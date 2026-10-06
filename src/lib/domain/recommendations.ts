import type { Capability, Mode, RecommendationType } from "@/lib/domain/constants";
import { CAPABILITY_LABELS } from "@/lib/domain/copy";
import { rankCapabilities, type Interpretation } from "@/lib/domain/interpretation";

// Recommendation Engine. Fuente: docs/innovaton/02-technical-spec.md §24 y
// 05-evidence-interpretation.md "Recomendación". No intenta corregir la capacidad más baja:
// falta de evidencia no significa debilidad.

/** Próximos experimentos (02 §24, 05 "Próximos experimentos"), literales. */
export const EXPERIMENT_TEMPLATES: Record<Capability, string> = {
  PROBLEM_UNDERSTANDING:
    "Antes de buscar soluciones, formulá en una frase cuál creés que es el problema real.",
  ASSUMPTION_QUESTIONING:
    "Identificá un supuesto que el equipo esté dando por cierto y preguntá cómo podrían comprobarlo.",
  IDEATION: "Generá al menos tres alternativas antes de elegir una.",
  PRIORITIZATION: "Cuando haya varias opciones, proponé un criterio y ayudá al equipo a decidir.",
  EXPERIMENTATION: "Convertí una idea en la prueba más pequeña posible para aprender algo.",
  COMMUNICATION:
    "Tomá una idea compleja del equipo e intentá explicarla claramente en menos de 30 segundos.",
};

/** Capacidad complementaria a explorar cuando la evidencia ya está concentrada. */
export const COMPLEMENT: Record<Capability, Capability> = {
  PROBLEM_UNDERSTANDING: "IDEATION",
  ASSUMPTION_QUESTIONING: "IDEATION",
  IDEATION: "EXPERIMENTATION",
  PRIORITIZATION: "ASSUMPTION_QUESTIONING",
  EXPERIMENTATION: "ASSUMPTION_QUESTIONING",
  COMMUNICATION: "PROBLEM_UNDERSTANDING",
};

/** Sin señal: experimento basado en el modo inicial para generar evidencia (02 §24, paso 4). */
export const MODE_DEFAULT_CAPABILITY: Record<Mode, Capability> = {
  EXPLORE: "PROBLEM_UNDERSTANDING",
  CREATE: "IDEATION",
  DRIVE: "EXPERIMENTATION",
};

export interface Recommendation {
  type: RecommendationType;
  capability: Capability;
  action: string;
  rationale: string;
}

function recommendation(
  type: RecommendationType,
  capability: Capability,
  rationale: string,
): Recommendation {
  return { type, capability, action: EXPERIMENT_TEMPLATES[capability], rationale };
}

export function generateRecommendation(
  interpretation: Interpretation,
  initialMode: Mode | null,
): Recommendation {
  const { type, primary, secondary, primaryLevel, secondaryLevel, scores } = interpretation;

  // 5. Sin señal individual: generar una situación más informativa.
  if (type === "INSUFFICIENT" || primary === null || primaryLevel === null) {
    const capability = initialMode ? MODE_DEFAULT_CAPABILITY[initialMode] : "PROBLEM_UNDERSTANDING";
    return recommendation(
      "GATHER_MORE_EVIDENCE",
      capability,
      "Todavía hay poca evidencia, y que algo no se haya visto hoy no significa que no esté. Este experimento crea una situación más fácil de observar.",
    );
  }

  // 1. Contradicción interesante con la hipótesis inicial: intentar replicarla.
  if (type === "DIVERGENT") {
    // Si la primaria es COMMUNICATION (transversal), la divergencia está en la capacidad de contraste.
    const capability =
      primary !== "COMMUNICATION"
        ? primary
        : (rankCapabilities(scores).find((s) => s.capability !== "COMMUNICATION")?.capability ??
          primary);
    return recommendation(
      "INVESTIGATE_DIVERGENCE",
      capability,
      `Aparecieron señales de ${CAPABILITY_LABELS[capability]}, algo distinto a tu punto de partida. Vale la pena ver si se repiten en otra situación.`,
    );
  }

  // 2. Evidencia concentrada en dos capacidades: explorar una complementaria sin evidencia todavía.
  if (primaryLevel === "CONVERGENT" && secondary !== null && secondaryLevel === "CONVERGENT") {
    const complement = [COMPLEMENT[primary], COMPLEMENT[secondary]].find(
      (c) => scores[c].level === "INSUFFICIENT",
    );
    if (complement) {
      return recommendation(
        "EXPLORE_COMPLEMENT",
        complement,
        `Ya aparecieron varias señales de ${CAPABILITY_LABELS[primary]} y de ${CAPABILITY_LABELS[secondary]}. Probar a propósito otro tipo de aporte te da información nueva sobre cómo podés sumar a un equipo.`,
      );
    }
  }

  // 3. Señal convergente en una sola experiencia: volver a observarla.
  if (primaryLevel === "CONVERGENT") {
    return recommendation(
      "REPLICATE_SIGNAL",
      primary,
      `Hoy aparecieron varias señales de ${CAPABILITY_LABELS[primary]}, pero en una sola experiencia. El próximo paso es ver si se repiten en otra situación.`,
    );
  }

  // 4. Una primera señal: repetirla a propósito.
  return recommendation(
    "GATHER_MORE_EVIDENCE",
    primary,
    `Apareció una primera señal de ${CAPABILITY_LABELS[primary]}. Repetirla a propósito ayuda a saber si es una forma habitual de aportar para vos.`,
  );
}

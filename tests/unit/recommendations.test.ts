import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  A3_BLOCKS,
  CAPABILITIES,
  MODES,
  REFLECTION_ACTIONS,
  type Capability,
  type Mode,
} from "@/lib/domain/constants";
import {
  evidenceFromA3Blocks,
  evidenceFromFounderAssessment,
  evidenceFromObservation,
  evidenceFromReflection,
} from "@/lib/domain/evidence";
import { interpret, type EvidenceInput } from "@/lib/domain/interpretation";
import {
  COMPLEMENT,
  EXPERIMENT_TEMPLATES,
  MODE_DEFAULT_CAPABILITY,
  generateRecommendation,
} from "@/lib/domain/recommendations";

const action = (capability: Capability): EvidenceInput => ({
  sourceType: "SELF_REPORT_ACTION",
  scope: "INDIVIDUAL",
  sourceWeight: 1,
  confidence: 1,
  signals: [{ capability, strength: 1 }],
});
const facilitator = (capability: Capability) =>
  evidenceFromObservation({ capability, observerSource: "FACILITATOR_OBSERVATION" });
const founder = (capability: Capability) =>
  evidenceFromObservation({ capability, observerSource: "FOUNDER_INDIVIDUAL" });

function recommend(initialMode: Mode | null, evidence: EvidenceInput[]) {
  const interpretation = interpret({ initialMode, evidence });
  return { interpretation, recommendation: generateRecommendation(interpretation, initialMode) };
}

describe("constantes", () => {
  it("usa los templates literales de 02 §24 / 05", () => {
    expect(EXPERIMENT_TEMPLATES).toEqual({
      PROBLEM_UNDERSTANDING:
        "Antes de buscar soluciones, formulá en una frase cuál creés que es el problema real.",
      ASSUMPTION_QUESTIONING:
        "Identificá un supuesto que el equipo esté dando por cierto y preguntá cómo podrían comprobarlo.",
      IDEATION: "Generá al menos tres alternativas antes de elegir una.",
      PRIORITIZATION: "Cuando haya varias opciones, proponé un criterio y ayudá al equipo a decidir.",
      EXPERIMENTATION: "Convertí una idea en la prueba más pequeña posible para aprender algo.",
      COMMUNICATION:
        "Tomá una idea compleja del equipo e intentá explicarla claramente en menos de 30 segundos.",
    });
  });

  it("COMPLEMENT y MODE_DEFAULT_CAPABILITY", () => {
    expect(COMPLEMENT).toEqual({
      PROBLEM_UNDERSTANDING: "IDEATION",
      ASSUMPTION_QUESTIONING: "IDEATION",
      IDEATION: "EXPERIMENTATION",
      PRIORITIZATION: "ASSUMPTION_QUESTIONING",
      EXPERIMENTATION: "ASSUMPTION_QUESTIONING",
      COMMUNICATION: "PROBLEM_UNDERSTANDING",
    });
    for (const c of CAPABILITIES) expect(COMPLEMENT[c]).not.toBe(c);
    expect(MODE_DEFAULT_CAPABILITY).toEqual({
      EXPLORE: "PROBLEM_UNDERSTANDING",
      CREATE: "IDEATION",
      DRIVE: "EXPERIMENTATION",
    });
  });
});

describe("generateRecommendation", () => {
  it("1. DIVERGENT → INVESTIGATE_DIVERGENCE sobre la primaria", () => {
    const { interpretation, recommendation } = recommend("CREATE", [
      ...evidenceFromReflection({
        selectedActions: ["CREATED_TEST"],
        primaryCapability: "EXPERIMENTATION",
      }),
      ...evidenceFromFounderAssessment({ problemScore: null, valueScore: null, testScore: 5 }),
    ]);
    expect(interpretation.type).toBe("DIVERGENT");
    expect(recommendation).toEqual({
      type: "INVESTIGATE_DIVERGENCE",
      capability: "EXPERIMENTATION",
      action: EXPERIMENT_TEMPLATES.EXPERIMENTATION,
      rationale:
        "Aparecieron señales de experimentación, algo distinto a tu punto de partida. Vale la pena ver si se repiten en otra situación.",
    });
  });

  it("1. DIVERGENT con COMMUNICATION primaria → investiga la capacidad de contraste", () => {
    const { interpretation, recommendation } = recommend("CREATE", [
      founder("COMMUNICATION"),
      action("COMMUNICATION"),
      facilitator("PRIORITIZATION"),
    ]);
    expect(interpretation.type).toBe("DIVERGENT");
    expect(interpretation.primary).toBe("COMMUNICATION");
    expect(recommendation.type).toBe("INVESTIGATE_DIVERGENCE");
    expect(recommendation.capability).toBe("PRIORITIZATION");
    expect(recommendation.action).toBe(EXPERIMENT_TEMPLATES.PRIORITIZATION);
  });

  it("2. primaria y secundaria CONVERGENT → EXPLORE_COMPLEMENT sobre el complemento de la primaria", () => {
    const { interpretation, recommendation } = recommend("DRIVE", [
      founder("PRIORITIZATION"),
      facilitator("EXPERIMENTATION"),
    ]);
    expect(interpretation).toMatchObject({
      type: "ALIGNED",
      primary: "PRIORITIZATION",
      primaryLevel: "CONVERGENT",
      secondary: "EXPERIMENTATION",
      secondaryLevel: "CONVERGENT",
    });
    expect(recommendation.type).toBe("EXPLORE_COMPLEMENT");
    expect(recommendation.capability).toBe("ASSUMPTION_QUESTIONING");
    expect(recommendation.action).toBe(EXPERIMENT_TEMPLATES.ASSUMPTION_QUESTIONING);
    expect(recommendation.rationale).toBe(
      "Ya aparecieron varias señales de síntesis y priorización y de experimentación. Probar a propósito otro tipo de aporte te da información nueva sobre cómo podés sumar a un equipo.",
    );
  });

  it("2. si el complemento de la primaria ya tiene evidencia, prueba el de la secundaria", () => {
    const { interpretation, recommendation } = recommend("EXPLORE", [
      founder("PROBLEM_UNDERSTANDING"),
      facilitator("IDEATION"),
    ]);
    expect([interpretation.primary, interpretation.secondary]).toEqual([
      "PROBLEM_UNDERSTANDING",
      "IDEATION",
    ]);
    // COMPLEMENT[PROBLEM_UNDERSTANDING] = IDEATION ya tiene evidencia → COMPLEMENT[IDEATION].
    expect(recommendation.type).toBe("EXPLORE_COMPLEMENT");
    expect(recommendation.capability).toBe("EXPERIMENTATION");
  });

  it("2 → 3. si ambos complementos ya tienen evidencia, replica la primaria", () => {
    const { recommendation } = recommend("EXPLORE", [
      founder("PROBLEM_UNDERSTANDING"),
      facilitator("IDEATION"),
      action("EXPERIMENTATION"),
    ]);
    expect(recommendation.type).toBe("REPLICATE_SIGNAL");
    expect(recommendation.capability).toBe("PROBLEM_UNDERSTANDING");
  });

  it("3. primaria CONVERGENT sola → REPLICATE_SIGNAL", () => {
    const { interpretation, recommendation } = recommend("DRIVE", [
      ...evidenceFromReflection({
        selectedActions: ["CREATED_TEST"],
        primaryCapability: "EXPERIMENTATION",
      }),
      ...evidenceFromA3Blocks(["TEST"]),
      ...evidenceFromFounderAssessment({ problemScore: null, valueScore: null, testScore: 5 }),
    ]);
    expect(interpretation.primaryLevel).toBe("CONVERGENT");
    expect(recommendation).toEqual({
      type: "REPLICATE_SIGNAL",
      capability: "EXPERIMENTATION",
      action: EXPERIMENT_TEMPLATES.EXPERIMENTATION,
      rationale:
        "Hoy aparecieron varias señales de experimentación, pero en una sola experiencia. El próximo paso es ver si se repiten en otra situación.",
    });
  });

  it("3. primaria CONVERGENT con secundaria SIGNAL → REPLICATE_SIGNAL", () => {
    const { recommendation } = recommend("EXPLORE", [
      facilitator("ASSUMPTION_QUESTIONING"),
      action("IDEATION"),
    ]);
    expect(recommendation.type).toBe("REPLICATE_SIGNAL");
    expect(recommendation.capability).toBe("ASSUMPTION_QUESTIONING");
  });

  it("4. primaria SIGNAL → GATHER_MORE_EVIDENCE sobre la primaria", () => {
    const { interpretation, recommendation } = recommend("CREATE", [
      ...evidenceFromReflection({
        selectedActions: ["PROPOSED_ALTERNATIVES"],
        primaryCapability: "IDEATION",
      }),
    ]);
    expect(interpretation.primaryLevel).toBe("SIGNAL");
    expect(recommendation).toEqual({
      type: "GATHER_MORE_EVIDENCE",
      capability: "IDEATION",
      action: EXPERIMENT_TEMPLATES.IDEATION,
      rationale:
        "Apareció una primera señal de generación de alternativas. Repetirla a propósito ayuda a saber si es una forma habitual de aportar para vos.",
    });
  });

  it.each(MODES.map((m) => [m]))(
    "5. sin señal con modo %s → GATHER_MORE_EVIDENCE sobre la capacidad del modo",
    (mode) => {
      const { interpretation, recommendation } = recommend(mode, [
        ...evidenceFromA3Blocks(["PROBLEM", "TEST"]),
      ]);
      expect(interpretation.type).toBe("INSUFFICIENT");
      expect(recommendation.type).toBe("GATHER_MORE_EVIDENCE");
      expect(recommendation.capability).toBe(MODE_DEFAULT_CAPABILITY[mode]);
      expect(recommendation.action).toBe(EXPERIMENT_TEMPLATES[MODE_DEFAULT_CAPABILITY[mode]]);
      expect(recommendation.rationale).toBe(
        "Todavía hay poca evidencia, y que algo no se haya visto hoy no significa que no esté. Este experimento crea una situación más fácil de observar.",
      );
    },
  );

  it("5. sin señal y sin modo inicial → comprensión del problema", () => {
    const { recommendation } = recommend(null, []);
    expect(recommendation.type).toBe("GATHER_MORE_EVIDENCE");
    expect(recommendation.capability).toBe("PROBLEM_UNDERSTANDING");
  });

  it("modo nulo con señal: recomienda según la evidencia", () => {
    const { interpretation, recommendation } = recommend(null, [facilitator("COMMUNICATION")]);
    expect(interpretation.type).toBe("MIXED");
    expect(recommendation.type).toBe("REPLICATE_SIGNAL");
    expect(recommendation.capability).toBe("COMMUNICATION");
  });

  it("ninguna recomendación habla de debilidades, fortalezas ni porcentajes", () => {
    const scenarios: [Mode | null, EvidenceInput[]][] = [
      [null, []],
      ["CREATE", [founder("EXPERIMENTATION")]],
      ["DRIVE", [founder("PRIORITIZATION"), facilitator("EXPERIMENTATION")]],
      ["DRIVE", [facilitator("EXPERIMENTATION")]],
      ["EXPLORE", [action("PROBLEM_UNDERSTANDING")]],
    ];
    const types = new Set<string>();
    for (const [mode, evidence] of scenarios) {
      const { recommendation } = recommend(mode, evidence);
      types.add(recommendation.type);
      expect(`${recommendation.action} ${recommendation.rationale}`).not.toMatch(
        /%|debilidad|fortaleza|corregir/i,
      );
    }
    expect(types.size).toBe(4);
  });
});

describe("templates literales", () => {
  const doc = (name: string) =>
    readFileSync(new URL(`../../docs/innovaton/${name}`, import.meta.url), "utf8");

  it("coinciden carácter por carácter con 05 'Próximos experimentos' y 02 §24", () => {
    const doc05 = doc("05-evidence-interpretation.md");
    const doc02 = doc("02-technical-spec.md");
    for (const template of Object.values(EXPERIMENT_TEMPLATES)) {
      expect(doc05).toContain(`> ${template}\n`);
      expect(doc02).toContain(`“${template}”`);
    }
  });
});

describe("EXPLORE_COMPLEMENT con evidencia concentrada realista", () => {
  it("Impulsar con prueba y priorización convergentes → explorar cuestionamiento de supuestos", () => {
    const { interpretation, recommendation } = recommend("DRIVE", [
      ...evidenceFromReflection({
        selectedActions: ["ORGANIZED_TEAM", "HELPED_CHOOSE", "CREATED_TEST", "PROPOSED_ALTERNATIVES"],
        primaryCapability: "EXPERIMENTATION",
      }),
      ...evidenceFromA3Blocks([...A3_BLOCKS]),
      ...evidenceFromFounderAssessment({ problemScore: null, valueScore: 5, testScore: 5 }),
    ]);
    expect([interpretation.primary, interpretation.secondary]).toEqual([
      "EXPERIMENTATION",
      "PRIORITIZATION",
    ]);
    expect(recommendation).toEqual({
      type: "EXPLORE_COMPLEMENT",
      capability: "ASSUMPTION_QUESTIONING",
      action: EXPERIMENT_TEMPLATES.ASSUMPTION_QUESTIONING,
      rationale:
        "Ya aparecieron varias señales de experimentación y de síntesis y priorización. Probar a propósito otro tipo de aporte te da información nueva sobre cómo podés sumar a un equipo.",
    });
  });
});

describe("invariantes de la recomendación sobre escenarios generados", () => {
  it("respeta el orden de 02 §24 en 3000 escenarios", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
    const scores = [null, 3, 4, 5] as const;

    for (let i = 0; i < 3000; i++) {
      const evidence: EvidenceInput[] = [];
      if (rnd() < 0.9) {
        evidence.push(
          ...evidenceFromReflection({
            selectedActions: REFLECTION_ACTIONS.filter(() => rnd() < 0.3),
            primaryCapability: pick(CAPABILITIES),
          }),
        );
      }
      if (rnd() < 0.6) evidence.push(...evidenceFromA3Blocks(A3_BLOCKS.filter(() => rnd() < 0.5)));
      if (rnd() < 0.6) {
        evidence.push(
          ...evidenceFromFounderAssessment({
            problemScore: pick(scores),
            valueScore: pick(scores),
            testScore: pick(scores),
          }),
        );
      }
      if (rnd() < 0.3) evidence.push(pick([facilitator, founder])(pick(CAPABILITIES)));
      const mode = pick([...MODES, null]);
      const { interpretation: r, recommendation: rec } = recommend(mode, evidence);

      expect(rec.action).toBe(EXPERIMENT_TEMPLATES[rec.capability]);
      expect(`${rec.action} ${rec.rationale}`).not.toMatch(/%|debilidad|fortaleza|corregir/i);
      expect(rec.type === "INVESTIGATE_DIVERGENCE").toBe(r.type === "DIVERGENT");

      if (r.type === "INSUFFICIENT") {
        expect(rec).toMatchObject({
          type: "GATHER_MORE_EVIDENCE",
          capability: mode ? MODE_DEFAULT_CAPABILITY[mode] : "PROBLEM_UNDERSTANDING",
        });
      } else if (r.type === "DIVERGENT") {
        // La divergencia se investiga sobre una capacidad con evidencia y fuera del modo inicial.
        expect(rec.capability).not.toBe("COMMUNICATION");
        expect(r.scores[rec.capability].level).toBe("CONVERGENT");
        expect(mode && MODE_DEFAULT_CAPABILITY[mode]).not.toBe(rec.capability);
      } else if (rec.type === "EXPLORE_COMPLEMENT") {
        // Solo con evidencia concentrada, y hacia una capacidad sin evidencia individual todavía.
        expect([r.primaryLevel, r.secondaryLevel]).toEqual(["CONVERGENT", "CONVERGENT"]);
        expect(r.scores[rec.capability].level).toBe("INSUFFICIENT");
      } else {
        expect(rec.capability).toBe(r.primary);
        expect(rec.type).toBe(
          r.primaryLevel === "CONVERGENT" ? "REPLICATE_SIGNAL" : "GATHER_MORE_EVIDENCE",
        );
      }
    }
  });
});

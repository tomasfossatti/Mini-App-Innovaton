import {
  ALGORITHM_VERSION,
  CAPABILITIES,
  type Capability,
  type EvidenceLevel,
  type EvidenceScope,
  type EvidenceSource,
  type InterpretationType,
  type Mode,
} from "@/lib/domain/constants";
import { CAPABILITY_LABELS, MODE_LABELS } from "@/lib/domain/copy";
import { evidenceCategory } from "@/lib/domain/evidence";

// Interpretation Engine. Fuente: docs/innovaton/02-technical-spec.md §21–§23 y
// 05-evidence-interpretation.md. Recibe solo evidencia de la experiencia y el modo inicial
// (hipótesis); las respuestas del cuestionario nunca entran acá.

/** Topes de 02 §21: la autodeclaración y lo grupal no pueden dominar el score. */
export const SELF_CAP = 2;
export const TEAM_CAP = 1.5;

/** 05 "Relación entre modos y capacidades". COMMUNICATION es transversal. */
export const MODE_CAPABILITIES: Record<Mode, Capability[]> = {
  EXPLORE: ["PROBLEM_UNDERSTANDING", "ASSUMPTION_QUESTIONING"],
  CREATE: ["IDEATION"],
  DRIVE: ["PRIORITIZATION", "EXPERIMENTATION"],
};

export const CAPABILITY_MODE: Record<Capability, Mode | null> = {
  PROBLEM_UNDERSTANDING: "EXPLORE",
  ASSUMPTION_QUESTIONING: "EXPLORE",
  IDEATION: "CREATE",
  PRIORITIZATION: "DRIVE",
  EXPERIMENTATION: "DRIVE",
  COMMUNICATION: null,
};

export interface EvidenceInput {
  sourceType: EvidenceSource;
  scope: EvidenceScope;
  sourceWeight: number;
  confidence: number;
  signals: readonly { capability: Capability; strength: number }[];
}

export interface CapabilityScore {
  capability: Capability;
  rawSelf: number;
  self: number;
  observed: number;
  rawTeam: number;
  team: number;
  effective: number;
  level: EvidenceLevel;
}

export interface InterpretationTypeResult {
  type: InterpretationType;
  primary: CapabilityScore | null;
  secondary: CapabilityScore | null;
  contrast: CapabilityScore | null;
}

export interface Interpretation {
  algorithmVersion: string;
  type: InterpretationType;
  primary: Capability | null;
  secondary: Capability | null;
  primaryLevel: EvidenceLevel | null;
  secondaryLevel: EvidenceLevel | null;
  summary: string;
  signalsText: string | null;
  scores: Record<Capability, CapabilityScore>;
}

/** Textos fijos (05 "Comparación con hipótesis inicial"). */
export const INTERPRETATION_TEXT = {
  aligned: "La hipótesis inicial encontró respaldo en lo que hiciste durante el desafío.",
  insufficient:
    "Esta experiencia todavía no alcanza para interpretar con claridad cómo tendiste a aportar. Necesitamos observar más situaciones.",
} as const;

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** 02 §22, al pie de la letra. */
export function determineEvidenceLevel(s: {
  self: number;
  observed: number;
  team: number;
}): EvidenceLevel {
  if (s.self === 0 && s.observed === 0) return "INSUFFICIENT";
  if (s.observed >= 2.5) return "CONVERGENT";
  if (s.self >= 1 && s.team >= 0.75) return "CONVERGENT";
  if (s.self >= 1 && s.observed >= 1) return "CONVERGENT";
  return "SIGNAL";
}

/** Score interno por capacidad: Σ(strength × source_weight × confidence) (05 "Score interno"). */
export function computeCapabilityScores(
  evidence: readonly EvidenceInput[],
): Record<Capability, CapabilityScore> {
  const totals = new Map<Capability, { self: number; observed: number; team: number }>(
    CAPABILITIES.map((c) => [c, { self: 0, observed: 0, team: 0 }]),
  );

  for (const item of evidence) {
    const category = evidenceCategory(item.sourceType, item.scope);
    for (const signal of item.signals) {
      const bucket = totals.get(signal.capability);
      const contribution = signal.strength * item.sourceWeight * item.confidence;
      // Señales sin aporte positivo (o datos corruptos) no suman ni restan.
      if (!bucket || !Number.isFinite(contribution) || contribution <= 0) continue;
      bucket[category] += contribution;
    }
  }

  const scores = {} as Record<Capability, CapabilityScore>;
  for (const capability of CAPABILITIES) {
    const t = totals.get(capability) ?? { self: 0, observed: 0, team: 0 };
    const rawSelf = round4(t.self);
    const self = Math.min(rawSelf, SELF_CAP);
    const observed = round4(t.observed);
    const rawTeam = round4(t.team);
    const team = Math.min(rawTeam, TEAM_CAP);
    // 02 §21: lo grupal solo cuenta si hay evidencia individual de esa capacidad.
    const effective = self > 0 || observed > 0 ? round4(self + observed + team) : 0;
    scores[capability] = {
      capability,
      rawSelf,
      self,
      observed,
      rawTeam,
      team,
      effective,
      level: determineEvidenceLevel({ self, observed, team }),
    };
  }
  return scores;
}

/** Capacidades con alguna señal individual, de más a menos evidencia. */
export function rankCapabilities(scores: Record<Capability, CapabilityScore>): CapabilityScore[] {
  return CAPABILITIES.map((c) => scores[c])
    .filter((s) => s.level !== "INSUFFICIENT")
    .sort(
      (a, b) =>
        b.effective - a.effective ||
        b.observed - a.observed ||
        b.self - a.self ||
        CAPABILITIES.indexOf(a.capability) - CAPABILITIES.indexOf(b.capability),
    );
}

/** Comparación con la hipótesis inicial (02 §23, 05 "Comparación con hipótesis inicial"). */
export function interpretationType(
  initialMode: Mode | null,
  ranked: readonly CapabilityScore[],
): InterpretationTypeResult {
  const primary = ranked[0] ?? null;
  if (!primary) return { type: "INSUFFICIENT", primary: null, secondary: null, contrast: null };
  // Se muestran como máximo dos capacidades.
  const secondary = ranked[1] ?? null;
  const result = (type: InterpretationType, contrast: CapabilityScore | null) => ({
    type,
    primary,
    secondary,
    contrast,
  });

  if (initialMode === null) return result("MIXED", null);

  // COMMUNICATION es transversal: no confirma ni contradice un modo.
  const anchor =
    primary.capability !== "COMMUNICATION"
      ? primary
      : ranked.find((s) => s.capability !== "COMMUNICATION");
  if (!anchor) return result("MIXED", null);

  const modeCapabilities = MODE_CAPABILITIES[initialMode];
  const inMode = (c: Capability) => modeCapabilities.includes(c);

  if (inMode(anchor.capability)) {
    const outsideConvergent = ranked.find(
      (s) => s.capability !== "COMMUNICATION" && !inMode(s.capability) && s.level === "CONVERGENT",
    );
    return outsideConvergent ? result("MIXED", outsideConvergent) : result("ALIGNED", null);
  }

  const modeConvergent = ranked.some((s) => inMode(s.capability) && s.level === "CONVERGENT");
  if (anchor.level === "CONVERGENT" && !modeConvergent) return result("DIVERGENT", anchor);
  return result("MIXED", anchor);
}

function label(s: CapabilityScore): string {
  return CAPABILITY_LABELS[s.capability];
}

/**
 * "A y B" como en el literal de 05 ("comprensión del problema y experimentación"). Si alguna
 * etiqueta ya lleva "y" ("síntesis y priorización"), se repite "de" para que no sea ambiguo.
 */
function joinLabels(a: CapabilityScore, b: CapabilityScore): string {
  const [la, lb] = [label(a), label(b)];
  return la.includes(" y ") || lb.includes(" y ") ? `${la} y de ${lb}` : `${la} y ${lb}`;
}

function singleFragment(s: CapabilityScore): string {
  return s.level === "CONVERGENT"
    ? `aparecieron varias señales de ${label(s)}`
    : `apareció una señal de ${label(s)}`;
}

/**
 * Fragmento con los niveles de hasta dos capacidades (05 "Niveles"), en minúscula y sin punto,
 * para poder usarlo solo o dentro de otra oración.
 */
function signalsFragment(
  primary: CapabilityScore | null,
  secondary: CapabilityScore | null,
): string | null {
  if (!primary) return null;
  if (!secondary) return singleFragment(primary);
  const primaryConvergent = primary.level === "CONVERGENT";
  const secondaryConvergent = secondary.level === "CONVERGENT";
  if (primaryConvergent && secondaryConvergent) {
    return `aparecieron varias señales de ${joinLabels(primary, secondary)}`;
  }
  if (!primaryConvergent && !secondaryConvergent) {
    return `aparecieron señales de ${label(primary)} y de ${label(secondary)}`;
  }
  // Niveles distintos: la convergente va primero para que la oración se lea natural.
  const [convergent, signal] = primaryConvergent ? [primary, secondary] : [secondary, primary];
  return `aparecieron varias señales de ${label(convergent)} y una señal de ${label(signal)}`;
}

function sentence(fragment: string): string {
  return `${fragment.charAt(0).toUpperCase()}${fragment.slice(1)}.`;
}

function buildSummary(
  initialMode: Mode | null,
  result: InterpretationTypeResult,
  fragment: string | null,
  ranked: readonly CapabilityScore[],
): string {
  const primary = result.primary;
  if (result.type === "INSUFFICIENT" || primary === null || fragment === null) {
    return INTERPRETATION_TEXT.insufficient;
  }
  const signals = sentence(fragment);

  // Sin hipótesis inicial no hay contra qué comparar: se describe solo lo que apareció.
  if (initialMode === null) return `En esta experiencia ${fragment}.`;

  const mode = MODE_LABELS[initialMode];
  const contrast = result.contrast;

  if (result.type === "ALIGNED") return `${INTERPRETATION_TEXT.aligned} ${signals}`;

  if (result.type === "DIVERGENT" && contrast) {
    const contrastMode = CAPABILITY_MODE[contrast.capability];
    if (contrastMode) {
      return `Aunque empezaste poniendo ${mode} en primer plano, durante esta experiencia aparecieron especialmente señales de ${MODE_LABELS[contrastMode]}. ${signals}`;
    }
  }

  // MIXED sin señales del modo inicial (solo comunicación, o señales sueltas de otro modo):
  // decir "además" sería engañoso, y el nivel va en la misma oración para no repetir.
  const modeCapabilities = MODE_CAPABILITIES[initialMode];
  const hasModeSignals = ranked.some((s) => modeCapabilities.includes(s.capability));
  if (!contrast || !hasModeSignals) return `Empezaste desde ${mode} y durante el desafío ${fragment}.`;

  // 05 "MIXED": "Empezaste desde Explorar y además aparecieron señales claras de ...".
  const strength = contrast.level === "CONVERGENT" ? "señales claras" : "señales";
  const mixed = `Empezaste desde ${mode} y además aparecieron ${strength} de ${label(contrast)}.`;
  // 02 §23 "Mostrar máximo dos capacidades": si el contraste quedó fuera de las dos primeras del
  // ranking, el resumen nombra solo la primaria y el contraste.
  const contrastShown =
    contrast.capability === primary.capability ||
    contrast.capability === result.secondary?.capability;
  return `${mixed} ${contrastShown ? signals : sentence(singleFragment(primary))}`;
}

export function interpret(input: {
  initialMode: Mode | null;
  evidence: readonly EvidenceInput[];
}): Interpretation {
  const scores = computeCapabilityScores(input.evidence);
  const ranked = rankCapabilities(scores);
  const result = interpretationType(input.initialMode, ranked);
  const fragment = signalsFragment(result.primary, result.secondary);

  return {
    algorithmVersion: ALGORITHM_VERSION,
    type: result.type,
    primary: result.primary?.capability ?? null,
    secondary: result.secondary?.capability ?? null,
    primaryLevel: result.primary?.level ?? null,
    secondaryLevel: result.secondary?.level ?? null,
    summary: buildSummary(input.initialMode, result, fragment, ranked),
    signalsText: fragment === null ? null : sentence(fragment),
    scores,
  };
}

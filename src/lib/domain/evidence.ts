import type {
  A3Block,
  Capability,
  EvidenceScope,
  EvidenceSource,
  ObserverSource,
  ReflectionAction,
} from "@/lib/domain/constants";

// Evidence Engine: traduce lo que pasó en la experiencia a items de evidencia con señales.
// Fuente: docs/innovaton/02-technical-spec.md §19–§21 y 05-evidence-interpretation.md.

/** Pesos por fuente (02 §20, 05 "Fuentes de evidencia"). */
export const SOURCE_WEIGHTS: Record<EvidenceSource, number> = {
  SELF_REPORT_ACTION: 1,
  SELF_REFLECTION_PRIMARY: 1.5,
  FOUNDER_INDIVIDUAL: 3,
  FACILITATOR_OBSERVATION: 2.5,
  FOUNDER_TEAM_SCORE: 1.5,
  TEAM_ARTIFACT: 1,
};

/**
 * El cuestionario genera una hipótesis (initial_mode) y nunca evidencia (05 "Regla central", 02 §20).
 * Valor documental: no existe una fuente de evidencia para el cuestionario ni una función que lo reciba.
 */
export const QUESTIONNAIRE_EVIDENCE_WEIGHT = 0;

/** Autodeclaración y reflexión abierta (02 §21 "Self"). */
export const SELF_SOURCES: readonly EvidenceSource[] = [
  "SELF_REPORT_ACTION",
  "SELF_REFLECTION_PRIMARY",
];
/** Founder individual + facilitador (02 §21 "Observed"). */
export const OBSERVED_SOURCES: readonly EvidenceSource[] = [
  "FOUNDER_INDIVIDUAL",
  "FACILITATOR_OBSERVATION",
];
/** Founder score + artefactos: pertenecen al equipo (02 §21 "Team"). */
export const TEAM_SOURCES: readonly EvidenceSource[] = ["FOUNDER_TEAM_SCORE", "TEAM_ARTIFACT"];

export type EvidenceCategory = "self" | "observed" | "team";

/**
 * Categoría con la que una evidencia suma al score. Todo lo que tenga scope TEAM cuenta como
 * evidencia de equipo aunque la fuente sea individual: lo grupal nunca se atribuye
 * automáticamente a cada integrante (05 "Regla para evidencia grupal").
 */
export function evidenceCategory(sourceType: EvidenceSource, scope: EvidenceScope): EvidenceCategory {
  if (scope === "TEAM" || TEAM_SOURCES.includes(sourceType)) return "team";
  if (OBSERVED_SOURCES.includes(sourceType)) return "observed";
  return "self";
}

export interface SignalDraft {
  capability: Capability;
  strength: number;
}

/** Acciones de la reflexión → señales (02 §19, 05 "Acciones → señales"). */
export const ACTION_SIGNALS: Record<ReflectionAction, SignalDraft[]> = {
  ASKED_QUESTIONS: [
    { capability: "PROBLEM_UNDERSTANDING", strength: 1 },
    { capability: "ASSUMPTION_QUESTIONING", strength: 0.5 },
  ],
  FOUND_ASSUMPTION: [{ capability: "ASSUMPTION_QUESTIONING", strength: 1 }],
  PROPOSED_ALTERNATIVES: [{ capability: "IDEATION", strength: 1 }],
  CONNECTED_IDEAS: [
    { capability: "IDEATION", strength: 0.75 },
    { capability: "COMMUNICATION", strength: 0.25 },
  ],
  HELPED_CHOOSE: [{ capability: "PRIORITIZATION", strength: 1 }],
  ORGANIZED_TEAM: [
    { capability: "PRIORITIZATION", strength: 0.75 },
    { capability: "COMMUNICATION", strength: 0.5 },
  ],
  CREATED_TEST: [{ capability: "EXPERIMENTATION", strength: 1 }],
  PRESENTED: [{ capability: "COMMUNICATION", strength: 1 }],
  OTHER: [],
};

/** Criterios del founder (PRD §21: Problema / Valor / Prueba) → capacidad que refuerzan. */
export const FOUNDER_SCORE_CAPABILITY = {
  problem: "PROBLEM_UNDERSTANDING",
  value: "IDEATION",
  test: "EXPERIMENTATION",
} as const satisfies Record<string, Capability>;

/**
 * Fuerza de un score founder (1–5). Solo 4 y 5 aportan: con peso 1.5, un 5 suma 1.5 y un 4 suma
 * 0.75, alineado con los umbrales de equipo de 02 §22.
 */
export function founderScoreStrength(score: number | null | undefined): number {
  if (score === 5) return 1;
  if (score === 4) return 0.5;
  return 0;
}

/** Bloques del A3 marcados por staff (PRD §19, §22: no hay análisis automático). */
export const A3_BLOCK_SIGNALS: Record<A3Block, SignalDraft[]> = {
  PROBLEM: [{ capability: "PROBLEM_UNDERSTANDING", strength: 0.75 }],
  HYPOTHESIS: [{ capability: "IDEATION", strength: 0.75 }],
  HOW_IT_WORKS: [{ capability: "PRIORITIZATION", strength: 0.75 }],
  TEST: [{ capability: "EXPERIMENTATION", strength: 0.75 }],
};

export interface EvidenceDraft {
  sourceType: EvidenceSource;
  scope: EvidenceScope;
  rawCode: string;
  rawText: string | null;
  sourceWeight: number;
  confidence: number;
  signals: SignalDraft[];
}

function cleanText(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function copySignals(signals: readonly SignalDraft[]): SignalDraft[] {
  return signals.map((s) => ({ capability: s.capability, strength: s.strength }));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** Reflexión final (PRD §23, preguntas 2 y 3). Evidencia individual autodeclarada. */
export function evidenceFromReflection(input: {
  selectedActions: readonly ReflectionAction[];
  primaryCapability: Capability;
  primaryContributionText?: string | null;
}): EvidenceDraft[] {
  const actionItems = unique(input.selectedActions).map(
    (action): EvidenceDraft => ({
      sourceType: "SELF_REPORT_ACTION",
      scope: "INDIVIDUAL",
      rawCode: action,
      rawText: null,
      sourceWeight: SOURCE_WEIGHTS.SELF_REPORT_ACTION,
      confidence: 1,
      // OTHER queda registrada pero no produce señales.
      signals: copySignals(ACTION_SIGNALS[action]),
    }),
  );

  const primaryItem: EvidenceDraft = {
    sourceType: "SELF_REFLECTION_PRIMARY",
    scope: "INDIVIDUAL",
    rawCode: input.primaryCapability,
    rawText: cleanText(input.primaryContributionText),
    sourceWeight: SOURCE_WEIGHTS.SELF_REFLECTION_PRIMARY,
    confidence: 1,
    signals: [{ capability: input.primaryCapability, strength: 1 }],
  };

  return [...actionItems, primaryItem];
}

/** Evaluación founder del equipo (PRD §21). Evidencia de equipo: solo refuerza, nunca origina. */
export function evidenceFromFounderAssessment(a: {
  problemScore: number | null;
  valueScore: number | null;
  testScore: number | null;
}): EvidenceDraft[] {
  const criteria = [
    { key: "PROBLEM", score: a.problemScore, capability: FOUNDER_SCORE_CAPABILITY.problem },
    { key: "VALUE", score: a.valueScore, capability: FOUNDER_SCORE_CAPABILITY.value },
    { key: "TEST", score: a.testScore, capability: FOUNDER_SCORE_CAPABILITY.test },
  ] as const;

  return criteria.flatMap(({ key, score, capability }): EvidenceDraft[] => {
    const strength = founderScoreStrength(score);
    if (strength <= 0) return [];
    return [
      {
        sourceType: "FOUNDER_TEAM_SCORE",
        scope: "TEAM",
        rawCode: `FOUNDER_SCORE_${key}:${score}`,
        rawText: null,
        sourceWeight: SOURCE_WEIGHTS.FOUNDER_TEAM_SCORE,
        confidence: 1,
        signals: [{ capability, strength }],
      },
    ];
  });
}

/** Bloques del A3 que el staff marcó como presentes. Evidencia de equipo. */
export function evidenceFromA3Blocks(blocks: readonly A3Block[]): EvidenceDraft[] {
  return unique(blocks).map(
    (block): EvidenceDraft => ({
      sourceType: "TEAM_ARTIFACT",
      scope: "TEAM",
      rawCode: `A3_BLOCK_${block}`,
      rawText: null,
      sourceWeight: SOURCE_WEIGHTS.TEAM_ARTIFACT,
      confidence: 1,
      signals: copySignals(A3_BLOCK_SIGNALS[block]),
    }),
  );
}

/** Observación individual de founder o facilitador (02 §10 addFounderObservation). */
export function evidenceFromObservation(o: {
  capability: Capability;
  observerSource: ObserverSource;
  note?: string | null;
}): EvidenceDraft {
  return {
    sourceType: o.observerSource,
    scope: "INDIVIDUAL",
    rawCode: o.capability,
    rawText: cleanText(o.note),
    sourceWeight: SOURCE_WEIGHTS[o.observerSource],
    confidence: 1,
    signals: [{ capability: o.capability, strength: 1 }],
  };
}

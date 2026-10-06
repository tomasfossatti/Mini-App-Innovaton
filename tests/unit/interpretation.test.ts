import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  A3_BLOCKS,
  ALGORITHM_VERSION,
  CAPABILITIES,
  MODES,
  REFLECTION_ACTIONS,
  type Capability,
  type EvidenceSource,
  type Mode,
} from "@/lib/domain/constants";
import { CAPABILITY_LABELS } from "@/lib/domain/copy";
import {
  evidenceFromA3Blocks,
  evidenceFromFounderAssessment,
  evidenceFromObservation,
  evidenceFromReflection,
} from "@/lib/domain/evidence";
import {
  CAPABILITY_MODE,
  INTERPRETATION_TEXT,
  MODE_CAPABILITIES,
  SELF_CAP,
  TEAM_CAP,
  computeCapabilityScores,
  determineEvidenceLevel,
  interpret,
  interpretationType,
  rankCapabilities,
  type EvidenceInput,
} from "@/lib/domain/interpretation";

// Helpers: evidencia mínima con una señal de fuerza 1.
function ev(
  sourceType: EvidenceSource,
  capability: Capability,
  opts: { strength?: number; confidence?: number; weight?: number } = {},
): EvidenceInput {
  const weights: Record<EvidenceSource, number> = {
    SELF_REPORT_ACTION: 1,
    SELF_REFLECTION_PRIMARY: 1.5,
    FOUNDER_INDIVIDUAL: 3,
    FACILITATOR_OBSERVATION: 2.5,
    FOUNDER_TEAM_SCORE: 1.5,
    TEAM_ARTIFACT: 1,
  };
  const team = sourceType === "FOUNDER_TEAM_SCORE" || sourceType === "TEAM_ARTIFACT";
  return {
    sourceType,
    scope: team ? "TEAM" : "INDIVIDUAL",
    sourceWeight: opts.weight ?? weights[sourceType],
    confidence: opts.confidence ?? 1,
    signals: [{ capability, strength: opts.strength ?? 1 }],
  };
}
const action = (c: Capability) => ev("SELF_REPORT_ACTION", c);
const facilitator = (c: Capability) => ev("FACILITATOR_OBSERVATION", c);
const founder = (c: Capability) => ev("FOUNDER_INDIVIDUAL", c);

describe("relación modos ↔ capacidades", () => {
  it("replica 05 y deja COMMUNICATION como transversal", () => {
    expect(MODE_CAPABILITIES).toEqual({
      EXPLORE: ["PROBLEM_UNDERSTANDING", "ASSUMPTION_QUESTIONING"],
      CREATE: ["IDEATION"],
      DRIVE: ["PRIORITIZATION", "EXPERIMENTATION"],
    });
    for (const c of CAPABILITIES) {
      const mode = CAPABILITY_MODE[c];
      if (c === "COMMUNICATION") expect(mode).toBeNull();
      else expect(mode && MODE_CAPABILITIES[mode]).toContain(c);
    }
  });
});

describe("determineEvidenceLevel (02 §22)", () => {
  it.each([
    [{ self: 0, observed: 0, team: 0 }, "INSUFFICIENT"],
    [{ self: 0, observed: 0, team: 1.5 }, "INSUFFICIENT"],
    [{ self: 0, observed: 2.5, team: 0 }, "CONVERGENT"],
    [{ self: 0, observed: 2.4999, team: 0 }, "SIGNAL"],
    [{ self: 0, observed: 3, team: 0 }, "CONVERGENT"],
    [{ self: 1, observed: 0, team: 0.75 }, "CONVERGENT"],
    [{ self: 0.9999, observed: 0, team: 0.75 }, "SIGNAL"],
    [{ self: 1, observed: 0, team: 0.7499 }, "SIGNAL"],
    [{ self: 1, observed: 1, team: 0 }, "CONVERGENT"],
    [{ self: 1, observed: 0.9999, team: 0 }, "SIGNAL"],
    [{ self: 0.5, observed: 1, team: 0 }, "SIGNAL"],
    [{ self: 0.5, observed: 0, team: 1.5 }, "SIGNAL"],
    [{ self: 2, observed: 0, team: 0 }, "SIGNAL"],
    [{ self: 2, observed: 0, team: 0.5 }, "SIGNAL"],
  ] as const)("%o → %s", (s, expected) => {
    expect(determineEvidenceLevel(s)).toBe(expected);
  });
});

describe("computeCapabilityScores", () => {
  it("sin evidencia todas las capacidades quedan INSUFFICIENT con score 0", () => {
    const scores = computeCapabilityScores([]);
    expect(Object.keys(scores).sort()).toEqual([...CAPABILITIES].sort());
    for (const c of CAPABILITIES) {
      expect(scores[c]).toEqual({
        capability: c,
        rawSelf: 0,
        self: 0,
        observed: 0,
        rawTeam: 0,
        team: 0,
        effective: 0,
        level: "INSUFFICIENT",
      });
    }
  });

  it("aplica strength × peso × confianza", () => {
    const scores = computeCapabilityScores([
      ev("SELF_REFLECTION_PRIMARY", "IDEATION", { strength: 0.5, confidence: 0.8 }),
    ]);
    expect(scores.IDEATION.rawSelf).toBe(0.6);
  });

  it("topea self en 2 (dos autodeclaraciones solas dan SIGNAL)", () => {
    const scores = computeCapabilityScores(
      evidenceFromReflection({
        selectedActions: ["ASKED_QUESTIONS"],
        primaryCapability: "PROBLEM_UNDERSTANDING",
      }),
    );
    expect(SELF_CAP).toBe(2);
    expect(scores.PROBLEM_UNDERSTANDING).toMatchObject({
      rawSelf: 2.5,
      self: 2,
      effective: 2,
      level: "SIGNAL",
    });
    expect(scores.ASSUMPTION_QUESTIONING).toMatchObject({ self: 0.5, level: "SIGNAL" });
  });

  it("topea team en 1.5", () => {
    const scores = computeCapabilityScores([
      action("EXPERIMENTATION"),
      ...evidenceFromA3Blocks(["TEST"]),
      ...evidenceFromFounderAssessment({ problemScore: null, valueScore: null, testScore: 5 }),
    ]);
    expect(TEAM_CAP).toBe(1.5);
    expect(scores.EXPERIMENTATION).toMatchObject({
      rawTeam: 2.25,
      team: 1.5,
      self: 1,
      effective: 2.5,
      level: "CONVERGENT",
    });
  });

  it("evidencia SOLO de equipo: effective 0 e INSUFFICIENT", () => {
    const scores = computeCapabilityScores([
      ...evidenceFromA3Blocks(["PROBLEM", "HYPOTHESIS", "HOW_IT_WORKS", "TEST"]),
      ...evidenceFromFounderAssessment({ problemScore: 5, valueScore: 5, testScore: 5 }),
    ]);
    for (const c of CAPABILITIES) {
      expect(scores[c].effective).toBe(0);
      expect(scores[c].level).toBe("INSUFFICIENT");
    }
    // El dato interno se conserva para auditoría, pero no se atribuye a la persona.
    expect(scores.EXPERIMENTATION.rawTeam).toBe(2.25);
    expect(rankCapabilities(scores)).toEqual([]);
  });

  it("observación founder sola → CONVERGENT (3 >= 2.5)", () => {
    const scores = computeCapabilityScores([
      evidenceFromObservation({ capability: "IDEATION", observerSource: "FOUNDER_INDIVIDUAL" }),
    ]);
    expect(scores.IDEATION).toMatchObject({ observed: 3, effective: 3, level: "CONVERGENT" });
  });

  it("observación de facilitador sola → CONVERGENT (2.5)", () => {
    const scores = computeCapabilityScores([
      evidenceFromObservation({
        capability: "PRIORITIZATION",
        observerSource: "FACILITATOR_OBSERVATION",
      }),
    ]);
    expect(scores.PRIORITIZATION).toMatchObject({
      observed: 2.5,
      effective: 2.5,
      level: "CONVERGENT",
    });
  });

  it("self 1 + team 0.75 → CONVERGENT", () => {
    const scores = computeCapabilityScores([
      action("EXPERIMENTATION"),
      ...evidenceFromA3Blocks(["TEST"]),
    ]);
    expect(scores.EXPERIMENTATION).toMatchObject({
      self: 1,
      team: 0.75,
      effective: 1.75,
      level: "CONVERGENT",
    });
  });

  it("self 1 + team 0.75 de founder score 4 → CONVERGENT", () => {
    const scores = computeCapabilityScores([
      action("PROBLEM_UNDERSTANDING"),
      ...evidenceFromFounderAssessment({ problemScore: 4, valueScore: null, testScore: null }),
    ]);
    expect(scores.PROBLEM_UNDERSTANDING).toMatchObject({ team: 0.75, level: "CONVERGENT" });
  });

  it("self 1 + observed 1 → CONVERGENT", () => {
    const scores = computeCapabilityScores([
      action("ASSUMPTION_QUESTIONING"),
      ev("FACILITATOR_OBSERVATION", "ASSUMPTION_QUESTIONING", { confidence: 0.4 }),
    ]);
    expect(scores.ASSUMPTION_QUESTIONING).toMatchObject({
      self: 1,
      observed: 1,
      effective: 2,
      level: "CONVERGENT",
    });
  });

  it("self 2 sin más → SIGNAL", () => {
    const scores = computeCapabilityScores([action("IDEATION"), action("IDEATION")]);
    expect(scores.IDEATION).toMatchObject({ self: 2, effective: 2, level: "SIGNAL" });
  });

  it("redondea a 4 decimales para evitar ruido de punto flotante", () => {
    const tenth = ev("SELF_REPORT_ACTION", "IDEATION", { confidence: 0.1 });
    const scores = computeCapabilityScores([tenth, tenth, tenth]);
    expect(scores.IDEATION.rawSelf).toBe(0.3);
    expect(scores.IDEATION.effective).toBe(0.3);
  });

  it("evidencia con scope TEAM nunca suma como individual", () => {
    const scores = computeCapabilityScores([{ ...founder("IDEATION"), scope: "TEAM" }]);
    expect(scores.IDEATION).toMatchObject({ observed: 0, team: 1.5, level: "INSUFFICIENT" });
  });

  it("ignora aportes no positivos o inválidos", () => {
    const scores = computeCapabilityScores([
      ev("SELF_REPORT_ACTION", "IDEATION", { strength: -1 }),
      ev("SELF_REPORT_ACTION", "IDEATION", { confidence: 0 }),
      ev("SELF_REPORT_ACTION", "IDEATION", { weight: Number.NaN }),
    ]);
    expect(scores.IDEATION.level).toBe("INSUFFICIENT");
    expect(scores.IDEATION.rawSelf).toBe(0);
  });
});

describe("rankCapabilities", () => {
  it("excluye INSUFFICIENT y ordena por effective, observed, self e índice", () => {
    const scores = computeCapabilityScores([
      // effective 2 (self)
      action("COMMUNICATION"),
      action("COMMUNICATION"),
      // effective 2 (self 1 + observed 1) → gana por observed
      action("PRIORITIZATION"),
      ev("FACILITATOR_OBSERVATION", "PRIORITIZATION", { confidence: 0.4 }),
      // effective 2.5 → primero
      facilitator("EXPERIMENTATION"),
      // empatan en todo: decide el índice en CAPABILITIES
      ev("SELF_REPORT_ACTION", "IDEATION", { strength: 0.5 }),
      ev("SELF_REPORT_ACTION", "ASSUMPTION_QUESTIONING", { strength: 0.5 }),
      // solo equipo → no aparece
      ...evidenceFromA3Blocks(["PROBLEM"]),
    ]);
    expect(rankCapabilities(scores).map((s) => s.capability)).toEqual([
      "EXPERIMENTATION",
      "PRIORITIZATION",
      "COMMUNICATION",
      "ASSUMPTION_QUESTIONING",
      "IDEATION",
    ]);
  });

  it("a igual effective y observed, desempata por self", () => {
    const scores = computeCapabilityScores([
      // effective 1.75 = self 1 + team 0.75
      action("EXPERIMENTATION"),
      ...evidenceFromA3Blocks(["TEST"]),
      // effective 1.75 = self 1.75
      action("PROBLEM_UNDERSTANDING"),
      ev("SELF_REPORT_ACTION", "PROBLEM_UNDERSTANDING", { strength: 0.75 }),
    ]);
    expect(rankCapabilities(scores).map((s) => s.capability)).toEqual([
      "PROBLEM_UNDERSTANDING",
      "EXPERIMENTATION",
    ]);
  });
});

describe("interpretationType", () => {
  const rank = (evidence: EvidenceInput[]) => rankCapabilities(computeCapabilityScores(evidence));

  it("sin ranking → INSUFFICIENT", () => {
    expect(interpretationType("EXPLORE", [])).toEqual({
      type: "INSUFFICIENT",
      primary: null,
      secondary: null,
      contrast: null,
    });
  });

  it("modo inicial nulo → MIXED", () => {
    const r = interpretationType(null, rank([facilitator("IDEATION")]));
    expect(r.type).toBe("MIXED");
    expect(r.primary?.capability).toBe("IDEATION");
    expect(r.contrast).toBeNull();
  });

  it("primaria dentro del modo y nada convergente afuera → ALIGNED", () => {
    const r = interpretationType(
      "EXPLORE",
      rank([facilitator("PROBLEM_UNDERSTANDING"), action("IDEATION")]),
    );
    expect(r.type).toBe("ALIGNED");
    expect(r.secondary?.capability).toBe("IDEATION");
  });

  it("primaria dentro del modo + otra convergente afuera → MIXED con contraste", () => {
    const r = interpretationType(
      "EXPLORE",
      rank([founder("PROBLEM_UNDERSTANDING"), facilitator("IDEATION")]),
    );
    expect(r.type).toBe("MIXED");
    expect(r.contrast?.capability).toBe("IDEATION");
  });

  it("primaria convergente afuera y sin convergencia en el modo → DIVERGENT", () => {
    const r = interpretationType(
      "CREATE",
      rank([founder("PRIORITIZATION"), action("IDEATION")]),
    );
    expect(r.type).toBe("DIVERGENT");
    expect(r.contrast?.capability).toBe("PRIORITIZATION");
  });

  it("primaria convergente afuera pero el modo también converge → MIXED", () => {
    const r = interpretationType(
      "CREATE",
      rank([founder("PRIORITIZATION"), facilitator("IDEATION")]),
    );
    expect(r.type).toBe("MIXED");
    expect(r.contrast?.capability).toBe("PRIORITIZATION");
  });

  it("primaria solo SIGNAL fuera del modo → MIXED", () => {
    const r = interpretationType("CREATE", rank([action("EXPERIMENTATION")]));
    expect(r.type).toBe("MIXED");
    expect(r.contrast?.capability).toBe("EXPERIMENTATION");
  });

  it("COMMUNICATION primaria: decide la primera capacidad no transversal", () => {
    const aligned = interpretationType(
      "EXPLORE",
      rank([founder("COMMUNICATION"), action("PROBLEM_UNDERSTANDING")]),
    );
    expect(aligned.type).toBe("ALIGNED");
    expect(aligned.primary?.capability).toBe("COMMUNICATION");

    const divergent = interpretationType(
      "CREATE",
      rank([founder("COMMUNICATION"), action("COMMUNICATION"), facilitator("EXPERIMENTATION")]),
    );
    expect(divergent.type).toBe("DIVERGENT");
    expect(divergent.primary?.capability).toBe("COMMUNICATION");
    expect(divergent.contrast?.capability).toBe("EXPERIMENTATION");
  });

  it("solo COMMUNICATION → MIXED sin contraste", () => {
    const r = interpretationType("DRIVE", rank([facilitator("COMMUNICATION")]));
    expect(r).toMatchObject({ type: "MIXED", contrast: null, secondary: null });
  });

  it("COMMUNICATION convergente afuera no vuelve MIXED a una interpretación alineada", () => {
    const r = interpretationType(
      "DRIVE",
      rank([founder("EXPERIMENTATION"), facilitator("COMMUNICATION")]),
    );
    expect(r.type).toBe("ALIGNED");
  });
});

describe("interpret", () => {
  it("ejemplo de Tomás (05): declara la prueba + A3 con prueba + founder Prueba=5 → experimentación CONVERGENT", () => {
    const tomas = [
      ...evidenceFromReflection({
        selectedActions: ["CREATED_TEST"],
        primaryCapability: "EXPERIMENTATION",
        primaryContributionText: "Convertí la idea en una prueba",
      }),
      ...evidenceFromA3Blocks(["TEST"]),
      ...evidenceFromFounderAssessment({ problemScore: 3, valueScore: 3, testScore: 5 }),
    ];
    const result = interpret({ initialMode: "DRIVE", evidence: tomas });

    expect(result).toMatchObject({
      algorithmVersion: ALGORITHM_VERSION,
      type: "ALIGNED",
      primary: "EXPERIMENTATION",
      primaryLevel: "CONVERGENT",
      secondary: null,
      secondaryLevel: null,
      signalsText: "Aparecieron varias señales de experimentación.",
      summary:
        "La hipótesis inicial encontró respaldo en lo que hiciste durante el desafío. Aparecieron varias señales de experimentación.",
    });
    expect(result.scores.EXPERIMENTATION).toMatchObject({ self: 2, team: 1.5, effective: 3.5 });
  });

  it("A3 bueno no vuelve buenos experimentando a todos los integrantes (05)", () => {
    const teamEvidence = [
      ...evidenceFromA3Blocks(["TEST"]),
      ...evidenceFromFounderAssessment({ problemScore: null, valueScore: null, testScore: 5 }),
    ];
    const companero = interpret({
      initialMode: "EXPLORE",
      evidence: [
        ...evidenceFromReflection({
          selectedActions: ["ASKED_QUESTIONS"],
          primaryCapability: "PROBLEM_UNDERSTANDING",
        }),
        ...teamEvidence,
      ],
    });
    expect(companero.scores.EXPERIMENTATION).toMatchObject({ effective: 0, level: "INSUFFICIENT" });
    expect([companero.primary, companero.secondary]).not.toContain("EXPERIMENTATION");
  });

  it("sin evidencia → INSUFFICIENT con el texto literal de 05", () => {
    const result = interpret({ initialMode: "CREATE", evidence: [] });
    expect(result).toMatchObject({
      type: "INSUFFICIENT",
      primary: null,
      secondary: null,
      primaryLevel: null,
      secondaryLevel: null,
      signalsText: null,
      summary: INTERPRETATION_TEXT.insufficient,
    });
    expect(result.summary).toBe(
      "Esta experiencia todavía no alcanza para interpretar con claridad cómo tendiste a aportar. Necesitamos observar más situaciones.",
    );
  });

  it("solo evidencia de equipo → INSUFFICIENT", () => {
    const result = interpret({
      initialMode: "DRIVE",
      evidence: [
        ...evidenceFromA3Blocks(["TEST", "HOW_IT_WORKS"]),
        ...evidenceFromFounderAssessment({ problemScore: 5, valueScore: 5, testScore: 5 }),
      ],
    });
    expect(result.type).toBe("INSUFFICIENT");
    expect(result.signalsText).toBeNull();
  });

  it("DIVERGENT (05): empezó en Crear y aparecieron señales de Impulsar", () => {
    const result = interpret({
      initialMode: "CREATE",
      evidence: [
        ...evidenceFromReflection({
          selectedActions: ["CREATED_TEST", "HELPED_CHOOSE"],
          primaryCapability: "EXPERIMENTATION",
        }),
        ...evidenceFromFounderAssessment({ problemScore: null, valueScore: null, testScore: 5 }),
      ],
    });
    expect(result.type).toBe("DIVERGENT");
    expect(result.primary).toBe("EXPERIMENTATION");
    expect(result.secondary).toBe("PRIORITIZATION");
    expect(result.summary).toBe(
      "Aunque empezaste poniendo Crear en primer plano, durante esta experiencia aparecieron especialmente señales de Impulsar. Aparecieron varias señales de experimentación y una señal de síntesis y priorización.",
    );
  });

  it("MIXED (05): empezó en Explorar y además aparecieron señales claras de generación de alternativas", () => {
    const result = interpret({
      initialMode: "EXPLORE",
      evidence: [
        ...evidenceFromReflection({
          selectedActions: ["ASKED_QUESTIONS", "PROPOSED_ALTERNATIVES"],
          primaryCapability: "PROBLEM_UNDERSTANDING",
        }),
        ...evidenceFromFounderAssessment({ problemScore: 5, valueScore: 4, testScore: 2 }),
      ],
    });
    expect(result.type).toBe("MIXED");
    expect(result.primary).toBe("PROBLEM_UNDERSTANDING");
    expect(result.secondary).toBe("IDEATION");
    expect(result.summary).toBe(
      "Empezaste desde Explorar y además aparecieron señales claras de generación de alternativas. Aparecieron varias señales de comprensión del problema y generación de alternativas.",
    );
  });

  it("output de ejemplo de 05: varias señales de comprensión del problema y experimentación", () => {
    const result = interpret({
      initialMode: "EXPLORE",
      evidence: [
        ...evidenceFromReflection({
          selectedActions: ["FOUND_ASSUMPTION", "HELPED_CHOOSE", "CREATED_TEST"],
          primaryCapability: "PROBLEM_UNDERSTANDING",
        }),
        ...evidenceFromA3Blocks(["TEST"]),
        ...evidenceFromFounderAssessment({ problemScore: 5, valueScore: 3, testScore: 5 }),
      ],
    });
    expect(result.type).toBe("MIXED");
    expect(result.signalsText).toBe(
      "Aparecieron varias señales de comprensión del problema y experimentación.",
    );
  });

  it("MIXED con señales fuera del modo y nada del modo: no dice 'además' ni repite", () => {
    const one = interpret({ initialMode: "EXPLORE", evidence: [action("IDEATION")] });
    expect(one.type).toBe("MIXED");
    expect(one.summary).toBe(
      "Empezaste desde Explorar y durante el desafío apareció una señal de generación de alternativas.",
    );
    const two = interpret({
      initialMode: "EXPLORE",
      evidence: [action("IDEATION"), action("IDEATION"), action("EXPERIMENTATION")],
    });
    expect(two.type).toBe("MIXED");
    expect(two.summary).toBe(
      "Empezaste desde Explorar y durante el desafío aparecieron señales de generación de alternativas y de experimentación.",
    );
  });

  it("modo inicial nulo → MIXED describiendo solo lo que apareció", () => {
    const result = interpret({
      initialMode: null,
      evidence: [action("IDEATION"), facilitator("PROBLEM_UNDERSTANDING")],
    });
    expect(result.type).toBe("MIXED");
    expect(result.summary).toBe(
      "En esta experiencia aparecieron varias señales de comprensión del problema y una señal de generación de alternativas.",
    );
    expect(result.signalsText).toBe(
      "Aparecieron varias señales de comprensión del problema y una señal de generación de alternativas.",
    );
  });

  it("modo nulo con una sola señal", () => {
    const result = interpret({ initialMode: null, evidence: [action("PRIORITIZATION")] });
    expect(result.summary).toBe("En esta experiencia apareció una señal de síntesis y priorización.");
  });

  it("COMMUNICATION como primaria con anclaje dentro del modo → ALIGNED", () => {
    const result = interpret({
      initialMode: "EXPLORE",
      evidence: [
        ...evidenceFromReflection({
          selectedActions: ["PRESENTED", "ASKED_QUESTIONS"],
          primaryCapability: "COMMUNICATION",
        }),
        evidenceFromObservation({
          capability: "COMMUNICATION",
          observerSource: "FACILITATOR_OBSERVATION",
        }),
      ],
    });
    expect(result.type).toBe("ALIGNED");
    expect(result.primary).toBe("COMMUNICATION");
    expect(result.secondary).toBe("PROBLEM_UNDERSTANDING");
    expect(result.signalsText).toBe(
      "Aparecieron varias señales de comunicación y colaboración y una señal de comprensión del problema.",
    );
  });

  it("solo comunicación → MIXED con texto propio", () => {
    const result = interpret({
      initialMode: "CREATE",
      evidence: [facilitator("COMMUNICATION")],
    });
    expect(result.type).toBe("MIXED");
    expect(result.summary).toBe(
      "Empezaste desde Crear y durante el desafío aparecieron varias señales de comunicación y colaboración.",
    );
  });

  it("ambas capacidades SIGNAL", () => {
    const result = interpret({
      initialMode: "DRIVE",
      evidence: [action("PRIORITIZATION"), ev("SELF_REPORT_ACTION", "EXPERIMENTATION", { strength: 0.5 })],
    });
    expect(result.type).toBe("ALIGNED");
    expect(result.signalsText).toBe(
      "Aparecieron señales de síntesis y priorización y de experimentación.",
    );
  });

  it("primaria SIGNAL y secundaria CONVERGENT: la convergente se nombra primero", () => {
    const result = interpret({
      initialMode: "EXPLORE",
      evidence: [
        // self 2 + team 0.5 → effective 2.5, SIGNAL
        action("PROBLEM_UNDERSTANDING"),
        action("PROBLEM_UNDERSTANDING"),
        ev("TEAM_ARTIFACT", "PROBLEM_UNDERSTANDING", { strength: 0.5 }),
        // self 1 + team 0.75 → effective 1.75, CONVERGENT
        action("ASSUMPTION_QUESTIONING"),
        ev("TEAM_ARTIFACT", "ASSUMPTION_QUESTIONING", { strength: 0.75 }),
      ],
    });
    expect(result.primary).toBe("PROBLEM_UNDERSTANDING");
    expect(result.primaryLevel).toBe("SIGNAL");
    expect(result.secondaryLevel).toBe("CONVERGENT");
    expect(result.signalsText).toBe(
      "Aparecieron varias señales de cuestionamiento de supuestos y una señal de comprensión del problema.",
    );
  });

  it("muestra como máximo dos capacidades", () => {
    const result = interpret({
      initialMode: "EXPLORE",
      evidence: [founder("PROBLEM_UNDERSTANDING"), facilitator("IDEATION"), action("PRIORITIZATION")],
    });
    expect([result.primary, result.secondary]).toEqual(["PROBLEM_UNDERSTANDING", "IDEATION"]);
    expect(result.summary).not.toContain("síntesis");
  });

  it("es determinístico e independiente del orden de la evidencia", () => {
    const evidence = [
      ...evidenceFromReflection({
        selectedActions: ["CONNECTED_IDEAS", "ORGANIZED_TEAM"],
        primaryCapability: "IDEATION",
      }),
      ...evidenceFromA3Blocks(["HYPOTHESIS"]),
      facilitator("PRIORITIZATION"),
    ];
    const a = interpret({ initialMode: "CREATE", evidence });
    const b = interpret({ initialMode: "CREATE", evidence: [...evidence].reverse() });
    expect(b).toEqual(a);
  });

  it("nunca muestra porcentajes, 'fortaleza' ni 'debilidad'", () => {
    const scenarios: { initialMode: Mode | null; evidence: EvidenceInput[] }[] = [
      { initialMode: "EXPLORE", evidence: [] },
      { initialMode: "CREATE", evidence: [founder("EXPERIMENTATION")] },
      { initialMode: "DRIVE", evidence: [action("PRIORITIZATION"), facilitator("IDEATION")] },
      { initialMode: null, evidence: [action("COMMUNICATION")] },
      { initialMode: "EXPLORE", evidence: [facilitator("COMMUNICATION")] },
    ];
    for (const s of scenarios) {
      const r = interpret(s);
      const text = `${r.summary} ${r.signalsText ?? ""}`;
      expect(text).not.toMatch(/%|fortaleza|debilidad/i);
    }
  });
});

describe("el cuestionario no es evidencia", () => {
  const evidence = [
    ...evidenceFromReflection({
      selectedActions: ["ASKED_QUESTIONS", "CREATED_TEST"],
      primaryCapability: "EXPERIMENTATION",
    }),
    ...evidenceFromA3Blocks(["TEST"]),
    facilitator("IDEATION"),
  ];

  it("el modo inicial (hipótesis) no cambia ningún score", () => {
    const baseline = interpret({ initialMode: null, evidence }).scores;
    for (const mode of MODES) {
      expect(interpret({ initialMode: mode, evidence }).scores).toEqual(baseline);
    }
    expect(baseline).toEqual(computeCapabilityScores(evidence));
  });

  it("con modo inicial pero sin evidencia de la experiencia el resultado es INSUFFICIENT", () => {
    for (const mode of MODES) {
      expect(interpret({ initialMode: mode, evidence: [] }).type).toBe("INSUFFICIENT");
    }
  });

  it("interpret solo acepta evidencia + modo inicial", () => {
    interpret({
      initialMode: "EXPLORE",
      evidence: [],
      // @ts-expect-error las respuestas del cuestionario no son una entrada válida
      questionnaireAnswers: [{ questionKey: "q1", selectedMode: "EXPLORE" }],
    });
    // Tampoco existe una fuente de evidencia para el cuestionario.
    const questionnaireLike: EvidenceInput = {
      // @ts-expect-error QUESTIONNAIRE no es una EvidenceSource
      sourceType: "QUESTIONNAIRE",
      scope: "INDIVIDUAL",
      sourceWeight: 0,
      confidence: 1,
      signals: [],
    };
    expect(questionnaireLike.sourceWeight).toBe(0);
  });
});

describe("copy literal de 05", () => {
  const doc05 = readFileSync(
    new URL("../../docs/innovaton/05-evidence-interpretation.md", import.meta.url),
    "utf8",
  );

  it("ALIGNED, DIVERGENT e INSUFFICIENT coinciden carácter por carácter con 05", () => {
    expect(doc05).toContain(`> ${INTERPRETATION_TEXT.aligned}\n`);
    expect(doc05).toContain(`> ${INTERPRETATION_TEXT.insufficient}\n`);
    const divergent = interpret({ initialMode: "CREATE", evidence: [founder("PRIORITIZATION")] });
    const [typeSentence] = divergent.summary.split(/(?<=\.) /);
    expect(doc05).toContain(`> ${typeSentence}\n`);
  });

  it("el ejemplo de salida de 05 se reproduce literal", () => {
    const result = interpret({
      initialMode: "EXPLORE",
      evidence: [founder("PROBLEM_UNDERSTANDING"), facilitator("EXPERIMENTATION")],
    });
    expect(doc05).toContain(`> ${result.signalsText}\n`);
  });
});

describe("textos con dos capacidades", () => {
  it("si una etiqueta ya lleva 'y', repite 'de' para que no sea ambiguo", () => {
    const result = interpret({
      initialMode: "DRIVE",
      evidence: [founder("PRIORITIZATION"), facilitator("EXPERIMENTATION")],
    });
    expect(result.signalsText).toBe(
      "Aparecieron varias señales de síntesis y priorización y de experimentación.",
    );
    const communication = interpret({
      initialMode: null,
      evidence: [founder("COMMUNICATION"), facilitator("PROBLEM_UNDERSTANDING")],
    });
    expect(communication.summary).toBe(
      "En esta experiencia aparecieron varias señales de comunicación y colaboración y de comprensión del problema.",
    );
  });

  it("MIXED con el contraste fuera de las dos primeras: nombra solo primaria y contraste (02 §23)", () => {
    // Impulsar: organizó, ayudó a elegir, armó la prueba y propuso alternativas; A3 completo y
    // founder Valor=5 y Prueba=5. Ranking: experimentación, priorización, generación de alternativas.
    const result = interpret({
      initialMode: "DRIVE",
      evidence: [
        ...evidenceFromReflection({
          selectedActions: ["ORGANIZED_TEAM", "HELPED_CHOOSE", "CREATED_TEST", "PROPOSED_ALTERNATIVES"],
          primaryCapability: "EXPERIMENTATION",
        }),
        ...evidenceFromA3Blocks([...A3_BLOCKS]),
        ...evidenceFromFounderAssessment({ problemScore: null, valueScore: 5, testScore: 5 }),
      ],
    });
    expect(result).toMatchObject({
      type: "MIXED",
      primary: "EXPERIMENTATION",
      secondary: "PRIORITIZATION",
      signalsText: "Aparecieron varias señales de experimentación y de síntesis y priorización.",
      summary:
        "Empezaste desde Impulsar y además aparecieron señales claras de generación de alternativas. Aparecieron varias señales de experimentación.",
    });
    expect(result.scores.IDEATION.level).toBe("CONVERGENT");
  });

  it("MIXED con COMMUNICATION primaria y contraste tercero: también nombra solo dos", () => {
    const result = interpret({
      initialMode: "DRIVE",
      evidence: [
        founder("COMMUNICATION"),
        action("COMMUNICATION"),
        facilitator("EXPERIMENTATION"),
        action("EXPERIMENTATION"),
        action("PROBLEM_UNDERSTANDING"),
        ...evidenceFromA3Blocks(["PROBLEM"]),
      ],
    });
    expect([result.type, result.primary, result.secondary]).toEqual([
      "MIXED",
      "COMMUNICATION",
      "EXPERIMENTATION",
    ]);
    expect(result.summary).toBe(
      "Empezaste desde Impulsar y además aparecieron señales claras de comprensión del problema. Aparecieron varias señales de comunicación y colaboración.",
    );
  });

  it("MIXED con contraste SIGNAL usa 'señales' sin 'claras'", () => {
    const result = interpret({
      initialMode: "EXPLORE",
      evidence: [action("IDEATION"), action("IDEATION"), action("PROBLEM_UNDERSTANDING")],
    });
    expect(result.type).toBe("MIXED");
    expect(result.summary).toBe(
      "Empezaste desde Explorar y además aparecieron señales de generación de alternativas. Aparecieron señales de generación de alternativas y de comprensión del problema.",
    );
  });
});

describe("ejemplo de Tomás con una sola autodeclaración", () => {
  const declared = evidenceFromReflection({
    selectedActions: ["CREATED_TEST"],
    primaryCapability: "PRIORITIZATION",
  });
  const team = [
    ...evidenceFromA3Blocks(["TEST"]),
    ...evidenceFromFounderAssessment({ problemScore: null, valueScore: null, testScore: 5 }),
  ];

  it("sin evidencia externa, 'convertí la idea en una prueba' es solo una señal", () => {
    expect(computeCapabilityScores(declared).EXPERIMENTATION).toMatchObject({
      self: 1,
      level: "SIGNAL",
    });
  });

  it("con A3 con prueba + founder Prueba=5, la misma declaración converge", () => {
    expect(computeCapabilityScores([...declared, ...team]).EXPERIMENTATION).toMatchObject({
      self: 1,
      rawTeam: 2.25,
      team: 1.5,
      effective: 2.5,
      level: "CONVERGENT",
    });
  });
});

describe("invariantes sobre escenarios generados", () => {
  // Generador determinístico (LCG) para recorrer combinaciones realistas de evidencia.
  function scenarios(count: number) {
    let seed = 20261006;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
    const scores = [null, 1, 2, 3, 4, 5] as const;
    return Array.from({ length: count }, () => {
      const evidence: EvidenceInput[] = [
        ...evidenceFromReflection({
          selectedActions: REFLECTION_ACTIONS.filter(() => rnd() < 0.3),
          primaryCapability: pick(CAPABILITIES),
        }),
      ];
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
      if (rnd() < 0.25) {
        evidence.push(
          evidenceFromObservation({
            capability: pick(CAPABILITIES),
            observerSource: pick(["FOUNDER_INDIVIDUAL", "FACILITATOR_OBSERVATION"] as const),
          }),
        );
      }
      return { initialMode: pick([...MODES, null]), evidence };
    });
  }

  const labels = CAPABILITIES.map((c) => CAPABILITY_LABELS[c]);

  it("se cumplen las reglas de 02 §21–§23 y de copy en 3000 escenarios", () => {
    for (const s of scenarios(3000)) {
      const r = interpret(s);
      const text = `${r.summary} ${r.signalsText ?? ""}`;

      // Nunca porcentajes, fortalezas ni debilidades.
      expect(text).not.toMatch(/%|fortaleza|debilidad/i);
      // Máximo dos capacidades en el resumen.
      expect(labels.filter((l) => r.summary.includes(l)).length).toBeLessThanOrEqual(2);
      // Sin "y ... y" ambiguo al unir etiquetas que ya llevan "y".
      for (const a of labels) {
        for (const b of labels) {
          if (a !== b && (a.includes(" y ") || b.includes(" y "))) {
            expect(r.summary).not.toContain(`${a} y ${b}`);
          }
        }
      }
      // El modo inicial (hipótesis) no cambia la evidencia.
      expect(r.scores).toEqual(computeCapabilityScores(s.evidence));
      // Lo grupal solo cuenta con evidencia individual de la misma capacidad.
      for (const c of CAPABILITIES) {
        const sc = r.scores[c];
        if (sc.self === 0 && sc.observed === 0) {
          expect(sc).toMatchObject({ effective: 0, level: "INSUFFICIENT" });
        }
        expect(sc.self).toBeLessThanOrEqual(SELF_CAP);
        expect(sc.team).toBeLessThanOrEqual(TEAM_CAP);
      }
      // Primaria y secundaria siempre tienen evidencia individual.
      for (const c of [r.primary, r.secondary]) {
        if (c) expect(r.scores[c].self + r.scores[c].observed).toBeGreaterThan(0);
      }
      const anyIndividual = CAPABILITIES.some((c) => r.scores[c].level !== "INSUFFICIENT");
      expect(r.type === "INSUFFICIENT").toBe(!anyIndividual);
      if (r.type === "INSUFFICIENT") expect(r.signalsText).toBeNull();
      if (s.initialMode === null && r.type !== "INSUFFICIENT") expect(r.type).toBe("MIXED");

      if (s.initialMode && (r.type === "ALIGNED" || r.type === "DIVERGENT")) {
        const inMode = (c: Capability) => MODE_CAPABILITIES[s.initialMode as Mode].includes(c);
        const convergent = CAPABILITIES.filter((c) => r.scores[c].level === "CONVERGENT");
        if (r.type === "ALIGNED") {
          // Nada convergente fuera del modo (salvo comunicación, que es transversal).
          expect(convergent.filter((c) => c !== "COMMUNICATION" && !inMode(c))).toEqual([]);
        } else {
          // Ninguna capacidad del modo inicial converge.
          expect(convergent.filter(inMode)).toEqual([]);
        }
      }
    }
  });
});

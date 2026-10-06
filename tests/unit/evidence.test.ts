import { describe, expect, it } from "vitest";
import {
  A3_BLOCKS,
  CAPABILITIES,
  EVIDENCE_SOURCES,
  OBSERVER_SOURCES,
  REFLECTION_ACTIONS,
} from "@/lib/domain/constants";
import {
  A3_BLOCK_SIGNALS,
  ACTION_SIGNALS,
  FOUNDER_SCORE_CAPABILITY,
  OBSERVED_SOURCES,
  QUESTIONNAIRE_EVIDENCE_WEIGHT,
  SELF_SOURCES,
  SOURCE_WEIGHTS,
  TEAM_SOURCES,
  evidenceCategory,
  evidenceFromA3Blocks,
  evidenceFromFounderAssessment,
  evidenceFromObservation,
  evidenceFromReflection,
  founderScoreStrength,
} from "@/lib/domain/evidence";

describe("pesos y fuentes", () => {
  it("usa los pesos exactos de 02 §20", () => {
    expect(SOURCE_WEIGHTS).toEqual({
      SELF_REPORT_ACTION: 1,
      SELF_REFLECTION_PRIMARY: 1.5,
      FOUNDER_INDIVIDUAL: 3,
      FACILITATOR_OBSERVATION: 2.5,
      FOUNDER_TEAM_SCORE: 1.5,
      TEAM_ARTIFACT: 1,
    });
  });

  it("el cuestionario pesa 0 y no existe como fuente de evidencia", () => {
    expect(QUESTIONNAIRE_EVIDENCE_WEIGHT).toBe(0);
    expect(Object.keys(SOURCE_WEIGHTS).sort()).toEqual([...EVIDENCE_SOURCES].sort());
    expect(Object.keys(SOURCE_WEIGHTS).some((k) => /QUESTION/i.test(k))).toBe(false);
  });

  it("self / observed / team particionan todas las fuentes sin superponerse", () => {
    expect(SELF_SOURCES).toEqual(["SELF_REPORT_ACTION", "SELF_REFLECTION_PRIMARY"]);
    expect(OBSERVED_SOURCES).toEqual(["FOUNDER_INDIVIDUAL", "FACILITATOR_OBSERVATION"]);
    expect(TEAM_SOURCES).toEqual(["FOUNDER_TEAM_SCORE", "TEAM_ARTIFACT"]);
    const all = [...SELF_SOURCES, ...OBSERVED_SOURCES, ...TEAM_SOURCES];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...EVIDENCE_SOURCES].sort());
  });

  it.each([
    ["SELF_REPORT_ACTION", "INDIVIDUAL", "self"],
    ["SELF_REFLECTION_PRIMARY", "INDIVIDUAL", "self"],
    ["FOUNDER_INDIVIDUAL", "INDIVIDUAL", "observed"],
    ["FACILITATOR_OBSERVATION", "INDIVIDUAL", "observed"],
    ["FOUNDER_TEAM_SCORE", "TEAM", "team"],
    ["TEAM_ARTIFACT", "TEAM", "team"],
    // Lo que tenga scope TEAM nunca suma como individual.
    ["FOUNDER_INDIVIDUAL", "TEAM", "team"],
    ["SELF_REPORT_ACTION", "TEAM", "team"],
    ["TEAM_ARTIFACT", "INDIVIDUAL", "team"],
  ] as const)("evidenceCategory(%s, %s) = %s", (source, scope, expected) => {
    expect(evidenceCategory(source, scope)).toBe(expected);
  });
});

describe("ACTION_SIGNALS", () => {
  it("replica exactamente el mapping de 02 §19", () => {
    expect(ACTION_SIGNALS).toEqual({
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
    });
    expect(Object.keys(ACTION_SIGNALS).sort()).toEqual([...REFLECTION_ACTIONS].sort());
  });
});

describe("founder score", () => {
  it("mapea Problema / Valor / Prueba a capacidades", () => {
    expect(FOUNDER_SCORE_CAPABILITY).toEqual({
      problem: "PROBLEM_UNDERSTANDING",
      value: "IDEATION",
      test: "EXPERIMENTATION",
    });
  });

  it.each([
    [5, 1],
    [4, 0.5],
    [3, 0],
    [2, 0],
    [1, 0],
    [0, 0],
    [4.5, 0],
    [null, 0],
    [undefined, 0],
  ])("founderScoreStrength(%s) = %s", (score, expected) => {
    expect(founderScoreStrength(score)).toBe(expected);
  });

  it("con peso 1.5 un 5 aporta 1.5 y un 4 aporta 0.75 (umbrales de 02 §22)", () => {
    expect(founderScoreStrength(5) * SOURCE_WEIGHTS.FOUNDER_TEAM_SCORE).toBe(1.5);
    expect(founderScoreStrength(4) * SOURCE_WEIGHTS.FOUNDER_TEAM_SCORE).toBe(0.75);
  });

  it("genera evidencia de equipo solo para scores 4 y 5", () => {
    const items = evidenceFromFounderAssessment({ problemScore: 5, valueScore: 3, testScore: 4 });
    expect(items).toEqual([
      {
        sourceType: "FOUNDER_TEAM_SCORE",
        scope: "TEAM",
        rawCode: "FOUNDER_SCORE_PROBLEM:5",
        rawText: null,
        sourceWeight: 1.5,
        confidence: 1,
        signals: [{ capability: "PROBLEM_UNDERSTANDING", strength: 1 }],
      },
      {
        sourceType: "FOUNDER_TEAM_SCORE",
        scope: "TEAM",
        rawCode: "FOUNDER_SCORE_TEST:4",
        rawText: null,
        sourceWeight: 1.5,
        confidence: 1,
        signals: [{ capability: "EXPERIMENTATION", strength: 0.5 }],
      },
    ]);
  });

  it("value 5 refuerza generación de alternativas; scores nulos o bajos no generan nada", () => {
    expect(
      evidenceFromFounderAssessment({ problemScore: null, valueScore: 5, testScore: null }),
    ).toEqual([
      expect.objectContaining({
        rawCode: "FOUNDER_SCORE_VALUE:5",
        signals: [{ capability: "IDEATION", strength: 1 }],
      }),
    ]);
    expect(
      evidenceFromFounderAssessment({ problemScore: null, valueScore: null, testScore: null }),
    ).toEqual([]);
    expect(evidenceFromFounderAssessment({ problemScore: 3, valueScore: 2, testScore: 1 })).toEqual(
      [],
    );
  });
});

describe("evidenceFromReflection", () => {
  it("crea un item por acción (sin duplicados) y uno para el aporte principal", () => {
    const items = evidenceFromReflection({
      selectedActions: ["ASKED_QUESTIONS", "CREATED_TEST", "ASKED_QUESTIONS"],
      primaryCapability: "EXPERIMENTATION",
      primaryContributionText: "  Armé la prueba con el equipo  ",
    });

    expect(items).toEqual([
      {
        sourceType: "SELF_REPORT_ACTION",
        scope: "INDIVIDUAL",
        rawCode: "ASKED_QUESTIONS",
        rawText: null,
        sourceWeight: 1,
        confidence: 1,
        signals: [
          { capability: "PROBLEM_UNDERSTANDING", strength: 1 },
          { capability: "ASSUMPTION_QUESTIONING", strength: 0.5 },
        ],
      },
      {
        sourceType: "SELF_REPORT_ACTION",
        scope: "INDIVIDUAL",
        rawCode: "CREATED_TEST",
        rawText: null,
        sourceWeight: 1,
        confidence: 1,
        signals: [{ capability: "EXPERIMENTATION", strength: 1 }],
      },
      {
        sourceType: "SELF_REFLECTION_PRIMARY",
        scope: "INDIVIDUAL",
        rawCode: "EXPERIMENTATION",
        rawText: "Armé la prueba con el equipo",
        sourceWeight: 1.5,
        confidence: 1,
        signals: [{ capability: "EXPERIMENTATION", strength: 1 }],
      },
    ]);
  });

  it("OTHER queda registrada sin señales", () => {
    const items = evidenceFromReflection({
      selectedActions: ["OTHER"],
      primaryCapability: "COMMUNICATION",
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ rawCode: "OTHER", signals: [] });
    expect(items[1]).toMatchObject({
      sourceType: "SELF_REFLECTION_PRIMARY",
      rawText: null,
      signals: [{ capability: "COMMUNICATION", strength: 1 }],
    });
  });

  it.each([[undefined], [null], [""], ["   "]])("texto vacío (%j) se guarda como null", (text) => {
    const items = evidenceFromReflection({
      selectedActions: ["PRESENTED"],
      primaryCapability: "COMMUNICATION",
      primaryContributionText: text,
    });
    expect(items.at(-1)?.rawText).toBeNull();
  });

  it("todos los items son individuales y con confianza 1", () => {
    const items = evidenceFromReflection({
      selectedActions: [...REFLECTION_ACTIONS],
      primaryCapability: "IDEATION",
    });
    expect(items).toHaveLength(REFLECTION_ACTIONS.length + 1);
    for (const item of items) {
      expect(item.scope).toBe("INDIVIDUAL");
      expect(item.confidence).toBe(1);
      expect(SELF_SOURCES).toContain(item.sourceType);
    }
  });

  it("no comparte referencias con ACTION_SIGNALS", () => {
    const [item] = evidenceFromReflection({
      selectedActions: ["CREATED_TEST"],
      primaryCapability: "EXPERIMENTATION",
    });
    item.signals[0].strength = 99;
    item.signals.push({ capability: "IDEATION", strength: 1 });
    expect(ACTION_SIGNALS.CREATED_TEST).toEqual([{ capability: "EXPERIMENTATION", strength: 1 }]);
  });
});

describe("evidenceFromA3Blocks", () => {
  it("mapea cada bloque marcado a evidencia de equipo, sin duplicados", () => {
    const items = evidenceFromA3Blocks(["TEST", "PROBLEM", "TEST"]);
    expect(items).toEqual([
      {
        sourceType: "TEAM_ARTIFACT",
        scope: "TEAM",
        rawCode: "A3_BLOCK_TEST",
        rawText: null,
        sourceWeight: 1,
        confidence: 1,
        signals: [{ capability: "EXPERIMENTATION", strength: 0.75 }],
      },
      {
        sourceType: "TEAM_ARTIFACT",
        scope: "TEAM",
        rawCode: "A3_BLOCK_PROBLEM",
        rawText: null,
        sourceWeight: 1,
        confidence: 1,
        signals: [{ capability: "PROBLEM_UNDERSTANDING", strength: 0.75 }],
      },
    ]);
  });

  it("usa el mapping de bloques acordado", () => {
    expect(A3_BLOCK_SIGNALS).toEqual({
      PROBLEM: [{ capability: "PROBLEM_UNDERSTANDING", strength: 0.75 }],
      HYPOTHESIS: [{ capability: "IDEATION", strength: 0.75 }],
      HOW_IT_WORKS: [{ capability: "PRIORITIZATION", strength: 0.75 }],
      TEST: [{ capability: "EXPERIMENTATION", strength: 0.75 }],
    });
    expect(evidenceFromA3Blocks([])).toEqual([]);
  });
});

describe("evidenceFromObservation", () => {
  it("una mención founder individual es evidencia individual con peso 3", () => {
    expect(
      evidenceFromObservation({
        capability: "ASSUMPTION_QUESTIONING",
        observerSource: "FOUNDER_INDIVIDUAL",
        note: " Detectó que nadie había hablado con usuarios ",
      }),
    ).toEqual({
      sourceType: "FOUNDER_INDIVIDUAL",
      scope: "INDIVIDUAL",
      rawCode: "ASSUMPTION_QUESTIONING",
      rawText: "Detectó que nadie había hablado con usuarios",
      sourceWeight: 3,
      confidence: 1,
      signals: [{ capability: "ASSUMPTION_QUESTIONING", strength: 1 }],
    });
  });

  it("una observación de facilitador pesa 2.5 y la nota es opcional", () => {
    const item = evidenceFromObservation({
      capability: "PRIORITIZATION",
      observerSource: "FACILITATOR_OBSERVATION",
    });
    expect(item).toMatchObject({
      sourceType: "FACILITATOR_OBSERVATION",
      scope: "INDIVIDUAL",
      sourceWeight: 2.5,
      rawText: null,
    });
  });
});

describe("coherencia de los items generados", () => {
  const all = [
    ...evidenceFromReflection({
      selectedActions: [...REFLECTION_ACTIONS],
      primaryCapability: "IDEATION",
      primaryContributionText: "Propuse tres caminos",
    }),
    ...evidenceFromFounderAssessment({ problemScore: 5, valueScore: 4, testScore: 5 }),
    ...evidenceFromA3Blocks([...A3_BLOCKS]),
    ...OBSERVER_SOURCES.flatMap((observerSource) =>
      CAPABILITIES.map((capability) => evidenceFromObservation({ capability, observerSource })),
    ),
  ];

  it("cada item usa el peso de su fuente y el scope de su categoría", () => {
    for (const item of all) {
      expect(EVIDENCE_SOURCES).toContain(item.sourceType);
      expect(item.sourceWeight).toBe(SOURCE_WEIGHTS[item.sourceType]);
      // Ningún item pesa como el cuestionario: el cuestionario no genera evidencia.
      expect(item.sourceWeight).toBeGreaterThan(QUESTIONNAIRE_EVIDENCE_WEIGHT);
      expect(item.confidence).toBe(1);
      const team = TEAM_SOURCES.includes(item.sourceType);
      expect(item.scope).toBe(team ? "TEAM" : "INDIVIDUAL");
      expect(evidenceCategory(item.sourceType, item.scope)).toBe(
        team ? "team" : OBSERVED_SOURCES.includes(item.sourceType) ? "observed" : "self",
      );
      for (const signal of item.signals) {
        expect(CAPABILITIES).toContain(signal.capability);
        expect(signal.strength).toBeGreaterThan(0);
        expect(signal.strength).toBeLessThanOrEqual(1);
      }
    }
  });

  it("la evidencia de equipo nunca nace con scope individual", () => {
    const teamItems = all.filter((i) => TEAM_SOURCES.includes(i.sourceType));
    expect(teamItems.length).toBe(3 + A3_BLOCKS.length);
    for (const item of teamItems) expect(item.scope).toBe("TEAM");
  });

  it("los items de A3 no comparten referencias con A3_BLOCK_SIGNALS", () => {
    const [item] = evidenceFromA3Blocks(["TEST"]);
    item.signals[0].strength = 99;
    expect(A3_BLOCK_SIGNALS.TEST).toEqual([{ capability: "EXPERIMENTATION", strength: 0.75 }]);
  });

  it.each([[6], [-1], [Number.NaN]])("un score founder fuera de rango (%s) no genera evidencia", (score) => {
    expect(
      evidenceFromFounderAssessment({ problemScore: score, valueScore: score, testScore: score }),
    ).toEqual([]);
  });
});

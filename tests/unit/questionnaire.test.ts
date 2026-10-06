import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODES, type Mode } from "@/lib/domain/constants";
import * as questionnaire from "@/lib/domain/questionnaire";
import {
  QUESTION_KEYS,
  QUESTIONS,
  TIEBREAK_KEY,
  TIEBREAK_OPTIONS,
  TIEBREAK_PROMPT,
  isComplete,
  resolveInitialMode,
  scoreAnswers,
  shuffleOptions,
  validateTieBreak,
  type Answers,
} from "@/lib/domain/questionnaire";

function answersFrom(modes: Mode[]): Answers {
  const answers: Answers = {};
  modes.forEach((mode, i) => {
    answers[QUESTION_KEYS[i]] = mode;
  });
  return answers;
}

function resolve(modes: Mode[]) {
  return resolveInitialMode(scoreAnswers(answersFrom(modes)));
}

const PRD = readFileSync(new URL("../../docs/innovaton/01-functional-prd.md", import.meta.url), "utf8");

function prdSection(from: string, to: string): string {
  const start = PRD.indexOf(from);
  const end = PRD.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`No se encontró la sección ${from} del PRD`);
  return PRD.slice(start, end);
}

/** Citas "> texto" de un bloque del PRD, en orden. */
function quotes(block: string): string[] {
  return [...block.matchAll(/^> (.+)$/gm)].map((m) => m[1].trim());
}

describe("questionnaire — contenido (PRD §7 y §8)", () => {
  it("tiene las cinco preguntas en orden con tres opciones E, C, I", () => {
    expect(QUESTION_KEYS).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5"]);
    expect(QUESTIONS.map((q) => q.key)).toEqual(QUESTION_KEYS);
    for (const q of QUESTIONS) {
      expect(q.options.map((o) => o.mode)).toEqual(["EXPLORE", "CREATE", "DRIVE"]);
    }
  });

  it("usa los textos literales del PRD", () => {
    const q1 = QUESTIONS[0];
    expect(q1.prompt).toBe(
      "Te tiran un problema que nadie del equipo conoce. ¿Qué te sale hacer primero?",
    );
    expect(q1.options[0].text).toBe("Entender qué está pasando y hacer las preguntas que faltan.");
    expect(q1.options[1].text).toBe("Abrir varias posibilidades antes de casarnos con una.");
    expect(q1.options[2].text).toBe("Ordenar lo que sabemos y definir un primer paso.");

    const q4 = QUESTIONS[3];
    expect(q4.prompt).toBe(
      "Quedan pocos minutos y hay tres buenas ideas sobre la mesa. ¿Qué te sale hacer?",
    );
    expect(q4.options[2].text).toBe("Elijo una, ordeno al equipo y la llevamos a algo concreto.");

    expect(QUESTIONS[4].prompt).toBe("Antes de presentar, ¿qué te gustaría tener más claro?");
  });

  it("coincide carácter por carácter con las cinco preguntas del PRD §7", () => {
    const blocks = prdSection("## 7.", "## 8.").split(/^### /m).slice(1);
    expect(blocks).toHaveLength(5);
    blocks.forEach((block, i) => {
      const options = [...block.matchAll(/^\*\*[ECI](?: — \S+)?:\*\* (.+)$/gm)].map((m) => m[1].trim());
      expect(QUESTIONS[i].key).toBe(block.split("\n")[0].trim());
      expect(QUESTIONS[i].prompt).toBe(quotes(block)[0]);
      expect(QUESTIONS[i].options.map((o) => o.text)).toEqual(options);
    });
  });

  it("coincide carácter por carácter con el desempate del PRD §8", () => {
    const [prompt, ...options] = quotes(prdSection("### Empate 2–2–1", "## 9."));
    expect(TIEBREAK_PROMPT).toBe(prompt);
    expect(options).toEqual(MODES.map((mode) => TIEBREAK_OPTIONS[mode].text));
  });

  it("no expone nada relacionado con evidencia (el cuestionario pesa 0)", () => {
    expect(Object.keys(questionnaire).filter((name) => /evidence|evidencia/i.test(name))).toEqual([]);
  });

  it("tiene la pregunta y opciones de desempate literales", () => {
    expect(TIEBREAK_KEY).toBe("TIEBREAK");
    expect(TIEBREAK_PROMPT).toBe(
      "Si hoy solo pudieras aportar una cosa al equipo, ¿cuál elegirías?",
    );
    expect(TIEBREAK_OPTIONS).toEqual({
      EXPLORE: {
        label: "Explorar",
        text: "Que entendamos mejor qué problema realmente vale la pena resolver.",
      },
      CREATE: {
        label: "Crear",
        text: "Que aparezca una posibilidad que antes nadie estaba viendo.",
      },
      DRIVE: {
        label: "Impulsar",
        text: "Que salgamos con algo concreto que podamos poner a prueba.",
      },
    });
  });
});

describe("questionnaire — completitud y scoring", () => {
  it("isComplete exige las cinco respuestas", () => {
    expect(isComplete({})).toBe(false);
    expect(isComplete(answersFrom(["EXPLORE", "CREATE", "DRIVE", "EXPLORE"]))).toBe(false);
    expect(isComplete(answersFrom(["EXPLORE", "CREATE", "DRIVE", "EXPLORE", "CREATE"]))).toBe(true);
  });

  it("cada respuesta suma 1 a su modo", () => {
    expect(scoreAnswers({})).toEqual({ explore: 0, create: 0, drive: 0 });
    expect(scoreAnswers(answersFrom(["EXPLORE", "CREATE", "DRIVE", "EXPLORE", "DRIVE"]))).toEqual({
      explore: 2,
      create: 1,
      drive: 2,
    });
    expect(scoreAnswers({ Q3: "CREATE" })).toEqual({ explore: 0, create: 1, drive: 0 });
  });

  it("ignora claves que no son Q1..Q5", () => {
    const answers = { Q1: "DRIVE", TIEBREAK: "EXPLORE" } as Answers;
    expect(scoreAnswers(answers)).toEqual({ explore: 0, create: 0, drive: 1 });
  });
});

describe("questionnaire — resolución del modo inicial", () => {
  it("5-0-0", () => {
    expect(resolve(["CREATE", "CREATE", "CREATE", "CREATE", "CREATE"])).toEqual({
      kind: "RESOLVED",
      mode: "CREATE",
    });
  });

  it("4-1-0", () => {
    expect(resolve(["DRIVE", "DRIVE", "EXPLORE", "DRIVE", "DRIVE"])).toEqual({
      kind: "RESOLVED",
      mode: "DRIVE",
    });
  });

  it("3-2-0", () => {
    expect(resolve(["EXPLORE", "CREATE", "EXPLORE", "CREATE", "EXPLORE"])).toEqual({
      kind: "RESOLVED",
      mode: "EXPLORE",
    });
  });

  it("3-1-1", () => {
    expect(resolve(["CREATE", "EXPLORE", "CREATE", "DRIVE", "CREATE"])).toEqual({
      kind: "RESOLVED",
      mode: "CREATE",
    });
  });

  it("2-2-1 EXPLORE/CREATE", () => {
    expect(resolve(["CREATE", "EXPLORE", "DRIVE", "CREATE", "EXPLORE"])).toEqual({
      kind: "TIE",
      modes: ["EXPLORE", "CREATE"],
    });
  });

  it("2-2-1 EXPLORE/DRIVE", () => {
    expect(resolve(["DRIVE", "DRIVE", "CREATE", "EXPLORE", "EXPLORE"])).toEqual({
      kind: "TIE",
      modes: ["EXPLORE", "DRIVE"],
    });
  });

  it("2-2-1 CREATE/DRIVE", () => {
    expect(resolve(["DRIVE", "CREATE", "EXPLORE", "CREATE", "DRIVE"])).toEqual({
      kind: "TIE",
      modes: ["CREATE", "DRIVE"],
    });
  });

  it("lanza error ante un triple empate", () => {
    expect(() => resolveInitialMode({ explore: 0, create: 0, drive: 0 })).toThrow();
    expect(() => resolveInitialMode({ explore: 1, create: 1, drive: 1 })).toThrow();
  });

  it("lanza error ante puntajes inválidos", () => {
    expect(() => resolveInitialMode({ explore: Number.NaN, create: 2, drive: 1 })).toThrow(/inválidos/);
    expect(() => resolveInitialMode({ explore: -1, create: 2, drive: 1 })).toThrow(/inválidos/);
    expect(() => resolveInitialMode({ explore: 1.5, create: 2, drive: 1 })).toThrow(/inválidos/);
  });

  it("con incompletas: máximo único resuelve y dos empatados piden desempate", () => {
    expect(resolveInitialMode(scoreAnswers({ Q2: "DRIVE" }))).toEqual({ kind: "RESOLVED", mode: "DRIVE" });
    expect(resolveInitialMode(scoreAnswers({ Q1: "DRIVE", Q4: "CREATE" }))).toEqual({
      kind: "TIE",
      modes: ["CREATE", "DRIVE"],
    });
  });

  it("las 243 combinaciones completas: solo 2–2–1 empata y nunca lanza error", () => {
    let ties = 0;
    for (let n = 0; n < 3 ** 5; n++) {
      const modes = QUESTION_KEYS.map((_, i) => MODES[Math.floor(n / 3 ** i) % 3]);
      const scores = scoreAnswers(answersFrom(modes));
      expect(scores.explore + scores.create + scores.drive).toBe(5);
      const result = resolveInitialMode(scores);
      const sorted = [scores.explore, scores.create, scores.drive].sort((a, b) => b - a);
      if (sorted[0] === 2 && sorted[1] === 2) {
        ties++;
        expect(result.kind).toBe("TIE");
        if (result.kind !== "TIE") continue;
        // Los dos empatados, en orden EXPLORE, CREATE, DRIVE.
        expect(result.modes).toEqual(MODES.filter((m) => modes.filter((x) => x === m).length === 2));
      } else {
        expect(result.kind).toBe("RESOLVED");
        if (result.kind !== "RESOLVED") continue;
        expect(modes.filter((m) => m === result.mode)).toHaveLength(sorted[0]);
      }
    }
    // 3 pares × 5!/(2!·2!·1!) = 90 combinaciones 2–2–1.
    expect(ties).toBe(90);
  });
});

describe("questionnaire — desempate", () => {
  it("acepta solo uno de los dos modos empatados", () => {
    const tie: Mode[] = ["EXPLORE", "DRIVE"];
    expect(validateTieBreak(tie, "EXPLORE")).toBe(true);
    expect(validateTieBreak(tie, "DRIVE")).toBe(true);
    expect(validateTieBreak(tie, "CREATE")).toBe(false);
  });

  it("no depende del orden en que vienen los empatados", () => {
    expect(validateTieBreak(["DRIVE", "CREATE"], "CREATE")).toBe(true);
    expect(validateTieBreak(["DRIVE", "CREATE"], "EXPLORE")).toBe(false);
  });

  it("valida contra el resultado de resolveInitialMode", () => {
    const result = resolve(["CREATE", "DRIVE", "CREATE", "DRIVE", "EXPLORE"]);
    if (result.kind !== "TIE") throw new Error("debería empatar");
    for (const mode of MODES) {
      expect(validateTieBreak(result.modes, mode)).toBe(result.modes.includes(mode));
    }
  });

  it("rechaza listas de empate mal formadas", () => {
    expect(validateTieBreak([], "EXPLORE")).toBe(false);
    expect(validateTieBreak(["EXPLORE"], "EXPLORE")).toBe(false);
    expect(validateTieBreak(["EXPLORE", "EXPLORE"], "EXPLORE")).toBe(false);
    expect(validateTieBreak(["EXPLORE", "CREATE", "DRIVE"], "DRIVE")).toBe(false);
  });
});

describe("questionnaire — orden de opciones", () => {
  const options = QUESTIONS[0].options;

  it("misma seed, mismo orden", () => {
    const a = shuffleOptions(options, "participation-123:Q1");
    const b = shuffleOptions(options, "participation-123:Q1");
    expect(a).toEqual(b);
  });

  it("no muta el array original y conserva los elementos", () => {
    const input = ["a", "b", "c", "d"] as const;
    const copy = [...input];
    const out = shuffleOptions(input, "x");
    expect(input).toEqual(copy);
    expect([...out].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("con distintas seeds aparecen las seis permutaciones", () => {
    const seen = new Map<string, number>();
    for (let i = 0; i < 600; i++) {
      const order = shuffleOptions(["E", "C", "I"], `seed-${i}`).join("");
      seen.set(order, (seen.get(order) ?? 0) + 1);
    }
    expect([...seen.keys()].sort()).toEqual(["CEI", "CIE", "ECI", "EIC", "ICE", "IEC"]);
    // Distribución razonable: ninguna permutación queda muy por debajo de 1/6.
    for (const count of seen.values()) expect(count).toBeGreaterThan(60);
  });

  it("el orden es estable entre versiones (un deploy no reordena a quien ya está respondiendo)", () => {
    expect(shuffleOptions(["E", "C", "I"], "participation-123:Q1")).toEqual(["C", "I", "E"]);
    expect(shuffleOptions(["E", "C", "I"], "3f1c9a52-6a4e-4c1b-9d7e-2b8f0c5e7a10:Q3")).toEqual([
      "E",
      "C",
      "I",
    ]);
    expect(shuffleOptions([1, 2, 3, 4, 5, 6], "a")).toEqual([1, 3, 6, 5, 2, 4]);
  });

  it("devuelve las mismas opciones (por referencia) en otro orden", () => {
    const out = shuffleOptions(options, "p:Q1");
    expect(out).not.toBe(options);
    expect(out).toHaveLength(3);
    for (const option of options) expect(out).toContain(option);
  });

  it("maneja listas vacías y de un elemento", () => {
    expect(shuffleOptions([], "s")).toEqual([]);
    expect(shuffleOptions([1], "s")).toEqual([1]);
  });
});

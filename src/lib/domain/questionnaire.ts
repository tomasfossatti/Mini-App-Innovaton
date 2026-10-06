import { MODES, type Mode } from "@/lib/domain/constants";
import { MODE_LABELS } from "@/lib/domain/copy";

// Cuestionario situacional (PRD §7) y scoring (PRD §8).
// Genera solo una hipótesis (initial_mode): nunca produce evidencia.

export type QuestionKey = "Q1" | "Q2" | "Q3" | "Q4" | "Q5";

export const QUESTION_KEYS: readonly QuestionKey[] = ["Q1", "Q2", "Q3", "Q4", "Q5"];

/** Clave con la que se guarda la respuesta de desempate en questionnaire_answers. */
export const TIEBREAK_KEY = "TIEBREAK" as const;

export interface QuestionOption {
  mode: Mode;
  text: string;
}

export interface Question {
  key: QuestionKey;
  prompt: string;
  /** Orden canónico E, C, I. La UI las mezcla con shuffleOptions. */
  options: QuestionOption[];
}

/** PRD §7 — textos literales. */
export const QUESTIONS: readonly Question[] = [
  {
    key: "Q1",
    prompt: "Te tiran un problema que nadie del equipo conoce. ¿Qué te sale hacer primero?",
    options: [
      { mode: "EXPLORE", text: "Entender qué está pasando y hacer las preguntas que faltan." },
      { mode: "CREATE", text: "Abrir varias posibilidades antes de casarnos con una." },
      { mode: "DRIVE", text: "Ordenar lo que sabemos y definir un primer paso." },
    ],
  },
  {
    key: "Q2",
    prompt: "Llevan 10 minutos y el equipo está trabado. ¿Dónde aparecés vos?",
    options: [
      { mode: "EXPLORE", text: "Detecto qué estamos dando por supuesto y lo cuestiono." },
      { mode: "CREATE", text: "Cambio el enfoque y propongo una alternativa distinta." },
      { mode: "DRIVE", text: "Recorto opciones y empujo una decisión para seguir." },
    ],
  },
  {
    key: "Q3",
    prompt: "Aparece información que contradice la idea que venían armando. ¿Qué hacés?",
    options: [
      { mode: "EXPLORE", text: "Vuelvo al problema y reviso qué entendimos mal." },
      { mode: "CREATE", text: "Uso ese dato para reformular la idea." },
      { mode: "DRIVE", text: "Ajusto la propuesta y defino qué tenemos que probar ahora." },
    ],
  },
  {
    key: "Q4",
    prompt: "Quedan pocos minutos y hay tres buenas ideas sobre la mesa. ¿Qué te sale hacer?",
    options: [
      { mode: "EXPLORE", text: "Comparo cuál responde mejor al problema real." },
      { mode: "CREATE", text: "Combino lo mejor de varias para crear algo mejor." },
      { mode: "DRIVE", text: "Elijo una, ordeno al equipo y la llevamos a algo concreto." },
    ],
  },
  {
    key: "Q5",
    prompt: "Antes de presentar, ¿qué te gustaría tener más claro?",
    options: [
      { mode: "EXPLORE", text: "Por qué creemos que ese es el problema importante." },
      { mode: "CREATE", text: "Qué hace valiosa o diferente nuestra propuesta." },
      { mode: "DRIVE", text: "Cómo funcionaría y cuál sería la primera prueba." },
    ],
  },
];

/** PRD §8 — pregunta de desempate 2–2–1. */
export const TIEBREAK_PROMPT = "Si hoy solo pudieras aportar una cosa al equipo, ¿cuál elegirías?";

/** PRD §8 — opciones de desempate (se muestran solo las de los dos modos empatados). */
export const TIEBREAK_OPTIONS: Record<Mode, { label: string; text: string }> = {
  EXPLORE: {
    label: MODE_LABELS.EXPLORE,
    text: "Que entendamos mejor qué problema realmente vale la pena resolver.",
  },
  CREATE: {
    label: MODE_LABELS.CREATE,
    text: "Que aparezca una posibilidad que antes nadie estaba viendo.",
  },
  DRIVE: {
    label: MODE_LABELS.DRIVE,
    text: "Que salgamos con algo concreto que podamos poner a prueba.",
  },
};

export type Answers = Partial<Record<QuestionKey, Mode>>;

export interface ModeScores {
  explore: number;
  create: number;
  drive: number;
}

export type InitialModeResolution =
  | { kind: "RESOLVED"; mode: Mode }
  | { kind: "TIE"; modes: [Mode, Mode] };

const SCORE_FIELD: Record<Mode, keyof ModeScores> = {
  EXPLORE: "explore",
  CREATE: "create",
  DRIVE: "drive",
};

function isMode(value: unknown): value is Mode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

/** true si las cinco preguntas tienen una respuesta válida. */
export function isComplete(answers: Answers): boolean {
  return QUESTION_KEYS.every((key) => isMode(answers[key]));
}

/** PRD §8 — cada respuesta suma 1 a su modo. Ignora claves ajenas a Q1..Q5. */
export function scoreAnswers(answers: Answers): ModeScores {
  const scores: ModeScores = { explore: 0, create: 0, drive: 0 };
  for (const key of QUESTION_KEYS) {
    const mode = answers[key];
    if (isMode(mode)) scores[SCORE_FIELD[mode]] += 1;
  }
  return scores;
}

/**
 * PRD §8 — mayor puntaje = initial_mode. Con dos modos empatados en el máximo (2–2–1 con
 * las cinco respuestas) se devuelve TIE en orden EXPLORE, CREATE, DRIVE para la pregunta
 * de desempate. Un triple empate solo ocurre con respuestas incompletas y se considera error.
 */
export function resolveInitialMode(scores: ModeScores): InitialModeResolution {
  const values = [scores.explore, scores.create, scores.drive];
  if (!values.every((value) => Number.isInteger(value) && value >= 0)) {
    throw new Error(`Puntajes inválidos (${values.join("-")}).`);
  }
  const max = Math.max(...values);
  const top = MODES.filter((mode) => scores[SCORE_FIELD[mode]] === max);
  if (top.length === 1) return { kind: "RESOLVED", mode: top[0] };
  if (top.length === 2) return { kind: "TIE", modes: [top[0], top[1]] };
  throw new Error(
    `No se puede resolver el modo inicial con un triple empate (${scores.explore}-${scores.create}-${scores.drive}).`,
  );
}

/** 02 §9 saveTieBreak — solo se acepta uno de los dos modos empatados. */
export function validateTieBreak(tieModes: readonly Mode[], selected: Mode): boolean {
  if (tieModes.length !== 2 || tieModes[0] === tieModes[1]) return false;
  return isMode(selected) && tieModes.includes(selected);
}

/**
 * PRD §7 — randomiza el orden visual de las respuestas de forma determinística:
 * la misma seed (p. ej. participación + pregunta) da siempre el mismo orden,
 * así un refresh no reordena las opciones. No muta el array recibido.
 */
export function shuffleOptions<T>(items: readonly T[], seed: string): T[] {
  const result = items.slice();
  const random = mulberry32(fnv1a(seed));
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

/** Hash FNV-1a de 32 bits sobre las unidades UTF-16 del texto. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** PRNG mulberry32: devuelve números en [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

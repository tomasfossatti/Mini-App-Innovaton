import type { A3Block, Capability, Mode, ReflectionAction } from "./constants";

// Textos visibles. Los que vienen del PRD (docs/innovaton/01-functional-prd.md) son literales.

export const MODE_LABELS: Record<Mode, string> = {
  EXPLORE: "Explorar",
  CREATE: "Crear",
  DRIVE: "Impulsar",
};

export const MODE_SHORT: Record<Mode, string> = {
  EXPLORE: "E",
  CREATE: "C",
  DRIVE: "I",
};

/** PRD §9 — Resultado inicial. */
export const RESULT_INTRO = {
  heading: "Esto no define quién sos.",
  body: "De todo lo que sos, hoy te proponemos poner una capacidad en primer plano y ver qué pasa cuando la usás sobre un problema real.",
};

export const MODE_RESULT: Record<Mode, { headline: string; mission: string }> = {
  EXPLORE: {
    headline: "Hoy tu ventaja puede estar en ver lo que otros pasan por alto.",
    mission: "Hacé al menos una pregunta que cambie cómo el equipo entiende el problema.",
  },
  CREATE: {
    headline: "Hoy tu ventaja puede estar en abrir caminos que todavía no están sobre la mesa.",
    mission: "Ayudá a que aparezcan varias posibilidades antes de quedarse con una.",
  },
  DRIVE: {
    headline: "Hoy tu ventaja puede estar en transformar conversación en avance.",
    mission: "Ayudá al equipo a salir con una decisión y una primera prueba.",
  },
};

/** Etiquetas internas de capacidades (00-vision "Capacidades internas"). */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  PROBLEM_UNDERSTANDING: "comprensión del problema",
  ASSUMPTION_QUESTIONING: "cuestionamiento de supuestos",
  IDEATION: "generación de alternativas",
  PRIORITIZATION: "síntesis y priorización",
  EXPERIMENTATION: "experimentación",
  COMMUNICATION: "comunicación y colaboración",
};

/** PRD §23, pregunta 2. */
export const REFLECTION_ACTION_LABELS: Record<ReflectionAction, string> = {
  ASKED_QUESTIONS: "Hice preguntas para entender mejor",
  FOUND_ASSUMPTION: "Detecté un supuesto o información faltante",
  PROPOSED_ALTERNATIVES: "Propuse alternativas",
  CONNECTED_IDEAS: "Conecté ideas",
  HELPED_CHOOSE: "Ayudé a elegir entre opciones",
  ORGANIZED_TEAM: "Organicé al equipo para avanzar",
  CREATED_TEST: "Convertí una idea en una prueba",
  PRESENTED: "Presenté o expliqué la propuesta",
  OTHER: "Otra",
};

/** Versión en pasado para el bloque "Lo que hiciste" del resultado final. */
export const REFLECTION_ACTION_PAST: Record<ReflectionAction, string> = {
  ASKED_QUESTIONS: "hiciste preguntas para entender mejor",
  FOUND_ASSUMPTION: "detectaste un supuesto o información faltante",
  PROPOSED_ALTERNATIVES: "propusiste alternativas",
  CONNECTED_IDEAS: "conectaste ideas",
  HELPED_CHOOSE: "ayudaste a elegir entre opciones",
  ORGANIZED_TEAM: "organizaste al equipo para avanzar",
  CREATED_TEST: "convertiste una idea en una prueba",
  PRESENTED: "presentaste o explicaste la propuesta",
  OTHER: "hiciste otro aporte",
};

/** PRD §23, pregunta 3: categorías del aporte principal. */
export const PRIMARY_CONTRIBUTION_OPTIONS: { capability: Capability; label: string }[] = [
  { capability: "PROBLEM_UNDERSTANDING", label: "Entender el problema" },
  { capability: "ASSUMPTION_QUESTIONING", label: "Cuestionar supuestos" },
  { capability: "IDEATION", label: "Generar alternativas" },
  { capability: "PRIORITIZATION", label: "Priorizar" },
  { capability: "EXPERIMENTATION", label: "Diseñar una prueba" },
  { capability: "COMMUNICATION", label: "Comunicar / coordinar" },
];

/** PRD §19 — bloques del A3. */
export const A3_BLOCK_LABELS: Record<A3Block, { title: string; question: string }> = {
  PROBLEM: { title: "Problema", question: "¿Qué está ocurriendo realmente?" },
  HYPOTHESIS: { title: "Hipótesis", question: "¿Qué proponemos?" },
  HOW_IT_WORKS: { title: "Funcionamiento", question: "¿Cómo funcionaría?" },
  TEST: { title: "Prueba", question: "¿Cómo sabríamos rápidamente si sirve?" },
};

/** PRD §25 — disclaimer del resultado Educai. */
export const OUTCOME_DISCLAIMER =
  "Esta experiencia no define tus capacidades. Es una primera evidencia contextual sobre cómo actuaste hoy.";

/** PRD §26 — CTA Espacio IDI. */
export const IDI_CTA = {
  body1:
    "Hace menos de una hora no conocías este problema ni a tu equipo. Ahora tenés una evidencia más sobre cómo podés aportar en una situación real.",
  body2: "Espacio IDI crea más oportunidades para seguir poniéndolo a prueba.",
  button: "QUIERO PARTICIPAR DE LOS PRÓXIMOS DESAFÍOS",
};

/** PRD §14 — recordatorio manual por WhatsApp. */
export const WHATSAPP_REMINDER =
  "En unos minutos empieza el Innovatón. Acercate al stand de Espacio IDI entre 14:20 y 14:25 para confirmar tu lugar. A las 14:30 arrancamos.";

export function startingPointText(mode: Mode | null): string {
  if (!mode) return "Entraste al desafío sin pasar por el cuestionario inicial.";
  return `Entraste poniendo ${MODE_LABELS[mode]} en primer plano.`;
}

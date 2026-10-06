import { and, eq, inArray, ne } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import {
  challenges,
  participations,
  questionnaireAnswers,
  teams,
  type EventRow,
  type ParticipationRow,
} from "@/lib/db/schema";
import { generateToken, sha256 } from "@/lib/auth/crypto";
import {
  PHASES_OPEN_FOR_SELF_CHECKIN,
  PHASES_OPEN_FOR_START,
  type EventPhase,
  type Mode,
  type ParticipationStatus,
} from "@/lib/domain/constants";
import { canReflect, choicesComplete, hasCompletedReflection, isRegistered } from "@/lib/domain/flow";
import { normalizeWhatsapp } from "@/lib/domain/phone";
import {
  QUESTION_KEYS,
  TIEBREAK_KEY,
  isComplete,
  resolveInitialMode,
  scoreAnswers,
  validateTieBreak,
  type Answers,
  type QuestionKey,
} from "@/lib/domain/questionnaire";
import { formatTime } from "@/lib/domain/time";
import { DomainError } from "./errors";
import { lockEvent } from "./events";
import { cleanName, findParticipantByWhatsapp, upsertParticipantByWhatsapp } from "./participants";

// Flujo del participante (02 §9). El cuestionario genera una hipótesis (initial_mode) y
// nunca crea evidencia: este archivo no toca evidence_items.

const PRESENT_STATUSES: readonly ParticipationStatus[] = [
  "CHECKED_IN",
  "MATCHED",
  "EXPERIENCE_COMPLETED",
  "REFLECTION_COMPLETED",
  "INTERPRETED",
];

function phoneCountry() {
  return (process.env.DEFAULT_PHONE_COUNTRY ?? "AR") as Parameters<typeof normalizeWhatsapp>[1];
}

function closedMessage(event: EventRow): string {
  if (event.phase === "DRAFT") return "La inscripción todavía no abrió.";
  return "La inscripción para este Innovatón ya cerró.";
}

function assertEditable(p: ParticipationRow): void {
  if (isRegistered(p.status)) {
    throw new DomainError("LOCKED", "Ya completaste esta parte. Seguí desde tu estado.");
  }
}

async function reload(db: DbOrTx, id: string): Promise<ParticipationRow> {
  const row = await db.query.participations.findFirst({ where: eq(participations.id, id) });
  if (!row) throw new DomainError("NOT_FOUND", "No encontramos tu participación. Empezá de nuevo.");
  return row;
}

export async function startParticipation(
  db: DbOrTx,
  event: EventRow,
): Promise<{ participation: ParticipationRow; token: string }> {
  if (!PHASES_OPEN_FOR_START.includes(event.phase)) {
    throw new DomainError("REGISTRATION_CLOSED", closedMessage(event));
  }
  const token = generateToken();
  const [participation] = await db
    .insert(participations)
    .values({ eventId: event.id, resumeTokenHash: sha256(token) })
    .returning();
  return { participation, token };
}

export async function getParticipationByToken(
  db: DbOrTx,
  eventId: string,
  token: string | null,
): Promise<ParticipationRow | null> {
  if (!token) return null;
  return (
    (await db.query.participations.findFirst({
      where: and(eq(participations.eventId, eventId), eq(participations.resumeTokenHash, sha256(token))),
    })) ?? null
  );
}

export async function savePreClarity(
  db: DbOrTx,
  participation: ParticipationRow,
  value: number,
): Promise<void> {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new DomainError("INVALID_VALUE", "Elegí un valor del 1 al 5.");
  }
  assertEditable(participation);
  await db.update(participations).set({ preClarity: value }).where(eq(participations.id, participation.id));
}

async function loadAnswers(db: DbOrTx, participationId: string): Promise<Answers> {
  const rows = await db
    .select({ key: questionnaireAnswers.questionKey, mode: questionnaireAnswers.selectedMode })
    .from(questionnaireAnswers)
    .where(
      and(
        eq(questionnaireAnswers.participationId, participationId),
        inArray(questionnaireAnswers.questionKey, [...QUESTION_KEYS]),
      ),
    );
  const answers: Answers = {};
  for (const r of rows) answers[r.key as QuestionKey] = r.mode;
  return answers;
}

export async function getAnswers(db: DbOrTx, participationId: string): Promise<Answers> {
  return loadAnswers(db, participationId);
}

async function upsertAnswer(db: DbOrTx, participationId: string, questionKey: string, mode: Mode) {
  await db
    .insert(questionnaireAnswers)
    .values({ participationId, questionKey, selectedMode: mode })
    .onConflictDoUpdate({
      target: [questionnaireAnswers.participationId, questionnaireAnswers.questionKey],
      set: { selectedMode: mode, updatedAt: new Date() },
    });
}

/**
 * Guarda una respuesta (UPSERT) y recalcula E/C/I. Si la persona vuelve atrás y cambia
 * respuestas, la hipótesis se recalcula al finalizar.
 */
export async function saveAnswer(
  db: DbOrTx,
  participation: ParticipationRow,
  questionKey: QuestionKey,
  mode: Mode,
): Promise<void> {
  if (!QUESTION_KEYS.includes(questionKey)) {
    throw new DomainError("INVALID_QUESTION", "Pregunta inválida.");
  }
  assertEditable(participation);
  await db.transaction(async (tx) => {
    const before = await loadAnswers(tx, participation.id);
    await upsertAnswer(tx, participation.id, questionKey, mode);
    const answers = { ...before, [questionKey]: mode };
    const scores = scoreAnswers(answers);
    const changed = before[questionKey] !== undefined && before[questionKey] !== mode;
    await tx
      .update(participations)
      .set({
        exploreScore: scores.explore,
        createScore: scores.create,
        driveScore: scores.drive,
        ...(changed ? { initialMode: null, tiebreakModes: null, status: "STARTED" as const } : {}),
      })
      .where(eq(participations.id, participation.id));
  });
}

export type AssessmentOutcome = { kind: "RESOLVED"; mode: Mode } | { kind: "TIE"; modes: [Mode, Mode] };

/**
 * Recibe las 5 respuestas completas (aunque algún guardado parcial haya fallado por la red),
 * calcula el modo inicial y marca desempate si es 2–2–1 (PRD §8).
 */
export async function finalizeAssessment(
  db: DbOrTx,
  participation: ParticipationRow,
  answers: Record<QuestionKey, Mode>,
): Promise<AssessmentOutcome> {
  if (!isComplete(answers)) {
    throw new DomainError("INCOMPLETE", "Faltan respuestas. Volvé a la pregunta pendiente.");
  }
  if (isRegistered(participation.status)) {
    // Doble submit tardío: devolver el resultado ya guardado.
    if (participation.initialMode) return { kind: "RESOLVED", mode: participation.initialMode };
  }
  assertEditable(participation);
  return db.transaction(async (tx) => {
    for (const key of QUESTION_KEYS) await upsertAnswer(tx, participation.id, key, answers[key]);
    const scores = scoreAnswers(answers);
    const resolution = resolveInitialMode(scores);
    const base = { exploreScore: scores.explore, createScore: scores.create, driveScore: scores.drive };
    if (resolution.kind === "RESOLVED") {
      await tx
        .update(participations)
        .set({ ...base, initialMode: resolution.mode, tiebreakModes: null, status: "PROFILE_COMPLETED" })
        .where(eq(participations.id, participation.id));
      await tx
        .delete(questionnaireAnswers)
        .where(
          and(
            eq(questionnaireAnswers.participationId, participation.id),
            eq(questionnaireAnswers.questionKey, TIEBREAK_KEY),
          ),
        );
      return { kind: "RESOLVED", mode: resolution.mode };
    }
    const current = await reload(tx, participation.id);
    const sameTie =
      current.tiebreakModes?.length === 2 &&
      current.tiebreakModes.every((m) => resolution.modes.includes(m)) &&
      current.initialMode !== null &&
      resolution.modes.includes(current.initialMode);
    if (sameTie) {
      // Ya había desempatado entre estos mismos dos modos: se respeta su elección.
      await tx.update(participations).set(base).where(eq(participations.id, participation.id));
      return { kind: "RESOLVED", mode: current.initialMode as Mode };
    }
    await tx
      .update(participations)
      .set({ ...base, initialMode: null, tiebreakModes: [...resolution.modes], status: "STARTED" })
      .where(eq(participations.id, participation.id));
    return { kind: "TIE", modes: resolution.modes };
  });
}

export async function saveTieBreak(
  db: DbOrTx,
  participation: ParticipationRow,
  mode: Mode,
): Promise<void> {
  if (participation.initialMode === mode) return; // doble tap
  assertEditable(participation);
  const tie = participation.tiebreakModes ?? [];
  if (tie.length !== 2 || !validateTieBreak(tie, mode)) {
    throw new DomainError("INVALID_TIEBREAK", "Elegí una de las dos opciones.");
  }
  await db.transaction(async (tx) => {
    await upsertAnswer(tx, participation.id, TIEBREAK_KEY, mode);
    await tx
      .update(participations)
      .set({ initialMode: mode, status: "PROFILE_COMPLETED" })
      .where(eq(participations.id, participation.id));
  });
}

export interface ChoicesInput {
  firstChoiceId: string;
  secondChoiceId: string | null;
  secondChoiceAny: boolean;
}

/** Valida las elecciones de desafío (PRD §10). Compartida con el alta rápida de staff. */
export async function validateChoices(db: DbOrTx, eventId: string, input: ChoicesInput): Promise<void> {
  if (!input.firstChoiceId) {
    throw new DomainError("FIRST_REQUIRED", "Elegí el desafío que más te interesa.");
  }
  if (input.secondChoiceAny && input.secondChoiceId) {
    throw new DomainError("SECOND_CONFLICT", "Elegí una segunda opción o 'Cualquiera', no las dos.");
  }
  if (!input.secondChoiceAny && !input.secondChoiceId) {
    throw new DomainError(
      "SECOND_REQUIRED",
      "Elegí una segunda opción o marcá 'Cualquiera, quiero participar'.",
    );
  }
  if (input.secondChoiceId && input.secondChoiceId === input.firstChoiceId) {
    throw new DomainError("SECOND_SAME", "La segunda opción tiene que ser distinta de la primera.");
  }
  const ids = [input.firstChoiceId, ...(input.secondChoiceId ? [input.secondChoiceId] : [])];
  const found = await db
    .select({ id: challenges.id })
    .from(challenges)
    .where(and(eq(challenges.eventId, eventId), eq(challenges.active, true), inArray(challenges.id, ids)));
  if (found.length !== ids.length) {
    throw new DomainError("INVALID_CHALLENGE", "Ese desafío ya no está disponible. Elegí otro.");
  }
}

export async function saveChallengeChoices(
  db: DbOrTx,
  event: EventRow,
  participation: ParticipationRow,
  input: ChoicesInput,
): Promise<void> {
  assertEditable(participation);
  if (!participation.initialMode) {
    throw new DomainError("PROFILE_REQUIRED", "Primero respondé las preguntas.");
  }
  await validateChoices(db, event.id, input);
  await db
    .update(participations)
    .set({
      firstChoiceId: input.firstChoiceId,
      secondChoiceId: input.secondChoiceAny ? null : input.secondChoiceId,
      secondChoiceAny: input.secondChoiceAny,
    })
    .where(eq(participations.id, participation.id));
}

export interface RegisterInput {
  name: string;
  whatsapp: string;
  operationalConsent: boolean;
  communityConsent: boolean;
}

export interface RegisterResult {
  participation: ParticipationRow;
  late: boolean;
}

/**
 * Inscripción (02 §9 registerParticipant).
 * - Identidad persistente por WhatsApp normalizado.
 * - En fase CHECKIN (14:20–14:25, desde el stand) queda CHECKED_IN automáticamente (PRD §12).
 * - En MATCHING/SPRINT se inscribe como llegada tarde (REGISTERED) y el staff decide.
 * - Si ese WhatsApp ya tiene una inscripción en este evento, no se toca: puede ser otra persona
 *   usando un número ajeno. Quien cambió de celular recupera su lugar con "Recuperar mi lugar".
 */
export async function registerParticipant(
  db: DbOrTx,
  event: EventRow,
  participation: ParticipationRow,
  input: RegisterInput,
  now: Date = new Date(),
): Promise<RegisterResult> {
  if (isRegistered(participation.status)) {
    return { participation, late: false }; // doble submit
  }
  if (!PHASES_OPEN_FOR_START.includes(event.phase)) {
    throw new DomainError("REGISTRATION_CLOSED", closedMessage(event));
  }
  if (!participation.initialMode || !choicesComplete(participation)) {
    throw new DomainError("INCOMPLETE", "Te falta completar algún paso antes de inscribirte.");
  }
  if (!input.operationalConsent) {
    throw new DomainError(
      "CONSENT_REQUIRED",
      "Para participar necesitamos poder escribirte por WhatsApp sobre este Innovatón.",
    );
  }
  const name = cleanName(input.name);
  const phone = normalizeWhatsapp(input.whatsapp, phoneCountry());
  if (!phone.ok) throw new DomainError("INVALID_WHATSAPP", phone.error);

  const late = event.phase === "MATCHING" || event.phase === "SPRINT";
  const autoCheckIn = event.phase === "CHECKIN";

  return db.transaction(async (tx) => {
    await lockEvent(tx, event.id);
    const current = await reload(tx, participation.id);
    if (isRegistered(current.status)) return { participation: current, late };

    const known = await findParticipantByWhatsapp(tx, phone.e164);
    if (known) {
      const existing = await tx.query.participations.findFirst({
        where: and(
          eq(participations.eventId, event.id),
          eq(participations.participantId, known.id),
          ne(participations.id, current.id),
        ),
        columns: { id: true },
      });
      if (existing) {
        throw new DomainError(
          "ALREADY_REGISTERED",
          "Ese WhatsApp ya tiene una inscripción en este Innovatón. Si sos vos, tocá «Recuperar mi lugar».",
        );
      }
    }

    // Persona nueva, o conocida de otro evento (se actualiza el nombre con el último ingresado).
    const person = await upsertParticipantByWhatsapp(tx, { name, whatsappNormalized: phone.e164 });
    const [updated] = await tx
      .update(participations)
      .set({
        participantId: person.id,
        status: autoCheckIn ? "CHECKED_IN" : "REGISTERED",
        registeredAt: now,
        checkedInAt: autoCheckIn ? now : null,
        operationalConsentAt: now,
        communityConsentAt: input.communityConsent ? now : null,
      })
      .where(eq(participations.id, current.id))
      .returning();
    return { participation: updated, late };
  });
}

/** Check-in del participante (PRD §15). Idempotente. */
export async function checkIn(
  db: DbOrTx,
  event: EventRow,
  participation: ParticipationRow,
  now: Date = new Date(),
): Promise<ParticipationRow> {
  if (PRESENT_STATUSES.includes(participation.status)) return participation;
  if (participation.status !== "REGISTERED" && participation.status !== "NO_SHOW") {
    throw new DomainError("NOT_REGISTERED", "Primero completá la inscripción.");
  }
  if (!PHASES_OPEN_FOR_SELF_CHECKIN.includes(event.phase)) {
    if (event.phase === "DRAFT" || event.phase === "REGISTRATION") {
      throw new DomainError(
        "CHECKIN_NOT_OPEN",
        `El check-in abre a las ${formatTime(event.checkinOpensAt, event.timezone)}. Te esperamos en el stand.`,
      );
    }
    throw new DomainError(
      "CHECKIN_CLOSED",
      "El check-in desde el celular ya cerró. Acercate al stand y el staff te suma si es posible.",
    );
  }
  const [updated] = await db
    .update(participations)
    .set({ status: "CHECKED_IN", checkedInAt: now })
    .where(
      and(
        eq(participations.id, participation.id),
        inArray(participations.status, ["REGISTERED", "NO_SHOW"]),
      ),
    )
    .returning();
  return updated ?? (await reload(db, participation.id));
}

/**
 * Recupera la sesión desde otro dispositivo con el WhatsApp de la inscripción.
 * Genera un token nuevo (el dispositivo anterior deja de estar asociado).
 */
export async function recoverParticipation(
  db: DbOrTx,
  event: EventRow,
  whatsappInput: string,
): Promise<{ token: string; participation: ParticipationRow }> {
  const phone = normalizeWhatsapp(whatsappInput, phoneCountry());
  if (!phone.ok) throw new DomainError("INVALID_WHATSAPP", phone.error);
  const notFound = new DomainError(
    "NOT_FOUND",
    "No encontramos una inscripción con ese número. Revisalo o acercate al stand.",
  );
  const person = await findParticipantByWhatsapp(db, phone.e164);
  if (!person) throw notFound;
  const existing = await db.query.participations.findFirst({
    where: and(eq(participations.eventId, event.id), eq(participations.participantId, person.id)),
  });
  if (!existing || !isRegistered(existing.status)) throw notFound;
  const token = generateToken();
  const [updated] = await db
    .update(participations)
    .set({ resumeTokenHash: sha256(token) })
    .where(eq(participations.id, existing.id))
    .returning();
  return { token, participation: updated };
}

export interface ParticipantState {
  status: ParticipationStatus;
  eventPhase: EventPhase;
  initialMode: Mode | null;
  checkedIn: boolean;
  canSelfCheckIn: boolean;
  team: {
    startupName: string;
    challengeTitle: string;
    teamNumber: number;
    tableNumber: number;
    published: true;
  } | null;
  canReflect: boolean;
  hasOutcome: boolean;
  firstChoice: { startupName: string; title: string } | null;
  secondChoice: { startupName: string; title: string } | null;
  secondChoiceAny: boolean;
}

/** Estado para la pantalla de estado y el polling (02 §11). Nunca expone equipos borrador. */
export async function getParticipantState(
  db: DbOrTx,
  event: EventRow,
  participation: ParticipationRow,
): Promise<ParticipantState> {
  const challengeIds = [participation.firstChoiceId, participation.secondChoiceId].filter(
    (id): id is string => Boolean(id),
  );
  const chosen = challengeIds.length
    ? await db
        .select({ id: challenges.id, startupName: challenges.startupName, title: challenges.title })
        .from(challenges)
        .where(inArray(challenges.id, challengeIds))
    : [];
  const byId = new Map(chosen.map((c) => [c.id, { startupName: c.startupName, title: c.title }]));

  let team: ParticipantState["team"] = null;
  if (participation.teamId) {
    const rows = await db
      .select({
        teamNumber: teams.teamNumber,
        tableNumber: teams.tableNumber,
        publishedAt: teams.publishedAt,
        startupName: challenges.startupName,
        challengeTitle: challenges.title,
      })
      .from(teams)
      .innerJoin(challenges, eq(teams.challengeId, challenges.id))
      .where(eq(teams.id, participation.teamId))
      .limit(1);
    const row = rows[0];
    if (row?.publishedAt) {
      team = {
        startupName: row.startupName,
        challengeTitle: row.challengeTitle,
        teamNumber: row.teamNumber,
        tableNumber: row.tableNumber,
        published: true,
      };
    }
  }

  return {
    status: participation.status,
    eventPhase: event.phase,
    initialMode: participation.initialMode,
    checkedIn: participation.checkedInAt !== null,
    canSelfCheckIn:
      (participation.status === "REGISTERED" || participation.status === "NO_SHOW") &&
      PHASES_OPEN_FOR_SELF_CHECKIN.includes(event.phase),
    team,
    canReflect: team !== null && canReflect(participation, event.phase),
    hasOutcome: hasCompletedReflection(participation.status),
    firstChoice: participation.firstChoiceId ? (byId.get(participation.firstChoiceId) ?? null) : null,
    secondChoice: participation.secondChoiceId ? (byId.get(participation.secondChoiceId) ?? null) : null,
    secondChoiceAny: participation.secondChoiceAny,
  };
}

/** CTA final "QUIERO PARTICIPAR DE LOS PRÓXIMOS DESAFÍOS" (PRD §26). Idempotente. */
export async function registerCommunityInterest(
  db: DbOrTx,
  participation: ParticipationRow,
  now: Date = new Date(),
): Promise<void> {
  if (!participation.participantId) {
    throw new DomainError("NOT_REGISTERED", "Primero completá la inscripción.");
  }
  await db
    .update(participations)
    .set({
      communityCtaAt: participation.communityCtaAt ?? now,
      communityConsentAt: participation.communityConsentAt ?? now,
    })
    .where(eq(participations.id, participation.id));
}

import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { CountryCode } from "libphonenumber-js";
import type { DbOrTx } from "@/lib/db/client";
import {
  challenges,
  evidenceItems,
  interpretationSnapshots,
  participants,
  participations,
  reflections,
  teams,
  type ChallengeRow,
  type EventRow,
  type TeamRow,
} from "@/lib/db/schema";
import {
  INTERPRETATION_TYPES,
  type InterpretationType,
  type Mode,
  type ParticipationStatus,
} from "@/lib/domain/constants";
import { normalizeWhatsapp } from "@/lib/domain/phone";
import { formatTime } from "@/lib/domain/time";
import { generateRecoveryCode, generateToken, recoveryCodeHash, sha256 } from "@/lib/auth/crypto";
import { hasCompletedReflection, isRegistered } from "@/lib/domain/flow";
import { namesLikelyMatch } from "@/lib/domain/text";
import { DomainError } from "./errors";
import { hasPublishedTeams, isUuid, listChallenges, lockEvent, requireEvent } from "./events";
import { cleanName, upsertParticipantByWhatsapp, findParticipantByWhatsapp } from "./participants";

// Operación del evento para el staff: dashboard, check-in manual, alta rápida y métricas
// (PRD §14, §15, §27, §31; spec 02 §25; operaciones 03 §2).

/** Etiqueta que se muestra cuando la persona aceptó cualquier desafío como segunda opción. */
export const ANY_CHOICE_LABEL = "Cualquiera";

export interface DashboardCounts {
  /** Recorridos iniciados (todas las participations del evento). */
  started: number;
  /** Terminaron el cuestionario (initial_mode no nulo, sin altas de staff). */
  profileCompleted: number;
  /** Inscriptos (con persona asociada), incluye NO_SHOW y altas de staff. */
  registered: number;
  /** Presentes (checked_in_at no nulo). */
  present: number;
  /** Con equipo publicado. */
  matched: number;
  teams: number;
  reflections: number;
  communityCta: number;
}

export interface DashboardChallenge {
  challengeId: string;
  startupName: string;
  title: string;
  active: boolean;
  /** Inscriptos con este desafío como primera opción. */
  firstChoice: number;
  /** Inscriptos con este desafío como segunda opción. */
  secondChoice: number;
  /** Presentes con este desafío como primera opción. */
  present: number;
  teams: number;
  /** Personas en equipos de este desafío. */
  assigned: number;
}

export interface DashboardPerson {
  participationId: string;
  name: string;
  /** E.164, p. ej. "+5493511234567". */
  whatsapp: string;
  /** Sin "+", para wa.me. */
  waNumber: string;
  status: ParticipationStatus;
  initialMode: Mode | null;
  /** startupName de la primera opción. */
  firstChoice: string | null;
  /** startupName de la segunda opción o "Cualquiera". */
  secondChoice: string | null;
  checkedInAt: Date | null;
  team: { teamNumber: number; tableNumber: number; startupName: string; published: boolean } | null;
  addedByStaff: boolean;
  operationalConsent: boolean;
  communityConsent: boolean;
  hasReflection: boolean;
}

export interface Metrics {
  funnel: {
    started: number;
    profileCompleted: number;
    registered: number;
    checkedIn: number;
    matched: number;
    reflections: number;
    communityCta: number;
  };
  /** Proporciones entre 0 y 1; null si el denominador es 0. */
  rates: {
    /** profileCompleted / recorridos iniciados sin contar altas de staff (no hicieron el cuestionario). */
    questionnaireCompletion: number | null;
    /** Inscriptos sin altas de staff / profileCompleted. */
    registration: number | null;
    registrationToCheckin: number | null;
    checkinToCompletion: number | null;
    reflectionCompletion: number | null;
    communityConversion: number | null;
  };
  educai: {
    avgPreClarity: number | null;
    avgPostClarity: number | null;
    /** Solo personas con claridad inicial y final. */
    avgDeltaClarity: number | null;
    avgInitialModeUsefulness: number | null;
    avgPerceivedValue: number | null;
    evidenceItems: number;
    /** Personas con al menos una interpretación. */
    interpreted: number;
    /** Última interpretación por persona con tipo distinto de INSUFFICIENT / interpreted. */
    sufficientInterpretationRate: number | null;
    /** Tipo de la última interpretación por persona. */
    interpretationTypes: Record<InterpretationType, number>;
  };
}

export interface Dashboard {
  event: EventRow;
  teamsPublished: boolean;
  counts: DashboardCounts;
  byChallenge: DashboardChallenge[];
  people: DashboardPerson[];
  metrics: Metrics;
}

const collator = new Intl.Collator("es", { sensitivity: "base" });

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function secondChoiceLabel(
  p: { secondChoiceId: string | null; secondChoiceAny: boolean },
  challengeById: Map<string, ChallengeRow>,
): string | null {
  if (p.secondChoiceId) return challengeById.get(p.secondChoiceId)?.startupName ?? null;
  return p.secondChoiceAny ? ANY_CHOICE_LABEL : null;
}

/**
 * Todo lo que necesita la pantalla principal del staff (PRD §27, spec §25) y las métricas
 * (PRD §31). Seis consultas en total: se refresca cada pocos segundos con 50–150 personas.
 */
export async function getDashboard(db: DbOrTx, eventId: string): Promise<Dashboard> {
  const event = await requireEvent(db, eventId);

  const [challengeRows, teamRows, rows, evidenceCount, latestInterpretations] = await Promise.all([
    listChallenges(db, eventId),
    db.select().from(teams).where(eq(teams.eventId, eventId)),
    db
      .select({
        id: participations.id,
        participantId: participations.participantId,
        status: participations.status,
        preClarity: participations.preClarity,
        initialMode: participations.initialMode,
        firstChoiceId: participations.firstChoiceId,
        secondChoiceId: participations.secondChoiceId,
        secondChoiceAny: participations.secondChoiceAny,
        operationalConsentAt: participations.operationalConsentAt,
        communityConsentAt: participations.communityConsentAt,
        communityCtaAt: participations.communityCtaAt,
        checkedInAt: participations.checkedInAt,
        teamId: participations.teamId,
        addedByStaff: participations.addedByStaff,
        name: participants.name,
        whatsapp: participants.whatsappNormalized,
        reflectionId: reflections.id,
        postClarity: reflections.postClarity,
        perceivedValue: reflections.perceivedValue,
        initialModeUsefulness: reflections.initialModeUsefulness,
      })
      .from(participations)
      .leftJoin(participants, eq(participants.id, participations.participantId))
      .leftJoin(reflections, eq(reflections.participationId, participations.id))
      .where(eq(participations.eventId, eventId)),
    db
      .select({ n: count() })
      .from(evidenceItems)
      .where(eq(evidenceItems.eventId, eventId)),
    db
      .selectDistinctOn([interpretationSnapshots.participationId], {
        participationId: interpretationSnapshots.participationId,
        type: interpretationSnapshots.type,
      })
      .from(interpretationSnapshots)
      .innerJoin(participations, eq(participations.id, interpretationSnapshots.participationId))
      .where(eq(participations.eventId, eventId))
      .orderBy(
        interpretationSnapshots.participationId,
        desc(interpretationSnapshots.createdAt),
        desc(interpretationSnapshots.id),
      ),
  ]);

  const challengeById = new Map(challengeRows.map((c) => [c.id, c]));
  const teamById = new Map<string, TeamRow>(teamRows.map((t) => [t.id, t]));
  const teamsPublished = teamRows.some((t) => t.publishedAt !== null);

  const counts: DashboardCounts = {
    started: rows.length,
    profileCompleted: 0,
    registered: 0,
    present: 0,
    matched: 0,
    teams: teamRows.length,
    reflections: 0,
    communityCta: 0,
  };
  // Las altas de staff no hicieron el cuestionario ni la inscripción desde el celular: no
  // entran en los denominadores de las tasas del recorrido propio (PRD §31).
  let startedWithoutStaff = 0;
  let registeredWithoutStaff = 0;

  const perChallenge = new Map<string, Omit<DashboardChallenge, "challengeId" | "startupName" | "title" | "active">>(
    challengeRows.map((c) => [c.id, { firstChoice: 0, secondChoice: 0, present: 0, teams: 0, assigned: 0 }]),
  );
  for (const team of teamRows) {
    const entry = perChallenge.get(team.challengeId);
    if (entry) entry.teams += 1;
  }

  const people: DashboardPerson[] = [];
  const preClarities: number[] = [];
  const postClarities: number[] = [];
  const deltas: number[] = [];
  const usefulness: number[] = [];
  const perceivedValues: number[] = [];

  for (const row of rows) {
    const registered = row.participantId !== null;
    const present = row.checkedInAt !== null;
    const team = row.teamId ? teamById.get(row.teamId) : undefined;
    const hasReflection = row.reflectionId !== null;

    if (!row.addedByStaff) startedWithoutStaff += 1;
    if (row.initialMode !== null && !row.addedByStaff) counts.profileCompleted += 1;
    if (registered) {
      counts.registered += 1;
      if (!row.addedByStaff) registeredWithoutStaff += 1;
    }
    if (present) counts.present += 1;
    if (team?.publishedAt) counts.matched += 1;
    if (hasReflection) counts.reflections += 1;
    if (row.communityCtaAt !== null) counts.communityCta += 1;

    if (registered) {
      const first = row.firstChoiceId ? perChallenge.get(row.firstChoiceId) : undefined;
      if (first) {
        first.firstChoice += 1;
        if (present) first.present += 1;
      }
      const second = row.secondChoiceId ? perChallenge.get(row.secondChoiceId) : undefined;
      if (second) second.secondChoice += 1;
    }
    if (team) {
      const assigned = perChallenge.get(team.challengeId);
      if (assigned) assigned.assigned += 1;
    }

    if (row.preClarity !== null) preClarities.push(row.preClarity);
    if (row.postClarity !== null) {
      postClarities.push(row.postClarity);
      if (row.preClarity !== null) deltas.push(row.postClarity - row.preClarity);
    }
    // La utilidad del modo inicial solo tiene sentido para quien recibió una hipótesis.
    if (row.initialModeUsefulness !== null && row.initialMode !== null) {
      usefulness.push(row.initialModeUsefulness);
    }
    if (row.perceivedValue !== null) perceivedValues.push(row.perceivedValue);

    if (registered && row.name !== null && row.whatsapp !== null) {
      people.push({
        participationId: row.id,
        name: row.name,
        whatsapp: row.whatsapp,
        waNumber: row.whatsapp.replace(/^\+/, ""),
        status: row.status,
        initialMode: row.initialMode,
        firstChoice: row.firstChoiceId
          ? (challengeById.get(row.firstChoiceId)?.startupName ?? null)
          : null,
        secondChoice: secondChoiceLabel(row, challengeById),
        checkedInAt: row.checkedInAt,
        team: team
          ? {
              teamNumber: team.teamNumber,
              tableNumber: team.tableNumber,
              startupName: challengeById.get(team.challengeId)?.startupName ?? "",
              published: team.publishedAt !== null,
            }
          : null,
        addedByStaff: row.addedByStaff,
        operationalConsent: row.operationalConsentAt !== null,
        communityConsent: row.communityConsentAt !== null,
        hasReflection,
      });
    }
  }
  people.sort((a, b) => collator.compare(a.name, b.name));

  const byChallenge: DashboardChallenge[] = [];
  for (const c of challengeRows) {
    const entry = perChallenge.get(c.id)!;
    const used = entry.firstChoice + entry.secondChoice + entry.teams + entry.assigned > 0;
    // Los desafíos inactivos solo aparecen si alguien los eligió o tienen equipos.
    if (!c.active && !used) continue;
    byChallenge.push({
      challengeId: c.id,
      startupName: c.startupName,
      title: c.title,
      active: c.active,
      ...entry,
    });
  }

  const interpretationTypes = Object.fromEntries(
    INTERPRETATION_TYPES.map((t) => [t, 0]),
  ) as Record<InterpretationType, number>;
  for (const i of latestInterpretations) interpretationTypes[i.type] += 1;
  const interpreted = latestInterpretations.length;

  const metrics: Metrics = {
    funnel: {
      started: counts.started,
      profileCompleted: counts.profileCompleted,
      registered: counts.registered,
      checkedIn: counts.present,
      matched: counts.matched,
      reflections: counts.reflections,
      communityCta: counts.communityCta,
    },
    rates: {
      questionnaireCompletion: ratio(counts.profileCompleted, startedWithoutStaff),
      registration: ratio(registeredWithoutStaff, counts.profileCompleted),
      registrationToCheckin: ratio(counts.present, counts.registered),
      checkinToCompletion: ratio(counts.reflections, counts.present),
      reflectionCompletion: ratio(counts.reflections, counts.matched),
      communityConversion: ratio(counts.communityCta, counts.reflections),
    },
    educai: {
      avgPreClarity: average(preClarities),
      avgPostClarity: average(postClarities),
      avgDeltaClarity: average(deltas),
      avgInitialModeUsefulness: average(usefulness),
      avgPerceivedValue: average(perceivedValues),
      evidenceItems: evidenceCount[0]?.n ?? 0,
      interpreted,
      sufficientInterpretationRate: ratio(interpreted - interpretationTypes.INSUFFICIENT, interpreted),
      interpretationTypes,
    },
  };

  return { event, teamsPublished, counts, byChallenge, people, metrics };
}

const NOT_FOUND_MESSAGE = "No encontramos a esta persona en el evento.";

const PRE_REGISTRATION_STATUSES: readonly ParticipationStatus[] = ["STARTED", "PROFILE_COMPLETED"];
const CHECKIN_FROM_STATUSES = ["REGISTERED", "NO_SHOW"] as const satisfies readonly ParticipationStatus[];

/**
 * Check-in manual del staff (spec §10). Permitido en cualquier fase: decide el staff.
 * Idempotente aunque dos personas del staff marquen a la misma persona a la vez:
 * el UPDATE es condicional y la segunda recibe `alreadyPresent: true`.
 */
export async function manualCheckIn(
  db: DbOrTx,
  eventId: string,
  participationId: string,
  now: Date = new Date(),
): Promise<{ alreadyPresent: boolean }> {
  if (!isUuid(eventId) || !isUuid(participationId)) {
    throw new DomainError("NOT_FOUND", NOT_FOUND_MESSAGE);
  }
  // Si el UPDATE no aplica pero la lectura posterior la ve REGISTERED/NO_SHOW, otra persona
  // del staff deshizo el check-in en el medio: se reintenta en lugar de responder
  // "ya estaba presente" sobre alguien que no lo está.
  for (let attempt = 0; attempt < 3; attempt++) {
    const updated = await db
      .update(participations)
      .set({ status: "CHECKED_IN", checkedInAt: now })
      .where(
        and(
          eq(participations.id, participationId),
          eq(participations.eventId, eventId),
          inArray(participations.status, CHECKIN_FROM_STATUSES),
        ),
      )
      .returning({ id: participations.id });
    if (updated.length > 0) return { alreadyPresent: false };

    const current = await db.query.participations.findFirst({
      where: and(eq(participations.id, participationId), eq(participations.eventId, eventId)),
      columns: { status: true },
    });
    if (!current) throw new DomainError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (PRE_REGISTRATION_STATUSES.includes(current.status)) {
      throw new DomainError("NOT_REGISTERED", "Esta persona no terminó la inscripción.");
    }
    if (!(CHECKIN_FROM_STATUSES as readonly ParticipationStatus[]).includes(current.status)) {
      return { alreadyPresent: true };
    }
  }
  throw new DomainError(
    "CHECKIN_CONFLICT",
    "Otra persona del staff está cambiando este check-in. Probá de nuevo.",
  );
}

/**
 * Deshace un check-in hecho por error. Solo para presentes sin equipo; si ya está como
 * inscripta (o nunca llegó) no hace nada. Toma el lock del evento para no cruzarse con
 * la generación de equipos.
 *
 * Vuelve a REGISTERED; si los equipos ya se publicaron vuelve a NO_SHOW, que es el estado
 * que `publishTeams` les da a los inscriptos que no llegaron (07: "Al publicar, quienes
 * estaban REGISTERED pasan a NO_SHOW").
 */
export async function undoCheckIn(
  db: DbOrTx,
  eventId: string,
  participationId: string,
): Promise<void> {
  if (!isUuid(eventId) || !isUuid(participationId)) {
    throw new DomainError("NOT_FOUND", NOT_FOUND_MESSAGE);
  }
  await db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const current = await tx.query.participations.findFirst({
      where: and(eq(participations.id, participationId), eq(participations.eventId, eventId)),
      columns: { status: true, teamId: true },
    });
    if (!current) throw new DomainError("NOT_FOUND", NOT_FOUND_MESSAGE);
    if (current.teamId) throw new DomainError("HAS_TEAM", "Primero sacala del equipo.");
    if (current.status !== "CHECKED_IN") {
      if (
        PRE_REGISTRATION_STATUSES.includes(current.status) ||
        current.status === "REGISTERED" ||
        current.status === "NO_SHOW"
      ) {
        return;
      }
      throw new DomainError(
        "CANNOT_UNDO_CHECKIN",
        "Ya no se puede deshacer el check-in de esta persona.",
      );
    }
    const published = await hasPublishedTeams(tx, eventId);
    await tx
      .update(participations)
      .set({ status: published ? "NO_SHOW" : "REGISTERED", checkedInAt: null })
      .where(
        and(
          eq(participations.id, participationId),
          eq(participations.status, "CHECKED_IN"),
          isNull(participations.teamId),
        ),
      );
  });
}

const RECOVERY_CODE_MINUTES = 15;

/**
 * Código de un solo uso para que una persona inscripta recupere su sesión en otro celular
 * (recoverParticipation). Lo genera el staff en el stand, cara a cara con la persona. Reemplaza
 * el código anterior, vence a los 15 minutos y se invalida tras 5 intentos fallidos.
 */
export async function createRecoveryCode(
  db: DbOrTx,
  eventId: string,
  participationId: string,
  now: Date = new Date(),
): Promise<{ code: string; expiresAt: Date }> {
  if (!isUuid(eventId) || !isUuid(participationId)) {
    throw new DomainError("NOT_FOUND", NOT_FOUND_MESSAGE);
  }
  const current = await db.query.participations.findFirst({
    where: and(eq(participations.id, participationId), eq(participations.eventId, eventId)),
    columns: { id: true, status: true },
  });
  if (!current) throw new DomainError("NOT_FOUND", NOT_FOUND_MESSAGE);
  if (!isRegistered(current.status)) {
    throw new DomainError("NOT_REGISTERED", "Esta persona no terminó la inscripción.");
  }
  const code = generateRecoveryCode();
  const expiresAt = new Date(now.getTime() + RECOVERY_CODE_MINUTES * 60_000);
  await db
    .update(participations)
    .set({
      recoveryCodeHash: recoveryCodeHash(current.id, code),
      recoveryCodeExpiresAt: expiresAt,
      recoveryAttempts: 0,
    })
    .where(eq(participations.id, current.id));
  return { code, expiresAt };
}

export interface StaffQuickAddInput {
  name: string;
  whatsapp: string;
  firstChoiceId: string;
  secondChoiceId: string | null;
  secondChoiceAny: boolean;
  /** Modo del cuestionario hecho en papel (hipótesis inicial). Nunca crea evidencia. */
  initialMode?: Mode | null;
}

const UNAVAILABLE_CHALLENGE = "Ese desafío ya no está disponible. Elegí otro.";
const SECOND_REQUIRED = "Elegí una segunda opción o marcá 'Cualquiera'.";

/**
 * Mismas reglas que la elección del participante (PRD §10, `validateChoices` de
 * participation.ts), con mensajes pensados para el staff.
 */
async function validateStaffChoices(
  db: DbOrTx,
  eventId: string,
  input: Pick<StaffQuickAddInput, "firstChoiceId" | "secondChoiceId" | "secondChoiceAny">,
): Promise<{ firstChoiceId: string; secondChoiceId: string | null; secondChoiceAny: boolean }> {
  const firstChoiceId = input.firstChoiceId.trim();
  const secondChoiceId = input.secondChoiceId?.trim() || null;
  if (!firstChoiceId) {
    throw new DomainError("FIRST_REQUIRED", "Elegí la primera opción.");
  }
  if (secondChoiceId && input.secondChoiceAny) {
    throw new DomainError("SECOND_CONFLICT", SECOND_REQUIRED);
  }
  if (!secondChoiceId && !input.secondChoiceAny) {
    throw new DomainError("SECOND_REQUIRED", SECOND_REQUIRED);
  }
  if (secondChoiceId && secondChoiceId === firstChoiceId) {
    throw new DomainError("SECOND_SAME", "La segunda opción tiene que ser distinta de la primera.");
  }
  const ids = secondChoiceId ? [firstChoiceId, secondChoiceId] : [firstChoiceId];
  if (!ids.every(isUuid)) throw new DomainError("INVALID_CHALLENGE", UNAVAILABLE_CHALLENGE);
  const found = await db
    .select({ id: challenges.id })
    .from(challenges)
    .where(
      and(eq(challenges.eventId, eventId), eq(challenges.active, true), inArray(challenges.id, ids)),
    );
  if (found.length !== ids.length) throw new DomainError("INVALID_CHALLENGE", UNAVAILABLE_CHALLENGE);
  return { firstChoiceId, secondChoiceId, secondChoiceAny: input.secondChoiceAny };
}

const MARK_PRESENT_FROM: readonly ParticipationStatus[] = [
  "STARTED",
  "PROFILE_COMPLETED",
  "REGISTERED",
  "NO_SHOW",
];

/**
 * Alta rápida del staff para quien llega sin celular o para cargar planillas en papel.
 * La persona queda presente. Si ya existe (mismo WhatsApp normalizado) reutiliza su
 * participation en lugar de duplicarla. El modo del cuestionario en papel solo completa uno
 * que falte: nunca pisa el del celular ni cambia a quien ya reflexionó.
 */
export async function staffQuickAdd(
  db: DbOrTx,
  event: EventRow,
  input: StaffQuickAddInput,
  now: Date = new Date(),
): Promise<{ participationId: string; created: boolean }> {
  const name = cleanName(input.name);
  const phone = normalizeWhatsapp(
    input.whatsapp,
    (process.env.DEFAULT_PHONE_COUNTRY ?? "AR") as CountryCode,
  );
  if (!phone.ok) throw new DomainError("INVALID_WHATSAPP", phone.error);

  return db.transaction(async (tx) => {
    await lockEvent(tx, event.id);
    const choices = await validateStaffChoices(tx, event.id, input);

    // Un número mal tipeado no puede pisar a otra persona: si el WhatsApp ya es de alguien con
    // otro nombre, se frena y se muestra el nombre guardado.
    const known = await findParticipantByWhatsapp(tx, phone.e164);
    if (known && !namesLikelyMatch(known.name, name)) {
      throw new DomainError(
        "PHONE_CONFLICT",
        `Ese WhatsApp ya está registrado a nombre de «${known.name}». Revisá el número; si es la misma persona, buscala en la lista y hacé el check-in.`,
      );
    }
    const participant =
      known ?? (await upsertParticipantByWhatsapp(tx, { name, whatsappNormalized: phone.e164 }));

    const existing = await tx.query.participations.findFirst({
      where: and(
        eq(participations.eventId, event.id),
        eq(participations.participantId, participant.id),
      ),
    });

    if (existing) {
      // Si se inscribió sola/o, sus elecciones no se tocan: solo se la marca presente.
      const canUpdateChoices = existing.teamId === null && existing.addedByStaff;
      const canSetMode =
        Boolean(input.initialMode) &&
        existing.initialMode === null &&
        !hasCompletedReflection(existing.status);
      await tx
        .update(participations)
        .set({
          ...(canUpdateChoices ? choices : {}),
          ...(canSetMode ? { initialMode: input.initialMode } : {}),
          status: MARK_PRESENT_FROM.includes(existing.status) ? "CHECKED_IN" : existing.status,
          registeredAt: existing.registeredAt ?? now,
          operationalConsentAt: existing.operationalConsentAt ?? now,
          checkedInAt: existing.checkedInAt ?? now,
        })
        .where(eq(participations.id, existing.id));
      return { participationId: existing.id, created: false };
    }

    const [row] = await tx
      .insert(participations)
      .values({
        eventId: event.id,
        participantId: participant.id,
        addedByStaff: true,
        resumeTokenHash: sha256(generateToken()),
        status: "CHECKED_IN",
        checkedInAt: now,
        registeredAt: now,
        operationalConsentAt: now,
        initialMode: input.initialMode ?? null,
        ...choices,
      })
      .returning({ id: participations.id });
    return { participationId: row.id, created: true };
  });
}

/**
 * Recordatorio manual por WhatsApp (PRD §14) con los horarios reales del evento.
 */
export function whatsappReminderText(event: EventRow): string {
  const tz = event.timezone;
  const label = event.locationLabel.trim();
  const where =
    label === "" || label.toLowerCase() === "stand espacio idi"
      ? "Acercate al stand de Espacio IDI"
      : `Acercate a ${label}`;
  return (
    `En unos minutos empieza el Innovatón. ${where} entre ${formatTime(event.checkinOpensAt, tz)}` +
    ` y ${formatTime(event.registrationClosesAt, tz)} para confirmar tu lugar.` +
    ` A las ${formatTime(event.startsAt, tz)} arrancamos.`
  );
}

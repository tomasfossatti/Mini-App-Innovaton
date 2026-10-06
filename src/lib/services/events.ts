import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import {
  challenges,
  events,
  participations,
  teams,
  type ChallengeRow,
  type EventRow,
} from "@/lib/db/schema";
import { EVENT_PHASES, type EventPhase } from "@/lib/domain/constants";
import { DomainError } from "./errors";

export async function lockEvent(db: DbOrTx, eventId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${eventId}))`);
}

export async function getEventBySlug(db: DbOrTx, slug: string): Promise<EventRow | null> {
  return (await db.query.events.findFirst({ where: eq(events.slug, slug) })) ?? null;
}

export async function getEventById(db: DbOrTx, id: string): Promise<EventRow | null> {
  if (!isUuid(id)) return null;
  return (await db.query.events.findFirst({ where: eq(events.id, id) })) ?? null;
}

export async function requireEvent(db: DbOrTx, id: string): Promise<EventRow> {
  const event = await getEventById(db, id);
  if (!event) throw new DomainError("EVENT_NOT_FOUND", "No encontramos el evento.");
  return event;
}

/**
 * Evento al que apunta la raíz "/": DEFAULT_EVENT_SLUG si existe; si no, el evento abierto
 * más reciente; si no, el último creado.
 */
export async function getDefaultEvent(db: DbOrTx): Promise<EventRow | null> {
  const slug = process.env.DEFAULT_EVENT_SLUG;
  if (slug) {
    const bySlug = await getEventBySlug(db, slug);
    if (bySlug) return bySlug;
  }
  const open = await db.query.events.findFirst({
    where: and(ne(events.phase, "DRAFT"), ne(events.phase, "CLOSED")),
    orderBy: desc(events.startsAt),
  });
  if (open) return open;
  return (await db.query.events.findFirst({ orderBy: desc(events.createdAt) })) ?? null;
}

export async function listEvents(db: DbOrTx): Promise<EventRow[]> {
  return db.query.events.findMany({ orderBy: desc(events.startsAt) });
}

export async function listChallenges(
  db: DbOrTx,
  eventId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<ChallengeRow[]> {
  return db.query.challenges.findMany({
    where: opts.activeOnly
      ? and(eq(challenges.eventId, eventId), eq(challenges.active, true))
      : eq(challenges.eventId, eventId),
    orderBy: [asc(challenges.sortOrder), asc(challenges.startupName)],
  });
}

export async function hasPublishedTeams(db: DbOrTx, eventId: string): Promise<boolean> {
  const row = await db.query.teams.findFirst({
    where: and(eq(teams.eventId, eventId), isNotNull(teams.publishedAt)),
    columns: { id: true },
  });
  return Boolean(row);
}

const PRE_PUBLISH_PHASES: readonly EventPhase[] = ["DRAFT", "REGISTRATION", "CHECKIN", "MATCHING"];

/**
 * Cambia la fase del evento (02 §10 setEventPhase). Se puede avanzar a cualquier fase.
 * Con equipos publicados no se puede volver a fases previas al sprint.
 * Al abrir la reflexión, quienes estaban MATCHED pasan a EXPERIENCE_COMPLETED.
 */
export async function setEventPhase(
  db: DbOrTx,
  eventId: string,
  phase: EventPhase,
): Promise<EventRow> {
  if (!EVENT_PHASES.includes(phase)) {
    throw new DomainError("INVALID_PHASE", "Fase inválida.");
  }
  return db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const event = await requireEvent(tx, eventId);
    if (event.phase === phase) return event;
    if (PRE_PUBLISH_PHASES.includes(phase) && (await hasPublishedTeams(tx, eventId))) {
      throw new DomainError(
        "TEAMS_PUBLISHED",
        "Los equipos ya se publicaron: no se puede volver a una fase anterior al sprint.",
      );
    }
    const [updated] = await tx
      .update(events)
      .set({ phase })
      .where(eq(events.id, eventId))
      .returning();
    if (phase === "REFLECTION" || phase === "CLOSED") {
      await tx
        .update(participations)
        .set({ status: "EXPERIENCE_COMPLETED" })
        .where(and(eq(participations.eventId, eventId), eq(participations.status, "MATCHED")));
    }
    return updated;
  });
}

export interface EventInput {
  slug: string;
  name: string;
  timezone: string;
  locationLabel: string;
  registrationOpensAt: Date;
  checkinOpensAt: Date;
  registrationClosesAt: Date;
  startsAt: Date;
  endsAt: Date;
  communityUrl: string | null;
}

function validateEventInput(input: EventInput): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
    throw new DomainError(
      "INVALID_SLUG",
      "El identificador del evento solo puede tener minúsculas, números y guiones.",
    );
  }
  const order = [
    input.registrationOpensAt,
    input.checkinOpensAt,
    input.registrationClosesAt,
    input.startsAt,
    input.endsAt,
  ];
  for (let i = 1; i < order.length; i++) {
    if (order[i].getTime() < order[i - 1].getTime()) {
      throw new DomainError(
        "INVALID_TIMES",
        "Revisá los horarios: inscripción ≤ check-in ≤ cierre ≤ inicio ≤ fin.",
      );
    }
  }
}

export async function createEvent(db: DbOrTx, input: EventInput): Promise<EventRow> {
  validateEventInput(input);
  if (await getEventBySlug(db, input.slug)) {
    throw new DomainError("SLUG_TAKEN", "Ya existe un evento con ese identificador.");
  }
  const [row] = await db
    .insert(events)
    .values({ ...input, phase: "DRAFT" })
    .returning();
  return row;
}

export async function updateEvent(db: DbOrTx, eventId: string, input: EventInput): Promise<EventRow> {
  validateEventInput(input);
  const clash = await db.query.events.findFirst({
    where: and(eq(events.slug, input.slug), ne(events.id, eventId)),
  });
  if (clash) throw new DomainError("SLUG_TAKEN", "Ya existe un evento con ese identificador.");
  const [row] = await db.update(events).set(input).where(eq(events.id, eventId)).returning();
  if (!row) throw new DomainError("EVENT_NOT_FOUND", "No encontramos el evento.");
  return row;
}

export interface ChallengeInput {
  startupName: string;
  title: string;
  description: string;
  brief: string;
  prize: string | null;
  sortOrder: number;
  active: boolean;
}

export async function createChallenge(
  db: DbOrTx,
  eventId: string,
  input: ChallengeInput,
): Promise<ChallengeRow> {
  await requireEvent(db, eventId);
  const [row] = await db
    .insert(challenges)
    .values({ ...input, eventId })
    .returning();
  return row;
}

export async function updateChallenge(
  db: DbOrTx,
  eventId: string,
  challengeId: string,
  input: ChallengeInput,
): Promise<ChallengeRow> {
  const [row] = await db
    .update(challenges)
    .set(input)
    .where(and(eq(challenges.id, challengeId), eq(challenges.eventId, eventId)))
    .returning();
  if (!row) throw new DomainError("CHALLENGE_NOT_FOUND", "No encontramos el desafío.");
  return row;
}

/**
 * Borra un desafío solo si nadie lo eligió ni tiene equipos. Si no, conviene desactivarlo.
 */
export async function deleteChallenge(
  db: DbOrTx,
  eventId: string,
  challengeId: string,
): Promise<void> {
  const used = await db.query.participations.findFirst({
    where: and(
      eq(participations.eventId, eventId),
      or(
        eq(participations.firstChoiceId, challengeId),
        eq(participations.secondChoiceId, challengeId),
      ),
    ),
    columns: { id: true },
  });
  const withTeams = await db.query.teams.findFirst({
    where: eq(teams.challengeId, challengeId),
    columns: { id: true },
  });
  if (used || withTeams) {
    throw new DomainError(
      "CHALLENGE_IN_USE",
      "Hay personas o equipos asociados a este desafío. Desactivalo en lugar de borrarlo.",
    );
  }
  await db
    .delete(challenges)
    .where(and(eq(challenges.id, challengeId), eq(challenges.eventId, eventId)));
}

export async function getChallengesByIds(
  db: DbOrTx,
  eventId: string,
  ids: string[],
): Promise<ChallengeRow[]> {
  if (ids.length === 0) return [];
  return db.query.challenges.findMany({
    where: and(eq(challenges.eventId, eventId), inArray(challenges.id, ids)),
  });
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

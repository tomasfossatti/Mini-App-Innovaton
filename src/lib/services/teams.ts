import {
  and,
  asc,
  count,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  max,
  not,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import {
  artifacts,
  assignmentSourceEnum,
  challenges,
  events,
  evidenceItems,
  founderAssessments,
  founderObservations,
  participants,
  participations,
  teams,
  type ChallengeRow,
  type ParticipationRow,
  type TeamRow,
} from "@/lib/db/schema";
import {
  ASSIGNMENT_SOURCES,
  type AssignmentSource,
  type EventPhase,
  type Mode,
  type ParticipationStatus,
} from "@/lib/domain/constants";
import {
  suggestPlacement,
  type Latecomer,
  type PlacementSuggestion,
  type PlacementTeam,
} from "@/lib/domain/latecomers";
import {
  generateMatching,
  type MatchingWarning,
  type UnresolvedReason,
} from "@/lib/domain/matching";
import { DomainError } from "./errors";
import { hasPublishedTeams, isUuid, listChallenges, lockEvent, requireEvent } from "./events";
import { interpretParticipation } from "./reflection";

// Equipos: matching, edición, publicación y latecomers
// (02 §10, §13–§18, §28–§29; PRD §16–§18; operaciones §3 y §11).
// Toda operación que toca equipos corre en transacción con el lock por evento.

export type BoardPerson = {
  participationId: string;
  name: string;
  whatsapp: string;
  initialMode: Mode | null;
  firstChoiceId: string | null;
  secondChoiceId: string | null;
  secondChoiceAny: boolean;
  assignmentSource: AssignmentSource | null;
  status: ParticipationStatus;
  checkedInAt: Date | null;
  suggestion: PlacementSuggestion | null;
};

export type BoardTeam = {
  id: string;
  challengeId: string;
  startupName: string;
  challengeTitle: string;
  teamNumber: number;
  tableNumber: number;
  publishedAt: Date | null;
  members: BoardPerson[];
  hasAssessment: boolean;
  winner: boolean;
  artifactCount: number;
};

export type TeamsBoard = {
  eventId: string;
  phase: EventPhase;
  published: boolean;
  challenges: { id: string; startupName: string; title: string; active: boolean }[];
  teams: BoardTeam[];
  unassigned: BoardPerson[];
  warnings: { code: string; message: string }[];
};

/** Estados de alguien que ya está en el lugar (hizo check-in en algún momento). */
const PRESENT_STATUSES: readonly ParticipationStatus[] = [
  "CHECKED_IN",
  "MATCHED",
  "EXPERIENCE_COMPLETED",
  "REFLECTION_COMPLETED",
  "INTERPRETED",
];

const UNRESOLVED_REASON_TEXT: Record<UnresolvedReason, string> = {
  NO_VALID_CHOICE: "No tiene elegido ningún desafío activo.",
  SECOND_CHOICE_NOT_VIABLE: "Su desafío no llegó a 3 personas y su segunda opción tampoco.",
  NO_SECOND_CHOICE: "Su desafío no llegó a 3 personas y no eligió segunda opción.",
  NO_ANY_TARGET: "Aceptaba cualquier desafío, pero no se formó ningún equipo al que sumarse.",
};

const MAX_TABLE_NUMBER = 999;
/** Un latecomer entra como cuarto o quinto excepcional (PRD §18); más allá es cambio manual. */
const LATECOMER_MAX_TEAM_SIZE = 5;

// ---------------------------------------------------------------------------------------------
// Helpers internos (asumen que el lock del evento ya está tomado cuando modifican equipos).

function notFoundParticipation(): DomainError {
  return new DomainError("NOT_FOUND", "No encontramos a esta persona en el evento.");
}

function notFoundTeam(): DomainError {
  return new DomainError("NOT_FOUND", "No encontramos ese equipo en el evento.");
}

function notFoundChallenge(): DomainError {
  return new DomainError("NOT_FOUND", "No encontramos ese desafío en el evento.");
}

/**
 * Lee la participation con lock de fila (FOR UPDATE): así una escritura concurrente de otro
 * servicio (reflexión, check-in) no se pisa con el estado leído acá. Requiere transacción.
 */
async function requireParticipation(
  tx: DbOrTx,
  eventId: string,
  participationId: string,
): Promise<ParticipationRow> {
  if (!isUuid(participationId)) throw notFoundParticipation();
  const [row] = await tx
    .select()
    .from(participations)
    .where(and(eq(participations.id, participationId), eq(participations.eventId, eventId)))
    .limit(1)
    .for("update");
  if (!row) throw notFoundParticipation();
  return row;
}

/** Condición SQL (sobre la tabla teams): el equipo tiene al menos un miembro. */
function teamHasMembers(tx: DbOrTx): SQL {
  return exists(
    tx.select({ one: sql`1` }).from(participations).where(eq(participations.teamId, teams.id)),
  );
}

/**
 * Condición SQL (sobre la tabla teams): el equipo tiene A3, evaluación del founder,
 * observaciones o evidencia. Borrar el equipo borraría todo eso en cascada.
 */
function teamHasRecords(tx: DbOrTx): SQL {
  return or(
    exists(tx.select({ one: sql`1` }).from(artifacts).where(eq(artifacts.teamId, teams.id))),
    exists(
      tx
        .select({ one: sql`1` })
        .from(founderAssessments)
        .where(eq(founderAssessments.teamId, teams.id)),
    ),
    exists(
      tx
        .select({ one: sql`1` })
        .from(founderObservations)
        .where(eq(founderObservations.teamId, teams.id)),
    ),
    exists(
      tx.select({ one: sql`1` }).from(evidenceItems).where(eq(evidenceItems.teamId, teams.id)),
    ),
  )!;
}

/** Equipo sin miembros y sin registros: se puede borrar o reutilizar. */
function teamIsEmpty(tx: DbOrTx): SQL {
  return and(not(teamHasMembers(tx)), not(teamHasRecords(tx)))!;
}

async function findTeam(db: DbOrTx, eventId: string, teamId: string): Promise<TeamRow | null> {
  if (!isUuid(teamId)) return null;
  return (
    (await db.query.teams.findFirst({
      where: and(eq(teams.id, teamId), eq(teams.eventId, eventId)),
    })) ?? null
  );
}

async function requireTeam(db: DbOrTx, eventId: string, teamId: string): Promise<TeamRow> {
  const team = await findTeam(db, eventId, teamId);
  if (!team) throw notFoundTeam();
  return team;
}

async function requireChallenge(
  db: DbOrTx,
  eventId: string,
  challengeId: string,
): Promise<ChallengeRow> {
  if (!isUuid(challengeId)) throw notFoundChallenge();
  const row = await db.query.challenges.findFirst({
    where: and(eq(challenges.id, challengeId), eq(challenges.eventId, eventId)),
  });
  if (!row) throw notFoundChallenge();
  return row;
}

function assertPresent(participation: ParticipationRow): void {
  if (!PRESENT_STATUSES.includes(participation.status)) {
    throw new DomainError("NOT_PRESENT", "Primero hacé el check-in de esta persona.");
  }
}

/** Regla de source para latecomers y equipos nuevos: según la relación con el challenge. */
function latecomerSource(participation: ParticipationRow, challengeId: string): AssignmentSource {
  if (participation.firstChoiceId === challengeId) return "FIRST_CHOICE";
  if (participation.secondChoiceId === challengeId) return "SECOND_CHOICE";
  if (participation.secondChoiceAny) return "ANY";
  return "MANUAL";
}

/**
 * Mueve UNA persona (nunca toca a otros miembros). Idempotente: si ya está en el destino
 * no cambia nada. Ajusta el estado según el destino esté publicado o no.
 */
async function applyMove(
  tx: DbOrTx,
  participation: ParticipationRow,
  target: TeamRow | null,
  source: AssignmentSource,
): Promise<void> {
  assertPresent(participation);
  const targetId = target?.id ?? null;
  if (participation.teamId === targetId) return;

  let status = participation.status;
  const targetPublished = Boolean(target?.publishedAt);
  if (targetPublished && status === "CHECKED_IN") {
    status = "MATCHED";
  } else if (!targetPublished && status === "MATCHED") {
    status = "CHECKED_IN";
  }

  // El estado solo se escribe si cambia: nunca pisar avances posteriores (reflexión, etc.).
  await tx
    .update(participations)
    .set({
      teamId: targetId,
      assignmentSource: target ? source : null,
      ...(status !== participation.status ? { status } : {}),
    })
    .where(eq(participations.id, participation.id));
}

async function teamSize(tx: DbOrTx, teamId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(participations)
    .where(eq(participations.teamId, teamId));
  return Number(row?.n ?? 0);
}

/** Primer equipo vacío (sin miembros ni registros) del desafío, si existe. */
async function findEmptyTeam(
  tx: DbOrTx,
  eventId: string,
  challengeId: string,
): Promise<TeamRow | null> {
  const [empty] = await tx
    .select()
    .from(teams)
    .where(and(eq(teams.eventId, eventId), eq(teams.challengeId, challengeId), teamIsEmpty(tx)))
    .orderBy(asc(teams.teamNumber))
    .limit(1);
  return empty ?? null;
}

/** Inserta un equipo con el siguiente número del challenge y la siguiente mesa libre del evento. */
async function insertTeam(
  tx: DbOrTx,
  eventId: string,
  challengeId: string,
  now: Date,
): Promise<TeamRow> {
  const [{ maxTeam }] = await tx
    .select({ maxTeam: max(teams.teamNumber) })
    .from(teams)
    .where(and(eq(teams.eventId, eventId), eq(teams.challengeId, challengeId)));
  const [{ maxTable }] = await tx
    .select({ maxTable: max(teams.tableNumber) })
    .from(teams)
    .where(eq(teams.eventId, eventId));
  const published = await hasPublishedTeams(tx, eventId);
  const [row] = await tx
    .insert(teams)
    .values({
      eventId,
      challengeId,
      teamNumber: (maxTeam ?? 0) + 1,
      tableNumber: Math.max(maxTable ?? 0, 0) + 1,
      publishedAt: published ? now : null,
    })
    .returning();
  return row;
}

async function publicationCounts(
  tx: DbOrTx,
  eventId: string,
): Promise<{ teamCount: number; matchedCount: number; noShowCount: number }> {
  const [teamRow] = await tx.select({ n: count() }).from(teams).where(eq(teams.eventId, eventId));
  const [matchedRow] = await tx
    .select({ n: count() })
    .from(participations)
    .where(and(eq(participations.eventId, eventId), isNotNull(participations.teamId)));
  const [noShowRow] = await tx
    .select({ n: count() })
    .from(participations)
    .where(and(eq(participations.eventId, eventId), eq(participations.status, "NO_SHOW")));
  return {
    teamCount: Number(teamRow?.n ?? 0),
    matchedCount: Number(matchedRow?.n ?? 0),
    noShowCount: Number(noShowRow?.n ?? 0),
  };
}

function teamLabel(startupName: string, teamNumber: number, tableNumber: number): string {
  return `${startupName} · Equipo ${teamNumber} · Mesa ${tableNumber}`;
}

function people(n: number): string {
  return n === 1 ? "1 persona" : `${n} personas`;
}

// ---------------------------------------------------------------------------------------------
// 1. Generar equipos (borrador)

export async function generateTeams(
  db: DbOrTx,
  eventId: string,
): Promise<{
  teamCount: number;
  assignedCount: number;
  unresolved: { participationId: string; name: string; reason: string }[];
  warnings: MatchingWarning[];
}> {
  return db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const event = await requireEvent(tx, eventId);
    if (await hasPublishedTeams(tx, eventId)) {
      throw new DomainError(
        "TEAMS_PUBLISHED",
        "Los equipos ya se publicaron. Desde ahora los cambios son manuales.",
      );
    }
    if (event.phase !== "MATCHING") {
      throw new DomainError("WRONG_PHASE", "Para generar equipos primero cerrá la inscripción.");
    }

    // Borrar un borrador borra en cascada su A3, evaluación y evidencia: nunca en silencio.
    const [draftWithRecords] = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.eventId, eventId), isNull(teams.publishedAt), teamHasRecords(tx)))
      .limit(1);
    if (draftWithRecords) {
      throw new DomainError(
        "DRAFT_HAS_RECORDS",
        "Hay equipos en borrador con A3, evaluación u observaciones cargadas. Revisalos antes de volver a generar.",
      );
    }

    // Regeneración (02 §17): se descartan los borradores anteriores.
    const draftTeamIds = tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.eventId, eventId), isNull(teams.publishedAt)));
    await tx
      .update(participations)
      .set({ teamId: null, assignmentSource: null })
      .where(and(eq(participations.eventId, eventId), inArray(participations.teamId, draftTeamIds)));
    await tx.delete(teams).where(and(eq(teams.eventId, eventId), isNull(teams.publishedAt)));

    // Solo presentes (CHECKED_IN), en orden de llegada.
    const present = await tx
      .select({
        id: participations.id,
        name: participants.name,
        firstChoiceId: participations.firstChoiceId,
        secondChoiceId: participations.secondChoiceId,
        secondChoiceAny: participations.secondChoiceAny,
        initialMode: participations.initialMode,
      })
      .from(participations)
      .leftJoin(participants, eq(participants.id, participations.participantId))
      .where(and(eq(participations.eventId, eventId), eq(participations.status, "CHECKED_IN")))
      .orderBy(sql`${participations.checkedInAt} asc nulls last`, asc(participations.id));

    const activeChallenges = await listChallenges(tx, eventId, { activeOnly: true });

    const result = generateMatching(
      present.map((p, index) => ({
        id: p.id,
        firstChoiceId: p.firstChoiceId,
        secondChoiceId: p.secondChoiceId,
        secondChoiceAny: p.secondChoiceAny,
        mode: p.initialMode,
        order: index,
      })),
      // El índice respeta el orden de listChallenges (sortOrder y, ante empate, startup).
      activeChallenges.map((c, index) => ({ id: c.id, sortOrder: index })),
      { startTableNumber: 1 },
    );

    let assignedCount = 0;
    if (result.teams.length > 0) {
      const inserted = await tx
        .insert(teams)
        .values(
          result.teams.map((t) => ({
            eventId,
            challengeId: t.challengeId,
            teamNumber: t.teamNumber,
            tableNumber: t.tableNumber,
            publishedAt: null,
          })),
        )
        .returning({ id: teams.id, challengeId: teams.challengeId, teamNumber: teams.teamNumber });
      const idByKey = new Map(inserted.map((t) => [`${t.challengeId}:${t.teamNumber}`, t.id]));

      // Una sola sentencia para todas las asignaciones (el lock del evento está tomado).
      const values = result.teams.flatMap((team) => {
        const teamId = idByKey.get(`${team.challengeId}:${team.teamNumber}`);
        if (!teamId) throw new Error("generateTeams: equipo insertado no encontrado");
        return team.members.map(
          (member) =>
            sql`(${member.participantId}::uuid, ${teamId}::uuid, ${member.source}::${sql.identifier(assignmentSourceEnum.enumName)})`,
        );
      });
      const updated = await tx.execute(sql`
        update ${participations}
        set ${sql.identifier(participations.teamId.name)} = v.team_id,
            ${sql.identifier(participations.assignmentSource.name)} = v.source
        from (values ${sql.join(values, sql`, `)}) as v(id, team_id, source)
        where ${participations.id} = v.id
          and ${participations.eventId} = ${eventId}
          and ${participations.status} = 'CHECKED_IN'
        returning ${participations.id}
      `);
      assignedCount = updated.length;
      if (assignedCount !== values.length) {
        // Invariante protegida por el lock; si se rompe, se revierte todo y se pide reintentar.
        throw new DomainError(
          "CONCURRENT_CHANGE",
          "Cambió la lista de presentes mientras se armaban los equipos. Probá de nuevo.",
        );
      }
    }

    const nameById = new Map(present.map((p) => [p.id, p.name ?? "Sin nombre"]));
    return {
      teamCount: result.teams.length,
      assignedCount,
      unresolved: result.unresolved.map((u) => ({
        participationId: u.participantId,
        name: nameById.get(u.participantId) ?? "Sin nombre",
        reason: UNRESOLVED_REASON_TEXT[u.reason],
      })),
      warnings: result.warnings,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// 2. Publicar equipos

export async function publishTeams(
  db: DbOrTx,
  eventId: string,
  now: Date = new Date(),
): Promise<{ alreadyPublished: boolean; teamCount: number; matchedCount: number; noShowCount: number }> {
  return db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const event = await requireEvent(tx, eventId);

    // Idempotente (02 §28): si ya se publicó, devuelve el estado actual.
    if (await hasPublishedTeams(tx, eventId)) {
      return { alreadyPublished: true, ...(await publicationCounts(tx, eventId)) };
    }
    if (event.phase !== "MATCHING") {
      throw new DomainError(
        "WRONG_PHASE",
        "Para publicar equipos primero cerrá la inscripción y generá los equipos.",
      );
    }
    const anyTeam = await tx.query.teams.findFirst({
      where: eq(teams.eventId, eventId),
      columns: { id: true },
    });
    if (!anyTeam) {
      throw new DomainError("NO_TEAMS", "Todavía no hay equipos para publicar.");
    }

    await tx.update(teams).set({ publishedAt: now }).where(eq(teams.eventId, eventId));
    await tx
      .update(participations)
      .set({ status: "MATCHED" })
      .where(
        and(
          eq(participations.eventId, eventId),
          isNotNull(participations.teamId),
          eq(participations.status, "CHECKED_IN"),
        ),
      );
    await tx
      .update(participations)
      .set({ status: "NO_SHOW" })
      .where(and(eq(participations.eventId, eventId), eq(participations.status, "REGISTERED")));
    await tx.update(events).set({ phase: "SPRINT" }).where(eq(events.id, eventId));

    return { alreadyPublished: false, ...(await publicationCounts(tx, eventId)) };
  });
}

// ---------------------------------------------------------------------------------------------
// 3. Mover una persona (cambio manual, antes o después de publicar)

export async function moveParticipant(
  db: DbOrTx,
  eventId: string,
  participationId: string,
  targetTeamId: string | null,
  opts: { source?: AssignmentSource } = {},
): Promise<void> {
  const source = opts.source ?? "MANUAL";
  if (!ASSIGNMENT_SOURCES.includes(source)) {
    throw new DomainError("INVALID_SOURCE", "El origen de la asignación no es válido.");
  }
  await db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    await requireEvent(tx, eventId);
    const participation = await requireParticipation(tx, eventId, participationId);
    const target = targetTeamId === null ? null : await requireTeam(tx, eventId, targetTeamId);
    await applyMove(tx, participation, target, source);
    // Si ya reflexionó, su interpretación pasa a usar la evidencia del equipo nuevo.
    const reflected = participation.status === "REFLECTION_COMPLETED" || participation.status === "INTERPRETED";
    if (reflected && participation.teamId !== (target?.id ?? null)) {
      await interpretParticipation(tx, participation.id);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 4. Latecomer: se suma a un equipo sin mover a nadie más (03 §11)

export async function assignLatecomer(
  db: DbOrTx,
  eventId: string,
  participationId: string,
  teamId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    await requireEvent(tx, eventId);
    const participation = await requireParticipation(tx, eventId, participationId);
    const team = await requireTeam(tx, eventId, teamId);
    // Doble tap o dos staff con la misma decisión: ya está ahí.
    if (participation.teamId === team.id) return;
    assertPresent(participation);
    // Un latecomer no tiene equipo. Sacar a alguien de otro equipo es un cambio manual
    // (y evita que un segundo staff con el tablero viejo lo mueva sin darse cuenta).
    if (participation.teamId !== null) {
      throw new DomainError(
        "ALREADY_ASSIGNED",
        "Esta persona ya tiene equipo. Si querés cambiarla, usá el cambio manual.",
      );
    }
    // Cuarto o quinto excepcional, nunca sexto: protege de dos staff sumando a la vez.
    if ((await teamSize(tx, team.id)) >= LATECOMER_MAX_TEAM_SIZE) {
      throw new DomainError(
        "TEAM_FULL",
        `Ese equipo ya tiene ${LATECOMER_MAX_TEAM_SIZE} personas. Si igual querés sumarla, usá el cambio manual.`,
      );
    }
    await applyMove(tx, participation, team, latecomerSource(participation, team.challengeId));
  });
}

// ---------------------------------------------------------------------------------------------
// 5–6. Crear equipos

export async function createTeam(
  db: DbOrTx,
  eventId: string,
  challengeId: string,
  now: Date = new Date(),
): Promise<TeamRow> {
  return db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    await requireEvent(tx, eventId);
    await requireChallenge(tx, eventId, challengeId);
    // Idempotente ante doble tap o dos staff: si ese desafío ya tiene un equipo vacío
    // (sin miembros ni registros), se devuelve ese en lugar de crear otro.
    return (
      (await findEmptyTeam(tx, eventId, challengeId)) ??
      (await insertTeam(tx, eventId, challengeId, now))
    );
  });
}

/**
 * "Si llegan 3 compatibles → nuevo equipo" (PRD §18). Solo con personas presentes sin equipo.
 * Idempotente: si todas ya están juntas en un equipo de ese desafío, devuelve ese equipo.
 */
export async function createTeamWithMembers(
  db: DbOrTx,
  eventId: string,
  challengeId: string,
  participationIds: string[],
  now: Date = new Date(),
): Promise<TeamRow> {
  const ids = [...new Set(participationIds)];
  if (ids.length === 0) {
    throw new DomainError("NO_MEMBERS", "Elegí al menos una persona para el equipo nuevo.");
  }
  if (!ids.every(isUuid)) throw notFoundParticipation();

  return db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    await requireEvent(tx, eventId);
    await requireChallenge(tx, eventId, challengeId);

    const rows = await tx
      .select()
      .from(participations)
      .where(and(eq(participations.eventId, eventId), inArray(participations.id, ids)))
      .for("update");
    if (rows.length !== ids.length) throw notFoundParticipation();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)!);

    // Doble tap: ya están todas juntas en un equipo de este desafío.
    const currentTeamIds = new Set(ordered.map((r) => r.teamId));
    const [onlyTeamId] = [...currentTeamIds];
    if (currentTeamIds.size === 1 && onlyTeamId) {
      const existing = await findTeam(tx, eventId, onlyTeamId);
      if (existing && existing.challengeId === challengeId) return existing;
    }

    for (const row of ordered) {
      assertPresent(row);
      if (row.teamId !== null) {
        throw new DomainError(
          "ALREADY_ASSIGNED",
          "Alguna de estas personas ya tiene equipo. Para moverla usá el cambio manual.",
        );
      }
    }

    // Si el desafío ya tiene un equipo vacío (p. ej. un "crear equipo" previo), se usa ese.
    const team =
      (await findEmptyTeam(tx, eventId, challengeId)) ??
      (await insertTeam(tx, eventId, challengeId, now));
    for (const row of ordered) {
      await applyMove(tx, row, team, latecomerSource(row, challengeId));
    }
    return team;
  });
}

// ---------------------------------------------------------------------------------------------
// 7. Borrar equipo vacío

export async function deleteTeam(db: DbOrTx, eventId: string, teamId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    await requireEvent(tx, eventId);
    const team = await findTeam(tx, eventId, teamId);
    // Idempotente: si ya no existe, no hay nada que borrar.
    if (!team) return;

    // Sin miembros, ni artefactos, ni evaluación del founder (score u observaciones/evidencia).
    const deleted = await tx
      .delete(teams)
      .where(and(eq(teams.id, team.id), teamIsEmpty(tx)))
      .returning({ id: teams.id });
    if (deleted.length === 0) {
      throw new DomainError(
        "TEAM_NOT_EMPTY",
        "Solo se pueden borrar equipos vacíos y sin evaluación.",
      );
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 8. Cambiar mesa (intercambia si ya estaba ocupada)

export async function setTableNumber(
  db: DbOrTx,
  eventId: string,
  teamId: string,
  tableNumber: number,
): Promise<void> {
  if (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > MAX_TABLE_NUMBER) {
    throw new DomainError(
      "INVALID_TABLE",
      `La mesa tiene que ser un número entero entre 1 y ${MAX_TABLE_NUMBER}.`,
    );
  }
  await db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    await requireEvent(tx, eventId);
    const team = await requireTeam(tx, eventId, teamId);
    if (team.tableNumber === tableNumber) return;

    const occupant = await tx.query.teams.findFirst({
      where: and(eq(teams.eventId, eventId), eq(teams.tableNumber, tableNumber)),
    });
    if (occupant) {
      // unique(event_id, table_number): valor temporal negativo para poder intercambiar.
      await tx.update(teams).set({ tableNumber: -1 }).where(eq(teams.id, team.id));
      await tx
        .update(teams)
        .set({ tableNumber: team.tableNumber })
        .where(eq(teams.id, occupant.id));
    }
    await tx.update(teams).set({ tableNumber }).where(eq(teams.id, team.id));
  });
}

// ---------------------------------------------------------------------------------------------
// 9. Tablero de equipos para el staff

export async function getTeamsBoard(db: DbOrTx, eventId: string): Promise<TeamsBoard> {
  // Pantalla que se refresca seguido: cantidad fija de consultas, independientes en paralelo.
  const event = await requireEvent(db, eventId);
  const [allChallenges, teamRows, personRows, assessmentRows, artifactRows] = await Promise.all([
    listChallenges(db, eventId),
    db.query.teams.findMany({
      where: eq(teams.eventId, eventId),
      orderBy: [asc(teams.tableNumber)],
    }),
    db
      .select({
        participationId: participations.id,
        name: participants.name,
        whatsapp: participants.whatsappNormalized,
        initialMode: participations.initialMode,
        firstChoiceId: participations.firstChoiceId,
        secondChoiceId: participations.secondChoiceId,
        secondChoiceAny: participations.secondChoiceAny,
        assignmentSource: participations.assignmentSource,
        status: participations.status,
        checkedInAt: participations.checkedInAt,
        teamId: participations.teamId,
      })
      .from(participations)
      .leftJoin(participants, eq(participants.id, participations.participantId))
      .where(
        and(
          eq(participations.eventId, eventId),
          or(isNotNull(participations.teamId), eq(participations.status, "CHECKED_IN")),
        ),
      )
      .orderBy(sql`${participations.checkedInAt} asc nulls last`, asc(participations.id)),
    db
      .select({ teamId: founderAssessments.teamId, winner: founderAssessments.winner })
      .from(founderAssessments)
      .innerJoin(teams, eq(teams.id, founderAssessments.teamId))
      .where(eq(teams.eventId, eventId)),
    db
      .select({ teamId: artifacts.teamId, n: count() })
      .from(artifacts)
      .where(eq(artifacts.eventId, eventId))
      .groupBy(artifacts.teamId),
  ]);
  const published = teamRows.some((t) => t.publishedAt !== null);
  const challengeById = new Map(allChallenges.map((c) => [c.id, c]));
  const assessmentByTeam = new Map(assessmentRows.map((a) => [a.teamId, a]));
  const artifactsByTeam = new Map(artifactRows.map((a) => [a.teamId, Number(a.n)]));

  const toPerson = (row: (typeof personRows)[number]): BoardPerson => ({
    participationId: row.participationId,
    name: row.name ?? "Sin nombre",
    whatsapp: row.whatsapp ?? "",
    initialMode: row.initialMode,
    firstChoiceId: row.firstChoiceId,
    secondChoiceId: row.secondChoiceId,
    secondChoiceAny: row.secondChoiceAny,
    assignmentSource: row.assignmentSource,
    status: row.status,
    checkedInAt: row.checkedInAt,
    suggestion: null,
  });

  const membersByTeam = new Map<string, BoardPerson[]>();
  const unassigned: BoardPerson[] = [];
  for (const row of personRows) {
    if (row.teamId) {
      const list = membersByTeam.get(row.teamId) ?? [];
      list.push(toPerson(row));
      membersByTeam.set(row.teamId, list);
    } else if (row.status === "CHECKED_IN") {
      unassigned.push(toPerson(row));
    }
  }

  const boardTeams: BoardTeam[] = teamRows.map((team) => {
    const challenge = challengeById.get(team.challengeId);
    const members = (membersByTeam.get(team.id) ?? []).sort(
      (a, b) => a.name.localeCompare(b.name, "es") || a.participationId.localeCompare(b.participationId),
    );
    const assessment = assessmentByTeam.get(team.id);
    return {
      id: team.id,
      challengeId: team.challengeId,
      startupName: challenge?.startupName ?? "",
      challengeTitle: challenge?.title ?? "",
      teamNumber: team.teamNumber,
      tableNumber: team.tableNumber,
      publishedAt: team.publishedAt,
      members,
      hasAssessment: Boolean(assessment),
      winner: assessment?.winner ?? false,
      artifactCount: artifactsByTeam.get(team.id) ?? 0,
    };
  });

  // Sugerencias para latecomers (solo después de publicar; nunca mueven a nadie).
  if (published) {
    const isActive = (id: string | null): string | null =>
      id !== null && challengeById.get(id)?.active ? id : null;
    const placementTeams: PlacementTeam[] = boardTeams
      .filter((t) => challengeById.get(t.challengeId)?.active)
      .map((t) => ({
        id: t.id,
        challengeId: t.challengeId,
        teamNumber: t.teamNumber,
        tableNumber: t.tableNumber,
        size: t.members.length,
      }));
    const latecomers: Latecomer[] = unassigned.map((p) => ({
      participationId: p.participationId,
      firstChoiceId: isActive(p.firstChoiceId),
      secondChoiceId: isActive(p.secondChoiceId),
      secondChoiceAny: p.secondChoiceAny,
    }));
    unassigned.forEach((person, index) => {
      person.suggestion = suggestPlacement(
        latecomers[index],
        placementTeams,
        latecomers.filter((_, other) => other !== index),
      );
    });
  }

  const warnings: TeamsBoard["warnings"] = [];
  if (unassigned.length > 0) {
    warnings.push({
      code: "UNASSIGNED",
      message:
        unassigned.length === 1
          ? "Hay 1 persona presente sin equipo."
          : `Hay ${unassigned.length} personas presentes sin equipo.`,
    });
  }
  for (const team of boardTeams) {
    const label = teamLabel(team.startupName, team.teamNumber, team.tableNumber);
    const size = team.members.length;
    if (size === 0) {
      warnings.push({ code: "TEAM_TOO_SMALL", message: `${label} está vacío.` });
    } else if (size < 3) {
      warnings.push({
        code: "TEAM_TOO_SMALL",
        message: `${label} tiene ${people(size)}: el mínimo es 3.`,
      });
    } else if (size === 5) {
      warnings.push({
        code: "TEAM_OF_FIVE",
        message: `${label} tiene 5 personas (quinto excepcional).`,
      });
    } else if (size >= 6) {
      warnings.push({
        code: "TEAM_TOO_BIG",
        message: `${label} tiene ${size} personas. Conviene dividirlo.`,
      });
    }
    if (size > 0 && challengeById.get(team.challengeId)?.active === false) {
      warnings.push({
        code: "INACTIVE_CHALLENGE",
        message: `${label} es de un desafío desactivado y tiene ${people(size)}.`,
      });
    }
  }

  return {
    eventId: event.id,
    phase: event.phase,
    published,
    challenges: allChallenges.map((c) => ({
      id: c.id,
      startupName: c.startupName,
      title: c.title,
      active: c.active,
    })),
    teams: boardTeams,
    unassigned,
    warnings,
  };
}

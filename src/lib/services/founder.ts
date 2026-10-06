import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import {
  artifacts,
  challenges,
  events,
  evidenceItems,
  founderAssessments,
  founderObservations,
  participants,
  participations,
  reflections,
  teams,
  type FounderAssessmentRow,
  type TeamRow,
} from "@/lib/db/schema";
import {
  A3_BLOCKS,
  CAPABILITIES,
  OBSERVER_SOURCES,
  type A3Block,
  type AssignmentSource,
  type Capability,
  type EventPhase,
  type Mode,
  type ObserverSource,
  type ParticipationStatus,
} from "@/lib/domain/constants";
import {
  evidenceFromA3Blocks,
  evidenceFromFounderAssessment,
  evidenceFromObservation,
  type EvidenceDraft,
} from "@/lib/domain/evidence";
import { ALLOWED_ARTIFACT_TYPES, MAX_ARTIFACT_BYTES, getStorage } from "@/lib/storage";
import { DomainError } from "./errors";
import { isUuid, lockEvent } from "./events";
import {
  insertEvidence,
  interpretParticipation,
  lockTeamEvidence,
  reinterpretTeam,
} from "./reflection";

// Vista de equipo para founder/staff: A3, evaluación founder, observaciones individuales y fotos
// (PRD §21, §22, §28; 02 §10; 03 §8, §12).
// - La evaluación y el A3 son evidencia de EQUIPO (scope TEAM, sin participationId): nunca se
//   atribuyen a cada integrante; interpret() solo las suma donde hay evidencia individual.
// - La observación individual es evidencia INDIVIDUAL externa fuerte.
// - Subir la foto del A3 no genera evidencia (no hay análisis automático).
// Cada cambio de evidencia re-interpreta solo a quienes ya reflexionaron.

export interface TeamDetail {
  team: TeamRow;
  eventPhase: EventPhase;
  challenge: { id: string; startupName: string; title: string; brief: string; prize: string | null };
  members: {
    participationId: string;
    name: string;
    initialMode: Mode | null;
    assignmentSource: AssignmentSource | null;
    status: ParticipationStatus;
    hasReflection: boolean;
  }[];
  artifacts: { id: string; contentType: string; sizeBytes: number; createdAt: Date }[];
  assessment: FounderAssessmentRow | null;
  observations: {
    id: string;
    participationId: string;
    name: string;
    capability: Capability;
    observerSource: ObserverSource;
    note: string | null;
    createdAt: Date;
  }[];
  /** Otros equipos del mismo desafío, para navegar. */
  siblings: { id: string; teamNumber: number; tableNumber: number }[];
}

export interface FounderAssessmentInput {
  problemScore: number | null;
  valueScore: number | null;
  testScore: number | null;
  feedback: string | null;
  winner: boolean;
}

export interface ObservationInput {
  participationId: string;
  capability: Capability;
  observerSource: ObserverSource;
  note: string | null;
}

const MAX_FEEDBACK = 1000;
const MAX_NOTE = 500;
const NO_NAME = "Sin nombre";

function teamNotFound(): DomainError {
  return new DomainError("TEAM_NOT_FOUND", "No encontramos ese equipo.");
}

async function requireTeam(db: DbOrTx, eventId: string, teamId: string): Promise<TeamRow> {
  if (!isUuid(eventId) || !isUuid(teamId)) throw teamNotFound();
  const team = await db.query.teams.findFirst({
    where: and(eq(teams.id, teamId), eq(teams.eventId, eventId)),
  });
  if (!team) throw teamNotFound();
  return team;
}

async function hasReflection(db: DbOrTx, participationId: string): Promise<boolean> {
  const row = await db.query.reflections.findFirst({
    where: eq(reflections.participationId, participationId),
    columns: { id: true },
  });
  return Boolean(row);
}

function draftKey(d: {
  sourceType: string;
  rawCode: string;
  sourceWeight: number;
  confidence: number;
}): string {
  return `${d.sourceType}|${d.rawCode}|${d.sourceWeight}|${d.confidence}`;
}

/**
 * Reconstruye la evidencia de equipo de un origen ("founder_assessment:<teamId>", "a3:<teamId>").
 * Si la evidencia guardada ya es la misma, no toca nada (doble tap, re-guardar solo el feedback).
 * Devuelve true si cambió.
 */
async function replaceTeamEvidence(
  tx: DbOrTx,
  eventId: string,
  teamId: string,
  originRef: string,
  drafts: readonly EvidenceDraft[],
): Promise<boolean> {
  const current = await tx
    .select({
      sourceType: evidenceItems.sourceType,
      rawCode: evidenceItems.rawCode,
      sourceWeight: evidenceItems.sourceWeight,
      confidence: evidenceItems.confidence,
    })
    .from(evidenceItems)
    .where(eq(evidenceItems.originRef, originRef));
  const before = current.map(draftKey).sort();
  const after = drafts.map(draftKey).sort();
  if (before.length === after.length && before.every((k, i) => k === after[i])) return false;

  await tx.delete(evidenceItems).where(eq(evidenceItems.originRef, originRef));
  await insertEvidence(tx, { eventId, participationId: null, teamId, originRef }, drafts);
  return true;
}

function isScoreOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5);
}

function cleanOptionalText(value: string | null | undefined, max: number, error: DomainError): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > max) throw error;
  return text.length > 0 ? text : null;
}

/** Vista de equipo (PRD §28). null si el equipo no es de ese evento. */
export async function getTeamDetail(
  db: DbOrTx,
  eventId: string,
  teamId: string,
): Promise<TeamDetail | null> {
  if (!isUuid(eventId) || !isUuid(teamId)) return null;
  // La vista se recarga tras cada carga del founder: equipo, fase, desafío y evaluación van en
  // una sola consulta.
  const [head] = await db
    .select({
      team: teams,
      eventPhase: events.phase,
      challenge: {
        id: challenges.id,
        startupName: challenges.startupName,
        title: challenges.title,
        brief: challenges.brief,
        prize: challenges.prize,
      },
      assessment: founderAssessments,
    })
    .from(teams)
    .innerJoin(events, eq(events.id, teams.eventId))
    .innerJoin(challenges, eq(challenges.id, teams.challengeId))
    .leftJoin(founderAssessments, eq(founderAssessments.teamId, teams.id))
    .where(and(eq(teams.id, teamId), eq(teams.eventId, eventId)))
    .limit(1);
  if (!head) return null;
  const { team, challenge } = head;

  const memberRows = await db
    .select({
      participationId: participations.id,
      name: participants.name,
      initialMode: participations.initialMode,
      assignmentSource: participations.assignmentSource,
      status: participations.status,
      reflectionId: reflections.id,
    })
    .from(participations)
    .leftJoin(participants, eq(participants.id, participations.participantId))
    .leftJoin(reflections, eq(reflections.participationId, participations.id))
    .where(eq(participations.teamId, teamId));
  const members = memberRows
    .map((m) => ({
      participationId: m.participationId,
      name: m.name ?? NO_NAME,
      initialMode: m.initialMode,
      assignmentSource: m.assignmentSource,
      status: m.status,
      hasReflection: m.reflectionId !== null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es") || a.participationId.localeCompare(b.participationId));

  const artifactRows = await db
    .select({
      id: artifacts.id,
      contentType: artifacts.contentType,
      sizeBytes: artifacts.sizeBytes,
      createdAt: artifacts.createdAt,
    })
    .from(artifacts)
    .where(eq(artifacts.teamId, teamId))
    .orderBy(asc(artifacts.createdAt), asc(artifacts.id));

  const observationRows = await db
    .select({
      id: founderObservations.id,
      participationId: founderObservations.participationId,
      name: participants.name,
      capability: founderObservations.capability,
      observerSource: founderObservations.observerSource,
      note: founderObservations.note,
      createdAt: founderObservations.createdAt,
    })
    .from(founderObservations)
    .innerJoin(participations, eq(participations.id, founderObservations.participationId))
    .leftJoin(participants, eq(participants.id, participations.participantId))
    .where(eq(founderObservations.teamId, teamId))
    .orderBy(asc(founderObservations.createdAt), asc(founderObservations.id));
  const observations = observationRows.map((o) => ({
    id: o.id,
    participationId: o.participationId,
    name: o.name ?? NO_NAME,
    capability: o.capability,
    // La columna admite cualquier fuente de evidencia; acá solo se guardan las de observador.
    observerSource: o.observerSource as ObserverSource,
    note: o.note,
    createdAt: o.createdAt,
  }));

  const siblings = await db
    .select({ id: teams.id, teamNumber: teams.teamNumber, tableNumber: teams.tableNumber })
    .from(teams)
    .where(and(eq(teams.eventId, eventId), eq(teams.challengeId, team.challengeId), ne(teams.id, teamId)))
    .orderBy(asc(teams.teamNumber));

  return {
    team,
    eventPhase: head.eventPhase,
    challenge,
    members,
    artifacts: artifactRows,
    assessment: head.assessment,
    observations,
    siblings,
  };
}

/**
 * Evaluación founder Problema / Valor / Prueba + feedback + ganador (PRD §21, 02 §10).
 * Un founder sin puntajes es válido (todo null). Upsert por equipo; reconstruye la evidencia
 * de equipo y re-interpreta a quienes ya reflexionaron.
 */
export async function saveFounderAssessment(
  db: DbOrTx,
  eventId: string,
  teamId: string,
  input: FounderAssessmentInput,
  staffId: string | null,
  opts: { expectedUpdatedAt?: string | null } = {},
): Promise<FounderAssessmentRow> {
  if (!isScoreOrNull(input.problemScore) || !isScoreOrNull(input.valueScore) || !isScoreOrNull(input.testScore)) {
    throw new DomainError("INVALID_SCORE", "Los puntajes van del 1 al 5 (o sin puntaje).");
  }
  const feedback = cleanOptionalText(
    input.feedback,
    MAX_FEEDBACK,
    new DomainError("INVALID_FEEDBACK", `El feedback puede tener hasta ${MAX_FEEDBACK} caracteres.`),
  );
  const values = {
    problemScore: input.problemScore,
    valueScore: input.valueScore,
    testScore: input.testScore,
    feedback,
    winner: input.winner === true,
    updatedByStaffId: staffId,
  };

  return db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    await requireTeam(tx, eventId, teamId);
    await lockTeamEvidence(tx, teamId);
    if (opts.expectedUpdatedAt !== undefined) {
      // El formulario manda la versión que vio: si otra persona guardó en el medio, no se pisa.
      const current = await tx.query.founderAssessments.findFirst({
        where: eq(founderAssessments.teamId, teamId),
        columns: { updatedAt: true },
      });
      const currentVersion = current ? current.updatedAt.toISOString() : null;
      if (currentVersion !== opts.expectedUpdatedAt) {
        throw new DomainError(
          "STALE_ASSESSMENT",
          "Otra persona guardó una evaluación para este equipo hace un momento. Recargá para verla antes de cambiarla.",
        );
      }
    }
    const [row] = await tx
      .insert(founderAssessments)
      .values({ teamId, ...values })
      .onConflictDoUpdate({ target: founderAssessments.teamId, set: { ...values, updatedAt: new Date() } })
      .returning();
    const changed = await replaceTeamEvidence(
      tx,
      eventId,
      teamId,
      `founder_assessment:${teamId}`,
      evidenceFromFounderAssessment(values),
    );
    if (changed) await reinterpretTeam(tx, teamId);
    return row;
  });
}

/**
 * Bloques del A3 marcados por staff/founder (PRD §19, §22). Marcado humano, sin análisis
 * automático. Reemplaza la marca anterior.
 */
export async function saveA3Blocks(
  db: DbOrTx,
  eventId: string,
  teamId: string,
  blocks: A3Block[],
  opts: { expectedBlocks?: A3Block[] } = {},
): Promise<void> {
  // Una entrada que no es lista no puede leerse como "ningún bloque": borraría la marca guardada.
  if (!Array.isArray(blocks) || blocks.some((b) => !A3_BLOCKS.includes(b))) {
    throw new DomainError("INVALID_A3", "Hay un bloque del A3 que no reconocemos.");
  }
  const clean = A3_BLOCKS.filter((b) => blocks.includes(b));

  await db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const team = await requireTeam(tx, eventId, teamId);
    await lockTeamEvidence(tx, teamId);
    if (opts.expectedBlocks !== undefined) {
      const seen = A3_BLOCKS.filter((b) => opts.expectedBlocks?.includes(b)).join(",");
      const current = A3_BLOCKS.filter((b) => team.a3Blocks.includes(b)).join(",");
      if (seen !== current && current !== clean.join(",")) {
        throw new DomainError(
          "STALE_A3",
          "Otra persona marcó los bloques del A3 hace un momento. Recargá para verlos antes de cambiarlos.",
        );
      }
    }
    await tx.update(teams).set({ a3Blocks: clean }).where(eq(teams.id, teamId));
    const changed = await replaceTeamEvidence(tx, eventId, teamId, `a3:${teamId}`, evidenceFromA3Blocks(clean));
    if (changed) await reinterpretTeam(tx, teamId);
  });
}

/**
 * Contribución individual observada por founder o facilitador (PRD §21 opcional, 02 §10).
 * Evidencia individual externa fuerte. Una observación idéntica ya cargada (misma persona,
 * capacidad, fuente y nota) no se duplica: se devuelve la existente (doble tap / dos staff).
 */
export async function addObservation(
  db: DbOrTx,
  eventId: string,
  teamId: string,
  input: ObservationInput,
  staffId: string | null,
): Promise<string> {
  if (!CAPABILITIES.includes(input.capability)) {
    throw new DomainError("INVALID_CAPABILITY", "Elegí la capacidad que observaste.");
  }
  if (!OBSERVER_SOURCES.includes(input.observerSource)) {
    throw new DomainError("INVALID_SOURCE", "Indicá si la observación es del founder o de facilitación.");
  }
  const note = cleanOptionalText(
    input.note,
    MAX_NOTE,
    new DomainError("INVALID_NOTE", `La nota puede tener hasta ${MAX_NOTE} caracteres.`),
  );
  const notInTeam = new DomainError("NOT_IN_TEAM", "Esa persona no está en este equipo.");

  return db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    await requireTeam(tx, eventId, teamId);
    await lockTeamEvidence(tx, teamId);
    if (!isUuid(input.participationId)) throw notInTeam;
    const p = await tx.query.participations.findFirst({
      where: and(eq(participations.id, input.participationId), eq(participations.eventId, eventId)),
      columns: { id: true, teamId: true },
    });
    if (!p || p.teamId !== teamId) throw notInTeam;

    const duplicate = await tx.query.founderObservations.findFirst({
      where: and(
        eq(founderObservations.teamId, teamId),
        eq(founderObservations.participationId, p.id),
        eq(founderObservations.capability, input.capability),
        eq(founderObservations.observerSource, input.observerSource),
        note === null ? isNull(founderObservations.note) : eq(founderObservations.note, note),
      ),
      columns: { id: true },
    });
    if (duplicate) return duplicate.id;

    const [observation] = await tx
      .insert(founderObservations)
      .values({
        eventId,
        teamId,
        participationId: p.id,
        capability: input.capability,
        observerSource: input.observerSource,
        note,
        createdByStaffId: staffId,
      })
      .returning({ id: founderObservations.id });

    await insertEvidence(
      tx,
      { eventId, participationId: p.id, teamId, originRef: `observation:${observation.id}` },
      [evidenceFromObservation({ capability: input.capability, observerSource: input.observerSource, note })],
    );
    if (await hasReflection(tx, p.id)) await interpretParticipation(tx, p.id);
    return observation.id;
  });
}

/** Borra una observación y su evidencia; re-interpreta si la persona ya reflexionó. Idempotente. */
export async function deleteObservation(db: DbOrTx, eventId: string, observationId: string): Promise<void> {
  if (!isUuid(eventId) || !isUuid(observationId)) return;
  await db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const observation = await tx.query.founderObservations.findFirst({
      where: and(eq(founderObservations.id, observationId), eq(founderObservations.eventId, eventId)),
    });
    if (!observation) return;
    // El lock es el del equipo ACTUAL de la persona: es el que toma submitReflection. Si la
    // movieron de equipo después de la observación, bloquear el equipo viejo no alcanzaría para
    // que una reflexión simultánea vea (o no) esta evidencia de forma consistente.
    // moveParticipant necesita lockEvent (lo tenemos), así que el equipo no cambia acá.
    const owner = await tx.query.participations.findFirst({
      where: eq(participations.id, observation.participationId),
      columns: { teamId: true },
    });
    await lockTeamEvidence(tx, owner?.teamId ?? observation.teamId);
    await tx.delete(evidenceItems).where(eq(evidenceItems.originRef, `observation:${observation.id}`));
    await tx.delete(founderObservations).where(eq(founderObservations.id, observation.id));
    if (await hasReflection(tx, observation.participationId)) {
      await interpretParticipation(tx, observation.participationId);
    }
  });
}

function normalizeContentType(value: string): string {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Foto del A3 (PRD §22). Se guarda en el storage privado y NO genera evidencia.
 * Re-subir la misma foto al mismo equipo (reintento, doble tap) devuelve la existente.
 */
export async function uploadArtifact(
  db: DbOrTx,
  eventId: string,
  teamId: string,
  file: { data: Buffer; contentType: string },
  staffId: string | null,
): Promise<{ id: string }> {
  const contentType = normalizeContentType(file.contentType);
  const size = Buffer.isBuffer(file.data) ? file.data.length : 0;
  if (
    !(ALLOWED_ARTIFACT_TYPES as readonly string[]).includes(contentType) ||
    size <= 0 ||
    size > MAX_ARTIFACT_BYTES
  ) {
    throw new DomainError("INVALID_FILE", "Subí una foto JPG, PNG o WEBP de hasta 4 MB.");
  }
  const storage = getStorage();

  return db.transaction(async (tx) => {
    // Lock del evento (como toda mutación sobre equipos): serializa con deleteTeam, que solo borra
    // equipos sin fotos. Sin él, un borrado simultáneo deja el INSERT con una FK rota (error 500)
    // o una foto huérfana. La foto llega comprimida (≤ 1600 px), así que el lock dura poco.
    await lockEvent(tx, eventId);
    await requireTeam(tx, eventId, teamId);
    const sameSize = await tx
      .select({ id: artifacts.id, storagePath: artifacts.storagePath })
      .from(artifacts)
      .where(
        and(eq(artifacts.teamId, teamId), eq(artifacts.contentType, contentType), eq(artifacts.sizeBytes, size)),
      );
    for (const candidate of sameSize) {
      const existing = await storage.get(tx, candidate.storagePath);
      if (existing && existing.equals(file.data)) return { id: candidate.id };
    }

    const storagePath = await storage.put(tx, file.data);
    const [row] = await tx
      .insert(artifacts)
      .values({
        eventId,
        teamId,
        type: "A3_PHOTO",
        storagePath,
        contentType,
        sizeBytes: size,
        createdByStaffId: staffId,
      })
      .returning({ id: artifacts.id });
    return { id: row.id };
  });
}

/** Archivo de una foto para el Route Handler autenticado de staff. */
export async function getArtifactFile(
  db: DbOrTx,
  artifactId: string,
): Promise<{ eventId: string; teamId: string; contentType: string; data: Buffer } | null> {
  if (!isUuid(artifactId)) return null;
  const artifact = await db.query.artifacts.findFirst({ where: eq(artifacts.id, artifactId) });
  if (!artifact) return null;
  const data = await getStorage().get(db, artifact.storagePath);
  if (!data) return null;
  return { eventId: artifact.eventId, teamId: artifact.teamId, contentType: artifact.contentType, data };
}

/** Borra la foto (blob + fila). Idempotente. */
export async function deleteArtifact(db: DbOrTx, eventId: string, artifactId: string): Promise<void> {
  if (!isUuid(eventId) || !isUuid(artifactId)) return;
  await db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const [artifact] = await tx
      .delete(artifacts)
      .where(and(eq(artifacts.id, artifactId), eq(artifacts.eventId, eventId)))
      .returning({ storagePath: artifacts.storagePath });
    if (!artifact) return;
    await getStorage().remove(tx, artifact.storagePath);
  });
}

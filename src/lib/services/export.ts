import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import type { DbOrTx } from "@/lib/db/client";
import {
  artifacts,
  capabilitySignals,
  challenges,
  evidenceItems,
  founderAssessments,
  founderObservations,
  interpretationSnapshots,
  participants,
  participations,
  questionnaireAnswers,
  recommendations,
  reflections,
  teams,
  type ChallengeRow,
  type EventRow,
  type TeamRow,
} from "@/lib/db/schema";
import { MODE_LABELS } from "@/lib/domain/copy";
import { toCsv, type CsvCell } from "@/lib/domain/csv";
import { normalizeWhatsapp } from "@/lib/domain/phone";
import { formatIsoDate, formatTime } from "@/lib/domain/time";
import { requireEvent } from "./events";
import { ANY_CHOICE_LABEL } from "./operations";

// Contingencia y backup (PRD §29, spec §30, operaciones §13–§14): el evento tiene que poder
// seguir en papel si se cae la app.

const collator = new Intl.Collator("es", { sensitivity: "base" });

/**
 * Corre varias lecturas sobre una misma foto de la base (REPEATABLE READ, solo lectura).
 * Los exports se piden en pleno evento (14:15 y justo antes del matching, ops §14): sin la
 * foto, un equipo creado o una reflexión enviada entre dos consultas dejaría el respaldo
 * con referencias colgadas (personas en un equipo que no figura, evidencia sin reflexión).
 * Si ya se está dentro de una transacción, se usa esa.
 */
async function readSnapshot<T>(db: DbOrTx, fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
  if (db instanceof PgTransaction) return fn(db);
  return db.transaction(fn, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** "20261015-1420" en la hora local del evento. */
function fileStamp(now: Date, timeZone: string): string {
  return `${formatIsoDate(now, timeZone).replace(/-/g, "")}-${formatTime(now, timeZone).replace(":", "")}`;
}

/** Inscriptos del evento (con persona asociada), incluye NO_SHOW y altas de staff. */
function selectRegistered(db: DbOrTx, eventId: string) {
  return db
    .select({
      id: participations.id,
      status: participations.status,
      initialMode: participations.initialMode,
      firstChoiceId: participations.firstChoiceId,
      secondChoiceId: participations.secondChoiceId,
      secondChoiceAny: participations.secondChoiceAny,
      operationalConsentAt: participations.operationalConsentAt,
      communityConsentAt: participations.communityConsentAt,
      checkedInAt: participations.checkedInAt,
      teamId: participations.teamId,
      addedByStaff: participations.addedByStaff,
      name: participants.name,
      whatsapp: participants.whatsappNormalized,
    })
    .from(participations)
    .innerJoin(participants, eq(participants.id, participations.participantId))
    .where(eq(participations.eventId, eventId));
}

type RegisteredRow = Awaited<ReturnType<typeof selectRegistered>>[number];

interface EventSheet {
  event: EventRow;
  challenges: ChallengeRow[];
  teams: TeamRow[];
  people: RegisteredRow[];
  challengeById: Map<string, ChallengeRow>;
  teamById: Map<string, TeamRow>;
}

/** Evento, desafíos, equipos (por mesa) e inscriptos: tres consultas sobre la misma foto. */
async function loadEventSheet(db: DbOrTx, eventId: string): Promise<EventSheet> {
  const { event, challengeRows, teamRows, people } = await readSnapshot(db, async (tx) => {
    const event = await requireEvent(tx, eventId);
    const [challengeRows, teamRows, people] = await Promise.all([
      tx
        .select()
        .from(challenges)
        .where(eq(challenges.eventId, eventId))
        .orderBy(asc(challenges.sortOrder), asc(challenges.startupName)),
      tx
        .select()
        .from(teams)
        .where(eq(teams.eventId, eventId))
        .orderBy(asc(teams.tableNumber)),
      selectRegistered(tx, eventId),
    ]);
    return { event, challengeRows, teamRows, people };
  });
  return {
    event,
    challenges: challengeRows,
    teams: teamRows,
    people,
    challengeById: new Map(challengeRows.map((c) => [c.id, c])),
    teamById: new Map(teamRows.map((t) => [t.id, t])),
  };
}

function choiceNames(
  p: { firstChoiceId: string | null; secondChoiceId: string | null; secondChoiceAny: boolean },
  challengeById: Map<string, ChallengeRow>,
): { first: string; second: string } {
  const first = p.firstChoiceId ? (challengeById.get(p.firstChoiceId)?.startupName ?? "") : "";
  const second = p.secondChoiceId
    ? (challengeById.get(p.secondChoiceId)?.startupName ?? "")
    : p.secondChoiceAny
      ? ANY_CHOICE_LABEL
      : "";
  return { first, second };
}

/**
 * WhatsApp legible y sin "+" inicial: Excel no lo convierte en número (5,49E+12) ni en fórmula.
 */
function csvPhone(e164: string): string {
  const parsed = normalizeWhatsapp(e164);
  return (parsed.ok ? parsed.display : e164).replace(/^\+/, "");
}

export const PARTICIPANTS_CSV_HEADER = [
  "nombre",
  "whatsapp",
  "whatsapp_link",
  "estado",
  "modo_inicial",
  "primera_opcion",
  "segunda_opcion",
  "presente",
  "hora_checkin",
  "desafio_asignado",
  "equipo",
  "mesa",
  "equipos_publicados",
  "consentimiento_operativo",
  "consentimiento_comunidad",
  "alta_staff",
] as const;

/**
 * CSV de contingencia con todas las personas inscriptas (PRD §29, spec §30, ops §14).
 * Ordenado por primera opción y nombre, para separar por desafío en papel.
 */
export async function exportParticipantsCsv(
  db: DbOrTx,
  eventId: string,
  now: Date = new Date(),
): Promise<{ filename: string; csv: string }> {
  const { event, people, challengeById, teamById } = await loadEventSheet(db, eventId);
  const tz = event.timezone;

  const rows = people.map((p) => {
    const { first, second } = choiceNames(p, challengeById);
    const team = p.teamId ? teamById.get(p.teamId) : undefined;
    return { p, first, second, team };
  });
  rows.sort((a, b) => {
    // Sin primera opción, al final.
    if (!a.first !== !b.first) return a.first ? -1 : 1;
    return collator.compare(a.first, b.first) || collator.compare(a.p.name, b.p.name);
  });

  const table: CsvCell[][] = [
    [...PARTICIPANTS_CSV_HEADER],
    ...rows.map(({ p, first, second, team }) => [
      p.name,
      csvPhone(p.whatsapp),
      `https://wa.me/${p.whatsapp.replace(/\D/g, "")}`,
      p.status,
      p.initialMode ? MODE_LABELS[p.initialMode] : "",
      first,
      second,
      p.checkedInAt !== null,
      p.checkedInAt ? formatTime(p.checkedInAt, tz) : "",
      team ? (challengeById.get(team.challengeId)?.startupName ?? "") : "",
      team ? team.teamNumber : "",
      team ? team.tableNumber : "",
      team ? team.publishedAt !== null : "",
      p.operationalConsentAt !== null,
      p.communityConsentAt !== null,
      p.addedByStaff,
    ]),
  ];

  return {
    filename: `innovaton-${event.slug}-${fileStamp(now, tz)}.csv`,
    // ";" es el separador que espera Excel en español; Google Sheets lo detecta solo.
    csv: toCsv(table, { separator: ";" }),
  };
}

/**
 * Volcado completo del evento en JSON (sin tokens ni bytes de archivos) para poder
 * reconstruir o auditar después.
 */
export async function exportBackupJson(
  db: DbOrTx,
  eventId: string,
  now: Date = new Date(),
): Promise<{ filename: string; data: Record<string, unknown> }> {
  return readSnapshot(db, async (tx) => {
    const event = await requireEvent(tx, eventId);

    const participationIds = tx
      .select({ id: participations.id })
      .from(participations)
      .where(eq(participations.eventId, eventId));
    const participantIds = tx
      .select({ id: participations.participantId })
      .from(participations)
      .where(and(eq(participations.eventId, eventId), isNotNull(participations.participantId)));
    const teamIds = tx.select({ id: teams.id }).from(teams).where(eq(teams.eventId, eventId));
    const evidenceIds = tx
      .select({ id: evidenceItems.id })
      .from(evidenceItems)
      .where(eq(evidenceItems.eventId, eventId));
    const interpretationIds = tx
      .select({ id: interpretationSnapshots.id })
      .from(interpretationSnapshots)
      .where(inArray(interpretationSnapshots.participationId, participationIds));

    const [
      challengeRows,
      participantRows,
      participationRows,
      answerRows,
      teamRows,
      reflectionRows,
      assessmentRows,
      observationRows,
      artifactRows,
      evidenceRows,
      signalRows,
      interpretationRows,
      recommendationRows,
    ] = await Promise.all([
      tx.query.challenges.findMany({
        where: eq(challenges.eventId, eventId),
        orderBy: [asc(challenges.sortOrder), asc(challenges.startupName)],
      }),
      tx.query.participants.findMany({
        where: inArray(participants.id, participantIds),
        orderBy: asc(participants.createdAt),
      }),
      tx.query.participations.findMany({
        where: eq(participations.eventId, eventId),
        columns: { resumeTokenHash: false },
        orderBy: asc(participations.createdAt),
      }),
      tx.query.questionnaireAnswers.findMany({
        where: inArray(questionnaireAnswers.participationId, participationIds),
        orderBy: [asc(questionnaireAnswers.participationId), asc(questionnaireAnswers.questionKey)],
      }),
      tx.query.teams.findMany({ where: eq(teams.eventId, eventId), orderBy: asc(teams.tableNumber) }),
      tx.query.reflections.findMany({
        where: inArray(reflections.participationId, participationIds),
        orderBy: asc(reflections.createdAt),
      }),
      tx.query.founderAssessments.findMany({ where: inArray(founderAssessments.teamId, teamIds) }),
      tx.query.founderObservations.findMany({
        where: eq(founderObservations.eventId, eventId),
        orderBy: asc(founderObservations.createdAt),
      }),
      // Solo metadatos: los bytes viven en artifact_blobs y no se exportan.
      tx.query.artifacts.findMany({
        where: eq(artifacts.eventId, eventId),
        orderBy: asc(artifacts.createdAt),
      }),
      tx.query.evidenceItems.findMany({
        where: eq(evidenceItems.eventId, eventId),
        orderBy: asc(evidenceItems.createdAt),
      }),
      tx.query.capabilitySignals.findMany({
        where: inArray(capabilitySignals.evidenceItemId, evidenceIds),
      }),
      tx.query.interpretationSnapshots.findMany({
        where: inArray(interpretationSnapshots.participationId, participationIds),
        orderBy: asc(interpretationSnapshots.createdAt),
      }),
      tx.query.recommendations.findMany({
        where: inArray(recommendations.interpretationId, interpretationIds),
        orderBy: asc(recommendations.createdAt),
      }),
    ]);

    return {
      filename: `innovaton-${event.slug}-backup-${fileStamp(now, event.timezone)}.json`,
      data: {
        exportedAt: now.toISOString(),
        event,
        challenges: challengeRows,
        participants: participantRows,
        participations: participationRows,
        questionnaireAnswers: answerRows,
        teams: teamRows,
        reflections: reflectionRows,
        founderAssessments: assessmentRows,
        founderObservations: observationRows,
        artifacts: artifactRows,
        evidenceItems: evidenceRows,
        capabilitySignals: signalRows,
        interpretationSnapshots: interpretationRows,
        recommendations: recommendationRows,
      },
    };
  });
}

export interface PrintData {
  event: EventRow;
  /** Desafíos activos, en el orden del evento. */
  challenges: {
    id: string;
    startupName: string;
    title: string;
    brief: string;
    prize: string | null;
  }[];
  /** Equipos ordenados por mesa, con integrantes por nombre. */
  teams: {
    tableNumber: number;
    startupName: string;
    teamNumber: number;
    published: boolean;
    members: string[];
  }[];
  /** Inscriptos ordenados por nombre. */
  people: {
    name: string;
    whatsapp: string;
    firstChoice: string;
    secondChoice: string;
    present: boolean;
    table: number | null;
  }[];
}

/** Datos para la hoja imprimible de contingencia (ops §13). */
export async function getPrintData(db: DbOrTx, eventId: string): Promise<PrintData> {
  const sheet = await loadEventSheet(db, eventId);
  const { event, challengeById, teamById } = sheet;
  const registered = [...sheet.people];
  registered.sort((a, b) => collator.compare(a.name, b.name));

  const membersByTeam = new Map<string, string[]>();
  for (const p of registered) {
    if (!p.teamId) continue;
    const list = membersByTeam.get(p.teamId) ?? [];
    list.push(p.name);
    membersByTeam.set(p.teamId, list);
  }

  return {
    event,
    challenges: sheet.challenges
      .filter((c) => c.active)
      .map((c) => ({
        id: c.id,
        startupName: c.startupName,
        title: c.title,
        brief: c.brief,
        prize: c.prize,
      })),
    teams: sheet.teams.map((t) => ({
      tableNumber: t.tableNumber,
      startupName: challengeById.get(t.challengeId)?.startupName ?? "",
      teamNumber: t.teamNumber,
      published: t.publishedAt !== null,
      members: membersByTeam.get(t.id) ?? [],
    })),
    people: registered.map((p) => {
      const { first, second } = choiceNames(p, challengeById);
      const team = p.teamId ? teamById.get(p.teamId) : undefined;
      return {
        name: p.name,
        whatsapp: p.whatsapp,
        firstChoice: first,
        secondChoice: second,
        present: p.checkedInAt !== null,
        table: team ? team.tableNumber : null,
      };
    }),
  };
}

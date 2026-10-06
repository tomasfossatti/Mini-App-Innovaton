import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { count, eq, sql } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import type { Capability, EventPhase, EvidenceLevel, Mode, ReflectionAction } from "@/lib/domain/constants";
import { evidenceFromFounderAssessment } from "@/lib/domain/evidence";
import { MAX_ARTIFACT_BYTES } from "@/lib/storage";
import { DomainError } from "@/lib/services/errors";
import { lockEvent } from "@/lib/services/events";
import {
  addObservation,
  deleteArtifact,
  deleteObservation,
  getArtifactFile,
  getTeamDetail,
  saveA3Blocks,
  saveFounderAssessment,
  uploadArtifact,
} from "@/lib/services/founder";
import { getOutcome, lockTeamEvidence, submitReflection } from "@/lib/services/reflection";
import {
  closeTestDb,
  makeChallenges,
  makeEvent,
  makeRegistered,
  resetDb,
  secondTestDb,
  testDb,
} from "./helpers";

const db = testDb();

beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const NOW = new Date("2026-10-15T18:40:00.000Z");
const NO_SCORES = { problemScore: null, valueScore: null, testScore: null, feedback: null, winner: false };

type Scores = Record<Capability, { self: number; observed: number; team: number; rawTeam: number; effective: number; level: EvidenceLevel }>;

async function setup(phase: EventPhase = "REFLECTION") {
  const event = await makeEvent(db, { phase });
  const [challenge, otherChallenge] = await makeChallenges(db, event.id, 2);
  const [team, sibling, otherTeam] = await db
    .insert(s.teams)
    .values([
      { eventId: event.id, challengeId: challenge.id, teamNumber: 1, tableNumber: 1, publishedAt: NOW },
      { eventId: event.id, challengeId: challenge.id, teamNumber: 2, tableNumber: 2, publishedAt: NOW },
      { eventId: event.id, challengeId: otherChallenge.id, teamNumber: 1, tableNumber: 3, publishedAt: NOW },
    ])
    .returning();
  return { event, challenge, team, sibling, otherTeam };
}

async function member(eventId: string, challengeId: string, teamId: string, name: string, mode: Mode = "DRIVE") {
  const { participation } = await makeRegistered(db, eventId, {
    firstChoiceId: challengeId,
    secondChoiceAny: true,
    checkedIn: true,
    mode,
    name,
  });
  const [updated] = await db
    .update(s.participations)
    .set({ teamId, assignmentSource: "FIRST_CHOICE", status: "EXPERIENCE_COMPLETED" })
    .where(eq(s.participations.id, participation.id))
    .returning();
  return updated;
}

async function reflect(
  event: s.EventRow,
  participationId: string,
  selectedActions: ReflectionAction[],
  primaryCapability: Capability,
  database = db,
) {
  return submitReflection(
    database,
    event,
    participationId,
    {
      postClarity: 4,
      selectedActions,
      primaryContributionText: null,
      primaryCapability,
      perceivedValue: 4,
      initialModeUsefulness: 4,
    },
    NOW,
  );
}

async function latestSnapshot(participationId: string) {
  const outcome = await getOutcome(db, participationId);
  if (!outcome) throw new Error("sin outcome");
  const row = await db.query.interpretationSnapshots.findFirst({
    where: eq(s.interpretationSnapshots.id, outcome.interpretation.id),
  });
  if (!row) throw new Error("sin snapshot");
  const details = row.evidenceSnapshot as { scores: Scores; counts: { individual: number; team: number } };
  return { outcome, row, scores: details.scores, counts: details.counts };
}

async function snapshotCount(participationId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(s.interpretationSnapshots)
    .where(eq(s.interpretationSnapshots.participationId, participationId));
  return Number(row.n);
}

async function evidenceByOrigin(originRef: string) {
  return db.query.evidenceItems.findMany({ where: eq(s.evidenceItems.originRef, originRef) });
}

async function total(table: typeof s.evidenceItems | typeof s.capabilitySignals | typeof s.artifactBlobs) {
  const [row] = await db.select({ n: count() }).from(table);
  return Number(row.n);
}

/** Espera a que haya al menos `min` sesiones de esta base esperando un lock (fila o advisory). */
async function waitForLockWaiters(min: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await db.execute(
      sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (Number(rows[0]?.n ?? 0) >= min) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function caught(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error("Se esperaba un DomainError");
}

describe("evidencia de equipo (founder score + A3)", () => {
  it("no se atribuye a todo el equipo: solo refuerza a quien tiene evidencia individual compatible", async () => {
    const { event, challenge, team } = await setup();
    const a = await member(event.id, challenge.id, team.id, "Ana", "DRIVE");
    const b = await member(event.id, challenge.id, team.id, "Bruno", "EXPLORE");

    await saveFounderAssessment(db, event.id, team.id, { ...NO_SCORES, testScore: 5 }, null);
    await saveA3Blocks(db, event.id, team.id, ["TEST"]);

    const teamItems = await db.query.evidenceItems.findMany({ where: eq(s.evidenceItems.teamId, team.id) });
    expect(teamItems).toHaveLength(2);
    for (const item of teamItems) {
      expect(item.scope).toBe("TEAM");
      expect(item.participationId).toBeNull();
    }

    // A declaró haber convertido la idea en una prueba (y su aporte principal fue comunicar).
    await reflect(event, a.id, ["CREATED_TEST"], "COMMUNICATION");
    // B no declaró nada de experimentación.
    await reflect(event, b.id, ["ASKED_QUESTIONS"], "PROBLEM_UNDERSTANDING");

    const sa = await latestSnapshot(a.id);
    // Score founder 5 (1.5) + bloque TEST (0.75) = 2.25, con tope de equipo 1.5.
    expect(sa.scores.EXPERIMENTATION).toMatchObject({ self: 1, rawTeam: 2.25, team: 1.5, level: "CONVERGENT" });
    expect(sa.row.primaryCapability).toBe("EXPERIMENTATION");
    expect(sa.outcome.interpretation.primaryLevel).toBe("CONVERGENT");
    expect(sa.counts).toEqual({ individual: 2, team: 2 });

    const sb = await latestSnapshot(b.id);
    expect(sb.scores.EXPERIMENTATION).toMatchObject({ self: 0, observed: 0, effective: 0, level: "INSUFFICIENT" });
    expect(sb.scores.EXPERIMENTATION.rawTeam).toBeGreaterThan(0); // la evidencia existe, pero no suma
    expect(sb.row.primaryCapability).toBe("PROBLEM_UNDERSTANDING");
    expect(sb.row.secondaryCapability).not.toBe("EXPERIMENTATION");
    expect(sb.outcome.interpretation.secondary).not.toBe("EXPERIMENTATION");
  });

  it("evaluación cargada después de la reflexión → snapshot nuevo y getOutcome refleja el cambio", async () => {
    const { event, challenge, team } = await setup();
    const a = await member(event.id, challenge.id, team.id, "Ana", "DRIVE");
    const b = await member(event.id, challenge.id, team.id, "Bruno", "DRIVE");
    const first = await reflect(event, a.id, ["CREATED_TEST"], "COMMUNICATION");

    const before = await getOutcome(db, a.id);
    expect(before?.interpretation.id).toBe(first.interpretationId);
    expect(before?.interpretation.primary).toBe("COMMUNICATION");
    expect(before?.interpretation.primaryLevel).toBe("SIGNAL");

    await saveFounderAssessment(
      db,
      event.id,
      team.id,
      { problemScore: 3, valueScore: 2, testScore: 5, feedback: "  Muy buena prueba  ", winner: true },
      null,
    );

    expect(await snapshotCount(a.id)).toBe(2);
    expect(await snapshotCount(b.id)).toBe(0); // no reflexionó: no se interpreta
    const after = await getOutcome(db, a.id);
    expect(after?.interpretation.id).not.toBe(first.interpretationId);
    expect(after?.interpretation.primary).toBe("EXPERIMENTATION");
    expect(after?.interpretation.primaryLevel).toBe("CONVERGENT");
    expect(after?.recommendation.type).toBe("REPLICATE_SIGNAL");
    expect(after?.recommendation.capability).toBe("EXPERIMENTATION");

    const status = await db.query.participations.findFirst({ where: eq(s.participations.id, a.id) });
    expect(status?.status).toBe("INTERPRETED");
  });

  it("founder sin evaluación (o sin puntajes): la interpretación funciona sin evidencia de equipo", async () => {
    const { event, challenge, team } = await setup();
    const a = await member(event.id, challenge.id, team.id, "Ana", "DRIVE");
    await reflect(event, a.id, ["CREATED_TEST"], "EXPERIMENTATION");

    const sa = await latestSnapshot(a.id);
    expect(sa.counts).toEqual({ individual: 2, team: 0 });
    expect(sa.scores.EXPERIMENTATION).toMatchObject({ team: 0, level: "SIGNAL" });
    expect(sa.row.type).toBe("ALIGNED");

    // Founder ausente / sin score: solo feedback. No crea evidencia ni re-interpreta.
    const row = await saveFounderAssessment(
      db,
      event.id,
      team.id,
      { ...NO_SCORES, feedback: "Llegué tarde, no puntúo" },
      null,
    );
    expect(row).toMatchObject({ problemScore: null, valueScore: null, testScore: null, winner: false });
    expect(await evidenceByOrigin(`founder_assessment:${team.id}`)).toHaveLength(0);
    expect(await snapshotCount(a.id)).toBe(1);
  });

  it("guardar la evaluación dos veces no duplica evidencia; cambiar puntajes la reemplaza", async () => {
    const { event, challenge, team } = await setup();
    const a = await member(event.id, challenge.id, team.id, "Ana");
    await reflect(event, a.id, ["CREATED_TEST"], "EXPERIMENTATION");
    const payload = { problemScore: 4, valueScore: 3, testScore: 5, feedback: null, winner: false };

    await saveFounderAssessment(db, event.id, team.id, payload, null);
    await saveFounderAssessment(db, event.id, team.id, payload, null);
    const items = await evidenceByOrigin(`founder_assessment:${team.id}`);
    expect(items.map((i) => i.rawCode).sort()).toEqual(["FOUNDER_SCORE_PROBLEM:4", "FOUNDER_SCORE_TEST:5"]);
    expect(await total(s.capabilitySignals)).toBe(2 + 2); // reflexión (2) + equipo (2)
    expect(await snapshotCount(a.id)).toBe(2); // reflexión + primera evaluación

    // Solo cambia el feedback/ganador: misma evidencia, sin re-interpretar.
    const updated = await saveFounderAssessment(
      db,
      event.id,
      team.id,
      { ...payload, feedback: "Ganadores", winner: true },
      null,
    );
    expect(updated).toMatchObject({ feedback: "Ganadores", winner: true });
    expect(await evidenceByOrigin(`founder_assessment:${team.id}`)).toHaveLength(2);
    expect(await snapshotCount(a.id)).toBe(2);

    // Cambian los puntajes: se reconstruye.
    await saveFounderAssessment(db, event.id, team.id, { ...payload, problemScore: null, testScore: 4 }, null);
    const rebuilt = await evidenceByOrigin(`founder_assessment:${team.id}`);
    expect(rebuilt.map((i) => i.rawCode)).toEqual(["FOUNDER_SCORE_TEST:4"]);
    expect(await snapshotCount(a.id)).toBe(3);

    const [assessments] = await db.select({ n: count() }).from(s.founderAssessments);
    expect(Number(assessments.n)).toBe(1);
  });

  it("solo A3 (founder ausente): el bloque TEST refuerza a quien declaró la prueba, no al resto", async () => {
    const { event, challenge, team } = await setup();
    const a = await member(event.id, challenge.id, team.id, "Ana", "DRIVE");
    const b = await member(event.id, challenge.id, team.id, "Bruno", "EXPLORE");
    await reflect(event, a.id, ["CREATED_TEST"], "COMMUNICATION");
    await reflect(event, b.id, ["ASKED_QUESTIONS"], "PROBLEM_UNDERSTANDING");
    expect((await latestSnapshot(a.id)).scores.EXPERIMENTATION.level).toBe("SIGNAL");

    await saveA3Blocks(db, event.id, team.id, ["TEST"]);

    const sa = await latestSnapshot(a.id);
    expect(sa.scores.EXPERIMENTATION).toMatchObject({ self: 1, team: 0.75, level: "CONVERGENT" });
    const sb = await latestSnapshot(b.id);
    expect(sb.scores.EXPERIMENTATION).toMatchObject({ effective: 0, level: "INSUFFICIENT" });
    expect(await snapshotCount(a.id)).toBe(2);
    expect(await snapshotCount(b.id)).toBe(2);
  });

  it("dos staff guardan la evaluación a la vez: una fila y evidencia de la versión final", async () => {
    const { event, challenge, team } = await setup();
    const a = await member(event.id, challenge.id, team.id, "Ana");
    await reflect(event, a.id, ["CREATED_TEST"], "EXPERIMENTATION");
    const other = secondTestDb();
    try {
      await Promise.all([
        saveFounderAssessment(db, event.id, team.id, { ...NO_SCORES, testScore: 5 }, null),
        saveFounderAssessment(other.db, event.id, team.id, { ...NO_SCORES, problemScore: 5, testScore: 4 }, null),
      ]);
    } finally {
      await other.sql.end({ timeout: 5 });
    }
    const rows = await db.query.founderAssessments.findMany({ where: eq(s.founderAssessments.teamId, team.id) });
    expect(rows).toHaveLength(1);
    const expected = evidenceFromFounderAssessment(rows[0]).map((d) => d.rawCode).sort();
    const items = await evidenceByOrigin(`founder_assessment:${team.id}`);
    expect(items.map((i) => i.rawCode).sort()).toEqual(expected);
    const snap = await latestSnapshot(a.id);
    expect(snap.scores.EXPERIMENTATION.rawTeam).toBe(rows[0].testScore === 5 ? 1.5 : 0.75);
  });

  it("el A3 se reemplaza sin duplicar y se guarda en el equipo", async () => {
    const { event, challenge, team } = await setup();
    await member(event.id, challenge.id, team.id, "Ana");
    await saveA3Blocks(db, event.id, team.id, ["TEST", "PROBLEM", "TEST"]);
    await saveA3Blocks(db, event.id, team.id, ["PROBLEM", "TEST"]);
    let items = await evidenceByOrigin(`a3:${team.id}`);
    expect(items.map((i) => i.rawCode).sort()).toEqual(["A3_BLOCK_PROBLEM", "A3_BLOCK_TEST"]);
    let row = await db.query.teams.findFirst({ where: eq(s.teams.id, team.id) });
    expect(row?.a3Blocks).toEqual(["PROBLEM", "TEST"]);

    await saveA3Blocks(db, event.id, team.id, []);
    items = await evidenceByOrigin(`a3:${team.id}`);
    expect(items).toHaveLength(0);
    row = await db.query.teams.findFirst({ where: eq(s.teams.id, team.id) });
    expect(row?.a3Blocks).toEqual([]);

    const err = await caught(saveA3Blocks(db, event.id, team.id, ["SLIDES" as never]));
    expect(err.code).toBe("INVALID_A3");

    // Algo que no es una lista no se interpreta como "ningún bloque": no borra la marca.
    await saveA3Blocks(db, event.id, team.id, ["TEST"]);
    expect((await caught(saveA3Blocks(db, event.id, team.id, null as never))).code).toBe("INVALID_A3");
    row = await db.query.teams.findFirst({ where: eq(s.teams.id, team.id) });
    expect(row?.a3Blocks).toEqual(["TEST"]);
    expect(await evidenceByOrigin(`a3:${team.id}`)).toHaveLength(1);
  });

  it("valida puntajes, feedback y que el equipo sea del evento", async () => {
    const { event, team } = await setup();
    expect((await caught(saveFounderAssessment(db, event.id, team.id, { ...NO_SCORES, testScore: 6 }, null))).code).toBe(
      "INVALID_SCORE",
    );
    expect((await caught(saveFounderAssessment(db, event.id, team.id, { ...NO_SCORES, valueScore: 2.5 }, null))).code).toBe(
      "INVALID_SCORE",
    );
    expect(
      (await caught(saveFounderAssessment(db, event.id, team.id, { ...NO_SCORES, feedback: "x".repeat(1001) }, null)))
        .code,
    ).toBe("INVALID_FEEDBACK");
    const otherEvent = await makeEvent(db, { phase: "REFLECTION" });
    expect((await caught(saveFounderAssessment(db, otherEvent.id, team.id, NO_SCORES, null))).code).toBe(
      "TEAM_NOT_FOUND",
    );
    expect((await caught(saveA3Blocks(db, otherEvent.id, team.id, ["TEST"]))).code).toBe("TEAM_NOT_FOUND");
  });

  it("reflexión y evaluación simultáneas: el resultado final ve las dos", async () => {
    const { event, challenge, team } = await setup();
    const a = await member(event.id, challenge.id, team.id, "Ana", "DRIVE");
    const other = secondTestDb();
    try {
      await Promise.all([
        reflect(event, a.id, ["CREATED_TEST"], "COMMUNICATION", other.db),
        saveFounderAssessment(db, event.id, team.id, { ...NO_SCORES, testScore: 5 }, null),
      ]);
    } finally {
      await other.sql.end({ timeout: 5 });
    }
    const sa = await latestSnapshot(a.id);
    expect(sa.scores.EXPERIMENTATION).toMatchObject({ team: 1.5, level: "CONVERGENT" });
    expect(sa.outcome.interpretation.primary).toBe("EXPERIMENTATION");
  });
});

describe("observaciones individuales", () => {
  it("observación founder → CONVERGENT (peso 3) y re-interpretación; borrarla vuelve atrás", async () => {
    const { event, challenge, team } = await setup();
    const b = await member(event.id, challenge.id, team.id, "Bruno", "EXPLORE");
    await reflect(event, b.id, ["ASKED_QUESTIONS"], "PROBLEM_UNDERSTANDING");
    const before = await latestSnapshot(b.id);
    expect(before.scores.IDEATION.level).toBe("INSUFFICIENT");
    expect(before.row.primaryCapability).toBe("PROBLEM_UNDERSTANDING");

    const observationId = await addObservation(
      db,
      event.id,
      team.id,
      { participationId: b.id, capability: "IDEATION", observerSource: "FOUNDER_INDIVIDUAL", note: "  Propuso el giro clave " },
      null,
    );
    const items = await evidenceByOrigin(`observation:${observationId}`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      scope: "INDIVIDUAL",
      participationId: b.id,
      teamId: team.id,
      sourceType: "FOUNDER_INDIVIDUAL",
      sourceWeight: 3,
      rawCode: "IDEATION",
      rawText: "Propuso el giro clave",
    });

    const withObs = await latestSnapshot(b.id);
    expect(withObs.scores.IDEATION).toMatchObject({ self: 0, observed: 3, level: "CONVERGENT" });
    expect(withObs.row.primaryCapability).toBe("IDEATION");
    expect(withObs.outcome.interpretation.primaryLevel).toBe("CONVERGENT");
    expect(await snapshotCount(b.id)).toBe(2);

    await deleteObservation(db, event.id, observationId);
    expect(await evidenceByOrigin(`observation:${observationId}`)).toHaveLength(0);
    expect(await db.query.founderObservations.findFirst({ where: eq(s.founderObservations.id, observationId) })).toBeUndefined();
    const after = await latestSnapshot(b.id);
    expect(after.scores.IDEATION.level).toBe("INSUFFICIENT");
    expect(after.row.primaryCapability).toBe("PROBLEM_UNDERSTANDING");
    expect(await snapshotCount(b.id)).toBe(3);

    // Idempotente.
    await deleteObservation(db, event.id, observationId);
    expect(await snapshotCount(b.id)).toBe(3);
  });

  it("deleteObservation se serializa con el equipo ACTUAL de la persona (el que bloquea su reflexión)", async () => {
    const { event, challenge, team, sibling } = await setup();
    const a = await member(event.id, challenge.id, team.id, "Ana");
    const observationId = await addObservation(
      db,
      event.id,
      team.id,
      { participationId: a.id, capability: "IDEATION", observerSource: "FOUNDER_INDIVIDUAL", note: null },
      null,
    );
    // Después de la observación la pasaron a otro equipo.
    await db.update(s.participations).set({ teamId: sibling.id }).where(eq(s.participations.id, a.id));

    const other = secondTestDb();
    let done = false;
    try {
      // Simula una reflexión en curso de Ana (toma el lock de evidencia de su equipo actual).
      const { pending } = await other.db.transaction(async (tx) => {
        await lockTeamEvidence(tx, sibling.id);
        const pending = deleteObservation(db, event.id, observationId).then(() => {
          done = true;
        });
        expect(await waitForLockWaiters(1)).toBe(true);
        expect(done).toBe(false);
        return { pending };
      });
      await pending;
    } finally {
      await other.sql.end({ timeout: 5 });
    }
    expect(done).toBe(true);
    expect(await evidenceByOrigin(`observation:${observationId}`)).toHaveLength(0);
  });

  it("observación de facilitación pesa 2.5 y alcanza CONVERGENT", async () => {
    const { event, challenge, team } = await setup();
    const b = await member(event.id, challenge.id, team.id, "Bruno", "EXPLORE");
    await reflect(event, b.id, ["ASKED_QUESTIONS"], "PROBLEM_UNDERSTANDING");
    await addObservation(
      db,
      event.id,
      team.id,
      { participationId: b.id, capability: "PRIORITIZATION", observerSource: "FACILITATOR_OBSERVATION", note: null },
      null,
    );
    const snap = await latestSnapshot(b.id);
    expect(snap.scores.PRIORITIZATION).toMatchObject({ observed: 2.5, level: "CONVERGENT" });
  });

  it("antes de reflexionar se guarda la evidencia pero no se interpreta; luego cuenta en la reflexión", async () => {
    const { event, challenge, team } = await setup();
    const a = await member(event.id, challenge.id, team.id, "Ana", "DRIVE");
    await addObservation(
      db,
      event.id,
      team.id,
      { participationId: a.id, capability: "IDEATION", observerSource: "FOUNDER_INDIVIDUAL", note: null },
      null,
    );
    expect(await snapshotCount(a.id)).toBe(0);
    await reflect(event, a.id, ["CREATED_TEST"], "EXPERIMENTATION");
    const snap = await latestSnapshot(a.id);
    expect(snap.scores.IDEATION).toMatchObject({ observed: 3, level: "CONVERGENT" });
    expect(snap.counts).toEqual({ individual: 3, team: 0 });
  });

  it("la observación idéntica no se duplica y otra persona del evento fuera del equipo → NOT_IN_TEAM", async () => {
    const { event, challenge, team, sibling } = await setup();
    const a = await member(event.id, challenge.id, team.id, "Ana");
    const outsider = await member(event.id, challenge.id, sibling.id, "Otro");
    const obs = { participationId: a.id, capability: "IDEATION" as const, observerSource: "FOUNDER_INDIVIDUAL" as const, note: "Idea" };

    const [first, second] = await Promise.all([
      addObservation(db, event.id, team.id, obs, null),
      addObservation(db, event.id, team.id, { ...obs, note: " Idea " }, null),
    ]);
    expect(second).toBe(first);
    const [n] = await db.select({ n: count() }).from(s.founderObservations);
    expect(Number(n.n)).toBe(1);
    expect(await total(s.evidenceItems)).toBe(1);

    const err = await caught(
      addObservation(db, event.id, team.id, { ...obs, participationId: outsider.id }, null),
    );
    expect(err.code).toBe("NOT_IN_TEAM");
    expect(err.message).toBe("Esa persona no está en este equipo.");
    expect((await caught(addObservation(db, event.id, team.id, { ...obs, participationId: "x" }, null))).code).toBe(
      "NOT_IN_TEAM",
    );
    expect((await caught(addObservation(db, event.id, team.id, { ...obs, note: "x".repeat(501) }, null))).code).toBe(
      "INVALID_NOTE",
    );
  });
});

describe("fotos del A3", () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

  it("tipo inválido, vacía o tamaño excedido → INVALID_FILE", async () => {
    const { event, team } = await setup();
    const cases = [
      { data: PNG, contentType: "application/pdf" },
      { data: PNG, contentType: "image/gif" },
      { data: Buffer.alloc(0), contentType: "image/png" },
      { data: Buffer.alloc(MAX_ARTIFACT_BYTES + 1), contentType: "image/jpeg" },
    ];
    for (const file of cases) {
      const err = await caught(uploadArtifact(db, event.id, team.id, file, null));
      expect(err.code).toBe("INVALID_FILE");
      expect(err.message).toBe("Subí una foto JPG, PNG o WEBP de hasta 4 MB.");
    }
    expect(await total(s.artifactBlobs)).toBe(0);
  });

  it("subida válida se recupera, no crea evidencia, no se duplica y se puede borrar", async () => {
    const { event, team } = await setup();
    const { id } = await uploadArtifact(db, event.id, team.id, { data: PNG, contentType: "Image/PNG" }, null);

    const file = await getArtifactFile(db, id);
    expect(file).toEqual({ eventId: event.id, teamId: team.id, contentType: "image/png", data: PNG });
    expect(await total(s.evidenceItems)).toBe(0);

    // Reintento con la misma foto: devuelve la existente.
    const again = await uploadArtifact(db, event.id, team.id, { data: PNG, contentType: "image/png" }, null);
    expect(again.id).toBe(id);
    expect(await total(s.artifactBlobs)).toBe(1);

    // Límite exacto permitido.
    const big = await uploadArtifact(
      db,
      event.id,
      team.id,
      { data: Buffer.alloc(MAX_ARTIFACT_BYTES, 7), contentType: "image/jpeg" },
      null,
    );
    expect(big.id).not.toBe(id);
    await deleteArtifact(db, event.id, big.id);

    await deleteArtifact(db, event.id, id);
    expect(await getArtifactFile(db, id)).toBeNull();
    expect(await total(s.artifactBlobs)).toBe(0);
    const [rows] = await db.select({ n: count() }).from(s.artifacts);
    expect(Number(rows.n)).toBe(0);
    await deleteArtifact(db, event.id, id); // idempotente
  });

  it("subir una foto mientras se borra el equipo → TEAM_NOT_FOUND (no un error de base)", async () => {
    const { event, challenge } = await setup();
    const [empty] = await db
      .insert(s.teams)
      .values({ eventId: event.id, challengeId: challenge.id, teamNumber: 9, tableNumber: 9, publishedAt: NOW })
      .returning();
    const other = secondTestDb();
    try {
      // Un staff borra el equipo vacío (lock del evento + DELETE, como deleteTeam) sin confirmar todavía.
      const { pending } = await other.db.transaction(async (tx) => {
        await lockEvent(tx, event.id);
        await tx.delete(s.teams).where(eq(s.teams.id, empty.id));
        const pending = uploadArtifact(db, event.id, empty.id, { data: PNG, contentType: "image/png" }, null).then(
          () => null,
          (err: unknown) => err,
        );
        expect(await waitForLockWaiters(1)).toBe(true);
        return { pending };
      });
      const err = await pending;
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("TEAM_NOT_FOUND");
    } finally {
      await other.sql.end({ timeout: 5 });
    }
    expect(await total(s.artifactBlobs)).toBe(0);
  });

  it("equipo de otro evento → TEAM_NOT_FOUND; borrar con otro evento no borra", async () => {
    const { event, team } = await setup();
    const otherEvent = await makeEvent(db, { phase: "REFLECTION" });
    const err = await caught(uploadArtifact(db, otherEvent.id, team.id, { data: PNG, contentType: "image/png" }, null));
    expect(err.code).toBe("TEAM_NOT_FOUND");

    const { id } = await uploadArtifact(db, event.id, team.id, { data: PNG, contentType: "image/png" }, null);
    await deleteArtifact(db, otherEvent.id, id);
    expect(await getArtifactFile(db, id)).not.toBeNull();
  });
});

describe("getTeamDetail", () => {
  it("devuelve equipo, desafío, integrantes, fotos, evaluación, observaciones y equipos hermanos", async () => {
    const { event, challenge, team, sibling, otherTeam } = await setup();
    const a = await member(event.id, challenge.id, team.id, "Bruno", "DRIVE");
    const b = await member(event.id, challenge.id, team.id, "Ana", "EXPLORE");
    await reflect(event, a.id, ["CREATED_TEST"], "EXPERIMENTATION");
    await saveFounderAssessment(db, event.id, team.id, { ...NO_SCORES, testScore: 4, winner: true }, null);
    const { id: artifactId } = await uploadArtifact(
      db,
      event.id,
      team.id,
      { data: Buffer.from("foto"), contentType: "image/webp" },
      null,
    );
    const observationId = await addObservation(
      db,
      event.id,
      team.id,
      { participationId: b.id, capability: "COMMUNICATION", observerSource: "FACILITATOR_OBSERVATION", note: null },
      null,
    );

    const detail = await getTeamDetail(db, event.id, team.id);
    expect(detail).not.toBeNull();
    expect(detail?.team.id).toBe(team.id);
    expect(detail?.eventPhase).toBe("REFLECTION");
    expect(detail?.challenge).toEqual({
      id: challenge.id,
      startupName: challenge.startupName,
      title: challenge.title,
      brief: challenge.brief,
      prize: null,
    });
    expect(detail?.members.map((m) => [m.name, m.hasReflection, m.status])).toEqual([
      ["Ana", false, "EXPERIENCE_COMPLETED"],
      ["Bruno", true, "INTERPRETED"],
    ]);
    expect(detail?.members[1]).toMatchObject({ initialMode: "DRIVE", assignmentSource: "FIRST_CHOICE" });
    expect(detail?.artifacts).toEqual([
      { id: artifactId, contentType: "image/webp", sizeBytes: 4, createdAt: expect.any(Date) },
    ]);
    expect(detail?.assessment).toMatchObject({ testScore: 4, winner: true });
    expect(detail?.observations).toEqual([
      {
        id: observationId,
        participationId: b.id,
        name: "Ana",
        capability: "COMMUNICATION",
        observerSource: "FACILITATOR_OBSERVATION",
        note: null,
        createdAt: expect.any(Date),
      },
    ]);
    expect(detail?.siblings).toEqual([{ id: sibling.id, teamNumber: 2, tableNumber: 2 }]);
    expect(detail?.siblings.some((t) => t.id === otherTeam.id)).toBe(false);
  });

  it("equipo sin evaluación ni integrantes: assessment null y listas vacías", async () => {
    const { event, team, sibling } = await setup();
    const detail = await getTeamDetail(db, event.id, sibling.id);
    expect(detail).toMatchObject({ assessment: null, members: [], artifacts: [], observations: [] });
    expect(detail?.siblings.map((t) => t.id)).toEqual([team.id]);
  });

  it("null si el equipo no es del evento o el id no es válido", async () => {
    const { team } = await setup();
    const otherEvent = await makeEvent(db, { phase: "REFLECTION" });
    expect(await getTeamDetail(db, otherEvent.id, team.id)).toBeNull();
    expect(await getTeamDetail(db, otherEvent.id, "nope")).toBeNull();
  });
});

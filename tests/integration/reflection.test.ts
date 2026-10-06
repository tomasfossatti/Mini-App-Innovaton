import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { count, eq, inArray, sql } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import type { Capability, EventPhase, Mode, ParticipationStatus } from "@/lib/domain/constants";
import { evidenceFromObservation } from "@/lib/domain/evidence";
import type { QuestionKey } from "@/lib/domain/questionnaire";
import { DomainError } from "@/lib/services/errors";
import {
  finalizeAssessment,
  registerParticipant,
  saveChallengeChoices,
  savePreClarity,
  startParticipation,
} from "@/lib/services/participation";
import {
  getOutcome,
  insertEvidence,
  interpretParticipation,
  reinterpretTeam,
  submitReflection,
  type ReflectionInput,
} from "@/lib/services/reflection";
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

async function setup(phase: EventPhase = "REFLECTION") {
  const event = await makeEvent(db, { phase });
  const [challenge] = await makeChallenges(db, event.id, 1);
  const [team] = await db
    .insert(s.teams)
    .values({ eventId: event.id, challengeId: challenge.id, teamNumber: 1, tableNumber: 1, publishedAt: NOW })
    .returning();
  return { event, challenge, team };
}

async function member(
  eventId: string,
  challengeId: string,
  teamId: string | null,
  opts: { mode?: Mode | null; status?: ParticipationStatus } = {},
) {
  const { participation } = await makeRegistered(db, eventId, {
    firstChoiceId: challengeId,
    secondChoiceAny: true,
    checkedIn: true,
    mode: opts.mode,
  });
  const [updated] = await db
    .update(s.participations)
    .set({
      teamId,
      assignmentSource: teamId ? "FIRST_CHOICE" : null,
      status: opts.status ?? (teamId ? "EXPERIENCE_COMPLETED" : "CHECKED_IN"),
    })
    .where(eq(s.participations.id, participation.id))
    .returning();
  return updated;
}

function input(overrides: Partial<ReflectionInput> = {}): ReflectionInput {
  return {
    postClarity: 4,
    selectedActions: ["ASKED_QUESTIONS", "CREATED_TEST"],
    primaryContributionText: "Armé la primera prueba con el equipo",
    primaryCapability: "EXPERIMENTATION",
    perceivedValue: 5,
    initialModeUsefulness: 3,
    ...overrides,
  };
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

async function countRows(participationId: string) {
  const items = await db
    .select({ id: s.evidenceItems.id })
    .from(s.evidenceItems)
    .where(eq(s.evidenceItems.participationId, participationId));
  const ids = items.map((i) => i.id);
  const [signals] = ids.length
    ? await db.select({ n: count() }).from(s.capabilitySignals).where(inArray(s.capabilitySignals.evidenceItemId, ids))
    : [{ n: 0 }];
  const [refl] = await db
    .select({ n: count() })
    .from(s.reflections)
    .where(eq(s.reflections.participationId, participationId));
  const snapshots = await db
    .select({ id: s.interpretationSnapshots.id })
    .from(s.interpretationSnapshots)
    .where(eq(s.interpretationSnapshots.participationId, participationId));
  const [recs] = snapshots.length
    ? await db
        .select({ n: count() })
        .from(s.recommendations)
        .where(inArray(s.recommendations.interpretationId, snapshots.map((x) => x.id)))
    : [{ n: 0 }];
  return {
    reflections: Number(refl.n),
    evidence: items.length,
    signals: Number(signals.n),
    snapshots: snapshots.length,
    recommendations: Number(recs.n),
  };
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

async function statusOf(id: string) {
  const row = await db.query.participations.findFirst({ where: eq(s.participations.id, id) });
  return row?.status;
}

describe("submitReflection", () => {
  it("crea reflexión, evidencia, señales, snapshot y recomendación y deja INTERPRETED", async () => {
    const { event, challenge, team } = await setup();
    const p = await member(event.id, challenge.id, team.id, { mode: "EXPLORE" });

    const result = await submitReflection(
      db,
      event,
      p.id,
      input({
        selectedActions: ["CREATED_TEST", "ASKED_QUESTIONS", "CREATED_TEST"],
        primaryContributionText: "   Armé la primera prueba   ",
      }),
      NOW,
    );
    expect(result.alreadySubmitted).toBe(false);

    const reflection = await db.query.reflections.findFirst({
      where: eq(s.reflections.participationId, p.id),
    });
    expect(reflection).toMatchObject({
      postClarity: 4,
      perceivedValue: 5,
      initialModeUsefulness: 3,
      // Sin duplicados y en el orden de la pregunta.
      selectedActions: ["ASKED_QUESTIONS", "CREATED_TEST"],
      primaryContributionText: "Armé la primera prueba",
      primaryCapability: "EXPERIMENTATION",
    });
    expect(reflection?.createdAt.toISOString()).toBe(NOW.toISOString());

    const items = await db.query.evidenceItems.findMany({
      where: eq(s.evidenceItems.participationId, p.id),
    });
    // 2 acciones + aporte principal.
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item).toMatchObject({
        eventId: event.id,
        teamId: team.id,
        scope: "INDIVIDUAL",
        originRef: `reflection:${reflection?.id}`,
      });
    }
    expect(items.map((i) => [i.sourceType, i.rawCode, i.sourceWeight]).sort()).toEqual(
      [
        ["SELF_REFLECTION_PRIMARY", "EXPERIMENTATION", 1.5],
        ["SELF_REPORT_ACTION", "ASKED_QUESTIONS", 1],
        ["SELF_REPORT_ACTION", "CREATED_TEST", 1],
      ].sort(),
    );
    expect(items.find((i) => i.sourceType === "SELF_REFLECTION_PRIMARY")?.rawText).toBe(
      "Armé la primera prueba",
    );

    // ASKED_QUESTIONS (2 señales) + CREATED_TEST (1) + primaria (1).
    expect(await countRows(p.id)).toEqual({
      reflections: 1,
      evidence: 3,
      signals: 4,
      snapshots: 1,
      recommendations: 1,
    });

    const snapshot = await db.query.interpretationSnapshots.findFirst({
      where: eq(s.interpretationSnapshots.participationId, p.id),
    });
    expect(snapshot?.id).toBe(result.interpretationId);
    expect(snapshot?.algorithmVersion).toBe("innovaton-v1");
    expect(snapshot?.primaryCapability).toBe("EXPERIMENTATION");
    const details = snapshot?.evidenceSnapshot as {
      scores: Record<Capability, { self: number; level: string }>;
      evidenceItemIds: string[];
      counts: { individual: number; team: number };
      primaryLevel: string | null;
      signalsText: string | null;
    };
    expect(details.counts).toEqual({ individual: 3, team: 0 });
    expect([...details.evidenceItemIds].sort()).toEqual(items.map((i) => i.id).sort());
    // Self tope 2 (1 + 1.5 → 2): una sola experiencia autodeclarada es SIGNAL.
    expect(details.scores.EXPERIMENTATION.self).toBe(2);
    expect(details.scores.EXPERIMENTATION.level).toBe("SIGNAL");
    expect(details.scores.IDEATION.level).toBe("INSUFFICIENT");
    expect(details.primaryLevel).toBe("SIGNAL");
    expect(details.signalsText).toEqual(expect.any(String));

    const rec = await db.query.recommendations.findFirst({
      where: eq(s.recommendations.interpretationId, result.interpretationId),
    });
    expect(rec?.type).toBe("GATHER_MORE_EVIDENCE");
    expect(rec?.capability).toBe("EXPERIMENTATION");

    expect(await statusOf(p.id)).toBe("INTERPRETED");
  });

  it("también acepta personas MATCHED (fase CLOSED)", async () => {
    const { event, challenge, team } = await setup("CLOSED");
    const p = await member(event.id, challenge.id, team.id, { status: "MATCHED" });
    const result = await submitReflection(db, event, p.id, input(), NOW);
    expect(result.alreadySubmitted).toBe(false);
    expect(await statusOf(p.id)).toBe("INTERPRETED");
  });

  it("doble submit secuencial: un solo set de filas y alreadySubmitted", async () => {
    const { event, challenge, team } = await setup();
    const p = await member(event.id, challenge.id, team.id);

    const first = await submitReflection(db, event, p.id, input(), NOW);
    const before = await countRows(p.id);
    const second = await submitReflection(
      db,
      event,
      p.id,
      input({ selectedActions: ["PRESENTED"], primaryCapability: "COMMUNICATION" }),
      NOW,
    );

    expect(second).toEqual({ alreadySubmitted: true, interpretationId: first.interpretationId });
    expect(await countRows(p.id)).toEqual(before);
    const reflection = await db.query.reflections.findFirst({
      where: eq(s.reflections.participationId, p.id),
    });
    expect(reflection?.primaryCapability).toBe("EXPERIMENTATION");
  });

  it("doble submit simultáneo (dos conexiones): un solo set de filas", async () => {
    const { event, challenge, team } = await setup();
    const p = await member(event.id, challenge.id, team.id);
    const other = secondTestDb();
    try {
      const results = await Promise.all([
        submitReflection(db, event, p.id, input(), NOW),
        submitReflection(other.db, event, p.id, input(), NOW),
        submitReflection(db, event, p.id, input(), NOW),
      ]);
      expect(results.filter((r) => !r.alreadySubmitted)).toHaveLength(1);
      expect(new Set(results.map((r) => r.interpretationId)).size).toBe(1);
      expect(await countRows(p.id)).toEqual({
        reflections: 1,
        evidence: 3,
        signals: 4,
        snapshots: 1,
        recommendations: 1,
      });
      expect(await statusOf(p.id)).toBe("INTERPRETED");
    } finally {
      await other.sql.end({ timeout: 5 });
    }
  });

  it("fuera de fase de reflexión → REFLECTION_CLOSED", async () => {
    const { event, challenge, team } = await setup("SPRINT");
    const p = await member(event.id, challenge.id, team.id, { status: "MATCHED" });
    const err = await caught(submitReflection(db, event, p.id, input(), NOW));
    expect(err.code).toBe("REFLECTION_CLOSED");
    expect(err.message).toBe("La reflexión todavía no está abierta. Te avisamos al terminar los pitches.");
    expect(await countRows(p.id)).toMatchObject({ reflections: 0, evidence: 0, snapshots: 0 });
  });

  it("sin equipo → NO_TEAM", async () => {
    const { event, challenge } = await setup();
    const p = await member(event.id, challenge.id, null);
    const err = await caught(submitReflection(db, event, p.id, input(), NOW));
    expect(err.code).toBe("NO_TEAM");
    expect(err.message).toBe("La reflexión es para quienes participaron en un equipo.");
    expect(await countRows(p.id)).toMatchObject({ reflections: 0, evidence: 0, snapshots: 0 });
  });

  it("participación de otro evento → NOT_FOUND", async () => {
    const { event, challenge, team } = await setup();
    const p = await member(event.id, challenge.id, team.id);
    const otherEvent = await makeEvent(db, { phase: "REFLECTION" });
    const err = await caught(submitReflection(db, otherEvent, p.id, input(), NOW));
    expect(err.code).toBe("NOT_FOUND");
  });

  it.each<[string, Partial<ReflectionInput>]>([
    ["claridad fuera de escala", { postClarity: 0 }],
    ["valor no entero", { perceivedValue: 3.5 }],
    ["utilidad fuera de escala", { initialModeUsefulness: 6 }],
    ["sin acciones", { selectedActions: [] }],
    ["acción desconocida", { selectedActions: ["HACKED" as never] }],
    ["texto largo", { primaryContributionText: "a".repeat(501) }],
    ["capacidad inválida", { primaryCapability: "MAGIC" as never }],
  ])("valida la entrada: %s → INVALID_REFLECTION", async (_name, override) => {
    const { event, challenge, team } = await setup();
    const p = await member(event.id, challenge.id, team.id);
    const err = await caught(submitReflection(db, event, p.id, input(override), NOW));
    expect(err.code).toBe("INVALID_REFLECTION");
    expect(await countRows(p.id)).toMatchObject({ reflections: 0, evidence: 0 });
  });

  it("cada señal queda atada a su item de evidencia", async () => {
    const { event, challenge, team } = await setup();
    const p = await member(event.id, challenge.id, team.id);
    await submitReflection(
      db,
      event,
      p.id,
      input({
        selectedActions: ["PRESENTED", "ORGANIZED_TEAM", "ASKED_QUESTIONS", "OTHER", "CONNECTED_IDEAS"],
        primaryCapability: "PRIORITIZATION",
      }),
      NOW,
    );
    const items = await db.query.evidenceItems.findMany({ where: eq(s.evidenceItems.participationId, p.id) });
    const signals = await db.query.capabilitySignals.findMany({
      where: inArray(
        s.capabilitySignals.evidenceItemId,
        items.map((i) => i.id),
      ),
    });
    const byItem = Object.fromEntries(
      items.map((i) => [
        `${i.sourceType}:${i.rawCode}`,
        signals
          .filter((x) => x.evidenceItemId === i.id)
          .map((x) => `${x.capability}=${x.strength}`)
          .sort(),
      ]),
    );
    expect(byItem).toEqual({
      "SELF_REPORT_ACTION:ASKED_QUESTIONS": ["ASSUMPTION_QUESTIONING=0.5", "PROBLEM_UNDERSTANDING=1"],
      "SELF_REPORT_ACTION:CONNECTED_IDEAS": ["COMMUNICATION=0.25", "IDEATION=0.75"],
      "SELF_REPORT_ACTION:ORGANIZED_TEAM": ["COMMUNICATION=0.5", "PRIORITIZATION=0.75"],
      "SELF_REPORT_ACTION:PRESENTED": ["COMMUNICATION=1"],
      // OTHER queda registrada sin señales.
      "SELF_REPORT_ACTION:OTHER": [],
      "SELF_REFLECTION_PRIMARY:PRIORITIZATION": ["PRIORITIZATION=1"],
    });
  });

  it.each<[string, ParticipationStatus]>([
    ["presente en un equipo sin publicar", "CHECKED_IN"],
    ["marcada como ausente", "NO_SHOW"],
  ])("con equipo pero sin experiencia (%s) → NO_TEAM", async (_name, status) => {
    const { event, challenge, team } = await setup();
    const p = await member(event.id, challenge.id, team.id, { status });
    const err = await caught(submitReflection(db, event, p.id, input(), NOW));
    expect(err.code).toBe("NO_TEAM");
    expect(await countRows(p.id)).toMatchObject({ reflections: 0, evidence: 0, snapshots: 0 });
    expect(await statusOf(p.id)).toBe(status);
  });

  it("si la movieron de equipo entre la lectura y el lock → RETRY sin crear nada; al reintentar funciona", async () => {
    const { event, challenge, team } = await setup();
    const [teamB] = await db
      .insert(s.teams)
      .values({ eventId: event.id, challengeId: challenge.id, teamNumber: 2, tableNumber: 2, publishedAt: NOW })
      .returning();
    const p = await member(event.id, challenge.id, team.id);
    const other = secondTestDb();
    try {
      // Un staff la mueve (transacción abierta, fila bloqueada) mientras ella envía la reflexión.
      const { pending } = await other.db.transaction(async (tx) => {
        await tx.update(s.participations).set({ teamId: teamB.id }).where(eq(s.participations.id, p.id));
        const pending = submitReflection(db, event, p.id, input(), NOW).then(
          () => null,
          (err: unknown) => err,
        );
        expect(await waitForLockWaiters(1)).toBe(true);
        return { pending };
      });
      const err = await pending;
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("RETRY");
    } finally {
      await other.sql.end({ timeout: 5 });
    }
    expect(await countRows(p.id)).toMatchObject({ reflections: 0, evidence: 0, snapshots: 0 });

    const retry = await submitReflection(db, event, p.id, input(), NOW);
    expect(retry.alreadySubmitted).toBe(false);
    const items = await db.query.evidenceItems.findMany({ where: eq(s.evidenceItems.participationId, p.id) });
    expect(new Set(items.map((i) => i.teamId))).toEqual(new Set([teamB.id]));
  });

  it("texto vacío o con espacios se guarda como null; 500 caracteres es válido", async () => {
    const { event, challenge, team } = await setup();
    const a = await member(event.id, challenge.id, team.id);
    const b = await member(event.id, challenge.id, team.id);
    await submitReflection(db, event, a.id, input({ primaryContributionText: "   " }), NOW);
    await submitReflection(db, event, b.id, input({ primaryContributionText: "x".repeat(500) }), NOW);
    const ra = await db.query.reflections.findFirst({ where: eq(s.reflections.participationId, a.id) });
    const rb = await db.query.reflections.findFirst({ where: eq(s.reflections.participationId, b.id) });
    expect(ra?.primaryContributionText).toBeNull();
    expect(rb?.primaryContributionText).toHaveLength(500);
  });
});

describe("reflexión en papel con el modo del cuestionario en papel", () => {
  async function latestSnapshot(participationId: string) {
    const rows = await db
      .select()
      .from(s.interpretationSnapshots)
      .where(eq(s.interpretationSnapshots.participationId, participationId));
    return rows.at(-1)!;
  }

  it("completa un modo vacío antes de interpretar, sin sumar evidencia ni pisar un modo existente", async () => {
    const { event, challenge, team } = await setup();
    const sinModo = await member(event.id, challenge.id, team.id, { mode: null });
    const enPapel = await member(event.id, challenge.id, team.id, { mode: null });
    const delCelular = await member(event.id, challenge.id, team.id, { mode: "EXPLORE" });
    const conModo = await member(event.id, challenge.id, team.id, { mode: "DRIVE" });

    await submitReflection(db, event, sinModo.id, input(), NOW);
    await submitReflection(db, event, enPapel.id, input(), NOW, { initialMode: "EXPLORE" });
    await submitReflection(db, event, delCelular.id, input(), NOW);
    await submitReflection(db, event, conModo.id, input(), NOW, { initialMode: "EXPLORE" });

    const reload = (id: string) => db.query.participations.findFirst({ where: eq(s.participations.id, id) });
    expect((await reload(enPapel.id))?.initialMode).toBe("EXPLORE");
    expect((await reload(conModo.id))?.initialMode).toBe("DRIVE");
    expect((await reload(sinModo.id))?.initialMode).toBeNull();

    // La hipótesis no es evidencia: mismas filas que sin modo.
    expect(await countRows(enPapel.id)).toEqual(await countRows(sinModo.id));
    // Se interpreta igual que quien hizo el cuestionario en el celular con ese modo.
    const paper = await latestSnapshot(enPapel.id);
    const phone = await latestSnapshot(delCelular.id);
    expect(paper.type).toBe(phone.type);
    expect(paper.summary).toBe(phone.summary);

    // Si la reflexión ya existía, el modo no se toca.
    const again = await submitReflection(db, event, sinModo.id, input(), NOW, { initialMode: "CREATE" });
    expect(again.alreadySubmitted).toBe(true);
    expect((await reload(sinModo.id))?.initialMode).toBeNull();
  });
});

describe("el cuestionario no es evidencia", () => {
  it("quien completó el cuestionario y se inscribió, sin hacer nada más, tiene 0 evidence_items", async () => {
    const event = await makeEvent(db, { phase: "REGISTRATION" });
    const [c1, c2] = await makeChallenges(db, event.id, 2);
    const answers: Record<QuestionKey, Mode> = {
      Q1: "DRIVE",
      Q2: "DRIVE",
      Q3: "DRIVE",
      Q4: "EXPLORE",
      Q5: "CREATE",
    };
    const { participation } = await startParticipation(db, event);
    await savePreClarity(db, participation, 3);
    const outcome = await finalizeAssessment(db, participation, answers);
    expect(outcome).toEqual({ kind: "RESOLVED", mode: "DRIVE" });
    const withMode = await db.query.participations.findFirst({
      where: eq(s.participations.id, participation.id),
    });
    await saveChallengeChoices(db, event, withMode!, {
      firstChoiceId: c1.id,
      secondChoiceId: c2.id,
      secondChoiceAny: false,
    });
    const ready = await db.query.participations.findFirst({
      where: eq(s.participations.id, participation.id),
    });
    const reg = await registerParticipant(db, event, ready!, {
      name: "Ana Cuestionario",
      whatsapp: "351 555 1234",
      operationalConsent: true,
      communityConsent: false,
    });
    expect(reg.participation.status).toBe("REGISTERED");
    expect(reg.participation.initialMode).toBe("DRIVE");

    const [answersCount] = await db
      .select({ n: count() })
      .from(s.questionnaireAnswers)
      .where(eq(s.questionnaireAnswers.participationId, participation.id));
    expect(Number(answersCount.n)).toBeGreaterThan(0);

    const [all] = await db.select({ n: count() }).from(s.evidenceItems);
    expect(Number(all.n)).toBe(0);
    const [signals] = await db.select({ n: count() }).from(s.capabilitySignals);
    expect(Number(signals.n)).toBe(0);

    // Aun interpretando, sin experiencia no hay señales: INSUFFICIENT y nunca "debilidad".
    const snapshotId = await interpretParticipation(db, participation.id);
    const snapshot = await db.query.interpretationSnapshots.findFirst({
      where: eq(s.interpretationSnapshots.id, snapshotId),
    });
    expect(snapshot?.type).toBe("INSUFFICIENT");
    expect(snapshot?.primaryCapability).toBeNull();
    expect((snapshot?.evidenceSnapshot as { counts: unknown }).counts).toEqual({ individual: 0, team: 0 });
    const rec = await db.query.recommendations.findFirst({
      where: eq(s.recommendations.interpretationId, snapshotId),
    });
    // Sin evidencia: experimento según el modo inicial (DRIVE → experimentación).
    expect(rec?.type).toBe("GATHER_MORE_EVIDENCE");
    expect(rec?.capability).toBe("EXPERIMENTATION");

    // Sin reflexión no hay resultado final.
    expect(await getOutcome(db, participation.id)).toBeNull();
  });
});

describe("getOutcome", () => {
  it("null antes de reflexionar", async () => {
    const { event, challenge, team } = await setup();
    const p = await member(event.id, challenge.id, team.id);
    expect(await getOutcome(db, p.id)).toBeNull();
    expect(await getOutcome(db, "no-es-uuid")).toBeNull();
  });

  it("devuelve el último snapshot", async () => {
    const { event, challenge, team } = await setup();
    const p = await member(event.id, challenge.id, team.id, { mode: "EXPLORE" });
    const first = await submitReflection(
      db,
      event,
      p.id,
      input({ selectedActions: ["ASKED_QUESTIONS", "OTHER"], primaryCapability: "PROBLEM_UNDERSTANDING" }),
      NOW,
    );

    const initial = await getOutcome(db, p.id);
    expect(initial).toMatchObject({
      initialMode: "EXPLORE",
      reflection: {
        selectedActions: ["ASKED_QUESTIONS", "OTHER"],
        primaryCapability: "PROBLEM_UNDERSTANDING",
      },
      interpretation: { id: first.interpretationId, type: "ALIGNED", primary: "PROBLEM_UNDERSTANDING" },
      communityCtaDone: false,
    });

    // Aparece evidencia nueva (observación externa fuerte de ideación) y se re-interpreta.
    await insertEvidence(
      db,
      { eventId: event.id, participationId: p.id, teamId: team.id, originRef: "observation:test" },
      [evidenceFromObservation({ capability: "IDEATION", observerSource: "FOUNDER_INDIVIDUAL" })],
    );
    const secondId = await interpretParticipation(db, p.id);
    expect(secondId).not.toBe(first.interpretationId);

    const latest = await getOutcome(db, p.id);
    expect(latest?.interpretation.id).toBe(secondId);
    expect(latest?.interpretation.primary).toBe("IDEATION");
    expect(latest?.interpretation.primaryLevel).toBe("CONVERGENT");
    expect(latest?.interpretation.summary).toEqual(expect.any(String));
    expect(latest?.recommendation.action).toEqual(expect.any(String));
    expect(latest?.recommendation.rationale).toEqual(expect.any(String));
    // interpretParticipation no cambia el status.
    expect(await statusOf(p.id)).toBe("INTERPRETED");

    await db.update(s.participations).set({ communityCtaAt: NOW }).where(eq(s.participations.id, p.id));
    expect((await getOutcome(db, p.id))?.communityCtaDone).toBe(true);
  });
});

describe("ids inválidos", () => {
  it("interpretParticipation → NOT_FOUND (DomainError); reinterpretTeam → 0", async () => {
    expect((await caught(interpretParticipation(db, "no-es-uuid"))).code).toBe("NOT_FOUND");
    expect((await caught(interpretParticipation(db, "00000000-0000-4000-8000-000000000000"))).code).toBe(
      "NOT_FOUND",
    );
    expect(await reinterpretTeam(db, "no-es-uuid")).toBe(0);
  });
});

describe("reinterpretTeam", () => {
  it("re-interpreta solo a quienes ya reflexionaron", async () => {
    const { event, challenge, team } = await setup();
    const a = await member(event.id, challenge.id, team.id);
    const b = await member(event.id, challenge.id, team.id);
    await submitReflection(db, event, a.id, input(), NOW);

    expect(await reinterpretTeam(db, team.id)).toBe(1);
    expect((await countRows(a.id)).snapshots).toBe(2);
    expect((await countRows(b.id)).snapshots).toBe(0);
  });
});

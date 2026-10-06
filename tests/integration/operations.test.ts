import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import type { InterpretationType } from "@/lib/domain/constants";
import { WHATSAPP_REMINDER } from "@/lib/domain/copy";
import { generateToken, sha256 } from "@/lib/auth/crypto";
import { DomainError } from "@/lib/services/errors";
import {
  getDashboard,
  manualCheckIn,
  staffQuickAdd,
  undoCheckIn,
  whatsappReminderText,
} from "@/lib/services/operations";
import { publishTeams } from "@/lib/services/teams";
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
const NOW = new Date("2026-10-15T17:21:00.000Z"); // 14:21 en Córdoba

beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function reload(id: string) {
  const row = await db.query.participations.findFirst({ where: eq(s.participations.id, id) });
  if (!row) throw new Error("missing participation");
  return row;
}

async function expectDomainError(promise: Promise<unknown>, code: string, message?: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  if (message) expect((err as DomainError).message).toBe(message);
}

/** Participation sin persona asociada (recorrido iniciado, sin inscripción). */
async function makeAnonymous(
  eventId: string,
  opts: { status: "STARTED" | "PROFILE_COMPLETED"; preClarity?: number | null; mode?: "CREATE" | null },
) {
  const [row] = await db
    .insert(s.participations)
    .values({
      eventId,
      resumeTokenHash: sha256(generateToken()),
      status: opts.status,
      preClarity: opts.preClarity ?? null,
      initialMode: opts.mode ?? null,
    })
    .returning();
  return row;
}

async function makeTeam(
  eventId: string,
  challengeId: string,
  teamNumber: number,
  tableNumber: number,
  published: boolean,
) {
  const [team] = await db
    .insert(s.teams)
    .values({ eventId, challengeId, teamNumber, tableNumber, publishedAt: published ? NOW : null })
    .returning();
  return team;
}

async function assignTeam(participationId: string, teamId: string, status: "MATCHED" | "CHECKED_IN") {
  await db
    .update(s.participations)
    .set({ teamId, status, assignmentSource: "FIRST_CHOICE" })
    .where(eq(s.participations.id, participationId));
}

async function addReflection(
  participationId: string,
  values: { postClarity: number; perceivedValue: number; initialModeUsefulness: number },
) {
  await db.insert(s.reflections).values({
    participationId,
    ...values,
    selectedActions: ["ASKED_QUESTIONS"],
    primaryCapability: "PROBLEM_UNDERSTANDING",
  });
  await db
    .update(s.participations)
    .set({ status: "REFLECTION_COMPLETED" })
    .where(eq(s.participations.id, participationId));
}

async function addInterpretation(participationId: string, type: InterpretationType, createdAt: Date) {
  await db.insert(s.interpretationSnapshots).values({
    participationId,
    algorithmVersion: "test",
    type,
    summary: "resumen",
    evidenceSnapshot: {},
    createdAt,
  });
}

describe("getDashboard", () => {
  it("cuenta estados, desafíos, personas y métricas con una mezcla realista", async () => {
    const event = await makeEvent(db, { phase: "SPRINT" });
    const [a, b, c, d, e] = await makeChallenges(db, event.id, 5);
    await db.update(s.challenges).set({ active: false }).where(eq(s.challenges.id, d.id));
    await db.update(s.challenges).set({ active: false }).where(eq(s.challenges.id, e.id));

    // Recorridos sin inscripción.
    await makeAnonymous(event.id, { status: "STARTED", preClarity: 2 });
    await makeAnonymous(event.id, { status: "PROFILE_COMPLETED", preClarity: 4, mode: "CREATE" });

    // Inscriptos (preClarity 3 en todos).
    await makeRegistered(db, event.id, {
      name: "Zoe",
      firstChoiceId: a.id,
      secondChoiceId: b.id,
    });
    const ana = await makeRegistered(db, event.id, {
      name: "Ana",
      firstChoiceId: a.id,
      secondChoiceAny: true,
      mode: "DRIVE",
      checkedIn: true,
    });
    const bruno = await makeRegistered(db, event.id, {
      name: "Bruno",
      firstChoiceId: b.id,
      secondChoiceId: d.id, // desafío luego desactivado
      mode: "CREATE",
      checkedIn: true,
    });
    const carla = await makeRegistered(db, event.id, {
      name: "Carla",
      firstChoiceId: b.id,
      secondChoiceId: a.id,
    });
    await db
      .update(s.participations)
      .set({ status: "NO_SHOW" })
      .where(eq(s.participations.id, carla.participation.id));
    const diego = await staffQuickAdd(
      db,
      event,
      { name: "Diego", whatsapp: "+5493517654321", firstChoiceId: a.id, secondChoiceId: null, secondChoiceAny: true },
      NOW,
    );

    const t1 = await makeTeam(event.id, a.id, 1, 1, true);
    const t2 = await makeTeam(event.id, b.id, 1, 2, true);
    await makeTeam(event.id, a.id, 2, 3, true);
    await assignTeam(ana.participation.id, t1.id, "MATCHED");
    await assignTeam(bruno.participation.id, t2.id, "MATCHED");

    await addReflection(ana.participation.id, { postClarity: 5, perceivedValue: 4, initialModeUsefulness: 3 });
    await addReflection(bruno.participation.id, { postClarity: 4, perceivedValue: 5, initialModeUsefulness: 5 });
    await db
      .update(s.participations)
      .set({ communityCtaAt: NOW, communityConsentAt: NOW })
      .where(eq(s.participations.id, ana.participation.id));

    await db.insert(s.evidenceItems).values(
      [ana, ana, bruno].map((p, i) => ({
        eventId: event.id,
        participationId: p.participation.id,
        sourceType: "SELF_REPORT_ACTION" as const,
        scope: "INDIVIDUAL" as const,
        rawCode: "ASKED_QUESTIONS",
        sourceWeight: 1,
        originRef: `test:${i}`,
      })),
    );
    await addInterpretation(ana.participation.id, "INSUFFICIENT", new Date("2026-10-15T18:30:00Z"));
    await addInterpretation(ana.participation.id, "ALIGNED", new Date("2026-10-15T18:31:00Z"));
    await addInterpretation(bruno.participation.id, "INSUFFICIENT", new Date("2026-10-15T18:30:00Z"));

    // Ruido de otro evento: no tiene que contar.
    const other = await makeEvent(db);
    const [otherChallenge] = await makeChallenges(db, other.id, 1);
    await makeRegistered(db, other.id, { firstChoiceId: otherChallenge.id, secondChoiceAny: true, checkedIn: true });

    const dash = await getDashboard(db, event.id);

    expect(dash.event.id).toBe(event.id);
    expect(dash.teamsPublished).toBe(true);
    expect(dash.counts).toEqual({
      started: 7,
      profileCompleted: 5,
      registered: 5,
      present: 3,
      matched: 2,
      teams: 3,
      reflections: 2,
      communityCta: 1,
    });

    expect(dash.byChallenge.map((x) => x.challengeId)).toEqual([a.id, b.id, c.id, d.id]);
    const byId = new Map(dash.byChallenge.map((x) => [x.challengeId, x]));
    expect(byId.get(a.id)).toMatchObject({
      startupName: a.startupName,
      title: a.title,
      active: true,
      firstChoice: 3,
      secondChoice: 1,
      present: 2,
      teams: 2,
      assigned: 1,
    });
    expect(byId.get(b.id)).toMatchObject({ firstChoice: 2, secondChoice: 1, present: 1, teams: 1, assigned: 1 });
    expect(byId.get(c.id)).toMatchObject({ active: true, firstChoice: 0, secondChoice: 0, present: 0, teams: 0, assigned: 0 });
    expect(byId.get(d.id)).toMatchObject({ active: false, firstChoice: 0, secondChoice: 1 });
    expect(byId.has(e.id)).toBe(false);

    expect(dash.people.map((p) => p.name)).toEqual(["Ana", "Bruno", "Carla", "Diego", "Zoe"]);
    const people = new Map(dash.people.map((p) => [p.name, p]));
    expect(people.get("Ana")).toEqual({
      participationId: ana.participation.id,
      name: "Ana",
      whatsapp: ana.participant.whatsappNormalized,
      waNumber: ana.participant.whatsappNormalized.slice(1),
      status: "REFLECTION_COMPLETED",
      initialMode: "DRIVE",
      firstChoice: a.startupName,
      secondChoice: "Cualquiera",
      checkedInAt: expect.any(Date),
      team: { teamNumber: 1, tableNumber: 1, startupName: a.startupName, published: true },
      addedByStaff: false,
      operationalConsent: true,
      communityConsent: true,
      hasReflection: true,
    });
    expect(people.get("Zoe")).toMatchObject({
      status: "REGISTERED",
      firstChoice: a.startupName,
      secondChoice: b.startupName,
      checkedInAt: null,
      team: null,
      hasReflection: false,
      communityConsent: false,
    });
    expect(people.get("Bruno")?.secondChoice).toBe(d.startupName);
    expect(people.get("Carla")?.status).toBe("NO_SHOW");
    expect(people.get("Diego")).toMatchObject({
      participationId: diego.participationId,
      whatsapp: "+5493517654321",
      waNumber: "5493517654321",
      status: "CHECKED_IN",
      initialMode: null,
      addedByStaff: true,
      operationalConsent: true,
      checkedInAt: NOW,
    });

    const { funnel, rates, educai } = dash.metrics;
    expect(funnel).toEqual({
      started: 7,
      profileCompleted: 5,
      registered: 5,
      checkedIn: 3,
      matched: 2,
      reflections: 2,
      communityCta: 1,
    });
    // El alta de staff (Diego) no hizo el cuestionario: no cuenta en el denominador.
    expect(rates.questionnaireCompletion).toBeCloseTo(5 / 6);
    expect(rates.registration).toBeCloseTo(4 / 5); // sin el alta de staff
    expect(rates.registrationToCheckin).toBeCloseTo(3 / 5);
    expect(rates.checkinToCompletion).toBeCloseTo(2 / 3);
    expect(rates.reflectionCompletion).toBe(1);
    expect(rates.communityConversion).toBe(0.5);

    expect(educai.avgPreClarity).toBeCloseTo(3); // (2 + 4 + 3·4) / 6
    expect(educai.avgPostClarity).toBeCloseTo(4.5);
    expect(educai.avgDeltaClarity).toBeCloseTo(1.5);
    expect(educai.avgInitialModeUsefulness).toBeCloseTo(4);
    expect(educai.avgPerceivedValue).toBeCloseTo(4.5);
    expect(educai.evidenceItems).toBe(3);
    expect(educai.interpreted).toBe(2);
    expect(educai.sufficientInterpretationRate).toBe(0.5);
    expect(educai.interpretationTypes).toEqual({ INSUFFICIENT: 1, ALIGNED: 1, DIVERGENT: 0, MIXED: 0 });
  });

  it("con el evento vacío devuelve ceros y tasas null", async () => {
    const event = await makeEvent(db);
    await makeChallenges(db, event.id, 2);
    const dash = await getDashboard(db, event.id);

    expect(dash.teamsPublished).toBe(false);
    expect(dash.people).toEqual([]);
    expect(dash.byChallenge).toHaveLength(2);
    expect(Object.values(dash.counts).every((n) => n === 0)).toBe(true);
    expect(Object.values(dash.metrics.rates).every((r) => r === null)).toBe(true);
    expect(dash.metrics.educai).toEqual({
      avgPreClarity: null,
      avgPostClarity: null,
      avgDeltaClarity: null,
      avgInitialModeUsefulness: null,
      avgPerceivedValue: null,
      evidenceItems: 0,
      interpreted: 0,
      sufficientInterpretationRate: null,
      interpretationTypes: { INSUFFICIENT: 0, ALIGNED: 0, DIVERGENT: 0, MIXED: 0 },
    });
  });

  it("con equipos en borrador: matched 0 y el equipo figura sin publicar", async () => {
    const event = await makeEvent(db, { phase: "MATCHING" });
    const [a] = await makeChallenges(db, event.id, 1);
    const p = await makeRegistered(db, event.id, { firstChoiceId: a.id, secondChoiceAny: true, checkedIn: true });
    const team = await makeTeam(event.id, a.id, 1, 1, false);
    await assignTeam(p.participation.id, team.id, "CHECKED_IN");

    const dash = await getDashboard(db, event.id);
    expect(dash.teamsPublished).toBe(false);
    expect(dash.counts.matched).toBe(0);
    expect(dash.counts.teams).toBe(1);
    expect(dash.byChallenge[0]).toMatchObject({ teams: 1, assigned: 1, present: 1 });
    expect(dash.people[0].team).toEqual({
      teamNumber: 1,
      tableNumber: 1,
      startupName: a.startupName,
      published: false,
    });
    // Solo hubo presentes: tasas con denominador 0 siguen en null.
    expect(dash.metrics.rates.reflectionCompletion).toBeNull();
    expect(dash.metrics.rates.checkinToCompletion).toBe(0);
  });

  it("evento inexistente → EVENT_NOT_FOUND", async () => {
    await expectDomainError(getDashboard(db, "no-es-un-uuid"), "EVENT_NOT_FOUND");
    await expectDomainError(
      getDashboard(db, "00000000-0000-0000-0000-000000000000"),
      "EVENT_NOT_FOUND",
    );
  });

  it("solo altas de staff: las tasas del recorrido propio quedan en null", async () => {
    const event = await makeEvent(db, { phase: "CHECKIN" });
    const [a] = await makeChallenges(db, event.id, 1);
    await staffQuickAdd(
      db,
      event,
      { name: "Papel", whatsapp: "+5493517000001", firstChoiceId: a.id, secondChoiceId: null, secondChoiceAny: true },
      NOW,
    );
    const dash = await getDashboard(db, event.id);
    expect(dash.counts).toMatchObject({ started: 1, profileCompleted: 0, registered: 1, present: 1 });
    expect(dash.metrics.rates.questionnaireCompletion).toBeNull();
    expect(dash.metrics.rates.registration).toBeNull();
    expect(dash.metrics.rates.registrationToCheckin).toBe(1);
    expect(dash.byChallenge[0]).toMatchObject({ firstChoice: 1, present: 1, secondChoice: 0 });
  });

  it("última interpretación por persona: desempata por id si coinciden las horas", async () => {
    const event = await makeEvent(db, { phase: "REFLECTION" });
    const [a] = await makeChallenges(db, event.id, 1);
    const p = await makeRegistered(db, event.id, { firstChoiceId: a.id, secondChoiceAny: true, checkedIn: true });
    const at = new Date("2026-10-15T18:30:00Z");
    await addInterpretation(p.participation.id, "ALIGNED", at);
    await addInterpretation(p.participation.id, "MIXED", at);
    const dash = await getDashboard(db, event.id);
    expect(dash.metrics.educai.interpreted).toBe(1);
    const total = Object.values(dash.metrics.educai.interpretationTypes).reduce((x, y) => x + y, 0);
    expect(total).toBe(1);
    expect(dash.metrics.educai.sufficientInterpretationRate).toBe(1);
  });
});

describe("manualCheckIn", () => {
  it("marca presente y es idempotente ante el doble tap", async () => {
    const event = await makeEvent(db, { phase: "CHECKIN" });
    const [a] = await makeChallenges(db, event.id, 1);
    const { participation } = await makeRegistered(db, event.id, { firstChoiceId: a.id, secondChoiceAny: true });

    expect(await manualCheckIn(db, event.id, participation.id, NOW)).toEqual({ alreadyPresent: false });
    let row = await reload(participation.id);
    expect(row.status).toBe("CHECKED_IN");
    expect(row.checkedInAt).toEqual(NOW);

    const later = new Date(NOW.getTime() + 60_000);
    expect(await manualCheckIn(db, event.id, participation.id, later)).toEqual({ alreadyPresent: true });
    row = await reload(participation.id);
    expect(row.checkedInAt).toEqual(NOW);
  });

  it("NO_SHOW pasa a presente", async () => {
    const event = await makeEvent(db, { phase: "SPRINT" });
    const [a] = await makeChallenges(db, event.id, 1);
    const { participation } = await makeRegistered(db, event.id, { firstChoiceId: a.id, secondChoiceAny: true });
    await db.update(s.participations).set({ status: "NO_SHOW" }).where(eq(s.participations.id, participation.id));

    expect(await manualCheckIn(db, event.id, participation.id, NOW)).toEqual({ alreadyPresent: false });
    const row = await reload(participation.id);
    expect(row.status).toBe("CHECKED_IN");
    expect(row.checkedInAt).toEqual(NOW);
  });

  it("con equipo asignado devuelve alreadyPresent sin tocar nada", async () => {
    const event = await makeEvent(db, { phase: "SPRINT" });
    const [a] = await makeChallenges(db, event.id, 1);
    const { participation } = await makeRegistered(db, event.id, {
      firstChoiceId: a.id,
      secondChoiceAny: true,
      checkedIn: true,
      checkedInAt: NOW,
    });
    const team = await makeTeam(event.id, a.id, 1, 1, true);
    await assignTeam(participation.id, team.id, "MATCHED");

    expect(await manualCheckIn(db, event.id, participation.id, new Date())).toEqual({ alreadyPresent: true });
    const row = await reload(participation.id);
    expect(row.status).toBe("MATCHED");
    expect(row.checkedInAt).toEqual(NOW);
  });

  it("STARTED o PROFILE_COMPLETED → NOT_REGISTERED", async () => {
    const event = await makeEvent(db, { phase: "CHECKIN" });
    const started = await makeAnonymous(event.id, { status: "STARTED" });
    const profile = await makeAnonymous(event.id, { status: "PROFILE_COMPLETED", mode: "CREATE" });
    await expectDomainError(
      manualCheckIn(db, event.id, started.id, NOW),
      "NOT_REGISTERED",
      "Esta persona no terminó la inscripción.",
    );
    await expectDomainError(manualCheckIn(db, event.id, profile.id, NOW), "NOT_REGISTERED");
    expect((await reload(started.id)).status).toBe("STARTED");
  });

  it("participation de otro evento o id inválido → NOT_FOUND", async () => {
    const event = await makeEvent(db);
    const other = await makeEvent(db);
    const [a] = await makeChallenges(db, other.id, 1);
    const { participation } = await makeRegistered(db, other.id, { firstChoiceId: a.id, secondChoiceAny: true });
    await expectDomainError(manualCheckIn(db, event.id, participation.id, NOW), "NOT_FOUND");
    await expectDomainError(manualCheckIn(db, event.id, "abc", NOW), "NOT_FOUND");
    expect((await reload(participation.id)).status).toBe("REGISTERED");
  });

  it("no asigna equipo ni toca equipos publicados (latecomer queda para el staff)", async () => {
    const event = await makeEvent(db, { phase: "SPRINT" });
    const [a] = await makeChallenges(db, event.id, 1);
    const team = await makeTeam(event.id, a.id, 1, 1, true);
    const { participation } = await makeRegistered(db, event.id, { firstChoiceId: a.id, secondChoiceAny: true });
    await db.update(s.participations).set({ status: "NO_SHOW" }).where(eq(s.participations.id, participation.id));

    await manualCheckIn(db, event.id, participation.id, NOW);
    const row = await reload(participation.id);
    expect(row).toMatchObject({ status: "CHECKED_IN", teamId: null, assignmentSource: null });
    const teamsAfter = await db.select().from(s.teams).where(eq(s.teams.eventId, event.id));
    expect(teamsAfter).toEqual([team]);
  });

  it("check-in mientras se publican los equipos: queda presente en cualquier orden", async () => {
    const event = await makeEvent(db, { phase: "MATCHING" });
    const [a] = await makeChallenges(db, event.id, 1);
    const present = await makeRegistered(db, event.id, { firstChoiceId: a.id, secondChoiceAny: true, checkedIn: true });
    const team = await makeTeam(event.id, a.id, 1, 1, false);
    await assignTeam(present.participation.id, team.id, "CHECKED_IN");
    const late = await makeRegistered(db, event.id, { firstChoiceId: a.id, secondChoiceAny: true });

    const second = secondTestDb();
    try {
      const [checkIn] = await Promise.all([
        manualCheckIn(second.db, event.id, late.participation.id, NOW),
        publishTeams(db, event.id, NOW),
      ]);
      expect(checkIn.alreadyPresent).toBe(false);
    } finally {
      await second.sql.end({ timeout: 5 });
    }
    // Si la publicación lo pasó a NO_SHOW antes, el check-in igual lo marca presente.
    expect(await reload(late.participation.id)).toMatchObject({
      status: "CHECKED_IN",
      checkedInAt: NOW,
      teamId: null,
    });
    expect((await reload(present.participation.id)).status).toBe("MATCHED");
  });

  it("dos staff a la vez: una marca, la otra ve alreadyPresent, sin errores", async () => {
    const event = await makeEvent(db, { phase: "CHECKIN" });
    const [a] = await makeChallenges(db, event.id, 1);
    const { participation } = await makeRegistered(db, event.id, { firstChoiceId: a.id, secondChoiceAny: true });
    const second = secondTestDb();
    try {
      const results = await Promise.all([
        manualCheckIn(db, event.id, participation.id, NOW),
        manualCheckIn(second.db, event.id, participation.id, NOW),
        manualCheckIn(db, event.id, participation.id, NOW),
      ]);
      expect(results.filter((r) => !r.alreadyPresent)).toHaveLength(1);
      expect(results.filter((r) => r.alreadyPresent)).toHaveLength(2);
    } finally {
      await second.sql.end({ timeout: 5 });
    }
    expect((await reload(participation.id)).status).toBe("CHECKED_IN");
  });
});

describe("undoCheckIn", () => {
  it("vuelve a REGISTERED y es no-op si ya estaba inscripta", async () => {
    const event = await makeEvent(db, { phase: "CHECKIN" });
    const [a] = await makeChallenges(db, event.id, 1);
    const { participation } = await makeRegistered(db, event.id, { firstChoiceId: a.id, secondChoiceAny: true });
    await manualCheckIn(db, event.id, participation.id, NOW);

    await undoCheckIn(db, event.id, participation.id);
    let row = await reload(participation.id);
    expect(row.status).toBe("REGISTERED");
    expect(row.checkedInAt).toBeNull();

    await undoCheckIn(db, event.id, participation.id);
    row = await reload(participation.id);
    expect(row.status).toBe("REGISTERED");

    // Se puede volver a marcar.
    expect(await manualCheckIn(db, event.id, participation.id, NOW)).toEqual({ alreadyPresent: false });
  });

  it("con equipo → HAS_TEAM", async () => {
    const event = await makeEvent(db, { phase: "MATCHING" });
    const [a] = await makeChallenges(db, event.id, 1);
    const { participation } = await makeRegistered(db, event.id, {
      firstChoiceId: a.id,
      secondChoiceAny: true,
      checkedIn: true,
    });
    const team = await makeTeam(event.id, a.id, 1, 1, false);
    await assignTeam(participation.id, team.id, "CHECKED_IN");

    await expectDomainError(
      undoCheckIn(db, event.id, participation.id),
      "HAS_TEAM",
      "Primero sacala del equipo.",
    );
    const row = await reload(participation.id);
    expect(row.status).toBe("CHECKED_IN");
    expect(row.checkedInAt).not.toBeNull();
  });

  it("de otro evento o id inválido → NOT_FOUND", async () => {
    const event = await makeEvent(db);
    const other = await makeEvent(db);
    const [a] = await makeChallenges(db, other.id, 1);
    const { participation } = await makeRegistered(db, other.id, {
      firstChoiceId: a.id,
      secondChoiceAny: true,
      checkedIn: true,
    });
    await expectDomainError(undoCheckIn(db, event.id, participation.id), "NOT_FOUND");
    await expectDomainError(undoCheckIn(db, event.id, "abc"), "NOT_FOUND");
    expect((await reload(participation.id)).status).toBe("CHECKED_IN");
  });

  it("después de publicar vuelve a NO_SHOW (como el resto de quienes no llegaron)", async () => {
    const event = await makeEvent(db, { phase: "SPRINT" });
    const [a] = await makeChallenges(db, event.id, 1);
    await makeTeam(event.id, a.id, 1, 1, true);
    const { participation } = await makeRegistered(db, event.id, { firstChoiceId: a.id, secondChoiceAny: true });
    await db.update(s.participations).set({ status: "NO_SHOW" }).where(eq(s.participations.id, participation.id));

    await manualCheckIn(db, event.id, participation.id, NOW);
    await undoCheckIn(db, event.id, participation.id);
    const row = await reload(participation.id);
    expect(row.status).toBe("NO_SHOW");
    expect(row.checkedInAt).toBeNull();

    // No-op si se repite y se puede volver a marcar.
    await undoCheckIn(db, event.id, participation.id);
    expect((await reload(participation.id)).status).toBe("NO_SHOW");
    expect(await manualCheckIn(db, event.id, participation.id, NOW)).toEqual({ alreadyPresent: false });
  });

  it("sin inscripción es no-op; con la experiencia avanzada y sin equipo no se puede deshacer", async () => {
    const event = await makeEvent(db, { phase: "REFLECTION" });
    const [a] = await makeChallenges(db, event.id, 1);
    const started = await makeAnonymous(event.id, { status: "STARTED" });
    await undoCheckIn(db, event.id, started.id);
    expect((await reload(started.id)).status).toBe("STARTED");

    const { participation } = await makeRegistered(db, event.id, {
      firstChoiceId: a.id,
      secondChoiceAny: true,
      checkedIn: true,
    });
    await db
      .update(s.participations)
      .set({ status: "EXPERIENCE_COMPLETED" })
      .where(eq(s.participations.id, participation.id));
    await expectDomainError(undoCheckIn(db, event.id, participation.id), "CANNOT_UNDO_CHECKIN");
    expect((await reload(participation.id)).status).toBe("EXPERIENCE_COMPLETED");
  });

  it("check-in y deshacer a la vez: sin errores y con estado coherente", async () => {
    const event = await makeEvent(db, { phase: "CHECKIN" });
    const [a] = await makeChallenges(db, event.id, 1);
    const people = await Promise.all(
      Array.from({ length: 5 }, () => makeRegistered(db, event.id, { firstChoiceId: a.id, secondChoiceAny: true, checkedIn: true })),
    );
    const second = secondTestDb();
    try {
      await Promise.all(
        people.flatMap(({ participation }) => [
          undoCheckIn(db, event.id, participation.id),
          manualCheckIn(second.db, event.id, participation.id, NOW),
        ]),
      );
    } finally {
      await second.sql.end({ timeout: 5 });
    }
    for (const { participation } of people) {
      const row = await reload(participation.id);
      expect(["CHECKED_IN", "REGISTERED"]).toContain(row.status);
      expect(row.checkedInAt === null).toBe(row.status === "REGISTERED");
    }
  });

  it("dos staff deshaciendo a la vez: sin errores y queda inscripta", async () => {
    const event = await makeEvent(db, { phase: "CHECKIN" });
    const [a] = await makeChallenges(db, event.id, 1);
    const { participation } = await makeRegistered(db, event.id, {
      firstChoiceId: a.id,
      secondChoiceAny: true,
      checkedIn: true,
    });
    const second = secondTestDb();
    try {
      await Promise.all([
        undoCheckIn(db, event.id, participation.id),
        undoCheckIn(second.db, event.id, participation.id),
      ]);
    } finally {
      await second.sql.end({ timeout: 5 });
    }
    const row = await reload(participation.id);
    expect(row.status).toBe("REGISTERED");
    expect(row.checkedInAt).toBeNull();
  });
});

describe("staffQuickAdd", () => {
  async function setup() {
    const event = await makeEvent(db, { phase: "CHECKIN" });
    const challenges = await makeChallenges(db, event.id, 3);
    return { event, challenges };
  }

  it("crea a la persona presente y deduplica por WhatsApp escrito distinto", async () => {
    const { event, challenges: [a, b, c] } = await setup();

    const first = await staffQuickAdd(
      db,
      event,
      { name: "  María   José ", whatsapp: "351 15 123 4567", firstChoiceId: a.id, secondChoiceId: b.id, secondChoiceAny: false },
      NOW,
    );
    expect(first.created).toBe(true);
    const row = await reload(first.participationId);
    expect(row).toMatchObject({
      eventId: event.id,
      status: "CHECKED_IN",
      addedByStaff: true,
      initialMode: null,
      firstChoiceId: a.id,
      secondChoiceId: b.id,
      secondChoiceAny: false,
      checkedInAt: NOW,
      registeredAt: NOW,
      operationalConsentAt: NOW,
      communityConsentAt: null,
      teamId: null,
    });
    expect(row.resumeTokenHash).toMatch(/^[0-9a-f]{64}$/);
    const person = await db.query.participants.findFirst({
      where: eq(s.participants.id, row.participantId!),
    });
    expect(person).toMatchObject({ name: "María José", whatsappNormalized: "+5493511234567" });

    const later = new Date(NOW.getTime() + 120_000);
    const again = await staffQuickAdd(
      db,
      event,
      { name: "María José", whatsapp: "+5493511234567", firstChoiceId: c.id, secondChoiceId: null, secondChoiceAny: true },
      later,
    );
    expect(again).toEqual({ participationId: first.participationId, created: false });
    const updated = await reload(first.participationId);
    expect(updated).toMatchObject({
      status: "CHECKED_IN",
      firstChoiceId: c.id,
      secondChoiceId: null,
      secondChoiceAny: true,
      checkedInAt: NOW, // no se pisa la hora original
    });

    const all = await db.select().from(s.participations).where(eq(s.participations.eventId, event.id));
    expect(all).toHaveLength(1);
    expect(await db.select().from(s.participants)).toHaveLength(1);
  });

  it("reutiliza la inscripción previa de la persona y la marca presente", async () => {
    const { event, challenges: [a, b, c] } = await setup();
    const { participation, participant } = await makeRegistered(db, event.id, {
      name: "Lucía",
      firstChoiceId: a.id,
      secondChoiceId: b.id,
    });
    await db.update(s.participations).set({ status: "NO_SHOW" }).where(eq(s.participations.id, participation.id));

    const result = await staffQuickAdd(
      db,
      event,
      { name: "Lucía", whatsapp: participant.whatsappNormalized, firstChoiceId: c.id, secondChoiceId: a.id, secondChoiceAny: false },
      NOW,
    );
    expect(result).toEqual({ participationId: participation.id, created: false });
    const row = await reload(participation.id);
    expect(row).toMatchObject({
      status: "CHECKED_IN",
      checkedInAt: NOW,
      addedByStaff: false,
      initialMode: "EXPLORE",
      firstChoiceId: c.id,
      secondChoiceId: a.id,
    });
    expect(row.registeredAt).toEqual(participation.registeredAt);
  });

  it("si ya tiene equipo no cambia elecciones ni estado", async () => {
    const { event, challenges: [a, b, c] } = await setup();
    const { participation, participant } = await makeRegistered(db, event.id, {
      firstChoiceId: a.id,
      secondChoiceId: b.id,
      checkedIn: true,
      checkedInAt: NOW,
    });
    const team = await makeTeam(event.id, a.id, 1, 1, true);
    await assignTeam(participation.id, team.id, "MATCHED");

    const result = await staffQuickAdd(
      db,
      event,
      { name: "Otro Nombre", whatsapp: participant.whatsappNormalized, firstChoiceId: c.id, secondChoiceId: null, secondChoiceAny: true },
      new Date(),
    );
    expect(result).toEqual({ participationId: participation.id, created: false });
    const row = await reload(participation.id);
    expect(row).toMatchObject({
      status: "MATCHED",
      teamId: team.id,
      firstChoiceId: a.id,
      secondChoiceId: b.id,
      checkedInAt: NOW,
    });
  });

  it("después de publicar queda presente sin equipo y no toca equipos ni crea evidencia", async () => {
    const { event, challenges: [a, b] } = await setup();
    const team = await makeTeam(event.id, a.id, 1, 1, true);
    const member = await makeRegistered(db, event.id, { firstChoiceId: a.id, secondChoiceAny: true, checkedIn: true });
    await assignTeam(member.participation.id, team.id, "MATCHED");

    const result = await staffQuickAdd(
      db,
      event,
      { name: "Llegó Tarde", whatsapp: "+5493517000002", firstChoiceId: a.id, secondChoiceId: b.id, secondChoiceAny: false },
      NOW,
    );
    expect(result.created).toBe(true);
    expect(await reload(result.participationId)).toMatchObject({
      status: "CHECKED_IN",
      teamId: null,
      assignmentSource: null,
    });
    expect(await db.select().from(s.teams).where(eq(s.teams.eventId, event.id))).toEqual([team]);
    expect((await reload(member.participation.id)).teamId).toBe(team.id);
    // Sin cuestionario ni evidencia: el alta de staff no genera señales.
    expect(await db.select().from(s.questionnaireAnswers)).toHaveLength(0);
    expect(await db.select().from(s.evidenceItems)).toHaveLength(0);
  });

  it("la misma persona inscripta en otro evento: crea una participation nueva en este", async () => {
    const { event, challenges: [a] } = await setup();
    const other = await makeEvent(db);
    const [otherChallenge] = await makeChallenges(db, other.id, 1);
    const previous = await makeRegistered(db, other.id, { firstChoiceId: otherChallenge.id, secondChoiceAny: true });

    const result = await staffQuickAdd(
      db,
      event,
      { name: "Repite", whatsapp: previous.participant.whatsappNormalized, firstChoiceId: a.id, secondChoiceId: null, secondChoiceAny: true },
      NOW,
    );
    expect(result.created).toBe(true);
    expect(result.participationId).not.toBe(previous.participation.id);
    const row = await reload(result.participationId);
    expect(row).toMatchObject({ eventId: event.id, participantId: previous.participant.id });
    expect(await reload(previous.participation.id)).toMatchObject({
      eventId: other.id,
      status: "REGISTERED",
      firstChoiceId: otherChallenge.id,
    });
  });

  it("dos altas simultáneas del mismo número no duplican", async () => {
    const { event, challenges: [a] } = await setup();
    const second = secondTestDb();
    const input = { name: "Pedro", whatsapp: "0351 15 765 4321", firstChoiceId: a.id, secondChoiceId: null, secondChoiceAny: true };
    try {
      const results = await Promise.all([
        staffQuickAdd(db, event, input, NOW),
        staffQuickAdd(second.db, event, { ...input, whatsapp: "+54 9 351 765 4321" }, NOW),
      ]);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(new Set(results.map((r) => r.participationId)).size).toBe(1);
    } finally {
      await second.sql.end({ timeout: 5 });
    }
    const all = await db.select().from(s.participations).where(eq(s.participations.eventId, event.id));
    expect(all).toHaveLength(1);
  });

  it("valida las elecciones como en el flujo del participante", async () => {
    const { event, challenges: [a, b, c] } = await setup();
    await db.update(s.challenges).set({ active: false }).where(eq(s.challenges.id, c.id));
    const other = await makeEvent(db);
    const [foreign] = await makeChallenges(db, other.id, 1);
    const base = { name: "Sofía", whatsapp: "351 1234567" };

    await expectDomainError(
      staffQuickAdd(db, event, { ...base, firstChoiceId: a.id, secondChoiceId: null, secondChoiceAny: false }, NOW),
      "SECOND_REQUIRED",
      "Elegí una segunda opción o marcá 'Cualquiera'.",
    );
    await expectDomainError(
      staffQuickAdd(db, event, { ...base, firstChoiceId: a.id, secondChoiceId: b.id, secondChoiceAny: true }, NOW),
      "SECOND_CONFLICT",
      "Elegí una segunda opción o marcá 'Cualquiera'.",
    );
    await expectDomainError(
      staffQuickAdd(db, event, { ...base, firstChoiceId: a.id, secondChoiceId: a.id, secondChoiceAny: false }, NOW),
      "SECOND_SAME",
      "La segunda opción tiene que ser distinta de la primera.",
    );
    await expectDomainError(
      staffQuickAdd(db, event, { ...base, firstChoiceId: "", secondChoiceId: null, secondChoiceAny: true }, NOW),
      "FIRST_REQUIRED",
    );
    await expectDomainError(
      staffQuickAdd(db, event, { ...base, firstChoiceId: c.id, secondChoiceId: null, secondChoiceAny: true }, NOW),
      "INVALID_CHALLENGE",
    );
    await expectDomainError(
      staffQuickAdd(db, event, { ...base, firstChoiceId: a.id, secondChoiceId: foreign.id, secondChoiceAny: false }, NOW),
      "INVALID_CHALLENGE",
    );
    await expectDomainError(
      staffQuickAdd(db, event, { ...base, firstChoiceId: "x", secondChoiceId: null, secondChoiceAny: true }, NOW),
      "INVALID_CHALLENGE",
    );
    await expectDomainError(
      staffQuickAdd(db, event, { ...base, whatsapp: "123", firstChoiceId: a.id, secondChoiceId: null, secondChoiceAny: true }, NOW),
      "INVALID_WHATSAPP",
      "Revisá el número de WhatsApp (incluí el código de área).",
    );
    await expectDomainError(
      staffQuickAdd(db, event, { ...base, name: " ", firstChoiceId: a.id, secondChoiceId: null, secondChoiceAny: true }, NOW),
      "INVALID_NAME",
    );

    expect(await db.select().from(s.participations)).toHaveLength(0);
    expect(await db.select().from(s.participants)).toHaveLength(0);
  });
});

describe("whatsappReminderText", () => {
  it("usa los horarios del evento (coincide con el texto del PRD por defecto)", async () => {
    const event = await makeEvent(db);
    expect(whatsappReminderText(event)).toBe(WHATSAPP_REMINDER);
  });

  it("refleja otros horarios y otra ubicación", async () => {
    const event = await makeEvent(db);
    const [updated] = await db
      .update(s.events)
      .set({
        locationLabel: "Hall central",
        checkinOpensAt: new Date("2026-10-15T21:05:00Z"), // 18:05
        registrationClosesAt: new Date("2026-10-15T21:15:00Z"), // 18:15
        startsAt: new Date("2026-10-15T21:20:00Z"), // 18:20
      })
      .where(and(eq(s.events.id, event.id)))
      .returning();
    expect(whatsappReminderText(updated)).toBe(
      "En unos minutos empieza el Innovatón. Acercate a Hall central entre 18:05 y 18:15 para confirmar tu lugar. A las 18:20 arrancamos.",
    );
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { Mode } from "@/lib/domain/constants";
import { DomainError } from "@/lib/services/errors";
import {
  assignLatecomer,
  createTeam,
  createTeamWithMembers,
  deleteTeam,
  generateTeams,
  getTeamsBoard,
  moveParticipant,
  publishTeams,
  setTableNumber,
} from "@/lib/services/teams";
import {
  closeTestDb,
  makeChallenges,
  makeEvent,
  makeRegistered,
  resetDb,
  secondTestDb,
  testDb,
} from "./helpers";

beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const NOW = new Date("2026-10-15T17:40:00.000Z");

let arrival = 0;

/** Crea n personas inscriptas (presentes por defecto) con las mismas elecciones. */
async function addPeople(
  eventId: string,
  n: number,
  opts: {
    firstChoiceId: string | null;
    secondChoiceId?: string | null;
    secondChoiceAny?: boolean;
    mode?: Mode | null;
    checkedIn?: boolean;
    name?: string;
  },
): Promise<s.ParticipationRow[]> {
  const out: s.ParticipationRow[] = [];
  for (let i = 0; i < n; i++) {
    arrival += 1;
    const { participation } = await makeRegistered(testDb(), eventId, {
      checkedIn: true,
      ...opts,
      name: opts.name ? `${opts.name} ${i + 1}` : undefined,
      checkedInAt: new Date(NOW.getTime() - 3_600_000 + arrival * 1000),
    });
    out.push(participation);
  }
  return out;
}

async function teamsOf(eventId: string, db: DB = testDb()) {
  return db.query.teams.findMany({
    where: eq(s.teams.eventId, eventId),
    orderBy: [asc(s.teams.tableNumber)],
  });
}

async function participationsOf(eventId: string) {
  return testDb().query.participations.findMany({ where: eq(s.participations.eventId, eventId) });
}

async function participation(id: string) {
  const row = await testDb().query.participations.findFirst({ where: eq(s.participations.id, id) });
  if (!row) throw new Error("participation no encontrada");
  return row;
}

async function caught(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    return err as DomainError;
  }
  throw new Error("se esperaba un DomainError");
}

async function setup(phase: "MATCHING" | "CHECKIN" | "REGISTRATION" = "MATCHING", n = 3) {
  const db = testDb();
  const event = await makeEvent(db, { phase });
  const challenges = await makeChallenges(db, event.id, n);
  return { db, event, challenges };
}

/** Cada presente con equipo está en un equipo existente; sin duplicados de mesa ni número. */
async function expectCoherent(eventId: string, expectedTeams: number, expectedAssigned: number) {
  const teams = await teamsOf(eventId);
  expect(teams).toHaveLength(expectedTeams);
  const teamIds = new Set(teams.map((t) => t.id));
  expect(new Set(teams.map((t) => t.tableNumber)).size).toBe(teams.length);
  expect(new Set(teams.map((t) => `${t.challengeId}:${t.teamNumber}`)).size).toBe(teams.length);
  const rows = await participationsOf(eventId);
  const assigned = rows.filter((r) => r.teamId !== null);
  expect(assigned).toHaveLength(expectedAssigned);
  for (const row of assigned) expect(teamIds.has(row.teamId!)).toBe(true);
  for (const team of teams) {
    expect(assigned.some((r) => r.teamId === team.id)).toBe(true);
  }
  return { teams, rows };
}

function sizesByChallenge(
  teams: s.TeamRow[],
  rows: s.ParticipationRow[],
  challengeId: string,
): number[] {
  return teams
    .filter((t) => t.challengeId === challengeId)
    .map((t) => rows.filter((r) => r.teamId === t.id).length)
    .sort((a, b) => a - b);
}

describe("generateTeams", () => {
  it("usa solo personas CHECKED_IN (REGISTERED no entra)", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    const present = await addPeople(event.id, 3, { firstChoiceId: a.id });
    const absent = await addPeople(event.id, 2, { firstChoiceId: a.id, checkedIn: false });

    const result = await generateTeams(db, event.id);
    expect(result).toMatchObject({ teamCount: 1, assignedCount: 3, unresolved: [], warnings: [] });

    const [team] = await teamsOf(event.id);
    expect(team).toMatchObject({ challengeId: a.id, teamNumber: 1, tableNumber: 1, publishedAt: null });
    for (const p of present) {
      expect(await participation(p.id)).toMatchObject({
        teamId: team.id,
        assignmentSource: "FIRST_CHOICE",
        status: "CHECKED_IN",
      });
    }
    for (const p of absent) {
      expect(await participation(p.id)).toMatchObject({ teamId: null, status: "REGISTERED" });
    }
  });

  it("reasigna grupos de 1–2 por segunda opción viable y explica a quien queda sin resolver", async () => {
    const { db, event, challenges } = await setup();
    const [a, b, c] = challenges;
    await addPeople(event.id, 4, { firstChoiceId: a.id });
    const second = await addPeople(event.id, 2, { firstChoiceId: b.id, secondChoiceId: a.id });
    const [noSecond] = await addPeople(event.id, 1, { firstChoiceId: c.id, name: "Sin segunda" });
    const [notViable] = await addPeople(event.id, 1, {
      firstChoiceId: c.id,
      secondChoiceId: b.id,
      name: "Segunda inviable",
    });

    const result = await generateTeams(db, event.id);
    expect(result.teamCount).toBe(2);
    expect(result.assignedCount).toBe(6);
    expect(result.warnings).toContainEqual({ code: "UNRESOLVED", count: 2 });
    expect(result.unresolved).toEqual([
      {
        participationId: noSecond.id,
        name: "Sin segunda 1",
        reason: "Su desafío no llegó a 3 personas y no eligió segunda opción.",
      },
      {
        participationId: notViable.id,
        name: "Segunda inviable 1",
        reason: "Su desafío no llegó a 3 personas y su segunda opción tampoco.",
      },
    ]);

    const { teams, rows } = await expectCoherent(event.id, 2, 6);
    expect(sizesByChallenge(teams, rows, a.id)).toEqual([3, 3]);
    for (const p of second) {
      expect(await participation(p.id)).toMatchObject({ assignmentSource: "SECOND_CHOICE" });
      expect(teams.find((t) => t.id === rows.find((r) => r.id === p.id)!.teamId)!.challengeId).toBe(a.id);
    }
    expect(await participation(noSecond.id)).toMatchObject({ teamId: null, status: "CHECKED_IN" });
  });

  it("5 personas en un desafío → un equipo de 5 con advertencia", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    await addPeople(event.id, 5, { firstChoiceId: a.id });

    const result = await generateTeams(db, event.id);
    expect(result.teamCount).toBe(1);
    expect(result.assignedCount).toBe(5);
    expect(result.warnings).toContainEqual({ code: "TEAM_OF_FIVE", challengeId: a.id, teamNumber: 1 });

    const board = await getTeamsBoard(db, event.id);
    expect(board.teams[0].members).toHaveLength(5);
    expect(board.warnings.map((w) => w.code)).toContain("TEAM_OF_FIVE");
    expect(board.warnings.find((w) => w.code === "TEAM_OF_FIVE")!.message).toMatch(/quinto excepcional/);
  });

  it("13 en un desafío → 3+3+3+4", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    await addPeople(event.id, 13, { firstChoiceId: a.id });

    const result = await generateTeams(db, event.id);
    expect(result.teamCount).toBe(4);
    const { teams, rows } = await expectCoherent(event.id, 4, 13);
    expect(sizesByChallenge(teams, rows, a.id)).toEqual([3, 3, 3, 4]);
    expect(teams.map((t) => t.tableNumber)).toEqual([1, 2, 3, 4]);
    expect(teams.map((t) => t.teamNumber).sort()).toEqual([1, 2, 3, 4]);
  });

  it("20+ personas en varios desafíos", async () => {
    const { db, event, challenges } = await setup("MATCHING", 4);
    const [a, b, c, d] = challenges;
    const modes: Mode[] = ["EXPLORE", "CREATE", "DRIVE"];
    for (let i = 0; i < 10; i++) {
      await addPeople(event.id, 1, { firstChoiceId: a.id, mode: modes[i % 3] });
    }
    await addPeople(event.id, 7, { firstChoiceId: b.id, mode: "CREATE" });
    await addPeople(event.id, 4, { firstChoiceId: c.id, mode: "DRIVE" });
    await addPeople(event.id, 2, { firstChoiceId: d.id, secondChoiceId: b.id, mode: null });

    const result = await generateTeams(db, event.id);
    expect(result.assignedCount).toBe(23);
    expect(result.unresolved).toEqual([]);
    const { teams, rows } = await expectCoherent(event.id, 7, 23);
    expect(sizesByChallenge(teams, rows, a.id)).toEqual([3, 3, 4]);
    expect(sizesByChallenge(teams, rows, b.id)).toEqual([3, 3, 3]);
    expect(sizesByChallenge(teams, rows, c.id)).toEqual([4]);
    expect(sizesByChallenge(teams, rows, d.id)).toEqual([]);
    expect(teams.map((t) => t.tableNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("todos con el mismo modo: igual arma equipos sin dejar a nadie afuera", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    await addPeople(event.id, 8, { firstChoiceId: a.id, mode: "DRIVE" });

    const result = await generateTeams(db, event.id);
    expect(result).toMatchObject({ teamCount: 2, assignedCount: 8, unresolved: [] });
    const { teams, rows } = await expectCoherent(event.id, 2, 8);
    expect(sizesByChallenge(teams, rows, a.id)).toEqual([4, 4]);
  });

  it("ANY: quien acepta cualquiera se suma a un grupo viable", async () => {
    const { db, event, challenges } = await setup();
    const [a, b] = challenges;
    await addPeople(event.id, 3, { firstChoiceId: a.id });
    const [any] = await addPeople(event.id, 1, { firstChoiceId: b.id, secondChoiceAny: true });

    const result = await generateTeams(db, event.id);
    expect(result).toMatchObject({ teamCount: 1, assignedCount: 4, unresolved: [] });
    const [team] = await teamsOf(event.id);
    expect(team.challengeId).toBe(a.id);
    expect(await participation(any.id)).toMatchObject({ teamId: team.id, assignmentSource: "ANY" });
  });

  it("falla si la fase no es MATCHING", async () => {
    const { db, event, challenges } = await setup("CHECKIN");
    await addPeople(event.id, 3, { firstChoiceId: challenges[0].id });
    const err = await caught(generateTeams(db, event.id));
    expect(err.code).toBe("WRONG_PHASE");
    expect(await teamsOf(event.id)).toHaveLength(0);
  });

  it("ignora desafíos inactivos y explica cada caso sin resolver", async () => {
    const { db, event, challenges } = await setup();
    const [a, b, c] = challenges;
    await db.update(s.challenges).set({ active: false }).where(eq(s.challenges.id, c.id));
    await addPeople(event.id, 3, { firstChoiceId: a.id });
    // Primera opción inactiva → cuenta la segunda.
    const [toSecond] = await addPeople(event.id, 1, { firstChoiceId: c.id, secondChoiceId: a.id });
    const [noValid] = await addPeople(event.id, 1, { firstChoiceId: c.id, name: "Inactiva" });
    const [alone] = await addPeople(event.id, 1, { firstChoiceId: b.id, name: "Sola" });

    const result = await generateTeams(db, event.id);
    expect(result).toMatchObject({ teamCount: 1, assignedCount: 4 });
    expect(await participation(toSecond.id)).toMatchObject({ assignmentSource: "SECOND_CHOICE" });
    expect(result.unresolved).toEqual([
      { participationId: noValid.id, name: "Inactiva 1", reason: "No tiene elegido ningún desafío activo." },
      {
        participationId: alone.id,
        name: "Sola 1",
        reason: "Su desafío no llegó a 3 personas y no eligió segunda opción.",
      },
    ]);
    expect((await teamsOf(event.id)).every((t) => t.challengeId === a.id)).toBe(true);
  });

  it("ANY sin ningún grupo viable queda para resolución manual", async () => {
    const { db, event, challenges } = await setup();
    const [a, b] = challenges;
    const [x] = await addPeople(event.id, 1, { firstChoiceId: a.id, secondChoiceAny: true });
    const [y] = await addPeople(event.id, 1, { firstChoiceId: b.id, secondChoiceAny: true });
    const result = await generateTeams(db, event.id);
    expect(result.teamCount).toBe(0);
    expect(result.unresolved.map((u) => [u.participationId, u.reason])).toEqual([
      [x.id, "Aceptaba cualquier desafío, pero no se formó ningún equipo al que sumarse."],
      [y.id, "Aceptaba cualquier desafío, pero no se formó ningún equipo al que sumarse."],
    ]);
  });

  it("regenerar descarta los cambios manuales del borrador y limpia a quien queda sin equipo", async () => {
    const { db, event, challenges } = await setup();
    const [a, b] = challenges;
    const as = await addPeople(event.id, 3, { firstChoiceId: a.id });
    const bs = await addPeople(event.id, 3, { firstChoiceId: b.id });
    await generateTeams(db, event.id);
    const teamA = (await teamsOf(event.id)).find((t) => t.challengeId === a.id)!;
    await moveParticipant(db, event.id, bs[0].id, teamA.id);
    const extra = await createTeam(db, event.id, b.id, NOW);
    await moveParticipant(db, event.id, bs[1].id, extra.id);

    // Se deshace un check-in de B (otro servicio): B queda con 2 presentes y no se forma.
    await db
      .update(s.participations)
      .set({ status: "REGISTERED", checkedInAt: null, teamId: null, assignmentSource: null })
      .where(eq(s.participations.id, bs[1].id));
    const again = await generateTeams(db, event.id);
    expect(again).toMatchObject({ teamCount: 1, assignedCount: 3 });
    expect(again.unresolved.map((u) => u.participationId)).toEqual([bs[0].id, bs[2].id]);
    const { teams, rows } = await expectCoherent(event.id, 1, 3);
    expect(teams[0]).toMatchObject({ challengeId: a.id, tableNumber: 1 });
    for (const p of as) {
      expect(rows.find((r) => r.id === p.id)).toMatchObject({ assignmentSource: "FIRST_CHOICE" });
    }
    // El cambio manual a A se descartó con el borrador.
    for (const id of [bs[0].id, bs[2].id]) {
      expect(rows.find((r) => r.id === id)).toMatchObject({
        teamId: null,
        assignmentSource: null,
        status: "CHECKED_IN",
      });
    }
  });

  it("no regenera si un borrador tiene A3 o evaluación cargada", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    await addPeople(event.id, 3, { firstChoiceId: a.id });
    await generateTeams(db, event.id);
    const [team] = await teamsOf(event.id);
    await db.insert(s.founderAssessments).values({ teamId: team.id, problemScore: 2 });

    const err = await caught(generateTeams(db, event.id));
    expect(err.code).toBe("DRAFT_HAS_RECORDS");
    const [same] = await teamsOf(event.id);
    expect(same.id).toBe(team.id);
    expect(await db.query.founderAssessments.findFirst()).toMatchObject({ teamId: team.id });
  });

  it("regenerar antes de publicar reemplaza borradores e incluye presentes nuevos", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    await addPeople(event.id, 3, { firstChoiceId: a.id });
    await generateTeams(db, event.id);
    const [oldTeam] = await teamsOf(event.id);

    await addPeople(event.id, 3, { firstChoiceId: a.id });
    await addPeople(event.id, 1, { firstChoiceId: a.id, checkedIn: false });

    const again = await generateTeams(db, event.id);
    expect(again).toMatchObject({ teamCount: 2, assignedCount: 6 });
    const { teams } = await expectCoherent(event.id, 2, 6);
    expect(teams.map((t) => t.id)).not.toContain(oldTeam.id);
    expect(teams.map((t) => t.tableNumber)).toEqual([1, 2]);
    expect(teams.every((t) => t.publishedAt === null)).toBe(true);

    // Doble tap: misma estructura, sin duplicados.
    await generateTeams(db, event.id);
    await expectCoherent(event.id, 2, 6);
  });
});

describe("publishTeams", () => {
  it("publica: MATCHED, NO_SHOW, fase SPRINT; es idempotente y bloquea la regeneración", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    const present = await addPeople(event.id, 4, { firstChoiceId: a.id });
    const absent = await addPeople(event.id, 2, { firstChoiceId: a.id, checkedIn: false });
    await generateTeams(db, event.id);

    const result = await publishTeams(db, event.id, NOW);
    expect(result).toEqual({ alreadyPublished: false, teamCount: 1, matchedCount: 4, noShowCount: 2 });

    const [team] = await teamsOf(event.id);
    expect(team.publishedAt?.toISOString()).toBe(NOW.toISOString());
    for (const p of present) expect((await participation(p.id)).status).toBe("MATCHED");
    for (const p of absent) expect((await participation(p.id)).status).toBe("NO_SHOW");
    const ev = await db.query.events.findFirst({ where: eq(s.events.id, event.id) });
    expect(ev?.phase).toBe("SPRINT");

    const later = new Date(NOW.getTime() + 60_000);
    const again = await publishTeams(db, event.id, later);
    expect(again).toEqual({ alreadyPublished: true, teamCount: 1, matchedCount: 4, noShowCount: 2 });
    const [same] = await teamsOf(event.id);
    expect(same.publishedAt?.toISOString()).toBe(NOW.toISOString());

    const err = await caught(generateTeams(db, event.id));
    expect(err.code).toBe("TEAMS_PUBLISHED");
    expect(err.message).toBe("Los equipos ya se publicaron. Desde ahora los cambios son manuales.");
    expect((await teamsOf(event.id)).map((t) => t.id)).toEqual([team.id]);
  });

  it("publicar deja presentes sin equipo como CHECKED_IN y no toca a quien no terminó la inscripción", async () => {
    const { db, event, challenges } = await setup();
    const [a, b] = challenges;
    await addPeople(event.id, 3, { firstChoiceId: a.id });
    const [alone] = await addPeople(event.id, 1, { firstChoiceId: b.id });
    const [started] = await db
      .insert(s.participations)
      .values({ eventId: event.id, resumeTokenHash: `hash-${Math.random()}`, status: "STARTED" })
      .returning();
    await generateTeams(db, event.id);

    const result = await publishTeams(db, event.id, NOW);
    expect(result).toEqual({ alreadyPublished: false, teamCount: 1, matchedCount: 3, noShowCount: 0 });
    expect(await participation(alone.id)).toMatchObject({ teamId: null, status: "CHECKED_IN" });
    expect((await participation(started.id)).status).toBe("STARTED");
  });

  it("sin equipos → NO_TEAMS; fuera de MATCHING → WRONG_PHASE", async () => {
    const { db, event } = await setup();
    expect((await caught(publishTeams(db, event.id, NOW))).code).toBe("NO_TEAMS");

    const other = await makeEvent(db, { phase: "CHECKIN" });
    expect((await caught(publishTeams(db, other.id, NOW))).code).toBe("WRONG_PHASE");
  });
});

describe("concurrencia entre dos staff", () => {
  it("dos generateTeams simultáneos dejan un solo set de equipos coherente", async () => {
    const { db, event, challenges } = await setup();
    const [a, b] = challenges;
    await addPeople(event.id, 7, { firstChoiceId: a.id });
    await addPeople(event.id, 6, { firstChoiceId: b.id });

    const second = secondTestDb();
    try {
      for (let round = 0; round < 3; round++) {
        const results = await Promise.all([
          generateTeams(db, event.id),
          generateTeams(second.db, event.id),
          generateTeams(db, event.id),
        ]);
        for (const r of results) expect(r).toMatchObject({ teamCount: 4, assignedCount: 13 });
        const { teams, rows } = await expectCoherent(event.id, 4, 13);
        expect(teams.map((t) => t.tableNumber)).toEqual([1, 2, 3, 4]);
        expect(sizesByChallenge(teams, rows, a.id)).toEqual([3, 4]);
        expect(sizesByChallenge(teams, rows, b.id)).toEqual([3, 3]);
      }
    } finally {
      await second.sql.end({ timeout: 5 });
    }
  });

  it("generate + publish simultáneos terminan en un estado coherente", async () => {
    const second = secondTestDb();
    try {
      for (let round = 0; round < 4; round++) {
        await resetDb();
        const { db, event, challenges } = await setup();
        const [a, b] = challenges;
        await addPeople(event.id, 7, { firstChoiceId: a.id });
        await addPeople(event.id, 6, { firstChoiceId: b.id });
        // En rondas pares ya hay borradores; en impares, publish puede llegar antes que generate.
        if (round % 2 === 0) await generateTeams(db, event.id);

        const [gen, pub] = await Promise.allSettled([
          generateTeams(second.db, event.id),
          publishTeams(db, event.id, NOW),
        ]);
        for (const r of [gen, pub]) {
          if (r.status === "rejected") expect(r.reason).toBeInstanceOf(DomainError);
        }

        const ev = await db.query.events.findFirst({ where: eq(s.events.id, event.id) });
        const { teams, rows } = await expectCoherent(event.id, 4, 13);
        if (pub.status === "fulfilled") {
          expect(ev?.phase).toBe("SPRINT");
          expect(teams.every((t) => t.publishedAt?.getTime() === NOW.getTime())).toBe(true);
          expect(rows.every((r) => r.status === "MATCHED")).toBe(true);
          if (gen.status === "rejected") expect((gen.reason as DomainError).code).toBe("TEAMS_PUBLISHED");
        } else {
          expect((pub.reason as DomainError).code).toBe("NO_TEAMS");
          expect(gen.status).toBe("fulfilled");
          expect(ev?.phase).toBe("MATCHING");
          expect(teams.every((t) => t.publishedAt === null)).toBe(true);
          expect(rows.every((r) => r.status === "CHECKED_IN")).toBe(true);
        }
      }
    } finally {
      await second.sql.end({ timeout: 5 });
    }
  });

  it("dos staff con el mismo latecomer: mismo equipo → ok; equipos distintos → uno gana y el otro se entera", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    await addPeople(event.id, 6, { firstChoiceId: a.id });
    await generateTeams(db, event.id);
    await publishTeams(db, event.id, NOW);
    const [t1, t2] = await teamsOf(event.id);
    const second = secondTestDb();
    try {
      const [same] = await addPeople(event.id, 1, { firstChoiceId: a.id });
      await Promise.all([
        assignLatecomer(db, event.id, same.id, t1.id),
        assignLatecomer(second.db, event.id, same.id, t1.id),
      ]);
      expect(await participation(same.id)).toMatchObject({ teamId: t1.id, status: "MATCHED" });

      const [late] = await addPeople(event.id, 1, { firstChoiceId: a.id });
      const results = await Promise.allSettled([
        assignLatecomer(db, event.id, late.id, t1.id),
        assignLatecomer(second.db, event.id, late.id, t2.id),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0].reason).toBeInstanceOf(DomainError);
      expect((failed[0].reason as DomainError).code).toBe("ALREADY_ASSIGNED");
      const winner = results[0].status === "fulfilled" ? t1.id : t2.id;
      expect((await participation(late.id)).teamId).toBe(winner);
    } finally {
      await second.sql.end({ timeout: 5 });
    }
  });

  it("dos staff suman latecomers distintos a un equipo de 4: nunca queda de 6", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    await addPeople(event.id, 4, { firstChoiceId: a.id });
    await generateTeams(db, event.id);
    await publishTeams(db, event.id, NOW);
    const [team] = await teamsOf(event.id);
    const [x, y] = await addPeople(event.id, 2, { firstChoiceId: a.id });
    const second = secondTestDb();
    try {
      const results = await Promise.allSettled([
        assignLatecomer(db, event.id, x.id, team.id),
        assignLatecomer(second.db, event.id, y.id, team.id),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
      expect((failed.reason as DomainError).code).toBe("TEAM_FULL");
      const rows = await participationsOf(event.id);
      expect(rows.filter((r) => r.teamId === team.id)).toHaveLength(5);
    } finally {
      await second.sql.end({ timeout: 5 });
    }
  });

  it("dos staff crean el mismo equipo nuevo (con o sin miembros): no se duplica", async () => {
    const { db, event, challenges } = await setup();
    const [a, , c] = challenges;
    await addPeople(event.id, 3, { firstChoiceId: a.id });
    await generateTeams(db, event.id);
    await publishTeams(db, event.id, NOW);
    const lateC = (await addPeople(event.id, 3, { firstChoiceId: c.id })).map((p) => p.id);
    const second = secondTestDb();
    try {
      const [t1, t2] = await Promise.all([
        createTeamWithMembers(db, event.id, c.id, lateC, NOW),
        createTeamWithMembers(second.db, event.id, c.id, [...lateC].reverse(), NOW),
      ]);
      expect(t1.id).toBe(t2.id);
      expect(await teamsOf(event.id)).toHaveLength(2);

      const [e1, e2] = await Promise.all([
        createTeam(db, event.id, a.id, NOW),
        createTeam(second.db, event.id, a.id, NOW),
      ]);
      expect(e1.id).toBe(e2.id);
      expect(e1.publishedAt?.toISOString()).toBe(NOW.toISOString());
      expect(await teamsOf(event.id)).toHaveLength(3);
    } finally {
      await second.sql.end({ timeout: 5 });
    }
  });

  it("dos staff intercambian mesas a la vez sin violar el unique de mesa", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    await addPeople(event.id, 12, { firstChoiceId: a.id });
    await generateTeams(db, event.id);
    const [t1, t2, t3] = await teamsOf(event.id);
    const second = secondTestDb();
    try {
      await Promise.all([
        setTableNumber(db, event.id, t1.id, 3),
        setTableNumber(second.db, event.id, t2.id, 1),
        setTableNumber(db, event.id, t3.id, 2),
      ]);
      const tables = (await teamsOf(event.id)).map((t) => t.tableNumber).sort();
      expect(tables).toEqual([1, 2, 3]);
    } finally {
      await second.sql.end({ timeout: 5 });
    }
  });
});

describe("moveParticipant", () => {
  it("antes de publicar: mueve como MANUAL, a null, y exige check-in", async () => {
    const { db, event, challenges } = await setup();
    const [a, b] = challenges;
    await addPeople(event.id, 3, { firstChoiceId: a.id });
    const bs = await addPeople(event.id, 4, { firstChoiceId: b.id });
    const [registered] = await addPeople(event.id, 1, { firstChoiceId: a.id, checkedIn: false });
    await generateTeams(db, event.id);
    const teams = await teamsOf(event.id);
    const teamA = teams.find((t) => t.challengeId === a.id)!;

    await moveParticipant(db, event.id, bs[0].id, teamA.id);
    expect(await participation(bs[0].id)).toMatchObject({
      teamId: teamA.id,
      assignmentSource: "MANUAL",
      status: "CHECKED_IN",
    });
    // Doble tap: sin cambios ni errores.
    await moveParticipant(db, event.id, bs[0].id, teamA.id);
    expect(await participation(bs[0].id)).toMatchObject({ teamId: teamA.id, assignmentSource: "MANUAL" });

    await moveParticipant(db, event.id, bs[1].id, teamA.id, { source: "SECOND_CHOICE" });
    expect((await participation(bs[1].id)).assignmentSource).toBe("SECOND_CHOICE");

    await moveParticipant(db, event.id, bs[0].id, null);
    expect(await participation(bs[0].id)).toMatchObject({
      teamId: null,
      assignmentSource: null,
      status: "CHECKED_IN",
    });
    const board = await getTeamsBoard(db, event.id);
    expect(board.unassigned.map((p) => p.participationId)).toEqual([bs[0].id]);
    expect(board.unassigned[0].suggestion).toBeNull();

    const notPresent = await caught(moveParticipant(db, event.id, registered.id, teamA.id));
    expect(notPresent.code).toBe("NOT_PRESENT");
    expect(notPresent.message).toBe("Primero hacé el check-in de esta persona.");

    const other = await makeEvent(db, { phase: "MATCHING" });
    const [otherChallenge] = await makeChallenges(db, other.id, 1);
    const foreignTeam = await createTeam(db, other.id, otherChallenge.id, NOW);
    expect((await caught(moveParticipant(db, event.id, bs[2].id, foreignTeam.id))).code).toBe("NOT_FOUND");
    expect((await caught(moveParticipant(db, other.id, bs[2].id, foreignTeam.id))).code).toBe("NOT_FOUND");
  });

  it("después de publicar: al entrar a un equipo publicado pasa a MATCHED y al salir vuelve a CHECKED_IN", async () => {
    const { db, event, challenges } = await setup();
    const [a, b] = challenges;
    const as = await addPeople(event.id, 3, { firstChoiceId: a.id });
    const bs = await addPeople(event.id, 4, { firstChoiceId: b.id });
    await generateTeams(db, event.id);
    await moveParticipant(db, event.id, bs[0].id, null);
    await publishTeams(db, event.id, NOW);
    expect((await participation(bs[0].id)).status).toBe("CHECKED_IN");

    const teamA = (await teamsOf(event.id)).find((t) => t.challengeId === a.id)!;
    await moveParticipant(db, event.id, bs[0].id, teamA.id);
    expect(await participation(bs[0].id)).toMatchObject({
      teamId: teamA.id,
      assignmentSource: "MANUAL",
      status: "MATCHED",
    });

    await moveParticipant(db, event.id, as[0].id, null);
    expect(await participation(as[0].id)).toMatchObject({
      teamId: null,
      assignmentSource: null,
      status: "CHECKED_IN",
    });
  });

  it("después del sprint mueve sin retroceder el estado; valida el origen", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    const as = await addPeople(event.id, 6, { firstChoiceId: a.id });
    await generateTeams(db, event.id);
    await publishTeams(db, event.id, NOW);
    const [t1, t2] = await teamsOf(event.id);
    await db
      .update(s.participations)
      .set({ status: "EXPERIENCE_COMPLETED" })
      .where(eq(s.participations.id, as[0].id));
    const from = (await participation(as[0].id)).teamId;
    const target = from === t1.id ? t2 : t1;

    await moveParticipant(db, event.id, as[0].id, target.id);
    expect(await participation(as[0].id)).toMatchObject({
      teamId: target.id,
      assignmentSource: "MANUAL",
      status: "EXPERIENCE_COMPLETED",
    });
    // Dejarla sin equipo después del sprint la haría desaparecer del tablero: se rechaza.
    const unassign = await caught(moveParticipant(db, event.id, as[0].id, null));
    expect(unassign.code).toBe("CANNOT_UNASSIGN");
    expect(await participation(as[0].id)).toMatchObject({
      teamId: target.id,
      status: "EXPERIENCE_COMPLETED",
    });

    const bad = await caught(
      moveParticipant(db, event.id, as[1].id, t1.id, { source: "WHATEVER" as "MANUAL" }),
    );
    expect(bad.code).toBe("INVALID_SOURCE");
  });
});

describe("identificadores inválidos", () => {
  it("devuelven DomainError (nunca un error de base) en todas las operaciones", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    const [p] = await addPeople(event.id, 3, { firstChoiceId: a.id });
    await generateTeams(db, event.id);
    const [team] = await teamsOf(event.id);
    const missing = "00000000-0000-4000-8000-000000000000";

    for (const eventId of ["no-es-un-uuid", missing]) {
      const calls: [string, () => Promise<unknown>][] = [
        ["generate", () => generateTeams(db, eventId)],
        ["publish", () => publishTeams(db, eventId, NOW)],
        ["move", () => moveParticipant(db, eventId, p.id, team.id)],
        ["assign", () => assignLatecomer(db, eventId, p.id, team.id)],
        ["create", () => createTeam(db, eventId, a.id, NOW)],
        ["createWith", () => createTeamWithMembers(db, eventId, a.id, [p.id], NOW)],
        ["delete", () => deleteTeam(db, eventId, team.id)],
        ["table", () => setTableNumber(db, eventId, team.id, 5)],
        ["board", () => getTeamsBoard(db, eventId)],
      ];
      for (const [name, call] of calls) {
        const err = await caught(call());
        expect([name, err.code]).toEqual([name, "EVENT_NOT_FOUND"]);
      }
    }

    // Otros ids inválidos dentro de un evento existente.
    expect((await caught(moveParticipant(db, event.id, "x", team.id))).code).toBe("NOT_FOUND");
    expect((await caught(moveParticipant(db, event.id, p.id, "x"))).code).toBe("NOT_FOUND");
    expect((await caught(assignLatecomer(db, event.id, missing, team.id))).code).toBe("NOT_FOUND");
    expect((await caught(createTeam(db, event.id, "x", NOW))).code).toBe("NOT_FOUND");
    expect((await caught(createTeamWithMembers(db, event.id, a.id, ["x"], NOW))).code).toBe(
      "NOT_FOUND",
    );
    expect((await caught(setTableNumber(db, event.id, missing, 4))).code).toBe("NOT_FOUND");
    await deleteTeam(db, event.id, "x"); // no existe: nada que borrar
    expect(await teamsOf(event.id)).toHaveLength(1);
  });
});

describe("latecomers después de publicar", () => {
  it("sugiere, asigna sin mover a nadie y arma equipo nuevo con 3 compatibles", async () => {
    const { db, event, challenges } = await setup();
    const [a, b, c] = challenges;
    await addPeople(event.id, 3, { firstChoiceId: a.id });
    await addPeople(event.id, 4, { firstChoiceId: b.id });
    await generateTeams(db, event.id);
    await publishTeams(db, event.id, NOW);
    const published = await teamsOf(event.id);
    expect(published).toHaveLength(2);
    const teamA = published.find((t) => t.challengeId === a.id)!;
    const teamB = published.find((t) => t.challengeId === b.id)!;

    // Llega alguien de A: equipo de 3 → cuarto.
    const { participation: late1 } = await makeRegistered(db, event.id, {
      firstChoiceId: a.id,
      checkedIn: true,
      name: "Llega tarde",
    });
    let board = await getTeamsBoard(db, event.id);
    expect(board.published).toBe(true);
    expect(board.unassigned.map((p) => p.participationId)).toEqual([late1.id]);
    expect(board.unassigned[0].suggestion).toEqual({
      kind: "JOIN_TEAM",
      teamId: teamA.id,
      challengeId: a.id,
      choice: "FIRST",
      resultingSize: 4,
      exceptional: false,
    });

    const before = (await participationsOf(event.id)).filter((p) => p.id !== late1.id);
    await assignLatecomer(db, event.id, late1.id, teamA.id);
    expect(await participation(late1.id)).toMatchObject({
      teamId: teamA.id,
      assignmentSource: "FIRST_CHOICE",
      status: "MATCHED",
    });
    const after = (await participationsOf(event.id)).filter((p) => p.id !== late1.id);
    const pick = (rows: s.ParticipationRow[]) =>
      rows
        .map((r) => ({ id: r.id, teamId: r.teamId, source: r.assignmentSource, status: r.status }))
        .sort((x, y) => x.id.localeCompare(y.id));
    expect(pick(after)).toEqual(pick(before));
    // Doble tap.
    await assignLatecomer(db, event.id, late1.id, teamA.id);
    expect((await participation(late1.id)).teamId).toBe(teamA.id);

    // Llega alguien de B: equipo de 4 → quinto excepcional.
    const { participation: late2 } = await makeRegistered(db, event.id, {
      firstChoiceId: b.id,
      checkedIn: true,
    });
    board = await getTeamsBoard(db, event.id);
    const s2 = board.unassigned.find((p) => p.participationId === late2.id)!.suggestion;
    expect(s2).toMatchObject({ kind: "JOIN_TEAM", teamId: teamB.id, resultingSize: 5, exceptional: true });

    // Llegan 3 compatibles de C, sin equipos de C → nuevo equipo.
    const lateC = await addPeople(event.id, 3, { firstChoiceId: c.id });
    const lateCIds = lateC.map((p) => p.id);
    board = await getTeamsBoard(db, event.id);
    for (const id of lateCIds) {
      const suggestion = board.unassigned.find((p) => p.participationId === id)!.suggestion;
      expect(suggestion).toMatchObject({ kind: "NEW_TEAM", challengeId: c.id, choice: "FIRST" });
      if (suggestion?.kind === "NEW_TEAM") {
        expect([...suggestion.participationIds].sort()).toEqual([...lateCIds].sort());
      }
    }

    const later = new Date(NOW.getTime() + 10 * 60_000);
    const newTeam = await createTeamWithMembers(db, event.id, c.id, lateCIds, later);
    expect(newTeam).toMatchObject({ challengeId: c.id, teamNumber: 1, tableNumber: 3 });
    expect(newTeam.publishedAt?.toISOString()).toBe(later.toISOString());
    for (const id of lateCIds) {
      expect(await participation(id)).toMatchObject({
        teamId: newTeam.id,
        assignmentSource: "FIRST_CHOICE",
        status: "MATCHED",
      });
    }
    // Doble tap: devuelve el mismo equipo, sin duplicar.
    const again = await createTeamWithMembers(db, event.id, c.id, lateCIds, later);
    expect(again.id).toBe(newTeam.id);
    expect(await teamsOf(event.id)).toHaveLength(3);

    board = await getTeamsBoard(db, event.id);
    expect(board.unassigned.map((p) => p.participationId)).toEqual([late2.id]);
    expect(board.teams.find((t) => t.id === newTeam.id)!.members).toHaveLength(3);
  });

  it("assignLatecomer usa SECOND_CHOICE, ANY o MANUAL según el desafío del equipo", async () => {
    const { db, event, challenges } = await setup();
    const [a, b, c] = challenges;
    await addPeople(event.id, 6, { firstChoiceId: a.id });
    await generateTeams(db, event.id);
    await publishTeams(db, event.id, NOW);
    const [teamA1, teamA2] = await teamsOf(event.id);

    const [second] = await addPeople(event.id, 1, { firstChoiceId: b.id, secondChoiceId: a.id });
    const [any] = await addPeople(event.id, 1, { firstChoiceId: b.id, secondChoiceAny: true });
    const [manual] = await addPeople(event.id, 1, { firstChoiceId: b.id, secondChoiceId: c.id });
    await assignLatecomer(db, event.id, second.id, teamA1.id);
    await assignLatecomer(db, event.id, any.id, teamA1.id);
    await assignLatecomer(db, event.id, manual.id, teamA2.id);
    expect((await participation(second.id)).assignmentSource).toBe("SECOND_CHOICE");
    expect((await participation(any.id)).assignmentSource).toBe("ANY");
    expect((await participation(manual.id)).assignmentSource).toBe("MANUAL");

    const [registered] = await addPeople(event.id, 1, { firstChoiceId: a.id, checkedIn: false });
    expect((await caught(assignLatecomer(db, event.id, registered.id, teamA2.id))).code).toBe(
      "NOT_PRESENT",
    );
  });

  it("assignLatecomer nunca saca a alguien de otro equipo ni arma un sexto integrante", async () => {
    const { db, event, challenges } = await setup();
    const [a, b] = challenges;
    const as = await addPeople(event.id, 3, { firstChoiceId: a.id });
    await addPeople(event.id, 4, { firstChoiceId: b.id });
    await generateTeams(db, event.id);
    await publishTeams(db, event.id, NOW);
    const teams = await teamsOf(event.id);
    const teamA = teams.find((t) => t.challengeId === a.id)!;
    const teamB = teams.find((t) => t.challengeId === b.id)!;

    // Ya tiene equipo: no se lo mueve en silencio (eso es un cambio manual).
    const moved = await caught(assignLatecomer(db, event.id, as[0].id, teamB.id));
    expect(moved.code).toBe("ALREADY_ASSIGNED");
    expect((await participation(as[0].id)).teamId).toBe(teamA.id);

    // Equipo de 4 → quinto excepcional; equipo de 5 → no por esta vía.
    const [fifth, sixth] = await addPeople(event.id, 2, { firstChoiceId: b.id });
    await assignLatecomer(db, event.id, fifth.id, teamB.id);
    const full = await caught(assignLatecomer(db, event.id, sixth.id, teamB.id));
    expect(full.code).toBe("TEAM_FULL");
    expect(await participation(sixth.id)).toMatchObject({ teamId: null, status: "CHECKED_IN" });
    // Doble tap de quien ya entró como quinto: sin error.
    await assignLatecomer(db, event.id, fifth.id, teamB.id);

    // El staff igual puede decidirlo a mano; el tablero lo advierte.
    await moveParticipant(db, event.id, sixth.id, teamB.id);
    const board = await getTeamsBoard(db, event.id);
    expect(board.teams.find((t) => t.id === teamB.id)!.members).toHaveLength(6);
    expect(board.warnings.map((w) => w.code)).toContain("TEAM_TOO_BIG");
  });

  it("quien quedó NO_SHOW y llega después se ubica como latecomer", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    await addPeople(event.id, 3, { firstChoiceId: a.id });
    const [late] = await addPeople(event.id, 1, { firstChoiceId: a.id, checkedIn: false });
    await generateTeams(db, event.id);
    const result = await publishTeams(db, event.id, NOW);
    expect(result.noShowCount).toBe(1);
    expect((await participation(late.id)).status).toBe("NO_SHOW");
    expect((await caught(moveParticipant(db, event.id, late.id, null))).code).toBe("NOT_PRESENT");

    // Check-in del staff (lo hace otro servicio): vuelve a estar presente.
    await db
      .update(s.participations)
      .set({ status: "CHECKED_IN", checkedInAt: NOW })
      .where(eq(s.participations.id, late.id));
    const [teamA] = await teamsOf(event.id);
    const board = await getTeamsBoard(db, event.id);
    expect(board.unassigned.map((p) => p.participationId)).toEqual([late.id]);
    expect(board.unassigned[0].suggestion).toMatchObject({ kind: "JOIN_TEAM", teamId: teamA.id });

    await assignLatecomer(db, event.id, late.id, teamA.id);
    expect(await participation(late.id)).toMatchObject({
      teamId: teamA.id,
      assignmentSource: "FIRST_CHOICE",
      status: "MATCHED",
    });
  });

  it("createTeamWithMembers exige al menos una persona sin equipo", async () => {
    const { db, event, challenges } = await setup();
    const [a, b] = challenges;
    const as = await addPeople(event.id, 3, { firstChoiceId: a.id });
    await generateTeams(db, event.id);
    expect((await caught(createTeamWithMembers(db, event.id, b.id, [], NOW))).code).toBe("NO_MEMBERS");
    expect((await caught(createTeamWithMembers(db, event.id, b.id, [as[0].id], NOW))).code).toBe(
      "ALREADY_ASSIGNED",
    );
    expect(await teamsOf(event.id)).toHaveLength(1);
  });
});

describe("createTeam, deleteTeam y setTableNumber", () => {
  it("createTeam numera por desafío y toma la siguiente mesa; publica si el evento ya publicó", async () => {
    const { db, event, challenges } = await setup();
    const [a, b] = challenges;
    await addPeople(event.id, 6, { firstChoiceId: a.id });
    await generateTeams(db, event.id);

    const draft = await createTeam(db, event.id, a.id, NOW);
    expect(draft).toMatchObject({ challengeId: a.id, teamNumber: 3, tableNumber: 3, publishedAt: null });

    await publishTeams(db, event.id, NOW);
    const later = new Date(NOW.getTime() + 60_000);
    const published = await createTeam(db, event.id, b.id, later);
    expect(published).toMatchObject({ challengeId: b.id, teamNumber: 1, tableNumber: 4 });
    expect(published.publishedAt?.toISOString()).toBe(later.toISOString());

    const other = await makeEvent(db, { phase: "MATCHING" });
    const [foreign] = await makeChallenges(db, other.id, 1);
    expect((await caught(createTeam(db, event.id, foreign.id, NOW))).code).toBe("NOT_FOUND");
  });

  it("deleteTeam solo borra equipos vacíos y sin evaluación", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    await addPeople(event.id, 3, { firstChoiceId: a.id });
    await generateTeams(db, event.id);
    const [full] = await teamsOf(event.id);

    const err = await caught(deleteTeam(db, event.id, full.id));
    expect(err.code).toBe("TEAM_NOT_EMPTY");
    expect(err.message).toBe("Solo se pueden borrar equipos vacíos y sin evaluación.");

    const assessed = await createTeam(db, event.id, a.id, NOW);
    await db.insert(s.founderAssessments).values({ teamId: assessed.id, problemScore: 3 });
    expect((await caught(deleteTeam(db, event.id, assessed.id))).code).toBe("TEAM_NOT_EMPTY");

    const withArtifact = await createTeam(db, event.id, a.id, NOW);
    await db.insert(s.artifacts).values({
      eventId: event.id,
      teamId: withArtifact.id,
      storagePath: "db:test",
      contentType: "image/jpeg",
      sizeBytes: 10,
    });
    expect((await caught(deleteTeam(db, event.id, withArtifact.id))).code).toBe("TEAM_NOT_EMPTY");

    const withEvidence = await createTeam(db, event.id, a.id, NOW);
    await db.insert(s.evidenceItems).values({
      eventId: event.id,
      teamId: withEvidence.id,
      sourceType: "FOUNDER_TEAM_SCORE",
      scope: "TEAM",
      rawCode: "PROBLEM_SCORE",
      sourceWeight: 0.5,
      originRef: `founder_assessment:${withEvidence.id}`,
    });
    expect((await caught(deleteTeam(db, event.id, withEvidence.id))).code).toBe("TEAM_NOT_EMPTY");

    const empty = await createTeam(db, event.id, a.id, NOW);
    await deleteTeam(db, event.id, empty.id);
    await deleteTeam(db, event.id, empty.id); // doble tap
    const ids = (await teamsOf(event.id)).map((t) => t.id);
    expect(ids).toContain(full.id);
    expect(ids).toContain(assessed.id);
    expect(ids).toContain(withArtifact.id);
    expect(ids).toContain(withEvidence.id);
    expect(ids).not.toContain(empty.id);
  });

  it("createTeam con doble tap devuelve el mismo equipo vacío", async () => {
    const { db, event, challenges } = await setup();
    const [a, b] = challenges;
    await addPeople(event.id, 3, { firstChoiceId: a.id });
    await generateTeams(db, event.id);

    const first = await createTeam(db, event.id, b.id, NOW);
    const again = await createTeam(db, event.id, b.id, NOW);
    expect(again.id).toBe(first.id);
    expect(await teamsOf(event.id)).toHaveLength(2);

    // Con alguien adentro ya no está vacío: el siguiente pedido crea otro.
    const [late] = await addPeople(event.id, 1, { firstChoiceId: b.id });
    await moveParticipant(db, event.id, late.id, first.id);
    const next = await createTeam(db, event.id, b.id, NOW);
    expect(next).toMatchObject({ challengeId: b.id, teamNumber: 2, tableNumber: 3 });

    // "Crear equipo" y después "nuevo equipo con estas personas": no queda uno vacío colgado.
    const lateB = (await addPeople(event.id, 3, { firstChoiceId: b.id })).map((p) => p.id);
    const withMembers = await createTeamWithMembers(db, event.id, b.id, lateB, NOW);
    expect(withMembers.id).toBe(next.id);
    expect(await teamsOf(event.id)).toHaveLength(3);
  });

  it("setTableNumber intercambia mesas si ya estaba ocupada", async () => {
    const { db, event, challenges } = await setup();
    const [a] = challenges;
    await addPeople(event.id, 6, { firstChoiceId: a.id });
    await generateTeams(db, event.id);
    const [t1, t2] = await teamsOf(event.id);
    expect([t1.tableNumber, t2.tableNumber]).toEqual([1, 2]);

    await setTableNumber(db, event.id, t1.id, 2);
    let byId = new Map((await teamsOf(event.id)).map((t) => [t.id, t.tableNumber]));
    expect(byId.get(t1.id)).toBe(2);
    expect(byId.get(t2.id)).toBe(1);

    await setTableNumber(db, event.id, t1.id, 10);
    await setTableNumber(db, event.id, t1.id, 10);
    byId = new Map((await teamsOf(event.id)).map((t) => [t.id, t.tableNumber]));
    expect(byId.get(t1.id)).toBe(10);
    expect(byId.get(t2.id)).toBe(1);

    for (const bad of [0, 1000, 2.5, -3]) {
      expect((await caught(setTableNumber(db, event.id, t1.id, bad))).code).toBe("INVALID_TABLE");
    }
  });
});

describe("getTeamsBoard", () => {
  it("ordena por mesa, informa evaluación/artefactos y advierte equipos fuera de rango", async () => {
    const { db, event, challenges } = await setup();
    const [a, b] = challenges;
    const as = await addPeople(event.id, 8, { firstChoiceId: a.id });
    await addPeople(event.id, 3, { firstChoiceId: b.id });
    await generateTeams(db, event.id);
    const teams = await teamsOf(event.id);
    const [a1, a2] = teams.filter((t) => t.challengeId === a.id);
    const [b1] = teams.filter((t) => t.challengeId === b.id);

    const rows = await participationsOf(event.id);
    expect(rows.filter((r) => as.some((p) => p.id === r.id) && r.teamId !== null)).toHaveLength(8);
    const a1Members = rows.filter((r) => r.teamId === a1.id).map((r) => r.id);
    expect(a1Members).toHaveLength(4);
    await moveParticipant(db, event.id, a1Members[0], a2.id);
    await moveParticipant(db, event.id, a1Members[1], a2.id);
    await moveParticipant(db, event.id, a1Members[2], null);

    await db.insert(s.founderAssessments).values({ teamId: b1.id, winner: true });
    await db.insert(s.artifacts).values({
      eventId: event.id,
      teamId: b1.id,
      storagePath: "db:test",
      contentType: "image/jpeg",
      sizeBytes: 10,
    });
    await db.update(s.challenges).set({ active: false }).where(eq(s.challenges.id, a.id));

    const board = await getTeamsBoard(db, event.id);
    expect(board).toMatchObject({ eventId: event.id, phase: "MATCHING", published: false });
    expect(board.challenges.map((c) => [c.id, c.active])).toEqual([
      [a.id, false],
      [b.id, true],
      [challenges[2].id, true],
    ]);
    expect(board.teams.map((t) => t.tableNumber)).toEqual([1, 2, 3]);
    const boardA1 = board.teams.find((t) => t.id === a1.id)!;
    const boardA2 = board.teams.find((t) => t.id === a2.id)!;
    const boardB1 = board.teams.find((t) => t.id === b1.id)!;
    expect(boardA1.members).toHaveLength(1);
    expect(boardA2.members).toHaveLength(6);
    expect(boardB1).toMatchObject({ hasAssessment: true, winner: true, artifactCount: 1 });
    expect(boardA1).toMatchObject({ hasAssessment: false, winner: false, artifactCount: 0 });
    expect(boardB1.startupName).toBe(challenges[1].startupName);
    expect(boardB1.challengeTitle).toBe(challenges[1].title);
    const names = boardA2.members.map((m) => m.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y, "es")));
    expect(boardA2.members[0].whatsapp).toMatch(/^\+549351/);

    expect(board.unassigned.map((p) => p.participationId)).toEqual([a1Members[2]]);
    const codes = board.warnings.map((w) => w.code);
    expect(codes).toContain("UNASSIGNED");
    expect(codes).toContain("TEAM_TOO_SMALL");
    expect(codes).toContain("TEAM_TOO_BIG");
    expect(codes.filter((c) => c === "INACTIVE_CHALLENGE")).toHaveLength(2);
    expect(board.warnings.find((w) => w.code === "UNASSIGNED")!.message).toBe(
      "Hay 1 persona presente sin equipo.",
    );
  });
});

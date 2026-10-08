import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import { deleteChallenge, setEventPhase } from "@/lib/services/events";
import { generateTeams, publishTeams } from "@/lib/services/teams";
import { closeTestDb, makeChallenges, makeEvent, makeRegistered, resetDb, testDb } from "./helpers";

const db = testDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await closeTestDb();
});

describe("deleteChallenge", () => {
  it("borra un desafío sin inscripciones y permite repetir el borrado", async () => {
    const event = await makeEvent(db);
    const [challenge] = await makeChallenges(db, event.id, 1);

    await deleteChallenge(db, event.id, challenge.id);
    await deleteChallenge(db, event.id, challenge.id);

    expect(await db.select().from(s.challenges)).toEqual([]);
  });

  it("conserva las inscripciones y vacía únicamente las preferencias del desafío eliminado", async () => {
    const event = await makeEvent(db);
    const [removed, kept, another] = await makeChallenges(db, event.id, 3);
    const choices = [
      { firstChoiceId: removed.id, secondChoiceId: kept.id },
      { firstChoiceId: kept.id, secondChoiceId: removed.id, checkedIn: true },
      { firstChoiceId: removed.id, secondChoiceAny: true, checkedIn: true },
      { firstChoiceId: kept.id, secondChoiceId: another.id },
      { firstChoiceId: null, secondChoiceAny: true },
    ];
    const people = [];
    for (const choice of choices) people.push(await makeRegistered(db, event.id, choice));
    const participantsBefore = await db.select().from(s.participants).orderBy(s.participants.id);

    await deleteChallenge(db, event.id, removed.id);

    const rows = await db.select().from(s.participations);
    expect(rows).toHaveLength(people.length);
    for (const { participation } of people) {
      expect(rows.find((row) => row.id === participation.id)).toEqual({
        ...participation,
        firstChoiceId: participation.firstChoiceId === removed.id ? null : participation.firstChoiceId,
        secondChoiceId: participation.secondChoiceId === removed.id ? null : participation.secondChoiceId,
      });
    }
    expect(await db.select().from(s.participants).orderBy(s.participants.id)).toEqual(participantsBefore);
    expect(await db.query.challenges.findFirst({ where: eq(s.challenges.id, removed.id) })).toBeUndefined();
    expect(await db.select().from(s.challenges).orderBy(s.challenges.sortOrder)).toEqual([kept, another]);
  });

  it.each([false, true])("protege equipos y evaluaciones sin vaciar preferencias (publicado: %s)", async (published) => {
    const event = await makeEvent(db);
    const [challenge] = await makeChallenges(db, event.id, 1);
    const { participation } = await makeRegistered(db, event.id, {
      firstChoiceId: challenge.id,
      secondChoiceAny: true,
    });
    const [team] = await db.insert(s.teams).values({
      eventId: event.id,
      challengeId: challenge.id,
      teamNumber: 1,
      tableNumber: 1,
      publishedAt: published ? new Date() : null,
    }).returning();
    const [assessment] = await db.insert(s.founderAssessments).values({
      teamId: team.id,
      problemScore: 4,
      valueScore: 5,
      feedback: "Conservar esta evaluación",
    }).returning();

    await expect(deleteChallenge(db, event.id, challenge.id)).rejects.toMatchObject({
      code: "CHALLENGE_IN_USE",
    });

    expect(await db.select().from(s.challenges)).toEqual([challenge]);
    expect(await db.select().from(s.participations)).toEqual([participation]);
    expect(await db.select().from(s.teams)).toEqual([team]);
    expect(await db.select().from(s.founderAssessments)).toEqual([assessment]);
  });

  it("borra una preferencia sin alterar el equipo asignado a otro desafío ni su evaluación", async () => {
    const event = await makeEvent(db);
    const [removed, assigned] = await makeChallenges(db, event.id, 2);
    const { participation } = await makeRegistered(db, event.id, {
      firstChoiceId: removed.id,
      secondChoiceId: assigned.id,
      checkedIn: true,
    });
    const [team] = await db.insert(s.teams).values({
      eventId: event.id,
      challengeId: assigned.id,
      teamNumber: 1,
      tableNumber: 1,
      publishedAt: new Date(),
    }).returning();
    const [matched] = await db.update(s.participations).set({
      teamId: team.id,
      status: "MATCHED",
      assignmentSource: "SECOND_CHOICE",
    }).where(eq(s.participations.id, participation.id)).returning();
    const [assessment] = await db.insert(s.founderAssessments).values({
      teamId: team.id,
      problemScore: 3,
      feedback: "Evaluación existente",
    }).returning();

    await deleteChallenge(db, event.id, removed.id);

    expect(await db.select().from(s.participations)).toEqual([{ ...matched, firstChoiceId: null }]);
    expect(await db.select().from(s.teams)).toEqual([team]);
    expect(await db.select().from(s.founderAssessments)).toEqual([assessment]);
  });

  it("no borra ni vacía preferencias de un desafío de otro evento", async () => {
    const event = await makeEvent(db);
    const otherEvent = await makeEvent(db);
    const [challenge] = await makeChallenges(db, otherEvent.id, 1);
    const { participation } = await makeRegistered(db, otherEvent.id, {
      firstChoiceId: challenge.id,
      secondChoiceAny: true,
    });

    await deleteChallenge(db, event.id, challenge.id);

    expect(await db.select().from(s.challenges)).toEqual([challenge]);
    expect(await db.select().from(s.participations)).toEqual([participation]);
  });
});

describe("setEventPhase", () => {
  it("no deja pasar al sprint/pitch/reflexión sin equipos publicados, pero sí cerrar", async () => {
    const event = await makeEvent(db, { phase: "MATCHING" });
    for (const phase of ["SPRINT", "PITCH", "REFLECTION"] as const) {
      await expect(setEventPhase(db, event.id, phase)).rejects.toMatchObject({ code: "PUBLISH_FIRST" });
    }
    expect((await setEventPhase(db, event.id, "CLOSED")).phase).toBe("CLOSED");
  });

  it("con equipos publicados no vuelve atrás y al abrir la reflexión MATCHED → EXPERIENCE_COMPLETED", async () => {
    const event = await makeEvent(db, { phase: "MATCHING" });
    const [a] = await makeChallenges(db, event.id, 1);
    const people = [];
    for (let i = 0; i < 3; i++) people.push(await makeRegistered(db, event.id, { firstChoiceId: a.id, checkedIn: true }));
    await generateTeams(db, event.id);
    await publishTeams(db, event.id);
    await expect(setEventPhase(db, event.id, "MATCHING")).rejects.toMatchObject({ code: "TEAMS_PUBLISHED" });
    await setEventPhase(db, event.id, "PITCH");
    await setEventPhase(db, event.id, "REFLECTION");
    const rows = await db.select().from(s.participations).where(eq(s.participations.eventId, event.id));
    expect(rows.every((r) => r.status === "EXPERIENCE_COMPLETED")).toBe(true);
    // Repetir la misma fase no hace nada.
    expect((await setEventPhase(db, event.id, "REFLECTION")).phase).toBe("REFLECTION");
  });

  it("antes de publicar se puede volver a una fase anterior", async () => {
    const event = await makeEvent(db, { phase: "MATCHING" });
    expect((await setEventPhase(db, event.id, "CHECKIN")).phase).toBe("CHECKIN");
    await expect(setEventPhase(db, event.id, "NOPE" as "CHECKIN")).rejects.toMatchObject({ code: "INVALID_PHASE" });
  });
});

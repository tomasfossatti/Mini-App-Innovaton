import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import { setEventPhase } from "@/lib/services/events";
import { generateTeams, publishTeams } from "@/lib/services/teams";
import { closeTestDb, makeChallenges, makeEvent, makeRegistered, resetDb, testDb } from "./helpers";

const db = testDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await closeTestDb();
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

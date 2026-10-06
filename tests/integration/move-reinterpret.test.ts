import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import { saveFounderAssessment } from "@/lib/services/founder";
import { getOutcome, submitReflection } from "@/lib/services/reflection";
import { moveParticipant } from "@/lib/services/teams";
import { closeTestDb, makeChallenges, makeEvent, makeRegistered, resetDb, testDb } from "./helpers";

const db = testDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await closeTestDb();
});

describe("mover a alguien que ya reflexionó", () => {
  it("re-interpreta con la evidencia del equipo nuevo", async () => {
    const event = await makeEvent(db, { phase: "REFLECTION" });
    const [challenge] = await makeChallenges(db, event.id, 1);
    const now = new Date();
    const [t1, t2] = await db
      .insert(s.teams)
      .values([
        { eventId: event.id, challengeId: challenge.id, teamNumber: 1, tableNumber: 1, publishedAt: now },
        { eventId: event.id, challengeId: challenge.id, teamNumber: 2, tableNumber: 2, publishedAt: now },
      ])
      .returning();
    // El equipo 1 tiene Prueba = 5 del founder; el equipo 2 no tiene evaluación.
    await saveFounderAssessment(db, event.id, t1.id, { problemScore: null, valueScore: null, testScore: 5, feedback: null, winner: false }, null);
    const { participation } = await makeRegistered(db, event.id, { firstChoiceId: challenge.id, mode: "DRIVE", checkedIn: true });
    await db
      .update(s.participations)
      .set({ teamId: t2.id, status: "EXPERIENCE_COMPLETED", assignmentSource: "FIRST_CHOICE" })
      .where(eq(s.participations.id, participation.id));

    await submitReflection(db, event, participation.id, {
      postClarity: 4,
      selectedActions: ["CREATED_TEST"],
      primaryContributionText: null,
      primaryCapability: "EXPERIMENTATION",
      perceivedValue: 4,
      initialModeUsefulness: 4,
    });
    const before = await getOutcome(db, participation.id);
    expect(before?.interpretation.primary).toBe("EXPERIMENTATION");
    expect(before?.interpretation.primaryLevel).toBe("SIGNAL");

    await moveParticipant(db, event.id, participation.id, t1.id);
    const after = await getOutcome(db, participation.id);
    expect(after?.interpretation.id).not.toBe(before?.interpretation.id);
    expect(after?.interpretation.primaryLevel).toBe("CONVERGENT");
    const row = await db.query.participations.findFirst({ where: eq(s.participations.id, participation.id) });
    expect(row?.status).toBe("INTERPRETED");
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import { saveA3Blocks, saveFounderAssessment } from "@/lib/services/founder";
import { assignLatecomer, boardVersion, generateTeams, getTeamsBoard, moveParticipant, publishTeams } from "@/lib/services/teams";
import { closeTestDb, makeChallenges, makeEvent, makeRegistered, resetDb, testDb } from "./helpers";

// Defensas contra vistas viejas: dos personas del staff mirando la misma pantalla.

const db = testDb();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await closeTestDb();
});

async function matchingEvent(people: number) {
  const event = await makeEvent(db, { phase: "MATCHING" });
  const [a, b] = await makeChallenges(db, event.id, 2);
  const ps = [];
  for (let i = 0; i < people; i++) ps.push(await makeRegistered(db, event.id, { firstChoiceId: a.id, secondChoiceId: b.id, checkedIn: true }));
  return { event, a, b, ps };
}

describe("tablero desactualizado", () => {
  it("generar o publicar con una versión vieja se rechaza", async () => {
    const { event, ps } = await matchingEvent(6);
    const empty = boardVersion(await getTeamsBoard(db, event.id));
    await generateTeams(db, event.id, { expectedVersion: empty });
    const afterGen = boardVersion(await getTeamsBoard(db, event.id));
    // Otra persona ajusta a mano.
    const board = await getTeamsBoard(db, event.id);
    await moveParticipant(db, event.id, ps[0].participation.id, board.teams[1].id === (await db.query.participations.findFirst({ where: eq(s.participations.id, ps[0].participation.id) }))?.teamId ? board.teams[0].id : board.teams[1].id);
    await expect(generateTeams(db, event.id, { expectedVersion: afterGen })).rejects.toMatchObject({ code: "STALE_BOARD" });
    await expect(publishTeams(db, event.id, new Date(), { expectedVersion: afterGen })).rejects.toMatchObject({ code: "STALE_BOARD" });
    const fresh = boardVersion(await getTeamsBoard(db, event.id));
    const res = await publishTeams(db, event.id, new Date(), { expectedVersion: fresh });
    expect(res.alreadyPublished).toBe(false);
  });
});

describe("quinto excepcional", () => {
  it("sumar a un equipo de 4 exige confirmación explícita", async () => {
    const { event, a } = await matchingEvent(4);
    await generateTeams(db, event.id);
    await publishTeams(db, event.id);
    const [team] = (await getTeamsBoard(db, event.id)).teams;
    expect(team.members).toHaveLength(4);
    const late = await makeRegistered(db, event.id, { firstChoiceId: a.id, checkedIn: true });
    await expect(assignLatecomer(db, event.id, late.participation.id, team.id, { allowFifth: false })).rejects.toMatchObject({
      code: "NEEDS_FIFTH_CONFIRMATION",
    });
    await assignLatecomer(db, event.id, late.participation.id, team.id, { allowFifth: true });
    expect((await getTeamsBoard(db, event.id)).teams[0].members).toHaveLength(5);
  });
});

describe("evaluación y A3 con dos personas", () => {
  it("no pisa una evaluación que guardó otra persona", async () => {
    const { event } = await matchingEvent(3);
    await generateTeams(db, event.id);
    const [team] = (await getTeamsBoard(db, event.id)).teams;
    const input = { problemScore: 4, valueScore: 5, testScore: 3, feedback: null, winner: false };
    const first = await saveFounderAssessment(db, event.id, team.id, input, null, { expectedUpdatedAt: null });
    // Un formulario abierto antes (sin evaluación) intenta guardar.
    await expect(
      saveFounderAssessment(db, event.id, team.id, { ...input, problemScore: null, winner: true }, null, { expectedUpdatedAt: null }),
    ).rejects.toMatchObject({ code: "STALE_ASSESSMENT" });
    // Con la versión correcta, sí.
    const second = await saveFounderAssessment(db, event.id, team.id, { ...input, winner: true }, null, {
      expectedUpdatedAt: first.updatedAt.toISOString(),
    });
    expect(second.winner).toBe(true);
    expect(second.problemScore).toBe(4);
  });

  it("no pisa los bloques del A3 que marcó otra persona", async () => {
    const { event } = await matchingEvent(3);
    await generateTeams(db, event.id);
    const [team] = (await getTeamsBoard(db, event.id)).teams;
    await saveA3Blocks(db, event.id, team.id, ["PROBLEM"], { expectedBlocks: [] });
    await expect(saveA3Blocks(db, event.id, team.id, ["TEST"], { expectedBlocks: [] })).rejects.toMatchObject({ code: "STALE_A3" });
    // Doble tap con el mismo contenido no es conflicto.
    await saveA3Blocks(db, event.id, team.id, ["PROBLEM"], { expectedBlocks: [] });
    await saveA3Blocks(db, event.id, team.id, ["PROBLEM", "TEST"], { expectedBlocks: ["PROBLEM"] });
    const row = await db.query.teams.findFirst({ where: eq(s.teams.id, team.id) });
    expect(row?.a3Blocks).toEqual(["PROBLEM", "TEST"]);
  });
});

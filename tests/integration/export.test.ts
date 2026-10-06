import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import { generateToken, sha256 } from "@/lib/auth/crypto";
import { DomainError } from "@/lib/services/errors";
import { exportBackupJson, exportParticipantsCsv, getPrintData } from "@/lib/services/export";
import { staffQuickAdd } from "@/lib/services/operations";
import { closeTestDb, makeChallenges, makeEvent, makeRegistered, resetDb, testDb } from "./helpers";

const db = testDb();
const NOW = new Date("2026-10-15T17:22:00.000Z"); // 14:22 en Córdoba

beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const HEADER =
  "nombre,whatsapp,estado,modo_inicial,primera_opcion,segunda_opcion,presente,hora_checkin," +
  "desafio_asignado,equipo,mesa,equipos_publicados,consentimiento_operativo,consentimiento_comunidad,alta_staff";

/**
 * Escenario: desafíos A, B, C (C inactivo). Equipo publicado en mesa 2 (A) y borrador en mesa 1 (B).
 */
async function scenario() {
  const event = await makeEvent(db, { phase: "SPRINT", slug: "innovaton-test" });
  const [a, b, c] = await makeChallenges(db, event.id, 3);
  await db.update(s.challenges).set({ active: false }).where(eq(s.challenges.id, c.id));

  const tA = (
    await db
      .insert(s.teams)
      .values({ eventId: event.id, challengeId: a.id, teamNumber: 1, tableNumber: 2, publishedAt: NOW })
      .returning()
  )[0];
  const tB = (
    await db
      .insert(s.teams)
      .values({ eventId: event.id, challengeId: b.id, teamNumber: 1, tableNumber: 1 })
      .returning()
  )[0];

  const checkedInAt = new Date("2026-10-15T17:21:00.000Z"); // 14:21
  const zoe = await makeRegistered(db, event.id, {
    name: "Zoe",
    firstChoiceId: a.id,
    secondChoiceAny: true,
    mode: "EXPLORE",
    checkedIn: true,
    checkedInAt,
  });
  const ana = await makeRegistered(db, event.id, {
    name: "Ana",
    firstChoiceId: a.id,
    secondChoiceId: b.id,
    mode: "DRIVE",
    checkedIn: true,
    checkedInAt,
  });
  const bruno = await makeRegistered(db, event.id, {
    name: "Bruno",
    firstChoiceId: b.id,
    secondChoiceId: a.id,
    mode: "CREATE",
    checkedIn: true,
    checkedInAt,
  });
  const carla = await makeRegistered(db, event.id, {
    name: "Carla",
    firstChoiceId: b.id,
    secondChoiceAny: true,
    mode: "CREATE",
  });
  await db
    .update(s.participations)
    .set({ teamId: tA.id, status: "MATCHED", communityConsentAt: NOW })
    .where(eq(s.participations.id, ana.participation.id));
  await db
    .update(s.participations)
    .set({ teamId: tA.id, status: "MATCHED" })
    .where(eq(s.participations.id, zoe.participation.id));
  await db
    .update(s.participations)
    .set({ teamId: tB.id })
    .where(eq(s.participations.id, bruno.participation.id));

  const diego = await staffQuickAdd(
    db,
    event,
    { name: "Diego", whatsapp: "+5493517654321", firstChoiceId: a.id, secondChoiceId: null, secondChoiceAny: true },
    checkedInAt,
  );

  // Recorrido sin inscripción: no aparece en el CSV ni en la hoja.
  const [anonymous] = await db
    .insert(s.participations)
    .values({ eventId: event.id, resumeTokenHash: sha256(generateToken()), status: "STARTED", preClarity: 2 })
    .returning();

  return { event, a, b, c, tA, tB, zoe, ana, bruno, carla, diego, anonymous };
}

function parseCsv(csv: string): string[][] {
  return csv
    .replace(/^﻿/, "")
    .split("\r\n")
    .filter((line) => line !== "")
    .map((line) => line.split(","));
}

describe("exportParticipantsCsv", () => {
  it("genera el CSV de contingencia con header exacto, orden y valores legibles", async () => {
    const { event, a, b, ana } = await scenario();
    const { filename, csv } = await exportParticipantsCsv(db, event.id, NOW);

    expect(filename).toBe("innovaton-innovaton-test-20261015-1422.csv");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\r\n")[0]).toBe(`﻿${HEADER}`);

    const [header, ...rows] = parseCsv(csv);
    expect(header.join(",")).toBe(HEADER);
    // Orden: primera opción (A antes que B) y luego nombre. Sin el recorrido anónimo.
    expect(rows.map((r) => r[0])).toEqual(["Ana", "Diego", "Zoe", "Bruno", "Carla"]);

    const byName = new Map(rows.map((r) => [r[0], r]));
    expect(byName.get("Ana")).toEqual([
      "Ana",
      ana.participant.whatsappNormalized,
      "MATCHED",
      "Impulsar",
      a.startupName,
      b.startupName,
      "sí",
      "14:21",
      a.startupName,
      "1",
      "2",
      "sí",
      "sí",
      "sí",
      "no",
    ]);
    expect(byName.get("Zoe")?.[5]).toBe("Cualquiera");
    expect(byName.get("Bruno")?.slice(7, 12)).toEqual(["14:21", b.startupName, "1", "1", "no"]);
    expect(byName.get("Carla")?.slice(2, 12)).toEqual([
      "REGISTERED",
      "Crear",
      b.startupName,
      "Cualquiera",
      "no",
      "",
      "",
      "",
      "",
      "",
    ]);
    expect(byName.get("Diego")).toEqual([
      "Diego",
      "+5493517654321",
      "CHECKED_IN",
      "",
      a.startupName,
      "Cualquiera",
      "sí",
      "14:21",
      "",
      "",
      "",
      "",
      "sí",
      "no",
      "sí",
    ]);
    // El teléfono va intacto (sin apóstrofo anti-fórmula).
    expect(csv).toContain(",+5493517654321,");
    expect(csv).not.toContain("'+549");
  });

  it("protege fórmulas y respeta comas y comillas en los nombres", async () => {
    const event = await makeEvent(db, { slug: "csv-raro" });
    const [a] = await makeChallenges(db, event.id, 1);
    await makeRegistered(db, event.id, { name: "=HYPERLINK(\"x\")", firstChoiceId: a.id, secondChoiceAny: true });
    await makeRegistered(db, event.id, { name: "Pérez, Juan", firstChoiceId: a.id, secondChoiceAny: true });

    const { csv } = await exportParticipantsCsv(db, event.id, NOW);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[1].startsWith('"\'=HYPERLINK(""x"")",')).toBe(true);
    expect(lines[2].startsWith('"Pérez, Juan",+549')).toBe(true);
  });

  it("funciona dentro de una transacción abierta (usa esa misma foto)", async () => {
    const { event } = await scenario();
    const result = await db.transaction(async (tx) => {
      await tx.insert(s.participants).values({ name: "Sin commit", whatsappNormalized: "+5493517000009" });
      const [person] = await tx
        .select()
        .from(s.participants)
        .where(eq(s.participants.whatsappNormalized, "+5493517000009"));
      await tx.insert(s.participations).values({
        eventId: event.id,
        participantId: person.id,
        resumeTokenHash: sha256(generateToken()),
        status: "REGISTERED",
        registeredAt: NOW,
        operationalConsentAt: NOW,
      });
      return exportParticipantsCsv(tx, event.id, NOW);
    });
    expect(result.csv).toContain("Sin commit,+5493517000009,REGISTERED");
  });

  it("evento sin inscriptos: solo el header", async () => {
    const event = await makeEvent(db, { slug: "vacio" });
    const { csv } = await exportParticipantsCsv(db, event.id, NOW);
    expect(parseCsv(csv)).toEqual([HEADER.split(",")]);
  });

  it("evento inexistente → EVENT_NOT_FOUND", async () => {
    const err = await exportParticipantsCsv(db, "00000000-0000-0000-0000-000000000000").catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe("EVENT_NOT_FOUND");
  });
});

describe("exportBackupJson", () => {
  it("vuelca todo el evento sin tokens ni bytes", async () => {
    const { event, a, tA, ana, zoe } = await scenario();

    // Datos de las etapas finales.
    await db.insert(s.questionnaireAnswers).values({
      participationId: ana.participation.id,
      questionKey: "Q1",
      selectedMode: "DRIVE",
    });
    await db.insert(s.reflections).values({
      participationId: ana.participation.id,
      postClarity: 4,
      perceivedValue: 5,
      initialModeUsefulness: 4,
      selectedActions: ["PRESENTED"],
      primaryCapability: "COMMUNICATION",
    });
    await db.insert(s.founderAssessments).values({ teamId: tA.id, problemScore: 3, valueScore: 2, testScore: 3 });
    await db.insert(s.founderObservations).values({
      eventId: event.id,
      teamId: tA.id,
      participationId: zoe.participation.id,
      capability: "IDEATION",
      observerSource: "FOUNDER_INDIVIDUAL",
    });
    const [blob] = await db
      .insert(s.artifactBlobs)
      .values({ data: Buffer.from("bytes-secretos") })
      .returning();
    await db.insert(s.artifacts).values({
      eventId: event.id,
      teamId: tA.id,
      storagePath: `db:${blob.id}`,
      contentType: "image/jpeg",
      sizeBytes: 14,
    });
    const [item] = await db
      .insert(s.evidenceItems)
      .values({
        eventId: event.id,
        participationId: ana.participation.id,
        sourceType: "SELF_REPORT_ACTION",
        scope: "INDIVIDUAL",
        rawCode: "PRESENTED",
        sourceWeight: 1,
        originRef: "reflection:x",
      })
      .returning();
    await db.insert(s.capabilitySignals).values({ evidenceItemId: item.id, capability: "COMMUNICATION", strength: 1 });
    const [snapshot] = await db
      .insert(s.interpretationSnapshots)
      .values({
        participationId: ana.participation.id,
        algorithmVersion: "test",
        type: "INSUFFICIENT",
        summary: "resumen",
        evidenceSnapshot: { a: 1 },
      })
      .returning();
    await db.insert(s.recommendations).values({
      interpretationId: snapshot.id,
      capability: "COMMUNICATION",
      type: "GATHER_MORE_EVIDENCE",
      action: "hacer algo",
      rationale: "porque sí",
    });

    // Otro evento con su propia gente: no se mezcla.
    const other = await makeEvent(db, { slug: "otro" });
    const [otherChallenge] = await makeChallenges(db, other.id, 1);
    const outsider = await makeRegistered(db, other.id, { firstChoiceId: otherChallenge.id, secondChoiceAny: true });

    const { filename, data } = await exportBackupJson(db, event.id, NOW);
    expect(filename).toBe("innovaton-innovaton-test-backup-20261015-1422.json");
    expect(Object.keys(data).sort()).toEqual(
      [
        "exportedAt",
        "event",
        "challenges",
        "participants",
        "participations",
        "questionnaireAnswers",
        "teams",
        "reflections",
        "founderAssessments",
        "founderObservations",
        "artifacts",
        "evidenceItems",
        "capabilitySignals",
        "interpretationSnapshots",
        "recommendations",
      ].sort(),
    );
    expect(data.exportedAt).toBe(NOW.toISOString());
    expect((data.event as { id: string }).id).toBe(event.id);

    const len = (key: string) => (data[key] as unknown[]).length;
    expect(len("challenges")).toBe(3);
    expect(len("participants")).toBe(5);
    expect(len("participations")).toBe(6);
    expect(len("questionnaireAnswers")).toBe(1);
    expect(len("teams")).toBe(2);
    expect(len("reflections")).toBe(1);
    expect(len("founderAssessments")).toBe(1);
    expect(len("founderObservations")).toBe(1);
    expect(len("artifacts")).toBe(1);
    expect(len("evidenceItems")).toBe(1);
    expect(len("capabilitySignals")).toBe(1);
    expect(len("interpretationSnapshots")).toBe(1);
    expect(len("recommendations")).toBe(1);

    const participations = data.participations as Record<string, unknown>[];
    for (const p of participations) expect(p).not.toHaveProperty("resumeTokenHash");
    expect(participations[0]).toHaveProperty("firstChoiceId");
    const participantIds = (data.participants as { id: string }[]).map((p) => p.id);
    expect(participantIds).not.toContain(outsider.participant.id);
    expect((data.artifacts as Record<string, unknown>[])[0]).not.toHaveProperty("data");
    expect((data.challenges as { id: string }[])[0].id).toBe(a.id);

    const json = JSON.stringify(data);
    expect(json).not.toContain(ana.participation.resumeTokenHash);
    expect(json).not.toContain("resumeTokenHash");
    expect(json).not.toContain(Buffer.from("bytes-secretos").toString("base64"));
    expect(JSON.parse(json).event.slug).toBe("innovaton-test");
  });

  it("dentro de una transacción abierta también exporta (sin abrir otra foto)", async () => {
    const { event } = await scenario();
    const { data } = await db.transaction((tx) => exportBackupJson(tx, event.id, NOW));
    expect((data.participations as unknown[]).length).toBe(6);
    expect((data.teams as unknown[]).length).toBe(2);
  });

  it("evento inexistente → EVENT_NOT_FOUND", async () => {
    const err = await exportBackupJson(db, "no-es-uuid", NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe("EVENT_NOT_FOUND");
  });

  it("evento sin datos: claves presentes con listas vacías", async () => {
    const event = await makeEvent(db, { slug: "vacio" });
    const { data } = await exportBackupJson(db, event.id, NOW);
    expect(data.participants).toEqual([]);
    expect(data.participations).toEqual([]);
    expect(data.recommendations).toEqual([]);
    expect(data.capabilitySignals).toEqual([]);
  });
});

describe("getPrintData", () => {
  it("arma la hoja imprimible: desafíos activos, equipos por mesa e inscriptos por nombre", async () => {
    const { event, a, b, ana, zoe, diego } = await scenario();
    const print = await getPrintData(db, event.id);

    expect(print.event.id).toBe(event.id);
    expect(print.challenges).toEqual([
      { id: a.id, startupName: a.startupName, title: a.title, brief: a.brief, prize: a.prize },
      { id: b.id, startupName: b.startupName, title: b.title, brief: b.brief, prize: b.prize },
    ]);
    expect(print.teams).toEqual([
      { tableNumber: 1, startupName: b.startupName, teamNumber: 1, published: false, members: ["Bruno"] },
      { tableNumber: 2, startupName: a.startupName, teamNumber: 1, published: true, members: ["Ana", "Zoe"] },
    ]);
    expect(print.people.map((p) => p.name)).toEqual(["Ana", "Bruno", "Carla", "Diego", "Zoe"]);
    expect(print.people[0]).toEqual({
      name: "Ana",
      whatsapp: ana.participant.whatsappNormalized,
      firstChoice: a.startupName,
      secondChoice: b.startupName,
      present: true,
      table: 2,
    });
    expect(print.people.find((p) => p.name === "Zoe")).toMatchObject({
      whatsapp: zoe.participant.whatsappNormalized,
      secondChoice: "Cualquiera",
      table: 2,
    });
    expect(print.people.find((p) => p.name === "Carla")).toMatchObject({ present: false, table: null });
    expect(print.people.find((p) => p.name === "Diego")).toMatchObject({ present: true, table: null });
    expect(diego.created).toBe(true);
  });
});

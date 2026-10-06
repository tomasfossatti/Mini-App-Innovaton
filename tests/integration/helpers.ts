import { sql } from "drizzle-orm";
import { createDb, type DB } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { EventPhase, Mode } from "@/lib/domain/constants";
import { generateToken, sha256 } from "@/lib/auth/crypto";

let cached: ReturnType<typeof createDb> | null = null;

/** Conexión a la base de tests (innovaton_test, ver .env.test). */
export function testDb(): DB {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url || !url.includes("test")) {
      throw new Error("Los tests de integración requieren DATABASE_URL apuntando a una base *_test");
    }
    cached = createDb(url, { max: 10 });
  }
  return cached.db;
}

/** Segunda conexión independiente (para simular dos staff en paralelo). */
export function secondTestDb(): ReturnType<typeof createDb> {
  return createDb(process.env.DATABASE_URL!, { max: 5 });
}

export async function closeTestDb(): Promise<void> {
  if (cached) {
    await cached.sql.end({ timeout: 5 });
    cached = null;
  }
}

const TABLES = [
  "recommendations",
  "interpretation_snapshots",
  "capability_signals",
  "evidence_items",
  "founder_observations",
  "founder_assessments",
  "artifacts",
  "artifact_blobs",
  "reflections",
  "questionnaire_answers",
  "participations",
  "teams",
  "challenges",
  "events",
  "participants",
  "staff_sessions",
  "staff_members",
];

export async function resetDb(db: DB = testDb()): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`));
}

export async function makeEvent(
  db: DB,
  opts: { phase?: EventPhase; slug?: string; communityUrl?: string | null } = {},
) {
  const base = new Date("2026-10-15T17:00:00.000Z"); // 14:00 en Córdoba
  const [event] = await db
    .insert(s.events)
    .values({
      slug: opts.slug ?? `evento-${Math.random().toString(36).slice(2, 8)}`,
      name: "Innovatón TEST",
      registrationOpensAt: new Date(base.getTime() - 3 * 3600_000),
      checkinOpensAt: new Date(base.getTime() + 20 * 60_000),
      registrationClosesAt: new Date(base.getTime() + 25 * 60_000),
      startsAt: new Date(base.getTime() + 30 * 60_000),
      endsAt: new Date(base.getTime() + 95 * 60_000),
      phase: opts.phase ?? "REGISTRATION",
      communityUrl: opts.communityUrl ?? null,
    })
    .returning();
  return event;
}

export async function makeChallenges(db: DB, eventId: string, count: number) {
  const values = Array.from({ length: count }, (_, i) => ({
    eventId,
    startupName: `DEMO · Startup ${String.fromCharCode(65 + i)}`,
    title: `Desafío ${String.fromCharCode(65 + i)}`,
    description: "Descripción de prueba",
    brief: "Brief de prueba",
    sortOrder: i + 1,
  }));
  return db.insert(s.challenges).values(values).returning();
}

let phoneSeq = 1000000;

/**
 * Crea una persona ya inscripta (o presente) directamente en la base, sin pasar por el flujo.
 * Útil para escenarios de matching/latecomers.
 */
export async function makeRegistered(
  db: DB,
  eventId: string,
  opts: {
    firstChoiceId: string | null;
    secondChoiceId?: string | null;
    secondChoiceAny?: boolean;
    mode?: Mode | null;
    checkedIn?: boolean;
    name?: string;
    checkedInAt?: Date;
  },
) {
  phoneSeq += 1;
  const [participant] = await db
    .insert(s.participants)
    .values({ name: opts.name ?? `Persona ${phoneSeq}`, whatsappNormalized: `+549351${phoneSeq}` })
    .returning();
  const token = generateToken();
  const now = new Date();
  const [participation] = await db
    .insert(s.participations)
    .values({
      eventId,
      participantId: participant.id,
      resumeTokenHash: sha256(token),
      status: opts.checkedIn ? "CHECKED_IN" : "REGISTERED",
      preClarity: 3,
      initialMode: opts.mode === undefined ? "EXPLORE" : opts.mode,
      firstChoiceId: opts.firstChoiceId,
      secondChoiceId: opts.secondChoiceId ?? null,
      secondChoiceAny: opts.secondChoiceAny ?? false,
      operationalConsentAt: now,
      registeredAt: now,
      checkedInAt: opts.checkedIn ? (opts.checkedInAt ?? now) : null,
    })
    .returning();
  return { participant, participation, token };
}

import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "../../src/lib/db/schema";
import { hashPassword } from "../../src/lib/auth/crypto";
import { e2eDb } from "./db";
import { newMobile } from "./helpers";

// Cuentas STAFF (founders, facilitación): sin datos personales completos, sin respaldos y sin
// controles de matching. Pueden hacer check-in y cargar A3 y evaluación.

const { db, sql } = e2eDb();

test.afterAll(async () => {
  await sql.end();
});

/** Evento publicado con un equipo de 3 y una persona que llegó tarde con ese desafío. */
async function lateScenario() {
  const base = new Date(Date.now() + 2 * 24 * 3600_000);
  const [event] = await db
    .insert(s.events)
    .values({
      slug: `e2e-roles-${Date.now().toString(36)}`,
      name: "Evento roles",
      registrationOpensAt: new Date(base.getTime() - 3600_000),
      checkinOpensAt: base,
      registrationClosesAt: new Date(base.getTime() + 5 * 60_000),
      startsAt: new Date(base.getTime() + 10 * 60_000),
      endsAt: new Date(base.getTime() + 75 * 60_000),
      phase: "SPRINT",
    })
    .returning();
  const [challenge] = await db
    .insert(s.challenges)
    .values({ eventId: event.id, startupName: "DEMO · Roles", title: "Desafío roles", description: "Ficticio", sortOrder: 1 })
    .returning();
  const [team] = await db
    .insert(s.teams)
    .values({ eventId: event.id, challengeId: challenge.id, teamNumber: 1, tableNumber: 1, publishedAt: new Date() })
    .returning();
  const add = async (i: number, withTeam: boolean) => {
    const [person] = await db
      .insert(s.participants)
      .values({ name: `Roles ${i}`, whatsappNormalized: `+54935180000${10 + i}` })
      .returning();
    const [row] = await db
      .insert(s.participations)
      .values({
        eventId: event.id,
        participantId: person.id,
        resumeTokenHash: `hash-roles-${event.id}-${i}`,
        status: withTeam ? "MATCHED" : "CHECKED_IN",
        initialMode: "CREATE",
        firstChoiceId: challenge.id,
        secondChoiceAny: true,
        operationalConsentAt: new Date(),
        registeredAt: new Date(),
        checkedInAt: new Date(),
        teamId: withTeam ? team.id : null,
        assignmentSource: withTeam ? "FIRST_CHOICE" : null,
      })
      .returning();
    return row;
  };
  for (let i = 0; i < 3; i++) await add(i, true);
  const latecomer = await add(9, false);
  return { eventId: event.id, latecomerId: latecomer.id };
}


test("una cuenta STAFF no ve teléfonos completos ni puede exportar u operar el matching", async ({ browser }) => {
  await db
    .insert(s.staffMembers)
    .values({ email: "founder@e2e.local", name: "Founder E2E", passwordHash: await hashPassword("founder-pass-123"), role: "STAFF" })
    .onConflictDoNothing();
  const event = await db.query.events.findFirst({ where: eq(s.events.slug, "innovaton-demo") });
  const team = await db.query.teams.findFirst({ where: eq(s.teams.eventId, event!.id) });

  const { page } = await newMobile(browser);
  await page.goto("/staff/login");
  await page.getByLabel("Email").fill("founder@e2e.local");
  await page.getByLabel("Contraseña").fill("founder-pass-123");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("heading", { name: "Eventos" })).toBeVisible();

  await page.goto(`/staff/events/${event!.id}`);
  await expect(page.getByText(/Las fases, el matching y los respaldos los maneja una cuenta ADMIN/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Descargar CSV" })).toHaveCount(0);
  await expect(page.getByText(/•••• \d{4}/).first()).toBeVisible();
  await expect(page.getByText(/\+549351/)).toHaveCount(0);
  await expect(page.getByPlaceholder("Buscar por nombre o últimos 4 dígitos")).toBeVisible();

  const csv = await page.request.get(`/api/staff/events/${event!.id}/export.csv`);
  expect(csv.status()).toBe(401);
  const backup = await page.request.get(`/api/staff/events/${event!.id}/backup.json`);
  expect(backup.status()).toBe(401);

  await page.goto(`/staff/events/${event!.id}/teams`);
  await expect(page.getByRole("button", { name: /Generar|Regenerar|Publicar/ })).toHaveCount(0);
  await expect(page.getByText("Mover a")).toHaveCount(0);

  // El print con la lista de WhatsApp es solo ADMIN: redirige.
  await page.goto(`/staff/events/${event!.id}/print`);
  await expect(page).toHaveURL(/\/staff$/);

  // Puede sumar un latecomer con la sugerencia del tablero (nunca mueve a nadie más).
  const late = await lateScenario();
  await page.goto(`/staff/events/${late.eventId}/teams`);
  await page.getByRole("button", { name: /Sumar a .*Equipo 1/ }).click();
  await expect(page.getByText(/Latecomers y presentes sin equipo/)).toHaveCount(0);
  const placed = await db.query.participations.findFirst({ where: eq(s.participations.id, late.latecomerId) });
  expect(placed?.status).toBe("MATCHED");

  // Sí puede cargar A3 y evaluación de su equipo.
  if (team) {
    await page.goto(`/staff/events/${event!.id}/teams/${team.id}`);
    await expect(page.getByRole("heading", { name: "Evaluación del founder" })).toBeVisible();
    await expect(page.getByText("Sacar o elegir foto del A3")).toBeVisible();
  }
});

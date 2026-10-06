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

  // Sí puede cargar A3 y evaluación de su equipo.
  if (team) {
    await page.goto(`/staff/events/${event!.id}/teams/${team.id}`);
    await expect(page.getByRole("heading", { name: "Evaluación del founder" })).toBeVisible();
    await expect(page.getByText("Sacar o elegir foto del A3")).toBeVisible();
  }
});

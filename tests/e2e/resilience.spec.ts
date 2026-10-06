import { expect, test, type Page } from "@playwright/test";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import * as s from "../../src/lib/db/schema";
import { e2eDb } from "./db";
import { acceptDialogs, chooseChallenges, newMobile, staffLogin, trackErrors } from "./helpers";

// Hardening (pedido del MVP, fase 5): refresh, doble tap, internet lento, sesión perdida,
// dos staff a la vez y responsive. Usa eventos propios para no depender del recorrido completo.

test.describe.configure({ mode: "serial" });

const { db, sql } = e2eDb();
const SLUG = "e2e-resiliencia";

async function createEvent(slug: string, phase: s.EventRow["phase"], challengeCount = 3) {
  const base = new Date(Date.now() + 24 * 3600_000);
  const [event] = await db
    .insert(s.events)
    .values({
      slug,
      name: `Evento ${slug}`,
      registrationOpensAt: new Date(base.getTime() - 3600_000),
      checkinOpensAt: base,
      registrationClosesAt: new Date(base.getTime() + 5 * 60_000),
      startsAt: new Date(base.getTime() + 10 * 60_000),
      endsAt: new Date(base.getTime() + 75 * 60_000),
      phase,
    })
    .returning();
  const challenges = await db
    .insert(s.challenges)
    .values(
      Array.from({ length: challengeCount }, (_, i) => ({
        eventId: event.id,
        startupName: `DEMO · Startup ${String.fromCharCode(65 + i)}`,
        title: `Desafío ${String.fromCharCode(65 + i)}`,
        description: "Ficticio para pruebas",
        sortOrder: i + 1,
      })),
    )
    .returning();
  return { event, challenges };
}

async function startQuestionnaire(page: Page, slug: string) {
  await page.goto(`/e/${slug}`);
  await page.getByRole("button", { name: "DESCUBRIR CÓMO PUEDO APORTAR" }).click();
  await page.waitForURL(/\/clarity$/);
  await page.getByRole("radio", { name: /^3/ }).click();
  await page.waitForURL(/\/assessment$/);
}

async function finishQuestionnaire(page: Page, from: number) {
  for (let i = from; i <= 5; i++) {
    await expect(page.getByText(`${i}/5`, { exact: true })).toBeVisible();
    await page.getByRole("radio").nth(1).click();
  }
  const outcome = await Promise.race([
    page.waitForURL(/\/result$/).then(() => "result" as const),
    page.getByText("Una más y listo").waitFor().then(() => "tie" as const),
  ]);
  if (outcome === "tie") await page.getByRole("button").filter({ hasText: /Que / }).first().click();
  await page.waitForURL(/\/result$/);
}

test.beforeAll(async () => {
  await createEvent(SLUG, "REGISTRATION");
});

test.afterAll(async () => {
  await sql.end();
});

test("refresh en medio del cuestionario retoma donde estaba", async ({ browser }) => {
  const { page } = await newMobile(browser);
  await startQuestionnaire(page, SLUG);
  await page.getByRole("radio").first().click();
  await expect(page.getByText("2/5", { exact: true })).toBeVisible();
  await page.getByRole("radio").first().click();
  await expect(page.getByText("3/5", { exact: true })).toBeVisible();
  // Dar tiempo a los guardados en segundo plano y recargar.
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.getByText("3/5", { exact: true })).toBeVisible();
  await finishQuestionnaire(page, 3);
  await expect(page.getByRole("heading", { name: "Esto no define quién sos." })).toBeVisible();
});

test("doble tap en INSCRIBIRME crea una sola inscripción", async ({ browser }) => {
  const { page } = await newMobile(browser);
  await startQuestionnaire(page, SLUG);
  await finishQuestionnaire(page, 1);
  await chooseChallenges(page, "Startup A", "Startup B");
  await page.getByLabel("Tu nombre").fill("Doble Tap");
  await page.getByLabel("Tu WhatsApp").fill("351 200 0001");
  await page.getByText("Acepto recibir mensajes operativos").click();
  await page.getByRole("button", { name: "INSCRIBIRME" }).dblclick();
  await page.waitForURL(/\/status$/);
  const people = await db.select().from(s.participants).where(eq(s.participants.whatsappNormalized, "+5493512000001"));
  expect(people).toHaveLength(1);
  const regs = await db.select().from(s.participations).where(eq(s.participations.participantId, people[0].id));
  expect(regs).toHaveLength(1);
});

test("internet lento: los botones muestran estado y el flujo termina sin duplicados", async ({ browser }) => {
  const { context, page } = await newMobile(browser);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  // ~3G lenta: 600 ms de latencia y 50 KB/s.
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 600,
    downloadThroughput: 50 * 1024,
    uploadThroughput: 25 * 1024,
  });
  await startQuestionnaire(page, SLUG);
  await finishQuestionnaire(page, 1);
  await chooseChallenges(page, "Startup B", "ANY");
  await page.getByLabel("Tu nombre").fill("Red Lenta");
  await page.getByLabel("Tu WhatsApp").fill("351 200 0002");
  await page.getByText("Acepto recibir mensajes operativos").click();
  const submit = page.getByRole("button", { name: "INSCRIBIRME" });
  await submit.click();
  await expect(page.getByRole("button", { name: /Inscribiendo/ })).toBeDisabled();
  await page.waitForURL(/\/status$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Estás preinscripto." })).toBeVisible();
  const people = await db.select().from(s.participants).where(eq(s.participants.whatsappNormalized, "+5493512000002"));
  expect(people).toHaveLength(1);
});

test("sesión perdida: el WhatsApp solo no alcanza; con el código del staff recupera el lugar", async ({ browser }) => {
  const event = await db.query.events.findFirst({ where: eq(s.events.slug, SLUG) });

  async function tryRecover(whatsapp: string, code: string) {
    const { page } = await newMobile(browser);
    await page.goto(`/e/${SLUG}/recover`);
    await page.getByLabel("El WhatsApp con el que te inscribiste").fill(whatsapp);
    await page.getByLabel("Código que te dieron en el stand").fill(code);
    await page.getByRole("button", { name: "RECUPERAR MI LUGAR" }).click();
    return page;
  }

  // Conocer el número de otra persona no abre su inscripción.
  const intruder = await tryRecover("+54 9 351 200-0001", "123456");
  await expect(intruder.getByText(/Revisá tu WhatsApp y el código/)).toBeVisible();
  await expect(intruder).toHaveURL(/\/recover$/);

  // En el stand, el staff genera el código desde la fila de la persona.
  const staff = await newMobile(browser);
  await staffLogin(staff.page);
  await staff.page.goto(`/staff/events/${event!.id}`);
  const row = staff.page.getByRole("listitem").filter({ hasText: "Doble Tap" });
  await row.getByRole("button", { name: "Código para recuperar" }).click();
  const issued = row.getByRole("status");
  await expect(issued).toContainText(/Código\s*\d{6}/);
  const code = (await issued.textContent())!.match(/Código\s*(\d{6})/)![1];

  const { page } = await newMobile(browser);
  await page.goto(`/e/${SLUG}`);
  await page.getByRole("link", { name: "¿Ya te inscribiste? Recuperá tu lugar" }).click();
  await page.getByLabel("El WhatsApp con el que te inscribiste").fill("+54 9 351 200-0001");
  await page.getByLabel("Código que te dieron en el stand").fill(code);
  await page.getByRole("button", { name: "RECUPERAR MI LUGAR" }).click();
  await page.waitForURL(/\/status$/);
  await expect(page.getByRole("heading", { name: "Estás preinscripto." })).toBeVisible();

  // El código es de un solo uso, y un número que no está inscripto da el mismo mensaje.
  const reuse = await tryRecover("351 200 0001", code);
  await expect(reuse.getByText(/Revisá tu WhatsApp y el código/)).toBeVisible();
  const unknown = await tryRecover("351 999 9999", code);
  await expect(unknown.getByText(/Revisá tu WhatsApp y el código/)).toBeVisible();

  // Sin cookie, las pantallas internas vuelven al inicio en lugar de romperse.
  const fresh = await newMobile(browser);
  await fresh.page.goto(`/e/${SLUG}/status`);
  await expect(fresh.page).toHaveURL(new RegExp(`/e/${SLUG}$`));
});

/** Personas presentes cargadas directo en la base (como si hubieran hecho check-in). */
async function addPresent(
  eventId: string,
  people: { name: string; phone: string; firstChoiceId: string; secondChoiceId?: string | null; mode?: s.ParticipationRow["initialMode"] }[],
) {
  const out: s.ParticipationRow[] = [];
  for (const [i, p] of people.entries()) {
    const [person] = await db.insert(s.participants).values({ name: p.name, whatsappNormalized: p.phone }).returning();
    const [row] = await db
      .insert(s.participations)
      .values({
        eventId,
        participantId: person.id,
        resumeTokenHash: `hash-${p.phone}`,
        status: "CHECKED_IN",
        initialMode: p.mode === undefined ? "EXPLORE" : p.mode,
        firstChoiceId: p.firstChoiceId,
        secondChoiceId: p.secondChoiceId ?? null,
        secondChoiceAny: !p.secondChoiceId,
        operationalConsentAt: new Date(),
        registeredAt: new Date(),
        checkedInAt: new Date(Date.now() - (10 - i) * 1000),
      })
      .returning();
    out.push(row);
  }
  return out;
}

test("con muy poca gente el staff arma un equipo a mano aunque sean 2 y lo publica", async ({ browser }) => {
  const { event, challenges } = await createEvent("e2e-pocos", "MATCHING");
  const people = await addPresent(event.id, [
    { name: "Poca Gente Uno", phone: "+5493513100001", firstChoiceId: challenges[0].id, secondChoiceId: challenges[1].id },
    { name: "Poca Gente Dos", phone: "+5493513100002", firstChoiceId: challenges[2].id, secondChoiceId: challenges[1].id },
  ]);
  const { page } = await newMobile(browser);
  acceptDialogs(page);
  await staffLogin(page);
  await page.goto(`/staff/events/${event.id}/teams`);

  // El matching no puede formar equipos de 3: quedan como casos manuales.
  await page.getByRole("button", { name: /Generar equipos/ }).click();
  await expect(page.getByText("0 equipos · 0 personas asignadas")).toBeVisible();
  await expect(page.getByText("Presentes sin equipo (2)")).toBeVisible();

  await page.getByRole("button", { name: "+ Equipo vacío" }).first().click();
  for (const name of ["Poca Gente Uno", "Poca Gente Dos"]) {
    const select = page.getByLabel(`Asignar a ${name} manualmente`);
    await expect(select.locator("option")).toHaveCount(2);
    await select.selectOption({ index: 1 });
    await expect(page.getByLabel(`Asignar a ${name} manualmente`)).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Publicar equipos" }).click();
  await expect(page.getByText("Equipos publicados")).toBeVisible();

  const rows = await db
    .select()
    .from(s.participations)
    .where(inArray(s.participations.id, people.map((p) => p.id)));
  expect(rows.map((r) => r.status)).toEqual(["MATCHED", "MATCHED"]);
  expect(new Set(rows.map((r) => r.teamId)).size).toBe(1);
});

test("carga en papel: el alta rápida y la reflexión guardan el modo del cuestionario en papel", async ({ browser }) => {
  const { event, challenges } = await createEvent("e2e-papel", "REFLECTION");
  const [team] = await db
    .insert(s.teams)
    .values({ eventId: event.id, challengeId: challenges[0].id, teamNumber: 1, tableNumber: 1, publishedAt: new Date() })
    .returning();
  const [paper] = await addPresent(event.id, [
    { name: "Papel Uno", phone: "+5493513200001", firstChoiceId: challenges[0].id, mode: null },
  ]);
  await db
    .update(s.participations)
    .set({ teamId: team.id, assignmentSource: "MANUAL", status: "EXPERIENCE_COMPLETED", addedByStaff: true })
    .where(eq(s.participations.id, paper.id));

  const { page } = await newMobile(browser);
  acceptDialogs(page);
  await staffLogin(page);

  // Reflexión en papel de alguien dado de alta sin cuestionario.
  await page.goto(`/staff/events/${event.id}/teams/${team.id}`);
  await page.getByText("Cargar la reflexión de Papel Uno").click();
  const form = page.locator("details[open]");
  await form.getByLabel("Modo del cuestionario en papel (opcional)").selectOption({ label: "E · Explorar" });
  await form.getByRole("radiogroup", { name: /1\. Claridad/ }).getByRole("radio", { name: "4" }).click();
  await form.getByText("Propuse alternativas").click();
  await form.getByLabel("3. Aporte más importante").selectOption({ label: "Generar alternativas" });
  await form.getByRole("radiogroup", { name: /4\. ¿Su aporte/ }).getByRole("radio", { name: "5" }).click();
  await form.getByRole("radiogroup", { name: /5\. ¿La sugerencia/ }).getByRole("radio", { name: "3" }).click();
  await form.getByRole("button", { name: "Guardar reflexión de Papel Uno" }).click();
  await expect(page.getByText("Cargar la reflexión de Papel Uno")).toHaveCount(0);
  await expect
    .poll(async () => (await db.query.participations.findFirst({ where: eq(s.participations.id, paper.id) }))?.status)
    .toBe("INTERPRETED");
  expect((await db.query.participations.findFirst({ where: eq(s.participations.id, paper.id) }))?.initialMode).toBe(
    "EXPLORE",
  );

  // Alta rápida desde la planilla en papel, con el modo del cuestionario.
  await page.goto(`/staff/events/${event.id}`);
  await page.getByText("Alta rápida (sin celular o desde planilla)").click();
  await page.getByLabel("Nombre", { exact: true }).fill("Papel Dos");
  await page.getByLabel("WhatsApp", { exact: true }).fill("351 320 0002");
  await page.getByLabel("Desafío 1").selectOption({ label: challenges[1].startupName });
  await page.getByLabel("Modo del cuestionario en papel (opcional)").selectOption({ label: "C · Crear" });
  await page.getByRole("button", { name: "Agregar como presente" }).click();
  await expect(page.getByText("Papel Dos quedó presente.")).toBeVisible();
  const person = await db.query.participants.findFirst({ where: eq(s.participants.whatsappNormalized, "+5493513200002") });
  const added = await db.query.participations.findFirst({ where: eq(s.participations.participantId, person!.id) });
  expect(added).toMatchObject({ initialMode: "CREATE", addedByStaff: true, status: "CHECKED_IN" });
});

test("dos staff generan equipos al mismo tiempo: un único set coherente", async ({ browser }) => {
  const { event, challenges } = await createEvent("e2e-concurrencia", "MATCHING");
  // 9 presentes en el desafío A → 3+3+3.
  for (let i = 0; i < 9; i++) {
    const [person] = await db
      .insert(s.participants)
      .values({ name: `Concurrente ${i}`, whatsappNormalized: `+54935130000${10 + i}` })
      .returning();
    await db.insert(s.participations).values({
      eventId: event.id,
      participantId: person.id,
      resumeTokenHash: `hash-concurrencia-${i}`,
      status: "CHECKED_IN",
      initialMode: (["EXPLORE", "CREATE", "DRIVE"] as const)[i % 3],
      firstChoiceId: challenges[0].id,
      secondChoiceAny: true,
      operationalConsentAt: new Date(),
      registeredAt: new Date(),
      checkedInAt: new Date(Date.now() - (9 - i) * 1000),
    });
  }
  const a = await newMobile(browser);
  const b = await newMobile(browser);
  for (const ctx of [a, b]) {
    acceptDialogs(ctx.page);
    await staffLogin(ctx.page);
    await ctx.page.goto(`/staff/events/${event.id}/teams`);
  }
  await Promise.all([
    a.page.getByRole("button", { name: /Generar equipos/ }).click(),
    b.page.getByRole("button", { name: /Generar equipos/ }).click(),
  ]);
  // Uno genera; el otro, que miraba el tablero vacío, recibe el aviso y ve el tablero nuevo.
  const outcome = /3 equipos · 9 personas asignadas|Otra persona cambió los equipos/;
  await expect(a.page.getByText(outcome)).toBeVisible();
  await expect(b.page.getByText(outcome)).toBeVisible();
  const generated =
    (await a.page.getByText(/3 equipos · 9 personas asignadas/).count()) +
    (await b.page.getByText(/3 equipos · 9 personas asignadas/).count());
  expect(generated).toBeGreaterThanOrEqual(1);
  const teams = await db.select().from(s.teams).where(eq(s.teams.eventId, event.id));
  expect(teams).toHaveLength(3);
  expect(new Set(teams.map((t) => t.tableNumber)).size).toBe(3);
  const assigned = await db
    .select()
    .from(s.participations)
    .where(and(eq(s.participations.eventId, event.id), isNotNull(s.participations.teamId)));
  expect(assigned).toHaveLength(9);

  // Publicar desde uno (con la vista al día); el otro ya no puede regenerar.
  await a.page.reload();
  await a.page.getByRole("button", { name: "Publicar equipos" }).click();
  await expect(a.page.getByText("Equipos publicados")).toBeVisible();
  await b.page.reload();
  await expect(b.page.getByRole("button", { name: /Regenerar|Generar/ })).toHaveCount(0);
});

test("pantallas de staff y participante sin scroll horizontal en celular", async ({ browser }) => {
  const errors: string[] = [];
  const { page } = await newMobile(browser);
  trackErrors(page, errors, "responsive");
  await staffLogin(page);
  const event = await db.query.events.findFirst({ where: eq(s.events.slug, "innovaton-demo") });
  const team = await db.query.teams.findFirst({ where: eq(s.teams.eventId, event!.id) });
  const urls = [
    "/staff",
    `/staff/events/${event!.id}`,
    `/staff/events/${event!.id}/teams`,
    ...(team ? [`/staff/events/${event!.id}/teams/${team.id}`] : []),
    `/staff/events/${event!.id}/settings`,
    `/staff/events/${event!.id}/print`,
    "/staff/members",
    `/e/${SLUG}`,
  ];
  for (const url of urls) {
    await page.goto(url);
    await page.locator("h1, h2").first().waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `scroll horizontal en ${url}`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `tests/e2e/.artifacts/${url.replace(/[^a-z0-9]+/gi, "_")}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});

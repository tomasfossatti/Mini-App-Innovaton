import { devices, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

export const SLUG = "innovaton-demo";

/** Registra errores de consola y de página para verificar que no haya errores visibles. */
export function trackErrors(page: Page, bucket: string[], label: string) {
  page.on("console", (m) => {
    if (m.type() === "error") bucket.push(`[${label}] console: ${m.text()}`);
  });
  page.on("pageerror", (e) => bucket.push(`[${label}] pageerror: ${e.message}`));
}

export const BASE_URL = `http://localhost:${process.env.E2E_PORT ?? 3100}`;

/** Contexto nuevo (otro celular) con viewport móvil y la URL base del server de pruebas. */
export async function newMobile(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL: BASE_URL,
    locale: "es-AR",
    timezoneId: "America/Argentina/Cordoba",
  });
  const page = await context.newPage();
  return { context, page };
}

export async function staffLogin(page: Page) {
  await page.goto("/staff/login");
  await page.getByLabel("Email").fill(E2E_ADMIN.email);
  await page.getByLabel("Contraseña").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("heading", { name: "Eventos" })).toBeVisible();
}

export async function openEvent(page: Page, name = "Innovatón DEMO") {
  await page.goto("/staff");
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(page.getByRole("heading", { name: "Fase del evento" })).toBeVisible();
  return page.url().replace(/\/$/, "");
}

/** Cuestionario completo. answerIndex elige la opción (después del orden aleatorio estable). */
export async function doQuestionnaire(page: Page, slug = SLUG) {
  await page.goto(`/e/${slug}`);
  await page.getByRole("button", { name: "DESCUBRIR CÓMO PUEDO APORTAR" }).click();
  await page.waitForURL(/\/clarity$/);
  await page.getByRole("radio", { name: /^2/ }).click();
  await page.waitForURL(/\/assessment$/);
  for (let i = 1; i <= 5; i++) {
    await expect(page.getByText(`${i}/5`, { exact: true })).toBeVisible();
    await page.getByRole("radio").first().click();
  }
  // Puede haber desempate (2–2–1): o se va al resultado o aparece la pregunta extra.
  const outcome = await Promise.race([
    page.waitForURL(/\/result$/).then(() => "result" as const),
    page.getByText("Una más y listo").waitFor().then(() => "tie" as const),
  ]);
  if (outcome === "tie") {
    await page.getByRole("button").filter({ hasText: /Que / }).first().click();
  }
  await page.waitForURL(/\/result$/);
  await expect(page.getByRole("heading", { name: "Esto no define quién sos." })).toBeVisible();
}

export async function chooseChallenges(page: Page, first: string, second: string | "ANY") {
  await page.getByRole("link", { name: "ELEGIR UN DESAFÍO" }).click();
  await page.waitForURL(/\/challenges$/);
  await page.getByRole("radio", { name: new RegExp(first) }).click();
  await page.getByRole("button", { name: "SIGUIENTE" }).click();
  if (second === "ANY") await page.getByRole("radio", { name: /Cualquiera, quiero participar/ }).click();
  else await page.getByRole("radio", { name: new RegExp(second) }).click();
  await page.getByRole("button", { name: "CONTINUAR" }).click();
  await page.waitForURL(/\/register$/);
}

export async function register(page: Page, name: string, whatsapp: string, community = false) {
  await page.getByLabel("Tu nombre").fill(name);
  await page.getByLabel("Tu WhatsApp").fill(whatsapp);
  await page.getByText("Acepto recibir mensajes operativos").click();
  if (community) await page.getByText("Quiero recibir próximas oportunidades").click();
  await page.getByRole("button", { name: "INSCRIBIRME" }).click();
  await page.waitForURL(/\/status$/);
}

export async function fullRegistration(page: Page, name: string, whatsapp: string, first: string, second: string | "ANY") {
  await doQuestionnaire(page);
  await chooseChallenges(page, first, second);
  await register(page, name, whatsapp);
}

export function acceptDialogs(page: Page) {
  page.on("dialog", (d) => void d.accept());
}

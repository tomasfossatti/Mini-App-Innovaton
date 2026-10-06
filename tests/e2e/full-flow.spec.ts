import { expect, test } from "@playwright/test";
import { deflateSync } from "node:zlib";
import {
  SLUG,
  acceptDialogs,
  fullRegistration,
  newMobile,
  openEvent,
  staffLogin,
  trackErrors,
} from "./helpers";

// Definition of Done (01 §32 y pedido del MVP): recorrido real completo de participantes y staff.
// QR → cuestionario → hipótesis → desafío 1+2 → registro → calendario → check-in → matching →
// startup/equipo/mesa → sprint (A3 + evaluación) → reflexión → interpretación → recomendación → CTA.

test.describe.configure({ mode: "serial" });

/** PNG mínimo válido (foto de A3 simulada). */
function tinyPng(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const w = 40;
  const h = 30;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x80);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("recorrido completo: participantes + staff + Educai", async ({ browser }) => {
  const errors: string[] = [];

  // ── Staff
  const staff = await newMobile(browser);
  trackErrors(staff.page, errors, "staff");
  acceptDialogs(staff.page);
  await staffLogin(staff.page);
  const eventUrl = await openEvent(staff.page);
  const eventId = eventUrl.split("/").pop()!;

  // ── 4 participantes se preinscriben desde el QR
  const people = [
    { name: "Ana E2E", phone: "351 15 100 0001", first: "Cosecha Directa", second: "TurnoYa" },
    { name: "Bruno E2E", phone: "351 100 0002", first: "Cosecha Directa", second: "ANY" },
    { name: "Carla E2E", phone: "+54 9 351 100 0003", first: "Cosecha Directa", second: "Segunda Vuelta" },
    // Único en su primera opción: el matching lo lleva a su segunda (grupo inviable → 2ª opción).
    { name: "Diego E2E", phone: "0351 15 100 0004", first: "TurnoYa", second: "Cosecha Directa" },
  ];
  const pages = [];
  for (const p of people) {
    const m = await newMobile(browser);
    trackErrors(m.page, errors, p.name);
    await fullRegistration(m.page, p.name, p.phone, p.first, p.second);
    await expect(m.page.getByRole("heading", { name: "Estás preinscripto." })).toBeVisible();
    pages.push(m.page);
  }

  // Calendario: Google + .ics
  const first = pages[0];
  const google = first.getByRole("link", { name: "AGREGAR AL CALENDARIO" });
  await expect(google).toHaveAttribute("href", /calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  const icsHref = await first.getByRole("link", { name: /Descargar evento/ }).getAttribute("href");
  const ics = await first.request.get(icsHref!);
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  const icsText = await ics.text();
  expect(icsText).toContain("BEGIN:VALARM");
  expect(icsText).toContain("TRIGGER:-PT10M");

  // ── Staff abre el check-in
  await staff.page.getByRole("button", { name: "Abrir check-in" }).click();
  await expect(staff.page.getByText("Check-in abierto").first()).toBeVisible();

  // 3 participantes hacen check-in desde el celular (con doble tap incluido)
  for (const page of pages.slice(0, 3)) {
    await page.reload();
    const btn = page.getByRole("button", { name: "ESTOY ACÁ" });
    await btn.dblclick();
    await expect(page.getByRole("heading", { name: "Listo. Estás adentro." })).toBeVisible();
  }

  // El cuarto llega sin batería en el celular: check-in manual desde el panel (búsqueda por nombre)
  await staff.page.reload();
  await staff.page.getByPlaceholder("Buscar por nombre o teléfono").fill("diego");
  await staff.page.getByRole("button", { name: "Check-in", exact: true }).click();
  await staff.page.getByPlaceholder("Buscar por nombre o teléfono").fill("");
  await expect(staff.page.getByRole("button", { name: /Presentes \(4\)/ })).toBeVisible();

  // ── Cierre de inscripción + matching solo con presentes
  await staff.page.getByRole("button", { name: "Cerrar inscripción" }).click();
  await staff.page.goto(`${eventUrl}/teams`);
  await staff.page.getByRole("button", { name: /Generar equipos \(4 presentes\)/ }).click();
  await expect(staff.page.getByText(/1 equipos · 4 personas asignadas/)).toBeVisible();
  const teamCard = staff.page.locator("div.rounded-3xl").filter({ hasText: "Equipo 1" }).first();
  await expect(teamCard.getByText("4 personas")).toBeVisible();
  await expect(teamCard.getByText("2ª", { exact: true })).toBeVisible(); // Diego entró por segunda opción

  // Regenerar antes de publicar es posible y no duplica
  await staff.page.getByRole("button", { name: "Regenerar equipos" }).click();
  await expect(staff.page.getByText(/1 equipos · 4 personas asignadas/)).toBeVisible();

  // Publicación
  await staff.page.getByRole("button", { name: "Publicar equipos" }).click();
  await expect(staff.page.getByText("Equipos publicados")).toBeVisible();
  await expect(staff.page.getByRole("button", { name: /Regenerar/ })).toHaveCount(0);

  // El participante que esperaba ve su equipo por polling, sin recargar
  await expect(first.getByText("Mesa 1", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(first.getByText("Equipo 1", { exact: true })).toBeVisible();
  await expect(first.getByText(/DEMO · Cosecha Directa/i)).toBeVisible();

  // ── Latecomer: se inscribe después de publicar y el staff lo suma
  const late = await newMobile(browser);
  trackErrors(late.page, errors, "latecomer");
  await late.page.goto(`/e/${SLUG}`);
  await expect(late.page.getByText("La inscripción para el matching ya cerró")).toBeVisible();
  await fullRegistration(late.page, "Eva Tarde E2E", "351 100 0005", "Cosecha Directa", "ANY");
  await expect(late.page.getByRole("heading", { name: "Acercate al stand de Espacio IDI" })).toBeVisible();

  await staff.page.goto(eventUrl);
  await staff.page.getByPlaceholder("Buscar por nombre o teléfono").fill("Eva");
  await staff.page.getByRole("button", { name: "Check-in", exact: true }).click();
  await expect(staff.page.getByText("Presente").first()).toBeVisible();
  await staff.page.goto(`${eventUrl}/teams`);
  await expect(staff.page.getByText(/Latecomers y presentes sin equipo \(1\)/)).toBeVisible();
  await staff.page.getByRole("button", { name: /Sumar como 5º/ }).click();
  await expect(staff.page.getByText(/Latecomers y presentes sin equipo/)).toHaveCount(0);
  await late.page.reload();
  await expect(late.page.getByText("Mesa 1", { exact: true })).toBeVisible();

  // ── Sprint: A3 + evaluación del founder + contribución individual
  await staff.page.getByRole("link", { name: "A3 y evaluación" }).first().click();
  await expect(staff.page.getByRole("heading", { name: /Equipo 1 · Mesa 1/ })).toBeVisible();
  await staff.page.locator('input[type="file"]').setInputFiles({ name: "a3.png", mimeType: "image/png", buffer: tinyPng() });
  await expect(staff.page.getByText("Foto guardada.")).toBeVisible();
  await expect(staff.page.getByRole("img", { name: /A3 del equipo 1/ })).toBeVisible();
  await staff.page.getByText("Prueba", { exact: true }).first().click();
  await staff.page.getByRole("button", { name: "Guardar bloques" }).click();
  await expect(staff.page.getByText("Guardado.")).toBeVisible();
  await staff.page.getByRole("radiogroup", { name: "Problema" }).getByRole("radio", { name: "4" }).click();
  await staff.page.getByRole("radiogroup", { name: "Valor" }).getByRole("radio", { name: "5" }).click();
  await staff.page.getByRole("radiogroup", { name: "Prueba" }).getByRole("radio", { name: "5" }).click();
  await staff.page.getByLabel("Feedback para el equipo (opcional)").fill("Muy buena primera prueba.");
  await staff.page.getByText("Ganador / reconocimiento del founder").click();
  await staff.page.getByRole("button", { name: "Guardar evaluación" }).click();
  await expect(staff.page.getByText("Evaluación guardada.")).toBeVisible();
  await staff.page.getByLabel("Participante").selectOption({ label: "Ana E2E" });
  await staff.page.getByLabel("Capacidad observada").selectOption({ label: "experimentación" });
  await staff.page.getByRole("button", { name: "Registrar contribución" }).click();
  await expect(staff.page.getByText("Observación registrada.")).toBeVisible();

  // ── Pitch y reflexión
  await staff.page.goto(eventUrl);
  await staff.page.getByRole("button", { name: "Pasar a pitch" }).click();
  await expect(staff.page.getByRole("button", { name: "Abrir reflexión" })).toBeVisible();
  await staff.page.getByRole("button", { name: "Abrir reflexión" }).click();
  await expect(staff.page.getByRole("button", { name: "Cerrar evento" })).toBeVisible();

  await first.reload();
  await first.getByRole("link", { name: "HACER LA REFLEXIÓN FINAL" }).click();
  await first.waitForURL(/\/reflection$/);
  await first.getByRole("radio", { name: /^4/ }).click();
  await first.getByText("Convertí una idea en una prueba").click();
  await first.getByText("Hice preguntas para entender mejor").click();
  await first.getByRole("button", { name: "SIGUIENTE" }).click();
  await first.getByLabel("Tu aporte más importante (opcional)").fill("Propuse probar con 5 almacenes.");
  await first.getByRole("radio", { name: "Diseñar una prueba" }).click();
  await first.getByRole("button", { name: "SIGUIENTE" }).click();
  await first.getByRole("radio", { name: /^5/ }).click();
  await first.getByRole("radio", { name: /^4/ }).click();
  await first.getByRole("button", { name: "VER MI RESULTADO" }).dblclick();
  await first.waitForURL(/\/outcome$/);
  for (const block of ["Tu punto de partida", "Lo que hiciste", "Lo que esta experiencia sugiere", "Próximo experimento"]) {
    await expect(first.getByRole("heading", { name: block })).toBeVisible();
  }
  await expect(first.getByText(/Esta experiencia no define tus capacidades/)).toBeVisible();
  await expect(first.getByText(/experimentación/).first()).toBeVisible();
  await first.getByRole("button", { name: "QUIERO PARTICIPAR DE LOS PRÓXIMOS DESAFÍOS" }).click();
  await expect(first.getByText(/Te vamos a avisar de los próximos desafíos/)).toBeVisible();

  // ── Respaldo: CSV con presencia, equipo y mesa
  const csv = await staff.page.request.get(`/api/staff/events/${eventId}/export.csv`);
  expect(csv.status()).toBe(200);
  const csvText = await csv.text();
  expect(csvText).toContain("nombre,whatsapp");
  expect(csvText).toContain("Ana E2E");
  expect(csvText).toContain("+5493511000001");
  expect(csvText).toContain("Cualquiera");
  const anon = await first.request.get(`/api/staff/events/${eventId}/export.csv`);
  expect(anon.status()).toBe(401);

  // Sin errores visibles en consola en ninguna pantalla
  expect(errors).toEqual([]);
});

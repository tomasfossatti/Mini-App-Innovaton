import { describe, expect, it } from "vitest";
import { buildIcs, googleCalendarUrl, type CalendarEventInput } from "@/lib/domain/calendar";

const start = new Date("2026-10-15T17:20:00.000Z"); // 14:20 en Córdoba
const end = new Date("2026-10-15T18:00:00.000Z");

const base: CalendarEventInput = {
  uid: "innovaton-2026@espacioidi",
  title: "Innovatón — Espacio IDI",
  description: "Volvé al stand de Espacio IDI entre 14:20 y 14:25.",
  location: "Stand Espacio IDI",
  start,
  end,
};

function lines(ics: string): string[] {
  return ics.split("\r\n");
}

function unfold(ics: string): string[] {
  return lines(ics.replace(/\r\n /g, ""));
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("buildIcs", () => {
  it("arma la estructura VCALENDAR / VEVENT / VALARM", () => {
    const ics = buildIcs({ ...base, now: new Date("2026-10-01T12:00:00.000Z") });
    expect(unfold(ics)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Espacio IDI//Innovaton//ES",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:innovaton-2026@espacioidi",
      "DTSTAMP:20261001T120000Z",
      "DTSTART:20261015T172000Z",
      "DTEND:20261015T180000Z",
      "SUMMARY:Innovatón — Espacio IDI",
      "DESCRIPTION:Volvé al stand de Espacio IDI entre 14:20 y 14:25.",
      "LOCATION:Stand Espacio IDI",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-PT10M",
      "DESCRIPTION:Innovatón — Espacio IDI",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ]);
  });

  it("usa CRLF en todas las líneas y termina con CRLF", () => {
    const ics = buildIcs(base);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("es determinística: sin now, DTSTAMP = start", () => {
    const a = buildIcs(base);
    const b = buildIcs(base);
    expect(a).toBe(b);
    expect(a).toContain("DTSTAMP:20261015T172000Z\r\n");
  });

  it("descarta milisegundos en las fechas UTC", () => {
    const ics = buildIcs({ ...base, start: new Date("2026-10-15T17:20:00.999Z") });
    expect(ics).toContain("DTSTART:20261015T172000Z\r\n");
  });

  it("incluye URL opcional y respeta la anticipación de la alarma", () => {
    const ics = buildIcs({
      ...base,
      url: "https://innovaton.espacioidi.com/e/demo?x=1,2",
      alarmMinutesBefore: 15,
    });
    expect(unfold(ics)).toContain("URL:https://innovaton.espacioidi.com/e/demo?x=1,2");
    expect(ics).toContain("TRIGGER:-PT15M\r\n");
    expect(buildIcs(base)).not.toContain("URL:");
  });

  it("escapa barra invertida, punto y coma, coma y saltos de línea", () => {
    const ics = buildIcs({
      ...base,
      title: "A; B, C",
      description: "Línea 1\nLínea 2\r\nRuta C:\\idi; fin, listo",
      location: "Stand 3, pabellón B",
    });
    const unfolded = unfold(ics);
    expect(unfolded).toContain("SUMMARY:A\\; B\\, C");
    expect(unfolded).toContain("DESCRIPTION:Línea 1\\nLínea 2\\nRuta C:\\\\idi\\; fin\\, listo");
    expect(unfolded).toContain("LOCATION:Stand 3\\, pabellón B");
  });

  it("pliega líneas de más de 75 octetos sin cortar caracteres multibyte", () => {
    const description = "Acercate al stand de Espacio IDI. ".repeat(3) + "áéíóúñ¿¡".repeat(20) + " 🙂🙂🙂 fin";
    const ics = buildIcs({ ...base, description });

    const physical = lines(ics);
    for (const line of physical) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
      // Cada línea física es UTF-8 válido: un carácter cortado se volvería U+FFFD al codificarlo.
      expect(decoder.decode(encoder.encode(line))).toBe(line);
    }
    const continuations = physical.filter((line) => line.startsWith(" "));
    expect(continuations.length).toBeGreaterThan(3);

    expect(unfold(ics)).toContain(`DESCRIPTION:${description}`);
  });

  it("no pliega líneas de exactamente 75 octetos", () => {
    const summary = "x".repeat(75 - "SUMMARY:".length);
    const ics = buildIcs({ ...base, title: summary });
    expect(lines(ics)).toContain(`SUMMARY:${summary}`);
  });

  it("si un carácter de 2 octetos no entra en el octeto 75, pasa entero a la línea siguiente", () => {
    // "SUMMARY:" (8) + 66 "S" = 74 octetos; "á" ocupa 2 y llevaría la línea a 76.
    const title = "S".repeat(66) + "á" + "b".repeat(10);
    const physical = lines(buildIcs({ ...base, title }));
    const index = physical.indexOf(`SUMMARY:${"S".repeat(66)}`);
    expect(index).toBeGreaterThan(-1);
    expect(encoder.encode(physical[index]).length).toBe(74);
    expect(physical[index + 1]).toBe(` á${"b".repeat(10)}`);
  });

  it("no pliega una línea de exactamente 75 octetos con acentos", () => {
    // 8 + 33 × 2 + 1 = 75 octetos.
    const title = "á".repeat(33) + "x";
    expect(lines(buildIcs({ ...base, title }))).toContain(`SUMMARY:${title}`);
  });

  it("las líneas de continuación usan 74 octetos de contenido más el espacio", () => {
    const description = "x".repeat(300);
    const physical = lines(buildIcs({ ...base, description }));
    const start = physical.findIndex((line) => line.startsWith("DESCRIPTION:"));
    expect(physical[start]).toHaveLength(75);
    expect(physical[start + 1]).toBe(` ${"x".repeat(74)}`);
    expect(physical[start + 2]).toBe(` ${"x".repeat(74)}`);
  });

  it("los escapes sobreviven al plegado", () => {
    const description = "Paso 1; paso 2, paso 3\n".repeat(10);
    const ics = buildIcs({ ...base, description });
    const expected = "Paso 1\\; paso 2\\, paso 3\\n".repeat(10);
    expect(unfold(ics)).toContain(`DESCRIPTION:${expected}`);
  });

  it("rechaza rangos y alarmas inválidas", () => {
    expect(() => buildIcs({ ...base, start: end, end: start })).toThrow();
    expect(() => buildIcs({ ...base, start: new Date("x") })).toThrow();
    expect(() => buildIcs({ ...base, alarmMinutesBefore: -5 })).toThrow();
    expect(() => buildIcs({ ...base, alarmMinutesBefore: 2.5 })).toThrow();
    expect(() => buildIcs({ ...base, now: new Date("x") })).toThrow();
  });
});

describe("googleCalendarUrl", () => {
  it("arma el link de plantilla con fechas UTC", () => {
    const url = googleCalendarUrl({
      title: "Innovatón — Espacio IDI",
      details: "Volvé al stand entre 14:20 y 14:25. A las 14:30 empezamos.",
      location: "Stand Espacio IDI",
      start,
      end,
      timezone: "America/Argentina/Cordoba",
    });
    expect(url.startsWith("https://calendar.google.com/calendar/render?action=TEMPLATE&")).toBe(true);
    expect(url).toContain("&dates=20261015T172000Z/20261015T180000Z&");

    const params = new URL(url).searchParams;
    expect(params.get("action")).toBe("TEMPLATE");
    expect(params.get("text")).toBe("Innovatón — Espacio IDI");
    expect(params.get("dates")).toBe("20261015T172000Z/20261015T180000Z");
    expect(params.get("details")).toBe("Volvé al stand entre 14:20 y 14:25. A las 14:30 empezamos.");
    expect(params.get("location")).toBe("Stand Espacio IDI");
    expect(params.get("ctz")).toBe("America/Argentina/Cordoba");
  });

  it("usa las mismas fechas UTC que el .ics, sin milisegundos", () => {
    const url = googleCalendarUrl({
      title: "x",
      details: "",
      location: "",
      start: new Date("2026-10-15T17:20:00.500Z"),
      end,
    });
    expect(new URL(url).searchParams.get("dates")).toBe("20261015T172000Z/20261015T180000Z");
    expect(() => googleCalendarUrl({ title: "x", details: "", location: "", start: end, end: start })).toThrow();
  });

  it("codifica saltos de línea en details", () => {
    const url = googleCalendarUrl({ title: "x", details: "a\nb", location: "", start, end });
    expect(url).toContain("details=a%0Ab");
  });

  it("codifica caracteres especiales y omite ctz si no se indica", () => {
    const url = googleCalendarUrl({
      title: "A & B",
      details: "50% listo + resto",
      location: "Stand #3",
      start,
      end,
    });
    expect(url).toContain("text=A%20%26%20B");
    expect(url).not.toContain("ctz=");
    const params = new URL(url).searchParams;
    expect(params.get("details")).toBe("50% listo + resto");
    expect(params.get("location")).toBe("Stand #3");
  });
});

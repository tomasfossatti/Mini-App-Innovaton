// Formato de fechas y horas en la zona horaria del evento (por defecto Córdoba).

export const DEFAULT_TIMEZONE = "America/Argentina/Cordoba";

/** "14:20" */
export function formatTime(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
}

/** "jueves, 15 de octubre" */
export function formatDate(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(date);
}

/** "2026-10-15" en la zona indicada. */
export function formatIsoDate(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Convierte "YYYY-MM-DD" + "HH:mm" en hora local de la zona a Date UTC. */
export function zonedDateTimeToUtc(date: string, time: string, timeZone: string = DEFAULT_TIMEZONE): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  // Primera aproximación tratando la hora como UTC, luego se corrige por el offset real de la zona.
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const offset = zoneOffsetMinutes(guess, timeZone);
  const corrected = new Date(guess.getTime() - offset * 60_000);
  const offset2 = zoneOffsetMinutes(corrected, timeZone);
  return offset2 === offset ? corrected : new Date(guess.getTime() - offset2 * 60_000);
}

function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** "HH:mm" local de una fecha, para inputs type="time". */
export function toTimeInput(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return formatTime(date, timeZone);
}

// Evento de calendario para la confirmación (PRD §13, 02 §12): archivo .ics y link de Google Calendar.
// Las horas se emiten en UTC (sufijo Z): es inequívoco y no requiere un bloque VTIMEZONE.

export interface CalendarEventInput {
  uid: string;
  title: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  /** Minutos de anticipación de la alarma. PRD §13: 10 minutos antes. */
  alarmMinutesBefore?: number;
  url?: string;
  /** Momento de generación (DTSTAMP). Si no viene se usa `start` para que la salida sea determinística. */
  now?: Date;
}

export interface GoogleCalendarInput {
  title: string;
  details: string;
  location: string;
  start: Date;
  end: Date;
  /** Zona IANA para mostrar el evento, p. ej. "America/Argentina/Cordoba". */
  timezone?: string;
}

const CRLF = "\r\n";
const MAX_LINE_OCTETS = 75;
const DEFAULT_ALARM_MINUTES = 10;

/** Genera un VCALENDAR con un único VEVENT y su VALARM (RFC 5545). */
export function buildIcs(input: CalendarEventInput): string {
  assertValidRange(input.start, input.end);
  const alarmMinutes = input.alarmMinutesBefore ?? DEFAULT_ALARM_MINUTES;
  if (!Number.isInteger(alarmMinutes) || alarmMinutes < 0) {
    throw new Error("alarmMinutesBefore debe ser un entero mayor o igual a 0.");
  }
  const stamp = input.now ?? input.start;
  assertValidDate(stamp, "now");

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Espacio IDI//Innovaton//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeText(input.uid)}`,
    `DTSTAMP:${formatUtc(stamp)}`,
    `DTSTART:${formatUtc(input.start)}`,
    `DTEND:${formatUtc(input.end)}`,
    `SUMMARY:${escapeText(input.title)}`,
    `DESCRIPTION:${escapeText(input.description)}`,
    `LOCATION:${escapeText(input.location)}`,
  ];
  // URL es de tipo URI: no lleva el escape de TEXT.
  if (input.url) lines.push(`URL:${stripLineBreaks(input.url)}`);
  lines.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `TRIGGER:-PT${alarmMinutes}M`,
    `DESCRIPTION:${escapeText(input.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  );

  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** Link "Agregar a Google Calendar" con los mismos datos del .ics. */
export function googleCalendarUrl(input: GoogleCalendarInput): string {
  assertValidRange(input.start, input.end);
  const params: string[] = [
    "action=TEMPLATE",
    `text=${encodeURIComponent(input.title)}`,
    `dates=${formatUtc(input.start)}/${formatUtc(input.end)}`,
    `details=${encodeURIComponent(input.details)}`,
    `location=${encodeURIComponent(input.location)}`,
  ];
  if (input.timezone) params.push(`ctz=${encodeURIComponent(input.timezone)}`);
  return `https://calendar.google.com/calendar/render?${params.join("&")}`;
}

/** YYYYMMDDTHHMMSSZ (UTC, sin milisegundos). */
function formatUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

/** RFC 5545 §3.3.11: escapa \ ; , y convierte saltos de línea en \n. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function stripLineBreaks(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

/**
 * RFC 5545 §3.1: las líneas de más de 75 octetos se pliegan con CRLF + espacio.
 * Se cuenta en bytes UTF-8 y se corta entre code points, nunca dentro de un carácter.
 */
function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let currentOctets = 0;
  // La primera línea admite 75 octetos; las siguientes 74 porque el espacio inicial cuenta.
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const octets = utf8Length(char);
    if (currentOctets + octets > limit) {
      parts.push(current);
      current = "";
      currentOctets = 0;
      limit = MAX_LINE_OCTETS - 1;
    }
    current += char;
    currentOctets += octets;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

function utf8Length(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

function assertValidDate(date: Date, name: string): void {
  if (Number.isNaN(date.getTime())) throw new Error(`Fecha inválida: ${name}.`);
}

function assertValidRange(start: Date, end: Date): void {
  assertValidDate(start, "start");
  assertValidDate(end, "end");
  if (end.getTime() < start.getTime()) {
    throw new Error("La fecha de fin no puede ser anterior a la de inicio.");
  }
}

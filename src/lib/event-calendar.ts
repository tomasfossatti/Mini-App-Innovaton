import type { EventRow } from "@/lib/db/schema";
import { googleCalendarUrl } from "@/lib/domain/calendar";
import { standPhrase } from "@/lib/domain/copy";
import { formatTime } from "@/lib/domain/time";

/** Datos del evento de calendario (PRD §13): referencia 14:20, alarma 10 minutos antes. */
export function calendarEventFor(event: EventRow) {
  const tz = event.timezone;
  return {
    title: `${event.name} — Espacio IDI`,
    details: `Volvé al ${standPhrase(event.locationLabel)} entre ${formatTime(event.checkinOpensAt, tz)} y ${formatTime(
      event.registrationClosesAt,
      tz,
    )} para confirmar tu lugar. A las ${formatTime(event.startsAt, tz)} empezamos.`,
    location: event.locationLabel,
    start: event.checkinOpensAt,
    end: event.endsAt,
    timezone: tz,
  };
}

export function googleCalendarLink(event: EventRow): string {
  return googleCalendarUrl(calendarEventFor(event));
}

export function icsPath(event: EventRow): string {
  return `/api/events/${event.id}/calendar.ics`;
}

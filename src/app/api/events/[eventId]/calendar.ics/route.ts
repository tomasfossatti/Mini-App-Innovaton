import { getDb } from "@/lib/db/client";
import { buildIcs } from "@/lib/domain/calendar";
import { getEventById } from "@/lib/services/events";
import { calendarEventFor } from "@/lib/event-calendar";

/** Archivo .ics para "Agregar al calendario" (02 §12). */
export async function GET(_request: Request, ctx: RouteContext<"/api/events/[eventId]/calendar.ics">) {
  const { eventId } = await ctx.params;
  const event = await getEventById(getDb(), eventId);
  if (!event) return new Response("Evento inexistente", { status: 404 });
  const data = calendarEventFor(event);
  const ics = buildIcs({
    uid: `${event.id}@innovaton.espacioidi`,
    title: data.title,
    description: data.details,
    location: data.location,
    start: data.start,
    end: data.end,
    alarmMinutesBefore: 10,
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="innovaton-${event.slug}.ics"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}

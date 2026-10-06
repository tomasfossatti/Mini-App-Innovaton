import { getDb } from "@/lib/db/client";
import { staffForRoute } from "@/lib/auth/staff";
import { isUuid } from "@/lib/services/events";
import { exportParticipantsCsv } from "@/lib/services/export";

export const dynamic = "force-dynamic";

/** Export CSV de contingencia (PRD §29, spec §30). Solo staff. */
export async function GET(_request: Request, ctx: RouteContext<"/api/staff/events/[eventId]/export.csv">) {
  if (!(await staffForRoute("ADMIN"))) return new Response("No autorizado: el respaldo con datos personales es solo para cuentas ADMIN.", { status: 401 });
  const { eventId } = await ctx.params;
  if (!isUuid(eventId)) return new Response("Evento inexistente", { status: 404 });
  try {
    const { filename, csv } = await exportParticipantsCsv(getDb(), eventId);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[export.csv]", err);
    return new Response("No se pudo generar el CSV", { status: 500 });
  }
}

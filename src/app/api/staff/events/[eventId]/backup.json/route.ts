import { getDb } from "@/lib/db/client";
import { staffForRoute } from "@/lib/auth/staff";
import { isUuid } from "@/lib/services/events";
import { exportBackupJson } from "@/lib/services/export";

export const dynamic = "force-dynamic";

/** Backup completo del evento en JSON (sin fotos). Solo staff. */
export async function GET(_request: Request, ctx: RouteContext<"/api/staff/events/[eventId]/backup.json">) {
  if (!(await staffForRoute("ADMIN"))) return new Response("No autorizado: el respaldo con datos personales es solo para cuentas ADMIN.", { status: 401 });
  const { eventId } = await ctx.params;
  if (!isUuid(eventId)) return new Response("Evento inexistente", { status: 404 });
  try {
    const { filename, data } = await exportBackupJson(getDb(), eventId);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[backup.json]", err);
    return new Response("No se pudo generar el backup", { status: 500 });
  }
}

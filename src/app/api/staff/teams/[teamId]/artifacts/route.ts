import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { teams } from "@/lib/db/schema";
import { staffForRoute } from "@/lib/auth/staff";
import { isDomainError } from "@/lib/services/errors";
import { isUuid } from "@/lib/services/events";
import { uploadArtifact } from "@/lib/services/founder";
import { MAX_ARTIFACT_BYTES } from "@/lib/storage";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

/** Subida de la foto del A3 (PRD §22). Multipart con campo "file". Solo staff. */
export async function POST(request: Request, ctx: RouteContext<"/api/staff/teams/[teamId]/artifacts">) {
  const staff = await staffForRoute();
  if (!staff) return NextResponse.json({ error: "Tu sesión de staff venció. Volvé a ingresar." }, { status: 401 });
  const { teamId } = await ctx.params;
  if (!isUuid(teamId)) return NextResponse.json({ error: "Equipo inexistente" }, { status: 404 });
  const db = getDb();
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId), columns: { id: true, eventId: true } });
  if (!team) return NextResponse.json({ error: "Equipo inexistente" }, { status: 404 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return NextResponse.json({ error: "No llegó la foto. Probá de nuevo." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No llegó la foto. Probá de nuevo." }, { status: 400 });
  if (file.size > MAX_ARTIFACT_BYTES) {
    return NextResponse.json({ error: "Subí una foto JPG, PNG o WEBP de hasta 4 MB." }, { status: 413 });
  }
  try {
    const data = Buffer.from(await file.arrayBuffer());
    const result = await uploadArtifact(db, team.eventId, team.id, { data, contentType: file.type || "image/jpeg" }, staff.id);
    revalidatePath(`/staff/events/${team.eventId}`, "layout");
    return NextResponse.json(result);
  } catch (err) {
    if (isDomainError(err)) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[artifacts upload]", err);
    return NextResponse.json({ error: "No se pudo guardar la foto. Probá de nuevo." }, { status: 500 });
  }
}

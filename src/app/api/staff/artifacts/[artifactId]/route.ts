import { getDb } from "@/lib/db/client";
import { staffForRoute } from "@/lib/auth/staff";
import { isUuid } from "@/lib/services/events";
import { getArtifactFile } from "@/lib/services/founder";

export const dynamic = "force-dynamic";

/** Foto privada del A3: solo staff autenticado (el bucket es la base de datos). */
export async function GET(_request: Request, ctx: RouteContext<"/api/staff/artifacts/[artifactId]">) {
  if (!(await staffForRoute())) return new Response("No autorizado", { status: 401 });
  const { artifactId } = await ctx.params;
  if (!isUuid(artifactId)) return new Response("No encontrado", { status: 404 });
  const file = await getArtifactFile(getDb(), artifactId);
  if (!file) return new Response("No encontrado", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
    },
  });
}

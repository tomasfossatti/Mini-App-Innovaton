import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { readParticipantToken } from "@/lib/auth/participant-session";
import { getEventBySlug } from "@/lib/services/events";
import { getParticipantState, getParticipationByToken } from "@/lib/services/participation";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/** Polling del participante (02 §11). */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("event");
  if (!slug) return NextResponse.json({ error: "Falta el evento" }, { status: 400, headers: NO_STORE });
  try {
    const db = getDb();
    const event = await getEventBySlug(db, slug);
    if (!event) return NextResponse.json({ error: "Evento inexistente" }, { status: 404, headers: NO_STORE });
    const participation = await getParticipationByToken(db, event.id, await readParticipantToken(slug));
    if (!participation) {
      return NextResponse.json({ error: "Sesión no encontrada" }, { status: 401, headers: NO_STORE });
    }
    const state = await getParticipantState(db, event, participation);
    return NextResponse.json(state, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/participant/state]", err);
    return NextResponse.json({ error: "Error temporal" }, { status: 503, headers: NO_STORE });
  }
}

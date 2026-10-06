import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import type { ParticipationRow, EventRow } from "@/lib/db/schema";
import { readParticipantToken } from "@/lib/auth/participant-session";
import { canAccess, nextStep, stepPath, type ParticipantStep } from "@/lib/domain/flow";
import { getEventBySlug } from "@/lib/services/events";
import { getParticipationByToken } from "@/lib/services/participation";

export async function loadEventOr404(eventSlug: string): Promise<EventRow> {
  const event = await getEventBySlug(getDb(), eventSlug);
  if (!event) notFound();
  return event;
}

export async function loadOptionalParticipation(event: EventRow): Promise<ParticipationRow | null> {
  return getParticipationByToken(getDb(), event.id, await readParticipantToken(event.slug));
}

/**
 * Carga evento + participación de la cookie y redirige a la pantalla correcta si la persona
 * no debería estar en este paso (refresh, back, link viejo).
 */
export async function loadParticipantStep(
  eventSlug: string,
  step: ParticipantStep,
): Promise<{ event: EventRow; participation: ParticipationRow }> {
  const event = await loadEventOr404(eventSlug);
  const participation = await loadOptionalParticipation(event);
  if (!participation || !canAccess(step, participation, event.phase)) {
    redirect(stepPath(event.slug, nextStep(participation)));
  }
  return { event, participation };
}

import type { EventPhase, Mode, ParticipationStatus } from "./constants";
import { PHASES_OPEN_FOR_REFLECTION } from "./constants";

// Router de pasos del participante: decide a qué pantalla corresponde ir según el estado
// guardado. Permite refrescar o volver atrás sin romper el flujo.

export type ParticipantStep =
  | "landing"
  | "clarity"
  | "assessment"
  | "result"
  | "challenges"
  | "register"
  | "status"
  | "reflection"
  | "outcome";

export interface FlowParticipation {
  status: ParticipationStatus;
  preClarity: number | null;
  initialMode: Mode | null;
  firstChoiceId: string | null;
  secondChoiceId: string | null;
  secondChoiceAny: boolean;
  teamId: string | null;
}

const REGISTERED_STATUSES: readonly ParticipationStatus[] = [
  "REGISTERED",
  "CHECKED_IN",
  "MATCHED",
  "EXPERIENCE_COMPLETED",
  "NO_SHOW",
];
const DONE_STATUSES: readonly ParticipationStatus[] = ["REFLECTION_COMPLETED", "INTERPRETED"];

const PRE_REGISTRATION_ORDER: ParticipantStep[] = [
  "clarity",
  "assessment",
  "result",
  "challenges",
  "register",
];

export function isRegistered(status: ParticipationStatus): boolean {
  return REGISTERED_STATUSES.includes(status) || DONE_STATUSES.includes(status);
}

export function hasCompletedReflection(status: ParticipationStatus): boolean {
  return DONE_STATUSES.includes(status);
}

export function choicesComplete(p: FlowParticipation): boolean {
  return Boolean(p.firstChoiceId) && (Boolean(p.secondChoiceId) || p.secondChoiceAny);
}

/** Puede completar la reflexión: tiene equipo y la fase está abierta. */
export function canReflect(p: FlowParticipation, phase: EventPhase): boolean {
  return (
    !hasCompletedReflection(p.status) &&
    Boolean(p.teamId) &&
    PHASES_OPEN_FOR_REFLECTION.includes(phase) &&
    ["MATCHED", "EXPERIENCE_COMPLETED"].includes(p.status)
  );
}

export function nextStep(p: FlowParticipation | null): ParticipantStep {
  if (!p) return "landing";
  if (hasCompletedReflection(p.status)) return "outcome";
  if (isRegistered(p.status)) return "status";
  if (p.preClarity == null) return "clarity";
  if (!p.initialMode) return "assessment";
  if (!p.firstChoiceId) return "result";
  if (!choicesComplete(p)) return "challenges";
  return "register";
}

/**
 * ¿Puede ver esta pantalla? Antes de inscribirse se puede volver a pasos anteriores;
 * después, solo estado, reflexión (si corresponde) y resultado final.
 */
export function canAccess(step: ParticipantStep, p: FlowParticipation | null, phase: EventPhase): boolean {
  if (step === "landing") return true;
  if (!p) return false;
  const next = nextStep(p);
  if (hasCompletedReflection(p.status)) return step === "outcome" || step === "status";
  if (isRegistered(p.status)) {
    if (step === "status") return true;
    if (step === "reflection") return canReflect(p, phase);
    return false;
  }
  const target = PRE_REGISTRATION_ORDER.indexOf(step);
  const limit = PRE_REGISTRATION_ORDER.indexOf(next);
  return target !== -1 && target <= limit;
}

export function stepPath(eventSlug: string, step: ParticipantStep): string {
  return step === "landing" ? `/e/${eventSlug}` : `/e/${eventSlug}/${step}`;
}

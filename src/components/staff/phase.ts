import type { EventPhase } from "@/lib/domain/constants";

export const PHASE_LABELS: Record<EventPhase, string> = {
  DRAFT: "Borrador",
  REGISTRATION: "Inscripción abierta",
  CHECKIN: "Check-in abierto",
  MATCHING: "Inscripción cerrada · matching",
  SPRINT: "Sprint",
  PITCH: "Pitch",
  REFLECTION: "Reflexión",
  CLOSED: "Cerrado",
};

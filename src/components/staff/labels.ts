import type { AssignmentSource, ParticipationStatus } from "@/lib/domain/constants";
import type { BadgeTone } from "@/components/ui/Badge";

export const STATUS_LABELS: Record<ParticipationStatus, { label: string; tone: BadgeTone }> = {
  STARTED: { label: "Iniciado", tone: "neutral" },
  PROFILE_COMPLETED: { label: "Perfil listo", tone: "neutral" },
  REGISTERED: { label: "Inscripto", tone: "warn" },
  CHECKED_IN: { label: "Presente", tone: "ok" },
  MATCHED: { label: "Con equipo", tone: "brand" },
  EXPERIENCE_COMPLETED: { label: "Sprint hecho", tone: "brand" },
  REFLECTION_COMPLETED: { label: "Reflexión", tone: "brand" },
  INTERPRETED: { label: "Finalizado", tone: "ok" },
  NO_SHOW: { label: "No vino", tone: "danger" },
};

export const SOURCE_LABELS: Record<AssignmentSource, string> = {
  FIRST_CHOICE: "1ª",
  SECOND_CHOICE: "2ª",
  ANY: "Cualquiera",
  MANUAL: "Manual",
};

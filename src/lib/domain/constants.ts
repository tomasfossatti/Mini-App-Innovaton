// Enums compartidos entre dominio, base de datos y UI.
// Fuente: docs/innovaton/02-technical-spec.md §6 y §8.

export const EVENT_PHASES = [
  "DRAFT",
  "REGISTRATION",
  "CHECKIN",
  "MATCHING",
  "SPRINT",
  "PITCH",
  "REFLECTION",
  "CLOSED",
] as const;
export type EventPhase = (typeof EVENT_PHASES)[number];

export const PARTICIPATION_STATUSES = [
  "STARTED",
  "PROFILE_COMPLETED",
  "REGISTERED",
  "CHECKED_IN",
  "MATCHED",
  "EXPERIENCE_COMPLETED",
  "REFLECTION_COMPLETED",
  "INTERPRETED",
  "NO_SHOW",
] as const;
export type ParticipationStatus = (typeof PARTICIPATION_STATUSES)[number];

export const MODES = ["EXPLORE", "CREATE", "DRIVE"] as const;
export type Mode = (typeof MODES)[number];

export const CAPABILITIES = [
  "PROBLEM_UNDERSTANDING",
  "ASSUMPTION_QUESTIONING",
  "IDEATION",
  "PRIORITIZATION",
  "EXPERIMENTATION",
  "COMMUNICATION",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const ASSIGNMENT_SOURCES = [
  "FIRST_CHOICE",
  "SECOND_CHOICE",
  "ANY",
  "MANUAL",
] as const;
export type AssignmentSource = (typeof ASSIGNMENT_SOURCES)[number];

export const EVIDENCE_SCOPES = ["INDIVIDUAL", "TEAM"] as const;
export type EvidenceScope = (typeof EVIDENCE_SCOPES)[number];

export const EVIDENCE_SOURCES = [
  "SELF_REPORT_ACTION",
  "SELF_REFLECTION_PRIMARY",
  "FOUNDER_INDIVIDUAL",
  "FACILITATOR_OBSERVATION",
  "FOUNDER_TEAM_SCORE",
  "TEAM_ARTIFACT",
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const OBSERVER_SOURCES = [
  "FOUNDER_INDIVIDUAL",
  "FACILITATOR_OBSERVATION",
] as const satisfies readonly EvidenceSource[];
export type ObserverSource = (typeof OBSERVER_SOURCES)[number];

export const INTERPRETATION_TYPES = [
  "INSUFFICIENT",
  "ALIGNED",
  "DIVERGENT",
  "MIXED",
] as const;
export type InterpretationType = (typeof INTERPRETATION_TYPES)[number];

export const RECOMMENDATION_TYPES = [
  "REPLICATE_SIGNAL",
  "INVESTIGATE_DIVERGENCE",
  "GATHER_MORE_EVIDENCE",
  "EXPLORE_COMPLEMENT",
] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const EVIDENCE_LEVELS = ["INSUFFICIENT", "SIGNAL", "CONVERGENT"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const STAFF_ROLES = ["ADMIN", "STAFF"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ARTIFACT_TYPES = ["A3_PHOTO"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

// Acciones autodeclaradas en la reflexión (PRD §23, pregunta 2).
export const REFLECTION_ACTIONS = [
  "ASKED_QUESTIONS",
  "FOUND_ASSUMPTION",
  "PROPOSED_ALTERNATIVES",
  "CONNECTED_IDEAS",
  "HELPED_CHOOSE",
  "ORGANIZED_TEAM",
  "CREATED_TEST",
  "PRESENTED",
  "OTHER",
] as const;
export type ReflectionAction = (typeof REFLECTION_ACTIONS)[number];

// Bloques del A3 (PRD §19). Los marca una persona del staff, no hay análisis automático.
export const A3_BLOCKS = ["PROBLEM", "HYPOTHESIS", "HOW_IT_WORKS", "TEST"] as const;
export type A3Block = (typeof A3_BLOCKS)[number];

// Fases en las que una persona nueva puede iniciar el recorrido.
export const PHASES_OPEN_FOR_START: readonly EventPhase[] = [
  "REGISTRATION",
  "CHECKIN",
  "MATCHING",
  "SPRINT",
];
// Fases en las que el participante puede marcar "ESTOY ACÁ" por su cuenta.
export const PHASES_OPEN_FOR_SELF_CHECKIN: readonly EventPhase[] = ["CHECKIN", "MATCHING"];
// Fases en las que el participante puede completar la reflexión.
export const PHASES_OPEN_FOR_REFLECTION: readonly EventPhase[] = ["REFLECTION", "CLOSED"];

export const ALGORITHM_VERSION = "innovaton-v1";

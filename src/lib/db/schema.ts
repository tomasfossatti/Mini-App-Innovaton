import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  A3_BLOCKS,
  ARTIFACT_TYPES,
  ASSIGNMENT_SOURCES,
  CAPABILITIES,
  EVENT_PHASES,
  EVIDENCE_SCOPES,
  EVIDENCE_SOURCES,
  INTERPRETATION_TYPES,
  MODES,
  PARTICIPATION_STATUSES,
  RECOMMENDATION_TYPES,
  REFLECTION_ACTIONS,
  STAFF_ROLES,
  type A3Block,
  type ReflectionAction,
} from "@/lib/domain/constants";

// Esquema según docs/innovaton/02-technical-spec.md §7.
// Agregados mínimos documentados en docs/innovaton/07-implementation-decisions.md.

export const eventPhaseEnum = pgEnum("event_phase", EVENT_PHASES);
export const participationStatusEnum = pgEnum("participation_status", PARTICIPATION_STATUSES);
export const initialModeEnum = pgEnum("initial_mode", MODES);
export const capabilityKeyEnum = pgEnum("capability_key", CAPABILITIES);
export const assignmentSourceEnum = pgEnum("assignment_source", ASSIGNMENT_SOURCES);
export const evidenceScopeEnum = pgEnum("evidence_scope", EVIDENCE_SCOPES);
export const evidenceSourceEnum = pgEnum("evidence_source", EVIDENCE_SOURCES);
export const interpretationTypeEnum = pgEnum("interpretation_type", INTERPRETATION_TYPES);
export const recommendationTypeEnum = pgEnum("recommendation_type", RECOMMENDATION_TYPES);
export const staffRoleEnum = pgEnum("staff_role", STAFF_ROLES);
export const artifactTypeEnum = pgEnum("artifact_type", ARTIFACT_TYPES);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const participants = pgTable("participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  whatsappNormalized: text("whatsapp_normalized").notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Argentina/Cordoba"),
  locationLabel: text("location_label").notNull().default("Stand Espacio IDI"),
  registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }).notNull(),
  checkinOpensAt: timestamp("checkin_opens_at", { withTimezone: true }).notNull(),
  registrationClosesAt: timestamp("registration_closes_at", { withTimezone: true }).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  phase: eventPhaseEnum("phase").notNull().default("DRAFT"),
  communityUrl: text("community_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const challenges = pgTable(
  "challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    startupName: text("startup_name").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    brief: text("brief").notNull().default(""),
    prize: text("prize"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("challenges_event_idx").on(t.eventId, t.sortOrder)],
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "restrict" }),
    teamNumber: integer("team_number").notNull(),
    tableNumber: integer("table_number").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Bloques del A3 que el staff marcó como completos (sin análisis automático).
    a3Blocks: text("a3_blocks").array().$type<A3Block[]>().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("teams_event_challenge_number_uq").on(t.eventId, t.challengeId, t.teamNumber),
    uniqueIndex("teams_event_table_uq").on(t.eventId, t.tableNumber),
  ],
);

export const participations = pgTable(
  "participations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id").references(() => participants.id, {
      onDelete: "set null",
    }),
    status: participationStatusEnum("status").notNull().default("STARTED"),
    resumeTokenHash: text("resume_token_hash").notNull().unique(),
    preClarity: smallint("pre_clarity"),
    exploreScore: smallint("explore_score").notNull().default(0),
    createScore: smallint("create_score").notNull().default(0),
    driveScore: smallint("drive_score").notNull().default(0),
    initialMode: initialModeEnum("initial_mode"),
    // Si el cuestionario terminó 2–2–1, los dos modos empatados a desempatar.
    tiebreakModes: initialModeEnum("tiebreak_modes").array(),
    firstChoiceId: uuid("first_choice").references(() => challenges.id, { onDelete: "set null" }),
    secondChoiceId: uuid("second_choice").references(() => challenges.id, {
      onDelete: "set null",
    }),
    secondChoiceAny: boolean("second_choice_any").notNull().default(false),
    operationalConsentAt: timestamp("operational_consent_at", { withTimezone: true }),
    communityConsentAt: timestamp("community_consent_at", { withTimezone: true }),
    communityCtaAt: timestamp("community_cta_at", { withTimezone: true }),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    assignmentSource: assignmentSourceEnum("assignment_source"),
    // true cuando el staff dio de alta a la persona (sin cuestionario).
    addedByStaff: boolean("added_by_staff").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("participations_event_participant_uq")
      .on(t.eventId, t.participantId)
      .where(sql`${t.participantId} is not null`),
    index("participations_event_status_idx").on(t.eventId, t.status),
    index("participations_team_idx").on(t.teamId),
  ],
);

export const questionnaireAnswers = pgTable(
  "questionnaire_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participationId: uuid("participation_id")
      .notNull()
      .references(() => participations.id, { onDelete: "cascade" }),
    // Q1..Q5, o TIEBREAK para la pregunta de desempate.
    questionKey: text("question_key").notNull(),
    selectedMode: initialModeEnum("selected_mode").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("questionnaire_answers_uq").on(t.participationId, t.questionKey)],
);

export const reflections = pgTable("reflections", {
  id: uuid("id").primaryKey().defaultRandom(),
  participationId: uuid("participation_id")
    .notNull()
    .unique()
    .references(() => participations.id, { onDelete: "cascade" }),
  postClarity: smallint("post_clarity").notNull(),
  perceivedValue: smallint("perceived_value").notNull(),
  initialModeUsefulness: smallint("initial_mode_usefulness").notNull(),
  selectedActions: text("selected_actions").array().$type<ReflectionAction[]>().notNull(),
  primaryContributionText: text("primary_contribution_text"),
  primaryCapability: capabilityKeyEnum("primary_capability").notNull(),
  createdAt: createdAt(),
});

export const artifactBlobs = pgTable("artifact_blobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  data: bytea("data").notNull(),
  createdAt: createdAt(),
});

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    type: artifactTypeEnum("type").notNull().default("A3_PHOTO"),
    // "db:<uuid de artifact_blobs>" con el driver por defecto.
    storagePath: text("storage_path").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdByStaffId: uuid("created_by_staff_id"),
    createdAt: createdAt(),
  },
  (t) => [index("artifacts_team_idx").on(t.teamId)],
);

export const founderAssessments = pgTable("founder_assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id")
    .notNull()
    .unique()
    .references(() => teams.id, { onDelete: "cascade" }),
  problemScore: smallint("problem_score"),
  valueScore: smallint("value_score"),
  testScore: smallint("test_score"),
  feedback: text("feedback"),
  winner: boolean("winner").notNull().default(false),
  updatedByStaffId: uuid("updated_by_staff_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const founderObservations = pgTable(
  "founder_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    participationId: uuid("participation_id")
      .notNull()
      .references(() => participations.id, { onDelete: "cascade" }),
    capability: capabilityKeyEnum("capability").notNull(),
    // FOUNDER_INDIVIDUAL o FACILITATOR_OBSERVATION.
    observerSource: evidenceSourceEnum("observer_source").notNull(),
    note: text("note"),
    createdByStaffId: uuid("created_by_staff_id"),
    createdAt: createdAt(),
  },
  (t) => [index("founder_observations_team_idx").on(t.teamId)],
);

export const evidenceItems = pgTable(
  "evidence_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    participationId: uuid("participation_id").references(() => participations.id, {
      onDelete: "cascade",
    }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    sourceType: evidenceSourceEnum("source_type").notNull(),
    scope: evidenceScopeEnum("scope").notNull(),
    rawCode: text("raw_code").notNull(),
    rawText: text("raw_text"),
    sourceWeight: doublePrecision("source_weight").notNull(),
    confidence: doublePrecision("confidence").notNull().default(1),
    // Origen que permite reconstruir la evidencia de forma idempotente
    // (p. ej. "reflection:<id>", "founder_assessment:<teamId>", "a3:<teamId>", "observation:<id>").
    originRef: text("origin_ref").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("evidence_items_participation_idx").on(t.participationId),
    index("evidence_items_team_idx").on(t.teamId),
    index("evidence_items_origin_idx").on(t.originRef),
  ],
);

export const capabilitySignals = pgTable(
  "capability_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evidenceItemId: uuid("evidence_item_id")
      .notNull()
      .references(() => evidenceItems.id, { onDelete: "cascade" }),
    capability: capabilityKeyEnum("capability").notNull(),
    strength: doublePrecision("strength").notNull(),
  },
  (t) => [index("capability_signals_item_idx").on(t.evidenceItemId)],
);

export const interpretationSnapshots = pgTable(
  "interpretation_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participationId: uuid("participation_id")
      .notNull()
      .references(() => participations.id, { onDelete: "cascade" }),
    algorithmVersion: text("algorithm_version").notNull(),
    type: interpretationTypeEnum("type").notNull(),
    primaryCapability: capabilityKeyEnum("primary_capability"),
    secondaryCapability: capabilityKeyEnum("secondary_capability"),
    summary: text("summary").notNull(),
    evidenceSnapshot: jsonb("evidence_snapshot").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("interpretation_snapshots_participation_idx").on(t.participationId, t.createdAt)],
);

export const recommendations = pgTable("recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  interpretationId: uuid("interpretation_id")
    .notNull()
    .unique()
    .references(() => interpretationSnapshots.id, { onDelete: "cascade" }),
  capability: capabilityKeyEnum("capability").notNull(),
  type: recommendationTypeEnum("type").notNull(),
  action: text("action").notNull(),
  rationale: text("rationale").notNull(),
  createdAt: createdAt(),
});

export const staffMembers = pgTable("staff_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: staffRoleEnum("role").notNull().default("STAFF"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const staffSessions = pgTable(
  "staff_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("staff_sessions_staff_idx").on(t.staffId)],
);

// Re-export para que los consumidores no dependan de la ruta de constants.
export { A3_BLOCKS, REFLECTION_ACTIONS };

export type EventRow = typeof events.$inferSelect;
export type ChallengeRow = typeof challenges.$inferSelect;
export type ParticipationRow = typeof participations.$inferSelect;
export type ParticipantRow = typeof participants.$inferSelect;
export type TeamRow = typeof teams.$inferSelect;
export type ReflectionRow = typeof reflections.$inferSelect;
export type FounderAssessmentRow = typeof founderAssessments.$inferSelect;
export type FounderObservationRow = typeof founderObservations.$inferSelect;
export type EvidenceItemRow = typeof evidenceItems.$inferSelect;
export type InterpretationSnapshotRow = typeof interpretationSnapshots.$inferSelect;
export type RecommendationRow = typeof recommendations.$inferSelect;
export type StaffMemberRow = typeof staffMembers.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;

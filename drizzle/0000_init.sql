CREATE TYPE "public"."artifact_type" AS ENUM('A3_PHOTO');--> statement-breakpoint
CREATE TYPE "public"."assignment_source" AS ENUM('FIRST_CHOICE', 'SECOND_CHOICE', 'ANY', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."capability_key" AS ENUM('PROBLEM_UNDERSTANDING', 'ASSUMPTION_QUESTIONING', 'IDEATION', 'PRIORITIZATION', 'EXPERIMENTATION', 'COMMUNICATION');--> statement-breakpoint
CREATE TYPE "public"."event_phase" AS ENUM('DRAFT', 'REGISTRATION', 'CHECKIN', 'MATCHING', 'SPRINT', 'PITCH', 'REFLECTION', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."evidence_scope" AS ENUM('INDIVIDUAL', 'TEAM');--> statement-breakpoint
CREATE TYPE "public"."evidence_source" AS ENUM('SELF_REPORT_ACTION', 'SELF_REFLECTION_PRIMARY', 'FOUNDER_INDIVIDUAL', 'FACILITATOR_OBSERVATION', 'FOUNDER_TEAM_SCORE', 'TEAM_ARTIFACT');--> statement-breakpoint
CREATE TYPE "public"."initial_mode" AS ENUM('EXPLORE', 'CREATE', 'DRIVE');--> statement-breakpoint
CREATE TYPE "public"."interpretation_type" AS ENUM('INSUFFICIENT', 'ALIGNED', 'DIVERGENT', 'MIXED');--> statement-breakpoint
CREATE TYPE "public"."participation_status" AS ENUM('STARTED', 'PROFILE_COMPLETED', 'REGISTERED', 'CHECKED_IN', 'MATCHED', 'EXPERIENCE_COMPLETED', 'REFLECTION_COMPLETED', 'INTERPRETED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."recommendation_type" AS ENUM('REPLICATE_SIGNAL', 'INVESTIGATE_DIVERGENCE', 'GATHER_MORE_EVIDENCE', 'EXPLORE_COMPLEMENT');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('ADMIN', 'STAFF');--> statement-breakpoint
CREATE TABLE "artifact_blobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"type" "artifact_type" DEFAULT 'A3_PHOTO' NOT NULL,
	"storage_path" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_item_id" uuid NOT NULL,
	"capability" "capability_key" NOT NULL,
	"strength" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"startup_name" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"prize" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Argentina/Cordoba' NOT NULL,
	"location_label" text DEFAULT 'Stand Espacio IDI' NOT NULL,
	"registration_opens_at" timestamp with time zone NOT NULL,
	"checkin_opens_at" timestamp with time zone NOT NULL,
	"registration_closes_at" timestamp with time zone NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"phase" "event_phase" DEFAULT 'DRAFT' NOT NULL,
	"community_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"participation_id" uuid,
	"team_id" uuid,
	"source_type" "evidence_source" NOT NULL,
	"scope" "evidence_scope" NOT NULL,
	"raw_code" text NOT NULL,
	"raw_text" text,
	"source_weight" double precision NOT NULL,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"origin_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founder_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"problem_score" smallint,
	"value_score" smallint,
	"test_score" smallint,
	"feedback" text,
	"winner" boolean DEFAULT false NOT NULL,
	"updated_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "founder_assessments_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
CREATE TABLE "founder_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"participation_id" uuid NOT NULL,
	"capability" "capability_key" NOT NULL,
	"observer_source" "evidence_source" NOT NULL,
	"note" text,
	"created_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interpretation_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participation_id" uuid NOT NULL,
	"algorithm_version" text NOT NULL,
	"type" "interpretation_type" NOT NULL,
	"primary_capability" "capability_key",
	"secondary_capability" "capability_key",
	"summary" text NOT NULL,
	"evidence_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"whatsapp_normalized" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_whatsapp_normalized_unique" UNIQUE("whatsapp_normalized")
);
--> statement-breakpoint
CREATE TABLE "participations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"participant_id" uuid,
	"status" "participation_status" DEFAULT 'STARTED' NOT NULL,
	"resume_token_hash" text NOT NULL,
	"pre_clarity" smallint,
	"explore_score" smallint DEFAULT 0 NOT NULL,
	"create_score" smallint DEFAULT 0 NOT NULL,
	"drive_score" smallint DEFAULT 0 NOT NULL,
	"initial_mode" "initial_mode",
	"tiebreak_modes" "initial_mode"[],
	"first_choice" uuid,
	"second_choice" uuid,
	"second_choice_any" boolean DEFAULT false NOT NULL,
	"operational_consent_at" timestamp with time zone,
	"community_consent_at" timestamp with time zone,
	"community_cta_at" timestamp with time zone,
	"registered_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"team_id" uuid,
	"assignment_source" "assignment_source",
	"added_by_staff" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participations_resume_token_hash_unique" UNIQUE("resume_token_hash")
);
--> statement-breakpoint
CREATE TABLE "questionnaire_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participation_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"selected_mode" "initial_mode" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interpretation_id" uuid NOT NULL,
	"capability" "capability_key" NOT NULL,
	"type" "recommendation_type" NOT NULL,
	"action" text NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendations_interpretation_id_unique" UNIQUE("interpretation_id")
);
--> statement-breakpoint
CREATE TABLE "reflections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participation_id" uuid NOT NULL,
	"post_clarity" smallint NOT NULL,
	"perceived_value" smallint NOT NULL,
	"initial_mode_usefulness" smallint NOT NULL,
	"selected_actions" text[] NOT NULL,
	"primary_contribution_text" text,
	"primary_capability" "capability_key" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reflections_participation_id_unique" UNIQUE("participation_id")
);
--> statement-breakpoint
CREATE TABLE "staff_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "staff_role" DEFAULT 'STAFF' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_members_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"challenge_id" uuid NOT NULL,
	"team_number" integer NOT NULL,
	"table_number" integer NOT NULL,
	"published_at" timestamp with time zone,
	"a3_blocks" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_signals" ADD CONSTRAINT "capability_signals_evidence_item_id_evidence_items_id_fk" FOREIGN KEY ("evidence_item_id") REFERENCES "public"."evidence_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_assessments" ADD CONSTRAINT "founder_assessments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_observations" ADD CONSTRAINT "founder_observations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_observations" ADD CONSTRAINT "founder_observations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_observations" ADD CONSTRAINT "founder_observations_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interpretation_snapshots" ADD CONSTRAINT "interpretation_snapshots_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_first_choice_challenges_id_fk" FOREIGN KEY ("first_choice") REFERENCES "public"."challenges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_second_choice_challenges_id_fk" FOREIGN KEY ("second_choice") REFERENCES "public"."challenges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_answers" ADD CONSTRAINT "questionnaire_answers_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_interpretation_id_interpretation_snapshots_id_fk" FOREIGN KEY ("interpretation_id") REFERENCES "public"."interpretation_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_team_idx" ON "artifacts" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "capability_signals_item_idx" ON "capability_signals" USING btree ("evidence_item_id");--> statement-breakpoint
CREATE INDEX "challenges_event_idx" ON "challenges" USING btree ("event_id","sort_order");--> statement-breakpoint
CREATE INDEX "evidence_items_participation_idx" ON "evidence_items" USING btree ("participation_id");--> statement-breakpoint
CREATE INDEX "evidence_items_team_idx" ON "evidence_items" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "evidence_items_origin_idx" ON "evidence_items" USING btree ("origin_ref");--> statement-breakpoint
CREATE INDEX "founder_observations_team_idx" ON "founder_observations" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "interpretation_snapshots_participation_idx" ON "interpretation_snapshots" USING btree ("participation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "participations_event_participant_uq" ON "participations" USING btree ("event_id","participant_id") WHERE "participations"."participant_id" is not null;--> statement-breakpoint
CREATE INDEX "participations_event_status_idx" ON "participations" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "participations_team_idx" ON "participations" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_answers_uq" ON "questionnaire_answers" USING btree ("participation_id","question_key");--> statement-breakpoint
CREATE INDEX "staff_sessions_staff_idx" ON "staff_sessions" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_event_challenge_number_uq" ON "teams" USING btree ("event_id","challenge_id","team_number");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_event_table_uq" ON "teams" USING btree ("event_id","table_number");
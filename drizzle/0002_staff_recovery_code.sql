ALTER TABLE "participations" ADD COLUMN "recovery_code_hash" text;--> statement-breakpoint
ALTER TABLE "participations" ADD COLUMN "recovery_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "participations" ADD COLUMN "recovery_attempts" smallint DEFAULT 0 NOT NULL;
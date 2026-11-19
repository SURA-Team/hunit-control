CREATE TYPE "public"."commercial_event_type" AS ENUM('dispatched', 'withdrawn', 'line_cancelled', 'line_restored', 'line_concluded', 'return_received', 'return_changed', 'return_ignored', 'return_confirmed', 'return_rejected', 'return_confirmation_undone', 'return_closed');--> statement-breakpoint
CREATE TYPE "public"."commercial_line_state" AS ENUM('open', 'concluded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."commercial_return_state" AS ENUM('awaiting_validation', 'confirmed', 'rejected', 'superseded', 'closed');--> statement-breakpoint
CREATE TYPE "public"."dispatch_item_outcome" AS ENUM('pending', 'sent', 'withdrawn', 'not_verified', 'ignored');--> statement-breakpoint
CREATE TABLE "commercial_dispatch_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"status" "execution_status",
	"hotel_code" text,
	"reservation_number" text,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_dispatch_items" (
	"dispatch_id" uuid NOT NULL,
	"hotel_code" text NOT NULL,
	"reservation_number" text NOT NULL,
	"position" integer NOT NULL,
	"outcome" "dispatch_item_outcome" DEFAULT 'pending' NOT NULL,
	"classification_before" "classification",
	"classification_after" "classification",
	"reason" text,
	"processed_at" timestamp with time zone,
	CONSTRAINT "commercial_dispatch_items_dispatch_id_hotel_code_reservation_number_pk" PRIMARY KEY("dispatch_id","hotel_code","reservation_number"),
	CONSTRAINT "commercial_dispatch_items_position_check" CHECK ("commercial_dispatch_items"."position" >= 1),
	CONSTRAINT "commercial_dispatch_items_processed_check" CHECK (("commercial_dispatch_items"."outcome" = 'pending') = ("commercial_dispatch_items"."processed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "commercial_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_key" text NOT NULL,
	"client_id" uuid NOT NULL,
	"parent_dispatch_id" uuid,
	"status" "execution_status" DEFAULT 'queued' NOT NULL,
	"end_reason" "execution_end_reason",
	"two_factor_deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cancelled_by_client_id" uuid,
	CONSTRAINT "commercial_dispatches_end_reason_check" CHECK ("commercial_dispatches"."status" not in ('failed', 'cancelled') or "commercial_dispatches"."end_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "commercial_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"hotel_code" text NOT NULL,
	"reservation_number" text NOT NULL,
	"type" "commercial_event_type" NOT NULL,
	"dispatch_id" uuid,
	"return_id" uuid,
	"client_id" uuid,
	"classification" "classification",
	"reason" text,
	"batch_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_lines" (
	"hotel_code" text NOT NULL,
	"reservation_number" text NOT NULL,
	"state" "commercial_line_state" DEFAULT 'open' NOT NULL,
	"first_sent_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL,
	"last_dispatch_id" uuid NOT NULL,
	"last_sent_by_client_id" uuid NOT NULL,
	"concluded_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_client_id" uuid,
	"removed_from_sheet_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"synced_version" integer DEFAULT 0 NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone,
	"last_read_return" jsonb,
	"return_problem" text,
	"return_problem_at" timestamp with time zone,
	"sheet_issue" text,
	"sheet_issue_at" timestamp with time zone,
	CONSTRAINT "commercial_lines_hotel_code_reservation_number_pk" PRIMARY KEY("hotel_code","reservation_number"),
	CONSTRAINT "commercial_lines_cancelled_check" CHECK (("commercial_lines"."state" = 'cancelled') = ("commercial_lines"."cancelled_at" is not null)
        and ("commercial_lines"."cancelled_at" is null) = ("commercial_lines"."cancelled_by_client_id" is null)),
	CONSTRAINT "commercial_lines_concluded_check" CHECK (("commercial_lines"."state" = 'open') = ("commercial_lines"."concluded_at" is null)),
	CONSTRAINT "commercial_lines_version_check" CHECK ("commercial_lines"."version" >= 1 and "commercial_lines"."synced_version" between 0 and "commercial_lines"."version")
);
--> statement-breakpoint
CREATE TABLE "commercial_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_code" text NOT NULL,
	"reservation_number" text NOT NULL,
	"authorization_code" text NOT NULL,
	"charge_hotel" text NOT NULL,
	"charged_amount" numeric(12, 2) NOT NULL,
	"charged_by" text NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"state" "commercial_return_state" DEFAULT 'awaiting_validation' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_client_id" uuid,
	"rejection_reason" text,
	"batch_id" uuid,
	CONSTRAINT "commercial_returns_texts_check" CHECK (char_length("commercial_returns"."authorization_code") between 1 and 100
        and char_length("commercial_returns"."charge_hotel") between 1 and 100
        and char_length("commercial_returns"."charged_by") between 1 and 100),
	CONSTRAINT "commercial_returns_amount_check" CHECK ("commercial_returns"."charged_amount" > 0),
	CONSTRAINT "commercial_returns_rejection_reason_check" CHECK ("commercial_returns"."rejection_reason" is null or char_length("commercial_returns"."rejection_reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "commercial_sheet_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"last_round_at" timestamp with time zone,
	"last_round_ok_at" timestamp with time zone,
	"last_read_ok_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"round_problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "commercial_sheet_state_single_row_check" CHECK ("commercial_sheet_state"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "evidence" ALTER COLUMN "execution_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "dispatch_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "last_dispatch_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_dispatch_events" ADD CONSTRAINT "commercial_dispatch_events_dispatch_id_commercial_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."commercial_dispatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_dispatch_items" ADD CONSTRAINT "commercial_dispatch_items_dispatch_id_commercial_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."commercial_dispatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_dispatches" ADD CONSTRAINT "commercial_dispatches_client_id_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_dispatches" ADD CONSTRAINT "commercial_dispatches_parent_dispatch_id_commercial_dispatches_id_fk" FOREIGN KEY ("parent_dispatch_id") REFERENCES "public"."commercial_dispatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_dispatches" ADD CONSTRAINT "commercial_dispatches_cancelled_by_client_id_api_clients_id_fk" FOREIGN KEY ("cancelled_by_client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_dispatch_id_commercial_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."commercial_dispatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_return_id_commercial_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."commercial_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_client_id_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_reservation_fk" FOREIGN KEY ("hotel_code","reservation_number") REFERENCES "public"."reservations"("hotel_code","reservation_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_lines" ADD CONSTRAINT "commercial_lines_last_dispatch_id_commercial_dispatches_id_fk" FOREIGN KEY ("last_dispatch_id") REFERENCES "public"."commercial_dispatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_lines" ADD CONSTRAINT "commercial_lines_last_sent_by_client_id_api_clients_id_fk" FOREIGN KEY ("last_sent_by_client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_lines" ADD CONSTRAINT "commercial_lines_cancelled_by_client_id_api_clients_id_fk" FOREIGN KEY ("cancelled_by_client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_lines" ADD CONSTRAINT "commercial_lines_reservation_fk" FOREIGN KEY ("hotel_code","reservation_number") REFERENCES "public"."reservations"("hotel_code","reservation_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_returns" ADD CONSTRAINT "commercial_returns_decided_by_client_id_api_clients_id_fk" FOREIGN KEY ("decided_by_client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_returns" ADD CONSTRAINT "commercial_returns_reservation_fk" FOREIGN KEY ("hotel_code","reservation_number") REFERENCES "public"."reservations"("hotel_code","reservation_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commercial_dispatch_events_dispatch_id_idx" ON "commercial_dispatch_events" USING btree ("dispatch_id","id");--> statement-breakpoint
CREATE INDEX "commercial_dispatch_items_reservation_idx" ON "commercial_dispatch_items" USING btree ("hotel_code","reservation_number");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_dispatches_one_active_per_account" ON "commercial_dispatches" USING btree ("account_key") WHERE "commercial_dispatches"."status" in ('queued', 'running', 'awaiting_2fa');--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_dispatches_one_resume_per_parent" ON "commercial_dispatches" USING btree ("parent_dispatch_id");--> statement-breakpoint
CREATE INDEX "commercial_dispatches_created_at_idx" ON "commercial_dispatches" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "commercial_events_reservation_idx" ON "commercial_events" USING btree ("hotel_code","reservation_number","id");--> statement-breakpoint
CREATE INDEX "commercial_lines_pending_idx" ON "commercial_lines" USING btree ("changed_at") WHERE "commercial_lines"."synced_version" < "commercial_lines"."version";--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_returns_one_current" ON "commercial_returns" USING btree ("hotel_code","reservation_number") WHERE "commercial_returns"."state" in ('awaiting_validation', 'confirmed');--> statement-breakpoint
CREATE INDEX "commercial_returns_reservation_idx" ON "commercial_returns" USING btree ("hotel_code","reservation_number");--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_dispatch_id_commercial_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."commercial_dispatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_last_dispatch_id_commercial_dispatches_id_fk" FOREIGN KEY ("last_dispatch_id") REFERENCES "public"."commercial_dispatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_owner_check" CHECK (num_nonnulls("evidence"."execution_id", "evidence"."dispatch_id") = 1);
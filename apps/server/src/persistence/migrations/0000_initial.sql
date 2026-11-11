CREATE TYPE "public"."classification" AS ENUM('ignored_hotelbeds_258', 'not_virtual_card', 'virtual_card_charge_error', 'virtual_card_already_charged', 'virtual_card_validated_only', 'virtual_card_pending_charge', 'analysis_error');--> statement-breakpoint
CREATE TYPE "public"."client_role" AS ENUM('operator', 'reader');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('navigation_failure', 'classification_failure', 'screen_not_recognized', 'reservation_status_unknown');--> statement-breakpoint
CREATE TYPE "public"."execution_end_reason" AS ENUM('invalid_credentials', 'invalid_token', 'two_factor_timeout', 'hunit_unavailable', 'hunit_screen_not_recognized', 'session_expired', 'server_restarted', 'cancelled_by_client', 'internal_error');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('queued', 'running', 'awaiting_2fa', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."hotel_run_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('active', 'cancelled', 'unknown');--> statement-breakpoint
CREATE TABLE "api_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" "client_role" NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_clients_name_unique" UNIQUE("name"),
	CONSTRAINT "api_clients_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"hotel_code" text,
	"reservation_number" text,
	"kind" "evidence_kind" NOT NULL,
	"reason" text NOT NULL,
	"screenshot_path" text,
	"html_path" text,
	"response_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evidence_has_file_check" CHECK (num_nonnulls("evidence"."screenshot_path", "evidence"."html_path", "evidence"."response_path") >= 1)
);
--> statement-breakpoint
CREATE TABLE "execution_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"status" "execution_status",
	"hotel_code" text,
	"reservation_number" text,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_hotels" (
	"execution_id" uuid NOT NULL,
	"hotel_code" text NOT NULL,
	"status" "hotel_run_status" DEFAULT 'pending' NOT NULL,
	"pages_total" integer,
	"pages_done" integer,
	"reservations_seen" integer DEFAULT 0 NOT NULL,
	"reservations_opened" integer DEFAULT 0 NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_reason" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "execution_hotels_execution_id_hotel_code_pk" PRIMARY KEY("execution_id","hotel_code")
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_key" text NOT NULL,
	"client_id" uuid NOT NULL,
	"parent_execution_id" uuid,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"requested_hotel_codes" text[],
	"status" "execution_status" DEFAULT 'queued' NOT NULL,
	"end_reason" "execution_end_reason",
	"two_factor_deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cancelled_by_client_id" uuid,
	CONSTRAINT "executions_period_check" CHECK ("executions"."period_from" <= "executions"."period_to"),
	CONSTRAINT "executions_end_reason_check" CHECK ("executions"."status" not in ('failed', 'cancelled') or "executions"."end_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "hotels" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_observations" (
	"execution_id" uuid NOT NULL,
	"hotel_code" text NOT NULL,
	"reservation_number" text NOT NULL,
	"classification" "classification" NOT NULL,
	"reservation_status" "reservation_status" NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_observations_execution_id_hotel_code_reservation_number_pk" PRIMARY KEY("execution_id","hotel_code","reservation_number")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"hotel_code" text NOT NULL,
	"reservation_number" text NOT NULL,
	"guest_name" text,
	"channel" text NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"stay_period" text NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"reservation_status" "reservation_status" NOT NULL,
	"classification" "classification" NOT NULL,
	"reason" text NOT NULL,
	"pre_payment_found" boolean NOT NULL,
	"charged_at" timestamp with time zone,
	"charged_by" text,
	"charged_amount" numeric(12, 2),
	"transaction_id" text,
	"authorization_code" text,
	"processor_reference" text,
	"is_installment" boolean,
	"installment_count" integer,
	"installment_amount" numeric(12, 2),
	"pre_payment_state" text,
	"pre_payment_message" text,
	"charge_action_visible" boolean NOT NULL,
	"first_verified_at" timestamp with time zone NOT NULL,
	"last_verified_at" timestamp with time zone NOT NULL,
	"verification_count" integer DEFAULT 1 NOT NULL,
	"changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"status_changed" boolean DEFAULT false NOT NULL,
	"previous_classification" "classification",
	"previous_reservation_status" "reservation_status",
	"status_changed_at" timestamp with time zone,
	"not_found_since" timestamp with time zone,
	"last_execution_id" uuid NOT NULL,
	"anonymized_at" timestamp with time zone,
	CONSTRAINT "reservations_hotel_code_reservation_number_pk" PRIMARY KEY("hotel_code","reservation_number"),
	CONSTRAINT "reservations_verification_count_check" CHECK ("reservations"."verification_count" >= 1)
);
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_hotels" ADD CONSTRAINT "execution_hotels_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_hotels" ADD CONSTRAINT "execution_hotels_hotel_code_hotels_code_fk" FOREIGN KEY ("hotel_code") REFERENCES "public"."hotels"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_client_id_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_parent_execution_id_executions_id_fk" FOREIGN KEY ("parent_execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_cancelled_by_client_id_api_clients_id_fk" FOREIGN KEY ("cancelled_by_client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_observations" ADD CONSTRAINT "reservation_observations_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_observations" ADD CONSTRAINT "reservation_observations_reservation_fk" FOREIGN KEY ("hotel_code","reservation_number") REFERENCES "public"."reservations"("hotel_code","reservation_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_hotel_code_hotels_code_fk" FOREIGN KEY ("hotel_code") REFERENCES "public"."hotels"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_last_execution_id_executions_id_fk" FOREIGN KEY ("last_execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_expires_at_idx" ON "evidence" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "execution_events_execution_id_idx" ON "execution_events" USING btree ("execution_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "executions_one_active_per_account" ON "executions" USING btree ("account_key") WHERE "executions"."status" in ('queued', 'running', 'awaiting_2fa');--> statement-breakpoint
CREATE INDEX "reservations_classification_idx" ON "reservations" USING btree ("classification");--> statement-breakpoint
CREATE INDEX "reservations_reservation_status_idx" ON "reservations" USING btree ("reservation_status");--> statement-breakpoint
CREATE INDEX "reservations_hotel_check_in_idx" ON "reservations" USING btree ("hotel_code","check_in");--> statement-breakpoint
CREATE INDEX "reservations_not_found_since_idx" ON "reservations" USING btree ("not_found_since") WHERE "reservations"."not_found_since" is not null;--> statement-breakpoint
CREATE INDEX "reservations_check_in_not_anonymized_idx" ON "reservations" USING btree ("check_in") WHERE "reservations"."anonymized_at" is null;
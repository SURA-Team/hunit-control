CREATE TYPE "public"."legacy_hotel_decision" AS ENUM('proposed', 'confirmed', 'unmapped');--> statement-breakpoint
CREATE TYPE "public"."legacy_import_kind" AS ENUM('simulation', 'import');--> statement-breakpoint
CREATE TYPE "public"."legacy_import_status" AS ENUM('running', 'completed', 'failed', 'interrupted');--> statement-breakpoint
CREATE TABLE "legacy_hotel_mappings" (
	"legacy_key" text PRIMARY KEY NOT NULL,
	"legacy_name" text NOT NULL,
	"decision" "legacy_hotel_decision" DEFAULT 'proposed' NOT NULL,
	"hotel_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_hotel_mappings_decision_check" CHECK (("legacy_hotel_mappings"."decision" <> 'confirmed' or "legacy_hotel_mappings"."hotel_code" is not null)
        and ("legacy_hotel_mappings"."decision" <> 'unmapped' or "legacy_hotel_mappings"."hotel_code" is null))
);
--> statement-breakpoint
CREATE TABLE "legacy_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "legacy_import_kind" NOT NULL,
	"simulation_id" uuid,
	"status" "legacy_import_status" DEFAULT 'running' NOT NULL,
	"fingerprint" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"counts" jsonb,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"differences" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "legacy_imports_simulation_check" CHECK (("legacy_imports"."kind" = 'import') = ("legacy_imports"."simulation_id" is not null)),
	CONSTRAINT "legacy_imports_finished_check" CHECK (("legacy_imports"."status" = 'running') = ("legacy_imports"."finished_at" is null))
);
--> statement-breakpoint
CREATE TABLE "legacy_reservations" (
	"hotel_code" text NOT NULL,
	"reservation_number" text NOT NULL,
	"legacy_hotel_key" text NOT NULL,
	"original_classification" text NOT NULL,
	"original_previous_classification" text,
	"first_verified_at" timestamp with time zone NOT NULL,
	"last_verified_at" timestamp with time zone NOT NULL,
	"verification_count" integer NOT NULL,
	"merged" boolean NOT NULL,
	"applied_count" integer NOT NULL,
	"row_hash" text NOT NULL,
	"first_import_id" uuid NOT NULL,
	"last_import_id" uuid NOT NULL,
	CONSTRAINT "legacy_reservations_hotel_code_reservation_number_pk" PRIMARY KEY("hotel_code","reservation_number"),
	CONSTRAINT "legacy_reservations_verification_count_check" CHECK ("legacy_reservations"."verification_count" >= 1)
);
--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "last_execution_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reservation_manual_amounts" ADD COLUMN "legacy_import_id" uuid;--> statement-breakpoint
ALTER TABLE "treatment_documents" ADD COLUMN "legacy_import_id" uuid;--> statement-breakpoint
ALTER TABLE "treatment_events" ADD COLUMN "legacy_import_id" uuid;--> statement-breakpoint
ALTER TABLE "legacy_hotel_mappings" ADD CONSTRAINT "legacy_hotel_mappings_hotel_code_hotels_code_fk" FOREIGN KEY ("hotel_code") REFERENCES "public"."hotels"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_imports" ADD CONSTRAINT "legacy_imports_simulation_id_legacy_imports_id_fk" FOREIGN KEY ("simulation_id") REFERENCES "public"."legacy_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_reservations" ADD CONSTRAINT "legacy_reservations_first_import_id_legacy_imports_id_fk" FOREIGN KEY ("first_import_id") REFERENCES "public"."legacy_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_reservations" ADD CONSTRAINT "legacy_reservations_last_import_id_legacy_imports_id_fk" FOREIGN KEY ("last_import_id") REFERENCES "public"."legacy_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_reservations" ADD CONSTRAINT "legacy_reservations_reservation_fk" FOREIGN KEY ("hotel_code","reservation_number") REFERENCES "public"."reservations"("hotel_code","reservation_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_manual_amounts" ADD CONSTRAINT "reservation_manual_amounts_legacy_import_id_legacy_imports_id_fk" FOREIGN KEY ("legacy_import_id") REFERENCES "public"."legacy_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_documents" ADD CONSTRAINT "treatment_documents_legacy_import_id_legacy_imports_id_fk" FOREIGN KEY ("legacy_import_id") REFERENCES "public"."legacy_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_events" ADD CONSTRAINT "treatment_events_legacy_import_id_legacy_imports_id_fk" FOREIGN KEY ("legacy_import_id") REFERENCES "public"."legacy_imports"("id") ON DELETE no action ON UPDATE no action;
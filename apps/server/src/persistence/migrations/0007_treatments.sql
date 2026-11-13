CREATE TYPE "public"."treatment_document_kind" AS ENUM('request', 'proof');--> statement-breakpoint
CREATE TYPE "public"."treatment_document_state" AS ENUM('current', 'replaced', 'removed', 'purged');--> statement-breakpoint
CREATE TYPE "public"."treatment_event_type" AS ENUM('attached', 'replaced', 'removed', 'reverted', 'amount_set', 'amount_cleared');--> statement-breakpoint
CREATE TABLE "reservation_manual_amounts" (
	"hotel_code" text NOT NULL,
	"reservation_number" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"set_by_client_id" uuid NOT NULL,
	CONSTRAINT "reservation_manual_amounts_hotel_code_reservation_number_pk" PRIMARY KEY("hotel_code","reservation_number"),
	CONSTRAINT "reservation_manual_amounts_amount_check" CHECK ("reservation_manual_amounts"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "treatment_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_code" text NOT NULL,
	"reservation_number" text NOT NULL,
	"kind" "treatment_document_kind" NOT NULL,
	"state" "treatment_document_state" DEFAULT 'current' NOT NULL,
	"file_sha256" text,
	"original_name" text,
	"size_bytes" integer NOT NULL,
	"media_type" text NOT NULL,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attached_by_client_id" uuid NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by_client_id" uuid,
	"purged_at" timestamp with time zone,
	CONSTRAINT "treatment_documents_state_check" CHECK (("treatment_documents"."state" = 'current' and "treatment_documents"."ended_at" is null)
        or ("treatment_documents"."state" in ('replaced', 'removed') and "treatment_documents"."ended_at" is not null)
        or "treatment_documents"."state" = 'purged'),
	CONSTRAINT "treatment_documents_purged_check" CHECK (("treatment_documents"."state" = 'purged') = ("treatment_documents"."file_sha256" is null)
        and ("treatment_documents"."state" = 'purged') = ("treatment_documents"."original_name" is null)
        and ("treatment_documents"."state" = 'purged') = ("treatment_documents"."purged_at" is not null)),
	CONSTRAINT "treatment_documents_ended_by_check" CHECK (("treatment_documents"."ended_at" is null) = ("treatment_documents"."ended_by_client_id" is null))
);
--> statement-breakpoint
CREATE TABLE "treatment_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"hotel_code" text NOT NULL,
	"reservation_number" text NOT NULL,
	"type" "treatment_event_type" NOT NULL,
	"kind" "treatment_document_kind",
	"document_id" uuid,
	"previous_document_id" uuid,
	"amount" numeric(12, 2),
	"batch_id" uuid,
	"client_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatment_files" (
	"sha256" text PRIMARY KEY NOT NULL,
	"content" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"media_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_client_id" uuid NOT NULL,
	CONSTRAINT "treatment_files_sha256_check" CHECK ("treatment_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "treatment_files_size_check" CHECK ("treatment_files"."size_bytes" = octet_length("treatment_files"."content") and "treatment_files"."size_bytes" between 1 and 26214400)
);
--> statement-breakpoint
ALTER TABLE "reservation_manual_amounts" ADD CONSTRAINT "reservation_manual_amounts_set_by_client_id_api_clients_id_fk" FOREIGN KEY ("set_by_client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_manual_amounts" ADD CONSTRAINT "reservation_manual_amounts_reservation_fk" FOREIGN KEY ("hotel_code","reservation_number") REFERENCES "public"."reservations"("hotel_code","reservation_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_documents" ADD CONSTRAINT "treatment_documents_file_sha256_treatment_files_sha256_fk" FOREIGN KEY ("file_sha256") REFERENCES "public"."treatment_files"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_documents" ADD CONSTRAINT "treatment_documents_attached_by_client_id_api_clients_id_fk" FOREIGN KEY ("attached_by_client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_documents" ADD CONSTRAINT "treatment_documents_ended_by_client_id_api_clients_id_fk" FOREIGN KEY ("ended_by_client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_documents" ADD CONSTRAINT "treatment_documents_reservation_fk" FOREIGN KEY ("hotel_code","reservation_number") REFERENCES "public"."reservations"("hotel_code","reservation_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_events" ADD CONSTRAINT "treatment_events_document_id_treatment_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."treatment_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_events" ADD CONSTRAINT "treatment_events_previous_document_id_treatment_documents_id_fk" FOREIGN KEY ("previous_document_id") REFERENCES "public"."treatment_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_events" ADD CONSTRAINT "treatment_events_client_id_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_events" ADD CONSTRAINT "treatment_events_reservation_fk" FOREIGN KEY ("hotel_code","reservation_number") REFERENCES "public"."reservations"("hotel_code","reservation_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_files" ADD CONSTRAINT "treatment_files_uploaded_by_client_id_api_clients_id_fk" FOREIGN KEY ("uploaded_by_client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_documents_one_current" ON "treatment_documents" USING btree ("hotel_code","reservation_number","kind") WHERE "treatment_documents"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "treatment_documents_reservation_idx" ON "treatment_documents" USING btree ("hotel_code","reservation_number");--> statement-breakpoint
CREATE INDEX "treatment_documents_ended_at_idx" ON "treatment_documents" USING btree ("ended_at") WHERE "treatment_documents"."state" in ('replaced', 'removed');--> statement-breakpoint
CREATE INDEX "treatment_documents_file_idx" ON "treatment_documents" USING btree ("file_sha256");--> statement-breakpoint
CREATE INDEX "treatment_events_reservation_idx" ON "treatment_events" USING btree ("hotel_code","reservation_number","id");
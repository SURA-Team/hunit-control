-- specs/008 (data-model §1 e §2): marcação "Cancelada sem cobrança", relatos do Comercial,
-- situação e data da cobrança no retorno e a verificação da fila "Cobradas no Hunit".
CREATE TYPE "public"."charge_situation_kind" AS ENUM('charged_at_terminal', 'charged_in_hunit', 'not_charged', 'other');--> statement-breakpoint
CREATE TYPE "public"."commercial_report_kind" AS ENUM('charged_in_hunit', 'not_charged');--> statement-breakpoint
CREATE TYPE "public"."dispatch_purpose" AS ENUM('send', 'hunit_check');--> statement-breakpoint
CREATE TYPE "public"."hunit_check_result" AS ENUM('confirmed', 'not_found');--> statement-breakpoint
ALTER TYPE "public"."commercial_event_type" ADD VALUE 'report_received';--> statement-breakpoint
ALTER TYPE "public"."commercial_event_type" ADD VALUE 'report_changed';--> statement-breakpoint
ALTER TYPE "public"."commercial_event_type" ADD VALUE 'report_cleared';--> statement-breakpoint
ALTER TYPE "public"."commercial_event_type" ADD VALUE 'hunit_checked';--> statement-breakpoint
ALTER TYPE "public"."dispatch_item_outcome" ADD VALUE 'checked';--> statement-breakpoint
CREATE TABLE "commercial_reports" (
	"hotel_code" text NOT NULL,
	"reservation_number" text NOT NULL,
	"kind" "commercial_report_kind" NOT NULL,
	"situation_text" text NOT NULL,
	"charged_by" text NOT NULL,
	"charge_date" date,
	"read_at" timestamp with time zone NOT NULL,
	"settled_result" "hunit_check_result",
	"settled_at" timestamp with time zone,
	CONSTRAINT "commercial_reports_hotel_code_reservation_number_pk" PRIMARY KEY("hotel_code","reservation_number"),
	CONSTRAINT "commercial_reports_settled_check" CHECK (("commercial_reports"."settled_result" is null) = ("commercial_reports"."settled_at" is null)),
	CONSTRAINT "commercial_reports_texts_check" CHECK (char_length("commercial_reports"."situation_text") between 1 and 100
        and char_length("commercial_reports"."charged_by") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "no_charge_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_code" text NOT NULL,
	"reservation_number" text NOT NULL,
	"previous_amount" numeric(12, 2),
	"note" text,
	"marked_by_client_id" uuid NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_by_client_id" uuid,
	"undone_at" timestamp with time zone,
	CONSTRAINT "no_charge_marks_note_check" CHECK ("no_charge_marks"."note" is null or char_length("no_charge_marks"."note") between 1 and 500),
	CONSTRAINT "no_charge_marks_undone_check" CHECK (("no_charge_marks"."undone_at" is null) = ("no_charge_marks"."undone_by_client_id" is null))
);
--> statement-breakpoint
ALTER TABLE "commercial_dispatch_items" ADD COLUMN "check_result" "hunit_check_result";--> statement-breakpoint
ALTER TABLE "commercial_dispatches" ADD COLUMN "purpose" "dispatch_purpose" DEFAULT 'send' NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_returns" ADD COLUMN "charge_situation_text" text;--> statement-breakpoint
ALTER TABLE "commercial_returns" ADD COLUMN "charge_situation_kind" charge_situation_kind;--> statement-breakpoint
ALTER TABLE "commercial_returns" ADD COLUMN "charge_date" date;--> statement-breakpoint
ALTER TABLE "commercial_reports" ADD CONSTRAINT "commercial_reports_reservation_fk" FOREIGN KEY ("hotel_code","reservation_number") REFERENCES "public"."reservations"("hotel_code","reservation_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "no_charge_marks" ADD CONSTRAINT "no_charge_marks_marked_by_client_id_api_clients_id_fk" FOREIGN KEY ("marked_by_client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "no_charge_marks" ADD CONSTRAINT "no_charge_marks_undone_by_client_id_api_clients_id_fk" FOREIGN KEY ("undone_by_client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "no_charge_marks" ADD CONSTRAINT "no_charge_marks_reservation_fk" FOREIGN KEY ("hotel_code","reservation_number") REFERENCES "public"."reservations"("hotel_code","reservation_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "no_charge_marks_one_active" ON "no_charge_marks" USING btree ("hotel_code","reservation_number") WHERE "no_charge_marks"."undone_at" is null;--> statement-breakpoint
CREATE INDEX "no_charge_marks_reservation_idx" ON "no_charge_marks" USING btree ("hotel_code","reservation_number");--> statement-breakpoint
ALTER TABLE "commercial_dispatch_items" ADD CONSTRAINT "commercial_dispatch_items_check_result_check" CHECK (("commercial_dispatch_items"."check_result" is not null) = ("commercial_dispatch_items"."outcome"::text = 'checked'));--> statement-breakpoint
ALTER TABLE "commercial_returns" ADD CONSTRAINT "commercial_returns_charge_situation_check" CHECK ("commercial_returns"."charge_situation_text" is null or char_length("commercial_returns"."charge_situation_text") between 1 and 100);
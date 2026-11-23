CREATE TYPE "public"."commercial_report_validation" AS ENUM('awaiting_validation', 'confirmed', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."commercial_event_type" ADD VALUE 'cancellation_confirmed';--> statement-breakpoint
ALTER TYPE "public"."commercial_event_type" ADD VALUE 'cancellation_rejected';--> statement-breakpoint
ALTER TABLE "commercial_reports" DROP CONSTRAINT "commercial_reports_texts_check";--> statement-breakpoint
-- "Não cobrada" virou "Cancelada" (homologação da 008, research R-19): renomeia o valor, sem
-- recriar os tipos, para as linhas já gravadas continuarem valendo.
ALTER TYPE "public"."charge_situation_kind" RENAME VALUE 'not_charged' TO 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."commercial_report_kind" RENAME VALUE 'not_charged' TO 'cancelled';--> statement-breakpoint
ALTER TABLE "commercial_reports" ALTER COLUMN "charged_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_reports" ADD COLUMN "validation_state" "commercial_report_validation";--> statement-breakpoint
ALTER TABLE "commercial_reports" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commercial_reports" ADD COLUMN "decided_by_client_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_reports" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "commercial_reports" ADD COLUMN "no_charge_mark_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_reports" ADD CONSTRAINT "commercial_reports_decided_by_client_id_api_clients_id_fk" FOREIGN KEY ("decided_by_client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_reports" ADD CONSTRAINT "commercial_reports_no_charge_mark_id_no_charge_marks_id_fk" FOREIGN KEY ("no_charge_mark_id") REFERENCES "public"."no_charge_marks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- As "Cancelada" já gravadas aguardam a validação do Financeiro.
UPDATE "commercial_reports" SET "validation_state" = 'awaiting_validation' WHERE "kind"::text = 'cancelled';--> statement-breakpoint
ALTER TABLE "commercial_reports" ADD CONSTRAINT "commercial_reports_kind_check" CHECK (("commercial_reports"."kind"::text = 'charged_in_hunit' and "commercial_reports"."charged_by" is not null
          and "commercial_reports"."validation_state" is null)
        or ("commercial_reports"."kind"::text = 'cancelled' and "commercial_reports"."validation_state" is not null));--> statement-breakpoint
ALTER TABLE "commercial_reports" ADD CONSTRAINT "commercial_reports_texts_check" CHECK (char_length("commercial_reports"."situation_text") between 1 and 100
        and ("commercial_reports"."charged_by" is null or char_length("commercial_reports"."charged_by") between 1 and 100)
        and ("commercial_reports"."rejection_reason" is null or char_length("commercial_reports"."rejection_reason") between 1 and 500));
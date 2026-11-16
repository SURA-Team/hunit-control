ALTER TYPE "public"."treatment_event_type" ADD VALUE 'review_confirmed';--> statement-breakpoint
ALTER TABLE "treatment_events" ADD COLUMN "classification" "classification";
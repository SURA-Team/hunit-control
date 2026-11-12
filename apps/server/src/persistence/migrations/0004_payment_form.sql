ALTER TYPE "public"."classification" ADD VALUE 'invoiced' BEFORE 'not_virtual_card';--> statement-breakpoint
ALTER TYPE "public"."classification" ADD VALUE 'charge_at_terminal' BEFORE 'not_virtual_card';--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "payment_form" text;
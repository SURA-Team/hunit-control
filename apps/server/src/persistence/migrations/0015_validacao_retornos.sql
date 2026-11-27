ALTER TABLE "commercial_returns" DROP CONSTRAINT "commercial_returns_texts_check";--> statement-breakpoint
ALTER TABLE "commercial_returns" DROP CONSTRAINT "commercial_returns_amount_check";--> statement-breakpoint
ALTER TABLE "commercial_returns" ALTER COLUMN "authorization_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_returns" ALTER COLUMN "charge_hotel" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_returns" ALTER COLUMN "charged_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_returns" ADD COLUMN "no_charge_mark_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_returns" ADD CONSTRAINT "commercial_returns_no_charge_mark_id_no_charge_marks_id_fk" FOREIGN KEY ("no_charge_mark_id") REFERENCES "public"."no_charge_marks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_returns" ADD CONSTRAINT "commercial_returns_terminal_fields_check" CHECK (coalesce("commercial_returns"."charge_situation_kind"::text, '') = 'other'
        or ("commercial_returns"."authorization_code" is not null and "commercial_returns"."charge_hotel" is not null
          and "commercial_returns"."charged_amount" is not null));--> statement-breakpoint
ALTER TABLE "commercial_returns" ADD CONSTRAINT "commercial_returns_no_charge_check" CHECK ("commercial_returns"."no_charge_mark_id" is null
        or ("commercial_returns"."state"::text = 'closed'
          and coalesce("commercial_returns"."charge_situation_kind"::text, '') = 'other'));--> statement-breakpoint
ALTER TABLE "commercial_returns" ADD CONSTRAINT "commercial_returns_texts_check" CHECK (("commercial_returns"."authorization_code" is null or char_length("commercial_returns"."authorization_code") between 1 and 100)
        and ("commercial_returns"."charge_hotel" is null or char_length("commercial_returns"."charge_hotel") between 1 and 100)
        and char_length("commercial_returns"."charged_by") between 1 and 100);--> statement-breakpoint
ALTER TABLE "commercial_returns" ADD CONSTRAINT "commercial_returns_amount_check" CHECK ("commercial_returns"."charged_amount" is null or "commercial_returns"."charged_amount" > 0);
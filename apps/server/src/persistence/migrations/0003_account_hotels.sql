CREATE TABLE "account_hotels" (
	"account_key" text NOT NULL,
	"hotel_code" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "account_hotels_account_key_hotel_code_pk" PRIMARY KEY("account_key","hotel_code")
);
--> statement-breakpoint
ALTER TABLE "account_hotels" ADD CONSTRAINT "account_hotels_hotel_code_hotels_code_fk" FOREIGN KEY ("hotel_code") REFERENCES "public"."hotels"("code") ON DELETE no action ON UPDATE no action;
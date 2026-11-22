-- Termine (#437): persönlicher ICS-Link. Gespeichert wird nur der SHA-256-Hash des Tokens und seine letzten vier Zeichen, nie der Token selbst.
-- Höchstens ein aktiver Token je Person (teilweiser Unique-Index); widerrufene Zeilen entfernt der tägliche Lauf nach 30 Tagen. Das Konto löscht seine Token mit (CASCADE).
-- Rückweg: drizzle/rueckweg/0121_kalender_token.sql
CREATE TABLE "kalender_token" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"endung" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"zuletzt_abgerufen_am" timestamp with time zone,
	"widerrufen_am" timestamp with time zone,
	CONSTRAINT "kalender_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "kalender_token" ADD CONSTRAINT "kalender_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kalender_token_aktiv_je_person" ON "kalender_token" USING btree ("user_id") WHERE "kalender_token"."widerrufen_am" is null;

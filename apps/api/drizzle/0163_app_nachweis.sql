-- Nachweis der App durch das Betriebssystem (#785): Der Server erkannte die App bisher am Header Origin, den jeder setzen kann. Google Play Integrity (Android) und Apple App Attest (iOS) liefern den Beleg, dass die echte App auf einem echten Gerät anfragt. Die Migration legt nur an: die Spalte «client_art» der Sitzung, die Herausforderungen und die Schlüssel der iOS-Geräte. Das Verhalten ändert sich erst mit APP_NACHWEIS=pruefen oder pflicht.
-- Bestehende Sitzungen: Wo ein Konto mit zweitem Faktor eine Sitzung ohne geprüften Code hat, kann sie nur die der App sein (die Anmeldung im Browser verlangt den Code); sie gilt als «app_ungeprueft». Alle anderen gelten als «web»: Ein Konto ohne zweiten Faktor braucht keine Unterscheidung (wie in 0160).
-- Rückweg: drizzle/rueckweg/0163_app_nachweis.sql
ALTER TABLE "session" ADD COLUMN "client_art" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_client_art_check" CHECK ("session"."client_art" in ('web', 'app_nachgewiesen', 'app_ungeprueft'));--> statement-breakpoint
UPDATE "session" SET "client_art" = 'app_ungeprueft' WHERE "zweiter_faktor_geprueft" IS FALSE AND "user_id" IN (SELECT "id" FROM "user" WHERE "two_factor_enabled" IS TRUE);--> statement-breakpoint
CREATE TABLE "app_nachweis_challenge" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"nonce_hash" text NOT NULL,
	"plattform" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"laeuft_ab_am" timestamp with time zone NOT NULL,
	"eingeloest_am" timestamp with time zone,
	"benutzername" text,
	"ticket_hash" text,
	"ticket_laeuft_ab_am" timestamp with time zone,
	"schluessel_id" text,
	"verbraucht_am" timestamp with time zone,
	CONSTRAINT "app_nachweis_challenge_nonce_hash_unique" UNIQUE("nonce_hash"),
	CONSTRAINT "app_nachweis_challenge_ticket_hash_unique" UNIQUE("ticket_hash"),
	CONSTRAINT "app_nachweis_challenge_plattform_check" CHECK ("app_nachweis_challenge"."plattform" in ('android', 'ios'))
);
--> statement-breakpoint
CREATE INDEX "app_nachweis_challenge_laeuft_ab_idx" ON "app_nachweis_challenge" USING btree ("laeuft_ab_am");--> statement-breakpoint
CREATE TABLE "app_nachweis_geraet" (
	"schluessel_id" text PRIMARY KEY NOT NULL,
	"oeffentlicher_schluessel" text NOT NULL,
	"zaehler" bigint DEFAULT 0 NOT NULL,
	"user_id" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_nachweis_geraet_zaehler_check" CHECK ("app_nachweis_geraet"."zaehler" between 0 and 4294967295)
);
--> statement-breakpoint
ALTER TABLE "app_nachweis_geraet" ADD CONSTRAINT "app_nachweis_geraet_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_nachweis_geraet_user_id_idx" ON "app_nachweis_geraet" USING btree ("user_id");

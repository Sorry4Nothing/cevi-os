-- Dateien im Lager als Verknüpfung auf das SharePoint der Abteilung (#370). Legt lager_datei an (nur Adresse, Anzeigename, optional Typ und Grösse, nie ein Inhalt) und die Spalte abteilung.datei_hosts (erlaubte Hosts der Links; NULL = keine Einschränkung, das ist die Vorgabe). Die Migration fasst keine bestehenden Zeilen an.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0066_lager_dateien.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0066_lager_dateien.sql
--   Es gehen alle Verknüpfungen und die eingestellten Hosts verloren; die Dateien am Ablageort bleiben unberührt.
ALTER TABLE "abteilung" ADD COLUMN "datei_hosts" text[];--> statement-breakpoint
CREATE TABLE "lager_datei" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lager_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"erstellt_von" uuid,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_von" uuid,
	"geloescht_am" timestamp with time zone,
	"geloescht_von" uuid,
	"lager_seq" bigint NOT NULL,
	"anzeigename" text NOT NULL,
	"link" text NOT NULL,
	"typ" text,
	"groesse" bigint,
	CONSTRAINT "lager_datei_anzeigename_check" CHECK (char_length("lager_datei"."anzeigename") between 1 and 200),
	CONSTRAINT "lager_datei_link_check" CHECK ("lager_datei"."link" ~ '^https://[^[:space:]]+$' and strpos("lager_datei"."link", chr(92)) = 0 and char_length("lager_datei"."link") <= 2048),
	CONSTRAINT "lager_datei_typ_groesse_check" CHECK (("lager_datei"."typ" is null or char_length("lager_datei"."typ") <= 100) and ("lager_datei"."groesse" is null or "lager_datei"."groesse" >= 0))
);
--> statement-breakpoint
ALTER TABLE "lager_datei" ADD CONSTRAINT "lager_datei_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lager_datei" ADD CONSTRAINT "lager_datei_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lager_datei" ADD CONSTRAINT "lager_datei_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lager_datei" ADD CONSTRAINT "lager_datei_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lager_datei_lager_idx" ON "lager_datei" USING btree ("lager_id");--> statement-breakpoint
CREATE INDEX "lager_datei_erstellt_idx" ON "lager_datei" USING btree ("erstellt_am");

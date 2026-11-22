-- Dokumente im Lager (#396): dokument (Titel, Verweis auf lager_datei, Stichworte, Freigabe für das Team). Dazu ein UNIQUE auf lager_datei (lager_id, id) als Ziel des zusammengesetzten Fremdschlüssels. Die Migration legt an; sie fasst keine bestehenden Zeilen an.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0090_lager_dokumente.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0090_lager_dokumente.sql
--   Es gehen alle Dokumente verloren (Titel, Stichworte, Freigabe); die Dateien am Ablageort und die Verknüpfungen in lager_datei bleiben (der Aufräumlauf entfernt sie nach 24 Stunden, wenn kein Datensatz sie einbindet). Einträge von dokument im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
ALTER TABLE "lager_datei" ADD CONSTRAINT "lager_datei_lager_id_id_uq" UNIQUE("lager_id","id");--> statement-breakpoint
CREATE TABLE "dokument" (
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
	"titel" text NOT NULL,
	"datei_id" uuid NOT NULL,
	"stichworte" text[] DEFAULT '{}'::text[] NOT NULL,
	"team_sichtbar" boolean DEFAULT false NOT NULL,
	CONSTRAINT "dokument_check" CHECK (char_length("dokument"."titel") between 1 and 200 and cardinality("dokument"."stichworte") <= 20 and char_length(array_to_string("dokument"."stichworte", ',')) <= 900)
);
--> statement-breakpoint
ALTER TABLE "dokument" ADD CONSTRAINT "dokument_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dokument" ADD CONSTRAINT "dokument_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dokument" ADD CONSTRAINT "dokument_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dokument" ADD CONSTRAINT "dokument_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dokument" ADD CONSTRAINT "dokument_datei_fk" FOREIGN KEY ("lager_id","datei_id") REFERENCES "public"."lager_datei"("lager_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dokument_liste_idx" ON "dokument" USING btree ("lager_id","id");--> statement-breakpoint
CREATE INDEX "dokument_datei_idx" ON "dokument" USING btree ("datei_id");--> statement-breakpoint
CREATE INDEX "dokument_stichworte_idx" ON "dokument" USING gin ("stichworte");

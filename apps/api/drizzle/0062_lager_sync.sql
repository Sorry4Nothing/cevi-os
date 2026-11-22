-- Sync-Kern des Lagers (#366): Folgenummer je Lager und Index des Änderungsfeeds. Die Migration legt nur an (zwei Spalten mit festem Vorgabewert, eine neue Tabelle).
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0062_lager_sync.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0062_lager_sync.sql
--   Es geht der Änderungsfeed aller Lager verloren; die Apps laden danach neu (410). Zeilenversionen und Folgenummern der Lager-Tabellen späterer Issues bleiben stehen und gelten nicht mehr.
ALTER TABLE "lager" ADD COLUMN "seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lager" ADD COLUMN "seq_min" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE TABLE "lager_aenderung" (
	"lager_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"tabelle" text NOT NULL,
	"zeile_id" uuid NOT NULL,
	"art" text NOT NULL,
	"version" integer NOT NULL,
	"zeitpunkt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "lager_aenderung_lager_id_seq_pk" PRIMARY KEY("lager_id","seq"),
	CONSTRAINT "lager_aenderung_seq_check" CHECK ("lager_aenderung"."seq" >= 1 and "lager_aenderung"."version" >= 1),
	CONSTRAINT "lager_aenderung_art_check" CHECK ("lager_aenderung"."art" in ('neu', 'geaendert', 'geloescht'))
);
--> statement-breakpoint
ALTER TABLE "lager" ADD CONSTRAINT "lager_seq_check" CHECK ("lager"."seq" >= 0 and "lager"."seq_min" >= 1);--> statement-breakpoint
ALTER TABLE "lager_aenderung" ADD CONSTRAINT "lager_aenderung_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lager_aenderung_zeitpunkt_idx" ON "lager_aenderung" USING btree ("zeitpunkt");

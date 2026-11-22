-- Protokolle und Beschlüsse im Lager (#379): protokoll (Art, Titel, Datum, Verweis auf lager_datei, optional Höck) und beschluss (kurzer Text, optional Protokoll und Höck). Das Protokoll liegt als Datei im SharePoint, Cevi OS speichert nur die Verknüpfung. Die Migration legt an; sie ändert keine bestehende Tabelle.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0074_lager_protokolle.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0074_lager_protokolle.sql
--   Es gehen alle Protokoll-Einträge (Art, Titel, Datum, Verknüpfung) und alle Beschlüsse verloren; die Dateien am Ablageort und die Einträge in lager_datei bleiben (der Aufräumlauf entfernt sie nach 24 Stunden, wenn kein Datensatz sie einbindet). hoeck.protokoll_id behält seinen Wert ohne Ziel: Der Rückweg setzt sie auf NULL zurück. Einträge der Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen aus.
CREATE TABLE "protokoll" (
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
	"art" text NOT NULL,
	"titel" text NOT NULL,
	"datum" date NOT NULL,
	"hoeck_id" uuid,
	"datei_id" uuid NOT NULL,
	CONSTRAINT "protokoll_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "protokoll_check" CHECK ("protokoll"."art" in ('sitzung', 'notiz', 'kontakt', 'idee') and char_length("protokoll"."titel") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "beschluss" (
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
	"text" text NOT NULL,
	"protokoll_id" uuid,
	"hoeck_id" uuid,
	CONSTRAINT "beschluss_check" CHECK (char_length("beschluss"."text") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "protokoll" ADD CONSTRAINT "protokoll_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protokoll" ADD CONSTRAINT "protokoll_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protokoll" ADD CONSTRAINT "protokoll_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protokoll" ADD CONSTRAINT "protokoll_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protokoll" ADD CONSTRAINT "protokoll_datei_fk" FOREIGN KEY ("lager_id","datei_id") REFERENCES "public"."lager_datei"("lager_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protokoll" ADD CONSTRAINT "protokoll_hoeck_fk" FOREIGN KEY ("lager_id","hoeck_id") REFERENCES "public"."hoeck"("lager_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beschluss" ADD CONSTRAINT "beschluss_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beschluss" ADD CONSTRAINT "beschluss_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beschluss" ADD CONSTRAINT "beschluss_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beschluss" ADD CONSTRAINT "beschluss_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beschluss" ADD CONSTRAINT "beschluss_protokoll_fk" FOREIGN KEY ("lager_id","protokoll_id") REFERENCES "public"."protokoll"("lager_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beschluss" ADD CONSTRAINT "beschluss_hoeck_fk" FOREIGN KEY ("lager_id","hoeck_id") REFERENCES "public"."hoeck"("lager_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "protokoll_liste_idx" ON "protokoll" USING btree ("lager_id","datum","id");--> statement-breakpoint
CREATE INDEX "protokoll_datei_idx" ON "protokoll" USING btree ("datei_id");--> statement-breakpoint
CREATE INDEX "protokoll_hoeck_idx" ON "protokoll" USING btree ("lager_id","hoeck_id") WHERE "protokoll"."hoeck_id" is not null;--> statement-breakpoint
CREATE INDEX "beschluss_liste_idx" ON "beschluss" USING btree ("lager_id","id");--> statement-breakpoint
CREATE INDEX "beschluss_protokoll_idx" ON "beschluss" USING btree ("lager_id","protokoll_id") WHERE "beschluss"."protokoll_id" is not null;--> statement-breakpoint
CREATE INDEX "beschluss_hoeck_idx" ON "beschluss" USING btree ("lager_id","hoeck_id") WHERE "beschluss"."hoeck_id" is not null;

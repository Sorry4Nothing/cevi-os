-- Rechte je Gruppe (#643): Gruppenrollen. Jede Gruppe (Tag jedes Typs) hat eigene, selbst erstellbare Rollen mit einstellbaren Rechten; eine Person trägt je Gruppe höchstens eine (person_tag.rolle_id). Die Rechte stehen im Katalog im Code (rechtemodell/katalog.ts), die Datenbank kennt ihn nicht: ein Name, den der Katalog nicht kennt, gibt nichts (fail-closed). Es gibt keine Frist: Die Rechte gelten, bis Rolle, Zuordnung oder Gruppe gelöscht sind.
-- Die Migration legt nur an: zwei Tabellen, die Spalten person_tag.rolle_id und plattform_rolle.version und einen Trigger, der rolle_id dem Freitext der Rolle nachführt (Systemrollen «leitung», «stufenleitung», «verantwortlich»). Bestehende Zeilen ändert erst 0141.
-- Rückweg: drizzle/rueckweg/0140_gruppenrollen.sql
CREATE TABLE "gruppen_rolle" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"name" text NOT NULL,
	"beschreibung" text,
	"verantwortlich" boolean DEFAULT false NOT NULL,
	"reihenfolge" integer DEFAULT 1000 NOT NULL,
	"schluessel" text,
	"version" integer DEFAULT 1 NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gruppen_rolle_name_check" CHECK (char_length("gruppen_rolle"."name") between 1 and 50),
	CONSTRAINT "gruppen_rolle_beschreibung_check" CHECK ("gruppen_rolle"."beschreibung" is null or char_length("gruppen_rolle"."beschreibung") <= 300),
	CONSTRAINT "gruppen_rolle_reihenfolge_check" CHECK ("gruppen_rolle"."reihenfolge" >= 1),
	CONSTRAINT "gruppen_rolle_schluessel_check" CHECK ("gruppen_rolle"."schluessel" is null or "gruppen_rolle"."schluessel" in ('leitung', 'stufenleitung', 'verantwortlich'))
);
--> statement-breakpoint
CREATE TABLE "gruppen_rolle_recht" (
	"rolle_id" uuid NOT NULL,
	"recht" text NOT NULL,
	"geltung" text DEFAULT 'eigene' NOT NULL,
	CONSTRAINT "gruppen_rolle_recht_rolle_id_recht_pk" PRIMARY KEY("rolle_id","recht"),
	CONSTRAINT "gruppen_rolle_recht_geltung_check" CHECK ("gruppen_rolle_recht"."geltung" in ('alle', 'eigene'))
);
--> statement-breakpoint
ALTER TABLE "gruppen_rolle" ADD CONSTRAINT "gruppen_rolle_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gruppen_rolle" ADD CONSTRAINT "gruppen_rolle_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gruppen_rolle_recht" ADD CONSTRAINT "gruppen_rolle_recht_rolle_id_gruppen_rolle_id_fk" FOREIGN KEY ("rolle_id") REFERENCES "public"."gruppen_rolle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gruppen_rolle_name_pro_gruppe" ON "gruppen_rolle" USING btree ("tag_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "gruppen_rolle_schluessel_pro_gruppe" ON "gruppen_rolle" USING btree ("tag_id","schluessel") WHERE "gruppen_rolle"."schluessel" is not null;--> statement-breakpoint
CREATE INDEX "gruppen_rolle_abteilung_id_idx" ON "gruppen_rolle" USING btree ("abteilung_id");--> statement-breakpoint
ALTER TABLE "person_tag" ADD COLUMN "rolle_id" uuid;--> statement-breakpoint
ALTER TABLE "person_tag" ADD CONSTRAINT "person_tag_rolle_id_gruppen_rolle_id_fk" FOREIGN KEY ("rolle_id") REFERENCES "public"."gruppen_rolle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_tag_rolle_id_idx" ON "person_tag" USING btree ("rolle_id");--> statement-breakpoint
-- Versionsnummer gegen gleichzeitiges Überschreiben in der Matrix (If-Match); bestehende Rollen beginnen bei 1
ALTER TABLE "plattform_rolle" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- rolle_id folgt dem Freitext der Rolle, damit jeder Weg, der sie schreibt (Routen, Import, die Sichten «rolle» und «stufe»), dieselbe Wirkung hat: An einer Stufe sind «leitung» und «stufenleitung» die Systemrollen dieser Stufe, an jeder anderen Gruppe «verantwortlich» (Gross- und Kleinschreibung egal). Nur wenn die Rolle sich ändert und rolle_id nicht im selben Schritt; eine ausdrücklich gesetzte rolle_id bleibt. Wechselt die Rolle auf einen anderen Text, fällt eine Systemrolle weg; eine selbst erstellte Rolle bleibt
CREATE FUNCTION person_tag_rolle_abgleich() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  gefunden uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.rolle IS NOT DISTINCT FROM OLD.rolle OR NEW.rolle_id IS DISTINCT FROM OLD.rolle_id THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.rolle_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.rolle IS NOT NULL THEN
    SELECT r.id INTO gefunden
      FROM gruppen_rolle r
      JOIN tag t ON t.id = r.tag_id
      WHERE r.tag_id = NEW.tag_id
        AND r.schluessel IS NOT NULL
        AND r.schluessel = CASE WHEN t.typ = 'stufe' THEN NEW.rolle ELSE lower(NEW.rolle) END;
  END IF;
  IF gefunden IS NOT NULL THEN
    NEW.rolle_id := gefunden;
  ELSIF TG_OP = 'UPDATE' AND OLD.rolle_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM gruppen_rolle WHERE id = OLD.rolle_id AND schluessel IS NOT NULL) THEN
    NEW.rolle_id := NULL;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER person_tag_rolle_abgleich BEFORE INSERT OR UPDATE OF rolle ON "person_tag" FOR EACH ROW EXECUTE FUNCTION person_tag_rolle_abgleich();

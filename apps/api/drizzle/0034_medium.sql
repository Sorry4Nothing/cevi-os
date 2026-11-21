-- Medienspeicher (#335): Metadaten zu Bildern und PDFs; der Inhalt liegt im S3. Rückweg: DROP TABLE "medium"
CREATE TABLE "medium" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"mime_typ" text NOT NULL,
	"groesse" integer NOT NULL,
	"breite" integer,
	"hoehe" integer,
	"alt_text" text,
	"dekorativ" boolean DEFAULT false NOT NULL,
	"sichtbarkeit" text NOT NULL,
	"speicher_schluessel" text NOT NULL,
	"hochgeladen_von" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medium_speicher_schluessel_unique" UNIQUE("speicher_schluessel"),
	CONSTRAINT "medium_sichtbarkeit_check" CHECK ("medium"."sichtbarkeit" in ('oeffentlich', 'angemeldet')),
	CONSTRAINT "medium_inhalt_check" CHECK ("medium"."groesse" > 0 and (
        ("medium"."mime_typ" = 'application/pdf' and not "medium"."dekorativ" and "medium"."breite" is null and "medium"."hoehe" is null)
        or ("medium"."mime_typ" in ('image/jpeg', 'image/png', 'image/webp') and "medium"."breite" > 0 and "medium"."hoehe" > 0 and "medium"."dekorativ" = ("medium"."alt_text" is null))
      ))
);
--> statement-breakpoint
ALTER TABLE "medium" ADD CONSTRAINT "medium_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medium" ADD CONSTRAINT "medium_hochgeladen_von_user_id_fk" FOREIGN KEY ("hochgeladen_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "medium_abteilung" ON "medium" USING btree ("abteilung_id","erstellt_am");

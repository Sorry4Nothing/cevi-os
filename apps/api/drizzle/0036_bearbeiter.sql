-- Bearbeitungsrechte (#334): Sonderrechte pro Objekt, an eine Person oder einen Tag. objekt_id leer heisst: alle Objekte dieses Typs (Rolle «Redaktion»).
-- Die Migration legt nur an und fasst keine bestehende Tabelle an.
-- Rückweg (Migrationen laufen nur vorwärts; von Hand): DROP TABLE "bearbeiter"; DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
CREATE TABLE "bearbeiter" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"objekt_typ" text NOT NULL,
	"objekt_id" uuid,
	"user_id" uuid,
	"tag_id" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bearbeiter_eindeutig" UNIQUE NULLS NOT DISTINCT("abteilung_id","objekt_typ","objekt_id","user_id","tag_id"),
	CONSTRAINT "bearbeiter_objekt_typ_check" CHECK ("bearbeiter"."objekt_typ" in ('seite')),
	CONSTRAINT "bearbeiter_person_oder_tag_check" CHECK (("bearbeiter"."user_id" is null) <> ("bearbeiter"."tag_id" is null))
);
--> statement-breakpoint
ALTER TABLE "bearbeiter" ADD CONSTRAINT "bearbeiter_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bearbeiter" ADD CONSTRAINT "bearbeiter_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bearbeiter" ADD CONSTRAINT "bearbeiter_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bearbeiter_user_id_idx" ON "bearbeiter" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bearbeiter_tag_id_idx" ON "bearbeiter" USING btree ("tag_id");

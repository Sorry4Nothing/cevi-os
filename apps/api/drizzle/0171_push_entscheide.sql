-- Push-Schalter für den Entscheid zum eigenen Terminvorschlag und zur eigenen Raumanfrage (#847); wie die übrigen Schalter standardmässig an.
-- Rückweg: drizzle/rueckweg/0171_push_entscheide.sql
ALTER TABLE "user" ADD COLUMN "push_termin_entscheid" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "push_raum_entscheid" boolean DEFAULT true NOT NULL;

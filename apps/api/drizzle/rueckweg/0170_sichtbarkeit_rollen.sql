-- Rückweg zu 0170_sichtbarkeit_rollen (#844), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0170_sichtbarkeit_rollen.sql
-- Danach den Code auf den Stand vor 0170 zurückstellen. Der alte Code kennt keine Rollen: Damit niemand mehr sieht als eingestellt (fail-closed), fällt jeder eingeschränkte Tag ganz aus der Menge, bei Seiten, Anlässen und Bausteinen (Entwurf und Versionen). Bleibt kein Tag, sieht nur noch die Abteilungsleitung das Objekt.
UPDATE "seite" SET "sichtbarkeit_tags" = ARRAY(SELECT t FROM unnest("sichtbarkeit_tags") AS t WHERE NOT "sichtbarkeit_rollen" ? t::text) WHERE "sichtbarkeit_rollen" <> '{}'::jsonb;--> statement-breakpoint
UPDATE "anlass" SET "sichtbarkeit_tags" = ARRAY(SELECT t FROM unnest("sichtbarkeit_tags") AS t WHERE NOT "sichtbarkeit_rollen" ? t::text) WHERE "sichtbarkeit_rollen" <> '{}'::jsonb;--> statement-breakpoint
CREATE FUNCTION pg_temp.ohne_rollen(dok jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT CASE WHEN jsonb_typeof(dok -> 'bausteine') = 'array' THEN jsonb_set(dok, '{bausteine}', (
    SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(b -> 'sichtbarkeit') = 'object' AND (b -> 'sichtbarkeit') ? 'rollen'
      THEN jsonb_set(b, '{sichtbarkeit}', ((b -> 'sichtbarkeit') - 'rollen') || jsonb_build_object('tagIds', coalesce(
        (SELECT jsonb_agg(t) FROM jsonb_array_elements(b -> 'sichtbarkeit' -> 'tagIds') AS t WHERE NOT (b -> 'sichtbarkeit' -> 'rollen') ? (t #>> '{}')),
        '[]'::jsonb)))
      ELSE b END ORDER BY i), '[]'::jsonb)
    FROM jsonb_array_elements(dok -> 'bausteine') WITH ORDINALITY AS e(b, i)))
  ELSE dok END
$$;--> statement-breakpoint
UPDATE "seite" SET "entwurf" = pg_temp.ohne_rollen("entwurf") WHERE "entwurf"::text LIKE '%"rollen"%';--> statement-breakpoint
UPDATE "seite_version" SET "inhalt" = pg_temp.ohne_rollen("inhalt") WHERE "inhalt"::text LIKE '%"rollen"%';--> statement-breakpoint
ALTER TABLE "anlass" DROP CONSTRAINT "anlass_sichtbarkeit_rollen_check";--> statement-breakpoint
ALTER TABLE "anlass" DROP COLUMN "sichtbarkeit_rollen";--> statement-breakpoint
ALTER TABLE "seite" DROP CONSTRAINT "seite_sichtbarkeit_rollen_check";--> statement-breakpoint
ALTER TABLE "seite" DROP COLUMN "sichtbarkeit_rollen";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");

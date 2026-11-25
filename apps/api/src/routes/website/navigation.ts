import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import { seite } from "../../db/schema.js";
import type { Person } from "../../rechte.js";
import { ladeTagIds } from "../../sichtbarkeit.js";
import {
  DATENSCHUTZ_ADRESSE,
  IMPRESSUM_ADRESSE,
  ziel,
} from "../../website/abgleich.js";
import { baueGeschuetzteNavigation } from "../../website/navigation-angemeldet.js";
import type { Knoten } from "../../website/seiten.js";

// Menü für Angemeldete (#795): die Seiten, die nicht öffentlich sind und die diese Person laut Sichtbarkeit sehen darf (angemeldet, Gruppe oder Tag), nur mit Titel, Adresse und Position.
// Die Sitzung ist Pflicht (401 aus personAusSitzung). Nur die Abteilung der Person, nur Seiten mit veröffentlichter Version, nie öffentliche Seiten, nie Inhalte, nie eine Zahl oder ein Hinweis auf Seiten ohne Recht.
// Dasselbe Recht wie beim Nachladen der Bausteine (routes/website/inhalt.ts); das statische Menü der Besucher bleibt ohne jede Angabe zu diesen Seiten.
export function erstelleNavigationRoute({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>().get(
    "/navigation",
    async (c) => {
      const person = c.get("person");
      const zeilen = await db
        .select({
          id: seite.id,
          elternId: seite.elternId,
          adresse: seite.adresse,
          titel: seite.titel,
          reihenfolge: seite.reihenfolge,
          tagId: seite.tagId,
          sichtbarkeit: seite.sichtbarkeit,
          sichtbarkeitTags: seite.sichtbarkeitTags,
          veroeffentlichteVersionId: seite.veroeffentlichteVersionId,
        })
        .from(seite)
        .where(eq(seite.abteilungId, person.abteilungId));
      const knoten: Knoten = new Map(zeilen.map((z) => [z.id, z]));
      const eintraege = baueGeschuetzteNavigation(
        zeilen,
        person.abteilungId,
        { ...person, tagIds: await ladeTagIds(db, person) },
        (id) => ziel(knoten, id)?.pfad ?? null,
        new Set([`/${IMPRESSUM_ADRESSE}`, `/${DATENSCHUTZ_ADRESSE}`]),
      );
      // Personenbezogen und nur für diese Sitzung: nie in einem gemeinsamen Zwischenspeicher
      c.header("Cache-Control", "private, no-store");
      c.header("Vary", "Cookie");
      return c.json({ eintraege });
    },
  );
}

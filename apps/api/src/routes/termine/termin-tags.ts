import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { programm, tag } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { OutlookDienst } from "../../outlook/dienst.js";
import { setzeTerminTags, TerminFehlt } from "../../outlook/termin-tags.js";
import type { Person } from "../../rechte.js";
import { verlange } from "../../rechtemodell/darf.js";
import { tagsGehoerenZurAbteilung } from "../../sichtbarkeit.js";
import type { TermineEnv } from "./index.js";

// Tags bestehender Termine setzen (#835, Epic #430). Das Recht ist dasselbe wie für die Zuordnung der Kategorien, «termine.kategorien_zuordnen» (rechtemodell/katalog.ts, erweitert: zweiter Faktor; standardmässig nur die Abteilungsleitung, einstellbar): Beides entscheidet, welche Gruppe einen Termin sieht, ein neues Recht wäre dieselbe Entscheidung zweimal (docs/rechte.md).
// Cevi OS speichert zuerst lokal und schreibt dann nur die Kategorien des einen Termins nach Outlook (outlook/termin-tags.ts); ohne Outlook (Schalter aus oder nicht verbunden) bleibt es bei «aus».
const pfad = z.strictObject({ id: z.uuid() });

// Obergrenzen gegen unbegrenzte Anfragen (SR-71); doppelte IDs sind ein Fehler, kein stilles Zusammenfassen
const MAX_TAGS = 20;
const MAX_TERMINE = 100;
const eindeutig = (l: string[]) => new Set(l).size === l.length;
const tagIdListe = (min: number) =>
  z.array(z.uuid()).min(min).max(MAX_TAGS).refine(eindeutig);
const terminTagsSchema = z.strictObject({ tagIds: tagIdListe(0) });
const sammelTagsSchema = z.strictObject({
  terminIds: z.array(z.uuid()).min(1).max(MAX_TERMINE).refine(eindeutig),
  tagIds: tagIdListe(1),
});

const TAG_UNBEKANNT = {
  code: "TAG_UNBEKANNT",
  message: "Der Tag gehört nicht zur Abteilung.",
} as const;

export function erstelleTerminTagsRouten({
  db,
  outlook,
}: {
  db: Db;
  outlook?: OutlookDienst;
}) {
  const pruefeRecht = (person: Person) =>
    verlange(db, person, "termine.kategorien_zuordnen", {
      abteilungId: person.abteilungId,
    });

  return (
    new Hono<TermineEnv>()
      // Sammelaktion (Warnliste): dieselben Tags für viele Termine. Ohne Objekt im Pfad: erst das Recht, dann ein fremder Tag (400) oder Termin (404)
      .put(
        "/admin/termine/tags",
        eingabe("json", sammelTagsSchema),
        async (c) => {
          const person = c.get("person");
          await pruefeRecht(person);
          const b = c.req.valid("json");
          if (
            !(await tagsGehoerenZurAbteilung(db, person.abteilungId, b.tagIds))
          ) {
            return c.json(TAG_UNBEKANNT, 400);
          }
          try {
            const stand = await setzeTerminTags(db, outlook, {
              abteilungId: person.abteilungId,
              akteurId: person.id,
              terminIds: b.terminIds,
              tagIds: b.tagIds,
            });
            const zaehle = (w: string) =>
              [...stand.values()].filter((x) => x === w).length;
            return c.json({
              geaendert: stand.size,
              outlook: {
                geschrieben: zaehle("geschrieben"),
                ausstehend: zaehle("ausstehend"),
                aus: zaehle("aus"),
              },
            });
          } catch (fehler) {
            if (fehler instanceof TerminFehlt) throw new HTTPException(404);
            throw fehler;
          }
        },
      )
      .put(
        "/admin/termine/:id/tags",
        eingabe("param", pfad),
        eingabe("json", terminTagsSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const b = c.req.valid("json");
          // Erst der Termin der eigenen Abteilung (fremd = 404), dann das Recht
          const [ziel] = await db
            .select({ id: programm.id })
            .from(programm)
            .where(
              and(
                eq(programm.id, id),
                eq(programm.abteilungId, person.abteilungId),
              ),
            );
          if (!ziel) throw new HTTPException(404);
          await pruefeRecht(person);
          if (
            !(await tagsGehoerenZurAbteilung(db, person.abteilungId, b.tagIds))
          ) {
            return c.json(TAG_UNBEKANNT, 400);
          }
          try {
            const stand = await setzeTerminTags(db, outlook, {
              abteilungId: person.abteilungId,
              akteurId: person.id,
              terminIds: [id],
              tagIds: b.tagIds,
            });
            const tags =
              b.tagIds.length === 0
                ? []
                : await db
                    .select({ id: tag.id, name: tag.name, typ: tag.typ })
                    .from(tag)
                    .where(
                      and(
                        eq(tag.abteilungId, person.abteilungId),
                        inArray(tag.id, b.tagIds),
                      ),
                    )
                    .orderBy(asc(tag.typ), asc(tag.name));
            return c.json({ tags, outlook: stand.get(id)! });
          } catch (fehler) {
            if (fehler instanceof TerminFehlt) throw new HTTPException(404);
            throw fehler;
          }
        },
      )
  );
}

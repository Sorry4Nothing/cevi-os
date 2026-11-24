import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { redaktionBildUrl } from "../../bild.js";
import { ort, personTag, profilbild, tag, user } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { aktivesKonto, type Person } from "../../rechte.js";
import {
  anzeigename,
  AUSSENROLLEN,
  hatAussenrolle,
} from "../../website/personen.js";
import { hatWebsiteZugang } from "../../website/seiten.js";

// Auswahllisten für den Editor (#353): nur was eine Auswahl braucht. Nie Telefon, E-Mail, Benutzername oder Rolle des Kontos.
// Die Listen sind auf die Abteilung der Person gefiltert; ein fremder oder unbekannter Tag ist 404.
// Dazu «baustein-auswahl» (#740): Anlässe und Orte für die Bausteine aus Cevi OS, nur Namen, Tage und Art. Anlässe nur, wenn die Website sie zeigen darf (öffentlich, aktiver Termin für Eltern), ab 90 Tage zurück; nie Anmeldungen oder Personen
export function erstelleAuswahlRouten({ db }: { db: Db }) {
  const zugang = async (person: Person) => {
    if (!(await hatWebsiteZugang(db, person))) throw new HTTPException(403);
  };

  return new Hono<{ Variables: { person: Person } }>()
    .get("/tags", async (c) => {
      const person = c.get("person");
      await zugang(person);
      const tags = await db
        .select({ id: tag.id, name: tag.name, typ: tag.typ })
        .from(tag)
        .where(eq(tag.abteilungId, person.abteilungId))
        .orderBy(asc(tag.typ), asc(tag.name), asc(tag.id));
      return c.json({ tags });
    })
    .get("/baustein-auswahl", async (c) => {
      const person = c.get("person");
      await zugang(person);
      const anlaesse = await db.execute<{
        id: string;
        titel: string;
        art: "anlass" | "lager";
        von: string;
        bis: string;
      }>(sql`
        select anlass.id, programm.titel, anlass.art,
          case when programm.ganztaegig then programm.tag_von::text else to_char(programm.beginn at time zone 'Europe/Zurich', 'YYYY-MM-DD') end as von,
          case when programm.ganztaegig then programm.tag_bis::text else to_char(coalesce(programm.ende, programm.beginn) at time zone 'Europe/Zurich', 'YYYY-MM-DD') end as bis
        from anlass join programm on programm.id = anlass.programm_id
        where anlass.abteilung_id = ${person.abteilungId} and programm.abteilung_id = ${person.abteilungId}
          and programm.status = 'aktiv' and programm.sichtbarkeit = 'eltern' and anlass.sichtbarkeit = 'oeffentlich'
          and coalesce(programm.beginn, programm.tag_von::timestamp at time zone 'Europe/Zurich') >= now() - interval '90 days'
        order by coalesce(programm.beginn, programm.tag_von::timestamp at time zone 'Europe/Zurich'), anlass.id
        limit 200`);
      const orte = await db
        .select({
          id: ort.id,
          name: ort.name,
          beschreibung: ort.beschreibung,
        })
        .from(ort)
        .where(
          and(eq(ort.abteilungId, person.abteilungId), eq(ort.aktiv, true)),
        )
        .orderBy(asc(ort.reihenfolge), asc(sql`lower(${ort.name})`))
        .limit(200);
      return c.json({ anlaesse: [...anlaesse], orte });
    })
    .get(
      "/personen",
      eingabe("query", z.strictObject({ tag: z.uuid().optional() })),
      async (c) => {
        const person = c.get("person");
        await zugang(person);
        const { tag: tagId } = c.req.valid("query");
        if (tagId) {
          const [ziel] = await db
            .select({ id: tag.id })
            .from(tag)
            .where(
              and(eq(tag.id, tagId), eq(tag.abteilungId, person.abteilungId)),
            );
          if (!ziel) throw new HTTPException(404);
        }
        // Nur wer auf der Website erscheinen darf (#755): eine Rolle mit Aussenwirkung (#610) und ein aktives Konto. Kinder sind eigene Datensätze und kommen hier nie vor.
        // Ohne Tag: alle Leitenden der Abteilung, eine Zeile je Rolle in einer Stufe; mit Tag: die Personen dieser Gruppe
        const zeilen = await db
          .select({
            id: user.id,
            name: user.name,
            ceviName: user.ceviName,
            funktion: personTag.rolle,
            gruppe: tag.name,
            tagId: tag.id,
            // Das Bild holt die Auswahl einzeln über /personen/:id/bild (team.ts, #760)
            bildUrl: redaktionBildUrl,
          })
          .from(personTag)
          .innerJoin(user, eq(user.id, personTag.userId))
          .innerJoin(tag, eq(tag.id, personTag.tagId))
          .leftJoin(profilbild, eq(profilbild.userId, user.id))
          .where(
            and(
              aktivesKonto(person.abteilungId),
              eq(tag.abteilungId, person.abteilungId),
              hatAussenrolle,
              tagId
                ? eq(personTag.tagId, tagId)
                : and(
                    eq(tag.typ, "stufe"),
                    inArray(personTag.rolle, [...AUSSENROLLEN]),
                  ),
            ),
          )
          .orderBy(asc(personTag.prioritaet), asc(user.name), asc(user.id));
        // Wie auf der Website: der Cevi-Name, sonst der Vorname, nie der ganze Name des Kontos
        const personen = zeilen.map(({ name, ceviName, ...z }) => ({
          ...z,
          anzeigename: anzeigename(ceviName, name),
          aufWebsite: true,
        }));
        if (!tagId) {
          const de = new Intl.Collator("de-CH");
          personen.sort(
            (a, b) =>
              de.compare(a.gruppe, b.gruppe) ||
              de.compare(a.anzeigename, b.anzeigename),
          );
        }
        return c.json({ personen });
      },
    );
}

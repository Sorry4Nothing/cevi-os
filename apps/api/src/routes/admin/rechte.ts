import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../../db/client.js";
import { bearbeiter, personTag, seite, tag } from "../../db/schema.js";
import { lager, lagerMitglied } from "../../db/schema-lager.js";
import { raum } from "../../db/schema-raum.js";
import type { Person } from "../../rechte.js";

// «Rollen und Rechte» der Verwaltung (#623): die Zuordnungen, aus denen die Seite zeigt, was Gruppen, Lager, Räume und Sonderrechte heute an Rechten tragen. Nur lesen, nur die Abteilungsleitung (Pfad /admin, zweiter Faktor). Es gibt kein neues Recht und keine neue Tabelle: Die Antwort fasst vorhandene Zeilen zusammen, damit die Oberfläche nicht je Gruppe und je Lager einzeln fragen muss.
// Plattformrollen und ihre Rechte kommen weiter aus /api/v1/admin/plattform/rollen, Personen und Stufenrollen aus /api/v1/admin/personen.
// Nur Kennungen, Namen von Gruppen, Lagern, Räumen und Seiten, Rollenwerte; keine Kontaktdaten, nie Namen von Personen. Sieben Abfragen je Aufruf, unabhängig von der Datenmenge; jede auf die Abteilung der Sitzung gefiltert.
export function erstelleRechteRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>().get(
    "/zuordnungen",
    async (c) => {
      const person = c.get("person");
      if (!person.admin) throw new HTTPException(403);
      const abteilungId = person.abteilungId;
      const [
        gruppen,
        gruppenMitglieder,
        lagerListe,
        lagerLeute,
        raeume,
        rechte,
        seiten,
      ] = await Promise.all([
        db
          .select({ id: tag.id, typ: tag.typ, name: tag.name })
          .from(tag)
          .where(eq(tag.abteilungId, abteilungId))
          .orderBy(asc(tag.typ), asc(tag.name), asc(tag.id)),
        db
          .select({
            tagId: personTag.tagId,
            userId: personTag.userId,
            rolle: personTag.rolle,
          })
          .from(personTag)
          .innerJoin(tag, eq(tag.id, personTag.tagId))
          .where(eq(tag.abteilungId, abteilungId))
          .orderBy(asc(personTag.prioritaet), asc(personTag.userId)),
        db
          .select({ id: lager.id, titel: lager.titel, status: lager.status })
          .from(lager)
          .where(eq(lager.abteilungId, abteilungId))
          .orderBy(asc(lager.von), asc(lager.id)),
        db
          .select({
            lagerId: lagerMitglied.lagerId,
            userId: lagerMitglied.personId,
            rolle: lagerMitglied.rolle,
          })
          .from(lagerMitglied)
          .innerJoin(lager, eq(lager.id, lagerMitglied.lagerId))
          .where(eq(lager.abteilungId, abteilungId))
          .orderBy(asc(lagerMitglied.personId)),
        db
          .select({
            id: raum.id,
            name: raum.name,
            teamTagId: raum.teamTagId,
            aktiv: raum.aktiv,
          })
          .from(raum)
          .where(eq(raum.abteilungId, abteilungId))
          .orderBy(asc(raum.name), asc(raum.id)),
        db
          .select({
            id: bearbeiter.id,
            seiteId: bearbeiter.objektId,
            userId: bearbeiter.userId,
            tagId: bearbeiter.tagId,
          })
          .from(bearbeiter)
          .where(eq(bearbeiter.abteilungId, abteilungId))
          .orderBy(asc(bearbeiter.erstelltAm), asc(bearbeiter.id)),
        db
          .select({ id: seite.id, titel: seite.titel })
          .from(seite)
          .where(eq(seite.abteilungId, abteilungId))
          .orderBy(asc(seite.titel), asc(seite.id)),
      ]);
      return c.json({
        gruppen: gruppen.map((g) => ({
          ...g,
          mitglieder: gruppenMitglieder
            .filter((m) => m.tagId === g.id)
            .map(({ userId, rolle }) => ({ userId, rolle })),
        })),
        lager: lagerListe.map((l) => ({
          ...l,
          mitglieder: lagerLeute
            .filter((m) => m.lagerId === l.id)
            .map(({ userId, rolle }) => ({ userId, rolle })),
        })),
        raeume,
        // Nur Zeilen für Seiten dieser Abteilung (die Zeile selbst trägt die Abteilung, die Seite muss dazu passen)
        sonderrechte: rechte.filter((r) =>
          seiten.some((s) => s.id === r.seiteId),
        ),
        seiten,
      });
    },
  );
}

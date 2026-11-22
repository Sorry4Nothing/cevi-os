import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import { chatStatus, lager, lagerMitglied } from "../../db/schema.js";
import { lagerAnsicht } from "../../lager/ansicht.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { LAGER_RECHTE } from "../../lager/rechte-katalog.js";
import { sichtbareNachrichten } from "../../rechte.js";

// Lager der Person (#364). Wer kein Mitglied ist, bekommt das Lager weder in der Liste noch einzeln (404); die Abteilungsleitung sieht jedes Lager der Abteilung
export function erstelleLagerKernRouten({ db }: { db: Db }) {
  return (
    new Hono<LagerEnv>()
      .get("/", async (c) => {
        const person = c.get("person");
        const zeilen = await db
          .select({ lager, rolle: lagerMitglied.rolle })
          .from(lager)
          .leftJoin(
            lagerMitglied,
            and(
              eq(lagerMitglied.lagerId, lager.id),
              eq(lagerMitglied.personId, person.id),
            ),
          )
          .where(
            and(
              eq(lager.abteilungId, person.abteilungId),
              // Ohne Mitgliedschaft nur die Abteilungsleitung
              person.admin ? undefined : isNotNull(lagerMitglied.personId),
            ),
          )
          .orderBy(desc(lager.von), asc(lager.id));
        return c.json({
          lager: zeilen.map((z) => ({
            ...lagerAnsicht(z.lager),
            rolle: person.admin ? "lagerleitung" : z.rolle,
          })),
        });
      })
      // Neuigkeiten-Stand (#520) für den Punkt an der Pille im Kopf: nur Ja oder Nein, nie Inhalt. «neu» je Lager: Es gibt ungelesene Benachrichtigungen der Person in diesem Lager (lager_benachrichtigung, bleiben, bis die Person sie liest; keine Speicherung je Anfrage, kein Stand des Clients nötig). «programme.neu»: Es gibt ungelesene Chat-Nachrichten. Zwei Abfragen, unabhängig von der Zahl der Lager. Vor «/:id», damit «neuigkeiten» nicht als ID gilt
      .get("/neuigkeiten", async (c) => {
        const person = c.get("person");
        const n = sichtbareNachrichten(db, person);
        const [zeilen, ungelesen] = await Promise.all([
          db
            .select({
              lagerId: lager.id,
              neu: sql<boolean>`exists (select 1 from lager_benachrichtigung b where b.lager_id = ${lager.id} and b.person_id = ${person.id} and b.gelesen_am is null)`,
            })
            .from(lager)
            .leftJoin(
              lagerMitglied,
              and(
                eq(lagerMitglied.lagerId, lager.id),
                eq(lagerMitglied.personId, person.id),
              ),
            )
            .where(
              and(
                eq(lager.abteilungId, person.abteilungId),
                person.admin ? undefined : isNotNull(lagerMitglied.personId),
              ),
            )
            .orderBy(desc(lager.von), asc(lager.id)),
          db
            .select({ eins: sql<number>`1` })
            .from(n)
            .leftJoin(
              chatStatus,
              and(
                eq(chatStatus.chatId, n.chatId),
                eq(chatStatus.userId, person.id),
              ),
            )
            .where(
              and(
                ne(n.autorId, person.id),
                or(
                  isNull(chatStatus.gelesenBis),
                  gt(n.erstelltAm, chatStatus.gelesenBis),
                ),
              ),
            )
            .limit(1),
        ]);
        return c.json({
          lager: zeilen,
          programme: { neu: ungelesen.length > 0 },
        });
      })
      .get("/:id", lagerZugriff(db), (c) => {
        const zugriff = c.get("lager");
        return c.json({
          ...lagerAnsicht(zugriff.lager),
          rolle: zugriff.rolle,
          schreibgeschuetzt: zugriff.geschlossen,
          // Die erlaubten Aktionen der eigenen Rolle (Schlüssel des Rechtekatalogs); die Rechte der Policy sind schon geladen, es kommt keine Abfrage dazu. Nie die Rechte anderer Rollen. Die Lagerleitung und die Abteilungsleitung haben alle
          rechte: LAGER_RECHTE.filter((r) => darf(zugriff, r)),
        });
      })
  );
}

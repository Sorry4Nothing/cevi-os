import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { bildUrlImLager } from "../../bild.js";
import type { Db } from "../../db/client.js";
import { lagerMitglied, ressort, user } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import {
  brauchtPersonen,
  brauchtRessorts,
  parseSchnelleingabe,
  schnelleingabeEingabe,
  type Kandidat,
  type Treffer,
} from "../../lager/schnelleingabe.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const ANFRAGEN_PRO_MINUTE = 60;

const heuteInZuerich = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(
    new Date(),
  );

// Schnelleingabe (#375): POST /lager/{id}/aufgaben/schnell liefert nur einen Vorschlag und schreibt nie (keine Transaktion, kein Feed, keine Benachrichtigung); angelegt wird erst nach der Bestätigung über POST /lager/{id}/aufgaben. Recht: aufgaben.bearbeiten. Datenbank: höchstens zwei gebündelte Abfragen (Mitglieder, Ressorts), und nur wenn der Text «@» oder «#» enthält; der Parser selbst (lager/schnelleingabe.ts) rechnet ohne Datenbank
export function erstelleAufgabenSchnellRouten({ db }: { db: Db }) {
  const bearbeiten = lagerZugriff(db, { recht: "aufgaben.bearbeiten" });

  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const anfragen = new Map<string, number[]>();
  const zuViele = (wer: string) => {
    const jetzt = Date.now();
    const liste = (anfragen.get(wer) ?? []).filter((t) => jetzt - t < 60_000);
    const voll = liste.length >= ANFRAGEN_PRO_MINUTE;
    if (!voll) liste.push(jetzt);
    if (liste.length > 0) anfragen.set(wer, liste);
    else anfragen.delete(wer);
    return voll;
  };

  return new Hono<LagerEnv>().post(
    "/:id/aufgaben/schnell",
    bearbeiten,
    eingabe("param", lagerPfad),
    eingabe("json", schnelleingabeEingabe),
    async (c) => {
      const lager = c.get("lager").lager;
      if (zuViele(c.get("person").id)) throw new HTTPException(429);
      const { text } = c.req.valid("json");

      // Mitglieder des Lagers (nur sie können Verantwortliche sein) und Ressorts: je eine Abfrage
      const [mitglieder, ressorts] = await Promise.all([
        brauchtPersonen(text)
          ? db
              .select({
                id: user.id,
                name: user.name,
                ceviName: user.ceviName,
                bildUrl: bildUrlImLager(sql`${user.id}`, lager.id),
              })
              .from(lagerMitglied)
              .innerJoin(user, eq(user.id, lagerMitglied.personId))
              .where(
                and(
                  eq(lagerMitglied.lagerId, lager.id),
                  isNull(user.deaktiviertAm),
                ),
              )
              .orderBy(asc(user.name), asc(user.id))
          : [],
        brauchtRessorts(text)
          ? db
              .select({
                id: ressort.id,
                kuerzel: ressort.kuerzel,
                name: ressort.name,
              })
              .from(ressort)
              .where(and(eq(ressort.lagerId, lager.id)))
              .orderBy(asc(ressort.reihenfolge), asc(ressort.id))
          : [],
      ]);
      const personen: Kandidat[] = mitglieder.map((m) => ({
        id: m.id,
        schluessel: [m.ceviName, m.name, m.name.split(/\s+/)[0]].filter(
          (s): s is string => !!s,
        ),
      }));
      const ressortKandidaten: Kandidat[] = ressorts.map((r) => ({
        id: r.id,
        schluessel: [r.kuerzel, r.name],
      }));
      const personNachId = new Map(mitglieder.map((m) => [m.id, m]));
      const ressortNachId = new Map(ressorts.map((r) => [r.id, r]));
      const mit = <T>(t: Treffer | null, nachId: Map<string, T>) =>
        t && {
          status: t.status,
          text: t.text,
          kandidaten: t.ids.map((id) => nachId.get(id)!),
        };

      const vorschlaege = parseSchnelleingabe(text, {
        heute: heuteInZuerich(),
        lagerVon: lager.von,
        personen,
        ressorts: ressortKandidaten,
      });
      return c.json({
        vorschlaege: vorschlaege.map((v) => ({
          zeile: v.zeile,
          titel: v.titel,
          person: mit(v.person, personNachId),
          ressort: mit(v.ressort, ressortNachId),
          frist: v.frist,
          hinweise: v.hinweise,
        })),
      });
    },
  );
}

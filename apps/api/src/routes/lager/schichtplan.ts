import { randomInt } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import { SEED_MAX } from "../../lager/mischen.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { sperreLager } from "../../lager/ressorts.js";
import {
  aendereDienst,
  besetze,
  besetzen,
  dienstAendern,
  dienstAnlegen,
  ladeSchichtplan,
  legeDienstAn,
  loescheDienst,
  planeVorschlag,
  statistikVon,
  uebernehmeVorschlag,
  versionAbfrage,
  vorschlagen,
  type SchichtplanFehler,
} from "../../lager/schichtplan.js";

// Je Konto und Lager höchstens so viele Vorschläge je Minute: Übernehmen sperrt das Lager für die Dauer des Schreibens (lager/sync.ts)
export const VORSCHLAEGE_PRO_MINUTE = 10;

const lagerPfad = z.strictObject({ id: z.uuid() });
const dienstPfad = z.strictObject({ id: z.uuid(), dienstId: z.uuid() });

const FEHLER_TEXT: Record<SchichtplanFehler, [number, string]> = {
  LIMIT_ERREICHT: [409, "Mehr Dienste sind in diesem Lager nicht möglich."],
  DIENST_VORHANDEN: [409, "Diesen Dienst gibt es in diesem Abschnitt schon."],
  ABGEWAEHLT: [
    409,
    "Wer nicht dabei ist, lässt sich nicht einteilen. Wähle die Person zuerst wieder zu.",
  ],
  ABWESEND: [
    409,
    "Mindestens eine Person ist in diesem Abschnitt als abwesend eingetragen.",
  ],
  DOPPELBELEGT: [
    409,
    "Mindestens eine Person hat in diesem Abschnitt schon einen anderen Dienst.",
  ],
};
const fehlerAntwort = (fehler: SchichtplanFehler) => {
  const [status, message] = FEHLER_TEXT[fehler];
  return { status: status as 409, body: { code: fehler, message } };
};

// Dienste und Schichtplan (#388). Lesen braucht einteilung.lesen, jede Änderung einteilung.bearbeiten (Standard: Lagerleitung und Leitung). Jede Schreibroute geht durch lager/sync.ts (Folgenummer, Feed) unter der Lagersperre. Der Vorschlag mit uebernehmen=false schreibt nichts, hat aber dasselbe Recht und denselben Schreibschutz wie das Übernehmen
export function erstelleSchichtplanRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, { recht: "einteilung.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "einteilung.bearbeiten" });

  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const laeufe = new Map<string, number[]>();
  const zuViele = (wer: string) => {
    const jetzt = Date.now();
    const liste = (laeufe.get(wer) ?? []).filter((t) => jetzt - t < 60_000);
    const voll = liste.length >= VORSCHLAEGE_PRO_MINUTE;
    if (!voll) liste.push(jetzt);
    if (liste.length > 0) laeufe.set(wer, liste);
    else laeufe.delete(wer);
    return voll;
  };

  return (
    new Hono<LagerEnv>()
      // Eine Abfrage für Dienste und Schichten; die Statistik ergibt sich aus denselben Zeilen. Teilnehmende zeigen Vorname, Nachname und Stufe, nie den Cevi-Namen
      .get(
        "/:id/schichtplan",
        lesen,
        eingabe("param", lagerPfad),
        async (c) => {
          const plan = await ladeSchichtplan(db, c.get("lager").lager.id);
          return c.json({
            dienste: plan.dienste,
            schichten: plan.schichten,
            statistik: statistikVon(plan),
          });
        },
      )
      .post(
        "/:id/schichtplan/dienste",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", dienstAnlegen),
        async (c) => {
          const k = {
            lagerId: c.get("lager").lager.id,
            personId: c.get("person").id,
          };
          const e = c.req.valid("json");
          const ergebnis = await db.transaction((tx) => legeDienstAn(tx, k, e));
          if ("fehler" in ergebnis) {
            const a = fehlerAntwort(ergebnis.fehler);
            return c.json(a.body, a.status);
          }
          return c.json(ergebnis.dienst, 201);
        },
      )
      .patch(
        "/:id/schichtplan/dienste/:dienstId",
        bearbeiten,
        eingabe("param", dienstPfad),
        eingabe("json", dienstAendern),
        async (c) => {
          const k = {
            lagerId: c.get("lager").lager.id,
            personId: c.get("person").id,
          };
          const ergebnis = await db.transaction((tx) =>
            aendereDienst(
              tx,
              k,
              c.req.valid("param").dienstId,
              c.req.valid("json"),
            ),
          );
          if ("fehler" in ergebnis) {
            const a = fehlerAntwort(ergebnis.fehler);
            return c.json(a.body, a.status);
          }
          return c.json(ergebnis.dienst);
        },
      )
      .delete(
        "/:id/schichtplan/dienste/:dienstId",
        bearbeiten,
        eingabe("param", dienstPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          const k = {
            lagerId: c.get("lager").lager.id,
            personId: c.get("person").id,
          };
          await db.transaction((tx) =>
            loescheDienst(
              tx,
              k,
              c.req.valid("param").dienstId,
              c.req.valid("query").version,
            ),
          );
          return c.body(null, 204);
        },
      )
      .put(
        "/:id/schichtplan/schichten",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", besetzen),
        async (c) => {
          const k = {
            lagerId: c.get("lager").lager.id,
            personId: c.get("person").id,
          };
          const ergebnis = await db.transaction((tx) =>
            besetze(tx, k, c.get("person").abteilungId, c.req.valid("json")),
          );
          if ("fehler" in ergebnis) {
            const a = fehlerAntwort(ergebnis.fehler);
            return c.json(a.body, a.status);
          }
          return c.json(ergebnis);
        },
      )
      .post(
        "/:id/schichtplan/vorschlag",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", vorschlagen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const person = c.get("person");
          const {
            uebernehmen,
            seed: wunsch,
            ...optionen
          } = c.req.valid("json");
          if (zuViele(`${person.id}:${lagerId}`)) throw new HTTPException(429);
          const seed = wunsch ?? randomInt(0, SEED_MAX + 1);
          const p = { ...optionen, seed };
          if (!uebernehmen) {
            const { antwort } = await planeVorschlag(
              db,
              lagerId,
              person.abteilungId,
              p,
            );
            return c.json({ vorschau: true, ...antwort });
          }
          const k = { lagerId, personId: person.id };
          const ergebnis = await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            // Der Stand unter der Sperre, nicht der der Vorschau
            const { zeilen, antwort } = await planeVorschlag(
              tx,
              lagerId,
              person.abteilungId,
              p,
            );
            const neu = await uebernehmeVorschlag(tx, k, zeilen);
            return { ...antwort, geaendert: neu.length };
          });
          return c.json({ vorschau: false, ...ergebnis });
        },
      )
  );
}

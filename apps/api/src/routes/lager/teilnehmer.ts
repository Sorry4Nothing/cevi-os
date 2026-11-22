import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog, teilnehmer } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { sperreLager } from "../../lager/ressorts.js";
import { aendereZeile, legeZeilenAn, loescheZeile } from "../../lager/sync.js";
import {
  IMPORT_MAX_ZEILEN,
  leseImport,
  schluessel,
  teilnehmerAendern,
  teilnehmerAnlegen,
  teilnehmerImport,
  teilnehmerKurz,
  teilnehmerVoll,
  versionAbfrage,
} from "../../lager/teilnehmer.js";

const SEITE = 100;
// Je Konto und Lager höchstens so viele Importe je Minute: Jeder Import sperrt das Lager für die Dauer des Schreibens (lager/sync.ts)
export const IMPORTE_PRO_MINUTE = 10;

const lagerPfad = z.strictObject({ id: z.uuid() });
const teilnehmerPfad = z.strictObject({ id: z.uuid(), teilnehmerId: z.uuid() });
const listeAbfrage = z.strictObject({
  // Cursor: die ID des letzten Eintrags der vorigen Seite
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(SEITE),
  // Nur diese Stufe, ohne Beachtung der Gross- und Kleinschreibung
  stufe: z.string().trim().min(1).max(50).optional(),
});

// Teilnehmende eines Lagers (#384). Lesen braucht teilnehmer.lesen und zeigt Vorname, Nachname und Stufe; wer teilnehmer.bearbeiten hat, sieht zusätzlich den Cevi-Namen. Erfassen, ändern, löschen und Importieren braucht teilnehmer.bearbeiten (Standard: nur die Lagerleitung). Jede Schreibroute geht durch lager/sync.ts: Version prüfen (409 VERSION_KONFLIKT), Folgenummer, Feed; Löschen ist ein Soft-Delete, nach dem Lager löscht ein täglicher Lauf die Zeilen endgültig (lager/teilnehmer.ts). Keine Gesundheitsdaten: unbekannte Felder lehnen die strikten Schemas ab
export function erstelleTeilnehmerRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, { recht: "teilnehmer.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "teilnehmer.bearbeiten" });

  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const importe = new Map<string, number[]>();
  const zuViele = (wer: string) => {
    const jetzt = Date.now();
    const liste = (importe.get(wer) ?? []).filter((t) => jetzt - t < 60_000);
    const voll = liste.length >= IMPORTE_PRO_MINUTE;
    if (!voll) liste.push(jetzt);
    if (liste.length > 0) importe.set(wer, liste);
    else importe.delete(wer);
    return voll;
  };

  const ansichtFuer = (c: { get(k: "lager"): Parameters<typeof darf>[0] }) =>
    darf(c.get("lager"), "teilnehmer.bearbeiten")
      ? teilnehmerVoll
      : teilnehmerKurz;

  // Eine Abfrage je Seite, sortiert nach Name; der Seitenwechsel läuft über (Nachname, Vorname, ID) der letzten bekannten Zeile
  async function lade(
    lagerId: string,
    p: { id?: string; nach?: string; limit?: number; stufe?: string },
  ) {
    const limit = p.limit ?? SEITE;
    const zeilen = await db
      .select()
      .from(teilnehmer)
      .where(
        and(
          eq(teilnehmer.lagerId, lagerId),
          isNull(teilnehmer.geloeschtAm),
          p.id ? eq(teilnehmer.id, p.id) : undefined,
          p.stufe
            ? sql`lower(${teilnehmer.stufe}) = lower(${p.stufe})`
            : undefined,
          // Ist die letzte bekannte Zeile unbekannt oder gelöscht, bleibt die Seite leer
          p.nach
            ? sql`(${teilnehmer.nachname}, ${teilnehmer.vorname}, ${teilnehmer.id}) > (select t.nachname, t.vorname, t.id from teilnehmer t where t.id = ${p.nach} and t.lager_id = ${lagerId})`
            : undefined,
        ),
      )
      .orderBy(
        asc(teilnehmer.nachname),
        asc(teilnehmer.vorname),
        asc(teilnehmer.id),
      )
      .limit(limit + 1);
    return {
      zeilen: zeilen.slice(0, limit),
      naechster: zeilen.length > limit ? zeilen[limit - 1]!.id : null,
    };
  }

  const vorhandene = (tx: Pick<Db, "select">, lagerId: string) =>
    tx
      .select({
        vorname: teilnehmer.vorname,
        nachname: teilnehmer.nachname,
        stufe: teilnehmer.stufe,
      })
      .from(teilnehmer)
      .where(
        and(eq(teilnehmer.lagerId, lagerId), isNull(teilnehmer.geloeschtAm)),
      );

  // Liest den Text und trennt die Zeilen, die schon im Lager stehen, von den neuen
  async function plane(tx: Pick<Db, "select">, lagerId: string, text: string) {
    const gelesen = leseImport(text);
    if (!gelesen) return null;
    const da = new Set((await vorhandene(tx, lagerId)).map(schluessel));
    const neu = gelesen.zeilen.filter((z) => !da.has(schluessel(z)));
    return {
      neu,
      fehler: gelesen.fehler,
      doppelt: [
        ...gelesen.doppeltImText.map((d) => ({
          zeile: d.zeile,
          grund: "im_text" as const,
        })),
        ...gelesen.zeilen
          .filter((z) => da.has(schluessel(z)))
          .map((z) => ({ zeile: z.zeile, grund: "vorhanden" as const })),
      ].sort((a, b) => a.zeile - b.zeile),
    };
  }

  return (
    new Hono<LagerEnv>()
      .get(
        "/:id/teilnehmer",
        lesen,
        eingabe("param", lagerPfad),
        eingabe("query", listeAbfrage),
        async (c) => {
          const { zeilen, naechster } = await lade(
            c.get("lager").lager.id,
            c.req.valid("query"),
          );
          return c.json({
            teilnehmer: zeilen.map(ansichtFuer(c)),
            naechster,
          });
        },
      )
      .post(
        "/:id/teilnehmer",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", teilnehmerAnlegen),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const [neu] = await db.transaction((tx) =>
            legeZeilenAn(
              tx,
              teilnehmer,
              { lagerId, personId: c.get("person").id },
              [c.req.valid("json")],
            ),
          );
          return c.json(teilnehmerVoll(neu!), 201);
        },
      )
      // Vor «/:teilnehmerId», damit «import» nicht als ID gilt
      .post(
        "/:id/teilnehmer/import",
        bearbeiten,
        eingabe("param", lagerPfad),
        eingabe("json", teilnehmerImport),
        async (c) => {
          const lagerId = c.get("lager").lager.id;
          const person = c.get("person");
          const { text, uebernehmen } = c.req.valid("json");
          if (zuViele(`${person.id}:${lagerId}`)) throw new HTTPException(429);
          const zuGross = {
            code: "ZU_VIELE_ZEILEN",
            message: `Ein Import nimmt höchstens ${IMPORT_MAX_ZEILEN} Zeilen. Teile die Liste auf.`,
          };
          if (!uebernehmen) {
            const plan = await plane(db, lagerId, text);
            if (!plan) return c.json(zuGross, 400);
            return c.json({ vorschau: true, angelegt: 0, ...plan });
          }
          // Eine Transaktion: Sperre, Abgleich mit dem Stand unter der Sperre, ein gebündelter Insert samt Feed
          const ergebnis = await db.transaction(async (tx) => {
            await sperreLager(tx, lagerId);
            const plan = await plane(tx, lagerId, text);
            if (!plan) return null;
            const angelegt = await legeZeilenAn(
              tx,
              teilnehmer,
              { lagerId, personId: person.id },
              plan.neu.map(({ vorname, nachname, stufe, ceviName }) => ({
                vorname,
                nachname,
                stufe,
                ceviName,
              })),
            );
            if (angelegt.length > 0) {
              // Nur die Anzahl, keine Namen
              await tx.insert(auditLog).values({
                abteilungId: person.abteilungId,
                akteurId: person.id,
                aktion: "lager_teilnehmende_importiert",
                zielTyp: "lager",
                zielId: lagerId,
                details: { anzahl: angelegt.length },
              });
            }
            return { ...plan, angelegt: angelegt.length };
          });
          if (!ergebnis) return c.json(zuGross, 400);
          return c.json({ vorschau: false, ...ergebnis });
        },
      )
      .get(
        "/:id/teilnehmer/:teilnehmerId",
        lesen,
        eingabe("param", teilnehmerPfad),
        async (c) => {
          const { zeilen } = await lade(c.get("lager").lager.id, {
            id: c.req.valid("param").teilnehmerId,
          });
          if (!zeilen[0]) throw new HTTPException(404);
          return c.json(ansichtFuer(c)(zeilen[0]));
        },
      )
      .patch(
        "/:id/teilnehmer/:teilnehmerId",
        bearbeiten,
        eingabe("param", teilnehmerPfad),
        eingabe("json", teilnehmerAendern),
        async (c) => {
          const { version, ...werte } = c.req.valid("json");
          const neu = await db.transaction((tx) =>
            aendereZeile(
              tx,
              teilnehmer,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              {
                id: c.req.valid("param").teilnehmerId,
                version,
                werte,
                ansicht: teilnehmerVoll,
              },
            ),
          );
          return c.json(teilnehmerVoll(neu));
        },
      )
      .delete(
        "/:id/teilnehmer/:teilnehmerId",
        bearbeiten,
        eingabe("param", teilnehmerPfad),
        eingabe("query", versionAbfrage),
        async (c) => {
          await db.transaction((tx) =>
            loescheZeile(
              tx,
              teilnehmer,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              {
                id: c.req.valid("param").teilnehmerId,
                version: c.req.valid("query").version,
                ansicht: teilnehmerVoll,
              },
            ),
          );
          return c.body(null, 204);
        },
      )
  );
}

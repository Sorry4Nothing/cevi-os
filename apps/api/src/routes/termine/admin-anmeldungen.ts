import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  ladeAnlassMitSumme,
  ladeBlock,
  ladeSeite,
  liesCursor,
  type Anmeldung,
  type Feld,
} from "../../termine/anmeldungen-liste.js";
import { pruefeAnlassRecht } from "../../termine/anlass-recht.js";
import { BOM, csvZeile } from "../../termine/csv.js";
import type { Person } from "../../rechte.js";
import type { TermineEnv } from "./index.js";

// Anmeldungen eines Anlasses ansehen und exportieren (#444, Epic #430). Nur die Abteilungsleitung (termine/anlass-recht.ts, den zweiten Faktor verlangt der Pfad /api/v1/admin/*); ein Anlass einer anderen Abteilung ist 404.
// Abfragen: Liste 2 je Seite (Anlass mit Summe und Feldern; Seite mit Konto-Daten). Export: 1 (Anlass), 1 Audit-Eintrag, dann 1 je Block von 500 Anmeldungen, nie je Zeile. Die Datei wird gestreamt und nirgends gespeichert.

const pfadSchema = z.strictObject({ id: z.uuid() });
// Ohne Angabe nur die, die angemeldet sind; «alle» zeigt auch die Abgemeldeten
const statusSchema = z.enum(["angemeldet", "abgemeldet", "alle"]);
const listeSchema = z.strictObject({
  status: statusSchema.default("angemeldet"),
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .refine((n) => n >= 1 && n <= 100)
    .optional(),
  nach: z.string().min(1).max(200).optional(),
});
const exportSchema = z.strictObject({
  status: statusSchema.default("angemeldet"),
});

export const BLOCKGROESSE = 500;
// Je Person höchstens so viele Exporte in 10 Minuten (SR-71)
export const EXPORTE_PRO_FENSTER = 10;
const FENSTER_MS = 600_000;

const KOPF = [
  "Angemeldet von",
  "Telefon",
  "Kind Vorname",
  "Kind Nachname",
  "Kind Cevi-Name",
  "Kind Stufe",
  "Status",
  "Geändert am",
];
const zeit = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  dateStyle: "short",
  timeStyle: "short",
});

function antwortText(feld: Feld, antworten: Anmeldung["antworten"]) {
  const wert = antworten[feld.schluessel];
  if (typeof wert === "boolean") return wert ? "Ja" : "Nein";
  return wert ?? "";
}
const csvDatenzeile = (a: Anmeldung, felder: readonly Feld[]) =>
  csvZeile([
    a.person.name,
    a.person.telefon ?? "",
    a.kind?.vorname ?? "",
    a.kind?.nachname ?? "",
    a.kind?.ceviName ?? "",
    a.kind?.stufe ?? "",
    a.status === "angemeldet" ? "angemeldet" : "abgemeldet",
    zeit.format(a.geaendertAm),
    ...felder.map((f) => antwortText(f, a.antworten)),
  ]);

export function erstelleAdminAnmeldungenRouten({ db }: { db: Db }) {
  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const exporte = new Map<string, number[]>();
  const zuViele = (person: Person) => {
    const jetzt = Date.now();
    const liste = (exporte.get(person.id) ?? []).filter(
      (t) => jetzt - t < FENSTER_MS,
    );
    const voll = liste.length >= EXPORTE_PRO_FENSTER;
    if (!voll) liste.push(jetzt);
    if (liste.length > 0) exporte.set(person.id, liste);
    else exporte.delete(person.id);
    return voll;
  };

  // Erst den Anlass in SQL auf die Abteilung der Sitzung gefiltert laden (fremd und unbekannt sind 404), dann das Recht (403)
  async function ladeAnlass(person: Person, id: string) {
    const a = await ladeAnlassMitSumme(db, person.abteilungId, id);
    if (!a) throw new HTTPException(404);
    pruefeAnlassRecht(person);
    return a;
  }

  return new Hono<TermineEnv>()
    .get(
      "/admin/anlaesse/:id/anmeldungen",
      eingabe("param", pfadSchema),
      eingabe("query", listeSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const { status, limit = 50, nach } = c.req.valid("query");
        const a = await ladeAnlass(person, id);
        const cursor = nach === undefined ? undefined : liesCursor(nach);
        if (cursor === null) throw new HTTPException(400);
        const seite = await ladeSeite(db, id, status, limit, cursor);
        return c.json({
          eintraege: seite.eintraege,
          summe: { angemeldet: a.angemeldet, abgemeldet: a.abgemeldet },
          weitere: seite.weitere,
          naechste: seite.naechste,
        });
      },
    )
    .get(
      "/admin/anlaesse/:id/anmeldungen.csv",
      eingabe("param", pfadSchema),
      eingabe("query", exportSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const { status } = c.req.valid("query");
        const a = await ladeAnlass(person, id);
        if (zuViele(person)) throw new HTTPException(429);
        const anzahl =
          status === "alle" ? a.angemeldet + a.abgemeldet : a[status];
        // Nur die Kennung des Anlasses und die Zahl, nie Namen oder Antworten. Die Zahl ist die beim Start; Änderungen während des Exports ändern sie nicht
        await db.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "anlass_export",
          zielTyp: "anlass",
          zielId: id,
          details: { anzahl },
        });
        const kopfzeile = csvZeile([
          ...KOPF,
          ...a.felder.map((f) => f.beschriftung),
        ]);
        const text = new TextEncoder();
        let kopfGesendet = false;
        let nachId: string | undefined;
        const datei = new ReadableStream<Uint8Array>({
          // pull läuft erst, wenn der Client Daten abnimmt: Ein abgebrochener Download fragt keinen weiteren Block ab
          async pull(controller) {
            try {
              if (!kopfGesendet) {
                kopfGesendet = true;
                controller.enqueue(text.encode(BOM + kopfzeile));
                return;
              }
              const block = await ladeBlock(
                db,
                id,
                status,
                BLOCKGROESSE,
                nachId,
              );
              if (block.length > 0) {
                controller.enqueue(
                  text.encode(
                    block.map((z) => csvDatenzeile(z, a.felder)).join(""),
                  ),
                );
              }
              if (block.length < BLOCKGROESSE) controller.close();
              else nachId = block[block.length - 1]!.id;
            } catch (fehler) {
              // Nur der Typ, nie Inhalt
              console.error(
                "anlass_export abgebrochen",
                fehler instanceof Error ? fehler.name : typeof fehler,
              );
              controller.error(fehler);
            }
          },
        });
        return new Response(datei, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="anlass-${id}.csv"`,
            "Cache-Control": "no-store",
          },
        });
      },
    );
}

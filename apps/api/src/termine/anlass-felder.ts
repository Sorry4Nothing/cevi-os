import { and, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { CEVI_QUELLEN } from "../cevi-db/felder.js";
import { anlassFeld } from "../db/schema.js";
import { enthaeltGesundheitswort } from "../gesundheit-sperrliste.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Zusatzfelder einer Anmeldung (#442). Obergrenzen: 20 Felder, Beschriftung 100 Zeichen, Auswahl mit 2 bis 20 Optionen zu je 100 Zeichen, Schlüssel a-z, 0-9 und «_» (1 bis 40)
export const MAX_FELDER = 20;

const feld = z
  .strictObject({
    schluessel: z.string().regex(/^[a-z0-9_]{1,40}$/),
    beschriftung: z.string().trim().min(1).max(100),
    typ: z.enum(["text", "ja_nein", "auswahl"]),
    optionen: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    pflicht: z.boolean().default(false),
    // Aus welcher Angabe der Cevi-Datenbank die Anmeldung das Feld vorausfüllt (#691); nur bei Textfeldern, nie Gesundheit (die Liste ist fest)
    ceviQuelle: z.enum(CEVI_QUELLEN).nullable().default(null),
  })
  .refine((f) => f.ceviQuelle === null || f.typ === "text", {
    message: "ceviQuelle nur bei Text",
  })
  .refine(
    (f) =>
      f.typ === "auswahl"
        ? f.optionen.length >= 2 &&
          new Set(f.optionen).size === f.optionen.length
        : f.optionen.length === 0,
    { message: "optionen passen nicht zum Typ" },
  );

// Die ganze Liste; die Reihenfolge ist die der Liste
export const felderSchema = z
  .array(feld)
  .max(MAX_FELDER)
  .refine(
    (liste) => new Set(liste.map((f) => f.schluessel)).size === liste.length,
    { message: "Schlüssel doppelt" },
  );
export type FeldEingabe = z.infer<typeof feld>;

// Der Schlüssel des ersten Feldes, das nach Gesundheitsdaten fragt, sonst null
export function findeGesundheitsfeld(felder: readonly FeldEingabe[]) {
  const treffer = felder.find((f) =>
    [f.beschriftung, ...f.optionen].some(enthaeltGesundheitswort),
  );
  return treffer?.schluessel ?? null;
}

// Schlüssel und Typ eines Feldes mit Antworten sind fest: Es muss in der neuen Liste bleiben und seinen Typ behalten. Gibt die Schlüssel zurück, die das verletzen
export function felderInBenutzung(
  bisher: readonly { schluessel: string; typ: string }[],
  neu: readonly FeldEingabe[],
  mitAntworten: ReadonlySet<string>,
) {
  return bisher
    .filter((b) => mitAntworten.has(b.schluessel))
    .filter(
      (b) => neu.find((n) => n.schluessel === b.schluessel)?.typ !== b.typ,
    )
    .map((b) => b.schluessel);
}

// Ersetzt die Felder des Anlasses durch die Liste: ein Löschen und ein Einfügen mit Aktualisieren, unabhängig von der Zahl der Felder
export async function schreibeFelder(
  tx: Db | Tx,
  anlassId: string,
  felder: readonly FeldEingabe[],
) {
  await tx.delete(anlassFeld).where(
    felder.length === 0
      ? eq(anlassFeld.anlassId, anlassId)
      : and(
          eq(anlassFeld.anlassId, anlassId),
          notInArray(
            anlassFeld.schluessel,
            felder.map((f) => f.schluessel),
          ),
        ),
  );
  if (felder.length === 0) return;
  await tx
    .insert(anlassFeld)
    .values(
      felder.map((f, reihenfolge) => ({
        anlassId,
        schluessel: f.schluessel,
        beschriftung: f.beschriftung,
        typ: f.typ,
        optionen: f.optionen,
        pflicht: f.pflicht,
        ceviQuelle: f.ceviQuelle,
        reihenfolge,
      })),
    )
    .onConflictDoUpdate({
      target: [anlassFeld.anlassId, anlassFeld.schluessel],
      set: {
        beschriftung: sql`excluded.beschriftung`,
        typ: sql`excluded.typ`,
        optionen: sql`excluded.optionen`,
        pflicht: sql`excluded.pflicht`,
        ceviQuelle: sql`excluded.cevi_quelle`,
        reihenfolge: sql`excluded.reihenfolge`,
      },
    });
}

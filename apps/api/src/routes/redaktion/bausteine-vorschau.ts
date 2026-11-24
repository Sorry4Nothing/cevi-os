import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { darfSeite } from "../../bearbeiten.js";
import type { Db } from "../../db/client.js";
import { seite } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";
import { bausteinSchema, type Baustein } from "../../website/bausteine.js";
import type { Kontakt } from "../../website/rendern.js";
import { hatWebsiteZugang } from "../../website/seiten.js";
import {
  BEISPIEL_SEITE_ID,
  beispielDaten,
  ladeVorschauDaten,
  MAX_VORSCHAU_BAUSTEINE,
  platzhalterBilder,
  rendereBausteinVorschau,
  type Vorschau,
} from "../../website/vorschau.js";

// Vorschau einzelner Bausteine (#739): der Katalog «Baustein hinzufügen» und die Bausteinliste des Editors zeigen jeden Baustein, wie die Website ihn zeigt.
// Die Route schreibt nichts (keine Datei, keine Zeile) und liefert nur HTML, das der Renderer aus geprüften Daten erzeugt: Jeder Baustein läuft durch bausteinSchema, nie HTML aus der Eingabe.
// Die Bausteine sind Eingaben: Das Dokument der Seite muss dafür nicht gespeichert sein.
const schema = z.strictObject({
  // Mit Seite zeigt die Vorschau die echten Daten der Abteilung (Bilder, Personen, Termine), ohne sie die Platzhalter des Katalogs
  seiteId: z.uuid().optional(),
  bausteine: z.array(z.unknown()).min(1).max(MAX_VORSCHAU_BAUSTEINE),
});

// shortcut: Zähler im Arbeitsspeicher wie beim Speichern des Entwurfs (seiten-inhalt.ts), ein Neustart setzt ihn zurück; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
const ANFRAGEN = 60;
const FENSTER_MS = 60_000;

export function erstelleBausteineVorschauRouten({
  db,
  kontakt,
}: {
  db: Db;
  kontakt?: Kontakt;
}) {
  const versuche = new Map<string, number[]>();
  const zuViele = (id: string) => {
    const jetzt = Date.now();
    const liste = (versuche.get(id) ?? []).filter(
      (t) => jetzt - t < FENSTER_MS,
    );
    const voll = liste.length >= ANFRAGEN;
    if (!voll) liste.push(jetzt);
    versuche.set(id, liste);
    return voll;
  };

  return new Hono<{ Variables: { person: Person } }>().post(
    "/vorschau",
    eingabe("json", schema),
    async (c) => {
      const person = c.get("person");
      if (!(await hatWebsiteZugang(db, person))) {
        throw new HTTPException(403);
      }
      if (zuViele(person.id)) throw new HTTPException(429);
      const { seiteId, bausteine } = c.req.valid("json");
      // Mit Seite: in der Abteilung der Sitzung (404 sonst) und dasselbe Recht wie die Vorschau der Seite (403)
      if (seiteId !== undefined) {
        const [z] = await db
          .select()
          .from(seite)
          .where(
            and(
              eq(seite.id, seiteId),
              eq(seite.abteilungId, person.abteilungId),
            ),
          );
        if (!z) throw new HTTPException(404);
        if (!(await darfSeite(db, person, z))) throw new HTTPException(403);
      }
      // Jeder Baustein für sich: ein ungültiger (neu, noch leer) zeigt «ungültig», die übrigen erscheinen.
      // Offen wie bei der Vorschau der Seite: Wer die Seite bearbeitet, darf alles sehen
      const geprueft = bausteine.map((roh) => {
        const p = bausteinSchema.safeParse(roh);
        return p.success
          ? ({ ...p.data, sichtbarkeit: "erbt" } as Baustein)
          : null;
      });
      const gueltig = geprueft.filter((b) => b !== null);
      const dokument = {
        v: 1 as const,
        titel: "Vorschau",
        bausteine: gueltig,
      };
      const daten =
        seiteId === undefined
          ? beispielDaten([dokument])
          : await ladeVorschauDaten(db, person, seiteId, dokument, kontakt);
      const ersatz =
        seiteId === undefined ? platzhalterBilder(daten) : undefined;
      const rechne = seiteId ?? BEISPIEL_SEITE_ID;
      const vorschauen: (Vorschau | { html: null; grund: "ungueltig" })[] =
        geprueft.map((b) =>
          b === null
            ? { html: null, grund: "ungueltig" }
            : rendereBausteinVorschau(b, daten, rechne, ersatz),
        );
      return c.json({ vorschauen }, 200, {
        "Cache-Control": "private, no-store",
      });
    },
  );
}

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import { ARTEN, darfDrucken, ladeAushang } from "../../lager/aushaenge.js";
import { AushangZuGross, erzeugePdf } from "../../lager/pdf.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";

// Je Konto höchstens so viele Aushänge je Minute (SR-71): Jeder kostet Abfragen und Rechenzeit
export const AUSHAENGE_PRO_MINUTE = 10;

const pfad = z.strictObject({ id: z.uuid(), art: z.enum(ARTEN) });

// Aushänge als PDF (#405): Schichtplan, Zimmerliste, Türschilder, Gruppenlisten, Fahrtenliste und Organigramm. Die Datei entsteht beim Aufruf aus den Daten der Ansicht und wird nirgends gespeichert (nicht in der Datenbank, nicht im S3, nicht auf der Platte). Die Berechtigung folgt der Ansicht (lager/aushaenge.ts, RECHTE); die Prüfung steht nach dem Laden des Lagers: fremdes Lager 404, fehlendes Recht 403. Grösse und Zeit sind begrenzt (413 ZU_GROSS)
export function erstelleAushaengeRouten({ db }: { db: Db }) {
  const mitglied = lagerZugriff(db);

  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const laeufe = new Map<string, number[]>();
  const zuViele = (wer: string) => {
    const jetzt = Date.now();
    const liste = (laeufe.get(wer) ?? []).filter((t) => jetzt - t < 60_000);
    const voll = liste.length >= AUSHAENGE_PRO_MINUTE;
    if (!voll) liste.push(jetzt);
    if (liste.length > 0) laeufe.set(wer, liste);
    else laeufe.delete(wer);
    return voll;
  };

  return new Hono<LagerEnv>().get(
    "/:id/aushaenge/:art",
    mitglied,
    eingabe("param", pfad),
    async (c) => {
      const zugriff = c.get("lager");
      const { art } = c.req.valid("param");
      if (!darfDrucken(zugriff, art)) throw new HTTPException(403);
      if (zuViele(c.get("person").id)) throw new HTTPException(429);
      let pdf: Buffer;
      try {
        pdf = await erzeugePdf(await ladeAushang(db, zugriff, art));
      } catch (fehler) {
        if (fehler instanceof AushangZuGross) throw new HTTPException(413);
        throw fehler;
      }
      // Der Dateiname nennt nur die Art, nie Lager oder Personen
      return c.body(new Uint8Array(pdf), 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${art}.pdf"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
    },
  );
}

import { and, asc, eq, gt, lte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { lagerAenderung } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  darfTabelleLesen,
  lagerZugriff,
  type LagerEnv,
} from "../../lager/policy.js";
import { holeLagerTabelle, listeLagerTabellen } from "../../lager/tabellen.js";

// Änderungsfeed des Lagers (#366). Er nennt nur Objekttyp, ID, Art und Version einer Änderung, nie Inhalte; die App holt den Inhalt über die Route des Moduls, wo die Rechte der Rolle gelten. Gefiltert wird in zwei Stufen: Das Leserecht der Tabelle (darf) und der Zeilenfilter der Rolle (sichtbar, lager/tabellen.ts). Eine Tabelle ohne Anmeldung kommt nie vor
const abfrage = z.strictObject({
  seit: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export function erstelleAenderungenRouten({ db }: { db: Db }) {
  return new Hono<LagerEnv>().get(
    "/:id/aenderungen",
    lagerZugriff(db),
    eingabe("query", abfrage),
    async (c) => {
      const zugriff = c.get("lager");
      const { seit, limit } = c.req.valid("query");
      // Stand der Anfrage; was später dazukommt, holt die nächste
      const { seq, seqMin } = zugriff.lager;

      // Ohne «seit»: aktuelle Folgenummer und die Objekttypen, die die Rolle lesen darf. Die App lädt die Listen der Module und fragt dann mit seit = seq weiter
      if (seit === undefined) {
        return c.json({
          seq,
          objekttypen: listeLagerTabellen()
            .filter(([, e]) => darfTabelleLesen(zugriff, e.recht))
            .map(([name]) => name)
            .sort(),
        });
      }
      // Der Feed beginnt erst bei seq_min (Einträge sind aufgeräumt), oder der Client kennt eine Nummer aus der Zukunft (Lager zurückgespielt): neu laden
      if (seit + 1 < seqMin || seit > seq) {
        return c.json(
          {
            code: "FEED_NEU_LADEN",
            message:
              "Der Stand ist zu alt für den Änderungsfeed. Bitte neu laden.",
            seq,
          },
          410,
        );
      }

      const zeilen = await db
        .select({
          seq: lagerAenderung.seq,
          tabelle: lagerAenderung.tabelle,
          zeileId: lagerAenderung.zeileId,
          art: lagerAenderung.art,
          version: lagerAenderung.version,
          zeitpunkt: lagerAenderung.zeitpunkt,
        })
        .from(lagerAenderung)
        .where(
          and(
            eq(lagerAenderung.lagerId, zugriff.lager.id),
            gt(lagerAenderung.seq, seit),
            lte(lagerAenderung.seq, seq),
          ),
        )
        .orderBy(asc(lagerAenderung.seq))
        .limit(limit + 1);
      const weitere = zeilen.length > limit;
      const seite = weitere ? zeilen.slice(0, limit) : zeilen;

      // Pro Tabelle einmal fragen, welche IDs die Person lesen darf. Gelöschte Zeilen gibt es nicht mehr (#427): Der Zeilenfilter kann sie nicht beurteilen und bekommt sie nicht; ihr Eintrag «geloescht» (nur Tabelle, ID, Version) geht an jeden mit dem Leserecht der Tabelle, damit die App die Zeile entfernt. Preis: Wer die Tabelle lesen darf, erfährt, dass eine Zeile verschwand, die er nie sah; eine unbekannte ID verrät nichts
      const lesbar = new Map<string, Set<string> | "alle">();
      for (const tabelle of new Set(seite.map((z) => z.tabelle))) {
        const eintrag = holeLagerTabelle(tabelle);
        if (!eintrag) continue;
        if (!darfTabelleLesen(zugriff, eintrag.recht)) continue;
        const ids = seite
          .filter((z) => z.tabelle === tabelle && z.art !== "geloescht")
          .map((z) => z.zeileId);
        lesbar.set(
          tabelle,
          eintrag.sichtbar
            ? ids.length > 0
              ? await eintrag.sichtbar(db, zugriff, ids)
              : new Set<string>()
            : "alle",
        );
      }

      return c.json({
        eintraege: seite
          .filter((z) => {
            const ids = lesbar.get(z.tabelle);
            if (ids === undefined) return false;
            return (
              z.art === "geloescht" || ids === "alle" || ids.has(z.zeileId)
            );
          })
          .map((z) => ({
            seq: z.seq,
            objekttyp: z.tabelle,
            id: z.zeileId,
            art: z.art,
            version: z.version,
            zeitpunkt: z.zeitpunkt,
          })),
        // Von hier fragt die App weiter; auch wenn der Filter alle Einträge der Seite entfernt hat, rückt der Stand vor
        bis: weitere ? seite[seite.length - 1]!.seq : seq,
        weitere,
      });
    },
  );
}

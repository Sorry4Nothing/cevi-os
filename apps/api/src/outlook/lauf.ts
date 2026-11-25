import { and, asc, eq, isNull, lt, lte, sql as roh } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { outlookAenderung, outlookVerbindung } from "../db/schema.js";
import { log } from "../log.js";
import type { OutlookDienst } from "./dienst.js";
import { ausfallVon, fehlerCodeVon, OutlookFehler } from "./fehler.js";
import { gleicheKategorienAb } from "./kategorien-abgleich.js";
import {
  SCHUTZ_STUNDEN,
  versucheSchreiben,
  wartezeitMs,
} from "./termin-tags.js";

// Der Lauf im Hintergrund (#835): holt nach, was nicht gleich nach Outlook ging (Kategorienliste, Kategorien einzelner Termine), mit Backoff je Eintrag. Ein Ausfall des Zugangs bricht den Lauf ab, statt jeden Eintrag einzeln gegen die Wand laufen zu lassen. Ohne verbundene Abteilung tut er nichts.
const JE_LAUF = 50;

export async function verarbeiteOutlook(
  db: Db,
  dienst: OutlookDienst,
  jetzt = new Date(),
) {
  const verbindungen = await db
    .select()
    .from(outlookVerbindung)
    .where(eq(outlookVerbindung.status, "aktiv"));
  for (const v of verbindungen) {
    const client = await dienst.fuer(v.abteilungId);
    if (!client) continue;
    let ausgefallen = false;

    if (v.kategorienOffen && v.naechsterVersuch <= jetzt) {
      try {
        await gleicheKategorienAb(db, client, v.abteilungId, v.akteurId);
        // Nur, wenn niemand während des Laufs eine neue Änderung gemeldet hat (sie setzt naechster_versuch später)
        await db
          .update(outlookVerbindung)
          .set({ kategorienOffen: false, versuche: 0, letzterFehler: null })
          .where(
            and(
              eq(outlookVerbindung.abteilungId, v.abteilungId),
              lte(outlookVerbindung.naechsterVersuch, jetzt),
            ),
          );
      } catch (fehler) {
        const code = fehlerCodeVon(fehler);
        const versuche = v.versuche + 1;
        await db
          .update(outlookVerbindung)
          .set({
            versuche,
            letzterFehler: code,
            naechsterVersuch: new Date(
              jetzt.getTime() +
                wartezeitMs(
                  versuche,
                  fehler instanceof OutlookFehler
                    ? fehler.wartenSek
                    : undefined,
                ),
            ),
          })
          .where(eq(outlookVerbindung.abteilungId, v.abteilungId));
        log(undefined, {
          ereignis: "outlook",
          art: "kategorien",
          abteilungId: v.abteilungId,
          code,
        });
        ausgefallen = ausfallVon(fehler);
      }
    }

    if (!ausgefallen) {
      const offene = await db
        .select({ programmId: outlookAenderung.programmId })
        .from(outlookAenderung)
        .where(
          and(
            eq(outlookAenderung.abteilungId, v.abteilungId),
            isNull(outlookAenderung.geschriebenAm),
            lte(outlookAenderung.naechsterVersuch, jetzt),
          ),
        )
        .orderBy(asc(outlookAenderung.geaendertAm))
        .limit(JE_LAUF);
      for (const o of offene) {
        // Der Ausgang steht schon in der Zeile; hier nur, ob es sich lohnt weiterzumachen
        const fehler = await versucheSchreiben(db, client, o.programmId, jetzt);
        if (fehler) {
          log(undefined, {
            ereignis: "outlook",
            art: "termin",
            abteilungId: v.abteilungId,
            code: fehler.code,
          });
          if (ausfallVon(fehler)) break;
        }
      }
    }
  }
  // Aufräumen: Nach 24 Stunden endet der Schutz jeder Änderung, ob geschrieben (der Feed hat es nie bestätigt) oder nie gelungen; dann gewinnt Outlook beim Lesen
  await db
    .delete(outlookAenderung)
    .where(
      lt(
        outlookAenderung.geaendertAm,
        roh`${jetzt.toISOString()}::timestamptz - make_interval(hours => ${SCHUTZ_STUNDEN})`,
      ),
    );
}

// Alle 60 Sekunden; ein Lauf, der noch arbeitet, wird nicht überholt. Fehler stören den Server nicht
export function starteOutlookLauf(lauf: () => Promise<unknown>) {
  let laeuft = false;
  return setInterval(() => {
    if (laeuft) return;
    laeuft = true;
    lauf()
      .catch((fehler) =>
        log(undefined, {
          ereignis: "outlook",
          art: "lauf",
          code: fehlerCodeVon(fehler),
        }),
      )
      .finally(() => {
        laeuft = false;
      });
  }, 60_000);
}

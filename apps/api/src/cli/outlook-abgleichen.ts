import { and, eq } from "drizzle-orm";
import { outlookVerbindung } from "../db/schema.js";
import { erstelleOutlookDienst } from "../outlook/dienst.js";
import { fehlerCodeVon } from "../outlook/fehler.js";
import { gleicheKategorienAb } from "../outlook/kategorien-abgleich.js";
import {
  erstelleDb,
  leseUmgebung,
  verbindeDatenbank,
  waehleAbteilung,
} from "./outlook-gemeinsam.js";

// Legt die vorhandenen Tags (Stufen, Funktionen, Teams, Lager) als Kategorien in der Liste des Postfachs an (#835), einmalig nach dem Verbinden und beliebig oft wiederholbar (idempotent):
//   npm run kalender:outlook-abgleichen -w apps/api [-- --abteilung <id>]
// Gelöscht wird nur, was Cevi OS selbst angelegt hat und was keinen Tag mehr hat. Die Ausgabe nennt nur Zahlen.
let sql: ReturnType<typeof verbindeDatenbank> | undefined;
try {
  const { url, optionen } = leseUmgebung();
  sql = verbindeDatenbank(url);
  const db = erstelleDb(sql);
  const abteilungId = await waehleAbteilung(db, process.argv.slice(2));
  const client = await erstelleOutlookDienst(db, optionen).fuer(abteilungId);
  if (!client) {
    throw new Error(
      "Nicht verbunden oder abgelaufen: erst «npm run kalender:outlook-verbinden»",
    );
  }
  const e = await gleicheKategorienAb(db, client, abteilungId, "cli");
  await db
    .update(outlookVerbindung)
    .set({ kategorienOffen: false, versuche: 0, letzterFehler: null })
    .where(and(eq(outlookVerbindung.abteilungId, abteilungId)));
  console.log(
    `Angelegt: ${e.angelegt}, entfernt: ${e.entfernt}, übersprungen (Name unzulässig): ${e.uebersprungen}`,
  );
} catch (fehler) {
  console.error(
    `Abgleich fehlgeschlagen: ${fehler instanceof Error && /^(Nicht verbunden|Mehrere|Fehlende)/.test(fehler.message) ? fehler.message : fehlerCodeVon(fehler)}`,
  );
  process.exitCode = 1;
} finally {
  await sql?.end({ timeout: 5 });
}

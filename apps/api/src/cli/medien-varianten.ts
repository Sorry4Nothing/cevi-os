import { ergaenzeVarianten } from "../medien-flickr.js";
import { verbindeMedien } from "./medien-gemeinsam.js";

// Erzeugt die Varianten (srcset, #868) für Medienbilder, die noch keine haben, in allen Abteilungen. Einmal nach dem Update, beliebig oft wiederholbar. Im Container:
//   node --import tsx src/cli/medien-varianten.ts
// Die Website übernimmt die Varianten beim nächsten Abgleich (spätestens nach 10 Minuten). Die Ausgabe nennt nur Zahlen.
let verbindung: ReturnType<typeof verbindeMedien> | undefined;
try {
  verbindung = verbindeMedien();
  const e = await ergaenzeVarianten(verbindung);
  console.log(`Varianten ergänzt: ${e.ergaenzt}, fehlgeschlagen: ${e.fehler}`);
  if (e.fehler > 0) process.exitCode = 1;
} catch (fehler) {
  console.error(
    `Varianten fehlgeschlagen: ${fehler instanceof Error && /^(Ohne|Fehlende)/.test(fehler.message) ? fehler.message : "Fehler beim Lesen oder Schreiben"}`,
  );
  process.exitCode = 1;
} finally {
  await verbindung?.sql.end({ timeout: 5 });
}

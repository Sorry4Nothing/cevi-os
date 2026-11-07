import { writeFile } from "node:fs/promises";
import { holeKalender } from "./abruf.js";

// Zeichnet den iCal-Text des Testkalenders auf; anonymisiert wird von Hand, und der E-Mail-Test in test/kalender/aufzeichnungen.test.ts wacht darüber
const pfad = process.argv[2];
const adresse = process.env.TESTKALENDER_URL;

if (!pfad || !adresse) {
  console.error(
    !adresse
      ? "Fehlende Umgebungsvariable: TESTKALENDER_URL"
      : "Aufruf: npm run kalender:aufzeichnen -w apps/api -- <zieldatei>",
  );
  process.exit(1);
}

await writeFile(pfad, await holeKalender(adresse));
console.log(`Kalender geschrieben: ${pfad}`);

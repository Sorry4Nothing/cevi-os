import { writeFile } from "node:fs/promises";
import { holeSeiten, holeToken } from "./google.js";

// Zeichnet die rohen Seiten eines Laufs aus dem Testkalender auf; anonymisiert wird von Hand, und der E-Mail-Test in test/kalender/aufzeichnungen.test.ts wacht darüber
const pfad = process.argv[2];
const schluesselDatei = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const kalenderId = process.env.TESTKALENDER_ID;

if (!pfad || !schluesselDatei || !kalenderId) {
  const fehlend = [
    !schluesselDatei && "GOOGLE_APPLICATION_CREDENTIALS",
    !kalenderId && "TESTKALENDER_ID",
  ].filter((name) => name !== false);
  console.error(
    fehlend.length > 0
      ? `Fehlende Umgebungsvariablen: ${fehlend.join(", ")}`
      : "Aufruf: npm run kalender:aufzeichnen -w apps/api -- <zieldatei>",
  );
  process.exit(1);
}

const jetzt = new Date();
const seiten = await holeSeiten(
  await holeToken(schluesselDatei, jetzt),
  kalenderId,
  jetzt,
);
await writeFile(pfad, `${JSON.stringify(seiten, null, 2)}\n`);
console.log(`${seiten.length} Seite(n) geschrieben: ${pfad}`);

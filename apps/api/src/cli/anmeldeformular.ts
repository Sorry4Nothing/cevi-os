import { parseArgs } from "node:util";
import { verbindeDatenbank } from "../datenbank.js";
import { erstelleDb } from "../db/client.js";
import {
  AnmeldeFehler,
  setzeAnmeldeformular,
  waehleAbteilungMitSeite,
  zerlegePfad,
} from "../website/anmeldeformular.js";

// Stellt eine Seite auf das Anmeldeformular um (#881): Der Abschnitt «So meldest du dich an» (Text und Knopf «per E-Mail») wird durch das Formular ersetzt. Im Container des Servers:
//   node --import tsx src/cli/anmeldeformular.ts --pfad /mitmachen/anmeldung [--veroeffentlichen] [--anhaengen] [--abteilung <id>]
// Ohne --veroeffentlichen landet das Formular im Entwurf; die Verwaltung zeigt ihn zum Prüfen. Ein zweiter Lauf legt nichts doppelt an. Die Website zeigt eine neue Version nach dem nächsten Abgleich (höchstens 10 Minuten).
const VERWENDUNG =
  "Verwendung: node --import tsx src/cli/anmeldeformular.ts --pfad /mitmachen/anmeldung [--veroeffentlichen] [--anhaengen] [--abteilung <id>]";

// Die Meldung eines parseArgs-Fehlers nie ausgeben: Sie wiederholt die Eingabe
function leseArgumente() {
  try {
    const { values } = parseArgs({
      options: {
        pfad: { type: "string" },
        veroeffentlichen: { type: "boolean", default: false },
        anhaengen: { type: "boolean", default: false },
        abteilung: { type: "string" },
      },
      strict: true,
    });
    return values.pfad ? { ...values, pfad: values.pfad } : null;
  } catch {
    return null;
  }
}

const argumente = leseArgumente();
if (!argumente) {
  console.error(VERWENDUNG);
  process.exitCode = 1;
} else {
  const url = process.env.DATABASE_URL;
  // Nur der Name: Die URL kann ein Passwort enthalten
  if (!url) throw new Error("Fehlende Umgebungsvariable: DATABASE_URL");
  const verbindung = verbindeDatenbank(url);
  try {
    const db = erstelleDb(verbindung);
    const teile = zerlegePfad(argumente.pfad);
    const abteilungId = await waehleAbteilungMitSeite(
      db,
      teile,
      argumente.abteilung,
    );
    const e = await setzeAnmeldeformular(db, {
      abteilungId,
      teile,
      veroeffentlichen: argumente.veroeffentlichen,
      anhaengen: argumente.anhaengen,
    });
    const pfad = `/${teile.join("/")}`;
    console.log(
      e.art === "ersetzt"
        ? `Formular auf ${pfad} eingesetzt${e.entfernt.length > 0 ? `, ersetzt: ${e.entfernt.join(", ")}` : " (am Ende angehängt)"}.`
        : `${pfad} hat schon ein Formular. Nichts neu angelegt.`,
    );
    console.log(
      e.veroeffentlicht !== null
        ? `Veröffentlicht als Version ${e.veroeffentlicht}. Die Website zeigt sie nach dem nächsten Abgleich (höchstens 10 Minuten).`
        : argumente.veroeffentlichen
          ? "Schon veröffentlicht."
          : "Im Entwurf. Prüfe ihn in der Verwaltung und veröffentliche ihn dort, oder starte den Befehl mit --veroeffentlichen.",
    );
  } catch (fehler) {
    // Nur eigene Meldungen; sonst der Name des Fehlers, nie eine Meldung mit Daten
    console.error(
      fehler instanceof AnmeldeFehler
        ? fehler.message
        : `Abgebrochen: ${fehler instanceof Error ? fehler.name : typeof fehler}`,
    );
    process.exitCode = 1;
  } finally {
    await verbindung.end({ timeout: 5 });
  }
}

import { starteGeraetecode } from "../outlook/anmeldung.js";
import { speichereVerbindung } from "../outlook/dienst.js";
import { fehlerCodeVon } from "../outlook/fehler.js";
import {
  erstelleDb,
  leseUmgebung,
  verbindeDatenbank,
  waehleAbteilung,
} from "./outlook-gemeinsam.js";

// Verbindet Cevi OS einmalig mit dem Outlook-Kalender (#835, Gerätecode-Fluss):
//   npm run kalender:outlook-verbinden -w apps/api [-- --abteilung <id>]
// Der Befehl zeigt eine Adresse und einen Code. Im Browser dort den Code eingeben und mit dem Konto anmelden, dessen Kalender Cevi OS führen soll; die Zustimmung zu den drei Berechtigungen bestätigen. Das Refresh-Token landet verschlüsselt in der Datenbank, nie in der Ausgabe.
let sql: ReturnType<typeof verbindeDatenbank> | undefined;
try {
  const { url, optionen } = leseUmgebung();
  sql = verbindeDatenbank(url);
  const db = erstelleDb(sql);
  const abteilungId = await waehleAbteilung(db, process.argv.slice(2));
  const geraet = await starteGeraetecode(optionen);
  console.log(
    `Öffne ${geraet.adresse} und gib diesen Code ein: ${geraet.code}`,
  );
  console.log(
    `Der Code gilt ${Math.floor(geraet.gueltigSek / 60)} Minuten. Ich warte.`,
  );
  const refreshToken = await geraet.warteAufFreigabe();
  await speichereVerbindung(db, abteilungId, refreshToken);
  console.log(
    "Verbunden. Setze OUTLOOK_GRAPH=true in der Umgebung und starte die API neu; die Kategorienliste wird dann nachgeführt.",
  );
} catch (fehler) {
  // Nie die Ursache ausgeben: Sie kann Antworten von Microsoft enthalten
  console.error(
    `Verbinden fehlgeschlagen: ${fehler instanceof Error && fehler.message.startsWith("Fehlende") ? fehler.message : fehlerCodeVon(fehler)}`,
  );
  process.exitCode = 1;
} finally {
  await sql?.end({ timeout: 5 });
}

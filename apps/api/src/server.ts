import { readdirSync, readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { erstelleApp } from "./app.js";
import { erstelleAuth } from "./auth.js";
import { erstelleSchalterZustand } from "./bereichsschalter.js";
import {
  kodiereMedienbild,
  kodiereProfilbild,
  kodiereStufenlogo,
} from "./bild-sharp.js";
import { verbindeDatenbank } from "./datenbank.js";
import { erstelleDb } from "./db/client.js";
import * as schema from "./db/schema.js";
import { erstelleFcm } from "./fcm.js";
import { starteKalenderSync, synchronisiere } from "./kalender/sync.js";
import { loescheGeleseneBenachrichtigungen } from "./lager/benachrichtigung.js";
import { raeumeDateienOhneVerweisAuf } from "./lager/datei-verweise.js";
import { loescheAlteTeilnehmende } from "./lager/teilnehmer.js";
import { loescheAlteAnmeldungen } from "./termine/anlass-anmeldungen.js";
import { ladeKonfiguration } from "./konfiguration.js";
import { loescheWiderrufene } from "./termine/ical-token.js";
import {
  raeumeAenderungenAuf,
  starteAenderungenAufraeumen,
} from "./lager/aufraeumen.js";
import { log } from "./log.js";
import { erstelleMedienspeicher } from "./medien-speicher-sdk.js";
import { ladeSeiten } from "./seiten.js";
import {
  loescheAbgelaufeneSitzungen,
  starteSitzungenAufraeumen,
} from "./sitzungen-aufraeumen.js";
import {
  starteWebsiteAbgleich,
  synchronisiereWebsite,
} from "./website/abgleich.js";
import { ladeStufenfakten } from "./website/stufenfakten.js";
import { dateisystemAusgabe } from "./website/ausgabe.js";
import {
  pruefeZeitregeln,
  starteZeitregelPruefer,
} from "./zeitregeln/pruefer.js";

// Ohne gültige Konfiguration endet der Prozess hier mit Status 1
const konfiguration = ladeKonfiguration(process.env);
// Einmal beim Start; eine fehlende Seite beendet den Prozess wie eine fehlende Variable
const seiten = ladeSeiten({
  stelle: konfiguration.VERANTWORTLICHE_STELLE,
  email: konfiguration.KONTAKT_EMAIL,
});
// Ohne Schlüsseldatei startet die API und sendet keine Pushes
const fcm = konfiguration.FCM_SCHLUESSEL_DATEI
  ? erstelleFcm(konfiguration.FCM_SCHLUESSEL_DATEI)
  : undefined;
if (!fcm) log(undefined, { ereignis: "push", code: "ohne-schluessel" });
// Ohne die fünf Variablen startet die API ohne Medien; die Konfiguration prüft, dass alle oder keine gesetzt sind
const medienspeicher =
  konfiguration.MEDIEN_S3_ENDPOINT &&
  konfiguration.MEDIEN_S3_REGION &&
  konfiguration.MEDIEN_S3_BUCKET &&
  konfiguration.MEDIEN_S3_ZUGANGSSCHLUESSEL &&
  konfiguration.MEDIEN_S3_GEHEIMSCHLUESSEL
    ? erstelleMedienspeicher({
        endpunkt: konfiguration.MEDIEN_S3_ENDPOINT,
        region: konfiguration.MEDIEN_S3_REGION,
        bucket: konfiguration.MEDIEN_S3_BUCKET,
        zugangsschluessel: konfiguration.MEDIEN_S3_ZUGANGSSCHLUESSEL,
        geheimschluessel: konfiguration.MEDIEN_S3_GEHEIMSCHLUESSEL,
        pfadstil: konfiguration.MEDIEN_S3_PFADSTIL === "true",
      })
    : undefined;
if (!medienspeicher)
  log(undefined, { ereignis: "medien", code: "ohne-speicher" });
const sql = verbindeDatenbank(konfiguration.DATABASE_URL);
const db = erstelleDb(sql);
const auth = erstelleAuth(
  drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
);
// Wartungsmodus und Sperre (#424): einmal aus der Datenbank geladen, danach nur im Speicher. Ohne diesen Stand startet die API nicht, damit eine Sperre nie durch einen Neustart verschwindet
const schalter = erstelleSchalterZustand();
await schalter.lade(db);
// Derselbe Lauf für den Takt im Hintergrund und den Knopf in der Verwaltung
const kalenderLauf = () =>
  synchronisiere({
    datenbankUrl: konfiguration.DATABASE_URL,
  });
const app = erstelleApp({
  appMinVersion: konfiguration.APP_MIN_VERSION,
  sql,
  db,
  auth,
  fcm,
  kodiereBild: kodiereProfilbild,
  kodiereLogo: kodiereStufenlogo,
  kodiereMedienbild,
  medienspeicher,
  seiten,
  schalter,
  syncs: {
    kalender: kalenderLauf,
  },
});
// Ohne hostname auf allen Schnittstellen: Der Dev-Build auf dem Handy erreicht die API im LAN; in Produktion öffnet nur Caddy Ports
serve({ fetch: app.fetch, port: konfiguration.PORT });
starteKalenderSync(kalenderLauf);
starteSitzungenAufraeumen(() => loescheAbgelaufeneSitzungen(db));
starteAenderungenAufraeumen(() => raeumeAenderungenAuf(db));
starteSitzungenAufraeumen(
  () => loescheGeleseneBenachrichtigungen(db),
  "lager_benachrichtigungen",
);
starteSitzungenAufraeumen(
  () => raeumeDateienOhneVerweisAuf(db),
  "lager_dateien",
);
// Widerrufene ICS-Token (#437) nach 30 Tagen entfernen
starteSitzungenAufraeumen(() => loescheWiderrufene(db), "kalender_token");
// Teilnehmende nach dem Ende des Lagers löschen (#384, sechs Monate)
starteSitzungenAufraeumen(
  () => loescheAlteTeilnehmende(db),
  "lager_teilnehmende",
);
// Anmeldungen zu Anlässen 180 Tage nach dem Ende des Anlasses löschen (#443)
starteSitzungenAufraeumen(
  () => loescheAlteAnmeldungen(db),
  "anlass_anmeldungen",
);
// Statische Auslieferung der Website (#351): ohne die drei Variablen (die Konfiguration prüft, dass alle oder keine gesetzt sind) läuft sie nicht
if (
  konfiguration.WEBSITE_AUSGABE_PFAD &&
  konfiguration.WEBSITE_ABTEILUNG_ID &&
  konfiguration.WEBSITE_BASIS_URL
) {
  const ausgabe = dateisystemAusgabe(konfiguration.WEBSITE_AUSGABE_PFAD);
  const stylesheet = readFileSync(
    new URL("../public/website/website.css", import.meta.url),
    "utf8",
  );
  // Die Skripte der Website (#354): alle .js-Dateien in public/website/
  const skripte = Object.fromEntries(
    readdirSync(new URL("../public/website/", import.meta.url))
      .filter((n) => n.endsWith(".js"))
      .map((n) => [
        n,
        readFileSync(
          new URL(`../public/website/${n}`, import.meta.url),
          "utf8",
        ),
      ]),
  );
  const merker = new Map<string, string>();
  const abteilungId = konfiguration.WEBSITE_ABTEILUNG_ID;
  const basisUrl = konfiguration.WEBSITE_BASIS_URL;
  starteWebsiteAbgleich(
    () =>
      synchronisiereWebsite({
        datenbankUrl: konfiguration.DATABASE_URL,
        ausgabe,
        abteilungId,
        basisUrl,
        stylesheet,
        skripte,
        datenquellen: [ladeStufenfakten],
        merker,
      }),
    abteilungId,
  );
} else {
  log(undefined, { ereignis: "website_ausgabe", art: "aus" });
}
// Ohne Schlüssel gäbe es nichts zu senden, und eine Erinnerung gälte trotzdem als gesendet
if (fcm) {
  starteZeitregelPruefer(() =>
    pruefeZeitregeln({ datenbankUrl: konfiguration.DATABASE_URL, fcm }),
  );
}

import { readdirSync, readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  erstelleAktivitaetsprotokoll,
  loescheAlteAktivitaet,
  systemzeileAus,
} from "./aktivitaet.js";
import { erstelleApp } from "./app.js";
import { erstelleCeviDbClient } from "./cevi-db/client.js";
import { erstelleCeviDbDienst } from "./cevi-db/dienst.js";
import { uebernehmeGeschlecht } from "./cevi-db/geschlecht.js";
import { speichereStand } from "./cevi-db/stand.js";
import { sucheBeiGeoAdmin } from "./ortssuche/geoadmin.js";
import { erstelleOrtssuche } from "./ortssuche/index.js";
import { erstelleAuth } from "./auth.js";
import {
  baueAppNachweis,
  beendeUngepruefteAppSitzungen,
} from "./app-nachweis/index.js";
import {
  erstelleAnmeldungGesperrt,
  erstelleSchalterZustand,
} from "./bereichsschalter.js";
import {
  kodiereMedienbild,
  kodiereZeichen,
  kodiereProfilbild,
  kodiereStufenlogo,
} from "./bild-sharp.js";
import { verbindeDatenbank } from "./datenbank.js";
import { erstelleDb } from "./db/client.js";
import * as schema from "./db/schema.js";
import { erstelleFcm } from "./fcm.js";
import { erstelleFlickr } from "./fotos/flickr.js";
import { starteKalenderSync, synchronisiere } from "./kalender/sync.js";
import { erstelleOutlookDienst } from "./outlook/dienst.js";
import { starteOutlookLauf, verarbeiteOutlook } from "./outlook/lauf.js";
import { loescheGeleseneBenachrichtigungen } from "./lager/benachrichtigung.js";
import { raeumeDateienOhneVerweisAuf } from "./lager/datei-verweise.js";
import {
  erinnereAnAufraeumen,
  loescheAlteKontakte,
} from "./lager/adressbuch.js";
import {
  sendeFristErinnerungen,
  starteFristErinnerung,
} from "./lager/fristen.js";
import { loescheAlteTeilnehmende } from "./lager/teilnehmer.js";
import { loescheAlteAnmeldungen } from "./termine/anlass-anmeldungen.js";
import { loescheAlteBuchungen } from "./termine/raum-buchung.js";
import { ladeLadenDaten, loescheAlteBestellungen } from "./laden/laden.js";
import { loescheAlteFormularAntworten } from "./formular/formular.js";
import { ladeKonfiguration } from "./konfiguration.js";
import { loescheWiderrufene } from "./termine/ical-token.js";
import {
  raeumeAenderungenAuf,
  starteAenderungenAufraeumen,
} from "./lager/aufraeumen.js";
import { log, setzeLogSenke } from "./log.js";
import { setzeRechteModus } from "./rechtemodell/modus.js";
import { erstelleMedienspeicher } from "./medien-speicher-sdk.js";
import { ladeSeiten } from "./seiten.js";
import {
  loescheAbgelaufeneSitzungen,
  starteSitzungenAufraeumen,
} from "./sitzungen-aufraeumen.js";
import {
  ladeZeichen,
  starteWebsiteAbgleich,
  synchronisiereWebsite,
} from "./website/abgleich.js";
import { ladeDynamischeBausteine } from "./website/dynamisch-daten.js";
import { ladeStufenfakten } from "./website/stufenfakten.js";
import { ladeAnlassSeiten, ladeTerminlisten } from "./website/termine-liste.js";
import { dateisystemAusgabe } from "./website/ausgabe.js";
import { erstelleWebsiteSperre, mitSperre } from "./website/sperre.js";
import {
  pruefeZeitregeln,
  starteZeitregelPruefer,
} from "./zeitregeln/pruefer.js";

// Ohne gültige Konfiguration endet der Prozess hier mit Status 1
const konfiguration = ladeKonfiguration(process.env);
// Einmal beim Start; eine fehlende Seite beendet den Prozess wie eine fehlende Variable
const seiten = ladeSeiten({
  stelle: konfiguration.VERANTWORTLICHE_STELLE,
  adresse: konfiguration.VERANTWORTLICHE_ADRESSE,
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
// Fotos aus Flickr (#690): ohne Schlüssel und Secret der App startet die API ohne Fotos; mit Token sieht sie auch die nicht öffentlichen Fotos des Kontos. Nichts davon gelangt in Log oder Antworten
const fotos = konfiguration.FLICKR_API_KEY
  ? erstelleFlickr({
      apiKey: konfiguration.FLICKR_API_KEY,
      apiSecret: konfiguration.FLICKR_API_SECRET,
      token: konfiguration.FLICKR_OAUTH_TOKEN,
      tokenSecret: konfiguration.FLICKR_OAUTH_TOKEN_SECRET,
      tokenKonto: konfiguration.FLICKR_KONTO,
      apiBasis: konfiguration.FLICKR_API_BASIS,
      bildBasis: konfiguration.FLICKR_BILD_BASIS,
    })
  : undefined;
if (!fotos) log(undefined, { ereignis: "fotos", code: "ohne-schluessel" });
const sql = verbindeDatenbank(konfiguration.DATABASE_URL);
const db = erstelleDb(sql);
// Cevi-Datenbank (#691): ohne Adresse und Token (die Konfiguration prüft, dass beide oder keines gesetzt sind) füllt die Anmeldung nichts vor
const ceviDb =
  konfiguration.CEVI_DB_URL && konfiguration.CEVI_DB_TOKEN
    ? erstelleCeviDbDienst({
        client: erstelleCeviDbClient({
          url: konfiguration.CEVI_DB_URL,
          token: konfiguration.CEVI_DB_TOKEN,
        }),
        beiAbruf: speichereStand(db),
        beiPersonen: async (abteilungId, personen) => {
          const anzahl = await uebernehmeGeschlecht(db, abteilungId, personen);
          // Nur die Zahl, nie wer
          if (anzahl > 0)
            log(undefined, {
              ereignis: "cevi_db_geschlecht_uebernommen",
              anzahl,
            });
        },
      })
    : undefined;
// Wartungsmodus und Sperre (#424, #425): einmal aus der Datenbank geladen, danach nur im Speicher. Ohne diesen Stand startet die API nicht, damit eine Sperre nie durch einen Neustart verschwindet
const schalter = erstelleSchalterZustand();
await schalter.lade(db);
// App-Nachweis (#785): ohne APP_NACHWEIS (Vorgabe «aus») erkennt die Anmeldung die App wie bisher am Origin. Im Modus «pflicht» enden die Sitzungen der App ohne Nachweis, bevor die API Anfragen annimmt
const appNachweis = baueAppNachweis(db, konfiguration);
log(undefined, {
  ereignis: "app_nachweis",
  schritt: "start",
  modus: konfiguration.APP_NACHWEIS,
  ...(konfiguration.APP_NACHWEIS === "pflicht" && {
    beendet: await beendeUngepruefteAppSitzungen(db),
  }),
});
const auth = erstelleAuth(
  drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
  // Unter einer Sperre von «alles» meldet sich nur die Abteilungsleitung oder der Entwickler an (#425)
  {
    anmeldungGesperrt: erstelleAnmeldungGesperrt({ db, zustand: schalter }),
    appNachweis,
  },
);
// Die öffentliche Website (#351): ohne die drei Variablen (die Konfiguration prüft, dass alle oder keine gesetzt sind) läuft sie nicht. Die Ausgabe gehört auch der Informationssperre (#425): Sie nimmt die Website vom Netz
const websiteAusgabe =
  konfiguration.WEBSITE_AUSGABE_PFAD &&
  konfiguration.WEBSITE_ABTEILUNG_ID &&
  konfiguration.WEBSITE_BASIS_URL
    ? dateisystemAusgabe(konfiguration.WEBSITE_AUSGABE_PFAD)
    : undefined;
const websiteSperre =
  websiteAusgabe && konfiguration.WEBSITE_ABTEILUNG_ID
    ? erstelleWebsiteSperre(
        websiteAusgabe,
        konfiguration.WEBSITE_ABTEILUNG_ID,
        seiten.zeichen.holen,
      )
    : undefined;
// Schreibanbindung an Outlook (#835): nur mit OUTLOOK_GRAPH=true (die Konfiguration verlangt dann Mandant und Client-ID); sonst liest der Server den Kalender wie bisher nur über den Feed
const outlook =
  konfiguration.OUTLOOK_GRAPH === "true" &&
  konfiguration.OUTLOOK_TENANT_ID &&
  konfiguration.OUTLOOK_CLIENT_ID
    ? erstelleOutlookDienst(db, {
        tenant: konfiguration.OUTLOOK_TENANT_ID,
        clientId: konfiguration.OUTLOOK_CLIENT_ID,
        graphBasis: konfiguration.OUTLOOK_GRAPH_BASIS,
        loginBasis: konfiguration.OUTLOOK_LOGIN_BASIS,
      })
    : undefined;
// Derselbe Lauf für den Takt im Hintergrund und den Knopf in der Verwaltung
const kalenderLauf = () =>
  synchronisiere({
    datenbankUrl: konfiguration.DATABASE_URL,
    outlook,
  });
// Aktivitätsprotokoll (#637): Ereignisse ohne Anfrage (Läufe, Versand) kommen über log() hinein; der Start steht als eigene Zeile
const aktivitaet = erstelleAktivitaetsprotokoll(db);
setzeLogSenke((felder) => systemzeileAus(aktivitaet, felder));
setzeRechteModus(konfiguration.RECHTE_MODELL ?? "schatten");
aktivitaet.system("start", { bereich: "system" });
// Beim Beenden schreibt der Prozess den Puffer zu Ende (höchstens eine Sekunde Zeilen)
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    aktivitaet.stopp();
    void aktivitaet.leere().finally(() => process.exit(0));
  });
}
const app = erstelleApp({
  aktivitaet,
  appMinVersion: konfiguration.APP_MIN_VERSION,
  sql,
  db,
  auth,
  fcm,
  ceviDb,
  outlook,
  // Adresssuche der Orte (#695): Suche des Bundes, mit Zwischenspeicher und Obergrenze
  ortssuche: erstelleOrtssuche(sucheBeiGeoAdmin),
  kodiereBild: kodiereProfilbild,
  kodiereLogo: kodiereStufenlogo,
  kodiereMedienbild,
  medienspeicher,
  fotos,
  appNachweis,
  seiten,
  schalter,
  website: websiteSperre,
  websiteKontakt: {
    adresse: konfiguration.VERANTWORTLICHE_ADRESSE,
    telefon: konfiguration.KONTAKT_TELEFON,
    email: konfiguration.KONTAKT_EMAIL,
  },
  syncs: {
    kalender: kalenderLauf,
  },
});
// Ohne hostname auf allen Schnittstellen: Der Dev-Build auf dem Handy erreicht die API im LAN; in Produktion öffnet nur Caddy Ports
serve({ fetch: app.fetch, port: konfiguration.PORT });
starteKalenderSync(kalenderLauf);
if (outlook) starteOutlookLauf(() => verarbeiteOutlook(db, outlook));
starteSitzungenAufraeumen(() => loescheAbgelaufeneSitzungen(db));
// Abgelaufene Herausforderungen und Tickets des App-Nachweises (#785)
if (appNachweis) {
  starteSitzungenAufraeumen(
    () => appNachweis.raeumeAuf(),
    "app_nachweis_aufraeumen",
  );
}
// Aktivitätsprotokoll (#637): nach der Frist (Vorgabe 90 Tage) und über der Obergrenze löschen
starteSitzungenAufraeumen(
  () =>
    loescheAlteAktivitaet(db, {
      tage: konfiguration.PROTOKOLL_TAGE ?? 90,
      maxZeilen: konfiguration.PROTOKOLL_MAX_ZEILEN ?? 500_000,
    }),
  "aktivitaet_aufraeumen",
);
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
// Adressbuch des Lagers (#397): Erinnerung an die Lagerleitung 14 Tage vorher, dann Kontakte ohne «behalten» 180 Tage nach dem Lagerende löschen
starteSitzungenAufraeumen(
  () => erinnereAnAufraeumen(db, fcm),
  "lager_adressbuch_erinnerung",
);
starteSitzungenAufraeumen(
  () => loescheAlteKontakte(db),
  "lager_adressbuch_aufraeumen",
);
// Anmeldungen zu Anlässen 180 Tage nach dem Ende des Anlasses löschen (#443)
starteSitzungenAufraeumen(
  () => loescheAlteAnmeldungen(db),
  "anlass_anmeldungen",
);
// Raumanfragen und Buchungen 180 Tage nach ihrem Ende löschen (#447)
starteSitzungenAufraeumen(() => loescheAlteBuchungen(db), "raum_buchungen");
// Bestellungen des Lädelis 180 Tage nach dem Abschluss löschen, nie abgeschlossene nach einem Jahr (#566)
starteSitzungenAufraeumen(
  () => loescheAlteBestellungen(db),
  "laden_bestellungen",
);
// Antworten auf Formulare der Website nach der Frist des Formulars löschen (#819)
starteSitzungenAufraeumen(
  () => loescheAlteFormularAntworten(db),
  "formular_antworten",
);
// Frist-Erinnerung des Lagers (#374): stündlicher Lauf, eine Abfrage über alle Lager; ohne Push-Schlüssel entstehen die Einträge der Glocke trotzdem
starteFristErinnerung(() => sendeFristErinnerungen(db, { fcm }));
// Statische Auslieferung der Website (#351): ohne die drei Variablen (die Konfiguration prüft, dass alle oder keine gesetzt sind) läuft sie nicht
if (
  websiteAusgabe &&
  konfiguration.WEBSITE_ABTEILUNG_ID &&
  konfiguration.WEBSITE_BASIS_URL
) {
  const ausgabe = websiteAusgabe;
  const stylesheet = readFileSync(
    new URL("../public/website/website.css", import.meta.url),
    "utf8",
  );
  // Die Dateien neben website.css (#354, #530): alle .js, das Zeichen für fehlende Bilder (.svg), die weiteren Stylesheets (website.css geht als «stylesheet» mit), die Schrift (Bytes) und ihre Lizenz
  const textEndung = /\.(js|css|txt|svg)$/;
  const skripte = Object.fromEntries(
    readdirSync(new URL("../public/website/", import.meta.url))
      .filter(
        (n) =>
          (textEndung.test(n) || n.endsWith(".woff2")) && n !== "website.css",
      )
      .map((n) => {
        const datei = new URL(`../public/website/${n}`, import.meta.url);
        return [
          n,
          textEndung.test(n)
            ? readFileSync(datei, "utf8")
            : readFileSync(datei),
        ];
      }),
  );
  const merker = new Map<string, string>();
  // Favicon (#558): aus dem gewählten Zeichen, sonst (oder wenn es sich nicht laden lässt) aus dem Cevi-Zeichen der Plattform. Gemerkt je Medium: Der Speicher wird nur gefragt, wenn sich die Wahl ändert
  const standardZeichen = readFileSync(
    new URL("../public/admin/favicon.svg", import.meta.url),
  );
  let gemerktesZeichen:
    | { id: string | null; dateien: Awaited<ReturnType<typeof kodiereZeichen>> }
    | undefined;
  const zeichen = async (
    quelle: { id: string; speicherSchluessel: string } | null,
  ) => {
    const id = medienspeicher && quelle ? quelle.id : null;
    if (gemerktesZeichen?.id === id) return gemerktesZeichen.dateien;
    let dateien: Awaited<ReturnType<typeof kodiereZeichen>>;
    try {
      dateien = await kodiereZeichen(
        id && quelle && medienspeicher
          ? await medienspeicher.holen(quelle.speicherSchluessel)
          : standardZeichen,
      );
    } catch {
      // Nicht gemerkt: Der nächste Lauf versucht es wieder
      log(undefined, { ereignis: "website_zeichen", code: "nicht-lesbar" });
      dateien = await kodiereZeichen(standardZeichen);
      seiten.zeichen.setze(dateien);
      return dateien;
    }
    gemerktesZeichen = { id, dateien };
    // Dasselbe Zeichen zeigen die Verwaltung und die Plattformseiten (#581)
    seiten.zeichen.setze(dateien);
    return dateien;
  };
  const abteilungId = konfiguration.WEBSITE_ABTEILUNG_ID;
  const basisUrl = konfiguration.WEBSITE_BASIS_URL;
  // Gleich beim Start, auch unter einer Sperre (dann läuft der Abgleich nicht): Die Verwaltung zeigt von Anfang an das Zeichen der Abteilung
  void ladeZeichen(db, abteilungId)
    .then(zeichen)
    .catch(() =>
      log(undefined, { ereignis: "website_zeichen", code: "start-fehler" }),
    );
  starteWebsiteAbgleich(
    // Unter einer Sperre, die die Website vom Netz nimmt, läuft der Abgleich nicht (#425)
    mitSperre(
      () => schalter.websiteOffline(abteilungId),
      () =>
        synchronisiereWebsite({
          datenbankUrl: konfiguration.DATABASE_URL,
          ausgabe,
          abteilungId,
          basisUrl,
          stylesheet,
          skripte,
          zeichen,
          datenquellen: [
            ladeStufenfakten,
            ladeTerminlisten,
            ladeAnlassSeiten,
            ladeLadenDaten,
            ladeDynamischeBausteine,
          ],
          kontakt: {
            adresse: konfiguration.VERANTWORTLICHE_ADRESSE,
            telefon: konfiguration.KONTAKT_TELEFON,
            email: konfiguration.KONTAKT_EMAIL,
          },
          merker,
        }),
    ),
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

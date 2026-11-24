import { Hono, type Context } from "hono";
import { etag } from "hono/etag";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { routePath } from "hono/route";
import type { Sql } from "postgres";
import { erstelleAdminSeiten, type AdminDateien } from "./admin-seiten.js";
import type { BildKodierer } from "./bild.js";
import {
  erstelleSchalterPruefung,
  erstelleSperrePruefungOhnePerson,
  erstelleSchalterZustand,
  type SchalterZustand,
} from "./bereichsschalter.js";
import {
  aktivitaetMiddleware,
  type AktivitaetSenke,
  type AktivitaetVariablen,
} from "./aktivitaet-middleware.js";
import { erstelleAuthRouten, type erstelleAuth } from "./auth.js";
import type { CeviDbDienst } from "./cevi-db/dienst.js";
import { erstelleCeviDbRouten } from "./routes/cevi-db.js";
import { erstelleAdminCeviDbRouten } from "./routes/admin/cevi-db.js";
import type { Db } from "./db/client.js";
import { LagerAntwortFehler } from "./lager/sync.js";
import { log } from "./log.js";
import type { MedienKodierer } from "./medien.js";
import type { Medienspeicher } from "./medien-speicher.js";
import type { Fcm } from "./push.js";
import { erstelleMetriken } from "./metriken.js";
import {
  ZEICHEN_APPLE,
  ZEICHEN_ICO,
  type ZeichenDateien,
} from "./website/zeichen.js";
import {
  personAusSitzung,
  zweiterFaktorFehlt,
  zweiterFaktorPflicht,
} from "./rechte.js";
import { ZweiterFaktorFehlt } from "./rechtemodell/darf.js";
import { erstelleBearbeiterRouten } from "./routes/admin/bearbeiter.js";
import { erstellePlattformRollenRouten } from "./routes/admin/plattform-rollen.js";
import { erstelleRechteRouten } from "./routes/admin/rechte.js";
import { erstelleRechteMatrixRouten } from "./routes/admin/rechte-matrix.js";
import { erstelleImportRouten } from "./routes/admin/import.js";
import { erstelleKinderRouten } from "./routes/admin/kinder.js";
import { erstelleMitteilungenRouten } from "./routes/admin/mitteilungen.js";
import { erstelleProtokollRouten } from "./routes/admin/protokoll.js";
import { erstellePersonenRouten } from "./routes/admin/personen.js";
import { erstelleAdminStufenRouten } from "./routes/admin/stufen.js";
import { erstelleSystemRouten } from "./routes/admin/system.js";
import { erstelleUebersichtRouten } from "./routes/admin/uebersicht.js";
import { erstelleTagRouten } from "./routes/admin/tags.js";
import { erstelleAdminLagerRouten } from "./routes/admin/lager.js";
import { erstelleAdminLagerDateiRouten } from "./routes/admin/lager-dateien.js";
import { erstelleAdminLagerRechteRouten } from "./routes/admin/lager-rechte.js";
import { erstelleAdminVorlagenRouten } from "./routes/admin/vorlagen.js";
import { erstelleZeitregelRouten } from "./routes/admin/zeitregeln.js";
import { erstellePlattformRouten } from "./routes/plattform.js";
import { erstelleChatRouten } from "./routes/chats.js";
import {
  erstelleMedienHandler,
  erstelleMedienRouten,
  erstelleOeffentlicheMedienRoute,
} from "./routes/medien.js";
import { erstelleEditorRouten } from "./routes/redaktion/index.js";
import { erstelleWebsiteRouten } from "./routes/website/index.js";
import { erstelleIchRouten } from "./routes/ich.js";
import type { Wetterdienst } from "./lager/wetter-openmeteo.js";
import type { OrtssucheHolen } from "./ortssuche/index.js";
import { erstelleLagerRouten } from "./routes/lager/index.js";
import { erstelleIcalRoute } from "./routes/termine/ical.js";
import { erstelleLadenRouten } from "./routes/laden/index.js";
import { erstelleFotoRouten } from "./routes/fotos/index.js";
import type { FotoQuelle } from "./fotos/quelle.js";
import { erstelleTermineRouten } from "./routes/termine/index.js";
import { erstelleProfilbildRouten } from "./routes/profilbild.js";
import { erstelleStufenlogoRouten } from "./routes/stufenlogo.js";
import { erstelleProgrammRouten } from "./routes/programme.js";
import { erstellePushTokenRouten } from "./routes/push-token.js";
import { erstelleStufenRouten } from "./routes/stufen.js";
import { MAX_ENTWURF_BYTES } from "./website/dokument.js";

// Ein Format für alle Fehler, wie bei better-auth, damit die App nur eines kennen muss
const FEHLER: Record<number, { code: string; message: string }> = {
  400: { code: "UNGUELTIGE_EINGABE", message: "Ungültige Eingabe" },
  401: { code: "NICHT_ANGEMELDET", message: "Nicht angemeldet" },
  403: { code: "KEINE_BERECHTIGUNG", message: "Keine Berechtigung" },
  404: { code: "NICHT_GEFUNDEN", message: "Nicht gefunden" },
  413: { code: "ZU_GROSS", message: "Anfrage zu gross" },
  429: { code: "ZU_VIELE_ANFRAGEN", message: "Zu viele Anfragen" },
  426: { code: "APP_VERALTET", message: "Bitte App aktualisieren" },
  500: { code: "INTERNER_FEHLER", message: "Interner Fehler" },
};

// An jeder Antwort (#220); die Verwaltung setzt eine volle CSP selbst, die behält sie
const SICHERHEITS_KOPFZEILEN = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

// Lesende Methoden ändern nichts; der Origin zählt nur bei den übrigen (#221)
const LESEND = new Set(["GET", "HEAD", "OPTIONS"]);

// Das Favicon ändert sich mit der Wahl der Abteilung: Browser fragen mit dem ETag nach, statt es zu behalten
const zeichenAntwort = (c: Context, daten: Uint8Array, typ: string) =>
  c.body(daten as Uint8Array<ArrayBuffer>, 200, {
    "Content-Type": typ,
    "Cache-Control": "no-cache",
  });

// Drei Zahlen statt semver: Die App schickt ihre Version als x.y.z
function istVeraltet(version: string, minimum: string) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return true;
  const [a, b] = [version, minimum].map((v) => v.split(".").map(Number));
  const i = a.findIndex((zahl, j) => zahl !== b[j]);
  return i !== -1 && a[i] < b[i];
}

// Auch in den Importen ohne node:* und process: Die App prüft diese Datei über AppType ohne die Typen von Node, die Konfiguration kommt als Parameter
export function erstelleApp({
  appMinVersion,
  sql,
  db,
  auth,
  fcm,
  ceviDb,
  wetter,
  ortssuche,
  jetzt,
  kodiereBild,
  kodiereLogo,
  kodiereMedienbild,
  medienspeicher,
  seiten,
  syncs,
  schalter = erstelleSchalterZustand(),
  website,
  websiteKontakt,
  aktivitaet,
  fotos,
}: {
  appMinVersion: string;
  sql: Sql;
  db: Db;
  auth: ReturnType<typeof erstelleAuth>;
  fcm?: Fcm;
  // Cevi-Datenbank (#691): Abruf der Personen der eigenen Ebene mit Zwischenspeicher; ohne Angabe ist die Funktion aus (die Anmeldung füllt nichts vor), die Tests spritzen einen Dienst mit einer Attrappe ein
  ceviDb?: CeviDbDienst;
  // Abruf der Wettervorhersage für das Lager (#391); ohne Angabe holt der Server sie bei Open-Meteo, die Tests spritzen eine Attrappe ein
  wetter?: Wetterdienst;
  // Adresssuche der Orte (#695); ohne Angabe antwortet die Suche mit 503, server.ts setzt die Suche des Bundes ein, die Tests eine Attrappe
  ortssuche?: OrtssucheHolen;
  // Uhr der Lager-Aggregate (#395); ohne Angabe die Systemzeit
  jetzt?: () => Date;
  // sharp steckt in bild-sharp.ts: Schon ein Import zöge dessen Typen von Node in dieses Programm; ohne Kodierer antwortet der Upload mit 501
  kodiereBild?: BildKodierer;
  kodiereLogo?: BildKodierer;
  // Medien (#335): ohne Speicher oder Kodierer antworten die Routen mit 501
  kodiereMedienbild?: MedienKodierer;
  medienspeicher?: Medienspeicher;
  // Die Abrufe im Hintergrund, von Hand anzustossen; ohne sie antwortet die Verwaltung mit 501
  syncs?: {
    kalender?: () => Promise<"fertig" | "gesperrt">;
  };
  // Wartungsmodus und Sperre (#424, #425): der Zustand im Speicher, beim Start aus der Datenbank geladen (server.ts); ohne Angabe ist nichts geschaltet
  schalter?: SchalterZustand;
  // Die Ausgabe der öffentlichen Website, die die Informationssperre vom Netz nimmt (#425); ausgeschrieben, ein Typ-Import aus website/sperre.ts zöge node:fs in dieses Programm
  website?: {
    abteilungId: string;
    nimmVomNetz: () => Promise<void>;
    gibFrei: () => Promise<void>;
  };
  // Aktivitätsprotokoll (#637): nimmt jede schreibende Anfrage entgegen; ohne Angabe (Tests, Werkzeuge) wird nichts erfasst. Die Route des Protokolls liest die Tabelle ohnehin
  aktivitaet?: AktivitaetSenke;
  // Quelle der Fotos (#690), heute Flickr (fotos/flickr.ts); ohne sie antworten die Foto-Routen mit «nicht eingerichtet». Die Tests spritzen eine Attrappe ein
  fotos?: FotoQuelle;
  // Adresse, Telefon und E-Mail der Abteilung für die Vorschau im Editor (#570); der Abgleich bekommt dieselben Werte in server.ts
  websiteKontakt?: { adresse?: string; telefon?: string; email?: string };
  // Ausgeschrieben statt aus seiten.ts importiert: Schon ein Typ-Import zöge node:fs in dieses Programm
  seiten: {
    admin: AdminDateien;
    // Favicon der Abteilung für /favicon.ico und /apple-touch-icon.png (#581)
    zeichen: { holen: () => Promise<ZeichenDateien> };
    datenschutz: string;
    kontoLoeschen: string;
    support: string;
  };
}) {
  // Zahlen der laufenden Instanz; nach einem Neustart leer
  const metriken = erstelleMetriken();
  const kleinesLimit = bodyLimit({ maxSize: 64 * 1024 });
  // 500 Zeilen mit langen Namen passen nicht in 64 KB
  const importLimit = bodyLimit({ maxSize: 256 * 1024 });
  // Abteilungsleitung und die Verwaltung der Website teilen die Handler und damit das Limit für Uploads je Person
  const medienHandler = erstelleMedienHandler({
    db,
    speicher: medienspeicher,
    kodiereMedienbild,
  });
  // Das Dokument einer Seite (#350)
  const entwurfLimit = bodyLimit({ maxSize: MAX_ENTWURF_BYTES });
  // Bis zu 100 Operationen der Offline-Warteschlange des Lagers (#367)
  const warteschlangeLimit = bodyLimit({ maxSize: 256 * 1024 });
  const fotoRouten = erstelleFotoRouten({ db, quelle: fotos });
  const protokollieren = aktivitaet
    ? aktivitaetMiddleware(aktivitaet)
    : undefined;
  return (
    // nutzerId setzt personAusSitzung, sobald es die Sitzung gelesen hat
    new Hono<{ Variables: AktivitaetVariablen }>()
      // Ohne Header-Name übernimmt Hono keine ID vom Client und schickt keine zurück
      .use(requestId({ headerName: "" }))
      .use(async (c, next) => {
        await next();
        for (const [kopf, wert] of Object.entries(SICHERHEITS_KOPFZEILEN)) {
          if (!c.res.headers.has(kopf)) c.header(kopf, wert);
        }
        // Nur JSON: Bilder und Seiten behalten ihre eigenen Cache-Regeln
        if (
          !c.res.headers.has("Cache-Control") &&
          c.res.headers.get("Content-Type")?.startsWith("application/json")
        ) {
          c.header("Cache-Control", "no-store");
        }
      })
      .use(async (c, next) => {
        const start = performance.now();
        await next();
        // Das Muster der Route statt des Pfads: Pfad und Query können Tokens enthalten
        const eintrag = {
          methode: c.req.method,
          route: routePath(c, -1),
          status: c.res.status,
          dauerMs: Math.round(performance.now() - start),
        };
        // Der Healthcheck von Docker fragt alle 30 s; ein Erfolg füllt weder Log noch Zahlen, ein Fehler bleibt sichtbar (die requestId verbindet ihn mit seinem Grund)
        if (eintrag.route === "/health" && eintrag.status === 200) return;
        const nutzerId = c.get("nutzerId");
        // Den Akteur nur bei 401 und 403 (#224): die ID, kein Name
        log(c, {
          ...eintrag,
          ...((eintrag.status === 401 || eintrag.status === 403) &&
            nutzerId !== undefined && { nutzerId }),
        });
        // Nicht gezählt: die statischen Dateien der Verwaltung und die Abrufe der Übersicht selbst, sonst misst sich die Übersicht ständig selbst
        if (
          !eintrag.route.startsWith("/admin") &&
          !eintrag.route.startsWith("/api/v1/admin/system")
        ) {
          metriken.erfasse(eintrag);
        }
      })
      // Aktivitätsprotokoll (#637): vor den Begrenzungen, damit auch abgewiesene Anfragen (401, 413, 429) erscheinen; die Zeile entsteht nach der Antwort
      .use((c, next) => (protokollieren ? protokollieren(c, next) : next()))
      // Ausnahmen: die Uploads von Profilbild und Stufenlogo, die ihre Routen selbst auf 5 MB begrenzen, der Upload der Medien (20 MB, die Route begrenzt selbst) und der Import mit 256 KB, das Dokument einer Seite mit 512 KiB und die Warteschlange des Lagers mit 256 KB
      .use((c, next) =>
        (c.req.method === "PUT" &&
          (c.req.path === "/api/v1/ich/bild" ||
            /^\/api\/v1\/admin\/stufen\/[^/]+\/logo$/.test(c.req.path))) ||
        (c.req.method === "POST" &&
          (c.req.path === "/api/v1/admin/medien" ||
            c.req.path === "/api/v1/redaktion/medien"))
          ? next()
          : c.req.method === "POST" &&
              /^\/api\/v1\/admin\/import(\/vorschau)?$/.test(c.req.path)
            ? importLimit(c, next)
            : c.req.method === "PUT" &&
                /^\/api\/v1\/redaktion\/seiten\/[^/]+\/entwurf$/.test(
                  c.req.path,
                )
              ? entwurfLimit(c, next)
              : c.req.method === "POST" &&
                  /^\/api\/v1\/lager\/[^/]+\/aenderungen$/.test(c.req.path)
                ? warteschlangeLimit(c, next)
                : kleinesLimit(c, next),
      )
      .use("/api/*", async (c, next) => {
        const version = c.req.header("X-App-Version");
        // Ohne Header weiter: 426 nur für eine ältere Version; den Header setzt der Client selbst, aussperren kann die Prüfung also niemanden
        if (version !== undefined && istVeraltet(version, appMinVersion)) {
          throw new HTTPException(426);
        }
        await next();
      })
      .route("/", erstelleAuthRouten(auth))
      // ICS-Feed der Termine (#438): der geheime Token im Pfad ersetzt die Sitzung, darum vor ihr und ausserhalb von /api/v1
      .route("/", erstelleIcalRoute({ db, schalter }))
      // Einen Origin sendet nur ein Browser (die Verwaltung), die App nicht; erlaubt ist dieselbe Liste, die better-auth unter /api/auth prüft: BETTER_AUTH_URL und das App-Schema. Vor der Sitzung, damit eine fremde Seite keine Abfrage auslöst
      .use("/api/v1/*", async (c, next) => {
        const herkunft = c.req.header("Origin");
        if (
          herkunft !== undefined &&
          !LESEND.has(c.req.method) &&
          !(await auth.$context).isTrustedOrigin(herkunft)
        ) {
          throw new HTTPException(403);
        }
        await next();
      })
      // Öffentliche Medien (#335) brauchen keine Sitzung, darum vor ihr; alle anderen Medien gehen weiter zur Sitzung. Eine Sperre der Website hält auch sie zurück (#425)
      .use("/api/v1/medien/*", erstelleSperrePruefungOhnePerson(schalter))
      .route(
        "/",
        erstelleOeffentlicheMedienRoute({ db, speicher: medienspeicher }),
      )
      // Unbekannte Pfade unter /api/v1 antworten ohne Sitzung 401, mit Sitzung 404
      .use("/api/v1/*", personAusSitzung(auth, db))
      // Gleich nach der Sitzung, vor jeder Route: Wartung und Sperre gelten für alles dahinter
      .use("/api/v1/*", erstelleSchalterPruefung({ db, zustand: schalter }))
      .use("/api/v1/admin/*", zweiterFaktorPflicht)
      .route(
        "/api/v1/plattform",
        erstellePlattformRouten({ db, zustand: schalter, fcm, website }),
      )
      .route("/api/v1", erstelleProfilbildRouten({ db, kodiereBild }))
      .route("/api/v1", erstelleStufenlogoRouten({ db, kodiereLogo }))
      .route(
        "/api/v1",
        erstelleMedienRouten({
          db,
          speicher: medienspeicher,
          handler: medienHandler,
        }),
      )
      .route("/api/v1/ich", erstelleIchRouten({ db }))
      // Vorschlag aus der Cevi-Datenbank für die Anmeldung (#691)
      .route("/api/v1/cevi-db", erstelleCeviDbRouten({ db, dienst: ceviDb }))
      .route("/api/v1/programme", erstelleProgrammRouten({ db, fcm }))
      .route("/api/v1/chats", erstelleChatRouten({ db, fcm }))
      .route("/api/v1/lager", erstelleLagerRouten({ db, fcm, wetter, jetzt }))
      // Termine (Epic #430): Einstieg bei /api/v1, die Module tragen den vollen Pfad (routes/termine/index.ts)
      .route("/api/v1", erstelleTermineRouten({ db, fcm, ceviDb }))
      // Lädeli (#566): Laden, Bestellungen und ihre Verwaltung
      .route("/api/v1", erstelleLadenRouten({ db }))
      // Fotos aus Flickr (#690): nur angemeldet; die Verwaltung erbt den zweiten Faktor
      .route("/api/v1/fotos", fotoRouten.oeffentlich)
      .route("/api/v1/admin/fotos", fotoRouten.verwaltung)
      .route("/api/v1/admin/personen", erstellePersonenRouten({ db, auth }))
      .route("/api/v1/admin/stufen", erstelleAdminStufenRouten({ db }))
      .route("/api/v1/admin/kinder", erstelleKinderRouten({ db, auth }))
      .route("/api/v1/admin/import", erstelleImportRouten({ db }))
      .route("/api/v1/admin/tags", erstelleTagRouten({ db }))
      .route("/api/v1/admin/lager", erstelleAdminLagerRouten({ db, wetter }))
      .route("/api/v1/admin/lager", erstelleAdminLagerRechteRouten({ db }))
      .route("/api/v1/admin/vorlagen", erstelleAdminVorlagenRouten({ db }))
      .route(
        "/api/v1/admin/lager-dateien",
        erstelleAdminLagerDateiRouten({ db }),
      )
      .route("/api/v1/admin/bearbeiter", erstelleBearbeiterRouten({ db }))
      .route("/api/v1/admin/rechte", erstelleRechteRouten({ db }))
      // Matrix-API (#643): Katalog, Gruppenrollen, globale Rollen, Vorschau, «Was darf wer?», Änderungen
      .route("/api/v1/admin/rechte", erstelleRechteMatrixRouten({ db }))
      .route(
        "/api/v1/admin/plattform/rollen",
        erstellePlattformRollenRouten({ db }),
      )
      // Namensraum der Website-Verwaltung (Seiten, Medien, Weiterleitungen, Vorlagen). Der Pfad stammt aus der Zeit vor #426 und bleibt, damit Editor und Clients nicht brechen; was jemand darf, bestimmen die Plattformrechte (plattform.ts)
      .route(
        "/api/v1/redaktion",
        erstelleEditorRouten({
          db,
          medien: medienHandler,
          kontakt: websiteKontakt,
          ortssuche,
        }),
      )
      // Geschützte Bausteine der Website nachladen (#354): hinter der Sitzung
      .route("/api/v1/website", erstelleWebsiteRouten({ db }))
      .route("/api/v1/admin/zeitregeln", erstelleZeitregelRouten({ db }))
      .route(
        "/api/v1/admin/mitteilungen",
        erstelleMitteilungenRouten({ db, fcm }),
      )
      // Aktivitätsprotokoll (#637): nur der Entwickler, die Route prüft selbst
      .route("/api/v1/admin/protokoll", erstelleProtokollRouten({ db }))
      // Verbindung zur Cevi-Datenbank prüfen, Gruppe einstellen (#691)
      .route(
        "/api/v1/admin/cevi-db",
        erstelleAdminCeviDbRouten({ db, dienst: ceviDb }),
      )
      .route(
        "/api/v1/admin/system",
        erstelleSystemRouten({ db, sql, metriken, syncs }),
      )
      // Übersicht der Verwaltung (#583): ein gebündelter Abruf, Rechte je Teil
      .route(
        "/api/v1/admin/uebersicht",
        erstelleUebersichtRouten({ db, metriken, schalter }),
      )
      .route("/api/v1/stufen", erstelleStufenRouten({ db }))
      .route("/api/v1/push-token", erstellePushTokenRouten({ db }))
      .get("/health", async (c) => {
        try {
          // 30 Minuten fest: Der Sync läuft alle 5 Minuten, ein einzelner Fehlschlag löst noch keinen Alarm aus
          const veraltet = await sql<{ id: string }[]>`
            select id from abteilung
            where google_kalender_id is not null
              and sync_ok_am < now() - interval '30 minutes'`;
          if (veraltet.length > 0) {
            log(c, {
              ereignis: "health",
              code: "SYNC_VERALTET",
              abteilungIds: veraltet.map((zeile) => zeile.id),
            });
            return c.text("fehler", 503);
          }
          return c.text("ok");
        } catch (fehler) {
          // Nur der Code: postgres-js nennt Host und Port in message, address und port
          log(c, {
            ereignis: "health",
            code: (fehler as { code?: unknown }).code,
          });
          return c.text("fehler", 503);
        }
      })
      // Seiten für die Stores, ohne Login und ausserhalb der Versionsprüfung; die Texte folgen in #63
      .get("/datenschutz", (c) => c.html(seiten.datenschutz))
      .get("/konto-loeschen", (c) => c.html(seiten.kontoLoeschen))
      .get("/support", (c) => c.html(seiten.support))
      // Favicon für Verwaltung und Plattformseiten (#581): dieselben Dateien, die der Abgleich neben die Website schreibt; im Speicher, ohne Datenbank. Mit der Website am selben Host liefert der Edge sie statisch aus
      .get("/favicon.ico", etag(), async (c) =>
        zeichenAntwort(
          c,
          (await seiten.zeichen.holen())[ZEICHEN_ICO],
          "image/x-icon",
        ),
      )
      .get("/apple-touch-icon.png", etag(), async (c) =>
        zeichenAntwort(
          c,
          (await seiten.zeichen.holen())[ZEICHEN_APPLE],
          "image/png",
        ),
      )
      // Verwaltung im Browser (#141): nur die statische Hülle, Daten kommen über /api/v1/admin/*
      .route("/admin", erstelleAdminSeiten(seiten.admin))
      // Eigene Routen statt Dateien, damit der Content-Type JSON ist; die Inhalte folgen in #24
      .get("/.well-known/apple-app-site-association", (c) => c.json({}))
      .get("/.well-known/assetlinks.json", (c) => c.json([]))
      .notFound((c) => c.json(FEHLER[404], 404))
      .onError((fehler, c) => {
        // Konfliktantwort des Lager-Sync (409 VERSION_KONFLIKT) mit dem Stand der Zeile im Body
        if (fehler instanceof LagerAntwortFehler) {
          return c.json(fehler.body, fehler.status);
        }
        // 403 mit dem Code für die App: Das Recht ist da, der zweite Faktor fehlt (#643)
        if (fehler instanceof ZweiterFaktorFehlt) {
          return c.json(
            zweiterFaktorFehlt(
              "Für dieses Recht braucht es zuerst einen zweiten Faktor.",
            ),
            403,
          );
        }
        if (fehler instanceof HTTPException) {
          return c.json(
            FEHLER[fehler.status] ?? {
              code: "FEHLER",
              message: "Anfrage fehlgeschlagen",
            },
            fehler.status,
          );
        }
        // Ohne Meldung: Sie kann Eingaben (Postgres) oder Hosts wiederholen
        log(c, {
          ereignis: "fehler",
          name: fehler.name,
          code: (fehler as { code?: unknown }).code,
          // Erst nach dem Kopf «Name: Meldung», den Node mit Error.prototype.toString bildet: Eine mehrzeilige Meldung kann Zeilen mit «at …» enthalten
          stack: fehler.stack
            ?.split("\n")
            .slice(Error.prototype.toString.call(fehler).split("\n").length)
            .filter((z) => /^\s+at /.test(z)),
        });
        return c.json(FEHLER[500], 500);
      })
  );
}

export type AppType = ReturnType<typeof erstelleApp>;

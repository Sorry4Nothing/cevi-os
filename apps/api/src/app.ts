import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { routePath } from "hono/route";
import type { Sql } from "postgres";
import { erstelleAuthRouten, type erstelleAuth } from "./auth.js";
import type { Db } from "./db/client.js";
import { log } from "./log.js";
import { personAusSitzung } from "./rechte.js";
import { erstelleAbteilungRouten } from "./routes/admin/abteilung.js";
import { erstellePersonenRouten } from "./routes/admin/personen.js";
import { erstelleChatRouten } from "./routes/chats.js";
import { erstelleHilfeRouten } from "./routes/hilfe.js";
import { erstelleIchRouten } from "./routes/ich.js";
import { erstelleProgrammRouten } from "./routes/programme.js";
import { erstellePushTokenRouten } from "./routes/push-token.js";

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
  seiten,
}: {
  appMinVersion: string;
  sql: Sql;
  db: Db;
  auth: ReturnType<typeof erstelleAuth>;
  // Ausgeschrieben statt aus seiten.ts importiert: Schon ein Typ-Import zöge node:fs in dieses Programm
  seiten: { datenschutz: string; kontoLoeschen: string; support: string };
}) {
  return (
    new Hono()
      // Ohne Header-Name übernimmt Hono keine ID vom Client und schickt keine zurück
      .use(requestId({ headerName: "" }))
      .use(async (c, next) => {
        const start = performance.now();
        await next();
        // Das Muster der Route statt des Pfads: Pfad und Query können Tokens enthalten
        log(c, {
          methode: c.req.method,
          route: routePath(c, -1),
          status: c.res.status,
          dauerMs: Math.round(performance.now() - start),
        });
      })
      .use(bodyLimit({ maxSize: 64 * 1024 }))
      .use("/api/*", async (c, next) => {
        const version = c.req.header("X-App-Version");
        // Ohne Header weiter: 426 nur für eine ältere Version; den Header setzt der Client selbst, aussperren kann die Prüfung also niemanden
        if (version !== undefined && istVeraltet(version, appMinVersion)) {
          throw new HTTPException(426);
        }
        await next();
      })
      .route("/", erstelleAuthRouten(auth))
      // Unbekannte Pfade unter /api/v1 antworten ohne Sitzung 401, mit Sitzung 404
      .use("/api/v1/*", personAusSitzung(auth, db))
      .route("/api/v1/ich", erstelleIchRouten({ db }))
      .route("/api/v1/programme", erstelleProgrammRouten({ db }))
      .route("/api/v1/chats", erstelleChatRouten({ db }))
      .route("/api/v1/hilfe", erstelleHilfeRouten({ db }))
      .route("/api/v1/admin/abteilung", erstelleAbteilungRouten({ db }))
      .route("/api/v1/admin/personen", erstellePersonenRouten({ db, auth }))
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
      // Eigene Routen statt Dateien, damit der Content-Type JSON ist; die Inhalte folgen in #24
      .get("/.well-known/apple-app-site-association", (c) => c.json({}))
      .get("/.well-known/assetlinks.json", (c) => c.json([]))
      .notFound((c) => c.json(FEHLER[404], 404))
      .onError((fehler, c) => {
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

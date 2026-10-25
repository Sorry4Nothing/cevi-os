import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { routePath } from "hono/route";
import type { Sql } from "postgres";
import { log } from "./log.js";

// Ein Format für alle Fehler, wie bei better-auth, damit die App nur eines kennen muss
const FEHLER: Record<number, { code: string; message: string }> = {
  400: { code: "UNGUELTIGE_EINGABE", message: "Ungültige Eingabe" },
  404: { code: "NICHT_GEFUNDEN", message: "Nicht gefunden" },
  413: { code: "ZU_GROSS", message: "Anfrage zu gross" },
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
}: {
  appMinVersion: string;
  sql: Sql;
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
        // Ohne Header weiter: Uptime-Dienst und Tests schicken keinen
        if (version !== undefined && istVeraltet(version, appMinVersion)) {
          throw new HTTPException(426);
        }
        await next();
      })
      .get("/health", async (c) => {
        try {
          await sql`select 1`;
          return c.text("ok");
        } catch (fehler) {
          // Nur der Code: postgres-js nennt Host und Port in message und address
          log(c, {
            ereignis: "health",
            code: (fehler as { code?: unknown }).code,
          });
          return c.text("fehler", 503);
        }
      })
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
          stack: fehler.stack?.split("\n").filter((z) => /^\s+at /.test(z)),
        });
        return c.json(FEHLER[500], 500);
      })
  );
}

export type AppType = ReturnType<typeof erstelleApp>;

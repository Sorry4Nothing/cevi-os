import { Hono } from "hono";
import { etag } from "hono/etag";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import { kopf, ladeTerminListe, listeSchema } from "./mein.js";
import type { TermineEnv } from "./index.js";

// «Alle Termine» für das Web (#436): alles, was die Person sehen darf (termine/sicht.ts, alleTermine), mit den Feldern von «Mein Kalender» plus «meine». Abfragen je Aufruf wie dort: höchstens 3, nie je Zeile.
// Für die Apps gesperrt: Anfragen mit X-App-Version bekommen 404. Der Client setzt den Header selbst, das hält also keinen Angreifer auf; es sichert den Vertrag, dass die Apps nie mehr als «Mein Kalender» abrufen. Die Antwort enthält ohnehin nichts, was die Person nicht sehen dürfte.
export function erstelleAlleRouten({ db }: { db: Db }) {
  return new Hono<TermineEnv>().get(
    "/termine/alle",
    (c, next) => {
      if (c.req.header("X-App-Version") !== undefined) {
        throw new HTTPException(404);
      }
      return next();
    },
    etag(),
    eingabe("query", listeSchema),
    async (c) => {
      kopf(c);
      return c.json(
        await ladeTerminListe(
          db,
          c.get("person"),
          c.req.valid("query"),
          "alle",
        ),
      );
    },
  );
}

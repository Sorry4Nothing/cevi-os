import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import { zweiterFaktorPflicht, type Person } from "../../rechte.js";
import { erstelleSeitenRouten } from "./seiten.js";

// Namensraum für Personen mit Bearbeitungsrecht, nicht nur für Admins. Jede Folgeroute hängt sich hier mit einer Zeile ein.
// Eine Admin-Person braucht auch hier den zweiten Faktor (sonst umginge sie ihn über diesen Weg); alle anderen passen vorbei.
// Wer hinein darf, regelt hatRedaktionszugang (website/seiten.ts), das Recht am einzelnen Objekt bearbeiten.ts.
export function erstelleRedaktionRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>()
    .use(zweiterFaktorPflicht)
    .route("/seiten", erstelleSeitenRouten({ db }));
}

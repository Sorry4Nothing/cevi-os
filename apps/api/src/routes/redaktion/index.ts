import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import { zweiterFaktorPflicht, type Person } from "../../rechte.js";
import type { MedienHandler } from "../medien.js";
import { erstelleAuswahlRouten } from "./auswahl.js";
import { erstelleRedaktionIchRouten } from "./ich.js";
import { erstelleRedaktionMedienRouten } from "./medien.js";
import { erstelleSeitenRouten } from "./seiten.js";

// Namensraum für Personen mit Bearbeitungsrecht, nicht nur für Admins. Jede Folgeroute hängt sich hier mit einer Zeile ein.
// Eine Admin-Person braucht auch hier den zweiten Faktor (sonst umginge sie ihn über diesen Weg); alle anderen passen vorbei.
// Wer hinein darf, regelt hatRedaktionszugang (website/seiten.ts), das Recht am einzelnen Objekt bearbeiten.ts.
export function erstelleRedaktionRouten({
  db,
  medien,
}: {
  db: Db;
  medien: MedienHandler;
}) {
  return new Hono<{ Variables: { person: Person } }>()
    .use(zweiterFaktorPflicht)
    .route("/ich", erstelleRedaktionIchRouten({ db }))
    .route("/seiten", erstelleSeitenRouten({ db }))
    .route("/medien", erstelleRedaktionMedienRouten({ db, handler: medien }))
    .route("/", erstelleAuswahlRouten({ db }));
}

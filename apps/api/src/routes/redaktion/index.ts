import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import {
  zweiterFaktorFehlt,
  zweiterFaktorPflicht,
  type Person,
} from "../../rechte.js";
import { hatErweitertesRecht } from "../../website/seiten.js";
import type { MedienHandler } from "../medien.js";
import { erstelleAuswahlRouten } from "./auswahl.js";
import { erstelleEckdatenRouten } from "./eckdaten.js";
import { erstelleRedaktionIchRouten } from "./ich.js";
import { erstelleRedaktionMedienRouten } from "./medien.js";
import { erstelleSeitenRouten } from "./seiten.js";
import { erstelleSeitenInhaltRouten } from "./seiten-inhalt.js";
import { erstelleVorlagenRouten } from "./vorlagen.js";
import { erstelleWeiterleitungsRouten } from "./weiterleitungen.js";

// Namensraum für Personen mit Bearbeitungsrecht, nicht nur für Admins. Jede Folgeroute hängt sich hier mit einer Zeile ein.
// Eine Admin-Person braucht auch hier den zweiten Faktor (sonst umginge sie ihn über diesen Weg). Dasselbe gilt für jede Person mit einem erweiterten Recht (#423): Plattformrolle, Zeile in «bearbeiter», Team-Verantwortung. Nur die Stufenleitung an der eigenen Stufenseite arbeitet ohne; alle anderen passen vorbei und behalten das 403 der Route.
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
    .use(async (c, next) => {
      const person = c.get("person");
      if (!person.zweiterFaktor && (await hatErweitertesRecht(db, person))) {
        return c.json(
          zweiterFaktorFehlt(
            "Für dieses Recht braucht es zuerst einen zweiten Faktor.",
          ),
          403,
        );
      }
      await next();
    })
    .route("/ich", erstelleRedaktionIchRouten({ db }))
    .route("/seiten", erstelleSeitenRouten({ db }))
    .route("/seiten", erstelleSeitenInhaltRouten({ db }))
    .route("/stufen", erstelleEckdatenRouten({ db }))
    .route("/medien", erstelleRedaktionMedienRouten({ db, handler: medien }))
    .route("/", erstelleAuswahlRouten({ db }))
    .route("/", erstelleVorlagenRouten({ db }))
    .route("/weiterleitungen", erstelleWeiterleitungsRouten({ db }));
}

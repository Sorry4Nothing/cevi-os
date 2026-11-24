import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import {
  zweiterFaktorFehlt,
  zweiterFaktorPflicht,
  type Person,
} from "../../rechte.js";
import { hatErweitertesRecht } from "../../website/seiten.js";
import type { Kontakt } from "../../website/rendern.js";
import type { MedienHandler } from "../medien.js";
import type { OrtssucheHolen } from "../../ortssuche/index.js";
import { erstelleAuswahlRouten } from "./auswahl.js";
import { erstelleEckdatenRouten } from "./eckdaten.js";
import { erstelleWebsiteEinstellungsRouten } from "./einstellungen.js";
import { erstelleEditorIchRouten } from "./ich.js";
import { erstelleEditorMedienRouten } from "./medien.js";
import { erstelleOrteRouten } from "./orte.js";
import { erstelleSeitenRouten } from "./seiten.js";
import { erstelleSeitenInhaltRouten } from "./seiten-inhalt.js";
import { erstelleVorlagenRouten } from "./vorlagen.js";
import { erstelleWeiterleitungsRouten } from "./weiterleitungen.js";

// Namensraum der Website-Verwaltung für Personen mit Bearbeitungsrecht, nicht nur für die Abteilungsleitung (der Pfadname stammt aus der Zeit vor #426). Jede Folgeroute hängt sich hier mit einer Zeile ein.
// eine Person der Abteilungsleitung-Person braucht auch hier den zweiten Faktor (sonst umginge sie ihn über diesen Weg). Dasselbe gilt für jede Person mit einem erweiterten Recht (#423): Plattformrolle (Webmaster), Zeile in «bearbeiter», Team-Verantwortung. Nur die Stufenleitung an der eigenen Stufenseite arbeitet ohne; alle anderen passen vorbei und behalten das 403 der Route.
// Wer hinein darf, regelt hatWebsiteZugang (website/seiten.ts), das Recht am einzelnen Objekt bearbeiten.ts, das an Medien, Weiterleitungen, Vorlagen und am Anlegen die Route mit hatPlattformRecht (plattform.ts).
export function erstelleEditorRouten({
  db,
  medien,
  kontakt,
  ortssuche,
}: {
  db: Db;
  medien: MedienHandler;
  // Adresssuche der Orte (#695)
  ortssuche?: OrtssucheHolen;
  // Angaben der Abteilung für die Vorschau im Editor (Kontaktkarte, Fuss)
  kontakt?: Kontakt;
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
    .route("/ich", erstelleEditorIchRouten({ db }))
    .route("/website", erstelleWebsiteEinstellungsRouten({ db }))
    .route("/seiten", erstelleSeitenRouten({ db }))
    .route("/seiten", erstelleSeitenInhaltRouten({ db, kontakt }))
    .route("/stufen", erstelleEckdatenRouten({ db }))
    .route("/orte", erstelleOrteRouten({ db, ortssuche }))
    .route("/medien", erstelleEditorMedienRouten({ db, handler: medien }))
    .route("/", erstelleAuswahlRouten({ db }))
    .route("/", erstelleVorlagenRouten({ db }))
    .route("/weiterleitungen", erstelleWeiterleitungsRouten({ db }));
}

import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import type { Person } from "../../rechte.js";
import { erstelleInhaltRoute } from "./inhalt.js";
import { erstelleKontoRoute } from "./konto.js";
import { erstelleNavigationRoute } from "./navigation.js";

// Namensraum für die Website (#354). Alle Routen laufen hinter der Sitzung (app.ts hängt ihn nach personAusSitzung ein); jede weitere hängt sich hier mit einer Zeile ein.
export function erstelleWebsiteRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>()
    .route("/", erstelleInhaltRoute({ db }))
    .route("/", erstelleKontoRoute({ db }))
    .route("/", erstelleNavigationRoute({ db }));
}

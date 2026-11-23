import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import type { Person } from "../../rechte.js";
import { erstelleAdminLadenRouten } from "./admin.js";
import { erstelleBestellRouten } from "./bestellungen.js";

// Einstieg des Lädelis (#566). app.ts hängt ihn einmal bei /api/v1 ein, hinter der Sitzung; /api/v1/admin/* erbt dort den zweiten Faktor. Die Routen tragen darum den vollen Pfad ab /api/v1.
// Website und Apps nutzen dieselben Routen: /laden (lesen), /laden/bestellungen (bestellen, eigene ansehen, stornieren), /admin/laden/* (Verwaltung).
export type LadenEnv = { Variables: { person: Person } };

export function erstelleLadenRouten({ db }: { db: Db }) {
  return new Hono<LadenEnv>()
    .route("/", erstelleBestellRouten({ db }))
    .route("/", erstelleAdminLadenRouten({ db }));
}

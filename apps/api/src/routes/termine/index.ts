import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import type { Fcm } from "../../push.js";
import type { Person } from "../../rechte.js";
import { erstelleAdminRaeumeRouten } from "./admin-raeume.js";
import { erstelleAdminVorschlaegeRouten } from "./admin-vorschlaege.js";
import { erstelleAlleRouten } from "./alle.js";
import { erstelleAdminAnlaesseRouten } from "./admin-anlaesse.js";
import { erstelleAdminAnmeldungenRouten } from "./admin-anmeldungen.js";
import { erstelleAnlaesseRouten } from "./anlaesse.js";
import { erstelleKalenderLinkRouten } from "./kalender-link.js";
import { erstelleKategorieZuordnungenRouten } from "./kategorie-zuordnungen.js";
import { erstelleMeinRouten } from "./mein.js";
import { erstelleRaeumeRouten } from "./raeume.js";
import { erstelleVorschlaegeRouten } from "./vorschlaege.js";
import { erstelleWarnungenRouten } from "./warnungen.js";

// Einstieg der Termine (Epic #430, Gerüst #431). app.ts hängt ihn einmal bei /api/v1 ein, hinter der Sitzung; /api/v1/admin/* erbt dort den zweiten Faktor. Die Routen tragen darum den vollen Pfad ab /api/v1: .get("/termine/mein", …) und .get("/admin/termine/warnungen", …).
//
// So hängt sich ein Folge-Issue ein (jedes Modul eine Datei und eine Zeile, sonst nichts hier):
//   1. routes/termine/<modul>.ts mit export function erstelle<Modul>Routen({ db, fcm }) { return new Hono<TermineEnv>()… }
//   2. hier: Import und eine Zeile .route("/", erstelle<Modul>Routen({ db, fcm }))
//   3. Matrix-Zeilen in test/termine/matrix/<modul>.ts (siehe test/termine/matrix.ts), OpenAPI-Pfade unter dem Marker «termine-pfade: <modul>»
// Jede Route lädt ihr Objekt in SQL auf person.abteilungId gefiltert (fremd = 404) und prüft erst dann das Recht (403). Kein Polling, keine Abfrage je Zeile: eine gebündelte Abfrage je Liste.
export type TermineEnv = { Variables: { person: Person } };

// «alle» steht vor «mein»: Dort fängt /termine/:id jeden Pfad ab
export function erstelleTermineRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  return new Hono<TermineEnv>()
    .route("/", erstelleAlleRouten({ db }))
    .route("/", erstelleMeinRouten({ db, fcm }))
    .route("/", erstelleAdminAnlaesseRouten({ db }))
    .route("/", erstelleAdminAnmeldungenRouten({ db }))
    .route("/", erstelleAnlaesseRouten({ db }))
    .route("/", erstelleWarnungenRouten({ db }))
    .route("/", erstelleKalenderLinkRouten({ db }))
    .route("/", erstelleKategorieZuordnungenRouten({ db }))
    .route("/", erstelleVorschlaegeRouten({ db, fcm }))
    .route("/", erstelleAdminVorschlaegeRouten({ db, fcm }))
    .route("/", erstelleRaeumeRouten({ db }))
    .route("/", erstelleAdminRaeumeRouten({ db }));
}

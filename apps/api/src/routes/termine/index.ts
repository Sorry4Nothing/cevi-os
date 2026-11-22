import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import type { Fcm } from "../../push.js";
import type { Person } from "../../rechte.js";
import { erstelleKalenderLinkRouten } from "./kalender-link.js";

// Einstieg der Termine (Epic #430, Gerüst #431). app.ts hängt ihn einmal bei /api/v1 ein, hinter der Sitzung; /api/v1/admin/* erbt dort den zweiten Faktor. Die Routen tragen darum den vollen Pfad ab /api/v1: .get("/termine/mein", …) und .get("/admin/termine/warnungen", …).
//
// So hängt sich ein Folge-Issue ein (jedes Modul eine Datei und eine Zeile, sonst nichts hier):
//   1. routes/termine/<modul>.ts mit export function erstelle<Modul>Routen({ db, fcm }) { return new Hono<TermineEnv>()… }
//   2. hier: Import und eine Zeile .route("/", erstelle<Modul>Routen({ db, fcm }))
//   3. Matrix-Zeilen in test/termine/matrix/<modul>.ts (siehe test/termine/matrix.ts), OpenAPI-Pfade unter dem Marker «termine-pfade: <modul>»
// Jede Route lädt ihr Objekt in SQL auf person.abteilungId gefiltert (fremd = 404) und prüft erst dann das Recht (403). Kein Polling, keine Abfrage je Zeile: eine gebündelte Abfrage je Liste.
export type TermineEnv = { Variables: { person: Person } };

// db und fcm reichen die Folge-Issues an ihre Module weiter
export function erstelleTermineRouten({ db }: { db: Db; fcm?: Fcm }) {
  return new Hono<TermineEnv>().route("/", erstelleKalenderLinkRouten({ db }));
}

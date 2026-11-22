import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import type { Fcm } from "../../push.js";
import type { LagerEnv } from "../../lager/policy.js";
import { erstelleAenderungenRouten } from "./aenderungen.js";
import { erstelleLagerBenachrichtigungenRouten } from "./benachrichtigungen.js";
import { erstelleLagerDateiRouten } from "./dateien.js";
import { erstelleLagerKernRouten } from "./lager.js";
import { erstelleEreignisRouten } from "./ereignisse.js";
import { erstelleLagerRechteRouten } from "./rechte.js";
import { erstelleWarteschlangeRouten } from "./warteschlange.js";
import { erstelleRessortRouten } from "./ressorts.js";
import { erstellePinnwandRouten } from "./pinnwand.js";

// Einstieg unter /api/v1/lager (app.ts hängt ihn einmal ein). Jedes Modul des Lager-Backends fügt hier genau eine .route()-Zeile an; seine Routen hängen lagerZugriff() vor jeden Handler (lager/policy.ts)
// fcm brauchen die Module, die benachrichtigen (lager/benachrichtigung.ts): Sie lesen es hier aus der Fabrik wie die Chat-Routen
export function erstelleLagerRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  return new Hono<LagerEnv>()
    .route("/", erstelleLagerKernRouten({ db }))
    .route("/", erstelleAenderungenRouten({ db }))
    .route("/", erstelleWarteschlangeRouten({ db }))
    .route("/", erstelleEreignisRouten({ db }))
    .route("/", erstelleLagerRechteRouten({ db }))
    .route("/", erstelleLagerBenachrichtigungenRouten({ db }))
    .route("/", erstelleLagerDateiRouten({ db }))
    .route("/", erstelleRessortRouten({ db }))
    .route("/", erstellePinnwandRouten({ db, fcm }));
}

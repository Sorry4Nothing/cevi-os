import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import type { Fcm } from "../../push.js";
import type { LagerEnv } from "../../lager/policy.js";
import { erstelleAenderungenRouten } from "./aenderungen.js";
import { erstelleAnwesenheitRouten } from "./anwesenheit.js";
import { erstelleAufgabenRouten } from "./aufgaben.js";
import { erstelleAufgabenDetailsRouten } from "./aufgaben-details.js";
import { erstelleLagerBenachrichtigungenRouten } from "./benachrichtigungen.js";
import { erstelleLagerDateiRouten } from "./dateien.js";
import { erstelleDokumentRouten } from "./dokumente.js";
import { erstelleLagerKernRouten } from "./lager.js";
import { erstelleEinkaufRouten } from "./einkauf.js";
import { erstelleEreignisRouten } from "./ereignisse.js";
import { erstelleLagerRechteRouten } from "./rechte.js";
import { erstelleWarteschlangeRouten } from "./warteschlange.js";
import { erstelleRessortRouten } from "./ressorts.js";
import { erstelleInfosRouten } from "./infos.js";
import { erstelleNotfallRouten } from "./notfall.js";
import { erstellePacklisteRouten } from "./packliste.js";
import { erstellePinnwandRouten } from "./pinnwand.js";
import { erstelleReaktionenRouten } from "./reaktionen.js";
import { erstelleUmfragenRouten } from "./umfragen.js";
import { erstelleAbzaehlenRouten } from "./abzaehlen.js";
import { erstelleGruppenRouten } from "./gruppen.js";
import { erstelleTeilnehmerRouten } from "./teilnehmer.js";
import { erstelleZimmerRouten } from "./zimmer.js";
import { erstelleFahrtenRouten } from "./fahrten.js";

// Einstieg unter /api/v1/lager (app.ts hängt ihn einmal ein). Jedes Modul des Lager-Backends fügt hier genau eine .route()-Zeile an; seine Routen hängen lagerZugriff() vor jeden Handler (lager/policy.ts)
// Die Aufgaben-Details stehen vor den Aufgaben: «/aufgaben/duplikate» wäre dort eine Aufgaben-ID
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
    .route("/", erstelleAufgabenDetailsRouten({ db }))
    .route("/", erstelleDokumentRouten({ db }))
    .route("/", erstelleAufgabenRouten({ db, fcm }))
    .route("/", erstelleAnwesenheitRouten({ db, fcm }))
    .route("/", erstellePinnwandRouten({ db, fcm }))
    .route("/", erstelleUmfragenRouten({ db }))
    .route("/", erstelleReaktionenRouten({ db }))
    .route("/", erstelleTeilnehmerRouten({ db }))
    .route("/", erstelleAbzaehlenRouten({ db }))
    .route("/", erstelleZimmerRouten({ db }))
    .route("/", erstelleFahrtenRouten({ db }))
    .route("/", erstelleGruppenRouten({ db }))
    .route("/", erstellePacklisteRouten({ db }))
    .route("/", erstelleNotfallRouten({ db }))
    .route("/", erstelleInfosRouten({ db }))
    .route("/", erstelleEinkaufRouten({ db }));
}

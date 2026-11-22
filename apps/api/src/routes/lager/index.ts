import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import type { LagerEnv } from "../../lager/policy.js";
import { erstelleLagerKernRouten } from "./lager.js";
import { erstelleLagerRechteRouten } from "./rechte.js";

// Einstieg unter /api/v1/lager (app.ts hängt ihn einmal ein). Jedes Modul des Lager-Backends fügt hier genau eine .route()-Zeile an; seine Routen hängen lagerZugriff() vor jeden Handler (lager/policy.ts)
export function erstelleLagerRouten({ db }: { db: Db }) {
  return new Hono<LagerEnv>()
    .route("/", erstelleLagerKernRouten({ db }))
    .route("/", erstelleLagerRechteRouten({ db }));
}

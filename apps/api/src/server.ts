import { serve } from "@hono/node-server";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { erstelleApp } from "./app.js";
import { erstelleAuth } from "./auth.js";
import { verbindeDatenbank } from "./datenbank.js";
import { erstelleDb } from "./db/client.js";
import * as schema from "./db/schema.js";
import { erstelleFcm } from "./fcm.js";
import { starteKalenderSync, synchronisiere } from "./kalender/sync.js";
import { ladeKonfiguration } from "./konfiguration.js";
import { log } from "./log.js";
import { ladeSeiten } from "./seiten.js";

// Ohne gültige Konfiguration endet der Prozess hier mit Status 1
const konfiguration = ladeKonfiguration(process.env);
// Einmal beim Start; eine fehlende Seite beendet den Prozess wie eine fehlende Variable
const seiten = ladeSeiten({
  stelle: konfiguration.VERANTWORTLICHE_STELLE,
  email: konfiguration.KONTAKT_EMAIL,
});
if (!konfiguration.KONTAKT_EMAIL) {
  log(undefined, { ereignis: "seiten", code: "ohne-kontakt" });
}
// Ohne Schlüsseldatei startet die API und sendet keine Pushes
const fcm = konfiguration.FCM_SCHLUESSEL_DATEI
  ? erstelleFcm(konfiguration.FCM_SCHLUESSEL_DATEI)
  : undefined;
if (!fcm) log(undefined, { ereignis: "push", code: "ohne-schluessel" });
const sql = verbindeDatenbank(konfiguration.DATABASE_URL);
const db = erstelleDb(sql);
const auth = erstelleAuth(
  drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
);
const app = erstelleApp({
  appMinVersion: konfiguration.APP_MIN_VERSION,
  sql,
  db,
  auth,
  fcm,
  seiten,
});
// Ohne hostname auf allen Schnittstellen: Der Dev-Build auf dem Handy erreicht die API im LAN; in Produktion öffnet nur Caddy Ports
serve({ fetch: app.fetch, port: konfiguration.PORT });
starteKalenderSync(() =>
  synchronisiere({
    datenbankUrl: konfiguration.DATABASE_URL,
    fcm,
    schluesselDatei: konfiguration.GOOGLE_APPLICATION_CREDENTIALS,
  }),
);

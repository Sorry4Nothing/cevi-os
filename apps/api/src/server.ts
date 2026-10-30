import { serve } from "@hono/node-server";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { Expo } from "expo-server-sdk";
import { starteAufbewahrung } from "./aufbewahrung.js";
import { erstelleApp } from "./app.js";
import { erstelleAuth } from "./auth.js";
import { verbindeDatenbank } from "./datenbank.js";
import { erstelleDb } from "./db/client.js";
import * as schema from "./db/schema.js";
import { starteKalenderSync, synchronisiere } from "./kalender/sync.js";
import { ladeKonfiguration } from "./konfiguration.js";
import { starteMeldungenAufraeumen } from "./meldungen.js";
import { ladeSeiten } from "./seiten.js";

// Ohne gültige Konfiguration endet der Prozess hier mit Status 1
const konfiguration = ladeKonfiguration(process.env);
// Einmal beim Start; eine fehlende Seite beendet den Prozess wie eine fehlende Variable
const seiten = ladeSeiten();
const expo = new Expo({ accessToken: konfiguration.EXPO_ACCESS_TOKEN });
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
  expo,
  seiten,
});
// Ohne hostname auf allen Schnittstellen: Der Dev-Build auf dem Handy erreicht die API im LAN; in Produktion öffnet nur Caddy Ports
serve({ fetch: app.fetch, port: konfiguration.PORT });
starteKalenderSync(() =>
  synchronisiere({
    datenbankUrl: konfiguration.DATABASE_URL,
    expo,
    schluesselDatei: konfiguration.GOOGLE_APPLICATION_CREDENTIALS,
  }),
);
starteMeldungenAufraeumen(db);
starteAufbewahrung(db);

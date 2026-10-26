import { serve } from "@hono/node-server";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { erstelleApp } from "./app.js";
import { erstelleAuth } from "./auth.js";
import { verbindeDatenbank } from "./datenbank.js";
import { erstelleDb } from "./db/client.js";
import * as schema from "./db/schema.js";
import { ladeKonfiguration } from "./konfiguration.js";
import { ladeSeiten } from "./seiten.js";

// Ohne gültige Konfiguration endet der Prozess hier mit Status 1
const konfiguration = ladeKonfiguration(process.env);
// Einmal beim Start; eine fehlende Seite beendet den Prozess wie eine fehlende Variable
const seiten = ladeSeiten();
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
  seiten,
});
// Ohne hostname auf allen Schnittstellen: Der Dev-Build auf dem Handy erreicht die API im LAN; in Produktion öffnet nur Caddy Ports
serve({ fetch: app.fetch, port: konfiguration.PORT });

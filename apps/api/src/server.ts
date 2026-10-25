import { serve } from "@hono/node-server";
import postgres from "postgres";
import { erstelleApp } from "./app.js";
import { ladeKonfiguration } from "./konfiguration.js";

// Ohne gültige Konfiguration endet der Prozess hier mit Status 1
const konfiguration = ladeKonfiguration(process.env);
const app = erstelleApp({
  appMinVersion: konfiguration.APP_MIN_VERSION,
  sql: postgres(konfiguration.DATABASE_URL),
});
// Ohne hostname auf allen Schnittstellen: Der Dev-Build auf dem Handy erreicht die API im LAN; in Produktion öffnet nur Caddy Ports
serve({ fetch: app.fetch, port: konfiguration.PORT });

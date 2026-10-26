import { serve } from "@hono/node-server";
import { erstelleApp } from "./app.js";
import { verbindeDatenbank } from "./datenbank.js";
import { starteKalenderSync, synchronisiere } from "./kalender/sync.js";
import { ladeKonfiguration } from "./konfiguration.js";

// Ohne gültige Konfiguration endet der Prozess hier mit Status 1
const konfiguration = ladeKonfiguration(process.env);
const app = erstelleApp({
  appMinVersion: konfiguration.APP_MIN_VERSION,
  sql: verbindeDatenbank(konfiguration.DATABASE_URL),
});
// Ohne hostname auf allen Schnittstellen: Der Dev-Build auf dem Handy erreicht die API im LAN; in Produktion öffnet nur Caddy Ports
serve({ fetch: app.fetch, port: konfiguration.PORT });
starteKalenderSync(() =>
  synchronisiere({
    datenbankUrl: konfiguration.DATABASE_URL,
    schluesselDatei: konfiguration.GOOGLE_APPLICATION_CREDENTIALS,
  }),
);

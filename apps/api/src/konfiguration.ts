import { z } from "zod";

// Pflicht und ohne Rückfall; die übrigen Variablen der Umgebung bleiben unbeachtet
const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_MIN_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/),
  PORT: z.coerce.number().int().min(1).max(65535),
  // Beide liest better-auth selbst aus der Umgebung; hier nur geprüft, damit der Start ohne sie scheitert
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
  // Freiwillig: Ohne Schlüsseldatei startet die API, und der Kalender-Sync meldet den Fehler pro Abteilung
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),
  // Webseite der Abteilung, von der Treffpunkt, Schluss und Mitnehmen kommen (…/cevistufe-<stufe>); öffentlich, darum eine feste Vorgabe, die die Variable überschreibt
  ECKDATEN_BASIS_URL: z
    .url({ protocol: /^https$/ })
    .default("https://www.cevi-staefa-hombi.ch"),
  // Freiwillig: Pfad zur Schlüsseldatei des Firebase-Dienstkontos für FCM; ohne sie startet die API und sendet keine Pushes
  FCM_SCHLUESSEL_DATEI: z.string().min(1).optional(),
  // Verantwortliche Stelle und ihre E-Mail-Adresse für /datenschutz, /konto-loeschen und /support; beide sind öffentlich, darum feste Vorgaben, die die Variablen überschreiben
  VERANTWORTLICHE_STELLE: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default("Abteilungsleitung Cevi Stäfa-Hombi"),
  KONTAKT_EMAIL: z.email().default("cevi-al@cevi-staefa-hombi.ch"),
});

// Mit http setzt better-auth Cookies ohne Secure, darum in Produktion nur https (#222); lokal bleibt http://localhost
const produktion = schema.extend({
  BETTER_AUTH_URL: z.url({ protocol: /^https$/ }),
});

export function ladeKonfiguration(env: Record<string, string | undefined>) {
  const ergebnis = (
    env.NODE_ENV === "production" ? produktion : schema
  ).safeParse(env);
  if (ergebnis.success) return ergebnis.data;
  // Nur die Namen: DATABASE_URL enthält das Passwort
  const namen = new Set(ergebnis.error.issues.map((f) => String(f.path[0])));
  throw new Error(
    `Fehlende oder ungültige Umgebungsvariablen: ${[...namen].join(", ")}`,
  );
}

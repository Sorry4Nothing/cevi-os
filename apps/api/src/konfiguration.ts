import { z } from "zod";

// Pflicht und ohne Rückfall; die übrigen Variablen der Umgebung bleiben unbeachtet
const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_MIN_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/),
  PORT: z.coerce.number().int().min(1).max(65535),
  // Beide liest better-auth selbst aus der Umgebung; hier nur geprüft, damit der Start ohne sie scheitert
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
  // Zugriffstoken für den Push-Versand über Expo; liegt nur in der .env des Servers
  EXPO_ACCESS_TOKEN: z.string().min(1),
  // Freiwillig: Ohne Schlüsseldatei startet die API, und der Kalender-Sync meldet den Fehler pro Abteilung
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),
});

export function ladeKonfiguration(env: Record<string, string | undefined>) {
  const ergebnis = schema.safeParse(env);
  if (ergebnis.success) return ergebnis.data;
  // Nur die Namen: DATABASE_URL enthält das Passwort
  const namen = new Set(ergebnis.error.issues.map((f) => String(f.path[0])));
  throw new Error(
    `Fehlende oder ungültige Umgebungsvariablen: ${[...namen].join(", ")}`,
  );
}

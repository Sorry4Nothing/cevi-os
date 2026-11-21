import { z } from "zod";

// Compose gibt eine leere Zeile in deploy/.env als leere Zeichenkette weiter; sie gilt als nicht gesetzt
const freiwillig = <T extends z.ZodType>(schema: T) =>
  z.preprocess((wert) => (wert === "" ? undefined : wert), schema.optional());

// Medienspeicher (#335): ohne alle fünf startet die API ohne Medien, mit einigen nicht
const MEDIEN_PFLICHT = [
  "MEDIEN_S3_ENDPOINT",
  "MEDIEN_S3_REGION",
  "MEDIEN_S3_BUCKET",
  "MEDIEN_S3_ZUGANGSSCHLUESSEL",
  "MEDIEN_S3_GEHEIMSCHLUESSEL",
] as const;

// Pflicht und ohne Rückfall; die übrigen Variablen der Umgebung bleiben unbeachtet
const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_MIN_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/),
  PORT: z.coerce.number().int().min(1).max(65535),
  // Beide liest better-auth selbst aus der Umgebung; hier nur geprüft, damit der Start ohne sie scheitert
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
  // Webseite der Abteilung, von der Treffpunkt, Schluss und Mitnehmen kommen (…/cevistufe-<stufe>); öffentlich, darum eine feste Vorgabe, die die Variable überschreibt
  ECKDATEN_BASIS_URL: z
    .url({ protocol: /^https$/ })
    .default("https://www.cevi-staefa-hombi.ch"),
  // Freiwillig: Pfad zur Schlüsseldatei des Firebase-Dienstkontos für FCM; ohne sie startet die API und sendet keine Pushes
  FCM_SCHLUESSEL_DATEI: z.string().min(1).optional(),
  // Eigener Bucket für Bilder und PDFs, getrennt vom Backup (docs/betrieb.md); die Zugangsdaten stehen nur in deploy/.env
  MEDIEN_S3_ENDPOINT: freiwillig(z.url({ protocol: /^https$/ })),
  MEDIEN_S3_REGION: freiwillig(z.string().min(1)),
  MEDIEN_S3_BUCKET: freiwillig(z.string().min(1)),
  MEDIEN_S3_ZUGANGSSCHLUESSEL: freiwillig(z.string().min(1)),
  MEDIEN_S3_GEHEIMSCHLUESSEL: freiwillig(z.string().min(1)),
  // «true», wenn der Anbieter den Bucket im Pfad statt im Hostnamen verlangt
  MEDIEN_S3_PFADSTIL: freiwillig(z.enum(["true", "false"])),
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
  // Nur die Namen: DATABASE_URL enthält das Passwort
  const namen = new Set<string>(
    ergebnis.success ? [] : ergebnis.error.issues.map((f) => String(f.path[0])),
  );
  if (ergebnis.success) {
    const gesetzt = MEDIEN_PFLICHT.filter(
      (n) => ergebnis.data[n] !== undefined,
    );
    if (gesetzt.length === 0 || gesetzt.length === MEDIEN_PFLICHT.length) {
      return ergebnis.data;
    }
    for (const n of MEDIEN_PFLICHT) {
      if (ergebnis.data[n] === undefined) namen.add(n);
    }
  }
  throw new Error(
    `Fehlende oder ungültige Umgebungsvariablen: ${[...namen].join(", ")}`,
  );
}

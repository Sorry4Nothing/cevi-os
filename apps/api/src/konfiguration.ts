import { z } from "zod";

// Compose gibt eine leere Zeile in deploy/.env als leere Zeichenkette weiter; sie gilt als nicht gesetzt
const freiwillig = <T extends z.ZodType>(schema: T) =>
  z.preprocess((wert) => (wert === "" ? undefined : wert), schema.optional());

// Öffentliche Angaben mit fester Vorgabe; eine leere Variable (compose gibt sie so weiter) gilt als nicht gesetzt
const mitVorgabe = (schema: z.ZodType<string>, vorgabe: string) =>
  z.preprocess(
    (wert) => (wert === "" ? undefined : wert),
    schema.default(vorgabe),
  );

// Medienspeicher (#335): ohne alle fünf startet die API ohne Medien, mit einigen nicht
const MEDIEN_PFLICHT = [
  "MEDIEN_S3_ENDPOINT",
  "MEDIEN_S3_REGION",
  "MEDIEN_S3_BUCKET",
  "MEDIEN_S3_ZUGANGSSCHLUESSEL",
  "MEDIEN_S3_GEHEIMSCHLUESSEL",
] as const;

// Statische Auslieferung der Website (#351): ohne alle drei läuft die Erzeugung nicht, mit einigen startet die API nicht
const WEBSITE_PFLICHT = [
  "WEBSITE_AUSGABE_PFAD",
  "WEBSITE_ABTEILUNG_ID",
  "WEBSITE_BASIS_URL",
] as const;
const GRUPPEN: readonly (readonly (keyof z.infer<typeof schema>)[])[] = [
  MEDIEN_PFLICHT,
  WEBSITE_PFLICHT,
];
// Nur die Herkunft, ohne Pfad und Schrägstrich am Ende: Daraus entstehen canonical und Sitemap
const basisUrl = (protokoll: RegExp) =>
  freiwillig(
    z.url({ protocol: protokoll }).transform((u) => new URL(u).origin),
  );

// Pflicht und ohne Rückfall; die übrigen Variablen der Umgebung bleiben unbeachtet
const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_MIN_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/),
  PORT: z.coerce.number().int().min(1).max(65535),
  // Beide liest better-auth selbst aus der Umgebung; hier nur geprüft, damit der Start ohne sie scheitert
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
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
  // Verzeichnis für die erzeugten Dateien der Website (eigenes Verzeichnis: der Abgleich löscht dort Seitendateien, die nicht mehr gebraucht werden), die Abteilung, deren Seiten erscheinen, und die Adresse der Website. Domain und Hosting stehen noch nicht fest
  WEBSITE_AUSGABE_PFAD: freiwillig(z.string().min(1)),
  WEBSITE_ABTEILUNG_ID: freiwillig(z.uuid()),
  WEBSITE_BASIS_URL: basisUrl(/^https?$/),
  // Verantwortliche Stelle, ihre Anschrift und E-Mail-Adresse für /datenschutz, /konto-loeschen und /support; alle drei sind öffentlich, darum feste Vorgaben, die die Variablen überschreiben
  VERANTWORTLICHE_STELLE: mitVorgabe(
    z.string().trim().min(1).max(200),
    "Abteilungsleitung Cevi Stäfa-Hombi",
  ),
  VERANTWORTLICHE_ADRESSE: mitVorgabe(
    z.string().trim().min(1).max(200),
    "Oetwilerstrasse 35, 8634 Hombrechtikon",
  ),
  KONTAKT_EMAIL: mitVorgabe(z.email(), "cevi-al@cevi-staefa-hombi.ch"),
  // Rechtemodell (#643): welcher Weg Rechte durchsetzt. «schatten» (Vorgabe): der alte Weg und die Rollen der Gruppen, verglichen mit dem neuen; «alt»: nur der alte (Notschalter); «neu»: nur der neue
  RECHTE_MODELL: freiwillig(z.enum(["alt", "schatten", "neu"])),
  // Aktivitätsprotokoll (#637): Aufbewahrung in Tagen (die Datenbank löscht nie vor 7) und Obergrenze der Zeilen (nie unter 10000); darüber löscht der nächtliche Lauf die ältesten
  PROTOKOLL_TAGE: freiwillig(z.coerce.number().int().min(7).max(365)),
  PROTOKOLL_MAX_ZEILEN: freiwillig(
    z.coerce.number().int().min(10000).max(5_000_000),
  ),
  // Telefon der Abteilung für Fuss und Kontaktkarte der Website (#549); öffentlich, steht nur in der Umgebung, nie im Repo. Ohne Angabe fehlt es dort. Anschrift und E-Mail sind die der verantwortlichen Stelle
  KONTAKT_TELEFON: freiwillig(
    z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9 ]{4,24}$/),
  ),
});

// Mit http setzt better-auth Cookies ohne Secure, darum in Produktion nur https (#222); lokal bleibt http://localhost
const produktion = schema.extend({
  BETTER_AUTH_URL: z.url({ protocol: /^https$/ }),
  WEBSITE_BASIS_URL: basisUrl(/^https$/),
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
    for (const gruppe of GRUPPEN) {
      const gesetzt = gruppe.filter((n) => ergebnis.data[n] !== undefined);
      if (gesetzt.length !== 0 && gesetzt.length !== gruppe.length) {
        for (const n of gruppe) {
          if (ergebnis.data[n] === undefined) namen.add(n);
        }
      }
    }
    if (namen.size === 0) return ergebnis.data;
  }
  throw new Error(
    `Fehlende oder ungültige Umgebungsvariablen: ${[...namen].join(", ")}`,
  );
}

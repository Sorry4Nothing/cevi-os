import { verbindeDatenbank } from "../datenbank.js";
import { erstelleDb } from "../db/client.js";
import { ladeKonfiguration } from "../konfiguration.js";
import { erstelleMedienspeicher } from "../medien-speicher-sdk.js";

// Gemeinsames der Befehle für Medienbilder (#868): dieselbe Konfiguration wie der Server (deploy/.env), nichts davon wird ausgegeben
export function verbindeMedien() {
  const k = ladeKonfiguration(process.env);
  if (
    !k.MEDIEN_S3_ENDPOINT ||
    !k.MEDIEN_S3_REGION ||
    !k.MEDIEN_S3_BUCKET ||
    !k.MEDIEN_S3_ZUGANGSSCHLUESSEL ||
    !k.MEDIEN_S3_GEHEIMSCHLUESSEL
  ) {
    throw new Error("Ohne MEDIEN_S3_* gibt es keine Medien");
  }
  const speicher = erstelleMedienspeicher({
    endpunkt: k.MEDIEN_S3_ENDPOINT,
    region: k.MEDIEN_S3_REGION,
    bucket: k.MEDIEN_S3_BUCKET,
    zugangsschluessel: k.MEDIEN_S3_ZUGANGSSCHLUESSEL,
    geheimschluessel: k.MEDIEN_S3_GEHEIMSCHLUESSEL,
    pfadstil: k.MEDIEN_S3_PFADSTIL === "true",
  });
  const sql = verbindeDatenbank(k.DATABASE_URL);
  return { konfiguration: k, speicher, sql, db: erstelleDb(sql) };
}

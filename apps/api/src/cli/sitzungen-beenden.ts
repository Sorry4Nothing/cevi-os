import { verbindeDatenbank } from "../datenbank.js";
import { erstelleDb } from "../db/client.js";
import { beendeSitzungen } from "../sitzungen-beenden.js";

// Für den Ablauf bei einer Datenpanne: Jede Sitzung endet sofort; Konten, Passwörter und zweite Faktoren bleiben
const url = process.env.DATABASE_URL;
// Nur der Name: Die URL kann ein Passwort enthalten
if (!url) throw new Error("Fehlende Umgebungsvariable: DATABASE_URL");

const sql = verbindeDatenbank(url);
try {
  console.log(`Beendete Sitzungen: ${await beendeSitzungen(erstelleDb(sql))}`);
} finally {
  await sql.end();
}

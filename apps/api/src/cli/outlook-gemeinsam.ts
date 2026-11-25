import { parseArgs } from "node:util";
import { isNotNull } from "drizzle-orm";
import { verbindeDatenbank } from "../datenbank.js";
import { erstelleDb } from "../db/client.js";
import { abteilung } from "../db/schema.js";
import type { GraphOptionen } from "../outlook/graph.js";

// Gemeinsames der beiden Befehle zur Outlook-Anbindung (#835). Gelesen wird nur die Umgebung (deploy/.env oder .env); nichts davon wird ausgegeben.
export function leseUmgebung() {
  const url = process.env.DATABASE_URL;
  const tenant = process.env.OUTLOOK_TENANT_ID;
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  // Nur die Namen: Die Werte sind Geheimnisse
  const fehlt = [
    ["DATABASE_URL", url],
    ["OUTLOOK_TENANT_ID", tenant],
    ["OUTLOOK_CLIENT_ID", clientId],
    ["BETTER_AUTH_SECRET", process.env.BETTER_AUTH_SECRET],
  ]
    .filter(([, wert]) => !wert)
    .map(([name]) => name);
  if (fehlt.length > 0) {
    throw new Error(`Fehlende Umgebungsvariable: ${fehlt.join(", ")}`);
  }
  const optionen: GraphOptionen = {
    tenant: tenant!,
    clientId: clientId!,
    graphBasis: process.env.OUTLOOK_GRAPH_BASIS || undefined,
    loginBasis: process.env.OUTLOOK_LOGIN_BASIS || undefined,
  };
  return { url: url!, optionen };
}

// Die Abteilung: --abteilung <id>, sonst die einzige mit Kalender
export async function waehleAbteilung(
  db: ReturnType<typeof erstelleDb>,
  argumente: string[],
) {
  const { values } = parseArgs({
    args: argumente,
    options: { abteilung: { type: "string" } },
    strict: true,
  });
  if (values.abteilung) return values.abteilung;
  const mitKalender = await db
    .select({ id: abteilung.id })
    .from(abteilung)
    .where(isNotNull(abteilung.googleKalenderId));
  if (mitKalender.length !== 1) {
    throw new Error(
      "Mehrere oder keine Abteilung mit Kalender: --abteilung <id> angeben",
    );
  }
  return mitKalender[0].id;
}

export { erstelleDb, verbindeDatenbank };

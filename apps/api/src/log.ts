import type { Context } from "hono";

// Wohin Ereignisse ohne Anfrage (Läufe im Hintergrund, Start, Versand) zusätzlich gehen: ins Aktivitätsprotokoll (#637). Gesetzt nur von server.ts; ohne Senke ändert sich nichts
let senke: ((felder: Record<string, unknown>) => void) | undefined;
export function setzeLogSenke(f: typeof senke) {
  senke = f;
}

// Eine JSON-Zeile pro Eintrag; die Felder wählt der Aufrufer, nie Header, Body, Query oder IP-Adresse
// Ohne Context (Jobs ausserhalb einer Anfrage) fällt die Request-ID weg
export function log(c: Context | undefined, felder: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      zeit: new Date().toISOString(),
      requestId: c?.get("requestId"),
      ...felder,
    }),
  );
  if (!c && senke) {
    try {
      senke(felder);
    } catch {
      // Das Protokoll darf nie den Lauf stören, der es meldet
    }
  }
}

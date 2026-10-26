import type { Context } from "hono";

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
}

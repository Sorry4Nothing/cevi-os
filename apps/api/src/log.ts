import type { Context } from "hono";

// Eine JSON-Zeile pro Eintrag; die Felder wählt der Aufrufer, nie Header, Body, Query oder IP-Adresse
export function log(c: Context, felder: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      zeit: new Date().toISOString(),
      requestId: c.get("requestId"),
      ...felder,
    }),
  );
}

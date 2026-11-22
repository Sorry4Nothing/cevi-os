// Das Ziel nach der Anmeldung (#354): nur ein Pfad der eigenen Website, nie ein anderer Host (kein offener Redirect).
// Erlaubt ist eine Allowlist: «/» oder bis zu fünf Adressstücke aus a-z, 0-9 und «-», wie die Seiten sie haben. Alles andere (zum Beispiel «//host», «/\host», «javascript:», «https://…», «%2F», «.», Anfrage, Anker) wird zu «/».
// Die obersten Adressen der API und der Verwaltung bleiben ausgeschlossen (gleiche Liste wie RESERVIERTE_ADRESSEN in src/website/seiten.ts).

const RESERVIERT = new Set([
  "api",
  "admin",
  "health",
  "datenschutz",
  "konto-loeschen",
  "support",
  "website",
  "anmelden",
  "medien",
  "ical",
]);

const MUSTER = /^\/(?:[a-z0-9-]{1,60}(?:\/[a-z0-9-]{1,60}){0,4})?$/;

export function sicheresZiel(wert) {
  if (typeof wert !== "string" || wert.length > 400 || !MUSTER.test(wert)) {
    return "/";
  }
  return RESERVIERT.has(wert.split("/")[1]) ? "/" : wert;
}

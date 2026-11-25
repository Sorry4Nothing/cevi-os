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

// Dazu als einzige Anfragen «?id=» mit einer UUID (die Seiten eines Anlasses brauchen sie, #530) und «?album=» mit der Kennung eines Fotoalbums, nur Ziffern (#690)
const MUSTER =
  /^\/(?:[a-z0-9-]{1,60}(?:\/[a-z0-9-]{1,60}){0,4})?(?:\?id=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\?album=[0-9]{1,20})?$/;

export function sicheresZiel(wert) {
  if (typeof wert !== "string" || wert.length > 400 || !MUSTER.test(wert)) {
    return "/";
  }
  return RESERVIERT.has(wert.slice(1).split(/[/?]/)[0]) ? "/" : wert;
}

// Der Rücksprung der gemeinsamen Anmeldeseite (#818): zusätzlich zu den Seiten der Website die Verwaltung, mit ihrem Bereich nach dem «#» (zum Beispiel «/admin#system/plattform»).
// Nur diese eine feste Adresse, nie eine andere unter «/admin»: Das Muster lässt vor dem «#» nichts zu, im Anker nur Zeichen aus Namen und Kennungen der Verwaltung (kein «\», Leerzeichen, «<»). Alles andere fällt auf die Regeln von sicheresZiel zurück, also auf «/».
const VERWALTUNG = /^\/admin(?:#[A-Za-z0-9/_.\-?=&%]{1,300})?$/;

export function sicheresRueckziel(wert) {
  if (typeof wert === "string" && wert.length <= 400 && VERWALTUNG.test(wert)) {
    return wert;
  }
  return sicheresZiel(wert);
}

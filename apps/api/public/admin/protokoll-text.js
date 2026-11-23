// Reine Texte und Zeiten des Protokolls (#637), ohne Abhängigkeiten, damit sie sich in Node testen lassen. Schweizer Zeit, Klartext der Funktionen und Arten.

const ZONE = "Europe/Zurich";
const DATUM_ZEIT = new Intl.DateTimeFormat("de-CH", {
  timeZone: ZONE,
  dateStyle: "medium",
  timeStyle: "medium",
});
const UHR = new Intl.DateTimeFormat("de-CH", {
  timeZone: ZONE,
  hour: "2-digit",
  minute: "2-digit",
});
const TAG_KOPF = new Intl.DateTimeFormat("de-CH", {
  timeZone: ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const TAG_SCHLUESSEL = new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE });
const RELATIV = new Intl.RelativeTimeFormat("de-CH", { numeric: "auto" });

export const absolut = (iso) => DATUM_ZEIT.format(new Date(iso));

// «vor 3 Minuten»; ab einem Tag das Datum (die Zeitleiste zeigt es im Tageskopf)
export function relativ(iso, jetzt = Date.now()) {
  const s = Math.round((new Date(iso).getTime() - jetzt) / 1000);
  const a = Math.abs(s);
  if (a < 45) return "gerade eben";
  if (a < 3600) return RELATIV.format(Math.round(s / 60), "minute");
  if (a < 86400) return RELATIV.format(Math.round(s / 3600), "hour");
  return UHR.format(new Date(iso));
}

// Tageskopf: «Heute», «Gestern», sonst «Montag, 23. November 2026»
export function tagText(iso, jetzt = new Date()) {
  const tag = TAG_SCHLUESSEL.format(new Date(iso));
  if (tag === TAG_SCHLUESSEL.format(jetzt)) return "Heute";
  if (tag === TAG_SCHLUESSEL.format(new Date(jetzt.getTime() - 86_400_000))) {
    return "Gestern";
  }
  return TAG_KOPF.format(new Date(iso));
}
export const tagSchluessel = (iso) => TAG_SCHLUESSEL.format(new Date(iso));

export const ROLLEN = {
  abteilungsleitung: "Abteilungsleitung",
  entwickler: "Entwickler",
  webmaster: "Webmaster",
  plattformrolle: "Plattformrolle",
  stufenleitung: "Stufenleitung",
  leitung: "Leitung",
  eltern: "Eltern",
  teilnehmer: "Teilnehmer",
};
export const ARTEN = {
  aktion: ["Änderung", "bearbeiten"],
  anmeldung: ["Anmeldung", "schluessel"],
  audit: ["Verwaltungsaktion", "schild"],
  zugriff: ["Zugriff", "lupe"],
  system: ["System", "system"],
};

// Wer: Name, sonst die Art des Akteurs
export function wer(e) {
  const b = e.benutzer;
  if (b.name) return b.name;
  return (
    { anonym: "Nicht angemeldet", cli: "Kommandozeile", system: "System" }[
      b.akteur
    ] ?? "Unbekannt"
  );
}

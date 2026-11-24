// Reine Texte und Zeiten des Änderungsprotokolls (#637, #662), ohne Abhängigkeiten, damit sie sich in Node testen lassen. Schweizer Zeit, deutsche Namen der Bereiche, Aktionen und Funktionen, Kurzformen für Felder, Rechte und Vorher/Nachher.

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

// «vor 3 Minuten»; ab einem Tag die Uhrzeit (die Zeitleiste zeigt das Datum im Tageskopf)
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

// Art der Zeile → [Wort, Symbol]. «aktion» und «audit» sind beide Änderungen; «audit» kam ohne Anfrage zustande (Kommandozeile, System)
export const ARTEN = {
  aktion: ["Änderung", "bearbeiten"],
  audit: ["Änderung ohne Anfrage", "bearbeiten"],
  system: ["System", "system"],
  sicherheit: ["Sicherheit", "schild"],
};

// Gruppe der Aktion → [Wort, Symbol, Ton]. Ton «warn» für das, was etwas wegnimmt; das Wort trägt die Bedeutung, nie nur die Farbe
export const GRUPPEN = {
  angelegt: ["Angelegt", "plus", "info"],
  geaendert: ["Geändert", "bearbeiten", "info"],
  geloescht: ["Gelöscht", "papierkorb", "warn"],
  zugeordnet: ["Zugeordnet", "tag", "info"],
  entzogen: ["Entzogen", "minus", "warn"],
  veroeffentlicht: ["Veröffentlicht", "website", "info"],
  zurueckgezogen: ["Zurückgezogen", "zurueck", "warn"],
  status: ["Status oder Sperre", "schild", "info"],
  gesendet: ["Gesendet", "meldungen", "info"],
  entschieden: ["Entschieden", "haken", "info"],
};
export const GRUPPEN_OPTIONEN = [
  ["", "Alle Aktionen"],
  ...Object.entries(GRUPPEN).map(([wert, [text]]) => [wert, text]),
];
const GRUPPE_ART = {
  system: ["Ereignis", "system", "info"],
  sicherheit: ["Sicherheit", "schild", "warn"],
};
// Wort, Symbol und Ton der Marke einer Zeile
export function gruppeInfo(e) {
  if (e.art === "sicherheit" || e.art === "system") return GRUPPE_ART[e.art];
  return GRUPPEN[e.gruppe] ?? ["Änderung", "bearbeiten", "info"];
}

// Bereich aus der Route (admin/<x> heisst <x>) → deutsches Wort; Unbekanntes bleibt roh
export const BEREICHE = {
  personen: "Personen",
  kinder: "Kinder",
  lager: "Lager",
  anlaesse: "Anlässe",
  tags: "Tags",
  stufen: "Stufen",
  website: "Website",
  rechte: "Rechte",
  plattform: "Plattform",
  laden: "Lädeli",
  fotos: "Fotos",
  raeume: "Räume",
  termine: "Termine",
  "termin-vorschlaege": "Termine",
  "kategorie-zuordnungen": "Termine",
  mitteilungen: "Mitteilungen",
  medien: "Medien",
  vorlagen: "Vorlagen",
  zeitregeln: "Erinnerungen",
  bearbeiter: "Rechte",
  import: "Import",
  system: "System",
  anmeldung: "Anmeldung",
  ich: "Mein Konto",
  admin: "Verwaltung",
  sonstiges: "Sonstiges",
  protokoll: "Protokoll",
  "lager-dateien": "Lager",
  programme: "Programme",
  chats: "Chat",
  push: "Push",
  migration: "Datenbank",
};
export const bereichText = (b) => BEREICHE[b] ?? b;

// Das Wort im Pfad vor der Kennung → Nennform des Objekts
const OBJEKT_TYPEN = {
  anlaesse: "Anlass",
  lager: "Lager",
  tags: "Tag",
  gruppen: "Gruppe",
  stufen: "Stufe",
  raeume: "Raum",
  artikel: "Artikel",
  seiten: "Seite",
  orte: "Ort",
  vorlagen: "Vorlage",
  rollen: "Rolle",
  medien: "Bild",
  zeitregeln: "Erinnerungsregel",
  weiterleitungen: "Weiterleitung",
  personen: "Person",
  kinder: "Kind",
};
export const objektTypText = (typ) => OBJEKT_TYPEN[typ] ?? typ ?? "Objekt";

// «Rolle «Kasse»» oder nur «Rolle»; Namen stehen in «»
export function objektText(objekt) {
  if (!objekt) return "";
  const typ = objektTypText(objekt.typ);
  return objekt.name ? `${typ} «${objekt.name}»` : typ;
}
// Das Elternobjekt: «Gruppe «OK Kirmes»» oder leer
export function elternText(aenderung) {
  const e = aenderung?.eltern;
  if (!e?.name) return "";
  return `${objektTypText(e.typ)} «${e.name}»`;
}

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

// Geänderte Felder als Chips: höchstens max sichtbar, der Rest als Zahl
export function feldChips(felder, max = 4) {
  const liste = Array.isArray(felder) ? felder : [];
  return {
    sichtbar: liste.slice(0, max),
    rest: Math.max(0, liste.length - max),
  };
}

// Rechte: Namen, die nur dazukamen, nur wegfielen, und die in beiden stehen (Geltung geändert)
export function rechteAenderung(aenderung) {
  const hinzu = aenderung?.hinzu ?? [];
  const weg = aenderung?.weg ?? [];
  return {
    neu: hinzu.filter((r) => !weg.includes(r)),
    entzogen: weg.filter((r) => !hinzu.includes(r)),
    geaendert: hinzu.filter((r) => weg.includes(r)),
  };
}
const rechtWort = (n) => (n === 1 ? "Recht" : "Rechte");
// «+2 Rechte, −1 Recht» für die Zeile; leer ohne Rechte
export function rechteKurz(aenderung) {
  const { neu, entzogen, geaendert } = rechteAenderung(aenderung);
  const teile = [];
  if (neu.length > 0) teile.push(`+${neu.length} ${rechtWort(neu.length)}`);
  if (entzogen.length > 0) {
    teile.push(`−${entzogen.length} ${rechtWort(entzogen.length)}`);
  }
  if (geaendert.length > 0) {
    teile.push(
      `${geaendert.length} ${rechtWort(geaendert.length)} mit anderer Geltung`,
    );
  }
  return teile.join(", ");
}

const wertText = (w) =>
  w === null || w === undefined
    ? "leer"
    : w === true
      ? "ja"
      : w === false
        ? "nein"
        : String(w);
// Vorher und Nachher je Feld: [{ feld, vorher, nachher }]; nur Felder, die in einem von beiden stehen
export function wechsel(aenderung) {
  const vorher = aenderung?.vorher ?? {};
  const nachher = aenderung?.nachher ?? {};
  return [...new Set([...Object.keys(vorher), ...Object.keys(nachher)])]
    .sort()
    .map((feld) => ({
      feld,
      vorher: feld in vorher ? wertText(vorher[feld]) : "",
      nachher: feld in nachher ? wertText(nachher[feld]) : "",
    }));
}
// «status: aktiv → inaktiv» für die Zeile; höchstens max, der Rest steht im Detail
export function wechselKurz(aenderung, max = 2) {
  return wechsel(aenderung)
    .slice(0, max)
    .map((w) =>
      w.vorher && w.nachher
        ? `${w.feld}: ${w.vorher} → ${w.nachher}`
        : `${w.feld}: ${w.nachher || w.vorher}`,
    );
}

// «sichtbarkeit» → «Sichtbarkeit», «anlassId» → «Anlass id»: Schlüssel der Angaben als Wort
export const schluesselText = (k) => {
  const wort = k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return wort.charAt(0).toUpperCase() + wort.slice(1);
};

// Weitere Angaben (werte) als [Name, Text]
export function werteListe(aenderung) {
  return Object.entries(aenderung?.werte ?? {}).map(([k, v]) => [
    schluesselText(k),
    wertText(v),
  ]);
}

// Kennung gekürzt für die Zeile
export const kurz = (id) => (id ? id.slice(0, 8) : "");

// Zahl der Ereignisse einer Sicherheitszeile: «3-mal»
export const malText = (e) => (e.anzahl > 1 ? `${e.anzahl}-mal` : "");

// Wort der Marke einer Sicherheitszeile: «Begrenzt» bei 429, sonst «Fehlgeschlagen»
export const sicherheitStatus = (e) =>
  e.status === 429 ? "Begrenzt" : "Fehlgeschlagen";

// Woher eine Zeile ohne Anfrage kommt
export const quelleText = (e) =>
  e.art === "system"
    ? "Von selbst, ohne Person"
    : e.benutzer?.akteur === "cli"
      ? "Über die Kommandozeile"
      : e.benutzer?.akteur === "system"
        ? "Vom System"
        : "";

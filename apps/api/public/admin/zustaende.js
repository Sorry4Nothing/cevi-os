// Zustände der Verwaltung nach dem Design (A30): ganze Seite («Rahmenzustand») und Karte in der Fläche. Gemeinsam für admin.js und alle Module.
import { ApiFehler, fehlertext } from "./api.js";
import { el, icon, knopf } from "./dom.js";

// Chip über dem Titel; Zustand nie nur über Farbe, daher immer mit Symbol und Text
// def: [Text, Icon, Art]; ohne Art bleibt der Chip neutral
export function zeichen([text, symbol, art]) {
  return el(
    "span",
    { class: art ? `chip chip--${art} chip--allein` : "chip chip--allein" },
    icon(symbol),
    text,
  );
}

// Texte der Fehler- und Zustandsseiten nach dem Status; ohne Status (kein ApiFehler) gilt der allgemeine Fehler
// Rückgabe: { ueber, titel, text, symbol, art, hilfe? } (ueber: «Fehler 404» in Monospace)
export function zustandsDaten(f) {
  const status = f instanceof ApiFehler ? f.status : undefined;
  const text = fehlertext(f);
  if (f?.offline) {
    return {
      ueber: "Keine Verbindung zum Server",
      titel: "Keine Verbindung.",
      text: "Prüfe das Internet und versuche es nochmals. Offene Formulare bleiben offen, deine Eingaben gehen nicht verloren.",
      symbol: "schliessen",
      art: "warn",
    };
  }
  if (f?.code === "IN_WARTUNG") {
    return {
      ueber: "Wartung",
      titel: "Dieser Bereich ist in Wartung.",
      text: "Ansehen geht, Ändern ist vorübergehend nicht möglich. Versuche es später nochmals.",
      symbol: "uhr",
      art: "warn",
    };
  }
  if (f?.code === "GESPERRT") {
    return {
      ueber: "Informationssperre",
      titel: "Dieser Bereich ist gesperrt.",
      text,
      symbol: "sperre",
      art: "warn",
    };
  }
  if (status === 401) {
    return {
      ueber: "Fehler 401",
      titel: "Die Sitzung ist abgelaufen.",
      text: "Bitte melde dich neu an. Du kommst danach auf dieselbe Seite zurück. Was du nicht gespeichert hast, ist weg.",
      symbol: "uhr",
      art: "warn",
    };
  }
  if (status === 502 || status === 503) {
    return {
      ueber: `Fehler ${status}`,
      titel: "Die Verwaltung ist gerade nicht erreichbar.",
      text,
      symbol: "uhr",
      art: "warn",
    };
  }
  if (status === 403) {
    return {
      ueber: "Fehler 403",
      titel: "Kein Zugriff.",
      text,
      symbol: "sperre",
      art: "fehler",
    };
  }
  if (status === 404) {
    return {
      ueber: "Fehler 404",
      titel: "Nicht gefunden.",
      text: "Vielleicht wurde der Eintrag inzwischen geändert oder gelöscht.",
      symbol: "lupe",
    };
  }
  if (status === 429) {
    return {
      ueber: "Fehler 429",
      titel: "Zu viele Versuche.",
      text,
      symbol: "uhr",
      art: "warn",
    };
  }
  // Eine Ansicht kann dem Fehler einen eigenen Titel mitgeben («Die Gruppen konnten nicht geladen werden.», A3 bis A7)
  if (f?.zustandTitel) {
    return {
      ueber: status ? `Fehler ${status}` : "Fehler",
      titel: f.zustandTitel,
      text: "Prüfe die Verbindung und versuche es nochmals.",
      symbol: "warnung",
      art: "fehler",
    };
  }
  return {
    ueber: status ? `Fehler ${status}` : "Fehler",
    titel: "Da ist etwas schiefgelaufen.",
    text: status
      ? "Der Server hat einen Fehler gemeldet. Was du zuletzt geändert hast, ist vielleicht nicht gespeichert. Versuche es nochmals."
      : text,
    symbol: "warnung",
    art: "fehler",
    hilfe:
      "Passiert es immer wieder, sag es mit Uhrzeit und Bereich der Person, die den Server betreut.",
  };
}

// Ganze Seite im Inhalt (A30: 401, 403, 404, 429, 500, 502/503, offline, Wartung, Sperre): Überzeile, Titel, Text, Knöpfe.
// Der Fokus liegt danach auf dem Titel (h1); die Meldung ist ein Alert.
// d: Ergebnis von zustandsDaten oder {ueber, titel, text, hilfe?}; aktionen: Knöpfe oder Links
export function rahmenzustand(d, aktionen = []) {
  const titel = el("h1", { tabindex: "-1" }, d.titel);
  const wurzel = el(
    "section",
    { class: "rahmenzustand", role: "alert" },
    el("p", { class: "mini leise mono" }, d.ueber),
    titel,
    el("p", { class: "rahmenzustand-text" }, d.text),
    d.hilfe && el("p", { class: "hilfe" }, d.hilfe),
    el("div", { class: "reihe" }, aktionen),
  );
  return { wurzel, titel };
}

// Karte in einer Fläche (A1: «Die offenen Punkte konnten nicht geladen werden.», Leer-Zustand): Der Rest der Seite bleibt stehen
// ebene: «h2» unter einem Seitenkopf
export function zustandsKarte(d, aktionen = [], ebene = "h2") {
  const titel = el(ebene, { tabindex: "-1" }, d.titel);
  const wurzel = el(
    "section",
    { class: "zustand", role: "alert" },
    d.ueber && el("p", { class: "mini leise mono" }, d.ueber),
    titel,
    d.text && el("p", { class: "leise" }, d.text),
    d.hilfe && el("p", { class: "hilfe" }, d.hilfe),
    aktionen.length > 0 && el("div", { class: "reihe" }, aktionen),
  );
  return { wurzel, titel };
}

// Leer-Zustand: nichts da, aber nichts kaputt. Ein Satz, optional mit Aktion.
export function leerKarte(text, aktionen = []) {
  return el(
    "div",
    { class: "zustand", role: "status" },
    el("p", { class: "zustand-satz" }, text),
    aktionen.length > 0 && el("div", { class: "reihe" }, aktionen),
  );
}

// Knopf «Nochmals versuchen» wie im Design
export const nochmals = (onclick, art = "haupt") =>
  knopf("Nochmals versuchen", { art, symbol: "aktualisieren", onclick });

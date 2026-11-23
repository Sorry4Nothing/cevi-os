// Skeletons des Lager-Arbeitsbereichs (#686): Formen wie der spätere Inhalt, damit beim Laden nichts springt. Sie bauen auf den Bausteinen von lader.js auf (sk, skeletonTabelle, skeletonListe, skeletonFlaeche) und setzen daraus ganze Seiten zusammen.
//
// skeletonSeite({ knopf, reiter, filter, inhalt, zeilen, spalten }) ist das Muster je Seitenart; jedes Modul wählt die Art, die seiner fertigen Seite gleicht:
//   inhalt «liste»    Karte mit Zeilen (Datum, Titel, Pille)        zeilen
//   inhalt «tabelle»  Tabelle mit Kopf                              zeilen, spalten
//   inhalt «karten»   Raster aus Karten (Heute, Check)              zeilen = Anzahl Karten
//   inhalt «flaechen» untereinander gestapelte Flächen              zeilen = Anzahl Flächen
//   inhalt «detail»   Kopf mit Titel und Chips, darunter zwei Flächen
//   knopf             Hauptknopf über dem Inhalt (z. B. «Höck anlegen»)
//   reiter            Anzahl Reiter (Pillen) über dem Inhalt
//   filter            Suchfeld plus (filter - 1) Auswahlfelder
// Im Modul: ctx.lade(laden, zeichnen, { skeleton: () => skeletonSeite({ knopf: true, inhalt: "tabelle" }) }).
// Ohne eigene Angabe nimmt der Rahmen die Art aus dem Register (lager-module.js, Schlüssel «skeleton»), sonst «liste».
import { el } from "./dom.js";
import {
  sk,
  skeletonFlaeche,
  skeletonListe,
  skeletonTabelle,
} from "./lader.js";

const mit = (knoten, klasse) => {
  knoten.classList.add(klasse);
  return knoten;
};
const knopf = (breite = 160) => mit(sk("r", breite), "lg-sk-knopf");
const feld = (breite = 160) => mit(sk("b", breite), "lg-sk-feld");

const INHALT = {
  liste: ({ zeilen }) => skeletonListe({ zeilen }),
  tabelle: ({ zeilen, spalten }) =>
    skeletonTabelle({ spalten, zeilen, avatar: false }),
  karten: ({ zeilen }) =>
    el(
      "div",
      { class: "lg-kacheln", "aria-hidden": "true" },
      Array.from({ length: zeilen }, () => skeletonFlaeche({ zeilen: 2 })),
    ),
  flaechen: ({ zeilen }) =>
    el(
      "div",
      { class: "lg-sk-stapel", "aria-hidden": "true" },
      Array.from({ length: zeilen }, () => skeletonFlaeche({ zeilen: 3 })),
    ),
  detail: () =>
    el(
      "div",
      { class: "lg-sk-stapel", "aria-hidden": "true" },
      el(
        "div",
        { class: "sk-zeile" },
        mit(sk("t", 260), "lg-sk-titel"),
        sk("r", 80),
      ),
      el(
        "div",
        { class: "lg-sk-zwei" },
        skeletonFlaeche({ zeilen: 4 }),
        skeletonFlaeche({ zeilen: 3 }),
      ),
    ),
};

export const SKELETON_ARTEN = Object.keys(INHALT);

export function skeletonSeite({
  knopf: mitKnopf = false,
  reiter = 0,
  filter = 0,
  inhalt = "liste",
  zeilen = 5,
  spalten = 5,
} = {}) {
  const bauen = INHALT[inhalt] ?? INHALT.liste;
  return el(
    "div",
    { class: "lg-sk", "aria-hidden": "true" },
    mitKnopf && el("div", { class: "lg-sk-reihe" }, knopf(160)),
    reiter > 0 &&
      el(
        "div",
        { class: "lg-sk-reiter" },
        Array.from({ length: reiter }, (_, i) => sk("r", i === 0 ? 112 : 96)),
      ),
    filter > 0 &&
      el(
        "div",
        { class: "lg-sk-reihe" },
        feld(320),
        Array.from({ length: filter - 1 }, () => feld(160)),
      ),
    bauen({ zeilen, spalten }),
  );
}

// Skeleton einer Seitenart aus dem Register: Name der Art oder eine Beschreibung { inhalt, … }
export function skeletonVon(art) {
  const beschreibung = typeof art === "string" ? { inhalt: art } : (art ?? {});
  return () => skeletonSeite(beschreibung);
}

// Der ganze Arbeitsbereich, bevor das Lager geladen ist: Leiste, Navigation, Titel und eine Seite. Dieselben Klassen wie der echte Rahmen, damit Leiste, Navigation und Inhalt beim Laden an ihrem Platz bleiben.
export function skeletonRahmen() {
  const navZeile = (breite) =>
    el("div", { class: "lg-sk-navzeile" }, sk("t", breite));
  const navGruppe = (zeilen) =>
    el(
      "div",
      { class: "lg-nav-gruppe" },
      el("div", { class: "lg-sk-navkopf" }, sk("t", 48)),
      zeilen.map(navZeile),
    );
  return el(
    "div",
    { class: "lg-rahmen-sk", "aria-hidden": "true" },
    el(
      "div",
      { class: "lg-leiste" },
      sk("t", 112),
      sk("r", 80),
      el("span", { class: "lg-leiste-luecke" }),
      mit(sk("b", 260), "lg-sk-suche"),
      knopf(136),
    ),
    el(
      "div",
      { class: "lg-arbeit" },
      el(
        "div",
        { class: "lg-nav" },
        el("div", { class: "lg-sk-navknopf" }, sk("t", 112)),
        el(
          "div",
          { class: "lg-nav-liste" },
          el(
            "div",
            { class: "lg-nav-innen" },
            navGruppe([64, 96, 112, 64]),
            navGruppe([96, 80, 112, 96, 64]),
            navGruppe([64, 80]),
          ),
        ),
      ),
      el(
        "div",
        { class: "lg-haupt" },
        el(
          "div",
          { class: "lg-modulkopf" },
          mit(sk("t", 200), "lg-sk-titel"),
          sk("t", 320),
        ),
        skeletonSeite({ inhalt: "karten", zeilen: 4 }),
      ),
    ),
  );
}

import { anfrage } from "./api.js";
import { filterleiste } from "./filterleiste.js";
import { aktionenZelle, el, knopf, tabelle } from "./dom.js";
import { skeletonTabelle } from "./lader.js";
import { macheSortierbar, seitenleiste, sortiere } from "./liste-hilfen.js";
import { leerKarte } from "./zustaende.js";
import {
  ADRESSE,
  BASIS,
  beschrifteZellen,
  kartenTabelle,
  ID,
  nichtGefunden,
  statusChip,
  zeigeWartende,
  zeitraum,
} from "./lager-gemeinsam.js";

// Bereich «Lager», Unterseite «Lager» (#527, Boards A20, A22, A29; #592): Liste, Detail mit einer Hauptaktion und Varianten (geteilter Knopf), Löschen mit Namenseingabe am Ort. Adressen: #lager/lager, …/neu (und …/neu/<schritt>), …/<id> und …/<id>/<modul>[/…] (Arbeitsbereich, lager-rahmen.js und lager-module.js). Kein Polling; die Liste ist eine Abfrage.

export function zeige(bereich, ctx) {
  const [erster, zweiter] = ctx.pfad;
  if (erster === undefined) return liste(bereich, ctx);
  if (erster === "neu")
    return import("./lager-anlegen.js").then((m) => m.zeige(bereich, ctx));
  if (!ID.test(erster)) return ctx.lade(nichtGefunden, () => {});
  // Arbeitsbereich des Lagers (#672): Rahmen mit Navigation; ohne Modul führt er ins Standardmodul
  return import("./lager-rahmen.js").then((m) =>
    m.zeigeRahmen(bereich, ctx, erster, zweiter, ctx.pfad.slice(2)),
  );
}

// Liste (A20) ---------------------------------------------------------------

const STATUS_FILTER = [
  ["alle", "Alle"],
  ["aktiv", "Aktiv"],
  ["entwurf", "Entwurf"],
  ["abgeschlossen", "Abgeschlossen"],
  ["archiviert", "Archiviert"],
];
const STATUS_FOLGE = ["entwurf", "aktiv", "abgeschlossen", "archiviert"];

function liste(bereich, ctx) {
  zeigeWartende(ctx);
  ctx.kopfAktion(
    knopf("Neues Lager", {
      art: "haupt",
      symbol: "plus",
      onclick: () => (location.hash = `${ADRESSE}/neu`),
    }),
  );
  ctx.lade(
    () => anfrage("GET", BASIS),
    (daten) => zeichneListe(bereich, daten.lager),
    {
      skeleton: () => skeletonTabelle({ spalten: 4, zeilen: 3, avatar: false }),
    },
  );
}

function zeichneListe(bereich, alle) {
  if (alle.length === 0) {
    bereich.append(leerKarte("Es gibt noch kein Lager. Lege das erste an."));
    return;
  }
  const zustand = { schluessel: "von", richtung: "ab" };
  const stand = { suche: "", filter: { status: "alle" } };
  // «Alle» zeigt keine archivierten Lager; sie stehen unter ihrem eigenen Filter
  const gibtArchiv = alle.some((l) => l.status === "archiviert");
  const leiste = filterleiste({
    suche: { label: "Lager suchen" },
    filter: [
      {
        schluessel: "status",
        label: "Status",
        grundwert: "alle",
        optionen: STATUS_FILTER.filter(
          ([g]) => g !== "archiviert" || gibtArchiv,
        ),
      },
    ],
    namen: { einzahl: "Lager", mehrzahl: "Lager" },
    beiAenderung: (neu) => {
      stand.suche = neu.suche.trim().toLowerCase();
      stand.filter = neu.filter;
      seiten.anfang();
      zeichne();
    },
  });
  const seiten = seitenleiste({ beiWechsel: () => zeichne() });
  const { wurzel: rahmen, koerper } = tabelle({
    beschriftung: "Lager",
    spalten: ["Name", "Zeitraum", "Ort", "Status", "Aktionen"],
    zeilen: [],
  });
  kartenTabelle(rahmen);
  macheSortierbar(
    rahmen,
    [
      { index: 0, schluessel: "name", name: "Name" },
      { index: 1, schluessel: "von", name: "Zeitraum" },
      { index: 2, schluessel: "ort", name: "Ort" },
      { index: 3, schluessel: "status", name: "Status" },
    ],
    zustand,
    () => zeichne(),
  );
  const leer = el("div");
  const schluesselVon = (l, k) =>
    k === "name"
      ? l.titel
      : k === "von"
        ? l.von
        : k === "ort"
          ? (l.ort ?? "")
          : STATUS_FOLGE.indexOf(l.status);

  function zeichne() {
    const gefiltert = alle
      .filter((l) =>
        stand.filter.status === "alle"
          ? l.status !== "archiviert"
          : l.status === stand.filter.status,
      )
      .filter(
        (l) =>
          stand.suche === "" ||
          l.titel.toLowerCase().includes(stand.suche) ||
          (l.ort ?? "").toLowerCase().includes(stand.suche),
      );
    const treffer = sortiere(gefiltert, zustand, schluesselVon);
    const [von, bis] = seiten.fenster(treffer.length);
    koerper.replaceChildren(
      ...treffer
        .slice(von, bis)
        .map((l) =>
          el(
            "tr",
            {},
            el(
              "th",
              { scope: "row" },
              el(
                "a",
                { class: "name lg-name", href: `${ADRESSE}/${l.id}` },
                l.titel,
              ),
            ),
            el("td", { class: "lg-zahlen" }, zeitraum(l.von, l.bis)),
            el("td", {}, l.ort ?? "–"),
            el("td", {}, statusChip(l.status)),
            aktionenZelle(
              el(
                "a",
                { class: "knopf knopf--klein", href: `${ADRESSE}/${l.id}` },
                "Öffnen",
                el("span", { class: "nur-leser" }, ` ${l.titel}`),
              ),
            ),
          ),
        ),
    );
    beschrifteZellen(koerper, ["", "Zeitraum", "Ort", "Status"]);
    rahmen.hidden = treffer.length === 0;
    leer.replaceChildren();
    if (treffer.length === 0)
      leer.append(
        leerKarte(
          stand.suche
            ? `Keine Treffer für «${stand.suche}».`
            : "Kein Lager in diesem Status.",
          [
            knopf("Filter zurücksetzen", {
              onclick: () => leiste.setzeAlles(),
            }),
          ],
        ),
      );
    leiste.setzeTreffer(treffer.length, alle.length);
  }
  bereich.append(leiste.wurzel, rahmen, leer, seiten.wurzel);
  zeichne();
}

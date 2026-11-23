import { el, filterGruppe, icon, neueId } from "./dom.js";
import {
  AUS,
  GELTUNG_TEXT,
  basisWert,
  geltungenFuer,
  gruppiereNachBereich,
  markenVon,
  rechteFuer,
  setzeZelle,
  wertIm,
} from "./rechte-modell.js";

// Die Rechte-Matrix (#651): Rechte (Zeilen, nach Bereich) mal Rollen (Spalten). Jede Zelle ist eine Auswahl «Aus / Eigene / Alle» (oder «Aus / An», wo es kein «eigene» gibt) als Radiogruppe mit Pfeiltasten, 44 px hoch.
// Dieselben Rollen gibt es als Karten (eine Karte je Rolle, Rechte nach Bereich): der Hauptweg am Telefon und bei grosser Schrift. Beide Ansichten ändern denselben Entwurf (z.entwurf) und folgen einander.
// Vorlage: Kokonut «tool-permissions» (Auswahl je Zeile, Gruppen, Etiketten, «war»-Stand bis Speichern) und «security-bento» (Matrix mit gesperrter Spalte); eigener Code.

// Klartext je Segment: bei Rechten ohne «eigene» heisst «alle» schlicht «An»
const segmentText = (wert, offeneGeltungen) =>
  wert === "alle" && !offeneGeltungen.includes("eigene")
    ? "An"
    : GELTUNG_TEXT[wert];

// Spaltenkopf und Kartenkopf teilen sich die Angaben einer Rolle
export function rolleKurz(rolle) {
  const n = rolle.personen.length;
  return `${n === 1 ? "1 Person" : `${n} Personen`}`;
}

// z: { katalog, entwurf, aenderung() } ; rollen: Rollen derselben Art; einzel: nur Karten (Seite einer einzelnen Rolle)
export function rechteRaster({ z, rollen, art, einzel = false }) {
  const rechte = rechteFuer(z.katalog, art);
  const bereiche = gruppiereNachBereich(z.katalog, (r) => rechte.includes(r));
  const steuerungen = []; // { rolle, recht, aktualisiere }
  const kopfZaehler = []; // { rolle, knoten }
  const ansage = el("p", { class: "nur-leser", role: "status" });
  let suche = "";
  let nurGesetzte = false;
  let nurAenderungen = false;

  // ---- eine Zelle ----
  function zelle(rolle, recht) {
    const offen = geltungenFuer(recht, rolle.art);
    const fest = rolle.fest.find((f) => f.recht === recht.id);
    const name = `${rolle.name}: ${recht.klartext}`;
    if (fest) {
      const knoten = el(
        "span",
        {
          class: "rr-fest",
          title: "Im Code vorgegeben, nicht einstellbar",
        },
        icon("sperre"),
        el("span", {}, `Fest: ${segmentText(fest.geltung, offen)}`),
        el("span", { class: "nur-leser" }, `${name}. Fest vorgegeben.`),
      );
      steuerungen.push({ rolle, recht, aktualisiere: () => {} });
      return knoten;
    }
    const gruppe = el("div", {
      class: "rr-wahl",
      role: "radiogroup",
      "aria-label": name,
    });
    const knoepfe = offen.map((wert) =>
      el(
        "button",
        {
          type: "button",
          class: "rr-segment",
          role: "radio",
          "aria-checked": "false",
          "data-wert": wert,
          onclick: () => setze(wert),
          onkeydown: (e) => taste(e, wert),
        },
        segmentText(wert, offen),
      ),
    );
    gruppe.append(...knoepfe);
    const war = el("span", { class: "rr-war" });
    const huelle = el("div", { class: "rr-zelle-inhalt" }, gruppe, war);
    function aktualisiere() {
      const jetzt = wertIm(z.entwurf, rolle, recht.id);
      const basis = basisWert(rolle, recht.id);
      const geaendert = jetzt !== basis;
      knoepfe.forEach((k) => {
        const an = k.dataset.wert === jetzt;
        k.setAttribute("aria-checked", String(an));
        k.tabIndex = an ? 0 : -1;
      });
      huelle.classList.toggle("ist-geaendert", geaendert);
      huelle.dataset.wert = jetzt;
      war.textContent = geaendert
        ? `war ${segmentText(basis, offen).toLowerCase()}`
        : "";
    }
    function setze(wert) {
      setzeZelle(z.entwurf, rolle, recht.id, wert);
      alleAktualisieren();
      z.aenderung();
      ansage.textContent = `${name}: ${segmentText(wert, offen)}.`;
    }
    function taste(e, wert) {
      const schritt = {
        ArrowRight: 1,
        ArrowDown: 1,
        ArrowLeft: -1,
        ArrowUp: -1,
      }[e.key];
      if (!schritt) return;
      e.preventDefault();
      const i = (offen.indexOf(wert) + schritt + offen.length) % offen.length;
      setze(offen[i]);
      knoepfe[i].focus();
    }
    steuerungen.push({ rolle, recht, aktualisiere });
    aktualisiere();
    return huelle;
  }

  // ---- Zeilentext ----
  function rechtTitel(recht) {
    return el(
      "span",
      { class: "rr-recht" },
      el("span", { class: "rr-titel" }, recht.klartext),
      el("span", { class: "rr-text klein leise" }, recht.erklaerung),
      el("span", { class: "rr-marken" }, marken(recht)),
    );
  }
  function marken(recht) {
    const liste = [];
    if (recht.zweiterFaktor) {
      liste.push(
        el(
          "span",
          {
            class: "rr-marke rr-marke--faktor",
            title: "Wer es nutzt, braucht den zweiten Faktor",
          },
          icon("schluessel"),
          "2. Faktor",
        ),
      );
    }
    for (const m of markenVon(recht.id)) {
      liste.push(
        el(
          "span",
          {
            class: m.gross ? "rr-marke rr-marke--gross" : "rr-marke",
            title: m.hilfe,
          },
          m.gross && icon("warnung"),
          m.text,
        ),
      );
    }
    return liste;
  }

  // ---- Matrix (Tabelle) ----
  function baueTabelle() {
    const kopf = el(
      "tr",
      {},
      el("th", { scope: "col", class: "rr-recht-kopf" }, "Recht"),
      rollen.map((rolle) => {
        const zaehl = el("span", { class: "klein leise" });
        kopfZaehler.push({ rolle, knoten: zaehl });
        return el(
          "th",
          { scope: "col", class: "rr-rolle-kopf" },
          el("span", { class: "rr-rolle-name" }, rolle.name),
          rolle.system &&
            el("span", { class: "rr-marke rr-marke--system" }, "Eingebaut"),
          el("span", { class: "klein leise" }, rolleKurz(rolle)),
          zaehl,
        );
      }),
    );
    const zeilen = bereiche.flatMap((b) => {
      const bereichId = neueId("rr-bereich");
      return [
        el(
          "tr",
          { class: "rr-bereich", "data-bereich": b.id },
          el(
            "th",
            {
              scope: "rowgroup",
              colspan: String(rollen.length + 1),
              id: bereichId,
            },
            b.name,
          ),
        ),
        ...b.rechte.map((recht) => {
          const tr = el(
            "tr",
            { class: "rr-zeile", "data-recht": recht.id, "data-bereich": b.id },
            el(
              "th",
              { scope: "row", class: "rr-recht-titel" },
              rechtTitel(recht),
            ),
            rollen.map((rolle) =>
              el("td", { class: "rr-zelle" }, zelle(rolle, recht)),
            ),
          );
          return tr;
        }),
      ];
    });
    return el(
      "div",
      {
        class: "rr-matrix-huelle",
        role: "region",
        tabindex: "0",
        "aria-label": "Rechte-Matrix, bei Bedarf waagrecht scrollbar",
      },
      el(
        "table",
        { class: "rr-matrix" },
        el("caption", { class: "nur-leser" }, "Rechte nach Rolle"),
        el("thead", {}, kopf),
        el("tbody", {}, zeilen),
      ),
    );
  }

  // ---- Karten (eine je Rolle) ----
  function baueKarten() {
    return el(
      "div",
      { class: "rr-karten" },
      rollen.map((rolle) =>
        el(
          "section",
          { class: "rr-rollenkarte", "aria-label": rolle.name },
          !einzel &&
            el(
              "header",
              { class: "rr-rollenkarte-kopf" },
              el("h4", {}, rolle.name),
              rolle.system &&
                el("span", { class: "rr-marke rr-marke--system" }, "Eingebaut"),
              el("span", { class: "klein leise" }, rolleKurz(rolle)),
            ),
          bereiche.map((b) =>
            el(
              "div",
              { class: "rr-karten-bereich", "data-bereich": b.id },
              el("h5", {}, b.name),
              el(
                "ul",
                { class: "rr-karten-liste" },
                b.rechte.map((recht) =>
                  el(
                    "li",
                    { class: "rr-karten-zeile", "data-recht": recht.id },
                    rechtTitel(recht),
                    zelle(rolle, recht),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ---- Filter ----
  const tabelle = einzel ? null : baueTabelle();
  const karten = baueKarten();
  const sucheId = neueId("rr-suche");
  const sucheFeld = el("input", {
    id: sucheId,
    class: "eingabe",
    type: "search",
    placeholder: "Recht suchen",
    autocomplete: "off",
    spellcheck: "false",
    oninput: () => {
      suche = sucheFeld.value.trim().toLowerCase();
      filtere();
    },
  });
  const umfang = filterGruppe({
    beschriftung: "Welche Rechte",
    eintraege: [
      { text: "Alle", wert: "alle" },
      { text: "Nur gesetzte", wert: "gesetzt" },
      { text: "Nur Änderungen", wert: "aenderung" },
    ],
    wert: "alle",
    beiAenderung: (w) => {
      nurGesetzte = w === "gesetzt";
      nurAenderungen = w === "aenderung";
      filtere();
    },
  });
  const leerHinweis = el("p", { class: "leise", role: "status", hidden: true });
  let ansichtWahl = null;
  const wurzel = el("div", {
    class: einzel ? "rr-raster rr-raster--einzel" : "rr-raster",
    "data-ansicht": einzel
      ? "karten"
      : window.matchMedia?.("(max-width: 47.99rem)").matches
        ? "karten"
        : "matrix",
  });
  if (!einzel) {
    ansichtWahl = filterGruppe({
      beschriftung: "Ansicht",
      eintraege: [
        { text: "Matrix", wert: "matrix" },
        { text: "Je Rolle", wert: "karten" },
      ],
      wert: wurzel.dataset.ansicht,
      beiAenderung: (w) => (wurzel.dataset.ansicht = w),
    });
  }
  wurzel.append(
    ...[
      el(
        "div",
        { class: "rr-werkzeug" },
        el(
          "div",
          { class: "suche" },
          el("label", { class: "nur-leser", for: sucheId }, "Recht suchen"),
          icon("lupe"),
          sucheFeld,
        ),
        umfang.wurzel,
        ansichtWahl?.wurzel,
      ),
      leerHinweis,
      tabelle,
      karten,
      ansage,
    ].filter(Boolean),
  );

  function sichtbarFuer(recht) {
    if (
      suche &&
      !`${recht.klartext} ${recht.erklaerung}`.toLowerCase().includes(suche)
    ) {
      return false;
    }
    if (nurGesetzte) {
      return rollen.some((r) => wertIm(z.entwurf, r, recht.id) !== AUS);
    }
    if (nurAenderungen) {
      return rollen.some(
        (r) => wertIm(z.entwurf, r, recht.id) !== basisWert(r, recht.id),
      );
    }
    return true;
  }
  function filtere() {
    let sichtbar = 0;
    const gezeigt = new Set();
    for (const b of bereiche) {
      for (const recht of b.rechte) {
        if (sichtbarFuer(recht)) {
          sichtbar++;
          gezeigt.add(recht.id);
        }
      }
    }
    for (const knoten of wurzel.querySelectorAll("[data-recht]")) {
      knoten.hidden = !gezeigt.has(knoten.dataset.recht);
    }
    // Ein Bereich ohne sichtbares Recht verschwindet mit seinem Kopf
    for (const b of bereiche) {
      const hat = b.rechte.some((r) => gezeigt.has(r.id));
      for (const knoten of wurzel.querySelectorAll(
        `[data-bereich="${b.id}"]:not([data-recht])`,
      )) {
        knoten.hidden = !hat;
      }
    }
    leerHinweis.hidden = sichtbar > 0;
    leerHinweis.textContent =
      sichtbar > 0
        ? ""
        : nurAenderungen
          ? "Noch keine Änderung. Stelle eine Zelle um, dann steht sie hier."
          : "Kein Recht passt zu dieser Suche.";
  }

  function alleAktualisieren() {
    for (const s of steuerungen) s.aktualisiere();
    for (const k of kopfZaehler) {
      const n = rechte.filter(
        (r) => wertIm(z.entwurf, k.rolle, r.id) !== AUS,
      ).length;
      const geaendert = z.entwurf.get(k.rolle.id)?.size ?? 0;
      k.knoten.textContent = `${n} von ${rechte.length} Rechten${geaendert ? `, ${geaendert} geändert` : ""}`;
    }
    if (nurGesetzte || nurAenderungen) filtere();
  }
  alleAktualisieren();

  return { wurzel, aktualisiere: alleAktualisieren };
}

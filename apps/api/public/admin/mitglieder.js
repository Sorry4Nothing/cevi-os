// Mitglieder-Darstellung (#624): eine gemeinsame Darstellung für Personen, Kinder und die Mitglieder einer Gruppe.
// Karten oder Liste (Umschalter, die Wahl bleibt im Browser), nach Rolle oder Stufe in Abschnitte gegliedert, dazu die ruhigen Marken für Konto und Zugang.
// Vorlagen (nur Aufbau, Abstände, Zustände; eigenes HTML und CSS): «team-members» (Abschnittskopf mit Zahl, Kopfzeile der Liste, Zeile mit Bild, Name und Rolle), «profile-card» (Bild gross, Name, Kennzahlen unter einer Linie) und «view-toggle-toolbar» (Umschalter mit gleitendem Schieber).
// Die Seiten bauen den Inhalt von Karte und Zeile selbst; hier steht, was sie teilen. Keine Abfragen: alles kommt aus den schon geladenen Daten.
import { avatar, el, icon, neueId, tabelle } from "./dom.js";
import { sk } from "./lader.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Eigene Symbole für den Umschalter: Karten (vier Felder) und Liste (drei Zeilen)
const FORMEN = {
  karten: [
    ["rect", { x: 4, y: 4, width: 6.5, height: 6.5 }],
    ["rect", { x: 13.5, y: 4, width: 6.5, height: 6.5 }],
    ["rect", { x: 4, y: 13.5, width: 6.5, height: 6.5 }],
    ["rect", { x: 13.5, y: 13.5, width: 6.5, height: 6.5 }],
  ],
  liste: [["path", { d: "M4 6.5h16M4 12h16M4 17.5h16" }]],
};

function form(name) {
  const knoten = document.createElementNS(SVG_NS, "svg");
  knoten.setAttribute("class", "i");
  knoten.setAttribute("viewBox", "0 0 24 24");
  knoten.setAttribute("aria-hidden", "true");
  for (const [tag, eigenschaften] of FORMEN[name] ?? []) {
    const teil = document.createElementNS(SVG_NS, tag);
    for (const [k, w] of Object.entries(eigenschaften)) teil.setAttribute(k, w);
    knoten.append(teil);
  }
  return knoten;
}

// Die gewählte Ansicht gilt auf allen drei Seiten gleich, solange die Seite offen ist (kein Browser-Speicher: nach dem Neuladen gilt «karten»).
let gewaehlteAnsicht = "karten";

export function gespeicherteAnsicht() {
  return gewaehlteAnsicht;
}

function speichereAnsicht(wert) {
  if (wert === "karten" || wert === "liste") gewaehlteAnsicht = wert;
}

// Umschalter aus Auswahlknöpfen (radiogroup, Pfeiltasten wechseln): Der Schieber gleitet unter die gewählte Option. Ohne Messung (Seite noch unsichtbar) färbt die gewählte Option sich selbst.
// eintraege: [[wert, text, symbol?], …]; liefert { wurzel, wert() }
export function umschalter({ beschriftung, eintraege, wert, beiAenderung }) {
  const name = neueId("mg-umschalter");
  let aktuell = wert ?? eintraege[0][0];
  const schieber = el("span", {
    class: "mg-umschalter-schieber",
    "aria-hidden": "true",
  });
  const optionen = eintraege.map(([w, text, symbol]) => {
    const eingabe = el("input", {
      type: "radio",
      name,
      value: w,
      class: "mg-umschalter-eingabe",
    });
    eingabe.checked = w === aktuell;
    eingabe.addEventListener("change", () => {
      if (!eingabe.checked) return;
      aktuell = w;
      positioniere(true);
      beiAenderung?.(w);
    });
    return el(
      "label",
      { class: "mg-umschalter-wahl" },
      eingabe,
      symbol && form(symbol),
      el("span", {}, text),
    );
  });
  const wurzel = el(
    "div",
    { class: "mg-umschalter", role: "radiogroup", "aria-label": beschriftung },
    schieber,
    ...optionen,
  );
  function positioniere(gleiten) {
    const gewaehlt = optionen.find((o) => o.firstChild.checked);
    if (!gewaehlt || gewaehlt.offsetWidth === 0) return;
    wurzel.style.setProperty("--mg-x", `${gewaehlt.offsetLeft}px`);
    wurzel.style.setProperty("--mg-b", `${gewaehlt.offsetWidth}px`);
    wurzel.classList.add("mg-umschalter--bereit");
    wurzel.classList.toggle("mg-umschalter--gleitet", gleiten);
  }
  // Breite und Stelle ändern sich mit der Schrift und dem Fenster
  if (typeof globalThis.ResizeObserver === "function") {
    new globalThis.ResizeObserver(() => positioniere(false)).observe(wurzel);
  }
  return { wurzel, wert: () => aktuell };
}

// Leiste über den Mitgliedern: links, was die Seite braucht (z. B. «Alle wählen»), rechts «Gruppieren» und «Ansicht»
// gruppierungen: [[wert, text], …] oder weglassen; beiAenderung({ ansicht, gruppierung }) läuft nach jedem Wechsel
export function ansichtsleiste({
  links,
  gruppierungen,
  gruppierung,
  ansicht = gespeicherteAnsicht(),
  beiAenderung,
}) {
  let stand = { ansicht, gruppierung };
  const melde = () => beiAenderung({ ...stand });
  const gruppe =
    gruppierungen &&
    umschalter({
      beschriftung: "Gruppieren nach",
      eintraege: gruppierungen,
      wert: gruppierung,
      beiAenderung: (w) => {
        stand = { ...stand, gruppierung: w };
        melde();
      },
    });
  const art = umschalter({
    beschriftung: "Ansicht",
    eintraege: [
      ["karten", "Karten", "karten"],
      ["liste", "Liste", "liste"],
    ],
    wert: ansicht,
    beiAenderung: (w) => {
      stand = { ...stand, ansicht: w };
      speichereAnsicht(w);
      melde();
    },
  });
  const feld = (text, schalter) =>
    el(
      "div",
      { class: "mg-leistenfeld" },
      el("span", { class: "mg-leistentext", "aria-hidden": "true" }, text),
      schalter.wurzel,
    );
  return {
    wurzel: el(
      "div",
      { class: "mg-leiste" },
      el("div", { class: "mg-leiste-links" }, links),
      el(
        "div",
        { class: "mg-leiste-rechts" },
        gruppe && feld("Gruppieren", gruppe),
        feld("Ansicht", art),
      ),
    ),
    stand: () => ({ ...stand }),
  };
}

// Ruhige Marke für Konto und Zugang: Symbol und Wort in leiser Schrift, nie ein Chip. Chips bleiben für das, was Aufmerksamkeit verlangt.
// art: «ok» (grün), «leise» (Vorgabe)
export function marke(text, symbol, art = "leise") {
  return el(
    "span",
    { class: `mg-marke mg-marke--${art}` },
    symbol && icon(symbol),
    text,
  );
}

// Chips mit höchstens n Einträgen; der Rest steht als «+3» mit Aufzählung im Titel und für Screenreader
export function chipListe(chips, { max = 3, klasse = "" } = {}) {
  if (chips.length === 0) return null;
  const sichtbar = chips.slice(0, max);
  const weitere = chips.length - sichtbar.length;
  const mehr =
    weitere > 0
      ? el(
          "li",
          {
            class: "chip chip--leise",
            "data-tipp": chips
              .slice(max)
              .map((c) => c.textContent)
              .join(", "),
          },
          `+${weitere}`,
          el("span", { class: "nur-leser" }, " weitere"),
        )
      : null;
  return el("ul", { class: `chips ${klasse}`.trim() }, sichtbar, mehr);
}

// Bild oder Initialen mit Name und Cevi-Name; «gross» ist das Bild der Karte, sonst das der Zeile
export function mitgliedKopf({
  name,
  ceviName,
  bildUrl,
  du,
  gross = false,
  ton = "hell",
  zusatz,
}) {
  return el(
    "div",
    { class: gross ? "mg-wer mg-wer--gross" : "mg-wer" },
    el(
      "span",
      { class: `mg-bild mg-bild--${ton}` },
      avatar(name, { hell: true, bildUrl }),
    ),
    el(
      "div",
      { class: "mg-text" },
      el(
        "span",
        { class: "mg-titel" },
        name,
        du && el("span", { class: "mg-du" }, " (du)"),
      ),
      ceviName && el("span", { class: "mg-zweit" }, ceviName),
      zusatz && el("div", { class: "mg-zustand" }, zusatz),
    ),
  );
}

// Karte eines Mitglieds. Ohne die Teile, die fehlen, bleibt sie ruhig: Rollen, Tags und Hinweis erscheinen nur, wenn es sie gibt.
// kopf: Knoten von mitgliedKopf; wahl: Knoten mit Kontrollkästchen (oben rechts) oder weglassen; aktionen: Knöpfe unten rechts. Konto und Zugang stehen als «zusatz» im Kopf (mitgliedKopf), unter dem Namen
export function mitgliedKarte({
  id,
  kopf,
  rollen,
  tags,
  hinweis,
  aktionen,
  wahl,
  aus = false,
}) {
  return el(
    "li",
    {
      class: `mg-karte${aus ? " mg-karte--aus" : ""}`,
      "data-id": id,
    },
    wahl && el("div", { class: "mg-wahl" }, wahl),
    kopf,
    rollen,
    tags,
    hinweis,
    // Ohne Aktion (z. B. eine Stufenrolle, die nur bei der Person ändert) entfällt die Fusszeile
    [aktionen].flat().some(Boolean) &&
      el(
        "div",
        { class: "mg-fuss" },
        el("div", { class: "mg-aktionen" }, aktionen),
      ),
  );
}

// Reihenfolge der Abschnitte: Einträge stabil nach dem Rang ihrer Gruppe ordnen, die Reihenfolge darin bleibt
export function nachGruppe(eintraege, rangVon) {
  return eintraege
    .map((e, i) => [e, rangVon(e), i])
    .sort((a, b) => a[1] - b[1] || a[2] - b[2])
    .map(([e]) => e);
}

// Gruppiert eine schon geordnete Seite: gruppen: [{ schluessel, titel, kennzeichen? }] in der Reihenfolge der Abschnitte; schluesselVon(eintrag) nennt die Gruppe; gesamt: { schluessel: Zahl } über alle Treffer (nicht nur diese Seite)
export function abschnitte(eintraege, gruppen, schluesselVon, gesamt = {}) {
  if (!gruppen) return [{ schluessel: "", titel: null, eintraege, anzahl: 0 }];
  return gruppen
    .map((g) => {
      const treffer = eintraege.filter(
        (e) => schluesselVon(e) === g.schluessel,
      );
      return {
        ...g,
        eintraege: treffer,
        anzahl: gesamt[g.schluessel] ?? treffer.length,
      };
    })
    .filter((g) => g.eintraege.length > 0);
}

// Ordnet die Treffer nach den Abschnitten und zählt je Abschnitt über alle Treffer (nicht nur die der Seite)
// gruppen: [{ schluessel, titel, kennzeichen? }] oder null (keine Abschnitte); schluesselVon(eintrag) nennt den Abschnitt
export function gliedere(treffer, gruppen, schluesselVon) {
  if (!gruppen) return { geordnet: treffer, gesamt: {} };
  const rang = new Map(gruppen.map((g, i) => [g.schluessel, i]));
  const gesamt = {};
  for (const e of treffer) {
    const k = schluesselVon(e);
    gesamt[k] = (gesamt[k] ?? 0) + 1;
  }
  return {
    geordnet: nachGruppe(
      treffer,
      (e) => rang.get(schluesselVon(e)) ?? rang.size,
    ),
    gesamt,
  };
}

// Kennzeichen einer Stufe vor dem Abschnittstitel: das eigene Logo, sonst der Anfangsbuchstabe
export function stufenKennzeichen(stufe) {
  return stufe.logoUrl
    ? el("img", { class: "mg-kennzeichen", src: stufe.logoUrl, alt: "" })
    : el(
        "span",
        {
          class: "mg-kennzeichen mg-kennzeichen--buchstabe",
          "aria-hidden": "true",
        },
        Array.from(stufe.name)[0]?.toLocaleUpperCase("de-CH") ?? "?",
      );
}

let ausblenden = 0;

// Zeichnet die Abschnitte als Kartenraster oder als Tabelle.
// ansicht: «karten» | «liste»; karte(e) und zeile(e) bauen li und tr (ohne spalten: li); spalten: Spaltenköpfe der Tabelle oder weglassen; abschnitte: aus abschnitte(); animiert: Einblenden bei Wechsel von Ansicht oder Gruppierung (nicht beim Tippen im Filter)
// Gibt die Tabelle zurück (für sortierbare Köpfe) oder null
export function zeichneAnsicht(
  behaelter,
  {
    ansicht,
    beschriftung,
    spalten,
    abschnitte: teile,
    karte,
    zeile,
    animiert,
    ebene = "h2",
  },
) {
  clearTimeout(ausblenden);
  behaelter.classList.toggle("mg-ein", Boolean(animiert));
  if (animiert) {
    ausblenden = setTimeout(() => behaelter.classList.remove("mg-ein"), 900);
  }
  // Ohne Spalten (schmaler Platz, z. B. in der Karte einer Gruppe) steht die Liste als Zeilen untereinander statt als Tabelle
  const alsZeilen = ansicht === "liste" && !spalten;
  if (alsZeilen) {
    behaelter.replaceChildren(
      ...teile.map((g) => {
        const id = neueId("mg-abschnitt");
        return el(
          "section",
          {
            class: "mg-abschnitt",
            "aria-labelledby": g.titel ? id : undefined,
          },
          g.titel &&
            el(
              "div",
              { class: "mg-abschnittkopf" },
              g.kennzeichen,
              el(ebene, { id, class: "mg-abschnittname" }, g.titel),
              el("span", { class: "mg-anzahl" }, String(g.anzahl)),
            ),
          el(
            "ul",
            {
              class: "mg-zeilen",
              "aria-label": g.titel
                ? `${beschriftung}: ${g.titel}`
                : beschriftung,
            },
            g.eintraege.map(zeile),
          ),
        );
      }),
    );
    return null;
  }
  if (ansicht === "liste") {
    const { wurzel, koerper } = tabelle({ beschriftung, spalten, zeilen: [] });
    wurzel.classList.add("mg-liste");
    const tabelleKnoten = wurzel.querySelector("table");
    teile.forEach((g, i) => {
      const tb = i === 0 ? koerper : el("tbody");
      if (g.titel) {
        tb.append(
          el(
            "tr",
            { class: "mg-gruppenzeile" },
            el(
              "th",
              { scope: "colgroup", colspan: String(spalten.length) },
              el(
                "span",
                { class: "mg-abschnittkopf" },
                g.kennzeichen,
                el("span", { class: "mg-abschnittname" }, g.titel),
                el("span", { class: "mg-anzahl" }, String(g.anzahl)),
              ),
            ),
          ),
        );
      }
      tb.append(...g.eintraege.map(zeile));
      if (i > 0) tabelleKnoten.append(tb);
    });
    behaelter.replaceChildren(wurzel);
    return wurzel;
  }
  behaelter.replaceChildren(
    ...teile.map((g) => {
      const id = neueId("mg-abschnitt");
      return el(
        "section",
        { class: "mg-abschnitt", "aria-labelledby": g.titel ? id : undefined },
        g.titel &&
          el(
            "div",
            { class: "mg-abschnittkopf" },
            g.kennzeichen,
            el(ebene, { id, class: "mg-abschnittname" }, g.titel),
            el("span", { class: "mg-anzahl" }, String(g.anzahl)),
          ),
        el(
          "ul",
          {
            class: "mg-raster",
            "aria-label": g.titel
              ? `${beschriftung}: ${g.titel}`
              : beschriftung,
          },
          g.eintraege.map(karte),
        ),
      );
    }),
  );
  return null;
}

// Skeleton in der Form der Karten (Bild, zwei Zeilen, Pillen), damit beim Laden nichts springt
export function skeletonKarten({ karten = 6 } = {}) {
  return el(
    "ul",
    { class: "mg-raster", "aria-hidden": "true" },
    Array.from({ length: karten }, () =>
      el(
        "li",
        { class: "mg-karte" },
        el(
          "div",
          { class: "mg-wer mg-wer--gross" },
          sk("b", 64),
          el("div", { class: "mg-text" }, sk("t", 136), sk("t", 80)),
        ),
        el("div", { class: "chips" }, sk("r", 80), sk("r", 96)),
        el("div", { class: "mg-fuss" }, sk("r", 112)),
      ),
    ),
  );
}

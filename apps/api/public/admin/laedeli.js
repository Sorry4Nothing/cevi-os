import { anfrage, fehlertext } from "./api.js";
import { splitKnopf } from "./aktionen.js";
import { bildMitLader, bildwahl } from "./bildwahl.js";
import {
  ankreuzen,
  chip,
  el,
  feld,
  filterGruppe,
  icon,
  knopf,
  menue,
  seitenblatt,
  tabelle,
} from "./dom.js";
import { formularRaster } from "./formularraster.js";
import { sk, skeletonTabelle } from "./lader.js";
import { ansichtVon } from "./rueckgaengig.js";
import { merkePlaetze, rutscheAnPlatz, zieheMitBewegung } from "./sortieren.js";
import {
  entferneFeldFehler,
  ersetze,
  feldFehler,
  pruefHinweis,
  speicherLeiste,
  stempel,
  zaehlwort,
} from "./kalenderhilfen.js";
import { leerKarte } from "./zustaende.js";

// Bereich «Lädeli» (#566): Bestellungen der Website sehen und ihren Stand setzen, Artikel pflegen, Übergabearten einstellen. Eine Datei für die drei Unterseiten; welche gemeint ist, sagt ctx.seite.unter.
// Datenbanklast: je Ansicht eine Anfrage beim Öffnen und je «Weitere laden» (25 Bestellungen); die Medien für die Bildwahl (eine Anfrage) erst, wenn ein Blatt sie braucht. Kein Polling.
// Es gibt keine Zahlung und keinen Lagerbestand: Bezahlt wird bei der Übergabe, ein Artikel ist verfügbar oder nicht.

const BASIS = "/api/v1/admin/laden";
const SEITE = 25;
const STAND = {
  offen: { text: "Offen", art: undefined, symbol: "uhr" },
  bereit: { text: "Bereit zur Übergabe", art: "ok", symbol: undefined },
  uebergeben: { text: "Übergeben", art: "stufe", symbol: "haken" },
  storniert: { text: "Storniert", art: "fehler", symbol: undefined },
};
const TEXTE = {
  MEDIUM_UNGEEIGNET:
    "Dieses Bild passt nicht: Es muss ein öffentliches Bild aus der Medienbibliothek sein.",
  ARTIKEL_LIMIT: "Das Lädeli fasst höchstens 200 Artikel.",
  STATUS_UNGUELTIG:
    "Der Stand hat sich inzwischen geändert. Die Liste ist neu geladen.",
};
const meldungVon = (f) => TEXTE[f?.code] ?? fehlertext(f);

// Griff zum Ziehen: sechs Punkte, eigenes Zeichen (Zierde, der Name steht im Knopf)
function griffSymbol() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "i");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const x of [9, 15]) {
    for (const y of [6, 12, 18]) {
      const kreis = document.createElementNS(ns, "circle");
      kreis.setAttribute("cx", String(x));
      kreis.setAttribute("cy", String(y));
      kreis.setAttribute("r", "1.6");
      kreis.setAttribute("fill", "currentColor");
      svg.append(kreis);
    }
  }
  return svg;
}

// «CHF 40.–», «CHF 12.50», «gratis»: wie src/laden/laden.ts (preisText)
export function preisText(rappen) {
  if (rappen === 0) return "gratis";
  const franken = Math.floor(rappen / 100)
    .toString()
    .replace(/\B(?=(\d{3})+$)/g, "’");
  const rest = rappen % 100;
  return `CHF ${franken}.${rest === 0 ? "–" : String(rest).padStart(2, "0")}`;
}
export const summeText = (rappen) =>
  rappen === 0 ? "CHF 0.–" : preisText(rappen);

// «40», «40.–», «12.50», «12,5», «CHF 4.-» zu Rappen; null, wenn es kein Betrag von 0 bis 10 000 Franken ist
export function rappenAus(text) {
  const m = text
    .trim()
    .replace(/^(chf|fr\.?)\s*/i, "")
    .replace(/[’']/g, "")
    .match(/^(\d{1,5})(?:[.,](\d{1,2}|–|-))?$/);
  if (!m) return null;
  const rest = m[2] && /\d/.test(m[2]) ? Number(m[2].padEnd(2, "0")) : 0;
  const rappen = Number(m[1]) * 100 + rest;
  return rappen <= 1_000_000 ? rappen : null;
}
const frankenText = (rappen) => (rappen / 100).toFixed(2);

// «S, M, L» zu ["S", "M", "L"]; doppelte und leere Einträge fallen weg
export const variantenAus = (text) => [
  ...new Map(
    text
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => [v.toLocaleLowerCase("de-CH"), v]),
  ).values(),
];

// Verfügbarkeit je Grösse (#629): «nichtVerfuegbar» nennt die Grössen, die nicht zu haben sind. Stand eines Artikels: aus (Schalter des Artikels), keine (alle Grössen weg), teilweise oder ganz
// Bei einem Artikel mit Grössen ergibt sich alles aus den Grössen. Ein älterer Artikel mit Grössen, dessen Schalter «verfügbar» aus ist, zählt als «alle Grössen nicht verfügbar» (bleibt also nicht bestellbar und ist auflösbar: eine Grösse einschalten)
export function wegVon(a) {
  return a.varianten.length > 0 &&
    (a.verfuegbarGesetzt ?? a.verfuegbar) === false
    ? [...a.varianten]
    : (a.nichtVerfuegbar ?? []);
}
export function standVon(a) {
  const weg = wegVon(a);
  if (a.varianten.length === 0) {
    return { art: (a.verfuegbarGesetzt ?? a.verfuegbar) ? "ganz" : "aus", weg };
  }
  if (a.varianten.every((v) => weg.includes(v))) return { art: "keine", weg };
  return { art: weg.length > 0 ? "teilweise" : "ganz", weg };
}
export function standChips(a) {
  const { art, weg } = standVon(a);
  if (art === "ganz") return [chip("Verfügbar", "ok")];
  if (art === "teilweise") {
    return [
      chip("Teilweise verfügbar", "warn"),
      el(
        "p",
        { class: "klein leise ld-stand-weg" },
        `${weg.join(", ")} nicht verfügbar`,
      ),
    ];
  }
  return [
    chip("Nicht verfügbar", "warn"),
    art === "keine" &&
      el(
        "p",
        { class: "klein leise ld-stand-weg" },
        "Alle Grössen nicht verfügbar",
      ),
  ];
}
// Ein Schalter je Grösse: role="switch", der Name ist die Grösse, der Zustand steht in aria-checked und als Wort («nicht verfügbar», durchgestrichen); nie nur Farbe
// kompakt (Artikelliste): ohne Wort unter dem Schalter, es steht in der Spalte «Stand» daneben
export function groessenSchalter({
  namen,
  weg,
  beiUmschalten,
  name,
  kompakt = false,
}) {
  return el(
    "ul",
    { class: "ld-groessen" },
    namen.map((v) => {
      const aus = weg.includes(v);
      return el(
        "li",
        { class: "ld-gposten" },
        el(
          "button",
          {
            type: "button",
            class: aus ? "ld-gschalter ld-gschalter--aus" : "ld-gschalter",
            role: "switch",
            "aria-checked": aus ? "false" : "true",
            "data-name": v,
            "aria-label": name ? `${v} verfügbar, ${name}` : `${v} verfügbar`,
            onclick: () => beiUmschalten(v, !aus),
          },
          icon(aus ? "schliessen" : "haken"),
          el("span", { class: "ld-gname" }, aus ? el("s", {}, v) : v),
        ),
        // Das Wort steht unter dem Schalter, nie in ihm; für Hilfstechnik trägt es schon der Name des Schalters
        !kompakt &&
          el(
            "span",
            {
              class: aus ? "ld-gstand ld-gstand--aus" : "ld-gstand",
              "aria-hidden": "true",
            },
            aus ? "nicht verfügbar" : "verfügbar",
          ),
      );
    }),
  );
}

export function zeige(bereich, ctx) {
  const unter = ctx.seite.unter.schluessel;
  if (unter === "artikel") return zeigeArtikel(bereich, ctx);
  if (unter === "einstellungen") return zeigeEinstellungen(bereich, ctx);
  return zeigeBestellungen(bereich, ctx);
}

// ===== Bestellungen =====

// Karten, solange die Bestellungen laden: Kopf mit Kachel, Schiene mit drei Schritten, Positionen, Aktion
function skeletonBestellungen() {
  const karte = () =>
    el(
      "div",
      { class: "ld-bestellung" },
      el(
        "div",
        { class: "ld-bestellung-kopf" },
        sk("k", 40),
        el("div", { class: "ld-bestellung-wer" }, sk("t", 136), sk("t", 112)),
        sk("t", 64),
      ),
      el(
        "div",
        { class: "sk-zeile" },
        sk("k", 24),
        sk("t", 64),
        sk("k", 24),
        sk("t", 64),
        sk("k", 24),
        sk("t", 80),
      ),
      sk("t", 200),
      sk("t", 160),
      sk("r", 136),
    );
  return el(
    "div",
    { class: "ld-skeleton" },
    el("div", { class: "werkzeuge" }, sk("r", 380)),
    el("div", { class: "ld-bestellungen" }, [karte(), karte(), karte()]),
  );
}

function zeigeBestellungen(bereich, ctx) {
  let stand = "offen";
  const adresse = () =>
    `${BASIS}/bestellungen?limit=${SEITE}${stand ? `&status=${stand}` : ""}`;
  const lade = () =>
    ctx.lade(
      () => anfrage("GET", adresse()),
      (erste) => zeichne(erste),
      {
        fehlerTitel: "Die Bestellungen konnten nicht geladen werden.",
        skeleton: skeletonBestellungen,
      },
    );

  function zeichne(erste) {
    const bestellungen = [...erste.bestellungen];
    let weitere = erste.weitere;
    let naechste = erste.naechste;
    if (stand === "offen") ctx.zaehler("bestellungen", bestellungen.length);

    const filter = filterGruppe({
      beschriftung: "Stand",
      eintraege: [
        { text: "Offen", wert: "offen" },
        { text: "Bereit", wert: "bereit" },
        { text: "Übergeben", wert: "uebergeben" },
        { text: "Storniert", wert: "storniert" },
        { text: "Alle", wert: "" },
      ],
      wert: stand,
      beiAenderung: (wert) => {
        stand = wert;
        ersetze(bereich);
        lade();
      },
    });
    const liste = el("div", {});
    const meldung = el("p", { class: "klein", role: "status" });
    const mehr = knopf("Weitere laden", {
      symbol: "runter",
      onclick: () => ladeWeitere(),
    });

    async function setze(b, neu, erfolg) {
      try {
        await anfrage("POST", `${BASIS}/bestellungen/${b.id}/status`, {
          status: neu,
        });
        ctx.melde(erfolg);
      } catch (f) {
        ctx.melde(meldungVon(f), "fehler");
      }
      ersetze(bereich);
      await lade();
      document.querySelector("h1")?.focus();
    }
    const wer = (b) => b.person.ceviName || b.person.name;
    // Was in diesem Stand geht (WECHSEL in src/laden/laden.ts); fehlt ein Wechsel, fehlt der Aktion die Stelle.
    // Hauptaktion ist der nächste Schritt der Schiene; die übrigen Wechsel stehen im Menü daneben (geteilter Knopf)
    function aktionen(b, karte) {
      const uebergeben = () =>
        ctx.mitRueckgaengig({
          text: `Bestellung von ${wer(b)} über ${summeText(b.summeRappen)} als übergeben und bezahlt eingetragen`,
          ansicht: ansichtVon(karte),
          ausfuehren: () =>
            anfrage("POST", `${BASIS}/bestellungen/${b.id}/status`, {
              status: "uebergeben",
            }),
          fehlertext: meldungVon,
          danach: async () => {
            ersetze(bereich);
            await lade();
          },
        });
      const stornieren = () =>
        ctx.mitRueckgaengig({
          text: `Bestellung von ${wer(b)} storniert`,
          ansicht: ansichtVon(karte),
          ausfuehren: () =>
            anfrage("POST", `${BASIS}/bestellungen/${b.id}/status`, {
              status: "storniert",
            }),
          fehlertext: meldungVon,
          danach: async () => {
            ersetze(bereich);
            await lade();
          },
        });
      if (b.status === "offen") {
        return splitKnopf({
          text: "Bereit melden",
          art: "blau",
          kontext: wer(b),
          onclick: () =>
            setze(b, "bereit", `Bestellung von ${wer(b)} ist bereit.`),
          eintraege: [
            { text: "Übergeben", onclick: uebergeben },
            { text: "Stornieren", onclick: stornieren, gefaehrlich: true },
          ],
        });
      }
      if (b.status === "bereit") {
        return splitKnopf({
          text: "Übergeben",
          art: "blau",
          symbol: "haken",
          kontext: wer(b),
          onclick: uebergeben,
          eintraege: [
            {
              text: "Zurück auf offen",
              onclick: () =>
                setze(b, "offen", `Bestellung von ${wer(b)} ist wieder offen.`),
            },
            { text: "Stornieren", onclick: stornieren, gefaehrlich: true },
          ],
        });
      }
      return null;
    }

    // Statusschiene wie beim Bestellverfolger: eine Linie mit drei Punkten (Offen, Bereit, Übergeben), die Linie ist bis zum aktuellen Schritt gefüllt.
    // Erledigte Schritte tragen einen Haken, der aktuelle ist gefüllt und «aktueller Schritt» für Screenreader, darunter steht seit wann; Zustand nie nur über Farbe
    function schiene(b) {
      const schritte = [
        ["offen", "Offen"],
        ["bereit", "Bereit"],
        ["uebergeben", "Übergeben"],
      ];
      const aktuell = schritte.findIndex(([w]) => w === b.status);
      return el(
        "ol",
        {
          class: "ld-schiene",
          "aria-label": "Stand der Bestellung",
          "data-schritt": String(aktuell),
        },
        schritte.map(([, text], i) =>
          el(
            "li",
            {
              class: `ld-schritt${i < aktuell ? " ld-schritt--erledigt" : ""}${i === aktuell ? " ld-schritt--jetzt" : ""}`,
              "aria-current": i === aktuell ? "step" : undefined,
            },
            el(
              "span",
              { class: "ld-punkt", "aria-hidden": "true" },
              i < aktuell ? icon("haken") : "",
            ),
            el("span", { class: "ld-schritttext" }, text),
            i < aktuell && el("span", { class: "nur-leser" }, " (erledigt)"),
            i === aktuell &&
              b.status !== "offen" &&
              el(
                "span",
                { class: "ld-seit klein leise" },
                `seit ${stempel(b.geaendertAm)}`,
              ),
          ),
        ),
      );
    }

    const kuerzel = (name) =>
      name
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    // Karte wie die Bestellkarten von Kokonut: Kopf mit Initialen, Name und Zeit, Stand rechts; Schiene; Positionen mit Zeilensumme; Summe; Übergabe und Aktion unten
    function karte(b) {
      const wurzel = el("article", {
        class: `ld-bestellung${b.status === "storniert" ? " ld-bestellung--storniert" : ""}`,
        "aria-label": `Bestellung von ${wer(b)}`,
      });
      const aktion = aktionen(b, wurzel);
      const stand = STAND[b.status];
      wurzel.append(
        ...[
          el(
            "header",
            { class: "ld-bestellung-kopf" },
            el(
              "span",
              { class: "ld-kuerzel", "aria-hidden": "true" },
              kuerzel(wer(b)),
            ),
            el(
              "div",
              { class: "ld-bestellung-wer" },
              el("h3", { class: "ld-bestellung-name" }, wer(b)),
              el(
                "span",
                { class: "klein leise ld-unter" },
                b.person.ceviName
                  ? `${b.person.name}, bestellt ${stempel(b.erstelltAm)}`
                  : `Bestellt ${stempel(b.erstelltAm)}`,
              ),
            ),
            el(
              "ul",
              { class: "chips ld-stand" },
              chip(
                stand.text,
                stand.art,
                stand.symbol ??
                  (b.status === "storniert" ? "sperre" : undefined),
              ),
            ),
          ),
          b.status !== "storniert" && schiene(b),
          el(
            "ul",
            { class: "ld-positionen" },
            b.positionen.map((p) =>
              el(
                "li",
                { class: "ld-position" },
                el(
                  "span",
                  { class: "ld-position-text" },
                  el("span", { class: "ld-position-name" }, p.name),
                  (p.variante || p.menge > 1) &&
                    el(
                      "span",
                      { class: "klein leise" },
                      [
                        p.variante && `Grösse ${p.variante}`,
                        p.menge > 1 &&
                          `${p.menge} × ${preisText(p.einzelpreisRappen)}`,
                      ]
                        .filter(Boolean)
                        .join(", "),
                    ),
                ),
                el(
                  "span",
                  { class: "ld-position-preis" },
                  summeText(p.menge * p.einzelpreisRappen),
                ),
              ),
            ),
            el(
              "li",
              { class: "ld-position ld-total" },
              el("span", {}, "Summe"),
              el("span", { class: "ld-summe" }, summeText(b.summeRappen)),
            ),
          ),
          el("p", { class: "klein leise ld-uebergabe" }, b.uebergabe),
          aktion &&
            el(
              "div",
              { class: "ld-bestellung-aktion" },
              aktion.wurzel ?? aktion,
            ),
        ].filter(Boolean),
      );
      return wurzel;
    }

    function zeichneListe() {
      mehr.hidden = !weitere;
      if (bestellungen.length === 0) {
        ersetze(
          liste,
          leerKarte(
            stand === "offen"
              ? "Gerade ist keine Bestellung offen."
              : "In diesem Stand gibt es keine Bestellungen.",
          ),
        );
        return;
      }
      ersetze(
        liste,
        el("div", { class: "ld-bestellungen" }, bestellungen.map(karte)),
      );
    }

    async function ladeWeitere() {
      mehr.disabled = true;
      mehr.setAttribute("aria-busy", "true");
      meldung.textContent = "Weitere Bestellungen werden geladen …";
      try {
        const seite = await anfrage(
          "GET",
          `${adresse()}&nach=${encodeURIComponent(naechste)}`,
        );
        if (!bereich.isConnected) return;
        bestellungen.push(...seite.bestellungen);
        weitere = seite.weitere;
        naechste = seite.naechste;
        zeichneListe();
        ctx.melde(
          `${zaehlwort(seite.bestellungen.length, "weitere Bestellung", "weitere Bestellungen")} geladen.`,
          "info",
        );
      } catch (f) {
        ctx.melde(fehlertext(f), "fehler", {
          text: "Nochmals versuchen",
          onclick: ladeWeitere,
        });
      } finally {
        meldung.textContent = "";
        mehr.disabled = false;
        mehr.removeAttribute("aria-busy");
      }
    }

    bereich.append(
      el("div", { class: "werkzeuge" }, filter.wurzel),
      el(
        "p",
        { class: "klein leise" },
        "Bezahlt wird bei der Übergabe. Abgeschlossene Bestellungen werden nach 180 Tagen gelöscht.",
      ),
      liste,
      meldung,
      el("div", { class: "ld-mehr" }, mehr),
    );
    zeichneListe();
  }
  return lade();
}

// ===== Artikel =====

function zeigeArtikel(bereich, ctx) {
  const lade = () =>
    ctx.lade(
      () => anfrage("GET", `${BASIS}/artikel`),
      (daten) => zeichne(daten.artikel),
      {
        fehlerTitel: "Die Artikel konnten nicht geladen werden.",
        // Sechs Spalten wie die Liste: Griff, Artikel, Preis, Grösse, Stand, Aktionen
        skeleton: () => skeletonTabelle({ spalten: 6, zeilen: 8 }),
      },
    );
  const neu = async () => {
    ersetze(bereich);
    await lade();
  };
  ctx.kopfAktion(
    knopf("Neuer Artikel", {
      art: "haupt",
      symbol: "plus",
      onclick: () => artikelBlatt({ ctx, neu, anzahl: 0 }),
    }),
  );

  function zeichne(artikel) {
    if (artikel.length === 0) {
      bereich.append(
        leerKarte(
          "Das Lädeli hat noch keine Artikel. Lege den ersten an; er erscheint auf der Website, sobald eine Seite den Baustein «Lädeli» hat.",
        ),
      );
      return;
    }
    // Die Folge der Liste: Ziehen am Griff (Maus, Finger), Tastatur am Griff (Leertaste greift, Pfeile bewegen, Leertaste setzt ab, Esc bricht ab) und «Nach oben», «Nach unten» im Menü. Nach dem Absetzen speichert ein Aufruf alle IDs
    const ids0 = artikel.map((a) => a.id);
    const nachId = new Map(artikel.map((a) => [a.id, a]));
    const sage = el("p", { class: "nur-leser", role: "status" });
    const ansage = (text) => {
      sage.textContent = "";
      sage.textContent = text;
    };
    const koerper = el("tbody", {});
    const reihe = () => [...koerper.children];
    const idsJetzt = () => reihe().map((tr) => tr.dataset.id);
    const platzText = (id) =>
      `Position ${idsJetzt().indexOf(id) + 1} von ${artikel.length}`;
    // Die Hülle der Tabelle nimmt den Platzhalter beim Ziehen auf (sie entsteht weiter unten)
    let huelleTabelle = null;

    async function speichere(vorher, nachher) {
      if (vorher.join() === nachher.join()) return;
      try {
        await anfrage("PUT", `${BASIS}/artikel/reihenfolge`, { ids: nachher });
      } catch (f) {
        ctx.melde(
          `Die Reihenfolge ist nicht gespeichert. ${meldungVon(f)}`,
          "fehler",
        );
        await neu();
        return;
      }
      ctx.melde("Reihenfolge gespeichert.", "ok", {
        text: "Rückgängig",
        onclick: async () => {
          try {
            await anfrage("PUT", `${BASIS}/artikel/reihenfolge`, {
              ids: vorher,
            });
            ctx.melde("Die alte Reihenfolge ist wieder da.");
          } catch (f) {
            ctx.melde(meldungVon(f), "fehler");
          }
          await neu();
        },
      });
      await neu();
    }
    // Nach einem Wechsel zeichnet die Liste neu; der Griff behält den Fokus
    const fokusAufGriff = (id) =>
      document
        .querySelector(`.ld-tabelle tr[data-id="${id}"] .ld-griff`)
        ?.focus();
    async function beendeUndSpeichere(id, vorher) {
      await speichere(vorher, idsJetzt());
      fokusAufGriff(id);
    }
    const stelleHer = (vorher) => {
      for (const id of vorher) {
        koerper.append(koerper.querySelector(`tr[data-id="${id}"]`));
      }
    };
    // Eine Zeile um einen Platz schieben (Menü, Tastatur)
    function schiebe(id, schritt) {
      const zeilen = reihe();
      const von = zeilen.findIndex((tr) => tr.dataset.id === id);
      const nach = von + schritt;
      if (nach < 0 || nach >= zeilen.length) return false;
      if (schritt < 0) zeilen[nach].before(zeilen[von]);
      else zeilen[nach].after(zeilen[von]);
      return true;
    }

    function griff(a) {
      let gegriffen = null;
      // Das Verschieben der Zeile nimmt dem Griff kurz den Fokus: Das ist kein Absetzen
      let bewegt = false;
      const knopfGriff = el(
        "button",
        {
          type: "button",
          class: "ld-griff",
          "aria-pressed": "false",
          "aria-label": `Position ändern: ${a.name}`,
          "aria-describedby": "ld-griff-hilfe",
        },
        griffSymbol(),
      );
      const zeile = () => knopfGriff.closest("tr");
      const ende = (abbrechen) => {
        if (!gegriffen) return;
        const { vorher } = gegriffen;
        gegriffen = null;
        knopfGriff.setAttribute("aria-pressed", "false");
        zeile().classList.remove("ld-gehoben");
        if (abbrechen) {
          stelleHer(vorher);
          ansage("Abgebrochen. Die Reihenfolge ist unverändert.");
          knopfGriff.focus();
          return;
        }
        void beendeUndSpeichere(a.id, vorher);
      };
      // Tastatur
      knopfGriff.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (!gegriffen) {
            gegriffen = { vorher: idsJetzt() };
            knopfGriff.setAttribute("aria-pressed", "true");
            zeile().classList.add("ld-gehoben");
            ansage(
              `${a.name} gegriffen. ${platzText(a.id)}. Pfeil hoch oder runter verschiebt, Leertaste setzt ab, Escape bricht ab.`,
            );
          } else {
            ende(false);
          }
        } else if (e.key === "Escape" && gegriffen) {
          e.preventDefault();
          e.stopPropagation();
          ende(true);
        } else if (
          gegriffen &&
          (e.key === "ArrowUp" || e.key === "ArrowDown")
        ) {
          e.preventDefault();
          bewegt = true;
          if (schiebe(a.id, e.key === "ArrowUp" ? -1 : 1)) {
            knopfGriff.focus();
            ansage(platzText(a.id));
          }
          bewegt = false;
        }
      });
      // Wer die Tastatur verlässt, ohne abzusetzen, setzt ab
      knopfGriff.addEventListener("blur", () => {
        if (gegriffen && !bewegt) ende(false);
      });
      // Maus und Finger: Die Zeile folgt dem Zeiger, die anderen rutschen weg, ein Platzhalter zeigt den Zielplatz (zieheMitBewegung); beim Loslassen ordnet die Tabelle neu und speichert
      knopfGriff.addEventListener("pointerdown", (e) => {
        if ((e.button !== 0 && e.pointerType === "mouse") || gegriffen) return;
        e.preventDefault();
        const mich = zeile();
        const vorher = idsJetzt();
        zieheMitBewegung({
          ereignis: e,
          zeile: mich,
          andere: () => reihe().filter((z) => z !== mich),
          huelle: huelleTabelle,
          beiEnde: ({ abgebrochen, pos, pos0 }) => {
            if (abgebrochen || pos === pos0) return;
            const rest = reihe().filter((z) => z !== mich);
            if (rest[pos]) rest[pos].before(mich);
            else koerper.append(mich);
            ansage(platzText(a.id));
            void beendeUndSpeichere(a.id, vorher);
          },
        });
      });
      return knopfGriff;
    }

    const standInhalt = (a) => [
      el("ul", { class: "chips" }, standChips(a)[0]),
      ...standChips(a).slice(1),
    ];
    // Schnellschalter: eine Grösse antippen meldet sie als nicht verfügbar oder wieder als verfügbar. Nur die beiden Zellen der Zeile zeichnen neu; «Rückgängig» stellt den Stand davor wieder her
    const groessenInhalt = (a) =>
      a.varianten.length > 0
        ? groessenSchalter({
            namen: a.varianten,
            weg: wegVon(a),
            name: a.name,
            kompakt: true,
            beiUmschalten: (v, aus) => schalte(a, v, aus),
          })
        : el("span", { class: "leise" }, "Einheitsgrösse");
    function zeichneZellen(a, fokusName) {
      const tr = koerper.querySelector(`tr[data-id="${a.id}"]`);
      if (!tr) return;
      tr.classList.toggle("inaktiv", !a.verfuegbar);
      tr.querySelector(".ld-groessenzelle").replaceChildren(groessenInhalt(a));
      tr.querySelector(".ld-standzelle").replaceChildren(...standInhalt(a));
      if (fokusName) {
        for (const b of tr.querySelectorAll(".ld-gschalter")) {
          if (b.dataset.name === fokusName) b.focus();
        }
      }
    }
    const meldeWeg = (a, v, aus) =>
      aus
        ? `${v} ist bei «${a.name}» als nicht verfügbar gemeldet.`
        : `${v} ist bei «${a.name}» wieder verfügbar.`;
    let beschaeftigt = false;
    async function setzeWeg(a, liste, fokusName) {
      // Mit Grössen gibt es keinen zweiten Schalter am Artikel: Er gilt als gesetzt, die Grössen entscheiden
      await anfrage("PATCH", `${BASIS}/artikel/${a.id}`, {
        nichtVerfuegbar: liste,
        verfuegbar: true,
      });
      a.nichtVerfuegbar = liste;
      a.verfuegbarGesetzt = true;
      a.verfuegbar = a.varianten.some((x) => !liste.includes(x));
      zeichneZellen(a, fokusName);
    }
    async function schalte(a, v, aus) {
      if (beschaeftigt) return;
      beschaeftigt = true;
      const vorher = [...wegVon(a)];
      const nachher = aus
        ? [...vorher, v].filter((x, i, l) => l.indexOf(x) === i)
        : vorher.filter((x) => x !== v);
      try {
        await setzeWeg(a, nachher, v);
      } catch (f) {
        ctx.melde(`Nicht gespeichert. ${meldungVon(f)}`, "fehler");
        beschaeftigt = false;
        return;
      }
      beschaeftigt = false;
      ctx.melde(meldeWeg(a, v, aus), "ok", {
        text: "Rückgängig",
        onclick: async () => {
          try {
            await setzeWeg(a, vorher, v);
            ctx.melde(meldeWeg(a, v, !aus));
          } catch (f) {
            ctx.melde(meldungVon(f), "fehler");
          }
        },
      });
    }

    const zeileVon = (a, n) =>
      el(
        "tr",
        { class: a.verfuegbar ? undefined : "inaktiv", "data-id": a.id },
        el("td", { class: "ld-griffzelle" }, griff(a)),
        el(
          "th",
          { scope: "row" },
          el(
            "div",
            { class: "ld-artikel" },
            a.mediumId
              ? el("img", {
                  class: "ld-bild",
                  src: `/api/v1/medien/${a.mediumId}?breite=640`,
                  alt: "",
                  loading: "lazy",
                })
              : el("span", { class: "ld-bild ld-bild--leer" }),
            el(
              "span",
              {},
              el("span", { class: "name" }, a.name),
              a.hinweis &&
                el("span", { class: "klein leise ld-unter" }, a.hinweis),
            ),
          ),
        ),
        el(
          "td",
          { class: "zahl", "data-label": "Preis" },
          preisText(a.preisRappen),
        ),
        el(
          "td",
          { class: "ld-groessenzelle", "data-label": "Grösse" },
          groessenInhalt(a),
        ),
        el(
          "td",
          { class: "ld-standzelle", "data-label": "Stand" },
          standInhalt(a),
        ),
        el(
          "td",
          { class: "rechts" },
          el(
            "div",
            { class: "aktionen" },
            knopf("Bearbeiten", {
              klein: true,
              symbol: "bearbeiten",
              kontext: a.name,
              onclick: () =>
                artikelBlatt({ artikel: a, ctx, neu, anzahl: artikel.length }),
            }),
            menue(a.name, [
              n > 0 && {
                text: "Nach oben",
                onclick: () => {
                  const plaetze = merkePlaetze(reihe());
                  schiebe(a.id, -1);
                  rutscheAnPlatz(reihe(), plaetze);
                  void beendeUndSpeichere(a.id, ids0);
                },
              },
              n < artikel.length - 1 && {
                text: "Nach unten",
                onclick: () => {
                  const plaetze = merkePlaetze(reihe());
                  schiebe(a.id, 1);
                  rutscheAnPlatz(reihe(), plaetze);
                  void beendeUndSpeichere(a.id, ids0);
                },
              },
            ]),
          ),
        ),
      );
    koerper.append(...ids0.map((id, n) => zeileVon(nachId.get(id), n)));

    const t = tabelle({
      beschriftung: "Artikel",
      spalten: [
        [el("span", { class: "nur-leser" }, "Position"), "ld-griffspalte"],
        "Artikel",
        ["Preis", "zahl"],
        "Grösse",
        "Stand",
        ["Aktionen", "rechts"],
      ],
      zeilen: [],
    });
    t.koerper.replaceWith(koerper);
    t.wurzel.classList.add("ld-tabelle");
    huelleTabelle = t.wurzel;
    bereich.append(
      el(
        "p",
        { class: "klein leise" },
        `${zaehlwort(artikel.length, "Artikel", "Artikel")}. Ziehe einen Artikel am Griff an seinen Platz. Änderungen erscheinen kurz darauf auf der Website.`,
      ),
      el(
        "p",
        { class: "nur-leser", id: "ld-griff-hilfe" },
        "Leertaste greift den Artikel, Pfeil hoch und runter verschiebt ihn, Leertaste setzt ihn ab, Escape bricht ab.",
      ),
      sage,
      t.wurzel,
    );
  }
  return lade();
}

async function artikelBlatt({ artikel, ctx, neu }) {
  const name = feld({
    label: "Name",
    hilfe: "Höchstens 100 Zeichen.",
    wert: artikel?.name ?? "",
    maxlength: 100,
  });
  const preis = feld({
    label: "Preis in Franken",
    hilfe: "Zum Beispiel 40 oder 12.50. Für einen Gratisartikel 0.",
    wert: artikel ? frankenText(artikel.preisRappen) : "",
    inputmode: "decimal",
    autocomplete: "off",
  });
  // Das Bild: gross neben den Feldern, gewählt aus der Medienbibliothek in der Seite selbst (nur öffentliche Bilder)
  let mediumId = artikel?.mediumId ?? null;
  const bildPlatz = el("div", { class: "ld-bildplatz" });
  const waehlen = knopf("Bild wählen", { klein: true });
  const entfernen = knopf("Bild entfernen", {
    klein: true,
    onclick: () => {
      mediumId = null;
      zeigeBild();
      meldeAenderung();
      waehlen.focus();
    },
  });
  const wahl = bildwahl({
    ausloeser: waehlen,
    gewaehlt: mediumId,
    beiWahl: (m) => {
      mediumId = m.id;
      zeigeBild();
      meldeAenderung();
    },
  });
  function zeigeBild() {
    bildPlatz.replaceChildren(
      mediumId
        ? bildMitLader(
            el("img", {
              src: `/api/v1/medien/${mediumId}?breite=640`,
              alt: "",
              decoding: "async",
            }),
            "ld-grossbild",
          )
        : el("div", { class: "ld-grossbild ld-grossbild--leer" }, "Kein Bild"),
    );
    wahl.setze(mediumId);
    waehlen.lastChild.textContent = mediumId
      ? "Anderes Bild wählen"
      : "Bild wählen";
    entfernen.hidden = !mediumId;
  }
  // Eine Bildwahl ist keine Eingabe im Feld: Das Formular merkt sich trotzdem, dass etwas geändert ist (Rückfrage beim Verlassen)
  const meldeAenderung = () =>
    formular.dispatchEvent(new Event("change", { bubbles: true }));
  // Pflichtangabe «Grösse»: Einheitsgrösse oder eine Liste; ohne Wahl lässt sich nicht speichern
  const groesseName = `groesse-${Math.random().toString(36).slice(2)}`;
  const groesseRadio = (wert, titel, text) => {
    const eingabe = el("input", {
      type: "radio",
      name: groesseName,
      value: wert,
      onchange: () => aktualisiereGroesse(),
    });
    eingabe.checked = artikel?.groessenart === wert;
    return {
      eingabe,
      wurzel: el(
        "label",
        { class: "wahlkarte" },
        eingabe,
        el("div", {}, el("strong", {}, titel), el("span", {}, text)),
      ),
    };
  };
  const einheit = groesseRadio(
    "einheit",
    "Einheitsgrösse",
    "Es gibt den Artikel nur in einer Grösse. Im Lädeli gibt es keine Auswahl.",
  );
  const liste = groesseRadio(
    "liste",
    "Liste mit Grössen",
    "Es gibt mehrere Grössen. Die Person wählt eine davon.",
  );
  const varianten = feld({
    label: "Vorhandene Grössen",
    hilfe:
      "Mindestens zwei, mit Komma getrennt: S, M, L. Höchstens 20, je höchstens 40 Zeichen, keine doppelten.",
    wert: artikel?.varianten.join(", ") ?? "",
    autocomplete: "off",
  });
  // Verfügbarkeit je Grösse (#629): ein Schalter je Grösse der Liste; ausgeschaltete Grössen bleiben sichtbar, lassen sich aber nicht bestellen
  // Ein älterer Artikel mit Grössen und ausgeschaltetem Artikel-Schalter beginnt mit «alle Grössen nicht verfügbar»; beim Speichern wird das so festgehalten
  const weg = new Set(artikel ? wegVon(artikel) : []);
  const schalterOrt = el("div", { class: "ld-gschalter-ort" });
  const gwahl = el(
    "div",
    { class: "ld-gwahl" },
    el(
      "p",
      { class: "ld-gwahl-titel", id: "ld-gwahl-titel" },
      "Verfügbarkeit je Grösse",
    ),
    el(
      "p",
      { class: "hilfe", id: "ld-gwahl-hilfe" },
      "Schalte eine Grösse aus, wenn sie nicht mehr zu haben ist. Sie bleibt im Lädeli sichtbar, durchgestrichen und mit dem Wort «nicht verfügbar».",
    ),
    schalterOrt,
  );
  const aktuelleNamen = () =>
    liste.eingabe.checked ? variantenAus(varianten.eingabe.value) : [];
  function zeichneSchalter(fokusName) {
    const namen = aktuelleNamen();
    // Ein bisher ausgeschalteter Einheitsartikel, der eine Liste bekommt, bleibt nicht verfügbar: Alle Grössen beginnen als nicht verfügbar
    if (!verfuegbar.eingabe.checked) for (const v of namen) weg.add(v);
    gwahl.hidden = namen.length < 2;
    schalterOrt.replaceChildren(
      groessenSchalter({
        namen,
        weg: namen.filter((v) => weg.has(v)),
        beiUmschalten: (v, aus) => {
          if (aus) weg.add(v);
          else weg.delete(v);
          // Wer eine Grösse bedient, hat den Stand des Artikels damit entschieden
          verfuegbar.eingabe.checked = true;
          zeichneSchalter(v);
          meldeAenderung();
          zeigeVorschau();
        },
      }),
    );
    if (fokusName) {
      for (const b of schalterOrt.querySelectorAll(".ld-gschalter")) {
        if (b.dataset.name === fokusName) b.focus();
      }
    }
  }
  const groesse = {
    eingabe: einheit.eingabe,
    wurzel: el(
      "fieldset",
      { class: "feld ld-groesse" },
      el("legend", {}, "Grösse (Pflicht)"),
      el("div", { class: "ld-wahl" }, einheit.wurzel, liste.wurzel),
      varianten.wurzel,
      gwahl,
    ),
  };
  let bereit = false;
  function aktualisiereGroesse() {
    varianten.wurzel.hidden = !liste.eingabe.checked;
    gwahl.hidden = true;
    // Mit Grössen entscheiden allein die Grössen; ohne Liste bleibt die Checkbox die einzige Einstellung
    verfuegbar.wurzel.hidden = liste.eingabe.checked;
    artikelHinweis.hidden = !liste.eingabe.checked;
    if (bereit) zeichneSchalter();
  }
  const hinweis = feld({
    label: "Hinweis (optional)",
    hilfe: "Steht unter dem Preis, höchstens 200 Zeichen.",
    wert: artikel?.hinweis ?? "",
    maxlength: 200,
  });
  const verfuegbar = ankreuzen({
    label: "Verfügbar: Der Artikel lässt sich bestellen",
    gewaehlt: artikel?.verfuegbarGesetzt ?? artikel?.verfuegbar ?? true,
    wert: "verfuegbar",
  });
  const artikelHinweis = el(
    "p",
    { class: "klein leise" },
    "Der Artikel ist bestellbar, solange mindestens eine Grösse verfügbar ist.",
    artikel?.varianten.length > 0 && artikel.verfuegbarGesetzt === false
      ? " Er war bisher als nicht verfügbar gesetzt: Darum sind alle Grössen als nicht verfügbar gemeldet. Schalte eine Grösse ein, damit er wieder bestellbar ist."
      : null,
  );
  aktualisiereGroesse();
  const meldungsfeld = el("div", {});
  // Vorschau rechts: Name, Preis, Hinweis, Grössen und Stand wie in der Liste
  const vorschau = el("div", { class: "ld-vorschau" });
  const zeigeVorschau = () => {
    const rappen = rappenAus(preis.eingabe.value);
    const namen = liste.eingabe.checked
      ? variantenAus(varianten.eingabe.value)
      : [];
    vorschau.replaceChildren(
      el(
        "p",
        { class: "ld-vorschau-name" },
        name.eingabe.value.trim() || "Ohne Namen",
      ),
      el(
        "p",
        { class: "ld-vorschau-preis" },
        rappen === null ? "Preis fehlt" : preisText(rappen),
      ),
      hinweis.eingabe.value.trim() &&
        el("p", { class: "klein leise" }, hinweis.eingabe.value.trim()),
      el(
        "p",
        { class: "klein" },
        namen.length > 0
          ? namen.join(", ")
          : einheit.eingabe.checked
            ? "Einheitsgrösse"
            : "Grösse noch offen",
      ),
      ...vorschauStand(),
    );
  };
  const vorschauStand = () => {
    const namen = aktuelleNamen();
    const stand = standChips({
      verfuegbarGesetzt: namen.length > 0 || verfuegbar.eingabe.checked,
      varianten: namen,
      nichtVerfuegbar: namen.filter((v) => weg.has(v)),
    });
    return [el("ul", { class: "chips" }, stand[0]), ...stand.slice(1)];
  };
  const formular = el(
    "form",
    { class: "formular", novalidate: true, id: "ld-artikel-formular" },
    formularRaster({
      felder: [
        meldungsfeld,
        name.wurzel,
        preis.wurzel,
        groesse.wurzel,
        hinweis.wurzel,
        verfuegbar.wurzel,
        artikelHinweis,
      ],
      seiteTitel: "Bild und Vorschau",
      seite: [
        bildPlatz,
        el("div", { class: "ws-teilaktionen" }, waehlen, entfernen),
        wahl.panel,
        vorschau,
      ],
    }),
  );
  zeigeBild();
  for (const f of [name, preis, varianten, hinweis]) {
    f.eingabe.addEventListener("input", zeigeVorschau);
  }
  varianten.eingabe.addEventListener("input", () => zeichneSchalter());
  bereit = true;
  zeichneSchalter();
  for (const k of [einheit, liste, verfuegbar]) {
    k.eingabe.addEventListener("change", zeigeVorschau);
  }
  zeigeVorschau();
  const speichern = knopf("Speichern", {
    art: "haupt",
    type: "submit",
    form: "ld-artikel-formular",
  });
  const abbrechen = knopf("Abbrechen", {
    onclick: () => dialog.versuchSchliessen(),
  });
  // Löschen steht links, abgesetzt von Abbrechen und Speichern
  const loeschen =
    artikel &&
    knopf("Artikel löschen", {
      art: "gefahr",
      symbol: "papierkorb",
      class: "knopf knopf--gefahr ld-fuss-links",
      onclick: () =>
        // Das Blatt schliesst sofort; bei «Rückgängig» oder Fehler öffnet es wieder. Soll der Artikel nur nicht bestellbar sein, nimmt man das Häkchen bei «Verfügbar» weg
        ctx.mitRueckgaengig({
          text: `Artikel «${artikel.name}» gelöscht. Er verschwindet von der Website, bestehende Bestellungen behalten ihre Positionen`,
          ansicht: {
            weg: () => dialog.close(),
            zurueck: () => artikelBlatt({ artikel, ctx, neu }),
          },
          ausfuehren: () => anfrage("DELETE", `${BASIS}/artikel/${artikel.id}`),
          fehlertext: meldungVon,
          danach: neu,
        }),
    });
  const dialog = seitenblatt({
    titel: artikel ? "Artikel bearbeiten" : "Neuer Artikel",
    untertitel: artikel?.name,
    inhalt: formular,
    fusszeile: [loeschen, abbrechen, speichern],
  });
  const sperre = (an) => {
    for (const f of [name, preis, varianten, hinweis]) {
      f.eingabe.readOnly = an;
    }
    einheit.eingabe.disabled = liste.eingabe.disabled = an;
    speichern.disabled = abbrechen.disabled = an;
    if (loeschen) loeschen.disabled = an;
    if (an) speichern.setAttribute("aria-busy", "true");
    else speichern.removeAttribute("aria-busy");
  };

  formular.addEventListener("submit", async (e) => {
    e.preventDefault();
    entferneFeldFehler(formular);
    ersetze(meldungsfeld);
    const fehler = [];
    const melde = (f, text, wie) => {
      feldFehler(f, text);
      fehler.push({ name: wie, eingabe: f.eingabe });
    };
    const wert = name.eingabe.value.trim();
    if (!wert) melde(name, "Gib dem Artikel einen Namen.", "Name");
    const rappen = rappenAus(preis.eingabe.value);
    if (rappen === null) {
      melde(
        preis,
        "Gib einen Betrag von 0 bis 10000 Franken ein, zum Beispiel 40 oder 12.50.",
        "Preis",
      );
    }
    const art = einheit.eingabe.checked
      ? "einheit"
      : liste.eingabe.checked
        ? "liste"
        : null;
    const namen = art === "liste" ? variantenAus(varianten.eingabe.value) : [];
    if (art === null) {
      melde(
        groesse,
        "Gib die Grösse an: Einheitsgrösse oder eine Liste mit mindestens zwei Grössen.",
        "Grösse",
      );
    } else if (art === "liste") {
      if (namen.length < 2) {
        melde(
          varianten,
          "Gib mindestens zwei verschiedene Grössen an. Gibt es nur eine, wähle Einheitsgrösse.",
          "Grössen",
        );
      } else if (namen.length > 20 || namen.some((v) => v.length > 40)) {
        melde(
          varianten,
          "Höchstens 20 Grössen mit je höchstens 40 Zeichen.",
          "Grössen",
        );
      }
    }
    if (fehler.length > 0) {
      const h = pruefHinweis(fehler);
      ersetze(meldungsfeld, h);
      h.focus();
      return;
    }
    const koerper = {
      name: wert,
      preisRappen: rappen,
      mediumId,
      groessenart: art,
      ...(art === "liste" && {
        varianten: namen,
        nichtVerfuegbar: namen.filter((v) => weg.has(v)),
      }),
      hinweis: hinweis.eingabe.value.trim() || null,
      // Mit Grössen entscheiden die Grössen
      verfuegbar: art === "liste" ? true : verfuegbar.eingabe.checked,
    };
    sperre(true);
    try {
      await (artikel
        ? anfrage("PATCH", `${BASIS}/artikel/${artikel.id}`, koerper)
        : anfrage("POST", `${BASIS}/artikel`, koerper));
    } catch (f) {
      sperre(false);
      const h = el(
        "div",
        { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
        `Nicht gespeichert. ${meldungVon(f)} Deine Eingaben sind noch da, speichere nochmals.`,
      );
      ersetze(meldungsfeld, h);
      h.focus();
      return;
    }
    dialog.close();
    ctx.melde(`Artikel «${wert}» gespeichert.`);
    await neu();
    document.querySelector("h1")?.focus();
  });
}

// ===== Einstellungen =====
// Alles, was eine Abteilung am Lädeli selbst bestimmt (#642): Bestellen, Übergabe, Bezahlung, Grenzen, Bedingungen. Die Texte und Regeln, die vorher im Code standen, sind hier die Vorgaben; was die Abteilung nicht ändert, gilt weiter. Rechts steht eine Vorschau, unten die Speicherleiste.

const SCHALTER = [
  {
    k: "bestellenOffen",
    label: "Bestellungen annehmen",
    hilfe:
      "Aus: Das Lädeli zeigt die Artikel weiter, nimmt aber nichts mehr an. Der Text unten erklärt es den Besuchern.",
  },
  {
    k: "schnellDazu",
    label: "«Schnell dazu» auf den Kacheln",
    hilfe:
      "Das Plus auf der Kachel legt einen Artikel mit zwei Klicks in den Warenkorb.",
  },
  {
    k: "preiseOeffentlich",
    label: "Preise für alle sichtbar",
    hilfe:
      "Aus: Besucher ohne Konto sehen «Preis nach Anmeldung». Wer angemeldet ist, sieht den Preis.",
  },
];
const EINST_TEXTE = [
  {
    k: "geschlossenText",
    label: "Text, wenn das Lädeli geschlossen ist",
    hilfe: "Steht über den Artikeln und in der Bestellübersicht.",
    max: 200,
    rows: 2,
  },
  {
    k: "uebergabehinweis",
    label: "Hinweis zur Übergabe (optional)",
    hilfe:
      "Wann und wo ihr übergebt, zum Beispiel «Samstags nach dem Treffen im Lagerhaus». Steht über den Artikeln, im Artikel und in der Bestellübersicht.",
    max: 200,
    rows: 2,
  },
  {
    k: "bezahlhinweis",
    label: "Hinweis zur Bezahlung",
    hilfe:
      "Ein Satz im Kopf des Lädelis, im Artikel und im Warenkorb. Leer: kein Hinweis.",
    max: 120,
    rows: 2,
  },
  {
    k: "zahlungsart",
    label: "Zahlung in der Bestellübersicht",
    hilfe: "Steht neben «Bezahlung». Leer: Die Zeile entfällt.",
    max: 60,
  },
  {
    k: "bestaetigung",
    label: "Meldung nach dem Bestellen",
    hilfe:
      "«{uebergabe}» wird durch die gewählte Übergabeart ersetzt. Leer: nur «Deine Bestellung ist eingegangen.»",
    max: 240,
    rows: 3,
  },
  {
    k: "bedingungen",
    label: "Bestellbedingungen (optional)",
    hilfe:
      "Zum Beispiel zu Umtausch oder Abholfrist. Ein Absatz je Zeile; sie stehen in der Bestellübersicht vor dem Bestellen.",
    max: 600,
    rows: 5,
  },
];
const ZAHLEN = [
  {
    k: "maxMenge",
    label: "Höchstmenge je Artikel",
    hilfe: "Von 1 bis 99 Stück.",
    min: 1,
    max: 99,
  },
  {
    k: "maxPositionen",
    label: "Verschiedene Artikel je Bestellung",
    hilfe: "Von 1 bis 50.",
    min: 1,
    max: 50,
  },
  {
    k: "maxOffene",
    label: "Offene Bestellungen je Person",
    hilfe:
      "Von 1 bis 20. Wer so viele offene hat, bestellt erst wieder, wenn eine übergeben oder storniert ist.",
    min: 1,
    max: 20,
  },
];

// Rappen im Feld: «20», «12.50»
const frankenFeld = (rappen) =>
  rappen % 100 === 0 ? String(rappen / 100) : frankenText(rappen);
const artenAus = (text) => [
  ...new Set(
    text
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];
// Absätze der Vorschau: eine Zeile, ein Absatz
const absaetze = (text) =>
  text
    .split("\n")
    .filter((t) => t.trim() !== "")
    .map((t) => el("p", {}, t));

function zeigeEinstellungen(bereich, ctx) {
  return ctx.lade(
    () => anfrage("GET", `${BASIS}/einstellungen`),
    (daten) => {
      const vorgaben = daten.vorgaben;
      const schluessel = [
        "uebergabearten",
        ...SCHALTER.map((s) => s.k),
        ...EINST_TEXTE.map((t) => t.k),
        ...ZAHLEN.map((z) => z.k),
        "mindestRappen",
      ];
      const nimm = (d) => Object.fromEntries(schluessel.map((k) => [k, d[k]]));
      let gespeichert = nimm(daten);

      // --- Felder
      const arten = feld({
        label: "Übergabearten",
        hilfe:
          "Eine je Zeile, mindestens eine, höchstens fünf, je höchstens 80 Zeichen. Wer bestellt, wählt eine davon. Bei nur einer entfällt die Wahl.",
        wert: gespeichert.uebergabearten.join("\n"),
        mehrzeilig: true,
        rows: 4,
      });
      const schalter = Object.fromEntries(
        SCHALTER.map((s) => {
          const a = ankreuzen({
            label: s.label,
            gewaehlt: gespeichert[s.k],
          });
          const hilfeId = `ld-${s.k}-hilfe`;
          a.eingabe.setAttribute("aria-describedby", hilfeId);
          // Hilfe unter dem Schalter, nicht in der Zeile des Kontrollkästchens
          return [
            s.k,
            {
              ...a,
              wurzel: el(
                "div",
                { class: "ld-schalter" },
                a.wurzel,
                el("p", { class: "hilfe", id: hilfeId }, s.hilfe),
              ),
            },
          ];
        }),
      );
      const texte = Object.fromEntries(
        EINST_TEXTE.map((t) => {
          const f = feld({
            label: t.label,
            hilfe: t.hilfe,
            wert: gespeichert[t.k],
            mehrzeilig: true,
            rows: t.rows ?? 2,
            maxlength: t.max,
            class: (t.rows ?? 2) <= 3 ? "ld-kurz" : undefined,
          });
          // «Standardtext»: stellt den Text von früher her; nur sichtbar, wenn er davon abweicht
          const zurueck = knopf("Standardtext einsetzen", {
            klein: true,
            onclick: () => {
              f.eingabe.value = vorgaben[t.k];
              f.eingabe.dispatchEvent(new Event("input"));
              f.eingabe.focus();
            },
          });
          f.wurzel.append(zurueck);
          const zeigeZurueck = () => {
            zurueck.hidden = f.eingabe.value === vorgaben[t.k];
          };
          zeigeZurueck();
          f.eingabe.addEventListener("input", zeigeZurueck);
          return [t.k, f];
        }),
      );
      const zahlen = Object.fromEntries(
        ZAHLEN.map((z) => [
          z.k,
          feld({
            label: z.label,
            hilfe: z.hilfe,
            wert: String(gespeichert[z.k]),
            inputmode: "numeric",
            autocomplete: "off",
            maxlength: 2,
          }),
        ]),
      );
      const mindest = feld({
        label: "Mindestbestellung in Franken",
        hilfe:
          "Zum Beispiel 20 oder 12.50. 0 heisst keine Mindestbestellung; was darunter liegt, lässt sich nicht bestellen.",
        wert: frankenFeld(gespeichert.mindestRappen),
        inputmode: "decimal",
        autocomplete: "off",
      });

      // --- Stand der Felder als Werte; zahl: Fehler als Text
      const lies = () => {
        const w = {
          uebergabearten: artenAus(arten.eingabe.value),
          mindestRappen: null,
        };
        for (const s of SCHALTER) w[s.k] = schalter[s.k].eingabe.checked;
        for (const t of EINST_TEXTE) w[t.k] = texte[t.k].eingabe.value.trim();
        for (const z of ZAHLEN) {
          const roh = zahlen[z.k].eingabe.value.trim();
          const n = /^\d{1,2}$/.test(roh) ? Number(roh) : NaN;
          w[z.k] = n >= z.min && n <= z.max ? n : null;
        }
        w.mindestRappen = rappenAus(mindest.eingabe.value);
        return w;
      };
      const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

      // --- Vorschau rechts: so erscheint es im Lädeli
      const vorschau = el("div", { class: "ld-vorschau ld-einst-vorschau" });
      const abschnitt = (titel, ...inhalt) =>
        el(
          "section",
          { class: "ld-einst-block" },
          el("h3", {}, titel),
          ...inhalt,
        );
      const zeigeVorschau = () => {
        const w = lies();
        const erste = w.uebergabearten[0] ?? "Abholung im Lädeli";
        const leiste = w.bestellenOffen
          ? ["Bestellen mit Konto", w.bezahlhinweis.replace(/\.$/, "")]
              .filter(Boolean)
              .join(" · ")
          : w.geschlossenText;
        const mindestText =
          w.mindestRappen !== null && w.mindestRappen > 0
            ? `Mindestbestellung ${preisText(w.mindestRappen)}`
            : null;
        vorschau.replaceChildren(
          abschnitt(
            "Kopf des Lädelis",
            el("p", { class: "ld-einst-leise" }, `5 Artikel · ${leiste}`),
            w.uebergabehinweis ? el("p", {}, w.uebergabehinweis) : null,
          ),
          abschnitt(
            "Kachel",
            el(
              "p",
              { class: "ld-vorschau-preis" },
              w.preiseOeffentlich
                ? "Foulard · CHF 25.–"
                : "Foulard · Preis nach Anmeldung",
            ),
            w.schnellDazu && w.bestellenOffen
              ? el("p", { class: "ld-einst-leise" }, "Mit Plus «Schnell dazu»")
              : el("p", { class: "ld-einst-leise" }, "Ohne «Schnell dazu»"),
          ),
          abschnitt(
            "Bestellübersicht",
            el("p", {}, `Übergabe: ${erste}`),
            w.zahlungsart ? el("p", {}, `Bezahlung: ${w.zahlungsart}`) : null,
            mindestText ? el("p", {}, mindestText) : null,
            ...absaetze(w.bedingungen),
          ),
          abschnitt(
            "Warenkorb",
            w.bezahlhinweis
              ? el("p", {}, w.bezahlhinweis)
              : el("p", { class: "ld-einst-leise" }, "Kein Hinweis"),
          ),
          abschnitt(
            "Nach dem Bestellen",
            el(
              "p",
              {},
              w.bestaetigung
                ? w.bestaetigung.replaceAll("{uebergabe}", erste)
                : "Deine Bestellung ist eingegangen.",
            ),
          ),
          abschnitt(
            "Grenzen",
            el(
              "p",
              {},
              [
                w.maxMenge === null
                  ? null
                  : `Höchstens ${w.maxMenge} Stück je Artikel`,
                w.maxPositionen === null
                  ? null
                  : `${w.maxPositionen} verschiedene Artikel je Bestellung`,
                w.maxOffene === null
                  ? null
                  : `${w.maxOffene} offene Bestellungen je Person`,
              ]
                .filter(Boolean)
                .join(" · "),
            ),
          ),
        );
      };

      // --- Speicherleiste unten
      const meldungsfeld = el("div", {});
      const aktualisiere = () => {
        if (gleich(lies(), gespeichert)) leiste.verstecke();
        else {
          leiste.zeige(
            "Die Einstellungen sind geändert, noch nicht gespeichert.",
          );
        }
      };
      const setzeFelder = (w) => {
        arten.eingabe.value = w.uebergabearten.join("\n");
        for (const s of SCHALTER) schalter[s.k].eingabe.checked = w[s.k];
        for (const t of EINST_TEXTE) {
          texte[t.k].eingabe.value = w[t.k];
          texte[t.k].eingabe.dispatchEvent(new Event("input"));
        }
        for (const z of ZAHLEN) zahlen[z.k].eingabe.value = String(w[z.k]);
        mindest.eingabe.value = frankenFeld(w.mindestRappen);
      };
      const leiste = speicherLeiste({
        beiSpeichern: (k) => speichere(k),
        beiVerwerfen: () => {
          setzeFelder(gespeichert);
          entferneFeldFehler(formular);
          ersetze(meldungsfeld);
          zeigeVorschau();
          aktualisiere();
        },
      });
      const abschnittForm = (titel, hilfe, ...inhalt) =>
        el(
          "section",
          { class: "ld-einst-abschnitt" },
          el("h3", {}, titel),
          hilfe ? el("p", { class: "leise" }, hilfe) : null,
          ...inhalt,
        );
      const formular = el(
        "form",
        { class: "formular ld-einstellungen", novalidate: true },
        meldungsfeld,
        abschnittForm(
          "Bestellen",
          "Was Besucher und Angemeldete im Lädeli tun können.",
          ...SCHALTER.map((s) => schalter[s.k].wurzel),
          texte.geschlossenText.wurzel,
        ),
        abschnittForm(
          "Übergabe",
          "Eine Bestellung nennt, wie sie übergeben wird. Eine Lieferadresse gibt es nicht.",
          arten.wurzel,
          texte.uebergabehinweis.wurzel,
        ),
        abschnittForm(
          "Bezahlung",
          "Das Lädeli kennt keine Zahlung im Netz. Hier steht, was die Leute lesen.",
          texte.bezahlhinweis.wurzel,
          texte.zahlungsart.wurzel,
          texte.bestaetigung.wurzel,
        ),
        abschnittForm(
          "Grenzen",
          "Der Server prüft jede Grenze beim Bestellen.",
          ...ZAHLEN.map((z) => zahlen[z.k].wurzel),
          mindest.wurzel,
        ),
        abschnittForm("Bedingungen", null, texte.bedingungen.wurzel),
      );
      formular.addEventListener("submit", (e) => e.preventDefault());
      const beiAenderung = () => {
        zeigeVorschau();
        aktualisiere();
      };
      formular.addEventListener("input", beiAenderung);
      formular.addEventListener("change", beiAenderung);

      async function speichere(knopfNode) {
        entferneFeldFehler(formular);
        ersetze(meldungsfeld);
        const w = lies();
        const fehler = [];
        const ungueltig = (f, text) => {
          feldFehler(f, text);
          fehler.push(f);
        };
        if (
          w.uebergabearten.length < 1 ||
          w.uebergabearten.length > 5 ||
          w.uebergabearten.some((v) => v.length > 80)
        ) {
          ungueltig(
            arten,
            "Trage eine bis fünf Übergabearten ein, je höchstens 80 Zeichen.",
          );
        }
        for (const z of ZAHLEN) {
          if (w[z.k] === null) {
            ungueltig(
              zahlen[z.k],
              `Trage eine ganze Zahl von ${z.min} bis ${z.max} ein.`,
            );
          }
        }
        if (w.mindestRappen === null) {
          ungueltig(
            mindest,
            "Trage einen Betrag bis 10 000 Franken ein, zum Beispiel 20 oder 12.50.",
          );
        }
        for (const t of EINST_TEXTE) {
          if (w[t.k].length > t.max) {
            ungueltig(
              texte[t.k],
              `Höchstens ${t.max} Zeichen. Der Text hat ${w[t.k].length}.`,
            );
          }
        }
        if (fehler.length > 0) {
          const h = pruefHinweis(
            fehler.map((f) => ({
              name: f.wurzel.querySelector("label")?.textContent ?? "Feld",
              eingabe: f.eingabe,
            })),
          );
          ersetze(meldungsfeld, h);
          h.focus();
          return;
        }
        knopfNode.disabled = true;
        knopfNode.setAttribute("aria-busy", "true");
        try {
          await anfrage("PUT", `${BASIS}/einstellungen`, w);
          gespeichert = w;
          zeigeVorschau();
          aktualisiere();
          ctx.melde(
            "Einstellungen gespeichert. Die Website zeigt sie in wenigen Sekunden.",
          );
        } catch (f) {
          const h = el(
            "div",
            { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
            `Nicht gespeichert. ${meldungVon(f)} Deine Eingaben sind noch da, speichere nochmals.`,
          );
          ersetze(meldungsfeld, h);
          h.focus();
        } finally {
          knopfNode.disabled = false;
          knopfNode.removeAttribute("aria-busy");
        }
      }
      zeigeVorschau();
      bereich.append(
        formularRaster({
          felder: formular,
          seiteTitel: "So erscheint es im Lädeli",
          seite: vorschau,
        }),
        leiste.wurzel,
      );
    },
    { skeleton: "formular" },
  );
}

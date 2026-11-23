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
import {
  entferneFeldFehler,
  ersetze,
  feldFehler,
  pruefHinweis,
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

export function zeige(bereich, ctx) {
  const unter = ctx.seite.unter.schluessel;
  if (unter === "artikel") return zeigeArtikel(bereich, ctx);
  if (unter === "einstellungen") return zeigeEinstellungen(bereich, ctx);
  return zeigeBestellungen(bereich, ctx);
}

// ===== Bestellungen =====

// Karten, solange die Bestellungen laden: Name, Summe, Schiene mit drei Schritten, Positionen, Aktion
function skeletonBestellungen() {
  const karte = () =>
    el(
      "div",
      { class: "ld-bestellung" },
      el(
        "div",
        { class: "ld-bestellung-kopf" },
        el("div", {}, sk("t", 136), sk("t", 112)),
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

    // Statusschiene: Offen, Bereit, Übergeben. Erledigte Schritte tragen einen Haken, der aktuelle ist gefüllt und «aktueller Schritt» für Screenreader; Zustand nie nur über Farbe
    function schiene(b) {
      if (b.status === "storniert") {
        return el(
          "ul",
          { class: "chips" },
          chip(STAND.storniert.text, STAND.storniert.art, "sperre"),
        );
      }
      const schritte = [
        ["offen", "Offen"],
        ["bereit", "Bereit"],
        ["uebergeben", "Übergeben"],
      ];
      const aktuell = schritte.findIndex(([w]) => w === b.status);
      return el(
        "ol",
        { class: "ld-schiene", "aria-label": "Stand der Bestellung" },
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
          ),
        ),
      );
    }

    function karte(b) {
      const wurzel = el("article", {
        class: "ld-bestellung",
        "aria-label": `Bestellung von ${wer(b)}`,
      });
      const aktion = aktionen(b, wurzel);
      wurzel.append(
        el(
          "header",
          { class: "ld-bestellung-kopf" },
          el(
            "div",
            {},
            el("h3", { class: "ld-bestellung-name" }, wer(b)),
            b.person.ceviName &&
              el("span", { class: "klein leise ld-unter" }, b.person.name),
            el(
              "span",
              { class: "klein leise ld-unter" },
              stempel(b.erstelltAm),
            ),
          ),
          el("p", { class: "ld-summe" }, summeText(b.summeRappen)),
        ),
        schiene(b),
        el(
          "ul",
          { class: "ld-positionen" },
          b.positionen.map((p) =>
            el(
              "li",
              {},
              `${p.menge} × ${p.name}`,
              p.variante && el("span", { class: "leise" }, `, ${p.variante}`),
            ),
          ),
        ),
        el("p", { class: "klein leise ld-uebergabe" }, b.uebergabe),
        aktion &&
          el("div", { class: "ld-bestellung-aktion" }, aktion.wurzel ?? aktion),
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
        meldung.textContent = `${zaehlwort(seite.bestellungen.length, "weitere Bestellung", "weitere Bestellungen")} geladen.`;
        zeichneListe();
      } catch (f) {
        meldung.textContent = `${fehlertext(f)} Versuche es nochmals.`;
      } finally {
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
          [
            knopf("Neuer Artikel", {
              symbol: "plus",
              onclick: () => artikelBlatt({ ctx, neu, anzahl: 0 }),
            }),
          ],
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
    // Eine laufende Zeigerbewegung (Maus, Finger)
    let zug = null;

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
      // Maus und Finger: Die gezogene Zeile folgt dem Zeiger, eine Kante zeigt, wo sie landet; erst beim Loslassen wandert sie dorthin (sonst verlöre der Griff den Zeiger)
      const markeLoeschen = () => {
        for (const z of reihe()) z.classList.remove("ld-vor", "ld-nach");
      };
      knopfGriff.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || gegriffen) return;
        e.preventDefault();
        knopfGriff.setPointerCapture(e.pointerId);
        zug = { id: a.id, start: e.clientY, davor: undefined };
        zeile().classList.add("ld-gezogen");
        document.body.classList.add("ld-zieht");
      });
      knopfGriff.addEventListener("pointermove", (e) => {
        if (!zug || zug.id !== a.id) return;
        const mich = zeile();
        mich.style.transform = `translateY(${e.clientY - zug.start}px)`;
        const andere = reihe().filter((z) => z !== mich);
        const davor = andere.find((z) => {
          const r = z.getBoundingClientRect();
          return e.clientY < r.top + r.height / 2;
        });
        markeLoeschen();
        zug.davor = davor ?? null;
        if (davor) davor.classList.add("ld-vor");
        else andere.at(-1)?.classList.add("ld-nach");
        // Am Rand des Fensters rollt die Seite mit
        if (e.clientY < 70) window.scrollBy(0, -12);
        else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
      });
      const loslassen = (abbruch) => {
        if (!zug || zug.id !== a.id) return;
        const { davor } = zug;
        const vorher = idsJetzt();
        zug = null;
        const mich = zeile();
        mich.classList.remove("ld-gezogen");
        mich.style.transform = "";
        markeLoeschen();
        document.body.classList.remove("ld-zieht");
        if (abbruch || davor === undefined) return;
        if (davor) davor.before(mich);
        else koerper.append(mich);
        ansage(platzText(a.id));
        void beendeUndSpeichere(a.id, vorher);
      };
      knopfGriff.addEventListener("pointerup", () => loslassen(false));
      knopfGriff.addEventListener("pointercancel", () => loslassen(true));
      return knopfGriff;
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
                  src: `/api/v1/medien/${a.mediumId}`,
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
        el("td", { class: "zahl" }, preisText(a.preisRappen)),
        el(
          "td",
          {},
          a.varianten.length > 0
            ? a.varianten.join(", ")
            : el("span", { class: "leise" }, "Einheitsgrösse"),
        ),
        el(
          "td",
          {},
          el(
            "ul",
            { class: "chips" },
            a.verfuegbar
              ? chip("Verfügbar", "ok")
              : chip("Nicht verfügbar", "warn"),
          ),
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
                  schiebe(a.id, -1);
                  void beendeUndSpeichere(a.id, ids0);
                },
              },
              n < artikel.length - 1 && {
                text: "Nach unten",
                onclick: () => {
                  schiebe(a.id, 1);
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
              src: `/api/v1/medien/${mediumId}`,
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
  const groesse = {
    eingabe: einheit.eingabe,
    wurzel: el(
      "fieldset",
      { class: "feld ld-groesse" },
      el("legend", {}, "Grösse (Pflicht)"),
      el("div", { class: "ld-wahl" }, einheit.wurzel, liste.wurzel),
      varianten.wurzel,
    ),
  };
  function aktualisiereGroesse() {
    varianten.wurzel.hidden = !liste.eingabe.checked;
  }
  aktualisiereGroesse();
  const hinweis = feld({
    label: "Hinweis (optional)",
    hilfe: "Steht unter dem Preis, höchstens 200 Zeichen.",
    wert: artikel?.hinweis ?? "",
    maxlength: 200,
  });
  const verfuegbar = ankreuzen({
    label: "Verfügbar: Der Artikel lässt sich bestellen",
    gewaehlt: artikel?.verfuegbar ?? true,
    wert: "verfuegbar",
  });
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
      el(
        "ul",
        { class: "chips" },
        verfuegbar.eingabe.checked
          ? chip("Verfügbar", "ok")
          : chip("Nicht verfügbar", "warn"),
      ),
    );
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
      ...(art === "liste" && { varianten: namen }),
      hinweis: hinweis.eingabe.value.trim() || null,
      verfuegbar: verfuegbar.eingabe.checked,
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

function zeigeEinstellungen(bereich, ctx) {
  return ctx.lade(
    () => anfrage("GET", `${BASIS}/einstellungen`),
    (daten) => {
      const arten = feld({
        label: "Übergabearten",
        hilfe:
          "Eine je Zeile, mindestens eine, höchstens fünf, je höchstens 80 Zeichen. Wer bestellt, wählt eine davon. Bei nur einer entfällt die Wahl.",
        wert: daten.uebergabearten.join("\n"),
        mehrzeilig: true,
        rows: 5,
      });
      const meldungsfeld = el("div", {});
      const speichern = knopf("Speichern", { art: "haupt", type: "submit" });
      const formular = el(
        "form",
        { class: "formular ld-einstellungen", novalidate: true },
        meldungsfeld,
        el(
          "p",
          { class: "leise" },
          "Eine Bestellung nennt, wie sie übergeben wird. Bezahlt wird immer bei der Übergabe; eine Lieferadresse gibt es nicht.",
        ),
        arten.wurzel,
        el("div", { class: "aktionen aktionen--unten" }, speichern),
      );
      formular.addEventListener("submit", async (e) => {
        e.preventDefault();
        entferneFeldFehler(formular);
        ersetze(meldungsfeld);
        const liste = [
          ...new Set(
            arten.eingabe.value
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean),
          ),
        ];
        if (
          liste.length < 1 ||
          liste.length > 5 ||
          liste.some((v) => v.length > 80)
        ) {
          feldFehler(
            arten,
            "Trage eine bis fünf Übergabearten ein, je höchstens 80 Zeichen.",
          );
          arten.eingabe.focus();
          return;
        }
        speichern.disabled = true;
        speichern.setAttribute("aria-busy", "true");
        try {
          await anfrage("PUT", `${BASIS}/einstellungen`, {
            uebergabearten: liste,
          });
          arten.eingabe.value = liste.join("\n");
          ctx.melde("Übergabearten gespeichert.");
        } catch (f) {
          const h = el(
            "div",
            { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
            `Nicht gespeichert. ${meldungVon(f)} Deine Eingaben sind noch da, speichere nochmals.`,
          );
          ersetze(meldungsfeld, h);
          h.focus();
        } finally {
          speichern.disabled = false;
          speichern.removeAttribute("aria-busy");
        }
      });
      bereich.append(formular);
    },
    { skeleton: "formular" },
  );
}

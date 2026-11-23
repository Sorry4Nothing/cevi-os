import { anfrage, fehlertext } from "./api.js";
import {
  ankreuzen,
  auswahl,
  bestaetigen,
  chip,
  el,
  feld,
  filterGruppe,
  knopf,
  seitenblatt,
  tabelle,
} from "./dom.js";
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

function zeigeBestellungen(bereich, ctx) {
  let stand = "offen";
  const adresse = () =>
    `${BASIS}/bestellungen?limit=${SEITE}${stand ? `&status=${stand}` : ""}`;
  const lade = () =>
    ctx.lade(
      () => anfrage("GET", adresse()),
      (erste) => zeichne(erste),
      { fehlerTitel: "Die Bestellungen konnten nicht geladen werden." },
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
    // Was in diesem Stand geht (WECHSEL in src/laden/laden.ts); fehlt ein Wechsel, fehlt der Knopf
    function aktionen(b) {
      const k = [];
      if (b.status === "offen") {
        k.push(
          knopf("Bereit melden", {
            klein: true,
            kontext: wer(b),
            onclick: () =>
              setze(b, "bereit", `Bestellung von ${wer(b)} ist bereit.`),
          }),
        );
      }
      if (b.status === "bereit") {
        k.push(
          knopf("Zurück auf offen", {
            klein: true,
            kontext: wer(b),
            onclick: () =>
              setze(b, "offen", `Bestellung von ${wer(b)} ist wieder offen.`),
          }),
        );
      }
      if (b.status === "offen" || b.status === "bereit") {
        k.push(
          knopf("Übergeben", {
            klein: true,
            symbol: "haken",
            kontext: wer(b),
            onclick: () =>
              bestaetigen({
                titel: "Bestellung übergeben?",
                beschreibung: `Die Bestellung von ${wer(b)} über ${summeText(b.summeRappen)} gilt danach als übergeben und bezahlt. Das lässt sich nicht zurücknehmen.`,
                ok: "Als übergeben eintragen",
                gefaehrlich: false,
                aktion: () =>
                  anfrage("POST", `${BASIS}/bestellungen/${b.id}/status`, {
                    status: "uebergeben",
                  }),
                danach: async () => {
                  ctx.melde(`Bestellung von ${wer(b)} ist übergeben.`);
                  ersetze(bereich);
                  await lade();
                  document.querySelector("h1")?.focus();
                },
              }),
          }),
          knopf("Stornieren", {
            klein: true,
            art: "gefahr",
            kontext: wer(b),
            onclick: () =>
              bestaetigen({
                titel: "Bestellung stornieren?",
                beschreibung: `Die Bestellung von ${wer(b)} über ${summeText(b.summeRappen)} wird storniert. Das lässt sich nicht zurücknehmen.`,
                ok: "Bestellung stornieren",
                aktion: () =>
                  anfrage("POST", `${BASIS}/bestellungen/${b.id}/status`, {
                    status: "storniert",
                  }),
                danach: async () => {
                  ctx.melde(`Bestellung von ${wer(b)} ist storniert.`);
                  ersetze(bereich);
                  await lade();
                  document.querySelector("h1")?.focus();
                },
              }),
          }),
        );
      }
      return k;
    }

    function zeile(b) {
      const s = STAND[b.status];
      return el(
        "tr",
        {},
        el(
          "th",
          { scope: "row" },
          el("span", { class: "name" }, wer(b)),
          b.person.ceviName &&
            el("span", { class: "klein leise ld-unter" }, b.person.name),
          el("span", { class: "klein leise ld-unter" }, stempel(b.erstelltAm)),
        ),
        el(
          "td",
          {},
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
          el("span", { class: "klein leise ld-unter" }, b.uebergabe),
        ),
        el("td", { class: "zahl" }, summeText(b.summeRappen)),
        el(
          "td",
          {},
          el("ul", { class: "chips" }, chip(s.text, s.art, s.symbol)),
        ),
        el(
          "td",
          { class: "rechts" },
          el("div", { class: "aktionen" }, aktionen(b)),
        ),
      );
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
        tabelle({
          beschriftung: "Bestellungen",
          spalten: [
            "Wer und wann",
            "Bestellt",
            ["Summe", "zahl"],
            "Stand",
            "Aktionen",
          ],
          zeilen: bestellungen.map(zeile),
        }).wurzel,
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

// Die Bilder für die Auswahl, höchstens einmal je Besuch der Seite und erst, wenn ein Blatt sie braucht
let medienMerker = null;
const ladeMedien = () => {
  medienMerker ??= anfrage("GET", "/api/v1/redaktion/medien").then((a) =>
    a.medien.filter(
      (m) => m.sichtbarkeit === "oeffentlich" && m.mimeTyp.startsWith("image/"),
    ),
  );
  medienMerker.catch(() => (medienMerker = null));
  return medienMerker;
};

function zeigeArtikel(bereich, ctx) {
  medienMerker = null;
  const lade = () =>
    ctx.lade(
      () => anfrage("GET", `${BASIS}/artikel`),
      (daten) => zeichne(daten.artikel),
      { fehlerTitel: "Die Artikel konnten nicht geladen werden." },
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
    const t = tabelle({
      beschriftung: "Artikel",
      spalten: [
        "Artikel",
        ["Preis", "zahl"],
        "Varianten",
        "Stand",
        ["Reihenfolge", "zahl"],
        "Aktionen",
      ],
      zeilen: artikel.map((a) =>
        el(
          "tr",
          { class: a.verfuegbar ? undefined : "inaktiv" },
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
              : el("span", { class: "leise" }, "Keine"),
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
          el("td", { class: "zahl" }, String(a.reihenfolge)),
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
                  artikelBlatt({
                    artikel: a,
                    ctx,
                    neu,
                    anzahl: artikel.length,
                  }),
              }),
            ),
          ),
        ),
      ),
    });
    bereich.append(
      el(
        "p",
        { class: "klein leise" },
        `${zaehlwort(artikel.length, "Artikel", "Artikel")}. Änderungen erscheinen kurz darauf auf der Website.`,
      ),
      t.wurzel,
    );
  }
  return lade();
}

async function artikelBlatt({ artikel, ctx, neu }) {
  let medien;
  try {
    medien = await ladeMedien();
  } catch (f) {
    ctx.melde(meldungVon(f), "fehler");
    return;
  }
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
  const bild = auswahl({
    label: "Bild",
    optionen: [
      ["", "Kein Bild"],
      // Ein gewähltes Bild, das nicht unter den jüngsten 200 ist, bleibt wählbar
      ...(artikel?.mediumId && !medien.some((m) => m.id === artikel.mediumId)
        ? [
            [
              artikel.mediumId,
              "Aktuelles Bild",
              `/api/v1/medien/${artikel.mediumId}`,
            ],
          ]
        : []),
      ...medien.map((m) => [
        m.id,
        m.altText || "Bild ohne Beschreibung",
        m.url,
      ]),
    ],
    wert: artikel?.mediumId ?? "",
  });
  const varianten = feld({
    label: "Varianten (optional)",
    hilfe:
      "Zum Beispiel Grössen, mit Komma getrennt: S, M, L. Höchstens 20, je höchstens 40 Zeichen. Ohne Eintrag gibt es keine Auswahl.",
    wert: artikel?.varianten.join(", ") ?? "",
    autocomplete: "off",
  });
  const hinweis = feld({
    label: "Hinweis (optional)",
    hilfe: "Steht unter dem Preis, höchstens 200 Zeichen.",
    wert: artikel?.hinweis ?? "",
    maxlength: 200,
  });
  const reihenfolge = feld({
    label: "Reihenfolge (optional)",
    hilfe:
      "Kleinere Zahlen stehen weiter vorn, von 0 bis 9999. Ohne Eingabe kommt ein neuer Artikel ans Ende.",
    typ: "number",
    wert: artikel?.reihenfolge ?? "",
    min: 0,
    max: 9999,
    step: 1,
    inputmode: "numeric",
  });
  const verfuegbar = ankreuzen({
    label: "Verfügbar: Der Artikel lässt sich bestellen",
    gewaehlt: artikel?.verfuegbar ?? true,
    wert: "verfuegbar",
  });
  const meldungsfeld = el("div", {});
  const formular = el(
    "form",
    { class: "formular", novalidate: true, id: "ld-artikel-formular" },
    meldungsfeld,
    name.wurzel,
    preis.wurzel,
    bild.wurzel,
    varianten.wurzel,
    hinweis.wurzel,
    reihenfolge.wurzel,
    verfuegbar.wurzel,
  );
  const speichern = knopf("Speichern", {
    art: "haupt",
    type: "submit",
    form: "ld-artikel-formular",
  });
  const abbrechen = knopf("Abbrechen", { onclick: () => dialog.close() });
  // Löschen steht links, abgesetzt von Abbrechen und Speichern
  const loeschen =
    artikel &&
    knopf("Artikel löschen", {
      art: "gefahr",
      symbol: "papierkorb",
      class: "knopf knopf--gefahr ld-fuss-links",
      onclick: () =>
        bestaetigen({
          titel: "Artikel löschen?",
          beschreibung: `«${artikel.name}» wird endgültig gelöscht und verschwindet von der Website. Bestehende Bestellungen behalten ihre Positionen. Soll er nur nicht bestellbar sein, nimm das Häkchen bei «Verfügbar» weg.`,
          ok: "Artikel löschen",
          aktion: () => anfrage("DELETE", `${BASIS}/artikel/${artikel.id}`),
          danach: async () => {
            dialog.close();
            ctx.melde(`Artikel «${artikel.name}» ist gelöscht.`);
            await neu();
            document.querySelector("h1")?.focus();
          },
        }),
    });
  const dialog = seitenblatt({
    titel: artikel ? "Artikel bearbeiten" : "Neuer Artikel",
    untertitel: artikel?.name,
    inhalt: formular,
    fusszeile: [loeschen, abbrechen, speichern],
  });
  const sperre = (an) => {
    for (const f of [name, preis, varianten, hinweis, reihenfolge]) {
      f.eingabe.readOnly = an;
    }
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
    const liste = variantenAus(varianten.eingabe.value);
    if (liste.length > 20 || liste.some((v) => v.length > 40)) {
      melde(
        varianten,
        "Höchstens 20 Varianten mit je höchstens 40 Zeichen.",
        "Varianten",
      );
    }
    const rohFolge = reihenfolge.eingabe.value.trim();
    const folge = Number(rohFolge);
    if (
      rohFolge !== "" &&
      !(Number.isInteger(folge) && folge >= 0 && folge <= 9999)
    ) {
      melde(reihenfolge, "Gib eine Zahl von 0 bis 9999 ein.", "Reihenfolge");
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
      mediumId: bild.eingabe.value || null,
      varianten: liste,
      hinweis: hinweis.eingabe.value.trim() || null,
      verfuegbar: verfuegbar.eingabe.checked,
      ...(rohFolge !== "" && { reihenfolge: folge }),
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

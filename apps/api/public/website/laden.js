// Lädeli (#566): Laden mit Artikelfenster, Warenkorb und Bestellübersicht auf dem Raster, das der Server erzeugt hat (src/website/laden.ts).
// Aufbau, Zustände und Abfolge folgen einem Ladenmuster: Kachel mit schnellem Hinzufügen, Artikelfenster mit grossem Bild, Variante und Menge, Warenkorb als Blatt von rechts, Bestellübersicht als Karte mit Summe und der einen Hauptaktion.
// Ansehen geht ohne Konto: Artikel, Preise, Varianten und Übergabearten stehen im Markup, das Artikelfenster zeigt Foto, Name, Preis und Beschreibung. Bestellen und Warenkorb gibt es nur mit Konto; Besucher bekommen statt der Bedienelemente den Hinweis «Zum Bestellen anmelden». Der Korb liegt im Browser (localStorage: Artikel-ID, Variante, Menge, keine Personendaten) und wird erst mit einer Sitzung gelesen und geschrieben.
// Abfragen: beim Laden einmal GET /laden (prüft die Sitzung; ohne Sitzung 401) und mit Sitzung GET /laden/bestellungen/meine; danach nur bei einer Handlung. Bis die Antwort da ist, bleiben die Bedienelemente verborgen (kein Flackern). Preise und Summe rechnet beim Bestellen der Server, die Anzeige hier ist die Vorschau.
// Ansichten sind reine Funktionen von Daten zu einer Beschreibung (tm.js: h, baue): kein innerHTML, kein style-Attribut (CSP). Stil: laden.css. Auswahlfelder wertet auswahl.js auf.
import "./auswahl.js";
import { api, bandView, baue, h, loginLink, sk, skelett } from "./tm.js";

const SPEICHER = "laden-korb";
// Nach der Anmeldung geht der Artikel («a:<id>») oder die Bestellübersicht («1») wieder auf
const WEITER = "laden-weiter";
const BLITZ_MS = 1600;
// Bis zu so vielen Varianten stehen als Knöpfe im schnellen Hinzufügen der Kachel
const MAX_SCHNELL = 6;

// «CHF 40.–», «CHF 12.50», «gratis»: wie src/laden/laden.ts (preisText)
export function preisText(rappen) {
  if (rappen === 0) return "gratis";
  const franken = Math.floor(rappen / 100)
    .toString()
    .replace(/\B(?=(\d{3})+$)/g, "’");
  const rest = rappen % 100;
  return `CHF ${franken}.${rest === 0 ? "–" : String(rest).padStart(2, "0")}`;
}
// Eine Summe ist nie «gratis», sondern ein Betrag
export const summeText = (rappen) =>
  rappen === 0 ? "CHF 0.–" : preisText(rappen);

const gleich = (a, b) =>
  a.id === b.id && (a.variante ?? null) === (b.variante ?? null);

// Verfügbarkeit je Grösse (#629): «nichtVerfuegbar» nennt die Grössen, die gerade nicht zu haben sind
export const groesseWeg = (a, variante) =>
  variante != null && (a?.nichtVerfuegbar ?? []).includes(variante);
// Zeilen des Korbs, deren Grösse inzwischen nicht mehr zu haben ist
export const weggefallen = (korb, artikel) =>
  korb.filter((k) => groesseWeg(artikel.get(k.id), k.variante));

// Korb aus dem Speicher: nur Zeilen, die zu einem verfügbaren Artikel und seinen Varianten passen (eine inzwischen nicht verfügbare Grösse bleibt stehen und wird in der Zeile gemeldet, siehe weggefallen); Mengen innerhalb der Grenze, höchstens so viele Zeilen wie erlaubt
export function bereinige(roh, artikel, grenzen) {
  const korb = [];
  for (const z of Array.isArray(roh) ? roh : []) {
    const a = z && typeof z === "object" ? artikel.get(z.id) : undefined;
    if (!a?.verfuegbar) continue;
    const variante = z.variante ?? null;
    if (
      a.varianten.length === 0
        ? variante !== null
        : !a.varianten.includes(variante)
    ) {
      continue;
    }
    const menge = Math.min(
      grenzen.menge,
      Math.max(1, Math.trunc(z.menge) || 1),
    );
    if (korb.some((k) => gleich(k, { id: a.id, variante }))) continue;
    if (korb.length < grenzen.positionen) {
      korb.push({ id: a.id, variante, menge });
    }
  }
  return korb;
}

// Legt dazu oder erhöht die Menge der gleichen Zeile; «voll», wenn der Korb keine weitere Zeile fasst
export function legeDazu(korb, zeile, grenzen) {
  const da = korb.find((k) => gleich(k, zeile));
  if (da) {
    return {
      korb: korb.map((k) =>
        k === da
          ? { ...k, menge: Math.min(grenzen.menge, k.menge + zeile.menge) }
          : k,
      ),
      voll: false,
    };
  }
  if (korb.length >= grenzen.positionen) return { korb, voll: true };
  return { korb: [...korb, zeile], voll: false };
}

export const summe = (korb, artikel) =>
  korb.reduce((s, k) => s + k.menge * (artikel.get(k.id)?.preisRappen ?? 0), 0);
export const stueck = (korb) => korb.reduce((s, k) => s + k.menge, 0);
const stueckText = (n) => `${n} Stück`;

// Reihenfolge des Rasters; «empfohlen» ist die der Abteilung
export const SORTIERUNG = [
  ["empfohlen", "Empfohlen"],
  ["preis-auf", "Preis aufsteigend"],
  ["preis-ab", "Preis absteigend"],
  ["name", "Name A bis Z"],
];
export function sortiere(artikel, art) {
  const liste = [...artikel];
  if (art === "preis-auf") {
    liste.sort((a, b) => a.preisRappen - b.preisRappen || a.platz - b.platz);
  } else if (art === "preis-ab") {
    liste.sort((a, b) => b.preisRappen - a.preisRappen || a.platz - b.platz);
  } else if (art === "name") {
    liste.sort((a, b) => a.name.localeCompare(b.name, "de-CH"));
  } else liste.sort((a, b) => a.platz - b.platz);
  return liste;
}

// --- Symbole im Strich der Website (24er-Raster, 2 px, gerade Enden)
const zeichen = (...pfade) =>
  h(
    "svg",
    { class: "i", viewBox: "0 0 24 24", "aria-hidden": "true" },
    pfade.map((d) => h("path", { d })),
  );
const PLUS = ["M12 5v14", "M5 12h14"];
const MINUS = ["M5 12h14"];
const TASCHE = ["M5 8h14l-1 12H6z", "M9 8V6a3 3 0 0 1 6 0v2"];
const ZU = ["M6 6l12 12", "M18 6 6 18"];
const HAKEN = ["m5 12 5 5 9-10"];
const WARNUNG = ["M12 4 3 20h18z", "M12 10v4", "M12 17h.01"];
const PFEIL = ["M5 12h14", "m13 6 6 6-6 6"];
const ORT = [
  "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z",
  "M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
];
const MUENZE = [
  "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  "M12 7v10",
  "M15 9.5h-4.25a1.75 1.75 0 0 0 0 3.5h2.5a1.75 1.75 0 0 1 0 3.5H9",
];
const SPALTEN = {
  2: ["M5 5h5v14H5z", "M14 5h5v14h-5z"],
  3: ["M4 5h3.5v14H4z", "M10.25 5h3.5v14h-3.5z", "M16.5 5H20v14h-3.5z"],
  4: [
    "M3.5 5H6v14H3.5z",
    "M8.5 5H11v14H8.5z",
    "M13 5h2.5v14H13z",
    "M18 5h2.5v14H18z",
  ],
};

const STATUS = {
  offen: { text: "Offen", klasse: "chip" },
  bereit: { text: "Bereit zur Übergabe", klasse: "chip ok" },
  uebergeben: { text: "Übergeben", klasse: "chip st" },
  storniert: { text: "Storniert", klasse: "chip fe" },
};

const datum = (zeit) =>
  new Intl.DateTimeFormat("de-CH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Zurich",
  }).format(new Date(zeit));

// Bildfläche: das Foto unbeschnitten in einem ruhigen Feld
const flaecheView = (a, klasse) =>
  h(
    "div",
    { class: a.bild ? klasse : `${klasse} ${klasse}--leer` },
    a.bild
      ? h("img", {
          src: a.bild.src,
          alt: "",
          width: a.bild.width,
          height: a.bild.height,
        })
      : null,
  );

// Eine Zahl, deren Wechsel rollt (rolle: Schlüssel, unter dem der alte Wert wiedergefunden wird)
const zahlView = (rolle, text, klasse = "") =>
  h(
    "span",
    { class: `laden-rolle ${klasse}`.trim(), "data-rolle": rolle },
    text,
  );

// Ruhige Schrittknöpfe für die Menge; f: Schlüssel, unter dem der Fokus nach dem Neuzeichnen wiedergefunden wird
export const mengeView = ({ name, menge, max, f, gesperrt, klein }) =>
  h(
    "fieldset",
    {
      class: klein ? "laden-menge laden-menge--klein" : "laden-menge",
      disabled: gesperrt,
    },
    h("legend", { class: "nur-leser" }, `Menge ${name}`),
    h(
      "button",
      {
        type: "button",
        "data-aktion": "weniger",
        "data-f": `${f}-w`,
        "aria-label": "Eins weniger",
        "aria-disabled": menge <= 1 ? "true" : null,
      },
      zeichen(...MINUS),
    ),
    // Die neue Menge sagt die Live-Region an
    zahlView(`${f}-n`, String(menge), "zahl"),
    h(
      "button",
      {
        type: "button",
        "data-aktion": "mehr",
        "data-f": `${f}-m`,
        "aria-label": "Eins mehr",
        "aria-disabled": menge >= max ? "true" : null,
      },
      zeichen(...PLUS),
    ),
  );

// Knopf zum Warenkorb im Kopf des Ladens: Symbol, Wort, Anzahl im Feld
export const korbKnopfView = (z) =>
  h(
    "button",
    {
      type: "button",
      class: "laden-knopf laden-knopf--zweit laden-korbknopf",
      "data-aktion": "korb",
      "data-f": "korb",
      "aria-label": `Warenkorb, ${stueckText(stueck(z.korb))}`,
    },
    zeichen(...TASCHE),
    h("span", { class: "wort" }, "Warenkorb"),
    h(
      "span",
      { class: "laden-anzahl" },
      zahlView("korb", String(stueck(z.korb))),
    ),
  );

// Besucher ohne Sitzung: ein ruhiger Hinweis mit dem Weg zur Anmeldung; weiter: Artikel, zu dem sie danach zurückkehren
export const anmeldeView = (z, weiter) =>
  h(
    "div",
    { class: "laden-anmelden" },
    h(
      "p",
      { class: "meta" },
      "Zum Bestellen brauchst du ein Konto der Abteilung.",
    ),
    h(
      "a",
      {
        class: "laden-knopf laden-knopf--haupt",
        href: loginLink(z.pfad),
        "data-aktion": "anmelden",
        "data-f": weiter ? "anmelden-artikel" : "anmelden",
        "data-weiter": weiter ? `a:${weiter}` : "1",
      },
      "Zum Bestellen anmelden",
    ),
  );

// Bleibt beim Scrollen am unteren Rand stehen, sobald etwas im Korb liegt (die Seite ist lang, der Kopf des Ladens scrollt weg)
export const schwebeView = (z) =>
  stueck(z.korb) === 0
    ? null
    : h(
        "button",
        {
          type: "button",
          class: "laden-knopf laden-knopf--haupt laden-schwebe",
          "data-aktion": "korb",
          "data-f": "schwebe",
          "aria-label": `Warenkorb, ${stueckText(stueck(z.korb))}, ${summeText(summe(z.korb, z.artikel))}`,
        },
        zeichen(...TASCHE),
        h(
          "span",
          { class: "laden-anzahl" },
          zahlView("schwebe-n", String(stueck(z.korb))),
        ),
        zahlView("schwebe-s", summeText(summe(z.korb, z.artikel)), "betrag"),
      );

// Sortierung und Spaltenzahl über dem Raster
export const werkzeugeView = (z) =>
  h(
    "div",
    { class: "laden-werkzeuge" },
    h(
      "div",
      { class: "laden-sort" },
      h("label", { for: "laden-sort", class: "nur-leser" }, "Sortieren"),
      h(
        "select",
        { id: "laden-sort", class: "eingabe", "data-f": "sort" },
        SORTIERUNG.map(([wert, text]) =>
          h("option", { value: wert, selected: wert === z.sort }, text),
        ),
      ),
    ),
    h(
      "div",
      { class: "laden-dichte", role: "group", "aria-label": "Spalten" },
      [2, 3, 4].map((n) =>
        h(
          "button",
          {
            type: "button",
            "data-aktion": "dichte",
            "data-wert": String(n),
            "data-f": `dichte-${n}`,
            "aria-label": `${n} Spalten`,
            "aria-pressed": z.dichte === n ? "true" : "false",
          },
          zeichen(...SPALTEN[n]),
        ),
      ),
    ),
  );

// Schnelles Hinzufügen in der Kachel: ein Streifen am unteren Rand mit den Varianten als Knöpfen (ohne Varianten ein Knopf). dazu: die eben hinzugefügte Variante («» ohne Variante), sonst undefined
export function schnellView(a, dazu) {
  const knopf = (text, variante, name) => {
    const weg = groesseWeg(a, variante);
    return h(
      "button",
      {
        type: "button",
        class: weg ? "weg" : dazu === variante ? "dazu" : null,
        "data-aktion": "schnell",
        "data-variante": variante,
        "data-weg": weg ? "1" : null,
        "aria-disabled": weg ? "true" : null,
        "aria-label": weg ? `${a.name} in ${variante}, nicht verfügbar` : name,
      },
      dazu === variante && !weg ? zeichen(...HAKEN) : null,
      weg ? h("s", {}, text) : text,
    );
  };
  let notiz = null;
  if (dazu !== undefined)
    notiz = dazu ? `${dazu} im Warenkorb` : "Im Warenkorb";
  return h(
    "div",
    { class: "laden-schnell" },
    h(
      "div",
      { class: "laden-schnell-kopf" },
      h("span", { class: "titel" }, "Schnell dazu"),
      h("span", { class: "notiz", role: "status" }, notiz),
      h(
        "button",
        {
          type: "button",
          class: "laden-schnell-zu",
          "data-aktion": "schnell-zu",
          "aria-label": "Schnell dazu schliessen",
        },
        zeichen(...ZU),
      ),
    ),
    h(
      "div",
      { class: "laden-schnell-knoepfe" },
      a.varianten.length > MAX_SCHNELL
        ? h(
            "button",
            { type: "button", "data-aktion": "oeffne" },
            "Variante wählen",
          )
        : a.varianten.length === 0
          ? knopf("In den Warenkorb", "", `${a.name} in den Warenkorb`)
          : a.varianten.map((v) =>
              knopf(v, v, `${a.name} in ${v} in den Warenkorb`),
            ),
    ),
  );
}

// Artikelfenster: links das Bild gross auf seiner Fläche, rechts Name, Preis, Beschrieb, Variante, Menge und der Knopf mit dem Betrag
export function artikelView(a, wahl, z) {
  const fehlt = a.varianten.length > 0 && wahl.variante === null;
  const imKorb = z.korb
    .filter((k) => k.id === a.id)
    .reduce((s, k) => s + k.menge, 0);
  const einzige = z.uebergabearten.length === 1 ? z.uebergabearten[0] : null;
  let beschriftung;
  let tausch = "da";
  if (!a.verfuegbar) beschriftung = "Nicht verfügbar";
  else if (wahl.dazu) {
    tausch = "ja";
    beschriftung = [h("span", {}, "Im Warenkorb"), zeichen(...HAKEN)];
  } else if (fehlt) {
    tausch = "fehlt";
    beschriftung = "Variante wählen";
  } else {
    beschriftung = [
      h("span", {}, "In den Warenkorb"),
      h("span", { class: "punkt", "aria-hidden": "true" }, "·"),
      zahlView("wahl-summe", summeText(a.preisRappen * wahl.menge)),
    ];
  }
  return h(
    "div",
    { class: "laden-fenster" },
    h(
      "button",
      {
        type: "button",
        class: "laden-zu",
        "data-aktion": "zu",
        "data-f": "zu",
        "aria-label": "Schliessen",
      },
      zeichen(...ZU),
    ),
    h(
      "div",
      { class: "laden-fenster-raster" },
      h(
        "div",
        { class: "laden-buehne" },
        flaecheView(a, "laden-buehne-bild"),
        a.verfuegbar
          ? null
          : h("span", { class: "laden-marke" }, "Nicht verfügbar"),
      ),
      h(
        "div",
        { class: "laden-fenster-text" },
        h(
          "div",
          { class: "laden-fenster-kopf" },
          h("p", { class: "meta" }, "Lädeli"),
          h("h2", { id: "laden-fenster-t" }, a.name),
          h("p", { class: "preis" }, preisText(a.preisRappen)),
          a.hinweis ? h("p", { class: "beschrieb" }, a.hinweis) : null,
        ),
        a.varianten.length > 0 && z.konto === "an"
          ? h(
              "fieldset",
              { class: "laden-wahl" },
              h("legend", {}, "Variante"),
              h(
                "div",
                {
                  class: a.varianten.some((v) => v.length > 4)
                    ? "laden-wahl-knoepfe laden-wahl-knoepfe--breit"
                    : "laden-wahl-knoepfe",
                },
                a.varianten.map((v, n) => {
                  const weg = groesseWeg(a, v);
                  return h(
                    "button",
                    {
                      type: "button",
                      class: weg ? "weg" : null,
                      "data-aktion": "variante",
                      "data-variante": v,
                      "data-weg": weg ? "1" : null,
                      "data-f": `v${n}`,
                      "aria-disabled": weg ? "true" : null,
                      "aria-pressed": v === wahl.variante ? "true" : "false",
                    },
                    // Durchgestrichen, dazu das Wort im Fenster (Notiz unter der Wahl) und für Hilfstechnik am Knopf
                    weg
                      ? [
                          h("s", {}, v),
                          h("span", { class: "nur-leser" }, " nicht verfügbar"),
                        ]
                      : v,
                  );
                }),
              ),
              a.nichtVerfuegbar?.length > 0
                ? h(
                    "p",
                    { class: "meta laden-wahl-notiz" },
                    `${a.nichtVerfuegbar.join(", ")} nicht verfügbar`,
                  )
                : null,
            )
          : null,
        a.varianten.length > 0 && z.konto !== "an"
          ? h(
              "p",
              { class: "meta" },
              `Grössen: ${a.varianten.filter((v) => !groesseWeg(a, v)).join(", ")}`,
              a.nichtVerfuegbar?.length > 0
                ? ` · ${a.nichtVerfuegbar.join(", ")} nicht verfügbar`
                : null,
            )
          : null,
        z.konto === "aus"
          ? anmeldeView(z, a.id)
          : z.konto !== "an"
            ? null
            : h(
                "div",
                { class: "laden-kauf" },
                h(
                  "div",
                  { class: "laden-kauf-zeile" },
                  mengeView({
                    name: a.name,
                    menge: wahl.menge,
                    max: z.grenzen.menge,
                    f: "wahl",
                  }),
                  h(
                    "button",
                    {
                      type: "button",
                      class: "laden-knopf laden-knopf--haupt laden-dazu",
                      "data-aktion": "dazu",
                      "data-f": "dazu",
                      "aria-disabled": fehlt || !a.verfuegbar ? "true" : null,
                    },
                    h(
                      "span",
                      {
                        class: "laden-tausch",
                        "data-rolle": "tausch",
                        "data-wert": tausch,
                      },
                      beschriftung,
                    ),
                  ),
                ),
                h(
                  "p",
                  { class: "meta laden-imkorb" },
                  imKorb > 0
                    ? [
                        `${stueckText(imKorb)} im Warenkorb · `,
                        h(
                          "button",
                          {
                            type: "button",
                            class: "laden-link",
                            "data-aktion": "zum-korb",
                            "data-f": "zum-korb",
                          },
                          "Warenkorb ansehen",
                        ),
                      ]
                    : null,
                ),
              ),
        h(
          "ul",
          { class: "laden-angaben" },
          h(
            "li",
            {},
            zeichen(...ORT),
            h(
              "span",
              {},
              einzige
                ? ["Übergabe: ", h("strong", {}, einzige)]
                : "Die Übergabe wählst du in der Bestellübersicht",
            ),
          ),
          h(
            "li",
            {},
            zeichen(...MUENZE),
            h(
              "span",
              {},
              "Bezahlt wird bei der Übergabe",
              h("span", { class: "leise" }, ", nicht online"),
            ),
          ),
        ),
      ),
    ),
  );
}

// Zeilen des Korbs. Eine entfernte Zeile bleibt an ihrem Platz als «Entfernt … Rückgängig», bis sich der Korb das nächste Mal ändert
function zeilenView(z, { klein, f }) {
  const zeilen = z.korb.map((k, n) => ({ k, n }));
  if (z.entfernt) {
    zeilen.splice(Math.min(z.entfernt.platz, zeilen.length), 0, {
      weg: z.entfernt.zeile,
    });
  }
  const wegZeilen = weggefallen(z.korb, z.artikel);
  const liste = h(
    "ul",
    { class: klein ? "laden-zeilen laden-zeilen--klein" : "laden-zeilen" },
    zeilen.map(({ k, n, weg }) => {
      if (weg) {
        const a = z.artikel.get(weg.id);
        return h(
          "li",
          { class: "laden-entfernt" },
          h(
            "p",
            {},
            "Entfernt: ",
            h("strong", {}, a?.name ?? "Artikel"),
            weg.variante ? ` · ${weg.variante}` : null,
          ),
          h(
            "button",
            {
              type: "button",
              class: "laden-link",
              "data-aktion": "zurueck",
              "data-f": `${f}-zurueck`,
            },
            "Rückgängig",
          ),
        );
      }
      const a = z.artikel.get(k.id);
      const mehrere = k.menge > 1 && a.preisRappen > 0;
      const groesseFehlt = groesseWeg(a, k.variante);
      return h(
        "li",
        {
          "data-zeile": String(n),
          class: groesseFehlt ? "laden-zeile--weg" : null,
        },
        flaecheView(a, "laden-zeile-bild"),
        h(
          "div",
          { class: "laden-zeile-text" },
          h(
            "div",
            { class: "laden-zeile-kopf" },
            h("p", { class: "name" }, a.name),
            zahlView(
              `${f}${n}-p`,
              summeText(k.menge * a.preisRappen),
              "betrag",
            ),
          ),
          h(
            "p",
            { class: "meta" },
            [
              k.variante,
              mehrere ? `${preisText(a.preisRappen)} je Stück` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          ),
          groesseFehlt
            ? h(
                "p",
                { class: "laden-zeile-hinweis" },
                zeichen(...WARNUNG),
                `Die Grösse ${k.variante} ist nicht mehr verfügbar. Entferne die Zeile und wähle im Artikel eine andere Grösse.`,
              )
            : null,
          h(
            "div",
            { class: "laden-zeile-fuss" },
            mengeView({
              name: a.name,
              menge: k.menge,
              max: z.grenzen.menge,
              f: `${f}${n}`,
              gesperrt: z.senden === "sendet",
              klein: true,
            }),
            h(
              "button",
              {
                type: "button",
                class: "laden-knopf laden-knopf--still",
                "data-aktion": "entfernen",
                "data-f": `${f}${n}-e`,
                "aria-label": `${a.name} entfernen`,
                disabled: z.senden === "sendet",
              },
              "Entfernen",
            ),
          ),
        ),
      );
    }),
  );
  return [
    wegZeilen.length > 0 && !z.meldung
      ? bandView({
          art: "wa",
          symbol: "warnung",
          titel: "Eine Grösse ist nicht mehr verfügbar.",
          text: "Entferne die markierte Zeile oder wähle eine andere Grösse, dann lässt sich bestellen.",
        })
      : null,
    liste,
  ];
}

const reiheView = (name, wert, stark) =>
  h(
    "div",
    { class: stark ? "stark" : null },
    h("dt", {}, name),
    h("dd", {}, wert),
  );

// Der Warenkorb: ein Blatt von rechts mit Kopf, Zeilen und der Zusammenfassung am Fuss
export function korbView(z) {
  const kopf = h(
    "div",
    { class: "laden-blatt-kopf" },
    h(
      "h2",
      { id: "laden-korb-t", tabindex: "-1" },
      "Warenkorb",
      h(
        "span",
        { class: "zahl" },
        zahlView("korb-n", String(stueck(z.korb))),
        " Stück",
      ),
    ),
    h(
      "button",
      {
        type: "button",
        class: "laden-zu",
        "data-aktion": "zu",
        "data-f": "zu",
        "aria-label": "Warenkorb schliessen",
      },
      zeichen(...ZU),
    ),
  );
  if (z.korb.length === 0 && !z.entfernt) {
    return [
      kopf,
      h(
        "div",
        { class: "laden-leer" },
        h(
          "svg",
          {
            class: "laden-leer-bild",
            viewBox: "0 0 120 96",
            "aria-hidden": "true",
          },
          h("path", { d: "M30 34h60l-5 50H35z" }),
          h("path", { d: "M46 34v-8a14 14 0 0 1 28 0v8" }),
          h("path", { d: "M18 84h84" }),
        ),
        h("p", { class: "titel" }, "Dein Warenkorb ist leer"),
        h(
          "p",
          { class: "meta" },
          "Öffne einen Artikel oder nimm das Plus in der Kachel.",
        ),
        h(
          "button",
          {
            type: "button",
            class: "laden-knopf laden-knopf--zweit",
            "data-aktion": "zu",
            "data-f": "weiter",
          },
          "Weiter einkaufen",
          zeichen(...PFEIL),
        ),
      ),
    ];
  }
  const betrag = summe(z.korb, z.artikel);
  return [
    kopf,
    h(
      "div",
      { class: "laden-blatt-rumpf" },
      z.meldung ? bandView({ rolle: "alert", ...z.meldung }) : null,
      zeilenView(z, { f: "k" }),
    ),
    h(
      "div",
      { class: "laden-blatt-fuss" },
      h(
        "dl",
        { class: "laden-reihen" },
        reiheView("Zwischensumme", zahlView("korb-zs", summeText(betrag))),
        reiheView(
          "Übergabe",
          z.uebergabearten.length === 1
            ? z.uebergabearten[0]
            : "Wählst du in der Übersicht",
        ),
        reiheView("Summe", zahlView("korb-s", summeText(betrag)), true),
      ),
      h(
        "button",
        {
          type: "button",
          class: "laden-knopf laden-knopf--haupt voll",
          "data-aktion": "uebersicht",
          "data-f": "uebersicht",
          "aria-disabled":
            z.korb.length === 0 || weggefallen(z.korb, z.artikel).length > 0
              ? "true"
              : null,
        },
        "Zur Bestellübersicht",
        zeichen(...PFEIL),
      ),
      h(
        "p",
        { class: "meta mitte" },
        "Bezahlt wird bei der Übergabe, nicht online.",
      ),
    ),
  ];
}

const positionenView = (b) =>
  h(
    "ul",
    { class: "laden-positionen" },
    b.positionen.map((p) =>
      h(
        "li",
        {},
        h(
          "span",
          {},
          `${p.menge} × ${p.name}`,
          p.variante ? h("span", { class: "leise" }, `, ${p.variante}`) : null,
        ),
        h(
          "span",
          { class: "betrag" },
          summeText(p.menge * p.einzelpreisRappen),
        ),
      ),
    ),
  );

// Die Bestellübersicht: eine ruhige Karte mit Artikelzeilen, Übergabe, Zwischensumme, grosser Summe und der einen Hauptaktion
export function uebersichtView(z) {
  const zu = h(
    "button",
    {
      type: "button",
      class: "laden-zu",
      "data-aktion": "zu",
      "data-f": "zu",
      "aria-label": "Bestellübersicht schliessen",
    },
    zeichen(...ZU),
  );
  if (z.bestaetigt) {
    const b = z.bestaetigt;
    return h(
      "div",
      { class: "laden-karte" },
      h(
        "div",
        { class: "laden-karte-kopf" },
        h(
          "h2",
          { id: "laden-uebersicht-t", tabindex: "-1" },
          "Bestellung gesendet",
        ),
        zu,
      ),
      bandView({
        art: "ok",
        symbol: "haken",
        titel: "Deine Bestellung ist eingegangen.",
        text: `Du bezahlst bei der Übergabe: ${b.uebergabe}. Den Stand siehst du unter «Deine Bestellungen».`,
      }),
      positionenView(b),
      h(
        "div",
        { class: "laden-karte-fuss" },
        h(
          "div",
          {},
          h("p", { class: "meta" }, "Summe"),
          h("p", { class: "summe" }, summeText(b.summeRappen)),
        ),
        h(
          "button",
          {
            type: "button",
            class: "laden-knopf laden-knopf--zweit",
            "data-aktion": "zu",
            "data-f": "fertig",
          },
          "Schliessen",
        ),
      ),
    );
  }
  const betrag = summe(z.korb, z.artikel);
  const leer = z.korb.length === 0;
  let aktion;
  if (z.konto === "aus") {
    aktion = h(
      "a",
      {
        class: "laden-knopf laden-knopf--bestellen",
        href: loginLink(z.pfad),
        "data-aktion": "anmelden",
        "data-f": "bestellen",
      },
      "Zum Bestellen anmelden",
    );
  } else {
    const wartet = z.senden === "sendet" || z.konto === "unbekannt";
    aktion = h(
      "button",
      {
        type: "button",
        class: "laden-knopf laden-knopf--bestellen",
        "data-aktion": "bestellen",
        "data-f": "bestellen",
        "aria-disabled":
          leer || wartet || weggefallen(z.korb, z.artikel).length > 0
            ? "true"
            : null,
      },
      wartet ? h("span", { class: "lade" }) : null,
      z.konto === "unbekannt"
        ? "Wird geprüft …"
        : z.senden === "sendet"
          ? "Wird gesendet …"
          : "Bestellen",
    );
  }
  return h(
    "div",
    { class: "laden-karte" },
    h(
      "div",
      { class: "laden-karte-kopf" },
      h("h2", { id: "laden-uebersicht-t", tabindex: "-1" }, "Bestellübersicht"),
      h(
        "span",
        { class: "meta" },
        zahlView("ue-n", String(stueck(z.korb))),
        " Stück",
      ),
      zu,
    ),
    leer && !z.entfernt
      ? h("p", { class: "meta laden-karte-leer" }, "Dein Warenkorb ist leer.")
      : zeilenView(z, { klein: true, f: "u" }),
    h(
      "div",
      { class: "laden-karte-wahl" },
      z.uebergabearten.length > 1
        ? h(
            "div",
            { class: "feld" },
            h("label", { for: "laden-uebergabe" }, "Übergabe"),
            h(
              "select",
              {
                id: "laden-uebergabe",
                class: "eingabe",
                "data-f": "uebergabe",
                disabled: z.senden === "sendet",
              },
              z.uebergabearten.map((u) =>
                h("option", { value: u, selected: u === z.uebergabe }, u),
              ),
            ),
          )
        : h(
            "dl",
            { class: "laden-reihen" },
            reiheView("Übergabe", z.uebergabe ?? ""),
          ),
    ),
    h(
      "dl",
      { class: "laden-reihen laden-karte-reihen" },
      reiheView("Zwischensumme", zahlView("ue-zs", summeText(betrag))),
      reiheView("Bezahlung", "Bei der Übergabe"),
    ),
    h(
      "div",
      { class: "laden-karte-fuss" },
      h(
        "div",
        {},
        h("p", { class: "meta" }, "Summe"),
        h("p", { class: "summe" }, zahlView("ue-s", summeText(betrag))),
      ),
      aktion,
    ),
    z.konto === "aus"
      ? h(
          "p",
          { class: "meta laden-karte-notiz" },
          "Zum Bestellen brauchst du ein Konto der Abteilung. Dein Warenkorb bleibt in diesem Browser erhalten.",
        )
      : null,
    z.meldung
      ? h(
          "div",
          { class: "laden-karte-notiz" },
          bandView({ rolle: "alert", ...z.meldung }),
        )
      : null,
  );
}

// «Deine Bestellungen» unter dem Laden, nur mit Sitzung. Laden: Skelett in der Form zweier Bestellungen (gemeinsamer Baustein der Ladezustände, #574)
export function bestellungenView(b) {
  const titel = h("h2", { id: "laden-bestellungen-t" }, "Deine Bestellungen");
  if (b.zustand === "lade") {
    return [
      titel,
      h(
        "div",
        { "aria-busy": "true" },
        skelett(
          sk("t h24 b40"),
          sk("t b90"),
          sk("h56 b100 mt"),
          sk("t h24 b40 mt"),
          sk("t b70"),
          sk("h56 b100 mt"),
        ),
      ),
    ];
  }
  if (b.zustand === "fehler") {
    return [
      titel,
      bandView({
        art: "fe",
        symbol: "warnung",
        rolle: "alert",
        titel: "Deine Bestellungen konnten nicht geladen werden.",
        aktion: h(
          "button",
          {
            type: "button",
            class: "laden-knopf laden-knopf--zweit",
            "data-aktion": "nochmal",
          },
          "Nochmals versuchen",
        ),
      }),
    ];
  }
  if (b.liste.length === 0) {
    return [titel, h("p", { class: "meta" }, "Du hast noch nichts bestellt.")];
  }
  return [
    titel,
    b.meldung ? bandView({ rolle: "alert", ...b.meldung }) : null,
    h(
      "ul",
      { class: "laden-liste" },
      b.liste.map((e) =>
        h(
          "li",
          {},
          h(
            "div",
            { class: "laden-liste-kopf" },
            h("h3", {}, `Bestellung vom ${datum(e.erstelltAm)}`),
            h(
              "span",
              { class: STATUS[e.status].klasse },
              STATUS[e.status].text,
            ),
          ),
          positionenView(e),
          h(
            "div",
            { class: "laden-liste-fuss" },
            h(
              "p",
              {},
              h("span", { class: "leise" }, `${e.uebergabe} · Summe `),
              h("strong", {}, summeText(e.summeRappen)),
            ),
            e.status === "offen"
              ? h(
                  "button",
                  {
                    type: "button",
                    class: "laden-knopf laden-knopf--zweit",
                    "data-aktion": "stornieren",
                    "data-id": e.id,
                    "data-f": `s-${e.id}`,
                    "aria-label": `Bestellung vom ${datum(e.erstelltAm)} stornieren`,
                  },
                  "Stornieren",
                )
              : null,
          ),
        ),
      ),
    ),
    b.weitere
      ? h(
          "button",
          {
            type: "button",
            class: "laden-knopf laden-knopf--zweit",
            "data-aktion": "weitere",
            "data-f": "weitere",
          },
          "Weitere laden",
        )
      : null,
  ];
}

// Was die Person nach einem Fehler beim Bestellen liest
export function fehlerMeldung(r) {
  const code = r.daten?.code;
  if (r.status === 429) {
    return {
      art: "wa",
      symbol: "warnung",
      titel: "Das waren zu viele Versuche.",
      text: "Warte ein paar Minuten und sende dann nochmals.",
    };
  }
  if (r.status === 0) {
    return {
      art: "fe",
      symbol: "warnung",
      titel: "Keine Verbindung.",
      text: "Dein Warenkorb bleibt erhalten. Prüfe die Verbindung und sende nochmals.",
    };
  }
  const bekannt = [
    "BESTELL_LIMIT",
    "ARTIKEL_NICHT_VERFUEGBAR",
    "GROESSE_NICHT_VERFUEGBAR",
    "VARIANTE_UNGUELTIG",
    "UEBERGABE_UNBEKANNT",
    "PREIS_GEAENDERT",
    "STATUS_UNGUELTIG",
  ];
  return {
    art: "fe",
    symbol: "warnung",
    titel: bekannt.includes(code) ? r.daten.message : "Das hat nicht geklappt.",
    text: bekannt.includes(code)
      ? null
      : "Dein Warenkorb bleibt erhalten. Versuche es nochmals.",
  };
}

// Liest die Artikel aus dem Markup des Servers: Sie sind die einzige Quelle für Besucher ohne Sitzung
export function liesArtikel(wurzel) {
  return new Map(
    [...wurzel.querySelectorAll(".laden-artikel[data-id]")].map((li, platz) => {
      const img = li.querySelector(".laden-kachel img");
      return [
        li.dataset.id,
        {
          id: li.dataset.id,
          platz,
          name: li.querySelector(".name")?.textContent ?? "",
          preisRappen: Number(li.dataset.preis) || 0,
          // data-name: Der Name ohne das Wort «nicht verfügbar» der Hilfstechnik
          varianten: [...li.querySelectorAll(".laden-varianten li")].map(
            (v) => v.dataset.name ?? v.textContent,
          ),
          nichtVerfuegbar: [
            ...li.querySelectorAll(".laden-varianten .laden-variante--weg"),
          ].map((v) => v.dataset.name),
          hinweis: li.querySelector(".hinweis")?.textContent ?? null,
          verfuegbar: !li.classList.contains("laden-artikel--weg"),
          bild: img
            ? {
                src: img.getAttribute("src"),
                width: img.getAttribute("width"),
                height: img.getAttribute("height"),
              }
            : null,
        },
      ];
    }),
  );
}

function start(doc, wurzel) {
  const fenster = doc.defaultView;
  let arten;
  try {
    arten = JSON.parse(wurzel.dataset.uebergabe ?? "[]");
  } catch {
    arten = [];
  }
  const z = {
    artikel: liesArtikel(wurzel),
    korb: [],
    grenzen: { positionen: 20, menge: 10 },
    uebergabearten: arten,
    uebergabe: arten[0] ?? null,
    // unbekannt, bis die erste Antwort da ist; «an» mit Sitzung, sonst «aus»
    konto: "unbekannt",
    pfad: fenster.location.pathname,
    sort: "empfohlen",
    dichte: null,
    entfernt: null,
    meldung: null,
    senden: "ruhe",
    bestaetigt: null,
    bestellungen: {
      zustand: "lade",
      liste: [],
      weitere: false,
      naechste: null,
    },
  };
  const raster = wurzel.querySelector(".laden-raster");
  const kacheln = new Map(
    [...wurzel.querySelectorAll(".laden-artikel[data-id]")].map((li) => [
      li.dataset.id,
      li,
    ]),
  );
  // Der Speicher des Browsers kann gesperrt sein: dann lebt der Korb, bis die Seite neu lädt
  const speicher = (art) => {
    try {
      return fenster[art];
    } catch {
      return null;
    }
  };
  const lies = (art, name) => {
    try {
      return speicher(art)?.getItem(name) ?? null;
    } catch {
      return null;
    }
  };
  const setze = (art, name, wert) => {
    try {
      if (wert === null) speicher(art)?.removeItem(name);
      else speicher(art)?.setItem(name, wert);
    } catch {
      // siehe oben
    }
  };

  const live = baue(doc, h("p", { class: "nur-leser", role: "status" }));
  const sage = (text) => {
    live.textContent = "";
    live.textContent = text;
  };
  const kopf = doc.createElement("div");
  kopf.className = "laden-leiste-korb";
  const werkzeuge = doc.createElement("div");
  const schwebe = doc.createElement("div");
  const dialog = (klasse, titel) =>
    baue(doc, h("dialog", { class: klasse, "aria-labelledby": titel }));
  const fensterDlg = dialog("laden-dialog", "laden-fenster-t");
  const korbDlg = dialog("laden-blatt", "laden-korb-t");
  const karteDlg = dialog("laden-uebersicht", "laden-uebersicht-t");
  const liste = baue(
    doc,
    h("section", {
      class: "laden-bestellungen",
      id: "laden-bestellungen",
      "aria-labelledby": "laden-bestellungen-t",
    }),
  );
  let wahl = null;
  const ausloeser = new Map();
  const uhren = new Map();

  // Zeichnet neu, gibt den Fokus dem Element mit demselben Schlüssel zurück und lässt geänderte Zahlen rollen (aufwärts oder abwärts)
  const zahlen = new Map();
  const zahl = (t) => Number(t.replace(/[^\d.]/g, "")) || 0;
  function zeichne(ort, ansicht) {
    const f = ort.contains(doc.activeElement)
      ? doc.activeElement.dataset?.f
      : undefined;
    ort.replaceChildren(
      ...[ansicht]
        .flat()
        .filter(Boolean)
        .map((a) => baue(doc, a)),
    );
    if (f) ort.querySelector(`[data-f="${f}"]`)?.focus();
    for (const e of ort.querySelectorAll("[data-rolle]")) {
      const vorher = zahlen.get(e.dataset.rolle);
      // data-wert: Der Wechsel eines Zustands zählt, nicht der des Textes (Beschriftung des Knopfs)
      const jetzt = e.dataset.wert ?? e.textContent;
      zahlen.set(e.dataset.rolle, jetzt);
      if (vorher !== undefined && vorher !== jetzt) {
        e.classList.add(zahl(jetzt) >= zahl(vorher) ? "rollt-auf" : "rollt-ab");
      }
    }
  }
  const merke = () => setze("localStorage", SPEICHER, JSON.stringify(z.korb));
  const zeichneKopf = () => {
    const an = z.konto === "an";
    zeichne(
      kopf,
      an ? korbKnopfView(z) : z.konto === "aus" ? anmeldeView(z) : null,
    );
    zeichne(schwebe, an ? schwebeView(z) : null);
  };
  const zeichneKorb = () => {
    if (korbDlg.open) zeichne(korbDlg, korbView(z));
    if (karteDlg.open) zeichne(karteDlg, uebersichtView(z));
  };
  const zeichneFenster = () => {
    if (wahl) zeichne(fensterDlg, artikelView(wahl.artikel, wahl, z));
  };
  const zeichneListe = () => zeichne(liste, bestellungenView(z.bestellungen));
  function aendereKorb(korb, ansage) {
    z.korb = korb;
    z.meldung = null;
    merke();
    zeichneKopf();
    zeichneKorb();
    zeichneFenster();
    if (ansage) sage(ansage);
  }
  // Ein kurzes Aufblitzen (Haken im Knopf); die Wirkung selbst bleibt am Warenkorb sichtbar
  function blitze(schluessel, an, aus) {
    fenster.clearTimeout(uhren.get(schluessel));
    an();
    uhren.set(schluessel, fenster.setTimeout(aus, BLITZ_MS));
  }

  // Mit Sitzung liefert der Server Preise, Verfügbarkeit, Übergabearten und Grenzen frisch; die Bilder bleiben die des Markups
  function uebernimm(daten) {
    // Der Korb wird erst mit Sitzung aus dem Speicher gelesen
    if (!z.korbGelesen) {
      z.korbGelesen = true;
      try {
        z.korb = JSON.parse(lies("localStorage", SPEICHER) ?? "[]");
      } catch {
        z.korb = [];
      }
    }
    z.grenzen = daten.grenzen;
    z.uebergabearten = daten.uebergabearten;
    if (!z.uebergabearten.includes(z.uebergabe)) {
      z.uebergabe = z.uebergabearten[0] ?? null;
    }
    const alt = z.artikel;
    z.artikel = new Map(
      daten.artikel.map((a, platz) => [
        a.id,
        { ...a, platz, bild: alt.get(a.id)?.bild ?? null },
      ]),
    );
    z.korb = bereinige(z.korb, z.artikel, z.grenzen);
    merke();
  }
  async function pruefeKonto() {
    const r = await api("/laden");
    if (r.status === 200) {
      z.konto = "an";
      uebernimm(r.daten);
    } else if (r.status === 401) z.konto = "aus";
    // Bei einem anderen Fehler bleibt der Laden benutzbar; die Übersicht fragt beim Öffnen nochmals
    return r.status;
  }

  async function ladeBestellungen(mehr = false) {
    const b = z.bestellungen;
    if (!mehr) {
      b.zustand = "lade";
      zeichneListe();
    }
    // Ruhige Ansage erst, wenn es dauert; eine schnelle Antwort sagt nichts
    const ansage = setTimeout(
      () => sage("Deine Bestellungen werden geladen."),
      700,
    );
    const r = await api(
      `/laden/bestellungen/meine${mehr && b.naechste ? `?nach=${b.naechste}` : ""}`,
    );
    clearTimeout(ansage);
    if (r.status !== 200) {
      b.zustand = "fehler";
    } else {
      b.zustand = "ok";
      b.liste = mehr
        ? [...b.liste, ...r.daten.bestellungen]
        : r.daten.bestellungen;
      b.weitere = r.daten.weitere;
      b.naechste = r.daten.naechste;
    }
    zeichneListe();
  }

  function oeffne(dlg, knopf, ansicht) {
    ausloeser.set(dlg, knopf ?? doc.activeElement);
    zeichne(dlg, ansicht);
    if (!dlg.open) dlg.showModal();
  }
  function oeffneFenster(a, knopf) {
    wahl = {
      artikel: a,
      // Eine einzige Variante ist schon gewählt
      variante: a.varianten.length === 1 ? a.varianten[0] : null,
      menge: 1,
      dazu: false,
    };
    oeffne(fensterDlg, knopf, artikelView(a, wahl, z));
  }
  function oeffneKorb(knopf) {
    oeffne(korbDlg, knopf, korbView(z));
    korbDlg.querySelector("h2")?.focus();
  }
  async function oeffneUebersicht(knopf) {
    const zurueck = ausloeser.get(korbDlg) ?? knopf;
    if (korbDlg.open) korbDlg.close();
    oeffne(karteDlg, zurueck, uebersichtView(z));
    karteDlg.querySelector("h2")?.focus();
    if (z.konto !== "an") {
      const status = await pruefeKonto();
      // Ohne Antwort des Servers bleibt der Weg über die Anmeldung
      if (status !== 200 && status !== 401) z.konto = "aus";
      zeichneKopf();
      zeichneKorb();
    }
  }
  function lege(a, variante, menge) {
    const { korb, voll } = legeDazu(
      z.korb,
      { id: a.id, variante, menge },
      z.grenzen,
    );
    z.entfernt = null;
    if (voll) {
      if (fensterDlg.open) fensterDlg.close();
      oeffneKorb();
      z.meldung = {
        art: "wa",
        symbol: "warnung",
        titel: `Der Warenkorb fasst höchstens ${z.grenzen.positionen} verschiedene Artikel.`,
      };
      zeichneKorb();
      return false;
    }
    aendereKorb(
      korb,
      `${a.name}${variante ? ` in ${variante}` : ""} liegt im Warenkorb. ${stueckText(stueck(korb))}.`,
    );
    return true;
  }

  async function bestelle() {
    if (z.senden === "sendet" || z.korb.length === 0) return;
    if (weggefallen(z.korb, z.artikel).length > 0) {
      z.meldung = {
        art: "wa",
        symbol: "warnung",
        titel: "Eine Grösse ist nicht mehr verfügbar.",
        text: "Entferne die markierte Zeile oder wähle eine andere Grösse.",
      };
      zeichneKorb();
      return;
    }
    z.senden = "sendet";
    z.meldung = null;
    z.entfernt = null;
    zeichneKorb();
    sage("Wird gesendet …");
    const r = await api("/laden/bestellungen", {
      methode: "POST",
      body: {
        positionen: z.korb.map((k) => ({
          artikelId: k.id,
          variante: k.variante,
          menge: k.menge,
        })),
        uebergabe: z.uebergabe,
        erwarteteSummeRappen: summe(z.korb, z.artikel),
      },
    });
    z.senden = "ruhe";
    if (r.status === 201) {
      z.bestaetigt = r.daten;
      z.korb = [];
      merke();
      zeichneKopf();
      zeichneKorb();
      karteDlg.querySelector("h2")?.focus();
      sage("Deine Bestellung ist eingegangen.");
      void ladeBestellungen();
      return;
    }
    if (r.status === 401) {
      // Die Sitzung ist abgelaufen: Der Knopf wird wieder «Zum Bestellen anmelden»
      z.konto = "aus";
    } else {
      z.meldung = fehlerMeldung(r);
      // Preise, Verfügbarkeit oder Übergabe haben sich geändert: den Laden neu lesen, damit Korb und Summe wieder stimmen
      if (r.status === 409 || r.status === 400 || r.status === 422) {
        await pruefeKonto();
      }
    }
    zeichneKopf();
    zeichneKorb();
  }

  async function storniere(id) {
    const r = await api(`/laden/bestellungen/${id}`, { methode: "DELETE" });
    if (r.status === 204) {
      await ladeBestellungen();
      sage("Die Bestellung ist storniert.");
      return;
    }
    z.bestellungen.meldung = fehlerMeldung(r);
    zeichneListe();
  }

  function ordne() {
    for (const a of sortiere(z.artikel.values(), z.sort)) {
      const li = kacheln.get(a.id);
      if (li) raster.append(li);
    }
  }

  // --- Ereignisse
  wurzel.addEventListener("click", (e) => {
    const knopf = e.target.closest?.("[data-aktion]");
    if (!knopf) return;
    if (knopf.getAttribute("aria-disabled") === "true") {
      e.preventDefault();
      // «Variante wählen»: zur Wahl führen statt nichts tun
      if (knopf.dataset.aktion === "dazu" && wahl?.artikel.verfuegbar) {
        fensterDlg
          .querySelector('[data-aktion="variante"]:not([data-weg])')
          ?.focus();
        sage("Wähle zuerst eine Variante.");
      } else if (knopf.dataset.weg) {
        sage(`${knopf.dataset.variante} ist nicht verfügbar.`);
      } else if (
        (knopf.dataset.aktion === "uebersicht" ||
          knopf.dataset.aktion === "bestellen") &&
        weggefallen(z.korb, z.artikel).length > 0
      ) {
        sage(
          "Eine Grösse ist nicht mehr verfügbar. Entferne die markierte Zeile.",
        );
      }
      return;
    }
    const aktion = knopf.dataset.aktion;
    const zeile = knopf.closest("[data-zeile]");
    const n = zeile ? Number(zeile.dataset.zeile) : -1;
    const kachel = knopf.closest(".laden-artikel[data-id]");
    const a = kachel ? z.artikel.get(kachel.dataset.id) : null;
    if (aktion === "oeffne" && a) {
      oeffneFenster(a, kachel.querySelector(".laden-oeffnen"));
    } else if (aktion === "schnell-auf" && kachel) {
      kachel.classList.add("schnell-offen");
      kachel.querySelector(".laden-schnell-knoepfe button")?.focus();
    } else if (aktion === "schnell-zu" && kachel) {
      kachel.classList.remove("schnell-offen");
      kachel.querySelector(".laden-plus")?.focus();
    } else if (aktion === "schnell" && a) {
      const variante = knopf.dataset.variante;
      if (!lege(a, variante || null, 1)) return;
      const ort = kachel.querySelector(".laden-schnell-ort");
      const wieder = () =>
        ort
          .querySelector(`[data-variante="${fenster.CSS.escape(variante)}"]`)
          ?.focus();
      blitze(
        `s-${a.id}`,
        () => {
          zeichne(ort, schnellView(a, variante));
          wieder();
        },
        () => {
          const hatte = ort.contains(doc.activeElement);
          zeichne(ort, schnellView(a, undefined));
          if (hatte) wieder();
        },
      );
    } else if (aktion === "korb") {
      z.bestaetigt = null;
      oeffneKorb(knopf);
    } else if (aktion === "zum-korb") {
      const zurueck = ausloeser.get(fensterDlg);
      fensterDlg.close();
      oeffneKorb(zurueck);
    } else if (aktion === "uebersicht") {
      void oeffneUebersicht(knopf);
    } else if (aktion === "zu") {
      knopf.closest("dialog").close();
    } else if (aktion === "anmelden") {
      // Der Link führt zur Anmeldung; danach geht der Artikel oder die Übersicht wieder auf
      setze("sessionStorage", WEITER, knopf.dataset.weiter ?? "1");
    } else if (aktion === "bestellen") {
      void bestelle();
    } else if (aktion === "variante" && wahl) {
      wahl.variante = knopf.dataset.variante;
      wahl.dazu = false;
      zeichneFenster();
      sage(`Variante ${wahl.variante} gewählt.`);
    } else if (aktion === "dazu" && wahl) {
      if (!lege(wahl.artikel, wahl.variante, wahl.menge)) return;
      blitze(
        "dazu",
        () => {
          wahl.dazu = true;
          zeichneFenster();
        },
        () => {
          if (!wahl) return;
          wahl.dazu = false;
          zeichneFenster();
        },
      );
    } else if (aktion === "zurueck" && z.entfernt) {
      const ort = knopf.closest("dialog");
      const { zeile: alt, platz } = z.entfernt;
      z.entfernt = null;
      const korb = [...z.korb];
      korb.splice(Math.min(platz, korb.length), 0, alt);
      aendereKorb(korb, "Wieder im Warenkorb.");
      // Die Zeile steht wieder an ihrem Platz: Der Fokus geht zu ihrem ersten Knopf, der etwas tut
      ort
        .querySelector(
          `[data-zeile="${Math.min(platz, korb.length - 1)}"] button:not([aria-disabled="true"])`,
        )
        ?.focus();
    } else if (aktion === "entfernen" && n >= 0) {
      const ort = knopf.closest("dialog");
      z.entfernt = { zeile: z.korb[n], platz: n };
      aendereKorb(
        z.korb.filter((_, i) => i !== n),
        `${z.artikel.get(z.entfernt.zeile.id).name} entfernt.`,
      );
      // Die Zeile mit dem Fokus ist weg: Er geht zu «Rückgängig»
      ort.querySelector('[data-aktion="zurueck"]')?.focus();
    } else if ((aktion === "mehr" || aktion === "weniger") && n >= 0) {
      const menge = z.korb[n].menge + (aktion === "mehr" ? 1 : -1);
      z.entfernt = null;
      const korb = z.korb.map((k, i) => (i === n ? { ...k, menge } : k));
      aendereKorb(
        korb,
        `Menge ${menge}. Summe ${summeText(summe(korb, z.artikel))}.`,
      );
    } else if ((aktion === "mehr" || aktion === "weniger") && wahl) {
      wahl.menge += aktion === "mehr" ? 1 : -1;
      wahl.dazu = false;
      zeichneFenster();
      sage(`Menge ${wahl.menge}.`);
    } else if (aktion === "dichte") {
      const wert = Number(knopf.dataset.wert);
      z.dichte = z.dichte === wert ? null : wert;
      if (z.dichte) raster.dataset.spalten = String(z.dichte);
      else delete raster.dataset.spalten;
      zeichne(werkzeuge, werkzeugeView(z));
    } else if (aktion === "stornieren") {
      void storniere(knopf.dataset.id);
    } else if (aktion === "weitere") {
      void ladeBestellungen(true);
    } else if (aktion === "nochmal") {
      void ladeBestellungen();
    }
  });
  wurzel.addEventListener("change", (e) => {
    if (e.target.id === "laden-uebergabe") {
      z.uebergabe = e.target.value;
    } else if (e.target.id === "laden-sort") {
      z.sort = e.target.value;
      ordne();
      sage(`Sortiert: ${e.target.selectedOptions[0]?.textContent ?? ""}.`);
    }
  });
  // Escape schliesst den offenen Streifen einer Kachel
  raster.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const offen = e.target.closest?.(".schnell-offen");
    if (!offen) return;
    offen.classList.remove("schnell-offen");
    offen.querySelector(".laden-plus")?.focus();
  });
  // Der Fokus geht zurück zum Auslöser; ein Klick neben das Fenster schliesst es
  for (const dlg of [fensterDlg, korbDlg, karteDlg]) {
    dlg.addEventListener("close", () => {
      if (dlg === fensterDlg) wahl = null;
      else {
        z.entfernt = null;
        z.meldung = null;
      }
      if (dlg === karteDlg) z.bestaetigt = null;
      const ziel = ausloeser.get(dlg);
      if (ziel?.isConnected && !doc.querySelector("dialog[open]")) ziel.focus();
    });
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });
  }

  // --- Aufbau: Kacheln werden bedienbar, Kopf, Werkzeuge und Fenster kommen dazu
  for (const [id, li] of kacheln) {
    const a = z.artikel.get(id);
    const flaeche = li.querySelector(".laden-kachel");
    if (!a || !flaeche) continue;
    // Die ganze Kachel öffnet das Artikelfenster
    flaeche.append(
      baue(
        doc,
        h("button", {
          type: "button",
          class: "laden-oeffnen",
          "data-aktion": "oeffne",
          "aria-label": `${a.name}, ${preisText(a.preisRappen)}${a.verfuegbar ? "" : ", nicht verfügbar"}`,
        }),
      ),
    );
  }
  // Schnelles Hinzufügen gibt es nur mit Sitzung; die Kacheln bekommen es, sobald sie feststeht
  function schnellErgaenzen() {
    for (const [id, li] of kacheln) {
      const a = z.artikel.get(id);
      const flaeche = li.querySelector(".laden-kachel");
      if (
        !a?.verfuegbar ||
        !flaeche ||
        li.querySelector(".laden-schnell-ort")
      ) {
        continue;
      }
      const ort = doc.createElement("div");
      ort.className = "laden-schnell-ort";
      ort.append(baue(doc, schnellView(a, undefined)));
      flaeche.append(
        ort,
        baue(
          doc,
          h(
            "button",
            {
              type: "button",
              class: "laden-plus",
              "data-aktion": "schnell-auf",
              "aria-label": `Schnell dazu: ${a.name}`,
            },
            zeichen(...PLUS),
          ),
        ),
      );
    }
  }
  wurzel.querySelector(".laden-leiste")?.append(kopf);
  raster.before(werkzeuge);
  wurzel.append(schwebe, fensterDlg, korbDlg, karteDlg, live);
  wurzel.classList.add("laden--an");
  zeichne(werkzeuge, werkzeugeView(z));

  // Einmal je Besuch: Sitzung prüfen. Mit Sitzung kommen Korb, schnelles Hinzufügen und «Deine Bestellungen» dazu, ohne Sitzung der Hinweis zur Anmeldung. Nach der Anmeldung geht der Artikel oder die Übersicht wieder auf
  void (async () => {
    const status = await pruefeKonto();
    // Ohne Antwort des Servers bleibt der Laden ein Katalog
    if (status !== 200) z.konto = "aus";
    const weiter = lies("sessionStorage", WEITER);
    setze("sessionStorage", WEITER, null);
    if (z.konto === "an") schnellErgaenzen();
    zeichneKopf();
    zeichneKorb();
    zeichneFenster();
    if (status !== 200) return;
    wurzel.insertBefore(liste, schwebe);
    void ladeBestellungen();
    if (weiter === "1" && z.korb.length > 0) {
      void oeffneUebersicht(kopf.firstChild);
    } else if (weiter?.startsWith("a:") && !wahl) {
      const a = z.artikel.get(weiter.slice(2));
      if (a) {
        oeffneFenster(a, kacheln.get(a.id)?.querySelector(".laden-oeffnen"));
      }
    }
  })();
}

const wurzel =
  typeof document === "undefined"
    ? null
    : document.querySelector("[data-laden]");
if (wurzel) start(document, wurzel);

// Lädeli (#566): Warenkorb und Bestellung für angemeldete Personen auf dem Raster, das der Server erzeugt hat (src/website/laden.ts).
// Ohne Skript und ohne Anmeldung bleibt die Seite eine Preisliste mit dem Hinweis zur Anmeldung. Mit Sitzung kommen dazu: Artikel wählen (Variante, Menge), Warenkorb mit Summe, Bestellung senden, eigene Bestellungen ansehen und stornieren.
// Abfragen: beim Laden GET /laden (zugleich die Prüfung der Sitzung) und GET /laden/bestellungen/meine; danach nur bei einer Handlung. Der Korb liegt im Browser (localStorage: Artikel-ID, Variante, Menge) und geht erst beim Bestellen an den Server; Preise und Summe rechnet der Server, die Anzeige hier ist die Vorschau.
// Ansichten sind reine Funktionen von Daten zu einer Beschreibung (tm.js: h, baue): kein innerHTML, kein style-Attribut (CSP). Stil: laden.css. Das Auswahlfeld der Variante wertet auswahl.js auf.
import "./auswahl.js";
import { api, bandView, baue, h, icon, loginLink } from "./tm.js";

const SPEICHER = "laden-korb";

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

// Korb aus dem Speicher: nur Zeilen, die zu einem verfügbaren Artikel und seinen Varianten passen; Mengen innerhalb der Grenze, höchstens so viele Zeilen wie erlaubt
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
    if (korb.length < grenzen.positionen)
      korb.push({ id: a.id, variante, menge });
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

const bildView = (a, klasse) =>
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

// Schrittknöpfe für die Menge; f ist der Schlüssel, unter dem der Fokus nach dem Neuzeichnen wiedergefunden wird
export const mengeView = ({ name, menge, max, f, gesperrt }) =>
  h(
    "fieldset",
    { class: "laden-menge", disabled: gesperrt },
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
    // Die neue Menge sagt die Live-Region an; hier steht nur die Zahl
    h("span", { class: "zahl" }, String(menge)),
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

// Kopf des Ladens für Angemeldete: der Knopf zum Warenkorb mit Anzahl
export const zugangView = (z) =>
  h(
    "div",
    { class: "laden-zugang laden-zugang--an" },
    z.bestellungen?.liste.length
      ? h("a", { href: "#laden-bestellungen" }, "Deine Bestellungen")
      : null,
    h(
      "button",
      {
        type: "button",
        class: "btn p",
        "data-aktion": "korb",
        "data-f": "korb",
      },
      zeichen(...TASCHE),
      "Warenkorb",
      h(
        "span",
        { class: "laden-anzahl" },
        h("span", { class: "nur-leser" }, ", "),
        String(stueck(z.korb)),
        h("span", { class: "nur-leser" }, " Stück"),
      ),
    ),
  );

// Bleibt beim Scrollen am unteren Rand stehen, sobald etwas im Korb liegt: Anzahl und Summe, ein Tipp öffnet den Warenkorb
export const schwebeView = (z) =>
  stueck(z.korb) === 0
    ? null
    : h(
        "button",
        {
          type: "button",
          class: "btn p laden-schwebe",
          "data-aktion": "korb",
          "data-f": "schwebe",
        },
        zeichen(...TASCHE),
        "Warenkorb",
        h("span", { class: "nur-leser" }, `, ${stueck(z.korb)} Stück, `),
        h(
          "span",
          { class: "laden-anzahl", "aria-hidden": "true" },
          String(stueck(z.korb)),
        ),
        h("span", { class: "betrag" }, summeText(summe(z.korb, z.artikel))),
      );

// Dialog eines Artikels: Bild, Name, Preis, Variante, Menge, «In den Warenkorb»
export function artikelView(a, wahl, grenzen) {
  return h(
    "form",
    { class: "laden-wahl", method: "dialog", novalidate: true },
    bildView(a, "laden-wahl-bild"),
    h(
      "div",
      { class: "laden-wahl-text" },
      h("h2", { id: "laden-wahl-t" }, a.name),
      h("p", { class: "preis" }, preisText(a.preisRappen)),
      a.hinweis ? h("p", { class: "hinweis" }, a.hinweis) : null,
      a.varianten.length > 0
        ? h(
            "div",
            { class: wahl.fehler ? "feld fehler" : "feld" },
            h("label", { for: "laden-variante" }, "Variante"),
            h(
              "select",
              {
                id: "laden-variante",
                class: "eingabe",
                "data-f": "variante",
                required: true,
                "aria-invalid": wahl.fehler ? "true" : null,
                "aria-describedby": wahl.fehler ? "laden-variante-f" : null,
              },
              h(
                "option",
                { value: "", disabled: true, selected: wahl.variante === null },
                "Bitte wählen",
              ),
              a.varianten.map((v) =>
                h("option", { value: v, selected: v === wahl.variante }, v),
              ),
            ),
            wahl.fehler
              ? h(
                  "p",
                  { class: "hilfe fehlertext", id: "laden-variante-f" },
                  icon("warnung"),
                  "Wähle eine Variante.",
                )
              : null,
          )
        : null,
      h(
        "div",
        { class: "laden-wahl-menge" },
        h(
          "span",
          { class: "laden-beschriftung", "aria-hidden": "true" },
          "Menge",
        ),
        mengeView({
          name: a.name,
          menge: wahl.menge,
          max: grenzen.menge,
          f: "wahl",
        }),
      ),
      h(
        "div",
        { class: "knopfreihe" },
        h(
          "button",
          { type: "submit", class: "btn p gross", "data-f": "dazu" },
          "In den Warenkorb",
        ),
        h(
          "button",
          { type: "button", class: "btn t", "data-aktion": "zu" },
          "Abbrechen",
        ),
      ),
    ),
  );
}

const zeilenView = (z) =>
  h(
    "ul",
    { class: "laden-zeilen" },
    z.korb.map((k, n) => {
      const a = z.artikel.get(k.id);
      return h(
        "li",
        { "data-zeile": String(n) },
        bildView(a, "laden-zeile-bild"),
        h(
          "div",
          { class: "laden-zeile-text" },
          h(
            "div",
            { class: "laden-zeile-kopf" },
            h("p", { class: "name" }, a.name),
            h("p", { class: "preis" }, summeText(k.menge * a.preisRappen)),
          ),
          k.variante ? h("p", { class: "leise" }, k.variante) : null,
          h(
            "div",
            { class: "laden-zeile-fuss" },
            mengeView({
              name: a.name,
              menge: k.menge,
              max: z.grenzen.menge,
              f: `z${n}`,
              gesperrt: z.sendet,
            }),
            h(
              "button",
              {
                type: "button",
                class: "btn t",
                "data-aktion": "entfernen",
                "data-f": `z${n}-e`,
                "aria-label": `${a.name} entfernen`,
                disabled: z.sendet,
              },
              "Entfernen",
            ),
          ),
        ),
      );
    }),
  );

// Der Warenkorb nach dem Muster einer Bestellübersicht: Zeilen, Übergabe, Summe, «Bestellen»
export function korbView(z) {
  const kopf = (titel, zahl) =>
    h(
      "div",
      { class: "laden-korb-kopf" },
      h("h2", { id: "laden-korb-t", tabindex: "-1" }, titel),
      zahl === null ? null : h("p", { class: "leise" }, `${zahl} Stück`),
      h(
        "button",
        {
          type: "button",
          class: "laden-zu",
          "data-aktion": "zu",
          "data-f": "zu",
          "aria-label": "Warenkorb schliessen",
        },
        icon("zu", false),
      ),
    );
  if (z.bestaetigt) {
    const b = z.bestaetigt;
    return h(
      "div",
      { class: "laden-korb-inhalt" },
      kopf("Bestellung gesendet", null),
      bandView({
        art: "ok",
        symbol: "haken",
        titel: "Deine Bestellung ist eingegangen.",
        text: `Du bezahlst bei der Übergabe: ${b.uebergabe}. Den Stand siehst du unter «Deine Bestellungen».`,
      }),
      positionenView(b),
      h(
        "div",
        { class: "laden-summe" },
        h("p", { class: "leise" }, "Summe"),
        h("p", { class: "betrag" }, summeText(b.summeRappen)),
      ),
      h(
        "div",
        { class: "knopfreihe" },
        h(
          "button",
          {
            type: "button",
            class: "btn p",
            "data-aktion": "zu",
            "data-f": "fertig",
          },
          "Schliessen",
        ),
      ),
    );
  }
  const leer = z.korb.length === 0;
  return h(
    "div",
    { class: "laden-korb-inhalt" },
    kopf("Warenkorb", stueck(z.korb)),
    z.meldung ? bandView({ rolle: "alert", ...z.meldung }) : null,
    leer
      ? h(
          "p",
          { class: "laden-leer" },
          "Dein Warenkorb ist leer. Wähle im Laden einen Artikel.",
        )
      : zeilenView(z),
    // Bleibt stehen, bis der Korb sich das nächste Mal ändert
    z.entfernt
      ? h(
          "p",
          { class: "laden-entfernt" },
          `${z.artikel.get(z.entfernt.id)?.name ?? "Artikel"} entfernt.`,
          h(
            "button",
            {
              type: "button",
              class: "btn t",
              "data-aktion": "zurueck",
              "data-f": "zurueck",
            },
            "Rückgängig machen",
          ),
        )
      : null,
    leer
      ? null
      : [
          h(
            "div",
            { class: "laden-uebergabe" },
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
                      disabled: z.sendet,
                    },
                    z.uebergabearten.map((u) =>
                      h("option", { value: u, selected: u === z.uebergabe }, u),
                    ),
                  ),
                )
              : h(
                  "dl",
                  { class: "laden-angabe" },
                  h("dt", {}, "Übergabe"),
                  h("dd", {}, z.uebergabe),
                ),
            h(
              "dl",
              { class: "laden-angabe" },
              h("dt", {}, "Bezahlung"),
              h("dd", {}, "Bei der Übergabe"),
            ),
          ),
          h(
            "div",
            { class: "laden-summe" },
            h(
              "div",
              {},
              h("p", { class: "leise" }, "Summe"),
              h("p", { class: "betrag" }, summeText(summe(z.korb, z.artikel))),
            ),
            h(
              "button",
              {
                type: "button",
                class: "btn p gross",
                "data-aktion": "bestellen",
                "data-f": "bestellen",
                "aria-disabled": z.sendet ? "true" : null,
              },
              z.sendet ? h("span", { class: "lade" }) : null,
              z.sendet ? "Wird gesendet …" : "Bestellen",
            ),
          ),
          h(
            "p",
            { class: "klein leise" },
            "Mit «Bestellen» sendest du die Bestellung an die Abteilung. Solange sie offen ist, kannst du sie unter «Deine Bestellungen» stornieren.",
          ),
        ],
  );
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
        h("span", { class: "preis" }, summeText(p.menge * p.einzelpreisRappen)),
      ),
    ),
  );

// «Deine Bestellungen» unter dem Laden. Zustände lädt, leer und Fehler sind bewusst einfach: Hier setzt das gemeinsame System für Ladezustände (#567) an
export function bestellungenView(b) {
  const titel = h("h2", { id: "laden-bestellungen-t" }, "Deine Bestellungen");
  if (b.zustand === "lade") {
    return [titel, h("p", { class: "leise", role: "status" }, "Lädt …")];
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
          { type: "button", class: "btn s", "data-aktion": "nochmal" },
          "Nochmals versuchen",
        ),
      }),
    ];
  }
  if (b.liste.length === 0) {
    return [titel, h("p", { class: "leise" }, "Du hast noch nichts bestellt.")];
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
                    class: "btn s",
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
            class: "btn s",
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
  if (r.status === 401) {
    return {
      art: "wa",
      symbol: "schloss",
      titel: "Du bist nicht mehr angemeldet.",
      text: "Dein Warenkorb bleibt erhalten.",
      aktion: h(
        "a",
        { class: "btn s", href: loginLink(location.pathname) },
        "Anmelden",
      ),
    };
  }
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

function start(doc, wurzel) {
  const z = {
    artikel: new Map(),
    korb: [],
    grenzen: { positionen: 20, menge: 10 },
    uebergabearten: [],
    uebergabe: null,
    entfernt: null,
    meldung: null,
    sendet: false,
    bestaetigt: null,
    bestellungen: {
      zustand: "lade",
      liste: [],
      weitere: false,
      naechste: null,
    },
  };
  // Bilder und Kacheln stehen schon im Dokument
  const kacheln = new Map(
    [...wurzel.querySelectorAll(".laden-artikel[data-id]")].map((li) => [
      li.dataset.id,
      li,
    ]),
  );
  const zugang = wurzel.querySelector("[data-laden-zugang]");
  const anmelden = zugang?.querySelector("a");
  // Nach der Anmeldung zurück auf diese Seite
  if (anmelden) anmelden.href = loginLink(location.pathname);

  const live = baue(doc, h("p", { class: "nur-leser", role: "status" }));
  const sage = (text) => {
    live.textContent = "";
    live.textContent = text;
  };
  const kopf = doc.createElement("div");
  const schwebe = doc.createElement("div");
  const wahlDlg = baue(
    doc,
    h("dialog", { class: "laden-dialog", "aria-labelledby": "laden-wahl-t" }),
  );
  const korbDlg = baue(
    doc,
    h("dialog", {
      class: "laden-korb",
      "aria-labelledby": "laden-korb-t",
    }),
  );
  const liste = baue(
    doc,
    h("section", {
      class: "laden-bestellungen",
      id: "laden-bestellungen",
      "aria-labelledby": "laden-bestellungen-t",
    }),
  );
  let wahl = null;
  let ausloeser = null;

  // Zeichnet neu und gibt den Fokus dem Element mit demselben Schlüssel zurück
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
  }
  const merke = () => {
    try {
      doc.defaultView.localStorage.setItem(SPEICHER, JSON.stringify(z.korb));
    } catch {
      // Ohne Speicher lebt der Korb, bis die Seite neu lädt
    }
  };
  const zeichneKopf = () => {
    zeichne(kopf, zugangView(z));
    zeichne(schwebe, schwebeView(z));
  };
  const zeichneKorb = () => zeichne(korbDlg, korbView(z));
  const zeichneListe = () => zeichne(liste, bestellungenView(z.bestellungen));
  function aendereKorb(korb, ansage) {
    z.korb = korb;
    z.meldung = null;
    merke();
    zeichneKopf();
    zeichneKorb();
    if (ansage) sage(ansage);
  }

  function uebernimm(daten) {
    z.grenzen = daten.grenzen;
    z.uebergabearten = daten.uebergabearten;
    if (!z.uebergabearten.includes(z.uebergabe)) {
      z.uebergabe = z.uebergabearten[0];
    }
    z.artikel = new Map(
      daten.artikel.map((a) => {
        const img = kacheln.get(a.id)?.querySelector("img");
        return [
          a.id,
          {
            ...a,
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

  async function ladeBestellungen(mehr = false) {
    const b = z.bestellungen;
    if (!mehr) {
      b.zustand = "lade";
      zeichneListe();
    }
    const r = await api(
      `/laden/bestellungen/meine${mehr && b.naechste ? `?nach=${b.naechste}` : ""}`,
    );
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
    zeichneKopf();
  }

  function oeffneWahl(a, knopf) {
    wahl = { artikel: a, variante: null, menge: 1, fehler: false };
    ausloeser = knopf;
    zeichne(wahlDlg, artikelView(a, wahl, z.grenzen));
    wahlDlg.showModal();
  }
  function lege(a, variante, menge) {
    const { korb, voll } = legeDazu(
      z.korb,
      { id: a.id, variante, menge },
      z.grenzen,
    );
    z.entfernt = null;
    if (voll) {
      z.meldung = {
        art: "wa",
        symbol: "warnung",
        titel: `Der Warenkorb fasst höchstens ${z.grenzen.positionen} verschiedene Artikel.`,
      };
      zeichneKorb();
      oeffneKorb();
      return;
    }
    aendereKorb(korb, `${a.name} liegt im Warenkorb. ${stueck(korb)} Stück.`);
  }
  function oeffneKorb(knopf) {
    if (korbDlg.open) return;
    ausloeser = knopf ?? kopf.querySelector('[data-aktion="korb"]');
    zeichneKorb();
    korbDlg.showModal();
    korbDlg.querySelector("h2")?.focus();
  }

  async function bestelle() {
    if (z.sendet || z.korb.length === 0) return;
    z.sendet = true;
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
    z.sendet = false;
    if (r.status === 201) {
      z.bestaetigt = r.daten;
      z.korb = [];
      merke();
      zeichneKopf();
      zeichneKorb();
      korbDlg.querySelector("h2")?.focus();
      sage("Deine Bestellung ist eingegangen.");
      void ladeBestellungen();
      return;
    }
    z.meldung = fehlerMeldung(r);
    // Preise, Verfügbarkeit oder Übergabe haben sich geändert: den Laden neu lesen, damit Korb und Summe wieder stimmen
    if (r.status === 409 || r.status === 400) {
      const neu = await api("/laden");
      if (neu.status === 200) {
        uebernimm(neu.daten);
        z.korb = bereinige(z.korb, z.artikel, z.grenzen);
        merke();
        zeichneKopf();
      }
    }
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

  // --- Ereignisse
  wurzel.addEventListener("click", (e) => {
    const knopf = e.target.closest?.("[data-aktion]");
    if (!knopf || knopf.getAttribute("aria-disabled") === "true") return;
    const aktion = knopf.dataset.aktion;
    const zeile = knopf.closest("[data-zeile]");
    const n = zeile ? Number(zeile.dataset.zeile) : -1;
    if (aktion === "waehle") {
      const a = z.artikel.get(knopf.closest("[data-id]").dataset.id);
      if (!a) return;
      if (a.varianten.length > 0) oeffneWahl(a, knopf);
      else lege(a, null, 1);
    } else if (aktion === "korb") {
      z.bestaetigt = null;
      oeffneKorb(knopf);
    } else if (aktion === "zu") {
      knopf.closest("dialog").close();
    } else if (aktion === "bestellen") {
      void bestelle();
    } else if (aktion === "zurueck" && z.entfernt) {
      const { korb } = legeDazu(z.korb, z.entfernt, z.grenzen);
      z.entfernt = null;
      aendereKorb(korb, "Wieder im Warenkorb.");
    } else if (aktion === "entfernen" && n >= 0) {
      z.entfernt = z.korb[n];
      aendereKorb(
        z.korb.filter((_, i) => i !== n),
        `${z.artikel.get(z.entfernt.id).name} entfernt.`,
      );
      // Die Zeile mit dem Fokus ist weg: Er geht zu «Rückgängig machen»
      korbDlg.querySelector('[data-f="zurueck"]')?.focus();
    } else if ((aktion === "mehr" || aktion === "weniger") && n >= 0) {
      const menge = z.korb[n].menge + (aktion === "mehr" ? 1 : -1);
      z.entfernt = null;
      aendereKorb(
        z.korb.map((k, i) => (i === n ? { ...k, menge } : k)),
        `Menge ${menge}. Summe ${summeText(summe(z.korb, z.artikel) + (aktion === "mehr" ? 1 : -1) * z.artikel.get(z.korb[n].id).preisRappen)}.`,
      );
    } else if ((aktion === "mehr" || aktion === "weniger") && wahl) {
      wahl.menge += aktion === "mehr" ? 1 : -1;
      zeichne(wahlDlg, artikelView(wahl.artikel, wahl, z.grenzen));
      sage(`Menge ${wahl.menge}.`);
    } else if (aktion === "stornieren") {
      void storniere(knopf.dataset.id);
    } else if (aktion === "weitere") {
      void ladeBestellungen(true);
    } else if (aktion === "nochmal") {
      void ladeBestellungen();
    }
  });
  wurzel.addEventListener("change", (e) => {
    if (e.target.id === "laden-variante" && wahl) {
      wahl.variante = e.target.value || null;
      wahl.fehler = false;
    } else if (e.target.id === "laden-uebergabe") {
      z.uebergabe = e.target.value;
    }
  });
  wahlDlg.addEventListener("submit", (e) => {
    e.preventDefault();
    const a = wahl.artikel;
    if (a.varianten.length > 0 && wahl.variante === null) {
      wahl.fehler = true;
      zeichne(wahlDlg, artikelView(a, wahl, z.grenzen));
      wahlDlg.querySelector('[data-f="variante"]')?.focus();
      return;
    }
    wahlDlg.close();
    lege(a, wahl.variante, wahl.menge);
  });
  // Der Fokus geht zurück zum Auslöser; ein Klick neben den Dialog schliesst ihn
  for (const dlg of [wahlDlg, korbDlg]) {
    dlg.addEventListener("close", () => {
      if (dlg === wahlDlg) wahl = null;
      ausloeser?.focus();
    });
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });
  }

  async function lade() {
    const r = await api("/laden");
    // Ohne Sitzung (401) oder bei einem Fehler bleibt die Preisliste mit dem Hinweis stehen
    if (r.status !== 200) return;
    uebernimm(r.daten);
    let roh;
    try {
      roh = JSON.parse(doc.defaultView.localStorage.getItem(SPEICHER) ?? "[]");
    } catch {
      roh = [];
    }
    z.korb = bereinige(roh, z.artikel, z.grenzen);
    for (const [id, li] of kacheln) {
      const a = z.artikel.get(id);
      if (!a?.verfuegbar) continue;
      li.querySelector(".laden-bild")?.append(
        baue(
          doc,
          h(
            "button",
            {
              type: "button",
              class: "laden-plus",
              "data-aktion": "waehle",
              "aria-label":
                a.varianten.length > 0
                  ? `${a.name} wählen`
                  : `${a.name} in den Warenkorb`,
            },
            zeichen(...PLUS),
          ),
        ),
      );
    }
    zugang?.replaceWith(kopf);
    wurzel.append(liste, schwebe, wahlDlg, korbDlg, live);
    wurzel.classList.add("laden--an");
    zeichneKopf();
    void ladeBestellungen();
  }
  void lade();
}

const wurzel =
  typeof document === "undefined"
    ? null
    : document.querySelector("[data-laden]");
if (wurzel) start(document, wurzel);

import { anfrage, fehlertext } from "./api.js";
import { auswahl, chip, el, tabelle, zeit } from "./dom.js";

// Betriebszahlen der API: Seite «System» und Bausteine für die «Übersicht». Alles kommt als Zahl oder fester Text von /api/v1/admin/system*; Anfragen werden nur im Arbeitsspeicher der API gezählt und beginnen nach jedem Neustart bei null.

const ZAHL = new Intl.NumberFormat("de-CH");
const PROZENT = new Intl.NumberFormat("de-CH", {
  style: "percent",
  maximumFractionDigits: 1,
});
const UHR = new Intl.DateTimeFormat("de-CH", {
  hour: "2-digit",
  minute: "2-digit",
});
const UHR_SEKUNDEN = new Intl.DateTimeFormat("de-CH", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const STUNDE = new Intl.DateTimeFormat("de-CH", {
  weekday: "short",
  hour: "2-digit",
});
const RELATIV = new Intl.RelativeTimeFormat("de-CH", { numeric: "auto" });

export const zahl = (n) =>
  n === null || n === undefined ? "–" : ZAHL.format(n);
export const prozent = (n) => PROZENT.format(n);
export const ms = (n) =>
  n === null || n === undefined ? "–" : `${ZAHL.format(n)} ms`;

export function dauer(sekunden) {
  const t = Math.floor(sekunden / 86400);
  const h = Math.floor((sekunden % 86400) / 3600);
  const m = Math.floor((sekunden % 3600) / 60);
  if (t > 0) return `${t} Tg. ${h} Std.`;
  if (h > 0) return `${h} Std. ${m} Min.`;
  if (m > 0) return `${m} Min.`;
  return `${sekunden} Sek.`;
}

// «vor 3 Minuten»; das Datum steht zusätzlich im Titel des Elements
export function vor(iso) {
  const sekunden = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(sekunden);
  if (abs < 60) return RELATIV.format(Math.round(sekunden / 10) * 10, "second");
  if (abs < 3600) return RELATIV.format(Math.round(sekunden / 60), "minute");
  if (abs < 86400) return RELATIV.format(Math.round(sekunden / 3600), "hour");
  return RELATIV.format(Math.round(sekunden / 86400), "day");
}

export async function ladeBetrieb() {
  const [system, anfragen] = await Promise.all([
    anfrage("GET", "/api/v1/admin/system"),
    anfrage("GET", "/api/v1/admin/system/requests"),
  ]);
  return { system, anfragen };
}

// Lädt alle 15 Sekunden neu, solange der Bereich auf der Seite steht und der Reiter sichtbar ist; ein Fehler lässt die alten Zahlen stehen
export function laufend(bereich, laden, zeichnen, fehlerFeld, sekunden = 15) {
  let laeuft = false;
  async function lauf() {
    if (laeuft || document.hidden) return;
    laeuft = true;
    try {
      zeichnen(await laden());
      fehlerFeld.textContent = "";
    } catch (f) {
      if (bereich.isConnected) {
        fehlerFeld.textContent = `Aktualisieren nicht möglich: ${fehlertext(f)}`;
      }
    } finally {
      laeuft = false;
    }
  }
  const takt = setInterval(() => {
    if (!bereich.isConnected) stoppe();
    else lauf();
  }, sekunden * 1000);
  const sichtbar = () => {
    if (!document.hidden && bereich.isConnected) lauf();
  };
  function stoppe() {
    clearInterval(takt);
    document.removeEventListener("visibilitychange", sichtbar);
  }
  document.addEventListener("visibilitychange", sichtbar);
}

// Zustand steht immer auch als Wort im Text, nie nur als Farbe des Punktes
export function kachel({ titel, wert, hinweis, status, link, text }) {
  return el(
    "div",
    { class: status ? `kachel kachel--${status}` : "kachel" },
    el("p", { class: "kachel-titel" }, titel),
    el(
      "p",
      { class: text ? "kachel-wert kachel-wert--text" : "kachel-wert" },
      wert,
    ),
    hinweis && el("p", { class: "kachel-hinweis" }, hinweis),
    link,
  );
}

export function panel(titel, ...inhalt) {
  return el("section", { class: "panel" }, el("h2", {}, titel), ...inhalt);
}

// Zeilen aus Name und Wert; wert darf Text oder Knoten sein
export function werte(zeilen) {
  return el(
    "dl",
    { class: "werte" },
    zeilen
      .filter(Boolean)
      .map(([name, wert]) =>
        el("div", {}, el("dt", {}, name), el("dd", {}, wert)),
      ),
  );
}

// Der Namensraum von SVG ist eine Kennung, keine Adresse: Es wird nichts geladen
const SVG = "http://www.w3.org/2000/svg";
function svg(tag, eigenschaften = {}, ...kinder) {
  const knoten = document.createElementNS(SVG, tag);
  for (const [name, wert] of Object.entries(eigenschaften)) {
    knoten.setAttribute(name, String(wert));
  }
  knoten.append(...kinder.flat(Infinity));
  return knoten;
}

// Gestapelte Balken je Zeitraum: in Ordnung, 4xx, 5xx. Die Tabelle dahinter enthält dieselben Zahlen.
export function diagramm({ titel, punkte, beschriftung, einheit, offen }) {
  const B = 720;
  const H = 160;
  const max = Math.max(1, ...punkte.map((p) => p.anzahl));
  const schritt = B / punkte.length;
  const breite = Math.max(2, schritt * 0.72);
  const gesamt = punkte.reduce((a, p) => a + p.anzahl, 0);
  const spitze = punkte.reduce(
    (a, p) => (p.anzahl > a.anzahl ? p : a),
    punkte[0],
  );
  const balken = punkte.map((p, i) => {
    const x = i * schritt + (schritt - breite) / 2;
    const teile = [
      ["bal--ok", p.anzahl - p.fehler4xx - p.fehler5xx],
      ["bal--4xx", p.fehler4xx],
      ["bal--5xx", p.fehler5xx],
    ];
    let unten = H;
    return svg(
      "g",
      {},
      svg(
        "title",
        {},
        `${beschriftung(p.ab)}: ${zahl(p.anzahl)} Anfragen, davon ${zahl(p.fehler4xx)} mit 4xx und ${zahl(p.fehler5xx)} mit 5xx`,
      ),
      // Unsichtbare Fläche über die ganze Höhe, damit auch ein kleiner Balken den Hinweis zeigt
      svg("rect", { class: "bal--flaeche", x, y: 0, width: breite, height: H }),
      teile
        .filter(([, n]) => n > 0)
        .map(([klasse, n]) => {
          const h = Math.max(1.5, (n / max) * (H - 4));
          unten -= h;
          return svg("rect", {
            class: klasse,
            x,
            y: unten,
            width: breite,
            height: h,
            rx: 1,
          });
        }),
    );
  });
  const gitter = [0, 0.5, 1].map((anteil) =>
    svg("line", {
      class: "gitter",
      x1: 0,
      x2: B,
      y1: H - anteil * (H - 4),
      y2: H - anteil * (H - 4),
    }),
  );
  const grafik = svg(
    "svg",
    {
      viewBox: `0 0 ${B} ${H}`,
      preserveAspectRatio: "none",
      role: "img",
      "aria-label": `${titel}: ${zahl(gesamt)} Anfragen insgesamt, Spitze ${zahl(spitze.anzahl)} ${einheit} (${beschriftung(spitze.ab)}).`,
    },
    gitter,
    balken,
  );
  const zeilen = tabelle({
    beschriftung: `${titel} als Tabelle`,
    spalten: [
      "Zeitraum",
      ["Anfragen", "zahl"],
      ["davon 4xx", "zahl"],
      ["davon 5xx", "zahl"],
    ],
    zeilen: [...punkte]
      .reverse()
      .map((p) =>
        el(
          "tr",
          {},
          el("th", { scope: "row" }, beschriftung(p.ab)),
          el("td", {}, zahl(p.anzahl)),
          el("td", {}, zahl(p.fehler4xx)),
          el("td", {}, zahl(p.fehler5xx)),
        ),
      ),
  });
  const alternative = el(
    "details",
    { class: "diagramm-tabelle", open: offen.wert },
    el("summary", {}, "Als Tabelle anzeigen"),
    zeilen.wurzel,
  );
  alternative.addEventListener("toggle", () => {
    offen.wert = alternative.open;
  });
  return el(
    "figure",
    { class: "diagramm" },
    el(
      "div",
      { class: "diagramm-achse" },
      el("span", {}, `Höchstwert ${zahl(max)} pro ${einheit}`),
      el(
        "ul",
        { class: "legende" },
        el("li", { class: "legende--ok" }, "In Ordnung"),
        el("li", { class: "legende--4xx" }, "4xx"),
        el("li", { class: "legende--5xx" }, "5xx"),
      ),
    ),
    grafik,
    el(
      "div",
      { class: "diagramm-achse diagramm-achse--unten" },
      el("span", {}, beschriftung(punkte[0].ab)),
      el("span", {}, "jetzt"),
    ),
    alternative,
  );
}

export const stundenName = (iso) => STUNDE.format(new Date(iso));
export const minutenName = (iso) => UHR.format(new Date(iso));

export function fehlerTabelle(fehler, max = fehler.length) {
  const gezeigt = fehler.slice(0, max);
  if (fehler.length === 0) {
    return el(
      "p",
      { class: "leer leer--klein" },
      "Keine Fehler seit dem Start.",
    );
  }
  return tabelle({
    beschriftung: "Letzte Fehler",
    spalten: ["Zeit", "Status", "Anfrage"],
    zeilen: gezeigt.map((f) =>
      el(
        "tr",
        {},
        el("th", { scope: "row" }, UHR_SEKUNDEN.format(new Date(f.zeit))),
        el(
          "td",
          {},
          el(
            "ul",
            { class: "chips" },
            chip(String(f.status), f.status >= 500 ? "fehler" : "warn"),
          ),
        ),
        el("td", { class: "code" }, `${f.methode} ${f.route}`),
      ),
    ),
  }).wurzel;
}

export function hinweisSeitStart(anfragen) {
  return `Die Zahlen zu den Anfragen liegen im Arbeitsspeicher der API und beginnen nach jedem Neustart bei null. Seit dem Start am ${zeit(anfragen.seit)}.`;
}

const SORTIERUNG = [
  ["anzahl", "Häufigste zuerst"],
  ["p95Ms", "Langsamste zuerst (95 %)"],
  ["fehler", "Meiste Fehler zuerst"],
];
const fehlerzahl = (r) => r.fehler4xx + r.fehler5xx;
const wertFuer = {
  anzahl: (r) => r.anzahl,
  p95Ms: (r) => r.p95Ms ?? -1,
  fehler: fehlerzahl,
};

export function zeige(bereich, ctx) {
  ctx.lade(ladeBetrieb, (daten) => zeichneSeite(bereich, daten));
}

function zeichneSeite(bereich, daten) {
  let anfragen;
  let sortierung = "anzahl";
  const offen = { wert: false };
  // Nur ein Fehler wird angesagt; die regelmässige Aktualisierung bleibt still
  const fehlerFeld = el("p", { class: "meta fehlerzeile", role: "status" });
  const stand = el("p", { class: "meta stand" });
  const kacheln = el("div", { class: "kacheln" });
  const verlauf = el("div", {});
  const routen = el("div", {});
  const fehler = el("div", {});
  const system = el("div", { class: "raster raster--2" });
  const sortieren = auswahl({
    label: "Sortieren",
    optionen: SORTIERUNG,
    wert: sortierung,
  });

  function zeichneRouten() {
    const zeilen = [...anfragen.routen].sort(
      (a, b) => wertFuer[sortierung](b) - wertFuer[sortierung](a),
    );
    routen.replaceChildren(
      zeilen.length === 0
        ? el(
            "p",
            { class: "leer leer--klein" },
            "Noch keine Anfragen seit dem Start.",
          )
        : tabelle({
            beschriftung: "Anfragen je Route",
            spalten: [
              "Methode",
              "Route",
              ["Anzahl", "zahl"],
              ["4xx", "zahl"],
              ["5xx", "zahl"],
              ["Fehlerquote", "zahl"],
              ["p50", "zahl"],
              ["p95", "zahl"],
            ],
            zeilen: zeilen.map((r) =>
              el(
                "tr",
                {},
                el("th", { scope: "row" }, r.methode || "–"),
                el("td", { class: "code" }, r.route),
                el("td", { class: "zahl" }, zahl(r.anzahl)),
                el("td", { class: "zahl" }, zahl(r.fehler4xx)),
                el("td", { class: "zahl" }, zahl(r.fehler5xx)),
                el("td", { class: "zahl" }, prozent(fehlerzahl(r) / r.anzahl)),
                el("td", { class: "zahl" }, ms(r.p50Ms)),
                el("td", { class: "zahl" }, ms(r.p95Ms)),
              ),
            ),
          }).wurzel,
    );
  }

  function zeichne({ system: s, anfragen: a }) {
    anfragen = a;
    const p = s.prozess;
    const d = s.datenbank;
    const k = s.kalender;
    const ja = (b) => (b ? "Ja" : "Nein");
    stand.textContent = `Stand ${UHR_SEKUNDEN.format(new Date())}, wird alle 15 Sekunden aktualisiert.`;
    kacheln.replaceChildren(...anfragenKacheln(a));
    verlauf.replaceChildren(
      diagramm({
        titel: "Anfragen pro Minute, letzte Stunde",
        punkte: a.minuten,
        beschriftung: minutenName,
        einheit: "Minute",
        offen,
      }),
    );
    fehler.replaceChildren(fehlerTabelle(a.letzteFehler, 15));
    system.replaceChildren(
      panel(
        "Prozess",
        werte([
          ["Node", p.node],
          ["Commit", p.commit ?? "nicht gesetzt"],
          ["Gestartet", zeit(p.gestartetAm)],
          ["Laufzeit", dauer(p.laufzeitSekunden)],
          ["Speicher (RSS)", `${ZAHL.format(p.rssMb)} MB`],
          [
            "Heap genutzt / gesamt",
            `${ZAHL.format(p.heapGenutztMb)} / ${ZAHL.format(p.heapGesamtMb)} MB`,
          ],
          [
            "Ereignisschleife (p99)",
            p.schleifeP99Ms === null
              ? "–"
              : `${ZAHL.format(p.schleifeP99Ms)} ms`,
          ],
        ]),
      ),
      panel(
        "Datenbank",
        werte([
          [
            "Zustand",
            el(
              "ul",
              { class: "chips" },
              chip(
                d.erreichbar ? "Erreichbar" : "Nicht erreichbar",
                d.erreichbar ? "ok" : "fehler",
              ),
            ),
          ],
          [
            "Antwortzeit",
            d.pingMs === null ? "–" : `${ZAHL.format(d.pingMs)} ms`,
          ],
          [
            "Verbindungen",
            d.verbindungen === null
              ? "–"
              : `${zahl(d.verbindungen)} (alle Anwendungen)`,
          ],
          ["Pool der API", `höchstens ${zahl(d.poolMaximum)}`],
        ]),
      ),
      panel(
        "Kalender-Sync",
        werte([
          ["Eingerichtet", ja(k.eingerichtet)],
          [
            "Letzter Erfolg",
            k.letzterErfolgAm
              ? `${zeit(k.letzterErfolgAm)} (${vor(k.letzterErfolgAm)})`
              : "noch nie",
          ],
          ["Fehler", k.fehler ?? "keiner"],
        ]),
      ),
      panel(
        "Umgebung",
        werte([
          ["HTTPS", ja(s.umgebung.https)],
          ["Produktion", ja(s.umgebung.produktion)],
          ["Google-Schlüssel konfiguriert", ja(s.umgebung.kalenderSchluessel)],
        ]),
      ),
    );
    zeichneRouten();
  }

  sortieren.eingabe.addEventListener("change", () => {
    sortierung = sortieren.eingabe.value;
    zeichneRouten();
  });
  zeichne(daten);
  bereich.append(
    el("div", { class: "stand-zeile" }, stand, fehlerFeld),
    system,
    el("h2", { class: "abschnitt" }, "API-Anfragen"),
    el("p", { class: "hilfe" }, hinweisSeitStart(daten.anfragen)),
    kacheln,
    panel("Anfragen pro Minute", verlauf),
    panel(
      "Anfragen je Route",
      el("div", { class: "werkzeuge" }, sortieren.wurzel),
      routen,
    ),
    panel("Letzte Fehler", fehler),
  );
  laufend(bereich, ladeBetrieb, zeichne, fehlerFeld);
}

// Kacheln zu den Anfragen, auf «System» und «Übersicht» gleich
export function anfragenKacheln(a) {
  return [
    kachel({
      titel: "Anfragen (24 Std.)",
      wert: zahl(a.gesamt),
      hinweis: `${zahl(a.letzteMinute)} in der letzten Minute`,
    }),
    kachel({ titel: "Letzte Stunde", wert: zahl(a.letzteStunde) }),
    kachel({
      titel: "Fehlerquote 5xx",
      wert: prozent(a.quote5xx),
      status: a.quote5xx > 0.01 ? "fehler" : "ok",
      hinweis: `4xx: ${prozent(a.quote4xx)}`,
    }),
    kachel({
      titel: "Dauer p50 / p95",
      wert: `${ms(a.p50Ms)} / ${ms(a.p95Ms)}`,
      hinweis: "Obergrenze der Dauerklasse",
    }),
  ];
}

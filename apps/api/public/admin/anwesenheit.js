import { anfrage } from "./api.js";
import { el, filterGruppe, icon, knopf, tabelle } from "./dom.js";

// Bereich «Anwesenheit» (#195): pro Stufe eine Tabelle mit den letzten Anlässen, je ein Reiter für Kinder und Leitende. Gelesen wird nur; erfasst wird in der App, Zusagen ändert niemand für jemand anderen.
// Adressen (Hash): #anwesenheit · #anwesenheit/<stufe> · #anwesenheit/<stufe>/<kinder|leitende>/<5|10|20>
// Abfragen: GET /api/v1/stufen und GET /api/v1/stufen/<id>/anwesenheit, je einmal beim Öffnen; kein Polling. Die Antwort bleibt 60 Sekunden im Speicher der Seite, damit der Wechsel zwischen den Reitern nicht nochmals fragt; «Aktualisieren» holt sie neu.

const ZONE = "Europe/Zurich";
const ANZAHLEN = [5, 10, 20];
const REITER = [
  ["kinder", "Kinder"],
  ["leitende", "Leitende"],
];
const ROLLEN = { leitung: "Leitung", stufenleitung: "Stufenleitung" };
const GUELTIG_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tagFormat = new Intl.DateTimeFormat("de-CH", {
  weekday: "short",
  day: "numeric",
  month: "numeric",
  year: "2-digit",
  timeZone: ZONE,
});
const tagUtc = new Intl.DateTimeFormat("de-CH", {
  weekday: "short",
  day: "numeric",
  month: "numeric",
  year: "2-digit",
  timeZone: "UTC",
});

const tagVon = (a) =>
  a.ganztaegig
    ? tagUtc.format(new Date(`${a.tagVon}T12:00:00Z`))
    : tagFormat.format(new Date(a.beginn));

let zwischen = null;

const adresse = (stufe, reiter, anzahl) =>
  `#anwesenheit/${stufe}/${reiter}/${anzahl}`;

async function ladeDaten(stufeId, anzahl) {
  const schluessel = `${stufeId ?? ""}|${anzahl}`;
  if (
    zwischen?.schluessel === schluessel &&
    Date.now() - zwischen.zeit < GUELTIG_MS
  ) {
    return zwischen.daten;
  }
  let daten;
  const abfrage = (id) =>
    anfrage("GET", `/api/v1/stufen/${id}/anwesenheit?anzahl=${anzahl}`);
  if (stufeId) {
    const [stufen, antwort] = await Promise.all([
      anfrage("GET", "/api/v1/stufen"),
      abfrage(stufeId),
    ]);
    daten = { stufen: stufen.stufen, stufeId, antwort };
  } else {
    const { stufen } = await anfrage("GET", "/api/v1/stufen");
    daten = {
      stufen,
      stufeId: stufen[0]?.id,
      antwort: stufen[0] ? await abfrage(stufen[0].id) : null,
    };
  }
  zwischen = { schluessel, zeit: Date.now(), daten };
  return daten;
}

// Zustand steht als Wort und Symbol, nie nur als Farbe
function zeichen(text, art, symbol) {
  return el(
    "span",
    { class: art ? `chip chip--${art}` : "chip" },
    icon(symbol),
    text,
  );
}

const ANWESEND = {
  da: () => zeichen("da", "ok", "haken"),
  nicht_da: () => zeichen("nicht da", undefined, "schliessen"),
};
const ZUSAGE = {
  ja: () => zeichen("kommt", "ok", "haken"),
  nein: () => zeichen("kommt nicht", undefined, "schliessen"),
  offen: () => zeichen("offen", "warn", "uhr"),
};

function zelle(anlass, person, i) {
  const stand = anlass.vergangen ? person.anwesenheit[i] : person.zusage[i];
  const inhalt = !anlass.vergangen
    ? ZUSAGE[stand]()
    : stand === null
      ? el("span", { class: "leise" }, "nicht erfasst")
      : ANWESEND[stand]();
  return el(
    "td",
    { class: anlass.vergangen ? undefined : "an-naechster" },
    inhalt,
  );
}

function personZeile(person, anlaesse, leitende) {
  const name = leitende ? person.name : `${person.vorname} ${person.nachname}`;
  return el(
    "tr",
    {},
    el(
      "th",
      { scope: "row" },
      el("span", { class: "name" }, name),
      leitende &&
        el(
          "span",
          { class: "an-zusatz leise" },
          [ROLLEN[person.rolle], person.ceviName].filter(Boolean).join(" · "),
        ),
    ),
    anlaesse.map((a, i) => zelle(a, person, i)),
    el(
      "td",
      { class: "zahl" },
      person.von === 0 ? keine() : `${person.da} von ${person.von}`,
    ),
    el(
      "td",
      { class: "zahl" },
      person.prozent === null ? keine() : `${person.prozent} %`,
    ),
  );
}

// «–» liest ein Screenreader nicht sinnvoll vor
const keine = () => [
  el("span", { "aria-hidden": "true" }, "–"),
  el("span", { class: "nur-leser" }, "nichts erfasst"),
];

function kachel(titel, wert, hinweis) {
  return el(
    "div",
    { class: "kachel" },
    el("p", { class: "kachel-titel" }, titel),
    el("p", { class: "kachel-wert" }, wert),
    el("p", { class: "kachel-hinweis" }, hinweis),
  );
}

const personenText = (n, leitende) =>
  leitende
    ? n === 1
      ? "1 Person"
      : `${n} Personen`
    : n === 1
      ? "1 Kind"
      : `${n} Kinder`;

function zusammenfassung(antwort, reiter) {
  const leitende = reiter === "leitende";
  const zahlen = antwort.zahlen[reiter];
  const liste = antwort[reiter];
  const naechster = antwort.naechster;
  const kacheln = [
    kachel(
      "Anwesenheit",
      zahlen.prozent === null ? "–" : `${zahlen.prozent} % da`,
      zahlen.von === 0
        ? "In den gezeigten Anlässen ist noch nichts erfasst."
        : `${zahlen.da} von ${zahlen.von} erfassten Einträgen`,
    ),
  ];
  if (naechster) {
    const anlass = antwort.anlaesse.find((a) => a.id === naechster.programmId);
    const z = naechster[reiter];
    kacheln.push(
      kachel(
        "Zusagen zum nächsten Anlass",
        `${z.ja} von ${liste.length} kommen`,
        `${z.offen} offen, ${z.nein} abgesagt · ${anlass.titel}, ${tagVon(anlass)}`,
      ),
    );
  } else {
    kacheln.push(
      kachel(
        "Zusagen zum nächsten Anlass",
        "–",
        "Für diese Stufe steht kein kommender Anlass im Kalender.",
      ),
    );
  }
  return [
    el("div", { class: "kacheln an-kacheln" }, kacheln),
    el(
      "p",
      { class: "meta klein", role: "status" },
      `${personenText(liste.length, leitende)} in der Stufe «${antwort.stufe.name}»`,
    ),
  ];
}

function tabelleFuer(antwort, reiter) {
  const leitende = reiter === "leitende";
  const { anlaesse } = antwort;
  const { wurzel } = tabelle({
    beschriftung: `Anwesenheit der ${leitende ? "Leitenden" : "Kinder"} in der Stufe ${antwort.stufe.name}`,
    spalten: [
      leitende ? "Person" : "Kind",
      ...anlaesse.map(tagVon),
      ["Da bei", "zahl"],
      ["Quote", "zahl"],
    ],
    zeilen: [],
  });
  // Der Titel des Anlasses steht unter dem Tag in der Spaltenüberschrift
  wurzel.querySelectorAll("thead th").forEach((th, i) => {
    const anlass = anlaesse[i - 1];
    if (!anlass) return;
    th.append(el("span", { class: "an-titel" }, anlass.titel));
    if (!anlass.vergangen) {
      th.append(el("span", { class: "an-titel" }, "Nächster Anlass"));
      th.classList.add("an-naechster");
    }
  });
  wurzel.classList.add("an-tabelle");
  wurzel
    .querySelector("tbody")
    .append(...antwort[reiter].map((p) => personZeile(p, anlaesse, leitende)));
  return wurzel;
}

function gruppe(beschriftung, inhalt) {
  return el(
    "div",
    { class: "an-gruppe" },
    el("p", { class: "meta klein" }, beschriftung),
    inhalt,
  );
}

function zeichne(bereich, ctx, daten, neu, { reiter, anzahl }) {
  const { stufen, stufeId, antwort } = daten;
  if (!antwort) {
    bereich.append(
      el(
        "p",
        { class: "leer" },
        "Es gibt noch keine Stufen. Lege sie im Bereich «Stufen» an.",
      ),
    );
    return;
  }
  ctx.kopfAktion(
    knopf("Aktualisieren", {
      symbol: "aktualisieren",
      onclick: () => {
        zwischen = null;
        neu();
      },
    }),
  );
  const stufenwahl = filterGruppe({
    beschriftung: "Stufe",
    eintraege: stufen.map((s) => ({ text: s.name, wert: s.id })),
    wert: stufeId,
    beiAenderung: (id) => {
      location.hash = adresse(id, reiter, anzahl);
    },
  });
  const anzahlwahl = filterGruppe({
    beschriftung: "Anzahl der letzten Anlässe",
    eintraege: ANZAHLEN.map((n) => ({ text: String(n), wert: n })),
    wert: anzahl,
    beiAenderung: (n) => {
      location.hash = adresse(stufeId, reiter, n);
    },
  });
  const tabs = el(
    "nav",
    { class: "tabs", "aria-label": "Kinder oder Leitende" },
    REITER.map(([schluessel, name]) =>
      el(
        "a",
        {
          class: "tab",
          href: adresse(stufeId, schluessel, anzahl),
          ...(schluessel === reiter && { "aria-current": "page" }),
        },
        name,
      ),
    ),
  );
  bereich.append(
    el(
      "div",
      { class: "an-wahl" },
      gruppe("Stufe", stufenwahl.wurzel),
      gruppe("Letzte Anlässe", anzahlwahl.wurzel),
    ),
    tabs,
    ...zusammenfassung(antwort, reiter),
  );
  if (antwort.anlaesse.length === 0) {
    bereich.append(
      el(
        "p",
        { class: "leer" },
        "Für diese Stufe gibt es noch keine Programme mit Anwesenheit.",
      ),
    );
  } else if (antwort[reiter].length === 0) {
    bereich.append(
      el(
        "p",
        { class: "leer" },
        reiter === "kinder"
          ? "In dieser Stufe sind keine Kinder eingetragen."
          : "In dieser Stufe ist niemand als Leitung eingetragen.",
      ),
    );
  } else {
    bereich.append(tabelleFuer(antwort, reiter));
  }
}

export function zeige(bereich, ctx) {
  const [stufe, unter = "kinder", n] = ctx.pfad;
  const anzahl = ANZAHLEN.includes(Number(n)) ? Number(n) : ANZAHLEN[0];
  if (!REITER.some(([s]) => s === unter)) {
    bereich.append(
      el(
        "p",
        { class: "leer" },
        "Diese Ansicht gibt es nicht. Wähle «Kinder» oder «Leitende».",
      ),
    );
    return;
  }
  const stufeId = stufe && UUID.test(stufe) ? stufe : undefined;
  ctx.lade(
    () => ladeDaten(stufeId, anzahl),
    (daten, neu) =>
      zeichne(bereich, ctx, daten, neu, { reiter: unter, anzahl }),
  );
}

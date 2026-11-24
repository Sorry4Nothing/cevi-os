import { anfrage, fehlertext } from "./api.js";
import {
  ablesbar,
  fmt,
  saeulen,
  svg,
  wertetabelle,
} from "./uebersicht-diagramme.js";
import {
  auswahl,
  chip,
  el,
  filterGruppe,
  icon,
  vorZeit,
  knopf,
  neueId,
  tabelle,
  zeit,
} from "./dom.js";

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

// «vor 3 Minuten», «gestern», «vor 2 Wochen»; das Datum steht zusätzlich im Titel des Elements
export const vor = vorZeit;

export async function ladeBetrieb() {
  const [system, anfragen] = await Promise.all([
    anfrage("GET", "/api/v1/admin/system"),
    anfrage("GET", "/api/v1/admin/system/requests"),
  ]);
  return { system, anfragen };
}

// Die Seite «System» braucht zusätzlich die Ausgaben der Abrufe; die Übersicht nicht
async function ladeSeite() {
  const [betrieb, abrufe] = await Promise.all([ladeBetrieb(), ladeAbrufe()]);
  return { ...betrieb, abrufe };
}

// Lädt neu, wenn die Person «Aktualisieren» wählt, nie im Takt: kein Polling, damit die Datenbank nicht im Hintergrund belastet wird (#593). Ein Fehler lässt die alten Zahlen stehen; liefert, ob es geklappt hat
export function aufWunsch(bereich, laden, zeichnen, fehlerFeld) {
  let laeuft = false;
  return async function lauf() {
    if (laeuft) return false;
    laeuft = true;
    try {
      zeichnen(await laden());
      fehlerFeld.textContent = "";
      return true;
    } catch (f) {
      if (bereich.isConnected) {
        fehlerFeld.textContent = `Aktualisieren nicht möglich: ${fehlertext(f)}`;
      }
      return false;
    } finally {
      laeuft = false;
    }
  };
}

// Beim Neuzeichnen bleibt der Fokus auf dem Element mit demselben data-fokus, sonst verlöre ihn die Tastatur alle 15 Sekunden
function ersetze(behaelter, ...knoten) {
  const aktiv = behaelter.contains(document.activeElement)
    ? document.activeElement.dataset?.fokus
    : undefined;
  behaelter.replaceChildren(...knoten);
  if (aktiv) {
    [...behaelter.querySelectorAll("[data-fokus]")]
      .find((k) => k.dataset.fokus === aktiv)
      ?.focus({ preventScroll: true });
  }
}

// Text nur bei Änderung setzen: Live-Regionen sagen sonst jede Aktualisierung an
function setzeText(knoten, text) {
  if (knoten.textContent !== text) knoten.textContent = text;
}

// Zustand steht immer auch als Wort im Text, nie nur als Farbe oder Symbol
// zustand: Wort im Chip oben rechts (mit status auch Symbol); ohne zustand zeigt das CSS nur ein Symbol
export function kachel({ titel, wert, hinweis, status, zustand, link, text }) {
  const titelKnoten = el("p", { class: "kachel-titel" }, titel);
  return el(
    "div",
    {
      class: [
        "kachel",
        status && `kachel--${status}`,
        zustand && "kachel--chip",
      ]
        .filter(Boolean)
        .join(" "),
    },
    zustand
      ? el(
          "div",
          { class: "kachel-kopf" },
          titelKnoten,
          el(
            "ul",
            { class: "chips" },
            chip(zustand, status, status ? undefined : "info"),
          ),
        )
      : titelKnoten,
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

export const minutenName = (iso) => UHR.format(new Date(iso));

export function fehlerTabelle(fehler, max = fehler.length) {
  const gezeigt = fehler.slice(0, max);
  if (fehler.length === 0) {
    return el(
      "p",
      { class: "leer leer--klein" },
      icon("haken"),
      " Keine Fehler seit dem Start.",
    );
  }
  const rahmen = tabelle({
    beschriftung: "Letzte Fehler",
    spalten: ["Zeit", "Status", "Methode", "Route"],
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
        el("td", { class: "mono" }, f.methode),
        el("td", { class: "mono" }, f.route),
      ),
    ),
  }).wurzel;
  rahmen.dataset.fokus = "fehler-rahmen";
  return rahmen;
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
const STATUS_FILTER = [
  { text: "Alle", wert: "alle" },
  { text: "Mit 4xx", wert: "4xx" },
  { text: "Mit 5xx", wert: "5xx" },
];
// Wie /health: Nach 30 Minuten ohne Erfolg gilt der Sync als veraltet
const SYNC_VERALTET_MS = 30 * 60 * 1000;
const syncVeraltet = (k) =>
  !k.letzterErfolgAm ||
  Date.now() - new Date(k.letzterErfolgAm).getTime() > SYNC_VERALTET_MS;

export function zeige(bereich, ctx) {
  ctx.lade(ladeSeite, (daten) => zeichneSeite(bereich, daten, ctx));
}

// Reiter innerhalb der Seite (ein Hash je Bereich): Pfeiltasten wechseln und aktivieren, Tab geht in den Inhalt
function reiter(beschriftung, eintraege) {
  const knoepfe = eintraege.map((e) =>
    el(
      "button",
      {
        type: "button",
        class: "tab",
        role: "tab",
        id: `${e.id}-reiter`,
        "aria-controls": e.id,
        onclick: () => waehle(e.id),
      },
      e.text,
    ),
  );
  const tafeln = eintraege.map((e) =>
    el(
      "div",
      {
        class: "system-tafel",
        role: "tabpanel",
        id: e.id,
        "aria-labelledby": `${e.id}-reiter`,
      },
      e.inhalt,
    ),
  );
  function waehle(id, fokus = true) {
    eintraege.forEach((e, i) => {
      const aktiv = e.id === id;
      knoepfe[i].setAttribute("aria-selected", String(aktiv));
      knoepfe[i].tabIndex = aktiv ? 0 : -1;
      tafeln[i].hidden = !aktiv;
      if (aktiv && fokus) knoepfe[i].focus();
    });
  }
  const leiste = el(
    "div",
    { class: "tabs", role: "tablist", "aria-label": beschriftung },
    knoepfe,
  );
  leiste.addEventListener("keydown", (ereignis) => {
    const i = knoepfe.indexOf(document.activeElement);
    const ziel = {
      ArrowRight: (i + 1) % knoepfe.length,
      ArrowLeft: (i - 1 + knoepfe.length) % knoepfe.length,
      Home: 0,
      End: knoepfe.length - 1,
    }[ereignis.key];
    if (i < 0 || ziel === undefined) return;
    ereignis.preventDefault();
    waehle(eintraege[ziel].id);
  });
  waehle(eintraege[0].id, false);
  return { leiste, tafeln, waehle };
}

// Eine Zeile zur Lage; der Zustand steht im Wort, die Farbe und das Symbol (aus dem CSS) verstärken nur
function lage(s, a) {
  const probleme = [];
  if (!s.datenbank.erreichbar) {
    probleme.push(["fehler", "Die Datenbank ist nicht erreichbar."]);
  }
  if (s.kalender.eingerichtet && s.kalender.fehler) {
    probleme.push(["fehler", "Der Kalender-Sync meldet einen Fehler."]);
  } else if (s.kalender.eingerichtet && syncVeraltet(s.kalender)) {
    probleme.push(["warn", "Der Kalender-Sync ist veraltet."]);
  }
  if (a.quote5xx > 0.01) {
    probleme.push([
      "warn",
      `${prozent(a.quote5xx)} der Anfragen enden mit einem Serverfehler (5xx).`,
    ]);
  }
  if (probleme.length === 0) {
    return [
      "ok",
      "Alles läuft: Datenbank erreichbar, keine auffälligen Fehler.",
    ];
  }
  return [
    probleme.some(([art]) => art === "fehler") ? "fehler" : "warn",
    probleme.map(([, text]) => text).join(" "),
  ];
}

function kalenderKachel(k) {
  if (!k.eingerichtet) {
    return kachel({
      titel: "Kalender-Sync",
      wert: "–",
      zustand: "Nicht eingerichtet",
      hinweis: "Keine Kalenderadresse hinterlegt.",
    });
  }
  const wert = k.letzterErfolgAm ? vor(k.letzterErfolgAm) : "noch nie";
  const letzter = k.letzterErfolgAm
    ? `Letzter Erfolg ${zeit(k.letzterErfolgAm)}`
    : "Noch nie erfolgreich";
  if (k.fehler) {
    return kachel({
      titel: "Kalender-Sync",
      wert,
      text: true,
      status: "fehler",
      zustand: "Fehler",
      hinweis: `${k.fehler}. ${letzter}`,
    });
  }
  const veraltet = syncVeraltet(k);
  return kachel({
    titel: "Kalender-Sync",
    wert,
    text: true,
    status: veraltet ? "warn" : "ok",
    zustand: veraltet ? "Veraltet" : "Aktuell",
    hinweis: veraltet
      ? `${letzter}. Veraltet nach 30 Min. ohne Erfolg.`
      : letzter,
  });
}

function systemKacheln(s) {
  const p = s.prozess;
  const d = s.datenbank;
  return [
    kachel({
      titel: "API",
      wert: `Node ${p.node}`,
      text: true,
      status: "ok",
      zustand: "Läuft",
      hinweis: `Gestartet ${zeit(p.gestartetAm)}, Laufzeit ${dauer(p.laufzeitSekunden)}`,
    }),
    kachel({
      titel: "Datenbank",
      wert: d.pingMs === null ? "–" : ms(d.pingMs),
      status: d.erreichbar ? "ok" : "fehler",
      zustand: d.erreichbar ? "Erreichbar" : "Nicht erreichbar",
      hinweis: "Antwortzeit der Abfrage",
    }),
    kalenderKachel(s.kalender),
    kachel({
      titel: "Push-Tokens",
      wert: zahl(s.bestand.pushTokens),
      hinweis: "Registrierte Geräte der Abteilung",
    }),
    kachel({
      titel: "Last der API",
      wert: p.schleifeP99Ms === null ? "–" : ms(Math.round(p.schleifeP99Ms)),
      hinweis: `Verzögerung der Ereignisschleife (p99) · ${ZAHL.format(p.heapGenutztMb)} MB Heap`,
    }),
  ];
}

function systemPanels(s) {
  const p = s.prozess;
  const d = s.datenbank;
  const k = s.kalender;
  const ja = (b) => (b ? "Ja" : "Nein");
  return [
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
          p.schleifeP99Ms === null ? "–" : `${ZAHL.format(p.schleifeP99Ms)} ms`,
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
      ]),
    ),
  ];
}

// Aufklappbarer Teil einer Route: ihre Fehler unter den letzten Fehlern, neueste zuerst
function routenDetail(r, fehler) {
  const eigene = fehler.filter(
    (f) => f.methode === r.methode && f.route === r.route,
  );
  return el(
    "div",
    { class: "route-detail" },
    el(
      "p",
      { class: "klein leise" },
      eigene.length === 0
        ? "Keine Fehler dieser Route unter den letzten Fehlern."
        : "Letzte Fehler dieser Route (Zeit, Status):",
    ),
    eigene.length > 0 &&
      el(
        "pre",
        { class: "stack mono" },
        eigene
          .map((f) => `${UHR_SEKUNDEN.format(new Date(f.zeit))}  ${f.status}`)
          .join("\n"),
      ),
    el(
      "p",
      { class: "hilfe" },
      "p50 und p95 sind die Obergrenze der Dauerklasse, in der das Quantil liegt.",
    ),
  );
}

export const ladeAbrufe = () => anfrage("GET", "/api/v1/admin/system/syncs");

// Der Stand des Kalender-Abgleichs im Hintergrund (#267); «Jetzt abgleichen» startet denselben Lauf von Hand
function zeichneAbrufe(ziel, d, starten, laeuft) {
  const k = d.kalender;
  ersetze(
    ziel,
    panel(
      "Kalender",
      werte([
        ["Eingerichtet", k.eingerichtet ? "Ja" : "Nein"],
        [
          "Letzter Erfolg",
          k.letzterErfolgAm
            ? `${zeit(k.letzterErfolgAm)} (${vor(k.letzterErfolgAm)})`
            : "noch nie",
        ],
        ["Fehler", k.fehler ?? "keiner"],
        ["Programme", zahl(k.programme)],
      ]),
      k.eingerichtet &&
        knopf("Jetzt abgleichen", {
          symbol: "aktualisieren",
          disabled: laeuft.kalender,
          "data-fokus": "abruf-kalender",
          onclick: () => starten("kalender"),
        }),
    ),
  );
}

// ===== Anfragen, Fehler und Last (Runde 2, #606) =====
// Aufbau nach Kokonut UI Pro als Vorlage: Kennzahlen mit Veränderung über dem Verlauf (chart-hero, dither-area-chart: Zeitraum-Umschalter, Achsen, Spitze), ein Streifen je Zeitraum mit Zustand und Ablesung (status-footer, event-timeline: eine Spur je Art). Gezeichnet ist alles selbst, mit den Säulen und der Ablesung der Übersicht (uebersicht-diagramme.js).
// Die API behält die Anfragen nur 24 Stunden im Arbeitsspeicher. Einen Vergleich mit dem Vortag gibt es deshalb nicht; verglichen wird mit der Stunde davor und mit dem Schnitt der Stunden davor.

const ZEITRAEUME = [
  { text: "Letzte Stunde", wert: "minuten" },
  { text: "Letzte 24 Stunden", wert: "stunden" },
];
// Wie in lage(): ab 1 % Serverfehler gilt der Anteil als erhöht
const SCHWELLE_5XX = 0.01;
const MINUTE_MS = 60_000;

const summe = (liste) =>
  liste.reduce(
    (s, p) => ({
      anzahl: s.anzahl + p.anzahl,
      fehler4xx: s.fehler4xx + p.fehler4xx,
      fehler5xx: s.fehler5xx + p.fehler5xx,
    }),
    { anzahl: 0, fehler4xx: 0, fehler5xx: 0 },
  );
const anteil = (teil, ganz) => (ganz === 0 ? 0 : teil / ganz);

// Zustand eines Zeitraums für den Streifen: «leer», «ruhig», «vereinzelt» (5xx bis 1 %), «erhoeht» (über 1 %)
export function zustandVon(p) {
  if (p.anzahl === 0) return "leer";
  if (p.fehler5xx === 0) return "ruhig";
  return p.fehler5xx / p.anzahl > SCHWELLE_5XX ? "erhoeht" : "vereinzelt";
}

// Alle Kennzahlen eines Zeitraums. «jetzt» ist die letzte Stunde, «basis» der Vergleich dazu: bei «minuten» die Stunde davor, bei «stunden» der Schnitt der Stunden davor (nur Stunden, in denen die API schon lief; sonst null)
export function auswerten(a, zeitraum, jetztMs = Date.now()) {
  const kurz = zeitraum === "minuten";
  const punkte = kurz ? a.minuten : a.stunden;
  const gesamt = summe(punkte);
  const spitze =
    gesamt.anzahl === 0
      ? null
      : punkte.reduce((m, p) => (p.anzahl > m.anzahl ? p : m), punkte[0]);
  const laeuft = (p) => Date.parse(a.seit) - MINUTE_MS <= Date.parse(p.ab);
  const letzte = summe([a.stunden.at(-1)]);
  const davor = a.stunden.slice(0, -1).filter(laeuft);
  const vergleichsstunden = kurz ? davor.slice(-1) : davor;
  const basis =
    vergleichsstunden.length === 0 ? null : summe(vergleichsstunden);
  return {
    kurz,
    punkte,
    gesamt,
    spitze,
    letzte,
    basis,
    stundenImVergleich: vergleichsstunden.length,
    jetztMs,
  };
}

// «+8 %», «−3 %», «±0 %»; bei einer Basis von 0 gibt es keinen Prozentwert
export function veraenderung(jetzt, basis) {
  if (basis === 0) return jetzt === 0 ? "±0" : "neu";
  const p = Math.round(((jetzt - basis) / basis) * 100);
  return `${p > 0 ? "+" : p < 0 ? "−" : "±"}${Math.abs(p)} %`;
}

// Unterschied zweier Anteile in Prozentpunkten: «+0.3 Prozentpunkte»
export function punkteVon(jetzt, basis) {
  const d = Math.round((jetzt - basis) * 1000) / 10;
  return `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)} Prozentpunkte`;
}

const TAGZEIT = new Intl.DateTimeFormat("de-CH", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

// Eine Kennzahl: Titel, grosse Zahl, Veränderung. Der Zustand «erhöht» steht im Wort
function kennzahl({ titel, zahlText, einheit, vergleich, zustand, hinweis }) {
  return el(
    "div",
    { class: "ub-kachel" },
    el(
      "div",
      { class: "ub-kachel-kopf" },
      el("p", { class: "ub-kachel-titel" }, titel),
      zustand && el("ul", { class: "chips" }, chip(zustand, "fehler")),
    ),
    el(
      "p",
      { class: "ub-wert" },
      el("span", { class: "ub-wert-zahl" }, zahlText),
      einheit && el("span", { class: "ub-wert-einheit" }, einheit),
    ),
    vergleich && el("p", { class: "ub-delta" }, vergleich),
    hinweis && el("p", { class: "ub-delta" }, hinweis),
  );
}

function kennzahlen(w) {
  const { gesamt, spitze, letzte, basis, kurz, stundenImVergleich } = w;
  const einheit = kurz ? "Minute" : "Stunde";
  const praefix = kurz ? "" : "Letzte Stunde: ";
  const schnitt = basis ? basis.anzahl / stundenImVergleich : 0;
  let anzahlText = "Noch kein Vergleich: Die API läuft erst kurz.";
  if (basis) {
    anzahlText = kurz
      ? `Stunde davor: ${fmt(basis.anzahl)} (${veraenderung(letzte.anzahl, basis.anzahl)})`
      : `Letzte Stunde: ${veraenderung(letzte.anzahl, schnitt)} gegenüber dem Stundenschnitt davor (Ø ${fmt(Math.round(schnitt))})`;
  }
  // Anteil der letzten Stunde, verglichen mit der Stunde davor bzw. dem Schnitt davor; ohne Anfragen gibt es keinen Anteil
  const anteilText = (feld) =>
    basis && basis.anzahl > 0 && letzte.anzahl > 0
      ? `${praefix}${prozent(anteil(letzte[feld], letzte.anzahl))}, ${punkteVon(anteil(letzte[feld], letzte.anzahl), anteil(basis[feld], basis.anzahl))} gegenüber ${kurz ? "der Stunde davor" : "dem Schnitt davor"}`
      : null;
  const anteil5 = anteil(gesamt.fehler5xx, gesamt.anzahl);
  return [
    kennzahl({
      titel: kurz ? "Anfragen in der letzten Stunde" : "Anfragen in 24 Stunden",
      zahlText: fmt(gesamt.anzahl),
      vergleich: anzahlText,
    }),
    kennzahl({
      titel: "Serverfehler (5xx)",
      zahlText: prozent(anteil5),
      zustand: anteil5 > SCHWELLE_5XX ? "Erhöht" : null,
      hinweis: `${fmt(gesamt.fehler5xx)} Fehler der API selbst`,
      vergleich: anteilText("fehler5xx"),
    }),
    kennzahl({
      titel: "Abgewiesen (4xx)",
      zahlText: prozent(anteil(gesamt.fehler4xx, gesamt.anzahl)),
      hinweis: `${fmt(gesamt.fehler4xx)}, zum Beispiel nicht angemeldet oder nicht gefunden`,
      vergleich: anteilText("fehler4xx"),
    }),
    kennzahl({
      titel: "Spitze",
      zahlText: spitze ? fmt(spitze.anzahl) : "–",
      einheit: spitze ? `Anfragen pro ${einheit}` : undefined,
      hinweis: spitze
        ? kurz
          ? `um ${minutenName(spitze.ab)} Uhr`
          : `${TAGZEIT.format(new Date(spitze.ab))} Uhr, eine Stunde lang`
        : "Noch keine Anfragen gezählt.",
    }),
  ];
}

// Ein Streifen mit einer Zelle je Zeitraum. Die Höhe trägt den Zustand mit (leer 2, ruhig 5, vereinzelt 10, erhöht 16), Farbe und Wort kommen dazu
const ZUSTAND_TEXT = {
  leer: "keine Anfragen",
  ruhig: "keine Serverfehler",
  vereinzelt: "vereinzelte Serverfehler",
  erhoeht: "Serverfehler erhöht",
};
const ZUSTAND_HOEHE = { leer: 2, ruhig: 5, vereinzelt: 10, erhoeht: 16 };

function streifen({ punkte, name, titel }) {
  const n = punkte.length;
  const B = 480;
  const H = 16;
  const schritt = B / n;
  const breite = Math.max(2, schritt - (n > 30 ? 1.5 : 4));
  const zustaende = punkte.map(zustandVon);
  const marken = punkte.map((p, i) => {
    const z = zustaende[i];
    const h = ZUSTAND_HOEHE[z];
    return svg(
      "g",
      { class: "ub-marke" },
      svg("rect", {
        class: "ub-traeger",
        x: i * schritt,
        y: 0,
        width: schritt,
        height: H,
      }),
      svg("rect", {
        class: `sv-zelle sv-zelle--${z}`,
        x: i * schritt + (schritt - breite) / 2,
        y: H - h,
        width: breite,
        height: h,
        rx: 1,
      }),
    );
  });
  const text = (p, i) => {
    const z = zustaende[i];
    return z === "leer" || z === "ruhig"
      ? `${name(p)}: ${ZUSTAND_TEXT[z]}`
      : `${name(p)}: ${ZUSTAND_TEXT[z]}, ${fmt(p.fehler5xx)} von ${fmt(p.anzahl)} Anfragen (${prozent(p.fehler5xx / p.anzahl)})`;
  };
  const grafik = svg(
    "svg",
    {
      viewBox: `0 0 ${B} ${H}`,
      preserveAspectRatio: "none",
      "aria-hidden": "true",
      focusable: "false",
    },
    ...marken,
    svg("line", { class: "ub-achse", x1: 0, x2: B, y1: H - 0.5, y2: H - 0.5 }),
  );
  const zaehler = { erhoeht: 0, vereinzelt: 0 };
  zustaende.forEach((z) => z in zaehler && zaehler[z]++);
  return ablesbar({
    grafik,
    marken,
    texte: punkte.map(text),
    beschriftung: `${titel}: ${zaehler.erhoeht} erhöht, ${zaehler.vereinzelt} mit vereinzelten Serverfehlern von ${n} Zeiträumen. Genaue Werte in der Tabelle.`,
  });
}

// Achsen um die Säulen: links 0, Mitte, Höchstwert; unten die Zeit. Die Säulen füllen die Höhe 64 des Rasters (oben 4, Boden 63); die Linien sitzen darum bei 6.25 %, 52.3 % und 98.4 % (siehe system.css)
function mitAchsen({ ablesen, punkte, max, achsenName, schritt }) {
  const n = punkte.length;
  const rahmen = ablesen.querySelector(".ub-grafik");
  rahmen.querySelector("svg").setAttribute("preserveAspectRatio", "none");
  rahmen.classList.add("sv-flaeche");
  const hoch = el("span", { class: "sv-y sv-y--oben" }, fmt(max));
  const mitte =
    max >= 2 &&
    el("span", { class: "sv-y sv-y--mitte" }, fmt(Math.round(max / 2)));
  const null_ = el("span", { class: "sv-y sv-y--unten" }, "0");
  rahmen.prepend(
    ...[0, 1, 2].map((i) => el("span", { class: `sv-gitter sv-gitter--${i}` })),
  );
  rahmen.append(hoch, mitte, null_);
  // Spalten und Lage der Marken stehen im CSS (sv-x--24, sv-x--60); die CSP erlaubt keine Stilangaben im Skript
  const x = el("div", { class: `sv-x sv-x--${n}`, "aria-hidden": "true" });
  for (let i = 0; i < n; i += schritt) {
    x.append(el("span", { class: "sv-x-marke" }, achsenName(punkte[i])));
  }
  const jetzt = el("span", { class: "sv-x-marke sv-x-marke--jetzt" }, "jetzt");
  x.append(jetzt);
  ablesen.insertBefore(x, ablesen.querySelector(".ub-lese"));
  return ablesen;
}

// Der ganze Bereich: Kopf mit Zeitraum-Umschalter, Kennzahlen, Verlauf, Streifen, Tabelle
function verlaufBereich(a, zeitraum, wechsle, offen) {
  const w = auswerten(a, zeitraum);
  const { kurz, punkte, gesamt } = w;
  const id = neueId("verlauf");
  const name = kurz
    ? (p) => `${minutenName(p.ab)} Uhr`
    : (p) =>
        `${TAGZEIT.format(new Date(p.ab))} bis ${UHR.format(new Date(Date.parse(p.ab) + 59 * MINUTE_MS))} Uhr`;
  const einheit = kurz ? "Minute" : "Stunde";
  const titelDiagramm = kurz
    ? "Anfragen je Minute, letzte Stunde"
    : "Anfragen je Stunde, letzte 24 Stunden";
  const max = Math.max(1, ...punkte.map((p) => p.anzahl));
  const schritt = kurz ? 20 : 8;
  const umschalter = filterGruppe({
    beschriftung: "Zeitraum",
    eintraege: ZEITRAEUME,
    wert: zeitraum,
    beiAenderung: wechsle,
  });
  const leer = gesamt.anzahl === 0;
  const verlauf = leer
    ? el(
        "p",
        { class: "leer leer--klein" },
        "Seit dem Start sind keine Anfragen gezählt worden.",
      )
    : [
        el("h3", { class: "sv-titel" }, `Anfragen je ${einheit}`),
        mitAchsen({
          ablesen: saeulen({
            titel: titelDiagramm,
            einheit: "Anfragen",
            fehlerName: "mit Fehler",
            weit: true,
            hoehe: 64,
            punkte: punkte.map((p) => ({
              name: name(p),
              wert: p.anzahl,
              fehler: p.fehler4xx + p.fehler5xx,
            })),
          }),
          punkte,
          max,
          achsenName: kurz
            ? (p) => minutenName(p.ab)
            : (p) => TAGZEIT.format(new Date(p.ab)),
          schritt,
        }),
        el(
          "p",
          { class: "ub-legende klein leise" },
          el("span", { class: "ub-schluessel", "aria-hidden": "true" }),
          "Anfragen ",
          el("span", {
            class: "ub-schluessel ub-schluessel--fehler",
            "aria-hidden": "true",
          }),
          "davon mit Fehler (4xx und 5xx)",
        ),
        el(
          "h3",
          { class: "sv-titel sv-titel--streifen" },
          `Serverfehler (5xx) je ${einheit}`,
        ),
        el(
          "div",
          { class: "sv-streifen" },
          streifen({
            punkte,
            name,
            titel: `Serverfehler je ${einheit}`,
          }),
        ),
        el(
          "ul",
          { class: "sv-zeichen klein leise" },
          ["leer", "ruhig", "vereinzelt", "erhoeht"].map((z) =>
            el(
              "li",
              {},
              el("span", {
                class: `sv-schluessel sv-schluessel--${z}`,
                "aria-hidden": "true",
              }),
              z === "vereinzelt"
                ? "vereinzelt (bis 1 %)"
                : z === "erhoeht"
                  ? "erhöht (über 1 %)"
                  : ZUSTAND_TEXT[z],
            ),
          ),
        ),
        el("p", { class: "hilfe" }, hinweisSeitStart(a)),
        el(
          "details",
          { class: "diagramm-tabelle", open: offen.wert },
          el("summary", {}, "Als Tabelle anzeigen"),
          wertetabelle({
            beschriftung: `${titelDiagramm}, neueste zuerst`,
            spalten: ["Zeitraum", "Anfragen", "4xx", "5xx", "Anteil 5xx"],
            zeilen: [...punkte]
              .reverse()
              .map((p) => [
                name(p),
                fmt(p.anzahl),
                fmt(p.fehler4xx),
                fmt(p.fehler5xx),
                p.anzahl === 0 ? "–" : prozent(p.fehler5xx / p.anzahl),
              ]),
          }),
        ),
      ];
  const bereich = el(
    "section",
    { class: "sv-bereich", "aria-labelledby": id },
    el(
      "div",
      { class: "zeile" },
      el("h2", { id }, "Anfragen, Fehler und Last"),
      umschalter.wurzel,
    ),
    el("div", { class: "ub-raster sv-kennzahlen" }, kennzahlen(w)),
    el("div", { class: "panel sv-verlauf" }, verlauf),
  );
  bereich.querySelector("details")?.addEventListener("toggle", (e) => {
    offen.wert = e.target.open;
  });
  return bereich;
}

// Die letzten Fehler als Liste: Status, Route, wie lange es her ist (Vorlage: activity-feed, feste Zeilenhöhe, Zeit als «vor 7 Minuten»). Die Tabelle mit allen steht unter «Anfragen».
function fehlerListe(fehler, max = 8) {
  if (fehler.length === 0) {
    return el(
      "p",
      { class: "leer leer--klein" },
      icon("haken"),
      " Keine Fehler seit dem Start.",
    );
  }
  return el(
    "ul",
    { class: "sv-fehler" },
    fehler.slice(0, max).map((f) =>
      el(
        "li",
        {},
        el(
          "ul",
          { class: "chips" },
          chip(String(f.status), f.status >= 500 ? "fehler" : "warn"),
        ),
        el(
          "span",
          { class: "sv-fehler-route" },
          el("span", { class: "sv-fehler-methode" }, f.methode),
          el("span", { class: "mono" }, f.route),
        ),
        el(
          "time",
          {
            class: "sv-fehler-zeit",
            datetime: f.zeit,
            "data-tipp": zeit(f.zeit),
          },
          vor(f.zeit),
        ),
      ),
    ),
  );
}

function zeichneSeite(bereich, daten, ctx) {
  let anfragen;
  let sortierung = "anzahl";
  let statusFilter = "alle";
  let zeitraum = "stunden";
  let suche = "";
  const offeneRouten = new Set();
  const offen = { wert: false };
  const basis = neueId("system");
  // Nur ein Fehler wird angesagt; die regelmässige Aktualisierung bleibt still
  const fehlerFeld = el("p", { class: "meta fehlerzeile", role: "status" });
  const stand = el("p", { class: "meta stand" });
  const lageFeld = el("div", { class: "hinweis", role: "status" });
  const kacheln = el("div", { class: "kacheln" });
  const verlaufFeld = el("div", {});
  const kurzFehler = el("div", {});
  const panels = el("div", { class: "raster raster--2" });
  const hinweisStart = el("p", { class: "hinweis" });
  const anfragenKachelnFeld = el("div", { class: "kacheln" });
  const routen = el("div", {});
  const routenZahl = el("p", { class: "klein leise", role: "status" });
  const fehler = el("div", {});
  const abrufe = el("div", { class: "raster" });
  const abrufeFehler = el("p", { class: "meta fehlerzeile", role: "status" });
  const abrufLaeuft = { kalender: false };
  let abrufDaten;

  const sortieren = auswahl({
    label: "Sortieren",
    optionen: SORTIERUNG,
    wert: sortierung,
  });
  const statusWahl = filterGruppe({
    beschriftung: "Status",
    eintraege: STATUS_FILTER,
    wert: statusFilter,
    beiAenderung: (wert) => {
      statusFilter = wert;
      zeichneRouten();
    },
  });
  const sucheId = neueId("suche");
  const sucheFeld = el("input", {
    id: sucheId,
    class: "eingabe",
    type: "search",
    placeholder: "Route oder Methode",
    autocomplete: "off",
  });

  function zeichneVerlauf() {
    ersetze(
      verlaufFeld,
      verlaufBereich(
        anfragen,
        zeitraum,
        (neu) => {
          zeitraum = neu;
          zeichneVerlauf();
          // Der Umschalter wird neu gezeichnet: der Fokus bleibt auf dem gewählten Knopf
          verlaufFeld
            .querySelector(`.filter button[aria-pressed="true"]`)
            ?.focus();
        },
        offen,
      ),
    );
  }

  function zeichneRouten() {
    const suchtext = suche.trim().toLowerCase();
    const zeilen = anfragen.routen
      .filter(
        (r) =>
          (statusFilter === "alle" ||
            (statusFilter === "4xx" ? r.fehler4xx : r.fehler5xx) > 0) &&
          `${r.methode} ${r.route}`.toLowerCase().includes(suchtext),
      )
      .sort((a, b) => wertFuer[sortierung](b) - wertFuer[sortierung](a));
    setzeText(
      routenZahl,
      zeilen.length === anfragen.routen.length
        ? `${zahl(zeilen.length)} Routen`
        : `${zahl(zeilen.length)} von ${zahl(anfragen.routen.length)} Routen`,
    );
    if (zeilen.length === 0) {
      ersetze(
        routen,
        el(
          "p",
          { class: "leer leer--klein" },
          anfragen.routen.length === 0
            ? "Noch keine Anfragen seit dem Start."
            : "Keine Route passt zu Suche und Filter.",
        ),
      );
      return;
    }
    const tabelleRouten = tabelle({
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
        [el("span", { class: "nur-leser" }, "Details"), "rechts"],
      ],
      zeilen: zeilen.flatMap((r, i) => {
        const schluessel = `${r.methode} ${r.route}`;
        const aufgeklappt = offeneRouten.has(schluessel);
        const detailId = `${basis}-detail-${i}`;
        const zeile = el(
          "tr",
          {},
          el(
            "th",
            { scope: "row" },
            r.methode ? el("ul", { class: "chips" }, chip(r.methode)) : "–",
          ),
          el("td", { class: "mono" }, r.route),
          el("td", { class: "zahl" }, zahl(r.anzahl)),
          el("td", { class: "zahl" }, zahl(r.fehler4xx)),
          el("td", { class: "zahl" }, zahl(r.fehler5xx)),
          el("td", { class: "zahl" }, prozent(fehlerzahl(r) / r.anzahl)),
          el("td", { class: "zahl" }, ms(r.p50Ms)),
          el("td", { class: "zahl" }, ms(r.p95Ms)),
          el(
            "td",
            { class: "rechts" },
            el(
              "button",
              {
                type: "button",
                class: "knopf knopf--rund",
                "data-fokus": schluessel,
                "aria-label": `Details: ${schluessel}`,
                "aria-expanded": String(aufgeklappt),
                "aria-controls": aufgeklappt ? detailId : undefined,
                onclick: () => {
                  if (aufgeklappt) offeneRouten.delete(schluessel);
                  else offeneRouten.add(schluessel);
                  zeichneRouten();
                },
              },
              icon(aufgeklappt ? "schliessen" : "plus"),
            ),
          ),
        );
        return aufgeklappt
          ? [
              zeile,
              el(
                "tr",
                { class: "offen", id: detailId },
                el(
                  "td",
                  { colspan: "9" },
                  routenDetail(r, anfragen.letzteFehler),
                ),
              ),
            ]
          : [zeile];
      }),
    });
    tabelleRouten.wurzel.dataset.fokus = "routen-rahmen";
    ersetze(routen, tabelleRouten.wurzel);
  }

  const zeichne = ({ system: s, anfragen: a }) => {
    anfragen = a;
    setzeText(
      stand,
      `Stand ${UHR_SEKUNDEN.format(new Date())}. Neue Zahlen holst du mit «Aktualisieren».`,
    );
    const [art, text] = lage(s, a);
    lageFeld.className = `hinweis hinweis--${art}`;
    setzeText(lageFeld, text);
    ersetze(kacheln, ...systemKacheln(s));
    ersetze(kurzFehler, fehlerListe(a.letzteFehler));
    ersetze(panels, ...systemPanels(s));
    setzeText(hinweisStart, hinweisSeitStart(a));
    ersetze(anfragenKachelnFeld, ...anfragenKacheln(a));
    zeichneVerlauf();
    zeichneRouten();
    ersetze(fehler, fehlerTabelle(a.letzteFehler, 15));
  };

  sortieren.eingabe.addEventListener("change", () => {
    sortierung = sortieren.eingabe.value;
    zeichneRouten();
  });
  sucheFeld.addEventListener("input", () => {
    suche = sucheFeld.value;
    zeichneRouten();
  });
  zeichne(daten);

  const ansicht = reiter("System", [
    {
      id: `${basis}-uebersicht`,
      text: "Übersicht",
      inhalt: [
        lageFeld,
        kacheln,
        verlaufFeld,
        el(
          "section",
          { class: "spalte", "aria-labelledby": `${basis}-fehler-kurz` },
          el(
            "div",
            { class: "zeile" },
            el("h2", { id: `${basis}-fehler-kurz` }, "Letzte Fehler"),
            knopf("Alle Anfragen", {
              art: "still",
              klein: true,
              onclick: () => ansicht.waehle(`${basis}-anfragen`),
            }),
          ),
          kurzFehler,
        ),
        panels,
      ],
    },
    {
      id: `${basis}-anfragen`,
      text: "Anfragen",
      inhalt: [
        hinweisStart,
        anfragenKachelnFeld,
        el(
          "section",
          { class: "spalte", "aria-labelledby": `${basis}-routen` },
          el("h2", { id: `${basis}-routen` }, "Anfragen je Route"),
          el(
            "div",
            { class: "werkzeuge" },
            el(
              "div",
              { class: "suche" },
              el(
                "label",
                { class: "nur-leser", for: sucheId },
                "Routen suchen",
              ),
              icon("lupe"),
              sucheFeld,
            ),
            statusWahl.wurzel,
            sortieren.wurzel,
          ),
          routenZahl,
          routen,
        ),
        el(
          "section",
          { class: "spalte", "aria-labelledby": `${basis}-fehler` },
          el("h2", { id: `${basis}-fehler` }, "Letzte Fehler"),
          fehler,
        ),
      ],
    },
    {
      id: `${basis}-abrufe`,
      text: "Abrufe",
      inhalt: [abrufeFehler, abrufe],
    },
  ]);

  const zeichneAbrufeNeu = (d) => {
    abrufDaten = d;
    zeichneAbrufe(abrufe, d, starteAbruf, abrufLaeuft);
  };
  async function starteAbruf(job) {
    abrufLaeuft[job] = true;
    zeichneAbrufe(abrufe, abrufDaten, starteAbruf, abrufLaeuft);
    try {
      const { ergebnis } = await anfrage(
        "POST",
        `/api/v1/admin/system/syncs/${job}`,
      );
      ctx.melde(
        ergebnis === "fertig"
          ? "Abruf abgeschlossen."
          : "Es läuft schon ein Abruf.",
      );
      abrufeFehler.textContent = "";
    } catch (f) {
      abrufeFehler.textContent = `Abruf nicht möglich: ${fehlertext(f)}`;
    } finally {
      abrufLaeuft[job] = false;
    }
    try {
      zeichneAbrufeNeu(await ladeAbrufe());
    } catch {
      zeichneAbrufe(abrufe, abrufDaten, starteAbruf, abrufLaeuft);
    }
  }
  zeichneAbrufeNeu(daten.abrufe);

  const nachladen = aufWunsch(
    bereich,
    ladeSeite,
    (neu) => {
      zeichne(neu);
      zeichneAbrufeNeu(neu.abrufe);
    },
    fehlerFeld,
  );
  ctx.kopfAktion(
    knopf("Aktualisieren", {
      symbol: "aktualisieren",
      onclick: async () => {
        if (await nachladen()) ctx.melde("Zahlen aktualisiert.");
      },
    }),
  );
  bereich.append(
    el("div", { class: "stand-zeile" }, stand, fehlerFeld),
    ansicht.leiste,
    ...ansicht.tafeln,
  );
}

// Kacheln zu den Anfragen, auf «System» und «Übersicht» gleich
export function anfragenKacheln(a) {
  const hoch = a.quote5xx > 0.01;
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
      status: hoch ? "fehler" : "ok",
      zustand: hoch ? "Erhöht" : "In Ordnung",
      hinweis: `4xx: ${prozent(a.quote4xx)}`,
    }),
    kachel({
      titel: "Dauer p50 / p95",
      wert: `${ms(a.p50Ms)} / ${ms(a.p95Ms)}`,
      hinweis: "Obergrenze der Dauerklasse",
    }),
  ];
}

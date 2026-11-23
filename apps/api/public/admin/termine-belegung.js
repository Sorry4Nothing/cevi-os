import { anfrage, kennungGueltig } from "./api.js";
import { ankreuzen, auswahl, el, filterGruppe, icon, knopf } from "./dom.js";
import { ersetze, heuteZuerich } from "./kalenderhilfen.js";
import {
  achseFuer,
  freieFenster,
  freiText,
  gruppiere,
  kalenderwoche,
  lageAufAchse,
  montagVon,
  naechsterBlock,
  ordneSpuren,
  plusTage,
  uhrzeit,
  wechselRichtung,
  wochenTage,
  zuerichTeile,
} from "./belegung-layout.js";
import { sk } from "./lader.js";
import { gueltigerTag } from "./termine-monat.js";
import { ersetzeAdresse, schiebeAdresse } from "./verlauf.js";
import {
  leerKarte,
  nochmals,
  zustandsDaten,
  zustandsKarte,
} from "./zustaende.js";

// Unterseite «Belegung» (#628, Bereich «Räume»): Alle Leitenden sehen, wie die Räume der Abteilung belegt sind. Nur lesen; angefragt wird in der App, über Anfragen entscheidet das Team des Raums.
// Ansichten: Woche (eine Zeile je Raum, sieben Tage mit Zeitachse), Tag (eine Spalte je Raum, Zeitachse senkrecht) und Liste (je Raum die Buchungen des Tages; auf schmalen Bildschirmen die einzige Ansicht).
// Adressen: #raeume/belegung (diese Woche) · …/woche/2026-11-23 · …/tag/2026-11-24 · …/liste/2026-11-24; ein dritter Teil ist die ID eines Raums.
// Datenbanklast: eine Abfrage je Woche (GET /api/v1/raeume/belegung, zwei SQL-Abfragen auf dem Server). Wechsel zwischen Woche, Tag und Liste, Raumfilter und «Angefragte zeigen» laufen im Browser auf den geladenen Daten; schon geladene Wochen bleiben im Speicher der Seite. Kein Polling.

const BASIS = "/api/v1/raeume/belegung";
const ANSICHTEN = ["woche", "tag", "liste"];
const KOMPAKT = "(max-width: 760px)";
const STATUS = {
  bestaetigt: { text: "Bestätigt", symbol: "haken" },
  angefragt: { text: "Angefragt", symbol: "uhr" },
};

const fmt = (optionen) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: "UTC", ...optionen });
const langerTag = fmt({
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const wochentagKurz = fmt({ weekday: "short" });
const monatsName = fmt({ month: "long" });
const tagKurz = fmt({ day: "2-digit", month: "2-digit" });
const mittag = (tag) => new Date(`${tag}T12:00:00Z`);
const kurz = (tag) =>
  `${wochentagKurz.format(mittag(tag)).replace(/\.$/, "")} ${tagKurz.format(mittag(tag))}`;
const zaehlwort = (n, ein, mehr) => `${n} ${n === 1 ? ein : mehr}`;

// «Mo 23.11., 08:00»; bei einer Buchung über mehrere Tage von – bis
function zeitText(b) {
  const a = zuerichTeile(b.beginn);
  const e = zuerichTeile(b.ende);
  if (a.tag === e.tag) {
    return `${kurz(a.tag)}, ${uhrzeit(a.minuten)}–${uhrzeit(e.minuten)}`;
  }
  return `${kurz(a.tag)}, ${uhrzeit(a.minuten)} – ${kurz(e.tag)}, ${uhrzeit(e.minuten)}`;
}

// Der Titel der Woche oder des Tages
function periodenTitel(art, datum) {
  if (art !== "woche") return langerTag.format(mittag(datum));
  const montag = montagVon(datum);
  const sonntag = plusTage(montag, 6);
  const [a, e] = [mittag(montag), mittag(sonntag)];
  const jahr = e.getUTCFullYear();
  const bereich =
    a.getUTCMonth() === e.getUTCMonth()
      ? `${a.getUTCDate()}.–${e.getUTCDate()}. ${monatsName.format(e)} ${jahr}`
      : `${a.getUTCDate()}. ${monatsName.format(a)} – ${e.getUTCDate()}. ${monatsName.format(e)} ${jahr}`;
  return `Woche ${kalenderwoche(montag).woche} · ${bereich}`;
}

export function ansichtAusPfad(pfad, heute) {
  const art = ANSICHTEN.includes(pfad[0]) ? pfad[0] : null;
  const datum = gueltigerTag(pfad[1] ?? "") ? pfad[1] : heute;
  const raumId = kennungGueltig(pfad[2] ?? "") ? pfad[2] : "";
  return { art, datum, raumId };
}

export const adresseVon = ({ art, datum, raumId }) =>
  `#raeume/belegung/${art}/${datum}${raumId ? `/${raumId}` : ""}`;

export function zeige(bereich, ctx) {
  const heute = heuteZuerich();
  const start = ansichtAusPfad(ctx.pfad, heute);
  const medien = window.matchMedia(KOMPAKT);
  const zustand = {
    art: start.art ?? "woche",
    datum: start.datum,
    raumId: start.raumId,
    anfragen: true,
    kompakt: medien.matches,
    // Welche Ansicht gilt: schmal immer die Liste
    wirksam() {
      return this.kompakt ? "liste" : this.art;
    },
  };
  if (ctx.zugang.termine.raumAnfragen) {
    ctx.kopfAktion(
      el(
        "a",
        { class: "knopf", href: "#raeume/anfragen" },
        icon("kalender"),
        "Anfragen ansehen",
      ),
    );
  }
  const wochen = new Map();
  const holeWoche = (montag) => {
    if (!wochen.has(montag)) {
      const p = anfrage(
        "GET",
        `${BASIS}?von=${montag}&bis=${plusTage(montag, 6)}`,
      );
      p.catch(() => wochen.delete(montag));
      wochen.set(montag, p);
    }
    return wochen.get(montag);
  };
  ctx.lade(
    () => holeWoche(montagVon(zustand.datum)),
    (erste) => baue(bereich, ctx, { zustand, heute, medien, holeWoche, erste }),
    {
      skeleton: skelettSeite,
      fehlerTitel: "Die Belegung konnte nicht geladen werden.",
      fehlerText: "Prüfe die Verbindung und versuche es nochmals.",
    },
  );
}

/* ---------- Aufbau der Seite ---------- */

function baue(bereich, ctx, { zustand, heute, medien, holeWoche, erste }) {
  const raeume = erste.raeume;
  if (raeume.length === 0) {
    bereich.append(
      leerKarte(
        "Es gibt noch keine Räume. Die Abteilungsleitung legt sie unter «Räume» an.",
        ctx.zugang.termine.raumListe
          ? [
              el(
                "a",
                { class: "knopf knopf--haupt", href: "#raeume/raeume" },
                icon("plus"),
                "Räume verwalten",
              ),
            ]
          : [],
      ),
    );
    return;
  }
  if (zustand.raumId && !raeume.some((r) => r.id === zustand.raumId)) {
    zustand.raumId = "";
  }

  const titel = el("h2", {
    class: "bl-titel",
    "aria-live": "polite",
    tabindex: "-1",
  });
  const zaehler = el("p", { class: "bl-zaehler klein leise" });
  const flaeche = el("div", { class: "bl-flaeche" });
  const detail = erstelleDetail();
  const huelle = el("div", { class: "bl-huelle" }, flaeche);

  const adresse = () =>
    adresseVon({
      art: zustand.art,
      datum: zustand.datum,
      raumId: zustand.raumId,
    });
  const merke = (neuerEintrag) =>
    neuerEintrag ? schiebeAdresse(adresse()) : ersetzeAdresse(adresse());

  let ladenNr = 0;
  // Was gerade gezeigt wird (für die Richtung des Wechsels) und der laufende Übergang
  let zuletzt = null;
  let laufend = null;
  const bewegt = () =>
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  async function zeichne({ neuerEintrag = false } = {}) {
    const nr = ++ladenNr;
    detail.verberge(true);
    const art = zustand.wirksam();
    const montag = montagVon(zustand.datum);
    schreibeNavigation();
    merke(neuerEintrag);
    // Die alte Ansicht bleibt stehen, bis die neuen Daten da sind; erst nach 150 ms wird sie matt
    const timer = window.setTimeout(
      () => flaeche.classList.add("bl-flaeche--laedt"),
      150,
    );
    flaeche.setAttribute("aria-busy", "true");
    let daten;
    try {
      daten = await holeWoche(montag);
    } catch (f) {
      window.clearTimeout(timer);
      if (nr !== ladenNr) return;
      flaeche.classList.remove("bl-flaeche--laedt");
      flaeche.removeAttribute("aria-busy");
      tausche(
        el(
          "div",
          {},
          zustandsKarte(zustandsDaten(f), [nochmals(() => zeichne())]).wurzel,
        ),
        "blende",
      );
      zuletzt = null;
      return;
    }
    window.clearTimeout(timer);
    if (nr !== ladenNr) return;
    flaeche.classList.remove("bl-flaeche--laedt");
    flaeche.removeAttribute("aria-busy");
    const jetzt = { art, datum: zustand.datum };
    const modus = wechselRichtung(zuletzt, jetzt);
    zuletzt = jetzt;
    const seite = baueSeite(daten, art, montag);
    setzeText(
      titel,
      periodenTitel(art === "woche" ? "woche" : "tag", zustand.datum),
    );
    setzeText(zaehler, seite.zaehler);
    tausche(seite.knoten, modus);
  }

  // Text ersetzen und sanft einblenden, nur wenn er sich ändert
  function setzeText(knoten, text) {
    if (knoten.textContent === text) return;
    const erstes = knoten.textContent === "";
    knoten.textContent = text;
    if (!erstes && bewegt()) {
      knoten.animate(
        [
          { opacity: 0, transform: "translateY(6px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 240, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
      );
    }
  }

  // Die neue Seite an die Stelle der alten setzen: Höhe der Fläche gleitet von alt zu neu (kein Sprung), die alte Seite gleitet in Richtung des Wechsels hinaus, die neue herein, die Blöcke blenden gestaffelt ein. Bei «Bewegung reduzieren» ersetzt sie die alte sofort
  function tausche(neu, modus) {
    laufend?.beende();
    neu.classList.add("bl-seite");
    const alt = flaeche.querySelector(":scope > .bl-seite");
    const hatFokus = alt?.contains(document.activeElement) === true;
    const scrollY = window.scrollY;
    if (!alt || !bewegt()) {
      flaeche.replaceChildren(neu);
      fuehreFokus(neu);
      if (hatFokus) titel.focus();
      return;
    }
    const hoeheAlt = flaeche.offsetHeight;
    alt.classList.add("bl-seite--alt");
    alt.setAttribute("aria-hidden", "true");
    alt.inert = true;
    flaeche.classList.add("bl-flaeche--wechsel");
    fuehreFokus(neu);
    flaeche.append(neu);
    const hoeheNeu = flaeche.offsetHeight;
    const weg = modus === "vor" ? -1 : modus === "zurueck" ? 1 : 0;
    const kurve = "cubic-bezier(0.2, 0.7, 0.2, 1)";
    const dauer = modus === "blende" ? 220 : 320;
    const animationen = [
      alt.animate(
        [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: `translateX(${weg * 48}px)` },
        ],
        { duration: dauer, easing: kurve, fill: "forwards" },
      ),
      neu.animate(
        [
          {
            opacity: modus === "blende" ? 0 : 0.2,
            transform: `translateX(${-weg * 48}px)`,
          },
          { opacity: 1, transform: "none" },
        ],
        { duration: dauer, easing: kurve },
      ),
    ];
    if (hoeheAlt !== hoeheNeu) {
      animationen.push(
        flaeche.animate(
          [{ height: `${hoeheAlt}px` }, { height: `${hoeheNeu}px` }],
          { duration: dauer, easing: kurve },
        ),
      );
    }
    [...neu.querySelectorAll(".bl-block")].slice(0, 120).forEach((b, i) => {
      animationen.push(
        b.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 220,
          delay: Math.min(i * 9, 200),
          easing: "ease-out",
          fill: "backwards",
        }),
      );
    });
    if (window.scrollY !== scrollY) window.scrollTo(window.scrollX, scrollY);
    let fertig = false;
    const beende = () => {
      if (fertig) return;
      fertig = true;
      for (const a of animationen) a.cancel();
      alt.remove();
      flaeche.classList.remove("bl-flaeche--wechsel");
      laufend = null;
      if (hatFokus) titel.focus();
    };
    laufend = { beende };
    Promise.allSettled(animationen.map((a) => a.finished)).then(beende);
  }

  // Inhalt der Fläche für eine Woche und Ansicht samt Zahlen für die Zeile unter dem Titel
  function baueSeite(daten, art, montag) {
    const sichtbar = daten.raeume.filter(
      (r) => !zustand.raumId || r.id === zustand.raumId,
    );
    const letzter = plusTage(montag, 6);
    const je = gruppiere(daten.buchungen, montag, letzter, zustand.anfragen);
    // Zahlen des gezeigten Zeitraums (Woche oder Tag), nur gezeigte Räume
    const [erster, letzterTag] =
      art === "woche" ? [montag, letzter] : [zustand.datum, zustand.datum];
    let best = 0;
    let angef = 0;
    const gezaehlt = new Set();
    for (const r of sichtbar) {
      for (const [tag, teile] of je.get(r.id) ?? []) {
        if (tag < erster || tag > letzterTag) continue;
        for (const t of teile) {
          if (gezaehlt.has(t.buchung.id)) continue;
          gezaehlt.add(t.buchung.id);
          if (t.buchung.status === "bestaetigt") best += 1;
          else angef += 1;
        }
      }
    }
    const zaehlerText =
      best + angef === 0
        ? "Kein Raum belegt."
        : `${zaehlwort(best, "Buchung", "Buchungen")} bestätigt${zustand.anfragen ? `, ${zaehlwort(angef, "Anfrage", "Anfragen")} offen` : ""}.`;
    const inhalt = [];
    if (daten.weitere) {
      inhalt.push(
        el(
          "p",
          { class: "hinweis hinweis--warn", role: "status" },
          "Diese Woche hat mehr als 500 Buchungen. Gezeigt werden die ersten 500. Wähle einen Raum, um alle zu sehen.",
        ),
      );
    }
    if (art === "woche") {
      inhalt.push(
        wochenAnsicht({ sichtbar, je, montag, heute, detail, wechsle }),
      );
    } else if (art === "tag") {
      inhalt.push(
        tagesAnsicht({ sichtbar, je, datum: zustand.datum, heute, detail }),
      );
    } else {
      inhalt.push(
        listenAnsicht({
          sichtbar,
          je,
          datum: zustand.datum,
          heute,
          wechsle,
        }),
      );
    }
    return { knoten: el("div", {}, inhalt), zaehler: zaehlerText };
  }

  // Werkzeugleiste ------------------------------------------------------
  const schritt = () => (zustand.wirksam() === "woche" ? 7 : 1);
  const wortSchritt = () =>
    zustand.wirksam() === "woche"
      ? ["Vorige Woche", "Nächste Woche"]
      : ["Vorheriger Tag", "Nächster Tag"];
  const zurueckKnopf = el(
    "button",
    {
      type: "button",
      class: "knopf knopf--klein bl-pfeil",
      onclick: () => wechsle(plusTage(zustand.datum, -schritt())),
    },
    icon("zurueck"),
  );
  const vorKnopf = el(
    "button",
    {
      type: "button",
      class: "knopf knopf--klein bl-pfeil",
      onclick: () => wechsle(plusTage(zustand.datum, schritt())),
    },
    icon("weiter"),
  );
  const heuteKnopf = knopf("Heute", {
    klein: true,
    onclick: () => wechsle(heute),
  });
  function schreibeNavigation() {
    const [zu, vor] = wortSchritt();
    zurueckKnopf.setAttribute("aria-label", zu);
    vorKnopf.setAttribute("aria-label", vor);
    const art = zustand.wirksam();
    const zeigtHeute =
      art === "woche"
        ? montagVon(zustand.datum) === montagVon(heute)
        : zustand.datum === heute;
    heuteKnopf.disabled = zeigtHeute;
  }
  function wechsle(datum, art = zustand.art) {
    zustand.datum = datum;
    zustand.art = art;
    ansichtswahl.setze(art);
    zeichne({ neuerEintrag: true });
  }

  const ansichtswahl = filterGruppe({
    beschriftung: "Ansicht",
    eintraege: [
      { text: "Woche", wert: "woche" },
      { text: "Tag", wert: "tag" },
      { text: "Liste", wert: "liste" },
    ],
    wert: zustand.art,
    beiAenderung: (wert) => {
      zustand.art = wert;
      zeichne({ neuerEintrag: true });
    },
  });
  const ansichtHuelle = el("div", { class: "bl-ansicht" }, ansichtswahl.wurzel);
  const raumwahl = auswahl({
    label: "Raum",
    optionen: [["", "Alle Räume"], ...raeume.map((r) => [r.id, r.name])],
    wert: zustand.raumId,
  });
  raumwahl.eingabe.addEventListener("change", () => {
    zustand.raumId = raumwahl.eingabe.value;
    zeichne({ neuerEintrag: false });
  });
  const anfragenwahl = ankreuzen({
    label: "Angefragte zeigen",
    gewaehlt: zustand.anfragen,
    wert: "ja",
  });
  anfragenwahl.eingabe.addEventListener("change", () => {
    zustand.anfragen = anfragenwahl.eingabe.checked;
    zeichne({ neuerEintrag: false });
  });

  const werkzeuge = el(
    "div",
    { class: "bl-werkzeuge" },
    el(
      "div",
      { class: "bl-nav" },
      zurueckKnopf,
      heuteKnopf,
      vorKnopf,
      el("div", { class: "bl-zeitraum" }, titel, zaehler),
    ),
    el(
      "div",
      { class: "bl-wahl" },
      ansichtHuelle,
      raumwahl.wurzel,
      anfragenwahl.wurzel,
    ),
  );

  const kompaktAenderung = () => {
    const war = zustand.wirksam();
    zustand.kompakt = medien.matches;
    ansichtHuelle.hidden = zustand.kompakt;
    if (war !== zustand.wirksam()) zeichne();
  };
  medien.addEventListener("change", kompaktAenderung);
  ansichtHuelle.hidden = zustand.kompakt;
  const ab = new AbortController();
  // Beim Verlassen der Seite räumt die nächste Navigation den Container; die Abhörer an window und document hängen an dieser Seite
  document.addEventListener(
    "keydown",
    (e) => {
      if (!huelle.isConnected) return ab.abort();
      if (e.key === "Escape") detail.verberge(true);
    },
    { signal: ab.signal },
  );
  document.addEventListener(
    "click",
    (e) => {
      if (!huelle.isConnected) return ab.abort();
      if (!e.target.closest?.(".bl-block")) detail.verberge(true);
    },
    { signal: ab.signal },
  );
  window.addEventListener(
    "scroll",
    () => {
      if (!huelle.isConnected) return ab.abort();
      detail.verberge(false);
    },
    { passive: true, signal: ab.signal },
  );
  window.addEventListener(
    "resize",
    () => {
      if (!huelle.isConnected) return ab.abort();
      detail.verberge(true);
    },
    { signal: ab.signal },
  );

  // Rollende Tabulatormarke: Pfeiltasten wechseln zwischen den Blöcken
  huelle.addEventListener("keydown", (e) => {
    const richtung = {
      ArrowLeft: "links",
      ArrowRight: "rechts",
      ArrowUp: "oben",
      ArrowDown: "unten",
    }[e.key];
    const block = e.target.closest?.(".bl-block");
    if (!block) return;
    const alle = [...huelle.querySelectorAll(".bl-block")];
    const liste = alle.map((b) => ({
      raum: b.dataset.raum,
      beginn: Number(b.dataset.beginn),
    }));
    const reihenfolge = [...new Set(liste.map((b) => b.raum))];
    let ziel = alle.indexOf(block);
    if (richtung) {
      ziel = naechsterBlock(liste, ziel, richtung, reihenfolge);
    } else if (e.key === "Home" || e.key === "End") {
      const gleiche = alle.filter((b) => b.dataset.raum === block.dataset.raum);
      ziel = alle.indexOf(e.key === "Home" ? gleiche[0] : gleiche.at(-1));
    } else {
      return;
    }
    e.preventDefault();
    alle[ziel]?.focus();
  });

  bereich.append(
    werkzeuge,
    legende(),
    huelle,
    detail.wurzel,
    hinweisKarte(ctx),
  );
  zeichne();
}

// Beim ersten Block liegt die Tabulatormarke, die übrigen sind per Pfeiltaste erreichbar
function fuehreFokus(wurzel) {
  const bloecke = [...wurzel.querySelectorAll(".bl-block")];
  bloecke.forEach((b, i) => b.setAttribute("tabindex", i === 0 ? "0" : "-1"));
  for (const b of bloecke) {
    b.addEventListener("focus", () => {
      for (const o of bloecke) o.setAttribute("tabindex", o === b ? "0" : "-1");
    });
  }
}

/* ---------- Legende, Hinweis ---------- */

function legende() {
  const eintrag = (klasse, text, beschreibung) =>
    el(
      "li",
      { class: "bl-legende-eintrag" },
      el("span", { class: `bl-muster ${klasse}`, "aria-hidden": "true" }),
      el("span", {}, text),
      beschreibung && el("span", { class: "leise" }, ` ${beschreibung}`),
    );
  return el(
    "ul",
    { class: "bl-legende", "aria-label": "Legende" },
    eintrag("bl-muster--best", "Bestätigt", "(gebucht)"),
    eintrag("bl-muster--angef", "Angefragt", "(noch nicht entschieden)"),
    eintrag("bl-muster--frei", "Frei", "(Raum ist nicht belegt)"),
    el(
      "li",
      { class: "bl-legende-eintrag" },
      el("span", {
        class: "bl-muster bl-muster--jetzt",
        "aria-hidden": "true",
      }),
      el("span", {}, "Jetzt"),
    ),
  );
}

function hinweisKarte(ctx) {
  return el(
    "section",
    { class: "bl-hinweis", "aria-labelledby": "bl-hinweis-titel" },
    el(
      "h2",
      { id: "bl-hinweis-titel", class: "bl-hinweis-titel" },
      "Raum anfragen",
    ),
    el(
      "p",
      {},
      "Einen Raum fragst du unter «Meine Anfragen» an, in der Verwaltung oder in der Cevi-OS-App. Das zuständige Team oder die Abteilungsleitung bestätigt die Anfrage. Erst dann erscheint die Zeit hier als bestätigt; bis dahin steht sie als angefragt da.",
    ),
    el(
      "p",
      {},
      el(
        "a",
        { class: "knopf knopf--klein", href: "#raeume/meine" },
        icon("kalender"),
        "Raum anfragen",
      ),
    ),
    ctx.zugang.termine.raumAnfragen &&
      el(
        "p",
        {},
        el(
          "a",
          { class: "knopf knopf--klein", href: "#raeume/anfragen" },
          icon("kalender"),
          "Zu den Anfragen",
        ),
      ),
  );
}

/* ---------- Bausteine der Blöcke ---------- */

function bauePerson(person) {
  return person || "Unbekannt";
}

function blockBeschriftung(raum, b) {
  return `${raum.name}, ${zeitText(b)}, ${b.zweck}, ${bauePerson(b.person)}, ${STATUS[b.status].text}`;
}

// Ein Block: Knopf mit voller Beschriftung für Screenreader; Hover und Fokus zeigen die Karte, ein Klick oder Enter hält sie fest
function baueBlock({ raum, teil, lage, detail, inhalt, klasse }) {
  const b = teil.buchung;
  const knoten = el(
    "button",
    {
      type: "button",
      class: `bl-block bl-block--${b.status === "bestaetigt" ? "best" : "angef"} ${klasse ?? ""}`,
      "aria-label": blockBeschriftung(raum, b),
      "aria-haspopup": "false",
      "data-raum": raum.id,
      "data-beginn": String(Date.parse(b.beginn)),
      tabindex: "-1",
    },
    inhalt,
  );
  knoten.addEventListener("mouseenter", () =>
    detail.zeige(knoten, raum, b, false),
  );
  knoten.addEventListener("mouseleave", () => detail.verberge(false));
  knoten.addEventListener("focus", () => detail.zeige(knoten, raum, b, false));
  knoten.addEventListener("blur", () => detail.verberge(false));
  knoten.addEventListener("click", () => detail.zeige(knoten, raum, b, true));
  lage?.(knoten);
  return knoten;
}

// Karte mit den Angaben zur Buchung neben dem Block; rein zur Ansicht (aria-hidden): Screenreader lesen die Beschriftung des Blocks
function erstelleDetail() {
  const wurzel = el("div", {
    class: "bl-detail",
    "aria-hidden": "true",
    hidden: true,
  });
  let festgehalten = false;
  return {
    wurzel,
    zeige(anker, raum, b, festhalten) {
      if (festgehalten && !festhalten) return;
      festgehalten = festhalten;
      const status = STATUS[b.status];
      ersetze(
        wurzel,
        el(
          "p",
          {
            class: `bl-detail-status bl-detail-status--${b.status === "bestaetigt" ? "best" : "angef"}`,
          },
          icon(status.symbol),
          status.text,
        ),
        el("p", { class: "bl-detail-zweck" }, b.zweck),
        el(
          "dl",
          { class: "bl-detail-liste" },
          el("dt", {}, "Raum"),
          el("dd", {}, raum.name),
          el("dt", {}, "Zeit"),
          el("dd", { class: "tm-ziffern" }, zeitText(b)),
          el("dt", {}, "Von"),
          el("dd", {}, bauePerson(b.person)),
        ),
        b.status === "angefragt" &&
          el("p", { class: "bl-detail-fuss" }, "Noch nicht entschieden."),
      );
      wurzel.hidden = false;
      const r = anker.getBoundingClientRect();
      const breite = Math.min(300, window.innerWidth - 16);
      const links = Math.max(
        8,
        Math.min(r.left, window.innerWidth - breite - 8),
      );
      wurzel.style.width = `${breite}px`;
      wurzel.style.left = `${links}px`;
      const hoehe = wurzel.offsetHeight;
      const unten = r.bottom + 8 + hoehe <= window.innerHeight;
      wurzel.style.top = `${unten ? r.bottom + 8 : Math.max(8, r.top - hoehe - 8)}px`;
    },
    verberge(auch) {
      if (festgehalten && !auch) return;
      festgehalten = false;
      wurzel.hidden = true;
    },
  };
}

const symbolFuer = (status) => icon(STATUS[status].symbol);

/* ---------- Woche ---------- */

function wochenAnsicht({ sichtbar, je, montag, heute, detail, wechsle }) {
  const tage = wochenTage(montag);
  const alleTeile = [];
  for (const tageJeRaum of je.values()) {
    for (const liste of tageJeRaum.values()) alleTeile.push(...liste);
  }
  const achse = achseFuer(alleTeile);
  const huelle = el("div", {
    class: "bl-woche",
    role: "group",
    "aria-label": `Belegung der ${periodenTitel("woche", montag)}`,
  });
  const kopf = el(
    "div",
    { class: "bl-zeile bl-zeile--kopf" },
    el("div", { class: "bl-ecke" }, el("span", { class: "nur-leser" }, "Raum")),
    tage.map((tag) => {
      const istHeute = tag === heute;
      const anzahl = sichtbar.reduce(
        (n, r) => n + (je.get(r.id)?.get(tag)?.length ?? 0),
        0,
      );
      return el(
        "button",
        {
          type: "button",
          class: `bl-tagkopf${istHeute ? " bl-tagkopf--heute" : ""}`,
          "aria-current": istHeute ? "date" : undefined,
          "aria-label": `${langerTag.format(mittag(tag))}${istHeute ? ", heute" : ""}: ${zaehlwort(anzahl, "Buchung", "Buchungen")}. Tag öffnen`,
          onclick: () => wechsle(tag, "tag"),
        },
        el(
          "span",
          { class: "bl-tagname" },
          wochentagKurz.format(mittag(tag)).replace(/\.$/, ""),
        ),
        el(
          "span",
          { class: "bl-tagdatum tm-ziffern" },
          tagKurz.format(mittag(tag)),
        ),
        istHeute && el("span", { class: "bl-heute-chip" }, "Heute"),
        achsenSkala(achse),
      );
    }),
  );
  huelle.append(kopf);
  for (const r of sichtbar) {
    const zeile = el(
      "div",
      { class: "bl-zeile", role: "group", "aria-label": r.name },
      el(
        "div",
        { class: "bl-raumname" },
        el("span", { class: "bl-raumtitel" }, r.name),
        r.ort && el("span", { class: "klein leise" }, r.ort),
      ),
    );
    for (const tag of tage) {
      const teile = je.get(r.id)?.get(tag) ?? [];
      const spuren = ordneSpuren(teile);
      const zelle = el(
        "div",
        {
          class: `bl-zelle${tag === heute ? " bl-zelle--heute" : ""}`,
          role: "group",
          "aria-label": `${kurz(tag)}: ${teile.length === 0 ? "frei" : zaehlwort(teile.length, "Buchung", "Buchungen")}`,
        },
        teile.map((teil, i) => {
          const lage = lageAufAchse(teil.von, teil.bis, achse);
          const s = spuren[i];
          return baueBlock({
            raum: r,
            teil,
            detail,
            inhalt: symbolFuer(teil.buchung.status),
            lage: (k) => {
              k.style.left = `${lage.links}%`;
              k.style.width = `${lage.breite}%`;
              k.style.setProperty(
                "--bl-top",
                `calc(${(s.spur / s.spuren) * 100}% + 5px)`,
              );
              k.style.setProperty(
                "--bl-hoehe",
                `calc(${(1 / s.spuren) * 100}% - 10px)`,
              );
            },
          });
        }),
      );
      // Ab 1280 px steht der Zweck als Kurztext unter dem Balken (nur wo der Balken allein steht und Platz bleibt bis zum nächsten)
      teile.forEach((teil, i) => {
        if (spuren[i].spuren > 1) return;
        const lage = lageAufAchse(teil.von, teil.bis, achse);
        const folgt = teile[i + 1]
          ? lageAufAchse(teile[i + 1].von, teile[i + 1].bis, achse).links
          : 100;
        const platz = Math.min(folgt, 100) - lage.links;
        if (platz < 14) return;
        const etikett = el(
          "span",
          { class: "bl-etikett", "aria-hidden": "true" },
          teil.buchung.zweck,
        );
        etikett.style.left = `${lage.links}%`;
        etikett.style.width = `${platz}%`;
        zelle.append(etikett);
        zelle.children[i].classList.add("bl-block--einzeln");
      });
      if (tag === heute) zelle.append(jetztMarke("waagrecht", achse));
      zeile.append(zelle);
    }
    huelle.append(zeile);
  }
  return huelle;
}

// Kleine Skala 07 · 12 · 18 · 23 im Kopf eines Tages
function achsenSkala(achse) {
  const marken = [7, 12, 18, 23].filter(
    (h) => h * 60 >= achse.anfang && h * 60 <= achse.ende,
  );
  return el(
    "span",
    { class: "bl-skala", "aria-hidden": "true" },
    marken.map((h) => {
      const m = el(
        "span",
        { class: "bl-marke tm-ziffern" },
        String(h).padStart(2, "0"),
      );
      m.style.left = `${((h * 60 - achse.anfang) / achse.laenge) * 100}%`;
      return m;
    }),
  );
}

// Die Marke «Jetzt»: Linie zur aktuellen Uhrzeit in Schweizer Zeit; ausserhalb der Achse fehlt sie
function jetztMarke(richtung, achse) {
  const minuten = zuerichTeile(new Date()).minuten;
  if (minuten < achse.anfang || minuten > achse.ende) return null;
  const marke = el("span", {
    class: `bl-jetzt bl-jetzt--${richtung}`,
    "aria-hidden": "true",
    title: `Jetzt, ${uhrzeit(minuten)}`,
  });
  if (richtung === "waagrecht") {
    marke.style.left = `${((minuten - achse.anfang) / achse.laenge) * 100}%`;
  } else {
    marke.style.top = `${((minuten - achse.anfang) / 60) * STUNDE_PX}px`;
    marke.append(
      el(
        "span",
        { class: "bl-jetzt-text tm-ziffern" },
        `Jetzt ${uhrzeit(minuten)}`,
      ),
    );
  }
  return marke;
}

/* ---------- Tag ---------- */

const STUNDE_PX = 56;

function tagesAnsicht({ sichtbar, je, datum, heute, detail }) {
  const teileJeRaum = new Map(
    sichtbar.map((r) => [r.id, je.get(r.id)?.get(datum) ?? []]),
  );
  const alleTeile = [...teileJeRaum.values()].flat();
  const achse = achseFuer(alleTeile);
  const hoehe = (achse.laenge / 60) * STUNDE_PX;
  const gutter = el("div", { class: "bl-gutter", "aria-hidden": "true" });
  gutter.style.height = `${hoehe}px`;
  for (let h = achse.anfang / 60; h <= achse.ende / 60; h++) {
    const m = el(
      "span",
      { class: "bl-stunde tm-ziffern" },
      `${String(h).padStart(2, "0")}:00`,
    );
    m.style.top = `${((h * 60 - achse.anfang) / 60) * STUNDE_PX}px`;
    gutter.append(m);
  }
  const raster = el("div", {
    class: "bl-tag",
    role: "group",
    "aria-label": `Belegung am ${langerTag.format(mittag(datum))}`,
  });
  raster.style.setProperty("--bl-raeume", String(sichtbar.length));
  const kopfzeile = el(
    "div",
    { class: "bl-spaltenkopfzeile" },
    el("div", { class: "bl-ecke" }),
  );
  const koerper = el("div", { class: "bl-spaltenkoerper" }, gutter);
  for (const r of sichtbar) {
    const teile = teileJeRaum.get(r.id);
    const frei = freieFenster(teile, achse);
    kopfzeile.append(
      el(
        "div",
        { class: "bl-spaltenkopf" },
        el("span", { class: "bl-raumtitel" }, r.name),
        el("span", { class: "klein leise" }, r.ort ?? ""),
        el("span", { class: "klein bl-frei" }, freiText(frei)),
      ),
    );
    const spuren = ordneSpuren(teile);
    const spalte = el(
      "div",
      {
        class: "bl-spalte",
        role: "group",
        "aria-label": `${r.name}, ${freiText(frei)}`,
      },
      teile.map((teil, i) => {
        const b = teil.buchung;
        const s = spuren[i];
        const kurzBlock = ((teil.bis - teil.von) / 60) * STUNDE_PX < 44;
        return baueBlock({
          raum: r,
          teil,
          detail,
          klasse: [
            kurzBlock && "bl-block--kurz",
            s.spuren > 1 && "bl-block--schmal",
          ]
            .filter(Boolean)
            .join(" "),
          inhalt: [
            el(
              "span",
              { class: "bl-block-kopf" },
              symbolFuer(b.status),
              el(
                "span",
                { class: "tm-ziffern" },
                `${uhrzeit(teil.von)}–${uhrzeit(teil.bis === 1440 ? 1440 : teil.bis)}`,
              ),
              b.status === "angefragt" &&
                el("span", { class: "bl-block-status" }, "angefragt"),
            ),
            el("span", { class: "bl-block-zweck" }, b.zweck),
            el("span", { class: "bl-block-person" }, bauePerson(b.person)),
          ],
          lage: (k) => {
            k.style.top = `${((teil.von - achse.anfang) / 60) * STUNDE_PX}px`;
            k.style.height = `${((teil.bis - teil.von) / 60) * STUNDE_PX}px`;
            k.style.left = `calc(${(s.spur / s.spuren) * 100}% + 2px)`;
            k.style.width = `calc(${(s.spanne / s.spuren) * 100}% - 4px)`;
          },
        });
      }),
    );
    spalte.style.height = `${hoehe}px`;
    koerper.append(spalte);
  }
  if (datum === heute) {
    const marke = jetztMarke("senkrecht", achse);
    if (marke) koerper.append(marke);
  }
  raster.append(kopfzeile, koerper);
  // Ohne Buchung bleibt der Plan so hoch wie sonst; der Satz liegt darüber
  if (alleTeile.length === 0) {
    raster.append(
      el(
        "p",
        { class: "bl-leer-hinweis", role: "status" },
        `Am ${langerTag.format(mittag(datum))} ist kein Raum belegt. Alle Räume sind den ganzen Tag frei.`,
      ),
    );
  }
  return raster;
}

/* ---------- Liste ---------- */

function listenAnsicht({ sichtbar, je, datum, heute, wechsle }) {
  const montag = montagVon(datum);
  const tage = wochenTage(montag);
  const streifen = el(
    "ul",
    { class: "bl-streifen", "aria-label": "Tage der Woche" },
    tage.map((tag) => {
      const n = sichtbar.reduce(
        (s, r) => s + (je.get(r.id)?.get(tag)?.length ?? 0),
        0,
      );
      return el(
        "li",
        {},
        el(
          "button",
          {
            type: "button",
            class: "bl-streifentag",
            "aria-pressed": String(tag === datum),
            "aria-current": tag === heute ? "date" : undefined,
            "aria-label": `${langerTag.format(mittag(tag))}${tag === heute ? ", heute" : ""}: ${zaehlwort(n, "Buchung", "Buchungen")}`,
            onclick: () => wechsle(tag, "liste"),
          },
          el(
            "span",
            { class: "bl-tagname" },
            wochentagKurz.format(mittag(tag)).replace(/\.$/, ""),
          ),
          el("span", { class: "tm-ziffern" }, String(mittag(tag).getUTCDate())),
          el("span", {
            class: `bl-punkt${n > 0 ? " bl-punkt--da" : ""}`,
            "aria-hidden": "true",
          }),
        ),
      );
    }),
  );
  const achse = achseFuer(
    sichtbar.flatMap((r) => je.get(r.id)?.get(datum) ?? []),
  );
  const karten = sichtbar.map((r) => {
    const teile = je.get(r.id)?.get(datum) ?? [];
    const frei = freieFenster(teile, achse);
    return el(
      "section",
      { class: "bl-raumkarte", "aria-labelledby": `bl-r-${r.id}` },
      el(
        "header",
        { class: "bl-raumkopf" },
        el(
          "div",
          {},
          el("h3", { id: `bl-r-${r.id}`, class: "bl-raumtitel" }, r.name),
          r.ort && el("p", { class: "klein leise" }, r.ort),
        ),
        el(
          "span",
          { class: `chip ${teile.length === 0 ? "chip--ok" : ""}` },
          teile.length === 0 ? icon("haken") : null,
          teile.length === 0
            ? "Frei"
            : zaehlwort(teile.length, "Buchung", "Buchungen"),
        ),
      ),
      teile.length > 0 &&
        el(
          "ul",
          { class: "bl-eintraege" },
          teile.map((teil) => {
            const b = teil.buchung;
            return el(
              "li",
              {
                class: `bl-eintrag bl-eintrag--${b.status === "bestaetigt" ? "best" : "angef"}`,
              },
              el(
                "span",
                { class: "bl-eintrag-zeit tm-ziffern" },
                `${uhrzeit(teil.von)}–${uhrzeit(teil.bis)}`,
              ),
              el(
                "span",
                { class: "bl-eintrag-text" },
                el("span", { class: "bl-eintrag-zweck" }, b.zweck),
                el("span", { class: "klein leise" }, bauePerson(b.person)),
              ),
              el(
                "span",
                {
                  class: `chip ${b.status === "bestaetigt" ? "chip--stufe" : "chip--warn"}`,
                },
                symbolFuer(b.status),
                STATUS[b.status].text,
              ),
            );
          }),
        ),
      el(
        "p",
        { class: "klein bl-frei" },
        teile.length === 0 ? "Den ganzen Tag frei." : freiText(frei, 4),
      ),
    );
  });
  return el(
    "div",
    { class: "bl-liste" },
    streifen,
    el("h3", { class: "bl-listentitel" }, langerTag.format(mittag(datum))),
    el("div", { class: "bl-karten" }, karten),
  );
}

/* ---------- Skeleton ---------- */

function skelettFlaeche() {
  const zeilen = Array.from({ length: 4 }, () =>
    el(
      "div",
      { class: "bl-sk-zeile" },
      sk("t", 112),
      Array.from({ length: 7 }, () =>
        el("span", { class: "sk bl-sk-zelle", "aria-hidden": "true" }),
      ),
    ),
  );
  return el(
    "div",
    { class: "bl-sk", role: "status" },
    el("span", { class: "nur-leser" }, "Belegung wird geladen …"),
    zeilen,
  );
}

function skelettSeite() {
  return el(
    "div",
    {},
    el("div", { class: "bl-werkzeuge" }, sk("r", 260), sk("r", 200)),
    skelettFlaeche(),
  );
}

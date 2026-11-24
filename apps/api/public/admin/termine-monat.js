// Monatsansicht des Kalenders (#590): Monatsraster mit Terminchips (auch über mehrere Tage) und Tagesliste daneben; Aufbau nach dem Muster «Monat mit Terminchips und Tagesliste», Tastatur im Raster (Roving Tabindex: Pfeile, Pos1/Ende, Bild auf/ab).
// Der erste Teil sind reine Funktionen ohne Browser (Test admin-termine-monat.test.ts), der zweite baut die Knoten. Nur lesen: Die Termine kommen aus Outlook.
// Abfragen: je Monat eine Seite von höchstens 100 Terminen, weitere Seiten nur, wenn die API «weitere» meldet (höchstens 5); die Monate liegen 2 Minuten im Speicher, Filter und Suche laufen im Browser. Kein Polling.
import { fehlertext } from "./api.js";
import { addiereMonate, addiereTage } from "./datumsfeld.js";
import { chip, el, icon, knopf, neueId } from "./dom.js";
import { ZONE, uhr, zaehlwort } from "./kalenderhilfen.js";

/* ---------- Reine Funktionen ---------- */

const tagFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE });
// Der Kalender zeigt höchstens so viele Tage eines Termins an (Schutz vor Fehldaten)
const MAX_TAGE = 62;

// Schweizer Kalendertag eines Zeitpunkts: «2026-12-05»
export const zuerichTag = (zeitpunkt) =>
  tagFormat.format(zeitpunkt instanceof Date ? zeitpunkt : new Date(zeitpunkt));

export function tageZwischen(von, bis) {
  const tage = [];
  for (let t = von; t <= bis && tage.length < MAX_TAGE; t = addiereTage(t, 1)) {
    tage.push(t);
  }
  return tage;
}

// Erster und letzter Kalendertag eines Termins (inklusive). Ein Termin, der genau um Mitternacht endet, gehört dem neuen Tag nicht mehr an.
export function terminTage(t) {
  if (t.ganztaegig) return [t.tagVon, t.tagBis ?? t.tagVon];
  const beginn = new Date(t.beginn);
  const ende = new Date(t.ende);
  const von = zuerichTag(beginn);
  const bis =
    ende > beginn ? zuerichTag(new Date(ende.getTime() - 1)) : zuerichTag(ende);
  return [von, bis < von ? von : bis];
}

const beginnText = (t) => (t.ganztaegig ? `${t.tagVon}T00:00` : t.beginn);
// Ganztägige zuerst, dann nach Beginn, dann nach Titel
export function vergleicheTermine(a, b) {
  return (
    Number(b.ganztaegig) - Number(a.ganztaegig) ||
    String(beginnText(a)).localeCompare(String(beginnText(b))) ||
    a.titel.localeCompare(b.titel, "de-CH")
  );
}

// Map «Tag → Termine des Tages» (sortiert); ein mehrtägiger Termin steht an jedem seiner Tage
export function nachTagen(termine) {
  const karte = new Map();
  for (const t of [...termine].sort(vergleicheTermine)) {
    const [von, bis] = terminTage(t);
    for (const tag of tageZwischen(von, bis)) {
      if (!karte.has(tag)) karte.set(tag, []);
      karte.get(tag).push(t);
    }
  }
  return karte;
}

export const monatVon = (tag) => tag.slice(0, 7);

// Wochen eines Monats (Montag zuerst) als Listen zu sieben Tagen; die Ränder gehören dem Vor- und Folgemonat
export function monatsWochen(monat) {
  const erster = `${monat}-01`;
  const [j, m] = monat.split("-").map(Number);
  const wochentag = (new Date(Date.UTC(j, m - 1, 1)).getUTCDay() + 6) % 7;
  const tageImMonat = new Date(Date.UTC(j, m, 0)).getUTCDate();
  const wochen = Math.ceil((wochentag + tageImMonat) / 7);
  const start = addiereTage(erster, -wochentag);
  return Array.from({ length: wochen }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => addiereTage(start, w * 7 + i)),
  );
}

// Zeitraum, den die Abfrage eines Monats abdeckt (mit den Randtagen des Rasters)
export function monatsZeitraum(monat) {
  const wochen = monatsWochen(monat);
  return { von: wochen[0][0], bis: wochen.at(-1)[6] };
}

// Ein Datum, das es gibt: ein ungültiges Date (2026-13-45) wirft bei toISOString
export const gueltigerTag = (s) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) &&
  new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const gueltigerMonat = (s) =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(s) &&
  +s.slice(0, 4) >= 2000 &&
  +s.slice(0, 4) <= 2100;

// Adresse → Ansicht. #termine/kalender (dieser Monat) · …/2027-01 (Monat) · …/2027-01-16 (Monat mit gewähltem Tag) · …/liste (3 Monate als Tabelle) · …/liste/12 oder …/12 (12 Monate)
export function ansichtAusPfad(pfad, heute) {
  const [a, b] = pfad;
  if (a === "liste") return { art: "liste", zeitraum: b === "12" ? "12" : "3" };
  if (a === "12") return { art: "liste", zeitraum: "12" };
  if (a && gueltigerMonat(a)) return { art: "monat", monat: a, tag: null };
  if (a && gueltigerTag(a) && gueltigerMonat(monatVon(a))) {
    return { art: "monat", monat: monatVon(a), tag: a };
  }
  return { art: "monat", monat: monatVon(heute), tag: null };
}

export function adresseVon(ansicht) {
  if (ansicht.art === "liste") {
    return `#termine/kalender/liste${ansicht.zeitraum === "12" ? "/12" : ""}`;
  }
  return `#termine/kalender/${ansicht.tag ?? ansicht.monat}`;
}

// Bahnen einer Woche: Ein mehrtägiger Termin liegt an allen Tagen der Woche in derselben Zeile, damit der Balken nicht springt.
// Liefert je Tag eine Liste (Bahn → Termin oder null)
export function wochenBahnen(woche, karte) {
  const belegt = woche.map(() => []);
  const gesehen = new Set();
  const liste = [];
  for (const tag of woche) {
    for (const t of karte.get(tag) ?? []) {
      if (!gesehen.has(t.id)) {
        gesehen.add(t.id);
        liste.push(t);
      }
    }
  }
  // Wer früher beginnt, bekommt die oberen Bahnen
  liste.sort(
    (a, b) =>
      terminTage(a)[0].localeCompare(terminTage(b)[0]) ||
      vergleicheTermine(a, b),
  );
  for (const t of liste) {
    const [von, bis] = terminTage(t);
    const index = woche
      .map((tag, i) => (tag >= von && tag <= bis ? i : -1))
      .filter((i) => i >= 0);
    let bahn = 0;
    while (index.some((i) => belegt[i][bahn])) bahn++;
    for (const i of index) belegt[i][bahn] = t;
  }
  return belegt.map((tag) => Array.from(tag, (t) => t ?? null));
}

// Taste im Raster → Zieltag (null: keine Bewegungstaste)
export function naechsterTag(tag, taste, umschalt = false) {
  const wochentag = (new Date(`${tag}T00:00:00Z`).getUTCDay() + 6) % 7;
  switch (taste) {
    case "ArrowLeft":
      return addiereTage(tag, -1);
    case "ArrowRight":
      return addiereTage(tag, 1);
    case "ArrowUp":
      return addiereTage(tag, -7);
    case "ArrowDown":
      return addiereTage(tag, 7);
    case "Home":
      return addiereTage(tag, -wochentag);
    case "End":
      return addiereTage(tag, 6 - wochentag);
    case "PageUp":
      return addiereMonate(tag, umschalt ? -12 : -1);
    case "PageDown":
      return addiereMonate(tag, umschalt ? 12 : 1);
    default:
      return null;
  }
}

export const verschiebeMonat = (monat, n) =>
  monatVon(addiereMonate(`${monat}-01`, n));

// Filter: suche (Titel, Ort), gruppe: "" (alle), "keine" (ohne Gruppe) oder die Kennung einer Gruppe, und nur: "meine" (die Termine der Gruppen der angemeldeten Person; die API markiert sie mit «meine») oder "alle"
export function filtere(termine, { suche = "", gruppe = "", nur = "alle" }) {
  const begriff = suche.trim().toLocaleLowerCase("de-CH");
  return termine.filter((t) => {
    if (nur === "meine" && !t.meine) return false;
    if (
      begriff &&
      !`${t.titel} ${t.ort ?? ""}`.toLocaleLowerCase("de-CH").includes(begriff)
    ) {
      return false;
    }
    if (gruppe === "keine") return t.tags.length === 0;
    if (gruppe) return t.tags.some((g) => g.id === gruppe);
    return true;
  });
}

const monatsFormat = new Intl.DateTimeFormat("de-CH", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const langFormat = new Intl.DateTimeFormat("de-CH", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const kurzFormat = new Intl.DateTimeFormat("de-CH", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
export const monatsName = (monat) =>
  monatsFormat.format(new Date(`${monat}-01T00:00:00Z`));
export const tagLang = (tag) => langFormat.format(new Date(`${tag}T00:00:00Z`));
const tagKurz = (tag) => kurzFormat.format(new Date(`${tag}T00:00:00Z`));
const WOCHENTAGE = [
  ["Mo", "Montag"],
  ["Di", "Dienstag"],
  ["Mi", "Mittwoch"],
  ["Do", "Donnerstag"],
  ["Fr", "Freitag"],
  ["Sa", "Samstag"],
  ["So", "Sonntag"],
];

/* ---------- Speicher je Monat ---------- */

const FRIST_MS = 120_000;
const MAX_SEITEN = 5;
const speicher = new Map();

// holeSeite(von, bis, nach) → { termine, weitere, naechste }; liefert { termine, unvollstaendig }
export async function ladeMonat(monat, holeSeite, { neu = false } = {}) {
  const alt = speicher.get(monat);
  if (!neu && alt && Date.now() - alt.zeit < FRIST_MS) return alt.daten;
  const { von, bis } = monatsZeitraum(monat);
  const termine = [];
  let nach = "";
  let unvollstaendig = false;
  for (let seite = 1; ; seite++) {
    const antwort = await holeSeite(von, bis, nach);
    termine.push(...antwort.termine);
    if (!antwort.weitere) break;
    if (seite >= MAX_SEITEN) {
      unvollstaendig = true;
      break;
    }
    nach = antwort.naechste;
  }
  const daten = { termine, unvollstaendig };
  speicher.set(monat, { zeit: Date.now(), daten });
  return daten;
}

/* ---------- Knoten ---------- */

const GRUPPENKLASSE = {
  abgesagt: "tm-ereignis--abgesagt",
  pruefen: "tm-ereignis--pruefen",
  ohne: "tm-ereignis--ohne",
};
function zustandVon(t) {
  if (t.status === "abgesagt") return "abgesagt";
  if (t.status !== "aktiv") return "pruefen";
  return t.tags.length === 0 ? "ohne" : "normal";
}

// Zeit eines Termins an einem Tag: «ganztägig», «14:00–17:00», bei Mehrtägigem «ab 14:00» / «bis 11:00» / «ganztägig»
function zeitAmTag(t, tag) {
  if (t.ganztaegig) return "ganztägig";
  const [von, bis] = terminTage(t);
  const beginn = new Date(t.beginn);
  const ende = new Date(t.ende);
  if (von === bis) return `${uhr(beginn)}–${uhr(ende)}`;
  if (tag === von) return `ab ${uhr(beginn)}`;
  if (tag === bis) return `bis ${uhr(ende)}`;
  return "ganztägig";
}

// «Tag 2 von 3» bei Terminen über mehrere Tage
function tagesZaehler(t, tag) {
  const [von, bis] = terminTage(t);
  if (von === bis) return null;
  const alle = tageZwischen(von, bis);
  return `Tag ${alle.indexOf(tag) + 1} von ${alle.length}`;
}

// heute: «2026-12-05»; gruppen: [{ id, name }] für die Auswahl der Filterleiste (im Aufrufer)
// zustand: { monat, tag, suche, gruppe, nur }; beiAenderung(zustand, art): Adresse nachführen (art «monat» = neuer Verlaufseintrag, «tag» = Korrektur)
export function monatsAnsicht({
  heute,
  zustand,
  holeSeite,
  beiAenderung,
  beiZahlen,
  ansichtswahl,
  werkzeugleiste,
}) {
  let daten = { termine: [], unvollstaendig: false };
  let karte = new Map();
  let fokusTag = zustand.tag;
  let laedt = 0;

  const titelId = neueId("tm-monat");
  const monatTitel = el("h2", { id: titelId, class: "tm-monatstitel" });
  const zurueckKnopf = el(
    "button",
    {
      type: "button",
      class: "knopf knopf--rund",
      "aria-label": "Vorheriger Monat",
      onclick: () => wechsle(verschiebeMonat(zustand.monat, -1)),
    },
    icon("zurueck"),
  );
  const weiterKnopf = el(
    "button",
    {
      type: "button",
      class: "knopf knopf--rund",
      "aria-label": "Nächster Monat",
      onclick: () => wechsle(verschiebeMonat(zustand.monat, 1)),
    },
    icon("weiter"),
  );
  const heuteKnopf = knopf("Heute", {
    klein: true,
    onclick: () => wechsle(monatVon(heute), heute),
  });
  const ansage = el("p", { class: "nur-leser", role: "status" });
  const meldung = el("div", { class: "tm-meldungsplatz" });
  const raster = el("div", {
    class: "tm-raster",
    role: "grid",
    "aria-labelledby": titelId,
  });
  const liste = el("section", { class: "tm-tagesliste" });
  const wurzel = el(
    "div",
    { class: "tm-monat" },
    el(
      "div",
      { class: "tm-monatskopf" },
      el(
        "div",
        { class: "tm-monatsnav" },
        zurueckKnopf,
        el(
          "div",
          { class: "tm-monatsname", "aria-live": "polite" },
          monatTitel,
        ),
        weiterKnopf,
      ),
      heuteKnopf,
      el("div", { class: "tm-ansichtswahl" }, ansichtswahl),
    ),
    werkzeugleiste,
    meldung,
    el("div", { class: "tm-monatslayout" }, raster, liste),
    ansage,
  );

  const sichtbar = () => filtere(daten.termine, zustand);

  // Nur die Markierung wechselt, das Raster bleibt stehen: Der Fokus bleibt auf dem Tag
  function waehleTag(tag) {
    const alt = tagKnopf(zustand.tag);
    alt?.classList.remove("tm-tag--gewaehlt");
    alt?.setAttribute("aria-pressed", "false");
    zustand.tag = tag;
    fokusTag = tag;
    const neu = tagKnopf(tag);
    neu?.classList.add("tm-tag--gewaehlt");
    neu?.setAttribute("aria-pressed", "true");
    beiAenderung(zustand, "tag");
    zeichneListe();
  }
  const tagKnopf = (tag) => raster.querySelector(`[data-tag="${tag}"]`);

  async function wechsle(
    monat,
    tag = null,
    { fokus = false, neu = false } = {},
  ) {
    const bisher = zustand.monat;
    zustand.monat = monat;
    zustand.tag = tag;
    fokusTag = tag ?? `${monat}-01`;
    if (monat !== bisher) beiAenderung(zustand, "monat");
    else if (tag) beiAenderung(zustand, "tag");
    await lade({ fokus, neu });
  }

  async function lade({ fokus = false, neu = false } = {}) {
    const lauf = ++laedt;
    ersetzeKinder(meldung);
    raster.setAttribute("aria-busy", "true");
    wurzel.classList.add("tm-monat--laedt");
    monatTitel.textContent = monatsName(zustand.monat);
    try {
      const neuDaten = await ladeMonat(zustand.monat, holeSeite, { neu });
      if (lauf !== laedt || !wurzel.isConnected) return;
      daten = neuDaten;
    } catch (f) {
      if (lauf !== laedt || !wurzel.isConnected) return;
      daten = { termine: [], unvollstaendig: false };
      ersetzeKinder(
        meldung,
        el(
          "div",
          { class: "hinweis hinweis--fehler", role: "alert" },
          el(
            "span",
            {},
            `Der Monat ${monatsName(zustand.monat)} konnte nicht geladen werden. ${fehlertext(f)}`.trim(),
          ),
          knopf("Nochmals versuchen", {
            klein: true,
            symbol: "aktualisieren",
            onclick: () => lade({ neu: true }),
          }),
        ),
      );
    } finally {
      if (lauf === laedt) {
        raster.removeAttribute("aria-busy");
        wurzel.classList.remove("tm-monat--laedt");
      }
    }
    karte = nachTagen(sichtbar());
    // Ohne gewählten Tag: heute, wenn er im Monat liegt, sonst der erste Tag mit Terminen, sonst der Erste
    if (!zustand.tag || monatVon(zustand.tag) !== zustand.monat) {
      zustand.tag =
        monatVon(heute) === zustand.monat
          ? heute
          : ([...karte.keys()]
              .filter((t) => monatVon(t) === zustand.monat)
              .sort()[0] ?? `${zustand.monat}-01`);
      beiAenderung(zustand, "tag");
    }
    fokusTag = zustand.tag;
    zeichneKopf();
    zeichneRaster();
    zeichneListe();
    if (fokus) tagKnopf(fokusTag)?.focus();
  }

  function zeichneKopf() {
    const imMonat = sichtbar().filter((t) => {
      const [von, bis] = terminTage(t);
      return von <= `${zustand.monat}-31` && bis >= `${zustand.monat}-01`;
    });
    beiZahlen?.(
      imMonat.length,
      daten.termine.filter((t) => {
        const [von, bis] = terminTage(t);
        return von <= `${zustand.monat}-31` && bis >= `${zustand.monat}-01`;
      }).length,
      daten.unvollstaendig,
    );
    if (daten.unvollstaendig) {
      ersetzeKinder(
        meldung,
        el(
          "div",
          { class: "hinweis hinweis--warn", role: "status" },
          "Dieser Monat hat sehr viele Termine, es sind nicht alle geladen. Grenze die Anzeige mit einer Gruppe ein.",
        ),
      );
    }
  }

  function zeichneRaster() {
    const wochen = monatsWochen(zustand.monat);
    const kopf = el(
      "div",
      { class: "tm-woche tm-woche--kopf", role: "row" },
      WOCHENTAGE.map(([kurz, lang]) =>
        el(
          "div",
          { class: "tm-wochentag", role: "columnheader" },
          el("abbr", { "data-tipp": lang }, kurz),
        ),
      ),
    );
    const tabbar =
      fokusTag && monatVon(fokusTag) === zustand.monat
        ? fokusTag
        : `${zustand.monat}-01`;
    const zeilen = wochen.map((woche) => {
      const bahnen = wochenBahnen(woche, karte);
      return el(
        "div",
        { class: "tm-woche", role: "row" },
        woche.map((tag, i) => zelle(tag, bahnen[i], i, tag === tabbar)),
      );
    });
    raster.replaceChildren(kopf, ...zeilen);
  }

  function zelle(tag, bahnen, spalte, tabbar) {
    const ausserhalb = monatVon(tag) !== zustand.monat;
    const tagTermine = karte.get(tag) ?? [];
    const gewaehlt = tag === zustand.tag;
    const istHeute = tag === heute;
    const text = `${tagKurz(tag)}${istHeute ? ", heute" : ""}, ${
      tagTermine.length === 0
        ? "keine Termine"
        : zaehlwort(tagTermine.length, "Termin", "Termine")
    }`;
    const MAX = 3;
    const sichtbarBahnen = bahnen.slice(0, MAX);
    const verborgen = bahnen.slice(MAX).filter(Boolean).length;
    const chips = el(
      "span",
      { class: "tm-chips", "aria-hidden": "true" },
      sichtbarBahnen.map((t) =>
        t
          ? chipFuerTag(t, tag, spalte)
          : el("span", { class: "tm-ereignis tm-ereignis--leer" }),
      ),
      verborgen > 0 &&
        el("span", { class: "tm-mehr-zahl" }, `+${verborgen} weitere`),
    );
    const punkte = el(
      "span",
      { class: "tm-punkte", "aria-hidden": "true" },
      tagTermine
        .slice(0, 3)
        .map((t) =>
          el("span", { class: `tm-punkt tm-punkt--${zustandVon(t)}` }),
        ),
      tagTermine.length > 3 &&
        el("span", { class: "tm-punkt-zahl" }, `+${tagTermine.length - 3}`),
    );
    const knopfNode = el(
      "button",
      {
        type: "button",
        class: `tm-tag${gewaehlt ? " tm-tag--gewaehlt" : ""}${istHeute ? " tm-tag--heute" : ""}${ausserhalb ? " tm-tag--ausserhalb" : ""}`,
        "data-tag": tag,
        "aria-label": text,
        "aria-pressed": String(gewaehlt),
        "aria-current": istHeute ? "date" : undefined,
        tabindex: tag === tabbar ? "0" : "-1",
        onclick: () =>
          ausserhalb
            ? wechsle(monatVon(tag), tag, { fokus: true })
            : waehleTag(tag),
        onfocus: () => (fokusTag = tag),
        onkeydown: (e) => bewege(e, tag),
      },
      el("span", { class: "tm-tagzahl" }, String(Number(tag.slice(8)))),
      chips,
      punkte,
    );
    return el("div", { class: "tm-zelle", role: "gridcell" }, knopfNode);
  }

  // Ein Balken je Tag; über mehrere Tage ohne Rand zum Nachbartag. Der Titel steht am ersten Tag und am Wochenanfang.
  function chipFuerTag(t, tag, spalte) {
    const [von, bis] = terminTage(t);
    const fortsetzung = tag > von;
    const weiter = tag < bis;
    const mitTitel = !fortsetzung || spalte === 0;
    const zustandsKlasse = GRUPPENKLASSE[zustandVon(t)] ?? "";
    return el(
      "span",
      {
        class: `tm-ereignis ${zustandsKlasse}${fortsetzung ? " tm-ereignis--fort" : ""}${weiter ? " tm-ereignis--weiter" : ""}`,
      },
      mitTitel && el("span", { class: "tm-ereignis-text" }, t.titel),
    );
  }

  function bewege(e, tag) {
    if (e.key === "Enter" || e.key === " ") return; // Klick löst aus
    const ziel = naechsterTag(tag, e.key, e.shiftKey);
    if (!ziel) return;
    e.preventDefault();
    if (monatVon(ziel) !== zustand.monat) {
      wechsle(monatVon(ziel), ziel, { fokus: true });
      return;
    }
    fokusTag = ziel;
    const alt = tagKnopf(tag);
    const neu = tagKnopf(ziel);
    alt?.setAttribute("tabindex", "-1");
    neu?.setAttribute("tabindex", "0");
    neu?.focus();
  }

  function zeichneListe() {
    const tag = zustand.tag;
    const tagTermine = karte.get(tag) ?? [];
    const kopf = el(
      "header",
      { class: "tm-tageskopf" },
      el("h3", { tabindex: "-1" }, tagLang(tag)),
      el(
        "p",
        { class: "klein leise" },
        tagTermine.length === 0
          ? "Keine Termine"
          : zaehlwort(tagTermine.length, "Termin", "Termine"),
      ),
    );
    ansage.textContent = `${tagKurz(tag)}: ${
      tagTermine.length === 0
        ? "keine Termine"
        : zaehlwort(tagTermine.length, "Termin", "Termine")
    }. Die Liste steht neben oder unter dem Kalender.`;
    liste.setAttribute("aria-label", `Termine am ${tagKurz(tag)}`);
    if (tagTermine.length === 0) {
      liste.replaceChildren(
        kopf,
        el(
          "p",
          { class: "tm-tagesleer" },
          daten.termine.length > 0 && sichtbar().length === 0
            ? zustand.nur === "meine"
              ? "Für deine Gruppen steht in diesem Monat nichts an."
              : "Kein Termin passt zu deinen Filtern."
            : "An diesem Tag steht nichts an. Neue Termine erfasst du in Outlook.",
        ),
      );
      return;
    }
    liste.replaceChildren(
      kopf,
      el(
        "ul",
        { class: "tm-tagesliste-eintraege" },
        tagTermine.map((t) => eintrag(t, tag)),
      ),
    );
  }

  function eintrag(t, tag) {
    const zaehler = tagesZaehler(t, tag);
    const zustandsName = zustandVon(t);
    return el(
      "li",
      { class: `tm-eintrag tm-eintrag--${zustandsName}` },
      el(
        "p",
        { class: "tm-eintrag-zeit tm-ziffern" },
        zeitAmTag(t, tag),
        zaehler && el("span", { class: "leise" }, ` · ${zaehler}`),
      ),
      el("p", { class: "tm-eintrag-titel" }, t.titel),
      t.ort && el("p", { class: "klein leise" }, t.ort),
      el(
        "ul",
        { class: "chips tm-unter" },
        t.status === "abgesagt" && chip("Abgesagt", "fehler"),
        t.status !== "aktiv" &&
          t.status !== "abgesagt" &&
          chip("Bitte prüfen", "warn"),
        t.tags.length === 0
          ? chip("Keine Gruppe", "warn")
          : t.tags.map((g) => chip(g.name, "stufe", "tag")),
        t.anlass && chip("Anlass mit Anmeldung", undefined, "haken"),
      ),
      t.anlass &&
        el(
          "a",
          {
            class: "tm-eintrag-link",
            href: `#anlaesse/${t.anlass.id}`,
          },
          "Anlass öffnen",
        ),
    );
  }

  // Der Aufrufer meldet geänderte Filter
  function filterGeaendert() {
    karte = nachTagen(sichtbar());
    zeichneKopf();
    zeichneRaster();
    zeichneListe();
  }

  return {
    wurzel,
    start: () => lade(),
    filterGeaendert,
    wechsleZu: (monat, tag) => wechsle(monat, tag),
  };
}

function ersetzeKinder(knoten, ...kinder) {
  knoten.replaceChildren(...kinder.flat().filter(Boolean));
}

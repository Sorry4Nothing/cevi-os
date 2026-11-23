// Kacheln der Übersicht (#583, neu gestaltet in #607): jede Kachel eine Funktion, die aus der Antwort von GET /api/v1/admin/uebersicht einen Knoten baut. Fehlt ein Teil in der Antwort, fehlt die Kachel (kein Recht, siehe docs/rechte.md); steht er in «fehlt», zeigt die Kachel für sich «Nochmals versuchen», der Rest bleibt stehen.
// Vorlagen für Aufbau und Zustände (angesehen und nachgezeichnet, kein Quelltext übernommen): Kokonut UI Pro «agent-inbox» (Aufgaben nach dem, was sie von dir brauchen), «status-footer» (Streifen mit Ablesung per Zeiger und Pfeiltasten), «clinic-dashboard» (Tagesschiene für das Kommende), «stats-feature» und «clinic-dashboard» (Kennzahlen: Zahl gross, Veränderung als Marke mit Pfeil, kleine Grafik).
import { chip, el, icon, knopf } from "./dom.js";
import { BEREICHE, darfSehen } from "./navigation.js";
import {
  fmt,
  pfeil,
  rangBalken,
  saeulen,
  svg,
  verlaufLinie,
  vorzeichen,
} from "./uebersicht-diagramme.js";

const ZONE = "Europe/Zurich";
const de = (optionen) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: ZONE, ...optionen });
const fKurz = de({ day: "numeric", month: "numeric" });
const fTag = de({ weekday: "short" });
const fTagMonat = de({ day: "numeric", month: "short" });
const fZahl = de({ day: "numeric" });
const fMonat = de({ month: "short" });
const fUhr = de({ hour: "2-digit", minute: "2-digit" });
const fDatumZeit = de({
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const heuteIso = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date());

// Ein Kalendertag «2026-12-05» ohne Zeitzonensprung
const tagDatum = (iso) => new Date(`${iso}T12:00:00Z`);
const MS_TAG = 86_400_000;

// «vor 5 Minuten», «vor 3 Stunden», «vor 4 Tagen»
export function vor(iso, jetzt = Date.now()) {
  const min = Math.max(
    0,
    Math.round((jetzt - new Date(iso).getTime()) / 60_000),
  );
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} ${min === 1 ? "Minute" : "Minuten"}`;
  const std = Math.round(min / 60);
  if (std < 48) return `vor ${std} ${std === 1 ? "Stunde" : "Stunden"}`;
  const tage = Math.round(std / 24);
  return `vor ${tage} Tagen`;
}

// Wohin ein Verweis führt: [Bereich, Unterseite]. Die Kachel ist nur dann ein Link, wenn die Person die Seite sehen darf (sonst zeigt sie nur die Zahl)
function ziel(ctx, [bereich, unter]) {
  const b = BEREICHE.find((x) => x.schluessel === bereich);
  const u = b?.unter.find((x) => x.schluessel === unter);
  if (!u) return null;
  const ok = darfSehen(u, {
    istAdmin: ctx.ich.role === "admin",
    zugang: ctx.zugang,
  });
  // Hat der Bereich nur eine Unterseite, steht sie nicht in der Adresse (#anlaesse)
  return ok
    ? b.unter.length === 1
      ? `#${bereich}`
      : `#${bereich}/${unter}`
    : null;
}

let zaehlerId = 0;
const neueId = (v) => `ub-${v}-${++zaehlerId}`;

// Eine Fläche mit Überschrift (h3 in einem Abschnitt mit h2); das Skelett der Kachel hat dieselbe Form (uebersicht.js)
function kachel({ titel, klasse = "", inhalt, aktion }) {
  const id = neueId("k");
  return el(
    "section",
    { class: `ub-kachel ${klasse}`.trim(), "aria-labelledby": id },
    el(
      "div",
      { class: "ub-kachel-kopf" },
      el("h3", { id, class: "ub-kachel-titel" }, titel),
      aktion,
    ),
    inhalt,
  );
}

// Fehler einer einzelnen Kachel: Der Rest der Seite bleibt, «Nochmals versuchen» lädt die Übersicht neu
export function fehlerKachel(titel, nochmals) {
  return kachel({
    titel,
    klasse: "ub-kachel--fehler",
    inhalt: el(
      "div",
      { class: "ub-zustand", role: "status" },
      el("ul", { class: "chips" }, chip("Nicht geladen", "fehler")),
      el("p", { class: "leise" }, "Diese Zahlen konnten nicht geladen werden."),
      knopf("Nochmals versuchen", {
        klein: true,
        symbol: "aktualisieren",
        onclick: nochmals,
      }),
    ),
  });
}

const verweisZeile = (href, text) =>
  href && el("a", { class: "ub-verweis", href }, text, pfeil());

// 1. Jetzt zu tun --------------------------------------------------------------------------

// Reihenfolge: erst Störungen, dann was auf eine Entscheidung wartet, dann Website und Aufräumarbeit
const AUFGABEN = [
  {
    schluessel: "kalenderFehler",
    art: "stoerung",
    text: [
      "Der Kalender-Abgleich ist fehlgeschlagen",
      "Der Kalender-Abgleich ist fehlgeschlagen",
    ],
    kurz: "Kalender-Abgleich",
    aktion: "Prüfen",
    ziel: ["termine", "outlook"],
  },
  {
    schluessel: "kontenOhneZweitenFaktor",
    art: "sicher",
    text: [
      "Konto mit Verwaltungsrechten hat keinen zweiten Faktor",
      "Konten mit Verwaltungsrechten haben keinen zweiten Faktor",
    ],
    kurz: "Zweiter Faktor",
    aktion: "Ansehen",
    ziel: ["personen", "personen"],
  },
  {
    schluessel: "terminVorschlaege",
    text: [
      "Terminvorschlag wartet auf deinen Entscheid",
      "Terminvorschläge warten auf deinen Entscheid",
    ],
    kurz: "Terminvorschläge",
    aktion: "Prüfen",
    ziel: ["termine", "vorschlaege"],
  },
  {
    schluessel: "raumanfragen",
    text: [
      "Raumanfrage wartet auf deinen Entscheid",
      "Raumanfragen warten auf deinen Entscheid",
    ],
    kurz: "Raumanfragen",
    aktion: "Entscheiden",
    ziel: ["raeume", "anfragen"],
  },
  {
    schluessel: "bestellungenBereit",
    text: [
      "Bestellung liegt bereit und wartet auf die Übergabe",
      "Bestellungen liegen bereit und warten auf die Übergabe",
    ],
    kurz: "Bestellungen zur Übergabe",
    aktion: "Übergeben",
    ziel: ["laedeli", "bestellungen"],
  },
  {
    schluessel: "bestellungenOffen",
    text: [
      "Bestellung ist neu und noch nicht bearbeitet",
      "Bestellungen sind neu und noch nicht bearbeitet",
    ],
    kurz: "Neue Bestellungen",
    aktion: "Bearbeiten",
    ziel: ["laedeli", "bestellungen"],
  },
  {
    schluessel: "websiteAenderungen",
    text: [
      "Seite hat Änderungen, die noch nicht veröffentlicht sind",
      "Seiten haben Änderungen, die noch nicht veröffentlicht sind",
    ],
    kurz: "Unveröffentlichte Änderungen",
    aktion: "Prüfen",
    ziel: ["website", "seiten"],
  },
  {
    schluessel: "websiteEntwuerfe",
    text: ["Seite ist noch ein Entwurf", "Seiten sind noch Entwürfe"],
    kurz: "Entwürfe",
    aktion: "Ansehen",
    ziel: ["website", "seiten"],
  },
  {
    schluessel: "termineOhneKategorie",
    text: [
      "Termin hat keine Kategorie und ist für niemanden sichtbar",
      "Termine haben keine Kategorie und sind für niemanden sichtbar",
    ],
    kurz: "Termine ohne Kategorie",
    aktion: "Zuordnen",
    ziel: ["termine", "warnliste"],
  },
  {
    schluessel: "anmeldefristen",
    text: [
      "Anmeldefrist endet in den nächsten 7 Tagen",
      "Anmeldefristen enden in den nächsten 7 Tagen",
    ],
    kurz: "Anmeldefristen",
    aktion: "Ansehen",
    ziel: ["anlaesse", "anlaesse"],
  },
];

const ARTEN = {
  stoerung: ["Störung", "warnung"],
  sicher: ["Sicherheit", "schild"],
};

// Jede Kachel hat denselben Aufbau, damit alle gleich gross und gleich bedienbar sind: oben Zahl und Marke, in der Mitte der Satz, unten die Zeile mit der Aktion (feste Höhe; ohne Recht auf die Zielseite bleibt die Zeile leer)
function aufgabe(def, wert, ctx) {
  const n = typeof wert === "boolean" ? (wert ? 1 : 0) : wert;
  const href = ziel(ctx, def.ziel);
  const inhalt = [
    el(
      "span",
      { class: "ub-aufgabe-kopf" },
      typeof wert === "boolean"
        ? el("span", { class: "ub-zahl ub-zahl--wort" }, "Fehler")
        : el("span", { class: "ub-zahl" }, fmt(n)),
      def.art &&
        el(
          "ul",
          { class: "chips ub-art" },
          chip(ARTEN[def.art][0], "warn", ARTEN[def.art][1]),
        ),
    ),
    el("span", { class: "ub-aufgabe-text" }, def.text[n === 1 ? 0 : 1]),
    el("span", { class: "ub-aufgabe-aktion" }, href && [def.aktion, pfeil()]),
  ];
  return el(
    "li",
    {},
    href
      ? el("a", { class: "ub-aufgabe", href }, inhalt)
      : el("div", { class: "ub-aufgabe ub-aufgabe--still" }, inhalt),
  );
}

// Das Band: nur was offen ist, als Kacheln mit Zahl und Sprung; was erledigt ist, steht in einem Satz darunter
export function aufgabenBand(daten, ctx, nochmals) {
  const a = daten.aufgaben;
  const id = neueId("h");
  const abschnitt = (inhalt) =>
    el(
      "section",
      { class: "ub-abschnitt ub-band", "aria-labelledby": id },
      el("h2", { id }, "Jetzt zu tun"),
      inhalt,
    );
  if (!a) {
    return daten.fehlt.some((f) => ["aufgaben", "website"].includes(f))
      ? abschnitt(fehlerKachel("Aufgaben", nochmals))
      : null;
  }
  const offen = AUFGABEN.filter(
    (d) =>
      a[d.schluessel] !== undefined &&
      a[d.schluessel] !== false &&
      a[d.schluessel] !== 0,
  );
  const erledigt = AUFGABEN.filter(
    (d) => a[d.schluessel] === 0 || a[d.schluessel] === false,
  );
  const teile = [];
  if (offen.length > 0) {
    teile.push(
      el(
        "ul",
        { class: "ub-aufgaben" },
        offen.map((d) => aufgabe(d, a[d.schluessel], ctx)),
      ),
    );
  } else {
    teile.push(
      el(
        "div",
        { class: "ub-leer", role: "status" },
        icon("haken"),
        el("p", { class: "ub-leer-satz" }, "Gerade ist nichts offen."),
      ),
    );
  }
  if (erledigt.length > 0 && offen.length > 0) {
    teile.push(
      el(
        "p",
        { class: "ub-erledigt klein leise" },
        icon("haken"),
        `Nichts offen bei: ${erledigt.map((d) => d.kurz).join(", ")}.`,
      ),
    );
  } else if (erledigt.length > 0) {
    teile.push(
      el(
        "p",
        { class: "ub-erledigt klein leise" },
        `Geprüft: ${erledigt.map((d) => d.kurz).join(", ")}.`,
      ),
    );
  }
  if (daten.fehlt.includes("raumanfragen")) {
    teile.push(
      el(
        "div",
        { class: "hinweis hinweis--warn", role: "status" },
        el("span", {}, "Die Raumanfragen konnten nicht geprüft werden."),
        knopf("Nochmals versuchen", { klein: true, onclick: nochmals }),
      ),
    );
  }
  return abschnitt(teile);
}

// 2. Kennzahlen ----------------------------------------------------------------------------
// Aufbau nach den Statistikkacheln von Kokonut UI Pro («stats-feature»: Zahl gross und tabellarisch, Bezeichnung darunter; «clinic-dashboard»: Veränderung als Marke mit Pfeil): Titel, grosse Zahl mit Einheit, Veränderung gegenüber dem Zeitraum davor, kleine Grafik. Nur Zahlen, die für die Abteilung etwas sagen und die die Route schon liefert.

const wochenNamen = (erzeugtAm, n) =>
  Array.from({ length: n }, (_, i) => {
    const ende = new Date(
      new Date(erzeugtAm).getTime() - (n - 1 - i) * 7 * MS_TAG,
    );
    return i === n - 1 ? "Letzte 7 Tage" : `7 Tage bis ${fKurz.format(ende)}`;
  });

function wert(zahlText, einheitText) {
  return el(
    "p",
    { class: "ub-wert" },
    el("span", { class: "ub-wert-zahl" }, zahlText),
    einheitText && el("span", { class: "ub-wert-einheit" }, einheitText),
  );
}

// Pfeil der Veränderung: hoch, runter oder gleich (Zustand nie nur über Farbe: Pfeil und Vorzeichen)
const PFEIL_PFAD = {
  hoch: "M12 19V5M6 11l6-6 6 6",
  runter: "M12 5v14M6 13l6 6 6-6",
  gleich: "M5 12h14",
};

// Veränderung als Marke mit Pfeil und Vorzeichen, daneben der Vergleich in Worten
function veraenderung(unterschied, text) {
  const richtung =
    unterschied > 0 ? "hoch" : unterschied < 0 ? "runter" : "gleich";
  return el(
    "p",
    { class: "ub-delta" },
    el(
      "span",
      { class: "ub-marke-delta" },
      svg(
        "svg",
        {
          class: "ub-pfeil",
          viewBox: "0 0 24 24",
          "aria-hidden": "true",
          focusable: "false",
        },
        svg("path", { d: PFEIL_PFAD[richtung] }),
      ),
      vorzeichen(unterschied),
    ),
    el("span", {}, text),
  );
}
const vergleichText = (text) => el("p", { class: "ub-delta" }, text);

// Eine Kennzahl: Titel, Zahl, Veränderung und Grafik; die Grafik trägt Satz und Ablesung (uebersicht-diagramme.js)
function kennzahl({ titel, wertText, einheit, vergleich, grafik }) {
  return kachel({
    titel,
    klasse: "ub-stat",
    inhalt: [
      wert(wertText, einheit),
      vergleich,
      el("div", { class: "ub-diagramm" }, grafik),
    ],
  });
}

export function kennzahlen(daten, ctx, { nochmals }) {
  const k = daten.kennzahlen;
  const id = neueId("h");
  const kacheln = [];
  if (k) {
    const n = k.fenster;
    const namen = wochenNamen(daten.erzeugtAm, n);
    const an = k.anmeldungen;
    const neu = an.verlauf[n - 1];
    const davor = an.verlauf[n - 2];
    kacheln.push(
      kennzahl({
        titel: "Anmeldungen zu Anlässen",
        wertText: fmt(an.kommend),
        einheit: "bei kommenden Anlässen",
        vergleich: veraenderung(
          neu - davor,
          `${fmt(neu)} neu in den letzten 7 Tagen, ${fmt(davor)} in den 7 Tagen davor`,
        ),
        grafik: saeulen({
          titel: "Neue Anmeldungen je 7 Tage",
          einheit: "Anmeldungen",
          punkte: an.verlauf.map((w, i) => ({ name: namen[i], wert: w })),
        }),
      }),
    );
    const p = k.personen;
    const seit = p.verlauf[n - 1] - p.verlauf[n - 5];
    kacheln.push(
      kennzahl({
        titel: "Konten",
        wertText: fmt(p.jetzt),
        einheit: "aktive Konten",
        vergleich: veraenderung(seit, "seit vier Wochen"),
        grafik: verlaufLinie({
          titel: "Aktive Konten",
          einheit: "Konten",
          punkte: p.verlauf.map((w, i) => ({
            name:
              i === n - 1 ? "Heute" : namen[i].replace("7 Tage bis", "Stand"),
            wert: w,
          })),
        }),
      }),
    );
    // Bestellungen nur, wenn das Lädeli in den letzten Wochen überhaupt benutzt wurde
    const be = k.bestellungen.verlauf;
    if (be.some((w) => w > 0)) {
      kacheln.push(
        kennzahl({
          titel: "Bestellungen im Lädeli",
          wertText: fmt(be[n - 1]),
          einheit: "in den letzten 7 Tagen",
          vergleich: veraenderung(
            be[n - 1] - be[n - 2],
            "gegenüber den 7 Tagen davor",
          ),
          grafik: saeulen({
            titel: "Neue Bestellungen je 7 Tage",
            einheit: "Bestellungen",
            punkte: be.map((w, i) => ({ name: namen[i], wert: w })),
          }),
        }),
      );
    }
  } else if (daten.fehlt.includes("kennzahlen")) {
    kacheln.push(fehlerKachel("Kennzahlen", nochmals));
  }
  // Termine der nächsten Wochen: dieselbe Sicht wie «Kommendes», ohne Termine keine Kachel
  const wochen = daten.kommend?.termineProWoche;
  const summe = wochen ? wochen.reduce((s, w) => s + w, 0) : 0;
  if (wochen && summe > 0) {
    const woche = (i) =>
      i === 0 ? "Diese Woche" : i === 1 ? "Nächste Woche" : `In ${i} Wochen`;
    kacheln.push(
      kennzahl({
        titel: "Termine",
        wertText: fmt(summe),
        einheit: `in den nächsten ${daten.kommend.wochen} Wochen`,
        vergleich: vergleichText(
          `Diese Woche ${fmt(wochen[0])}, nächste Woche ${fmt(wochen[1] ?? 0)}`,
        ),
        grafik: saeulen({
          titel: "Termine je Woche",
          einheit: "Termine",
          punkte: wochen.map((w, i) => ({ name: woche(i), wert: w })),
        }),
      }),
    );
  }
  if (kacheln.length === 0) return null;
  return el(
    "section",
    { class: "ub-abschnitt", "aria-labelledby": id },
    el("h2", { id }, "Kennzahlen"),
    el("div", { class: "ub-raster" }, kacheln),
  );
}

// 3. Kommendes -----------------------------------------------------------------------------

// Beginn als Zeitpunkt für das Sortieren
const beginnVon = (t) => (t.beginn ? new Date(t.beginn) : tagDatum(t.tagVon));

function datumsblock(d, heute) {
  const istHeute = fKurz.format(d) === fKurz.format(tagDatum(heute));
  return el(
    "span",
    {
      class: "ub-datum" + (istHeute ? " ub-datum--heute" : ""),
      "aria-hidden": "true",
    },
    el("span", { class: "ub-datum-tag" }, fTag.format(d).replace(".", "")),
    el("span", { class: "ub-datum-zahl" }, fZahl.format(d)),
    el("span", { class: "ub-datum-monat" }, fMonat.format(d).replace(".", "")),
  );
}

function zeitText(t) {
  if (t.ganztaegig) {
    if (t.tagBis && t.tagBis !== t.tagVon) {
      return `Ganztägig, bis ${fTagMonat.format(tagDatum(t.tagBis))}`;
    }
    return "Ganztägig";
  }
  return `${fUhr.format(new Date(t.beginn))}–${fUhr.format(new Date(t.ende))} Uhr`;
}

function lesbarerTag(d) {
  return new Intl.DateTimeFormat("de-CH", {
    timeZone: ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

export function kommendes(daten, ctx, { nochmals }) {
  const k = daten.kommend;
  if (!k) {
    return daten.fehlt.includes("kommend")
      ? fehlerKachel("Kommendes", nochmals)
      : null;
  }
  const heute = heuteIso();
  const zeilen = [
    ...k.termine.map((t) => ({
      art: "termin",
      titel: t.titel,
      von: beginnVon(t),
      t,
    })),
    ...k.lager.map((l) => ({
      art: "lager",
      titel: l.titel,
      von: tagDatum(l.von),
      l,
    })),
  ]
    .sort((a, b) => a.von - b.von)
    .slice(0, 6);
  const ist = ctx.ich.role === "admin";
  const liste =
    zeilen.length === 0
      ? el(
          "div",
          { class: "ub-zustand", role: "status" },
          el(
            "p",
            { class: "ub-leer-satz" },
            `In den nächsten ${k.wochen} Wochen steht nichts an.`,
          ),
        )
      : el(
          "ol",
          { class: "ub-zeitleiste" },
          zeilen.map((z) => {
            const meta =
              z.art === "lager"
                ? `${fTagMonat.format(tagDatum(z.l.von))} bis ${fTagMonat.format(tagDatum(z.l.bis))}`
                : zeitText(z.t);
            const chips = [];
            if (z.art === "lager") chips.push(chip("Lager", "", false));
            if (z.art === "lager" && z.l.status === "entwurf")
              chips.push(chip("Entwurf", "warn"));
            if (fKurz.format(z.von) === fKurz.format(tagDatum(heute)))
              chips.push(chip("Heute", "", false));
            return el(
              "li",
              {},
              datumsblock(z.von, heute),
              el(
                "span",
                { class: "ub-zeile-text" },
                el("span", { class: "nur-leser" }, `${lesbarerTag(z.von)}: `),
                el("span", { class: "ub-zeile-titel" }, z.titel),
                el("span", { class: "ub-zeile-meta klein leise" }, meta),
              ),
              chips.length > 0 && el("ul", { class: "chips" }, chips),
            );
          }),
        );
  return kachel({
    titel: "Kommendes",
    klasse: "ub-kommend",
    aktion:
      ist && ziel(ctx, ["termine", "kalender"])
        ? verweisZeile(ziel(ctx, ["termine", "kalender"]), "Alle Termine")
        : undefined,
    inhalt: [
      daten.fehlt.includes("lager") &&
        el(
          "div",
          { class: "hinweis hinweis--warn", role: "status" },
          el("span", {}, "Die Lager konnten nicht geladen werden."),
          knopf("Nochmals versuchen", { klein: true, onclick: nochmals }),
        ),
      liste,
    ],
  });
}

// 4. Kinder je Stufe -----------------------------------------------------------------------

export function kinderJeStufe(daten, ctx, { nochmals }) {
  const s = daten.kinderJeStufe;
  if (!s)
    return daten.fehlt.includes("kinderJeStufe")
      ? fehlerKachel("Kinder je Stufe", nochmals)
      : null;
  const summe = s.reduce((x, y) => x + y.kinder, 0);
  return kachel({
    titel: "Kinder je Stufe",
    klasse: "ub-stufen",
    aktion:
      ctx.ich.role === "admin" && ziel(ctx, ["personen", "kinder"])
        ? verweisZeile(ziel(ctx, ["personen", "kinder"]), "Kinder")
        : undefined,
    inhalt:
      s.length === 0
        ? el(
            "div",
            { class: "ub-zustand", role: "status" },
            el("p", { class: "ub-leer-satz" }, "Noch keine Stufe angelegt."),
          )
        : [
            wert(
              fmt(summe),
              s.length === 1
                ? "Kind in dieser Stufe"
                : `Kinder in ${s.length} Stufen`,
            ),
            rangBalken({
              zeilen: s.map((x) => ({ name: x.name, wert: x.kinder })),
              einheit: "Kinder",
            }),
          ],
  });
}

// 5. Zustand -------------------------------------------------------------------------------
// Nur, was die Abteilung wissen muss: läuft die Website (Wartung, Sperre), läuft der Kalender-Abgleich. Dateien, Speicher und Antwortzeiten der Datenbank sind Sache des Systems und stehen dort. Aufbau wie der Streifen «Status» von Kokonut UI Pro (status-footer): ein Band, je Punkt Name, Zustand als Wort mit Symbol und ein Satz.

const chips = (...c) => el("ul", { class: "chips" }, c.filter(Boolean));

function punkt({ titel, zustandChips, satz, href, verweis, extra }) {
  const id = neueId("p");
  return el(
    "li",
    { class: "ub-punkt-betrieb", "aria-labelledby": id },
    el(
      "div",
      { class: "ub-betrieb-kopf" },
      el("h3", { id, class: "ub-kachel-titel" }, titel),
      href && verweisZeile(href, verweis),
    ),
    zustandChips,
    el("p", { class: "ub-delta" }, satz),
    extra,
  );
}

export function zustand(daten, ctx, { nochmals }) {
  const z = daten.zustand ?? {};
  const punkte = [];
  if (z.website) {
    const w = z.website;
    punkte.push(
      punkt({
        titel: "Website",
        href: ziel(ctx, ["website", "seiten"]),
        verweis: "Seiten",
        zustandChips: chips(
          w.sperre
            ? chip(
                w.offline
                  ? "Informationssperre, Website vom Netz"
                  : "Informationssperre",
                "fehler",
              )
            : null,
          w.wartung
            ? chip(
                w.wartungEndeAm
                  ? `Wartung bis ${fDatumZeit.format(new Date(w.wartungEndeAm))}`
                  : "Wartung",
                "warn",
              )
            : null,
          !w.sperre && !w.wartung ? chip("Läuft", "ok") : null,
        ),
        satz: w.zuletztErzeugtAm
          ? `Zuletzt aktualisiert ${vor(w.zuletztErzeugtAm)}`
          : "Noch nie erzeugt",
      }),
    );
  } else if (daten.fehlt.includes("website")) {
    punkte.push(
      punkt({
        titel: "Website",
        zustandChips: chips(chip("Nicht geladen", "fehler")),
        satz: "Der Zustand konnte nicht geladen werden.",
        extra: knopf("Nochmals versuchen", { klein: true, onclick: nochmals }),
      }),
    );
  }
  if (z.kalender) {
    const c = z.kalender;
    const alt =
      c.letzterErfolgAm &&
      Date.now() - new Date(c.letzterErfolgAm).getTime() > 30 * 60_000;
    punkte.push(
      punkt({
        titel: "Kalender-Abgleich",
        href: ziel(ctx, ["termine", "outlook"]),
        verweis: "Outlook",
        zustandChips: chips(
          !c.eingerichtet ? chip("Nicht eingerichtet", "", "info") : null,
          c.eingerichtet && c.fehler
            ? chip("Letzter Abgleich fehlgeschlagen", "fehler")
            : null,
          c.eingerichtet && !c.fehler && alt
            ? chip("Älter als 30 Minuten", "warn")
            : null,
          c.eingerichtet && !c.fehler && !alt && c.letzterErfolgAm
            ? chip("Läuft", "ok")
            : null,
        ),
        satz: !c.eingerichtet
          ? "Die Termine kommen noch nicht aus Outlook."
          : c.fehler
            ? c.fehler
            : c.letzterErfolgAm
              ? `Letzter Abgleich ${vor(c.letzterErfolgAm)}`
              : "Noch kein Abgleich erfolgt",
      }),
    );
  }
  if (punkte.length === 0) return null;
  const id = neueId("h");
  return el(
    "section",
    { class: "ub-abschnitt", "aria-labelledby": id },
    el("h2", { id }, "Zustand"),
    el("ul", { class: "ub-betrieb" }, punkte),
  );
}

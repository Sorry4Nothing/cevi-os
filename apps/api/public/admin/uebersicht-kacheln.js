// Kacheln der Übersicht (#583): jede Kachel eine Funktion, die aus der Antwort von GET /api/v1/admin/uebersicht einen Knoten baut. Fehlt ein Teil in der Antwort, fehlt die Kachel (kein Recht, siehe docs/rechte.md); steht er in «fehlt», zeigt die Kachel für sich «Nochmals versuchen», der Rest bleibt stehen.
// Vorlagen für Aufbau und Zustände (angesehen und nachgezeichnet, kein Quelltext übernommen): Kokonut UI Pro «agent-inbox» (Aufgaben nach dem, was sie von dir brauchen), «status-footer» (Streifen mit Ablesung per Zeiger und Pfeiltasten), «clinic-dashboard» (Tagesschiene für das Kommende).
import { chip, el, icon, knopf } from "./dom.js";
import { BEREICHE, darfSehen } from "./navigation.js";
import {
  fmt,
  pfeil,
  rangBalken,
  saeulen,
  verlaufLinie,
  vorzeichen,
  wertetabelle,
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
  return ok ? `#${bereich}/${unter}` : null;
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
    ziel: ["anlaesse", "anmeldungen"],
  },
];

const ARTEN = {
  stoerung: ["Störung", "warnung"],
  sicher: ["Sicherheit", "schild"],
};

function aufgabe(def, wert, ctx) {
  const n = typeof wert === "boolean" ? (wert ? 1 : 0) : wert;
  const href = ziel(ctx, def.ziel);
  const inhalt = [
    def.art &&
      el(
        "ul",
        { class: "chips ub-art" },
        chip(ARTEN[def.art][0], "warn", ARTEN[def.art][1]),
      ),
    typeof wert === "boolean"
      ? el("span", { class: "ub-zahl ub-zahl--wort" }, "Fehler")
      : el("span", { class: "ub-zahl" }, fmt(n)),
    el("span", { class: "ub-aufgabe-text" }, def.text[n === 1 ? 0 : 1]),
    href && el("span", { class: "ub-aufgabe-aktion" }, def.aktion, pfeil()),
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
const delta = (text) => el("p", { class: "ub-delta" }, text);

// Eine Kennzahl: Wert, Vergleich mit Zeitraum, Grafik und ihre Tabelle (der Schalter «Tabellen statt Diagramme» blendet eine der beiden aus)
function kennzahl({ titel, wertKnoten, vergleich, grafik, tabelle, klasse }) {
  return kachel({
    titel,
    klasse: `ub-kennzahl ${klasse ?? ""}`,
    inhalt: [
      wertKnoten,
      vergleich,
      el("div", { class: "ub-diagramm" }, grafik),
      tabelle,
    ],
  });
}

export function kennzahlen(daten, ctx, { nochmals, tabellen, beiTabellen }) {
  const k = daten.kennzahlen;
  const b = daten.betrieb;
  const id = neueId("h");
  const kacheln = [];
  if (k) {
    const n = k.fenster;
    const namen = wochenNamen(daten.erzeugtAm, n);
    const p = k.personen;
    const seit = p.verlauf[n - 1] - p.verlauf[n - 5];
    kacheln.push(
      kennzahl({
        titel: "Personen",
        wertKnoten: wert(fmt(p.jetzt), "aktive Konten"),
        vergleich: delta(
          seit === 0
            ? "Unverändert seit vier Wochen"
            : `${vorzeichen(seit)} seit vier Wochen`,
        ),
        grafik: verlaufLinie({
          titel: "Aktive Konten",
          einheit: "Konten",
          punkte: p.verlauf.map((w, i) => ({
            name:
              i === n - 1 ? "Heute" : namen[i].replace("7 Tage bis", "Stand"),
            wert: w,
          })),
        }),
        tabelle: wertetabelle({
          beschriftung: "Aktive Konten am Ende jedes Zeitraums",
          spalten: ["Zeitpunkt", "Konten"],
          zeilen: p.verlauf.map((w, i) => [
            namen[i].replace("7 Tage bis", "Stand"),
            fmt(w),
          ]),
        }),
      }),
    );
    const an = k.anmeldungen;
    const neu = an.verlauf[n - 1];
    const davor = an.verlauf[n - 2];
    kacheln.push(
      kennzahl({
        titel: "Anmeldungen zu Anlässen",
        wertKnoten: wert(fmt(an.kommend), "bei kommenden Anlässen"),
        vergleich: delta(
          `Neu in 7 Tagen: ${fmt(neu)} (${neu === davor ? "gleich viele wie in den 7 Tagen davor" : `${vorzeichen(neu - davor)} gegenüber den 7 Tagen davor`})`,
        ),
        grafik: saeulen({
          titel: "Neue Anmeldungen je 7 Tage",
          einheit: "Anmeldungen",
          punkte: an.verlauf.map((w, i) => ({ name: namen[i], wert: w })),
        }),
        tabelle: wertetabelle({
          beschriftung: "Neue Anmeldungen je 7 Tage",
          spalten: ["Zeitraum", "Anmeldungen"],
          zeilen: an.verlauf.map((w, i) => [namen[i], fmt(w)]),
        }),
      }),
    );
    const be = k.bestellungen.verlauf;
    kacheln.push(
      kennzahl({
        titel: "Bestellungen im Lädeli",
        wertKnoten: wert(fmt(be[n - 1]), "in den letzten 7 Tagen"),
        vergleich: delta(
          be[n - 1] === be[n - 2]
            ? "Gleich viele wie in den 7 Tagen davor"
            : `${vorzeichen(be[n - 1] - be[n - 2])} gegenüber den 7 Tagen davor`,
        ),
        grafik: saeulen({
          titel: "Neue Bestellungen je 7 Tage",
          einheit: "Bestellungen",
          punkte: be.map((w, i) => ({ name: namen[i], wert: w })),
        }),
        tabelle: wertetabelle({
          beschriftung: "Neue Bestellungen je 7 Tage, ohne stornierte",
          spalten: ["Zeitraum", "Bestellungen"],
          zeilen: be.map((w, i) => [namen[i], fmt(w)]),
        }),
      }),
    );
  } else if (daten.fehlt.includes("kennzahlen")) {
    kacheln.push(fehlerKachel("Kennzahlen", nochmals));
  }
  if (b) {
    const stunden = b.stunden;
    const summe = stunden.reduce((s, x) => s + x.anzahl, 0);
    const f4 = stunden.reduce((s, x) => s + x.fehler4xx, 0);
    const f5 = stunden.reduce((s, x) => s + x.fehler5xx, 0);
    const start = new Date(b.seit);
    const teilweise = Date.now() - start.getTime() < 24 * 3_600_000;
    const name = (x) => `Ab ${fUhr.format(new Date(x.ab))} Uhr`;
    kacheln.push(
      kennzahl({
        titel: "Anfragen an die API",
        wertKnoten: wert(fmt(summe), "in 24 Stunden"),
        vergleich: el(
          "div",
          { class: "ub-delta" },
          el(
            "p",
            {},
            f5 > 0
              ? `${fmt(f5)} Serverfehler (5xx), ${fmt(f4)} abgelehnte (4xx)`
              : `Keine Serverfehler (5xx), ${fmt(f4)} abgelehnte (4xx)`,
          ),
          b.p95Ms !== null &&
            el("p", {}, `Antwortzeit: 95 % unter ${fmt(b.p95Ms)} ms`),
          teilweise &&
            el(
              "p",
              { class: "leise" },
              `Gezählt seit dem Start um ${fUhr.format(start)} Uhr`,
            ),
        ),
        grafik: [
          saeulen({
            titel: "Anfragen je Stunde",
            einheit: "Anfragen",
            fehlerName: "mit Fehler",
            punkte: stunden.map((x) => ({
              name: name(x),
              wert: x.anzahl,
              fehler: x.fehler4xx + x.fehler5xx,
            })),
          }),
          el(
            "p",
            { class: "ub-legende klein leise" },
            el("span", {
              class: "ub-schluessel ub-schluessel--ok",
              "aria-hidden": "true",
            }),
            "Anfragen ",
            el("span", {
              class: "ub-schluessel ub-schluessel--fehler",
              "aria-hidden": "true",
            }),
            "davon mit Fehler",
          ),
        ],
        tabelle: wertetabelle({
          beschriftung: "Anfragen je Stunde, die letzten 24 Stunden",
          spalten: ["Stunde", "Anfragen", "mit Fehler"],
          zeilen: stunden.map((x) => [
            name(x),
            fmt(x.anzahl),
            fmt(x.fehler4xx + x.fehler5xx),
          ]),
        }),
      }),
    );
  }
  if (kacheln.length === 0) return null;
  const schalter = el(
    "button",
    {
      type: "button",
      class: "knopf knopf--klein knopf--still ub-schalter",
      "aria-pressed": String(tabellen),
      onclick: (e) => {
        const an = e.currentTarget.getAttribute("aria-pressed") !== "true";
        e.currentTarget.setAttribute("aria-pressed", String(an));
        beiTabellen(an);
      },
    },
    "Tabellen statt Diagramme",
  );
  return el(
    "section",
    { class: "ub-abschnitt", "aria-labelledby": id },
    el(
      "div",
      { class: "ub-abschnitt-kopf" },
      el("h2", { id }, "Kennzahlen"),
      schalter,
    ),
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
    .slice(0, 8);
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

// Termine je Woche: eigene Kachel neben der Liste
export function termineProWoche(daten) {
  const k = daten.kommend;
  const wochen = k?.termineProWoche;
  if (!wochen) return null;
  const namen = wochen.map((_, i) =>
    i === 0 ? "Diese Woche" : i === 1 ? "Nächste Woche" : `In ${i} Wochen`,
  );
  const summe = wochen.reduce((s, w) => s + w, 0);
  // Ohne Termine sagt die Liste daneben schon alles
  if (summe === 0) return null;
  return kachel({
    titel: "Termine je Woche",
    inhalt: [
      wert(fmt(summe), `in den nächsten ${k.wochen} Wochen`),
      el(
        "div",
        { class: "ub-diagramm" },
        saeulen({
          titel: "Termine je Woche",
          einheit: "Termine",
          weit: true,
          punkte: wochen.map((w, i) => ({ name: namen[i], wert: w })),
        }),
      ),
      wertetabelle({
        beschriftung: "Termine je Woche ab heute",
        spalten: ["Woche", "Termine"],
        zeilen: wochen.map((w, i) => [namen[i], fmt(w)]),
      }),
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

const zeile = (name, knoten) =>
  el("div", {}, el("dt", {}, name), el("dd", {}, knoten));
const chips = (...c) => el("ul", { class: "chips" }, c.filter(Boolean));

function mb(bytes) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function zustand(daten, ctx, { nochmals }) {
  const z = daten.zustand ?? {};
  const kacheln = [];
  if (z.website) {
    const w = z.website;
    kacheln.push(
      kachel({
        titel: "Website",
        aktion: verweisZeile(ziel(ctx, ["website", "seiten"]), "Seiten"),
        inhalt: [
          chips(
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
            !w.sperre && !w.wartung
              ? chip("Keine Wartung, keine Sperre", "ok")
              : null,
          ),
          el(
            "dl",
            { class: "werte" },
            zeile(
              "Zuletzt erzeugt",
              w.zuletztErzeugtAm
                ? el(
                    "span",
                    {},
                    vor(w.zuletztErzeugtAm),
                    el(
                      "span",
                      { class: "ub-nebenwert klein leise" },
                      fDatumZeit.format(new Date(w.zuletztErzeugtAm)),
                    ),
                  )
                : "Noch nie",
            ),
            zeile(
              "Seiten",
              `${fmt(w.veroeffentlicht)} von ${fmt(w.seiten)} veröffentlicht`,
            ),
          ),
        ],
      }),
    );
  } else if (daten.fehlt.includes("website")) {
    kacheln.push(fehlerKachel("Website", nochmals));
  }
  if (z.kalender) {
    const c = z.kalender;
    const alt =
      c.letzterErfolgAm &&
      Date.now() - new Date(c.letzterErfolgAm).getTime() > 30 * 60_000;
    kacheln.push(
      kachel({
        titel: "Kalender-Abgleich",
        aktion: verweisZeile(ziel(ctx, ["termine", "outlook"]), "Outlook"),
        inhalt: [
          chips(
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
          el(
            "dl",
            { class: "werte" },
            c.eingerichtet &&
              zeile(
                "Letzter Erfolg",
                c.letzterErfolgAm
                  ? el(
                      "span",
                      {},
                      vor(c.letzterErfolgAm),
                      el(
                        "span",
                        { class: "ub-nebenwert klein leise" },
                        fDatumZeit.format(new Date(c.letzterErfolgAm)),
                      ),
                    )
                  : "Noch keiner",
              ),
            c.fehler && zeile("Meldung", c.fehler),
            zeile("Termine im Bestand", fmt(c.programme)),
          ),
        ],
      }),
    );
  }
  if (z.medien) {
    const m = z.medien;
    kacheln.push(
      kachel({
        titel: "Medien",
        aktion: verweisZeile(ziel(ctx, ["website", "medien"]), "Medien"),
        inhalt: el(
          "dl",
          { class: "werte" },
          zeile("Dateien", fmt(m.anzahl)),
          zeile("Speicher", mb(m.bytes)),
          zeile("Bilder und PDF", `${fmt(m.bilder)} und ${fmt(m.pdf)}`),
        ),
      }),
    );
  } else if (daten.fehlt.includes("medien")) {
    kacheln.push(fehlerKachel("Medien", nochmals));
  }
  if (z.datenbank) {
    const d = z.datenbank;
    kacheln.push(
      kachel({
        titel: "Datenbank",
        aktion: verweisZeile(ziel(ctx, ["system", "system"]), "System"),
        inhalt: [
          chips(
            d.erreichbar
              ? chip("Erreichbar", "ok")
              : chip("Nicht erreichbar", "fehler"),
          ),
          d.antwortMs !== null &&
            el(
              "dl",
              { class: "werte" },
              zeile("Antwortzeit", `${fmt(d.antwortMs)} ms`),
            ),
        ],
      }),
    );
  }
  if (kacheln.length === 0) return null;
  const id = neueId("h");
  return el(
    "section",
    { class: "ub-abschnitt", "aria-labelledby": id },
    el("h2", { id }, "Zustand"),
    el("div", { class: "ub-raster ub-raster--zustand" }, kacheln),
  );
}

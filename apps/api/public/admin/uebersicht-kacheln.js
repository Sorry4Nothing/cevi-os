// Bausteine der Übersicht (#583, neu gebaut in #620 als Dashboard): Karte, Aufgabenliste, Kennzahlenband und Zustandsstreifen. Jede Funktion baut aus der Antwort von GET /api/v1/admin/uebersicht einen Knoten. Fehlt ein Teil in der Antwort, fehlt der Baustein (kein Recht, siehe docs/rechte.md); steht er in «fehlt», zeigt die Karte für sich «Nochmals versuchen», der Rest bleibt stehen. Das Hauptdiagramm steht in uebersicht-verlauf.js, Kommendes, Aktivität und Teilnahme in uebersicht-kommend.js.
// Vorlagen für Aufbau und Zustände (angesehen und nachgezeichnet, kein Quelltext übernommen): Kokonut UI Pro «agent-inbox» (Aufgaben als kompakte Liste nach dem, was sie von dir brauchen, mit Gruppen und Zahl), «stats-headline» und «stats-feature» (Kennzahlen in einem Band, durch feine Linien geteilt, Zahl gross, Veränderung, kleine Grafik) und «status-footer» (schmaler Streifen mit Zustand als Wort und Symbol).
import { chip, el, icon, knopf, vorZeit } from "./dom.js";
import { BEREICHE, darfSehen } from "./navigation.js";
import { istAbteilungsleitung, istEntwickler } from "./sicht.js";
import {
  deltaMarke,
  fmt,
  pfeil,
  spur,
  zahlAnzeige,
} from "./uebersicht-diagramme.js";

const ZONE = "Europe/Zurich";
const de = (optionen) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: ZONE, ...optionen });
const fDatumZeit = de({
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// «vor 5 Minuten», «gestern», «vor 2 Wochen»: die Einheit wächst mit dem Abstand (dom.js)
export const vor = vorZeit;

// Wohin ein Verweis führt: [Bereich, Unterseite]. Der Eintrag ist nur dann ein Link, wenn die Person die Seite sehen darf
export function ziel(ctx, [bereich, unter]) {
  const b = BEREICHE.find((x) => x.schluessel === bereich);
  const u = b?.unter.find((x) => x.schluessel === unter);
  if (!u) return null;
  const ok = darfSehen(u, {
    abteilungsleitung: istAbteilungsleitung(ctx.ich),
    entwickler: istEntwickler(ctx.ich),
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
export const neueId = (v) => `ud-${v}-${++zaehlerId}`;

export const verweisZeile = (href, text) =>
  href && el("a", { class: "ub-verweis", href }, text, pfeil());

// Eine Karte: Kopfzeile mit Titel (h2) und optionalem Verweis, darunter der Inhalt. Das Skelett in uebersicht.js hat dieselbe Form.
export function karte({ titel, untertitel, klasse = "", inhalt, aktion }) {
  const id = neueId("k");
  return el(
    "section",
    { class: `ud-karte ${klasse}`.trim(), "aria-labelledby": id },
    el(
      "div",
      { class: "ud-kopf" },
      el(
        "div",
        { class: "ud-kopf-text" },
        el("h2", { id, class: "ud-titel" }, titel),
        untertitel &&
          el("p", { class: "ud-untertitel leise klein" }, untertitel),
      ),
      aktion,
    ),
    inhalt,
  );
}

// Fehler einer einzelnen Karte: Der Rest der Seite bleibt, «Nochmals versuchen» lädt die Übersicht neu
export function fehlerKarte(titel, nochmals) {
  return karte({
    titel,
    klasse: "ud-karte--fehler",
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

// 1. Jetzt zu tun --------------------------------------------------------------------------
// Eine kompakte Liste in zwei Gruppen (agent-inbox): was von dir einen Entscheid braucht, und was aufzuräumen ist. Jede Zeile ist ein Link, wenn die Person die Zielseite sehen darf. Störungen und Sicherheit tragen ein Symbol und ein Wort, nie nur Farbe.

const AUFGABEN = [
  {
    schluessel: "kalenderFehler",
    gruppe: "dich",
    art: "stoerung",
    titel: ["Kalender-Abgleich", "Kalender-Abgleich"],
    satz: ["ist fehlgeschlagen", "ist fehlgeschlagen"],
    kurz: "Kalender-Abgleich",
    aktion: "Prüfen",
    ziel: ["termine", "outlook"],
  },
  {
    schluessel: "kontenOhneZweitenFaktor",
    gruppe: "dich",
    art: "sicher",
    titel: ["Konto", "Konten"],
    satz: ["hat keinen zweiten Faktor", "haben keinen zweiten Faktor"],
    kurz: "Zweiter Faktor",
    aktion: "Ansehen",
    ziel: ["personen", "personen"],
  },
  {
    schluessel: "terminVorschlaege",
    gruppe: "dich",
    titel: ["Terminvorschlag", "Terminvorschläge"],
    satz: ["wartet auf deinen Entscheid", "warten auf deinen Entscheid"],
    kurz: "Terminvorschläge",
    aktion: "Prüfen",
    ziel: ["termine", "vorschlaege"],
  },
  {
    schluessel: "raumanfragen",
    gruppe: "dich",
    titel: ["Raumanfrage", "Raumanfragen"],
    satz: ["wartet auf deinen Entscheid", "warten auf deinen Entscheid"],
    kurz: "Raumanfragen",
    aktion: "Entscheiden",
    ziel: ["raeume", "anfragen"],
  },
  {
    schluessel: "bestellungenBereit",
    gruppe: "dich",
    titel: ["Bestellung", "Bestellungen"],
    satz: ["liegt bereit zur Übergabe", "liegen bereit zur Übergabe"],
    kurz: "Bestellungen zur Übergabe",
    aktion: "Übergeben",
    ziel: ["laedeli", "bestellungen"],
  },
  {
    schluessel: "bestellungenOffen",
    gruppe: "dich",
    titel: ["Bestellung", "Bestellungen"],
    satz: ["ist neu und noch offen", "sind neu und noch offen"],
    kurz: "Neue Bestellungen",
    aktion: "Bearbeiten",
    ziel: ["laedeli", "bestellungen"],
  },
  {
    schluessel: "websiteAenderungen",
    gruppe: "raeumen",
    titel: ["Seite", "Seiten"],
    satz: [
      "hat Änderungen, die nicht veröffentlicht sind",
      "haben Änderungen, die nicht veröffentlicht sind",
    ],
    kurz: "Unveröffentlichte Änderungen",
    aktion: "Prüfen",
    ziel: ["website", "seiten"],
  },
  {
    schluessel: "websiteEntwuerfe",
    gruppe: "raeumen",
    titel: ["Seite", "Seiten"],
    satz: ["ist noch ein Entwurf", "sind noch Entwürfe"],
    kurz: "Entwürfe",
    aktion: "Ansehen",
    ziel: ["website", "seiten"],
  },
  {
    schluessel: "termineOhneKategorie",
    gruppe: "raeumen",
    titel: ["Termin", "Termine"],
    satz: [
      "hat keine Kategorie, niemand sieht ihn",
      "haben keine Kategorie, niemand sieht sie",
    ],
    kurz: "Termine ohne Kategorie",
    aktion: "Zuordnen",
    ziel: ["termine", "warnliste"],
  },
  {
    schluessel: "anmeldefristen",
    gruppe: "raeumen",
    titel: ["Anmeldefrist", "Anmeldefristen"],
    satz: ["endet in 7 Tagen", "enden in 7 Tagen"],
    kurz: "Anmeldefristen",
    aktion: "Ansehen",
    ziel: ["anlaesse", "anlaesse"],
  },
];

const GRUPPEN = [
  ["dich", "Braucht dich"],
  ["raeumen", "Aufräumen und im Blick"],
];

const ARTEN = {
  stoerung: ["Störung", "warnung"],
  sicher: ["Sicherheit", "schild"],
};

function aufgabe(def, wert, ctx, i) {
  const n = typeof wert === "boolean" ? (wert ? 1 : 0) : wert;
  const href = ziel(ctx, def.ziel);
  const marke = def.art
    ? el(
        "span",
        { class: "ud-marke ud-marke--" + def.art },
        icon(ARTEN[def.art][1]),
        el("span", { class: "nur-leser" }, `${ARTEN[def.art][0]}: `),
      )
    : el("span", { class: "ud-marke" }, fmt(n));
  const inhalt = [
    marke,
    el(
      "span",
      { class: "ud-aufgabe-text" },
      el("span", { class: "ud-aufgabe-titel" }, def.titel[n === 1 ? 0 : 1]),
      el("span", { class: "ud-aufgabe-satz" }, def.satz[n === 1 ? 0 : 1]),
    ),
    href
      ? el("span", { class: "ud-aufgabe-aktion" }, def.aktion, pfeil())
      : null,
  ];
  const zeile = el(
    "li",
    {},
    href
      ? el("a", { class: "ud-aufgabe", href }, inhalt)
      : el("div", { class: "ud-aufgabe ud-aufgabe--still" }, inhalt),
  );
  zeile.style.setProperty("--i", String(i));
  return zeile;
}

export function aufgabenKarte(daten, ctx, nochmals) {
  const a = daten.aufgaben;
  if (!a) {
    return daten.fehlt.some((f) => ["aufgaben", "website"].includes(f))
      ? fehlerKarte("Jetzt zu tun", nochmals)
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
  let i = 0;
  for (const [schluessel, name] of GRUPPEN) {
    const liste = offen.filter((d) => d.gruppe === schluessel);
    if (liste.length === 0) continue;
    const id = neueId("g");
    teile.push(
      el(
        "div",
        { class: "ud-gruppe", role: "group", "aria-labelledby": id },
        el(
          "p",
          { id, class: "ud-gruppe-name" },
          name,
          el("span", { class: "ud-gruppe-zahl" }, String(liste.length)),
        ),
        el(
          "ul",
          { class: "ud-aufgaben" },
          liste.map((d) => aufgabe(d, a[d.schluessel], ctx, i++)),
        ),
      ),
    );
  }
  if (offen.length === 0) {
    teile.push(
      el(
        "div",
        { class: "ub-leer", role: "status" },
        icon("haken"),
        el("p", { class: "ub-leer-satz" }, "Gerade ist nichts offen."),
      ),
    );
  }
  if (erledigt.length > 0) {
    teile.push(
      el(
        "p",
        { class: "ub-erledigt klein leise" },
        icon("haken"),
        `${offen.length > 0 ? "Nichts offen bei" : "Geprüft"}: ${erledigt.map((d) => d.kurz).join(", ")}.`,
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
  return karte({
    titel: "Jetzt zu tun",
    untertitel:
      offen.length === 0
        ? "Nichts offen"
        : offen.length === 1
          ? "1 Punkt offen"
          : `${offen.length} Punkte offen`,
    klasse: "ud-aufgabenkarte",
    inhalt: teile,
  });
}

// Anzahl offener Punkte für den Satz oben auf der Seite
export function offeneAufgaben(daten) {
  const a = daten.aufgaben;
  if (!a) return 0;
  return AUFGABEN.filter(
    (d) =>
      a[d.schluessel] !== undefined &&
      a[d.schluessel] !== false &&
      a[d.schluessel] !== 0,
  ).length;
}

// 2. Kennzahlenband ------------------------------------------------------------------------
// Ein Band mit einer Zelle je Kennzahl (stats-headline): Bezeichnung, Zahl hochzählend, Veränderung, kleine Grafik. Nur Zahlen, die für die Abteilung etwas sagen und die die Route schon liefert.

const letzte = (reihe, n) => reihe.slice(-n);

function zelle({ name, wert, einheit, vergleich, grafik }) {
  const z = zahlAnzeige(wert);
  const id = neueId("z");
  return el(
    "li",
    { class: "ud-zelle", "aria-labelledby": id },
    el("p", { id, class: "ud-lbl" }, name),
    el(
      "p",
      { class: "ud-gross ud-gross--mittel" },
      z.wurzel,
      el("span", { class: "ud-einheit" }, einheit),
    ),
    el("p", { class: "ud-delta" }, vergleich),
    grafik,
  );
}

export function kennzahlenBand(daten, ctx, nochmals) {
  const k = daten.kennzahlen;
  if (!k) {
    return daten.fehlt.includes("kennzahlen")
      ? fehlerKarte("Kennzahlen", nochmals)
      : null;
  }
  const n = k.fenster;
  const zellen = [];
  const kurzSatz = (titel, werte, einheit) =>
    `${titel}, ${werte.length} Wochen bis heute: ${werte.map((w) => fmt(w)).join(", ")} ${einheit}.`;

  const p = k.personen;
  const pSpur = letzte(p.verlauf, 12);
  zellen.push(
    zelle({
      name: "Konten",
      wert: p.jetzt,
      einheit: "aktiv",
      vergleich: [
        deltaMarke(p.verlauf[n - 1] - p.verlauf[n - 5]),
        el("span", {}, "seit 4 Wochen"),
      ],
      grafik: spur({
        werte: pSpur,
        satz: kurzSatz("Aktive Konten", pSpur, "Konten"),
      }),
    }),
  );

  const stufen = daten.kinderJeStufe;
  if (k.kinder && stufen && stufen.length > 0) {
    zellen.push(
      zelle({
        name: "Kinder",
        wert: k.kinder.jetzt,
        einheit: "in der Abteilung",
        vergleich: [
          el(
            "span",
            {},
            stufen.length === 1
              ? "in einer Stufe"
              : `verteilt auf ${stufen.length} Stufen`,
          ),
        ],
        grafik: spur({
          art: "saeulen",
          werte: stufen.map((s) => s.kinder),
          satz: `Kinder je Stufe: ${stufen.map((s) => `${s.name} ${s.kinder}`).join(", ")}.`,
        }),
      }),
    );
  }

  const an = k.anmeldungen;
  const neu = an.verlauf[n - 1];
  const davor = an.verlauf[n - 2];
  const aSpur = letzte(an.verlauf, 12);
  zellen.push(
    zelle({
      name: "Anmeldungen",
      wert: an.kommend,
      einheit: "bei kommenden Anlässen",
      vergleich: [
        deltaMarke(neu - davor),
        el("span", {}, `${fmt(neu)} neu in 7 Tagen`),
      ],
      grafik: spur({
        art: "saeulen",
        werte: aSpur,
        satz: kurzSatz("Neue Anmeldungen je 7 Tage", aSpur, "Anmeldungen"),
      }),
    }),
  );

  const wochen = daten.kommend?.termineProWoche;
  if (wochen && wochen.some((w) => w > 0)) {
    const summe = wochen.reduce((s, w) => s + w, 0);
    zellen.push(
      zelle({
        name: "Termine",
        wert: summe,
        einheit: `in den nächsten ${daten.kommend.wochen} Wochen`,
        vergleich: [
          el(
            "span",
            {},
            `Diese Woche ${fmt(wochen[0])}, nächste ${fmt(wochen[1] ?? 0)}`,
          ),
        ],
        grafik: spur({
          art: "saeulen",
          werte: wochen,
          satz: `Termine je Woche, ab dieser Woche: ${wochen.map((w) => fmt(w)).join(", ")}.`,
        }),
      }),
    );
  }

  const be = k.bestellungen.verlauf;
  if (be.some((w) => w > 0)) {
    const bSpur = letzte(be, 12);
    zellen.push(
      zelle({
        name: "Bestellungen",
        wert: be[n - 1],
        einheit: "in 7 Tagen",
        vergleich: [
          deltaMarke(be[n - 1] - be[n - 2]),
          el("span", {}, "gegenüber davor"),
        ],
        grafik: spur({
          art: "saeulen",
          werte: bSpur,
          satz: kurzSatz("Neue Bestellungen je 7 Tage", bSpur, "Bestellungen"),
        }),
      }),
    );
  }
  const id = neueId("h");
  zellen.forEach((z, i) => z.style.setProperty("--i", String(i)));
  const liste = el("ul", { class: "ud-band-liste" }, zellen);
  liste.style.setProperty("--n", String(zellen.length));
  return el(
    "section",
    { class: "ud-karte ud-band", "aria-labelledby": id },
    el("h2", { id, class: "nur-leser" }, "Kennzahlen"),
    liste,
  );
}

// 3. Zustand -------------------------------------------------------------------------------
// Ein schmaler Streifen am Ende (status-footer): nur, was die Abteilung wissen muss. Läuft die Website (Wartung, Sperre), läuft der Kalender-Abgleich. Dateien, Speicher und Antwortzeiten der Datenbank stehen im System.

const chips = (...c) => el("ul", { class: "chips" }, c.filter(Boolean));

function punkt({ titel, zustandChips, satz, href, verweis, extra }) {
  const id = neueId("p");
  return el(
    "li",
    { class: "ud-streifen-punkt", "aria-labelledby": id },
    el("h3", { id, class: "ud-streifen-name" }, titel),
    zustandChips,
    el("p", { class: "ud-streifen-satz leise klein" }, satz),
    extra,
    href && verweisZeile(href, verweis),
  );
}

export function zustandStreifen(daten, ctx, nochmals) {
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
    { class: "ud-karte ud-streifen", "aria-labelledby": id },
    el("h2", { id, class: "ud-streifen-titel" }, "Zustand"),
    el("ul", { class: "ud-streifen-liste" }, punkte),
  );
}

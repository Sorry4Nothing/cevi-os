import { anfrage, fehlertext } from "./api.js";
import { chip, el, filterGruppe, icon, knopf, seitenwahl } from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import {
  datumsZelle,
  gruppenChips,
  heuteZuerich,
  keineTreffer,
  plusTage,
  sortKopf,
  zaehlwort,
  ersetze,
  termineTabelle,
} from "./kalenderhilfen.js";
import { skeletonFlaeche } from "./lader.js";
import {
  adresseVon,
  ansichtAusPfad,
  filtere,
  monatsAnsicht,
} from "./termine-monat.js";
import { ersetzeAdresse, schiebeAdresse } from "./verlauf.js";
import { leerKarte } from "./zustaende.js";

// Unterseite «Kalender» (A8, #590): Alle kommenden Termine der Abteilung, auch die ohne Gruppe. Standard ist die Monatsansicht (Raster mit Terminchips und Tagesliste, termine-monat.js); die Tabelle bleibt als Ansicht «Liste». Nur lesen: Die Termine kommen aus Outlook.
// Adressen: #termine/kalender (dieser Monat) · …/2027-01 (Monat) · …/2027-01-16 (Monat, Tag gewählt) · …/liste (Tabelle, 3 Monate) · …/liste/12 (12 Monate; die alte Adresse …/12 gilt weiter)
// Abfragen: 1 Abruf der Gruppen für den Filter; Monat: je Monat 1 Abfrage (bis 100 Termine, 2 Minuten im Speicher); Liste: je Seite von 100 Terminen 1 Abfrage beim Öffnen und je «Weitere laden». Suche, Filter, Sortierung und Blättern laufen im Browser. Kein Polling.

const BASIS = "/api/v1/termine/alle";
const ZEITRAEUME = [
  { schluessel: "3", tage: 92, text: "3 Monate" },
  { schluessel: "12", tage: 366, text: "12 Monate" },
];

const holeSeite = (von, bis, nach) =>
  anfrage(
    "GET",
    `${BASIS}?von=${von}&bis=${bis}&limit=100${nach ? `&nach=${encodeURIComponent(nach)}` : ""}`,
  );

// Gruppen für die Filterleiste; ohne Recht oder bei einem Fehler bleibt der Filter «Alle» und «Ohne Gruppe»
const ladeGruppen = () =>
  anfrage("GET", "/api/v1/admin/tags").then(
    (a) => a.tags,
    () => [],
  );

export function zeige(bereich, ctx) {
  const heute = heuteZuerich();
  const ansicht = ansichtAusPfad(ctx.pfad, heute);
  ctx.lade(
    ladeGruppen,
    (gruppen) => zeichne(bereich, ansicht, gruppen, heute),
    {
      skeleton: () => skeletonFlaeche({ zeilen: 6 }),
      fehlerTitel: "Der Kalender konnte nicht geladen werden.",
    },
  );
}

function ansichtswahl(ansicht) {
  return filterGruppe({
    beschriftung: "Ansicht",
    eintraege: [
      { text: "Monat", wert: "monat" },
      { text: "Liste", wert: "liste" },
    ],
    wert: ansicht.art,
    beiAenderung: (wert) => {
      window.location.hash =
        wert === "liste" ? "#termine/kalender/liste" : "#termine/kalender";
    },
  });
}

const gruppenFilter = (gruppen) => ({
  schluessel: "gruppe",
  label: "Gruppe",
  optionen: [
    ["", "Alle Gruppen"],
    ["keine", "Ohne Gruppe"],
    ...gruppen.map((g) => [g.id, g.name]),
  ],
});

function zeichne(bereich, ansicht, gruppen, heute) {
  bereich.append(
    ansicht.art === "monat"
      ? monatsSeite(ansicht, gruppen, heute)
      : listenSeite(bereich, ansicht, gruppen),
    el(
      "p",
      { class: "klein leise tm-quelle" },
      icon("kalender"),
      "Die Termine kommen aus Outlook. Änderungen machst du dort.",
    ),
  );
}

/* ---------- Monat ---------- */

function monatsSeite(ansicht, gruppen, heute) {
  const zustand = {
    monat: ansicht.monat,
    tag: ansicht.tag,
    suche: "",
    gruppe: "",
  };
  const leiste = filterleiste({
    suche: { label: "Titel oder Ort suchen" },
    filter: [gruppenFilter(gruppen)],
    namen: { einzahl: "Termin", mehrzahl: "Termine" },
    beiAenderung: ({ suche, filter }) => {
      zustand.suche = suche;
      zustand.gruppe = filter.gruppe;
      monat.filterGeaendert();
    },
  });
  const monat = monatsAnsicht({
    heute,
    zustand,
    holeSeite,
    ansichtswahl: ansichtswahl(ansicht).wurzel,
    werkzeugleiste: leiste.wurzel,
    // Monate bekommen einen Verlaufseintrag (Zurück führt zum Vormonat), die Wahl eines Tages nur die Korrektur der Adresse
    beiAenderung: (z, art) => {
      const hash = adresseVon({ art: "monat", monat: z.monat, tag: z.tag });
      if (art === "monat") schiebeAdresse(`#termine/kalender/${z.monat}`);
      else ersetzeAdresse(hash);
    },
    beiZahlen: (treffer, gesamt) => {
      leiste.setzeTreffer(treffer, gesamt);
    },
  });
  queueMicrotask(() => monat.start());
  return monat.wurzel;
}

/* ---------- Liste (Tabelle) ---------- */

function listenSeite(bereich, ansicht, gruppen) {
  const wahl =
    ZEITRAEUME.find((z) => z.schluessel === ansicht.zeitraum) ?? ZEITRAEUME[0];
  const von = heuteZuerich();
  const bis = plusTage(von, wahl.tage);
  const url = (nach) =>
    `${BASIS}?von=${von}&bis=${bis}&limit=100${nach ? `&nach=${encodeURIComponent(nach)}` : ""}`;
  const wurzel = el("div", { class: "tm-liste" });
  const zeitraumWahl = filterGruppe({
    beschriftung: "Zeitraum",
    eintraege: ZEITRAEUME.map((z) => ({ text: z.text, wert: z.schluessel })),
    wert: wahl.schluessel,
    beiAenderung: (wert) => {
      window.location.hash = `#termine/kalender/liste${wert === "3" ? "" : `/${wert}`}`;
    },
  });
  const kopfzeile = el(
    "div",
    { class: "tm-listenkopf" },
    ansichtswahl(ansicht).wurzel,
    zeitraumWahl.wurzel,
  );
  wurzel.append(kopfzeile);
  const inhalt = el("div", {});
  wurzel.append(inhalt);
  anfrage("GET", url()).then(
    (erste) => {
      if (!wurzel.isConnected) return;
      zeichneListe(inhalt, wahl, erste, url, gruppen);
    },
    (f) => {
      inhalt.append(
        el(
          "div",
          { class: "hinweis hinweis--fehler", role: "alert" },
          el(
            "span",
            {},
            `Die Termine konnten nicht geladen werden. ${fehlertext(f)}`,
          ),
          knopf("Nochmals versuchen", {
            klein: true,
            symbol: "aktualisieren",
            onclick: () => window.location.reload(),
          }),
        ),
      );
    },
  );
  return wurzel;
}

function zeichneListe(bereich, wahl, erste, url, gruppen) {
  const termine = [...erste.termine];
  let weitere = erste.weitere;
  let naechste = erste.naechste;
  let richtung = "ascending";
  let stand = { suche: "", filter: { gruppe: "" } };

  const leiste = filterleiste({
    suche: { label: "Titel oder Ort suchen" },
    filter: [gruppenFilter(gruppen)],
    namen: { einzahl: "Termin", mehrzahl: "Termine" },
    beiAenderung: (neu) => {
      stand = neu;
      seiten.anfang();
      zeichneTabelle();
    },
  });
  const meldung = el("p", { class: "klein tm-meldung", role: "status" });
  const liste = el("div", {});
  const seiten = seitenwahl({ beiWechsel: () => zeichneTabelle() });
  const mehr = knopf("Weitere laden", {
    symbol: "runter",
    onclick: () => ladeWeitere(),
  });

  const sortiert = () => {
    const kopie = filtere(termine, {
      suche: stand.suche,
      gruppe: stand.filter.gruppe,
    });
    // Beginn des Termins; ganztägige zählen ab 00:00 ihres ersten Tages
    const beginn = (t) =>
      t.ganztaegig ? `${t.tagVon}T00:00` : (t.beginn ?? "");
    kopie.sort((a, b) => beginn(a).localeCompare(beginn(b)));
    return richtung === "ascending" ? kopie : kopie.reverse();
  };

  function zeile(t) {
    return el(
      "tr",
      {},
      datumsZelle(t),
      el(
        "td",
        {},
        el("span", { class: "name" }, t.titel),
        t.status !== "aktiv" &&
          el(
            "ul",
            { class: "chips tm-unter" },
            t.status === "abgesagt"
              ? chip("Abgesagt", "fehler")
              : chip("Bitte prüfen", "warn"),
          ),
      ),
      el("td", {}, t.ort ?? el("span", { class: "leise" }, "–")),
      el("td", {}, gruppenChips(t.tags)),
      el(
        "td",
        {},
        el("ul", { class: "chips" }, chip("Outlook", undefined, "kalender")),
      ),
    );
  }

  function zeichneTabelle() {
    const treffer = sortiert();
    leiste.setzeTreffer(treffer.length, termine.length);
    mehr.hidden = !weitere;
    if (termine.length === 0) {
      seiten.wurzel.hidden = true;
      ersetze(
        liste,
        leerKarte(
          `In den nächsten ${wahl.text} stehen keine Termine an. Neue Termine erfasst du in Outlook.`,
        ),
      );
      return;
    }
    if (treffer.length === 0) {
      seiten.wurzel.hidden = true;
      ersetze(
        liste,
        keineTreffer(stand.suche || "diese Filter", () => leiste.setzeAlles()),
      );
      return;
    }
    const [a, b] = seiten.fenster(treffer.length);
    const t = termineTabelle({
      beschriftung: "Kommende Termine",
      spalten: ["Datum", "Titel", "Ort", "Gruppen", "Quelle"],
      zeilen: treffer.slice(a, b).map(zeile),
    });
    // Sortieren geht nur, solange alle Termine geladen sind; sonst stünde «absteigend» für einen Ausschnitt
    const kopf = t.wurzel.querySelector("th");
    if (weitere) kopf.setAttribute("aria-sort", "ascending");
    else {
      sortKopf(kopf, {
        richtung,
        beiWechsel: (r) => {
          richtung = r;
          seiten.anfang();
          zeichneTabelle();
          liste.querySelector(".tm-sortknopf")?.focus();
        },
      });
    }
    ersetze(liste, t.wurzel);
  }

  async function ladeWeitere() {
    mehr.disabled = true;
    mehr.setAttribute("aria-busy", "true");
    meldung.textContent = "Weitere Termine werden geladen …";
    try {
      const seite = await anfrage("GET", url(naechste));
      if (!bereich.isConnected) return;
      termine.push(...seite.termine);
      weitere = seite.weitere;
      naechste = seite.naechste;
      meldung.textContent = `${zaehlwort(seite.termine.length, "weiterer Termin", "weitere Termine")} geladen.`;
      zeichneTabelle();
    } catch (f) {
      meldung.textContent = `${fehlertext(f)} Versuche es nochmals.`;
    } finally {
      mehr.disabled = false;
      mehr.removeAttribute("aria-busy");
    }
  }

  bereich.append(
    leiste.wurzel,
    liste,
    seiten.wurzel,
    meldung,
    el("div", { class: "tm-mehr" }, mehr),
  );
  zeichneTabelle();
}

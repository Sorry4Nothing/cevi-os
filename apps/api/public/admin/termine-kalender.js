import { anfrage, fehlertext } from "./api.js";
import {
  auswahl,
  chip,
  el,
  filterGruppe,
  icon,
  knopf,
  seitenwahl,
} from "./dom.js";
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
import { melde } from "./melden.js";
import {
  adresseVon,
  ansichtAusPfad,
  filtere,
  monatsAnsicht,
} from "./termine-monat.js";
import { ersetzeAdresse, schiebeAdresse } from "./verlauf.js";
import { leerKarte } from "./zustaende.js";

// Unterseite «Kalender» (A8, #590, #608): Alle kommenden Termine der Abteilung, auch die ohne Gruppe. Standard ist die Monatsansicht (Raster mit Terminchips und Tagesliste, termine-monat.js); die Tabelle bleibt als Ansicht «Liste». Oben im Kopf wechselt der Umschalter «Alle Termine / Meine Termine»: Meine sind die Termine der Gruppen der angemeldeten Person. Die Antwort von GET /api/v1/termine/alle trägt dafür je Termin das Feld «meine»; es braucht keine weitere Abfrage. Nur lesen: Die Termine kommen aus Outlook.
// Adressen: #termine/kalender (dieser Monat) · …/2027-01 (Monat) · …/2027-01-16 (Monat, Tag gewählt) · …/liste (Tabelle, 3 Monate) · …/liste/12 (12 Monate; die alte Adresse …/12 gilt weiter). Meine Termine: dieselben Adressen mit «meine» nach «kalender», z. B. #termine/kalender/meine/2027-01.
// Abfragen: 1 Abruf der Gruppen für den Filter (30 Sekunden im Speicher); Monat: je Monat 1 Abfrage (bis 100 Termine, 2 Minuten im Speicher); Liste: je Seite von 100 Terminen 1 Abfrage beim Öffnen und je «Weitere laden». Umschalter, Suche, Filter, Sortierung und Blättern laufen im Browser. Kein Polling.

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

// Gruppen für den Filter; ohne Recht oder bei einem Fehler bleibt der Filter «Alle» und «Ohne Gruppe». 30 Sekunden im Speicher: Der Wechsel zwischen den Ansichten fragt nicht jedes Mal
let gruppenSpeicher = null;
const ladeGruppen = async () => {
  if (gruppenSpeicher && Date.now() - gruppenSpeicher.zeit < 30_000) {
    return gruppenSpeicher.gruppen;
  }
  const gruppen = await anfrage("GET", "/api/v1/admin/tags").then(
    (a) => a.tags,
    () => [],
  );
  gruppenSpeicher = { zeit: Date.now(), gruppen };
  return gruppen;
};

// Adresse mit dem Umschalter: «meine» steht nach «kalender»
export const mitUmfang = (hash, nur) =>
  nur === "meine"
    ? hash.replace("#termine/kalender", "#termine/kalender/meine")
    : hash;

// Standard ist «alle»: Nur die Adresse mit «meine» nach «kalender» zeigt Meine Termine (#622)
export const umfangAusPfad = (pfad) =>
  pfad[0] === "meine"
    ? { nur: "meine", rest: pfad.slice(1) }
    : { nur: "alle", rest: pfad };

export function zeige(bereich, ctx) {
  const heute = heuteZuerich();
  const { nur, rest } = umfangAusPfad(ctx.pfad);
  const meine = nur === "meine";
  const ansicht = ansichtAusPfad(rest, heute);
  // umfang: «alle» oder «meine»; die Ansicht trägt ein, wie sie auf einen Wechsel reagiert (beiWechsel) und welche Adresse sie gerade hat (adresse)
  const umfang = {
    nur: meine ? "meine" : "alle",
    beiWechsel: () => {},
    adresse: () => adresseVon(ansicht),
  };
  ctx.kopfAktion(umfangswahl(umfang).wurzel);
  ctx.lade(
    ladeGruppen,
    (gruppen) => zeichne(bereich, ansicht, gruppen, heute, umfang),
    {
      skeleton: () => skeletonFlaeche({ zeilen: 6 }),
      fehlerTitel: "Der Kalender konnte nicht geladen werden.",
    },
  );
}

// Der Umschalter oben im Kopf: gilt für Monat und Liste. Er filtert im Browser; die Adresse bekommt «meine» (ohne neuen Verlaufseintrag)
function umfangswahl(umfang) {
  return filterGruppe({
    beschriftung: "Welche Termine",
    eintraege: [
      { text: "Alle Termine", wert: "alle" },
      { text: "Meine Termine", wert: "meine" },
    ],
    wert: umfang.nur,
    beiAenderung: (wert) => {
      umfang.nur = wert;
      ersetzeAdresse(mitUmfang(umfang.adresse(), wert));
      umfang.beiWechsel();
    },
  });
}

function ansichtswahl(ansicht, umfang) {
  return filterGruppe({
    beschriftung: "Ansicht",
    eintraege: [
      { text: "Monat", wert: "monat" },
      { text: "Liste", wert: "liste" },
    ],
    wert: ansicht.art,
    beiAenderung: (wert) => {
      window.location.hash = mitUmfang(
        wert === "liste" ? "#termine/kalender/liste" : "#termine/kalender",
        umfang.nur,
      );
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

function zeichne(bereich, ansicht, gruppen, heute, umfang) {
  const quelle = el("p", { class: "klein leise tm-quelle" });
  const schreibeQuelle = () =>
    ersetze(
      quelle,
      icon("kalender"),
      umfang.nur === "meine"
        ? "Meine Termine sind die Termine deiner Gruppen. Die Termine kommen aus Outlook, Änderungen machst du dort."
        : "Die Termine kommen aus Outlook. Änderungen machst du dort.",
    );
  schreibeQuelle();
  bereich.append(
    ansicht.art === "monat"
      ? monatsSeite(ansicht, gruppen, heute, umfang, schreibeQuelle)
      : listenSeite(bereich, ansicht, gruppen, umfang, schreibeQuelle),
    quelle,
  );
}

/* ---------- Monat ---------- */

function monatsSeite(ansicht, gruppen, heute, umfang, schreibeQuelle) {
  const zustand = {
    monat: ansicht.monat,
    tag: ansicht.tag,
    suche: "",
    gruppe: "",
    nur: umfang.nur,
  };
  // Im Monat bleibt, was nötig ist: Gruppe und Ansicht in der Zeile des Monats, keine Suche, keine Trefferzahl
  const gruppenwahl =
    gruppen.length > 0
      ? gruppenAuswahl(gruppen, (wert) => {
          zustand.gruppe = wert;
          monat.filterGeaendert();
        })
      : null;
  const monat = monatsAnsicht({
    heute,
    zustand,
    holeSeite,
    ansichtswahl: el(
      "div",
      { class: "tm-ansichtsgruppe" },
      gruppenwahl,
      ansichtswahl(ansicht, umfang).wurzel,
    ),
    // Monate bekommen einen Verlaufseintrag (Zurück führt zum Vormonat), die Wahl eines Tages nur die Korrektur der Adresse
    beiAenderung: (z, art) => {
      const hash = mitUmfang(
        adresseVon({ art: "monat", monat: z.monat, tag: z.tag }),
        umfang.nur,
      );
      if (art === "monat")
        schiebeAdresse(mitUmfang(`#termine/kalender/${z.monat}`, umfang.nur));
      else ersetzeAdresse(hash);
    },
  });
  umfang.adresse = () =>
    adresseVon({ art: "monat", monat: zustand.monat, tag: zustand.tag });
  umfang.beiWechsel = () => {
    zustand.nur = umfang.nur;
    schreibeQuelle();
    monat.filterGeaendert();
  };
  queueMicrotask(() => monat.start());
  return monat.wurzel;
}

// Die Auswahl der Gruppe (Alle Gruppen, Ohne Gruppe, eine Gruppe); die Beschriftung bleibt für Screenreader, sichtbar steht der gewählte Wert
function gruppenAuswahl(gruppen, beiAenderung) {
  const f = gruppenFilter(gruppen);
  const wahl = auswahl({ label: f.label, optionen: f.optionen, wert: "" });
  wahl.wurzel.querySelector("label")?.classList.add("nur-leser");
  wahl.wurzel.classList.add("tm-gruppenwahl");
  wahl.eingabe.addEventListener("change", () =>
    beiAenderung(wahl.eingabe.value),
  );
  return wahl.wurzel;
}

/* ---------- Liste (Tabelle) ---------- */

function listenSeite(bereich, ansicht, gruppen, umfang, schreibeQuelle) {
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
      window.location.hash = mitUmfang(
        `#termine/kalender/liste${wert === "3" ? "" : `/${wert}`}`,
        umfang.nur,
      );
    },
  });
  const kopfzeile = el(
    "div",
    { class: "tm-listenkopf" },
    ansichtswahl(ansicht, umfang).wurzel,
    zeitraumWahl.wurzel,
  );
  wurzel.append(kopfzeile);
  const inhalt = el("div", {});
  wurzel.append(inhalt);
  anfrage("GET", url()).then(
    (erste) => {
      if (!wurzel.isConnected) return;
      zeichneListe(inhalt, wahl, erste, url, gruppen, umfang, schreibeQuelle);
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

function zeichneListe(
  bereich,
  wahl,
  erste,
  url,
  gruppen,
  umfang,
  schreibeQuelle,
) {
  const termine = [...erste.termine];
  let weitere = erste.weitere;
  let naechste = erste.naechste;
  let richtung = "ascending";
  let stand = { suche: "", filter: { gruppe: "" } };
  // Die Adresse der Liste (3 oder 12 Monate) für den Umschalter oben im Kopf
  umfang.adresse = () =>
    `#termine/kalender/liste${wahl.schluessel === "12" ? "/12" : ""}`;
  umfang.beiWechsel = () => {
    schreibeQuelle();
    seiten.anfang();
    zeichneTabelle();
  };

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
      nur: umfang.nur,
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
        umfang.nur === "meine" && !stand.suche && !stand.filter.gruppe
          ? leerKarte(
              `Für deine Gruppen stehen in den nächsten ${wahl.text} keine Termine an.`,
            )
          : keineTreffer(stand.suche || "diese Filter", () =>
              leiste.setzeAlles(),
            ),
      );
      return;
    }
    const [a, b] = seiten.fenster(treffer.length);
    const t = termineTabelle({
      beschriftung: "Kommende Termine",
      spalten: ["Datum", "Titel", "Ort", "Gruppen"],
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
      melde(
        `${zaehlwort(seite.termine.length, "weiterer Termin", "weitere Termine")} geladen.`,
      );
      zeichneTabelle();
    } catch (f) {
      melde(`${fehlertext(f)} Versuche es nochmals.`, "fehler");
    } finally {
      meldung.textContent = "";
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

import { anfrage, fehlertext } from "./api.js";
import { chip, el, knopf, seitenwahl } from "./dom.js";
import {
  datumsZelle,
  gruppenChips,
  heuteZuerich,
  keineTreffer,
  plusTage,
  sortKopf,
  suchfeld,
  trifft,
  zaehlwort,
  ersetze,
  termineTabelle,
} from "./kalenderhilfen.js";
import { skeletonTabelle } from "./lader.js";
import { leerKarte } from "./zustaende.js";

// Unterseite «Kalender» (A8): Alle kommenden Termine der Abteilung, auch die ohne Gruppe, mit ihren Gruppen. Nur lesen: Die Termine kommen aus Outlook.
// Adresse: #termine/kalender (3 Monate) · #termine/kalender/12 (12 Monate)
// Abfragen: eine je Seite von 100 Terminen (GET /api/v1/termine/alle) beim Öffnen und je «Weitere laden»; Suche, Sortierung und Blättern laufen im Browser. Kein Polling.

const BASIS = "/api/v1/termine/alle";
const ZEITRAEUME = [
  { schluessel: "3", tage: 92, text: "Nächste 3 Monate" },
  { schluessel: "12", tage: 366, text: "Nächste 12 Monate" },
];

export function zeige(bereich, ctx) {
  const wahl =
    ZEITRAEUME.find((z) => z.schluessel === ctx.pfad[0]) ?? ZEITRAEUME[0];
  const von = heuteZuerich();
  const bis = plusTage(von, wahl.tage);
  const url = (nach) =>
    `${BASIS}?von=${von}&bis=${bis}&limit=100${nach ? `&nach=${encodeURIComponent(nach)}` : ""}`;
  ctx.lade(
    () => anfrage("GET", url()),
    (erste) => zeichne(bereich, wahl, erste, url),
    {
      skeleton: () => skeletonTabelle({ spalten: 5, avatar: false }),
      fehlerTitel: "Die Termine konnten nicht geladen werden.",
    },
  );
}

function zeichne(bereich, wahl, erste, url) {
  const termine = [...erste.termine];
  let weitere = erste.weitere;
  let naechste = erste.naechste;
  let begriff = "";
  let richtung = "ascending";

  const hinweis = el(
    "div",
    { class: "hinweis", role: "status" },
    "Die Termine kommen aus Outlook. Änderungen machst du dort.",
  );
  const zeitraum = el(
    "select",
    { class: "eingabe tm-zeitraum", id: "tm-zeitraum" },
    ZEITRAEUME.map((z) =>
      el(
        "option",
        { value: z.schluessel, selected: z.schluessel === wahl.schluessel },
        z.text,
      ),
    ),
  );
  zeitraum.addEventListener("change", () => {
    window.location.hash = `#termine/kalender${zeitraum.value === "3" ? "" : `/${zeitraum.value}`}`;
  });
  const suche = suchfeld({
    label: "Titel oder Ort",
    beiAenderung: (wert) => {
      begriff = wert;
      seiten.anfang();
      zeichneListe();
    },
  });
  const werkzeuge = el(
    "div",
    { class: "werkzeuge" },
    suche.wurzel,
    el(
      "div",
      { class: "tm-zeitraumfeld" },
      el("label", { for: "tm-zeitraum" }, "Zeitraum"),
      zeitraum,
    ),
  );
  const zaehler = el("p", { class: "klein leise", role: "status" });
  const meldung = el("p", { class: "klein tm-meldung", role: "status" });
  const liste = el("div", {});
  const seiten = seitenwahl({ beiWechsel: () => zeichneListe() });
  const mehr = knopf("Weitere laden", {
    symbol: "runter",
    onclick: () => ladeWeitere(),
  });

  const sortiert = () => {
    const kopie = termine.filter(
      (t) => !begriff || trifft(t.titel, begriff) || trifft(t.ort, begriff),
    );
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

  function zeichneListe() {
    const treffer = sortiert();
    zaehler.textContent =
      termine.length === 0
        ? ""
        : begriff
          ? zaehlwort(treffer.length, "Treffer", "Treffer")
          : `${weitere ? "Mindestens " : ""}${zaehlwort(termine.length, "Termin", "Termine")}`;
    mehr.hidden = !weitere;
    if (termine.length === 0) {
      seiten.wurzel.hidden = true;
      ersetze(
        liste,
        leerKarte(
          `In den ${wahl.text.replace("Nächste ", "nächsten ")} stehen keine Termine an. Neue Termine erfasst du in Outlook.`,
        ),
      );
      return;
    }
    if (treffer.length === 0) {
      seiten.wurzel.hidden = true;
      ersetze(
        liste,
        keineTreffer(begriff, () => {
          suche.eingabe.value = "";
          begriff = "";
          zeichneListe();
          suche.eingabe.focus();
        }),
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
          zeichneListe();
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
      zeichneListe();
    } catch (f) {
      meldung.textContent = `${fehlertext(f)} Versuche es nochmals.`;
    } finally {
      mehr.disabled = false;
      mehr.removeAttribute("aria-busy");
    }
  }

  bereich.append(
    hinweis,
    werkzeuge,
    zaehler,
    liste,
    seiten.wurzel,
    meldung,
    el("div", { class: "tm-mehr" }, mehr),
  );
  zeichneListe();
}

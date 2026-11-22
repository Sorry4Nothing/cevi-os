import { anfrage, fehlertext } from "./api.js";
import { chip, el, knopf, tabelle } from "./dom.js";

// Reiter «Warnliste» (#433, Epic #430): kommende Termine ohne Tag und Kategorien aus Outlook, die noch keinem Tag entsprechen. Schnittstelle: siehe termine.js.
// Eine Abfrage beim Öffnen und je «Weitere laden»; kein Polling. Die Rechte prüft der Server (nur Abteilungsleitung).

const ZONE = "Europe/Zurich";
const tagFormat = new Intl.DateTimeFormat("de-CH", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: ZONE,
});
const tagUtc = new Intl.DateTimeFormat("de-CH", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});
const uhrFormat = new Intl.DateTimeFormat("de-CH", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ZONE,
});

// Ganztägige Termine haben nur Tage (tagVon bis tagBis), alle anderen Beginn und Ende als Zeitpunkt
function zeitraum(t) {
  if (t.ganztaegig) {
    const von = tagUtc.format(new Date(`${t.tagVon}T12:00:00Z`));
    if (t.tagVon === t.tagBis) return von;
    return `${von} – ${tagUtc.format(new Date(`${t.tagBis}T12:00:00Z`))}`;
  }
  const beginn = new Date(t.beginn);
  const ende = new Date(t.ende);
  const tag = tagFormat.format(beginn);
  const bis =
    tagFormat.format(ende) === tag
      ? uhrFormat.format(ende)
      : `${tagFormat.format(ende)} ${uhrFormat.format(ende)}`;
  return `${tag}, ${uhrFormat.format(beginn)} – ${bis} Uhr`;
}

const termineText = (n) => (n === 1 ? "1 Termin" : `${n} Termine`);

// Der Grund steht als Wort mit Symbol, nie nur als Farbe
const GRUENDE = {
  keine_kategorie: "Keine Kategorie",
  unbekannte_kategorie: "Unbekannte Kategorie",
};

function terminZeile(t) {
  return el(
    "tr",
    {},
    el("th", { scope: "row" }, el("span", { class: "name" }, t.titel)),
    el("td", {}, zeitraum(t)),
    el(
      "td",
      {},
      el("ul", { class: "chips" }, chip(GRUENDE[t.grund] ?? t.grund, "warn")),
    ),
    el(
      "td",
      {},
      t.kategorien.length === 0
        ? el("span", { class: "leise" }, "In Outlook ohne Kategorie")
        : el(
            "ul",
            { class: "chips tm-warnliste-roh" },
            t.kategorien.map((k) => chip(k, undefined, false)),
          ),
    ),
  );
}

export function zeige(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", "/api/v1/admin/termine/warnungen"),
    (daten) => zeichne(bereich, daten),
  );
}

function zeichne(bereich, erste) {
  let geladen = erste.termine.length;
  let weitere = erste.weitere;
  let naechste = erste.naechste;

  const zaehler = el("p", {
    class: "meta tm-warnliste-zaehler",
    role: "status",
  });
  const meldung = el("p", {
    class: "klein tm-warnliste-meldung",
    role: "status",
  });
  const { wurzel: tabellenRahmen, koerper } = tabelle({
    beschriftung: "Termine ohne Tag",
    spalten: ["Termin", "Wann", "Grund", "Kategorien in Outlook"],
    zeilen: erste.termine.map(terminZeile),
  });
  const mehr = knopf("Weitere laden", {
    symbol: "runter",
    onclick: () => ladeWeitere(),
  });
  const leer = el("p", { class: "leer" }, "Alle Termine haben eine Kategorie.");

  function aktualisiere() {
    zaehler.textContent =
      geladen === 0
        ? "Keine Termine ohne Kategorie"
        : `${weitere ? "Mindestens " : ""}${termineText(geladen)} ohne Kategorie`;
    tabellenRahmen.hidden = geladen === 0;
    leer.hidden = geladen !== 0;
    mehr.hidden = !weitere;
  }

  async function ladeWeitere() {
    mehr.disabled = true;
    mehr.setAttribute("aria-busy", "true");
    meldung.textContent = "Weitere Termine werden geladen …";
    try {
      const seite = await anfrage(
        "GET",
        `/api/v1/admin/termine/warnungen?nach=${encodeURIComponent(naechste)}`,
      );
      // Zwischen Anfrage und Antwort kann man den Reiter gewechselt haben
      if (!bereich.isConnected) return;
      koerper.append(...seite.termine.map(terminZeile));
      geladen += seite.termine.length;
      weitere = seite.weitere;
      naechste = seite.naechste;
      meldung.textContent = `${termineText(seite.termine.length)} geladen.`;
      aktualisiere();
      // Der Knopf verschwindet mit der letzten Seite: Der Fokus geht an die Tabelle statt ins Leere
      if (!weitere) tabellenRahmen.focus();
    } catch (f) {
      meldung.textContent = `${fehlertext(f)} Versuche es nochmals.`;
    } finally {
      mehr.disabled = false;
      mehr.removeAttribute("aria-busy");
    }
  }

  const unbekannte = erste.unbekannteKategorien;
  bereich.append(
    el("h2", { class: "tm-warnliste-titel" }, "Warnliste"),
    el(
      "p",
      { class: "leise tm-warnliste-text" },
      "Hier stehen kommende Termine ohne Tag. Sie sind keiner Gruppe zugewiesen: Leitende und Eltern sehen sie nicht in «Mein Kalender». Die Tags kommen aus den Kategorien in Outlook. Abgesagte und interne Termine fehlen.",
    ),
    zaehler,
    el("h3", { class: "tm-warnliste-unter" }, "Termine ohne Tag"),
    leer,
    tabellenRahmen,
    meldung,
    el("div", { class: "tm-warnliste-mehr" }, mehr),
    el("h3", { class: "tm-warnliste-unter" }, "Kategorien ohne Tag"),
    unbekannte.length === 0
      ? el(
          "p",
          { class: "leer leer--klein" },
          "Alle Kategorien der kommenden Termine entsprechen einem Tag.",
        )
      : el(
          "div",
          { class: "tm-warnliste-kategorien" },
          el(
            "p",
            { class: "leise tm-warnliste-text" },
            "Diese Kategorien aus Outlook entsprechen noch keinem Tag, auch bei Terminen, die über eine andere Kategorie sichtbar sind. Ordne sie im Reiter «Kategorien» einem Tag zu; die Zuordnung wirkt nach dem nächsten Abgleich mit Outlook (alle 5 Minuten).",
          ),
          tabelle({
            beschriftung: "Kategorien ohne Tag",
            spalten: ["Kategorie", ["Termine", "rechts"]],
            zeilen: unbekannte.map((k) =>
              el(
                "tr",
                {},
                el(
                  "th",
                  { scope: "row" },
                  el("span", { class: "name" }, k.name),
                ),
                el("td", { class: "rechts" }, String(k.anzahl)),
              ),
            ),
          }).wurzel,
        ),
  );
  aktualisiere();
}

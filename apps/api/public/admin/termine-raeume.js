import { anfrage, fehlertext } from "./api.js";
import {
  ankreuzen,
  auswahl,
  chip,
  el,
  feld,
  knopf,
  seitenblatt,
} from "./dom.js";
import { zahlfeld } from "./datumsfeld.js";
import { mitRueckgaengig } from "./rueckgaengig.js";
import {
  entferneFeldFehler,
  feldFehler,
  keineTreffer,
  pruefHinweis,
  sortKopf,
  suchfeld,
  trifft,
  zaehlwort,
  ersetze,
  termineTabelle,
} from "./kalenderhilfen.js";
import { leerKarte } from "./zustaende.js";

// Unterseite «Räume» (A14, A15, #446, #447): Die Abteilungsleitung legt Räume an, ändert, deaktiviert und löscht sie. Über Anfragen entscheidet die Unterseite «Anfragen».
// Datenbanklast: eine Abfrage beim Öffnen und je «Weitere laden» (50 Räume), die Gruppen (eine Abfrage) erst, wenn ein Blatt sie braucht. Suche und Sortierung laufen im Browser. Kein Polling.
// Lücken gegenüber dem Design: Die Spalte «Anfragen offen» fehlt (die API zählt offene Anfragen nicht je Raum), und das Feld «Ausstattung» heisst im Raum «Ort» (Gebäude, Stockwerk) und «Beschreibung» (Ausstattung und Hinweise).

const BASIS = "/api/v1/admin/raeume";
const SEITE = 50;
const TYPEN = {
  stufe: "Stufe",
  funktion: "Funktion",
  team: "Team",
  lager: "Lager",
};
const TEXTE = {
  PLAETZE_UNGUELTIG: "Gib eine Zahl von 1 bis 1000 ein.",
  TEAM_UNBEKANNT:
    "Dieses Team gibt es nicht mehr. Lade die Seite neu und wähle es nochmals.",
  RAUM_VORHANDEN: "Es gibt schon einen Raum mit diesem Namen.",
  ANFRAGEN_OFFEN:
    "Es gibt noch offene Raumanfragen oder bestätigte Buchungen. Deaktiviere den Raum stattdessen.",
};
const meldungVon = (f) => TEXTE[f?.code] ?? fehlertext(f);

// Die Gruppen für die Auswahl des Teams, höchstens einmal je Besuch der Seite und erst, wenn ein Blatt sie braucht
let tagsMerker = null;
const ladeTags = () => {
  tagsMerker ??= anfrage("GET", "/api/v1/admin/tags").then((a) => a.tags);
  tagsMerker.catch(() => (tagsMerker = null));
  return tagsMerker;
};

// Offene Anfragen je Raum: eine Abfrage (bis 50 Anfragen); ohne Recht oder bei einem Fehler fehlt die Spalte. Die API zählt nicht je Raum, darum zählt der Browser; gibt es mehr als 50, steht «mindestens».
const ladeOffene = () =>
  anfrage("GET", "/api/v1/raeume/anfragen/offen?limit=50").then(
    (a) => ({ je: zaehleJeRaum(a.anfragen), mindestens: a.weitere }),
    () => null,
  );
export const zaehleJeRaum = (anfragen) => {
  const je = new Map();
  for (const a of anfragen) je.set(a.raumId, (je.get(a.raumId) ?? 0) + 1);
  return je;
};

export function zeige(bereich, ctx) {
  tagsMerker = null;
  const lade = () =>
    ctx.lade(
      async () => {
        const [liste, offene] = await Promise.all([
          anfrage("GET", `${BASIS}?limit=${SEITE}`),
          ladeOffene(),
        ]);
        return { ...liste, offene };
      },
      (erste) => zeichne(bereich, ctx, erste, lade),
      { fehlerTitel: "Die Räume konnten nicht geladen werden." },
    );
  // Die Hauptaktion steht auch bei einem Ladefehler im Kopf
  ctx.kopfAktion(
    knopf("Neuer Raum", {
      art: "haupt",
      symbol: "plus",
      onclick: () => blatt({ ctx, neu: lade }),
    }),
  );
  return lade();
}

function zeichne(bereich, ctx, erste, neu) {
  const raeume = [...erste.raeume];
  let weitere = erste.weitere;
  let naechste = erste.naechste;
  let begriff = "";
  let richtung = "ascending";
  const offene = erste.offene;

  const suche = suchfeld({
    label: "Raum suchen",
    beiAenderung: (wert) => {
      begriff = wert;
      zeichneListe();
    },
  });
  const liste = el("div", {});
  const meldung = el("p", { class: "klein tm-meldung", role: "status" });
  const mehr = knopf("Weitere laden", {
    symbol: "runter",
    onclick: () => ladeWeitere(),
  });

  function zeile(r) {
    return el(
      "tr",
      { class: r.aktiv ? undefined : "inaktiv" },
      el(
        "th",
        { scope: "row" },
        el("span", { class: "name" }, r.name),
        r.ort && el("span", { class: "klein leise tm-zeit" }, r.ort),
        !r.aktiv &&
          el("ul", { class: "chips tm-unter" }, chip("Deaktiviert", "warn")),
      ),
      el(
        "td",
        {},
        r.team
          ? el("ul", { class: "chips" }, chip(r.team.name, undefined, "tag"))
          : el("span", { class: "leise" }, "Kein Team"),
      ),
      el(
        "td",
        { class: "tm-ziffern" },
        r.kapazitaet === null ? "–" : String(r.kapazitaet),
      ),
      offene &&
        el(
          "td",
          {},
          (offene.je.get(r.id) ?? 0) > 0
            ? el(
                "a",
                { class: "tm-tabellenlink", href: "#raeume/anfragen" },
                `${offene.mindestens ? "Mindestens " : ""}${zaehlwort(offene.je.get(r.id), "offene Anfrage", "offene Anfragen")}`,
              )
            : el("span", { class: "leise" }, "keine"),
        ),
      el(
        "td",
        { class: "rechts" },
        el(
          "div",
          { class: "aktionen" },
          knopf("Bearbeiten", {
            klein: true,
            symbol: "bearbeiten",
            kontext: r.name,
            onclick: () => blatt({ raum: r, ctx, neu }),
          }),
        ),
      ),
    );
  }

  function zeichneListe() {
    mehr.hidden = !weitere;
    if (raeume.length === 0) {
      suche.wurzel.hidden = true;
      ersetze(
        liste,
        leerKarte(
          "Es gibt noch keine Räume. Erfasse oben den ersten Raum, dann können Leitende ihn anfragen.",
        ),
      );
      return;
    }
    suche.wurzel.hidden = false;
    const treffer = raeume
      .filter(
        (r) => !begriff || trifft(r.name, begriff) || trifft(r.ort, begriff),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "de-CH"));
    if (richtung === "descending") treffer.reverse();
    if (treffer.length === 0) {
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
    const t = termineTabelle({
      beschriftung: "Räume",
      spalten: [
        "Name",
        "Zuständiges Team",
        "Plätze",
        ...(offene ? ["Anfragen"] : []),
        "Aktionen",
      ],
      zeilen: treffer.map(zeile),
    });
    const kopf = t.wurzel.querySelector("th");
    if (weitere) kopf.setAttribute("aria-sort", "ascending");
    else {
      sortKopf(kopf, {
        richtung,
        beiWechsel: (r) => {
          richtung = r;
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
    meldung.textContent = "Weitere Räume werden geladen …";
    try {
      const seite = await anfrage(
        "GET",
        `${BASIS}?limit=${SEITE}&nach=${encodeURIComponent(naechste)}`,
      );
      if (!bereich.isConnected) return;
      raeume.push(...seite.raeume);
      weitere = seite.weitere;
      naechste = seite.naechste;
      meldung.textContent = `${zaehlwort(seite.raeume.length, "weiterer Raum", "weitere Räume")} geladen.`;
      zeichneListe();
    } catch (f) {
      meldung.textContent = `${fehlertext(f)} Versuche es nochmals.`;
    } finally {
      mehr.disabled = false;
      mehr.removeAttribute("aria-busy");
    }
  }

  bereich.append(
    el("div", { class: "werkzeuge" }, suche.wurzel),
    liste,
    meldung,
    el("div", { class: "tm-mehr" }, mehr),
  );
  zeichneListe();
}

// Blatt «Raum bearbeiten» (A15) und «Neuer Raum»: Name, Beschreibung, Ort, Team, Plätze, Aktiv
async function blatt({ raum, ctx, neu }) {
  let tags;
  try {
    tags = await ladeTags();
  } catch (f) {
    ctx.melde(meldungVon(f), "fehler");
    return;
  }
  const name = feld({
    label: "Name",
    hilfe: "Höchstens 100 Zeichen. Jeder Name gilt nur einmal.",
    wert: raum?.name ?? "",
    maxlength: 100,
  });
  const beschreibung = feld({
    label: "Beschreibung (optional)",
    hilfe: "Ausstattung und Hinweise, höchstens 1000 Zeichen.",
    wert: raum?.beschreibung ?? "",
    maxlength: 1000,
    mehrzeilig: true,
    rows: 3,
  });
  const ort = feld({
    label: "Ort (optional)",
    hilfe: "Zum Beispiel das Gebäude und das Stockwerk, höchstens 200 Zeichen.",
    wert: raum?.ort ?? "",
    maxlength: 200,
  });
  const team = auswahl({
    label: "Zuständiges Team",
    optionen: [
      ["", "Kein Team"],
      ...tags.map((t) => [t.id, `${t.name} (${TYPEN[t.typ] ?? t.typ})`]),
    ],
    wert: raum?.team?.id ?? "",
  });
  const plaetze = zahlfeld({
    label: "Plätze (optional)",
    hilfe: "Wie viele Personen Platz haben, von 1 bis 1000.",
    wert: raum?.kapazitaet === null ? "" : String(raum?.kapazitaet ?? ""),
    min: 1,
    max: 1000,
  });
  const aktiv = ankreuzen({
    label: "Aktiv: Mitglieder sehen den Raum",
    gewaehlt: raum?.aktiv ?? true,
    wert: "aktiv",
  });
  const meldungsfeld = el("div", {});
  const formular = el(
    "form",
    { class: "formular", novalidate: true },
    meldungsfeld,
    name.wurzel,
    beschreibung.wurzel,
    ort.wurzel,
    team.wurzel,
    plaetze.wurzel,
    aktiv.wurzel,
  );
  const speichern = knopf("Speichern", { art: "haupt", type: "submit" });
  speichern.setAttribute("form", "tm-raum-formular");
  formular.id = "tm-raum-formular";
  const abbrechen = knopf("Abbrechen", {
    onclick: () => dialog.versuchSchliessen(),
  });
  // Löschen steht links, abgesetzt von Abbrechen und Speichern
  const loeschenKnopf =
    raum &&
    knopf("Raum löschen", {
      art: "gefahr",
      symbol: "papierkorb",
      onclick: () =>
        // Das Blatt schliesst sofort; bei «Rückgängig» oder Fehler öffnet es wieder. Willst du den Raum nur ausblenden, deaktiviere ihn stattdessen
        mitRueckgaengig({
          text: `Raum «${raum.name}» gelöscht`,
          ansicht: {
            weg: () => dialog.close(),
            zurueck: () => blatt({ raum, ctx, neu }),
          },
          ausfuehren: () => anfrage("DELETE", `${BASIS}/${raum.id}`),
          fehlertext: meldungVon,
          danach: neu,
        }),
    });
  loeschenKnopf?.classList.add("tm-fuss-links");
  const felder = [name, beschreibung, ort, plaetze];
  const dialog = seitenblatt({
    titel: raum ? "Raum bearbeiten" : "Neuer Raum",
    untertitel: raum?.name,
    inhalt: formular,
    fusszeile: [loeschenKnopf, abbrechen, speichern],
  });

  const sperre = (an) => {
    for (const f of felder) f.eingabe.readOnly = an;
    speichern.disabled = abbrechen.disabled = an;
    if (loeschenKnopf) loeschenKnopf.disabled = an;
    if (an) speichern.setAttribute("aria-busy", "true");
    else speichern.removeAttribute("aria-busy");
  };

  formular.addEventListener("submit", async (e) => {
    e.preventDefault();
    entferneFeldFehler(formular);
    ersetze(meldungsfeld);
    const fehler = [];
    const wert = name.eingabe.value.trim();
    if (!wert) {
      feldFehler(name, "Gib dem Raum einen Namen.");
      fehler.push({ name: "Name", eingabe: name.eingabe });
    }
    const roh = plaetze.eingabe.value.trim();
    const n = Number(roh);
    if (roh !== "" && !(Number.isInteger(n) && n >= 1 && n <= 1000)) {
      feldFehler(plaetze, TEXTE.PLAETZE_UNGUELTIG);
      fehler.push({ name: "Plätze", eingabe: plaetze.eingabe });
    }
    if (fehler.length > 0) {
      const hinweis = pruefHinweis(fehler);
      ersetze(meldungsfeld, hinweis);
      hinweis.focus();
      return;
    }
    const leer = (f) => f.eingabe.value.trim() || null;
    const koerper = {
      name: wert,
      ort: leer(ort),
      beschreibung: leer(beschreibung),
      kapazitaet: roh === "" ? null : n,
      teamId: team.eingabe.value || null,
      aktiv: aktiv.eingabe.checked,
    };
    sperre(true);
    try {
      await (raum
        ? anfrage("PATCH", `${BASIS}/${raum.id}`, koerper)
        : anfrage("POST", BASIS, koerper));
    } catch (f) {
      sperre(false);
      const hinweis = el(
        "div",
        { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
        `Nicht gespeichert. ${meldungVon(f)} Deine Eingaben sind noch da, speichere nochmals.`,
      );
      ersetze(meldungsfeld, hinweis);
      hinweis.focus();
      return;
    }
    dialog.close();
    ctx.melde(`Raum «${wert}» gespeichert.`);
    await neu();
    document.querySelector("h1")?.focus();
  });
}

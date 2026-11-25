import { anfrage, fehlertext } from "./api.js";
import { aktionenZelle, chip, el, knopf, neueId } from "./dom.js";
import {
  datumsZelle,
  sortKopf,
  zaehlwort,
  ersetze,
  termineTabelle,
} from "./kalenderhilfen.js";
import { darfTags, tagsAendern, tagsKnopf } from "./termine-tags.js";
import { leerKarte } from "./zustaende.js";

// Unterseite «Ohne Kategorie» (A11, #433, Epic #430): kommende Termine ohne Gruppe und Kategorien aus Outlook, die noch keiner Gruppe entsprechen. Die Zuordnung der Kategorien steht in «Kategorien».
// Mit dem Recht «Kalender-Kategorien zuordnen» setzt «Tags ändern» die Tags eines Termins, und die Sammelaktion («Tags setzen») versieht mehrere ausgewählte Termine auf einmal mit denselben Tags (#835, termine-tags.js); die Zeile verschwindet, sobald der Termin einen Tag hat.
// Datenbanklast: eine Abfrage beim Öffnen und je «Weitere laden»; die Zahl für die Unterleiste kommt aus derselben Abfrage. Kein Polling. Die Rechte prüft der Server (nur Abteilungsleitung).
// Lücke gegenüber dem Design: «In Outlook öffnen» fehlt, denn die API liefert keine Adresse des Termins in Outlook.

const termineText = (n) => zaehlwort(n, "Termin", "Termine");

// Der Grund steht als Wort mit Symbol, nie nur als Farbe
const GRUENDE = {
  keine_kategorie: "Keine Kategorie",
  unbekannte_kategorie: "Unbekannte Kategorie",
};

// gewaehlt: Auswahlfeld der Sammelaktion (null ohne Recht); knopfZelle: Knopf «Tags ändern» oder null
function terminZeile(t, gewaehlt, knopfZelle) {
  const name = el("span", { class: "name" }, t.titel);
  return el(
    "tr",
    {},
    datumsZelle(t),
    el(
      "th",
      { scope: "row" },
      gewaehlt ? el("label", { class: "tm-wahlzeile" }, gewaehlt, name) : name,
    ),
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
            { class: "chips tm-roh" },
            t.kategorien.map((k) => chip(k, undefined, false)),
          ),
    ),
    knopfZelle && aktionenZelle(knopfZelle),
  );
}

export function zeige(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", "/api/v1/admin/termine/warnungen"),
    (daten) => zeichne(bereich, ctx, daten),
    { fehlerTitel: "Die Termine ohne Kategorie konnten nicht geladen werden." },
  );
}

function zeichne(bereich, ctx, erste) {
  const termine = [...erste.termine];
  let weitere = erste.weitere;
  let naechste = erste.naechste;
  let richtung = "ascending";
  const mitTags = darfTags(ctx);
  // Gewählt für die Sammelaktion; ersetzt sich nie von selbst, nur durch Klick oder weil der Termin weg ist
  const gewaehlt = new Set();
  // Zeilen, die nach «Tags gesetzt» verschwanden und bei «Rückgängig» oder einem Fehler zurückkommen
  const entfernt = new Map();

  const meldung = el("p", { class: "klein tm-meldung", role: "status" });
  const liste = el("div", {});
  const mehr = knopf("Weitere laden", {
    symbol: "runter",
    onclick: () => ladeWeitere(),
  });

  const beginn = (t) => (t.ganztaegig ? `${t.tagVon}T00:00` : (t.beginn ?? ""));

  // Termine mit neuen Tags gehören nicht mehr auf die Liste; neu = null holt sie zurück (Rückgängig, Fehler)
  function zeigeTags(betroffene, neu) {
    if (neu) {
      for (const t of betroffene) {
        if (neu.length === 0) continue;
        entfernt.set(t.id, t);
        gewaehlt.delete(t.id);
        termine.splice(termine.indexOf(t), 1);
      }
    } else {
      for (const t of betroffene) {
        if (entfernt.delete(t.id)) termine.push(t);
      }
    }
    zeichneListe();
  }

  function waehle(t) {
    const feld = el("input", {
      type: "checkbox",
      class: "tm-wahl",
      "aria-label": `Termin «${t.titel}» auswählen`,
      checked: gewaehlt.has(t.id),
      onchange: () => {
        if (feld.checked) gewaehlt.add(t.id);
        else gewaehlt.delete(t.id);
        leiste.zeige();
      },
    });
    return feld;
  }

  // Aktionsleiste der Sammelaktion: «Alle auswählen», Zahl der gewählten und «Tags setzen»; die Zahl steht in einer Statusregion
  const alle = el("input", {
    type: "checkbox",
    id: neueId("tm-alle"),
    onchange: () => {
      for (const t of termine) {
        if (alle.checked) gewaehlt.add(t.id);
        else gewaehlt.delete(t.id);
      }
      for (const f of liste.querySelectorAll(".tm-wahl")) {
        f.checked = alle.checked;
      }
      leiste.zeige();
    },
  });
  const zahl = el("span", { class: "tm-wahlzahl", role: "status" });
  const setzen = knopf("Tags setzen", {
    art: "haupt",
    symbol: "tag",
    onclick: async () => {
      setzen.disabled = true;
      setzen.setAttribute("aria-busy", "true");
      try {
        await tagsAendern({
          termine: termine.filter((t) => gewaehlt.has(t.id)),
          beiAenderung: zeigeTags,
        });
      } finally {
        setzen.disabled = false;
        setzen.removeAttribute("aria-busy");
      }
    },
  });
  const leiste = {
    wurzel: el(
      "div",
      { class: "tm-aktionsleiste" },
      el(
        "div",
        { class: "wahl" },
        alle,
        el("label", { for: alle.id }, "Alle geladenen Termine auswählen"),
      ),
      zahl,
      setzen,
    ),
    zeige() {
      const n = gewaehlt.size;
      zahl.textContent =
        n === 0 ? "Noch keine Termine ausgewählt" : `${n} ausgewählt`;
      alle.checked = n > 0 && n === termine.length;
      alle.indeterminate = n > 0 && n < termine.length;
      setzen.hidden = n === 0;
    },
  };

  function zeichneListe() {
    if (!weitere) ctx.zaehler("warnliste", termine.length);
    mehr.hidden = !weitere;
    if (termine.length === 0) {
      ersetze(liste, leerKarte("Alle Termine haben eine Kategorie."));
      return;
    }
    const sortiert = [...termine].sort((a, b) =>
      beginn(a).localeCompare(beginn(b)),
    );
    if (richtung === "descending") sortiert.reverse();
    const t = termineTabelle({
      beschriftung: "Termine ohne Gruppe",
      spalten: [
        "Datum",
        "Titel",
        "Grund",
        "Kategorien in Outlook",
        ...(mitTags ? ["Aktionen"] : []),
      ],
      zeilen: sortiert.map((z) =>
        terminZeile(
          z,
          mitTags ? waehle(z) : null,
          tagsKnopf({
            ctx,
            termin: z,
            beiAenderung: zeigeTags,
          }),
        ),
      ),
    });
    // Sortieren geht nur, solange alle Termine geladen sind
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
    ersetze(
      liste,
      el(
        "p",
        { class: "klein leise", role: "status" },
        `${weitere ? "Mindestens " : ""}${termineText(termine.length)} ohne Kategorie`,
      ),
      mitTags && leiste.wurzel,
      t.wurzel,
    );
    leiste.zeige();
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
      // Zwischen Anfrage und Antwort kann man die Seite gewechselt haben
      if (!bereich.isConnected) return;
      termine.push(...seite.termine);
      weitere = seite.weitere;
      naechste = seite.naechste;
      ctx.melde(`${termineText(seite.termine.length)} geladen.`);
      zeichneListe();
    } catch (f) {
      ctx.melde(`${fehlertext(f)} Versuche es nochmals.`, "fehler");
    } finally {
      meldung.textContent = "";
      mehr.disabled = false;
      mehr.removeAttribute("aria-busy");
    }
  }

  const unbekannte = erste.unbekannteKategorien;
  bereich.append(
    el(
      "div",
      { class: "hinweis hinweis--warn", role: "status" },
      "Diese Termine sehen Leitende und Eltern nicht in «Mein Kalender». Vergib in Outlook eine Kategorie.",
    ),
    liste,
    meldung,
    el("div", { class: "tm-mehr" }, mehr),
  );
  zeichneListe();
  if (unbekannte.length > 0) {
    bereich.append(
      el(
        "section",
        { class: "flaeche", "aria-labelledby": "tm-unbekannt" },
        el("h2", { id: "tm-unbekannt" }, "Kategorien ohne Gruppe"),
        el(
          "p",
          { class: "leise" },
          "Diese Kategorien aus Outlook gehören noch zu keiner Gruppe, auch bei Terminen, die über eine andere Kategorie sichtbar sind. Die Zuordnung wirkt nach dem nächsten Abgleich mit Outlook, in höchstens 5 Minuten.",
        ),
        el(
          "ul",
          { class: "liste-zeilen" },
          unbekannte.map((k) =>
            el(
              "li",
              {},
              el(
                "div",
                { class: "text" },
                el("span", { class: "name tm-roh" }, k.name),
                el("span", { class: "klein leise" }, termineText(k.anzahl)),
              ),
              el(
                "a",
                {
                  class: "knopf knopf--klein",
                  href: `#termine/kategorien/${encodeURIComponent(k.name)}`,
                  "aria-label": `Gruppe zuordnen: ${k.name}`,
                },
                "Gruppe zuordnen",
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// «Komponenten» (System): Skeleton-Galerie (G5) und Zustandstafel (G6) mit den echten Bausteinen der Verwaltung, in Tag und Nacht des Browsers. Zeigt nur feste Beispiele, ruft keine API auf und enthält keine echten Daten. Dient auch als Prüfstand für die Folge-Issues.
import { anfrage } from "./api.js";
import {
  chip,
  dialogFormular,
  el,
  feld,
  icon,
  knopf,
  seitenblatt,
  tabelle,
} from "./dom.js";
import {
  skeletonDetail,
  skeletonFlaeche,
  skeletonFormular,
  skeletonListe,
  skeletonTabelle,
} from "./lader.js";
import { bestaetigungAmOrt, splitKnopf } from "./aktionen.js";
import { datumsfeld, datumZeitFeld, zahlfeld, zeitfeld } from "./datumsfeld.js";
import { filterleiste } from "./filterleiste.js";
import { formularRaster } from "./formularraster.js";
import { mitRueckgaengig, zweistufig } from "./rueckgaengig.js";
import { sortierListe } from "./sortieren.js";
import { leerKarte, rahmenzustand, zustandsKarte } from "./zustaende.js";

const abschnitt = (titel, ...inhalt) =>
  el(
    "section",
    { class: "flaeche" },
    el("h2", { class: "gross" }, titel),
    ...inhalt,
  );

// Zeile der Tafel: Name der Komponente, dann je Zustand ein Knoten oder ein Strich mit Grund
const zeile = (name, ...zellen) =>
  el(
    "tr",
    {},
    el("th", { scope: "row" }, name),
    zellen.map((z) =>
      el(
        "td",
        {},
        typeof z === "string" ? el("span", { class: "hilfe" }, `– ${z}`) : z,
      ),
    ),
  );

function knopfZeile(name, art, text, gefaehrlich = false) {
  const basis = () => knopf(text, { art });
  const aus = basis();
  aus.disabled = true;
  const laedt = basis();
  laedt.disabled = true;
  laedt.setAttribute("aria-busy", "true");
  return zeile(
    name,
    basis(),
    aus,
    laedt,
    gefaehrlich
      ? "Zerstörendes lässt sich in der Frist zurücknehmen (Toast)"
      : "Fehler steht im Hinweis",
  );
}

function tafel() {
  const feldFehler = feld({ label: "Name", wert: "" });
  feldFehler.eingabe.setAttribute("aria-invalid", "true");
  feldFehler.wurzel.append(
    el("p", { class: "feld-fehler" }, "Gib einen Namen ein."),
  );
  const schalterAus = el("button", {
    type: "button",
    class: "schalter",
    role: "switch",
    "aria-checked": "false",
    "aria-label": "Aus",
  });
  const schalterAn = el("button", {
    type: "button",
    class: "schalter",
    role: "switch",
    "aria-checked": "true",
    "aria-label": "An",
  });
  for (const s of [schalterAus, schalterAn]) {
    s.addEventListener("click", () =>
      s.setAttribute("aria-checked", String(s.ariaChecked !== "true")),
    );
  }
  const pille = (text, gedrueckt) =>
    el(
      "button",
      { type: "button", class: "pille", "aria-pressed": String(gedrueckt) },
      text,
    );
  return tabelle({
    beschriftung: "Zustände der Bausteine",
    spalten: ["Baustein", "Standard", "Deaktiviert", "Lädt", "Fehler"],
    zeilen: [
      knopfZeile("Knopf rot (Hauptaktion)", "haupt", "Speichern"),
      knopfZeile("Knopf umrandet", "", "Abbrechen"),
      knopfZeile("Knopf still", "still", "Mehr"),
      knopfZeile("Knopf gefährlich", "gefahr", "Löschen", true),
      zeile(
        "Chip",
        el("ul", { class: "chips" }, chip("Wölfe", undefined, false)),
        "Chips sind nicht bedienbar",
        "gibt es nicht",
        el(
          "ul",
          { class: "chips" },
          chip("Abgelehnt", "fehler"),
          chip("Freigegeben", "ok"),
          chip("Offen", "warn"),
        ),
      ),
      zeile(
        "Feld",
        feld({ label: "Name", wert: "Wölfe" }).wurzel,
        (() => {
          const f = feld({ label: "Name", wert: "Wölfe" });
          f.eingabe.disabled = true;
          return f.wurzel;
        })(),
        "kein eigener Zustand",
        feldFehler.wurzel,
      ),
      zeile(
        "Schalter",
        schalterAus,
        "wechselt sofort, der Server entscheidet",
        "gibt es nicht",
        "Fehler im Hinweis",
      ),
      zeile(
        "Pille (Auswahl)",
        pille("Stufe", false),
        "wird nicht ausgewählt",
        "gibt es nicht",
        el(
          "div",
          { class: "pillen" },
          pille("Stufe", true),
          pille("Team", false),
        ),
      ),
      zeile(
        "Dialog",
        knopf("Dialog öffnen", {
          onclick: () =>
            dialogFormular({
              titel: "Gruppe anlegen?",
              beschreibung: "Beispiel: Titel als Frage, Wirkung in Worten.",
              felder: [feld({ label: "Name" }).wurzel],
              ok: "Anlegen",
              senden: async () => {},
            }),
        }),
        "gibt es nicht",
        "Ladekreis im Aktionsknopf, Felder gesperrt",
        "Hinweis im Dialog, Eingaben bleiben",
      ),
      zeile(
        "Aktion mit Rückgängig",
        knopf("Toast zeigen", {
          onclick: () =>
            mitRueckgaengig({
              text: "Vorlage «Wochenendlager» gelöscht",
              ausfuehren: async () => {},
            }),
        }),
        "gibt es nicht",
        "Toast bleibt 8 Sekunden, der Balken läuft ab",
        "Der Toast meldet den Fehler und die Ansicht kommt zurück",
      ),
      zeile(
        "Zweistufiger Knopf",
        zweistufig(
          knopf("Senden", { symbol: "glocke" }),
          "Wirklich senden?",
          () => {},
        ),
        "gibt es nicht",
        "gibt es nicht",
        "Hinweis im Fluss",
      ),
      zeile(
        "Seitenblatt",
        knopf("Blatt öffnen", {
          onclick: () =>
            seitenblatt({
              titel: "Mara Muster",
              untertitel: "Wölfe",
              inhalt: [feld({ label: "Vorname", wert: "Mara" }).wurzel],
              fusszeile: [knopf("Speichern", { art: "haupt" })],
            }),
        }),
        "gibt es nicht",
        "Skeleton im Blatt",
        "Hinweis im Blatt, Eingaben bleiben",
      ),
    ],
  }).wurzel;
}

// Querschnitt-Komponenten (#578): feste Beispiele, nichts wird gespeichert
function werkzeuge(ctx) {
  const sortiert = sortierListe({
    beschriftung: "Beispiel: Reihenfolge der Stufen",
    eintraege: [
      { id: "a", text: "Biberstufe" },
      { id: "b", text: "Wolfsstufe" },
      { id: "c", text: "Pfadistufe" },
      { id: "d", text: "Piostufe" },
    ],
    beiNeu: () => {},
    mitRueckgaengig: ctx.mitRueckgaengig,
  });
  const zeilen = [
    ["Anna", "Aktiv"],
    ["Ben", "Aktiv"],
    ["Cem", "Inaktiv"],
  ];
  let leiste;
  const trefferListe = el("ul", { class: "spalte" });
  const zeichne = ({ suche, filter }) => {
    const sichtbar = zeilen.filter(
      ([n, s]) =>
        n.toLowerCase().includes(suche.trim().toLowerCase()) &&
        (filter.status === "alle" || filter.status === s),
    );
    trefferListe.replaceChildren(
      ...sichtbar.map(([n, s]) => el("li", {}, `${n} (${s})`)),
    );
    leiste.setzeTreffer(sichtbar.length, zeilen.length);
  };
  leiste = filterleiste({
    suche: { label: "Name suchen" },
    filter: [
      {
        schluessel: "status",
        label: "Status",
        optionen: [
          ["alle", "Alle"],
          ["Aktiv", "Aktiv"],
          ["Inaktiv", "Inaktiv"],
        ],
      },
    ],
    namen: { einzahl: "Person", mehrzahl: "Personen" },
    beiAenderung: zeichne,
  });
  zeichne(leiste.stand());
  const geteilt = splitKnopf({
    text: "Veröffentlichen",
    art: "haupt",
    onclick: () => ctx.melde("Veröffentlicht.", "ok"),
    eintraege: [
      {
        text: "Entwurf speichern",
        onclick: () => ctx.melde("Entwurf gespeichert.", "ok"),
      },
      { text: "Versionen ansehen", onclick: () => {} },
      { text: "Zurückziehen", gefaehrlich: true, onclick: () => {} },
    ],
  });
  const amOrt = bestaetigungAmOrt({
    text: "Lager löschen",
    frage: "Lager «Sommerlager» endgültig löschen?",
    folge: "Alle Mitglieder, Aufgaben und Packlisten gehen mit.",
    erwartet: "Sommerlager",
    ausfuehren: () =>
      ctx.melde("Nur ein Beispiel: Nichts wurde gelöscht.", "info"),
  });
  const raster = formularRaster({
    felder: [
      feld({ label: "Name", wert: "Sommerlager" }).wurzel,
      el("p", { class: "hilfe" }, "Die Felder stehen links, das Bild rechts."),
    ],
    seite: el(
      "p",
      { class: "leise" },
      "Hier steht das Bild oder die Vorschau.",
    ),
    seiteTitel: "Vorschau",
  });
  return [
    abschnitt("Sortierliste", sortiert.wurzel),
    abschnitt("Filterleiste", leiste.wurzel, trefferListe),
    abschnitt(
      "Datum, Zeit und Zahl",
      el(
        "div",
        { class: "reihe" },
        datumsfeld({ label: "Beginn", wert: "2026-12-05" }).wurzel,
        zeitfeld({ label: "Uhrzeit", wert: "14:30" }).wurzel,
        datumZeitFeld({ label: "Anmeldeschluss", wert: "2026-12-01T18:00" })
          .wurzel,
        zahlfeld({ label: "Plätze", wert: "12", min: 0, max: 200 }).wurzel,
      ),
    ),
    abschnitt(
      "Geteilter Knopf und Bestätigung am Ort",
      el("div", { class: "reihe" }, geteilt.wurzel, amOrt.wurzel),
    ),
    abschnitt("Formularraster", raster),
  ];
}

function zeigeGalerie(bereich, ctx) {
  const hinweise = el(
    "div",
    { class: "spalte" },
    ["ok", "info", "warn", "fehler"].map((art) =>
      el(
        "div",
        {
          class: `hinweis hinweis--${art}`,
          role: art === "fehler" ? "alert" : undefined,
        },
        el(
          "span",
          {},
          {
            ok: "Gruppe erstellt.",
            info: "Die Termine kommen aus Outlook. Änderungen machst du dort.",
            warn: "5 Termine haben keine Kategorie und sind für niemanden sichtbar.",
            fehler:
              "Nicht gespeichert. Der Server antwortet nicht. Versuche es nochmals.",
          }[art],
        ),
      ),
    ),
  );
  const karte = zustandsKarte(
    {
      ueber: "Fehler 500",
      titel: "Die offenen Punkte konnten nicht geladen werden.",
      text: "Prüfe die Verbindung und versuche es nochmals.",
    },
    [knopf("Nochmals versuchen", { symbol: "aktualisieren" })],
  );
  const meldungen = el(
    "div",
    { class: "reihe" },
    knopf("Erfolg melden", {
      onclick: () => ctx.melde("Gruppe «Bienli Plus» erstellt.", "ok"),
    }),
    knopf("Info melden", {
      onclick: () =>
        ctx.melde(
          "Die Termine kommen aus Outlook. Änderungen machst du dort.",
          "info",
        ),
    }),
    knopf("Warnung melden", {
      onclick: () =>
        ctx.melde(
          "5 Termine haben keine Kategorie und sind für niemanden sichtbar.",
          "warn",
          {
            text: "Beheben",
            onclick: () => {},
          },
        ),
    }),
    knopf("Fehler melden", {
      onclick: () =>
        ctx.melde(
          "Nicht gespeichert. Der Server antwortet nicht. Versuche es nochmals.",
          "fehler",
          {
            text: "Nochmals versuchen",
            onclick: () => {},
          },
        ),
    }),
  );
  bereich.append(
    el(
      "p",
      { class: "leise" },
      "Hover und Fokus gelten für jeden Baustein gleich: Bediene die Beispiele mit Maus und Tastatur. Tag und Nacht folgen der Einstellung des Geräts.",
    ),
    abschnitt("Zustände der Bausteine", tafel()),
    abschnitt("Hinweise", hinweise, meldungen),
    ...werkzeuge(ctx),
    abschnitt(
      "Zustände einer Fläche",
      karte.wurzel,
      leerKarte("Gerade ist nichts offen."),
    ),
    abschnitt(
      "Zustand auf der ganzen Seite",
      el(
        "div",
        { class: "komponenten-beispiel" },
        rahmenzustand(
          {
            ueber: "Fehler 404",
            titel: "Diese Seite gibt es nicht.",
            text: "Vielleicht ist der Link alt oder hat einen Tippfehler.",
          },
          [
            el(
              "a",
              { class: "knopf knopf--haupt", href: "#uebersicht" },
              icon("uebersicht"),
              "Zur Übersicht",
            ),
          ],
        ).wurzel,
      ),
    ),
    abschnitt(
      "Skeleton-Galerie",
      el(
        "p",
        { class: "hilfe" },
        "Das Skeleton erscheint nach 250 ms und bleibt mindestens 400 ms. Nach 4 Sekunden steht «Das dauert länger.» mit «Nochmals versuchen». Es pulsiert nur, wenn Bewegung erlaubt ist.",
      ),
      el("h3", {}, "Tabelle"),
      skeletonTabelle({ zeilen: 4 }),
      el("h3", {}, "Fläche mit Zeilen und Knopf"),
      skeletonFlaeche({ mitKnopf: true, zeilen: 3 }),
      el("h3", {}, "Fläche mit Werten"),
      skeletonFlaeche({ zeilen: 3 }),
      el("h3", {}, "Formular"),
      skeletonFormular({ felder: 2 }),
      el("h3", {}, "Detail"),
      skeletonDetail(),
      el("h3", {}, "Liste"),
      skeletonListe({ zeilen: 3 }),
    ),
  );
}

// Die Galerie ist ein Werkzeug für Entwickler (#593): Die Antwort der Website-Einstellungen sagt es mit «nameAenderbar» (nur Entwickler dürfen den Namen ändern); ohne diese Angabe, auch bei einem Fehler, bleibt die Galerie zu. Die Navigation blendet den Eintrag für alle anderen aus, sobald sie dieselbe Frage stellt.
export function zeige(bereich, ctx) {
  ctx.lade(
    async () => {
      try {
        return (
          (await anfrage("GET", "/api/v1/redaktion/website")).nameAenderbar ===
          true
        );
      } catch {
        return false;
      }
    },
    (entwickler) =>
      entwickler
        ? zeigeGalerie(bereich, ctx)
        : bereich.append(
            zustandsKarte({
              ueber: "Nur für Entwickler",
              titel: "Diese Galerie ist ein Werkzeug für Entwickler.",
              text: "Sie zeigt alle Bausteine der Verwaltung zum Prüfen. Für die tägliche Arbeit brauchst du sie nicht.",
            }).wurzel,
          ),
  );
}

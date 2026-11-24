import { ankreuzen, el, feld, knopf } from "./dom.js";
import {
  anmelden,
  anzahlText,
  bildWahl,
  eingabe,
  eintraegeForm,
  kuerze,
  LINK_HILFE,
  linkTeil,
  listenForm,
  pflicht,
  teilEingabe,
  wahl,
} from "./website-felder.js";
import {
  bloeckeZuText,
  textZuBloecken,
  zaehleZeichen,
} from "./website-richtext.js";

// Bausteine «Text und Gestaltung» (#741) im Editor: Hinweisbox, Zitat, Fragen und Antworten, zwei Spalten, Bild neben Text, Tabelle, Schritte, Checkliste.
// Typen und Katalogeinträge hängt website-felder.js an TYPEN und KATALOG; die Hilfen (eingabe, listenForm, bildWahl …) kommen von dort. Nichts hier läuft beim Laden: Alles wird erst beim Zeichnen eines Formulars gebraucht.
// Obergrenzen wie in src/website/bausteine-text.ts.

const MAX_HINWEISBOX = 1000;
const MAX_ANTWORT = 3000;
const MAX_SPALTE = 5000;
const MAX_BILDNEBEN = 3000;
const MAX_BLOECKE = 12;
const MAX_FRAGEN = 30;
const MAX_SPALTEN_TABELLE = 6;
const MAX_ZEILEN_TABELLE = 40;
const MAX_SCHRITTE = 12;
const MAX_PUNKTE = 40;

export const TEXT_FELDNAMEN = {
  art: "Die Art",
  frage: "Die Frage",
  antwort: "Die Antwort",
  links: "Die linke Spalte",
  rechts: "Die rechte Spalte",
  kopf: "Die Kopfzeile",
  zeilen: "Die Zeilen",
  person: "Die Person",
  seite: "Die Seite des Bildes",
};

const TEXT_HILFE =
  "Eine Zeile ist ein Absatz. Fett: **Text**. Kursiv: *Text*. Link: [Text](Adresse). Liste: Zeilen mit «- » am Anfang, nummeriert mit «1. ».";

// Text mit Absätzen, Listen und Links in einem Feld: Er liegt am Objekt «ziel» unter dem Schlüssel «schluessel» (Baustein, Spalte oder Frage) und zählt seine Zeichen
function textFeld(k, b, reg, ziel, schluessel, pfad, label, { max, rows = 5 }) {
  const f = feld({
    label,
    mehrzeilig: true,
    rows,
    wert: bloeckeZuText(ziel[schluessel] ?? []),
    lang: "de-CH",
    spellcheck: "true",
    hilfe: TEXT_HILFE,
  });
  const zaehler = el("p", { class: "hilfe" });
  const zaehle = () => {
    zaehler.textContent = `${zaehleZeichen(ziel[schluessel] ?? [])} von ${max} Zeichen`;
  };
  f.eingabe.addEventListener("input", () => {
    ziel[schluessel] = textZuBloecken(f.eingabe.value);
    zaehle();
    k.aendere(b);
  });
  zaehle();
  f.wurzel.append(zaehler);
  anmelden(reg, pfad, f);
  return f.wurzel;
}

// Prüfung eines solchen Textes wie beim Server: nicht leer, höchstens max Zeichen und zwölf Blöcke
const pruefeText = (bloecke, pfad, max) =>
  (bloecke ?? []).length === 0
    ? [[pfad, "fehlt."]]
    : zaehleZeichen(bloecke) > max
      ? [[pfad, `ist zu lang (höchstens ${max} Zeichen).`]]
      : bloecke.length > MAX_BLOECKE
        ? [[pfad, `hat zu viele Absätze (höchstens ${MAX_BLOECKE}).`]]
        : [];

// Anfang eines Textes für die Zeile in der Liste der Bausteine
const textAnfang = (bloecke, n = 80) =>
  kuerze(
    (bloecke ?? [])
      .flatMap((x) => (x.typ === "absatz" ? [x.inhalt] : x.eintraege))
      .map((abschnitte) => abschnitte.map((a) => a.text).join(""))
      .join(" · "),
    n,
  );

// Beispiele für die Vorschau im Katalog: feste IDs, die der Server durch Platzhalterbilder ersetzt (nie echte Medien)
const bspBild = (nr) =>
  `00000000-0000-4000-8000-${String(nr).padStart(12, "0")}`;
const absatz = (text) => ({ typ: "absatz", inhalt: [{ text }] });
const punkte = (...eintraege) => ({
  typ: "liste",
  geordnet: false,
  eintraege: eintraege.map((text) => [{ text }]),
});

const HINWEIS_ARTEN = [
  ["info", "Info"],
  ["tipp", "Tipp"],
  ["wichtig", "Wichtig"],
  ["achtung", "Achtung"],
];
const HINWEIS_NAMEN = Object.fromEntries(HINWEIS_ARTEN);

// Zwei Felder mit «beschriftung» und «ziel» gehören zusammen: Fehlt eines, meldet die Prüfung das fehlende
const pruefeLinkPaar = (d, pfad) => [
  ...(d.beschriftung?.trim() && !d.ziel?.trim()
    ? [[`${pfad}.ziel`, "fehlt."]]
    : []),
  ...(d.ziel?.trim() && !d.beschriftung?.trim()
    ? [[`${pfad}.beschriftung`, "fehlt."]]
    : []),
];

export const TEXT_TYPEN = {
  hinweisbox: {
    name: "Hinweisbox",
    kurz: (d) =>
      [HINWEIS_NAMEN[d.art], d.titel || textAnfang(d.inhalt, 60)]
        .filter(Boolean)
        .join(": "),
    pruefe: (d) => pruefeText(d.inhalt, "daten.inhalt", MAX_HINWEISBOX),
    form: (k, b, reg) => [
      wahl(k, b, reg, "art", "Art des Hinweises", HINWEIS_ARTEN),
      el(
        "p",
        { class: "hilfe" },
        "Info erklärt etwas, Tipp hilft, Wichtig muss man wissen, Achtung warnt vor einem Fehler. Das Wort der Art steht immer im Kasten, nicht nur die Farbe.",
      ),
      eingabe(k, b, reg, "titel", "Titel (optional)", {
        maxlength: 100,
        optional: true,
      }),
      textFeld(k, b, reg, b.daten, "inhalt", "daten.inhalt", "Text", {
        max: MAX_HINWEISBOX,
      }),
    ],
  },
  zitat: {
    name: "Zitat",
    kurz: (d) => kuerze(d.text ?? "", 80),
    pruefe: (d) => (d.text?.trim() ? [] : [["daten.text", "fehlt."]]),
    form: (k, b, reg) => [
      eingabe(k, b, reg, "text", "Zitat", {
        maxlength: 400,
        mehrzeilig: true,
        rows: 3,
        hilfe:
          "Der Wortlaut, ohne Anführungszeichen: Sie setzt die Seite selbst.",
      }),
      eingabe(k, b, reg, "person", "Person (optional)", {
        maxlength: 100,
        optional: true,
        hilfe:
          "Cevi-Name oder Vorname. Bei Kindern und Jugendlichen nur mit Einwilligung der Eltern.",
      }),
      eingabe(k, b, reg, "funktion", "Funktion (optional)", {
        maxlength: 100,
        optional: true,
        hilfe: "Zum Beispiel: Leitung Jungschar.",
      }),
      bildWahl(k, b, reg, b.daten, "daten.bild", {
        schluessel: "bild",
        optional: true,
        name: "Foto (optional)",
        klein: true,
      }),
    ],
  },
  fragen: {
    name: "Fragen und Antworten",
    kurz: (d) => anzahlText(d.eintraege?.length ?? 0, "1 Frage", "Fragen"),
    pruefe: (d) => [
      ...((d.eintraege ?? []).length === 0
        ? [["daten.eintraege", "fehlt."]]
        : []),
      ...(d.eintraege ?? []).flatMap((e, i) => [
        ...(e.frage?.trim() ? [] : [[`daten.eintraege.${i}.frage`, "fehlt."]]),
        ...pruefeText(e.antwort, `daten.eintraege.${i}.antwort`, MAX_ANTWORT),
      ]),
    ],
    form: (k, b, reg) => [
      el(
        "p",
        { class: "hilfe" },
        "Eine Liste zum Aufklappen: Die Frage steht in einer Zeile, die Antwort öffnet sich bei Klick oder mit Enter. Jede Frage hat einen eigenen Anker in der Adresse der Seite.",
      ),
      listenForm(k, b, {
        name: "Frage",
        listeName: "Fragen",
        pfadName: "daten.eintraege",
        liste: () => b.daten.eintraege,
        max: MAX_FRAGEN,
        hinzuText: "Frage hinzufügen",
        hinzu: (liste, fertig) => {
          liste.push({ frage: "", antwort: [] });
          fertig(liste.length - 1);
        },
        zeile: (eintrag, pfad) => [
          teilEingabe(k, b, reg, eintrag, "frage", "Frage", `${pfad}.frage`, {
            maxlength: 200,
          }),
          textFeld(
            k,
            b,
            reg,
            eintrag,
            "antwort",
            `${pfad}.antwort`,
            "Antwort",
            {
              max: MAX_ANTWORT,
              rows: 4,
            },
          ),
        ],
      }),
    ],
  },
  spalten: {
    name: "Zwei Spalten",
    kurz: (d) =>
      [d.links, d.rechts]
        .map((s) => s?.titel || textAnfang(s?.inhalt, 40))
        .filter(Boolean)
        .join(" | "),
    pruefe: (d) => [
      ...pruefeText(d.links?.inhalt, "daten.links.inhalt", MAX_SPALTE),
      ...pruefeText(d.rechts?.inhalt, "daten.rechts.inhalt", MAX_SPALTE),
    ],
    form: (k, b, reg) =>
      [
        ["links", "Linke Spalte"],
        ["rechts", "Rechte Spalte"],
      ].map(([seite, name]) =>
        el(
          "section",
          { class: "ws-teil" },
          el("h3", {}, name),
          teilEingabe(
            k,
            b,
            reg,
            b.daten[seite],
            "titel",
            "Titel (optional)",
            `daten.${seite}.titel`,
            { optional: true, maxlength: 100 },
          ),
          textFeld(
            k,
            b,
            reg,
            b.daten[seite],
            "inhalt",
            `daten.${seite}.inhalt`,
            "Text",
            { max: MAX_SPALTE },
          ),
        ),
      ),
  },
  bildneben: {
    name: "Bild neben Text",
    kurz: (d) => d.titel || textAnfang(d.inhalt, 60),
    pruefe: (d, k) => {
      const fehler = [
        ...(d.mediumId ? [] : [["daten.mediumId", "fehlt."]]),
        ...pruefeText(d.inhalt, "daten.inhalt", MAX_BILDNEBEN),
        ...pruefeLinkPaar(
          { beschriftung: d.link?.beschriftung, ziel: d.link?.ziel },
          "daten.link",
        ),
      ];
      const m = d.mediumId ? k?.medien.get(d.mediumId) : null;
      if (m && !m.dekorativ && !k.altText(m).trim())
        fehler.push([`alt.${m.id}`, "fehlt."]);
      return fehler;
    },
    form: (k, b, reg) => [
      bildWahl(k, b, reg, b.daten, "daten.mediumId", { alt: "pflicht" }),
      wahl(k, b, reg, "seite", "Bild steht", [
        ["links", "Links"],
        ["rechts", "Rechts"],
      ]),
      el(
        "p",
        { class: "hilfe" },
        "Am Handy steht das Bild immer über dem Text. Wechsle links und rechts ab, wenn mehrere solche Bausteine folgen.",
      ),
      eingabe(k, b, reg, "titel", "Titel (optional)", {
        maxlength: 100,
        optional: true,
      }),
      textFeld(k, b, reg, b.daten, "inhalt", "daten.inhalt", "Text", {
        max: MAX_BILDNEBEN,
      }),
      teilEingabe(
        k,
        b,
        reg,
        linkTeil(b),
        "beschriftung",
        "Beschriftung der Schaltfläche (optional)",
        "daten.link.beschriftung",
        { optional: true, maxlength: 60 },
      ),
      teilEingabe(
        k,
        b,
        reg,
        linkTeil(b),
        "ziel",
        "Ziel der Schaltfläche (optional)",
        "daten.link.ziel",
        {
          optional: true,
          maxlength: 2000,
          spellcheck: "false",
          autocapitalize: "off",
          hilfe: LINK_HILFE,
        },
      ),
    ],
  },
  tabelle: {
    name: "Tabelle",
    kurz: (d) =>
      `${anzahlText(d.zeilen?.length ?? 0, "1 Zeile", "Zeilen")}, ${anzahlText(d.kopf?.length ?? 0, "1 Spalte", "Spalten")}${d.beschriftung ? ` · ${kuerze(d.beschriftung, 40)}` : ""}`,
    pruefe: (d) => [
      ...(d.kopf ?? []).flatMap((t, i) =>
        t?.trim() ? [] : [[`daten.kopf.${i}`, "fehlt."]],
      ),
      ...((d.zeilen ?? []).length === 0 ? [["daten.zeilen", "fehlt."]] : []),
    ],
    form: (k, b, reg) => {
      const d = b.daten;
      // Eine Änderung an den Spalten zeichnet das Formular neu; der Fokus geht an die Stelle, die sich geändert hat
      const neu = (selektor) => {
        k.aendere(b);
        k.formNeu(b);
        document.querySelector(`.ws-blattform ${selektor}`)?.focus();
      };
      const spaltenKnoepfe = el(
        "div",
        { class: "ws-teilaktionen" },
        knopf("Spalte hinzufügen", {
          klein: true,
          symbol: "plus",
          "data-spalte-hinzu": "",
          onclick: () => {
            if (d.kopf.length >= MAX_SPALTEN_TABELLE) {
              k.ctx.melde(
                `Mehr als ${MAX_SPALTEN_TABELLE} Spalten sind nicht möglich.`,
                "fehler",
              );
              return;
            }
            d.kopf.push("");
            d.zeilen.forEach((z) => z.push(""));
            k.ctx.melde(`Spalte ${d.kopf.length} ist da.`);
            neu(`[data-spalte="${d.kopf.length - 1}"] input`);
          },
        }),
        knopf("Letzte Spalte entfernen", {
          klein: true,
          onclick: () => {
            if (d.kopf.length <= 2) {
              k.ctx.melde(
                "Eine Tabelle braucht mindestens 2 Spalten.",
                "fehler",
              );
              return;
            }
            const nr = d.kopf.length;
            d.kopf.pop();
            d.zeilen.forEach((z) => z.pop());
            k.ctx.melde(`Spalte ${nr} ist entfernt.`);
            neu("[data-spalte-hinzu]");
          },
        }),
      );
      const kopfFelder = d.kopf.map((_, i) => {
        const wurzel = teilEingabe(
          k,
          b,
          reg,
          d.kopf,
          i,
          `Kopf von Spalte ${i + 1}`,
          `daten.kopf.${i}`,
          { maxlength: 60 },
        );
        wurzel.dataset.spalte = String(i);
        // Die Zellen der Zeilen heissen wie ihre Spalte: Ändert sich der Kopf, ändert sich ihre Beschriftung mit
        wurzel.querySelector("input").addEventListener("input", (e) => {
          const name = e.target.value.trim() || `Spalte ${i + 1}`;
          for (const l of e.target
            .closest(".ws-blattform")
            .querySelectorAll(`label[data-zelle="${i}"]`))
            l.textContent = name;
        });
        return wurzel;
      });
      const zeilenKopf = ankreuzen({
        label: "Die erste Spalte ist die Überschrift jeder Zeile",
        gewaehlt: d.zeilenkopf === true,
        wert: "zeilenkopf",
      });
      zeilenKopf.eingabe.addEventListener("change", () => {
        d.zeilenkopf = zeilenKopf.eingabe.checked;
        k.aendere(b);
      });
      return [
        el(
          "p",
          { class: "hilfe" },
          "Für Preise, Zeiten oder Zuteilungen. Zahlen stehen automatisch rechtsbündig, wenn die ganze Spalte aus Zahlen besteht. Auf schmalen Bildschirmen scrollt die Tabelle zur Seite.",
        ),
        eingabe(k, b, reg, "beschriftung", "Titel der Tabelle (optional)", {
          maxlength: 100,
          optional: true,
          hilfe: "Screenreader lesen ihn vor der Tabelle vor.",
        }),
        el(
          "section",
          { class: "ws-teil" },
          el("h3", {}, "Spalten"),
          ...kopfFelder,
          spaltenKnoepfe,
          zeilenKopf.wurzel,
        ),
        el(
          "section",
          { class: "ws-teil" },
          el("h3", {}, "Zeilen"),
          listenForm(k, b, {
            name: "Zeile",
            listeName: "Zeilen der Tabelle",
            pfadName: "daten.zeilen",
            liste: () => d.zeilen,
            max: MAX_ZEILEN_TABELLE,
            hinzuText: "Zeile hinzufügen",
            hinzu: (zeilen, fertig) => {
              zeilen.push(d.kopf.map(() => ""));
              fertig(zeilen.length - 1);
            },
            zeile: (zeile, pfad) =>
              d.kopf.map((kopf, j) => {
                const wurzel = teilEingabe(
                  k,
                  b,
                  reg,
                  zeile,
                  j,
                  kopf.trim() || `Spalte ${j + 1}`,
                  `${pfad}.${j}`,
                  { maxlength: 120 },
                );
                wurzel.querySelector("label").dataset.zelle = String(j);
                return wurzel;
              }),
          }),
        ),
      ];
    },
  },
  schritte: {
    name: "Schritte",
    kurz: (d) => anzahlText(d.eintraege?.length ?? 0, "1 Schritt", "Schritte"),
    pruefe: (d) => [
      ...pflicht(d, "titel"),
      ...(d.eintraege ?? []).flatMap((e, i) =>
        pruefeLinkPaar(e, `daten.eintraege.${i}`),
      ),
    ],
    form: (k, b, reg) => [
      el(
        "p",
        { class: "hilfe" },
        "Eine nummerierte Abfolge, zum Beispiel «So meldest du dich an». Die Nummern setzt die Seite.",
      ),
      eintraegeForm(k, b, reg, {
        name: "Schritt",
        max: MAX_SCHRITTE,
        felder: [
          ["titel", "Titel des Schritts", { maxlength: 100 }],
          [
            "text",
            "Text (optional)",
            { optional: true, maxlength: 500, mehrzeilig: true, rows: 3 },
          ],
          [
            "beschriftung",
            "Beschriftung des Links (optional)",
            { optional: true, maxlength: 60 },
          ],
          [
            "ziel",
            "Ziel des Links (optional)",
            {
              optional: true,
              maxlength: 2000,
              spellcheck: "false",
              autocapitalize: "off",
              hilfe: LINK_HILFE,
            },
          ],
        ],
      }),
    ],
  },
  checkliste: {
    name: "Checkliste",
    kurz: (d) =>
      `${d.darstellung === "kaestchen" ? "Kästchen" : "Haken"} · ${anzahlText(d.eintraege?.length ?? 0, "1 Punkt", "Punkte")}`,
    pruefe: (d) => pflicht(d, "text"),
    form: (k, b, reg) => [
      wahl(k, b, reg, "darstellung", "Zeichen vor jedem Punkt", [
        ["haken", "Haken"],
        ["kaestchen", "Leeres Kästchen"],
      ]),
      el(
        "p",
        { class: "hilfe" },
        "Haken zeigen, was dabei oder inbegriffen ist. Leere Kästchen eignen sich für eine Packliste zum Abhaken auf Papier.",
      ),
      eingabe(k, b, reg, "titel", "Titel (optional)", {
        maxlength: 100,
        optional: true,
        hilfe: "Zum Beispiel: Das gehört in den Rucksack.",
      }),
      eintraegeForm(k, b, reg, {
        name: "Punkt",
        max: MAX_PUNKTE,
        felder: [["text", "Text", { maxlength: 200 }]],
      }),
    ],
  },
};

// Katalog «Baustein hinzufügen»: gruppe ordnet ihn ein, beispiel liefert die Daten für die Vorschau (echter Renderer, Bilder als Platzhalter)
export const TEXT_KATALOG = [
  {
    typ: "hinweisbox",
    gruppe: "Gestaltung",
    beschreibung: "Ein Kasten mit Info, Tipp, Wichtig oder Achtung.",
    neu: () => ({ art: "info", inhalt: [] }),
    beispiel: () => ({
      art: "tipp",
      titel: "Gutes Schuhwerk",
      inhalt: [
        absatz(
          "Der Weg führt über Wiesen und durch den Wald. Wetterfeste Schuhe halten die Füsse trocken.",
        ),
      ],
    }),
  },
  {
    typ: "zitat",
    gruppe: "Text",
    beschreibung: "Ein Satz einer Person, gross gesetzt, auf Wunsch mit Foto.",
    neu: () => ({ text: "" }),
    beispiel: () => ({
      text: "Im Lager habe ich Freunde gefunden, die bis heute zu mir halten.",
      person: "Mika",
      funktion: "Leitung Jungschar",
      bild: bspBild(61),
    }),
  },
  {
    typ: "fragen",
    gruppe: "Text",
    beschreibung: "Fragen mit Antworten zum Aufklappen, ohne Skript.",
    neu: () => ({ eintraege: [{ frage: "", antwort: [] }] }),
    beispiel: () => ({
      eintraege: [
        {
          frage: "Bis wann kann ich mein Kind anmelden?",
          antwort: [
            absatz("Die Anmeldung ist bis zwei Wochen vor dem Lager offen."),
          ],
        },
        {
          frage: "Was kostet das Lager?",
          antwort: [absatz("Der Preis steht bei den Angaben zum Lager.")],
        },
        {
          frage: "Was gehört in den Rucksack?",
          antwort: [punkte("Schlafsack", "Taschenlampe", "Regenjacke")],
        },
      ],
    }),
  },
  {
    typ: "spalten",
    gruppe: "Text",
    beschreibung: "Zwei Texte nebeneinander, am Handy untereinander.",
    neu: () => ({
      links: { inhalt: [] },
      rechts: { inhalt: [] },
    }),
    beispiel: () => ({
      links: {
        titel: "Für Kinder",
        inhalt: [
          absatz(
            "Spiel, Bastelarbeiten und Abenteuer in der Gruppe: jeden Samstag draussen unterwegs.",
          ),
        ],
      },
      rechts: {
        titel: "Für Eltern",
        inhalt: [
          absatz(
            "Wir melden uns vor jedem Anlass mit allen Angaben zu Treffpunkt und Mitnehmen.",
          ),
        ],
      },
    }),
  },
  {
    typ: "bildneben",
    gruppe: "Bilder und Medien",
    beschreibung:
      "Ein Bild neben einem Text, links oder rechts, auf Wunsch mit Schaltfläche.",
    neu: () => ({ seite: "links", inhalt: [] }),
    beispiel: () => ({
      mediumId: bspBild(62),
      seite: "links",
      titel: "Draussen zu Hause",
      inhalt: [
        absatz(
          "Wir sind bei jedem Wetter im Freien: Feuer machen, Hütten bauen, Spuren lesen.",
        ),
      ],
      link: { beschriftung: "Mehr über uns", ziel: "/ueber-uns" },
    }),
  },
  {
    typ: "tabelle",
    gruppe: "Karten und Listen",
    beschreibung: "Zeilen und Spalten, zum Beispiel für Preise und Zeiten.",
    neu: () => ({
      kopf: ["", ""],
      zeilen: [["", ""]],
      zeilenkopf: false,
    }),
    beispiel: () => ({
      beschriftung: "Beiträge",
      kopf: ["Angebot", "Preis"],
      zeilen: [
        ["Tageslager", "CHF 25.–"],
        ["Wochenendlager", "CHF 60.–"],
        ["Sommerlager", "CHF 180.–"],
      ],
      zeilenkopf: true,
    }),
  },
  {
    typ: "schritte",
    gruppe: "Karten und Listen",
    beschreibung:
      "Eine nummerierte Abfolge, zum Beispiel «So meldest du dich an».",
    neu: () => ({ eintraege: [{ titel: "" }] }),
    beispiel: () => ({
      eintraege: [
        { titel: "Anlass wählen", text: "Öffne den Anlass in der Übersicht." },
        { titel: "Kind anmelden", text: "Wähle dein Kind und bestätige." },
        { titel: "Bestätigung lesen", text: "Du bekommst eine E-Mail." },
      ],
    }),
  },
  {
    typ: "checkliste",
    gruppe: "Karten und Listen",
    beschreibung:
      "Punkte mit Haken oder leeren Kästchen, zum Beispiel eine Packliste.",
    neu: () => ({ darstellung: "kaestchen", eintraege: [{ text: "" }] }),
    beispiel: () => ({
      titel: "Das gehört in den Rucksack",
      darstellung: "kaestchen",
      eintraege: [
        { text: "Schlafsack und Mätteli" },
        { text: "Taschenlampe" },
        { text: "Regenjacke" },
        { text: "Trinkflasche" },
      ],
    }),
  },
];

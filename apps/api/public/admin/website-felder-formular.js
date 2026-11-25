import { ankreuzen, el, feld, neueId } from "./dom.js";
import { datumsfeld } from "./datumsfeld.js";
import {
  anmelden,
  eingabe,
  listenForm,
  teilEingabe,
} from "./website-felder.js";

// Baustein «Formular» (#819): Formular und Katalogeintrag. Die Felder des Formulars legt, ändert, ordnet und löscht die Person hier; die Antworten sehen Berechtigte unter «Website, Formulare» (website-formulare.js).
// Jedes Feld hat eine feste ID (crypto.randomUUID), die beim Ändern bleibt: Alte Antworten gehören so weiter zu ihrem Feld. Auswahlen tragen ihre Antworten als Text, eine Antwort pro Zeile.
// Die Prüfung im Browser meldet Fehlendes am Feld; alles andere prüft der Server beim Speichern.

const hilfe = (text) => el("p", { class: "hilfe" }, text);

export const FELD_TYPEN = [
  ["text", "Text, eine Zeile"],
  ["textbereich", "Text, mehrere Zeilen"],
  ["zahl", "Zahl"],
  ["datum", "Datum"],
  ["email", "E-Mail-Adresse"],
  ["telefon", "Telefonnummer"],
  ["auswahl", "Auswahlliste"],
  ["optionsfelder", "Optionsfelder (eine Antwort)"],
  ["mehrfachwahl", "Mehrfachwahl (mehrere Antworten)"],
  ["janein", "Ja oder Nein"],
  ["zustimmung", "Zustimmung (Pflichtkästchen)"],
];
const MIT_OPTIONEN = ["auswahl", "optionsfelder", "mehrfachwahl"];
export const MAX_FELDER = 30;
const STANDARD = {
  absenden: "Antwort senden",
  danke: "Danke. Deine Antwort ist angekommen.",
  aufbewahrenTage: 180,
  maxAntworten: 2000,
};

// Wie src/gesundheit-sperrliste.ts; test/website-formular.test.ts hält beide gleich
export const SPERRLISTE = [
  "allerg",
  "krank",
  "medikament",
  "diagnos",
  "gesundheit",
  "impf",
  "behinder",
  "handicap",
  "unvertraeglich",
  "intoleranz",
  "therapie",
  "epilep",
  "diabet",
  "asthma",
  "psych",
  "schwanger",
];
const normal = (t) =>
  t
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
const gesundheit = (t) => SPERRLISTE.some((w) => normal(t).includes(w));

// Eigenschaften je Typ; beim Wechsel des Typs fallen die des alten weg
const EIGEN = [
  "minLaenge",
  "maxLaenge",
  "ganzzahl",
  "min",
  "max",
  "von",
  "bis",
  "optionen",
  "minAuswahl",
  "maxAuswahl",
];

function neuesFeld() {
  return {
    id: window.crypto.randomUUID(),
    typ: "text",
    beschriftung: "",
    pflicht: false,
  };
}

// Zahlfeld, das eine Zahl oder nichts in die Kopie schreibt (Länge, Grenzen)
function zahlFeld(k, b, reg, ziel, schluessel, label, pfad, optionen = {}) {
  const { hilfe: h, ...rest } = optionen;
  const f = feld({
    label,
    wert: ziel[schluessel] === undefined ? "" : String(ziel[schluessel]),
    hilfe: h,
    inputmode: "decimal",
    autocomplete: "off",
    ...rest,
  });
  f.eingabe.addEventListener("input", () => {
    const t = f.eingabe.value.trim().replace(",", ".");
    if (t === "") delete ziel[schluessel];
    else ziel[schluessel] = Number.isFinite(Number(t)) ? Number(t) : t;
    k.aendere(b);
  });
  anmelden(reg, pfad, f);
  return f.wurzel;
}

function datumFeld(k, b, reg, ziel, schluessel, label, pfad, h) {
  // Eigenes Datumsfeld (Tippen und Kalender, TT.MM.JJJJ); der Wert ist JJJJ-MM-TT oder leer
  const f = datumsfeld({ label, wert: ziel[schluessel] ?? "", hilfe: h });
  f.eingabe.addEventListener("change", () => {
    if (f.eingabe.value === "") delete ziel[schluessel];
    else ziel[schluessel] = f.eingabe.value;
    k.aendere(b);
  });
  anmelden(reg, pfad, f);
  return f.wurzel;
}

function haken(k, b, ziel, schluessel, label, h, standard = false) {
  const f = ankreuzen({
    label,
    wert: schluessel,
    gewaehlt: ziel[schluessel] ?? standard,
  });
  f.eingabe.addEventListener("change", () => {
    ziel[schluessel] = f.eingabe.checked;
    k.aendere(b);
  });
  return el("div", {}, f.wurzel, h ? hilfe(h) : null);
}

// Die Zeilen der Auswahl: Der Wert im Feld ist roher Text, die Liste im Baustein entsteht daraus
function optionenFeld(k, b, reg, f, pfad) {
  const t = feld({
    label: "Antworten (eine pro Zeile)",
    mehrzeilig: true,
    rows: 4,
    wert: (f.optionen ?? []).join("\n"),
    hilfe: "Mindestens zwei, jede höchstens 100 Zeichen, keine doppelt.",
    autocomplete: "off",
  });
  t.eingabe.addEventListener("input", () => {
    f.optionen = t.eingabe.value
      .split("\n")
      .map((z) => z.trim())
      .filter(Boolean);
    k.aendere(b);
  });
  anmelden(reg, `${pfad}.optionen`, t);
  return t.wurzel;
}

function typWahl(k, b, f, i) {
  const id = neueId("ftyp");
  const sel = el(
    "select",
    { id, class: "ws-select" },
    FELD_TYPEN.map(([w, text]) => el("option", { value: w }, text)),
  );
  sel.value = f.typ;
  sel.addEventListener("change", () => {
    f.typ = sel.value;
    for (const e of EIGEN) delete f[e];
    if (f.typ === "zustimmung") f.pflicht = true;
    k.aendere(b);
    k.formNeu(b, { index: i, was: "neu" });
  });
  return el(
    "div",
    { class: "feld" },
    el("label", { for: id }, "Art des Feldes"),
    sel,
  );
}

function feldZeile(k, b, reg, f, pfad) {
  const i = Number(pfad.split(".").at(-1));
  const teile = [
    typWahl(k, b, f, i),
    teilEingabe(
      k,
      b,
      reg,
      f,
      "beschriftung",
      f.typ === "zustimmung" ? "Text neben dem Kästchen" : "Beschriftung",
      `${pfad}.beschriftung`,
      { maxlength: 300 },
    ),
    teilEingabe(
      k,
      b,
      reg,
      f,
      "hilfe",
      "Hilfetext (optional)",
      `${pfad}.hilfe`,
      {
        optional: true,
        maxlength: 300,
      },
    ),
  ];
  if (f.typ === "zustimmung") {
    teile.push(hilfe("Ohne Häkchen lässt sich das Formular nicht senden."));
  } else {
    teile.push(
      haken(
        k,
        b,
        f,
        "pflicht",
        "Pflichtfeld",
        "Ohne Häkchen steht «(optional)» hinter der Beschriftung.",
      ),
    );
  }
  if (f.typ === "text" || f.typ === "textbereich") {
    teile.push(
      zahlFeld(
        k,
        b,
        reg,
        f,
        "minLaenge",
        "Mindestens Zeichen (optional)",
        `${pfad}.minLaenge`,
      ),
      zahlFeld(
        k,
        b,
        reg,
        f,
        "maxLaenge",
        "Höchstens Zeichen (optional)",
        `${pfad}.maxLaenge`,
        {
          hilfe:
            f.typ === "text"
              ? "Ohne Angabe 200, höchstens 500."
              : "Ohne Angabe 1000, höchstens 2000.",
        },
      ),
    );
  }
  if (f.typ === "zahl") {
    teile.push(
      haken(k, b, f, "ganzzahl", "Nur ganze Zahlen"),
      zahlFeld(k, b, reg, f, "min", "Kleinster Wert (optional)", `${pfad}.min`),
      zahlFeld(k, b, reg, f, "max", "Grösster Wert (optional)", `${pfad}.max`),
    );
  }
  if (f.typ === "datum") {
    teile.push(
      datumFeld(
        k,
        b,
        reg,
        f,
        "von",
        "Frühestes Datum (optional)",
        `${pfad}.von`,
      ),
      datumFeld(
        k,
        b,
        reg,
        f,
        "bis",
        "Spätestes Datum (optional)",
        `${pfad}.bis`,
      ),
    );
  }
  if (MIT_OPTIONEN.includes(f.typ))
    teile.push(optionenFeld(k, b, reg, f, pfad));
  if (f.typ === "mehrfachwahl") {
    teile.push(
      zahlFeld(
        k,
        b,
        reg,
        f,
        "minAuswahl",
        "Mindestens Antworten (optional)",
        `${pfad}.minAuswahl`,
      ),
      zahlFeld(
        k,
        b,
        reg,
        f,
        "maxAuswahl",
        "Höchstens Antworten (optional)",
        `${pfad}.maxAuswahl`,
      ),
    );
  }
  return teile;
}

export const TYPEN_FORMULAR = {
  formular: {
    name: "Formular",
    kurz: (d) =>
      `${d.titel ? `${d.titel}: ` : ""}${(d.felder ?? []).length} ${(d.felder ?? []).length === 1 ? "Feld" : "Felder"}`,
    pruefe: (d) => [
      ...((d.felder ?? []).length === 0 ? [["daten.felder", "fehlen."]] : []),
      ...(d.datenschutz?.trim()
        ? []
        : [
            [
              "daten.datenschutz",
              "fehlt: Schreibe, wozu die Angaben dienen und wer sie sieht.",
            ],
          ]),
      ...(d.felder ?? []).flatMap((f, i) => {
        const p = `daten.felder.${i}`;
        const texte = [
          f.beschriftung ?? "",
          f.hilfe ?? "",
          ...(f.optionen ?? []),
        ];
        return [
          ...(f.beschriftung?.trim() ? [] : [[`${p}.beschriftung`, "fehlt."]]),
          ...(texte.some(gesundheit)
            ? [
                [
                  `${p}.beschriftung`,
                  "fragt nach Gesundheit. Das ist hier nicht erlaubt: Frage nicht nach Gesundheitsdaten.",
                ],
              ]
            : []),
          ...(MIT_OPTIONEN.includes(f.typ) &&
          ((f.optionen ?? []).length < 2 ||
            new Set(f.optionen).size !== f.optionen.length)
            ? [
                [
                  `${p}.optionen`,
                  "braucht mindestens zwei verschiedene Antworten.",
                ],
              ]
            : []),
        ];
      }),
    ],
    form: (k, b, reg) => {
      const d = b.daten;
      return [
        hilfe(
          "Holt Angaben auf einer Seite ein, zum Beispiel für eine Umfrage, eine Rückmeldung oder eine Bedarfsabfrage. Die Antworten gehen in die Verwaltung unter «Website, Formulare», nie per E-Mail. Wer das Formular ausfüllen darf, bestimmt die Sichtbarkeit der Seite und des Bausteins: Auf einer öffentlichen Seite darf es jede Person, auf einer Seite für Angemeldete nur, wer sie sehen darf. Frage nicht nach Gesundheit, und lade keine Dateien ein: Beides geht hier nicht.",
        ),
        eingabe(k, b, reg, "titel", "Titel (optional)", {
          maxlength: 120,
          optional: true,
        }),
        eingabe(k, b, reg, "einleitung", "Einleitung (optional)", {
          maxlength: 500,
          optional: true,
          mehrzeilig: true,
          rows: 3,
        }),
        listenForm(k, b, {
          name: "Feld",
          listeName: "Felder des Formulars",
          pfadName: "daten.felder",
          liste: () => (d.felder ??= []),
          max: MAX_FELDER,
          hinzuText: "Feld hinzufügen",
          hinzu: (liste, fertig) => {
            liste.push(neuesFeld());
            fertig(liste.length - 1);
          },
          zeile: (f, pfad) => feldZeile(k, b, reg, f, pfad),
        }),
        eingabe(k, b, reg, "datenschutz", "Datenschutzhinweis", {
          maxlength: 600,
          mehrzeilig: true,
          rows: 3,
          hilfe:
            "Pflicht. Schreibe, wozu die Angaben dienen und wer die Antworten sieht, zum Beispiel: «Wir planen damit das Sommerlager. Die Antworten sieht nur die Lagerleitung.» Der Hinweis steht über dem Knopf.",
        }),
        eingabe(k, b, reg, "absenden", "Beschriftung des Knopfs", {
          maxlength: 40,
          optional: true,
          hilfe: `Ohne Eingabe: ${STANDARD.absenden}. Ein Verb, zum Beispiel «Antwort senden».`,
        }),
        eingabe(k, b, reg, "danke", "Text nach dem Senden", {
          maxlength: 300,
          optional: true,
          mehrzeilig: true,
          rows: 2,
          hilfe: `Ohne Eingabe: ${STANDARD.danke}`,
        }),
        el(
          "p",
          { class: "hilfe" },
          "Zeit und Menge: Das Formular nimmt Antworten bis zum letzten Tag an (Mitternacht, Zürcher Zeit) oder bis die Obergrenze erreicht ist.",
        ),
        datumFeld(
          k,
          b,
          reg,
          d,
          "schliesstAm",
          "Letzter Tag für Antworten (optional)",
          "daten.schliesstAm",
          "Ohne Datum bleibt das Formular offen, solange die Seite es zeigt.",
        ),
        zahlFeld(
          k,
          b,
          reg,
          d,
          "maxAntworten",
          "Höchstens Antworten",
          "daten.maxAntworten",
          {
            hilfe: `Ohne Angabe ${STANDARD.maxAntworten}, höchstens 10000. Danach nimmt das Formular nichts mehr an.`,
          },
        ),
        zahlFeld(
          k,
          b,
          reg,
          d,
          "aufbewahrenTage",
          "Antworten löschen nach Tagen",
          "daten.aufbewahrenTage",
          {
            hilfe: `Ohne Angabe ${STANDARD.aufbewahrenTage}, zwischen 7 und 730. Danach löscht der Server die Antworten von selbst.`,
          },
        ),
        haken(
          k,
          b,
          d,
          "eineProPerson",
          "Eine Antwort je angemeldete Person",
          "Gilt nur für angemeldete Personen. Wer nicht angemeldet ist, lässt sich nicht zählen und kann mehrmals antworten.",
        ),
      ];
    },
  },
};

export const KATALOG_FORMULAR = [
  {
    typ: "formular",
    gruppe: "Handlung",
    beschreibung:
      "Angaben einholen: Umfrage, Rückmeldung oder Bedarfsabfrage. Die Antworten gehen in die Verwaltung.",
    neu: () => ({ felder: [neuesFeld()], datenschutz: "" }),
    beispiel: () => ({
      titel: "Umfrage zum Sommerlager",
      einleitung: "Hilf uns bei der Planung.",
      felder: [
        {
          id: "00000000-0000-4000-8000-000000000101",
          typ: "text",
          beschriftung: "Wie heisst du?",
          pflicht: true,
        },
        {
          id: "00000000-0000-4000-8000-000000000102",
          typ: "optionsfelder",
          beschriftung: "Wie lange soll das Lager dauern?",
          pflicht: false,
          optionen: ["Eine Woche", "Zwei Wochen"],
        },
      ],
      datenschutz:
        "Wir planen damit das Lager. Die Antworten sieht nur die Leitung.",
    }),
  },
];

import { ankreuzen, el } from "./dom.js";
import { loescheFeldFehler } from "./website-dialoge.js";
import {
  bildWahl,
  eingabe,
  LINK_HILFE,
  listenForm,
  teilEingabe,
  wahl,
} from "./website-felder.js";

// Bausteine «Einstieg und Handlung» (#743): Formulare und Katalogeinträge. Die Formulare nutzen die Felder aus website-felder.js (Texte, Auswahl, Listen, Bild); diese Datei hängt nur ihre Typen an TYPEN und KATALOG an.
// Die Prüfung im Browser meldet fehlende Pflichtfelder am Feld (Pfad wie beim Server, ohne «bausteine.<n>.»); alles andere prüft der Server beim Speichern.

const kuerze = (text, n = 60) =>
  text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text;

const hilfe = (text) => el("p", { class: "hilfe" }, text);

const KONTAKT_FELDER = [
  ["telefon", "Telefon"],
  ["email", "E-Mail"],
  ["adresse", "Anschrift"],
];

// Angaben der Kontaktleiste: Kästchen in fester Reihenfolge; mindestens eines muss bleiben
function kontaktFelder(k, b, reg) {
  const wurzel = el("fieldset", { class: "feld" });
  wurzel.append(el("legend", { class: "legende" }, "Angaben in der Leiste"));
  const gewaehlt = () => new Set(b.daten.felder ?? []);
  const kaestchen = KONTAKT_FELDER.map(([wert, label]) => {
    const f = ankreuzen({ label, wert, gewaehlt: gewaehlt().has(wert) });
    f.eingabe.addEventListener("change", () => {
      b.daten.felder = KONTAKT_FELDER.map(([w]) => w).filter((w) =>
        w === wert ? f.eingabe.checked : gewaehlt().has(w),
      );
      loescheFeldFehler(wurzel);
      k.aendere(b);
    });
    return f;
  });
  wurzel.append(...kaestchen.map((f) => f.wurzel));
  reg("daten.felder", wurzel, kaestchen[0].eingabe);
  return wurzel;
}

export const TYPEN_HANDLUNG = {
  kopfbereich: {
    name: "Kopfbereich",
    kurz: (d) => d.titel ?? "",
    pruefe: (d) => [
      ...(d.titel?.trim() ? [] : [["daten.titel", "fehlt."]]),
      ...(d.schaltflaechen ?? []).flatMap((s, i) => [
        ...(s.beschriftung?.trim()
          ? []
          : [[`daten.schaltflaechen.${i}.beschriftung`, "fehlt."]]),
        ...(s.ziel?.trim()
          ? []
          : [[`daten.schaltflaechen.${i}.ziel`, "fehlt."]]),
      ]),
    ],
    form: (k, b, reg) => [
      hilfe(
        "Der Einstieg einer Seite oder eines Abschnitts: mit Bild steht ein blauer Kasten über dem Bild, ohne Bild ein blaues Band. Der Titel ist eine Überschrift der Ebene 2.",
      ),
      eingabe(k, b, reg, "titel", "Titel", { maxlength: 120 }),
      eingabe(k, b, reg, "untertitel", "Untertitel (optional)", {
        maxlength: 300,
        optional: true,
        mehrzeilig: true,
        rows: 3,
      }),
      bildWahl(k, b, reg, b.daten, "daten.bild", {
        schluessel: "bild",
        optional: true,
        name: "Bild (optional)",
      }),
      hilfe(
        "Bis zu zwei Schaltflächen. Die erste ist die Hauptaktion der Seite und rot, die zweite hat nur einen Rand.",
      ),
      listenForm(k, b, {
        name: "Schaltfläche",
        listeName: "Schaltflächen",
        pfadName: "daten.schaltflaechen",
        liste: () => b.daten.schaltflaechen ?? [],
        max: 2,
        hinzuText: "Schaltfläche hinzufügen",
        hinzu: (liste, fertig) => {
          // Das Feld entsteht erst mit der ersten Schaltfläche
          const knoepfe = (b.daten.schaltflaechen ??= liste);
          knoepfe.push({ beschriftung: "", ziel: "" });
          fertig(knoepfe.length - 1);
        },
        zeile: (eintrag, pfad) => [
          teilEingabe(
            k,
            b,
            reg,
            eintrag,
            "beschriftung",
            "Beschriftung",
            `${pfad}.beschriftung`,
            { maxlength: 60 },
          ),
          teilEingabe(k, b, reg, eintrag, "ziel", "Ziel", `${pfad}.ziel`, {
            maxlength: 2000,
            spellcheck: "false",
            autocapitalize: "off",
            hilfe: LINK_HILFE,
          }),
        ],
      }),
    ],
  },
  inhaltsverzeichnis: {
    name: "Inhaltsverzeichnis",
    kurz: (d) =>
      `${d.darstellung === "knoepfe" ? "Knöpfe" : "Liste"}${d.titel ? `: ${kuerze(d.titel)}` : ""}`,
    pruefe: () => [],
    form: (k, b, reg) => [
      hilfe(
        "Zeigt «Auf dieser Seite» mit Sprunglinks zu allen Überschriften der Ebene 2 dieser Seite. Die Links entstehen von selbst, auch wenn du Überschriften änderst. Mit weniger als zwei solchen Überschriften erscheint der Baustein nicht.",
      ),
      wahl(k, b, reg, "darstellung", "Darstellung", [
        ["liste", "Liste"],
        ["knoepfe", "Knöpfe"],
      ]),
      eingabe(k, b, reg, "titel", "Titel (optional)", {
        maxlength: 60,
        optional: true,
        hilfe: "Ohne Eingabe steht dort: Auf dieser Seite.",
      }),
    ],
  },
  weiterfuehrend: {
    name: "Weiterführende Links",
    kurz: (d) =>
      (d.eintraege ?? [])
        .map((e) => e.titel)
        .filter(Boolean)
        .join(", "),
    pruefe: (d) => [
      ...((d.eintraege ?? []).length === 0
        ? [["daten.eintraege", "fehlt."]]
        : []),
      ...(d.eintraege ?? []).flatMap((e, i) => [
        ...(e.titel?.trim() ? [] : [[`daten.eintraege.${i}.titel`, "fehlt."]]),
        ...(e.ziel?.trim() ? [] : [[`daten.eintraege.${i}.ziel`, "fehlt."]]),
      ]),
    ],
    form: (k, b, reg) => [
      hilfe(
        "Die ganze Karte oder Zeile ist ein Link, mit Pfeil. Das Ziel ist eine Seite dieser Website oder eine Webadresse mit https; Links auf eine Seite, die Besucher nicht sehen, lässt die Website weg.",
      ),
      wahl(k, b, reg, "darstellung", "Darstellung", [
        ["karten", "Karten"],
        ["liste", "Liste"],
      ]),
      listenForm(k, b, {
        name: "Link",
        listeName: "Links",
        pfadName: "daten.eintraege",
        liste: () => b.daten.eintraege,
        max: 6,
        hinzuText: "Link hinzufügen",
        hinzu: (liste, fertig) => {
          liste.push({ titel: "", ziel: "" });
          fertig(liste.length - 1);
        },
        zeile: (eintrag, pfad) => [
          teilEingabe(k, b, reg, eintrag, "titel", "Titel", `${pfad}.titel`, {
            maxlength: 100,
          }),
          teilEingabe(
            k,
            b,
            reg,
            eintrag,
            "text",
            "Kurztext (optional)",
            `${pfad}.text`,
            { optional: true, maxlength: 200 },
          ),
          teilEingabe(k, b, reg, eintrag, "ziel", "Ziel", `${pfad}.ziel`, {
            maxlength: 2000,
            spellcheck: "false",
            autocapitalize: "off",
            hilfe:
              "Eine Seite dieser Website (zum Beispiel /stufen/woelfe) oder eine Webadresse mit https.",
          }),
        ],
      }),
    ],
  },
  kontaktleiste: {
    name: "Kontaktleiste",
    kurz: (d) =>
      (d.felder ?? [])
        .map((f) => KONTAKT_FELDER.find(([w]) => w === f)?.[1])
        .filter(Boolean)
        .join(", "),
    pruefe: (d) =>
      (d.felder ?? []).length === 0
        ? [["daten.felder", "fehlt. Wähle mindestens eine Angabe."]]
        : [],
    form: (k, b, reg) => [
      hilfe(
        "Eine schmale Karte mit Telefon, E-Mail und Anschrift der Abteilung. Die Werte setzt der Server aus der Konfiguration der Abteilung ein, wie im Fuss der Seite; was dort fehlt, erscheint auch hier nicht.",
      ),
      eingabe(k, b, reg, "titel", "Titel (optional)", {
        maxlength: 60,
        optional: true,
      }),
      kontaktFelder(k, b, reg),
    ],
  },
  weitersagen: {
    name: "Weitersagen",
    kurz: (d) => d.beschriftung ?? "Per E-Mail weitersagen",
    pruefe: () => [],
    form: (k, b, reg) => [
      hilfe(
        "Ein Knopf, der das Mailprogramm der Besuchenden öffnet: mit dem Titel der Seite als Betreff und ihrer Adresse im Text. Nichts geht an einen Dienst von aussen.",
      ),
      eingabe(k, b, reg, "beschriftung", "Beschriftung (optional)", {
        maxlength: 60,
        optional: true,
        hilfe: "Ohne Eingabe steht dort: Per E-Mail weitersagen.",
      }),
      eingabe(k, b, reg, "nachricht", "Satz in der E-Mail (optional)", {
        maxlength: 300,
        optional: true,
        mehrzeilig: true,
        rows: 3,
        hilfe: "Ohne Eingabe steht dort: Das könnte dich interessieren:",
      }),
    ],
  },
  seitenwechsel: {
    name: "Seitenwechsel",
    kurz: () => "Vorherige und nächste Seite",
    pruefe: () => [],
    form: () => [
      hilfe(
        "Zeigt am Ende einer Seite Links auf die vorherige und die nächste Seite im Menü, auf derselben Ebene. Die Reihenfolge ist die des Menüs. Hat die Seite keine Nachbarn, erscheint nichts. In der Vorschau steht ein Beispiel.",
      ),
    ],
  },
  brotkrumen: {
    name: "Brotkrumen",
    kurz: () => "Du bist hier: Start, übergeordnete Seiten, diese Seite",
    pruefe: () => [],
    form: () => [
      hilfe(
        "Zeigt den Weg zur Seite im Menü («Start, Gruppen, Stufe Pilami»), jede Stufe ein Link. Auf der Startseite erscheint nichts. In der Vorschau steht ein Beispiel.",
      ),
    ],
  },
};

// Was «Baustein hinzufügen» anbietet; beispiel: Daten für die Vorschau im Katalog, gruppe: Abschnitt des Katalogs
export const KATALOG_HANDLUNG = [
  {
    typ: "kopfbereich",
    gruppe: "Handlung",
    beschreibung:
      "Grosses Bild mit blauem Kasten, Titel, Untertitel und bis zu zwei Schaltflächen.",
    neu: () => ({ titel: "" }),
    beispiel: () => ({
      // Beispiel-ID: Die Vorschau im Katalog ersetzt jedes Medium durch ein Platzhalterbild
      bild: "00000000-0000-4000-8000-000000000040",
      titel: "Sommerlager 2027",
      untertitel: "Zehn Tage Abenteuer für alle ab neun Jahren.",
      schaltflaechen: [
        { beschriftung: "Zur Anmeldung", ziel: "/anmelden" },
        { beschriftung: "Mehr erfahren", ziel: "/anlaesse" },
      ],
    }),
  },
  {
    typ: "inhaltsverzeichnis",
    gruppe: "Handlung",
    beschreibung: "«Auf dieser Seite»: Sprunglinks zu den Abschnitten.",
    neu: () => ({ darstellung: "liste" }),
    beispiel: () => ({ darstellung: "liste" }),
  },
  {
    typ: "weiterfuehrend",
    gruppe: "Handlung",
    beschreibung: "Ganze Karten oder Zeilen mit Pfeil zu anderen Seiten.",
    neu: () => ({
      darstellung: "karten",
      eintraege: [{ titel: "", ziel: "" }],
    }),
    beispiel: () => ({
      darstellung: "karten",
      eintraege: [
        {
          titel: "Termine",
          text: "Was in den nächsten Wochen ansteht.",
          ziel: "/termine",
        },
        {
          titel: "Mitmachen",
          text: "So kommst du zum Schnuppern.",
          ziel: "/mitmachen",
        },
      ],
    }),
  },
  {
    typ: "kontaktleiste",
    gruppe: "Handlung",
    beschreibung: "Telefon, E-Mail und Anschrift der Abteilung als Leiste.",
    neu: () => ({ felder: ["telefon", "email"] }),
    beispiel: () => ({
      titel: "Fragen?",
      felder: ["telefon", "email", "adresse"],
    }),
  },
  {
    typ: "weitersagen",
    gruppe: "Handlung",
    beschreibung: "Ein Knopf, der eine E-Mail mit dem Link zur Seite öffnet.",
    neu: () => ({}),
    beispiel: () => ({}),
  },
  {
    typ: "seitenwechsel",
    gruppe: "Handlung",
    beschreibung: "Vorherige und nächste Seite aus dem Menü.",
    neu: () => ({}),
    beispiel: () => ({}),
  },
  {
    typ: "brotkrumen",
    gruppe: "Handlung",
    beschreibung: "«Du bist hier»: der Weg zur Seite im Menü.",
    neu: () => ({}),
    beispiel: () => ({}),
  },
];

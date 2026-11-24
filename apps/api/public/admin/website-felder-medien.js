import { el } from "./dom.js";

// Bausteine für Bilder und Medien im Editor (#742): Bildraster, Bild mit Text, Bildvergleich, Logo-Reihe, breites Bild, Bildstreifen, Bilderpaket.
// Die Hilfen (Felder, Bildwahl, Liste) kommen von website-felder.js und werden übergeben, nicht importiert: So entsteht zwischen den Dateien kein Kreis.
// Der Alt-Text liegt am Medium, nie am Baustein; die Bildwahl zeigt ihn und lässt ihn ändern, wer Medien verwalten darf.
// Grenzen wie in src/website/medien-schema.ts.

export const MIN_BILDRASTER = 2;
export const MAX_BILDRASTER = 24;
export const MIN_STREIFEN = 3;
export const MAX_STREIFEN = 30;
export const MAX_LOGOS = 24;

// Beispieladressen: Der Quelltext der Verwaltung nennt keine Adresse im Klartext (seiten.test.ts), darum getrennt geschrieben
const BSP_HTTPS = "https:" + "//";
// Beispielbilder für die Vorschau im Katalog: Platzhalter, nie echte Medien. Die Vorschau setzt für jede ID ein Platzhalterbild ein.
const bild = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const bilderBeispiel = (...n) => n.map((i) => ({ mediumId: bild(i) }));

const FOKUS_X = [
  ["links", "Links"],
  ["mitte", "Mitte"],
  ["rechts", "Rechts"],
];
const FOKUS_Y = [
  ["oben", "Oben"],
  ["mitte", "Mitte"],
  ["unten", "Unten"],
];

export function medienTypen(h) {
  const { eingabe, teilEingabe, wahl, bildWahl, listenForm, linkTeil } = h;
  const { groesseFeld, anzahlText, LINK_HILFE } = h;
  const medienPflicht = (d, k, pfad, mediumId) => {
    if (!mediumId) return [[pfad, "fehlt."]];
    return k?.medien.get(mediumId)?.dekorativ
      ? [[pfad, "hat keinen Alt-Text."]]
      : [];
  };

  // Eine Liste von Bildern (Raster, Streifen, Logos); extra baut die Felder neben dem Bild
  function bilderListe(k, b, reg, { name, listeName, max, alt, extra }) {
    return listenForm(k, b, {
      name,
      listeName,
      pfadName: "daten.bilder",
      liste: () => b.daten.bilder,
      max,
      hinzuText: "Bild hinzufügen",
      hinzu: (liste, fertig) =>
        k.waehleBild((m) => {
          k.medien.set(m.id, m);
          liste.push({ mediumId: m.id });
          fertig(liste.length - 1);
        }),
      zeile: (eintrag, pfad) => [
        bildWahl(k, b, reg, eintrag, `${pfad}.mediumId`, { alt, klein: true }),
        ...extra(eintrag, pfad),
      ],
    });
  }
  const unterschrift = (k, b, reg) => (eintrag, pfad) => [
    teilEingabe(
      k,
      b,
      reg,
      eintrag,
      "unterschrift",
      "Bildunterschrift (optional)",
      `${pfad}.unterschrift`,
      { optional: true, maxlength: 300 },
    ),
  ];
  const listePruefung = (d, min, k, mitAlt) => [
    ...((d.bilder ?? []).length < min
      ? [["daten.bilder", `braucht mindestens ${min} Bilder.`]]
      : []),
    ...(d.bilder ?? []).flatMap((x, i) =>
      mitAlt
        ? medienPflicht(d, k, `daten.bilder.${i}.mediumId`, x.mediumId)
        : x.mediumId
          ? []
          : [[`daten.bilder.${i}.mediumId`, "fehlt."]],
    ),
  ];

  return {
    bildraster: {
      name: "Bildraster",
      kurz: (d) =>
        `${anzahlText(d.bilder?.length ?? 0, "1 Bild", "Bilder")} in ${d.spalten ?? ""} Spalten`,
      pruefe: (d) => listePruefung(d, MIN_BILDRASTER),
      form: (k, b, reg) => [
        el(
          "p",
          { class: "hilfe" },
          "Bilder im gleichen Format nebeneinander, zum Beispiel Eindrücke aus einem Lager. Ein Klick öffnet das Bild gross.",
        ),
        wahl(k, b, reg, "spalten", "Spalten", [
          [2, "2"],
          [3, "3"],
          [4, "4"],
        ]),
        wahl(k, b, reg, "format", "Format der Bilder", [
          ["quer", "Quer (4 : 3)"],
          ["quadrat", "Quadrat"],
          ["hoch", "Hoch (3 : 4)"],
        ]),
        bilderListe(k, b, reg, {
          name: "Rasterbild",
          listeName: "Bilder des Rasters",
          max: MAX_BILDRASTER,
          alt: "zeigen",
          extra: unterschrift(k, b, reg),
        }),
      ],
    },
    bildtext: {
      name: "Bild mit Text",
      kurz: (d) => d.titel ?? "",
      pruefe: (d) => [
        ...(d.mediumId ? [] : [["daten.mediumId", "fehlt."]]),
        ...(d.titel?.trim() ? [] : [["daten.titel", "fehlt."]]),
        ...(d.link && !d.link.beschriftung?.trim()
          ? [["daten.link.beschriftung", "fehlt."]]
          : []),
        ...(d.link && !d.link.ziel?.trim()
          ? [["daten.link.ziel", "fehlt."]]
          : []),
      ],
      form: (k, b, reg) => [
        el(
          "p",
          { class: "hilfe" },
          "Titel und Text stehen auf dem Bild, auf einem dunklen Verlauf. So bleiben sie auch bei einem hellen Foto lesbar.",
        ),
        bildWahl(k, b, reg, b.daten, "daten.mediumId", { alt: "zeigen" }),
        eingabe(k, b, reg, "titel", "Titel", { maxlength: 100 }),
        eingabe(k, b, reg, "text", "Text (optional)", {
          maxlength: 500,
          optional: true,
          mehrzeilig: true,
          rows: 3,
        }),
        wahl(k, b, reg, "position", "Lage des Textes", [
          ["unten", "Unten"],
          ["mitte", "Über das ganze Bild"],
        ]),
        el(
          "p",
          { class: "hilfe" },
          "Der Link ist freiwillig. Lass beide Felder leer, wenn der Text allein steht.",
        ),
        teilEingabe(
          k,
          b,
          reg,
          linkTeil(b),
          "beschriftung",
          "Beschriftung des Links (optional)",
          "daten.link.beschriftung",
          { optional: true, maxlength: 60 },
        ),
        teilEingabe(
          k,
          b,
          reg,
          linkTeil(b),
          "ziel",
          "Ziel des Links (optional)",
          "daten.link.ziel",
          {
            optional: true,
            maxlength: 2000,
            spellcheck: "false",
            hilfe: LINK_HILFE,
          },
        ),
      ],
    },
    bildvergleich: {
      name: "Bildvergleich",
      kurz: (d) => d.unterschrift || "Vorher und Nachher",
      pruefe: (d, k) => [
        ...medienPflicht(
          d,
          k,
          "daten.bilder.0.mediumId",
          d.bilder?.[0]?.mediumId,
        ),
        ...medienPflicht(
          d,
          k,
          "daten.bilder.1.mediumId",
          d.bilder?.[1]?.mediumId,
        ),
      ],
      form: (k, b, reg) => [
        el(
          "p",
          { class: "hilfe" },
          "Zwei Bilder desselben Ortes, zum Beispiel vor und nach dem Umbau. Mit einem Schieber zieht man die Kante über das Bild; ohne Skript stehen beide Bilder mit ihrer Bezeichnung nebeneinander. Mach beide im gleichen Ausschnitt.",
        ),
        bildWahl(k, b, reg, b.daten.bilder[0], "daten.bilder.0.mediumId", {
          alt: "pflicht",
          name: "Bild links (Vorher)",
        }),
        bildWahl(k, b, reg, b.daten.bilder[1], "daten.bilder.1.mediumId", {
          alt: "pflicht",
          name: "Bild rechts (Nachher)",
        }),
        eingabe(k, b, reg, "vorherText", "Bezeichnung links (optional)", {
          maxlength: 30,
          optional: true,
          hilfe: "Ohne Eingabe steht dort: Vorher.",
        }),
        eingabe(k, b, reg, "nachherText", "Bezeichnung rechts (optional)", {
          maxlength: 30,
          optional: true,
          hilfe: "Ohne Eingabe steht dort: Nachher.",
        }),
        eingabe(k, b, reg, "unterschrift", "Bildunterschrift (optional)", {
          maxlength: 300,
          optional: true,
        }),
      ],
    },
    logoreihe: {
      name: "Logo-Reihe",
      kurz: (d) => anzahlText(d.bilder?.length ?? 0, "1 Logo", "Logos"),
      pruefe: (d, k) => listePruefung(d, 1, k, true),
      form: (k, b, reg) => [
        el(
          "p",
          { class: "hilfe" },
          "Logos von Partnern, Sponsoren und Dachverbänden. Der Alt-Text ist der Name der Organisation: Er gehört zum Bild und steht in der Medienbibliothek. Jedes Logo steht auf einer hellen Kachel.",
        ),
        wahl(k, b, reg, "darstellung", "Darstellung", [
          ["farbig", "In Farbe"],
          ["grau", "In Graustufen (Farbe beim Zeigen)"],
        ]),
        bilderListe(k, b, reg, {
          name: "Logo",
          listeName: "Logos",
          max: MAX_LOGOS,
          alt: "pflicht",
          extra: (eintrag, pfad) => [
            teilEingabe(
              k,
              b,
              reg,
              eintrag,
              "link",
              "Link zur Organisation (optional)",
              `${pfad}.link`,
              {
                optional: true,
                maxlength: 2000,
                spellcheck: "false",
                autocapitalize: "off",
                hilfe:
                  "Eine Webadresse mit https oder eine Seite dieser Website (zum Beispiel /partner).",
              },
            ),
          ],
        }),
      ],
    },
    panorama: {
      name: "Breites Bild",
      kurz: (d) =>
        [d.unterschrift, `Höhe ${d.hoehe ?? ""}`].filter(Boolean).join(" · "),
      pruefe: (d) => [
        ...(d.mediumId ? [] : [["daten.mediumId", "fehlt."]]),
        ...(d.hoehe ? [] : [["daten.hoehe", "fehlt."]]),
      ],
      form: (k, b, reg) => [
        el(
          "p",
          { class: "hilfe" },
          "Ein Bild über die ganze Breite mit begrenzter Höhe. Der Fokus bestimmt, welcher Teil des Bildes stehen bleibt, wenn der Ausschnitt schmaler ist (zum Beispiel am Handy). Ein Klick öffnet das ganze Bild.",
        ),
        bildWahl(k, b, reg, b.daten, "daten.mediumId", { alt: "zeigen" }),
        wahl(k, b, reg, "hoehe", "Höhe", [
          ["niedrig", "Niedrig"],
          ["mittel", "Mittel"],
          ["hoch", "Hoch"],
        ]),
        wahl(k, b, reg, "fokusX", "Fokus waagrecht", FOKUS_X),
        wahl(k, b, reg, "fokusY", "Fokus senkrecht", FOKUS_Y),
        eingabe(k, b, reg, "unterschrift", "Bildunterschrift (optional)", {
          maxlength: 300,
          optional: true,
        }),
      ],
    },
    bildstreifen: {
      name: "Bildstreifen",
      kurz: (d) => anzahlText(d.bilder?.length ?? 0, "1 Bild", "Bilder"),
      pruefe: (d) => listePruefung(d, MIN_STREIFEN),
      form: (k, b, reg) => [
        el(
          "p",
          { class: "hilfe" },
          "Ein Band mit vielen Bildern zum Scrollen und Wischen. Es bewegt sich nie von selbst, das nächste Bild schaut rechts heraus. Für ein Band mit Wechsel von selbst nimm das Karussell.",
        ),
        bilderListe(k, b, reg, {
          name: "Streifenbild",
          listeName: "Bilder des Streifens",
          max: MAX_STREIFEN,
          alt: "zeigen",
          extra: unterschrift(k, b, reg),
        }),
      ],
    },
    bilderpaket: {
      name: "Bilderpaket zum Herunterladen",
      kurz: (d) => d.titel ?? "",
      pruefe: (d) => [
        ...(d.titel?.trim() ? [] : [["daten.titel", "fehlt."]]),
        ...(d.link?.trim() ? [] : [["daten.link", "fehlt."]]),
        ...(d.groesse === undefined || d.groesse >= 0
          ? []
          : [["daten.groesse", "ist eine Zahl ab 0."]]),
        ...(d.anzahl === undefined ||
        (Number.isInteger(d.anzahl) && d.anzahl >= 1)
          ? []
          : [["daten.anzahl", "ist eine ganze Zahl ab 1."]]),
      ],
      form: (k, b, reg) => [
        el(
          "p",
          { class: "hilfe" },
          "Fotos zum Herunterladen mit einem Vorschaubild. Die Dateien liegen im SharePoint der Abteilung und werden nur verknüpft; prüfe dort, wer den Link öffnen darf.",
        ),
        eingabe(k, b, reg, "titel", "Titel", { maxlength: 100 }),
        eingabe(k, b, reg, "text", "Beschreibung (optional)", {
          maxlength: 500,
          optional: true,
          mehrzeilig: true,
          rows: 3,
        }),
        eingabe(k, b, reg, "link", "Link zu den Dateien", {
          maxlength: 2048,
          spellcheck: "false",
          autocapitalize: "off",
          hilfe:
            "Der Freigabelink im SharePoint der Abteilung. Er beginnt mit https.",
        }),
        bildWahl(k, b, reg, b.daten, "daten.bild", {
          schluessel: "bild",
          optional: true,
          name: "Vorschaubild (optional)",
        }),
        eingabe(k, b, reg, "typ", "Dateityp (optional)", {
          maxlength: 20,
          optional: true,
          hilfe: "Zum Beispiel ZIP.",
        }),
        eingabe(k, b, reg, "anzahl", "Anzahl Bilder (optional)", {
          zahl: true,
          inputmode: "numeric",
          class: "ws-kurzfeld",
        }),
        groesseFeld(k, b, reg),
      ],
    },
  };
}

// Einträge für «Baustein hinzufügen»: neu() legt die Felder an, die der Server verlangt; beispiel() liefert Daten für die Vorschau im Katalog
export const MEDIEN_KATALOG = [
  {
    typ: "bildraster",
    gruppe: "Bilder und Medien",
    beschreibung: "Bilder im gleichen Format in 2 bis 4 Spalten.",
    neu: () => ({
      spalten: 3,
      format: "quer",
      bilder: [{}, {}],
    }),
    beispiel: () => ({
      spalten: 3,
      format: "quer",
      bilder: [
        { ...bilderBeispiel(1)[0], unterschrift: "Am Feuer" },
        { ...bilderBeispiel(2)[0], unterschrift: "Im Wald" },
        { ...bilderBeispiel(3)[0], unterschrift: "Auf dem Platz" },
      ],
    }),
  },
  {
    typ: "bildtext",
    gruppe: "Bilder und Medien",
    beschreibung: "Ein Bild mit Titel und Text darauf.",
    neu: () => ({ titel: "", position: "unten" }),
    beispiel: () => ({
      mediumId: bild(1),
      titel: "Sommerlager",
      text: "Zwei Wochen im Wald mit Zelt, Feuer und Freunden.",
      position: "unten",
      link: { beschriftung: "Mehr zum Lager", ziel: "/lager" },
    }),
  },
  {
    typ: "bildvergleich",
    gruppe: "Bilder und Medien",
    beschreibung: "Vorher und Nachher mit einem Schieber.",
    neu: () => ({ bilder: [{}, {}] }),
    beispiel: () => ({ bilder: bilderBeispiel(1, 2) }),
  },
  {
    typ: "logoreihe",
    gruppe: "Bilder und Medien",
    beschreibung: "Logos von Partnern, Sponsoren und Verbänden.",
    neu: () => ({ darstellung: "farbig", bilder: [{}] }),
    beispiel: () => ({
      darstellung: "farbig",
      bilder: bilderBeispiel(1, 2, 3, 4),
    }),
  },
  {
    typ: "panorama",
    gruppe: "Bilder und Medien",
    beschreibung: "Ein breites Bild mit begrenzter Höhe und Fokus.",
    neu: () => ({ hoehe: "mittel", fokusX: "mitte", fokusY: "mitte" }),
    beispiel: () => ({
      mediumId: bild(1),
      hoehe: "mittel",
      fokusX: "mitte",
      fokusY: "mitte",
      unterschrift: "Blick über den Zeltplatz",
    }),
  },
  {
    typ: "bildstreifen",
    gruppe: "Bilder und Medien",
    beschreibung: "Viele Bilder in einem Band zum Scrollen.",
    neu: () => ({ bilder: [{}, {}, {}] }),
    beispiel: () => ({ bilder: bilderBeispiel(1, 2, 3, 4, 5) }),
  },
  {
    typ: "bilderpaket",
    gruppe: "Bilder und Medien",
    beschreibung:
      "Fotos aus dem SharePoint mit Vorschaubild zum Herunterladen.",
    neu: () => ({ titel: "", link: "" }),
    beispiel: () => ({
      titel: "Fotos Sommerlager",
      text: "Alle Fotos des Lagers in guter Qualität.",
      link: `${BSP_HTTPS}example.sharepoint.com/fotos`,
      bild: bild(1),
      typ: "ZIP",
      anzahl: 120,
      groesse: 250_000_000,
    }),
  },
];

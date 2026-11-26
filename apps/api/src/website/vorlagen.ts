import { randomUUID } from "node:crypto";
import { MAX_SEITENTITEL, type Baustein } from "./bausteine.js";
import type { Seitendokument } from "./dokument.js";

// Startvorlagen für neue Seiten (#352): Code, kein Datenbankinhalt (versioniert, testbar, keine Migration).
// Eine Vorlage ist nur ein vorbefüllter, gültiger Satz Bausteine; danach ist alles frei änderbar.
// Die Platzhaltertexte sind Anleitungen («Beschreibe hier …»), keine erfundenen Inhalte, und nennen keine Namen.

export const VORLAGEN_SCHLUESSEL = [
  "stufenseite",
  "anlass",
  "textseite",
  "anmeldung",
  "leer",
] as const;
export type Vorlage = (typeof VORLAGEN_SCHLUESSEL)[number];

export type VorlagenInfo = {
  name: string;
  beschreibung: string;
  // Stufenseite: Leitungsteam und Termine hängen am Tag der Gruppe
  brauchtTag: boolean;
};

const absatz = (text: string) => ({
  typ: "absatz" as const,
  inhalt: [{ text }],
});
const ueberschrift = (text: string): Baustein => ({
  id: randomUUID(),
  typ: "ueberschrift",
  daten: { ebene: 2, text },
  sichtbarkeit: "erbt",
});
const text = (...absaetze: string[]): Baustein => ({
  id: randomUUID(),
  typ: "text",
  daten: { inhalt: absaetze.map(absatz) },
  sichtbarkeit: "erbt",
});

// Das Anmeldeformular (#881) für die Vorlage «Anmeldung» und den Befehl anmeldeformular.ts: dieselben Felder wie die frühere Anleitung «Schreib uns eine E-Mail». Feld-IDs sind bei jedem Aufruf neu.
// Die Schulklasse ist eine Auswahl, damit die Abteilungsleitung nach Stufe sortieren kann.
export const ANMELDUNG_ABSCHNITT = "So meldest du dich an";
export const SCHULKLASSEN = [
  "Kindergarten",
  "1. Klasse",
  "2. Klasse",
  "3. Klasse",
  "4. Klasse",
  "5. Klasse",
  "6. Klasse",
  "1. Sek",
  "2. Sek",
  "3. Sek",
  "Gymnasium",
];
export function anmeldeFormular(titel?: string): Baustein {
  const id = () => randomUUID();
  return {
    id: id(),
    typ: "formular",
    sichtbarkeit: "erbt",
    daten: {
      ...(titel && { titel }),
      einleitung:
        "Die Anmeldung läuft über die Abteilungsleitung. Fülle das Formular aus und sende es ab. Die Abteilungsleitung meldet sich danach bei dir.",
      felder: [
        {
          id: id(),
          typ: "text",
          beschriftung: "Vorname",
          pflicht: true,
          maxLaenge: 100,
          autocomplete: "given-name",
        },
        {
          id: id(),
          typ: "text",
          beschriftung: "Nachname",
          pflicht: true,
          maxLaenge: 100,
          autocomplete: "family-name",
        },
        {
          id: id(),
          typ: "datum",
          beschriftung: "Geburtsdatum",
          pflicht: true,
          autocomplete: "bday",
        },
        {
          id: id(),
          typ: "text",
          beschriftung: "Strasse und Nummer",
          pflicht: true,
          maxLaenge: 200,
          autocomplete: "street-address",
        },
        {
          id: id(),
          typ: "text",
          beschriftung: "Postleitzahl",
          pflicht: true,
          minLaenge: 4,
          maxLaenge: 10,
          autocomplete: "postal-code",
        },
        {
          id: id(),
          typ: "text",
          beschriftung: "Ort",
          pflicht: true,
          maxLaenge: 100,
          autocomplete: "address-level2",
        },
        {
          id: id(),
          typ: "email",
          beschriftung: "E-Mail-Adresse",
          pflicht: true,
        },
        {
          id: id(),
          typ: "auswahl",
          beschriftung: "Aktuelle Schulklasse",
          pflicht: true,
          optionen: SCHULKLASSEN,
        },
        {
          id: id(),
          typ: "text",
          beschriftung: "Notfallkontakt: Name",
          hilfe: "Eine Person, die wir im Notfall erreichen können.",
          pflicht: true,
          maxLaenge: 100,
        },
        {
          id: id(),
          typ: "telefon",
          beschriftung: "Notfallkontakt: Telefonnummer",
          hilfe: "Zum Beispiel 079 123 45 67.",
          pflicht: true,
        },
        {
          id: id(),
          typ: "text",
          beschriftung: "Cevi-Name",
          hilfe: "Wenn du schon einen hast.",
          pflicht: false,
          maxLaenge: 100,
        },
      ],
      datenschutz:
        "Wir brauchen die Angaben, um deine Anmeldung zu bearbeiten und im Notfall jemanden zu erreichen. Sie sieht nur die Abteilungsleitung und wer von ihr das Recht dazu bekommt.",
      absenden: "Anmeldung senden",
      danke:
        "Danke für deine Anmeldung. Die Abteilungsleitung meldet sich bei dir.",
      eineProPerson: false,
      aufbewahrenTage: 180,
      maxAntworten: 2000,
    },
  };
}

type Eintrag = VorlagenInfo & {
  bausteine: (tagId: string | undefined) => Baustein[];
};

const EINTRAEGE: Record<Vorlage, Eintrag> = {
  stufenseite: {
    name: "Stufenseite",
    beschreibung:
      "Samstagsangaben der Stufe, ein Text über die Stufe, das Leitungsteam und die nächsten Termine.",
    brauchtTag: true,
    bausteine: (tagId) => [
      ueberschrift("Das Wichtigste auf einen Blick"),
      {
        id: randomUUID(),
        typ: "stufenfakten",
        daten: {},
        sichtbarkeit: "erbt",
      },
      ueberschrift("Über die Stufe"),
      text(
        "Beschreibe hier, was diese Stufe ausmacht und was die Kinder bei uns erleben.",
        "Ersetze diesen Text durch deine eigenen Worte.",
      ),
      ueberschrift("Leitungsteam"),
      {
        id: randomUUID(),
        typ: "leitungsteam",
        daten: { tagId: tagId!, zusatz: [] },
        sichtbarkeit: "erbt",
      },
      ueberschrift("Nächste Termine"),
      {
        id: randomUUID(),
        typ: "terminliste",
        daten: { tagId: tagId!, anzahl: 5 },
        sichtbarkeit: "erbt",
      },
    ],
  },
  anlass: {
    name: "Anlass",
    beschreibung:
      "Worum es geht, wann und wo, mit einem Platz für die Termine des Anlasses.",
    brauchtTag: false,
    bausteine: () => [
      ueberschrift("Worum geht es?"),
      text("Beschreibe hier den Anlass in zwei bis drei Sätzen."),
      ueberschrift("Wann und wo?"),
      text("Nenne hier Datum, Zeit und Treffpunkt."),
      ueberschrift("Termine"),
      {
        id: randomUUID(),
        typ: "terminliste",
        daten: { anzahl: 3 },
        sichtbarkeit: "erbt",
      },
    ],
  },
  textseite: {
    name: "Textseite",
    beschreibung: "Eine Überschrift und ein Text zum Weiterschreiben.",
    brauchtTag: false,
    bausteine: () => [
      ueberschrift("Überschrift"),
      text("Schreibe hier deinen Text."),
    ],
  },
  anmeldung: {
    name: "Anmeldung",
    beschreibung:
      "Ein Anmeldeformular mit Name, Geburtsdatum, Adresse, Schulklasse und Notfallkontakt. Die Anmeldungen erscheinen unter «Website, Formulare».",
    brauchtTag: false,
    bausteine: () => [ueberschrift(ANMELDUNG_ABSCHNITT), anmeldeFormular()],
  },
  leer: {
    name: "Leere Seite",
    beschreibung: "Eine Seite ohne Bausteine.",
    brauchtTag: false,
    bausteine: () => [],
  },
};

// Für die Liste der Routen: nie die Dokumente selbst
export const vorlagenInfos = (): ({ schluessel: Vorlage } & VorlagenInfo)[] =>
  VORLAGEN_SCHLUESSEL.map((schluessel) => ({
    schluessel,
    name: EINTRAEGE[schluessel].name,
    beschreibung: EINTRAEGE[schluessel].beschreibung,
    brauchtTag: EINTRAEGE[schluessel].brauchtTag,
  }));

export const vorlageBrauchtTag = (vorlage: Vorlage) =>
  EINTRAEGE[vorlage].brauchtTag;

// Ein frisches Dokument: Baustein-IDs sind bei jedem Aufruf neu. tagId ist bei «stufenseite» Pflicht (vorlageBrauchtTag)
export function dokumentAusVorlage(
  vorlage: Vorlage,
  titel: string,
  tagId?: string,
): Seitendokument {
  const eintrag = EINTRAEGE[vorlage];
  if (eintrag.brauchtTag && tagId === undefined) {
    throw new Error("Die Vorlage braucht einen Tag");
  }
  return {
    v: 1,
    titel: titel.trim().slice(0, MAX_SEITENTITEL),
    bausteine: eintrag.bausteine(tagId),
  };
}

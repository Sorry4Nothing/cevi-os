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

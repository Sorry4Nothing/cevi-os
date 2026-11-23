import type { Geltung, RechtId } from "./katalog.js";

// Was im Code fest steht und keine Zeile in der Datenbank braucht (#643). Alles andere stellt die Abteilungsleitung in der Matrix ein.
// Jede Zeile hier bildet ein Verhalten ab, das es vor dem Rechtemodell schon gab; der Test rechtemodell-standard.test.ts hält sie gegen die alten Funktionen.

export interface Zuteilung {
  recht: RechtId;
  geltung: Geltung;
}
const z = (recht: RechtId, geltung: Geltung): Zuteilung => ({ recht, geltung });

// Stufenrollen (Leitung und Stufenleitung, Sicht «rolle» auf person_tag; rechte.ts). «eigene» heisst hier: die Stufe der Rolle (objekt.stufeId). Die Stufenleitung bearbeitet und veröffentlicht die Seiten ihrer Stufe ohne zweiten Faktor (Entscheid vom 22.11.2026); diese Ausnahme steht in rechtemodell/pruefung.ts (keinZweiterFaktor)
export const STUFENROLLEN_STANDARD = {
  stufenleitung: [
    z("seiten.bearbeiten", "eigene"),
    z("seiten.veroeffentlichen", "eigene"),
    z("vorschlag.einreichen", "alle"),
    z("raum.belegung", "alle"),
    // Programme und Stufenarbeit wie vor dem Rechtemodell (#650): «adminOderSl» sieht jedes Programm; Leitung und Stufenleitung führen die Anwesenheit ihrer Stufe, sehen die Teilnahmen der Kinder und die Kontakte der Stufe
    z("programm.alle_sehen", "alle"),
    z("anwesenheit.fuehren", "eigene"),
    z("stufe.einblick", "eigene"),
  ],
  leitung: [
    z("vorschlag.einreichen", "alle"),
    z("raum.belegung", "alle"),
    z("anwesenheit.fuehren", "eigene"),
    z("stufe.einblick", "eigene"),
  ],
} as const satisfies Record<"leitung" | "stufenleitung", readonly Zuteilung[]>;

// Rechte, die ohne zweiten Faktor gelten, obwohl ihr Eintrag «erweitert» ist: nur die Arbeit der Stufenleitung an der eigenen Stufenseite
export const OHNE_ZWEITEN_FAKTOR: ReadonlySet<RechtId> = new Set([
  "seiten.bearbeiten",
  "seiten.veroeffentlichen",
]);

// Die Stufenarbeit (#650): Anwesenheit, Teilnahmen und Kontakte liefen schon vor dem Rechtemodell ohne zweiten Faktor, für Leitung und Stufenleitung und für die Abteilungsleitung (Entscheid #523: der Faktor gilt nur im Web, unter /api/v1/admin). Eine Gruppenrolle oder Plattformrolle mit diesen Rechten braucht ihn, wie jedes erweiterte Recht
export const OHNE_ZWEITEN_FAKTOR_STUFENARBEIT: ReadonlySet<RechtId> = new Set([
  "anwesenheit.fuehren",
  "stufe.einblick",
]);

// Mitgliedschaft in einer Gruppe gibt ohne Rolle schon etwas (Annahme A9 und R2 der Termine): Terminvorschläge für Funktion und Team, Raumanfragen entscheiden für das Team des Raums. «eigene» ist die Gruppe selbst. raum.belegung gilt für Mitglieder einer Gruppe, die ein Raum als Team führt (siehe satz.ts, istRaumTeam)
export const MITGLIED_STANDARD = {
  team: [
    z("vorschlag.einreichen", "alle"),
    z("raum.anfrage_entscheiden", "eigene"),
  ],
  funktion: [z("vorschlag.einreichen", "alle")],
} as const satisfies Partial<Record<string, readonly Zuteilung[]>>;
export const RAUM_TEAM_STANDARD: readonly Zuteilung[] = [
  z("raum.belegung", "alle"),
];

// Systemrollen jeder Gruppe: Die Datenbank legt sie an (gruppen_rolle.schluessel), die Verwaltung benennt und löscht sie nie, ihre Rechte sind einstellbar. person_tag.rolle_id folgt dem Freitext der Rolle (Trigger person_tag_rolle_abgleich): «leitung» und «stufenleitung» an einer Stufe, «verantwortlich» an jeder anderen Gruppe.
export const SYSTEMROLLEN = {
  stufe: [
    {
      schluessel: "stufenleitung",
      name: "Stufenleitung",
      beschreibung: "Stufenleitung der Stufe",
      verantwortlich: false,
      reihenfolge: 1,
      rechte: [],
    },
    {
      schluessel: "leitung",
      name: "Leitung",
      beschreibung: "Leitung der Stufe",
      verantwortlich: false,
      reihenfolge: 2,
      rechte: [],
    },
  ],
  andere: [
    {
      schluessel: "verantwortlich",
      name: "Verantwortliche/r",
      beschreibung: "Verantwortlich für die Gruppe",
      verantwortlich: true,
      reihenfolge: 1,
      // Bisher: Verantwortliche eines Teams bearbeiten und veröffentlichen die Seite des Teams (#352) und sehen die Belegung der Räume (#628). Sie gelten als Standard der Systemrolle und lassen sich in der Matrix ändern
      rechte: {
        team: [
          z("seiten.bearbeiten", "eigene"),
          z("seiten.veroeffentlichen", "eigene"),
          z("raum.belegung", "alle"),
        ],
      } as Partial<Record<string, readonly Zuteilung[]>>,
    },
  ],
} as const;

export type Systemschluessel = "leitung" | "stufenleitung" | "verantwortlich";

// Die Systemrollen und ihre Standardrechte für eine neue Gruppe des Typs
export function systemrollenFuer(typ: string) {
  if (typ === "stufe") {
    return SYSTEMROLLEN.stufe.map((r) => ({ ...r, rechte: [] as Zuteilung[] }));
  }
  return SYSTEMROLLEN.andere.map((r) => ({
    ...r,
    rechte: [...(r.rechte[typ] ?? [])],
  }));
}

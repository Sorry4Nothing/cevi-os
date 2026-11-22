import { describe, expect, test } from "vitest";
import {
  LAGER_RECHTE,
  LAGER_ROLLEN,
  RECHTE_KATALOG,
  standardErlaubt,
  type LagerRecht,
  type LagerRolle,
} from "../../src/lager/rechte-katalog.js";

// Literale Listen aus dem Plan «Rechtekatalog und Standardmatrix» (Spalten Leitung, Team, Lesen), nie aus dem Katalog berechnet
const ERLAUBT: Record<Exclude<LagerRolle, "lagerleitung">, string[]> = {
  leitung: [
    "ressorts.lesen",
    "aufgaben.lesen_alle",
    "aufgaben.bearbeiten",
    "aufgaben.eigene",
    "zeitplan.lesen",
    "check.lesen",
    "hoecks.lesen_alle",
    "hoecks.team_lesen",
    "hoecks.bearbeiten",
    "protokolle.lesen",
    "protokolle.bearbeiten",
    "pinnwand.lesen",
    "pinnwand.bearbeiten",
    "interaktion.schreiben",
    "eingang.senden",
    "teilnehmer.lesen",
    "einteilung.lesen",
    "einteilung.bearbeiten",
    "abzaehlen.schreiben",
    "diensttausch.anfragen",
    "diensttausch.entscheiden",
    "anwesenheit.lesen_alle",
    "anwesenheit.eigene",
    "tagesseiten.lesen",
    "tagesseiten.bearbeiten",
    "einkauf.lesen",
    "einkauf.bearbeiten",
    "packliste.lesen",
    "packliste.abhaken",
    "notfall.lesen",
    "infos.lesen",
    "wetter.lesen",
    "dokumente.lesen_alle",
    "dokumente.team_lesen",
    "dokumente.bearbeiten",
    "verlauf.lesen",
  ],
  team: [
    "aufgaben.eigene",
    "zeitplan.lesen",
    "hoecks.team_lesen",
    "pinnwand.lesen",
    "interaktion.schreiben",
    "eingang.senden",
    "teilnehmer.lesen",
    "einteilung.lesen",
    "abzaehlen.schreiben",
    "diensttausch.anfragen",
    "anwesenheit.eigene",
    "packliste.lesen",
    "packliste.abhaken",
    "notfall.lesen",
    "infos.lesen",
    "wetter.lesen",
    "dokumente.team_lesen",
  ],
  lesen: [
    "ressorts.lesen",
    "aufgaben.lesen_alle",
    "zeitplan.lesen",
    "check.lesen",
    "hoecks.lesen_alle",
    "hoecks.team_lesen",
    "protokolle.lesen",
    "pinnwand.lesen",
    "teilnehmer.lesen",
    "einteilung.lesen",
    "anwesenheit.lesen_alle",
    "tagesseiten.lesen",
    "einkauf.lesen",
    "packliste.lesen",
    "notfall.lesen",
    "infos.lesen",
    "wetter.lesen",
    "dokumente.lesen_alle",
    "dokumente.team_lesen",
    "verlauf.lesen",
  ],
};

describe("Rechtekatalog", () => {
  test("49 Rechte im Schema <bereich>.<aktion>, jedes mit Bedeutung", () => {
    expect(LAGER_RECHTE).toHaveLength(49);
    for (const recht of LAGER_RECHTE) {
      expect(recht).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(RECHTE_KATALOG[recht].bedeutung.length).toBeGreaterThan(5);
    }
  });

  test("die Lagerleitung hat jedes Recht", () => {
    for (const recht of LAGER_RECHTE) {
      expect(standardErlaubt("lagerleitung", recht), recht).toBe(true);
    }
  });

  test.each(["leitung", "team", "lesen"] as const)(
    "%s: genau die Rechte der Standardmatrix",
    (rolle) => {
      const erlaubt = LAGER_RECHTE.filter((r) => standardErlaubt(rolle, r));
      expect(erlaubt.sort()).toEqual([...ERLAUBT[rolle]].sort());
    },
  );

  test("nur die Lagerleitung: Eingänge lesen und beantworten, Adressbuch, Vertrauliches, Zeitplan, Teilnehmende und Notfall ändern", () => {
    for (const recht of [
      "eingang.lesen",
      "eingang.antworten",
      "adressbuch.lesen",
      "adressbuch.bearbeiten",
      "vertrauliches.lesen",
      "zeitplan.bearbeiten",
      "teilnehmer.bearbeiten",
      "notfall.bearbeiten",
      "ressorts.bearbeiten",
      "vorlagen.anwenden",
    ] as const) {
      for (const rolle of ["leitung", "team", "lesen"] as const) {
        expect(standardErlaubt(rolle, recht), `${rolle} ${recht}`).toBe(false);
      }
    }
  });

  test("Lesen schreibt nichts: kein Recht, das nicht mit .lesen, .lesen_alle oder .team_lesen endet", () => {
    for (const recht of LAGER_RECHTE) {
      if (/\.(lesen|lesen_alle|team_lesen)$/.test(recht)) continue;
      expect(standardErlaubt("lesen", recht), recht).toBe(false);
    }
  });

  test("ein unbekanntes Recht ist für jede Rolle verboten", () => {
    for (const rolle of LAGER_ROLLEN) {
      expect(standardErlaubt(rolle, "gibt.es.nicht" as LagerRecht)).toBe(false);
    }
  });
});

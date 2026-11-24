import { describe, expect, test } from "vitest";
import { PLATTFORM_RECHT_NAMEN, PLATTFORM_RECHTE } from "../src/plattform.js";
import {
  BEREICHE,
  GRUPPENROLLEN_RECHTE,
  RECHT_IDS,
  RECHTE_KATALOG,
  VERGEBBARE_RECHTE,
  brauchtZweitenFaktor,
  istRecht,
} from "../src/rechtemodell/katalog.js";
import {
  MITGLIED_STANDARD,
  RAUM_TEAM_STANDARD,
  STUFENROLLEN_STANDARD,
  SYSTEMROLLEN,
  systemrollenFuer,
} from "../src/rechtemodell/standard.js";
import { TERMINE_RECHTE } from "../src/termine/rechte-katalog.js";

// Der eine Katalog muss die älteren enthalten und in sich stimmig sein (#643)
describe("Rechtekatalog", () => {
  test("jedes Plattformrecht steht im Katalog, «erweitert» und vergebbar", () => {
    for (const name of PLATTFORM_RECHT_NAMEN) {
      const e = RECHTE_KATALOG[name];
      expect(e.risiko, name).toBe("erweitert");
      expect(e.art, name).toBe("vergebbar");
      expect(e.bereich, name).toBe("website");
      expect(PLATTFORM_RECHTE[name].erweitert).toBe(true);
    }
  });

  test("jedes Recht der Termine steht im Katalog, unter seinem Namen oder dem Namen «frueher»", () => {
    const frueher = new Map(
      RECHT_IDS.flatMap((id) => {
        const f = (RECHTE_KATALOG[id] as { frueher?: string }).frueher;
        return f ? [[f, id] as const] : [];
      }),
    );
    for (const name of Object.keys(TERMINE_RECHTE)) {
      // raum.belegung steht im Katalog unter demselben Namen
      expect(istRecht(name) || frueher.has(name), name).toBe(true);
    }
  });

  test("Namen haben die Form bereich.aktion, und jedes Recht gehört zu einem Bereich", () => {
    for (const id of RECHT_IDS) {
      expect(id, id).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(BEREICHE, id).toContain(RECHTE_KATALOG[id].bereich);
    }
  });

  test("nur Vergebbares hat Geltungen; «eigene» hat einen Bezug; Festes und Strukturelles sind nie vergebbar", () => {
    for (const id of RECHT_IDS) {
      const e = RECHTE_KATALOG[id] as {
        art: string;
        risiko: string;
        geltungen: readonly string[];
        bezug?: string;
      };
      if (e.art === "vergebbar") {
        expect(e.geltungen.length, id).toBeGreaterThan(0);
        expect(e.geltungen, id).toContain("alle");
        if (e.geltungen.includes("eigene")) {
          expect(e.bezug, id).toBeDefined();
        }
        // Alles, was ändert oder Personendaten zeigt, ist erweitert; normal ist nur Alltag
        if (e.risiko === "normal") {
          expect(
            [
              "vorschlag.einreichen",
              "raum.belegung",
              "programm.alle_sehen",
              "programm.intern_sehen",
            ],
            id,
          ).toContain(id);
        }
      } else {
        expect(e.geltungen, id).toEqual([]);
      }
      if (e.art === "fest") expect(e.risiko, id).toBe("fest");
      if (e.art === "struktur") expect(e.risiko, id).toBe("normal");
    }
  });

  test("Rechte mit Personendaten von Kindern sind erweitert und nie strukturell", () => {
    for (const id of [
      "anlass.anmeldungen_sehen",
      "anlass.anmeldungen_exportieren",
      "personen.verwalten",
      "personen.sehen",
      "kinder.sehen",
      "kinder.verwalten",
      "anwesenheit.fuehren",
      "stufe.einblick",
      "laden.ansehen",
    ] as const) {
      expect(RECHTE_KATALOG[id].risiko, id).toBe("erweitert");
      expect(RECHTE_KATALOG[id].art, id).toBe("vergebbar");
    }
  });

  test("fest bleibt: Rechte vergeben, Entwickler vergeben, Sperre, Protokoll", () => {
    for (const id of [
      "rechte.verwalten",
      "entwickler.vergeben",
      "plattform.sperren",
      "protokoll.lesen",
    ] as const) {
      expect(RECHTE_KATALOG[id].art, id).toBe("fest");
      expect(VERGEBBARE_RECHTE as readonly string[], id).not.toContain(id);
    }
    // Das Protokoll liest nur der Entwickler (Entscheid E5)
    expect(
      (RECHTE_KATALOG["protokoll.lesen"] as { nurEntwickler?: true })
        .nurEntwickler,
    ).toBe(true);
  });

  test("Konten löschen ist vergebbar, erweitert und nur abteilungsweit (#771)", () => {
    const e = RECHTE_KATALOG["konto.loeschen"];
    expect(e.art).toBe("vergebbar");
    expect(e.risiko).toBe("erweitert");
    expect(e.geltungen).toEqual(["alle"]);
    expect(VERGEBBARE_RECHTE as readonly string[]).toContain("konto.loeschen");
    expect(brauchtZweitenFaktor("konto.loeschen")).toBe(true);
  });

  test("vergebbar seit #648: Lädeli, Lager, Betriebszahlen, Zeitregeln und die Wartung der Bereiche, alle mit zweitem Faktor", () => {
    for (const id of [
      "laden.ansehen",
      "laden.artikel_pflegen",
      "laden.bestellungen_bearbeiten",
      "laden.einstellungen",
      "lager.verwalten",
      "lager.vorlagen_pflegen",
      "system.lesen",
      "zeitregeln.verwalten",
      "wartung.bereiche",
    ] as const) {
      expect(RECHTE_KATALOG[id].art, id).toBe("vergebbar");
      expect(RECHTE_KATALOG[id].risiko, id).toBe("erweitert");
      expect(VERGEBBARE_RECHTE as readonly string[], id).toContain(id);
    }
    // Die Informationssperre bleibt fest; die Mitglieder und Rollen eines Lagers gehören zu «Rechte vergeben»
    expect(RECHTE_KATALOG["plattform.sperren"].art).toBe("fest");
    expect(RECHTE_KATALOG["rechte.verwalten"].art).toBe("fest");
  });

  test("Gruppenrollen tragen alles Vergebbare ausser dem Wartungsmodus der Website", () => {
    expect(GRUPPENROLLEN_RECHTE).not.toContain("wartungsmodus.website");
    expect(GRUPPENROLLEN_RECHTE.length).toBe(VERGEBBARE_RECHTE.length - 1);
  });

  test("ein Name, den der Katalog nicht kennt, ist kein Recht (auch «toString»)", () => {
    for (const name of ["", "toString", "__proto__", "seiten.bearbeitenn"]) {
      expect(istRecht(name), name).toBe(false);
    }
  });
});

describe("Standardrechte im Code", () => {
  const alleStandards = [
    ...Object.values(STUFENROLLEN_STANDARD).flat(),
    ...Object.values(MITGLIED_STANDARD).flat(),
    ...RAUM_TEAM_STANDARD,
    ...SYSTEMROLLEN.andere.flatMap((r) =>
      Object.values(r.rechte).flatMap((x) => x ?? []),
    ),
  ];

  test("jeder Standard nennt ein vergebbares Recht mit einer Geltung, die der Katalog kennt", () => {
    for (const z of alleStandards) {
      expect(VERGEBBARE_RECHTE, z.recht).toContain(z.recht);
      expect(RECHTE_KATALOG[z.recht].geltungen as readonly string[]).toContain(
        z.geltung,
      );
    }
  });

  test("Systemrollen: Stufe hat Stufenleitung und Leitung, jede andere Gruppe Verantwortliche/r", () => {
    expect(systemrollenFuer("stufe").map((r) => r.schluessel)).toEqual([
      "stufenleitung",
      "leitung",
    ]);
    for (const typ of ["team", "funktion", "lager", "anlass"]) {
      expect(systemrollenFuer(typ).map((r) => r.schluessel)).toEqual([
        "verantwortlich",
      ]);
    }
    // Nur das Team gibt der Systemrolle Rechte: der alte Weg kannte nur dort «verantwortlich»
    expect(systemrollenFuer("team")[0].rechte.map((z) => z.recht)).toEqual([
      "seiten.bearbeiten",
      "seiten.veroeffentlichen",
      "raum.belegung",
    ]);
    expect(systemrollenFuer("funktion")[0].rechte).toEqual([]);
  });
});

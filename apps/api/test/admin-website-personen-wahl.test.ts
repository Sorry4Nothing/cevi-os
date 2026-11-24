import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";

// Person direkt wählen (#755): Die Auswahl im Seiten-Editor ist eine einzige Liste der Leitenden, ohne Gruppenschritt
const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

async function ladeEditor() {
  vi.stubGlobal("window", { addEventListener() {}, location: { hash: "" } });
  vi.stubGlobal("document", { addEventListener() {} });
  // @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
  return (await import("../public/admin/website-felder.js")) as {
    TYPEN: Record<
      string,
      {
        pruefe: (d: unknown, k: unknown) => [string, string][];
        kurz: (d: unknown, k: unknown) => string;
      }
    >;
    KATALOG: { typ: string; neu: () => unknown; beispiel?: () => unknown }[];
    VERWEIS_TEXTE: Record<string, string>;
    feldName: (pfad: string) => string;
  };
}

describe("Baustein «Personen» im Editor", async () => {
  const editor = await ladeEditor();
  const k = { personNamen: new Map([["p1", "Flink"]]) };

  test("jeder Eintrag verlangt eine Person aus der Auswahl", () => {
    const pruefe = editor.TYPEN.personen!.pruefe;
    expect(pruefe({ eintraege: [] }, k)).toEqual([
      ["daten.eintraege", "fehlt."],
    ]);
    expect(
      pruefe({ eintraege: [{ personId: "p1" }, { funktion: "Leitung" }] }, k),
    ).toEqual([["daten.eintraege.1.personId", "fehlt."]]);
    const beispiel = editor.KATALOG.find((e) => e.typ === "personen")!;
    expect(pruefe(beispiel.beispiel!(), k)).toEqual([]);
    expect(pruefe(beispiel.neu(), k).length).toBeGreaterThan(0);
  });

  test("die Verweisprüfung des Servers hat einen Text am Baustein", () => {
    expect(editor.VERWEIS_TEXTE.PERSON_NICHT_AUF_WEBSITE).toMatch(
      /keine Leitung.*nicht auf der Website/,
    );
    expect(editor.feldName("daten.eintraege.0.personId")).toBe("Die Person");
  });
});

describe("Auswahl der Person", () => {
  const felder = lies("website-felder.js");
  const wahl = lies("website-personenwahl.js");

  test("eine Liste ohne Gruppenschritt, die Gruppe steht im Text jeder Person", () => {
    expect(wahl).toContain('anfrage("GET", `${API}/personen`)');
    expect(felder + wahl).not.toContain("Gruppe der Person");
    expect(felder + wahl).not.toContain("personen?tag=");
    expect(wahl).toContain(
      "`${FUNKTIONEN[p.funktion] ?? p.funktion}, ${p.gruppe}`",
    );
  });

  test("der Hilfetext sagt, wer nicht zur Auswahl steht", () => {
    expect(wahl).toContain(
      "Nur Leitende erscheinen auf der Website. Kinder und andere Personen stehen hier nicht zur Auswahl.",
    );
  });

  test("eine nicht mehr wählbare Person bleibt sichtbar, mit Hinweis", () => {
    expect(wahl).toContain("Bisherige Person (nicht mehr wählbar)");
    expect(felder).toContain("Diese Person ist keine Leitung mehr");
  });

  test("der Editor und das Blatt teilen eine Liste je Sitzung", () => {
    expect(lies("website-editor.js")).toContain(
      "personen: { laden: null, liste: null }",
    );
    expect(lies("website-bausteine.js")).toContain("personen: k.personen");
  });
});

// Personenwahl mit Foto und Leitungsteam (#760)
describe("Personenwahl mit Foto", async () => {
  vi.stubGlobal("window", { addEventListener() {}, location: { hash: "" } });
  vi.stubGlobal("document", { addEventListener() {} });
  // @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
  const w = (await import("../public/admin/website-personenwahl.js")) as {
    SUCHE_AB: number;
    filterePersonen: (
      personen: { anzeigename: string; funktion: string; gruppe: string }[],
      text: string,
    ) => unknown[];
    teamText: (team: {
      gruppe: string;
      stufe: boolean;
      personen: { anzeigename: string; funktion: string | null }[];
    }) => string;
  };
  const wahl = lies("website-personenwahl.js");
  const personen = [
    { anzeigename: "Zoë", funktion: "stufenleitung", gruppe: "Pilami" },
    { anzeigename: "Ben", funktion: "leitung", gruppe: "Pilami" },
    { anzeigename: "Clara", funktion: "leitung", gruppe: "Tekoa" },
  ];

  test("die Suche findet Namen ohne Akzente, Gruppen und Funktionen; ohne Eingabe stehen alle da", () => {
    expect(w.filterePersonen(personen, "")).toHaveLength(3);
    expect(w.filterePersonen(personen, "zoe")).toEqual([personen[0]]);
    expect(w.filterePersonen(personen, "tekoa")).toEqual([personen[2]]);
    expect(w.filterePersonen(personen, "pilami leitung")).toHaveLength(2);
    expect(w.filterePersonen(personen, "stufenleitung pilami")).toEqual([
      personen[0],
    ]);
    expect(w.filterePersonen(personen, "xyz")).toEqual([]);
  });

  test("das Suchfeld gibt es ab 9 Einträgen", () => {
    expect(w.SUCHE_AB).toBe(9);
  });

  test("der Satz beim Leitungsteam nennt Gruppe, Zahl und Personen nach Funktion, in der Reihenfolge des Servers", () => {
    expect(
      w.teamText({
        gruppe: "Pilami",
        stufe: true,
        personen: [
          { anzeigename: "Anna", funktion: "Stufenleitung" },
          { anzeigename: "Ben", funktion: "Stufenleitung" },
          { anzeigename: "Clara", funktion: "Leitung" },
          { anzeigename: "Dani", funktion: "Leitung" },
        ],
      }),
    ).toBe(
      "Zeigt 4 Personen der Gruppe Pilami: Stufenleitung: Anna, Ben; Leitung: Clara, Dani.",
    );
    expect(
      w.teamText({
        gruppe: "Runde",
        stufe: false,
        personen: [{ anzeigename: "Anna", funktion: null }],
      }),
    ).toBe("Zeigt 1 Person der Gruppe Runde: Anna.");
    expect(w.teamText({ gruppe: "Biber", stufe: true, personen: [] })).toBe(
      "In dieser Gruppe gibt es keine Leitenden, der Baustein bleibt leer.",
    );
    expect(w.teamText({ gruppe: "Runde", stufe: false, personen: [] })).toMatch(
      /bleibt leer\.$/,
    );
  });

  test("Kombinationsfeld nach APG: Rolle, Zustand, aktives Kind und Tasten", () => {
    for (const teil of [
      'role: "combobox"',
      '"aria-expanded"',
      '"aria-controls"',
      '"aria-activedescendant"',
      'role: "listbox"',
      'role: "option"',
      '"aria-selected"',
      'z === "Escape"',
      '"ArrowDown"',
      "e.stopPropagation()",
    ]) {
      expect(wahl).toContain(teil);
    }
  });

  test("Bilder sind dekorativ und laden einzeln; kein HTML aus Text, keine Browserdialoge", () => {
    expect(wahl).toContain("avatar(");
    expect(lies("dom.js")).toContain('alt: ""');
    expect(lies("dom.js")).toContain('loading: "lazy"');
    expect(wahl).not.toMatch(/innerHTML|insertAdjacentHTML|https?:\/\//);
    expect(wahl).not.toMatch(/\b(?:alert|confirm|prompt)\(/);
  });

  test("die Zeile in der Liste sagt, was das Leitungsteam zeigt, und der Editor lädt Namen und Teams vor", () => {
    expect(lies("website-felder.js")).toContain(
      'anzahlText(n, "1 Person", "Personen")',
    );
    expect(lies("website-editor.js")).toContain(
      "teams: { laden: new Map(), stand: new Map() }",
    );
    expect(lies("website-editor.js")).toContain("ladeTeam(k, id)");
    expect(lies("website-bausteine.js")).toContain("teams: k.teams");
  });
});

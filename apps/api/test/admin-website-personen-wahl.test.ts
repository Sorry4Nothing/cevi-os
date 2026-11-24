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

  test("eine Liste ohne Gruppenschritt, die Gruppe steht im Text jeder Person", () => {
    expect(felder).toContain('anfrage("GET", `${API}/personen`)');
    expect(felder).not.toContain("Gruppe der Person");
    expect(felder).not.toContain("personen?tag=");
    expect(felder).toContain("p.funktion}, ${p.gruppe})");
  });

  test("der Hilfetext sagt, wer nicht zur Auswahl steht", () => {
    expect(felder).toContain(
      "Nur Leitende erscheinen auf der Website. Kinder und andere Personen stehen hier nicht zur Auswahl.",
    );
  });

  test("eine nicht mehr wählbare Person bleibt sichtbar, mit Hinweis", () => {
    expect(felder).toContain("Bisherige Person (nicht mehr wählbar)");
    expect(felder).toContain("Diese Person ist keine Leitung mehr");
  });

  test("der Editor und das Blatt teilen eine Liste je Sitzung", () => {
    expect(lies("website-editor.js")).toContain(
      "personen: { laden: null, liste: null }",
    );
    expect(lies("website-bausteine.js")).toContain("personen: k.personen");
  });
});

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Mitteilungen an Gruppen (#625): reine Funktionen der Oberfläche ohne Browser und Quelltext-Prüfungen.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let m: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {} });
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  m = await lade("mitteilungen.js");
  vi.unstubAllGlobals();
});

const quelle = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

const stufe = (id: string, name: string) => ({
  id,
  typ: "stufe",
  name,
  kuerzel: name.slice(0, 2),
  anzahlPersonen: 2,
});
const team = (id: string, name: string, kuerzel = "T") => ({
  id,
  typ: "team",
  name,
  kuerzel,
  anzahlPersonen: 4,
});

describe("Rollen passen zur Gruppe", () => {
  test("Stufen: Kinder (Eltern), Leitende, Stufenleitung; alle anderen: Mitglieder und Verantwortliche", () => {
    expect(m.rollenFuer("stufe").map(([w]: string[]) => w)).toEqual([
      "eltern",
      "leitung",
      "stufenleitung",
    ]);
    for (const typ of ["team", "funktion", "lager", "anlass"]) {
      expect(m.rollenFuer(typ).map(([w]: string[]) => w)).toEqual([
        "alle",
        "verantwortliche",
      ]);
    }
  });
});

describe("wahlAnfrage", () => {
  const a = stufe("a", "Artemis");
  const t = team("t", "Material-Team");

  test("«Alle aktiven Konten» ist die alte Form ohne Ziele", () => {
    expect(m.wahlAnfrage({ alle: true, ziele: [] })).toEqual({
      empfaenger: "alle",
    });
  });

  test("Ziele tragen Gruppe und Rollen in der Reihenfolge der Rollen, nicht des Klickens", () => {
    expect(
      m.wahlAnfrage({
        alle: false,
        ziele: [
          { gruppe: a, rollen: ["stufenleitung", "eltern"] },
          { gruppe: t, rollen: ["alle"] },
        ],
      }),
    ).toEqual({
      ziele: [
        { gruppeId: "a", rollen: ["eltern", "stufenleitung"] },
        { gruppeId: "t", rollen: ["alle"] },
      ],
    });
  });

  test("ohne Ziel oder mit einem Ziel ohne Rolle gibt es nichts zu senden", () => {
    expect(m.wahlAnfrage({ alle: false, ziele: [] })).toBeNull();
    expect(
      m.wahlAnfrage({
        alle: false,
        ziele: [
          { gruppe: a, rollen: ["eltern"] },
          { gruppe: t, rollen: [] },
        ],
      }),
    ).toBeNull();
  });
});

describe("zielText", () => {
  test("nennt Rollen und Gruppe in einem Satzteil", () => {
    const a = stufe("a", "Artemis");
    expect(m.zielText({ gruppe: a, rollen: ["leitung"] })).toBe(
      "die Leitenden von «Artemis»",
    );
    expect(
      m.zielText({ gruppe: a, rollen: ["leitung", "stufenleitung"] }),
    ).toBe("die Leitenden und die Stufenleitung von «Artemis»");
    expect(
      m.zielText({
        gruppe: a,
        rollen: ["stufenleitung", "leitung", "eltern"],
      }),
    ).toBe(
      "die Eltern der Kinder, die Leitenden und die Stufenleitung von «Artemis»",
    );
  });

  test("«Alle Mitglieder» schliesst die Verantwortlichen ein", () => {
    const t = team("t", "Mat");
    expect(m.zielText({ gruppe: t, rollen: ["alle", "verantwortliche"] })).toBe(
      "alle Mitglieder von «Mat»",
    );
    expect(m.zielText({ gruppe: t, rollen: ["verantwortliche"] })).toBe(
      "die Verantwortlichen von «Mat»",
    );
  });
});

describe("filtereGruppen", () => {
  const gruppen = [
    team("t2", "Küchen-Team", "Küche"),
    stufe("s2", "Exodus"),
    team("t1", "Material-Team", "Mat"),
    stufe("s1", "Artemis"),
    { ...team("f1", "Kassier", "Kas"), typ: "funktion" },
  ];

  test("Stufen zuerst, dann nach Art und Name; gewählte fehlen", () => {
    const ids = (liste: { id: string }[]) => liste.map((g) => g.id);
    expect(
      ids(m.filtereGruppen(gruppen, { gewaehlt: new Set<string>() })),
    ).toEqual(["s1", "s2", "t2", "t1", "f1"]);
    expect(
      ids(m.filtereGruppen(gruppen, { gewaehlt: new Set(["s1", "t1"]) })),
    ).toEqual(["s2", "t2", "f1"]);
  });

  test("nach Art und nach Name oder Kürzel, ohne auf Gross- und Kleinschreibung zu achten", () => {
    const g = (o: object) =>
      m
        .filtereGruppen(gruppen, { gewaehlt: new Set<string>(), ...o })
        .map((x: { id: string }) => x.id);
    expect(g({ typ: "team" })).toEqual(["t2", "t1"]);
    expect(g({ frage: "mat" })).toEqual(["t1"]);
    expect(g({ frage: "  KAS " })).toEqual(["f1"]);
    expect(g({ frage: "team", typ: "stufe" })).toEqual([]);
  });
});

describe("Zahlen", () => {
  test("kontenText", () => {
    expect(m.kontenText(1)).toBe("1 Konto");
    expect(m.kontenText(0)).toBe("0 Konten");
    expect(m.kontenText(12)).toBe("12 Konten");
  });

  test("doppelte: Personen in mehreren Zielen machen die Summe grösser als das Total", () => {
    const ziele = [
      { gruppeId: "a", anzahl: 3 },
      { gruppeId: "b", anzahl: 2 },
    ];
    expect(m.doppelte({ empfaenger: 5, ziele })).toBe(false);
    expect(m.doppelte({ empfaenger: 4, ziele })).toBe(true);
    expect(m.doppelte({ empfaenger: 0, ziele: [] })).toBe(false);
  });
});

describe("Quelltext (#625)", () => {
  test("zwei Stufen im Knopf, keine Popups, kein Polling, keine Inline-Stile, keine nativen Auswahlfelder", () => {
    const text = quelle("mitteilungen.js")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(text).toMatch(/zweiStufig/);
    expect(text).not.toMatch(
      /setInterval|\.style\b|\bconfirm\(|\balert\(|\bprompt\(|bestaetigen\(|<select|"select"/,
    );
    expect(text).not.toMatch(
      /datetime-local|typ: "(time|date|number)"|type: "(time|date|number)"/,
    );
  });

  test("die Seite fragt die Gruppen einmal und zählt nur bei einer Änderung der Wahl", () => {
    const text = quelle("mitteilungen.js");
    expect(text.match(/\/api\/v1\/admin\/tags/g)).toHaveLength(1);
    expect(text).toContain("`${API}/vorschau`");
    expect(text).toContain("clearTimeout(timer)");
  });

  test("system.css: Mitteilungen nur mit Tokens", () => {
    const css = quelle("system.css");
    const teil = css.slice(css.indexOf("/* Empfänger als Liste von Zielen"));
    expect(teil).not.toMatch(/:\s*[^;{]*#[0-9a-fA-F]{3,8}\b/);
  });
});

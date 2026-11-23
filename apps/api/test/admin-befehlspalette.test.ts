import { beforeAll, describe, expect, test, vi } from "vitest";

// Befehlspalette der Verwaltung (#602): reine Funktionen ohne Browser.
// befehlspalette.js hängt beim Laden Zuhörer an document; ohne Browser genügt eine Attrappe.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let palette: Modul;
let nav: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {} });
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  palette = await lade("befehlspalette.js");
  nav = await lade("navigation.js");
  vi.unstubAllGlobals();
});

const admin = () =>
  (nav.sichtbareBereiche as (p: object) => unknown[])({
    istAdmin: true,
    zugang: null,
  });
const stufenleitung = () =>
  (nav.sichtbareBereiche as (p: object) => unknown[])({
    istAdmin: false,
    zugang: { bereiche: ["website"], rechte: [] },
  });
const namen = (liste: { text: string }[]) => liste.map((e) => e.text);

describe("befehlspalette.js", () => {
  test("punkte: alle Wörter müssen vorkommen, Umlaute und Grossschreibung zählen nicht", () => {
    expect(palette.punkte!("UEBERSICHT", "Übersicht Übersicht")).not.toBeNull();
    expect(palette.punkte!("neue pers", "Neue Person")).not.toBeNull();
    expect(palette.punkte!("xyz", "Neue Person")).toBeNull();
    expect(palette.punkte!("neue xyz", "Neue Person")).toBeNull();
    // Wortanfang schlägt Mitte
    expect(palette.punkte!("son", "Person")!).toBeLessThan(
      palette.punkte!("per", "Person")!,
    );
  });

  test("ohne Frage: «Neue Person» und alle Seiten, die die Person sieht", () => {
    const e = palette.eintraege!({
      frage: "",
      bereiche: admin(),
      personen: [],
    });
    expect(namen(e)[0]).toBe("Neue Person");
    expect(namen(e)).toContain("Kalender");
    expect(namen(e)).toContain("Wartung und Sperre");
  });

  test("ohne Recht keine Aktion, keine Seite, keine Person", () => {
    const personen = [{ id: "1", name: "Demo Kind", ceviName: "" }];
    const e = palette.eintraege!({
      frage: "demo",
      bereiche: stufenleitung(),
      personen,
    });
    expect(namen(e)).not.toContain("Demo Kind");
    expect(namen(e)).not.toContain("Neue Person");
    const alle = palette.eintraege!({
      frage: "",
      bereiche: stufenleitung(),
      personen,
    });
    expect(namen(alle)).not.toContain("Einstellungen");
    expect(namen(alle)).toContain("Seiten");
  });

  test("Personen erst ab zwei Zeichen, höchstens sechs, nur die geladenen", () => {
    const personen = Array.from({ length: 9 }, (_, i) => ({
      id: String(i),
      name: `Demo Person ${i}`,
      ceviName: "",
    }));
    const ein = palette.eintraege!({
      frage: "d",
      bereiche: admin(),
      personen,
    });
    expect(ein.some((x: { gruppe: string }) => x.gruppe === "Personen")).toBe(
      false,
    );
    const zwei = palette.eintraege!({
      frage: "demo person",
      bereiche: admin(),
      personen,
    });
    expect(
      zwei.filter((x: { gruppe: string }) => x.gruppe === "Personen"),
    ).toHaveLength(6);
    const leer = palette.eintraege!({
      frage: "demo person",
      bereiche: admin(),
      personen: [],
    });
    expect(leer.some((x: { gruppe: string }) => x.gruppe === "Personen")).toBe(
      false,
    );
  });

  test("ein Wunsch gilt genau einmal", () => {
    expect(palette.nimmWunsch!()).toBeNull();
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";
// @ts-expect-error: Die Verwaltung besteht aus Browser-Modulen ohne Typen
import * as sicht from "../public/admin/sicht.js";
// @ts-expect-error: Browser-Modul ohne Typen
import * as nav from "../public/admin/navigation.js";
// @ts-expect-error: Browser-Modul ohne Typen
import * as modell from "../public/admin/rechte-modell.js";

// Die Verwaltung liest abteilungsleitung und entwickler aus GET /api/v1/ich, nicht role aus der Sitzung (#737)
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let konto: Modul;
let blatt: Modul;

// Diese Module hängen beim Laden Ereignisse an document und window
beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {}, history: {} });
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  konto = await lade("konto.js");
  blatt = await lade("personen-blatt.js");
  vi.unstubAllGlobals();
});

type Bereich = { schluessel: string; unter: { schluessel: string }[] };
const al = { abteilungsleitung: true, entwickler: false };
const dev = { abteilungsleitung: false, entwickler: true };
const keine = { abteilungsleitung: false, entwickler: false };

describe("sicht.js: ein Helfer für alle Stellen", () => {
  test("istAbteilungsleitung und istEntwickler lesen nur die zwei Felder", () => {
    expect(sicht.istAbteilungsleitung(al)).toBe(true);
    expect(sicht.istAbteilungsleitung(dev)).toBe(false);
    expect(sicht.istEntwickler(dev)).toBe(true);
    expect(sicht.istEntwickler(al)).toBe(false);
    // Das alte Feld und die Rolle der Sitzung zählen nicht mehr
    expect(sicht.istAbteilungsleitung({ role: "admin", admin: true })).toBe(
      false,
    );
    expect(sicht.istEntwickler({ role: "admin" })).toBe(false);
  });

  test("siehtAlles: Abteilungsleitung oder Entwickler, sonst niemand", () => {
    expect(sicht.siehtAlles(al)).toBe(true);
    expect(sicht.siehtAlles(dev)).toBe(true);
    expect(
      sicht.siehtAlles({ abteilungsleitung: true, entwickler: true }),
    ).toBe(true);
    expect(sicht.siehtAlles(keine)).toBe(false);
    expect(sicht.siehtAlles({})).toBe(false);
    expect(sicht.siehtAlles(null)).toBe(false);
    expect(sicht.siehtAlles(undefined)).toBe(false);
  });

  test("ein Wert, der nur wahrheitsähnlich ist, gilt nicht", () => {
    expect(sicht.siehtAlles({ abteilungsleitung: "true" })).toBe(false);
    expect(sicht.siehtAlles({ entwickler: 1 })).toBe(false);
  });
});

describe("Navigation: der Entwickler sieht, was die Abteilungsleitung sieht", () => {
  const schluessel = (person: object) =>
    (nav.sichtbareBereiche({ ...person, zugang: null }) as Bereich[]).flatMap(
      (b) => b.unter.map((u) => `${b.schluessel}/${u.schluessel}`),
    );

  test("der Entwickler sieht jede Seite der Abteilungsleitung", () => {
    const vomAl = schluessel(al);
    const vomEntwickler = schluessel(dev);
    expect(vomAl.length).toBeGreaterThan(10);
    for (const seite of vomAl) expect(vomEntwickler).toContain(seite);
  });

  test("Seiten nur für den Entwickler sieht die Abteilungsleitung nicht", () => {
    const nurEntwickler = schluessel(dev).filter(
      (s) => !schluessel(al).includes(s),
    );
    expect(nurEntwickler.length).toBeGreaterThan(0);
    const beides = schluessel({ ...al, entwickler: true });
    for (const seite of nurEntwickler) expect(beides).toContain(seite);
  });

  test("ohne Rolle und ohne Zugang bleibt nichts übrig", () => {
    expect(schluessel(keine)).toEqual([]);
  });

  test("rolleVon nennt Entwickler allein, Abteilungsleitung und beides", () => {
    expect(nav.rolleVon({ ...dev })).toBe("Entwickler");
    expect(nav.rolleVon({ ...al })).toBe("Abteilungsleitung");
    expect(nav.rolleVon({ abteilungsleitung: true, entwickler: true })).toBe(
      "Entwickler · Abteilungsleitung",
    );
  });
});

describe("Mein Konto, Personenblatt und Rechte zeigen beide Rollen", () => {
  const profil = { rollen: [], stufen: [] };

  test("Chips: der Entwickler allein bekommt nur «Entwickler»", () => {
    const text = (p: object) =>
      (
        konto.rollenChips({ profil: { ...profil, ...p } }) as { text: string }[]
      ).map((c) => c.text);
    expect(text(dev)).toEqual(["Entwickler"]);
    expect(text(al)).toEqual(["Abteilungsleitung"]);
    expect(text({ abteilungsleitung: true, entwickler: true })).toEqual([
      "Abteilungsleitung",
      "Entwickler",
    ]);
    expect(text(keine)).toEqual([]);
  });

  test("systemRollen und rolleText nennen den Entwickler", () => {
    const person = { rollen: [], elternteilVon: [], ...dev };
    expect(blatt.systemRollen(person)).toEqual(["Entwickler"]);
    expect(blatt.systemRollen({ ...person, abteilungsleitung: true })).toEqual([
      "Abteilungsleitung",
      "Entwickler",
    ]);
    expect(modell.rolleText(person, new Map())).toBe("Entwickler");
    expect(modell.rolleText({ ...person, ...al }, new Map())).toBe(
      "Abteilungsleitung",
    );
  });

  test("das alte Feld «admin» einer Person zeigt nichts mehr an", () => {
    const person = { rollen: [], elternteilVon: [], admin: true };
    expect(blatt.systemRollen(person)).toEqual([]);
    expect(modell.rolleText(person, new Map())).toBe("");
  });
});

describe("Quelltext der Verwaltung: keine Rolle «admin» mehr", () => {
  const ordner = new URL("../public/admin/", import.meta.url);
  const dateien = readdirSync(ordner).filter((d) => d.endsWith(".js"));

  test("keine Datei liest user.role oder das Feld admin einer Person", () => {
    expect(dateien.length).toBeGreaterThan(100);
    for (const datei of dateien) {
      const quelle = readFileSync(new URL(datei, ordner), "utf8");
      expect(quelle, datei).not.toMatch(/role\s*[!=]==?\s*["']admin["']/);
      expect(quelle, datei).not.toMatch(/\bistAdmin\b/);
      expect(quelle, datei).not.toMatch(/\.admin\b(?!\.)/);
    }
  });

  test("die Module, die Rollen lesen, nutzen den Helfer aus sicht.js", () => {
    for (const datei of [
      "admin.js",
      "konto.js",
      "personen-blatt.js",
      "rechte.js",
      "termine-anlaesse.js",
      "uebersicht-kommend.js",
      "website-editor.js",
    ]) {
      expect(readFileSync(new URL(datei, ordner), "utf8"), datei).toContain(
        'from "./sicht.js"',
      );
    }
  });
});

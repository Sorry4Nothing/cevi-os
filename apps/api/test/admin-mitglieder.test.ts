import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Mitglieder-Darstellung (#624): Gliederung in Abschnitte als reine Funktionen, dazu Quelltext-Prüfungen.
// dom.js hängt beim Laden Zuhörer an document; ohne Browser genügt eine Attrappe.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let mitglieder: Modul;
let stufen: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {} });
  // Als Text, damit tsc die Browserdatei nicht als Modul des Programms prüft
  const name: string = "mitglieder.js";
  mitglieder = (await import(
    /* @vite-ignore */ `../public/admin/${name}`
  )) as Modul;
  const stufenName: string = "stufen.js";
  stufen = (await import(
    /* @vite-ignore */ `../public/admin/${stufenName}`
  )) as Modul;
  vi.unstubAllGlobals();
});

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

const GRUPPEN = [
  { schluessel: "a", titel: "Leitende" },
  { schluessel: "b", titel: "Eltern" },
  { schluessel: "c", titel: "Weitere" },
];
const person = (name: string, g: string) => ({ name, g });
const schluessel = (e: { g: string }) => e.g;

describe("mitglieder.js: Gliederung", () => {
  test("nachGruppe ordnet nach dem Rang der Gruppe und lässt die Reihenfolge darin", () => {
    const eintraege = ["c1", "a1", "b1", "a2", "c2"];
    const rang = (e: string) => "abc".indexOf(e[0]!);
    expect(mitglieder.nachGruppe!(eintraege, rang)).toEqual([
      "a1",
      "a2",
      "b1",
      "c1",
      "c2",
    ]);
  });

  test("gliedere zählt über alle Treffer und ordnet nach den Abschnitten", () => {
    const treffer = [
      person("Zoe", "c"),
      person("Ann", "a"),
      person("Ben", "a"),
      person("Eli", "b"),
    ];
    const { geordnet, gesamt } = mitglieder.gliedere!(
      treffer,
      GRUPPEN,
      schluessel,
    );
    expect(geordnet.map((e: { name: string }) => e.name)).toEqual([
      "Ann",
      "Ben",
      "Eli",
      "Zoe",
    ]);
    expect(gesamt).toEqual({ a: 2, b: 1, c: 1 });
  });

  test("gliedere ohne Gruppen lässt alles, wie es ist", () => {
    const treffer = [person("Zoe", "c"), person("Ann", "a")];
    expect(mitglieder.gliedere!(treffer, null, schluessel)).toEqual({
      geordnet: treffer,
      gesamt: {},
    });
  });

  test("abschnitte nimmt nur die Gruppen mit Einträgen auf der Seite, die Zahl gilt für alle Treffer", () => {
    const seite = [person("Ann", "a"), person("Eli", "b")];
    const teile = mitglieder.abschnitte!(seite, GRUPPEN, schluessel, {
      a: 9,
      b: 1,
      c: 4,
    });
    expect(teile.map((g: { titel: string }) => g.titel)).toEqual([
      "Leitende",
      "Eltern",
    ]);
    expect(teile[0].anzahl).toBe(9);
    // Ohne Gruppen: ein Abschnitt ohne Titel
    const eins = mitglieder.abschnitte!(seite, null, schluessel);
    expect(eins).toHaveLength(1);
    expect(eins[0].titel).toBeNull();
    expect(eins[0].eintraege).toBe(seite);
  });
});

describe("stufen.js: Bild der Stufe", () => {
  const id = "01a204cf-77a7-7066-a520-92ea9f0150e0";
  test("titelbildId nimmt das erste Bild der Seite", () => {
    const dokument = {
      bausteine: [
        { typ: "text", daten: {} },
        { typ: "bild", daten: { mediumId: id } },
        { typ: "bild", daten: { mediumId: "zweites" } },
      ],
    };
    expect(stufen.titelbildId!(dokument)).toBe(id);
  });

  test("titelbildId liefert null ohne Bild, ohne Dokument und bei einer fremden Form", () => {
    expect(stufen.titelbildId!(null)).toBeNull();
    expect(stufen.titelbildId!({ bausteine: [] })).toBeNull();
    expect(
      stufen.titelbildId!({ bausteine: [{ typ: "bild", daten: {} }] }),
    ).toBeNull();
  });
});

describe("Mitglieder-Darstellung: Quelltext", () => {
  test("Personen, Kinder und Gruppen nutzen dieselbe Darstellung", () => {
    for (const datei of ["personen.js", "kinder.js", "tags-detail.js"]) {
      expect(lies(datei)).toContain('from "./mitglieder.js"');
    }
    expect(lies("index.html")).toContain('href="/admin/personen.css"');
  });

  test("keine zusätzlichen Abfragen: die Darstellung ruft die API nie selbst auf", () => {
    expect(lies("mitglieder.js")).not.toMatch(/anfrage\(|fetch\(/);
  });

  test("Ansicht bleibt im Browser, ohne Speicher gilt «karten»; Bewegung nur bei erlaubter Bewegung", () => {
    const quelle = lies("mitglieder.js");
    expect(quelle).toContain("localStorage");
    expect(quelle).toMatch(/catch \{/);
    const css = lies("personen.css");
    const ein = css.indexOf("animation: mg-ein");
    expect(ein).toBeGreaterThan(0);
    expect(
      css.lastIndexOf("prefers-reduced-motion: no-preference", ein),
    ).toBeGreaterThan(css.lastIndexOf("\n}\n", ein));
  });
});

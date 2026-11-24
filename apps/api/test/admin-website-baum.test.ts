import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Seitenbaum und Editor der Website-Verwaltung (#595): reine Funktionen von website-baum.js und Quelltext-Prüfungen der Bedienung.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let baum: Modul;
// Als Text, damit tsc die Browserdateien nicht als Module des Programms prüft
const lade = (name: string) =>
  import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {} });
  baum = await lade("website-baum.js");
  vi.unstubAllGlobals();
});

const quelle = (name: string) =>
  readFileSync(new URL(`../public/admin/${name}`, import.meta.url), "utf8");

type S = {
  id: string;
  elternId: string | null;
  adresse: string;
  reihenfolge: number;
  pfad: string;
  veroeffentlicht: boolean;
};
const seite = (
  id: string,
  elternId: string | null,
  reihenfolge: number,
  pfad: string,
  veroeffentlicht = true,
): S => ({
  id,
  elternId,
  adresse: pfad.split("/").at(-1)!,
  reihenfolge,
  pfad,
  veroeffentlicht,
});
// a (b, c (d)), e
const beispiel = () => [
  seite("a", null, 0, "/a"),
  seite("e", null, 1, "/e"),
  seite("b", "a", 0, "/a/b"),
  seite("c", "a", 1, "/a/c"),
  seite("d", "c", 0, "/a/c/d"),
];

describe("website-baum.js: Verschieben", () => {
  test("wendeAn ordnet neu und rechnet die Adressen der Seite und ihrer Unterseiten", () => {
    const seiten = beispiel();
    const c = seiten.find((s) => s.id === "c")!;
    // c wird Unterseite von e
    const { aenderungen } = baum.plane!(seiten, c, "e", Infinity);
    baum.wendeAn!(seiten, aenderungen);
    const pfad = Object.fromEntries(seiten.map((s) => [s.id, s.pfad]));
    expect(pfad).toMatchObject({ c: "/e/c", d: "/e/c/d", b: "/a/b" });
  });

  test("geaenderteAdressen nennt nur veröffentlichte Seiten mit neuer Adresse", () => {
    const vorher = beispiel();
    vorher[3]!.veroeffentlicht = true;
    vorher[4]!.veroeffentlicht = false; // d ist ein Entwurf
    const alt = vorher.map((s) => ({ ...s }));
    const c = vorher.find((s) => s.id === "c")!;
    baum.wendeAn!(vorher, baum.plane!(vorher, c, "e", Infinity).aenderungen);
    expect(baum.geaenderteAdressen!(alt, vorher)).toEqual([
      { alt: "/a/c", neu: "/e/c" },
    ]);
  });

  test("stelleHer holt den Stand vor dem Verschieben zurück", () => {
    const seiten = beispiel();
    const stand = baum.schnappschuss!(seiten);
    const c = seiten.find((s) => s.id === "c")!;
    baum.wendeAn!(seiten, baum.plane!(seiten, c, null, 0).aenderungen);
    expect(c.elternId).toBeNull();
    baum.stelleHer!(seiten, stand);
    expect(c.elternId).toBe("a");
    expect(c.pfad).toBe("/a/c");
  });

  test("ablehnung: nicht unter sich selbst oder Nachfahren, nicht tiefer als erlaubt", () => {
    const seiten = beispiel();
    const b = baum.baue!(seiten);
    const a = seiten.find((s) => s.id === "a")!;
    expect(baum.ablehnung!(b, a, "d")).toMatch(/unter sich selbst/);
    expect(baum.ablehnung!(b, a, "a")).toMatch(/unter sich selbst/);
    expect(baum.ablehnung!(b, a, "e")).toBeNull();
    // Kette der Tiefe 5: eine weitere Ebene geht nicht
    const tief = [
      seite("1", null, 0, "/1"),
      seite("2", "1", 0, "/1/2"),
      seite("3", "2", 0, "/1/2/3"),
      seite("4", "3", 0, "/1/2/3/4"),
      seite("5", "4", 0, "/1/2/3/4/5"),
      seite("x", null, 1, "/x"),
    ];
    const bt = baum.baue!(tief);
    expect(baum.ablehnung!(bt, tief[5], "5")).toMatch(/Ebenen/);
    expect(baum.ablehnung!(bt, tief[5], "3")).toBeNull();
  });
});

describe("website-baum.js: Adresse", () => {
  test("adresseAusTitel wie auf dem Server", () => {
    expect(baum.adresseAusTitel!("Über uns & Co.")).toBe("ueber-uns-co");
    expect(baum.adresseAusTitel!("  Sommerlager 2027 ")).toBe(
      "sommerlager-2027",
    );
    expect(baum.adresseAusTitel!("!!!")).toBe("seite");
    expect(baum.adresseAusTitel!("a".repeat(80))).toHaveLength(60);
  });
});

describe("Bedienung des Seitenbaums und des Editors (Quelltext)", () => {
  test("der Baum ist ein WAI-ARIA-Tree mit Pfeiltasten, F2 und Verschieben ohne Ziehen", () => {
    const q = quelle("website-baumansicht.js");
    expect(q).toContain('role: "tree"');
    expect(q).toContain('role: "treeitem"');
    expect(q).toContain("aria-level");
    expect(q).toContain("aria-expanded");
    for (const taste of [
      "ArrowRight",
      "ArrowLeft",
      '"F2"',
      '"Delete"',
      '" "',
      "Escape",
    ]) {
      expect(q, taste).toContain(taste);
    }
    // Hoch, runter, einordnen, eine Ebene höher: auch im Menü
    for (const text of [
      "Nach oben",
      "Nach unten",
      "einordnen",
      "Eine Ebene höher",
    ]) {
      expect(q, text).toContain(text);
    }
    // Das Verschieben geht über «Rückgängig» und weist auf Weiterleitungen hin
    expect(q).toContain("mitRueckgaengig");
    expect(q).toContain("weiterleitungen.verwalten");
  });

  test("Neue Seite zeigt Skizzen und prüft die Adresse live", () => {
    const q = quelle("website-seiten.js");
    expect(q).toContain("skizze(");
    expect(q).toContain("ws-adressstand");
    expect(q).not.toContain('typ: "number"');
  });

  test("der Editor hat Umbenennen, Speicherstand, Split-Knopf und keine Zahl für die Position", () => {
    const q = quelle("website-editor.js");
    expect(q).toContain("splitKnopf(");
    expect(q).toContain("Gespeichert ${vor(");
    expect(q).toContain('"F2"');
    expect(q).not.toContain('typ: "number"');
    expect(q).not.toContain("Position</");
    // Bausteine mit der Sortierliste, Löschen mit Rückgängig statt eigener Snackbar
    expect(q).toContain("sortierListe(");
    expect(q).toContain("mitRueckgaengig");
    expect(q).not.toContain('class: "snack"');
  });

  test("ungespeicherte Einstellungen zählen für die Rückfrage beim Verlassen", () => {
    const q = quelle("website-editor.js");
    expect(q).toContain("k.einstellungenGeaendert");
    expect(q.match(/einstellungenGeaendert/g)!.length).toBeGreaterThanOrEqual(
      4,
    );
  });

  test("Bild wählen und Zugriff eines Bausteins ersetzen den Inhalt des Panels statt ein zweites zu öffnen", () => {
    expect(quelle("website-unteransicht.js")).toContain("ws-unteransicht");
    expect(quelle("website-bausteine.js")).toContain("{ in: blatt }");
    expect(quelle("website-bausteine.js")).toContain("in: blatt,");
    expect(quelle("website-sichtbarkeit.js")).toContain("opt.in");
  });

  test("Karten und Bilder in den Bausteinen nutzen die Sortierliste", () => {
    expect(quelle("website-felder.js")).toContain("sortierListe(");
    expect(quelle("website-felder.js")).not.toContain('"Nach oben", {');
  });

  test("Versionen sind eine Zeitleiste", () => {
    const q = quelle("website-veroeffentlichen.js");
    expect(q).toContain("ws-zeitleiste");
    expect(q).toContain("export function zurueckziehen");
  });
});

describe("website-richtext.js: Format-Leiste", () => {
  let rt: Modul;
  beforeAll(async () => {
    rt = await lade("website-richtext.js");
  });

  test("fett und kursiv umschliessen die Auswahl oder setzen einen Platzhalter", () => {
    expect(rt.formatiere!("ein Wort hier", 4, 8, "fett")).toEqual({
      wert: "ein **Wort** hier",
      von: 6,
      bis: 10,
    });
    expect(rt.formatiere!("", 0, 0, "kursiv")).toEqual({
      wert: "*Text*",
      von: 1,
      bis: 5,
    });
  });

  test("Link setzt die Schreibweise und wählt die Adresse, die der Server prüft", () => {
    const r = rt.formatiere!("zur Seite", 4, 9, "link");
    expect(r.wert).toBe("zur [Seite](https://)");
    expect(r.wert.slice(r.von, r.bis)).toBe("https://");
    // Die Schreibweise bleibt lesbar für den Server: ein Link mit Adresse wird erkannt
    const bloecke = rt.textZuBloecken!("zur [Seite](https://beispiel.ch)");
    expect(JSON.stringify(bloecke)).toContain("beispiel.ch");
  });

  test("Liste setzt «- » vor jede Zeile und nimmt es beim zweiten Klick wieder weg", () => {
    const eins = rt.formatiere!("a\nb\nc", 0, 5, "liste");
    expect(eins.wert).toBe("- a\n- b\n- c");
    const zwei = rt.formatiere!(eins.wert, eins.von, eins.bis, "liste");
    expect(zwei.wert).toBe("a\nb\nc");
    expect(rt.formatiere!("x\ny", 0, 3, "nummer").wert).toBe("1. x\n2. y");
  });
});

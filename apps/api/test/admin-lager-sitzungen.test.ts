import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Lager-Module «Sitzungen und Mitteilen» der Verwaltung (#673): reine Funktionen und Quelltext-Prüfungen ohne Browser.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let gemeinsam: Modul;
let dokumente: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {}, history: {} });
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  gemeinsam = await lade("lager-sm-gemeinsam.js");
  dokumente = await lade("lager-m-dokumente.js");
  vi.unstubAllGlobals();
});

const quelle = (name: string) =>
  readFileSync(new URL(`../public/admin/${name}`, import.meta.url), "utf8");
const MODULE = [
  "hoecks",
  "protokolle",
  "pinnwand",
  "eingang",
  "erwaehnungen",
  "dokumente",
];
const DATEIEN = [
  ...MODULE.map((m) => `lager-m-${m}.js`),
  "lager-sm-gemeinsam.js",
  "lager-sm-traktanden.js",
];

describe("Lager Sitzungen: Erwähnungen", () => {
  const id1 = "01a20a7d-aa9c-7e99-a8c2-c753784e8af8";
  const id2 = "01a20a7d-aa9c-7e99-a8c2-c753784e8af9";
  const mitglieder = [
    { personId: id1, name: "Lua Demo" },
    { personId: id2, name: "Lua Demo" },
  ];

  test("gleiche Namen bekommen eine Zahl, damit sie sich unterscheiden", () => {
    const k = gemeinsam.erwaehnungsKarte!(mitglieder);
    expect(k.nachId.get(id1)).toBe("@Lua Demo");
    expect(k.nachId.get(id2)).toBe("@Lua Demo 2");
  });

  test("Namen werden zu Marken und zurück; längere Namen zuerst", () => {
    const k = gemeinsam.erwaehnungsKarte!(mitglieder);
    const roh = "Hallo @Lua Demo 2 und @Lua Demo";
    const marken = gemeinsam.namenZuMarken!(roh, k);
    expect(marken).toBe(`Hallo @{person:${id2}} und @{person:${id1}}`);
    expect(gemeinsam.markenZuNamen!(marken, k)).toBe(roh);
    expect(gemeinsam.markenIn!(marken)).toBe(2);
  });

  test("eine unbekannte Marke bleibt beim Anzeigen stehen", () => {
    const k = gemeinsam.erwaehnungsKarte!([]);
    const text = `Ruf @{person:${id1}} an`;
    expect(gemeinsam.markenZuNamen!(text, k)).toBe(text);
  });
});

describe("Lager Sitzungen: Datum und Rechte", () => {
  test("datumMitTag ohne Zeitzonen-Verschiebung", () => {
    expect(gemeinsam.datumMitTag!("2027-03-10")).toMatch(/10\.03\.2027$/);
    expect(gemeinsam.datumMitTag!("")).toBe("");
  });

  test("lokale Zeit und ISO sind umkehrbar", () => {
    const iso = gemeinsam.lokalZuIso!("2027-03-10T19:30");
    expect(iso).toMatch(/Z$/);
    expect(gemeinsam.isoZuLokal!(iso)).toBe("2027-03-10T19:30");
    expect(gemeinsam.lokalZuIso!("")).toBeNull();
    expect(gemeinsam.isoZuLokal!(null)).toBe("");
  });

  test("Schreiben braucht das Recht und ein offenes Lager", () => {
    const lager = { rechte: ["hoecks.bearbeiten"], schreibgeschuetzt: false };
    expect(gemeinsam.darfSchreiben!(lager, "hoecks.bearbeiten")).toBe(true);
    expect(gemeinsam.darfSchreiben!(lager, "pinnwand.bearbeiten")).toBe(false);
    expect(
      gemeinsam.darfSchreiben!(
        { ...lager, schreibgeschuetzt: true },
        "hoecks.bearbeiten",
      ),
    ).toBe(false);
    expect(
      gemeinsam.darfSchreiben!({ rechte: ["a"], status: "archiviert" }, "a"),
    ).toBe(false);
  });

  test("restPfad: ctx.weiter hat Vorrang, sonst der Rest nach dem Modul", () => {
    expect(gemeinsam.restPfad!({ weiter: ["x"], pfad: [] }, "L")).toEqual([
      "x",
    ]);
    expect(
      gemeinsam.restPfad!({ pfad: ["L", "hoecks", "h1", "modus"] }, "L"),
    ).toEqual(["h1", "modus"]);
  });

  test("kinder lässt false, null und undefined weg", () => {
    expect(gemeinsam.kinder!(false, "a", null, [undefined, "b"])).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("Lager Sitzungen: Dokumente", () => {
  test("Stichworte: klein, ohne Doppelte, ohne Leere", () => {
    expect(
      dokumente.stichworteAusText!(" Test, Probe ,test,, Zwei  Wörter "),
    ).toEqual(["test", "probe", "zwei wörter"]);
  });
});

describe("Lager Sitzungen: Quelltext", () => {
  test("jedes Modul hat eine Zeile im Register und exportiert zeige", () => {
    const register = quelle("lager-module.js");
    for (const m of MODULE) {
      expect(register).toContain(`schluessel: "${m}"`);
      expect(register).toContain(`./lager-m-${m}.js`);
      expect(quelle(`lager-m-${m}.js`)).toMatch(/export function zeige\(/);
    }
  });

  test("das Register nennt die Leserechte, die Module blenden Knöpfe nach Recht aus", () => {
    const register = quelle("lager-module.js");
    expect(register).toContain(
      'recht: "hoecks.lesen_alle|hoecks.team_lesen|hoecks.bearbeiten"',
    );
    expect(register).toContain('recht: "protokolle.lesen"');
    expect(register).toContain('recht: "pinnwand.lesen"');
    expect(register).toContain('recht: "eingang.senden|eingang.lesen"');
    for (const m of [
      "hoecks",
      "protokolle",
      "pinnwand",
      "eingang",
      "dokumente",
    ])
      expect(quelle(`lager-m-${m}.js`)).toContain("darfSchreiben(");
  });

  test("Löschen läuft mit Rückgängig, Bearbeiten meldet Versionskonflikte über die Konfliktbox", () => {
    for (const m of ["hoecks", "protokolle", "pinnwand", "dokumente"])
      expect(
        quelle(`lager-m-${m}.js`) + quelle("lager-sm-traktanden.js"),
      ).toContain("ctx.mitRueckgaengig");
    for (const m of [
      "hoecks",
      "protokolle",
      "pinnwand",
      "eingang",
      "dokumente",
    ]) {
      const q = quelle(`lager-m-${m}.js`) + quelle("lager-sm-traktanden.js");
      expect(q).toContain("konfliktBox(");
    }
    const g = quelle("lager-sm-gemeinsam.js");
    expect(g).toContain("Meine Änderung übernehmen");
    expect(g).toContain("Stand des Servers übernehmen");
    expect(g).toContain('"VERSION_KONFLIKT"');
  });

  test("Routen: nur die des Lager-Backends und die Host-Einstellung der Abteilung", () => {
    const alle = DATEIEN.map(quelle).join("\n");
    for (const pfad of [
      "/hoecks",
      "/traktanden/reihenfolge",
      "/protokolle",
      "/beschluesse",
      "/pinnwand",
      "/umfrage/stimme",
      "/reaktionen/pinnwand_beitrag",
      "/erwaehnungen",
      "/eingang",
      "/dokumente",
      "/dateien",
      "/api/v1/admin/lager-dateien/hosts",
    ])
      expect(alle).toContain(pfad);
  });

  test("Kästchen sind eigene, keine Popups, kein Polling, kein localStorage", () => {
    const alle = DATEIEN.map(quelle).join("\n");
    expect(alle).not.toMatch(/\balert\(|\bconfirm\(|\bprompt\(/);
    expect(alle).not.toMatch(/setInterval|localStorage|sessionStorage/);
    // Das einzige rohe Kästchen steckt in einer Zeile mit der Klasse «wahl» (Mehrfachwahl der Umfrage)
    const roh = alle.match(/type: u\.mehrfach|type: "checkbox"/g) ?? [];
    expect(roh.length).toBeLessThanOrEqual(1);
    expect(quelle("lager-m-pinnwand.js")).toContain('class: "wahl"');
    expect(quelle("lager-m-pinnwand.js")).toContain("wahlkarte");
  });

  test("Eingang: der Text steht nie in Adresse oder Titel, der Code wird einmal gezeigt", () => {
    const q = quelle("lager-m-eingang.js");
    expect(q).toContain("geheimnisDialog(");
    expect(q).not.toMatch(/location\.hash\s*=.*\.text/);
    expect(q).not.toMatch(/document\.title/);
  });

  test("die Traktanden ordnet die Sortierliste mit Rückgängig", () => {
    const q = quelle("lager-sm-traktanden.js");
    expect(q).toContain("sortierListe(");
    expect(q).toContain("mitRueckgaengig: ctx.mitRueckgaengig");
  });

  test("nach dem Schliessen einer Seite im Fluss geht die Adresse über gehe()", () => {
    expect(quelle("lager-m-hoecks.js")).toContain("gehe(adresse(");
  });

  test("Stil: eigene Datei, keine Hex-Farben", () => {
    const css = quelle("lager-sitzungen.css");
    expect(css).not.toMatch(/:\s*[^;{]*#[0-9a-fA-F]{3,8}\b/);
    expect(quelle("index.html")).toContain('href="/admin/lager-sitzungen.css"');
  });
});

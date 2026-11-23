import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Bereich «Lager» der Verwaltung (#592): reine Funktionen und Quelltext-Prüfungen ohne Browser.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let ausdrucke: Modul;
let vorlagen: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {}, history: {} });
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  ausdrucke = await lade("lager-ausdrucke.js");
  vorlagen = await lade("lager-vorlagen.js");
  vi.unstubAllGlobals();
});

const quelle = (name: string) =>
  readFileSync(new URL(`../public/admin/${name}`, import.meta.url), "utf8");

describe("Lager: Ausdrucke", () => {
  test("dateiname: Lager und Art ohne Umlaute und Sonderzeichen", () => {
    expect(ausdrucke.dateiname!("Sommerlager Küche 2027", "schichtplan")).toBe(
      "sommerlager-kueche-2027-schichtplan.pdf",
    );
    expect(ausdrucke.dateiname!("  ", "zimmerliste")).toBe("zimmerliste.pdf");
    expect(ausdrucke.dateiname!("Ä/Ö:Ü", "fahrtenliste")).toBe(
      "ae-oe-ue-fahrtenliste.pdf",
    );
  });

  test("groesse: Bytes, kB und MB mit Schweizer Zahlenschreibweise", () => {
    expect(ausdrucke.groesse!(512)).toBe("512 B");
    expect(ausdrucke.groesse!(2048)).toBe("2 kB");
    expect(ausdrucke.groesse!(86_016)).toBe("84 kB");
    expect(ausdrucke.groesse!(3 * 1024 * 1024 + 512 * 1024)).toBe("3.5 MB");
  });

  test("der Fortschritt ist ein progress-Element (keine Inline-Stile)", () => {
    const q = quelle("lager-ausdrucke.js");
    expect(q).toContain('el("progress"');
    expect(q).toContain("AbortController");
  });
});

describe("Lager: Vorlagen", () => {
  test("zeileZuEintrag: Aufgabe = Titel, Packliste = Abschnitt und Text", () => {
    expect(vorlagen.zeileZuEintrag!("aufgaben", "  Küche planen ")).toEqual({
      titel: "Küche planen",
    });
    expect(
      vorlagen.zeileZuEintrag!("packliste", "Schlafen: Schlafsack"),
    ).toEqual({ abschnitt: "Schlafen", text: "Schlafsack" });
    expect(vorlagen.zeileZuEintrag!("packliste", "Zahnbürste")).toEqual({
      abschnitt: "Allgemein",
      text: "Zahnbürste",
    });
    expect(vorlagen.zeileZuEintrag!("packliste", "Schlafen:  ")).toBeNull();
    expect(vorlagen.zeileZuEintrag!("aufgaben", "   ")).toBeNull();
  });

  test("die Längen folgen dem Server (Titel 200, Abschnitt 100, Text 300)", () => {
    expect(
      vorlagen.zeileZuEintrag!("aufgaben", "a".repeat(250))!.titel,
    ).toHaveLength(200);
    const p = vorlagen.zeileZuEintrag!(
      "packliste",
      `${"b".repeat(150)}: ${"c".repeat(400)}`,
    )!;
    expect(p.abschnitt).toHaveLength(100);
    expect(p.text).toHaveLength(300);
  });

  test("Anlegen und Bearbeiten ordnen mit der Sortierliste und speichern über die Vorlagen-Routen", () => {
    const q = quelle("lager-vorlagen.js");
    expect(q).toContain("sortierListe");
    expect(q).toContain('anfrage("PATCH", `${BASIS}/${start.id}`');
    expect(q).toContain('anfrage("POST", BASIS');
    // Weitere Angaben einer Aufgabe (Frist, Notiz) gehen beim Bearbeiten nicht verloren
    expect(q).toContain("...e.daten");
  });
});

describe("Lager: Assistent, Mitglieder, Rechte (Quelltext)", () => {
  test("jeder Schritt des Assistenten hat eine Adresse", () => {
    const q = quelle("lager-anlegen.js");
    for (const a of [
      "/neu`",
      "/neu/vorlage`",
      "/neu/mitglieder`",
      "/neu/pruefen`",
    ])
      expect(q).toContain(a);
    expect(q).toContain('"aria-current": i === nr ? "step"');
  });

  test("Beginn und Ende sind eigene Datumsfelder, keine nativen", () => {
    const q = quelle("lager-gemeinsam.js");
    expect(q).toContain("datumsfeld(");
    expect(q).not.toMatch(/typ: "date"/);
  });

  test("die Rechte zeigen nie den technischen Schlüssel, nur Klartext", () => {
    const q = quelle("lager-rechte.js");
    // Der Schlüssel dient nur als Kennung und für die Anfrage, nie als sichtbarer Text
    expect(q).not.toMatch(/el\(\s*"span",\s*\{[^}]*mono/);
    expect(q).toContain("KLARTEXT");
    expect(q).toContain("BEREICHE");
    expect(q).toContain("`${BASIS}/${lager.id}/rechte`");
  });

  test("Rolle ändern und Entfernen laufen mit Rückgängig, Aktivieren ohne Lagerleitung wird erklärt", () => {
    const m = quelle("lager-mitglieder.js");
    expect(m).toContain("ctx.mitRueckgaengig");
    expect(m).toContain("Rolle von ${m.name}");
    const l = quelle("lager.js");
    expect(l).toContain("lg-ohne-leitung");
    expect(l).toContain("Mitglieder öffnen");
    expect(l).toContain("splitKnopf");
  });
});

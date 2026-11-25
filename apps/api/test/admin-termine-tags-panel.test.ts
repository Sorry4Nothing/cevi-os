import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Tags bestehender Termine ändern (#835): Dialog, Sammelaktion, Anzeige des Outlook-Stands. Reine Logik ohne Browser, dazu der Quelltext der Einbindung.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let m: Modul;
const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

beforeAll(async () => {
  const leer = {
    addEventListener() {},
    location: { hash: "" },
    history: {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  vi.stubGlobal("window", leer);
  vi.stubGlobal("document", { ...leer, querySelector: () => null });
  // Als Text, damit tsc die Browserdatei nicht als Modul des Programms prüft
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  m = await lade("termine-tags.js");
  vi.unstubAllGlobals();
});

const tag = (id: string, name: string) => ({ id, name, typ: "stufe" });

describe("Tags der Termine: Logik", () => {
  test("der Zustand von Outlook steht im Wort", () => {
    const text = m.OUTLOOK_TEXT as unknown as Record<string, string>;
    expect(text.aus).toBe("Nur in Cevi OS gespeichert, nicht in Outlook.");
    expect(text.ausstehend).toBe(
      "In Cevi OS gespeichert. Outlook wird nachgeführt.",
    );
    expect(text.geschrieben).toBe("In Cevi OS und Outlook gespeichert.");
  });

  test("Sammelaktion: nennt je Zustand die Zahl, nie nur die Summe", () => {
    expect(
      m.sammelText({
        geaendert: 5,
        outlook: { geschrieben: 3, ausstehend: 1, aus: 1 },
      }),
    ).toBe(
      "5 Termine geändert. 3 in Cevi OS und Outlook gespeichert. 1 in Cevi OS gespeichert, Outlook wird nachgeführt. 1 nur in Cevi OS gespeichert, nicht in Outlook.",
    );
    expect(
      m.sammelText({
        geaendert: 1,
        outlook: { geschrieben: 0, ausstehend: 0, aus: 1 },
      }),
    ).toBe(
      "1 Termin geändert. 1 nur in Cevi OS gespeichert, nicht in Outlook.",
    );
  });

  test("das Recht kommt aus dem Signal «kategorien», nie aus einem Rückfall", () => {
    expect(m.darfTags({ zugang: { termine: { kategorien: true } } })).toBe(
      true,
    );
    expect(m.darfTags({ zugang: { termine: { kategorien: false } } })).toBe(
      false,
    );
    expect(m.darfTags({ zugang: { termine: {} } })).toBe(false);
    expect(m.darfTags({})).toBe(false);
  });

  test("Anzeige: neue Tags sofort, mit null der alte Stand zurück", () => {
    const termin = { id: "t1", tags: [tag("a", "Biber")] };
    const gezeichnet: unknown[] = [];
    const zeige = m.tagsAnzeige((ts: unknown) => gezeichnet.push(ts));
    zeige([termin], [tag("b", "Wölfe"), tag("c", "Pfadi")]);
    expect(termin.tags.map((t) => t.name)).toEqual(["Wölfe", "Pfadi"]);
    zeige([termin], null);
    expect(termin.tags.map((t) => t.name)).toEqual(["Biber"]);
    expect(gezeichnet).toHaveLength(2);
  });

  test("Anzeige: ein Termin ohne gemerkten Stand bleibt beim Zurücknehmen unberührt", () => {
    const termin = { id: "t2", tags: [tag("a", "Biber")] };
    m.tagsAnzeige(() => {})([termin], null);
    expect(termin.tags).toHaveLength(1);
  });

  test("die Obergrenze gleicht der API", () => {
    expect(m.MAX_TAGS).toBe(20);
  });
});

describe("Tags der Termine: Einbindung", () => {
  const modul = lies("termine-tags.js");

  test("lesen die Tags, schreiben einzeln und gesammelt, sonst nichts", () => {
    expect(
      [...modul.matchAll(/anfrage\(\s*"(\w+)"/g)].map((t) => t[1]).sort(),
    ).toEqual(["GET", "PUT", "PUT"]);
    expect(modul).toContain('"/api/v1/admin/tags"');
    expect(modul).toContain("/api/v1/admin/termine/${termine[0].id}/tags");
    expect(modul).toContain('"/api/v1/admin/termine/tags"');
  });

  test("Speichern geht über «Rückgängig» und meldet den Stand von Outlook", () => {
    expect(modul).toContain("mitRueckgaengig({");
    expect(modul).toContain("OUTLOOK_TEXT[antwort.outlook]");
    expect(modul).toContain("sammelText(antwort)");
  });

  test("Kalender, Monat und Warnliste bieten «Tags ändern» nur mit dem Recht an", () => {
    expect(modul).toContain("if (!darfTags(ctx)) return null;");
    for (const datei of ["termine-kalender.js", "termine-warnliste.js"]) {
      expect(lies(datei), datei).toContain("termine-tags.js");
    }
    expect(lies("termine-kalender.js")).toContain("tagsKnopf:");
    expect(lies("termine-monat.js")).toContain("tagsKnopf(t,");
  });

  test("Warnliste: Auswahl mit Namen je Zeile, Sammelaktion und Zahl in einer Statusregion", () => {
    const w = lies("termine-warnliste.js");
    expect(w).toContain("«${t.titel}» auswählen");
    expect(w).toContain("Alle geladenen Termine auswählen");
    expect(w).toContain('"Tags setzen"');
    expect(w).toContain('role: "status"');
    expect(w).toContain("ausgewählt");
  });

  test("kein Polling, keine Inline-Stile, kein HTML aus Daten", () => {
    for (const datei of ["termine-tags.js", "termine-warnliste.js"]) {
      const text = lies(datei);
      expect(text, datei).not.toMatch(
        /setInterval|\.style\b|setAttribute\("style"|innerHTML/,
      );
    }
  });
});

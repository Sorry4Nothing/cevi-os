import { describe, expect, test, vi } from "vitest";
import {
  aufWebsiteEreignis,
  meldeWebsiteEreignis,
} from "../src/website/ereignisse.js";
import {
  adresseSchema,
  adressenVon,
  hoeheVon,
  MAX_TIEFE,
  pruefeLage,
  RESERVIERTE_ADRESSEN,
  tiefeVon,
  type Knoten,
} from "../src/website/seiten.js";

// Baum: a > b > c, dazu d (oberste Ebene)
const baum = (): Knoten =>
  new Map(
    [
      ["a", null],
      ["b", "a"],
      ["c", "b"],
      ["d", null],
    ].map(([id, elternId]) => [
      id,
      { id, elternId, adresse: `adr-${id}`, reihenfolge: 0, tagId: null },
    ]),
  ) as Knoten;

describe("Adressen", () => {
  test.each(["biber", "a-1", "x".repeat(60)])("%s ist gültig", (a) => {
    expect(adresseSchema.safeParse(a).success).toBe(true);
  });
  test.each([
    "",
    "Gross",
    "mit leer",
    "ä",
    "unter_strich",
    "a/b",
    ".well-known",
    "robots.txt",
    "x".repeat(61),
  ])("%j ist ungültig", (a) => {
    expect(adresseSchema.safeParse(a).success).toBe(false);
  });
  test("die reservierten Adressen sind genau die der Vorgabe", () => {
    expect([...RESERVIERTE_ADRESSEN].sort()).toEqual(
      [
        "api",
        "admin",
        "health",
        "datenschutz",
        "konto-loeschen",
        "support",
        "website",
        "anmelden",
        "medien",
        "ical",
        "termine",
        "anlass",
        "termin",
        "konto",
        "datenschutz-cevi-os",
        "sitemap.xml",
        "robots.txt",
        ".well-known",
      ].sort(),
    );
  });
});

describe("Baum", () => {
  test("Pfad, Tiefe und Höhe", () => {
    const k = baum();
    expect(adressenVon(k, "c")).toEqual(["adr-a", "adr-b", "adr-c"]);
    expect(adressenVon(k, "gibt-es-nicht")).toEqual([]);
    expect(tiefeVon(k, "c")).toBe(3);
    expect(hoeheVon(k, "a")).toBe(3);
    expect(hoeheVon(k, "d")).toBe(1);
  });

  test("Zyklus: unter sich selbst und unter eine Unterseite", () => {
    const k = baum();
    expect(pruefeLage(k, "a", "a")).toBe("zyklus");
    expect(pruefeLage(k, "a", "c")).toBe("zyklus");
    expect(pruefeLage(k, "b", "c")).toBe("zyklus");
  });

  test("gültige Verschiebung und Wurzel", () => {
    const k = baum();
    expect(pruefeLage(k, "c", "d")).toBe("ok");
    expect(pruefeLage(k, "c", null)).toBe("ok");
    expect(pruefeLage(k, "d", "a")).toBe("ok");
  });

  test(`höchstens ${MAX_TIEFE} Ebenen, auch für einen ganzen Teilbaum`, () => {
    const kette: Knoten = new Map();
    for (let i = 1; i <= MAX_TIEFE; i++) {
      kette.set(`k${i}`, {
        id: `k${i}`,
        elternId: i === 1 ? null : `k${i - 1}`,
        adresse: `k${i}`,
        reihenfolge: 0,
        tagId: null,
      });
    }
    // Neue Seite unter der fünften Ebene wäre die sechste
    expect(pruefeLage(kette, undefined, `k${MAX_TIEFE}`)).toBe("zu_tief");
    expect(pruefeLage(kette, undefined, `k${MAX_TIEFE - 1}`)).toBe("ok");
    expect(pruefeLage(kette, undefined, null)).toBe("ok");
    // Der Teilbaum a > b > c (3 Ebenen) unter die zweite Ebene der Kette: 2 + 3 = 5 geht, unter die dritte nicht
    const k = new Map([...kette, ...baum()]);
    expect(pruefeLage(k, "a", "k2")).toBe("ok");
    expect(pruefeLage(k, "a", "k3")).toBe("zu_tief");
  });

  test("eine kaputte Kette (Schleife in den Daten) endet", () => {
    const k: Knoten = new Map([
      [
        "x",
        { id: "x", elternId: "y", adresse: "x", reihenfolge: 0, tagId: null },
      ],
      [
        "y",
        { id: "y", elternId: "x", adresse: "y", reihenfolge: 0, tagId: null },
      ],
    ]);
    expect(tiefeVon(k, "x")).toBeGreaterThan(0);
    expect(pruefeLage(k, "x", "y")).toBe("zyklus");
  });
});

describe("Ereignisse", () => {
  const ereignis = {
    art: "seite_geaendert",
    abteilungId: "abt",
    seiteId: "seite",
  } as const;

  test("Hörer bekommen das Ereignis, abgemeldet nicht mehr", () => {
    const h = vi.fn();
    const ab = aufWebsiteEreignis(h);
    meldeWebsiteEreignis(ereignis);
    ab();
    meldeWebsiteEreignis(ereignis);
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith(ereignis);
  });

  test("ein Fehler im Hörer (sync oder async) stört die anderen nicht und erscheint nur als Name im Log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const gut = vi.fn();
    const abmelden = [
      aufWebsiteEreignis(() => {
        throw new TypeError("geheim: Titel der Seite");
      }),
      aufWebsiteEreignis(async () => {
        throw new RangeError("geheim");
      }),
      aufWebsiteEreignis(gut),
    ];
    meldeWebsiteEreignis(ereignis);
    await new Promise((r) => setTimeout(r, 0));
    abmelden.forEach((a) => a());
    const zeilen = log.mock.calls.map((a) => String(a[0]));
    log.mockRestore();
    expect(gut).toHaveBeenCalledTimes(1);
    expect(zeilen).toHaveLength(2);
    expect(zeilen.join()).toContain("TypeError");
    expect(zeilen.join()).not.toContain("geheim");
  });
});

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Mein Konto der Verwaltung (#621): reine Funktionen (Rollen, Website nach Rolle, Telefon, Änderungen, Passwort), die Adresse #konto und Quelltext-Prüfungen ohne Browser.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let konto: Modul;
let nav: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {}, history: {} });
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  konto = await lade("konto.js");
  nav = await lade("navigation.js");
  vi.unstubAllGlobals();
});

const quelle = (name: string) =>
  readFileSync(new URL(`../public/admin/${name}`, import.meta.url), "utf8");

const stufen = [
  { id: "s1", name: "Artemis", kuerzel: "" },
  { id: "s2", name: "Pilami", kuerzel: "" },
];
const profil = (extra = {}) => ({
  id: "u1",
  name: "Linn Demo",
  ceviName: "Linn",
  benutzername: "linn.demo",
  telefon: null,
  bildUrl: null,
  abteilungsleitung: false,
  entwickler: false,
  zweiterFaktor: false,
  rollen: [
    { stufeId: "s1", typ: "stufenleitung" },
    { stufeId: "s2", typ: "leitung" },
  ],
  stufen,
  kinder: [],
  pushChat: true,
  pushProgramme: true,
  pushAnmeldungen: true,
  ...extra,
});

describe("Mein Konto: Adresse und Navigation", () => {
  test("#konto gehört zu keinem Bereich der Leiste, jede Person erreicht es", () => {
    const r = nav.loese!("#konto", []);
    expect(r.unter.schluessel).toBe("konto");
    expect(r.unter.modul).toBe("./konto.js");
    expect(r.unter.zugang).toBe("alle");
    expect(r.pfad).toEqual([]);
    const bereiche = nav.BEREICHE as unknown as { schluessel: string }[];
    expect(bereiche.some((b) => b.schluessel === "konto")).toBe(false);
    // Auch ohne sichtbare Bereiche (Stufenleitung ohne Website) bleibt die Seite offen
    expect(nav.loese!("#konto/x", []).pfad).toEqual(["x"]);
  });

  test("Kopf, Router und Stilvorlage kennen die Seite", () => {
    expect(quelle("rahmen.js")).toContain('href: "#konto"');
    expect(quelle("rahmen.js")).toContain("aria-current");
    expect(quelle("index.html")).toContain("/admin/konto.css");
    expect(quelle("admin.js")).toContain("zurAnmeldung");
  });
});

describe("Mein Konto: Rollen und Website", () => {
  test("rollenChips: Abteilungsleitung, Entwickler, Stufenrollen im Klartext", () => {
    const chips = konto.rollenChips!({
      profil: profil({
        abteilungsleitung: true,
        entwickler: true,
        rollen: [],
        stufen: [],
      }),
      zugang: { rechte: [] },
    });
    expect(chips.map((c: { text: string }) => c.text)).toEqual([
      "Abteilungsleitung",
      "Entwickler",
    ]);
    const sl = konto.rollenChips!({ profil: profil(), zugang: { rechte: [] } });
    expect(sl.map((c: { text: string }) => c.text)).toEqual([
      "Stufenleitung Artemis",
      "Leitung Pilami",
    ]);
  });

  test("rollenChips: Website-Redaktion nur bei Rechten, Wartung allein heisst anders", () => {
    const redaktion = konto.rollenChips!({
      profil: profil({ rollen: [], stufen: [] }),
      zugang: { rechte: ["seiten.bearbeiten"] },
    });
    expect(redaktion.map((c: { text: string }) => c.text)).toEqual([
      "Website-Redaktion",
    ]);
    const wartung = konto.rollenChips!({
      profil: profil({ rollen: [], stufen: [] }),
      zugang: { rechte: ["wartungsmodus.website"] },
    });
    expect(wartung[0].text).toBe("Wartung der Website");
    expect(
      konto.rollenChips!({ profil: profil({ rollen: [], stufen: [] }) }),
    ).toEqual([]);
  });

  test("websiteSicht: Leitung mit Cevi-Name erscheint, ohne Cevi-Name oder ohne Rolle nicht", () => {
    const mit = konto.websiteSicht!(
      profil({ bildUrl: "/api/v1/personen/u1/bild?v=1" }),
    );
    expect(mit.sichtbar).toBe(true);
    expect(mit.stufen).toEqual(["Artemis", "Pilami"]);
    expect(mit.text).toContain("«Linn»");
    expect(mit.text).toContain("Profilbild");
    expect(mit.text).toContain("Artemis und Pilami");
    // Ohne Bild sagt der Text, dass keines erscheint
    expect(konto.websiteSicht!(profil()).text).toContain("kein Profilbild");
    // Name im Konto erscheint nie: ohne Cevi-Name keine Anzeige
    const ohneName = konto.websiteSicht!(profil({ ceviName: null }));
    expect(ohneName.sichtbar).toBe(false);
    expect(ohneName.text).toContain("Cevi-Namen");
    const ohneRolle = konto.websiteSicht!(profil({ rollen: [], stufen: [] }));
    expect(ohneRolle.sichtbar).toBe(false);
    expect(ohneRolle.text).toContain("Leitung oder Stufenleitung");
  });

  test("aufzaehlung", () => {
    expect(konto.aufzaehlung!([])).toBe("");
    expect(konto.aufzaehlung!(["A"])).toBe("A");
    expect(konto.aufzaehlung!(["A", "B"])).toBe("A und B");
    expect(konto.aufzaehlung!(["A", "B", "C"])).toBe("A, B und C");
  });
});

describe("Mein Konto: Telefon und Änderungen", () => {
  test("pruefeTelefon: Stufenleitung speichert, andere dürfen nur entfernen", () => {
    expect(
      konto.pruefeTelefon!({
        eingabe: "0791234567",
        original: null,
        istStufenleitung: true,
      }),
    ).toEqual({ wert: "+41 79 123 45 67", fehler: null });
    expect(
      konto.pruefeTelefon!({
        eingabe: "0791234567",
        original: null,
        istStufenleitung: false,
      }).fehler,
    ).toContain("nur Stufenleitungen");
    // Entfernen und unverändert lassen ist jeder Person erlaubt
    expect(
      konto.pruefeTelefon!({
        eingabe: "",
        original: "+41 79 123 45 67",
        istStufenleitung: false,
      }).fehler,
    ).toBeNull();
    expect(
      konto.pruefeTelefon!({
        eingabe: "+41 79 123 45 67",
        original: "+41 79 123 45 67",
        istStufenleitung: false,
      }).fehler,
    ).toBeNull();
    expect(
      konto.pruefeTelefon!({
        eingabe: "12",
        original: null,
        istStufenleitung: true,
      }).fehler,
    ).toContain("passt nicht");
  });

  test("aenderung: nur Geändertes, Nummer entfernen ist null", () => {
    const stand = profil({ telefon: "+41 79 123 45 67" });
    const gleich = {
      telefon: "+41 79 123 45 67",
      pushChat: true,
      pushProgramme: true,
      pushAnmeldungen: true,
    };
    expect(konto.aenderung!(stand, gleich)).toEqual({});
    expect(konto.aenderung!(stand, { ...gleich, telefon: "" })).toEqual({
      telefon: null,
    });
    expect(
      konto.aenderung!(stand, {
        ...gleich,
        pushChat: false,
        telefon: "+41 79 000 00 00",
      }),
    ).toEqual({ pushChat: false, telefon: "+41 79 000 00 00" });
    // Ohne Telefon im Stand ist «leer» keine Änderung; pushAnmeldungen fehlt, wenn die API ihn nicht zeigt
    const ohne = profil({ telefon: null });
    delete (ohne as Record<string, unknown>).pushAnmeldungen;
    expect(
      konto.aenderung!(ohne, {
        telefon: "",
        pushChat: true,
        pushProgramme: true,
      }),
    ).toEqual({});
  });
});

describe("Mein Konto: Passwort", () => {
  test("pruefePasswort: Länge und Unterschied wie beim Server", () => {
    expect(
      konto.pruefePasswort!({ aktuell: "", neu: "x".repeat(12) })?.[0],
    ).toBe("aktuell");
    expect(konto.pruefePasswort!({ aktuell: "a", neu: "kurz" })?.[0]).toBe(
      "neu",
    );
    expect(
      konto.pruefePasswort!({ aktuell: "a", neu: "x".repeat(129) })?.[1],
    ).toContain("höchstens 128");
    expect(
      konto.pruefePasswort!({
        aktuell: "x".repeat(12),
        neu: "x".repeat(12),
      })?.[1],
    ).toContain("unterscheiden");
    expect(
      konto.pruefePasswort!({ aktuell: "alt", neu: "ein-neues-passwort" }),
    ).toBeNull();
  });

  test("passwortFehler: bekannte Codes der API haben deutschen Text beim richtigen Feld", () => {
    for (const code of [
      "INVALID_PASSWORD",
      "PASSWORD_TOO_SHORT",
      "PASSWORD_TOO_LONG",
      "PASSWORT_UNVERAENDERT",
      "PASSWORD_COMPROMISED",
    ]) {
      const f = konto.passwortFehler!(code);
      expect(f?.[0]).toMatch(/^(aktuell|neu)$/);
      expect(f?.[1]).toMatch(/[a-zäöü]/);
    }
    expect(konto.passwortFehler!("INVALID_PASSWORD")?.[0]).toBe("aktuell");
    expect(konto.passwortFehler!("UNBEKANNT")).toBeNull();
  });
});

describe("Mein Konto: Quelltext", () => {
  test("nur Routen für die eigene Person, nichts Fremdes", () => {
    const q = quelle("konto.js");
    for (const pfad of [
      "/api/v1/ich",
      "/api/v1/ich/bild",
      "/api/auth/change-password",
      "/api/auth/revoke-sessions",
    ]) {
      expect(q).toContain(`"${pfad}"`);
    }
    expect(q).not.toContain("/api/v1/admin");
    // Keine Popups, keine nativen Dialoge, keine Inline-Stile
    expect(q).not.toMatch(/\b(alert|confirm|prompt)\(/);
    expect(q).not.toContain("style:");
    expect(quelle("konto.css").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(
      /#[0-9a-fA-F]{3,8}\b/,
    );
  });

  test("Zerstörendes ist zweistufig, Bewegung nur bei erlaubter Bewegung", () => {
    const q = quelle("konto.js");
    expect(q.match(/zweiStufig\(/g)?.length).toBe(2);
    const css = quelle("konto.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toContain("transition: all");
    expect(css).toContain("prefers-reduced-motion: no-preference");
  });
});

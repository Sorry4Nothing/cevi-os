import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// Reines Browser-Modul ohne Typen
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as skript from "../public/website/navigation-plan.js";
import {
  baueGeschuetzteNavigation,
  type NavZeile,
} from "../src/website/navigation-angemeldet.js";
import type { Gruppe } from "../src/sichtbarkeit.js";

const { ausPlan, pfadVon, plane, pruefeAntwort } = skript as {
  ausPlan: (plan: Plan[], aktuell: string) => boolean;
  pfadVon: (pathname: string) => string;
  plane: (e: unknown[], vorhanden: Set<string>, aktuell: string) => Plan[];
  pruefeAntwort: (d: unknown) => unknown[] | null;
};
type Plan = {
  pfad: string;
  eltern: string | null;
  davor: string | null;
  stand: string | null;
};

// Menü für Angemeldete (#795): die Auswahl der Seiten (reine Funktion, ohne Datenbank) und die Logik des Skripts (navigation-plan.js). Route und Datenschutz mit Datenbank: test/website-navigation.test.ts

const ABT = "abt-a";
const T = "tag-t";
const X = "tag-x";
const person = (
  extra: Partial<Parameters<typeof baueGeschuetzteNavigation>[2]> = {},
) => ({
  id: "p1",
  abteilungId: ABT,
  abteilungsleitung: false,
  entwickler: false,
  gruppen: [] as Gruppe[],
  ...extra,
});

let n = 0;
const z = (adresse: string, extra: Partial<NavZeile> = {}): NavZeile => ({
  id: `id-${adresse}`,
  elternId: null,
  adresse,
  titel: adresse.toUpperCase(),
  reihenfolge: ++n,
  sichtbarkeit: "oeffentlich",
  sichtbarkeitTags: [],
  sichtbarkeitRollen: {},
  veroeffentlichteVersionId: "v",
  ...extra,
});
// Adresse im Netz aus der Kette der Elternseiten
const pfade = (zeilen: NavZeile[]) => (id: string) => {
  const nachId = new Map(zeilen.map((s) => [s.id, s]));
  const kette: string[] = [];
  for (
    let s = nachId.get(id);
    s && kette.length < 20;
    s = s.elternId ? nachId.get(s.elternId) : undefined
  ) {
    kette.unshift(s.adresse);
  }
  return kette.length > 0 ? `/${kette.join("/")}` : null;
};
const lauf = (
  zeilen: NavZeile[],
  p = person(),
  aus: ReadonlySet<string> = new Set(),
) => baueGeschuetzteNavigation(zeilen, ABT, p, pfade(zeilen), aus);

const baum = () => {
  n = 0;
  const stufen = z("stufen");
  const woelfe = z("woelfe", { elternId: stufen.id });
  const intern = z("intern", {
    elternId: stufen.id,
    sichtbarkeit: "tags",
    sichtbarkeitTags: [T],
    reihenfolge: 0,
  });
  const leitung = z("leitung", {
    elternId: intern.id,
    sichtbarkeit: "tags",
    sichtbarkeitTags: [X],
  });
  const fotos = z("fotos", { sichtbarkeit: "angemeldet", titel: "Fotos" });
  const kontakt = z("kontakt");
  return { zeilen: [stufen, woelfe, intern, leitung, fotos, kontakt] };
};

describe("Auswahl der Seiten", () => {
  test("angemeldet: jede Person der Abteilung sieht «Fotos», an der Stelle des Baums, vor der nächsten öffentlichen Seite", () => {
    const { zeilen } = baum();
    expect(lauf(zeilen)).toEqual([
      { pfad: "/fotos", titel: "Fotos", eltern: null, davor: "/kontakt" },
    ]);
  });

  test("Gruppe: nur wer den Tag trägt; die Seite steht in der Elternseite, in der Reihenfolge der Seitenliste", () => {
    const { zeilen } = baum();
    expect(
      lauf(zeilen, person({ gruppen: [{ tagId: T, rolle: "teilnehmende" }] })),
    ).toEqual([
      { pfad: "/fotos", titel: "Fotos", eltern: null, davor: "/kontakt" },
      {
        pfad: "/stufen/intern",
        titel: "INTERN",
        eltern: "/stufen",
        davor: "/stufen/woelfe",
      },
    ]);
  });

  test("eine Seite unter einer Seite, die die Person nicht sieht, hängt an der nächsten sichtbaren Elternseite; nichts verrät die unsichtbare", () => {
    const { zeilen } = baum();
    const e = lauf(
      zeilen,
      person({ gruppen: [{ tagId: X, rolle: "teilnehmende" }] }),
    );
    expect(e.find((s) => s.pfad === "/stufen/intern/leitung")).toEqual({
      pfad: "/stufen/intern/leitung",
      titel: "LEITUNG",
      eltern: "/stufen",
      davor: null,
    });
    expect(JSON.stringify(e)).not.toContain("INTERN");
  });

  test("Abteilungsleitung und Entwickler sehen alle geschützten Seiten der Abteilung, Eltern vor Kindern", () => {
    const { zeilen } = baum();
    for (const p of [
      person({ abteilungsleitung: true }),
      person({ entwickler: true }),
    ]) {
      expect(lauf(zeilen, p).map((s) => s.pfad)).toEqual([
        "/fotos",
        "/stufen/intern",
        "/stufen/intern/leitung",
      ]);
    }
  });

  test("Tag-Seite mit leerer Tag-Menge: nur die Abteilungsleitung", () => {
    n = 0;
    const s = [z("leer", { sichtbarkeit: "tags", sichtbarkeitTags: [] })];
    expect(lauf(s)).toEqual([]);
    expect(lauf(s, person({ abteilungsleitung: true }))).toHaveLength(1);
  });

  test("nie: Entwürfe ohne veröffentlichte Version, öffentliche Seiten, fremde Abteilung", () => {
    const { zeilen } = baum();
    const mit = [
      ...zeilen,
      z("entwurf", {
        sichtbarkeit: "angemeldet",
        veroeffentlichteVersionId: null,
      }),
    ];
    const alle = lauf(mit, person({ abteilungsleitung: true })).map(
      (s) => s.pfad,
    );
    expect(alle).not.toContain("/entwurf");
    expect(alle).not.toContain("/stufen");
    expect(alle).not.toContain("/kontakt");
    // Eine Person einer anderen Abteilung sieht nichts, auch nicht als Abteilungsleitung
    expect(
      lauf(mit, person({ abteilungId: "abt-b", abteilungsleitung: true })),
    ).toEqual([]);
  });

  test("Adressen, die nie ausgeliefert werden, und die Startseite fehlen; Impressum zählt nicht als Elternseite im Menü", () => {
    n = 0;
    const start = z("start", { sichtbarkeit: "angemeldet" });
    const impressum = z("impressum");
    const unter = z("verein", {
      elternId: impressum.id,
      sichtbarkeit: "angemeldet",
    });
    const zeilen = [start, impressum, unter];
    const e = baueGeschuetzteNavigation(
      zeilen,
      ABT,
      person(),
      (id) => (id === start.id ? "/" : pfade(zeilen)(id)),
      new Set(["/impressum"]),
    );
    expect(e).toEqual([
      { pfad: "/impressum/verein", titel: "VEREIN", eltern: null, davor: null },
    ]);
    expect(
      baueGeschuetzteNavigation(zeilen, ABT, person(), () => null),
    ).toEqual([]);
  });

  test("zwei geschützte Seiten vor derselben öffentlichen Seite behalten ihre Reihenfolge", () => {
    n = 0;
    const a = z("a-seite");
    const b = z("b-seite", { sichtbarkeit: "angemeldet" });
    const c = z("c-seite", { sichtbarkeit: "angemeldet" });
    const d = z("d-seite");
    expect(lauf([a, b, c, d]).map((s) => [s.pfad, s.davor])).toEqual([
      ["/b-seite", "/d-seite"],
      ["/c-seite", "/d-seite"],
    ]);
  });

  test("eine Kette mit Schleife in der Datenbank macht keine Endlosschleife", () => {
    n = 0;
    const a = z("aa", { sichtbarkeit: "angemeldet" });
    const b = z("bb", { sichtbarkeit: "angemeldet" });
    a.elternId = b.id;
    b.elternId = a.id;
    expect(() =>
      baueGeschuetzteNavigation([a, b], ABT, person(), (id) => `/${id}`),
    ).not.toThrow();
  });
});

describe("Skript: Antwort prüfen", () => {
  const ok = { pfad: "/fotos", titel: "Fotos", eltern: null, davor: null };
  test("gültige Form wird übernommen", () => {
    expect(pruefeAntwort({ eintraege: [ok] })).toEqual([ok]);
    expect(pruefeAntwort({ eintraege: [] })).toEqual([]);
  });
  test.each([
    ["kein Objekt", null],
    ["ohne Liste", {}],
    ["Adresse mit Anfrage", { eintraege: [{ ...ok, pfad: "/a?x=1" }] }],
    ["fremde Adresse", { eintraege: [{ ...ok, pfad: "https://x.example/a" }] }],
    ["Adresse ohne Schrägstrich", { eintraege: [{ ...ok, pfad: "fotos" }] }],
    ["leerer Titel", { eintraege: [{ ...ok, titel: " " }] }],
    ["Titel kein Text", { eintraege: [{ ...ok, titel: 5 }] }],
    ["Elternseite ungültig", { eintraege: [{ ...ok, eltern: "//x" }] }],
    ["davor fehlt", { eintraege: [{ pfad: "/a", titel: "A", eltern: null }] }],
    ["zu viele", { eintraege: Array.from({ length: 201 }, () => ok) }],
  ])("%s wird verworfen", (_, d) => {
    expect(pruefeAntwort(d)).toBeNull();
  });
});

describe("Skript: Plan für das Menü", () => {
  const e = (
    pfad: string,
    eltern: string | null = null,
    davor: string | null = null,
  ) => ({ pfad, titel: pfad, eltern, davor });

  test("Einträge, die das Menü schon hat, kommen nie doppelt", () => {
    const p = plane([e("/stufen"), e("/fotos")], new Set(["/stufen"]), "/");
    expect(p.map((x) => x.pfad)).toEqual(["/fotos"]);
  });

  test("Elternseite: im Menü oder weiter oben im Plan, sonst die oberste Ebene", () => {
    const p = plane(
      [e("/a/b", "/a"), e("/c/d", "/c"), e("/a/b/e", "/a/b")],
      new Set(["/a"]),
      "/",
    );
    expect(p.map((x) => [x.pfad, x.eltern])).toEqual([
      ["/a/b", "/a"],
      ["/c/d", null],
      ["/a/b/e", "/a/b"],
    ]);
  });

  test("davor gilt nur für Punkte, die das Menü schon hat", () => {
    const p = plane(
      [e("/x", null, "/y"), e("/z", null, "/x")],
      new Set(["/y"]),
      "/",
    );
    expect(p.map((x) => x.davor)).toEqual(["/y", null]);
  });

  test("aria-current: «page» auf der aktuellen Seite, «true» auf ihrer Elternseite", () => {
    const p = plane([e("/a"), e("/a/b", "/a"), e("/c")], new Set(), "/a/b");
    expect(p.map((x) => x.stand)).toEqual(["true", "page", null]);
    expect(ausPlan(p, "/a/b")).toBe(true);
    expect(ausPlan(p, "/a/b/c")).toBe(false);
  });

  test("Adresse der aktuellen Seite ohne Schrägstrich am Ende", () => {
    expect(pfadVon("/fotos/")).toBe("/fotos");
    expect(pfadVon("/")).toBe("/");
  });
});

describe("Skript: nur der eigene Ursprung, kein HTML", () => {
  const lies = (datei: string) =>
    readFileSync(
      new URL(`../public/website/${datei}`, import.meta.url),
      "utf8",
    ).replace(/^\s*\/\/.*$/gm, "");
  test.each(["navigation.js", "navigation-plan.js"])(
    "%s: kein innerHTML, keine fremde Adresse, kein Speicher",
    (datei) => {
      const s = lies(datei);
      expect(s).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|document\.write|localStorage|sessionStorage|document\.cookie/,
      );
      expect(s).not.toMatch(/https?:\/\//);
    },
  );
  test("navigation.js fragt nur die Route für Angemeldete; geladen wird es nur von konto-menue.js, mit bestätigter Sitzung", () => {
    expect(lies("navigation.js")).toContain('"/api/v1/website/navigation"');
    const konto = lies("konto-menue.js");
    expect(konto).toContain('import("./navigation.js")');
    expect(konto.indexOf('import("./navigation.js")')).toBeGreaterThan(
      konto.indexOf("merke(true)"),
    );
  });
});

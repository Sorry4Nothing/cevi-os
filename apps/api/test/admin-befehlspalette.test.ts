import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Suche der Verwaltung (#602, #611): reine Funktionen ohne Browser.
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

const bereicheFuer = (person: object) =>
  (nav.sichtbareBereiche as (p: object) => unknown[])(person);
const admin = () => bereicheFuer({ abteilungsleitung: true, zugang: null });
const stufenleitung = () =>
  bereicheFuer({
    abteilungsleitung: false,
    zugang: { bereiche: ["website"], rechte: [] },
  });

// Daten in der Form, die die Quellen der Palette liefern
const konto = {
  deaktiviert: false,
  mussPasswortAendern: false,
  startpasswortGueltigBis: null,
  zweiterFaktor: false,
};
const daten = () => ({
  personen: [
    {
      id: "p1",
      name: "Demo Kind",
      ceviName: "Pfeil",
      benutzername: "demo.kind",
      bildUrl: null,
      rollen: ["Stufenleitung"],
      tags: [{ name: "Artemis", typ: "stufe" }],
      konto,
    },
    {
      id: "p2",
      name: "Muster Leitung",
      ceviName: "",
      benutzername: "",
      bildUrl: null,
      rollen: [],
      tags: [],
      konto,
    },
  ],
  tags: [
    {
      id: "t1",
      name: "Artemis",
      typ: "stufe",
      typText: "Stufe",
      kuerzel: "",
      anzahlPersonen: 3,
    },
  ],
  termine: [
    {
      id: "m1",
      titel: "Weihnachtsfest",
      ort: "Pfadiheim",
      tagIso: "2026-12-05",
      datumText: "Sa 05.12.2026",
      zeitText: "ganztägig",
      gruppen: ["Artemis"],
      anlass: true,
      status: null,
    },
  ],
  anlaesse: [
    {
      id: "a1",
      titel: "Sommerfest",
      fuer: "",
      zeitText: "Sa 06.02.2027, ganztägig",
      status: { text: "Anmeldung offen", art: "ok" },
    },
  ],
  seiten: [
    {
      id: "s1",
      titel: "Auffahrtslager",
      pfad: "/anlaesse/auffahrtslager",
      zugang: "Öffentlich",
      status: { text: "Veröffentlicht", art: "ok" },
    },
  ],
  lager: [
    {
      id: "l1",
      titel: "Herbstweekend",
      ort: "Lagerhaus",
      zeitraum: "02.–03.10.2027",
      status: { text: "Entwurf", art: "warn" },
    },
  ],
});

type Eintrag = {
  gruppe: string;
  titel: string;
  id: string;
  adresse: string;
  wunsch?: object;
};
type Ergebnis = {
  abschnitte: {
    gruppe: { schluessel: string };
    eintraege: Eintrag[];
    mehr: number;
  }[];
  zaehler: Record<string, number>;
};
const liste = (bereiche: unknown[], d: object = daten()) =>
  palette.kandidaten!({ bereiche, daten: d }) as Eintrag[];
const suche = (
  bereiche: unknown[],
  frage: string,
  scope = "alle",
  zuletzt: string[] = [],
  d: object = daten(),
) =>
  palette.suchen!({
    liste: liste(bereiche, d),
    frage,
    scope,
    zuletzt,
  }) as Ergebnis;
const titel = (r: Ergebnis) =>
  r.abschnitte.flatMap((a) => a.eintraege.map((e) => e.titel));

describe("Text vergleichen", () => {
  test("punkte: alle Wörter müssen vorkommen, Umlaute und Grossschreibung zählen nicht", () => {
    expect(palette.punkte!("UEBERSICHT", "Übersicht Übersicht")).not.toBeNull();
    expect(palette.punkte!("neue pers", "Neue Person")).not.toBeNull();
    expect(palette.punkte!("xyz", "Neue Person")).toBeNull();
    expect(palette.punkte!("neue xyz", "Neue Person")).toBeNull();
    expect(palette.punkte!("", "Neue Person")).toBe(0);
    // Wortanfang schlägt Mitte
    expect(palette.punkte!("son", "Person")!).toBeLessThan(
      palette.punkte!("per", "Person")!,
    );
  });

  test("bewerte: ein Feld mit mehr Gewicht schlägt eines mit weniger", () => {
    const name = palette.bewerte!("art", [
      ["Artemis", 4],
      ["Zeitung", 1],
    ]);
    const nurBeschreibung = palette.bewerte!("art", [
      ["Zeitung", 4],
      ["Artikel", 1],
    ]);
    expect(name).toBeGreaterThan(nurBeschreibung);
    // Jedes Wort in irgendeinem Feld genügt
    expect(
      palette.bewerte!("linn zürich", [
        ["Linn Demo", 4],
        ["Zürich", 1],
      ]),
    ).not.toBeNull();
    expect(palette.bewerte!("linn bern", [["Linn Demo", 4]])).toBeNull();
  });

  test("trefferStellen: Stellen im Original, auch bei Umlauten und mehreren Wörtern", () => {
    expect(palette.trefferStellen!("uebersicht", "Übersicht")).toEqual([
      [0, 9],
    ]);
    expect(palette.trefferStellen!("pers", "Neue Person")).toEqual([[5, 9]]);
    // «ae» trifft das «ä» als Ganzes
    expect(palette.trefferStellen!("ae", "Käse")).toEqual([[1, 2]]);
    // Zwei Wörter, die sich berühren, verschmelzen; sonst bleiben zwei Stellen
    expect(palette.trefferStellen!("de mo", "Demo")).toEqual([[0, 4]]);
    expect(palette.trefferStellen!("de re", "Demo Reta")).toEqual([
      [0, 2],
      [5, 7],
    ]);
    expect(palette.trefferStellen!("", "Demo")).toEqual([]);
    expect(palette.trefferStellen!("x", "")).toEqual([]);
  });
});

describe("Kandidaten und Treffer", () => {
  test("ohne Frage: Zuletzt benutzt, Aktionen und die ersten Seiten, keine Personen", () => {
    const r = suche(admin(), "", "alle", ["person-p1", "gibt-es-nicht"]);
    expect(r.abschnitte.map((a) => a.gruppe.schluessel)).toEqual([
      "zuletzt",
      "aktionen",
      "seiten",
    ]);
    expect(r.abschnitte[0]!.eintraege.map((e) => e.titel)).toEqual([
      "Demo Kind",
    ]);
    expect(r.abschnitte[1]!.eintraege.map((e) => e.titel)).toEqual([
      "Neue Person",
      "Neues Lager",
    ]);
    // «Alle» zeigt von den Seiten nur die ersten acht, den Rest nennt «mehr»
    expect(r.abschnitte[2]!.eintraege).toHaveLength(8);
    expect(r.abschnitte[2]!.mehr).toBeGreaterThan(0);
  });

  test("mit Frage: jede Gruppe mit ihren Treffern", () => {
    const r = suche(admin(), "artemis");
    // Die Gruppe «Artemis» selbst ist der beste Treffer, danach folgen Person und Termin mit gleichem Gewicht in der Reihenfolge der Gruppen
    expect(r.abschnitte.map((a) => a.gruppe.schluessel)).toEqual([
      "tags",
      "personen",
      "termine",
    ]);
    expect(r.zaehler.personen).toBe(1);
    expect(r.zaehler.tags).toBe(1);
    expect(r.zaehler.termine).toBe(1);
    // Die Person trägt den Tag: Sie wird über ihre Gruppe gefunden
    expect(titel(r)).toContain("Demo Kind");
  });

  test("Enter öffnet das Wahrscheinlichste: ein gleich guter Inhalt steht vor der Aktion", () => {
    const lager = suche(admin(), "lager");
    expect(lager.abschnitte[0]!.gruppe.schluessel).toBe("seiten");
    const neu = suche(admin(), "neue person");
    expect(neu.abschnitte[0]!.eintraege[0]!.titel).toBe("Neue Person");
  });

  test("Cevi-Name, Rolle und Benutzername finden die Person", () => {
    expect(titel(suche(admin(), "pfeil"))).toEqual(["Demo Kind"]);
    expect(titel(suche(admin(), "stufenleitung"))).toContain("Demo Kind");
    expect(titel(suche(admin(), "demo.kind"))).toEqual(["Demo Kind"]);
  });

  test("ein Reiter zeigt nur seine Gruppe, mit der grossen Grenze", () => {
    const r = suche(admin(), "", "personen");
    expect(r.abschnitte).toHaveLength(1);
    expect(r.abschnitte[0]!.gruppe.schluessel).toBe("personen");
    expect(r.abschnitte[0]!.eintraege).toHaveLength(2);
    expect(titel(suche(admin(), "", "lager"))).toEqual(["Herbstweekend"]);
  });

  test("die Kappung im Reiter «Alle» nennt, wie viele fehlen", () => {
    const viele = {
      ...daten(),
      personen: Array.from({ length: 9 }, (_, i) => ({
        ...daten().personen[0]!,
        id: `x${i}`,
        name: `Demo Person ${i}`,
      })),
    };
    const r = suche(admin(), "demo person", "alle", [], viele);
    const personen = r.abschnitte.find(
      (a) => a.gruppe.schluessel === "personen",
    )!;
    expect(personen.eintraege).toHaveLength(6);
    expect(personen.mehr).toBe(3);
    expect(r.zaehler.personen).toBe(9);
  });

  test("ohne Recht keine Aktion, keine Seite, keine Person, kein Lager, kein Termin", () => {
    const l = liste(stufenleitung());
    // Die Stufenleitung hat nur die Seiten der Navigation und die Website-Seiten
    expect([...new Set(l.map((e) => e.gruppe))].sort()).toEqual([
      "seiten",
      "website",
    ]);
    const namen = l.map((e) => e.titel);
    expect(namen).not.toContain("Neue Person");
    expect(namen).not.toContain("Demo Kind");
    expect(namen).not.toContain("Herbstweekend");
    expect(namen).not.toContain("Einstellungen");
    expect(namen).toContain("Seiten");
    // Auch mit der Frage nach Namen der anderen Gruppen kommt nichts durch
    expect(titel(suche(stufenleitung(), "demo"))).toEqual([]);
    expect(titel(suche(stufenleitung(), "herbst"))).toEqual([]);
  });

  test("Adressen: jede Gruppe führt auf eine Seite, die die Person öffnen darf", () => {
    const alle = liste(admin());
    const adressen = Object.fromEntries(alle.map((e) => [e.id, e.adresse]));
    expect(adressen["person-p1"]).toBe("#personen/personen");
    expect(adressen["tag-t1"]).toBe("#personen/gruppen/t1");
    expect(adressen["termin-m1"]).toBe("#termine/kalender/2026-12-05");
    expect(adressen["anlass-a1"]).toBe("#anlaesse/a1");
    expect(adressen["webseite-s1"]).toBe("#website/seiten/s1");
    expect(adressen["lager-l1"]).toBe("#lager/lager/l1");
    expect(adressen["aktion-lager-neu"]).toBe("#lager/lager/neu");
    // Eine Person lässt sich öffnen: Die Seite bekommt die Kennung
    expect(alle.find((e) => e.id === "person-p1")!.wunsch).toEqual({
      art: "person",
      frage: "Demo Kind",
      id: "p1",
    });
  });

  test("erlaubteGruppen und quellenFuer folgen der Navigation", () => {
    expect(palette.erlaubteGruppen!(admin())).toEqual([
      "seiten",
      "personen",
      "tags",
      "termine",
      "anlaesse",
      "website",
      "lager",
    ]);
    expect(palette.erlaubteGruppen!(stufenleitung())).toEqual([
      "seiten",
      "website",
    ]);
    // Die Liste «Personen» bringt die Gruppen mit: keine eigene Abfrage dafür
    expect(palette.quellenFuer!(admin())).toEqual([
      "personen",
      "termine",
      "anlaesse",
      "website",
      "lager",
    ]);
    expect(palette.quellenFuer!(stufenleitung())).toEqual(["website"]);
    expect(palette.quellenFuer!([])).toEqual([]);
  });

  test("tippText nennt nur, was die Person finden darf", () => {
    expect(palette.tippText!(["seiten"])).toBe("Tippe eine Seite.");
    expect(palette.tippText!(["seiten", "website"])).toBe(
      "Tippe eine Seite oder eine Website-Seite.",
    );
    expect(palette.tippText!(palette.erlaubteGruppen!(admin()))).toBe(
      "Tippe einen Namen oder Cevi-Namen, eine Seite, eine Gruppe, einen Termin, einen Anlass, eine Website-Seite oder ein Lager.",
    );
  });
});

describe("Daten im Speicher", () => {
  test("von einer Person bleibt nur, was die Suche braucht: nie Startpasswort, Telefon oder Kinder", () => {
    const roh = {
      id: "p1",
      name: "Demo Kind",
      ceviName: null,
      benutzername: "demo.kind",
      bildUrl: "/api/v1/personen/p1/bild?v=1",
      telefon: "+41 44 000 00 00",
      startpasswort: "ABCD-EFGH-JKLM",
      abteilungsleitung: false,
      zweiterFaktor: true,
      deaktiviert: false,
      mussPasswortAendern: true,
      startpasswortGueltigBis: "2026-12-01T00:00:00.000Z",
      rollen: [{ stufeId: "s", typ: "leitung", prioritaet: 0 }],
      elternteilVon: ["kind-1", "kind-2"],
    };
    const hilfen = { systemRollen: () => ["Leitung"], typName: () => "Stufe" };
    const p = palette.normalisierePerson!(
      roh,
      [{ tag: { name: "Artemis", typ: "stufe" }, rolle: null }],
      hilfen,
    );
    const text = JSON.stringify(p);
    expect(text).not.toContain("ABCD");
    expect(text).not.toContain("+41");
    expect(text).not.toContain("kind-1");
    expect(p.rollen).toEqual(["Leitung"]);
    expect(p.tags).toEqual([{ name: "Artemis", typ: "stufe" }]);
    expect(p.ceviName).toBe("");
    expect(Object.keys(p).sort()).toEqual([
      "benutzername",
      "bildUrl",
      "ceviName",
      "id",
      "konto",
      "name",
      "rollen",
      "rollenNeutral",
      "tags",
    ]);
  });

  test("keine Abfrage je Tastendruck: Laden startet nur beim Öffnen", () => {
    const quelle = readFileSync(
      new URL("../public/admin/befehlspalette.js", import.meta.url),
      "utf8",
    );
    // Eine Definition und ein Aufruf in oeffne(); der Zuhörer für die Eingabe filtert nur
    expect(quelle.match(/starteLaden\(/g)).toHaveLength(2);
    expect(quelle).toContain('eingabe.addEventListener("input", neueFrage)');
    expect(quelle).toContain('role: "combobox"');
  });

  test("ein Wunsch gilt genau einmal", () => {
    expect(palette.nimmWunsch!()).toBeNull();
  });
});

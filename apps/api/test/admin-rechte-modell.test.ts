import { describe, expect, test } from "vitest";
// @ts-expect-error: Die Verwaltung besteht aus Browser-Modulen ohne Typen
import * as m from "../public/admin/rechte-modell.js";

// Rollen und Rechte (#651): reine Logik der Seite (Entwurf, Unterschied, Vorschau, Rechtesuche, Verlauf)

const katalog = {
  bereiche: [
    { id: "website", name: "Website" },
    { id: "anlaesse", name: "Anlässe" },
  ],
  rechte: [
    {
      id: "seiten.bearbeiten",
      bereich: "website",
      klartext: "Seiten bearbeiten",
      art: "vergebbar",
      geltungen: ["alle", "eigene"],
      gruppenrolle: true,
      nurEntwickler: false,
    },
    {
      id: "wartungsmodus.website",
      bereich: "website",
      klartext: "Wartung",
      art: "vergebbar",
      geltungen: ["alle"],
      gruppenrolle: false,
      nurEntwickler: false,
    },
    {
      id: "anlass.anmeldungen_sehen",
      bereich: "anlaesse",
      klartext: "Anmeldungen sehen",
      art: "vergebbar",
      geltungen: ["alle", "eigene"],
      gruppenrolle: true,
      nurEntwickler: false,
    },
    {
      id: "anlass.anmelden",
      bereich: "anlaesse",
      klartext: "Anmelden",
      art: "struktur",
      geltungen: [],
      gruppenrolle: false,
      nurEntwickler: false,
    },
  ],
};

const rolle = (
  id: string,
  rechte: [string, string][],
  personen: string[] = [],
) => ({
  id,
  art: "gruppe",
  name: id,
  system: false,
  version: 1,
  rechte: rechte.map(([recht, geltung]) => ({ recht, geltung })),
  fest: [],
  personen: personen.map((p) => ({ id: p, name: p })),
});

describe("Entwurf", () => {
  test("ein Wechsel hin und zurück ist keine Änderung", () => {
    const r = rolle("a", [["seiten.bearbeiten", "eigene"]]);
    const e = m.neuerEntwurf();
    m.setzeZelle(e, r, "seiten.bearbeiten", "alle");
    expect(m.anzahlAenderungen(e)).toBe(1);
    m.setzeZelle(e, r, "seiten.bearbeiten", "eigene");
    expect(m.anzahlAenderungen(e)).toBe(0);
    expect(e.size).toBe(0);
  });

  test("der Entwurf hält nur geänderte Zellen und liefert die Rechte in Katalogreihenfolge", () => {
    const r = rolle("a", [["anlass.anmeldungen_sehen", "eigene"]]);
    const e = m.neuerEntwurf();
    m.setzeZelle(e, r, "seiten.bearbeiten", "eigene");
    m.setzeZelle(e, r, "anlass.anmeldungen_sehen", "aus");
    const reihe = katalog.rechte.map((x) => x.id);
    expect(m.zuteilungenMitEntwurf(r, e, reihe)).toEqual([
      { recht: "seiten.bearbeiten", geltung: "eigene" },
    ]);
    expect(m.wertIm(e, r, "anlass.anmeldungen_sehen")).toBe("aus");
    expect(m.anzahlRollen(e)).toBe(1);
  });

  test("Unterschied je Rolle trennt dazu und weg", () => {
    const r = rolle("a", [["anlass.anmeldungen_sehen", "eigene"]]);
    const e = m.neuerEntwurf();
    m.setzeZelle(e, r, "seiten.bearbeiten", "alle");
    m.setzeZelle(e, r, "anlass.anmeldungen_sehen", "aus");
    const [a] = m.aenderungenJeRolle([r], e);
    expect(a.hinzu).toEqual([
      { recht: "seiten.bearbeiten", von: "aus", nach: "alle" },
    ]);
    expect(a.weg).toEqual([
      { recht: "anlass.anmeldungen_sehen", von: "eigene", nach: "aus" },
    ]);
  });

  test("grosse Wirkung: neu oder weiter gefasst fragt, enger oder weg nicht", () => {
    const r = rolle("a", [["anlass.anmeldungen_sehen", "alle"]]);
    const e = m.neuerEntwurf();
    m.setzeZelle(e, r, "anlass.anmeldungen_sehen", "eigene");
    expect(m.grosseWirkungen([r], e)).toEqual([]);
    const r2 = rolle("b", [["anlass.anmeldungen_sehen", "eigene"]]);
    const e2 = m.neuerEntwurf();
    m.setzeZelle(e2, r2, "anlass.anmeldungen_sehen", "alle");
    expect(m.grosseWirkungen([r2], e2)).toHaveLength(1);
    // Ein Recht ohne Marke fragt nie
    const e3 = m.neuerEntwurf();
    m.setzeZelle(e3, r2, "seiten.bearbeiten", "alle");
    expect(m.grosseWirkungen([r2], e3)).toEqual([]);
  });

  test("Konflikt: der neue Stand gilt, eigene Zellen, die schon stimmen, fallen weg", () => {
    const r = rolle("a", [["seiten.bearbeiten", "eigene"]]);
    const e = m.neuerEntwurf();
    m.setzeZelle(e, r, "seiten.bearbeiten", "alle");
    m.setzeZelle(e, r, "anlass.anmeldungen_sehen", "eigene");
    // Jemand anderes hat «Seiten bearbeiten» schon auf «alle» gestellt
    m.uebernehmeStand(e, r, {
      version: 5,
      rechte: [{ recht: "seiten.bearbeiten", geltung: "alle" }],
    });
    expect(r.version).toBe(5);
    expect([...e.get("a").keys()]).toEqual(["anlass.anmeldungen_sehen"]);
  });
});

describe("Vorschau", () => {
  test("zählt Personen einmal und lässt die Abteilungsleitung aus", () => {
    const a = rolle("a", [], ["p1", "p2", "admin"]);
    const b = rolle("b", [], ["p2"]);
    const e = m.neuerEntwurf();
    m.setzeZelle(e, a, "seiten.bearbeiten", "eigene");
    m.setzeZelle(e, b, "seiten.bearbeiten", "eigene");
    const v = m.betroffene([a, b], e, new Set(["admin"]));
    expect(v.personen).toBe(2);
    expect(v.jeRolle.map((x: { personen: number }) => x.personen)).toEqual([
      2, 1,
    ]);
    expect(m.vorschauText(v)).toMatch(/2 Personen/);
  });

  test("eine Rolle ohne Personen betrifft niemanden", () => {
    const a = rolle("a", [], []);
    const e = m.neuerEntwurf();
    m.setzeZelle(e, a, "seiten.bearbeiten", "alle");
    expect(m.vorschauText(m.betroffene([a], e))).toMatch(/Niemand/);
  });
});

describe("Katalog und Vorschläge", () => {
  test("Gruppenrollen bieten nicht an, was der Katalog ihnen verwehrt", () => {
    expect(
      m.rechteFuer(katalog, "gruppe").map((r: { id: string }) => r.id),
    ).toEqual(["seiten.bearbeiten", "anlass.anmeldungen_sehen"]);
    expect(m.rechteFuer(katalog, "global")).toHaveLength(3);
  });

  test("«eigene» gibt es nur bei Gruppenrollen und nur, wo der Katalog es kennt", () => {
    const [bearbeiten, wartung] = katalog.rechte;
    expect(m.geltungenFuer(bearbeiten, "gruppe")).toEqual([
      "aus",
      "eigene",
      "alle",
    ]);
    expect(m.geltungenFuer(bearbeiten, "global")).toEqual(["aus", "alle"]);
    expect(m.geltungenFuer(wartung, "gruppe")).toEqual(["aus", "alle"]);
  });

  test("Bereiche ohne passendes Recht fallen weg", () => {
    const g = m.gruppiereNachBereich(
      katalog,
      (r: { art: string }) => r.art === "struktur",
    );
    expect(g.map((b: { id: string }) => b.id)).toEqual(["anlaesse"]);
  });

  test("die OK-Vorschläge werden auf den Katalog zugeschnitten", () => {
    const v = m.vorschlaegeFuer(katalog);
    expect(v.map((x: { name: string }) => x.name)).toEqual([
      "Leitung",
      "Kasse",
      "Kommunikation",
      "Helfende",
    ]);
    const kasse = v.find((x: { name: string }) => x.name === "Kasse");
    expect(kasse.rechte).toEqual([
      { recht: "anlass.anmeldungen_sehen", geltung: "eigene" },
    ]);
    // Was der Katalog nicht kennt, fällt weg
    const leitung = v.find((x: { name: string }) => x.name === "Leitung");
    expect(leitung.rechte.map((x: { recht: string }) => x.recht)).toEqual([
      "anlass.anmeldungen_sehen",
      "seiten.bearbeiten",
    ]);
  });
});

describe("Wer darf dieses Recht?", () => {
  const gruppe = { id: "g1", name: "OK Kirmes", typ: "anlass" };
  test("Abteilungsleitung, Plattformrolle und Gruppenrolle mit ihren Personen", () => {
    const global = {
      ...rolle("w", [["seiten.bearbeiten", "alle"]], ["u1"]),
      art: "global",
    };
    const kasse = rolle("k", [["seiten.bearbeiten", "eigene"]], ["u2"]);
    const zeilen = m.werDarf({
      eintrag: katalog.rechte[0],
      admin: [{ id: "a", name: "A" }],
      globale: [global],
      gruppen: [{ gruppe, rollen: [kasse] }],
    });
    expect(zeilen.map((z: { art: string }) => z.art)).toEqual([
      "abteilungsleitung",
      "entwickler",
      "plattformrolle",
      "gruppenrolle",
    ]);
    expect(zeilen[3].titel).toBe("«k» in «OK Kirmes»");
    expect(zeilen[3].geltung).toBe("eigene");
  });

  test("der Entwickler steht bei jedem vergebbaren Recht, auch bei Anmeldungen (#722)", () => {
    const zeilen = m.werDarf({
      eintrag: katalog.rechte[2],
      admin: [],
      globale: [],
      gruppen: [],
    });
    expect(zeilen.map((z: { art: string }) => z.art)).toContain("entwickler");
  });

  test("ein Recht, das nur aus der Beziehung folgt, gilt für alle und nennt keine Personen", () => {
    const zeilen = m.werDarf({
      eintrag: katalog.rechte[3],
      admin: [],
      globale: [],
      gruppen: [],
    });
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0].personen).toBeNull();
  });

  test("ein festes Recht der Stufenrolle steht als fest da", () => {
    const stufe = {
      ...rolle("s", [], ["u"]),
      fest: [{ recht: "seiten.bearbeiten", geltung: "eigene" }],
    };
    const zeilen = m.werDarf({
      eintrag: katalog.rechte[0],
      admin: [],
      globale: [],
      gruppen: [
        { gruppe: { id: "x", name: "Pilami", typ: "stufe" }, rollen: [stufe] },
      ],
    });
    expect(
      zeilen.find((z: { art: string }) => z.art === "gruppenrolle").fest,
    ).toBe(true);
  });
});

describe("Texte", () => {
  test("Fehler der API in Klartext", () => {
    expect(m.rechteFehlerText({ code: "ROLLENNAME_VERGEBEN" })).toMatch(
      /schon eine Rolle/,
    );
    expect(m.rechteFehlerText({ code: "ROLLE_VORGEGEBEN" })).toMatch(
      /eingebaut/,
    );
    expect(m.rechteFehlerText({ code: "VERSION_KONFLIKT" })).toMatch(
      /inzwischen geändert/,
    );
    expect(m.rechteFehlerText({ status: 403 })).toMatch(
      /Wer Rechte vergibt, hat sie selbst/,
    );
    expect(m.rechteFehlerText({ status: 500 }, "Egal")).toBe("Egal");
  });

  test("Verlauf nennt Rolle, Gruppe, Person und Rechte, nie Rohwerte", () => {
    const nach = {
      gruppe: (id: string) => (id === "g1" ? "OK Kirmes" : undefined),
      rolle: (id: string) => (id === "r1" ? "Kasse" : undefined),
      person: (id: string) => (id === "p1" ? "Anna" : undefined),
      recht: (id: string) => ({ "seiten.bearbeiten": "Seiten bearbeiten" })[id],
    };
    const geaendert = m.verlaufText(
      {
        aktion: "gruppen_rolle_geaendert",
        zielId: "r1",
        details: {
          tagId: "g1",
          hinzu: [{ recht: "seiten.bearbeiten", geltung: "eigene" }],
          weg: [],
        },
      },
      nach,
    );
    expect(geaendert.titel).toBe("Rolle «Kasse» in «OK Kirmes» geändert");
    expect(geaendert.detail).toBe("Dazu: Seiten bearbeiten (nur eigene)");
    const zugeordnet = m.verlaufText(
      {
        aktion: "gruppen_rolle_zugeordnet",
        zielId: "p1",
        details: { tagId: "g1", rolleId: null },
      },
      nach,
    );
    expect(zugeordnet.titel).toBe("Anna: Rolle in «OK Kirmes» entzogen");
    // Plattformrollen im älteren Format
    const alt = m.verlaufText(
      {
        aktion: "plattform_rolle_geaendert",
        zielId: "x",
        details: { rechteVorher: [], rechteNachher: ["seiten.bearbeiten"] },
      },
      nach,
    );
    expect(alt.detail).toBe("Dazu: Seiten bearbeiten");
  });
});

describe("Die Abteilungsleitung als einstellbare Rolle (#663)", () => {
  const al = (rechte: string[], aenderbar = false) =>
    m.abteilungsleitungRolle({ version: 3, rechte, fest: [], aenderbar });
  const eintrag = (id: string) => katalog.rechte.find((r) => r.id === id)!;

  test("die Rolle hat keine Personen, ist eingebaut und nur für den Entwickler änderbar", () => {
    const gesperrt = al(["seiten.bearbeiten"]);
    expect(gesperrt).toMatchObject({
      abteilungsleitung: true,
      system: true,
      personen: [],
      gesperrt: true,
      version: 3,
    });
    expect(gesperrt.rechte).toEqual([
      { recht: "seiten.bearbeiten", geltung: "alle" },
    ]);
    expect(al([], true).gesperrt).toBe(false);
  });

  test("andere globale Rollen sind für den Entwickler gesperrt, sonst nicht", () => {
    const r = {
      id: "x",
      name: "Rolle",
      vorgabe: false,
      version: 1,
      rechte: [],
      personen: [],
    };
    expect(m.globaleRolle(r).gesperrt).toBe(false);
    expect(m.globaleRolle(r, true).gesperrt).toBe(true);
  });

  test("«Wer darf das?»: Nimmt der Entwickler ein Recht weg, steht die Abteilungsleitung nicht mehr dabei", () => {
    const quellen = (rechte: string[]) => ({
      eintrag: eintrag("seiten.bearbeiten"),
      admin: [],
      globale: [al(rechte)],
      gruppen: [],
    });
    expect(
      m
        .werDarf(quellen(["seiten.bearbeiten"]))
        .map((z: { art: string }) => z.art),
    ).toContain("abteilungsleitung");
    const ohne = m.werDarf(quellen([])).map((z: { art: string }) => z.art);
    expect(ohne).not.toContain("abteilungsleitung");
    // Die Systemrolle erscheint nie zusätzlich als Plattformrolle
    expect(ohne).not.toContain("plattformrolle");
  });

  test("Verlauf: die Änderung der Rechte der Abteilungsleitung steht in Klartext", () => {
    const text = m.verlaufText(
      {
        aktion: "abteilungsleitung_rechte_geaendert",
        details: { hinzu: [], weg: ["seiten.bearbeiten"] },
      },
      {
        recht: (id: string) => id,
        gruppe: () => null,
        rolle: () => null,
        person: () => null,
      },
    );
    expect(text.titel).toBe("Rechte der Abteilungsleitung geändert");
    expect(text.detail).toBe("Weg: seiten.bearbeiten");
  });
});

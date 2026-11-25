import { describe, expect, test } from "vitest";
import {
  berechneKategorien,
  farbeFuer,
  gleicheKategorien,
  kategorieName,
  PALETTE,
} from "../../src/outlook/kategorien-regeln.js";
import { ordneKategorienZu } from "../../src/kalender/graph-kategorien.js";
import {
  entschluesseleToken,
  verschluesseleToken,
} from "../../src/outlook/geheimnis.js";
import { wartezeitMs } from "../../src/outlook/termin-tags.js";

describe("kategorieName", () => {
  test.each([
    ["Biber", "Biber"],
    ["  Pfadi Stufe  ", "Pfadi Stufe"],
    ["Wölfe - TN", "Wölfe - TN"],
    ["x".repeat(255), "x".repeat(255)],
  ])("%s ist zulässig", (eingabe, erwartet) => {
    expect(kategorieName(eingabe)).toBe(erwartet);
  });
  test.each(["", "   ", "A,B", "x".repeat(256), "Zeile\neins", "Tab\tz"])(
    "%j ist unzulässig (Komma trennt, 255 Zeichen, keine Steuerzeichen)",
    (eingabe) => {
      expect(kategorieName(eingabe)).toBeNull();
    },
  );
});

test("die Farbe kommt aus der festen Palette, auch für einen unbekannten Typ", () => {
  for (const typ of ["stufe", "funktion", "team", "lager", "anlass", "?"]) {
    expect(PALETTE).toContain(farbeFuer(typ));
  }
});

describe("berechneKategorien", () => {
  const tags = [
    { id: "t-biber", name: "Biber" },
    { id: "t-wolf", name: "Wölfe" },
    { id: "t-komma", name: "Mit,Komma" },
  ];
  const abweichungen = new Map([["wö", "t-wolf"]]);
  const rechne = (bestehend: string[], soll: string[]) =>
    berechneKategorien({
      bestehend,
      sollTagIds: new Set(soll),
      tags,
      abweichungen,
    });

  test("fügt den Namen des Tags hinzu und lässt fremde Kategorien stehen", () => {
    expect(rechne(["Fremd"], ["t-biber"]).kategorien).toEqual([
      "Fremd",
      "Biber",
    ]);
  });
  test("entfernt nur Kategorien, die einem Tag entsprechen, der nicht mehr gewählt ist", () => {
    expect(rechne(["Fremd", "biber", "Wö"], ["t-wolf"]).kategorien).toEqual([
      "Fremd",
      "Wö",
    ]);
  });
  test("eine vorhandene Kategorie, die den Tag schon abdeckt (Abweichung oder Gross-/Kleinschreibung), bleibt und wird nicht doppelt", () => {
    expect(rechne(["Wö", "BIBER"], ["t-wolf", "t-biber"]).kategorien).toEqual([
      "Wö",
      "BIBER",
    ]);
  });
  test("ohne Tags bleiben nur die fremden", () => {
    expect(rechne(["Biber", "Fremd"], []).kategorien).toEqual(["Fremd"]);
  });
  test("ein Tag, dessen Name Outlook nicht annähme, wird übersprungen und gezählt", () => {
    expect(rechne([], ["t-komma", "t-biber"])).toEqual({
      kategorien: ["Biber"],
      uebersprungen: 1,
    });
  });
  test("idempotent: das Ergebnis, nochmals gerechnet, ändert nichts", () => {
    const erst = rechne(["Fremd", "Biber"], ["t-wolf"]).kategorien;
    expect(rechne(erst, ["t-wolf"]).kategorien).toEqual(erst);
    expect(gleicheKategorien(erst, [...erst].reverse())).toBe(true);
  });
});

describe("ordneKategorienZu (Graph → Termine des Feeds)", () => {
  const basis = {
    titel: "T",
    ort: null,
    tagVon: null,
    tagBis: null,
    ende: null,
  };
  const einzel = {
    ...basis,
    googleEventId: "uid-einzel",
    googleSerie: null,
    ganztaegig: false,
    beginn: new Date("2027-09-04T12:00:00Z"),
    kategorien: [],
  };
  const instanz = {
    ...basis,
    googleEventId: "uid-serie_20270911T120000Z",
    googleSerie: "uid-serie",
    ganztaegig: false,
    beginn: new Date("2027-09-11T12:00:00Z"),
    kategorien: [],
  };
  const ganz = {
    ...basis,
    googleEventId: "uid-serie_20270918",
    googleSerie: "uid-serie2",
    ganztaegig: true,
    beginn: null,
    tagVon: "2027-09-18",
    tagBis: "2027-09-18",
    kategorien: [],
  };

  test("einzeln über die UID, Serie über UID und Beginn, ganztägig über das Datum; ohne Treffer null", () => {
    const r = ordneKategorienZu(
      [einzel, instanz, ganz, { ...einzel, googleEventId: "unbekannt" }],
      [
        {
          iCalUId: "uid-einzel",
          serie: false,
          ganztaegig: false,
          start: "2027-09-04T12:00:00.0000000",
          kategorien: [" Biber ", "biber", "Wölfe"],
        },
        {
          iCalUId: "uid-serie",
          serie: true,
          ganztaegig: false,
          start: "2027-09-11T12:00:00.0000000",
          kategorien: [],
        },
        {
          iCalUId: "uid-serie",
          serie: true,
          ganztaegig: false,
          start: "2027-09-04T12:00:00.0000000",
          kategorien: ["Andere Instanz"],
        },
        {
          iCalUId: "uid-serie2",
          serie: true,
          ganztaegig: true,
          start: "2027-09-18T00:00:00.0000000",
          kategorien: ["Lager"],
        },
      ],
    );
    expect(r.map((p) => p.kategorien)).toEqual([
      ["Biber", "Wölfe"],
      [],
      ["Lager"],
      null,
    ]);
  });
});

describe("Token verschlüsseln", () => {
  process.env.BETTER_AUTH_SECRET = "x".repeat(40);
  test("Rundgang, nie im Klartext, an die Abteilung gebunden", () => {
    const t = verschluesseleToken("geheim-refresh", "abt-1");
    expect(t).not.toContain("geheim");
    expect(t).not.toBe(verschluesseleToken("geheim-refresh", "abt-1"));
    expect(entschluesseleToken(t, "abt-1")).toBe("geheim-refresh");
    expect(entschluesseleToken(t, "abt-2")).toBeNull();
    expect(entschluesseleToken(`${t.slice(0, -4)}AAAA`, "abt-1")).toBeNull();
    expect(entschluesseleToken("kein token", "abt-1")).toBeNull();
  });
  test("ein anderes Geheimnis macht das Token unlesbar", () => {
    const t = verschluesseleToken("geheim-refresh", "abt-1");
    const alt = process.env.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_SECRET = "y".repeat(40);
    expect(entschluesseleToken(t, "abt-1")).toBeNull();
    process.env.BETTER_AUTH_SECRET = alt;
  });
});

test("Wartezeit: 1, 2, 4 Minuten, höchstens 6 Stunden, nie weniger als Retry-After", () => {
  expect([1, 2, 3, 4].map((n) => wartezeitMs(n) / 60_000)).toEqual([
    1, 2, 4, 8,
  ]);
  expect(wartezeitMs(20) / 60_000).toBe(360);
  expect(wartezeitMs(1, 600) / 60_000).toBe(10);
});

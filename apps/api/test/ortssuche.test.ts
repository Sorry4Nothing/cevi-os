import { afterEach, describe, expect, test, vi } from "vitest";
import { leseTreffer, sucheBeiGeoAdmin } from "../src/ortssuche/geoadmin.js";
import {
  erstelleOrtssuche,
  OrtssucheBegrenzt,
  type OrtssucheHolen,
  type Ortsvorschlag,
} from "../src/ortssuche/index.js";

// Dienst für die Adresssuche (#695): ohne Netz und ohne Datenbank, fetch ist eine Attrappe. Alle Adressen sind erfunden
const treffer = (origin: string, label: string, lat = 47.2, lon = 8.7) => ({
  attrs: { origin, label, lat, lon, detail: "x", weitere: "Feld" },
  id: 1,
  weight: 1,
});
const antwort = (results: unknown[], init?: ResponseInit) =>
  new Response(JSON.stringify({ results }), init);

afterEach(() => vi.unstubAllGlobals());

describe("leseTreffer", () => {
  test("Adresse mit Hausnummer", () => {
    expect(
      leseTreffer(
        treffer("address", "Beispielweg 4 <b>8000 Beispielstadt</b>"),
      ),
    ).toEqual({
      bezeichnung: "Beispielweg 4, 8000 Beispielstadt",
      strasse: "Beispielweg 4",
      plz: "8000",
      ort: "Beispielstadt",
      breite: 47.2,
      laenge: 8.7,
    });
  });

  test("Strasse ohne Hausnummer: das «#» fällt weg", () => {
    expect(
      leseTreffer(treffer("address", "Beispielweg # <b>8000 Beispielstadt</b>"))
        ?.bezeichnung,
    ).toBe("Beispielweg, 8000 Beispielstadt");
  });

  test("Postleitzahl und Ortsname", () => {
    expect(
      leseTreffer(treffer("zipcode", "<b>8000 - Beispielstadt</b>")),
    ).toMatchObject({
      bezeichnung: "8000 Beispielstadt",
      strasse: null,
      plz: "8000",
    });
    expect(
      leseTreffer(
        treffer(
          "gazetteer",
          "<i>Bahnhof</i> <b>Beispielhalt</b> (ZH) - Beispielstadt,Nachbarort",
        ),
      ),
    ).toMatchObject({
      bezeichnung: "Beispielhalt (Bahnhof), Beispielstadt",
      ort: "Beispielstadt",
      strasse: null,
    });
  });

  test("Koordinaten werden auf sechs Stellen gerundet", () => {
    const v = leseTreffer(
      treffer(
        "address",
        "Beispielweg 4 <b>8000 Beispielstadt</b>",
        47.123456789,
        8.987654321,
      ),
    );
    expect([v?.breite, v?.laenge]).toEqual([47.123457, 8.987654]);
  });

  test("Unlesbares fällt weg: fremde Herkunft, Skript im Text, Steuerzeichen, Koordinaten ausserhalb, falsche Form", () => {
    expect(
      leseTreffer(treffer("parcel", "Beispielweg 4 <b>8000 Beispielstadt</b>")),
    ).toBeNull();
    expect(
      leseTreffer(treffer("address", "Weg <script> <b>8000 Ort</b>")),
    ).toBeNull();
    expect(
      leseTreffer(treffer("address", "Weg\u0007 4 <b>8000 Ort</b>")),
    ).toBeNull();
    expect(
      leseTreffer(treffer("address", "Weg 4 <b>8000 Ort</b>", 95, 8)),
    ).toBeNull();
    expect(leseTreffer(treffer("address", "ohne Auszeichnung"))).toBeNull();
    expect(leseTreffer({ attrs: { label: 5 } })).toBeNull();
    expect(leseTreffer(null)).toBeNull();
  });

  test("Zeichenverweise werden zu Text, nie zu Markup", () => {
    expect(
      leseTreffer(treffer("address", "Weg &amp; Steg 4 <b>8000 Ort</b>"))
        ?.strasse,
    ).toBe("Weg & Steg 4");
    expect(
      leseTreffer(treffer("address", "Weg &lt;b&gt; 4 <b>8000 Ort</b>")),
    ).toBeNull();
  });
});

describe("sucheBeiGeoAdmin", () => {
  test("fragt nur mit dem Suchtext, ohne Weiterleitung und mit Zeitlimit; höchstens acht Vorschläge ohne Doppelte", async () => {
    const holen = vi.fn(async () =>
      antwort([
        ...Array.from({ length: 12 }, (_, i) =>
          treffer("address", `Beispielweg ${i + 1} <b>8000 Beispielstadt</b>`),
        ),
        treffer("address", "Beispielweg 1 <b>8000 Beispielstadt</b>"),
      ]),
    );
    vi.stubGlobal("fetch", holen);
    const v = await sucheBeiGeoAdmin("Beispielweg Beispielstadt");
    expect(v).toHaveLength(8);
    expect(new Set(v.map((x) => x.bezeichnung)).size).toBe(8);
    const [url, optionen] = holen.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.origin).toBe("https://api3.geo.admin.ch");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      searchText: "Beispielweg Beispielstadt",
      type: "locations",
      origins: "address,zipcode,gazetteer",
      sr: "4326",
      limit: "15",
    });
    expect(optionen.redirect).toBe("error");
    expect(optionen.signal).toBeInstanceOf(AbortSignal);
    // Keine Cookies, keine Kennung, kein Schlüssel, kein Body
    expect(Object.keys(optionen.headers as object)).toEqual(["accept"]);
    expect(optionen.method ?? "GET").toBe("GET");
    expect(optionen.body).toBeUndefined();
    expect(optionen.credentials).toBeUndefined();
  });

  test("mehr als zehn Wörter werden gekürzt", async () => {
    const holen = vi.fn(async () => antwort([]));
    vi.stubGlobal("fetch", holen);
    await sucheBeiGeoAdmin("a1 b2 c3 d4 e5 f6 g7 h8 i9 j10 k11 l12");
    const url = (holen.mock.calls[0] as unknown as [URL])[0];
    expect(url.searchParams.get("searchText")).toBe(
      "a1 b2 c3 d4 e5 f6 g7 h8 i9 j10",
    );
  });

  test("keine Treffer: leere Liste", async () => {
    vi.stubGlobal("fetch", async () => antwort([]));
    expect(await sucheBeiGeoAdmin("Nirgendwo")).toEqual([]);
  });

  test("ein einzelner unlesbarer Treffer stört die anderen nicht", async () => {
    vi.stubGlobal("fetch", async () =>
      antwort([
        null,
        treffer("address", "Beispielweg 4 <b>8000 Beispielstadt</b>"),
      ]),
    );
    expect(await sucheBeiGeoAdmin("Beispielweg")).toHaveLength(1);
  });

  test.each([
    ["Fehlerstatus", async () => antwort([], { status: 503 })],
    [
      "Weiterleitung (fetch wirft)",
      async () => {
        throw new TypeError("redirect");
      },
    ],
    [
      "Zeitlimit",
      async () => {
        throw new DOMException("t", "TimeoutError");
      },
    ],
    ["kein JSON", async () => new Response("<html>")],
    [
      "falsches Schema",
      async () => new Response(JSON.stringify({ results: "x" })),
    ],
    [
      "zu viele Treffer",
      async () => antwort(Array.from({ length: 51 }, () => ({}))),
    ],
    ["zu grosse Antwort", async () => new Response("x".repeat(300 * 1024))],
  ])("%s: wirft", async (_name, fetchAttrappe) => {
    vi.stubGlobal("fetch", fetchAttrappe);
    await expect(sucheBeiGeoAdmin("Beispielweg")).rejects.toThrow();
  });
});

describe("erstelleOrtssuche", () => {
  const v: Ortsvorschlag = {
    bezeichnung: "Beispielweg 4, 8000 Beispielstadt",
    strasse: "Beispielweg 4",
    plz: "8000",
    ort: "Beispielstadt",
    breite: 47.2,
    laenge: 8.7,
  };

  test("gleiche Suche (auch anders geschrieben) geht nur einmal hinaus, gleichzeitige auch", async () => {
    const holen = vi.fn<OrtssucheHolen>(async () => [v]);
    const suche = erstelleOrtssuche(holen);
    const [a, b] = await Promise.all([
      suche("Beispielweg 4"),
      suche("  beispielweg   4 "),
    ]);
    expect(a).toEqual([v]);
    expect(b).toEqual([v]);
    await suche("BEISPIELWEG 4");
    expect(holen).toHaveBeenCalledTimes(1);
    // Der Dienst bekommt den bereinigten Text
    expect(holen).toHaveBeenCalledWith("beispielweg 4");
  });

  test("nach Ablauf wird neu gefragt", async () => {
    let jetzt = 0;
    const holen = vi.fn<OrtssucheHolen>(async () => [v]);
    const suche = erstelleOrtssuche(holen, {
      haltbar: 1000,
      jetzt: () => jetzt,
    });
    await suche("Beispielweg");
    jetzt = 999;
    await suche("Beispielweg");
    jetzt = 1001;
    await suche("Beispielweg");
    expect(holen).toHaveBeenCalledTimes(2);
  });

  test("Fehler werden nicht gemerkt", async () => {
    const holen = vi
      .fn<OrtssucheHolen>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue([v]);
    const suche = erstelleOrtssuche(holen);
    await expect(suche("Beispielweg")).rejects.toThrow("down");
    expect(await suche("Beispielweg")).toEqual([v]);
  });

  test("höchstens so viele Abrufe je Minute, danach OrtssucheBegrenzt; Treffer im Speicher zählen nicht", async () => {
    let jetzt = 0;
    const holen = vi.fn<OrtssucheHolen>(async () => [v]);
    const suche = erstelleOrtssuche(holen, {
      proMinute: 3,
      jetzt: () => jetzt,
    });
    for (const t of ["eins", "zwei", "drei"]) await suche(t);
    await suche("eins");
    await expect(suche("vier")).rejects.toBeInstanceOf(OrtssucheBegrenzt);
    jetzt = 61_000;
    await expect(suche("vier")).resolves.toEqual([v]);
  });

  test("der Speicher bleibt klein", async () => {
    const holen = vi.fn<OrtssucheHolen>(async () => [v]);
    const suche = erstelleOrtssuche(holen, {
      maxEintraege: 2,
      proMinute: 100,
    });
    for (const t of ["eins", "zwei", "drei"]) await suche(t);
    await suche("eins");
    expect(holen).toHaveBeenCalledTimes(4);
  });
});

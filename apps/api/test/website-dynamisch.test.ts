import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { erzeugeWebsite } from "../src/website/abgleich.js";
import { dateisystemAusgabe, type Ausgabe } from "../src/website/ausgabe.js";
import {
  dynamischeBausteine,
  MAX_ANLASS_ANZAHL,
  MAX_DOKUMENTE,
  MAX_TREFFPUNKTE,
  sammleDynamischeVerweise,
} from "../src/website/bausteine-dynamisch.js";
import { pruefeDokument } from "../src/website/dokument.js";
import {
  ladeDynamischeBausteine,
  MIN_ANZEIGE_LEITENDE,
  setzeSeitenpfade,
  tageBis,
  type AnlassInfo,
  type DynamischErgebnis,
} from "../src/website/dynamisch-daten.js";
import { pruefeVerweise } from "../src/website/verweise.js";
import {
  keineDaten,
  rendereSeite,
  type Daten,
} from "../src/website/rendern.js";
import { API_URL } from "./hilfen/datenbank.js";

// Bausteine mit Daten aus Cevi OS (#740): Schema mit Grenzen, Rendern mit Maskierung, Datenbeschaffung mit eigener Abteilung (nie Daten einer anderen)

const id = () => randomUUID();
const b = (typ: string, daten: unknown) => ({
  id: id(),
  typ,
  daten,
  sichtbarkeit: "erbt",
});
const dok = (...bausteine: unknown[]) => {
  const p = pruefeDokument({ v: 1, titel: "T", bausteine });
  if (!p.ok) throw new Error(JSON.stringify(p.fehler));
  return p.dokument;
};
const gueltig = (typ: string, daten: unknown) =>
  pruefeDokument({ v: 1, titel: "T", bausteine: [b(typ, daten)] }).ok;
const ID = "11111111-1111-4111-8111-111111111111";

describe("Schema der Bausteine aus Cevi OS", () => {
  test("gültige Bausteine, auch ohne optionale Felder", () => {
    expect(gueltig("naechsterAnlass", {})).toBe(true);
    expect(gueltig("naechsterAnlass", { anlassId: ID, art: "lager" })).toBe(
      true,
    );
    expect(gueltig("anlaesse", { anzahl: 3 })).toBe(true);
    expect(gueltig("lagerkarte", { anlassId: ID, kosten: "CHF 280.–" })).toBe(
      true,
    );
    expect(gueltig("countdown", {})).toBe(true);
    expect(gueltig("countdown", { anlassId: ID, bis: "frist" })).toBe(true);
    expect(gueltig("treffpunkte", { ortIds: [ID] })).toBe(true);
    expect(gueltig("kennzahlen", { zahlen: ["stufen", "leitende"] })).toBe(
      true,
    );
    expect(
      gueltig("dokumente", {
        eintraege: [
          {
            titel: "Anmeldung",
            link: "https://example.sharepoint.com/f/x",
            typ: "PDF",
            groesse: 1200,
          },
        ],
      }),
    ).toBe(true);
  });

  test("countdown ohne Ziel gilt als «beginn»", () => {
    const p = pruefeDokument({
      v: 1,
      titel: "T",
      bausteine: [b("countdown", {})],
    });
    expect(p.ok && p.dokument.bausteine[0]!.daten).toEqual({ bis: "beginn" });
  });

  test("Grenzen: Anzahl, Listen, Längen und unbekannte Werte", () => {
    expect(gueltig("anlaesse", { anzahl: 0 })).toBe(false);
    expect(gueltig("anlaesse", { anzahl: MAX_ANLASS_ANZAHL + 1 })).toBe(false);
    expect(gueltig("anlaesse", { anzahl: 2.5 })).toBe(false);
    expect(gueltig("anlaesse", { anzahl: 3, art: "fest" })).toBe(false);
    expect(gueltig("lagerkarte", {})).toBe(false);
    expect(gueltig("lagerkarte", { anlassId: "kein-uuid" })).toBe(false);
    expect(
      gueltig("lagerkarte", { anlassId: ID, kosten: "x".repeat(61) }),
    ).toBe(false);
    expect(
      gueltig("lagerkarte", { anlassId: ID, hinweis: "x".repeat(201) }),
    ).toBe(false);
    expect(gueltig("countdown", { bis: "morgen" })).toBe(false);
    expect(gueltig("treffpunkte", { ortIds: [] })).toBe(false);
    expect(gueltig("treffpunkte", { ortIds: [ID, ID] })).toBe(false);
    const viele = Array.from({ length: MAX_TREFFPUNKTE + 1 }, () => id());
    expect(gueltig("treffpunkte", { ortIds: viele })).toBe(false);
    expect(
      gueltig("treffpunkte", { ortIds: viele.slice(0, MAX_TREFFPUNKTE) }),
    ).toBe(true);
    expect(gueltig("kennzahlen", { zahlen: [] })).toBe(false);
    expect(gueltig("kennzahlen", { zahlen: ["kinder"] })).toBe(false);
    expect(gueltig("kennzahlen", { zahlen: ["stufen", "stufen"] })).toBe(false);
  });

  test("Dokumente: nur Dateilinks, höchstens 30, keine Steuerzeichen, kein Schluessel mehr als erlaubt", () => {
    const e = (link: string, extra: object = {}) => ({
      titel: "Datei",
      link,
      ...extra,
    });
    for (const link of [
      "javascript:alert(1)",
      "data:text/html,x",
      "http://example.sharepoint.com/x",
      "/api/v1/medien/x",
      "https://user:pw@example.org/x",
    ]) {
      expect(gueltig("dokumente", { eintraege: [e(link)] }), link).toBe(false);
    }
    expect(gueltig("dokumente", { eintraege: [] })).toBe(false);
    const dreissig = Array.from({ length: MAX_DOKUMENTE }, () =>
      e("https://example.sharepoint.com/f/x"),
    );
    expect(gueltig("dokumente", { eintraege: dreissig })).toBe(true);
    expect(
      gueltig("dokumente", { eintraege: [...dreissig, dreissig[0]] }),
    ).toBe(false);
    expect(
      gueltig("dokumente", {
        eintraege: [
          e("https://example.sharepoint.com/f/x", { typ: "x".repeat(21) }),
        ],
      }),
    ).toBe(false);
    expect(
      gueltig("dokumente", {
        eintraege: [e("https://example.sharepoint.com/f/x", { groesse: -1 })],
      }),
    ).toBe(false);
    expect(
      gueltig("dokumente", {
        eintraege: [
          { titel: "a\u0000b", link: "https://example.sharepoint.com/f/x" },
        ],
      }),
    ).toBe(false);
    expect(
      gueltig("dokumente", {
        eintraege: [e("https://example.sharepoint.com/f/x", { html: "<b>" })],
      }),
    ).toBe(false);
  });

  test("strenge Objekte: ein unbekanntes Feld ist ungültig; der Katalog hat sieben Typen", () => {
    expect(gueltig("naechsterAnlass", { daten: 1 })).toBe(false);
    expect(gueltig("kennzahlen", { zahlen: ["stufen"], kinder: 3 })).toBe(
      false,
    );
    expect(dynamischeBausteine).toHaveLength(7);
  });

  test("sammleDynamischeVerweise: Anlässe und Orte, klein geschrieben, ohne Doppelte", () => {
    const o = id();
    const v = sammleDynamischeVerweise([
      b("naechsterAnlass", { anlassId: ID.toUpperCase() }),
      b("lagerkarte", { anlassId: ID }),
      b("countdown", { bis: "beginn" }),
      b("treffpunkte", { ortIds: [o] }),
      b("text", { inhalt: [] }),
    ] as { typ: string }[]);
    expect(v).toEqual({ anlaesse: [ID], orte: [o] });
  });
});

// ===== Rendern: ohne Datenbank, mit fertigen Daten =====
const info = (extra: Partial<AnlassInfo> = {}): AnlassInfo => ({
  id: ID,
  titel: "Sommerlager",
  art: "lager",
  von: "2099-07-12",
  bis: "2099-07-19",
  zeitVon: null,
  zeitBis: null,
  ort: "Pfadiheim",
  anmeldungOffen: true,
  fristTag: "2099-05-15",
  fristZeit: "23:59",
  seiteId: null,
  ...extra,
});
const seite = (
  d: ReturnType<typeof dok>,
  dyn: [string, DynamischErgebnis][] = [],
) => {
  const daten: Daten = { ...keineDaten(), dynamisch: new Map(dyn) };
  return rendereSeite(
    { id: id(), pfad: "/lager", dokument: d },
    {
      abteilung: "Cevi Test",
      basisUrl: "https://www.example.org",
      navigation: [],
      daten,
    },
  );
};

describe("Rendern der Bausteine aus Cevi OS", () => {
  test("Anlasskarte: Titel, Datum, Ort, Anmeldeschluss, Kosten; Anmelden führt auf den Anlass, die Hauptaktion ist rot", () => {
    const bs = b("lagerkarte", {
      anlassId: ID,
      kosten: "CHF 280.–",
      hinweis: "Mit Bus",
    });
    const html = seite(dok(bs), [
      [bs.id, { typ: "anlaesse", anlaesse: [info()] }],
    ]);
    expect(html).toContain('<h2 class="titel">Sommerlager</h2>');
    expect(html).toContain(
      '<time datetime="2099-07-12">12. Juli 2099 bis 19. Juli 2099</time>',
    );
    expect(html).toContain("<dt>Ort</dt><dd>Pfadiheim</dd>");
    expect(html).toContain(
      "<dt>Anmeldeschluss</dt><dd>15. Mai 2099, 23:59 Uhr</dd>",
    );
    expect(html).toContain("<dt>Kosten</dt><dd>CHF 280.–</dd>");
    expect(html).toContain("Mit Bus");
    expect(html).toMatch(
      /<a class="btn p gross" href="\/anlass\?id=1111[^"]*">Anmelden<span class="nur-sr"> zu Sommerlager<\/span><\/a>/,
    );
    expect(html).toContain(
      '<link rel="stylesheet" href="/website/dynamisch.css">',
    );
    expect(html).toContain("Anmeldung offen");
  });

  test("ohne offene Anmeldung: «Mehr erfahren» auf die öffentliche Seite des Anlasses, sonst auf die Ansicht", () => {
    const bs = b("naechsterAnlass", {});
    const zu = info({ anmeldungOffen: false, seitePfad: "/lager/sola" });
    const html = seite(dok(bs), [[bs.id, { typ: "anlaesse", anlaesse: [zu] }]]);
    expect(html).toContain('href="/lager/sola">Mehr erfahren');
    expect(html).not.toContain("Anmeldung offen");
    expect(html).not.toContain("Anmeldeschluss");
    const ohne = seite(dok(bs), [
      [bs.id, { typ: "anlaesse", anlaesse: [info({ anmeldungOffen: false })] }],
    ]);
    expect(ohne).toContain(`href="/anlass?id=${ID}">Mehr erfahren`);
  });

  test("Texte aus der Datenbank und der Seite werden maskiert, nie als HTML ausgegeben", () => {
    const bs = b("lagerkarte", {
      anlassId: ID,
      kosten: '<img src=x onerror="a()">',
      hinweis: "<script>a()</script>",
    });
    const bose = info({
      titel: '<script>alert("x")</script>',
      ort: "<b>Ort</b>",
    });
    const html = seite(dok(bs), [
      [bs.id, { typ: "anlaesse", anlaesse: [bose] }],
    ]);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>Ort</b>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  test("ohne Daten entfällt der Baustein, ohne Stil", () => {
    const bs = b("anlaesse", { anzahl: 3 });
    const html = seite(dok(bs));
    expect(html).not.toContain("anlassliste");
    expect(html).not.toContain("dynamisch.css");
  });

  test("Anlässe: Liste, ohne Anlass ein Zustand; alle Knöpfe ausser dem ersten Hauptknopf sind Nebenaktionen", () => {
    const bs = b("anlaesse", { anzahl: 3 });
    const zwei = [
      info({ id: id(), titel: "A" }),
      info({ id: id(), titel: "B", anmeldungOffen: false }),
    ];
    const html = seite(dok(bs), [[bs.id, { typ: "anlaesse", anlaesse: zwei }]]);
    expect(html.match(/<article class="anlasskarte/g)).toHaveLength(2);
    expect(html).not.toContain("btn p");
    const leer = seite(dok(bs), [[bs.id, { typ: "anlaesse", anlaesse: [] }]]);
    expect(leer).toContain("Im Moment sind keine Anlässe eingetragen.");
  });

  test("Countdown: Zahl und Datum, «Heute», Einzahl, Anmeldeschluss", () => {
    const hole = (daten: object, tage: number, zielTag = "2099-07-12") => {
      const bs = b("countdown", daten);
      return seite(dok(bs), [
        [bs.id, { typ: "countdown", anlass: info(), tage, zielTag }],
      ]);
    };
    expect(hole({}, 12)).toContain(
      'Noch <strong class="countdown-zahl">12</strong> Tage bis Sommerlager',
    );
    expect(hole({}, 1)).toContain("</strong> Tag bis Sommerlager");
    expect(hole({}, 0)).toContain(
      '<strong class="countdown-zahl">Heute</strong>: Sommerlager',
    );
    expect(hole({ bis: "frist" }, 3, "2099-05-15")).toContain(
      "Tage bis zum Anmeldeschluss für Sommerlager",
    );
    expect(hole({ bis: "frist" }, 0, "2099-05-15")).toContain(
      "ist Anmeldeschluss für Sommerlager",
    );
    expect(hole({}, 12)).toContain(
      '<time datetime="2099-07-12">Sonntag, 12. Juli 2099</time>',
    );
  });

  test("Treffpunkte: der Link zur Karte nur als Link mit rel, nie eine Einbettung", () => {
    const bs = b("treffpunkte", { ortIds: [ID] });
    const html = seite(dok(bs), [
      [
        bs.id,
        {
          typ: "orte",
          orte: [
            {
              name: "Bahnhof <Stäfa>",
              beschreibung: "Beim Kiosk",
              karte: "https://www.google.com/maps/search/?api=1&query=Bahnhof",
            },
            { name: "Ohne Karte", beschreibung: null, karte: null },
          ],
        },
      ],
    ]);
    expect(html).toContain("Bahnhof &lt;Stäfa&gt;");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Auf Google Maps ansehen");
    expect(html).not.toMatch(/<iframe|<embed|<object/);
    expect(html.match(/Auf Google Maps ansehen/g)).toHaveLength(1);
    // Eine Adresse mit fremdem Schema wird nie ein Link
    const falsch = seite(dok(bs), [
      [
        bs.id,
        {
          typ: "orte",
          orte: [
            { name: "X", beschreibung: null, karte: "javascript:alert(1)" },
          ],
        },
      ],
    ]);
    expect(falsch).not.toContain("javascript:");
  });

  test("Dokumente: Links mit rel und Hinweis «externe Seite», Typ und Grösse; Titel maskiert", () => {
    const bs = b("dokumente", {
      eintraege: [
        {
          titel: "Liste <1>",
          link: "https://example.sharepoint.com/f/x",
          typ: "PDF",
          groesse: 2048,
          hinweis: "Bitte ausfüllen",
        },
      ],
    });
    const html = seite(dok(bs));
    expect(html).toContain('<ul class="dokumentliste">');
    expect(html).toContain(
      'href="https://example.sharepoint.com/f/x" rel="noopener noreferrer">Liste &lt;1&gt;',
    );
    expect(html).toContain("(externe Seite)");
    expect(html).toContain("(PDF, 2 KB)");
    expect(html).toContain("Bitte ausfüllen");
  });

  test("Cevi in Zahlen: Einzahl und Mehrzahl, Zahlen aus website.css", () => {
    const bs = b("kennzahlen", { zahlen: ["stufen", "leitende", "anlaesse"] });
    const html = seite(dok(bs), [
      [
        bs.id,
        {
          typ: "kennzahlen",
          zahlen: [
            { art: "stufen", zahl: 1 },
            { art: "leitende", zahl: 12 },
            { art: "anlaesse", zahl: 1 },
          ],
        },
      ],
    ]);
    expect(html).toContain('<strong class="zahl">1</strong><span>Stufe</span>');
    expect(html).toContain(
      '<strong class="zahl">12</strong><span>Leitende</span>',
    );
    expect(html).toContain("<span>kommender Anlass</span>");
  });

  test("Seitenpfade: ein Anlass führt auf seine öffentliche Seite", () => {
    const a = info({ seiteId: "s1" });
    setzeSeitenpfade(
      new Map([["x", { typ: "anlaesse", anlaesse: [a] }]]),
      (s) => (s === "s1" ? "/lager/sola" : undefined),
    );
    expect(a.seitePfad).toBe("/lager/sola");
  });

  test("tageBis zählt ganze Tage über die Monatsgrenze", () => {
    expect(tageBis("2099-01-30", "2099-02-02")).toBe(3);
    expect(tageBis("2099-03-01", "2099-03-01")).toBe(0);
    expect(tageBis("2099-03-02", "2099-03-01")).toBe(-1);
  });
});

// ===== Datenbank: eigene Abteilung je Test, nie Daten einer anderen =====
const sql = postgres(API_URL);
const db = erstelleDb(sql);
afterAll(() => sql.end());

describe("Daten aus der Datenbank", () => {
  let abteilungId: string;
  let fremdId: string;
  let wurzel: string;
  let ausgabe: Ausgabe;

  beforeEach(async () => {
    const [a, f] = await db
      .insert(schema.abteilung)
      .values([{ name: "Cevi Dynamisch" }, { name: "Cevi Fremd" }])
      .returning();
    abteilungId = a!.id;
    fremdId = f!.id;
    wurzel = await mkdtemp(join(tmpdir(), "cevi-dynamisch-"));
    ausgabe = dateisystemAusgabe(wurzel);
  });
  afterEach(() => rm(wurzel, { recursive: true, force: true }));

  const tage = (n: number) => new Date(Date.now() + n * 86_400_000);
  async function anlass(
    titel: string,
    n: number,
    opt: {
      abt?: string;
      sicht?: "oeffentlich" | "angemeldet";
      status?: "aktiv" | "abgesagt";
      art?: "anlass" | "lager";
      offen?: boolean;
      frist?: Date;
    } = {},
  ) {
    const abt = opt.abt ?? abteilungId;
    const beginn = tage(n);
    const [p] = await db
      .insert(schema.programm)
      .values({
        abteilungId: abt,
        googleEventId: id(),
        titel,
        ganztaegig: false,
        beginn,
        ende: new Date(beginn.getTime() + 3 * 3_600_000),
        status: opt.status ?? "aktiv",
        ort: "Treffpunkt",
      })
      .returning();
    const [a] = await db
      .insert(schema.anlass)
      .values({
        abteilungId: abt,
        programmId: p!.id,
        sichtbarkeit: opt.sicht ?? "oeffentlich",
        art: opt.art ?? "anlass",
        anmeldungOffen: opt.offen ?? false,
        frist: opt.frist ?? null,
      })
      .returning();
    return a!.id;
  }
  const lade = async (...bausteine: ReturnType<typeof b>[]) =>
    (
      await ladeDynamischeBausteine(
        db,
        abteilungId,
        [],
        new Map([["s", dok(...bausteine)]]),
      )
    ).dynamisch!;

  test("nächster Anlass und Anlässe: nur öffentliche, aktive, kommende Anlässe der eigenen Abteilung, der nächste zuerst", async () => {
    await anlass("Später", 20);
    const naechster = await anlass("Nächster", 5, {
      art: "lager",
      offen: true,
    });
    await anlass("Nur angemeldet", 1, { sicht: "angemeldet" });
    await anlass("Abgesagt", 1, { status: "abgesagt" });
    await anlass("Vergangen", -10);
    await anlass("Fremd", 1, { abt: fremdId });
    const eins = b("naechsterAnlass", {});
    const alle = b("anlaesse", { anzahl: 5 });
    const nurAnlass = b("anlaesse", { anzahl: 5, art: "anlass" });
    const nurLager = b("naechsterAnlass", { art: "lager" });
    const d = await lade(eins, alle, nurAnlass, nurLager);
    const titel = (k: string) => {
      const e = d.get(k);
      return e?.typ === "anlaesse" ? e.anlaesse.map((a) => a.titel) : null;
    };
    expect(titel(eins.id)).toEqual(["Nächster"]);
    expect(titel(alle.id)).toEqual(["Nächster", "Später"]);
    expect(titel(nurAnlass.id)).toEqual(["Später"]);
    expect(titel(nurLager.id)).toEqual(["Nächster"]);
    const e = d.get(eins.id);
    expect(e?.typ === "anlaesse" && e.anlaesse[0]).toMatchObject({
      id: naechster,
      art: "lager",
      ort: "Treffpunkt",
      anmeldungOffen: true,
    });
  });

  test("gewählter Anlass: nur der eigene und öffentliche; sonst entfällt der Baustein", async () => {
    const eigen = await anlass("Eigen", 30, { offen: true, frist: tage(10) });
    const angemeldet = await anlass("Nicht öffentlich", 30, {
      sicht: "angemeldet",
    });
    const fremd = await anlass("Fremd", 30, { abt: fremdId });
    const abgelaufen = await anlass("Frist vorbei", 30, {
      offen: true,
      frist: tage(-1),
    });
    const bs = [eigen, angemeldet, fremd, abgelaufen].map((anlassId) =>
      b("lagerkarte", { anlassId }),
    );
    const d = await lade(...bs);
    expect(d.has(bs[0]!.id)).toBe(true);
    expect(d.has(bs[1]!.id)).toBe(false);
    expect(d.has(bs[2]!.id)).toBe(false);
    const e = d.get(bs[0]!.id);
    expect(e?.typ === "anlaesse" && e.anlaesse[0]!.anmeldungOffen).toBe(true);
    // Eine abgelaufene Frist schliesst die Anmeldung, auch wenn «offen» noch gesetzt ist
    const a = d.get(bs[3]!.id);
    expect(a?.typ === "anlaesse" && a.anlaesse[0]!.anmeldungOffen).toBe(false);
  });

  test("Countdown: Tage bis zum Beginn oder zur Frist; Vergangenes entfällt", async () => {
    const lager = await anlass("Lager", 12, { offen: true, frist: tage(4) });
    const vorbei = await anlass("Vorbei", -3);
    const beginn = b("countdown", { anlassId: lager, bis: "beginn" });
    const frist = b("countdown", { anlassId: lager, bis: "frist" });
    const alt = b("countdown", { anlassId: vorbei, bis: "beginn" });
    const naechster = b("countdown", {});
    const d = await lade(beginn, frist, alt, naechster);
    const tageVon = (k: string) => {
      const e = d.get(k);
      return e?.typ === "countdown" ? e.tage : null;
    };
    expect([11, 12, 13]).toContain(tageVon(beginn.id));
    expect([3, 4, 5]).toContain(tageVon(frist.id));
    expect(d.has(alt.id)).toBe(false);
    expect([11, 12, 13]).toContain(tageVon(naechster.id));
  });

  test("Treffpunkte: nur aktive Orte der eigenen Abteilung, in der Reihenfolge des Bausteins, Karte nur als Link", async () => {
    const mk = async (
      name: string,
      abt: string,
      extra: Partial<typeof schema.ort.$inferInsert> = {},
    ) =>
      (
        await db
          .insert(schema.ort)
          .values({ abteilungId: abt, name, ...extra })
          .returning()
      )[0]!.id;
    const a = await mk("Pfadiheim", abteilungId, {
      beschreibung: "Waldstrasse 1",
      karteAdresse: "Waldstrasse 1, Stäfa",
    });
    const inaktiv = await mk("Alt", abteilungId, { aktiv: false });
    const fremd = await mk("Fremd", fremdId);
    const z = await mk("Zweiter", abteilungId);
    const bs = b("treffpunkte", { ortIds: [z, a, inaktiv, fremd] });
    const d = await lade(bs);
    const e = d.get(bs.id);
    expect(e?.typ === "orte" && e.orte.map((o) => o.name)).toEqual([
      "Zweiter",
      "Pfadiheim",
    ]);
    const heim = e?.typ === "orte" ? e.orte[1]! : null;
    expect(heim?.beschreibung).toBe("Waldstrasse 1");
    expect(heim?.karte).toMatch(/^https:\/\/www\.google\.com\/maps\//);
    const nur = b("treffpunkte", { ortIds: [inaktiv, fremd] });
    expect((await lade(nur)).has(nur.id)).toBe(false);
  });

  test("Zahlen: Stufen und Anlässe der eigenen Abteilung; Leitende erst ab der Mindestzahl; nichts mit Namen", async () => {
    for (const name of ["Bienli", "Wölfe"]) {
      await db
        .insert(schema.tag)
        .values({ abteilungId, typ: "stufe", name, kuerzel: name.slice(0, 2) });
    }
    await db.insert(schema.tag).values({
      abteilungId: fremdId,
      typ: "stufe",
      name: "Fremd",
      kuerzel: "Fr",
    });
    await db
      .insert(schema.tag)
      .values({ abteilungId, typ: "team", name: "Team", kuerzel: "Te" });
    await anlass("A", 3);
    await anlass("B", 4, { sicht: "angemeldet" });
    await anlass("C", 3, { abt: fremdId });
    const bs = b("kennzahlen", { zahlen: ["stufen", "leitende", "anlaesse"] });
    const d1 = await lade(bs);
    const e1 = d1.get(bs.id);
    expect(e1?.typ === "kennzahlen" && e1.zahlen).toEqual([
      { art: "stufen", zahl: 2 },
      { art: "anlaesse", zahl: 1 },
    ]);
    // Leitende: erst mit MIN_ANZEIGE_LEITENDE Personen mit einer Rolle mit Aussenwirkung in einer Stufe
    const [stufe] = await db.select().from(schema.tag).where(eqName("Bienli"));
    for (let i = 0; i < MIN_ANZEIGE_LEITENDE; i++) {
      const uid = id();
      await db.insert(schema.user).values({
        id: uid,
        name: `Person ${i}`,
        email: `${uid}@example.org`,
        emailVerified: true,
        abteilungId,
        ceviName: `Cevi${i}`,
      } as typeof schema.user.$inferInsert);
      await db
        .insert(schema.personTag)
        .values({ userId: uid, tagId: stufe!.id, rolle: "leitung" });
    }
    const d2 = await lade(bs);
    const e2 = d2.get(bs.id);
    expect(
      e2?.typ === "kennzahlen" && e2.zahlen.find((z) => z.art === "leitende"),
    ).toEqual({ art: "leitende", zahl: MIN_ANZEIGE_LEITENDE });
    // Keine Personendaten in den Ergebnissen
    expect(JSON.stringify([...d2.values()])).not.toMatch(/Cevi\d|example\.org/);
  });

  test("Abgleich: Seite mit allen Bausteinen, Stil als Datei, nur Daten der eigenen Abteilung, Seite des Anlasses als Ziel", async () => {
    const eigen = await anlass("Sommerlager Eigen", 20, {
      art: "lager",
      offen: true,
    });
    await anlass("Fremdlager", 5, { abt: fremdId });
    const [s] = await db
      .insert(schema.seite)
      .values({
        abteilungId,
        adresse: "lager",
        titel: "Lager",
        reihenfolge: 0,
        sichtbarkeit: "oeffentlich",
      })
      .returning();
    await db.update(schema.anlass).set({ seiteId: s!.id }).where(eqId(eigen));
    const inhalt = {
      v: 1,
      titel: "Lager",
      bausteine: [
        b("naechsterAnlass", {}),
        b("anlaesse", { anzahl: 3 }),
        b("lagerkarte", { anlassId: eigen, kosten: "CHF 100.–" }),
        b("countdown", { anlassId: eigen }),
      ],
    };
    const [v] = await db
      .insert(schema.seiteVersion)
      .values({ seiteId: s!.id, nr: 1, inhalt })
      .returning();
    await db
      .update(schema.seite)
      .set({ veroeffentlichteVersionId: v!.id })
      .where(eqId(s!.id, schema.seite));
    const { ladeStufenfakten } = await import("../src/website/stufenfakten.js");
    await erzeugeWebsite(db, {
      ausgabe,
      abteilungId,
      basisUrl: "https://www.example.org",
      stylesheet: "body{}",
      datenquellen: [ladeStufenfakten, ladeDynamischeBausteine],
    });
    const html = await readFile(join(wurzel, "lager", "index.html"), "utf8");
    expect(html).toContain("Sommerlager Eigen");
    expect(html).not.toContain("Fremdlager");
    expect(html).toContain("CHF 100.–");
    expect(html).toContain(
      '<link rel="stylesheet" href="/website/dynamisch.css">',
    );
    // Die Seite des Anlasses ist ihr öffentlicher Pfad: Der Knopf «Anmelden» bleibt auf der Anmeldung, die Karte der Liste führt dorthin, wo es keine Anmeldung gibt
    expect(html).toContain(`href="/anlass?id=${eigen}"`);
    expect(html).toContain("Noch ");
    // Keine IDs von Personen, keine Fremddaten
    expect(html).not.toContain(fremdId);
  });

  test("Verweisprüfung: unbekannter, fremder oder nicht öffentlicher Anlass und unbekannter Ort", async () => {
    const eigen = await anlass("Eigen", 3);
    const privat = await anlass("Privat", 3, { sicht: "angemeldet" });
    const fremd = await anlass("Fremd", 3, { abt: fremdId });
    const [o] = await db
      .insert(schema.ort)
      .values({ abteilungId, name: "Ort" })
      .returning();
    const [fo] = await db
      .insert(schema.ort)
      .values({ abteilungId: fremdId, name: "Fremder Ort" })
      .returning();
    const d = dok(
      b("lagerkarte", { anlassId: eigen }),
      b("lagerkarte", { anlassId: privat }),
      b("lagerkarte", { anlassId: fremd }),
      b("lagerkarte", { anlassId: id() }),
      b("treffpunkte", { ortIds: [o!.id] }),
      b("treffpunkte", { ortIds: [fo!.id] }),
    );
    const fehler = await pruefeVerweise(db, abteilungId, "oeffentlich", d);
    expect(fehler).toEqual([
      { pfad: "bausteine.1", code: "ANLASS_NICHT_OEFFENTLICH" },
      { pfad: "bausteine.2", code: "ANLASS_UNBEKANNT" },
      { pfad: "bausteine.3", code: "ANLASS_UNBEKANNT" },
      { pfad: "bausteine.5", code: "ORT_UNBEKANNT" },
    ]);
  });
});

const eqName = (name: string) => eq(schema.tag.name, name);
function eqId(
  wert: string,
  tabelle: typeof schema.anlass | typeof schema.seite = schema.anlass,
) {
  return eq(tabelle.id, wert);
}

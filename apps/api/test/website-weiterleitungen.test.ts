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
  vi,
  type MockInstance,
} from "vitest";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { erzeugeWebsite } from "../src/website/abgleich.js";
import { dateisystemAusgabe, type Ausgabe } from "../src/website/ausgabe.js";
import {
  alterPfadSchema,
  pruefeKette,
  rendereCaddy,
  rendereWeiterleitungsseite,
  stufenSlug,
  zielPfadSchema,
} from "../src/website/weiterleitungen.js";
import { API_URL } from "./hilfen/datenbank.js";

const sql = postgres(API_URL);
const db = erstelleDb(sql);
afterAll(() => sql.end());

const BASIS = "https://www.example.org";

describe("Caddy-Ausgabe ohne Injektion", () => {
  test("gültige Pfade ergeben genau eine redir-Zeile je Weiterleitung, sortiert", () => {
    const text = rendereCaddy([
      { alterPfad: "/b-alt", zielPfad: "/b", status: 302 },
      { alterPfad: "/a-alt", zielPfad: "/", status: 301 },
    ]);
    expect(text.split("\n").filter((z) => !z.startsWith("#") && z)).toEqual([
      "redir /a-alt / 301",
      "redir /b-alt /b 302",
    ]);
  });

  // Jedes dieser Zeichen würde in Caddy eine Zeile, einen Block, einen Kommentar oder eine Zeichenkette beginnen oder beenden
  test.each([
    "/a\nredir /x https://fremd.example 301",
    "/a\r\n",
    "/a {",
    "/a}",
    "/a{b}",
    "/a#b",
    '/a"b',
    "/a'b",
    "/a`b",
    "/a b",
    "/a\tb",
    "/a;b",
    "/a$b",
    "/a\\b",
    "/a\0b",
    "https://fremd.example",
    "//fremd.example",
    "/a/../b",
  ])("%j kommt nie in die Datei", (boese) => {
    for (const u of [
      { alterPfad: boese, zielPfad: "/ziel", status: 301 as const },
      { alterPfad: "/alt", zielPfad: boese, status: 301 as const },
    ]) {
      const text = rendereCaddy([u]);
      expect(text).not.toContain("redir");
      expect(text).not.toContain(boese);
    }
  });

  test("ohne Weiterleitung nur die Kommentarzeilen; jede Zeile ist Kommentar oder redir", () => {
    const text = rendereCaddy([
      { alterPfad: "/alt", zielPfad: "/neu", status: 301 },
    ]);
    for (const zeile of text.split("\n").filter(Boolean)) {
      expect(zeile).toMatch(/^(#|redir \/[a-z0-9./-]* \/[a-z0-9./-]* 30[12]$)/);
    }
    expect(rendereCaddy([])).not.toContain("redir");
  });
});

describe("Rückfallseite", () => {
  const html = rendereWeiterleitungsseite(
    { alterPfad: "/alt", zielPfad: "/stufen/woelfe", status: 301 },
    'Cevi <"Test">',
    BASIS,
  );

  test("meta refresh, Link, Sprache und Titel; kein Skript", () => {
    expect(html).toContain('<html lang="de-CH">');
    expect(html).toContain(
      '<meta http-equiv="refresh" content="0; url=/stufen/woelfe">',
    );
    expect(html).toContain('<a class="btn p gross" href="/stufen/woelfe">');
    expect(html).toContain('<a class="tafel" href="/stufen/woelfe">');
    expect(html).toContain('href="/website/fehler.css"');
    expect(html).toContain("<h1>");
    expect(html).toContain("<title>Seite umgezogen | ");
    expect(html).toContain(
      `<link rel="canonical" href="${BASIS}/stufen/woelfe">`,
    );
    expect(html).not.toMatch(/<script|onload|onclick|javascript:/i);
    expect(html).toContain("default-src &#39;none&#39;");
    expect(html).not.toContain("script-src");
  });

  test("der Name der Abteilung wird maskiert", () => {
    expect(html).toContain("Cevi &lt;&quot;Test&quot;&gt;");
    expect(html).not.toContain('<"Test">');
  });
});

describe("Pfade und Ketten", () => {
  test("die Schemas nehmen nur relative Pfade der Website", () => {
    expect(alterPfadSchema.safeParse("/cevistufe-woelfe").success).toBe(true);
    expect(alterPfadSchema.safeParse("/alt.html").success).toBe(true);
    expect(zielPfadSchema.safeParse("/").success).toBe(true);
    expect(alterPfadSchema.safeParse("/").success).toBe(false);
    expect(alterPfadSchema.safeParse("/api/v1").success).toBe(false);
    expect(zielPfadSchema.safeParse("https://x.example").success).toBe(false);
  });

  test("pruefeKette", () => {
    const a = { alterPfad: "/a", zielPfad: "/b" };
    expect(pruefeKette({ alterPfad: "/x", zielPfad: "/y" }, [a])).toBeNull();
    // Mehrere alte Adressen dürfen auf dasselbe Ziel zeigen
    expect(pruefeKette({ alterPfad: "/x", zielPfad: "/b" }, [a])).toBeNull();
    expect(pruefeKette({ alterPfad: "/b", zielPfad: "/a" }, [a])).toBe(
      "schleife",
    );
    expect(pruefeKette({ alterPfad: "/x", zielPfad: "/a" }, [a])).toBe("kette");
    expect(pruefeKette({ alterPfad: "/b", zielPfad: "/y" }, [a])).toBe("kette");
    expect(pruefeKette({ alterPfad: "/x", zielPfad: "/x" }, [])).toBe(
      "schleife",
    );
  });
});

// Ausgabe im Abgleich: eine eigene Abteilung je Test
let abteilungId: string;
let wurzel: string;
let ausgabe: Ausgabe;
let ausgabeLog: MockInstance<typeof console.log>;

beforeEach(async () => {
  const [a] = await db
    .insert(schema.abteilung)
    .values({ name: "Cevi Testabteilung" })
    .returning();
  abteilungId = a!.id;
  wurzel = await mkdtemp(join(tmpdir(), "cevi-weiterleitung-"));
  ausgabe = dateisystemAusgabe(wurzel);
  ausgabeLog = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  ausgabeLog.mockRestore();
  await rm(wurzel, { recursive: true, force: true });
});

const lauf = () =>
  erzeugeWebsite(db, {
    ausgabe,
    abteilungId,
    basisUrl: BASIS,
    stylesheet: "body{color:#000}",
  });
const lies = (pfad: string) => readFile(join(wurzel, pfad), "utf8");
const gibtEs = async (pfad: string) => (await ausgabe.liste()).includes(pfad);

const weiterleite = (alterPfad: string, zielPfad: string, status = 301) =>
  db
    .insert(schema.weiterleitung)
    .values({ abteilungId, alterPfad, zielPfad, status })
    .returning({ id: schema.weiterleitung.id })
    .then(([z]) => z!.id);

const dokument = (titel: string) => ({
  v: 1,
  titel,
  bausteine: [
    {
      id: randomUUID(),
      typ: "text",
      daten: { inhalt: [{ typ: "absatz", inhalt: [{ text: titel }] }] },
    },
  ],
});
// Eine öffentliche, veröffentlichte Seite
async function seite(
  adresse: string,
  extra: { elternId?: string; tagId?: string } = {},
) {
  const [s] = await db
    .insert(schema.seite)
    .values({
      abteilungId,
      adresse,
      titel: adresse,
      sichtbarkeit: "oeffentlich",
      ...extra,
    })
    .returning();
  const [v] = await db
    .insert(schema.seiteVersion)
    .values({ seiteId: s!.id, nr: 1, inhalt: dokument(adresse) })
    .returning();
  await db
    .update(schema.seite)
    .set({ veroeffentlichteVersionId: v!.id })
    .where(eq(schema.seite.id, s!.id));
  return s!.id;
}

describe("Auslieferung der Weiterleitungen", () => {
  test("eine alte Adresse erscheint in weiterleitungen.caddy und als Rückfallseite", async () => {
    await weiterleite("/alte-seite", "/neu", 302);
    await weiterleite("/ordner/alt.html", "/");
    const e = await lauf();
    expect(e.fehler).toBe(0);

    const caddy = await lies("weiterleitungen.caddy");
    expect(caddy).toContain("redir /alte-seite /neu 302\n");
    expect(caddy).toContain("redir /ordner/alt.html / 301\n");

    const seiteAlt = await lies("alte-seite/index.html");
    expect(seiteAlt).toContain('http-equiv="refresh" content="0; url=/neu"');
    expect(seiteAlt).toContain('<a class="btn p gross" href="/neu">');
    expect(seiteAlt).not.toContain("<script");
    expect(await lies("ordner/alt.html/index.html")).toContain('url=/"');
  });

  test("ein zweiter Lauf ohne Änderung schreibt nichts", async () => {
    await weiterleite("/alt", "/neu");
    const merker = new Map<string, string>();
    const einmal = () =>
      erzeugeWebsite(db, {
        ausgabe,
        abteilungId,
        basisUrl: BASIS,
        stylesheet: "x",
        merker,
      });
    expect((await einmal()).geschrieben).toBeGreaterThan(0);
    expect(await einmal()).toEqual({ geschrieben: 0, geloescht: 0, fehler: 0 });
  });

  test("Löschen räumt die Ausgabe auf, auch die Caddy-Datei bei der letzten", async () => {
    const eins = await weiterleite("/eins", "/neu");
    const zwei = await weiterleite("/zwei", "/neu");
    await lauf();
    expect(await gibtEs("eins/index.html")).toBe(true);
    expect(await gibtEs("zwei/index.html")).toBe(true);

    await db
      .delete(schema.weiterleitung)
      .where(eq(schema.weiterleitung.id, eins));
    const e = await lauf();
    expect(e.fehler).toBe(0);
    expect(await gibtEs("eins/index.html")).toBe(false);
    expect(await gibtEs("zwei/index.html")).toBe(true);
    const caddy = await lies("weiterleitungen.caddy");
    expect(caddy).not.toContain("/eins");
    expect(caddy).toContain("redir /zwei /neu 301");

    await db
      .delete(schema.weiterleitung)
      .where(eq(schema.weiterleitung.id, zwei));
    await lauf();
    expect(await gibtEs("zwei/index.html")).toBe(false);
    expect(await gibtEs("weiterleitungen.caddy")).toBe(false);
    // Die Gesamtdateien der Website bleiben
    expect(await gibtEs("sitemap.xml")).toBe(true);
  });

  test("ohne Weiterleitung entsteht keine Caddy-Datei", async () => {
    await lauf();
    expect(await gibtEs("weiterleitungen.caddy")).toBe(false);
  });

  test("wo eine Seite liegt, gilt keine Weiterleitung", async () => {
    await seite("vorhanden");
    await weiterleite("/vorhanden", "/neu");
    await weiterleite("/frei", "/neu");
    await lauf();
    const caddy = await lies("weiterleitungen.caddy");
    expect(caddy).not.toContain("/vorhanden");
    expect(caddy).toContain("redir /frei /neu 301");
    // Die Datei der Seite ist die der Seite, keine Rückfallseite
    expect(await lies("vorhanden/index.html")).not.toContain(
      'http-equiv="refresh"',
    );
  });

  test("reservierte oberste Adressen werden nie weitergeleitet, auch nicht aus der Datenbank", async () => {
    await weiterleite("/api/v1/x", "/neu");
    await weiterleite("/admin", "/neu");
    await weiterleite("/website/website.css", "/neu");
    await weiterleite("/ok", "/neu");
    await lauf();
    const caddy = await lies("weiterleitungen.caddy");
    expect(caddy).toContain("redir /ok /neu 301");
    expect(caddy).not.toMatch(/\/(api|admin|website)/);
    expect(await gibtEs("api/v1/x/index.html")).toBe(false);
    expect(await gibtEs("admin/index.html")).toBe(false);
  });

  test("Weiterleitungen einer anderen Abteilung erscheinen nicht", async () => {
    const [fremd] = await db
      .insert(schema.abteilung)
      .values({ name: "Fremd" })
      .returning();
    await db.insert(schema.weiterleitung).values({
      abteilungId: fremd!.id,
      alterPfad: "/fremde-alt",
      zielPfad: "/neu",
    });
    await weiterleite("/eigene-alt", "/neu");
    await lauf();
    const caddy = await lies("weiterleitungen.caddy");
    expect(caddy).toContain("/eigene-alt");
    expect(caddy).not.toContain("fremde");
  });
});

describe("Altes Adressmuster /cevistufe-<name>", () => {
  async function stufe(name: string) {
    const [t] = await db
      .insert(schema.tag)
      .values({ abteilungId, typ: "stufe", name, kuerzel: "S" })
      .returning();
    return t!.id;
  }

  test("leitet auf die Stufenseite, sobald sie besteht", async () => {
    const tagId = await stufe("Wölfli Süd");
    const stufen = await seite("stufen");
    await lauf();
    // Noch keine Stufenseite: keine Weiterleitung
    expect(await gibtEs("weiterleitungen.caddy")).toBe(false);

    await seite("woelfli", { elternId: stufen, tagId });
    await lauf();
    const caddy = await lies("weiterleitungen.caddy");
    expect(caddy).toContain("redir /cevistufe-woelflisued /stufen/woelfli 301");
    const rueckfall = await lies("cevistufe-woelflisued/index.html");
    expect(rueckfall).toContain("url=/stufen/woelfli");
  });

  test("nicht für Tags anderer Art, und eine eigene Weiterleitung geht vor", async () => {
    const [team] = await db
      .insert(schema.tag)
      .values({ abteilungId, typ: "team", name: "Küche", kuerzel: "K" })
      .returning();
    await seite("kueche", { tagId: team!.id });
    const tagId = await stufe("Biber");
    await seite("biber", { tagId });
    await weiterleite("/cevistufe-biber", "/anders");
    await lauf();
    const caddy = await lies("weiterleitungen.caddy");
    expect(caddy).not.toContain("cevistufe-kueche");
    expect(caddy).toContain("redir /cevistufe-biber /anders 301");
    expect(caddy).not.toContain("/cevistufe-biber /biber");
  });

  test("eine nicht veröffentlichte Stufenseite erzeugt nichts", async () => {
    const tagId = await stufe("Pfadi");
    await db.insert(schema.seite).values({
      abteilungId,
      adresse: "pfadi",
      titel: "Pfadi",
      sichtbarkeit: "oeffentlich",
      tagId,
    });
    await lauf();
    expect(await gibtEs("weiterleitungen.caddy")).toBe(false);
  });
});

test("Stufenname wird klein, Umlaute ausgeschrieben, Rest entfernt", () => {
  expect(stufenSlug("Fröschli")).toBe("froeschli");
  expect(stufenSlug(" Pi-La Mi ")).toBe("pilami");
  expect(stufenSlug("../admin")).toBe("admin");
});

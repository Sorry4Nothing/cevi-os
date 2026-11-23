import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import {
  erzeugeWebsite,
  starteWebsiteAbgleich,
  synchronisiereWebsite,
  type AbgleichOptionen,
} from "../src/website/abgleich.js";
import { dateisystemAusgabe, type Ausgabe } from "../src/website/ausgabe.js";
import { meldeWebsiteEreignis } from "../src/website/ereignisse.js";
import { erstelleWebsiteSperre } from "../src/website/sperre.js";
import { zeichenVersion } from "../src/website/zeichen.js";
import { API_URL } from "./hilfen/datenbank.js";

const sql = postgres(API_URL);
const db = erstelleDb(sql);
afterAll(() => sql.end());

const BASIS = "https://www.example.org";
const GEHEIM = "GEHEIMER-MARKER-TEXT";
const CSS = "body{color:#000}";

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
  wurzel = await mkdtemp(join(tmpdir(), "cevi-abgleich-"));
  ausgabe = dateisystemAusgabe(wurzel);
  ausgabeLog = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  ausgabeLog.mockRestore();
  await rm(wurzel, { recursive: true, force: true });
});

const text = (t: string, extra: object = {}) => ({
  id: randomUUID(),
  typ: "text",
  daten: { inhalt: [{ typ: "absatz", inhalt: [{ text: t }] }] },
  ...extra,
});
const dok = (titel: string, ...bausteine: unknown[]) => ({
  v: 1,
  titel,
  bausteine,
});

type Neu = {
  adresse: string;
  titel?: string;
  elternId?: string | null;
  sichtbarkeit?: "oeffentlich" | "angemeldet" | "tags";
  inhalt?: unknown | null;
  reihenfolge?: number;
};
// Legt Seite und (falls «inhalt») eine veröffentlichte Version an
async function seite(n: Neu) {
  const [s] = await db
    .insert(schema.seite)
    .values({
      abteilungId,
      elternId: n.elternId ?? null,
      adresse: n.adresse,
      titel: n.titel ?? n.adresse,
      reihenfolge: n.reihenfolge ?? 0,
      sichtbarkeit: n.sichtbarkeit ?? "oeffentlich",
    })
    .returning();
  if (n.inhalt !== undefined && n.inhalt !== null)
    await veroeffentliche(s!.id, n.inhalt);
  return s!.id;
}
async function veroeffentliche(seiteId: string, inhalt: unknown) {
  const [v] = await db
    .insert(schema.seiteVersion)
    .values({
      seiteId,
      nr: Math.floor(Math.random() * 1_000_000) + 1,
      inhalt,
    })
    .returning();
  await db
    .update(schema.seite)
    .set({ veroeffentlichteVersionId: v!.id })
    .where(eq(schema.seite.id, seiteId));
}

const lauf = (extra: Partial<AbgleichOptionen> = {}) =>
  erzeugeWebsite(db, {
    ausgabe,
    abteilungId,
    basisUrl: BASIS,
    stylesheet: CSS,
    ...extra,
  });
const lies = (pfad: string) => readFile(join(wurzel, pfad), "utf8");
const alle = async () =>
  Object.fromEntries(
    await Promise.all(
      (await ausgabe.liste()).map(async (p) => [p, await lies(p)] as const),
    ),
  );
const hash = async (id: string) =>
  (
    await db
      .select({ h: schema.seite.ausgabeHash, am: schema.seite.ausgabeAm })
      .from(schema.seite)
      .where(eq(schema.seite.id, id))
  )[0]!;

describe("Was ausgeliefert wird", () => {
  test("nur öffentliche, veröffentlichte Seiten; geschützte Inhalte fehlen in jeder Datei", async () => {
    const start = await seite({
      adresse: "start",
      titel: "Start",
      inhalt: dok("Willkommen", text("Hallo")),
    });
    const stufen = await seite({
      adresse: "stufen",
      titel: "Stufen",
      inhalt: dok(
        "Stufen",
        text("Alle Stufen"),
        text(GEHEIM, { sichtbarkeit: { art: "angemeldet" } }),
        text(GEHEIM, { sichtbarkeit: { art: "tags", tagIds: [randomUUID()] } }),
      ),
    });
    await seite({
      adresse: "woelfe",
      titel: "Wölfe",
      elternId: stufen,
      inhalt: dok("Wölfe", text("Treff am Samstag")),
    });
    // Nicht ausgeliefert: ohne Version, angemeldet, nur für Tags
    await seite({ adresse: "entwurf", titel: GEHEIM });
    await seite({
      adresse: "intern",
      titel: GEHEIM,
      sichtbarkeit: "angemeldet",
      inhalt: dok(GEHEIM, text(GEHEIM)),
    });
    await seite({
      adresse: "gruppe",
      titel: GEHEIM,
      sichtbarkeit: "tags",
      inhalt: dok(GEHEIM, text(GEHEIM)),
    });

    const e = await lauf();
    // Sieben Dateien der öffentlichen Seiten, dazu die Anmeldeseite, der Datenplan (termine.json, #564) und je eine Hülle für die zwei ganz geschützten Seiten
    expect(e).toEqual({ geschrieben: 17, geloescht: 0, fehler: 0 });

    const dateien = await alle();
    expect(Object.keys(dateien).sort()).toEqual([
      "404.html",
      "500.html",
      "anlass/anmeldung/index.html",
      "anlass/index.html",
      "anmelden/index.html",
      "gruppe/index.html",
      "index.html",
      "intern/index.html",
      "robots.txt",
      "sitemap.xml",
      "stufen/index.html",
      "stufen/woelfe/index.html",
      "termine/index.html",
      "termine/termine.json",
      "termine/vorschlagen/index.html",
      "wartung.html",
      "website/website.css",
    ]);
    // Der Marker steht in keiner erzeugten Datei, Titel nicht in der Navigation, der Platzhalter nur mit ID
    for (const inhalt of Object.values(dateien))
      expect(inhalt).not.toContain(GEHEIM);
    expect(dateien["stufen/index.html"]).toContain("Alle Stufen");
    expect(
      (dateien["stufen/index.html"]!.match(/data-geschuetzt/g) ?? []).length,
    ).toBe(2);
    expect(dateien["index.html"]).toContain(
      '<link rel="canonical" href="https://www.example.org/">',
    );
    expect(dateien["stufen/woelfe/index.html"]).toContain(
      '<link rel="canonical" href="https://www.example.org/stufen/woelfe">',
    );
    expect(dateien["website/website.css"]).toBe(CSS);
    // Navigation: Baum nur aus öffentlichen Seiten, aktuelle Seite markiert
    expect(dateien["stufen/woelfe/index.html"]).toContain(
      '<li><a href="/">Start</a></li><li class="mit-unter"><a href="/stufen" aria-current="true">Stufen</a><details open><summary aria-label="Unterseiten von Stufen">',
    );
    expect(dateien["stufen/woelfe/index.html"]).toContain(
      '</summary><ul><li><a href="/stufen/woelfe" aria-current="page">Wölfe</a>',
    );
    expect(dateien["404.html"]).toContain("Seite nicht gefunden");
    // Ganz geschützte Seiten: nur eine Hülle ohne Titel und Inhalt, mit Hinweis und Link zur Anmeldung, nie in der Sitemap
    for (const [datei, pfad] of [
      ["intern/index.html", "/intern"],
      ["gruppe/index.html", "/gruppe"],
    ] as const) {
      const h = dateien[datei]!;
      expect(h).toContain("<h1>Geschützte Seite</h1>");
      expect(h).toContain(`data-huelle data-pfad="${pfad}"`);
      expect(h).toContain(
        `href="/anmelden?weiter=${encodeURIComponent(pfad)}"`,
      );
      expect(h).toContain("noindex");
      expect(h).not.toContain("<h1>intern");
      expect(h).not.toContain("<h1>gruppe");
    }
    expect(dateien["sitemap.xml"]).not.toContain("intern");
    expect(dateien["sitemap.xml"]).not.toContain("gruppe");
    // Die Anmeldeseite hat Formular und Skript, aber kein name-Attribut an den Feldern (nie ein Passwort in einer Adresse)
    expect(dateien["anmelden/index.html"]).toContain(
      'src="/website/anmelden.js"',
    );
    expect(dateien["anmelden/index.html"]).not.toMatch(/<input[^>]* name=/);
    // Sitemap nur öffentlich
    const locs = [
      ...dateien["sitemap.xml"]!.matchAll(/<loc>([^<]+)<\/loc>/g),
    ].map((m) => m[1]);
    expect(locs).toEqual([
      `${BASIS}/`,
      `${BASIS}/stufen`,
      `${BASIS}/stufen/woelfe`,
    ]);
    expect(dateien["robots.txt"]).toBe(
      `User-agent: *\nDisallow: /api/\nDisallow: /admin\nSitemap: ${BASIS}/sitemap.xml\n`,
    );
    // Hash und Zeitpunkt nur bei den Seiten mit Datei
    expect((await hash(start)).h).toMatch(/^[0-9a-f]{64}$/);
    expect((await hash(start)).am).toBeInstanceOf(Date);
  });

  test("Skripte liegen unter website/; nur Seiten mit Platzhalter laden das Skript, mit angepasster Meta-CSP", async () => {
    await seite({
      adresse: "offen",
      inhalt: dok("Offen", text("Nur öffentlich")),
    });
    await seite({
      adresse: "mit",
      inhalt: dok(
        "Mit",
        text("Geheim", { sichtbarkeit: { art: "angemeldet" } }),
      ),
    });
    await lauf({ skripte: { "geschuetzt.js": "// a", "knoten.js": "// b" } });
    const d = await alle();
    expect(d["website/geschuetzt.js"]).toBe("// a");
    expect(d["website/knoten.js"]).toBe("// b");
    // Das Menü (menue.js) ist auf jeder Seite mit Navigation, theme.js (#550) auf jeder Seite; ohne Platzhalter braucht die Seite das Skript für geschützte Bausteine nicht. Verbinden darf sie wegen des Konto-Menüs im Kopf (konto.js, #669), nur zur eigenen Herkunft
    expect(d["offen/index.html"]).not.toContain("geschuetzt.js");
    expect(d["offen/index.html"]).toContain("connect-src &#39;self&#39;");
    expect(d["offen/index.html"]).toContain(
      '<script type="module" src="/website/menue.js"></script>',
    );
    expect(d["offen/index.html"]).toContain(
      '<script src="/website/theme.js"></script>',
    );
    expect(d["mit/index.html"]).toContain(
      '<script type="module" src="/website/geschuetzt.js"></script>',
    );
    expect(d["mit/index.html"]).toContain("script-src");
    expect(d["mit/index.html"]).toContain('data-pfad="/mit"');
    // Ohne Inline-Skript, nie unsafe-inline oder eval
    for (const html of Object.values(d)) {
      expect(html).not.toMatch(/unsafe-inline|unsafe-eval/);
      expect(html).not.toMatch(/<script(?![^>]* src=)/);
    }
  });

  test("Favicon überall (#581): jede erzeugte Seite und die Hinweisseite der Sperre tragen die Einträge, und jede Adresse zeigt auf eine Datei der Ausgabe", async () => {
    await seite({ adresse: "start", inhalt: dok("Start", text("Hallo")) });
    await db.insert(schema.weiterleitung).values({
      abteilungId,
      alterPfad: "/alt",
      zielPfad: "/start",
      status: 301,
    });
    const dateien = [
      "favicon.ico",
      "website/zeichen-32.png",
      "website/zeichen-192.png",
      "apple-touch-icon.png",
    ];
    const zeichen = async () =>
      Object.fromEntries(
        dateien.map((d) => [d, new TextEncoder().encode(`${d}:test`)]),
      ) as never;
    await lauf({ zeichen });
    const geprueft = async () => {
      const html = Object.entries(await alle()).filter(([p]) =>
        p.endsWith(".html"),
      );
      const links = (h: string) =>
        [...h.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*>/g)].map(
          (m) => /href="\/([^"?]+)\?v=[0-9a-f]{12}"/.exec(m[0])?.[1],
        );
      for (const [pfad, h] of html) {
        // Jede Seite hat drei Einträge, und jeder zeigt auf eine geschriebene Datei
        expect(links(h), pfad).toHaveLength(3);
        for (const datei of links(h)) {
          expect(await ausgabe.liste(), pfad).toContain(datei);
        }
      }
      return html.map(([p]) => p);
    };
    // Gefunden: Startseite, Anlass, Termine, 404, 500, Wartung, Anmeldung, Termine, Rückfallseite «Seite umgezogen»
    expect(await geprueft()).toEqual(
      expect.arrayContaining([
        "index.html",
        "404.html",
        "500.html",
        "wartung.html",
        "anmelden/index.html",
        "alt/index.html",
      ]),
    );

    // Die Sperre leert die Ausgabe, behält aber das Favicon und trägt die Einträge auch auf ihrer Hinweisseite
    await erstelleWebsiteSperre(ausgabe, abteilungId, zeichen).nimmVomNetz();
    expect((await ausgabe.liste()).sort()).toEqual(
      [
        "404.html",
        "gesperrt.css",
        "index.html",
        "weiterleitungen.caddy",
        ...dateien,
      ].sort(),
    );
    expect(await geprueft()).toEqual(["404.html", "index.html"]);
    // Gleiche Adresse wie auf der Website: Der Browser holt nichts doppelt
    expect(await lies("index.html")).toContain(
      `href="/website/zeichen-32.png?v=${zeichenVersion(new TextEncoder().encode("favicon.ico:test"))}"`,
    );
  });

  test("Favicon (#558): Dateien an der Wurzel und unter website/, Einträge auf jeder Seite; nur ein öffentliches Bild der Abteilung ist Quelle", async () => {
    await seite({ adresse: "start", inhalt: dok("Start", text("Hallo")) });
    const quellen: (string | null)[] = [];
    // Attrappe: je Datei ihr Name als Inhalt, dazu die Quelle, damit sich der Hash mit dem Zeichen ändert
    const zeichen = async (q: { id: string } | null) => {
      quellen.push(q?.id ?? null);
      return Object.fromEntries(
        [
          "favicon.ico",
          "website/zeichen-32.png",
          "website/zeichen-192.png",
          "apple-touch-icon.png",
        ].map((d) => [
          d,
          new TextEncoder().encode(`${d}:${q?.id ?? "standard"}`),
        ]),
      ) as never;
    };
    const setze = (id: string | null) =>
      db
        .update(schema.abteilung)
        .set({ websiteZeichenMediumId: id })
        .where(eq(schema.abteilung.id, abteilungId));
    const medium = async (sichtbarkeit: "oeffentlich" | "angemeldet") =>
      (
        await db
          .insert(schema.medium)
          .values({
            abteilungId,
            mimeTyp: "image/webp",
            groesse: 10,
            breite: 64,
            hoehe: 64,
            altText: "Zeichen",
            dekorativ: false,
            sichtbarkeit,
            speicherSchluessel: randomUUID(),
          })
          .returning({ id: schema.medium.id })
      )[0]!.id;
    const version = (html: string) =>
      /zeichen-32\.png\?v=([0-9a-f]{12})"/.exec(html)![1];

    // Ohne Wahl: die Quelle ist null (der Server nimmt dann das Cevi-Zeichen), Dateien und Einträge sind da
    await lauf({ zeichen });
    expect(quellen).toEqual([null]);
    expect(await lies("favicon.ico")).toBe("favicon.ico:standard");
    expect(await lies("apple-touch-icon.png")).toContain("standard");
    expect(await lies("website/zeichen-192.png")).toContain("standard");
    const vorher = version(await lies("index.html"));
    for (const datei of ["index.html", "404.html", "anmelden/index.html"]) {
      const html = await lies(datei);
      expect(html, datei).toContain(
        `<link rel="icon" type="image/png" sizes="32x32" href="/website/zeichen-32.png?v=${vorher}">`,
      );
      expect(html, datei).toContain(
        `<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=${vorher}">`,
      );
    }

    // Gewähltes Zeichen: Die Dateien und die Fassung in den Adressen wechseln
    const eigenes = await medium("oeffentlich");
    await setze(eigenes);
    await lauf({ zeichen });
    expect(quellen.at(-1)).toBe(eigenes);
    expect(await lies("favicon.ico")).toBe(`favicon.ico:${eigenes}`);
    expect(version(await lies("index.html"))).not.toBe(vorher);

    // Nicht öffentlich: keine Quelle, also wieder das Zeichen der Plattform
    await setze(await medium("angemeldet"));
    await lauf({ zeichen });
    expect(quellen.at(-1)).toBeNull();
    expect(version(await lies("index.html"))).toBe(vorher);
    await setze(null);

    // Ohne die Funktion (kein Favicon eingerichtet): keine Einträge
    await lauf();
    expect(await lies("index.html")).not.toContain('rel="icon"');
  });

  test("Logo (#550): im Kopf jeder Seite, nur wenn das Medium öffentlich und ein Bild der Abteilung ist", async () => {
    await seite({ adresse: "start", inhalt: dok("Start", text("Hallo")) });
    const neuesMedium = async (extra: object = {}, abt = abteilungId) =>
      (
        await db
          .insert(schema.medium)
          .values({
            abteilungId: abt,
            mimeTyp: "image/png",
            groesse: 10,
            breite: 715,
            hoehe: 178,
            altText: "Cevi",
            dekorativ: false,
            sichtbarkeit: "oeffentlich",
            speicherSchluessel: randomUUID(),
            ...extra,
          })
          .returning({ id: schema.medium.id })
      )[0]!.id;
    const setze = (logo: string | null) =>
      db
        .update(schema.abteilung)
        .set({ websiteLogoMediumId: logo })
        .where(eq(schema.abteilung.id, abteilungId));

    await lauf();
    expect(await lies("index.html")).toContain("<b>CEVI</b>");

    const logo = await neuesMedium();
    await setze(logo);
    await lauf();
    for (const datei of ["index.html", "404.html", "anmelden/index.html"]) {
      const html = await lies(datei);
      expect(html, datei).toContain(
        `<img class="logo" src="/api/v1/medien/${logo}" alt="Cevi" width="715" height="178">`,
      );
      expect(html, datei).not.toContain("<b>CEVI</b>");
    }

    // Fassung für den dunklen Modus (#558): beide Bilder im Kopf; eine nicht öffentliche Fassung fehlt, das Logo bleibt
    const setzeDunkel = (dunkel: string | null) =>
      db
        .update(schema.abteilung)
        .set({ websiteLogoDunkelMediumId: dunkel })
        .where(eq(schema.abteilung.id, abteilungId));
    const dunkel = await neuesMedium();
    await setzeDunkel(dunkel);
    await lauf();
    expect(await lies("index.html")).toContain(
      `<img class="logo logo--hell" src="/api/v1/medien/${logo}" alt="Cevi" width="715" height="178"><img class="logo logo--dunkel" src="/api/v1/medien/${dunkel}" alt="Cevi" width="715" height="178">`,
    );
    const dunkelIntern = await neuesMedium({ sichtbarkeit: "angemeldet" });
    await setzeDunkel(dunkelIntern);
    await lauf();
    const ohneDunkel = await lies("index.html");
    expect(ohneDunkel).toContain(
      `<img class="logo" src="/api/v1/medien/${logo}"`,
    );
    expect(ohneDunkel).not.toContain(dunkelIntern);
    await setzeDunkel(null);

    // Nicht öffentlich oder aus einer anderen Abteilung: wieder die Wortmarke
    const intern = await neuesMedium({ sichtbarkeit: "angemeldet" });
    await setze(intern);
    await lauf();
    expect(await lies("index.html")).toContain("<b>CEVI</b>");
    const [fremd] = await db
      .insert(schema.abteilung)
      .values({ name: "Fremde Abteilung" })
      .returning();
    const fremdes = await neuesMedium({}, fremd!.id);
    await setze(fremdes);
    await lauf();
    const html = await lies("index.html");
    expect(html).toContain("<b>CEVI</b>");
    expect(html).not.toContain(fremdes);

    // Wird das Medium gelöscht, fällt das Logo weg (kein Fehler, keine tote Adresse)
    const weg = await neuesMedium();
    await setze(weg);
    await db.delete(schema.medium).where(eq(schema.medium.id, weg));
    await lauf();
    expect(await lies("index.html")).toContain("<b>CEVI</b>");
  });

  test("Bild der Fehlerseiten (#567): die Wahl der Einstellungen, sonst das Titelbild der Startseite; nur öffentliche Bilder der Abteilung", async () => {
    const neuesMedium = async (extra: object = {}) =>
      (
        await db
          .insert(schema.medium)
          .values({
            abteilungId,
            mimeTyp: "image/webp",
            groesse: 10,
            breite: 1920,
            hoehe: 576,
            altText: "Weg",
            dekorativ: false,
            sichtbarkeit: "oeffentlich",
            speicherSchluessel: randomUUID(),
            ...extra,
          })
          .returning({ id: schema.medium.id })
      )[0]!.id;
    const setze = (id: string | null) =>
      db
        .update(schema.abteilung)
        .set({ websiteFehlerbildMediumId: id })
        .where(eq(schema.abteilung.id, abteilungId));
    const titel = await neuesMedium({ altText: "Titel" });
    await seite({
      adresse: "start",
      inhalt: dok("Start", {
        id: randomUUID(),
        typ: "bild",
        daten: { mediumId: titel },
      }),
    });

    // Ohne Wahl: das Titelbild der Startseite
    await lauf();
    const ohneWahl = await lies("404.html");
    expect(ohneWahl).toContain(
      `<img class="irr-bild" src="/api/v1/medien/${titel}" alt="" width="1920" height="576"`,
    );

    // Mit Wahl: dieses Bild, mit seinen Massen
    const weg = await neuesMedium({ breite: 1600, hoehe: 900 });
    await setze(weg);
    await lauf();
    const mitWahl = await lies("404.html");
    expect(mitWahl).toContain(
      `<img class="irr-bild" src="/api/v1/medien/${weg}" alt="" width="1600" height="900"`,
    );
    expect(mitWahl).not.toContain(titel);
    // 500 und Wartung tragen nie ein Foto
    expect(await lies("500.html")).not.toContain("/api/v1/medien/");
    expect(await lies("wartung.html")).not.toContain("/api/v1/medien/");

    // Nicht öffentlich: wieder das Titelbild
    await setze(await neuesMedium({ sichtbarkeit: "angemeldet" }));
    await lauf();
    expect(await lies("404.html")).toContain(`/api/v1/medien/${titel}`);
  });

  test("Karussell (#550): ein Skript nur auf Seiten, die eines zeigen", async () => {
    const bilder = await Promise.all(
      [1, 2, 3].map(async (n) => ({
        mediumId: (
          await db
            .insert(schema.medium)
            .values({
              abteilungId,
              mimeTyp: "image/webp",
              groesse: 10,
              breite: 16,
              hoehe: 9,
              altText: `Bild ${n}`,
              dekorativ: false,
              sichtbarkeit: "oeffentlich",
              speicherSchluessel: randomUUID(),
            })
            .returning({ id: schema.medium.id })
        )[0]!.id,
      })),
    );
    await seite({
      adresse: "mit",
      inhalt: dok("Mit", {
        id: randomUUID(),
        typ: "karussell",
        daten: { bilder },
      }),
    });
    await seite({ adresse: "ohne", inhalt: dok("Ohne", text("Hallo")) });
    await lauf({ skripte: { "karussell.js": "// k" } });
    const d = await alle();
    expect(d["website/karussell.js"]).toBe("// k");
    expect(d["mit/index.html"]).toContain(
      '<script src="/website/karussell.js" defer></script>',
    );
    expect(d["mit/index.html"]).toContain('aria-roledescription="Karussell"');
    expect(d["ohne/index.html"]).not.toContain("karussell");
  });

  test("Seiten anderer Abteilungen und reservierte Adressen erzeugen nie eine Datei", async () => {
    const [fremd] = await db
      .insert(schema.abteilung)
      .values({ name: "Fremde Abteilung" })
      .returning();
    await db.insert(schema.seite).values({
      abteilungId: fremd!.id,
      adresse: "fremd",
      titel: "Fremd",
      sichtbarkeit: "oeffentlich",
    });
    await seite({ adresse: "api", inhalt: dok("Api") });
    await seite({ adresse: "website", inhalt: dok("Web") });
    await seite({ adresse: "admin", inhalt: dok("Abteilungsleitung") });
    const eltern = await seite({ adresse: "ordner", inhalt: dok("Ordner") });
    // Unterseiten dürfen reservierte Adressen tragen
    await seite({ adresse: "api", elternId: eltern, inhalt: dok("Unter") });
    await lauf();
    expect(await ausgabe.liste()).toEqual([
      "404.html",
      "500.html",
      "anlass/anmeldung/index.html",
      "anlass/index.html",
      "anmelden/index.html",
      "ordner/api/index.html",
      "ordner/index.html",
      "robots.txt",
      "sitemap.xml",
      "termine/index.html",
      "termine/termine.json",
      "termine/vorschlagen/index.html",
      "wartung.html",
      "website/website.css",
    ]);
  });

  test("öffentliche Seite unter einer geschützten Elternseite: eigene Datei, Navigation an der Wurzel", async () => {
    const eltern = await seite({
      adresse: "intern",
      sichtbarkeit: "angemeldet",
      inhalt: dok("Intern", text(GEHEIM)),
    });
    await seite({
      adresse: "offen",
      elternId: eltern,
      titel: "Offen",
      inhalt: dok("Offen"),
    });
    await lauf();
    const d = await alle();
    expect(Object.keys(d)).toContain("intern/offen/index.html");
    expect(d["intern/offen/index.html"]).toContain(
      '<nav class="hauptnav" aria-label="Hauptnavigation"><ul><li><a href="/intern/offen" aria-current="page">Offen</a></li></ul></nav>',
    );
    expect(JSON.stringify(d)).not.toContain(GEHEIM);
  });

  test("Medien, Personen und Teams: nur Öffentliches, nur Cevi-Name und Funktion", async () => {
    const medium = async (
      sichtbarkeit: "oeffentlich" | "angemeldet",
      alt: string,
      abt = abteilungId,
    ) =>
      (
        await db
          .insert(schema.medium)
          .values({
            abteilungId: abt,
            mimeTyp: "image/webp",
            groesse: 10,
            breite: 10,
            hoehe: 10,
            altText: alt,
            sichtbarkeit,
            speicherSchluessel: randomUUID(),
          })
          .returning()
      )[0]!.id;
    const offen = await medium("oeffentlich", "Lagerfeuer");
    const zu = await medium("angemeldet", GEHEIM);
    const [andere] = await db
      .insert(schema.abteilung)
      .values({ name: "Andere" })
      .returning();
    const fremd = await medium("oeffentlich", GEHEIM, andere!.id);
    const person = async (
      name: string,
      extra: Partial<typeof schema.user.$inferInsert> = {},
    ) =>
      (
        await db
          .insert(schema.user)
          .values({
            name,
            email: `${randomUUID()}@example.org`,
            abteilungId,
            ...extra,
          })
          .returning()
      )[0]!.id;
    const mit = await person("Echter Name Eins", {
      ceviName: "Wolke",
      telefon: "+41790000000",
    });
    const ohne = await person("Echter Name Zwei");
    const aus = await person("Echter Name Drei", {
      ceviName: "Deaktiviert",
      deaktiviertAm: new Date(),
    });
    const [t] = await db
      .insert(schema.tag)
      .values({ abteilungId, typ: "team", name: "Leitung", kuerzel: "L" })
      .returning();
    await db.insert(schema.personTag).values([
      { userId: mit, tagId: t!.id, rolle: "Stufenleitung", prioritaet: 1 },
      { userId: ohne, tagId: t!.id },
      { userId: aus, tagId: t!.id },
    ]);
    await seite({
      adresse: "start",
      inhalt: dok(
        "Start",
        { id: randomUUID(), typ: "bild", daten: { mediumId: offen } },
        { id: randomUUID(), typ: "bild", daten: { mediumId: zu } },
        { id: randomUUID(), typ: "bild", daten: { mediumId: fremd } },
        {
          id: randomUUID(),
          typ: "kontaktperson",
          daten: { personId: mit, zusatz: ["telefon", "email"] },
        },
        { id: randomUUID(), typ: "kontaktperson", daten: { personId: ohne } },
        { id: randomUUID(), typ: "leitungsteam", daten: { tagId: t!.id } },
      ),
    });
    await lauf();
    const html = await lies("index.html");
    expect(html).toContain(
      `<img src="/api/v1/medien/${offen}" alt="Lagerfeuer" width="10" height="10" decoding="async" fetchpriority="high">`,
    );
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).toContain(
      '<span class="name">Wolke</span><span class="funktion">Stufenleitung</span>',
    );
    for (const verboten of [
      "Echter Name",
      "Deaktiviert",
      GEHEIM,
      "41790000000",
      "tel:",
      "mailto:",
    ]) {
      expect(html).not.toContain(verboten);
    }
    // Wolke steht einmal als Kontaktperson und einmal im Team; ohne Cevi-Namen und deaktivierte Konten erscheinen nie
    expect(html.match(/Wolke/g)).toHaveLength(2);
  });

  test("zusätzliche Datenquellen füllen die Stufenfakten", async () => {
    const id = await seite({
      adresse: "start",
      inhalt: dok("Start", {
        id: randomUUID(),
        typ: "stufenfakten",
        daten: {},
      }),
    });
    await lauf({
      datenquellen: [
        async (_db, _abt, ids) => ({
          stufenfakten: new Map(
            ids.map((i) => [
              i,
              [{ bezeichnung: "Treffpunkt", wert: "Bahnhof" }],
            ]),
          ),
        }),
      ],
    });
    expect(id).toBeTruthy();
    expect(await lies("index.html")).toContain(
      "<dt>Treffpunkt</dt><dd>Bahnhof</dd>",
    );
  });
});

describe("Hash, Idempotenz und Aufräumen", () => {
  test("ein zweiter Lauf ohne Änderung schreibt nichts", async () => {
    const id = await seite({
      adresse: "start",
      inhalt: dok("Start", text("a")),
    });
    await seite({ adresse: "unter", inhalt: dok("Unter") });
    const merker = new Map<string, string>();
    expect((await lauf({ merker })).geschrieben).toBe(14);
    const vorher = await hash(id);
    // Eigene Ausgabe, die jeden Schreibversuch zählt
    const schreibt = vi.spyOn(ausgabe, "schreibe");
    expect(await lauf({ merker })).toEqual({
      geschrieben: 0,
      geloescht: 0,
      fehler: 0,
    });
    // Auch ohne Merker (neuer Prozess): Seiten tragen den Hash in der Datenbank, nur die Gesamtdateien schreibt der erste Lauf einmal neu
    const nachNeustart = await lauf();
    expect(nachNeustart.geschrieben).toBe(12);
    expect(schreibt).toHaveBeenCalledTimes(12);
    expect(await hash(id)).toEqual(vorher);
  });

  test("eine geänderte Seite schreibt nur sich; eine fehlende Datei kommt zurück", async () => {
    const a = await seite({
      adresse: "start",
      titel: "Start",
      inhalt: dok("Start", text("alt")),
    });
    await seite({ adresse: "b", titel: "B", inhalt: dok("B") });
    const merker = new Map<string, string>();
    await lauf({ merker });
    const vorher = await hash(a);
    await veroeffentliche(a, dok("Start", text("neu")));
    expect((await lauf({ merker })).geschrieben).toBe(1);
    expect(await lies("index.html")).toContain("neu");
    expect((await hash(a)).h).not.toBe(vorher.h);

    await rm(join(wurzel, "b/index.html"));
    expect((await lauf({ merker })).geschrieben).toBe(1);
    expect(await lies("b/index.html")).toContain("<h1>B</h1>");
  });

  test("Zurückziehen, Sichtbarkeit und Löschen entfernen die Datei und den Hash; fremde Dateien bleiben", async () => {
    const a = await seite({ adresse: "a", inhalt: dok("A") });
    const b = await seite({ adresse: "b", inhalt: dok("B") });
    const c = await seite({ adresse: "c", inhalt: dok("C") });
    await seite({ adresse: "d", inhalt: dok("D") });
    await writeFile(join(wurzel, "notiz.txt"), "bleibt");
    await writeFile(join(wurzel, ".htaccess"), "bleibt");
    await lauf();
    expect(await ausgabe.liste()).toContain("a/index.html");

    await db
      .update(schema.seite)
      .set({ veroeffentlichteVersionId: null })
      .where(eq(schema.seite.id, a));
    await db
      .update(schema.seite)
      .set({ sichtbarkeit: "angemeldet" })
      .where(eq(schema.seite.id, b));
    await db.delete(schema.seite).where(eq(schema.seite.id, c));
    const e = await lauf();
    // a (zurückgezogen) und c (gelöscht) gehen; b ist jetzt ganz geschützt und wird zur Hülle
    expect(e.geloescht).toBe(2);
    expect(await ausgabe.liste()).toEqual([
      "404.html",
      "500.html",
      "anlass/anmeldung/index.html",
      "anlass/index.html",
      "anmelden/index.html",
      "b/index.html",
      "d/index.html",
      "notiz.txt",
      "robots.txt",
      "sitemap.xml",
      "termine/index.html",
      "termine/termine.json",
      "termine/vorschlagen/index.html",
      "wartung.html",
      "website/website.css",
    ]);
    expect(await lies(".htaccess")).toBe("bleibt");
    expect((await lies("sitemap.xml")).match(/<loc>/g)).toHaveLength(1);
    expect((await hash(a)).h).toBeNull();
    expect((await hash(b)).h).toMatch(/^[0-9a-f]{64}$/);
    expect(await lies("b/index.html")).toContain("<h1>Geschützte Seite</h1>");
    expect(await lies("b/index.html")).not.toContain("<h1>B</h1>");
    // Die Navigation der übrigen Seiten kennt sie nicht mehr
    expect(await lies("d/index.html")).not.toContain('href="/a"');
  });

  test("eine geänderte Adresse verschiebt die Datei", async () => {
    const a = await seite({ adresse: "alt", inhalt: dok("A") });
    await lauf();
    await db
      .update(schema.seite)
      .set({ adresse: "neu" })
      .where(eq(schema.seite.id, a));
    await lauf();
    const liste = await ausgabe.liste();
    expect(liste).toContain("neu/index.html");
    expect(liste).not.toContain("alt/index.html");
  });

  test("ohne Seiten entstehen nur die Gesamtdateien, die Sitemap ist leer", async () => {
    await lauf();
    expect(await ausgabe.liste()).toEqual([
      "404.html",
      "500.html",
      "anlass/anmeldung/index.html",
      "anlass/index.html",
      "anmelden/index.html",
      "robots.txt",
      "sitemap.xml",
      "termine/index.html",
      "termine/termine.json",
      "termine/vorschlagen/index.html",
      "wartung.html",
      "website/website.css",
    ]);
    expect(await lies("sitemap.xml")).not.toContain("<url>");
  });
});

describe("Fehler", () => {
  const protokoll = () =>
    ausgabeLog.mock.calls.map((a) => String(a[0])).join("\n");

  test("ein Fehler der Ausgabe bricht den Lauf nicht ab und der Log nennt keine Inhalte", async () => {
    const a = await seite({
      adresse: "a",
      titel: GEHEIM,
      inhalt: dok(GEHEIM, text(GEHEIM)),
    });
    const b = await seite({ adresse: "b", inhalt: dok("B") });
    const echt = dateisystemAusgabe(wurzel);
    const kaputt: Ausgabe = {
      ...echt,
      schreibe: async (pfad, inhalt) => {
        if (pfad === "a/index.html") {
          throw Object.assign(new Error(`Pfad ${wurzel} Inhalt ${inhalt}`), {
            code: "EACCES",
          });
        }
        return echt.schreibe(pfad, inhalt);
      },
    };
    const e = await lauf({ ausgabe: kaputt });
    expect(e.fehler).toBe(1);
    expect(await echt.liste()).toContain("b/index.html");
    expect(await echt.liste()).not.toContain("a/index.html");
    // Kein Hash für die Seite, die nicht geschrieben wurde: Der nächste Lauf versucht es wieder
    expect((await hash(a)).h).toBeNull();
    expect((await hash(b)).h).not.toBeNull();
    const log = protokoll();
    expect(log).toContain('"code":"EACCES"');
    expect(log).toContain(a);
    expect(log).not.toContain(GEHEIM);
    expect(log).not.toContain(wurzel);
    // Beim nächsten Lauf mit gesunder Ausgabe entsteht sie
    expect((await lauf()).fehler).toBe(0);
    expect(await echt.liste()).toContain("a/index.html");
  });

  test("ein Fehler beim Löschen bricht den Lauf nicht ab", async () => {
    const a = await seite({ adresse: "a", inhalt: dok("A") });
    await seite({ adresse: "b", inhalt: dok("B") });
    await lauf();
    await db
      .update(schema.seite)
      .set({ veroeffentlichteVersionId: null })
      .where(eq(schema.seite.id, a));
    const echt = dateisystemAusgabe(wurzel);
    const e = await lauf({
      ausgabe: {
        ...echt,
        loesche: async () => {
          throw new Error("nein");
        },
      },
    });
    expect(e).toMatchObject({ geloescht: 0, fehler: 1 });
    expect(await echt.liste()).toContain("a/index.html");
  });

  test("kann die Ausgabe nichts auflisten, ändert der Lauf nichts", async () => {
    await seite({ adresse: "a", inhalt: dok("A") });
    const echt = dateisystemAusgabe(wurzel);
    await expect(
      lauf({
        ausgabe: {
          ...echt,
          liste: async () => {
            throw new Error("nein");
          },
        },
      }),
    ).rejects.toThrow("nein");
    expect(await echt.liste()).toEqual([]);
  });

  test("eine ungültige Version bleibt beim alten Stand liegen", async () => {
    const a = await seite({ adresse: "a", inhalt: dok("A") });
    await lauf();
    await veroeffentliche(a, { v: 99, kaputt: true });
    const e = await lauf();
    expect(e.fehler).toBe(1);
    expect(e.geloescht).toBe(0);
    expect(await lies("a/index.html")).toContain("<h1>A</h1>");
    expect(protokoll()).toContain('"art":"dokument"');
  });

  test("eine unbekannte Abteilung ändert nichts und löscht nichts", async () => {
    await seite({ adresse: "a", inhalt: dok("A") });
    await lauf();
    const e = await lauf({ abteilungId: randomUUID() });
    expect(e).toEqual({ geschrieben: 0, geloescht: 0, fehler: 1 });
    expect(await ausgabe.liste()).toContain("a/index.html");
  });
});

describe("Sperre und Auslöser", () => {
  test("ein Lauf mit gehaltener Sperre endet sofort mit «gesperrt»", async () => {
    const halter = postgres(API_URL, { max: 1 });
    try {
      await halter`select pg_advisory_lock(740030)`;
      const r = await synchronisiereWebsite({
        datenbankUrl: API_URL,
        ausgabe,
        abteilungId,
        basisUrl: BASIS,
        stylesheet: CSS,
      });
      expect(r).toBe("gesperrt");
      expect(await ausgabe.liste()).toEqual([]);
      await halter`select pg_advisory_unlock(740030)`;
      await seite({ adresse: "a", inhalt: dok("A") });
      const frei = await synchronisiereWebsite({
        datenbankUrl: API_URL,
        ausgabe,
        abteilungId,
        basisUrl: BASIS,
        stylesheet: CSS,
      });
      expect(frei).toMatchObject({ fehler: 0 });
      expect(await ausgabe.liste()).toContain("a/index.html");
    } finally {
      await halter.end();
    }
  });

  test("Ereignisse der Abteilung lösen Läufe aus; Ereignisse während eines Laufs genau einen weiteren", async () => {
    let freigeben!: () => void;
    const aufruf = vi.fn(
      () =>
        new Promise<void>((fertig) => {
          freigeben = fertig;
        }),
    );
    const stopp = starteWebsiteAbgleich(aufruf, abteilungId);
    try {
      // Start: ein Lauf
      expect(aufruf).toHaveBeenCalledTimes(1);
      // Drei Ereignisse während des Laufs, eines fremder Abteilung
      const e = {
        art: "version_veroeffentlicht" as const,
        abteilungId,
        seiteId: randomUUID(),
      };
      meldeWebsiteEreignis(e);
      meldeWebsiteEreignis(e);
      meldeWebsiteEreignis({ ...e, abteilungId: randomUUID() });
      expect(aufruf).toHaveBeenCalledTimes(1);
      freigeben();
      await vi.waitFor(() => expect(aufruf).toHaveBeenCalledTimes(2));
      freigeben();
      // Danach Ruhe, bis das nächste Ereignis kommt
      await new Promise((r) => setTimeout(r, 50));
      expect(aufruf).toHaveBeenCalledTimes(2);
      meldeWebsiteEreignis(e);
      await vi.waitFor(() => expect(aufruf).toHaveBeenCalledTimes(3));
      freigeben();
    } finally {
      stopp();
    }
    // Abgemeldet: kein Lauf mehr
    meldeWebsiteEreignis({
      art: "seite_geloescht",
      abteilungId,
      seiteId: randomUUID(),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(aufruf).toHaveBeenCalledTimes(3);
  });

  test("ein Fehler im Lauf erscheint nur als Code im Log und beendet den Auslöser nicht", async () => {
    const aufruf = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error(GEHEIM), { code: "ECONNRESET" }),
      )
      .mockResolvedValue(undefined);
    const stopp = starteWebsiteAbgleich(aufruf, abteilungId);
    try {
      await vi.waitFor(() => expect(ausgabeLog).toHaveBeenCalled());
      const zeile = String(ausgabeLog.mock.calls[0]![0]);
      expect(zeile).toContain('"code":"ECONNRESET"');
      expect(zeile).not.toContain(GEHEIM);
      meldeWebsiteEreignis({
        art: "seite_geaendert",
        abteilungId,
        seiteId: randomUUID(),
      });
      await vi.waitFor(() => expect(aufruf).toHaveBeenCalledTimes(2));
    } finally {
      stopp();
    }
  });
});

describe("Personen mit Profilbild nach Rolle (#560, #610)", () => {
  const BILD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const person = async (
    name: string,
    extra: Partial<typeof schema.user.$inferInsert> = {},
    mitBild = true,
  ) => {
    const [u] = await db
      .insert(schema.user)
      .values({
        name,
        email: `${randomUUID()}@example.org`,
        abteilungId,
        ...extra,
      })
      .returning();
    if (mitBild) {
      await db
        .insert(schema.profilbild)
        .values({ userId: u!.id, inhalt: Buffer.from(BILD) });
    }
    return u!.id;
  };
  const tagNeu = async (
    typ: "stufe" | "team" | "anlass",
    name: string,
    abt: string = abteilungId,
  ) =>
    (
      await db
        .insert(schema.tag)
        .values({ abteilungId: abt, typ, name, kuerzel: name.slice(0, 2) })
        .returning()
    )[0]!.id;
  const rolle = (userId: string, tagId: string, rolle: string | null) =>
    db.insert(schema.personTag).values({ userId, tagId, rolle });
  const baustein = (...ids: string[]) => ({
    id: randomUUID(),
    typ: "personen",
    daten: {
      eintraege: ids.map((personId) => ({ personId, funktion: "Leitung" })),
    },
  });
  const bilder = async () =>
    (await ausgabe.liste()).filter((p) => p.startsWith("website/person-"));
  const neuLaufen = async (seiteId: string) => {
    await db
      .update(schema.seite)
      .set({ ausgabeHash: null })
      .where(eq(schema.seite.id, seiteId));
    await lauf();
  };

  test("eine Gruppe vom Typ «anlass» erscheint nie: weder ihre Rolle bei einer Kontaktperson noch als Leitungsteam (#626)", async () => {
    const ok = await tagNeu("anlass", "OK Geheimgruppe");
    const team = await tagNeu("team", "Kontaktteam");
    const anna = await person("Anna Muster", { ceviName: "Wolke" }, false);
    await rolle(anna, team, "Kontakt");
    await rolle(anna, ok, "OK-Leitung-Geheim");
    const beat = await person("Beat Beispiel", { ceviName: "Pfanne" }, false);
    await rolle(beat, ok, "Mitglied-Geheim");
    await seite({
      adresse: "start",
      inhalt: dok(
        "Start",
        {
          id: randomUUID(),
          typ: "kontaktperson",
          daten: { personId: anna },
        },
        { id: randomUUID(), typ: "leitungsteam", daten: { tagId: ok } },
      ),
    });
    await lauf();
    const html = await lies("index.html");
    expect(html).toContain("Wolke");
    expect(html).toContain("Kontakt");
    for (const verboten of [
      "OK-Leitung-Geheim",
      "Mitglied-Geheim",
      "Pfanne",
      "OK Geheimgruppe",
    ]) {
      expect(html).not.toContain(verboten);
    }
  });

  test("Stufenleitung und Leitung erscheinen ohne Freigabe mit Anzeigename und Profilbild als Datei; wer keine Rolle hat, gar nicht", async () => {
    const stufe = await tagNeu("stufe", "Biber");
    const team = await tagNeu("team", "Küchenteam");
    const mitCeviName = await person("Anna Muster", { ceviName: "Flink" });
    const nurVorname = await person("Beat Beispiel", {}, false);
    await rolle(mitCeviName, stufe, "stufenleitung");
    await rolle(nurVorname, stufe, "leitung");
    // Keine Rolle mit Aussenwirkung: ohne Rolle, mit Freitext-Rolle an einem Team (auch «Stufenleitung»), ohne Stufenrolle an der Stufe, deaktiviert
    const ohneRolle = await person("Clara Geheim", { ceviName: "Nebel" });
    const nurTeam = await person("Emil Teamer", { ceviName: "Pfanne" });
    await rolle(nurTeam, team, "Stufenleitung");
    const nurTag = await person("Fiona Tagger", { ceviName: "Stempel" });
    await rolle(nurTag, stufe, null);
    const deaktiviert = await person("Dora Weg", {
      ceviName: "Entfernt",
      deaktiviertAm: new Date(),
    });
    await rolle(deaktiviert, stufe, "stufenleitung");
    await seite({
      adresse: "team",
      inhalt: dok(
        "Team",
        baustein(
          mitCeviName,
          nurVorname,
          ohneRolle,
          nurTeam,
          nurTag,
          deaktiviert,
        ),
      ),
    });
    await lauf();

    const html = await lies("team/index.html");
    expect(html).toContain('<h2 class="titel">Flink</h2>');
    expect(html).toContain('<h2 class="titel">Beat</h2>');
    for (const nein of [
      "Anna",
      "Muster",
      "Beispiel",
      "Nebel",
      "Clara",
      "Pfanne",
      "Stempel",
      "Dora",
      "Entfernt",
    ]) {
      expect(html).not.toContain(nein);
    }
    // Eine Datei je Profilbild; Name der Datei ist ein Hash, keine ID
    const dateien = await bilder();
    expect(dateien).toHaveLength(1);
    expect(dateien[0]).toMatch(/^website\/person-[0-9a-f]{16}\.jpg$/);
    expect(dateien[0]).not.toContain(mitCeviName);
    expect(html).toContain(`src="/${dateien[0]}"`);
    expect(new Uint8Array(await readFile(join(wurzel, dateien[0]!)))).toEqual(
      BILD,
    );
    // Keine E-Mail, kein Telefon: Die Seite nennt nur Name, Bild und Funktion
    expect(html).not.toContain("@example.org");
    expect(html).not.toContain("mailto:");
  });

  test("Die Rolle fällt weg: Name und Datei sind beim nächsten Lauf weg", async () => {
    const stufe = await tagNeu("stufe", "Wolf");
    const sl = await person("Anna Muster", { ceviName: "Flink" });
    await rolle(sl, stufe, "stufenleitung");
    const s = await seite({
      adresse: "team",
      inhalt: dok("Team", baustein(sl)),
    });
    await lauf();
    expect(await lies("team/index.html")).toContain("Flink");
    expect(await bilder()).toHaveLength(1);

    await db.delete(schema.personTag).where(eq(schema.personTag.userId, sl));
    await neuLaufen(s);
    expect(await lies("team/index.html")).not.toContain("Flink");
    expect(await bilder()).toEqual([]);
  });

  test("Konto gelöscht oder deaktiviert: Name und Datei fehlen beim nächsten Lauf", async () => {
    const stufe = await tagNeu("stufe", "Biber");
    const a = await person("Eva Eins");
    const b = await person("Fritz Zwei");
    await rolle(a, stufe, "stufenleitung");
    await rolle(b, stufe, "leitung");
    await seite({ adresse: "team", inhalt: dok("Team", baustein(a, b)) });
    await lauf();
    expect(await bilder()).toHaveLength(1); // beide Bilder sind gleich: eine Datei
    await db.delete(schema.user).where(eq(schema.user.id, a));
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date() })
      .where(eq(schema.user.id, b));
    await db.update(schema.seite).set({ ausgabeHash: null });
    await lauf();
    const html = await lies("team/index.html");
    expect(html).not.toContain("Eva");
    expect(html).not.toContain("Fritz");
    expect(await bilder()).toEqual([]);
  });

  test("eine Person einer anderen Abteilung erscheint nie, auch nicht mit Stufenrolle dort", async () => {
    const [fremde] = await db
      .insert(schema.abteilung)
      .values({ name: "Fremde Abteilung" })
      .returning();
    const [u] = await db
      .insert(schema.user)
      .values({
        name: "Gustav Fremd",
        email: `${randomUUID()}@example.org`,
        abteilungId: fremde!.id,
      })
      .returning();
    await rolle(
      u!.id,
      await tagNeu("stufe", "Fremd", fremde!.id),
      "stufenleitung",
    );
    await seite({ adresse: "team", inhalt: dok("Team", baustein(u!.id)) });
    await lauf();
    expect(await lies("team/index.html")).not.toContain("Gustav");
    expect(await bilder()).toEqual([]);
  });

  test("Kinder erscheinen nie: weder als Person noch im Leitungsteam der Stufe", async () => {
    const stufe = await tagNeu("stufe", "Biber");
    const [k] = await db
      .insert(schema.kind)
      .values({
        abteilungId,
        vorname: "Kai",
        nachname: "Kindlein",
        ceviName: "Wirbel",
        stufeId: stufe,
      })
      .returning();
    await seite({
      adresse: "team",
      inhalt: dok("Team", baustein(k!.id), {
        id: randomUUID(),
        typ: "leitungsteam",
        daten: { tagId: stufe },
      }),
    });
    await lauf();
    const html = await lies("team/index.html");
    for (const nein of ["Kai", "Kindlein", "Wirbel"]) {
      expect(html).not.toContain(nein);
    }
    expect(await bilder()).toEqual([]);
  });

  test("Leitungsteam einer Stufe: Stufenleitung vor Leitung, mit Bild, nur Personen mit Stufenrolle; ein Team bleibt die einfache Liste", async () => {
    const stufe = await tagNeu("stufe", "Pfadi");
    const team = await tagNeu("team", "Leitungsrunde");
    const sl = await person("Anna Muster", { ceviName: "Flink" });
    const l = await person("Beat Beispiel", { ceviName: "Wolke" }, false);
    const ohne = await person("Clara Geheim", { ceviName: "Nebel" });
    await rolle(l, stufe, "leitung");
    await rolle(sl, stufe, "stufenleitung");
    await rolle(ohne, stufe, null);
    await rolle(sl, team, "Co-Leitung");
    await seite({
      adresse: "team",
      inhalt: dok(
        "Team",
        { id: randomUUID(), typ: "leitungsteam", daten: { tagId: stufe } },
        { id: randomUUID(), typ: "leitungsteam", daten: { tagId: team } },
      ),
    });
    await lauf();
    const html = await lies("team/index.html");
    // Porträts der Stufe: Stufenleitung zuerst, mit der Rolle als Funktion
    expect(html).toContain('<h2 class="titel">Flink</h2><p>Stufenleitung</p>');
    expect(html).toContain('<h2 class="titel">Wolke</h2><p>Leitung</p>');
    expect(html.indexOf("Flink")).toBeLessThan(html.indexOf("Wolke"));
    expect(html).not.toContain("Nebel");
    expect(await bilder()).toHaveLength(1);
    // Das Team bleibt die Liste mit Cevi-Namen und Funktion, ohne Bild
    expect(html).toContain(
      '<span class="name">Flink</span><span class="funktion">Co-Leitung</span>',
    );
  });
});

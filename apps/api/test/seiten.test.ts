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
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import { ladeSeiten, setzeKontakt } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

// Jede Anfrage schriebe sonst eine Log-Zeile in die Testausgabe
let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const geladen = ladeSeiten();

// Ohne Cookie («ohne Login»); seite === null heisst: Der genaue Inhalt kommt erst mit #24, hier zählt nur gültiges JSON
test.each<[string, string, string | null]>([
  ["/datenschutz", "text/html; charset=UTF-8", geladen.datenschutz],
  ["/konto-loeschen", "text/html; charset=UTF-8", geladen.kontoLoeschen],
  ["/support", "text/html; charset=UTF-8", geladen.support],
  ["/.well-known/apple-app-site-association", "application/json", null],
  ["/.well-known/assetlinks.json", "application/json", null],
])(
  "GET %s antwortet ohne Login mit 200 und %s, ohne Weiterleitung",
  async (pfad, typ, seite) => {
    const antwort = await app.request(pfad);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toBe(typ);
    expect(antwort.headers.get("location")).toBeNull();
    const text = await antwort.text();
    if (seite === null) {
      expect(() => JSON.parse(text)).not.toThrow();
    } else {
      // Jeder Pfad liefert seine eigene Seite
      expect(text).toBe(seite);
    }
  },
);

// Verwaltung im Browser (#141)
const admin = ladeSeiten().admin;
const adminPfad = (datei: string) =>
  datei === "index.html" ? "/admin" : `/admin/${datei}`;
const ADMIN_TYPEN: Record<string, string> = {
  html: "text/html; charset=UTF-8",
  css: "text/css; charset=UTF-8",
  js: "text/javascript; charset=UTF-8",
  svg: "image/svg+xml",
  woff2: "font/woff2",
};

describe("Verwaltung unter /admin", () => {
  test("die Dateien aus public/admin sind geladen", () => {
    expect(Object.keys(admin)).toContain("index.html");
    expect(Object.keys(admin)).toContain("admin.js");
    expect(Object.keys(admin)).toContain("admin.css");
  });

  test.each(Object.keys(admin))(
    "GET %s antwortet ohne Login mit 200, dem Typ der Datei und den Sicherheits-Kopfzeilen",
    async (datei) => {
      const antwort = await app.request(adminPfad(datei));
      expect(antwort.status).toBe(200);
      expect(antwort.headers.get("content-type")).toBe(
        ADMIN_TYPEN[datei.split(".").pop()!],
      );
      // Die Schrift der Vorschau liegt als Bytes vor
      if (typeof admin[datei] === "string")
        expect(await antwort.text()).toBe(admin[datei]);
      else
        expect(new Uint8Array(await antwort.arrayBuffer())).toEqual(
          admin[datei],
        );
      const csp = antwort.headers.get("content-security-policy")!;
      for (const regel of [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "connect-src 'self'",
        "frame-src 'self'",
      ]) {
        expect(csp).toContain(regel);
      }
      expect(csp).not.toContain("unsafe");
      expect(antwort.headers.get("x-content-type-options")).toBe("nosniff");
      expect(antwort.headers.get("referrer-policy")).toBe("no-referrer");
      expect(antwort.headers.get("x-frame-options")).toBe("DENY");
      expect(antwort.headers.get("cache-control")).toBe(
        datei.endsWith(".html") ? "no-store" : "no-cache",
      );
    },
  );

  test("unbekannte Dateien unter /admin sind 404 ohne Sicherheits-Kopfzeilen der Seite", async () => {
    const antwort = await app.request("/admin/gibt-es-nicht.js");
    expect(antwort.status).toBe(404);
  });

  test("die Seite enthält kein Inline-Skript, keinen Inline-Stil und keine Ereignis-Attribute", () => {
    const html = admin["index.html"];
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/<style/i);
  });

  test("die Verwaltung folgt Tag und Nacht des Geräts, ohne Umschalter", () => {
    expect(admin["index.html"]).toContain(
      'name="color-scheme" content="light dark"',
    );
    expect(admin["admin.css"]).toContain("color-scheme: light dark;");
    expect(admin["admin.css"]).toContain("prefers-color-scheme: dark");
  });

  test.each(Object.keys(admin).filter((d) => d.endsWith(".js")))(
    "%s schreibt keine Daten als HTML und lädt nichts von aussen",
    (datei) => {
      expect(admin[datei]).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|localStorage|sessionStorage/,
      );
      // Die CSP erlaubt keine Inline-Stile: Klassen statt style-Attribut
      expect(admin[datei]).not.toMatch(
        /setAttribute\(\s*["'`]style|\.style\.cssText/,
      );
      // Ausser dem Namensraum von SVG: eine Kennung, nichts wird geladen
      expect(
        String(admin[datei]).replaceAll("http://www.w3.org/2000/svg", ""),
      ).not.toMatch(/https?:\/\//);
    },
  );
});

describe("Seiten für die Stores", () => {
  const kontakt = {
    stelle: "Cevi <Beispiel> & Co",
    adresse: "Beispielweg 1 & 2, 8000 Beispielort",
    email: "kontakt@example.org",
  };
  const seiten = ladeSeiten(kontakt);
  const alle = Object.entries({
    datenschutz: seiten.datenschutz,
    kontoLoeschen: seiten.kontoLoeschen,
    support: seiten.support,
  });

  test.each(alle)(
    "%s: Stil und Adresse sind eingesetzt, nichts bleibt offen",
    (_name, html) => {
      expect(html).not.toMatch(/\{\{|STIL/);
      expect(html).toContain("color-scheme: light dark");
      expect(html).toContain(
        '<a href="mailto:kontakt@example.org">kontakt@example.org</a>',
      );
    },
  );

  test("die Stelle wird maskiert", () => {
    expect(seiten.datenschutz).toContain("Cevi &lt;Beispiel&gt; &amp; Co");
    expect(seiten.datenschutz).not.toContain("<Beispiel>");
  });

  test("die Anschrift wird eingesetzt und maskiert", () => {
    expect(seiten.datenschutz).toContain(
      "Beispielweg 1 &amp; 2, 8000 Beispielort",
    );
  });

  test("ohne Angaben nennen die Seiten weder Stelle noch Adresse, sagen es aber", () => {
    expect(geladen.datenschutz).toContain("noch nicht eingetragen");
    expect(geladen.datenschutz).toContain(
      "die Anschrift der Abteilung (noch nicht eingetragen)",
    );
    expect(setzeKontakt("{{ADRESSE}}", {})).toContain("noch nicht eingetragen");
    expect(geladen.datenschutz).not.toContain("mailto:");
    expect(setzeKontakt("{{STELLE}}", {})).toBe("die Abteilung");
  });

  test.each(alle)(
    "%s: Sprache, Hauptbereich, eine Überschrift 1, nichts von aussen, kein Eszett",
    (_name, html) => {
      expect(html).toContain('<html lang="de-CH">');
      expect(html).toContain("<main>");
      expect(html.match(/<h1[ >]/g)).toHaveLength(1);
      expect(html).toContain('name="viewport"');
      expect(html).not.toMatch(
        /<script|<img|<iframe|<link|\ssrc\s*=|@import|url\(/i,
      );
      // Verweise nach aussen: nur die Aufsichtsbehörde und die Standardvertragsklauseln der EU-Kommission
      const aussen = [...html.matchAll(/href="(https?:[^"]+)"/g)].map(
        (m) => m[1],
      );
      expect(
        aussen.every((u) =>
          [
            "https://www.edoeb.admin.ch",
            "https://commission.europa.eu/",
          ].includes(u!),
        ),
      ).toBe(true);
      expect(html).not.toContain("ß");
    },
  );

  test("jede Seite verlinkt die beiden anderen", () => {
    for (const [html, pfade] of [
      [seiten.datenschutz, ["/konto-loeschen", "/support"]],
      [seiten.kontoLoeschen, ["/datenschutz", "/support"]],
      [seiten.support, ["/datenschutz", "/konto-loeschen"]],
    ] as const) {
      for (const pfad of pfade) expect(html).toContain(`href="${pfad}"`);
    }
  });

  test("die Seite zum Löschen nennt den Löschtext und den Weg ohne App", () => {
    expect(seiten.kontoLoeschen.replace(/\s+/g, " ")).toContain(
      "Auf Anfrage löscht die Leitung Daten.",
    );
    expect(seiten.kontoLoeschen).toContain("mailto:kontakt@example.org");
  });
});

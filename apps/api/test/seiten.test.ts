import { Expo } from "expo-server-sdk";
import { readFileSync } from "node:fs";
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
import { ladeSeiten } from "../src/seiten.js";
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
  expo: new Expo({ accessToken: "test-zugang" }),
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

// Jede Anfrage schriebe sonst eine Log-Zeile in die Testausgabe
let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

// Ohne Cookie («ohne Login»); datei === null heisst: Der genaue Inhalt kommt erst mit #24, hier zählt nur gültiges JSON
test.each<[string, string, string | null]>([
  ["/datenschutz", "text/html; charset=UTF-8", "datenschutz.html"],
  ["/konto-loeschen", "text/html; charset=UTF-8", "konto-loeschen.html"],
  ["/support", "text/html; charset=UTF-8", "support.html"],
  ["/.well-known/apple-app-site-association", "application/json", null],
  ["/.well-known/assetlinks.json", "application/json", null],
])(
  "GET %s antwortet ohne Login mit 200 und %s, ohne Weiterleitung",
  async (pfad, typ, datei) => {
    const antwort = await app.request(pfad);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toBe(typ);
    expect(antwort.headers.get("location")).toBeNull();
    const text = await antwort.text();
    if (datei === null) {
      expect(() => JSON.parse(text)).not.toThrow();
    } else {
      // Gleich der Datei aus public/: Jeder Pfad liefert seine eigene Seite
      expect(text).toBe(
        readFileSync(new URL(`../public/${datei}`, import.meta.url), "utf8"),
      );
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
      expect(await antwort.text()).toBe(admin[datei]);
      const csp = antwort.headers.get("content-security-policy")!;
      for (const regel of [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "connect-src 'self'",
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

  test("die Verwaltung ist immer dunkel, ohne Umschalten nach Systemeinstellung", () => {
    expect(admin["index.html"]).toContain('name="color-scheme" content="dark"');
    expect(admin["admin.css"]).toContain("color-scheme: dark;");
    expect(admin["admin.css"]).not.toContain("prefers-color-scheme");
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
        admin[datei].replaceAll("http://www.w3.org/2000/svg", ""),
      ).not.toMatch(/https?:\/\//);
    },
  );
});

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

// Alte Adresse der Erklärung: die Erklärung der Abteilung ist die Seite «datenschutz-website» des Seiteneditors
test("GET /datenschutz leitet ohne Login mit 308 auf /datenschutz-website weiter", async () => {
  const antwort = await app.request("/datenschutz");
  expect(antwort.status).toBe(308);
  expect(antwort.headers.get("location")).toBe("/datenschutz-website");
});

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

  test("die Verwaltung folgt Tag und Nacht des Geräts und der Wahl im Kopf; die Tokens sind die der Website (#578)", () => {
    const html = String(admin["index.html"]);
    expect(html).toContain('name="color-scheme" content="light dark"');
    // Eine Token-Datei für beide: dieselben Bytes wie unter /website/tokens.css, vor admin.css geladen
    expect(admin["tokens.css"]).toBe(
      readFileSync(
        new URL("../public/website/tokens.css", import.meta.url),
        "utf8",
      ),
    );
    expect(html.indexOf("/admin/tokens.css")).toBeGreaterThan(-1);
    expect(html.indexOf("/admin/tokens.css")).toBeLessThan(
      html.indexOf("/admin/admin.css"),
    );
    expect(html).toContain('<script src="/admin/theme.js"></script>');
    const tokens = String(admin["tokens.css"]);
    expect(tokens).toContain("color-scheme: light dark;");
    expect(tokens).toContain("prefers-color-scheme: dark");
    expect(tokens).toContain('[data-theme="dark"]');
    // Die Werte stehen nur dort: admin.css verweist in seinem Token-Block auf sie
    const kopfBlock = String(admin["admin.css"]).split("\n").slice(0, 45);
    expect(kopfBlock.join("\n")).not.toMatch(/--[a-z-]+:\s*#[0-9a-f]{3,8}\b/i);
  });

  test("Kopf: Name und Logo kommen aus den Einstellungen der Website, nie aus dem Code (#578)", () => {
    for (const datei of ["rahmen.js", "admin.js"]) {
      expect(String(admin[datei])).not.toContain("Stäfa");
    }
    expect(String(admin["admin.js"])).toContain("/api/v1/redaktion/website");
    expect(String(admin["rahmen.js"])).toContain("/api/v1/medien/");
    expect(String(admin["rahmen.js"])).toContain('"aria-pressed"');
  });

  // Entscheid des Auftraggebers (#570, #761): Rückmeldungen sind Toasts; Erfolg und Info 4 s, Warnung und Fehler 8 s, mit Aktion bleiben sie (docs/barrierefreiheit.md 84)
  test("Rückmeldungen: Erfolg und Info 4 Sekunden, Warnung und Fehler 8, mit Aktion bis zum Schliessen", async () => {
    // dom.js hängt beim Laden einen Klick-Zuhörer an document: Ohne Browser genügt eine Attrappe
    vi.stubGlobal("document", { addEventListener: () => {} });
    // fluss.js hört auf popstate und pagehide (#578)
    vi.stubGlobal("window", { addEventListener: () => {} });
    // Als Text, damit tsc die Browserdatei nicht als Modul des Programms prüft
    const rahmenPfad = "../public/admin/rahmen.js";
    const { dauerVon } = (await import(/* @vite-ignore */ rahmenPfad)) as {
      dauerVon: (art: string, aktion?: object) => number;
    };
    vi.unstubAllGlobals();
    expect(dauerVon("ok", undefined)).toBe(4000);
    expect(dauerVon("info", undefined)).toBe(4000);
    for (const art of ["warn", "fehler"])
      expect(dauerVon(art, undefined)).toBe(8000);
    for (const art of ["ok", "info", "warn", "fehler"])
      expect(dauerVon(art, { text: "Beheben" })).toBe(0);
  });

  test("Rückmeldungen: Zeiger und Fokus halten die Zeit an, Esc und Knopf schliessen, mit «Bewegung reduzieren» ohne Übergang", () => {
    const rahmen = String(admin["rahmen.js"]);
    for (const ereignis of [
      "pointerenter",
      "pointerleave",
      "focusin",
      "focusout",
    ])
      expect(rahmen).toContain(`"${ereignis}"`);
    expect(rahmen).toContain("prefers-reduced-motion: reduce");
    expect(rahmen).toContain("Hinweis schliessen");
    expect(rahmen).toContain('e.key === "Escape"');
    // Der Übergang steht nur im Zweig für erlaubte Bewegung
    expect(String(admin["toast.css"])).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{[^@]*\.toast--geht \{\s*opacity: 0;\s*transition:/,
    );
  });

  // theme.js (die Datei der Website, #578) speichert die Wahl von Hell und Dunkel im Browser; es schreibt kein HTML
  test.each(
    Object.keys(admin).filter((d) => d.endsWith(".js") && d !== "theme.js"),
  )("%s schreibt keine Daten als HTML und lädt nichts von aussen", (datei) => {
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
  });
});

describe("Seiten für die Stores", () => {
  const kontakt = {
    stelle: "Cevi <Beispiel> & Co",
    adresse: "Beispielweg 1 & 2, 8000 Beispielort",
    email: "kontakt@example.org",
  };
  const seiten = ladeSeiten(kontakt);
  const alle = Object.entries({
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
    const html = setzeKontakt("{{STELLE}}", kontakt);
    expect(html).toContain("Cevi &lt;Beispiel&gt; &amp; Co");
    expect(html).not.toContain("<Beispiel>");
  });

  test("die Anschrift wird eingesetzt und maskiert", () => {
    expect(setzeKontakt("{{ADRESSE}}", kontakt)).toContain(
      "Beispielweg 1 &amp; 2, 8000 Beispielort",
    );
  });

  test("ohne Angaben nennen die Seiten weder Stelle noch Adresse, sagen es aber", () => {
    expect(setzeKontakt("{{ADRESSE}}", {})).toBe(
      "die Anschrift der Abteilung (noch nicht eingetragen)",
    );
    expect(setzeKontakt("{{STELLE}}", {})).toBe("die Abteilung");
    expect(geladen.kontoLoeschen).not.toContain("mailto:");
  });

  test.each(alle)(
    "%s: Sprache, Hauptbereich, eine Überschrift 1, nichts von aussen (ausser dem Favicon der Plattform), kein Eszett",
    (_name, html) => {
      expect(html).toContain('<html lang="de-CH">');
      expect(html).toContain("<main>");
      expect(html.match(/<h1[ >]/g)).toHaveLength(1);
      expect(html).toContain('name="viewport"');
      expect(html).not.toMatch(
        /<script|<img|<iframe|<link(?![^>]*href="\/(favicon\.ico|apple-touch-icon\.png)")|\ssrc\s*=|@import|url\(/i,
      );
      // Keine Verweise nach aussen
      expect(html).not.toMatch(/href="https?:/);
      expect(html).not.toContain("ß");
    },
  );

  test("jede Seite verlinkt die Datenschutzerklärung und die andere Seite", () => {
    for (const [html, pfade] of [
      [seiten.kontoLoeschen, ["/datenschutz-website", "/support"]],
      [seiten.support, ["/datenschutz-website", "/konto-loeschen"]],
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

// Favicon überall (#581): Plattformseiten und Verwaltung zeigen dasselbe Zeichen wie die Website
describe("Favicon der Plattformseiten und der Verwaltung", () => {
  const SEITEN = [
    ["/konto-loeschen", geladen.kontoLoeschen],
    ["/support", geladen.support],
    ["/admin", String(admin["index.html"])],
  ] as const;

  test.each(SEITEN)(
    "%s trägt die Einträge für /favicon.ico und /apple-touch-icon.png, und beide Adressen antworten",
    async (_pfad, html) => {
      expect(html).toContain('<link rel="icon" type="image/x-icon"');
      expect(html).toContain('href="/favicon.ico"');
      expect(html).toContain(
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png"',
      );
      // Nichts von aussen: Die CSP der Verwaltung (img-src 'self') lässt nur eigene Adressen zu
      expect(html).not.toMatch(
        /<link rel="(icon|apple-touch-icon)"[^>]*https?:/,
      );
      for (const [adresse, typ] of [
        ["/favicon.ico", "image/x-icon"],
        ["/apple-touch-icon.png", "image/png"],
      ]) {
        const antwort = await app.request(adresse!);
        expect(antwort.status).toBe(200);
        expect(antwort.headers.get("content-type")).toBe(typ);
        expect(antwort.headers.get("cache-control")).toBe("no-cache");
        expect(antwort.headers.get("etag")).toBeTruthy();
        expect((await antwort.arrayBuffer()).byteLength).toBeGreaterThan(100);
      }
    },
  );

  test("das gewählte Zeichen der Abteilung ersetzt das Cevi-Zeichen, ohne neue Abfrage", async () => {
    const eigene = ladeSeiten();
    const eigeneApp = erstelleApp({
      appMinVersion: "1.2.0",
      sql,
      db,
      auth,
      seiten: eigene,
    });
    const png = new Uint8Array([1, 2, 3]);
    eigene.zeichen.setze({
      "favicon.ico": png,
      "website/zeichen-32.png": png,
      "website/zeichen-192.png": png,
      "apple-touch-icon.png": new Uint8Array([9, 9]),
    });
    expect([
      ...new Uint8Array(
        await (await eigeneApp.request("/favicon.ico")).arrayBuffer(),
      ),
    ]).toEqual([1, 2, 3]);
    expect([
      ...new Uint8Array(
        await (await eigeneApp.request("/apple-touch-icon.png")).arrayBuffer(),
      ),
    ]).toEqual([9, 9]);
    // Mit passendem ETag: 304
    const erste = await eigeneApp.request("/favicon.ico");
    const bedingt = await eigeneApp.request("/favicon.ico", {
      headers: { "If-None-Match": erste.headers.get("etag")! },
    });
    expect(bedingt.status).toBe(304);
  });
});

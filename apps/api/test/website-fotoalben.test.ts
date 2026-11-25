import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { baueKnoten } from "../public/website/knoten.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { sicheresZiel } from "../public/website/weiter.js";
import {
  OFFEN_BIS_ALBEN,
  SCHRITT_BILDER,
  VIELE_ALBEN,
  bildBreiten,
  bildName,
  filtereAlben,
  gruppiereNachJahr,
  mengeBis,
  naechsteMenge,
  standardOffen,
  trefferText,
  verhaeltnisKlasse,
  // @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
} from "../public/website/fotos-logik.js";
import { pruefeDokument } from "../src/website/dokument.js";
import {
  keineDaten,
  rendereHuelle,
  rendereSeite,
  type Kontext,
} from "../src/website/rendern.js";
import { rendereFotoalben } from "../src/website/fotoalben.js";

// Baustein «fotoalben» (#690): Die Seite ist statisch und für alle gleich; Alben und Bilder kommen erst nach der Anmeldung vom Server.
const lies = (pfad: string) =>
  readFileSync(new URL(`../public/website/${pfad}`, import.meta.url), "utf8");
const kontext: Kontext = {
  abteilung: "Cevi Test",
  basisUrl: "https://www.example.org",
  navigation: [],
  daten: keineDaten(),
};
const seite = (...bausteine: unknown[]) => {
  const p = pruefeDokument({ v: 1, titel: "Fotos", bausteine });
  if (!p.ok) throw new Error(JSON.stringify(p.fehler));
  return rendereSeite(
    { id: randomUUID(), pfad: "/fotos", dokument: p.dokument },
    kontext,
  );
};
const foto = (extra: object = {}) => ({
  id: randomUUID(),
  typ: "fotoalben",
  daten: {},
  ...extra,
});

describe("Baustein", () => {
  test("hat keine eigenen Daten: ein Feld darin ist ungültig", () => {
    expect(pruefeDokument({ v: 1, titel: "T", bausteine: [foto()] }).ok).toBe(
      true,
    );
    expect(
      pruefeDokument({
        v: 1,
        titel: "T",
        bausteine: [foto({ daten: { x: 1 } })],
      }).ok,
    ).toBe(false);
  });

  test("die Seite enthält nur einen leeren Behälter und den Hinweis ohne Skript, nie Alben oder Bilder", () => {
    const html = seite(foto());
    expect(html).toContain('<div class="fotos">');
    expect(html).toContain("Zum Anzeigen braucht diese Seite JavaScript.");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("flickr");
    expect(html).not.toContain("staticflickr");
    expect(html).not.toContain("/api/v1/fotos");
  });

  test("lädt Skript (als Modul), Stil und Grossansicht, nur wenn die Seite ihn hat", () => {
    const mit = seite(foto());
    expect(mit).toContain(
      '<script type="module" src="/website/fotos.js"></script>',
    );
    expect(mit).toContain('href="/website/fotos.css"');
    expect(mit).toContain('src="/website/lichtkasten.js" defer');
    expect(mit).toContain('href="/website/lichtkasten.css"');
    // Abrufe nur an die eigene Herkunft: keine fremde Adresse in der Richtlinie
    const csp = mit.replaceAll("&#39;", "'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("img-src 'self'");
    expect(csp).not.toMatch(/Content-Security-Policy"[^>]*https?:\/\//);
    const ohne = seite({
      id: randomUUID(),
      typ: "trenner",
      daten: { art: "linie" },
    });
    expect(ohne).not.toContain("fotos.js");
    expect(ohne).not.toContain("fotos.css");
  });

  test("ein geschützter Baustein hat Platzhalter, Skript und Stil stehen für das Nachladen bereit; die Hülle lädt beides immer", () => {
    const html = seite(foto({ sichtbarkeit: { art: "angemeldet" } }));
    expect(html).toContain("Nur angemeldet sichtbar");
    expect(html).not.toContain('<div class="fotos">');
    expect(html).toContain('src="/website/fotos.js"');
    const huelle = rendereHuelle("/fotos", kontext);
    expect(huelle).toContain('src="/website/fotos.js"');
    expect(huelle).toContain('href="/website/fotos.css"');
  });

  test("beim Nachladen bleibt der Behälter mit seiner Klasse (knoten.js), der Hinweis ohne Skript fällt weg", () => {
    const knoten = rendereFotoalben();
    const dom: string[] = [];
    const doc = {
      createTextNode: (t: string) => ({ text: t }),
      createElement: (tag: string) => {
        dom.push(tag);
        return {
          tag,
          setAttribute() {},
          append() {},
        };
      },
    };
    expect(baueKnoten(doc as unknown as Document, knoten)).not.toBeNull();
    expect(dom).toContain("div");
    expect(dom).not.toContain("noscript");
  });
});

describe("Rückweg nach der Anmeldung (weiter.js)", () => {
  test("erlaubt «?album=» mit Ziffern, sonst keine Anfrage", () => {
    expect(sicheresZiel("/fotos?album=72157000000000001")).toBe(
      "/fotos?album=72157000000000001",
    );
    for (const boese of [
      "/fotos?album=abc",
      "/fotos?album=",
      "/fotos?album=1&x=2",
      "/fotos?album=1%2F",
      "/fotos?x=1",
      `/fotos?album=${"1".repeat(21)}`,
    ]) {
      expect(sicheresZiel(boese), boese).toBe("/");
    }
  });
});

describe("Skript und Stil der Website", () => {
  const js = lies("fotos.js");
  const css = lies("fotos.css");

  test("nichts Gefährliches: kein innerHTML, kein localStorage, kein eval, kein Inline", () => {
    for (const verboten of [
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "document.write",
      "localStorage",
      "sessionStorage",
      "eval(",
      "new Function",
      'setAttribute("style"',
      ".style.",
      "alert(",
      "confirm(",
    ]) {
      expect(js, verboten).not.toContain(verboten);
    }
    expect(css).not.toContain("@import");
    expect(css).not.toMatch(/url\(\s*["']?https?:/);
  });

  test("ruft nur die eigene API und kennt Flickr nur als Link zu flickr.com", () => {
    const urls = [...js.matchAll(/["'`](https?:\/\/[^"'`\s]+)/g)].map(
      (m) => m[1],
    );
    expect(urls).toEqual([]);
    expect(js).toContain('const API = "/api/v1/fotos"');
    // Der Link zu Flickr wird geprüft, bevor er gesetzt wird
    expect(js).toContain("flickr\\.com");
    expect(js).not.toContain("staticflickr");
    // Zustände: angemeldet, kein Zugriff, Zeitlimit und Fehler
    for (const text of [
      "Nur angemeldet sichtbar",
      "Hier gibt es noch keine Fotos.",
      "Nochmals versuchen",
      "Das dauert länger als sonst.",
      "Album auf Flickr öffnen",
    ]) {
      expect(js, text).toContain(text);
    }
  });

  test("Karten und Raster: Bilder sind lazy, ohne Quelle bis zum Zeigen, ohne Stilattribut; Grossansicht kennt das Raster", () => {
    expect(js).toContain('bild.loading = "lazy"');
    expect(js).toContain("srcset");
    expect(js).toContain("sizes");
    expect(js).toContain('"progress"');
    expect(js).toContain("Weitere");
    expect(js).toContain("aria-keyshortcuts");
    // Die Anzahl wird nicht bei jedem Tastendruck angesagt
    expect(js).toContain("ZAHL_NACH_MS");
    const lk = lies("lichtkasten.js");
    expect(lk).toContain(".fotos-raster");
    expect(lk).toContain("Grossansicht");
  });

  test("Bewegung nur unter «nicht reduzieren»; Ziele und Ring wie die übrige Website", () => {
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(css).not.toMatch(/transition:[^;]*all/);
    expect(css).toContain("min-height: 2.75rem");
    expect(css).toContain("outline: 3px solid var(--focus)");
  });
});

// Die reinen Teile von fotos.js (#796)
describe("Gruppen, Suche, Schritte und Namen (fotos-logik.js)", () => {
  const album = (id: string, titel: string, datum: string | null) => ({
    id,
    titel,
    datum,
  });

  test("Gruppen: jüngstes Jahr zuerst, ohne Datum zuletzt, Reihenfolge der Abteilung bleibt", () => {
    const g = gruppiereNachJahr([
      album("1", "A", "2024-05-01"),
      album("2", "B", null),
      album("3", "C", "2026-01-02"),
      album("4", "D", "2024-01-01"),
      album("5", "E", "2025-12-31"),
    ]);
    expect(g.map((x: { jahr: string | null }) => x.jahr)).toEqual([
      "2026",
      "2025",
      "2024",
      null,
    ]);
    expect(g[2].alben.map((a: { id: string }) => a.id)).toEqual(["1", "4"]);
    expect(gruppiereNachJahr([])).toEqual([]);
    // Ein ungültiges Datum zählt als «ohne Datum»
    expect(gruppiereNachJahr([album("9", "X", "gestern")])[0].jahr).toBeNull();
  });

  test("beim Öffnen ist die jüngste Gruppe immer offen, die nächsten nur, solange nicht zu viele Alben stehen", () => {
    const viele = (n: number, jahr: string) =>
      Array.from({ length: n }, (_, i) =>
        album(`${jahr}-${i}`, "T", `${jahr}-01-01`),
      );
    const g = gruppiereNachJahr([
      ...viele(OFFEN_BIS_ALBEN + 5, "2026"),
      ...viele(3, "2025"),
      ...viele(3, "2024"),
    ]);
    // Schon die jüngste Gruppe füllt das Fenster: nur sie ist offen
    expect([...standardOffen(g)]).toEqual(["2026"]);
    const wenige = gruppiereNachJahr([
      ...viele(3, "2026"),
      ...viele(3, "2025"),
      ...viele(3, "2024"),
      ...viele(OFFEN_BIS_ALBEN, "2023"),
      ...viele(3, "2022"),
    ]);
    expect([...standardOffen(wenige)]).toEqual([
      "2026",
      "2025",
      "2024",
      "2023",
    ]);
  });

  test("Suche: Gross und klein, Umlaute, «ss», mehrere Wörter, auch das Jahr", () => {
    const alben = [
      album("1", "2026 - Hörnli-Tour", "2026-03-01"),
      album("2", "Sommerlager Strasse", "2025-07-01"),
      album("3", "Waldweihnacht", null),
    ];
    const ids = (b: string) =>
      filtereAlben(alben, b).map((a: { id: string }) => a.id);
    expect(ids("")).toEqual(["1", "2", "3"]);
    expect(ids("   ")).toEqual(["1", "2", "3"]);
    expect(ids("HORNLI")).toEqual(["1"]);
    expect(ids("hoernli")).toEqual(["1"]);
    expect(ids("straße")).toEqual(["2"]);
    expect(ids("lager 2025")).toEqual(["2"]);
    expect(ids("2026")).toEqual(["1"]);
    expect(ids("lager waldweihnacht")).toEqual([]);
    expect(ids("xyz")).toEqual([]);
  });

  test("Anzeige der Treffer", () => {
    expect(trefferText(87, 87)).toBe("87 Alben");
    expect(trefferText(23, 87)).toBe("23 von 87 Alben");
    expect(trefferText(1, 1)).toBe("1 Album");
    expect(trefferText(0, 87)).toBe("0 von 87 Alben");
    expect(VIELE_ALBEN).toBeGreaterThan(1);
  });

  test("Kachelform: Zehntel, begrenzt auf 0.5 bis 3, ohne Masse 1.5", () => {
    expect(verhaeltnisKlasse(3, 2)).toBe("fr15");
    expect(verhaeltnisKlasse(320, 240)).toBe("fr13");
    expect(verhaeltnisKlasse(1, 1)).toBe("fr10");
    expect(verhaeltnisKlasse(2, 3)).toBe("fr07");
    expect(verhaeltnisKlasse(100, 1000)).toBe("fr05");
    expect(verhaeltnisKlasse(1000, 100)).toBe("fr30");
    expect(verhaeltnisKlasse(0, 0)).toBe("fr15");
    expect(verhaeltnisKlasse(undefined, "x")).toBe("fr15");
    // Jede Klasse, die es geben kann, steht im Stil
    const css = lies("fotos.css");
    for (let z = 5; z <= 30; z++) {
      expect(css).toContain(`.fr${String(z).padStart(2, "0")} {`);
    }
  });

  test("srcset: Die Stufen des Servers sind die lange Seite", () => {
    expect(bildBreiten(320, 213)).toEqual({ klein: 320, mittel: 640 });
    expect(bildBreiten(240, 320)).toEqual({ klein: 240, mittel: 480 });
    expect(bildBreiten(0, 0)).toEqual({ klein: 320, mittel: 640 });
  });

  test("Name des Links zum Bild: «Foto 3 von 393», ein Dateiname gehört nicht dazu", () => {
    expect(bildName(3, 393, "")).toBe("Foto 3 von 393");
    expect(bildName(3, 393, undefined)).toBe("Foto 3 von 393");
    expect(bildName(3, 393, " Gruppenbild am Feuer ")).toBe(
      "Foto 3 von 393: Gruppenbild am Feuer",
    );
    for (const datei of [
      "IMG_4021.jpg",
      "DSC00042",
      "img 12",
      "P1020304",
      "foto.PNG",
    ]) {
      expect(bildName(1, 2, datei), datei).toBe("Foto 1 von 2");
    }
  });

  test("Schritte: 48 je Klick, nie über die Zahl der Bilder; die Grossansicht holt bis zu ihrem Bild nach", () => {
    expect(SCHRITT_BILDER).toBe(48);
    expect(naechsteMenge(48, 393)).toBe(96);
    expect(naechsteMenge(384, 393)).toBe(393);
    expect(naechsteMenge(393, 393)).toBe(393);
    expect(mengeBis(48, 10, 393)).toBe(48);
    expect(mengeBis(48, 47, 393)).toBe(48);
    expect(mengeBis(48, 48, 393)).toBe(96);
    expect(mengeBis(48, 104, 393)).toBe(144);
    expect(mengeBis(48, 392, 393)).toBe(393);
  });
});

// Geschützte Seite (#816): Solange die Sitzung nicht geklärt ist, steht ein Skelett und nie «Nur angemeldet sichtbar». Es gibt kein jsdom: Der Ablauf im Browser steht in docs/barrierefreiheit.md (88); hier sind die Teile gesichert, auf denen er beruht.
describe("Ladezustand der geschützten Seite (#816)", () => {
  const huelle = rendereHuelle("/fotos", kontext);

  test("die Hülle bringt ihr Skelett mit, der Hinweis bleibt im HTML (ohne Skript) und main trägt die Klasse für den Abstand unten", () => {
    expect(huelle).toContain('class="huelle"');
    expect(huelle).toContain("Nur angemeldet sichtbar");
    const hinweis = huelle.indexOf('class="schutzblock"');
    const laden = huelle.indexOf('class="huelle-laden"');
    expect(hinweis).toBeGreaterThan(0);
    expect(laden).toBeGreaterThan(hinweis);
    // Formgleich zum Skelett, das geschuetzt.js sonst selbst baut; für Hilfstechnik verborgen
    expect(huelle).toContain('<div class="skelett karte" aria-hidden="true">');
  });

  test("der Stil verbirgt den Hinweis erst mit Skript und bis zur Antwort, ein Rückfall zeigt ihn wieder; unten gilt der Abstand der Seiten", () => {
    const css = lies("website.css");
    expect(css).toMatch(
      /html\.ladebild main\[data-huelle\]:not\(\[data-skript\]\) \.schutzblock \{\s*display: none;/,
    );
    expect(css).toMatch(
      /html\.ladebild main:not\(\[data-skript\]\) \[data-geschuetzt\] > \.schutzblock \{\s*visibility: hidden;/,
    );
    expect(css).toMatch(
      /html\[data-skript-spaet\] main\[data-huelle\]:not\(\[data-skript\]\) \.schutzblock \{\s*display: flex;/,
    );
    expect(css).toMatch(
      /main\.huelle > \.wrap \{\s*padding-bottom: var\(--abstand\);/,
    );
    // Ohne Skript (kein html.ladebild) ist das Skelett nicht da
    expect(css).toMatch(/\.huelle-laden \{\s*display: none;/);
  });

  test("geschuetzt.js übernimmt das Skelett, meldet sich an main an, bevor es fragt, und baut kein zweites", () => {
    const js = lies("geschuetzt.js");
    expect(js).toContain('.querySelector(".huelle-laden")');
    expect(js.indexOf('haupt.setAttribute("data-skript", "")')).toBeGreaterThan(
      0,
    );
    expect(js.indexOf('haupt.setAttribute("data-skript", "")')).toBeLessThan(
      js.indexOf("await fetch("),
    );
    expect(js).toContain("raeume(behalte)");
    // Der Hinweis kommt nur bei 401 zurück
    expect(js).toMatch(
      /if \(antwort\.status === 401\) return zeigeAbgemeldet\(\);/,
    );
  });

  test("theme.js setzt nach acht Sekunden den Rückfall, falls geschuetzt.js nie kommt", () => {
    expect(lies("theme.js")).toMatch(
      /setAttribute\("data-skript-spaet", ""\);\s*\}, 8000\)/,
    );
  });

  test("fotos.js zeigt den Hinweis nur nach der Antwort 401 der Schnittstelle, nie vorher", () => {
    const js = lies("fotos.js");
    // Der Hinweis steht nur in behandle(), und das ruft nur hole() nach der Antwort auf
    const stelle = js.indexOf("antwort.status === 401");
    expect(stelle).toBeGreaterThan(js.indexOf("function behandle("));
  });
});

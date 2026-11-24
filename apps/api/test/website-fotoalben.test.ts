import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { baueKnoten } from "../public/website/knoten.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { sicheresZiel } from "../public/website/weiter.js";
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

  test("Bewegung nur unter «nicht reduzieren»; Ziele und Ring wie die übrige Website", () => {
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(css).not.toMatch(/transition:[^;]*all/);
    expect(css).toContain("min-height: 2.75rem");
    expect(css).toContain("outline: 3px solid var(--focus)");
  });
});

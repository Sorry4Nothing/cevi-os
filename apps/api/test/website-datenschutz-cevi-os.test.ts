import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  DATENSCHUTZ_CEVI_OS_DATEI,
  markdownZuHtml,
  rendereDatenschutzCeviOs,
  STIL_DATENSCHUTZ,
} from "../src/website/datenschutz-cevi-os.js";
import { DATENSCHUTZ_CEVI_OS_TEXT } from "../src/website/datenschutz-cevi-os-text.js";
import { keineDaten, type Kontext } from "../src/website/rendern.js";
import { RESERVIERTE_ADRESSEN } from "../src/website/seiten.js";

// Die feste Seite «Datenschutz: Cevi OS, App, Verwaltung und Website» (#712): Text im Code, Datei beim Abgleich
const kontext: Kontext = {
  abteilung: "Cevi Beispielstadt",
  basisUrl: "https://www.example.org",
  navigation: [],
  daten: keineDaten(),
};
const [datei, html] = rendereDatenschutzCeviOs(kontext);
// Nur die Überschriften der Seite, nicht die des Fusses
const seite = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const ebenen = [...seite.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));

describe("Umwandler Markdown zu HTML", () => {
  test("Überschriften, Absätze, Listen, fett, kursiv und Link", () => {
    const { html: h, ueberschriften } = markdownZuHtml(
      [
        "## Titel",
        "",
        "Erste Zeile",
        "zweite Zeile mit **fett**, *kursiv* und [Link](/konto-loeschen).",
        "",
        "### 1.2 Unter",
        "- Eins **a**",
        "- Zwei",
        "",
        "#### Klein",
      ].join("\n"),
    );
    expect(h).toBe(
      [
        "<h2>Titel</h2>",
        '<p>Erste Zeile zweite Zeile mit <strong>fett</strong>, <em>kursiv</em> und <a href="/konto-loeschen">Link</a>.</p>',
        '<h3 id="abschnitt-1-2">1.2 Unter</h3>',
        "<ul>\n<li>Eins <strong>a</strong></li>\n<li>Zwei</li>\n</ul>",
        "<h4>Klein</h4>",
      ].join("\n"),
    );
    expect(ueberschriften).toEqual([
      { ebene: 2, text: "Titel" },
      { ebene: 3, text: "1.2 Unter", id: "abschnitt-1-2" },
      { ebene: 4, text: "Klein" },
    ]);
  });

  test("Text ist immer maskiert, rohes HTML kommt nie durch", () => {
    const { html: h } = markdownZuHtml(
      [
        "## <img src=x onerror=alert(1)>",
        "",
        `<script>alert("x")</script> & "Anführung" 'eins'`,
        "",
        "- <b>fett?</b> **<i>x</i>**",
        "<!-- Kommentar -->",
      ].join("\n"),
    );
    expect(h).not.toMatch(/<(script|img|b|i)[ >]/);
    expect(h).not.toContain("<!--");
    expect(h).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(h).toContain("&amp;");
    expect(h).toContain("&#39;eins&#39;");
    expect(h).toContain("<strong>&lt;i&gt;x&lt;/i&gt;</strong>");
  });

  test.each([
    ["javascript:void"],
    ["data:text/html,x"],
    ["//example.org/x"],
    ["http://example.org"],
    ["mailto:a@example.org"],
    ["relativ/ohne-slash"],
  ])("der Link auf %s wird zu Text ohne Link", (ziel) => {
    expect(markdownZuHtml(`[Text](${ziel})`).html).toBe("<p>Text</p>");
  });

  test("erlaubt sind ein Pfad auf derselben Domain und https", () => {
    expect(markdownZuHtml("[a](/x/y#z)").html).toBe(
      '<p><a href="/x/y#z">a</a></p>',
    );
    expect(markdownZuHtml("[a](https://example.org/p?q=1&r=2)").html).toBe(
      '<p><a href="https://example.org/p?q=1&amp;r=2" rel="noopener noreferrer">a</a></p>',
    );
  });

  test("Überschriften ausserhalb von 2 bis 4 sind Text", () => {
    const { html: h, ueberschriften } = markdownZuHtml("# Eins\n\n##### Fünf");
    expect(ueberschriften).toEqual([]);
    expect(h).toBe("<p># Eins</p>\n<p>##### Fünf</p>");
  });
});

describe("Seite Datenschutz Cevi OS", () => {
  test("die Datei liegt unter datenschutz-cevi-os/index.html, die Adresse ist reserviert", () => {
    expect(datei).toBe("datenschutz-cevi-os/index.html");
    expect(DATENSCHUTZ_CEVI_OS_DATEI).toBe(datei);
    expect(RESERVIERTE_ADRESSEN).toContain("datenschutz-cevi-os");
  });

  test("Rahmen: Sprache, Titel, Canonical, Stil, nur Skripte der eigenen Herkunft", () => {
    expect(html).toContain('<html lang="de-CH">');
    expect(html).toContain(
      "<title>Datenschutz: Cevi OS, App, Verwaltung und Website | Cevi Beispielstadt</title>",
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://www.example.org/datenschutz-cevi-os">',
    );
    expect(html).toContain(
      `<link rel="stylesheet" href="${STIL_DATENSCHUTZ}">`,
    );
    expect(html).not.toContain("noindex");
    const skripte = [...html.matchAll(/<script([^>]*)>/g)];
    expect(skripte.length).toBeGreaterThan(0);
    for (const m of skripte)
      expect(m[1]).toMatch(/ src="\/website\/[a-z-]+\.js"/);
    expect(html).not.toContain("<!--");
    expect(html).not.toContain("ß");
  });

  test("eine H1, eine H2 und die Ebenen springen nie über eine Stufe", () => {
    expect(ebenen.filter((e) => e === 1)).toHaveLength(1);
    expect(html).toContain(
      "<h1>Datenschutz: Cevi OS, App, Verwaltung und Website</h1>",
    );
    expect(ebenen.filter((e) => e === 2)).toHaveLength(1);
    expect(ebenen.some((e) => e > 4)).toBe(false);
    ebenen.forEach((e, i) => {
      if (i > 0) expect(e).toBeLessThanOrEqual(ebenen[i - 1]! + 1);
    });
  });

  test("die acht Abschnitte 11.1 bis 11.8 und 44 Kategorien", () => {
    const abschnitte = [
      ...html.matchAll(/<h3 id="(abschnitt-[\d-]+)">([^<]+)<\/h3>/g),
    ];
    expect(abschnitte.map((m) => m[2])).toEqual([
      "11.1 Grundsätze",
      "11.2 Welche Daten Cevi OS bearbeitet",
      "11.3 Woher die Daten stammen",
      "11.4 Wer was sieht",
      "11.5 An wen Daten gehen",
      "11.6 Wie lange Daten bleiben",
      "11.7 Wie wir Daten schützen",
      "11.8 Die öffentliche Website",
    ]);
    expect(abschnitte.map((m) => m[1])).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `abschnitt-11-${n}`),
    );
    expect(html).not.toContain("11.9");
    expect(ebenen.filter((e) => e === 3)).toHaveLength(8);
    const kategorien = [...html.matchAll(/<h4>([^<]+)<\/h4>/g)].map(
      (m) => m[1],
    );
    expect(kategorien).toHaveLength(44);
    expect(new Set(kategorien).size).toBe(44);
    expect(kategorien[0]).toBe("Konto und Anmeldung");
    expect(kategorien.at(-1)).toBe("Angaben aus der Cevi-Datenbank");
    // Jede Kategorie nennt Daten, Zweck und Aufbewahrung
    for (const zeile of ["Daten", "Zweck", "Aufbewahrung"]) {
      expect(
        html.match(new RegExp(`<li><strong>${zeile}:</strong>`, "g")),
      ).toHaveLength(44);
    }
  });

  test("das Inhaltsverzeichnis verlinkt jeden Abschnitt auf einen vorhandenen Anker", () => {
    const nav = /<nav class="datenschutz-inhalt"[\s\S]*?<\/nav>/.exec(html)![0];
    const ziele = [...nav.matchAll(/<a href="#([^"]+)">/g)].map((m) => m[1]!);
    expect(ziele).toHaveLength(8);
    for (const z of ziele) {
      expect(html.match(new RegExp(`id="${z}"`, "g"))).toHaveLength(1);
    }
    // Der Name des Verzeichnisses verweist auf eine vorhandene ID
    expect(nav).toContain('aria-labelledby="datenschutz-inhalt"');
    expect(nav).toContain('<p id="datenschutz-inhalt">');
  });

  test("Links: oben und unten zurück auf die allgemeine Erklärung, Konto löschen relativ", () => {
    expect(
      html.match(
        /<a class="verweis" href="\/datenschutz-website">Allgemeine Datenschutzerklärung des Cevi Stäfa-Hombrechtikon<\/a>/g,
      ),
    ).toHaveLength(2);
    expect(html).toContain('<a href="/konto-loeschen">Konto löschen</a>');
    expect(html).not.toContain("cevios.ch");
    // Im Inhalt gibt es keinen Link nach aussen
    const inhalt = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(inhalt).not.toMatch(/href="(?!#|\/)/);
  });

  test("der Text im Code enthält weder Kommentare noch 11.9 noch rohes HTML", () => {
    expect(DATENSCHUTZ_CEVI_OS_TEXT).not.toContain("<!--");
    expect(DATENSCHUTZ_CEVI_OS_TEXT).not.toContain("11.9");
    expect(DATENSCHUTZ_CEVI_OS_TEXT).not.toMatch(/<[a-z/]/i);
    expect(DATENSCHUTZ_CEVI_OS_TEXT).not.toContain("api.cevios.ch");
  });

  test("der Stil liegt in public/website, ohne fremde Quellen und ohne feste Farben", () => {
    const css = readFileSync(
      new URL("../public/website/datenschutz.css", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/url\(|@import|#[0-9a-f]{3,8}\b/i);
  });

  test("Fuss und Konto-Seiten verweisen auf die Seite", () => {
    expect(html).toContain(
      '<li><a href="/datenschutz-cevi-os">Datenschutz: Cevi OS, App, Verwaltung und Website</a></li>',
    );
    for (const pfad of ["admin/konto.js", "website/konto.js"]) {
      const js = readFileSync(
        new URL(`../public/${pfad}`, import.meta.url),
        "utf8",
      );
      expect(js).toContain("/datenschutz-cevi-os");
      expect(js).toContain("/datenschutz-website");
    }
  });
});

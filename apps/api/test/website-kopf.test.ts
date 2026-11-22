import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { kopf, STIL_KOPF } from "../src/website/kopf.js";
import {
  keineDaten,
  rendereSeite,
  type Kontext,
  type NavPunkt,
} from "../src/website/rendern.js";

// Kopf der Website (#558): Marke, Navigation mit Untermenüs, Umschalter Hell und Dunkel, Menü am Handy. Reines Rendern, ohne Datenbank
const punkt = (titel: string, pfad: string, kinder: NavPunkt[] = []) => ({
  titel,
  pfad,
  kinder,
});
const kontext = (navigation: NavPunkt[], extra: Partial<Kontext> = {}) => ({
  abteilung: "Cevi Test",
  basisUrl: "https://example.org",
  navigation,
  daten: keineDaten(),
  ...extra,
});
const BAUM = [
  punkt("Start", "/"),
  punkt("Gruppen", "/gruppen", [
    punkt("Stufe Eins", "/gruppen/eins"),
    punkt("Stufe Zwei", "/gruppen/zwei"),
  ]),
  punkt("Anlässe", "/anlaesse", [
    punkt("Lager", "/anlaesse/lager", [
      punkt("Sommerlager", "/anlaesse/lager/sola"),
    ]),
    punkt("Feste", "/anlaesse/feste"),
  ]),
];
const zaehle = (html: string, teil: string) => html.split(teil).length - 1;
const hauptnav = (html: string) =>
  /<nav class="hauptnav"[^>]*>(.*?)<\/nav>/s.exec(html)![1]!;
const mobil = (html: string) =>
  /<nav aria-label="Menü">(.*?)<\/nav>/s.exec(html)![1]!;

describe("Umschalter Hell und Dunkel", () => {
  const html = kopf(kontext(BAUM), "/", false);

  test("zwei Knöpfe nur mit Symbol: Name im aria-label, aria-pressed, ohne Skript verborgen, kein «System»", () => {
    const gruppen = html.match(
      /<div class="thema" role="group" aria-label="Darstellung" hidden>.*?<\/div>/gs,
    )!;
    // Einmal im Band und einmal im Menü am Handy
    expect(gruppen).toHaveLength(2);
    for (const g of gruppen) {
      expect(g.match(/<button /g)).toHaveLength(2);
      expect(g).toContain(
        '<button type="button" data-thema="light" aria-pressed="false" aria-label="Hell"><svg',
      );
      expect(g).toContain(
        '<button type="button" data-thema="dark" aria-pressed="false" aria-label="Dunkel"><svg',
      );
      // Kein sichtbarer Text: zwischen den Symbolen steht nichts
      expect(g.replace(/<svg.*?<\/svg>/gs, "").replace(/<[^>]+>/g, "")).toBe(
        "",
      );
      expect(g).not.toMatch(/system/i);
    }
  });

  test("theme.js: ohne gespeicherte Wahl folgt die Seite dem System und speichert nichts; nur ein Klick speichert", () => {
    const skript = readFileSync(
      new URL("../public/website/theme.js", import.meta.url),
      "utf8",
    );
    expect(skript).toContain("prefers-color-scheme: dark");
    expect(skript).not.toContain('"system"');
    // setItem steht nur in speichere(), und speichere() ruft nur der Klick auf
    expect(zaehle(skript, "setItem(")).toBe(1);
    expect(zaehle(skript, "speichere(")).toBe(2);
    expect(skript).toMatch(
      /addEventListener\("click", function \(e\) \{\s*aktuell = [^;]+;\s*speichere\(aktuell\);/,
    );
    expect(skript).not.toMatch(/cookie|fetch\(|XMLHttpRequest/);
  });
});

describe("Marke und Logo", () => {
  const logo = {
    id: "0190a000-0000-7000-8000-000000000001",
    altText: "Cevi",
    breite: 800,
    hoehe: 165,
  };
  const dunkel = {
    id: "0190a000-0000-7000-8000-000000000002",
    breite: 800,
    hoehe: 165,
  };

  test("ohne Logo die Wortmarke, mit Logo das Bild und der Name für Screenreader", () => {
    expect(kopf(kontext([]), "/", false)).toContain(
      '<a class="marke" href="/"><b>CEVI</b><span>Test</span></a>',
    );
    expect(kopf(kontext([], { logo }), "/", false)).toContain(
      `<a class="marke marke--logo" href="/"><img class="logo" src="/api/v1/medien/${logo.id}" alt="Cevi" width="800" height="165"><span class="nur-sr">Test</span></a>`,
    );
  });

  test("mit einer Fassung für den dunklen Modus stehen beide Bilder da; der Stil zeigt je nach Darstellung eines", () => {
    const html = kopf(kontext([], { logo: { ...logo, dunkel } }), "/", false);
    expect(html).toContain(
      `<a class="marke marke--logo marke--zwei" href="/"><img class="logo logo--hell" src="/api/v1/medien/${logo.id}" alt="Cevi" width="800" height="165"><img class="logo logo--dunkel" src="/api/v1/medien/${dunkel.id}" alt="Cevi" width="800" height="165"><span class="nur-sr">Test</span></a>`,
    );
    const css = readFileSync(
      new URL("../public/website/kopf.css", import.meta.url),
      "utf8",
    );
    // Beide Wege in die Nacht: System und gewählte Darstellung
    expect(css).toContain(
      ':root:not([data-theme="light"]) .logo--hell {\n    display: none;',
    );
    expect(css).toContain(':root[data-theme="dark"] .logo--hell {');
  });
});

describe("Navigation am Computer", () => {
  const html = hauptnav(kopf(kontext(BAUM), "/gruppen/eins", false));

  test("ein Punkt mit Unterseiten: Link zur Seite und daneben ein details-Element, dessen Dreieck den Namen trägt", () => {
    expect(html).toContain(
      '<li class="mit-unter"><a href="/gruppen" aria-current="true">Gruppen</a><details name="hauptnav"><summary aria-label="Unterseiten von Gruppen"><svg',
    );
    expect(html).toContain(
      '<div class="unter"><ul><li><a href="/gruppen/eins" aria-current="page">Stufe Eins</a></li><li><a href="/gruppen/zwei">Stufe Zwei</a></li></ul></div></details></li>',
    );
    // Ohne Skript: nichts hängt an Hover oder an einem Knopf ohne Funktion
    expect(html).not.toContain("<button");
    expect(html).toContain('<li><a href="/">Start</a></li>');
  });

  test("dritte Ebene: Die Tafel bekommt Spalten, jede Seite ist erreichbar", () => {
    expect(html).toContain(
      '<div class="unter unter--gruppen"><ul><li><a href="/anlaesse/lager">Lager</a><ul><li><a href="/anlaesse/lager/sola">Sommerlager</a></li></ul></li><li><a href="/anlaesse/feste">Feste</a></li></ul></div>',
    );
  });

  test("wenige kurze Punkte: alle in der Zeile, Stufe «kurz»; kein «Mehr»", () => {
    const ganz = kopf(kontext(BAUM), "/", false);
    expect(ganz).toContain('<header class="kopf kopf--kurz">');
    expect(ganz).not.toContain("Mehr");
  });

  test("zu viele oder zu lange Titel: Der Rest steht unter «Mehr», mit allen Ebenen; «Mehr» zeigt an, wenn die aktuelle Seite darin liegt", () => {
    const viele = Array.from({ length: 12 }, (_, i) =>
      punkt(`Ein langer Titel ${i}`, `/s${i}`, [
        punkt(`Unterseite ${i}`, `/s${i}/u`),
      ]),
    );
    const ganz = kopf(kontext(viele), "/s11/u", false);
    const nav = hauptnav(ganz);
    expect(ganz).toContain('<header class="kopf kopf--weit">');
    const mehr = nav.slice(nav.indexOf('<li class="mit-unter weitere hier">'));
    expect(mehr).toContain("<summary>Mehr<svg");
    expect(mehr).toContain(
      '<li><a href="/s11" aria-current="true">Ein langer Titel 11</a><ul><li><a href="/s11/u" aria-current="page">Unterseite 11</a></li></ul></li>',
    );
    // Jeder Punkt steht genau einmal in der Navigation
    for (let i = 0; i < 12; i++) expect(zaehle(nav, `href="/s${i}"`)).toBe(1);
    // Ein überlanger erster Titel bleibt trotzdem in der Zeile
    const lang = hauptnav(
      kopf(kontext([punkt("x".repeat(200), "/x"), ...viele]), "/", false),
    );
    expect(lang.indexOf('href="/x"')).toBeLessThan(lang.indexOf("Mehr"));
  });

  test("Titel und Adressen werden maskiert", () => {
    const boese = kopf(
      kontext([punkt('<b>"x"</b>', "/a", [punkt("<i>", "/a/b")])]),
      "/",
      false,
    );
    expect(boese).not.toContain("<b>\"x\"");
    expect(boese).toContain(
      'aria-label="Unterseiten von &lt;b&gt;&quot;x&quot;&lt;/b&gt;"',
    );
    expect(boese).not.toContain("<i>");
  });
});

describe("Menü am Handy", () => {
  test("ein details-Element mit dem ganzen Baum; Unterseiten sind zugeklappt, nur der Zweig der aktuellen Seite ist offen", () => {
    const ganz = kopf(kontext(BAUM), "/anlaesse/lager/sola", false);
    expect(ganz).toContain('<details class="menue-mobil"><summary>');
    expect(ganz).toContain(
      '<span class="auf">Menü</span><span class="zu">Schliessen</span>',
    );
    const m = mobil(ganz);
    expect(m).toContain(
      '<li class="mit-unter"><a href="/gruppen">Gruppen</a><details><summary aria-label="Unterseiten von Gruppen">',
    );
    expect(m).toContain(
      '<a href="/anlaesse" aria-current="true">Anlässe</a><details open>',
    );
    expect(m).toContain(
      '<a href="/anlaesse/lager" aria-current="true">Lager</a><details open>',
    );
    expect(m).toContain(
      '<li><a href="/anlaesse/lager/sola" aria-current="page">Sommerlager</a></li>',
    );
    // «Anmelden» steht im Band und im Menü
    expect(zaehle(ganz, '<a class="anmelden" href="/anmelden">')).toBe(2);
  });

  test("Unterleiste: die Unterseiten des gewählten Bereichs", () => {
    const ganz = kopf(kontext(BAUM), "/gruppen/zwei", false);
    expect(ganz).toContain(
      '<nav class="unterleiste" aria-label="Unterseiten von Gruppen"><div class="wrap"><ul><li><a href="/gruppen/eins">Stufe Eins</a></li><li><a href="/gruppen/zwei" aria-current="page">Stufe Zwei</a></li></ul></div></nav>',
    );
    expect(kopf(kontext(BAUM), "/", false)).not.toContain("unterleiste");
  });
});

describe("Rahmen", () => {
  test("nur die Marke (Wartung, Serverfehler): keine Navigation, kein «Anmelden», der Umschalter bleibt", () => {
    const html = kopf(kontext(BAUM), null, true);
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("anmelden");
    expect(zaehle(html, 'class="thema"')).toBe(1);
  });

  test("jede Seite lädt die Stilvorlage des Kopfs nach der Grundvorlage", () => {
    const html = rendereSeite(
      {
        id: "0190a000-0000-7000-8000-000000000003",
        pfad: "/x",
        dokument: { titel: "X", bausteine: [] } as never,
      },
      kontext(BAUM),
    );
    expect(html).toContain(
      `<link rel="stylesheet" href="/website/website.css">\n<link rel="stylesheet" href="${STIL_KOPF}">`,
    );
  });

  test("kopf.css: nichts von aussen, Bewegung nur ohne «Bewegung reduzieren», erzwungene Farben und Druck bedacht", () => {
    const css = readFileSync(
      new URL("../public/website/kopf.css", import.meta.url),
      "utf8",
    );
    expect(css).not.toMatch(/url\(|@import|https?:/);
    const [ruhe, bewegt] = css.split(
      "@media (prefers-reduced-motion: no-preference) {",
    );
    // Vor dem Block steht keine Bewegung; Keyframes stehen danach und laufen nur aus dem Block heraus
    expect(ruhe).not.toMatch(/transition|animation/);
    expect(bewegt).toContain("animation: tafel-auf");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media print");
  });

  test("menue.js: kein innerHTML, keine Abrufe; Esc, Pfeiltasten und das Schliessen sind da", () => {
    const js = readFileSync(
      new URL("../public/website/menue.js", import.meta.url),
      "utf8",
    );
    expect(js).not.toMatch(/innerHTML|fetch\(|eval\(|document\.write/);
    for (const taste of ["Escape", "ArrowDown", "ArrowRight", "Home"]) {
      expect(js).toContain(`"${taste}"`);
    }
  });
});

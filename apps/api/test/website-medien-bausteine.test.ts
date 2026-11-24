import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { baueKnoten } from "../public/website/knoten.js";
import {
  pruefeDokument,
  sammleVerweise,
  type Seitendokument,
} from "../src/website/dokument.js";
import {
  MAX_BILDRASTER,
  MAX_LOGOS,
  MAX_STREIFEN,
  MIN_BILDRASTER,
  MIN_STREIFEN,
} from "../src/website/medien-schema.js";
import {
  keineDaten,
  rendereGeschuetzte,
  rendereHuelle,
  rendereSeite,
  type Daten,
  type MedienDaten,
} from "../src/website/rendern.js";

// Bausteine für Bilder und Medien (#742): Schema mit Grenzen, Verweise, Renderer mit Maskierung, Stil und Skript nur dort, wo sie gebraucht werden, Stil und Skript selbst.
// Die Verweisprüfung gegen die Datenbank (Bild, Format, öffentlich, Alt-Text) steht in redaktion-seiten-medien-bausteine.test.ts.

const BOESE = `<x-boese a="1">`;
const id = () => randomUUID();
const b = (typ: string, daten: unknown, extra: object = {}) => ({
  id: id(),
  typ,
  daten,
  ...extra,
});
const pruefe = (...bausteine: unknown[]) =>
  pruefeDokument({ v: 1, titel: "Seite", bausteine });
const dok = (...bausteine: unknown[]): Seitendokument => {
  const p = pruefe(...bausteine);
  if (!p.ok) throw new Error(JSON.stringify(p.fehler));
  return p.dokument;
};
const ungueltig = (...bausteine: unknown[]) => !pruefe(...bausteine).ok;
const zaehle = (text: string, teil: string) => text.split(teil).length - 1;

const bildDaten = (
  altText: string | null,
  extra: Partial<MedienDaten> = {},
): MedienDaten => ({
  mimeTyp: "image/webp",
  groesse: 1000,
  breite: 800,
  hoehe: 600,
  altText,
  ...extra,
});
// n Bilder mit Alt-Text «Bild 1» …
const medien = (n: number) => {
  const ids = Array.from({ length: n }, () => id());
  const daten: Daten = {
    ...keineDaten(),
    medien: new Map(ids.map((m, i) => [m, bildDaten(`Bild ${i + 1}`)])),
  };
  return { ids, daten };
};
const bilder = (ids: string[]) => ids.map((mediumId) => ({ mediumId }));
const seite = (d: Seitendokument, daten: Daten = keineDaten()) =>
  rendereSeite(
    { id: id(), pfad: "/seite", dokument: d },
    {
      abteilung: "Cevi Test",
      basisUrl: "https://www.example.org",
      navigation: [],
      daten,
    },
  );
const lies = (pfad: string) =>
  readFileSync(new URL(`../public/website/${pfad}`, import.meta.url), "utf8");

describe("Schema: Grenzen und Ablehnung", () => {
  test("Bildraster: 2 bis 24 Bilder, 2 bis 4 Spalten, drei Formate", () => {
    const raster = (n: number, extra: object = {}) =>
      b("bildraster", {
        spalten: 3,
        format: "quer",
        bilder: bilder(Array.from({ length: n }, id)),
        ...extra,
      });
    expect(pruefe(raster(MIN_BILDRASTER)).ok).toBe(true);
    expect(pruefe(raster(MAX_BILDRASTER)).ok).toBe(true);
    expect(ungueltig(raster(MIN_BILDRASTER - 1))).toBe(true);
    expect(ungueltig(raster(MAX_BILDRASTER + 1))).toBe(true);
    for (const spalten of [1, 5, "3", 2.5]) {
      expect(ungueltig(raster(4, { spalten }))).toBe(true);
    }
    for (const format of ["quer", "quadrat", "hoch"]) {
      expect(pruefe(raster(4, { format })).ok).toBe(true);
    }
    expect(ungueltig(raster(4, { format: "breit" }))).toBe(true);
    // Fremdfelder: nie ein Alt-Text oder HTML am Baustein
    expect(ungueltig(raster(4, { html: "<b>" }))).toBe(true);
    expect(
      ungueltig(
        b("bildraster", {
          spalten: 2,
          format: "quer",
          bilder: [{ mediumId: id(), alt: "x" }, { mediumId: id() }],
        }),
      ),
    ).toBe(true);
    expect(
      ungueltig(
        b("bildraster", {
          spalten: 2,
          format: "quer",
          bilder: [{ mediumId: "kein-uuid" }, { mediumId: id() }],
        }),
      ),
    ).toBe(true);
  });

  test("Bildstreifen: 3 bis 30 Bilder", () => {
    const streifen = (n: number) =>
      b("bildstreifen", { bilder: bilder(Array.from({ length: n }, id)) });
    expect(pruefe(streifen(MIN_STREIFEN)).ok).toBe(true);
    expect(pruefe(streifen(MAX_STREIFEN)).ok).toBe(true);
    expect(ungueltig(streifen(MIN_STREIFEN - 1))).toBe(true);
    expect(ungueltig(streifen(MAX_STREIFEN + 1))).toBe(true);
  });

  test("Bild mit Text: Titel Pflicht, Text und Link frei, Link nur mit erlaubter Art", () => {
    const text = (extra: object = {}) =>
      b("bildtext", { mediumId: id(), titel: "Sommerlager", ...extra });
    expect(pruefe(text()).ok).toBe(true);
    expect(
      pruefe(
        text({
          text: "Zwei Wochen im Wald.",
          position: "mitte",
          link: { beschriftung: "Mehr", ziel: "/lager" },
        }),
      ).ok,
    ).toBe(true);
    expect(ungueltig(text({ titel: "" }))).toBe(true);
    expect(ungueltig(text({ titel: "x".repeat(101) }))).toBe(true);
    expect(ungueltig(text({ text: "x".repeat(501) }))).toBe(true);
    expect(ungueltig(text({ position: "oben" }))).toBe(true);
    for (const ziel of [
      "javascript:alert(1)",
      "data:text/html,x",
      "//example.org",
      "http://example.org",
    ]) {
      expect(
        ungueltig(text({ link: { beschriftung: "Mehr", ziel } })),
        ziel,
      ).toBe(true);
    }
    // Steuerzeichen gehören in keinen Text
    expect(ungueltig(text({ titel: "a\u0000b" }))).toBe(true);
  });

  test("Bildvergleich: genau zwei Bilder", () => {
    const v = (n: number, extra: object = {}) =>
      b("bildvergleich", {
        bilder: bilder(Array.from({ length: n }, id)),
        ...extra,
      });
    expect(pruefe(v(2)).ok).toBe(true);
    expect(
      pruefe(v(2, { vorherText: "Früher", nachherText: "Heute" })).ok,
    ).toBe(true);
    expect(ungueltig(v(1))).toBe(true);
    expect(ungueltig(v(3))).toBe(true);
    expect(ungueltig(v(2, { vorherText: "x".repeat(31) }))).toBe(true);
  });

  test("Logo-Reihe: 1 bis 24 Logos, Link nur https oder Seite, zwei Darstellungen", () => {
    const logos = (n: number, extra: object = {}) =>
      b("logoreihe", {
        darstellung: "farbig",
        bilder: Array.from({ length: n }, () => ({ mediumId: id() })),
        ...extra,
      });
    expect(pruefe(logos(1)).ok).toBe(true);
    expect(pruefe(logos(MAX_LOGOS)).ok).toBe(true);
    expect(ungueltig(logos(0))).toBe(true);
    expect(ungueltig(logos(MAX_LOGOS + 1))).toBe(true);
    expect(pruefe(logos(1, { darstellung: "grau" })).ok).toBe(true);
    expect(ungueltig(logos(1, { darstellung: "bunt" }))).toBe(true);
    const mitLink = (link: string) =>
      b("logoreihe", {
        darstellung: "farbig",
        bilder: [{ mediumId: id(), link }],
      });
    expect(pruefe(mitLink("https://www.example.org")).ok).toBe(true);
    expect(pruefe(mitLink("/ueber-uns")).ok).toBe(true);
    for (const link of [
      "mailto:a@example.org",
      "tel:+41000000000",
      "http://example.org",
      "javascript:alert(1)",
    ]) {
      expect(ungueltig(mitLink(link)), link).toBe(true);
    }
  });

  test("Breites Bild: Höhe Pflicht, Fokus nur aus der Liste", () => {
    const p = (extra: object = {}) =>
      b("panorama", { mediumId: id(), hoehe: "mittel", ...extra });
    expect(pruefe(p()).ok).toBe(true);
    expect(
      pruefe(p({ fokusX: "rechts", fokusY: "oben", unterschrift: "Blick" })).ok,
    ).toBe(true);
    expect(ungueltig(p({ hoehe: "riesig" }))).toBe(true);
    expect(ungueltig(p({ fokusX: "50%" }))).toBe(true);
    expect(ungueltig(p({ fokusY: "mitte oben" }))).toBe(true);
    expect(ungueltig(b("panorama", { mediumId: id() })), "ohne Höhe").toBe(
      true,
    );
  });

  test("Bilderpaket: Titel und Link Pflicht, der Link geht durch die strenge Prüfung", () => {
    const p = (extra: object = {}) =>
      b("bilderpaket", {
        titel: "Fotos Sommerlager",
        link: "https://example.sharepoint.com/pakete/sola",
        ...extra,
      });
    expect(pruefe(p()).ok).toBe(true);
    expect(
      pruefe(p({ bild: id(), typ: "ZIP", anzahl: 120, groesse: 250_000_000 }))
        .ok,
    ).toBe(true);
    expect(ungueltig(p({ titel: "" }))).toBe(true);
    expect(ungueltig(p({ anzahl: 0 }))).toBe(true);
    expect(ungueltig(p({ anzahl: 100_001 }))).toBe(true);
    expect(ungueltig(p({ anzahl: 1.5 }))).toBe(true);
    expect(ungueltig(p({ groesse: -1 }))).toBe(true);
    expect(ungueltig(p({ bild: "kein-uuid" }))).toBe(true);
    for (const link of [
      "javascript:alert(1)",
      "http://example.sharepoint.com/x",
      "//example.org",
      "mailto:a@example.org",
    ]) {
      expect(ungueltig(p({ link })), link).toBe(true);
    }
  });

  test("Video: das Vorschaubild ist freiwillig, bestehende Dokumente bleiben gültig", () => {
    const v = (extra: object = {}) =>
      b("videolink", {
        art: "video",
        beschriftung: "Rückblick",
        url: "https://video.example.org/w/abc",
        ...extra,
      });
    expect(pruefe(v()).ok).toBe(true);
    expect(pruefe(v({ bild: id() })).ok).toBe(true);
    expect(ungueltig(v({ bild: "x" }))).toBe(true);
    expect(ungueltig(v({ url: "http://video.example.org/" }))).toBe(true);
  });

  test("gespeicherte Dokumente ohne die neuen Bausteine sind weiter gültig (v: 1)", () => {
    expect(
      pruefe(
        b("ueberschrift", { ebene: 2, text: "Hallo" }),
        b("galerie", { bilder: [{ mediumId: id() }] }),
        b("karussell", { bilder: bilder([id(), id(), id()]) }),
      ).ok,
    ).toBe(true);
  });
});

describe("Verweise", () => {
  test("alle Medien und Seiten der neuen Bausteine zählen als Verweise", () => {
    const [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10] = Array.from(
      { length: 10 },
      id,
    );
    const v = sammleVerweise(
      dok(
        b("bildraster", {
          spalten: 2,
          format: "quer",
          bilder: bilder([m1!, m2!]),
        }),
        b("bildstreifen", { bilder: bilder([m3!, m3!, m4!]) }),
        b("bildvergleich", { bilder: bilder([m5!, m6!]) }),
        b("logoreihe", {
          darstellung: "grau",
          bilder: [
            { mediumId: m7!, link: "/partner#kirche" },
            { mediumId: m1! },
          ],
        }),
        b("panorama", { mediumId: m8!, hoehe: "niedrig" }),
        b("bildtext", {
          mediumId: m9!,
          titel: "T",
          link: { beschriftung: "Mehr", ziel: "/lager" },
        }),
        b("bilderpaket", {
          titel: "Paket",
          link: "https://example.sharepoint.com/x",
          bild: m10!,
        }),
        b("videolink", {
          art: "video",
          beschriftung: "V",
          url: "https://video.example.org/w/1",
          bild: m2!,
        }),
      ),
    );
    expect(v.medien.sort()).toEqual(
      [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10].sort(),
    );
    expect(v.seiten.sort()).toEqual(["/lager", "/partner"]);
  });

  test("ohne Vorschaubild keine Medien", () => {
    const v = sammleVerweise(
      dok(
        b("bilderpaket", {
          titel: "Paket",
          link: "https://example.sharepoint.com/x",
        }),
        b("videolink", {
          art: "video",
          beschriftung: "V",
          url: "https://video.example.org/w/1",
        }),
      ),
    );
    expect(v.medien).toEqual([]);
  });
});

describe("Renderer", () => {
  test("Bildraster: Raster mit Klassen für Spalten und Format, Bilder nur über die Medien-Adresse, mit Platz, lazy und Grossansicht", () => {
    const { ids, daten } = medien(4);
    const html = seite(
      dok(
        b("ueberschrift", { ebene: 2, text: "Bilder" }),
        b("bildraster", {
          spalten: 3,
          format: "quadrat",
          bilder: [
            { mediumId: ids[0], unterschrift: `Am ${BOESE}-See` },
            ...bilder(ids.slice(1)),
          ],
        }),
      ),
      daten,
    );
    expect(html).toContain(
      '<ul class="bildraster bildraster--3 bildraster--quadrat" role="list">',
    );
    expect(zaehle(html, '<a class="bildgross"')).toBe(4);
    expect(html).toContain(`src="/api/v1/medien/${ids[0]}"`);
    expect(html).toContain('alt="Bild 1" width="800" height="600"');
    // Maskiert, nie als Element
    expect(html).toContain(
      "<figcaption>Am &lt;x-boese a=&quot;1&quot;&gt;-See</figcaption>",
    );
    expect(html).not.toContain("<x-boese");
    expect(html).not.toContain("style=");
    // Grossansicht, Stil der Gruppe
    expect(html).toContain('href="/website/medien.css"');
    expect(html).toContain('href="/website/lichtkasten.css"');
    expect(html).toContain('src="/website/lichtkasten.js" defer');
    expect(html).not.toContain("vergleich.js");
    expect(html).not.toContain("karussell");
  });

  test("ein Medium, das kein Bild ist, oder ein fehlendes entfällt; ohne Bilder entfällt der Baustein", () => {
    const { ids, daten } = medien(3);
    const gemischt: Daten = {
      ...daten,
      medien: new Map([
        [ids[0]!, bildDaten("Ein Bild")],
        [ids[1]!, bildDaten(null, { mimeTyp: "application/pdf" })],
      ]),
    };
    const html = seite(
      dok(
        b("bildraster", {
          spalten: 2,
          format: "quer",
          bilder: bilder(ids),
        }),
      ),
      gemischt,
    );
    expect(zaehle(html, "<li ")).toBeGreaterThanOrEqual(1);
    expect(zaehle(html, '<a class="bildgross"')).toBe(1);
    const leer = seite(
      dok(
        b("bildraster", {
          spalten: 2,
          format: "quer",
          bilder: bilder([id(), id()]),
        }),
      ),
    );
    expect(leer).not.toContain("bildraster");
    // Auch dann ohne Stil und Skript
    expect(leer).toContain('href="/website/medien.css"');
  });

  test("Bildstreifen: Gruppe mit Namen und Anzahl, Liste, Bilder mit Grossansicht", () => {
    const { ids, daten } = medien(5);
    const html = seite(dok(b("bildstreifen", { bilder: bilder(ids) })), daten);
    expect(html).toContain(
      '<div class="bildstreifen" role="group" aria-label="Bildstreifen mit 5 Bildern"><ul class="streifen" role="list">',
    );
    expect(zaehle(html, '<a class="bildgross"')).toBe(5);
    // Der Streifen bewegt sich nie von selbst: kein Skript dafür
    expect(html).not.toContain("karussell.js");
    expect(html).toContain('src="/website/lichtkasten.js" defer');
  });

  test("Bild mit Text: Überschrift eine Ebene unter der letzten, Text und Link maskiert, Link nur erlaubt", () => {
    const { ids, daten } = medien(1);
    const html = seite(
      dok(
        b("ueberschrift", { ebene: 2, text: "Lager" }),
        b("bildtext", {
          mediumId: ids[0],
          titel: `Sommer ${BOESE}`,
          text: `Zwei <b>Wochen</b> & mehr`,
          position: "mitte",
          link: { beschriftung: "Zum Lager", ziel: "/lager" },
        }),
      ),
      daten,
    );
    expect(html).toContain('<div class="bildtext bildtext--mitte">');
    expect(html).toContain(
      '<h3 class="titel">Sommer &lt;x-boese a=&quot;1&quot;&gt;</h3>',
    );
    expect(html).toContain("Zwei &lt;b&gt;Wochen&lt;/b&gt; &amp; mehr");
    expect(html).toContain('<a href="/lager" class="btn w">Zum Lager</a>');
    expect(html).not.toContain("<x-boese");
    expect(html).not.toContain("<b>Wochen");
    // Das Bild ist kein Titelbild und kein Link zur Grossansicht
    expect(html).not.toContain("bildgross");
    expect(html).toContain('href="/website/medien.css"');
    expect(html).not.toContain("lichtkasten");
    // Standard: Text unten
    const unten = seite(
      dok(b("bildtext", { mediumId: ids[0], titel: "T" })),
      daten,
    );
    expect(unten).toContain('class="bildtext bildtext--unten"');
    expect(unten).toContain("<h2 ");
  });

  test("Bildvergleich: beide Bilder mit Bezeichnung, eigene Bezeichnungen maskiert, Skript nur hier", () => {
    const { ids, daten } = medien(2);
    const html = seite(
      dok(
        b("bildvergleich", {
          bilder: bilder(ids),
          nachherText: `Heute ${BOESE}`,
          unterschrift: "Der Lagerplatz",
        }),
      ),
      daten,
    );
    expect(html).toContain('<figure class="vergleich">');
    expect(html).toContain('<figure class="v-vorher">');
    expect(html).toContain("<figcaption>Vorher</figcaption>");
    expect(html).toContain(
      "<figcaption>Heute &lt;x-boese a=&quot;1&quot;&gt;</figcaption>",
    );
    expect(html).toContain(
      '<figcaption class="vergleich-text">Der Lagerplatz</figcaption>',
    );
    expect(html).not.toContain("<x-boese");
    expect(html).toContain('src="/website/vergleich.js" defer');
    // Ohne Skript sind beide Bilder da und kein Schieber im Markup
    expect(html).not.toContain("<input");
    // Fehlt ein Bild, entfällt der Baustein
    const halb: Daten = {
      ...daten,
      medien: new Map([[ids[0]!, bildDaten("A")]]),
    };
    expect(
      seite(dok(b("bildvergleich", { bilder: bilder(ids) })), halb),
    ).not.toContain("vergleich-bilder");
    const ohne = seite(dok(b("trenner", { art: "linie" })));
    expect(ohne).not.toContain("vergleich.js");
    expect(ohne).not.toContain("medien.css");
  });

  test("Logo-Reihe: Link nur um Logos mit Adresse, Alt-Text vom Medium, Darstellung als Klasse", () => {
    const { ids, daten } = medien(3);
    const html = seite(
      dok(
        b("logoreihe", {
          darstellung: "grau",
          bilder: [
            { mediumId: ids[0], link: "https://www.example.org/" },
            { mediumId: ids[1], link: "/partner" },
            { mediumId: ids[2] },
          ],
        }),
      ),
      daten,
    );
    expect(html).toContain(
      '<ul class="logoreihe logoreihe--grau" role="list">',
    );
    expect(html).toContain(
      `<a href="https://www.example.org/" rel="noopener noreferrer" class="logo-kachel"><img src="/api/v1/medien/${ids[0]}" alt="Bild 1"`,
    );
    expect(html).toContain('<a href="/partner" class="logo-kachel">');
    expect(html).toContain('<span class="logo-kachel"><img');
    // Ein Link auf eine fremde Seite sagt das auch Screenreadern
    expect(html).toContain('<span class="nur-sr"> (externe Seite)</span>');
    // Logos öffnen sich nicht gross
    expect(html).not.toContain("bildgross");
    expect(html).not.toContain("lichtkasten");
  });

  test("breites Bild: Klassen für Höhe und Fokus, Unterschrift maskiert, Grossansicht", () => {
    const { ids, daten } = medien(1);
    const html = seite(
      dok(
        b("panorama", {
          mediumId: ids[0],
          hoehe: "hoch",
          fokusX: "links",
          fokusY: "unten",
          unterschrift: `Blick ${BOESE}`,
        }),
      ),
      daten,
    );
    expect(html).toContain(
      '<figure class="panorama panorama--hoch panorama--x-links panorama--y-unten"><a class="bildgross"',
    );
    expect(html).toContain(
      "<figcaption>Blick &lt;x-boese a=&quot;1&quot;&gt;</figcaption>",
    );
    expect(html).not.toContain("<x-boese");
    expect(html).toContain('src="/website/lichtkasten.js" defer');
    // Ohne Fokus gilt die Mitte
    expect(
      seite(dok(b("panorama", { mediumId: ids[0], hoehe: "niedrig" })), daten),
    ).toContain("panorama--x-mitte panorama--y-mitte");
  });

  test("Bilderpaket: Link über die strenge Prüfung, Angaben, Vorschaubild ohne doppelten Alt-Text", () => {
    const m = id();
    const daten: Daten = {
      ...keineDaten(),
      medien: new Map([[m, bildDaten("Fotos Sommerlager")]]),
    };
    const html = seite(
      dok(
        b("bilderpaket", {
          titel: "Fotos Sommerlager",
          text: `Alle <i>Fotos</i>`,
          link: "https://example.sharepoint.com/pakete/sola",
          bild: m,
          typ: "ZIP",
          anzahl: 1200,
          groesse: 250 * 1024 * 1024,
        }),
      ),
      daten,
    );
    expect(html).toContain('<div class="paket paket--bild">');
    expect(html).toContain('<h2 class="titel">Fotos Sommerlager</h2>');
    expect(html).toContain("Alle &lt;i&gt;Fotos&lt;/i&gt;");
    expect(html).toMatch(
      /<p class="paket-info">ZIP, 1(?:&#39;|’)200 Bilder, 250\.0 MB<\/p>/,
    );
    expect(html).toContain(
      '<a class="btn s" href="https://example.sharepoint.com/pakete/sola" rel="noopener noreferrer">Bilder ansehen und herunterladen<span class="nur-sr"> (externe Seite)</span></a>',
    );
    // Der Titel steht daneben: Der Alt-Text wäre doppelt
    expect(html).toMatch(/<div class="paket-bild"><img [^>]*alt=""/);
    // Ohne Vorschaubild: nur der Text
    const ohne = seite(
      dok(
        b("bilderpaket", {
          titel: "Paket",
          link: "https://example.sharepoint.com/x",
        }),
      ),
    );
    expect(ohne).toContain('<div class="paket">');
    expect(ohne).not.toContain("paket-bild");
    expect(ohne).not.toContain("paket-info");
  });

  test("Video: mit Vorschaubild eine Karte als Link, nie eine Wiedergabe; ohne Bild wie bisher", () => {
    const m = id();
    const daten: Daten = {
      ...keineDaten(),
      medien: new Map([[m, bildDaten("Zelte im Wald")]]),
    };
    const video = (extra: object = {}) =>
      b("videolink", {
        art: "video",
        beschriftung: `Rückblick ${BOESE}`,
        url: "https://www.video.example.org/w/abc?x=1&y=2",
        ...extra,
      });
    const mit = seite(dok(video({ bild: m })), daten);
    expect(mit).toContain(
      '<a href="https://www.video.example.org/w/abc?x=1&amp;y=2" rel="noopener noreferrer" class="videokarte">',
    );
    expect(mit).toContain(
      '<span class="video-start" aria-hidden="true"></span>',
    );
    expect(mit).toContain(
      "<strong>Rückblick &lt;x-boese a=&quot;1&quot;&gt;</strong>",
    );
    expect(mit).toContain(
      '<span class="video-quelle">Video auf video.example.org</span>',
    );
    expect(mit).toContain('href="/website/medien.css"');
    expect(mit).not.toContain("<x-boese");
    // Nie eingebettet
    expect(mit).not.toMatch(/<(iframe|video|embed|object|audio)/);
    const social = seite(dok(video({ bild: m, art: "social" })), daten);
    expect(social).toContain("Beitrag auf video.example.org");
    // Ohne Vorschaubild oder mit einem fehlenden: die Zeile mit dem Link, ohne Stil
    for (const html of [
      seite(dok(video())),
      seite(dok(video({ bild: id() }))),
    ]) {
      expect(html).toContain(
        '<p><a href="https://www.video.example.org/w/abc?x=1&amp;y=2" rel="noopener noreferrer" class="verweis">',
      );
      expect(html).not.toContain("videokarte");
    }
    // (Mit einem Bild, das es nicht gibt, lädt die Seite den Stil trotzdem: Sie kennt die Medien erst beim Erzeugen)
    expect(seite(dok(video()))).not.toContain("medien.css");
  });

  test("geschützte Bausteine stehen nicht im HTML, die Seite lädt aber Stil und Skript für das Nachladen", () => {
    const { ids, daten } = medien(2);
    const html = seite(
      dok(
        b(
          "bildvergleich",
          { bilder: bilder(ids), unterschrift: "GEHEIM-UNTERSCHRIFT" },
          { sichtbarkeit: { art: "angemeldet" } },
        ),
        b(
          "bildraster",
          { spalten: 2, format: "quer", bilder: bilder(ids) },
          { sichtbarkeit: { art: "angemeldet" } },
        ),
      ),
      daten,
    );
    expect(html).not.toContain("GEHEIM-UNTERSCHRIFT");
    expect(html).not.toContain("v-vorher");
    expect(html).not.toContain("bildraster");
    expect(html).not.toContain(ids[0]!);
    expect(zaehle(html, "data-geschuetzt")).toBe(2);
    expect(html).toContain('src="/website/vergleich.js" defer');
    expect(html).toContain('href="/website/medien.css"');
    expect(html).toContain('src="/website/lichtkasten.js" defer');
  });

  test("die Hülle lädt Stil und Skript immer, für ein später nachgeladenes Bildraster oder einen Vergleich", () => {
    const huelle = rendereHuelle("/x", {
      abteilung: "Cevi Test",
      basisUrl: "https://www.example.org",
      navigation: [],
      daten: keineDaten(),
    });
    expect(huelle).toContain('href="/website/medien.css"');
    expect(huelle).toContain('src="/website/vergleich.js" defer');
    expect(huelle).toContain('src="/website/lichtkasten.js" defer');
  });

  test("das Nachladen liefert Knoten, die das Skript für geschützte Bausteine unverändert baut (Gruppe, Name, Klassen)", () => {
    const { ids, daten } = medien(3);
    const [e] = rendereGeschuetzte(
      dok(b("bildstreifen", { bilder: bilder(ids) })),
      id(),
      daten,
      () => true,
    );
    // Ein Minimaldokument für das DOM: nur Elemente und Attribute, die baueKnoten durchlässt
    const erzeugt: {
      tag: string;
      attrs: Record<string, string>;
      kinder: unknown[];
    }[] = [];
    const doc = {
      createTextNode: (t: string) => t,
      createElement: (tag: string) => {
        const k = {
          tag,
          attrs: {} as Record<string, string>,
          kinder: [] as unknown[],
          setAttribute(n: string, w: string) {
            this.attrs[n] = w;
          },
          appendChild(c: unknown) {
            this.kinder.push(c);
          },
        };
        erzeugt.push(k);
        return k;
      },
    };
    baueKnoten(doc, e!.knoten);
    const gruppe = erzeugt.find((k) => k.tag === "div")!;
    expect(gruppe.attrs.role).toBe("group");
    expect(gruppe.attrs["aria-label"]).toBe("Bildstreifen mit 3 Bildern");
    expect(gruppe.attrs.class).toBe("bildstreifen");
    expect(erzeugt.find((k) => k.tag === "ul")!.attrs.role).toBe("list");
    expect(erzeugt.filter((k) => k.tag === "img")).toHaveLength(3);
    expect(erzeugt.filter((k) => k.tag === "a")).toHaveLength(3);
  });

  test("keine Skripte oder Stile von aussen, kein style-Attribut, kein rohes HTML in keinem der neuen Bausteine", () => {
    const { ids, daten } = medien(4);
    const html = seite(
      dok(
        b("bildraster", { spalten: 4, format: "hoch", bilder: bilder(ids) }),
        b("bildtext", { mediumId: ids[0], titel: BOESE, text: BOESE }),
        b("bildvergleich", { bilder: bilder(ids.slice(0, 2)) }),
        b("logoreihe", { darstellung: "farbig", bilder: bilder(ids) }),
        b("panorama", {
          mediumId: ids[1],
          hoehe: "mittel",
          unterschrift: BOESE,
        }),
        b("bildstreifen", { bilder: bilder(ids.slice(1)) }),
        b("bilderpaket", {
          titel: BOESE,
          link: "https://example.sharepoint.com/a",
        }),
      ),
      daten,
    );
    expect(html).not.toContain("<x-boese");
    expect(html).not.toContain("style=");
    expect(html).not.toMatch(/\son[a-z]+=/);
    // Alle Bilder und Stile kommen von der eigenen Herkunft
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const w = m[1]!;
      if (w.startsWith("https://")) {
        // Nur das Ziel eines Links (Paket) und die Adresse der Seite (canonical)
        expect(w).toMatch(
          /^https:\/\/(www\.example\.org|example\.sharepoint\.com)/,
        );
      }
    }
    expect(zaehle(html, "<script")).toBeLessThanOrEqual(7);
  });
});

describe("Stil und Skript", () => {
  const css = lies("medien.css");
  // Ohne die Zeilen mit Kommentar: Sie nennen die verbotenen Dinge beim Namen
  const js = lies("vergleich.js").replace(/^\s*\/\/.*$/gm, "");

  test("nirgends ein style-Attribut, nie eine Farbe als Hex ausser Weiss und Schwarz auf Bildern", () => {
    const ohneKommentare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const hex of ohneKommentare.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
      expect(["#fff", "#ffffff"], hex).toContain(hex.toLowerCase());
    }
    // Gar kein Aufruf, der ein style-Attribut setzt
    expect(js).not.toMatch(/setAttribute\(\s*["']style/);
    expect(js).not.toMatch(/cssText/);
    expect(js).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/,
    );
    expect(js).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
  });

  test("Fokus sichtbar auf dem dunklen Verlauf, erzwungene Farben, reduzierte Bewegung, kein Scrollleistenstil", () => {
    expect(css).toMatch(
      /\.bildtext :focus-visible \{\s*outline-color: var\(--bt-text\)/,
    );
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(css).not.toMatch(/scrollbar-color|::-webkit-scrollbar/);
    // Keine eigene Fassung der Links und Knöpfe: nur Bausteinklassen
    expect(css).not.toMatch(/^a(:hover)? \{/m);
    expect(css).not.toMatch(/^a?\.btn(\.[pstw]|\.gross)?(:hover)? \{/m);
    // Der Bildvergleich bleibt ohne Skript vollständig: Die Überlagerung gilt nur mit v-aktiv
    expect(css).toContain(".vergleich.v-aktiv .v-vorher");
    expect(css).not.toMatch(/^\.v-vorher \{/m);
  });

  test("der Schieber ist ein Bereichsfeld mit Namen und Wert für Screenreader, mit Pfeiltasten bedienbar", () => {
    expect(js).toContain('regler.type = "range"');
    expect(js).toContain('"aria-label"');
    expect(js).toContain('"aria-valuetext"');
    expect(js).toContain("ArrowLeft");
    expect(js).toContain("ArrowRight");
    expect(js).toContain("MutationObserver");
    expect(js).toContain('setProperty("--v-pos"');
  });

  test("das Skript rüstet einen Vergleich aus, ohne ihn doppelt auszurüsten", () => {
    // Minimale DOM-Attrappe: genug für den Ablauf des Skripts
    type K = {
      tag: string;
      className: string;
      children: K[];
      attrs: Record<string, string>;
      style: {
        props: Record<string, string>;
        setProperty(n: string, w: string): void;
      };
      listeners: Record<string, ((e: unknown) => void)[]>;
      classList: {
        s: Set<string>;
        add(n: string): void;
        contains(n: string): boolean;
      };
      [k: string]: unknown;
    };
    const kind = (tag: string): K => {
      const s = new Set<string>();
      const k: K = {
        tag,
        className: "",
        children: [],
        attrs: {},
        style: {
          props: {},
          setProperty(n, w) {
            this.props[n] = w;
          },
        },
        listeners: {},
        classList: {
          s,
          add: (n) => void s.add(n),
          contains: (n) => s.has(n),
        },
        setAttribute(n: string, w: string) {
          k.attrs[n] = w;
        },
        appendChild(c: K) {
          k.children.push(c);
          return c;
        },
        addEventListener(n: string, f: (e: unknown) => void) {
          (k.listeners[n] ??= []).push(f);
        },
        querySelector(sel: string) {
          return sel === ".v-vorher figcaption"
            ? { textContent: "Früher" }
            : sel === ".v-nachher figcaption"
              ? { textContent: "Heute" }
              : sel === ".vergleich-bilder"
                ? bilder
                : null;
        },
      };
      return k;
    };
    const bilder = kind("div");
    const wurzel = kind("figure");
    wurzel.querySelector = (sel: string) =>
      sel === ".vergleich-bilder" ? bilder : null;
    bilder.querySelector = (sel: string) =>
      sel === ".v-vorher figcaption"
        ? { textContent: "Früher" }
        : sel === ".v-nachher figcaption"
          ? { textContent: "Heute" }
          : null;
    const dokument = {
      body: kind("body"),
      documentElement: kind("html"),
      createElement: kind,
      querySelectorAll: () => [wurzel],
    };
    new Function("window", "document", js)(
      { MutationObserver: undefined },
      dokument,
    );
    const regler = bilder.children.find((c) => c.className === "v-regler")!;
    expect(regler.type).toBe("range");
    expect(regler.attrs["aria-label"]).toBe(
      "Schieber: Früher und Heute vergleichen",
    );
    expect(regler.attrs["aria-valuetext"]).toBe(
      "50 Prozent Früher, 50 Prozent Heute",
    );
    expect(bilder.style.props["--v-pos"]).toBe("50%");
    expect(wurzel.classList.contains("v-aktiv")).toBe(true);
    // Pfeil nach rechts: 5 Prozent mehr «Vorher»
    let verhindert = false;
    regler.listeners.keydown![0]!({
      key: "ArrowRight",
      preventDefault: () => (verhindert = true),
    });
    expect(verhindert).toBe(true);
    expect(regler.value).toBe("55");
    expect(bilder.style.props["--v-pos"]).toBe("55%");
    // Ein Wert am Rand bleibt im Bereich
    regler.value = "98";
    regler.listeners.keydown![0]!({ key: "ArrowRight", preventDefault() {} });
    expect(regler.value).toBe("100");
    // Zweiter Aufruf rüstet nicht noch einmal aus
    const vorher = bilder.children.length;
    new Function("window", "document", js)(
      { MutationObserver: undefined },
      dokument,
    );
    expect(bilder.children.length).toBe(vorher);
  });
});

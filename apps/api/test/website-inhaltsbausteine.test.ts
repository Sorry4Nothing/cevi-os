import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { ladeSeiten } from "../src/seiten.js";
import {
  pruefeDokument,
  sammleVerweise,
  type Seitendokument,
} from "../src/website/dokument.js";
import {
  keineDaten,
  rendereGeschuetzte,
  rendereSeite,
  type Daten,
} from "../src/website/rendern.js";

// Bausteine der Inhaltsseiten (#560): Personen, Artikel, Link und Anmeldung der Eckdaten; dazu Anker, verborgene Seiten und der Weg vom Termin zur Seite

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
const seite = (
  d: Seitendokument,
  daten: Daten = keineDaten(),
  seiteId = id(),
) =>
  rendereSeite(
    { id: seiteId, pfad: "/seite", dokument: d },
    {
      abteilung: "Cevi Test",
      basisUrl: "https://www.example.org",
      navigation: [],
      daten,
    },
  );
const bildDaten = (altText: string | null) => ({
  mimeTyp: "image/jpeg",
  groesse: 1000,
  breite: 400,
  hoehe: 300,
  altText,
});

describe("Schema", () => {
  test("gültige Bausteine", () => {
    expect(
      pruefe(
        b("eckdaten", {
          eintraege: [
            { bezeichnung: "Datum", wert: "Sa 6. Juni 2026" },
            {
              bezeichnung: "Kontakt",
              wert: "lager@example.org",
              link: "mailto:lager@example.org",
            },
          ],
        }),
        b("personen", {
          eintraege: [
            {
              name: "Beispiel v/o Muster",
              funktion: "Stufenleitung",
              email: "stufe@example.org",
              mediumId: id(),
            },
          ],
        }),
        b("artikel", {
          eintraege: [
            { name: "Pulli", preis: "CHF 40.–", hinweis: "Nur mit Prüfung" },
          ],
        }),
      ).ok,
    ).toBe(true);
  });

  test.each([
    [
      "eckdaten mit javascript-Link",
      b("eckdaten", {
        eintraege: [
          { bezeichnung: "a", wert: "b", link: "javascript:alert(1)" },
        ],
      }),
    ],
    ["personen ohne Einträge", b("personen", { eintraege: [] })],
    [
      "personen mit ungültiger E-Mail",
      b("personen", { eintraege: [{ name: "A", email: "keine adresse" }] }),
    ],
    // Bewusst kein Feld für eine Telefonnummer
    [
      "personen mit Telefon",
      b("personen", { eintraege: [{ name: "A", telefon: "079 000 00 00" }] }),
    ],
    ["artikel ohne Name", b("artikel", { eintraege: [{ preis: "CHF 1.–" }] })],
    [
      "artikel mit Medium, das keine UUID ist",
      b("artikel", { eintraege: [{ name: "A", mediumId: "x" }] }),
    ],
    // Personen sind ein eigener Baustein, keine Darstellung der Karten
    [
      "karten mit Darstellung personen",
      b("karten", { darstellung: "personen", eintraege: [{ titel: "A" }] }),
    ],
  ])("ungültig: %s", (_name, baustein) => {
    expect(pruefe(baustein).ok).toBe(false);
  });

  test("Verweise: Bilder von Personen und Artikeln, Seiten der Eckdaten", () => {
    const [m1, m2] = [id(), id()];
    const v = sammleVerweise(
      dok(
        b("personen", { eintraege: [{ name: "A", mediumId: m1 }] }),
        b("artikel", {
          eintraege: [{ name: "B", mediumId: m2 }, { name: "C" }],
        }),
        b("eckdaten", {
          eintraege: [{ bezeichnung: "Mehr", wert: "Lager", link: "/lager#x" }],
        }),
      ),
    );
    expect(v.medien.sort()).toEqual([m1, m2].sort());
    expect(v.seiten).toEqual(["/lager"]);
  });
});

describe("Renderer", () => {
  const eckdaten = b("eckdaten", {
    eintraege: [
      { bezeichnung: "Datum", wert: BOESE },
      {
        bezeichnung: "Kontakt",
        wert: "lager@example.org",
        link: "mailto:lager@example.org",
      },
    ],
  });

  test("Eckdaten: der Wert kann ein Link sein; ohne Anlass keine Schaltfläche", () => {
    const html = seite(dok(eckdaten));
    expect(html).toContain(
      '<dl class="fakten karte"><div class="fakt"><dt>Datum</dt><dd>&lt;x-boese a=&quot;1&quot;&gt;</dd></div><div class="fakt"><dt>Kontakt</dt><dd><a href="mailto:lager@example.org">lager@example.org</a></dd></div></dl>',
    );
    expect(html).not.toContain("<x-boese");
    expect(html).not.toContain("Zur Anmeldung");
  });

  test("gehört die Seite zu einem Anlass, führt eine Schaltfläche unter den Eckdaten zur Anmeldung", () => {
    const seiteId = id();
    const anlassId = id();
    const html = seite(
      dok(eckdaten),
      { ...keineDaten(), anlaesse: new Map([[seiteId, anlassId]]) },
      seiteId,
    );
    expect(html).toContain(
      `</dl><a class="btn p gross voll" href="/anlass?id=${anlassId}">Zur Anmeldung</a></div>`,
    );
  });

  test("Personen: Foto ohne Alt-Text, sonst Initialen; die Adresse ist ein mailto-Link", () => {
    const foto = id();
    const html = seite(
      dok(
        b("ueberschrift", { ebene: 2, text: "Leitung" }),
        b("personen", {
          eintraege: [
            {
              name: "Anna Muster v/o Flink",
              funktion: "Stufenleitung",
              email: "flink@example.org",
              mediumId: foto,
            },
            { name: `${BOESE} Beat Beispiel`, mediumId: id() },
          ],
        }),
      ),
      { ...keineDaten(), medien: new Map([[foto, bildDaten("Porträt")]]) },
    );
    expect(html).toMatch(
      new RegExp(
        `<ul class="personen"><li class="einblenden"><span class="portraet-rahmen"><img class="portraet" src="/api/v1/medien/${foto}" alt="" width="400" height="300"[^>]*></span><h3 class="titel">Anna Muster v/o Flink</h3><p>Stufenleitung</p><p class="adresse"><a href="mailto:flink@example.org">flink@example.org</a></p></li>`,
      ),
    );
    // Das zweite Bild gibt es nicht (oder es ist nicht öffentlich): Initialen
    expect(html).toContain(
      '<span class="portraet portraet--leer" aria-hidden="true">XA</span>',
    );
    expect(html).not.toContain("<x-boese");
  });

  test("Artikel: Bild, Name und Preis in einer Karte; der Alt-Text entfällt, wenn er nur den Namen wiederholt", () => {
    const [gleich, anders] = [id(), id()];
    const html = seite(
      dok(
        b("artikel", {
          eintraege: [
            { name: "Pulli", preis: "CHF 40.–", mediumId: gleich },
            { name: "Messer", hinweis: BOESE, mediumId: anders },
            { name: "Ausweis", preis: "gratis" },
          ],
        }),
      ),
      {
        ...keineDaten(),
        medien: new Map([
          [gleich, bildDaten("pulli")],
          [anders, bildDaten("Rotes Sackmesser")],
        ]),
      },
    );
    expect(html).toContain(
      `<li class="einblenden"><div class="artikel-bild"><img src="/api/v1/medien/${gleich}" alt=""`,
    );
    expect(html).toContain('alt="Rotes Sackmesser"');
    expect(html).toContain(
      '<div class="artikel-text"><h2 class="name">Pulli</h2><p class="preis">CHF 40.–</p></div>',
    );
    expect(html).toContain(
      '<li class="einblenden"><div class="artikel-bild artikel-bild--leer"></div><div class="artikel-text"><h2 class="name">Ausweis</h2><p class="preis">gratis</p></div></li>',
    );
    expect(html).not.toContain("<x-boese");
  });

  test("der Stil der Inhaltsbausteine steht nur auf Seiten mit einem solchen Baustein", () => {
    const link = '<link rel="stylesheet" href="/website/inhalt.css">';
    expect(seite(dok(b("artikel", { eintraege: [{ name: "a" }] })))).toContain(
      link,
    );
    expect(
      seite(dok(b("ueberschrift", { ebene: 2, text: "Ohne" }))),
    ).not.toContain(link);
    // Die Datei gibt es, und die Vorschau der Verwaltung trägt sie in ihrem Stil
    const css = readFileSync(
      new URL("../public/website/inhalt.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain(".artikel");
    expect(ladeSeiten().admin["website-vorschau.css"]).toContain(css);
  });

  test("geschützte Inhaltsbausteine lassen sich nachladen", () => {
    const d = dok(
      b(
        "artikel",
        { eintraege: [{ name: "Pulli" }] },
        { sichtbarkeit: { art: "angemeldet" } },
      ),
    );
    expect(seite(d)).not.toContain("Pulli");
    const [k] = rendereGeschuetzte(d, id(), keineDaten(), () => true);
    expect(JSON.stringify(k?.knoten)).toContain("Pulli");
  });
});

describe("Zeitstrahl als Geschichte in Stationen", () => {
  test("Station mit Foto und ohne; der Abschnitt ist das blaue Band über die ganze Breite", () => {
    const foto = id();
    const html = seite(
      dok(
        b("ueberschrift", { ebene: 2, text: "Geschichte" }),
        b("karten", {
          darstellung: "zeitstrahl",
          eintraege: [
            { titel: "2008", text: "Gründung.", bild: foto },
            { titel: "2013", text: BOESE, bild: id() },
            { titel: "2014" },
          ],
        }),
      ),
      { ...keineDaten(), medien: new Map([[foto, bildDaten("Gruppenbild")]]) },
    );
    expect(html).toContain(
      '<section class="sektion sektion--marke sektion--breit">',
    );
    expect(html).toMatch(
      new RegExp(
        `<ol class="zeitstrahl"><li class="station station--bild"><figure class="station-bild"><img src="/api/v1/medien/${foto}" alt="Gruppenbild"[^>]*></figure><div class="station-text"><p class="jahr">2008</p><p>Gründung.</p></div></li>`,
      ),
    );
    // Ein Bild, das es nicht gibt (oder das nicht öffentlich ist): Station ohne Foto
    expect(html).toContain(
      '<li class="station"><div class="station-text"><p class="jahr">2013</p><p>&lt;x-boese a=&quot;1&quot;&gt;</p></div></li>',
    );
    expect(html).toContain(
      '<li class="station"><div class="station-text"><p class="jahr">2014</p></div></li>',
    );
    expect(html).not.toContain("<x-boese");
  });
});

describe("Anker und verborgene Seiten", () => {
  test("Überschriften der Ebene 2 bekommen eine id aus ihrem Text; doppelte werden gezählt", () => {
    const html = seite(
      dok(
        b("ueberschrift", { ebene: 2, text: "Unsere Lager" }),
        b("ueberschrift", { ebene: 3, text: "Unter" }),
        b("ueberschrift", { ebene: 2, text: "Unsere Lager" }),
        b("ueberschrift", { ebene: 2, text: "Grösse & Übung" }),
        b("ueberschrift", { ebene: 2, text: "Inhalt" }),
        b("ueberschrift", { ebene: 2, text: "«»" }),
      ),
    );
    expect(html).toContain('<h2 id="unsere-lager">Unsere Lager</h2>');
    expect(html).toContain("<h3>Unter</h3>");
    expect(html).toContain('<h2 id="unsere-lager-2">Unsere Lager</h2>');
    expect(html).toContain('<h2 id="groesse-uebung">Grösse &amp; Übung</h2>');
    // «inhalt» gehört dem Rahmen der Seite
    expect(html).toContain('<h2 id="inhalt-2">Inhalt</h2>');
    expect(html).toContain("<h2>«»</h2>");
  });

  test("Karten mit Link auf eine verborgene Seite entfallen, der ganze Baustein, wenn keine bleibt", () => {
    const karten = (darstellung: string) =>
      b("karten", {
        darstellung,
        eintraege: [
          { titel: "Offen", link: "/offen" },
          { titel: "Geheim", link: "/intern#teil" },
          { titel: "Fremd", link: "https://www.example.org/intern" },
        ],
      });
    const daten = { ...keineDaten(), verborgen: new Set(["/intern"]) };
    for (const art of ["karten", "liste"]) {
      const html = seite(dok(karten(art)), daten);
      expect(html).toContain("Offen");
      expect(html).toContain("Fremd");
      expect(html).not.toContain("Geheim");
      // Ohne die Angabe (Vorschau, Nachladen für Angemeldete) bleibt alles
      expect(seite(dok(karten(art)))).toContain("Geheim");
    }
    const nur = seite(
      dok(
        b("karten", {
          darstellung: "karten",
          eintraege: [{ titel: "Geheim", link: "/intern" }],
        }),
      ),
      daten,
    );
    expect(nur).not.toContain("Geheim");
    expect(nur).not.toContain('class="karten"');
  });

  test("ein Termin führt auf die Seite seines Anlasses, sonst auf die Anmeldung", () => {
    const liste = id();
    const [a1, a2] = [id(), id()];
    const termin = (titel: string, anlassId: string, seitePfad?: string) => ({
      id: id(),
      titel,
      von: "2030-06-01",
      bis: "2030-06-01",
      zeitVon: null,
      zeitBis: null,
      ort: null,
      stufen: [],
      anlassId,
      ...(seitePfad && { seitePfad }),
    });
    const html = seite(
      dok({ id: liste, typ: "terminliste", daten: { anzahl: 3 } }),
      {
        ...keineDaten(),
        termine: new Map([
          [
            liste,
            [termin("Mit Seite", a1, "/anlaesse/fest"), termin("Ohne", a2)],
          ],
        ]),
      },
    );
    expect(html).toContain('href="/anlaesse/fest"');
    expect(html).not.toContain(`/anlass?id=${a1}`);
    expect(html).toContain(`href="/anlass?id=${a2}"`);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// Reine Browser-Module ohne Typen: Die Ansichten sind Funktionen von Daten zu Beschreibungen (h) und laufen ohne DOM
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as tm from "../public/website/tm.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as laden from "../public/website/laden.js";

// Lädeli im Browser (#566): Besucher sehen den Laden zum Ansehen, Warenkorb und Bestellen gibt es nur mit Konto
const html = tm.html as (d: unknown) => string;

const artikel = (extra: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Foulard",
  preisRappen: 2500,
  varianten: [] as string[],
  nichtVerfuegbar: [] as string[],
  hinweis: "Aus Baumwolle",
  verfuegbar: true,
  bild: null,
  platz: 0,
  ...extra,
});
const zustand = (konto: string, a = artikel()) => ({
  artikel: new Map([[a.id, a]]),
  korb: [],
  grenzen: { positionen: 20, menge: 10 },
  uebergabearten: ["Abholung im Lädeli"],
  konto,
  pfad: "/ueber-uns/laedeli",
});
const wahl = (a = artikel()) => ({ artikel: a, variante: null, menge: 1 });

describe("Artikelfenster", () => {
  test("Besucher: Foto, Name, Preis und Beschreibung, dazu der Weg zur Anmeldung; kein Warenkorb, keine Menge", () => {
    const a = artikel();
    const s = html(laden.artikelView(a, wahl(a), zustand("aus", a)));
    expect(s).toContain("Foulard");
    expect(s).toContain("CHF 25.–");
    expect(s).toContain("Aus Baumwolle");
    expect(s).toContain("Zum Bestellen anmelden");
    expect(s).toContain("/anmelden?weiter=%2Fueber-uns%2Flaedeli");
    expect(s).not.toContain('data-aktion="dazu"');
    expect(s).not.toContain("laden-menge");
    expect(s).not.toContain("In den Warenkorb");
  });

  test("Besucher sehen die Grössen als Text, ohne Wahl", () => {
    const a = artikel({ varianten: ["S", "M"] });
    const s = html(laden.artikelView(a, wahl(a), zustand("aus", a)));
    expect(s).toContain("Grössen: S, M");
    expect(s).not.toContain('data-aktion="variante"');
  });

  test("nicht verfügbare Grössen (#629): sichtbar, durchgestrichen, nicht anwählbar, mit Wort; Besucher lesen sie im Text", () => {
    const a = artikel({ varianten: ["S", "M", "L"], nichtVerfuegbar: ["S"] });
    const an = html(laden.artikelView(a, wahl(a), zustand("an", a)));
    const knopf = (s: string, v: string) =>
      s.match(
        new RegExp(`<button[^>]*data-variante="${v}"[^>]*>.*?</button>`),
      )![0];
    expect(knopf(an, "S")).toContain('aria-disabled="true"');
    expect(knopf(an, "S")).toContain("<s>S</s>");
    expect(knopf(an, "S")).toContain("nicht verfügbar");
    expect(an).toContain("S nicht verfügbar");
    expect(knopf(an, "M")).not.toContain("aria-disabled");
    const aus = html(laden.artikelView(a, wahl(a), zustand("aus", a)));
    expect(aus).toContain("Grössen: M, L");
    expect(aus).toContain("S nicht verfügbar");
    // Schnell dazu: dieselbe Regel in der Kachel
    const schnell = html(laden.schnellView(a, undefined));
    expect(schnell.match(/aria-disabled="true"/g)).toHaveLength(1);
    expect(schnell).toContain("<s>S</s>");
  });

  test("Warenkorb: eine Zeile mit einer inzwischen nicht verfügbaren Grösse wird gemeldet und sperrt das Bestellen", () => {
    const a = artikel({ varianten: ["S", "M"], nichtVerfuegbar: ["S"] });
    const z = {
      ...zustand("an", a),
      korb: [{ id: a.id, variante: "S", menge: 1 }],
    };
    expect(laden.weggefallen(z.korb, z.artikel)).toHaveLength(1);
    const gesperrt = (s: string, aktion: string) =>
      new RegExp(
        `data-aktion="${aktion}"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*data-aktion="${aktion}"`,
      ).test(s);
    const korb = html(tm.h("div", {}, laden.korbView(z)));
    expect(korb).toContain("Die Grösse S ist nicht mehr verfügbar");
    expect(korb).toContain("laden-zeile--weg");
    expect(gesperrt(korb, "uebersicht")).toBe(true);
    expect(
      gesperrt(html(tm.h("div", {}, laden.uebersichtView(z))), "bestellen"),
    ).toBe(true);
    // Ohne betroffene Zeile bleibt alles bedienbar
    const ok = { ...z, korb: [{ id: a.id, variante: "M", menge: 1 }] };
    expect(laden.weggefallen(ok.korb, ok.artikel)).toHaveLength(0);
    expect(
      gesperrt(html(tm.h("div", {}, laden.korbView(ok))), "uebersicht"),
    ).toBe(false);
  });

  test("liesArtikel liest Name und nicht verfügbare Grössen aus dem Markup des Servers", () => {
    const li = (klasse: string, name: string, extra = "") => ({
      className: klasse,
      dataset: { name },
      textContent: `${name}${extra}`,
    });
    const eintrag = {
      dataset: { id: "x", preis: "100" },
      classList: { contains: () => false },
      querySelector: () => null,
      querySelectorAll: (sel: string) =>
        sel === ".laden-varianten li"
          ? [li("", "S", " nicht verfügbar"), li("", "M")]
          : sel.includes("laden-variante--weg")
            ? [li("laden-variante--weg", "S", " nicht verfügbar")]
            : [],
    };
    const karte = laden.liesArtikel({ querySelectorAll: () => [eintrag] });
    expect(karte.get("x")).toMatchObject({
      varianten: ["S", "M"],
      nichtVerfuegbar: ["S"],
    });
  });

  test("Angemeldet-Zeile (#638): Name oder nur «Angemeldet», dazu «Abmelden»; ohne Sitzung nichts davon", () => {
    const z = zustand("an");
    const mit = html(tm.h("div", {}, laden.kontoView({ ...z, name: "Luna" })));
    expect(mit).toContain("Angemeldet als <strong>Luna</strong>");
    expect(mit).toContain('data-aktion="abmelden"');
    expect(mit).toContain("Abmelden");
    const ohne = html(tm.h("div", {}, laden.kontoView({ ...z, name: null })));
    expect(ohne).toContain("Angemeldet");
    expect(ohne).not.toContain("Angemeldet als");
    // Fehler beim Abmelden ist ein Toast (#762), kein Text in der Zeile
    expect(
      html(
        tm.h(
          "div",
          {},
          laden.kontoView({ ...z, kontoFehler: "Nicht geklappt." }),
        ),
      ),
    ).not.toContain("Nicht geklappt.");
    // Ohne Sitzung: keine Zeile, keine Bedienelemente; nach Ablauf ein Hinweis
    const aus = zustand("aus");
    expect(laden.kontoView(aus)).toBeNull();
    const hinweis = html(
      tm.h(
        "div",
        {},
        laden.kontoView({
          ...aus,
          sitzungsHinweis: { titel: "Du bist nicht mehr angemeldet." },
        }),
      ),
    );
    expect(hinweis).toContain("Du bist nicht mehr angemeldet.");
    expect(hinweis).not.toContain('data-aktion="abmelden"');
  });

  test("Sitzung (#638): Ende bei 401, Neuladen bei neuer Sitzung, sonst Zustand halten; der Zustand ohne Sitzung hat keinen Korb", () => {
    expect(laden.kontoSchritt("an", 401)).toBe("ende");
    expect(laden.kontoSchritt("an", 200)).toBe("bleibt");
    expect(laden.kontoSchritt("an", 0)).toBe("bleibt");
    expect(laden.kontoSchritt("an", 500)).toBe("bleibt");
    expect(laden.kontoSchritt("aus", 200)).toBe("neu");
    expect(laden.kontoSchritt("aus", 401)).toBe("bleibt");
    expect(laden.OHNE_SITZUNG).toMatchObject({
      konto: "aus",
      name: null,
      korb: [],
      bestaetigt: null,
    });
    // Ohne Sitzung zeigt der Kopf nur den Weg zur Anmeldung, nie den Warenkorb
    const kopf = html(tm.h("div", {}, laden.anmeldeView(zustand("aus"))));
    expect(kopf).toContain("Zum Bestellen anmelden");
    expect(kopf).not.toContain("Warenkorb");
  });

  test("Quelltext (#638): Speicher nur mit Sitzung, Sitzungsende bei 401 und nach Zurück-Taste", () => {
    const js = readFileSync("public/website/laden.js", "utf8");
    // Der Korb wird nur mit Sitzung geschrieben
    expect(js).toMatch(
      /if \(z\.konto === "an"\)\s+setze\("localStorage", SPEICHER/,
    );
    // Beim Bestellen, Stornieren und Laden der Bestellungen beendet 401 die Sitzung im Browser
    expect(js.match(/r\.status === 401/g)!.length).toBeGreaterThanOrEqual(4);
    expect(js).toContain("function sitzungEnde");
    expect(js).toContain('setze("localStorage", SPEICHER, null)');
    // Zurück-Taste (bfcache) und Rückkehr in den Tab fragen neu
    expect(js).toContain('"pageshow"');
    expect(js).toContain('"visibilitychange"');
    // Abmelden über die bestehende Auth-Route
    expect(js).toContain("/api/auth/sign-out");
  });

  test("angemeldet: Menge und «In den Warenkorb», kein Anmelde-Hinweis", () => {
    const a = artikel();
    const s = html(laden.artikelView(a, wahl(a), zustand("an", a)));
    expect(s).toContain('data-aktion="dazu"');
    expect(s).toContain("laden-menge");
    expect(s).not.toContain("Zum Bestellen anmelden");
  });

  test("Einheitsgrösse: keine Variantenwahl; mit Liste die Wahl", () => {
    const einheit = artikel();
    expect(
      html(laden.artikelView(einheit, wahl(einheit), zustand("an", einheit))),
    ).not.toContain('data-aktion="variante"');
    const liste = artikel({ varianten: ["S", "M"] });
    expect(
      html(laden.artikelView(liste, wahl(liste), zustand("an", liste))),
    ).toContain('data-aktion="variante"');
  });

  test("solange unklar ist, ob jemand angemeldet ist, zeigt es weder Bedienelemente noch Hinweis", () => {
    const a = artikel();
    const s = html(laden.artikelView(a, wahl(a), zustand("unbekannt", a)));
    expect(s).not.toContain('data-aktion="dazu"');
    expect(s).not.toContain("anmelden");
  });
});

describe("Kopf und Kachel", () => {
  test("der Hinweis für Besucher ist ein Link zur Anmeldung mit Rückweg", () => {
    const s = html(laden.anmeldeView(zustand("aus")));
    expect(s).toContain('href="/anmelden?weiter=%2Fueber-uns%2Flaedeli"');
    expect(s).toContain('data-aktion="anmelden"');
  });

  test("schnelles Hinzufügen bei Einheitsgrösse: ein Knopf ohne Varianten", () => {
    const s = html(laden.schnellView(artikel(), undefined));
    expect(s.match(/data-aktion="schnell"/g)).toHaveLength(1);
    expect(s).toContain("In den Warenkorb");
  });

  test("das Plus in der Kachel gibt es nur auf Geräten ohne Zeigen", () => {
    const css = readFileSync("public/website/laden.css", "utf8");
    const plus = css.match(/\.laden-plus \{[^}]*\}/)![0];
    expect(plus).toContain("display: none");
    expect(css).toMatch(
      /@media \(hover: none\) \{\s*\.laden-plus \{\s*display: grid/,
    );
  });

  test("Deine Bestellungen laden (#574): Skelett in Listenform, verborgen, ohne «Lädt …»; die Ansage kommt aus der Statusregion", () => {
    const h = html(
      tm.h(
        "div",
        {},
        laden.bestellungenView({
          zustand: "lade",
          liste: [],
          weitere: false,
          naechste: null,
        }),
      ),
    );
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('<div class="skelett" aria-hidden="true">');
    expect(h).toContain("Deine Bestellungen");
    expect(h).not.toContain("Lädt …");
  });
});

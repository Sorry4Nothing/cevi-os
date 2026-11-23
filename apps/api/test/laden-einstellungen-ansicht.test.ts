import { describe, expect, test } from "vitest";
// Reine Browser-Module ohne Typen: Die Ansichten sind Funktionen von Daten zu Beschreibungen (h) und laufen ohne DOM
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as tm from "../public/website/tm.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as laden from "../public/website/laden.js";
import { EINSTELLUNG_VORGABE } from "../src/laden/laden.js";
import { rendereLaden, type LadenArtikel } from "../src/website/laden.js";
import { keineDaten, serialisiere } from "../src/website/rendern.js";

// Lädeli (#642): Texte und Regeln der Abteilung auf der Website. Die Vorgaben sind die Texte von vor #642.
const html = tm.html as (d: unknown) => string;

describe("Vorgaben im Browser und im Server sind dieselben", () => {
  test("die Zahlen und Texte der Vorgabe stimmen überein", () => {
    const { uebergabearten: _, ...server } = EINSTELLUNG_VORGABE;
    expect(laden.EINSTELLUNG).toEqual(server);
  });
});

const artikel = (extra: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Foulard",
  preisRappen: 2500,
  varianten: [] as string[],
  nichtVerfuegbar: [] as string[],
  hinweis: null,
  verfuegbar: true,
  bild: null,
  platz: 0,
  ...extra,
});
const zustand = (einstellung: Record<string, unknown> = {}, extra = {}) => {
  const a = artikel();
  return {
    artikel: new Map([[a.id, a]]),
    korb: [{ id: a.id, variante: null, menge: 1 }],
    grenzen: { positionen: 20, menge: 10 },
    uebergabearten: ["Abholung im Lädeli"],
    uebergabe: "Abholung im Lädeli",
    konto: "an",
    senden: "ruhe",
    entfernt: null,
    meldung: null,
    bestaetigt: null,
    pfad: "/laedeli",
    einstellung,
    ...extra,
  };
};
const wahl = () => ({ artikel: artikel(), variante: null, menge: 1 });
const uebersicht = (z: unknown) =>
  html(tm.h("div", {}, laden.uebersichtView(z)));
const korb = (z: unknown) => html(tm.h("div", {}, laden.korbView(z)));
const fenster = (z: ReturnType<typeof zustand>) =>
  html(laden.artikelView(artikel(), wahl(), z));
const gesperrt = (s: string, aktion: string) =>
  new RegExp(
    `data-aktion="${aktion}"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*data-aktion="${aktion}"`,
  ).test(s);

describe("Texte der Abteilung", () => {
  test("ohne Einstellung stehen die bisherigen Texte da", () => {
    const z = zustand();
    expect(korb(z)).toContain("Bezahlt wird bei der Übergabe, nicht online.");
    expect(fenster(z)).toContain(
      "Bezahlt wird bei der Übergabe, nicht online.",
    );
    expect(uebersicht(z)).toContain("Bei der Übergabe");
    expect(uebersicht(z)).not.toContain("Mindestbestellung");
    expect(gesperrt(uebersicht(z), "bestellen")).toBe(false);
  });

  test("Hinweis zur Bezahlung, Zahlungsart und Übergabehinweis erscheinen, wo sie gedacht sind", () => {
    const z = zustand({
      bezahlhinweis: "Zahlung per TWINT am Samstag.",
      zahlungsart: "TWINT",
      uebergabehinweis: "Samstags nach dem Treffen.\nBeim Lagerhaus.",
    });
    expect(korb(z)).toContain("Zahlung per TWINT am Samstag.");
    expect(korb(z)).not.toContain("nicht online");
    expect(fenster(z)).toContain("Zahlung per TWINT am Samstag.");
    expect(fenster(z)).toContain("Samstags nach dem Treffen.");
    const u = uebersicht(z);
    expect(u).toContain("TWINT");
    expect(u).toContain("Samstags nach dem Treffen.");
    expect(u).toContain("Beim Lagerhaus.");
  });

  test("leere Texte entfallen: kein Hinweis zur Bezahlung, keine Zeile «Bezahlung»", () => {
    const z = zustand({ bezahlhinweis: "", zahlungsart: "" });
    expect(korb(z)).not.toContain("Bezahlt wird");
    expect(fenster(z)).not.toContain("Bezahlt wird");
    expect(uebersicht(z)).not.toContain("Bezahlung");
  });

  test("Bedingungen stehen in der Bestellübersicht, Text wird nie als HTML gelesen", () => {
    const z = zustand({ bedingungen: "Umtausch nur mit Beleg.\n<b>x</b>" });
    const u = uebersicht(z);
    expect(u).toContain("Umtausch nur mit Beleg.");
    expect(u).not.toContain("<b>x</b>");
    expect(u).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  test("die Bestätigung ersetzt {uebergabe}; ohne Text entfällt der Satz", () => {
    const z = zustand(
      { bestaetigung: "Danke! Abholung: {uebergabe}." },
      {
        bestaetigt: {
          uebergabe: "Am Samstag",
          summeRappen: 2500,
          positionen: [],
        },
      },
    );
    expect(uebersicht(z)).toContain("Danke! Abholung: Am Samstag.");
    const ohne = zustand(
      { bestaetigung: "" },
      {
        bestaetigt: { uebergabe: "x", summeRappen: 0, positionen: [] },
      },
    );
    expect(uebersicht(ohne)).toContain("Deine Bestellung ist eingegangen.");
    expect(uebersicht(ohne)).not.toContain("Du bezahlst");
  });
});

describe("Regeln der Abteilung", () => {
  test("Mindestbestellung: darunter Hinweis mit Fehlbetrag und gesperrter Knopf, am Wert frei", () => {
    const z = zustand({ mindestRappen: 3000 });
    const u = uebersicht(z);
    expect(u).toContain("Die Mindestbestellung beträgt CHF 30.–.");
    expect(u).toContain("Dir fehlen CHF 5.–.");
    expect(gesperrt(u, "bestellen")).toBe(true);
    const genau = zustand({ mindestRappen: 2500 });
    expect(uebersicht(genau)).not.toContain("Mindestbestellung");
    expect(gesperrt(uebersicht(genau), "bestellen")).toBe(false);
  });

  test("geschlossen: Text der Abteilung, Bestellen und «In den Warenkorb» gesperrt", () => {
    const z = zustand({
      bestellenOffen: false,
      geschlossenText: "Bis Herbst zu.",
    });
    const u = uebersicht(z);
    expect(u).toContain("Bis Herbst zu.");
    expect(gesperrt(u, "bestellen")).toBe(true);
    const f = fenster(z);
    expect(f).toContain("Zurzeit nicht bestellbar");
    expect(gesperrt(f, "dazu")).toBe(true);
  });

  test("ohne öffentliche Preise ist der Preis unbekannt: Hinweis statt Betrag, nichts wird gerechnet", () => {
    expect(laden.preisAnzeige(null)).toBe("Preis nach Anmeldung");
    expect(laden.preisAnzeige(1250)).toBe("CHF 12.50");
    const a = artikel({ preisRappen: null });
    const z = { ...zustand(), artikel: new Map([[a.id, a]]), konto: "an" };
    const f = html(laden.artikelView(a, wahl(), z));
    expect(f).toContain("Preis nach Anmeldung");
    expect(f).not.toContain("CHF");
    const sortiert = laden.sortiere(
      [artikel({ preisRappen: null }), artikel({ id: "b", preisRappen: null })],
      "preis-auf",
    );
    expect(sortiert).toHaveLength(2);
  });

  test("die Fehlercodes der neuen Regeln zeigen den Text des Servers", () => {
    for (const code of [
      "LADEN_GESCHLOSSEN",
      "MINDESTBESTELLUNG",
      "POSITIONEN_ZU_VIELE",
      "MENGE_ZU_GROSS",
    ]) {
      expect(
        laden.fehlerMeldung({
          status: 409,
          daten: { code, message: "Text vom Server" },
        }).titel,
      ).toBe("Text vom Server");
    }
  });
});

// Die Seite aus dem Server
const a1: LadenArtikel = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Shirt",
  preisRappen: 2500,
  mediumId: null,
  varianten: [],
  nichtVerfuegbar: [],
  hinweis: null,
  verfuegbar: true,
};
const rendere = (einstellung?: Partial<typeof EINSTELLUNG_VORGABE>) =>
  serialisiere(
    rendereLaden(
      {
        ...keineDaten(),
        laden: new Map([[a1.id, a1]]),
        ladenUebergabe: new Map([["Abholung im Lädeli", true as const]]),
        ...(einstellung && {
          ladenEinstellung: new Map([
            ["e", { ...EINSTELLUNG_VORGABE, ...einstellung }],
          ]),
        }),
      },
      2,
    )!,
  );

describe("Markup des Servers", () => {
  test("ohne Einstellung wie vor #642: Notiz, Preis und data-preis", () => {
    const s = rendere();
    expect(s).toContain(
      '<p class="laden-notiz">Bestellen mit Konto · Bezahlt wird bei der Übergabe, nicht online</p>',
    );
    expect(s).toContain('data-preis="2500"');
    expect(s).toContain("CHF 25.–");
    expect(s).not.toContain("laden-hinweiszeile");
    expect(s).toContain("data-einstellung=");
    expect(s).not.toContain("uebergabearten&quot;");
  });

  test("Hinweis zur Bezahlung und zur Übergabe aus den Einstellungen; Text wird entschärft", () => {
    const s = rendere({
      bezahlhinweis: "Bar am Samstag.",
      uebergabehinweis: "Samstags 14 bis 16 Uhr <script>x</script>",
    });
    expect(s).toContain("Bestellen mit Konto · Bar am Samstag");
    expect(s).toContain("Samstags 14 bis 16 Uhr &lt;script&gt;");
    expect(s).not.toContain("<script>x");
  });

  test("ohne Hinweis zur Bezahlung nur «Bestellen mit Konto»", () => {
    expect(rendere({ bezahlhinweis: "" })).toContain(
      '<p class="laden-notiz">Bestellen mit Konto</p>',
    );
  });

  test("geschlossen: Hinweiszeile statt Notiz", () => {
    const s = rendere({ bestellenOffen: false, geschlossenText: "Pause." });
    expect(s).not.toContain("laden-notiz");
    expect(s).toContain("laden-hinweiszeile--zu");
    expect(s).toContain("Pause.");
  });

  test("Preise nur für Angemeldete: im Markup steht kein Preis und kein data-preis", () => {
    const s = rendere({ preiseOeffentlich: false });
    expect(s).not.toContain("data-preis");
    expect(s).not.toContain("CHF");
    expect(s).toContain("Preis nach Anmeldung");
  });
});

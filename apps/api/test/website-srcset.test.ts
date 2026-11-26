import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  pruefeDokument,
  type Seitendokument,
} from "../src/website/dokument.js";
import { rendereFehlerseite } from "../src/website/fehlerseiten.js";
import {
  bildQuelle,
  keineDaten,
  rendereSeite,
  vollbildGroesse,
  type Daten,
  type Kontext,
  type MedienDaten,
} from "../src/website/rendern.js";

// srcset und sizes für Medienbilder (#868): Varianten nur, wo die Datenbank sie nennt; ohne bleibt es beim einen Bild
const id = () => randomUUID();
const dok = (...bausteine: unknown[]): Seitendokument => {
  const p = pruefeDokument({ v: 1, titel: "Seite", bausteine });
  if (!p.ok) throw new Error(JSON.stringify(p.fehler));
  return p.dokument;
};
const bild = (varianten?: number[]): MedienDaten => ({
  mimeTyp: "image/webp",
  groesse: 1000,
  breite: 4096,
  hoehe: 1229,
  altText: "Blaues Feld",
  ...(varianten && { varianten }),
});
const kontext = (daten: Daten, extra: Partial<Kontext> = {}): Kontext => ({
  abteilung: "Cevi Test",
  basisUrl: "https://www.example.org",
  navigation: [],
  daten,
  ...extra,
});
const VOLL = [640, 1280, 1920, 2560, 3840];

describe("bildQuelle", () => {
  test("mit Varianten: jede mit ihrer Breite, das Bild selbst als grösste", () => {
    const m = id();
    expect(
      bildQuelle(m, { breite: 4096, varianten: [640, 1280] }, "100vw"),
    ).toEqual({
      src: `/api/v1/medien/${m}`,
      srcset: `/api/v1/medien/${m}?breite=640 640w, /api/v1/medien/${m}?breite=1280 1280w, /api/v1/medien/${m} 4096w`,
      sizes: "100vw",
    });
  });

  test("ohne Varianten (Bestand) oder ohne Breite: nur src", () => {
    const m = id();
    expect(bildQuelle(m, { breite: 1920, varianten: [] })).toEqual({
      src: `/api/v1/medien/${m}`,
    });
    expect(bildQuelle(m, { breite: 1920 })).toEqual({
      src: `/api/v1/medien/${m}`,
    });
    expect(bildQuelle(m, { breite: null, varianten: [640] })).toEqual({
      src: `/api/v1/medien/${m}`,
    });
  });

  test("ein Band über die ganze Breite braucht mehr Pixel als das Fenster breit ist", () => {
    expect(vollbildGroesse(1920, 576, "clamp(15rem, 36vw, 36rem)")).toBe(
      "max(100vw, calc(clamp(15rem, 36vw, 36rem) * 3.333))",
    );
    expect(vollbildGroesse(null, null, "30rem")).toBe("100vw");
  });
});

describe("Seiten", () => {
  test("Kopfbereich: srcset, sizes über die ganze Breite, lädt mit Vorrang", () => {
    const m = id();
    const daten = { ...keineDaten(), medien: new Map([[m, bild(VOLL)]]) };
    const html = rendereSeite(
      {
        id: id(),
        pfad: "/lager",
        dokument: dok({
          id: id(),
          typ: "kopfbereich",
          daten: { titel: "Sommerlager", bild: m },
        }),
      },
      kontext(daten),
    );
    const img = html.match(new RegExp(`<img[^>]*${m}[^>]*>`))![0];
    expect(img).toContain(`/api/v1/medien/${m}?breite=3840 3840w`);
    expect(img).toContain(`/api/v1/medien/${m} 4096w`);
    expect(img).toContain(
      'sizes="max(100vw, calc(clamp(15rem, 36vw, 36rem) * 3.333))"',
    );
    expect(img).toContain('fetchpriority="high"');
    expect(img).not.toContain("lazy");
  });

  test("Titelbild der Seite: sizes nach dem Rahmen der Seite; ohne Varianten kein srcset", () => {
    const m = id();
    const n = id();
    const daten = {
      ...keineDaten(),
      medien: new Map([
        [m, bild(VOLL)],
        [n, bild()],
      ]),
    };
    const html = rendereSeite(
      {
        id: id(),
        pfad: "/lager",
        dokument: dok(
          { id: id(), typ: "bild", daten: { mediumId: m } },
          { id: id(), typ: "bild", daten: { mediumId: n } },
        ),
      },
      kontext(daten),
    );
    expect(html).toContain(
      'sizes="max(100vw, calc(clamp(13rem, 30vw, 30rem) * 3.333))"',
    );
    // Das zweite Bild ist Bestand: nur src
    const zweites = html.match(new RegExp(`<img[^>]*${n}[^>]*>`))![0];
    expect(zweites).not.toContain("srcset");
  });

  test("Bild im Inhalt: sizes höchstens so breit wie der Inhalt", () => {
    const m = id();
    const daten = { ...keineDaten(), medien: new Map([[m, bild(VOLL)]]) };
    const html = rendereSeite(
      {
        id: id(),
        pfad: "/lager",
        dokument: dok(
          { id: id(), typ: "kopfbereich", daten: { titel: "Lager" } },
          { id: id(), typ: "bild", daten: { mediumId: m } },
        ),
      },
      kontext(daten),
    );
    expect(html).toContain('sizes="(min-width: 105rem) 105rem, 100vw"');
  });

  test("Logo im Kopf und Fehlerseite: srcset mit passender Breite", () => {
    const logo = id();
    const k = kontext(keineDaten(), {
      logo: {
        id: logo,
        altText: "Logo",
        breite: 1200,
        hoehe: 300,
        varianten: [640],
      },
    });
    const html = rendereSeite({ id: id(), pfad: "/a", dokument: dok() }, k);
    expect(html).toContain(`srcset="/api/v1/medien/${logo}?breite=640 640w`);
    // 1.875rem hoch, Seitenverhältnis 4:1
    expect(html).toContain('sizes="7.50rem"');
    const fehler = rendereFehlerseite(k, {
      id: logo,
      breite: 1200,
      hoehe: 300,
      varianten: [640],
    });
    expect(fehler).toContain('sizes="max(100vw, calc(100vh * 4.000))"');
  });
});

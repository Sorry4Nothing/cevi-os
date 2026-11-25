import { describe, expect, test } from "vitest";
// Reine Browser-Module ohne Typen und ohne Abhängigkeit auf DOM
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { baueKnoten } from "../public/website/knoten.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { sicheresZiel } from "../public/website/weiter.js";

describe("weiter: kein offener Redirect (#354)", () => {
  test.each([
    "//evil.example",
    "//evil.example/pfad",
    "///evil",
    "\\\\evil.example",
    "\\evil",
    "/\\evil",
    "/\\\\evil",
    "/\t/evil",
    "/\n/evil",
    "/ /evil",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://evil.example",
    "http://evil.example/",
    "evil.example",
    "ftp://evil",
    "/%2F/evil",
    "/%5Cevil",
    "/..",
    "/../evil",
    "/a/../../evil",
    "/.evil",
    "/a?x=//evil",
    "/a#//evil",
    "/a b",
    "/Gross",
    "/a/b/c/d/e/f",
    "/stufen/",
    // Die Adressen der API und der Verwaltung sind nie ein Ziel
    "/api/v1/ich",
    "/admin",
    "/anmelden",
    "/website/geschuetzt.js",
    "",
    "x".repeat(500),
    null,
    undefined,
    42,
    { toString: () => "/ok" },
  ])("%j wird zu «/»", (eingabe) => {
    expect(sicheresZiel(eingabe)).toBe("/");
  });

  test.each(["/", "/stufen", "/stufen/woelfe", "/a-b/c1"])(
    "%s bleibt erhalten",
    (eingabe) => {
      expect(sicheresZiel(eingabe)).toBe(eingabe);
    },
  );
});

// Eine kleine Attrappe des DOM: Sie hält fest, was das Skript erzeugt, ohne Browser
function attrappe() {
  const knoten = (name: string) => ({
    name,
    attrs: {} as Record<string, string>,
    kinder: [] as unknown[],
    setAttribute(n: string, w: string) {
      this.attrs[n] = w;
    },
    appendChild(k: unknown) {
      this.kinder.push(k);
      return k;
    },
  });
  return {
    createElement: (t: string) => knoten(t),
    createTextNode: (t: string) => ({ text: t }),
  };
}
type Attrappe = {
  name?: string;
  attrs?: Record<string, string>;
  kinder?: Attrappe[];
  text?: string;
};
const baue = (k: unknown) =>
  baueKnoten(attrappe(), k) as unknown as Attrappe | null;

describe("knoten: sicherer Aufbau ohne innerHTML (#354)", () => {
  test("Text bleibt Text, auch mit Markup darin", () => {
    const k = baue({
      tag: "p",
      kinder: ['<img src=x onerror="alert(1)">'],
    })!;
    expect(k.name).toBe("p");
    expect(k.kinder).toEqual([{ text: '<img src=x onerror="alert(1)">' }]);
  });

  test("unbekannte Elemente fallen weg, samt Kindern", () => {
    for (const tag of ["script", "iframe", "style", "object", "svg", "embed"]) {
      expect(baue({ tag, kinder: ["x"] })).toBeNull();
    }
    const k = baue({
      tag: "div",
      kinder: [{ tag: "script", kinder: ["alert(1)"] }, "bleibt"],
    })!;
    expect(k.kinder).toEqual([{ text: "bleibt" }]);
  });

  test("nur bekannte Attribute mit geprüften Werten", () => {
    const k = baue({
      tag: "a",
      attr: {
        href: "https://www.example.org/x",
        rel: "noopener noreferrer",
        class: "knopf",
        onclick: "alert(1)",
        style: "x",
        download: true,
      },
      kinder: ["x"],
    })!;
    expect(k.attrs).toEqual({
      href: "https://www.example.org/x",
      rel: "noopener noreferrer",
      class: "knopf",
      download: "",
    });
  });

  test.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "//evil.example",
    "/\\evil",
    "http://example.org",
    'https://x.example/"onmouseover="x',
    "https://x.example/ a",
    "https://x.example/\u0000",
  ])("href %j wird nicht gesetzt", (href) => {
    expect(baue({ tag: "a", attr: { href } })!.attrs).toEqual({});
  });

  test.each(["/stufen", "mailto:a@example.org", "tel:+41441234567"])(
    "href %j ist erlaubt",
    (href) => {
      expect(baue({ tag: "a", attr: { href } })!.attrs).toEqual({ href });
    },
  );

  test("Bilder nur aus den Medien der API, kein Skript im src oder alt-Ersatz", () => {
    const id = "0194a4a8-0000-7000-8000-000000000000";
    expect(
      baue({
        tag: "img",
        attr: { src: `/api/v1/medien/${id}`, alt: "Text", loading: "lazy" },
      })!.attrs,
    ).toEqual({ src: `/api/v1/medien/${id}`, alt: "Text", loading: "lazy" });
    for (const src of [
      "https://evil.example/x.png",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "/api/v1/ich",
      "javascript:alert(1)",
    ]) {
      expect(baue({ tag: "img", attr: { src } })!.attrs).toEqual({});
    }
    // src an einem anderen Element ist nie erlaubt
    expect(
      baue({ tag: "div", attr: { src: `/api/v1/medien/${id}` } })!.attrs,
    ).toEqual({});
  });

  test("class nur aus Kleinbuchstaben, Ziffern, Leerzeichen und -", () => {
    expect(baue({ tag: "p", attr: { class: 'a" onclick="x' } })!.attrs).toEqual(
      {},
    );
    expect(baue({ tag: "p", attr: { class: "galerie team" } })!.attrs).toEqual({
      class: "galerie team",
    });
  });

  test("role nur «list» an einer Liste (#645)", () => {
    expect(baue({ tag: "ul", attr: { role: "list" } })!.attrs).toEqual({
      role: "list",
    });
    expect(baue({ tag: "ul", attr: { role: "button" } })!.attrs).toEqual({});
    expect(baue({ tag: "div", attr: { role: "list" } })!.attrs).toEqual({});
  });

  test("Müll und zu tiefe Bäume werden abgewiesen, ohne Fehler", () => {
    for (const k of [
      null,
      undefined,
      1,
      true,
      [],
      { tag: 5 },
      { kinder: [] },
    ]) {
      expect(baue(k)).toBeNull();
    }
    let tief: unknown = "x";
    for (let i = 0; i < 40; i++) tief = { tag: "div", kinder: [tief] };
    // Abgeschnitten, nicht abgestürzt
    expect(baue(tief)).not.toBeNull();
    // Ein Name aus Object.prototype ist kein Attribut
    expect(
      baue({ tag: "p", attr: { constructor: "x", __proto__: "x" } })!.attrs,
    ).toEqual({});
  });
});

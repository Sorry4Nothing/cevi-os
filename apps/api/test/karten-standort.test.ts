import { describe, expect, test } from "vitest";
import {
  kartenLink,
  KEIN_STANDORT,
  pruefeStandort,
  standortText,
} from "../src/karten-standort.js";

// Prüfung und Normalisierung der Standorte der Orte (#646): rein, ohne Datenbank und Netz
const gut = (roh: string) => {
  const g = pruefeStandort(roh);
  if (!g.ok) throw new Error(`abgelehnt: ${roh} (${g.grund})`);
  return g.standort;
};
const grund = (roh: string) => {
  const g = pruefeStandort(roh);
  return g.ok ? "ok" : g.grund;
};

describe("Eingaben, die gelesen werden", () => {
  test("leer ist kein Standort", () => {
    expect(gut("   ")).toEqual(KEIN_STANDORT);
    expect(kartenLink(KEIN_STANDORT)).toBeNull();
  });

  test("eine Adresse bleibt Adresse, mit Umlauten und Komma", () => {
    expect(gut("  Seestrasse 12, 8712 Stäfa ")).toEqual({
      ...KEIN_STANDORT,
      adresse: "Seestrasse 12, 8712 Stäfa",
    });
    expect(kartenLink(gut("Seestrasse 12, 8712 Stäfa"))).toBe(
      "https://www.google.com/maps/search/?api=1&query=Seestrasse%2012%2C%208712%20St%C3%A4fa",
    );
  });

  test("«Breite, Länge» wird Koordinaten, gerundet auf sechs Stellen", () => {
    expect(gut("47.2391234567, 8.7258")).toEqual({
      ...KEIN_STANDORT,
      breite: 47.239123,
      laenge: 8.7258,
    });
    expect(kartenLink(gut("47.2391, 8.7258"))).toBe(
      "https://www.google.com/maps/search/?api=1&query=47.2391,8.7258",
    );
    expect(standortText(gut("47.2391, 8.7258"))).toBe("47.2391, 8.7258");
  });

  test("ein langer Link mit Ort und Kartenmitte: der Ort gewinnt", () => {
    const s = gut(
      "https://www.google.com/maps/place/Pfadiheim/@47.2400,8.7300,17z/data=!3m1!4b1!4m6!3m5!1s0x1:0x2!8m2!3d47.2391!4d8.7258",
    );
    expect(s).toEqual({ ...KEIN_STANDORT, breite: 47.2391, laenge: 8.7258 });
  });

  test("nur die Kartenmitte, ein Suchtext, ein Parameter q", () => {
    expect(gut("https://www.google.com/maps/@47.5,8.5,15z")).toMatchObject({
      breite: 47.5,
      laenge: 8.5,
    });
    expect(
      gut("https://www.google.com/maps/search/Bahnhof+St%C3%A4fa/"),
    ).toEqual({ ...KEIN_STANDORT, adresse: "Bahnhof Stäfa" });
    expect(gut("https://maps.google.com/?q=Dorfplatz+3")).toEqual({
      ...KEIN_STANDORT,
      adresse: "Dorfplatz 3",
    });
    expect(gut("https://www.google.com/maps?q=47.1,8.2")).toMatchObject({
      breite: 47.1,
      laenge: 8.2,
    });
    expect(
      gut("https://www.google.com/maps/search/?api=1&query=47.1%2C8.2"),
    ).toMatchObject({ breite: 47.1, laenge: 8.2 });
  });

  test("Kurzlinks bleiben als geprüfter Link, ohne Anker; ohne Schema eingefügt geht auch", () => {
    expect(gut("https://maps.app.goo.gl/AbC123xyz#frag")).toEqual({
      ...KEIN_STANDORT,
      url: "https://maps.app.goo.gl/AbC123xyz",
    });
    expect(gut("maps.app.goo.gl/AbC123xyz").url).toBe(
      "https://maps.app.goo.gl/AbC123xyz",
    );
    expect(gut("https://goo.gl/maps/AbC123xyz").url).toBe(
      "https://goo.gl/maps/AbC123xyz",
    );
    expect(kartenLink(gut("https://maps.app.goo.gl/AbC123xyz"))).toBe(
      "https://maps.app.goo.gl/AbC123xyz",
    );
    expect(gut("www.google.com/maps/@47.5,8.5,15z")).toMatchObject({
      breite: 47.5,
    });
  });

  test("Nord-, Süd- und Nullwerte bleiben, -0 wird 0", () => {
    expect(gut("-33.8688, 151.2093")).toMatchObject({ breite: -33.8688 });
    expect(Object.is(gut("-0.0000001, 8").breite, 0)).toBe(true);
  });
});

describe("Eingaben, die abgelehnt werden", () => {
  test.each([
    ["fremder Host", "https://evil.example/maps/@47,8,1z", "host"],
    [
      "Host mit Google im Namen",
      "https://www.google.com.evil.example/maps/",
      "host",
    ],
    ["Subdomain von Google", "https://sites.google.com/maps/x", "host"],
    [
      "Weiterleiter von Google",
      "https://www.google.com/url?q=https://evil.example",
      "host",
    ],
    ["goo.gl ohne maps", "https://goo.gl/abc123", "host"],
    ["Google Suche statt Maps", "https://www.google.com/search?q=x", "host"],
    ["andere Länderendung", "https://www.google.ch/maps/@47,8,1z", "host"],
  ])("%s", (_name, roh, erwartet) => {
    expect(grund(roh)).toBe(erwartet);
  });

  test.each([
    ["http", "http://www.google.com/maps/@47,8,1z"],
    ["javascript", "javascript:alert(1)"],
    ["javascript gross", "JavaScript:alert(1)"],
    ["data", "data:text/html,<script>alert(1)</script>"],
    ["Schema ohne Host", "file:///etc/passwd"],
    ["protokollrelativ", "//www.google.com/maps/@47,8,1z"],
    ["Zugangsdaten", "https://user:pass@www.google.com/maps/@47,8,1z"],
    ["nur Benutzer", "https://user@www.google.com/maps/@47,8,1z"],
    ["Port", "https://www.google.com:8443/maps/@47,8,1z"],
    ["IP-Adresse", "https://142.250.1.1/maps/@47,8,1z"],
    ["Backslash", "https://www.google.com\\@evil.example/maps/"],
    ["Leerraum im Link", "https://www.google.com/maps/ @47,8,1z"],
    [
      "Zeilenumbruch",
      "https://www.google.com/maps/@47,8,1z\nhttps://evil.example",
    ],
    ["Steuerzeichen in Adresse", "Dorf\u0000platz 3"],
    ["Bidi-Zeichen", "Dorf\u202Eplatz 3"],
    ["Koordinaten ausser Bereich", "95.0, 8.0"],
    ["Länge ausser Bereich", "47.0, 190.0"],
  ])("%s", (_name, roh) => {
    expect(grund(roh)).toBe("ungueltig");
  });

  test("zu lang", () => {
    expect(grund("a".repeat(601))).toBe("zu_lang");
    expect(grund("a".repeat(201))).toBe("zu_lang");
    expect(grund(`https://maps.app.goo.gl/${"a".repeat(70)}`)).toBe("host");
    expect(grund(`https://www.google.com/maps/dir/?x=${"a".repeat(480)}`)).toBe(
      "zu_lang",
    );
  });

  test("der erzeugte Link führt immer zu Google Maps, nie zu einem fremden Host", () => {
    for (const roh of [
      'Pfadiheim <script>alert(1)</script> & "x"',
      "https://www.google.com/maps/search/javascript:alert(1)",
      "47.1,8.2",
    ]) {
      const link = kartenLink(gut(roh));
      expect(link).toMatch(
        /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=[^\s<>"']+$/,
      );
    }
  });

  test("ein manipulierter gespeicherter Link wird beim Ausgeben nicht ausgegeben", () => {
    expect(
      kartenLink({ ...KEIN_STANDORT, url: "https://evil.example/x" }),
    ).toBeNull();
    expect(
      kartenLink({ ...KEIN_STANDORT, url: "javascript:alert(1)" }),
    ).toBeNull();
  });
});

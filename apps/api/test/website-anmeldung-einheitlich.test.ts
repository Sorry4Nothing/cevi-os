import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// Reine Browser-Module ohne Typen und ohne Abhängigkeit auf DOM
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { sicheresRueckziel, sicheresZiel } from "../public/website/weiter.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { anmeldeAdresse } from "../public/admin/navigation.js";
import { rendereAnmeldung, type Kontext } from "../src/website/rendern.js";
import {
  ANMELDE_ADRESSE,
  ANMELDUNG_DATEI,
  erstelleWebsiteSperre,
} from "../src/website/sperre.js";
import type { Ausgabe } from "../src/website/ausgabe.js";

// Eine Anmeldeseite für Website und Verwaltung (#818)
const lies = (pfad: string) =>
  readFileSync(new URL(`../public/${pfad}`, import.meta.url), "utf8");
const ADMIN = lies("admin/admin.js");
const ANMELDEN = lies("website/anmelden.js");
const CSS = lies("website/website.css");

describe("Rücksprung nach der Anmeldung: kein offener Redirect", () => {
  test.each([
    "/admin",
    "/admin#personen",
    "/admin#system/plattform",
    "/admin#lager/0b9a5d3e-1c1f-4a6e-9f55-6c3a7d2e1b00/menschen",
    "/admin#termine/anlaesse?monat=2026-11",
  ])("die Verwaltung bleibt erhalten: %s", (ziel) => {
    expect(sicheresRueckziel(ziel)).toBe(ziel);
  });

  test.each(["/", "/stufen", "/stufen/woelfe", "/fotos?album=12"])(
    "Seiten der Website bleiben erhalten: %s",
    (ziel) => {
      expect(sicheresRueckziel(ziel)).toBe(ziel);
    },
  );

  test.each([
    "//evil.example",
    "//evil.example/admin",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example",
    "https://evil.example/admin",
    "http://localhost/admin",
    "javascript:alert(1)",
    "/admin/",
    "/admin/x",
    "/admin?x=1",
    "/admin#",
    "/admin#<script>",
    "/admin#a b",
    "/admin#a\\b",
    "/admin@evil.example",
    "/admin\t#x",
    "/admin\n#x",
    "/Admin",
    "/api/v1/ich",
    "/anmelden",
    `/admin#${"a".repeat(400)}`,
    "",
    null,
    undefined,
    42,
    { toString: () => "/admin" },
  ])("%j wird zu «/»", (ziel) => {
    expect(sicheresRueckziel(ziel)).toBe("/");
  });

  test("die Regeln der Website bleiben streng: ohne den Rücksprung ist «/admin» kein Ziel", () => {
    expect(sicheresZiel("/admin#personen")).toBe("/");
  });

  test("die Adresse der Verwaltung führt mit ihrem Bereich zurück, auch mit Sonderzeichen im Anker", () => {
    for (const hash of [
      "",
      "#personen",
      "#system/plattform",
      "#anlaesse/abc?x=1&y=2",
    ]) {
      const adresse = anmeldeAdresse(hash);
      expect(adresse.startsWith("/anmelden?weiter=")).toBe(true);
      const weiter = new URLSearchParams(adresse.split("?")[1]).get("weiter");
      expect(sicheresRueckziel(weiter)).toBe(`/admin${hash}`);
    }
    expect(anmeldeAdresse("#personen", "code")).toBe(
      "/anmelden?weiter=%2Fadmin%23personen&grund=code",
    );
  });
});

describe("Die Verwaltung hat keine eigene Anmeldung mehr", () => {
  test("ohne Sitzung geht es zur Anmeldeseite, ohne Eintrag im Verlauf", () => {
    expect(ADMIN).toMatch(
      /function zurAnmeldeseite\(grund\) \{[^}]*location\.replace\(anmeldeAdresse\(location\.hash, grund\)\)/,
    );
    expect(ADMIN).toMatch(/if \(!sitzung\) \{\s*zurAnmeldeseite\(\);/);
  });

  test("keine Anmeldung, kein Codefeld und keine Fehlerzeile der Anmeldung im Code der Verwaltung", () => {
    expect(ADMIN).not.toContain("zeigeLogin");
    expect(ADMIN).not.toContain("zeigeCode");
    expect(ADMIN).not.toContain("sign-in/username");
    expect(ADMIN).not.toContain("verify-totp");
    expect(ADMIN).not.toContain("verify-backup-code");
    expect(ADMIN).not.toContain("codefeld");
  });

  test("Abmelden, Sitzungsablauf, alle Geräte und fehlender Code führen mit festem Hinweis zur Anmeldeseite", () => {
    expect(ADMIN).toContain('zurAnmeldeseite("abgemeldet")');
    expect(ADMIN).toContain('zurAnmeldeseite("sitzung")');
    expect(ADMIN).toContain('zurAnmeldeseite("alle")');
    expect(ADMIN).toContain('zurAnmeldeseite("code")');
    // Neuanmeldung mit Code (#721): erst abmelden, dann zur Anmeldeseite
    expect(ADMIN).toMatch(
      /async function neuAnmeldenMitCode\(\) \{\s*try \{\s*await anfrage\("POST", "\/api\/auth\/sign-out", \{\}\);[\s\S]*?zurAnmeldeseite\("code"\)/,
    );
  });

  test("jeder Hinweis, den die Verwaltung schickt, steht auf der Anmeldeseite", () => {
    const geschickt = [...ADMIN.matchAll(/zurAnmeldeseite\("(\w+)"\)/g)].map(
      (m) => m[1],
    );
    expect(geschickt.length).toBeGreaterThan(0);
    for (const grund of geschickt) {
      expect(ANMELDEN).toMatch(new RegExp(`^  ${grund}: \\[`, "m"));
    }
  });

  test("Startpasswort: Die Verwaltung schickt zum Wechsel in «Mein Konto», die Anmeldeseite führt auch dorthin", () => {
    expect(ADMIN).toMatch(
      /if \(ich\.mussPasswortAendern\) \{[^}]*location\.replace\("\/konto"\)/,
    );
    expect(ANMELDEN).toMatch(/mussPasswortAendern \? "\/konto" : ziel/);
  });

  test("zweiter Faktor, Ersatzcode und Abbrechen stehen auf der Anmeldeseite", () => {
    expect(ANMELDEN).toContain("/api/auth/two-factor/verify-totp");
    expect(ANMELDEN).toContain("/api/auth/two-factor/verify-backup-code");
    expect(ANMELDEN).toContain("INVALID_TWO_FACTOR_COOKIE");
    expect(ANMELDEN).toContain('$("abbrechen")');
  });

  test("die Anmeldeseite nimmt den Rücksprung nur über die Liste und fragt nicht nach dem Namen eines Hinweises", () => {
    expect(ANMELDEN).toContain("sicheresRueckziel(");
    expect(ANMELDEN).not.toMatch(/location\.(assign|replace)\(\s*[a-z]*\.get/);
    // Ein Name wie «constructor» ist kein Hinweis
    expect(ANMELDEN).toContain("Object.hasOwn(GRUENDE");
  });
});

const kontext: Kontext = {
  abteilung: "Cevi Beispielstadt",
  basisUrl: "https://www.example.org",
  navigation: [{ pfad: "/", titel: "Start", kinder: [] }],
  daten: {} as never,
};

describe("Anmeldeseite: in der Mitte, bei jeder Breite (#818)", () => {
  const html = rendereAnmeldung(kontext);
  const regel = (wahl: string) => {
    const m = new RegExp(`(?:^|\\n)${wahl} \\{([^}]*)\\}`).exec(CSS);
    expect(m, wahl).not.toBeNull();
    return m![1];
  };

  test("alle Schritte stehen in einer Karte: Anmelden, zweiter Faktor mit Ersatzcode, Hinweise und Fehler", () => {
    const karte = html.slice(html.indexOf('<div class="anmelde-karte"'));
    expect(karte).toContain('id="anmeldung"');
    expect(karte).toContain('id="faktor"');
    expect(karte).toContain('id="meldung"');
    expect(karte).toContain('id="ersatz"');
    // Genau eine Karte, beide Formulare darin
    expect(html.match(/class="anmelde-karte"/g)).toHaveLength(1);
    expect(karte.indexOf("</form>")).toBeLessThan(karte.lastIndexOf("</div>"));
  });

  test("die Karte ist eine mittige Spalte mit gleichem Rand links und rechts und läuft nie über", () => {
    const mitte = regel("\\.anmelde-mitte");
    expect(mitte).toMatch(/display: grid/);
    expect(mitte).toMatch(/justify-items: center/);
    expect(mitte).toMatch(/align-content: center/);
    // Keine Spaltenbreite, die nur eine Seite füllt, und kein fester Versatz
    expect(mitte).not.toMatch(
      /margin(-left|-right|-inline)|padding-(left|right)/,
    );
    const karte = regel("\\.anmelde-karte");
    expect(karte).toMatch(/width: min\(100%, 28rem\)/);
    expect(karte).toMatch(/min-width: 0/);
    expect(karte).not.toMatch(/margin|float|position/);
  });

  test("Formular und Hinweise füllen die Karte; die Höhe richtet sich nach dem Fenster, nicht nach einer geschätzten Kopfhöhe", () => {
    expect(CSS).toMatch(
      /\.anmelde-karte \.formular,\s*\.anmelde-karte #meldung:not\(:empty\) \{\s*max-width: none;/,
    );
    const mitte = regel("\\.anmelde-mitte");
    expect(mitte).toMatch(/min-height: max\(24rem, 60svh\)/);
    // Der Abstand der übrigen Seiten, kein eigener Pixelwert
    expect(mitte).toMatch(/padding-block: var\(--abstand\)/);
    expect(mitte).not.toMatch(/100vh|calc\(/);
  });
});

describe("Anmeldeseite im Kartenstil (#829)", () => {
  const html = rendereAnmeldung(kontext);
  const css = (wahl: string) => {
    const von = CSS.indexOf(`\n${wahl} {`);
    expect(von, wahl).toBeGreaterThan(-1);
    return CSS.slice(von, CSS.indexOf("}", von));
  };

  test("Kopf der Karte: Symbol im Kreis, Überzeile (zuerst verborgen), eine Überschrift, Hilfetext", () => {
    expect(html).toContain('<span class="kreis" aria-hidden="true">');
    expect(html).toContain(
      '<p class="ueber" id="ueber" hidden>Schritt 1 von 2</p>',
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h1 id="titel">Anmelden</h1>');
  });

  test("sechs Ziffernfelder in einer beschrifteten Gruppe, je Feld mit Nummer, Autofüllung nur am ersten", () => {
    expect(html).toContain(
      'id="ziffern" role="group" aria-labelledby="code-label" aria-describedby="code-hilfe"',
    );
    expect(html).toContain(
      '<label for="code" id="code-label">Code aus der Authenticator-App</label>',
    );
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const autofuellen = n === 1 ? "one-time-code" : "off";
      expect(html).toContain(
        `<input class="ziffer" id="ziffer-${n}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="${autofuellen}" autocapitalize="none" spellcheck="false" aria-label="Ziffer ${n} von 6">`,
      );
    }
    expect(html.match(/class="ziffer"/g)).toHaveLength(6);
    expect(html.match(/autocomplete="one-time-code"/g)).toHaveLength(1);
    expect(html).toContain(
      "Sechs Ziffern. Der Code wird nach der letzten Ziffer geprüft.",
    );
  });

  test("Statusregion für die Ansage beim Prüfen, Ersatzcode als ein eigenes Feld (zuerst verborgen)", () => {
    expect(html).toContain('<p class="nur-sr" id="status" role="status"></p>');
    expect(html).toMatch(/<input class="eingabe" id="code"[^>]* hidden>/);
  });

  test("Ziffernfelder: Gruppe 3 + Lücke + 3, 60 px hoch, Fokus ohne Breitenänderung, nur Tokens", () => {
    expect(css(".ziffer")).toContain("height: 3.75rem");
    expect(css(".ziffer:nth-child(3)")).toContain("margin-inline-end");
    expect(css(".ziffer:focus-visible")).toContain("box-shadow: inset");
    const stil = [".anmelde-karte", ".kreis", ".ueber", ".ziffer"]
      .map(css)
      .join("");
    expect(stil).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(css(".anmelde-karte")).toContain("background: var(--karte)");
    expect(css(".kreis")).toContain("var(--secondary-container)");
    expect(css(".ueber")).toContain("text-transform: uppercase");
  });

  test("Skript: Auto-Prüfung nach der letzten Ziffer, Einfügen, Pfeiltasten, Rücktaste, Fokus ins erste Feld", () => {
    expect(ANMELDEN).toContain("faktor.requestSubmit()");
    expect(ANMELDEN).toContain('"paste"');
    expect(ANMELDEN).toContain('"ArrowLeft"');
    expect(ANMELDEN).toContain('"ArrowRight"');
    expect(ANMELDEN).toContain('"Backspace"');
    expect(ANMELDEN).toContain(
      'if (schluessel === "codeFalsch") codeFelder()[0].focus();',
    );
    // Die Überzeile des ersten Schritts nur, wenn die Verwaltung das Ziel ist
    expect(ANMELDEN).toMatch(/faktorBekannt =\s*ziel\.startsWith\("\/admin"\)/);
  });
});

// Eine Ausgabe im Speicher
function speicher(dateien: string[]): Ausgabe & { liste(): Promise<string[]> } {
  const d = new Set(dateien);
  return {
    async schreibe(pfad) {
      d.add(pfad);
    },
    async loesche(pfad) {
      d.delete(pfad);
    },
    async liste() {
      return [...d].sort();
    },
  };
}

describe("Informationssperre: die Anmeldeseite bleibt erreichbar (#803, #818)", () => {
  test("die Hinweisseite führt zur gemeinsamen Anmeldeseite mit Rücksprung zu «Wartung und Sperre»", () => {
    expect(ANMELDE_ADRESSE.startsWith("/anmelden?weiter=")).toBe(true);
    const weiter = new URLSearchParams(ANMELDE_ADRESSE.split("?")[1]).get(
      "weiter",
    );
    expect(sicheresRueckziel(weiter)).toBe("/admin#system/plattform");
  });

  test("die Sperre behält Anmeldeseite, Skripte und Stile, nie Seiten, Bilder der Personen oder Sitemap", async () => {
    const ausgabe = speicher([
      ANMELDUNG_DATEI,
      "index.html",
      "stufen/index.html",
      "sitemap.xml",
      "website/anmelden.js",
      "website/weiter.js",
      "website/website.css",
      "website/tokens.css",
      "website/person-0123456789abcdef.jpg",
      "website/bild-fehlt.svg",
      "medien/a/b.jpg",
    ]);
    await erstelleWebsiteSperre(ausgabe, "abteilung").nimmVomNetz();
    expect(await ausgabe.liste()).toEqual([
      "404.html",
      ANMELDUNG_DATEI,
      "gesperrt.css",
      "index.html",
      "website/anmelden.js",
      "website/tokens.css",
      "website/website.css",
      "website/weiter.js",
    ]);
  });
});

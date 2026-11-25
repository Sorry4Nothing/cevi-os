import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test, vi } from "vitest";

// Kein «false», «null» oder «undefined» als Text auf der Seite (#800): el() lässt diese Werte weg, die nativen Methoden append(), prepend(), replaceChildren(), before(), after() und replaceWith() schreiben sie als Text in die Seite.
// Die Prüfung liest den Quelltext von Verwaltung und Website und sucht Aufrufe, deren Argument falsch sein kann: `bedingung && el(…)`, `bedingung ? el(…) : null`, `x?.wurzel`, ein blosses `false` oder `null`, auch als Element einer Liste mit `...`. Der Aufrufer filtert dann (`.filter(Boolean)`) oder nimmt eine Hilfe, die das tut (kinder(), haenge(), ersetze()).
// Grenze: Eine Variable mit unbekanntem Inhalt (`append(knoten)`) sieht die Prüfung nicht. Dort gilt: den Wert vorher filtern.

const WURZEL = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

function alle(ordner: string): string[] {
  const treffer: string[] = [];
  for (const name of readdirSync(ordner)) {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) treffer.push(...alle(pfad));
    else if (name.endsWith(".js")) treffer.push(pfad);
  }
  return treffer;
}

const dateien = alle(join(WURZEL, "public")).map((pfad) => ({
  name: relative(WURZEL, pfad).replaceAll("\\", "/"),
  text: readFileSync(pfad, "utf8"),
}));

// Ersetzt den Inhalt von Zeichenketten, Vorlagen und Kommentaren durch Leerzeichen (gleiche Länge, gleiche Positionen), damit Klammern und Operatoren darin nicht zählen. ${…} in Vorlagen wird zu «_».
function maskiere(text: string): string {
  const leer = (s: string) => s.replace(/[^\n]/g, " ");
  let aus = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      const ende = text.indexOf("\n", i);
      const bis = ende < 0 ? text.length : ende;
      aus += leer(text.slice(i, bis));
      i = bis;
    } else if (c === "/" && text[i + 1] === "*") {
      const ende = text.indexOf("*/", i + 2);
      const bis = ende < 0 ? text.length : ende + 2;
      aus += leer(text.slice(i, bis));
      i = bis;
    } else if (c === '"' || c === "'" || c === "`") {
      aus += c;
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") {
          aus += "  ";
          i += 2;
        } else if (c === "`" && text[i] === "$" && text[i + 1] === "{") {
          let tiefe = 0;
          do {
            if (text[i] === "{") tiefe++;
            if (text[i] === "}") tiefe--;
            aus += text[i] === "\n" ? "\n" : "_";
            i++;
          } while (i < text.length && tiefe > 0);
        } else {
          aus += text[i] === "\n" ? "\n" : " ";
          i++;
        }
      }
      aus += c;
      i++;
    } else {
      aus += c;
      i++;
    }
  }
  return aus;
}

// Teilt bei Kommas auf oberster Ebene; liefert Spannen
function teile(m: string, von: number, bis: number): [number, number][] {
  const spannen: [number, number][] = [];
  let tiefe = 0;
  let start = von;
  for (let i = von; i < bis; i++) {
    if ("([{".includes(m[i])) tiefe++;
    else if (")]}".includes(m[i])) tiefe--;
    else if (m[i] === "," && tiefe === 0) {
      spannen.push([start, i]);
      start = i + 1;
    }
  }
  if (m.slice(start, bis).trim()) spannen.push([start, bis]);
  return spannen;
}

// Der Ausdruck ohne den Inhalt der Klammern: übrig bleibt die oberste Ebene
function oberste(s: string): string {
  let tiefe = 0;
  let aus = "";
  for (const c of s) {
    if ("([{".includes(c)) aus += tiefe++ === 0 ? c : "_";
    else if (")]}".includes(c)) aus += --tiefe === 0 ? c : "_";
    else aus += tiefe > 0 && c !== "\n" ? "_" : c;
  }
  return aus;
}

// Ein «?» der Bedingung (nicht `?.` und nicht `??`)
const frageAn = (o: string, i: number) =>
  o[i] === "?" && o[i + 1] !== "." && o[i + 1] !== "?" && o[i - 1] !== "?";

// Spannen der beiden Zweige von `bedingung ? a : b`, sonst null
function zweige(m: string, a: number, b: number): [number, number][] | null {
  const o = oberste(m.slice(a, b));
  const frage = [...o].findIndex((_, i) => frageAn(o, i));
  if (frage < 0) return null;
  let offen = 0;
  for (let i = frage + 1; i < o.length; i++) {
    if (frageAn(o, i)) offen++;
    else if (o[i] === ":" && offen-- === 0) {
      return [
        [a + frage + 1, a + i],
        [a + i + 1, b],
      ];
    }
  }
  return null;
}

const LEER = /^\s*(?:null|false|true|undefined|void\s+0)\s*$/;

// Kann der Ausdruck false, null oder undefined ergeben (und als Text im Aufruf landen)?
function unsicher(m: string, a: number, b: number): boolean {
  const o = oberste(m.slice(a, b)).trim();
  if (o === "") return false;
  if (LEER.test(o)) return true;
  const z = zweige(m, a, b);
  if (z) return z.some(([x, y]) => unsicher(m, x, y));
  if (o.includes("&&")) return true;
  // `x || null`, `x ?? false`: der letzte Operand entscheidet
  if (/\|\||\?\?/.test(o) && LEER.test(o.split(/\|\||\?\?/).pop() ?? ""))
    return true;
  // `kasten?.wurzel`: schlägt der Zugriff fehl, kommt undefined
  return /\?\.[\w$]+$/.test(o);
}

const AUFRUF = /\.(append|prepend|replaceChildren|before|after|replaceWith)\(/g;
// Aufrufer, die nicht das DOM meinen (FormData, URLSearchParams, Headers)
const NICHT_DOM = /\b(?:fd|formData|daten|params|suchparameter|headers|url)$/i;

// Namen der Funktionen einer Datei, die null, false, undefined liefern können (`return null;`, `return;`, `return a && b;`): ihr Aufruf als Argument ist derselbe Fehler. Eine Rückgabe in einer inneren Funktion zählt mit; das gibt höchstens einen Fund zu viel, den man mit Filter oder Bedingung behebt.
function nullbare(m: string): Set<string> {
  const namen = new Set<string>();
  const kopf =
    /\bfunction\s+([\w$]+)\s*\(|\b(?:const|let)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\s*)?\([^()]*\)\s*(?:=>)?\s*\{/g;
  for (const t of m.matchAll(kopf)) {
    const start = m.indexOf(
      "{",
      t.index + t[0].length - (t[0].endsWith("{") ? 1 : 0),
    );
    let tiefe = 0;
    let ende = start;
    for (; ende < m.length; ende++) {
      if (m[ende] === "{") tiefe++;
      else if (m[ende] === "}" && --tiefe === 0) break;
    }
    const rumpf = m.slice(start, ende);
    // Nur die Rückgaben der Funktion selbst: eine innere Funktion (Pfeil oder function) zählt nicht
    const innen: boolean[] = [];
    for (let i = 0; i < rumpf.length; i++) {
      if (rumpf[i] === "{") {
        innen.push(
          /(?:=>|\bfunction\b[^{;]*)\s*$/.test(
            rumpf.slice(Math.max(0, i - 80), i),
          ),
        );
      } else if (rumpf[i] === "}") innen.pop();
      else if (
        rumpf.startsWith("return", i) &&
        !/[\w$]/.test(rumpf[i - 1] ?? "") &&
        !innen.slice(1).some(Boolean)
      ) {
        const a = i + 6;
        const ende = rumpf.indexOf(";", a);
        const bisSemi = ende < 0 ? rumpf.length : ende;
        if (
          rumpf.slice(a, bisSemi).trim() === "" ||
          unsicher(rumpf, a, bisSemi)
        )
          namen.add(t[1] ?? t[2]);
      }
    }
  }
  return namen;
}

export function funde(name: string, text: string): string[] {
  const m = maskiere(text);
  const treffer: string[] = [];
  const nullbar = nullbare(m);
  const meldeFund = (a: number, b: number) =>
    treffer.push(
      `${name}:${m.slice(0, a).split("\n").length}: ${text
        .slice(a, b)
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 70)}`,
    );

  // `...[a, b]` und `...(bedingung ? [a] : [b])`: die Elemente der Listen zählen; `.filter(` oder `.flat(` dahinter macht sie sicher, jeder andere Aufruf auch (er liefert, was er liefert)
  function liste(a: number, b: number) {
    const o = oberste(m.slice(a, b)).trim();
    const links = a + m.slice(a, b).search(/\S/);
    const rechts = links + o.length;
    if (o.startsWith("(") && o.endsWith(")")) {
      const z = zweige(m, links + 1, rechts - 1);
      for (const [x, y] of z ?? [[links + 1, rechts - 1]]) liste(x, y);
    } else if (o.startsWith("[") && o.endsWith("]")) {
      for (const [x, y] of teile(m, links + 1, rechts - 1)) element(x, y);
    }
  }

  // `name(…)` einer Funktion der Datei, die null liefern kann
  function nullbarerAufruf(a: number, b: number) {
    const aufruf = /^\s*([\w$]+)\(/.exec(m.slice(a, b));
    return (
      !!aufruf &&
      nullbar.has(aufruf[1]) &&
      oberste(m.slice(a, b)).trim().endsWith(")") &&
      !/[+*/<>=&|?:]/.test(oberste(m.slice(a, b)))
    );
  }

  function element(a: number, b: number) {
    const links = a + Math.max(0, m.slice(a, b).search(/\S/));
    if (m.startsWith("...", links)) liste(links + 3, b);
    else if (unsicher(m, a, b) || nullbarerAufruf(a, b)) meldeFund(a, b);
  }

  for (const t of m.matchAll(AUFRUF)) {
    if (NICHT_DOM.test(m.slice(Math.max(0, t.index - 20), t.index))) continue;
    const von = t.index + t[0].length;
    let tiefe = 1;
    let bis = von;
    for (; bis < m.length && tiefe > 0; bis++) {
      if ("([{".includes(m[bis])) tiefe++;
      else if (")]}".includes(m[bis])) tiefe--;
    }
    for (const [a, b] of teile(m, von, bis - 1)) element(a, b);
  }
  return treffer;
}

describe("kein «false» als Text", () => {
  test("die Prüfung sieht Verwaltung und Website", () => {
    expect(dateien.some((d) => d.name === "public/admin/rechte-rolle.js")).toBe(
      true,
    );
    expect(dateien.some((d) => d.name === "public/website/anmeldung.js")).toBe(
      true,
    );
  });

  test("die Prüfung erkennt die Fehlerart und lässt Sicheres durch", () => {
    const fehler = (code: string) => funde("x.js", code);
    expect(fehler("a.append(b, ok && el('p'));")).toHaveLength(1);
    expect(fehler("a.append(ok ? el('p') : null);")).toHaveLength(1);
    expect(fehler("a.append(ok ? b : c ? d : false);")).toHaveLength(1);
    expect(fehler("a.append(...[x, ok && el('p')]);")).toHaveLength(1);
    expect(
      fehler("a.replaceChildren(...(ok ? [x, k?.wurzel] : []));"),
    ).toHaveLength(1);
    expect(fehler("a.append(k?.wurzel);")).toHaveLength(1);
    expect(fehler("a.before(false);")).toHaveLength(1);
    expect(fehler("a.append(ok ? b : c, el('i', {}, x && y));")).toEqual([]);
    expect(fehler("a.append(...[x, ok && el('p')].filter(Boolean));")).toEqual(
      [],
    );
    expect(fehler("a.append(...(ok ? [el('p')] : []));")).toEqual([]);
    expect(fehler("a.append(x ?? el('p'), 'a && b', `${k && 1}`);")).toEqual(
      [],
    );
    expect(fehler("fd.append('a', ok && 'b');")).toEqual([]);
  });

  test("kein append, prepend, replaceChildren, before, after oder replaceWith mit einem Argument, das false, null oder undefined sein kann", () => {
    expect(dateien.flatMap((d) => funde(d.name, d.text))).toEqual([]);
  });
});

// Laufzeit: die Seite einer globalen Rolle (#800). Eine kleine Hülle für document mit dem Verhalten der nativen append(): Was kein Knoten ist, wird als Text eingefügt («false», «null»). Alles andere, das die Bausteine antasten, nimmt die Hülle leise hin.
class Text {
  constructor(public data: string) {}
}
class Huelle {
  kinder: (Huelle | Text)[] = [];
  attribute = new Map<string, string>();
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  value = "";
  classList = {
    add() {},
    remove() {},
    toggle() {},
    contains: () => false,
  };
  constructor(public tag: string) {}
  append(...args: unknown[]) {
    for (const a of args)
      this.kinder.push(
        a instanceof Huelle || a instanceof Text ? a : new Text(String(a)),
      );
  }
  prepend(...args: unknown[]) {
    const vorher = this.kinder;
    this.kinder = [];
    this.append(...args);
    this.kinder.push(...vorher);
  }
  replaceChildren(...args: unknown[]) {
    this.kinder = [];
    this.append(...args);
  }
  setAttribute(name: string, wert: string) {
    this.attribute.set(name, wert);
  }
  set textContent(wert: string) {
    this.kinder = [new Text(String(wert))];
  }
  get textContent(): string {
    return texteVon(this);
  }
}
const texteVon = (k: Huelle | Text): string =>
  k instanceof Text ? k.data : k.kinder.map(texteVon).join(" ");

// Unbekannte Eigenschaften der Hülle: eine Funktion, die nichts tut (addEventListener, focus, querySelector …)
const huelle = (tag: string) =>
  new Proxy(new Huelle(tag), {
    get(ziel, name, empfaenger) {
      if (name in ziel || name === "then" || typeof name === "symbol")
        return Reflect.get(ziel, name, empfaenger);
      return () => null;
    },
  });

describe("Seite einer globalen Rolle", () => {
  const person = { id: "p1", name: "Beispiel Person", deaktiviert: false };
  const rolle = (art: "global" | "gruppe") => ({
    id: "r1",
    name: "Webmaster",
    art,
    tagId: art === "gruppe" ? "t1" : undefined,
    personen: [],
  });

  async function zeichne(art: "global" | "gruppe") {
    vi.stubGlobal("Node", Huelle);
    const dokument = {
      createElement: huelle,
      createElementNS: huelle,
      createTextNode: (t: string) => new Text(String(t)),
      createDocumentFragment: () => huelle("#fragment"),
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: huelle("html"),
      body: huelle("body"),
    };
    const fenster = {
      addEventListener() {},
      location: { hash: "" },
      history: {},
      matchMedia: () => ({ matches: false, addEventListener() {} }),
    };
    vi.stubGlobal("document", dokument);
    vi.stubGlobal("window", fenster);
    // Browser-Modul ohne Typen: der Pfad steht in einer Variablen, damit TypeScript es nicht auflöst
    const datei = "rechte-rolle.js";
    const { personenBlock } = await import(
      /* @vite-ignore */ `../public/admin/${datei}`
    );
    const z = { ctx: {}, personen: [person], neu() {} };
    return personenBlock(z, rolle(art), {}) as Huelle;
  }

  test("enthält weder «false» noch «null» noch «undefined»", async () => {
    for (const art of ["global", "gruppe"] as const) {
      const text = texteVon(await zeichne(art));
      // Funktionen (globale Rollen) vergibt man im Blatt der Person (#801): Die Rollenseite zeigt nur die Liste
      if (art === "gruppe") expect(text, art).toContain("Personen zuordnen");
      else expect(text, art).not.toContain("Personen zuordnen");
      expect(text, art).not.toMatch(/\b(?:false|null|undefined)\b/);
    }
  });

  test("der Hinweis zum Aufnehmen steht nur bei einer Gruppenrolle", async () => {
    const hinweis = "Wer noch nicht in der Gruppe ist";
    expect(texteVon(await zeichne("global"))).not.toContain(hinweis);
    expect(texteVon(await zeichne("gruppe"))).toContain(hinweis);
  });
});

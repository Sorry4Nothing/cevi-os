import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import { kopf } from "../src/website/kopf.js";
import { keineDaten, rahmen, type Kontext } from "../src/website/rendern.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// Konto-Menü im Kopf der Website (#669): Route, Vorlage im statischen HTML und Verhalten von konto.js
bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

let welt: Welt;
let admin: PersonaKonto;
let slA: PersonaKonto;
let elternA: PersonaKonto;
let ohneLogin: PersonaKonto;
let mussWechseln: PersonaKonto;

const konto = (k: PersonaKonto) =>
  app.request("/api/v1/website/konto", { headers: k.headers });

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, slA, elternA, ohneLogin, mussWechseln] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "slA"),
    legePersonaAn(welt, "elternA"),
    legePersonaAn(welt, "ohneLogin"),
    legePersonaAn(welt, "mussPasswortAendern"),
  ]);
});

describe("GET /api/v1/website/konto", () => {
  test("ohne Sitzung 401, nichts über die Person", async () => {
    const a = await konto(ohneLogin);
    expect(a.status).toBe(401);
    expect(await a.text()).not.toMatch(/name|bildUrl|verwaltung/i);
  });

  test("Pflichtwechsel des Passworts offen: 403", async () => {
    expect((await konto(mussWechseln)).status).toBe(403);
  });

  test("Eltern: Vorname und kein Zugang zur Verwaltung", async () => {
    const a = await konto(elternA);
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({
      name: "Eltern",
      bildUrl: null,
      verwaltung: false,
    });
  });

  test("Abteilungsleitung: Zugang zur Verwaltung; nur drei Felder, nie Benutzername, E-Mail, Telefon oder Kennung", async () => {
    const a = await konto(admin);
    expect(a.status).toBe(200);
    const antwort = (await a.json()) as Record<string, unknown>;
    expect(Object.keys(antwort).sort()).toEqual([
      "bildUrl",
      "name",
      "verwaltung",
    ]);
    expect(antwort.verwaltung).toBe(true);
    const text = JSON.stringify(antwort);
    expect(text).not.toContain(admin.benutzername!);
    expect(text).not.toContain(admin.id!);
    expect(text).not.toMatch(/@|telefon|email/i);
  });

  test("Stufenleitung: Zugang zur Verwaltung über ihre Rechte (Termine, Räume, Anlässe, Website)", async () => {
    const antwort = (await (await konto(slA)).json()) as {
      verwaltung: boolean;
    };
    // Die Antwort folgt der Rechteprüfung der Verwaltung; die Stufenleitung hat darin mindestens die Belegung oder ein Recht
    const ich = (await (
      await app.request("/api/v1/redaktion/ich", { headers: slA.headers })
    ).json()) as {
      bereiche: string[];
      belegung: boolean;
      termine: Record<string, boolean>;
    };
    expect(antwort.verwaltung).toBe(
      ich.bereiche.length > 0 ||
        ich.belegung === true ||
        Object.values(ich.termine).some((v) => v === true),
    );
  });

  test("der Cevi-Name geht vor dem Vorvornamen; das eigene Profilbild kommt als Pfad mit Version", async () => {
    await db
      .update(schema.user)
      .set({ ceviName: "Funke" })
      .where(eq(schema.user.id, elternA.id!));
    await db
      .insert(schema.profilbild)
      .values({ userId: elternA.id!, inhalt: Buffer.from([1, 2, 3]) });
    const antwort = (await (await konto(elternA)).json()) as {
      name: string;
      bildUrl: string;
    };
    expect(antwort.name).toBe("Funke");
    expect(antwort.bildUrl).toMatch(
      new RegExp(`^/api/v1/personen/${elternA.id}/bild\\?v=\\d+$`),
    );
  });

  test("keine Zwischenspeicherung: private, no-store und Vary Cookie", async () => {
    const a = await konto(elternA);
    expect(a.headers.get("cache-control")).toBe("private, no-store");
    expect(a.headers.get("vary")).toContain("Cookie");
  });
});

describe("Kopf: Vorlage im statischen HTML (#669)", () => {
  const k: Kontext = {
    abteilung: "Cevi Test",
    basisUrl: "https://example.org",
    navigation: [{ titel: "Start", pfad: "/", kinder: [] }],
    daten: keineDaten(),
  };
  const html = kopf(k, "/", false);

  test("«Anmelden» bleibt der Ausgangszustand (Band und Menü am Handy)", () => {
    expect(html.match(/<a class="anmelden" href="\/anmelden">/g)).toHaveLength(
      2,
    );
  });

  test("eine Vorlage mit leeren Feldern und festen Texten, ohne Namen, Bild, Skript oder Zugang", () => {
    const vorlage = /<template id="konto-vorlage">(.*?)<\/template>/s.exec(
      html,
    )![1]!;
    expect(html.match(/<template/g)).toHaveLength(1);
    expect(vorlage).toContain('<span data-konto="name"></span>');
    expect(vorlage).toContain('<strong data-konto="name"></strong>');
    expect(vorlage).toContain(">Verwaltung</a>");
    expect(vorlage).toContain(">Mein Konto</a>");
    expect(vorlage).toContain(">Abmelden</button>");
    expect(vorlage).toContain('href="/admin"');
    expect(vorlage).toContain('href="/admin#konto"');
    expect(vorlage).not.toMatch(/<script|<img|style=|\son[a-z]+=/i);
    // Aufbau eines Offenlegungsmenüs, kein ARIA-«menu»
    expect(vorlage).toContain('<details class="konto-menue">');
    expect(vorlage).not.toContain('role="menu');
  });

  test("Wartung und Serverfehler (nur Marke): keine Vorlage, kein Konto-Skript", () => {
    expect(kopf(k, null, true)).not.toContain("konto-vorlage");
    const seite = rahmen(k, {
      titel: "Wartung",
      aktuell: null,
      inhalt: "<p>x</p>",
      nurMarke: true,
    });
    expect(seite).not.toContain("konto.js");
    expect(seite).not.toContain("connect-src");
  });

  test("jede Seite mit Kopf lädt konto.js als Modul der eigenen Herkunft und darf nur dorthin verbinden", () => {
    const seite = rahmen(k, {
      titel: "Start",
      aktuell: "/",
      inhalt: "<p>x</p>",
    });
    expect(seite).toContain(
      '<script type="module" src="/website/konto.js"></script>',
    );
    expect(seite).toContain("connect-src &#39;self&#39;");
    expect(seite).not.toMatch(/<script(?![^>]* src=)/);
  });
});

// konto.js in einer kleinsten Umgebung: Element mit Attributen, Kindern und Ereignissen
interface Elem {
  tag: string;
  attr: Map<string, string>;
  textContent: string;
  children: Elem[];
  hidden: boolean;
  open: boolean;
  classList: { add(n: string): void };
  setAttribute(n: string, v: string): void;
  getAttribute(n: string): string | null;
  removeAttribute(n: string): void;
  addEventListener(n: string, f: (e?: unknown) => void): void;
  querySelector(s: string): Elem | null;
  querySelectorAll(s: string): Elem[];
  append(e: Elem): void;
  remove(): void;
  contains(e: unknown): boolean;
  replaceWith(e: Elem): void;
  cloneNode(): Elem;
  closest(s: string): Elem | null;
  focus(): void;
  ersatz?: Elem;
  [k: string]: unknown;
}

function lauf(opt: {
  antwort: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  vorlage?: boolean;
  merker?: boolean;
  imMenue?: boolean;
}) {
  const skript = readFileSync(
    new URL("../public/website/konto.js", import.meta.url),
    "utf8",
  );
  const aufrufe: { url: string; opt?: Record<string, unknown> }[] = [];
  const speicher = new Map<string, string>(
    opt.merker ? [["cevi-konto", "1"]] : [],
  );
  const wurzelAttr = new Map<string, string>(
    opt.merker ? [["data-konto", "erwartet"]] : [],
  );
  const elem = (tag: string, felder: Record<string, Elem[]> = {}): Elem => {
    const e: Elem = {
      tag,
      attr: new Map(),
      textContent: "",
      children: [],
      hidden: false,
      open: false,
      classList: { add: (n) => e.attr.set("class", n) },
      setAttribute: (n, v) => void e.attr.set(n, v),
      getAttribute: (n) => e.attr.get(n) ?? null,
      removeAttribute: (n) => void e.attr.delete(n),
      addEventListener: () => {},
      querySelector: (s) => felder[s]?.[0] ?? null,
      querySelectorAll: (s) => felder[s] ?? [],
      append: (k) => void e.children.push(k),
      remove: () => void (e.textContent = "ENTFERNT"),
      contains: () => false,
      replaceWith: (n) => void (e.ersatz = n),
      cloneNode: () => e,
      closest: () => null,
      focus: () => {},
    };
    return e;
  };
  const name = [elem("span"), elem("strong")];
  const initialen = [elem("span")];
  const verw = [elem("li"), elem("li")];
  const abmelden = elem("button");
  const ava = elem("span");
  const menue = elem("details", {
    '[data-konto="name"]': name,
    '[data-konto="initialen"]': initialen,
    '[data-konto="verwaltung"]': verw,
    '[data-konto="abmelden"]': [abmelden],
    ".konto-meldung": [elem("p")],
    ".konto-ava": [ava],
    summary: [elem("summary")],
  });
  const anmelden = elem("a");
  anmelden.closest = () => (opt.imMenue ? elem("div") : null);
  const vorlage = { content: { firstElementChild: menue } };
  const dokument = {
    documentElement: {
      removeAttribute: (n: string) => void wurzelAttr.delete(n),
    },
    getElementById: (id: string) =>
      id === "konto-vorlage" && opt.vorlage !== false ? vorlage : null,
    querySelectorAll: () => [anmelden],
    createElement: (t: string) => elem(t),
    addEventListener: () => {},
  };
  runInNewContext(skript, {
    document: dokument,
    window: {
      sessionStorage: {
        getItem: (k: string) => speicher.get(k) ?? null,
        setItem: (k: string, v: string) => void speicher.set(k, v),
        removeItem: (k: string) => void speicher.delete(k),
      },
      addEventListener: () => {},
      location: { reload: () => {} },
    },
    fetch: (url: string, o?: Record<string, unknown>) => {
      aufrufe.push({ url, opt: o });
      return opt.antwort();
    },
    AbortController,
    setTimeout,
    clearTimeout,
    Array,
    Promise,
    RegExp,
    String,
    Object,
  });
  return {
    aufrufe,
    speicher,
    wurzelAttr,
    anmelden,
    name,
    initialen,
    verw,
    menue,
  };
}

const warte = () => new Promise((r) => setTimeout(r, 20));
const ok = (daten: unknown) => async () => ({
  ok: true,
  json: async () => daten,
});

describe("konto.js: Verhalten", () => {
  test("gültige Sitzung: tauscht «Anmelden» gegen das Menü, setzt Name und Initiale, löscht den Merker nicht", async () => {
    const l = lauf({
      antwort: ok({ name: "Funke", bildUrl: null, verwaltung: true }),
      merker: true,
    });
    await warte();
    expect(l.aufrufe).toHaveLength(1);
    expect(l.aufrufe[0]!.url).toBe("/api/v1/website/konto");
    expect(l.aufrufe[0]!.opt).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(l.anmelden.ersatz).toBe(l.menue);
    expect(l.name.map((n) => n.textContent)).toEqual(["Funke", "Funke"]);
    expect(l.initialen[0]!.textContent).toBe("F");
    // Mit Zugang bleiben die Einträge der Verwaltung
    expect(l.verw.map((v) => v.textContent)).toEqual(["", ""]);
    expect(l.speicher.get("cevi-konto")).toBe("1");
    expect(l.wurzelAttr.has("data-konto")).toBe(false);
  });

  test("ohne Zugang zur Verwaltung entfallen deren Einträge", async () => {
    const l = lauf({
      antwort: ok({ name: "Lua", bildUrl: null, verwaltung: false }),
    });
    await warte();
    expect(l.verw.map((v) => v.textContent)).toEqual(["ENTFERNT", "ENTFERNT"]);
  });

  test("im Menü am Handy steht die Liste ausgeklappt", async () => {
    const l = lauf({
      antwort: ok({ name: "Lua", bildUrl: null, verwaltung: false }),
      imMenue: true,
    });
    await warte();
    expect(l.menue.open).toBe(true);
    expect(l.menue.getAttribute("class")).toBe("konto-menue--liste");
  });

  test("ohne Sitzung (401) bleibt «Anmelden», der Merker ist weg und der Knopf wieder sichtbar", async () => {
    const l = lauf({
      antwort: async () => ({
        ok: false,
        json: async () => ({ code: "NICHT_ANGEMELDET" }),
      }),
      merker: true,
    });
    await warte();
    expect(l.anmelden.ersatz).toBeUndefined();
    expect(l.speicher.has("cevi-konto")).toBe(false);
    expect(l.wurzelAttr.has("data-konto")).toBe(false);
  });

  test("bei einem Netzfehler bleibt «Anmelden»", async () => {
    const l = lauf({
      antwort: async () => {
        throw new Error("Netz");
      },
      merker: true,
    });
    await warte();
    expect(l.anmelden.ersatz).toBeUndefined();
    expect(l.wurzelAttr.has("data-konto")).toBe(false);
  });

  test.each([
    [
      "ein Bild von aussen",
      { name: "A", bildUrl: "https://boese.example/x.png", verwaltung: false },
    ],
    [
      "ein Pfad ohne Version",
      {
        name: "A",
        bildUrl: "/api/v1/personen/0190a000-0000-7000-8000-000000000001/bild",
        verwaltung: false,
      },
    ],
    ["ein leerer Name", { name: "", bildUrl: null, verwaltung: false }],
    [
      "ein Zugang, der kein Boolean ist",
      { name: "A", bildUrl: null, verwaltung: "ja" },
    ],
    [
      "ein Name, der kein Text ist",
      { name: 5, bildUrl: null, verwaltung: false },
    ],
    ["kein Objekt", null],
  ])("eine Antwort mit %s wird nicht übernommen", async (_, daten) => {
    const l = lauf({ antwort: ok(daten) });
    await warte();
    expect(l.anmelden.ersatz).toBeUndefined();
  });

  test("ohne Vorlage fragt das Skript nicht", async () => {
    const l = lauf({ antwort: ok({}), vorlage: false });
    await warte();
    expect(l.aufrufe).toHaveLength(0);
  });

  test("nur der eigene Ursprung: kein innerHTML, keine fremde Adresse, kein localStorage, keine Daten in Cookies", () => {
    // Ohne die Kommentare, die diese Namen erwähnen
    const skript = readFileSync(
      new URL("../public/website/konto.js", import.meta.url),
      "utf8",
    ).replace(/^\s*\/\/.*$/gm, "");
    expect(skript).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|document\.write|localStorage|document\.cookie/,
    );
    expect(skript).not.toMatch(/https?:\/\//);
    // Abmelden: derselbe Aufruf wie in der Verwaltung
    expect(skript).toContain('"/api/auth/sign-out"');
    expect(skript).toContain('method: "POST"');
  });
});

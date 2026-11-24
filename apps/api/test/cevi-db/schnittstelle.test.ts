import { describe, expect, test, vi } from "vitest";
import {
  ANNAHMEN,
  CeviDbFehler,
  MAX_BYTES_SEITE,
  erstelleCeviDbClient,
} from "../../src/cevi-db/client.js";
import {
  FEHLER_MERKEN_MS,
  GUELTIG_MS,
  erstelleCeviDbDienst,
} from "../../src/cevi-db/dienst.js";
import { wertFuer, type CeviPerson } from "../../src/cevi-db/felder.js";
import { ordneZu } from "../../src/cevi-db/zuordnung.js";
import { ladeKonfiguration } from "../../src/konfiguration.js";

// Nur erfundene Personen und ein erfundenes Token; keine echte Verbindung
const URL_ = "https://cevi-db.example.org";
const TOKEN = "nur-fuer-tests-token-0123456789";

const person = (id: string, mehr: Partial<CeviPerson> = {}): CeviPerson => ({
  id,
  vorname: "Lea",
  nachname: "Muster",
  email: null,
  geburtsdatum: null,
  telefon: null,
  strasse: null,
  plz: null,
  ort: null,
  ...mehr,
});

// JSON:API-Antwort wie hitobito sie liefert (erfunden), samt einer Telefonnummer und Feldern, die wir nie behalten
const roh = (
  id: number,
  attr: Record<string, unknown> = {},
  telefon?: string,
) => ({
  id: String(id),
  type: "people",
  attributes: {
    first_name: "Lea",
    last_name: "Muster",
    email: "Eltern@Example.org",
    birthday: "2014-05-17",
    address: "Teststrasse 1",
    zip_code: 8000,
    town: "Testdorf",
    gender: "w",
    nickname: "Sunny",
    ...attr,
  },
  relationships: telefon
    ? { phone_numbers: { data: [{ id: `p${id}`, type: "phone_numbers" }] } }
    : {},
});
const seite = (data: unknown[], included: unknown[] = []) =>
  new Response(JSON.stringify({ data, included }), {
    status: 200,
    headers: { "content-type": "application/vnd.api+json" },
  });

describe("Zuordnung", () => {
  const anfrage = {
    ceviDbId: null,
    emails: ["eltern@example.org"],
    vorname: "Lea",
    nachname: "Muster",
    geburtsdatum: null,
  };

  test("E-Mail und Vorname: genau ein Treffer", () => {
    const z = ordneZu(
      [
        person("1", { email: "eltern@example.org" }),
        person("2", { vorname: "Noah", email: "eltern@example.org" }),
      ],
      anfrage,
    );
    expect(z).toEqual({ art: "treffer", person: expect.objectContaining({ id: "1" }) });
  });

  test("ohne Treffer: keiner", () => {
    expect(ordneZu([person("1", { email: "fremd@example.org" })], anfrage)).toEqual({
      art: "keiner",
    });
  });

  test("mehrere Treffer: mehrdeutig, und das Ergebnis nennt keine Person", () => {
    const z = ordneZu(
      [
        person("1", { email: "eltern@example.org" }),
        person("2", { email: "eltern@example.org", nachname: "Andere" }),
      ],
      anfrage,
    );
    expect(z).toEqual({ art: "mehrdeutig" });
  });

  test("ein Name allein ist nie ein Treffer", () => {
    expect(
      ordneZu([person("1")], { ...anfrage, emails: [], geburtsdatum: null }),
    ).toEqual({ art: "keiner" });
    // auch nicht mit gleichem Namen und anderer E-Mail
    expect(ordneZu([person("1", { email: "x@example.org" })], anfrage)).toEqual({
      art: "keiner",
    });
  });

  test("Name plus Geburtsdatum entscheidet, wenn die E-Mail nichts sagt", () => {
    const personen = [
      person("1", { geburtsdatum: "2014-05-17" }),
      person("2", { geburtsdatum: "2015-01-01" }),
    ];
    const z = ordneZu(personen, {
      ...anfrage,
      emails: [],
      geburtsdatum: "2014-05-17",
    });
    expect(z).toEqual({ art: "treffer", person: expect.objectContaining({ id: "1" }) });
  });

  test("Zwillinge: gleiche E-Mail und Vorname, das Geburtsdatum entscheidet", () => {
    const personen = [
      person("1", { email: "eltern@example.org", geburtsdatum: "2014-05-17" }),
      person("2", { email: "eltern@example.org", geburtsdatum: "2014-05-18" }),
    ];
    expect(ordneZu(personen, anfrage)).toEqual({ art: "mehrdeutig" });
    expect(
      ordneZu(personen, { ...anfrage, geburtsdatum: "2014-05-18" }),
    ).toEqual({ art: "treffer", person: expect.objectContaining({ id: "2" }) });
  });

  test("die gemerkte Nummer gilt zuerst; eine unbekannte Nummer fällt auf die E-Mail zurück", () => {
    const personen = [person("1", { email: "eltern@example.org" }), person("7")];
    expect(ordneZu(personen, { ...anfrage, ceviDbId: "7" })).toEqual({
      art: "treffer",
      person: expect.objectContaining({ id: "7" }),
    });
    expect(ordneZu(personen, { ...anfrage, ceviDbId: "99" })).toEqual({
      art: "treffer",
      person: expect.objectContaining({ id: "1" }),
    });
  });

  test("Gross-/Kleinschreibung und Akzente zählen nicht", () => {
    const z = ordneZu(
      [person("1", { vorname: "Léa", email: "eltern@example.org" })],
      { ...anfrage, vorname: "LEA" },
    );
    expect(z.art).toBe("treffer");
  });

  test("Werte: Geburtsdatum als TT.MM.JJJJ, Fehlendes ist null", () => {
    const p = person("1", { geburtsdatum: "2014-05-17", ort: "Testdorf" });
    expect(wertFuer(p, "geburtsdatum")).toBe("17.05.2014");
    expect(wertFuer(p, "ort")).toBe("Testdorf");
    expect(wertFuer(p, "telefon")).toBeNull();
  });
});

describe("Client", () => {
  test("schickt das Token im Kopf, nie in der Adresse, ohne Weiterleitung und mit Zeitlimit", async () => {
    const holen = vi.fn(async () => seite([]));
    const client = erstelleCeviDbClient({ url: URL_, token: TOKEN, holen });
    await client.personen();
    const [ziel, optionen] = holen.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(ziel)).not.toContain(TOKEN);
    expect(new URL(ziel).origin).toBe(URL_);
    expect(new URL(ziel).pathname).toBe(ANNAHMEN.pfadPersonen);
    expect(new URL(ziel).searchParams.get("page[number]")).toBe("1");
    expect((optionen.headers as Record<string, string>)["X-TOKEN"]).toBe(TOKEN);
    expect(optionen.redirect).toBe("error");
    expect(optionen.signal).toBeInstanceOf(AbortSignal);
  });

  test("liest Seiten bis zur leeren, behält nur die Felder der Liste und die Telefonnummer", async () => {
    const holen = vi.fn(async (ziel: URL | string | Request) => {
      const nr = new URL(String(ziel)).searchParams.get("page[number]");
      if (nr === "1")
        return seite(
          [roh(1, {}, "x"), roh(2)],
          [{ id: "p1", type: "phone_numbers", attributes: { number: "079 000 00 00" } }],
        );
      if (nr === "2") return seite([roh(3)]);
      return seite([]);
    });
    const personen = await erstelleCeviDbClient({
      url: URL_,
      token: TOKEN,
      holen: holen as unknown as typeof fetch,
    }).personen();
    expect(personen.map((p) => p.id)).toEqual(["1", "2", "3"]);
    expect(personen[0]).toEqual({
      id: "1",
      vorname: "Lea",
      nachname: "Muster",
      email: "eltern@example.org",
      geburtsdatum: "2014-05-17",
      telefon: "079 000 00 00",
      strasse: "Teststrasse 1",
      plz: "8000",
      ort: "Testdorf",
    });
    // gender und nickname sind nirgends mehr zu finden
    expect(JSON.stringify(personen)).not.toMatch(/Sunny|"gender"/);
  });

  test("eine Seite ohne neue Person beendet den Abruf (die Gegenseite ignoriert die Seitenzahl)", async () => {
    const holen = vi.fn(async () => seite([roh(1)]));
    const personen = await erstelleCeviDbClient({
      url: URL_,
      token: TOKEN,
      holen,
    }).personen();
    expect(personen).toHaveLength(1);
    expect(holen).toHaveBeenCalledTimes(2);
  });

  test("nie mehr Seiten als erlaubt: das ist ein Fehler, keine abgeschnittene Liste", async () => {
    let n = 0;
    const holen = vi.fn(async () => seite([roh(++n)]));
    await expect(
      erstelleCeviDbClient({ url: URL_, token: TOKEN, holen }).personen(),
    ).rejects.toMatchObject({ art: "antwort" });
    expect(holen).toHaveBeenCalledTimes(ANNAHMEN.maxSeiten);
  });

  test.each([
    ["401", new Response("{}", { status: 401 }), "abgelehnt"],
    ["403", new Response("{}", { status: 403 }), "abgelehnt"],
    ["500", new Response("{}", { status: 500 }), "nicht_erreichbar"],
    ["kein JSON", new Response("<html>", { status: 200 }), "antwort"],
    [
      "falsche Form",
      new Response(JSON.stringify({ data: "x" }), { status: 200 }),
      "antwort",
    ],
    [
      "Person ohne Attribute",
      new Response(JSON.stringify({ data: [{ id: "1" }] }), { status: 200 }),
      "antwort",
    ],
  ])("%s ist ein fester Fehler", async (_n, antwort, art) => {
    const holen = vi.fn(async () => antwort);
    await expect(
      erstelleCeviDbClient({ url: URL_, token: TOKEN, holen }).personen(),
    ).rejects.toMatchObject({ art });
  });

  test("Netzfehler, Zeitüberschreitung und Weiterleitung sind «nicht erreichbar» und verraten weder Token noch Adresse", async () => {
    for (const fehler of [
      new TypeError(`fetch failed ${TOKEN} ${URL_}`),
      new DOMException("timeout", "TimeoutError"),
      new TypeError("unexpected redirect"),
    ]) {
      const holen = vi.fn(async () => {
        throw fehler;
      });
      const f = await erstelleCeviDbClient({ url: URL_, token: TOKEN, holen })
        .personen()
        .catch((e: unknown) => e);
      expect(f).toBeInstanceOf(CeviDbFehler);
      expect((f as CeviDbFehler).art).toBe("nicht_erreichbar");
      expect(String((f as Error).message)).not.toContain(TOKEN);
      expect(String((f as Error).message)).not.toContain("example.org");
    }
  });

  test("eine zu grosse Antwort wird abgebrochen", async () => {
    const gross = "x".repeat(MAX_BYTES_SEITE + 10);
    const holen = vi.fn(async () => new Response(gross, { status: 200 }));
    await expect(
      erstelleCeviDbClient({ url: URL_, token: TOKEN, holen }).personen(),
    ).rejects.toMatchObject({ art: "antwort" });
  });

  test("pruefe: Gruppe sichtbar, unbekannt, Token abgelehnt", async () => {
    const holen = vi.fn(async (ziel: URL | string | Request) =>
      String(ziel).includes("/api/groups/1234")
        ? new Response("{}", { status: 200 })
        : String(ziel).includes("/api/groups/")
          ? new Response("{}", { status: 404 })
          : seite([]),
    );
    const client = erstelleCeviDbClient({
      url: URL_,
      token: TOKEN,
      holen: holen as unknown as typeof fetch,
    });
    expect(await client.pruefe(null)).toEqual({ gruppe: null });
    expect(await client.pruefe("1234")).toEqual({ gruppe: true });
    expect(await client.pruefe("9999")).toEqual({ gruppe: false });
    const abgelehnt = erstelleCeviDbClient({
      url: URL_,
      token: TOKEN,
      holen: async () => new Response("{}", { status: 401 }),
    });
    await expect(abgelehnt.pruefe("1234")).rejects.toMatchObject({
      art: "abgelehnt",
    });
  });
});

describe("Dienst (Zwischenspeicher im Arbeitsspeicher)", () => {
  const stumm = () => vi.spyOn(console, "log").mockImplementation(() => {});

  test("holt einmal und hält die Personen höchstens 15 Minuten", async () => {
    const log = stumm();
    let jetzt = 1_000;
    const personen = vi.fn(async () => [person("1")]);
    const dienst = erstelleCeviDbDienst({
      client: { personen, pruefe: async () => ({ gruppe: null }) },
      jetzt: () => jetzt,
    });
    await dienst.personen("a");
    await dienst.personen("a");
    expect(personen).toHaveBeenCalledTimes(1);
    jetzt += GUELTIG_MS + 1;
    await dienst.personen("a");
    expect(personen).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  test("gleichzeitige Abrufe teilen sich eine Anfrage", async () => {
    const log = stumm();
    const personen = vi.fn(async () => [person("1")]);
    const dienst = erstelleCeviDbDienst({
      client: { personen, pruefe: async () => ({ gruppe: null }) },
    });
    await Promise.all([dienst.personen("a"), dienst.personen("a"), dienst.personen("a")]);
    expect(personen).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  test("ein Fehler wird kurz gemerkt, danach neu versucht, und das Log nennt nur die Art", async () => {
    const log = stumm();
    let jetzt = 0;
    const personen = vi.fn(async () => {
      throw new CeviDbFehler("nicht_erreichbar");
    });
    const dienst = erstelleCeviDbDienst({
      client: { personen, pruefe: async () => ({ gruppe: null }) },
      jetzt: () => jetzt,
    });
    expect(await dienst.personen("a")).toEqual({
      ok: false,
      art: "nicht_erreichbar",
    });
    await dienst.personen("a");
    expect(personen).toHaveBeenCalledTimes(1);
    jetzt += FEHLER_MERKEN_MS + 1;
    await dienst.personen("a");
    expect(personen).toHaveBeenCalledTimes(2);
    const zeilen = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(zeilen).toContain("nicht_erreichbar");
    expect(zeilen).not.toContain(TOKEN);
    log.mockRestore();
  });

  test("der Stand des Abrufs geht an beiAbruf, Fehler dort stören nichts", async () => {
    const beiAbruf = vi.fn(async () => {
      throw new Error("Datenbank weg");
    });
    const dienst = erstelleCeviDbDienst({
      client: {
        personen: async () => [person("1"), person("2")],
        pruefe: async () => ({ gruppe: null }),
      },
      beiAbruf,
    });
    expect((await dienst.personen("a")).ok).toBe(true);
    expect(beiAbruf).toHaveBeenCalledWith("a", { ok: true, anzahl: 2 });
  });
});

describe("Konfiguration", () => {
  const BASIS = {
    DATABASE_URL: "postgres://cevi:geheim-1@db.example.org:5432/cevi_os",
    APP_MIN_VERSION: "0.1.0",
    PORT: "3000",
    BETTER_AUTH_SECRET: "geheim-6-0123456789abcdef0123456789abcdef",
    BETTER_AUTH_URL: "http://localhost:3000",
  };

  test("ohne beide Variablen läuft die API ohne Cevi-Datenbank", () => {
    const k = ladeKonfiguration(BASIS);
    expect(k.CEVI_DB_URL).toBeUndefined();
    expect(k.CEVI_DB_TOKEN).toBeUndefined();
    // eine leere Zeile in deploy/.env gilt als nicht gesetzt
    expect(
      ladeKonfiguration({ ...BASIS, CEVI_DB_URL: "", CEVI_DB_TOKEN: "" })
        .CEVI_DB_URL,
    ).toBeUndefined();
  });

  test("beide gesetzt: nur die Herkunft bleibt", () => {
    const k = ladeKonfiguration({
      ...BASIS,
      CEVI_DB_URL: "https://cevi-db.example.org/irgendwas/",
      CEVI_DB_TOKEN: TOKEN,
    });
    expect(k.CEVI_DB_URL).toBe("https://cevi-db.example.org");
  });

  test("eine allein ist ein Fehler, und die Meldung nennt nur Namen", () => {
    for (const env of [
      { CEVI_DB_URL: URL_ },
      { CEVI_DB_TOKEN: TOKEN },
    ]) {
      let meldung = "";
      try {
        ladeKonfiguration({ ...BASIS, ...env });
      } catch (f) {
        meldung = (f as Error).message;
      }
      expect(meldung).toMatch(/CEVI_DB_(URL|TOKEN)/);
      expect(meldung).not.toContain(TOKEN);
    }
  });

  test("http nur für den eigenen Rechner, in Produktion nie", () => {
    const ok = {
      ...BASIS,
      CEVI_DB_URL: "http://127.0.0.1:4999",
      CEVI_DB_TOKEN: TOKEN,
    };
    expect(ladeKonfiguration(ok).CEVI_DB_URL).toBe("http://127.0.0.1:4999");
    expect(() =>
      ladeKonfiguration({ ...ok, CEVI_DB_URL: "http://cevi-db.example.org" }),
    ).toThrow(/CEVI_DB_URL/);
    expect(() =>
      ladeKonfiguration({
        ...ok,
        NODE_ENV: "production",
        BETTER_AUTH_URL: "https://api.example.org",
      }),
    ).toThrow(/CEVI_DB_URL/);
  });

  test("ein zu kurzes Token wird abgelehnt, ohne es zu nennen", () => {
    let meldung = "";
    try {
      ladeKonfiguration({
        ...BASIS,
        CEVI_DB_URL: URL_,
        CEVI_DB_TOKEN: "kurz-geheim",
      });
    } catch (f) {
      meldung = (f as Error).message;
    }
    expect(meldung).toContain("CEVI_DB_TOKEN");
    expect(meldung).not.toContain("kurz-geheim");
  });
});

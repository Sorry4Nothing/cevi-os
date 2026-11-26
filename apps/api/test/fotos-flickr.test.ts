import { describe, expect, test } from "vitest";
import {
  begrenze,
  erstelleFlickr,
  MAX_BILD_BYTES,
  MAX_ORIGINAL_BYTES,
  signiere,
} from "../src/fotos/flickr.js";
import { QuellFehler, type QuellBild } from "../src/fotos/quelle.js";

// Der Flickr-Client ohne Netz: fetch ist eine Attrappe mit erfundenen Antworten. Keine echten Konten, Schlüssel oder Fotos.
const KONTO = "12345678@N00";
const SCHLUESSEL = "TestSchluesselNurFuerTests";
const GEHEIM = "ffeeddccbbaa9988";
const TOKEN = "72157600000000000-0123456789abcdef";
const TOKEN_GEHEIM = "fedcba9876543210";

const json = (daten: unknown, status = 200) =>
  new Response(JSON.stringify(daten), {
    status,
    headers: { "content-type": "application/json" },
  });
const pixel = (typ = "image/jpeg", laenge?: number) =>
  new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: {
      "content-type": typ,
      ...(laenge !== undefined && { "content-length": String(laenge) }),
    },
  });

type Aufruf = { url: URL; init: RequestInit | undefined };
function attrappe(antwort: (url: URL) => Response | Promise<Response>) {
  const aufrufe: Aufruf[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    const u = new URL(String(url));
    aufrufe.push({ url: u, init });
    return antwort(u);
  }) as unknown as typeof fetch;
  return { f, aufrufe };
}

describe("OAuth-Signatur", () => {
  test("Beispiel aus RFC 5849 (Abschnitt 3.4.1 und 3.4.2 sinngemäss) ergibt eine feste Signatur", () => {
    // Erfundene Werte; die Signatur ist von Hand mit HMAC-SHA1 nachgerechnet
    const a = signiere(
      "GET",
      "https://example.org/rest/",
      { b: "2", a: "1 2", c: "!*'()" },
      "geheim",
      "token",
    );
    const b = signiere(
      "get",
      "https://example.org/rest/",
      { c: "!*'()", a: "1 2", b: "2" },
      "geheim",
      "token",
    );
    // Reihenfolge der Parameter und Gross-/Kleinschreibung der Methode ändern nichts
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{27}=$/);
    // Ein anderes Token-Secret gibt eine andere Signatur
    expect(
      signiere("GET", "https://example.org/rest/", { a: "1" }, "geheim", "x"),
    ).not.toBe(
      signiere("GET", "https://example.org/rest/", { a: "1" }, "geheim", "y"),
    );
  });
});

describe("Albumliste", () => {
  const liste = {
    stat: "ok",
    photosets: {
      pages: 1,
      photoset: [
        {
          id: "72157000000000001",
          primary: "5000000001",
          secret: "aabbccddee",
          server: "65535",
          photos: "12",
          title: { _content: "Sommerlager Beispiel" },
          date_create: "1780000000",
        },
        {
          id: "72157000000000002",
          title: { _content: "Ohne Bild" },
          photos: 0,
        },
      ],
    },
  };

  test("liest Titel, Anzahl, Datum und Titelbild; ein Album ohne Titelbild hat keines", async () => {
    const { f, aufrufe } = attrappe(() => json(liste));
    const q = erstelleFlickr({ apiKey: SCHLUESSEL, fetch: f });
    const alben = await q.alben(KONTO);
    expect(alben).toHaveLength(2);
    expect(alben[0]).toMatchObject({
      id: "72157000000000001",
      titel: "Sommerlager Beispiel",
      anzahl: 12,
      datum: "2026-05-28",
    });
    expect(alben[0]!.titelbild).toMatchObject({
      id: "5000000001",
      server: "65535",
      secret: "aabbccddee",
    });
    expect(alben[1]!.titelbild).toBeNull();
    // Der Abruf: feste API-Adresse, Methode, Konto, JSON; ohne Token kein OAuth
    const u = aufrufe[0]!.url;
    expect(u.origin + u.pathname).toBe("https://api.flickr.com/services/rest/");
    expect(u.searchParams.get("method")).toBe("flickr.photosets.getList");
    expect(u.searchParams.get("user_id")).toBe(KONTO);
    expect(u.searchParams.get("format")).toBe("json");
    expect(u.searchParams.has("oauth_signature")).toBe(false);
    expect(aufrufe[0]!.init?.redirect).toBe("error");
    expect(aufrufe[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("mit Token ist jeder Abruf signiert, und kein Geheimnis steht in der Adresse", async () => {
    const { f, aufrufe } = attrappe(() => json(liste));
    const q = erstelleFlickr({
      apiKey: SCHLUESSEL,
      apiSecret: GEHEIM,
      token: TOKEN,
      tokenSecret: TOKEN_GEHEIM,
      tokenKonto: KONTO,
      fetch: f,
      jetzt: () => 1_780_000_000_000,
    });
    await q.alben(KONTO);
    const u = aufrufe[0]!.url;
    expect(u.searchParams.get("oauth_signature_method")).toBe("HMAC-SHA1");
    expect(u.searchParams.get("oauth_token")).toBe(TOKEN);
    expect(u.searchParams.get("oauth_timestamp")).toBe("1780000000");
    expect(u.searchParams.get("oauth_signature")).toBeTruthy();
    // Die Secrets gehen nie als Parameter hinaus, nur als Schlüssel der Signatur
    expect(u.href).not.toContain(GEHEIM);
    expect(u.href).not.toContain(TOKEN_GEHEIM);
  });

  test("signiert wird nur für das Konto des Tokens; jedes andere Konto sieht nur Öffentliches (#777)", async () => {
    const { f, aufrufe } = attrappe(() => json(liste));
    const q = erstelleFlickr({
      apiKey: SCHLUESSEL,
      apiSecret: GEHEIM,
      token: TOKEN,
      tokenSecret: TOKEN_GEHEIM,
      tokenKonto: KONTO,
      fetch: f,
    });
    await q.alben("87654321@N00");
    expect(aufrufe[0]!.url.searchParams.has("oauth_signature")).toBe(false);
    expect(aufrufe[0]!.url.searchParams.has("oauth_token")).toBe(false);
    // Ohne bekanntes Konto des Tokens signiert nichts
    const ohneKonto = attrappe(() => json(liste));
    await erstelleFlickr({
      apiKey: SCHLUESSEL,
      apiSecret: GEHEIM,
      token: TOKEN,
      tokenSecret: TOKEN_GEHEIM,
      fetch: ohneKonto.f,
    }).alben(KONTO);
    expect(ohneKonto.aufrufe[0]!.url.searchParams.has("oauth_signature")).toBe(
      false,
    );
  });

  test("eine Kontokennung, die keine ist, geht gar nicht erst hinaus", async () => {
    const { f, aufrufe } = attrappe(() => json(liste));
    const q = erstelleFlickr({ apiKey: SCHLUESSEL, fetch: f });
    await expect(q.alben("jemand@example.org")).rejects.toMatchObject({
      art: "nicht_gefunden",
    });
    await expect(q.alben("12345678@N00&method=x")).rejects.toBeInstanceOf(
      QuellFehler,
    );
    expect(aufrufe).toHaveLength(0);
  });
});

describe("Fehler", () => {
  const abruf = (antwort: () => Response | Promise<Response>) =>
    erstelleFlickr({ apiKey: SCHLUESSEL, fetch: attrappe(antwort).f });
  const fehler = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (f: unknown) => f as QuellFehler,
    );

  test.each([
    [1, "nicht_gefunden"],
    [98, "zugang"],
    [100, "zugang"],
    [105, "nicht_erreichbar"],
  ])("Flickr meldet Code %i: Art %s", async (code, art) => {
    const f = await fehler(
      abruf(() =>
        json({ stat: "fail", code, message: `Geheim ${SCHLUESSEL} im Text` }),
      ).alben(KONTO),
    );
    expect(f).toBeInstanceOf(QuellFehler);
    expect(f!.art).toBe(art);
    // Weder der Text von Flickr noch ein Schlüssel kommt in die Fehlermeldung
    expect(f!.message).toBe(art);
    expect(JSON.stringify(f)).not.toContain(SCHLUESSEL);
  });

  test("Netzfehler, Zeitlimit und HTTP-Fehler sind «nicht erreichbar»", async () => {
    for (const antwort of [
      () => {
        throw new TypeError(`fetch failed ${SCHLUESSEL}`);
      },
      () => new Response("x", { status: 429 }),
      () => new Response("x", { status: 500 }),
    ]) {
      const f = await fehler(abruf(antwort).alben(KONTO));
      expect(f!.art).toBe("nicht_erreichbar");
      expect(f!.message).not.toContain(SCHLUESSEL);
    }
  });

  test("ein Zeitlimit bricht ab: das Signal der Anfrage läuft ab", async () => {
    let signal: AbortSignal | undefined;
    const f = await fehler(
      erstelleFlickr({
        apiKey: SCHLUESSEL,
        fetch: (async (_u: unknown, init?: RequestInit) => {
          signal = init?.signal ?? undefined;
          throw new DOMException("Zeit", "TimeoutError");
        }) as unknown as typeof fetch,
      }).alben(KONTO),
    );
    expect(f!.art).toBe("nicht_erreichbar");
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  test("Antwort ohne erwartete Form oder kein JSON: nicht erreichbar; zu grosse Antwort wird abgebrochen", async () => {
    expect(
      (await fehler(abruf(() => json({ stat: "ok", x: 1 })).alben(KONTO)))!.art,
    ).toBe("nicht_erreichbar");
    expect(
      (await fehler(abruf(() => new Response("<html>")).alben(KONTO)))!.art,
    ).toBe("nicht_erreichbar");
    const gross = new Response(new Uint8Array(5 * 1024 * 1024).fill(32));
    expect((await fehler(abruf(() => gross).alben(KONTO)))!.art).toBe(
      "nicht_erreichbar",
    );
  });
});

describe("Album mit Bildern", () => {
  // Adressen wie bei Flickr: ab 1600 und beim Original ein eigenes Secret je Grösse (misc.urls)
  const adresse = (id: string, secret: string, suffix: string, typ = "jpg") =>
    `https://live.staticflickr.com/4321/${id}_${secret}_${suffix}.${typ}`;
  const bilder = (seite: number, seiten: number, n: number) =>
    json({
      stat: "ok",
      photoset: {
        pages: seiten,
        photo: Array.from({ length: n }, (_, i) => {
          const id = String(6000000000 + seite * 1000 + i);
          return {
            id,
            secret: "0a1b2c3d4e",
            server: "4321",
            title: i === 0 ? "Zelt" : "",
            url_n: adresse(id, "0a1b2c3d4e", "n"),
            width_n: 320,
            height_n: "240",
            url_z: adresse(id, "0a1b2c3d4e", "z"),
            width_z: 640,
            height_z: 480,
            ...(i === 0 && {
              url_l: adresse(id, "0a1b2c3d4e", "b"),
              width_l: 1024,
              height_l: 768,
              url_k: adresse(id, "aa11bb22cc", "k"),
              width_k: 2048,
              height_k: 1536,
              url_o: adresse(id, "99ff88ee77", "o", "png"),
              width_o: 6000,
              height_o: 4500,
              // Passt nicht: falsche Endung, anderes Bild, anderer Server, Unsinn, ohne Masse
              url_h: adresse(id, "1234567890", "k"),
              width_h: 1600,
              height_h: 1200,
              url_3k: adresse("6000000999", "1234567890", "3k"),
              width_3k: 3072,
              height_3k: 2304,
              url_4k: `https://live.staticflickr.com/9999/${id}_1234567890_4k.jpg`,
              width_4k: 4096,
              height_4k: 3072,
              url_5k: "javascript:alert(1)",
              width_5k: 5120,
              height_5k: 3840,
              url_6k: adresse(id, "1234567890", "6k"),
            }),
          };
        }),
      },
    });

  test("holt Info und alle Seiten und bildet Grössenstufen", async () => {
    const { f, aufrufe } = attrappe((u) => {
      const m = u.searchParams.get("method");
      if (m === "flickr.photosets.getInfo") {
        return json({
          stat: "ok",
          photoset: {
            id: "72157000000000001",
            title: { _content: "Beispiel" },
            photos: 3,
            date_create: "1780000000",
          },
        });
      }
      const seite = Number(u.searchParams.get("page"));
      return bilder(seite, 2, seite === 1 ? 2 : 1);
    });
    const q = erstelleFlickr({ apiKey: SCHLUESSEL, fetch: f });
    const r = await q.album(KONTO, "72157000000000001");
    expect(r.album.titel).toBe("Beispiel");
    expect(r.bilder).toHaveLength(3);
    expect(r.bilder[0]).toMatchObject({
      titel: "Zelt",
      breite: 320,
      hoehe: 240,
    });
    // Nur, was Flickr für das Bild in der Stufe meldet, mit eigenem Secret und Dateityp
    expect(r.bilder[0]!.groessen).toEqual({
      "320": { secret: "0a1b2c3d4e", breite: 320, hoehe: 240, endung: "jpg" },
      "640": { secret: "0a1b2c3d4e", breite: 640, hoehe: 480, endung: "jpg" },
      "1024": { secret: "0a1b2c3d4e", breite: 1024, hoehe: 768, endung: "jpg" },
      "2048": {
        secret: "aa11bb22cc",
        breite: 2048,
        hoehe: 1536,
        endung: "jpg",
      },
      original: {
        secret: "99ff88ee77",
        breite: 6000,
        hoehe: 4500,
        endung: "png",
      },
    });
    expect(Object.keys(r.bilder[1]!.groessen)).toEqual(["320", "640"]);
    expect(aufrufe.map((a) => a.url.searchParams.get("method"))).toEqual([
      "flickr.photosets.getInfo",
      "flickr.photosets.getPhotos",
      "flickr.photosets.getPhotos",
    ]);
    // Flickr nennt 1024 «url_l»; das Original nur, wenn das Konto es freigibt
    expect(aufrufe[1]!.url.searchParams.get("extras")).toBe(
      "url_n,url_w,url_z,url_c,url_l,url_h,url_k,url_3k,url_4k,url_5k,url_6k,url_o",
    );
  });

  test("ein Album von Flickr, das es nicht gibt, ist «nicht gefunden»", async () => {
    const q = erstelleFlickr({
      apiKey: SCHLUESSEL,
      fetch: attrappe(() => json({ stat: "fail", code: 1 })).f,
    });
    await expect(q.album(KONTO, "72157000000000009")).rejects.toMatchObject({
      art: "nicht_gefunden",
    });
    await expect(q.album(KONTO, "nicht-digits")).rejects.toMatchObject({
      art: "nicht_gefunden",
    });
  });
});

describe("Bilddatei", () => {
  const bild = (mehr: Partial<QuellBild> = {}): QuellBild => ({
    id: "6000000001",
    server: "4321",
    secret: "0a1b2c3d4e",
    titel: "",
    breite: 4,
    hoehe: 3,
    groessen: {
      "320": { secret: "0a1b2c3d4e", breite: 320, hoehe: 240, endung: "jpg" },
      "640": { secret: "0a1b2c3d4e", breite: 640, hoehe: 480, endung: "jpg" },
      "1024": { secret: "0a1b2c3d4e", breite: 1024, hoehe: 768, endung: "jpg" },
      "2048": {
        secret: "aa11bb22cc",
        breite: 2048,
        hoehe: 1536,
        endung: "jpg",
      },
      original: {
        secret: "99ff88ee77",
        breite: 6000,
        hoehe: 4500,
        endung: "png",
      },
    },
    ...mehr,
  });

  test("baut die Adresse nur aus geprüften Teilen am festen Bild-Host, mit dem Secret der Grösse", async () => {
    const { f, aufrufe } = attrappe(() => pixel());
    const q = erstelleFlickr({ apiKey: SCHLUESSEL, fetch: f });
    const a = await q.datei(bild(), "1024");
    expect(a.typ).toBe("image/jpeg");
    const u = aufrufe[0]!.url;
    expect(u.href).toBe(
      "https://live.staticflickr.com/4321/6000000001_0a1b2c3d4e_b.jpg",
    );
    expect(aufrufe[0]!.init?.redirect).toBe("error");
    await q.datei(bild(), "320");
    expect(aufrufe[1]!.url.pathname).toBe("/4321/6000000001_0a1b2c3d4e_n.jpg");
    await q.datei(bild(), "2048");
    expect(aufrufe[2]!.url.pathname).toBe("/4321/6000000001_aa11bb22cc_k.jpg");
    await q.datei(bild(), "original");
    expect(aufrufe[3]!.url.pathname).toBe("/4321/6000000001_99ff88ee77_o.png");
  });

  test("fehlt eine Stufe, gilt die nächstkleinere, zuletzt die Datei ohne Endung", async () => {
    const { f, aufrufe } = attrappe(() => pixel());
    const q = erstelleFlickr({ apiKey: SCHLUESSEL, fetch: f });
    const pfad = async (b: QuellBild, g: Parameters<typeof q.datei>[1]) => {
      await q.datei(b, g);
      return aufrufe.at(-1)!.url.pathname;
    };
    expect(await pfad(bild(), "4096")).toBe(
      "/4321/6000000001_aa11bb22cc_k.jpg",
    );
    expect(await pfad(bild(), "400")).toBe("/4321/6000000001_0a1b2c3d4e_n.jpg");
    // Ohne Original die grösste vorhandene
    const ohneOriginal = bild();
    delete ohneOriginal.groessen.original;
    expect(await pfad(ohneOriginal, "original")).toBe(
      "/4321/6000000001_aa11bb22cc_k.jpg",
    );
    // Nichts darunter: die 500er-Datei
    const nurGross = bild({ groessen: { "2048": bild().groessen["2048"]! } });
    expect(await pfad(nurGross, "640")).toBe("/4321/6000000001_0a1b2c3d4e.jpg");
    // Titelbild (ohne Angaben): das Secret des Bildes bis 1024
    expect(await pfad(bild({ groessen: {} }), "640")).toBe(
      "/4321/6000000001_0a1b2c3d4e_z.jpg",
    );
    expect(await pfad(bild({ groessen: {} }), "original")).toBe(
      "/4321/6000000001_0a1b2c3d4e_b.jpg",
    );
  });

  test("SSRF: Server, Kennung und Secret mit Sonderzeichen werden nie abgerufen", async () => {
    const { f, aufrufe } = attrappe(() => pixel());
    const q = erstelleFlickr({ apiKey: SCHLUESSEL, fetch: f });
    for (const b of [
      bild({ server: "evil.example.org/x" }),
      bild({ server: "../../x" }),
      bild({ server: "4321@evil.example.org" }),
      bild({ id: "1/../../2" }),
      bild({ secret: "a/../b" }),
      bild({ secret: "a b" }),
      bild({ secret: "x?y=z#", groessen: {} }),
    ]) {
      await expect(q.datei(b, "640")).rejects.toMatchObject({
        art: "nicht_gefunden",
      });
    }
    // Auch das Secret einer einzelnen Grösse
    const boese = bild();
    boese.groessen["2048"] = { ...boese.groessen["2048"]!, secret: "a/../b" };
    await expect(q.datei(boese, "2048")).rejects.toMatchObject({
      art: "nicht_gefunden",
    });
    expect(aufrufe).toHaveLength(0);
  });

  test("eine Stufe, die es nicht gibt, ist nie eine Pixelzahl", async () => {
    const q = erstelleFlickr({
      apiKey: SCHLUESSEL,
      fetch: attrappe(() => pixel()).f,
    });
    for (const g of ["1000", "gross", "../x"]) {
      await expect(
        q.datei(bild(), g as unknown as "1024"),
      ).rejects.toBeInstanceOf(QuellFehler);
    }
  });

  test("nur Bildtypen, nie Seiten, SVG oder Skripte", async () => {
    for (const typ of [
      "text/html",
      "image/svg+xml",
      "application/javascript",
    ]) {
      const q = erstelleFlickr({
        apiKey: SCHLUESSEL,
        fetch: attrappe(() => pixel(typ)).f,
      });
      await expect(q.datei(bild(), "640")).rejects.toMatchObject({
        art: "nicht_erreichbar",
      });
    }
  });

  test("zu grosse Dateien: schon die Länge im Kopf genügt; ohne Länge bricht der Strom ab", async () => {
    const q1 = erstelleFlickr({
      apiKey: SCHLUESSEL,
      fetch: attrappe(() => pixel("image/jpeg", MAX_BILD_BYTES + 1)).f,
    });
    await expect(q1.datei(bild(), "640")).rejects.toMatchObject({
      art: "nicht_erreichbar",
    });
    // Das Original darf grösser sein, aber nicht beliebig
    expect((await q1.datei(bild(), "original")).laenge).toBe(
      MAX_BILD_BYTES + 1,
    );
    const q2 = erstelleFlickr({
      apiKey: SCHLUESSEL,
      fetch: attrappe(() => pixel("image/png", MAX_ORIGINAL_BYTES + 1)).f,
    });
    await expect(q2.datei(bild(), "original")).rejects.toMatchObject({
      art: "nicht_erreichbar",
    });
    // Strom ohne ehrliche Länge: begrenze() bricht ab
    const strom = new ReadableStream<Uint8Array>({
      pull(ctl) {
        ctl.enqueue(new Uint8Array(1024));
      },
    });
    const leser = begrenze(strom, 4096).getReader();
    let fehler: unknown;
    try {
      for (let i = 0; i < 100; i++) await leser.read();
    } catch (f) {
      fehler = f;
    }
    expect(fehler).toBeInstanceOf(QuellFehler);
  });

  test("404 und 403 sind «nicht gefunden», ein Serverfehler «nicht erreichbar»", async () => {
    for (const [status, art] of [
      [404, "nicht_gefunden"],
      [403, "nicht_gefunden"],
      [502, "nicht_erreichbar"],
    ] as const) {
      const q = erstelleFlickr({
        apiKey: SCHLUESSEL,
        fetch: attrappe(() => new Response("x", { status })).f,
      });
      await expect(q.datei(bild(), "640")).rejects.toMatchObject({ art });
    }
  });

  test("die eigene Basis für Tests gilt nur dort: der Host der Basis ist der einzige erlaubte", async () => {
    const { f, aufrufe } = attrappe(() => pixel());
    const q = erstelleFlickr({
      apiKey: SCHLUESSEL,
      bildBasis: "http://127.0.0.1:4999",
      fetch: f,
    });
    await q.datei(bild(), "640");
    expect(aufrufe[0]!.url.host).toBe("127.0.0.1:4999");
  });
});

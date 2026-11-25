import { createVerify, generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, test } from "vitest";
import {
  DienstFehler,
  erstelleAndroidPruefer,
  erstelleGoogleDekodierer,
  leseDienstkonto,
  type IntegritaetsAntwort,
} from "../src/app-nachweis/android.js";

// Google Play Integrity (#785) mit selbst erzeugten Antworten: Die Prüfung der Felder und der Aufruf der Google-API laufen gegen eine Attrappe von fetch. Echte Antworten von Google sind hier NICHT getestet; Aufbau und Namen der Felder folgen der Dokumentation von decodeIntegrityToken.

const PAKET = "ch.example.cevios";
// SHA-256 des (erfundenen) App-Zertifikats: hex und als Digest von Google (base64url)
const ZERTIFIKAT = "ab".repeat(32);
const DIGEST = Buffer.from(ZERTIFIKAT, "hex").toString("base64url");
const NONCE = "bindung-der-anfrage";
const JETZT = Date.UTC(2026, 10, 25, 12, 0, 0);

const gueltig = (): IntegritaetsAntwort => ({
  requestDetails: {
    requestPackageName: PAKET,
    nonce: NONCE,
    timestampMillis: String(JETZT - 10_000),
  },
  appIntegrity: {
    appRecognitionVerdict: "PLAY_RECOGNIZED",
    packageName: PAKET,
    certificateSha256Digest: [DIGEST],
  },
  deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
});

const pruefer = (
  antwort: IntegritaetsAntwort | Error,
  optionen: Partial<Parameters<typeof erstelleAndroidPruefer>[0]> = {},
) =>
  erstelleAndroidPruefer({
    paketname: PAKET,
    zertifikate: [ZERTIFIKAT],
    dekodiere: async () => {
      if (antwort instanceof Error) throw antwort;
      return antwort;
    },
    jetzt: () => JETZT,
    ...optionen,
  });
const eingabe = { nonce: NONCE, integrityToken: "token" };

describe("Prüfung der Antwort", () => {
  test("gültig", async () => {
    expect(await pruefer(gueltig()).pruefe(eingabe)).toEqual({
      ok: true,
      plattform: "android",
      geraetOk: true,
    });
  });

  test.each([
    [
      "falsche Nonce (Token einer anderen Anfrage)",
      "nonce",
      (a: IntegritaetsAntwort) => (a.requestDetails!.nonce = "andere"),
    ],
    [
      "falsches Paket in der Anfrage",
      "paket",
      (a: IntegritaetsAntwort) =>
        (a.requestDetails!.requestPackageName = "ch.example.fremd"),
    ],
    [
      "falsches Paket in der App-Integrität",
      "paket",
      (a: IntegritaetsAntwort) =>
        (a.appIntegrity!.packageName = "ch.example.x"),
    ],
    [
      "abgelaufen (älter als 5 Minuten)",
      "zeit",
      (a: IntegritaetsAntwort) =>
        (a.requestDetails!.timestampMillis = String(JETZT - 5 * 60_000 - 1)),
    ],
    [
      "aus der Zukunft",
      "zeit",
      (a: IntegritaetsAntwort) =>
        (a.requestDetails!.timestampMillis = String(JETZT + 120_000)),
    ],
    [
      "kein Zeitstempel",
      "zeit",
      (a: IntegritaetsAntwort) =>
        (a.requestDetails!.timestampMillis = undefined),
    ],
    [
      "App nicht von Play erkannt",
      "app-erkannt",
      (a: IntegritaetsAntwort) =>
        (a.appIntegrity!.appRecognitionVerdict = "UNRECOGNIZED_VERSION"),
    ],
    [
      "fremdes Zertifikat",
      "zertifikat",
      (a: IntegritaetsAntwort) =>
        (a.appIntegrity!.certificateSha256Digest = [
          Buffer.from("cd".repeat(32), "hex").toString("base64url"),
        ]),
    ],
    [
      "eines von zwei Zertifikaten fremd",
      "zertifikat",
      (a: IntegritaetsAntwort) =>
        (a.appIntegrity!.certificateSha256Digest = [
          DIGEST,
          Buffer.from("cd".repeat(32), "hex").toString("base64url"),
        ]),
    ],
    [
      "kein Zertifikat",
      "zertifikat",
      (a: IntegritaetsAntwort) =>
        (a.appIntegrity!.certificateSha256Digest = []),
    ],
    [
      "kein Gerätesiegel",
      "geraet",
      (a: IntegritaetsAntwort) =>
        (a.deviceIntegrity!.deviceRecognitionVerdict = []),
    ],
    [
      "nur das einfache Siegel, gefordert ist das Gerätesiegel",
      "geraet",
      (a: IntegritaetsAntwort) =>
        (a.deviceIntegrity!.deviceRecognitionVerdict = [
          "MEETS_BASIC_INTEGRITY",
        ]),
    ],
    [
      "Geräteintegrität fehlt ganz",
      "geraet",
      (a: IntegritaetsAntwort) => (a.deviceIntegrity = undefined),
    ],
  ])("%s", async (_name, grund, aendere) => {
    const antwort = gueltig();
    aendere(antwort);
    expect(await pruefer(antwort).pruefe(eingabe)).toEqual({
      ok: false,
      grund,
    });
  });

  test("Antwort ohne requestDetails", async () => {
    expect(await pruefer({}).pruefe(eingabe)).toMatchObject({ ok: false });
  });

  test("das strenge Siegel nur, wenn gefordert", async () => {
    const strong = gueltig();
    strong.deviceIntegrity!.deviceRecognitionVerdict = [
      "MEETS_DEVICE_INTEGRITY",
    ];
    const streng = pruefer(strong, {
      mindestGeraete: "MEETS_STRONG_INTEGRITY",
    });
    expect(await streng.pruefe(eingabe)).toMatchObject({
      ok: false,
      grund: "geraet",
    });
    strong.deviceIntegrity!.deviceRecognitionVerdict.push(
      "MEETS_STRONG_INTEGRITY",
    );
    expect((await streng.pruefe(eingabe)).ok).toBe(true);
  });

  test("das einfache Siegel genügt, wenn der Betreiber es erlaubt", async () => {
    const a = gueltig();
    a.deviceIntegrity!.deviceRecognitionVerdict = ["MEETS_BASIC_INTEGRITY"];
    expect(
      (
        await pruefer(a, { mindestGeraete: "MEETS_BASIC_INTEGRITY" }).pruefe(
          eingabe,
        )
      ).ok,
    ).toBe(true);
  });

  test("manipuliertes Token: Google lehnt es ab", async () => {
    expect(await pruefer(new Error("abgelehnt")).pruefe(eingabe)).toEqual({
      ok: false,
      grund: "token",
    });
  });

  test("Google nicht erreichbar: vorübergehend, nicht ungültig", async () => {
    expect(await pruefer(new DienstFehler("x")).pruefe(eingabe)).toEqual({
      ok: false,
      grund: "dienst",
      voruebergehend: true,
    });
  });
});

describe("Aufruf der Google-API", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const konto = leseDienstkonto(
    JSON.stringify({
      client_email: "nachweis@projekt.iam.gserviceaccount.example",
      private_key: privateKey.export({ format: "pem", type: "pkcs8" }),
      extra: "wird ignoriert",
    }),
  );
  type Aufruf = { url: string; init: RequestInit };
  let aufrufe: Aufruf[];
  let antworten: (url: string) => Response | Error;
  const fetchAttrappe = (async (url: string, init: RequestInit) => {
    aufrufe.push({ url: String(url), init });
    const a = antworten(String(url));
    if (a instanceof Error) throw a;
    return a;
  }) as unknown as typeof fetch;
  const dekodierer = (jetzt = () => JETZT) =>
    erstelleGoogleDekodierer({
      dienstkonto: konto,
      paketname: PAKET,
      fetchFn: fetchAttrappe,
      jetzt,
    });
  const oauth = () =>
    new Response(
      JSON.stringify({ access_token: "zugang-1", expires_in: 3600 }),
    );
  const decode = (nutzlast: object = gueltig()) =>
    new Response(JSON.stringify({ tokenPayloadExternal: nutzlast }));

  beforeEach(() => {
    aufrufe = [];
    antworten = (url) =>
      url.startsWith("https://oauth2.googleapis.com/") ? oauth() : decode();
  });

  test("holt ein OAuth-Token mit signiertem JWT und dekodiert das Token", async () => {
    expect(await dekodierer()("integrity-token")).toEqual(gueltig());
    expect(aufrufe).toHaveLength(2);
    const [anmeldung, dekodierung] = aufrufe;
    expect(anmeldung!.url).toBe("https://oauth2.googleapis.com/token");
    const assertion = new URLSearchParams(String(anmeldung!.init.body)).get(
      "assertion",
    )!;
    const [kopf, inhalt, signatur] = assertion.split(".");
    expect(JSON.parse(Buffer.from(kopf!, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(
      JSON.parse(Buffer.from(inhalt!, "base64url").toString()),
    ).toMatchObject({
      iss: "nachweis@projekt.iam.gserviceaccount.example",
      scope: "https://www.googleapis.com/auth/playintegrity",
      aud: "https://oauth2.googleapis.com/token",
    });
    expect(
      createVerify("RSA-SHA256")
        .update(`${kopf}.${inhalt}`)
        .verify(publicKey, Buffer.from(signatur!, "base64url")),
    ).toBe(true);
    expect(dekodierung!.url).toBe(
      `https://playintegrity.googleapis.com/v1/${PAKET}:decodeIntegrityToken`,
    );
    expect(dekodierung!.init.headers).toMatchObject({
      authorization: "Bearer zugang-1",
    });
    expect(JSON.parse(String(dekodierung!.init.body))).toEqual({
      integrity_token: "integrity-token",
    });
  });

  test("kein Redirect, Zeitlimit; das OAuth-Token wird wiederverwendet und rechtzeitig erneuert", async () => {
    let uhr = JETZT;
    const d = dekodierer(() => uhr);
    await d("a");
    await d("b");
    expect(aufrufe.filter((a) => a.url.includes("oauth2"))).toHaveLength(1);
    for (const a of aufrufe) {
      expect(a.init.redirect).toBe("error");
      expect(a.init.signal).toBeInstanceOf(AbortSignal);
    }
    uhr += 3600_000;
    await d("c");
    expect(aufrufe.filter((a) => a.url.includes("oauth2"))).toHaveLength(2);
  });

  test("400 von Google: das Token ist ungültig", async () => {
    antworten = (url) =>
      url.includes("oauth2") ? oauth() : new Response("{}", { status: 400 });
    await expect(dekodierer()("x")).rejects.not.toBeInstanceOf(DienstFehler);
  });

  test.each([401, 403, 429, 500, 503])(
    "Status %s von Google: Fehler des Dienstes",
    async (status) => {
      antworten = (url) =>
        url.includes("oauth2") ? oauth() : new Response("{}", { status });
      await expect(dekodierer()("x")).rejects.toBeInstanceOf(DienstFehler);
    },
  );

  test("OAuth schlägt fehl, Verbindung bricht ab, Redirect wirft: Fehler des Dienstes", async () => {
    antworten = () => new Response("{}", { status: 401 });
    await expect(dekodierer()("x")).rejects.toBeInstanceOf(DienstFehler);
    antworten = () => new TypeError("fetch failed");
    await expect(dekodierer()("x")).rejects.toBeInstanceOf(DienstFehler);
  });

  test("zu lange Antwort wird abgebrochen", async () => {
    antworten = (url) =>
      url.includes("oauth2") ? oauth() : new Response("x".repeat(65 * 1024));
    await expect(dekodierer()("x")).rejects.toBeInstanceOf(DienstFehler);
  });

  test("zu langes Token erreicht Google nie", async () => {
    await expect(dekodierer()("x".repeat(17 * 1024))).rejects.toThrow();
    expect(aufrufe).toHaveLength(0);
  });

  test("Antwort ohne Inhalt ist ungültig", async () => {
    antworten = (url) =>
      url.includes("oauth2") ? oauth() : new Response("{}");
    await expect(dekodierer()("x")).rejects.toThrow();
  });

  test("Zusammenspiel: Prüfer mit dem Dekodierer", async () => {
    const p = erstelleAndroidPruefer({
      paketname: PAKET,
      zertifikate: [ZERTIFIKAT],
      dekodiere: dekodierer(),
      jetzt: () => JETZT,
    });
    expect((await p.pruefe(eingabe)).ok).toBe(true);
  });

  test("die Schlüsseldatei braucht Mail und privaten Schlüssel", () => {
    expect(() => leseDienstkonto("{}")).toThrow();
    expect(() =>
      leseDienstkonto(
        JSON.stringify({ client_email: "a@b", private_key: "kein Schlüssel" }),
      ),
    ).toThrow();
    // Die Fehlermeldung nennt den Inhalt nie
    try {
      leseDienstkonto(
        JSON.stringify({ client_email: "geheim@x", private_key: 1 }),
      );
    } catch (e) {
      expect(String(e)).not.toContain("geheim");
    }
  });
});

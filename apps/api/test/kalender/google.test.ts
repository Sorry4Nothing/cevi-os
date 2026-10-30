import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import {
  ANTWORT_UNGUELTIG,
  NICHT_ERREICHBAR,
  SCHLUESSEL_UNGUELTIG,
} from "../../src/kalender/fehler.js";
import {
  holeSeiten,
  holeToken,
  SCOPE,
  TOKEN_URL,
} from "../../src/kalender/google.js";

// Fester Zeitpunkt, damit Fenster und Claims aufs Millisekunde stimmen
const JETZT = new Date("2026-10-26T08:00:00Z");
const KALENDER_ID = "testkalender@example.org";

let schluesselDatei: string;
let publicKey: string;

beforeAll(async () => {
  const paar = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  publicKey = paar.publicKey;
  const ordner = await mkdtemp(join(tmpdir(), "kalender-"));
  schluesselDatei = join(ordner, "schluessel.json");
  await writeFile(
    schluesselDatei,
    JSON.stringify({
      type: "service_account",
      client_email: "sync@example.org",
      private_key: paar.privateKey,
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubAntworten(...antworten: (Response | Error)[]) {
  const stub = vi.fn(async () => {
    const antwort = antworten.shift();
    if (!antwort) throw new Error("mehr Anfragen als Antworten im Test");
    if (antwort instanceof Error) throw antwort;
    return antwort;
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

describe("holeToken", () => {
  test("der Server verlangt das Zugangstoken mit einem JWT: nur Scope calendar.events.readonly, Claims und Unterschrift stimmen", async () => {
    const stub = stubAntworten(Response.json({ access_token: "token-1" }));
    expect(await holeToken(schluesselDatei, JETZT)).toBe("token-1");

    expect(stub).toHaveBeenCalledTimes(1);
    const [url, init] = stub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TOKEN_URL);
    expect(init.method).toBe("POST");
    const body = init.body as URLSearchParams;
    expect(body.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );

    const jwt = body.get("assertion") as string;
    const [kopf, claims, unterschrift] = jwt.split(".");
    const dekodiert = (teil: string) =>
      JSON.parse(Buffer.from(teil, "base64url").toString("utf8"));
    expect(dekodiert(kopf)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(dekodiert(claims)).toEqual({
      iss: "sync@example.org",
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: Math.floor(JETZT.getTime() / 1000),
      exp: Math.floor(JETZT.getTime() / 1000) + 3600,
    });
    expect(SCOPE).toBe(
      "https://www.googleapis.com/auth/calendar.events.readonly",
    );
    expect(
      verify(
        "sha256",
        Buffer.from(`${kopf}.${claims}`),
        publicKey,
        Buffer.from(unterschrift, "base64url"),
      ),
    ).toBe(true);
  });

  test.each<[string, () => Promise<string | undefined>]>([
    ["ohne konfigurierte Datei", async () => undefined],
    ["mit fehlender Datei", async () => join(tmpdir(), "gibt-es-nicht.json")],
    [
      "mit Datei ohne private_key",
      async () => {
        const pfad = join(await mkdtemp(join(tmpdir(), "kalender-")), "s.json");
        await writeFile(
          pfad,
          JSON.stringify({ client_email: "a@example.org" }),
        );
        return pfad;
      },
    ],
    [
      "mit kaputtem PEM",
      async () => {
        const pfad = join(await mkdtemp(join(tmpdir(), "kalender-")), "s.json");
        await writeFile(
          pfad,
          JSON.stringify({
            client_email: "a@example.org",
            private_key: "kein PEM",
          }),
        );
        return pfad;
      },
    ],
  ])(
    "%s: «Schlüssel für Google fehlt oder ist ungültig», ohne Pfad in der Meldung",
    async (_, datei) => {
      const stub = stubAntworten();
      const pfad = await datei();
      await expect(holeToken(pfad, JETZT)).rejects.toMatchObject({
        message: SCHLUESSEL_UNGUELTIG,
      });
      expect(stub).not.toHaveBeenCalled();
    },
  );

  test("eine abgelehnte Token-Anfrage nennt nur den Status", async () => {
    stubAntworten(new Response("Fehlertext", { status: 403 }));
    await expect(holeToken(schluesselDatei, JETZT)).rejects.toMatchObject({
      message: "Google antwortet mit HTTP 403",
    });
  });

  test.each<[string, Response | Error]>([
    ["kein JSON", new Response("<html>kaputt</html>")],
    ["ohne access_token", Response.json({ token_type: "Bearer" })],
  ])(
    "eine unlesbare Token-Antwort (%s): «Antwort von Google ungültig»",
    async (_, antwort) => {
      stubAntworten(antwort);
      await expect(holeToken(schluesselDatei, JETZT)).rejects.toMatchObject({
        message: ANTWORT_UNGUELTIG,
      });
    },
  );

  test("ein Netzfehler wird zu «Google nicht erreichbar»", async () => {
    stubAntworten(
      Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" }),
    );
    await expect(holeToken(schluesselDatei, JETZT)).rejects.toMatchObject({
      message: NICHT_ERREICHBAR,
      cause: { code: "ECONNREFUSED" },
    });
  });
});

describe("holeSeiten", () => {
  test("fragt genau das Fenster, die Maske und die Kalender-ID an und folgt nextPageToken", async () => {
    const stub = stubAntworten(
      Response.json({ items: [{ id: "a1" }], nextPageToken: "seite-2" }),
      Response.json({ items: [{ id: "a2" }] }),
    );
    const seiten = await holeSeiten("token-1", KALENDER_ID, JETZT);
    expect(seiten).toEqual([
      { items: [{ id: "a1" }], nextPageToken: "seite-2" },
      { items: [{ id: "a2" }] },
    ]);

    expect(stub).toHaveBeenCalledTimes(2);
    const [ersteUrl, init] = stub.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const url = new URL(ersteUrl);
    expect(url.origin).toBe("https://www.googleapis.com");
    // encodeURIComponent: Das @ der Kalender-ID steht als %40 im Pfad
    expect(url.pathname).toBe(
      "/calendar/v3/calendars/testkalender%40example.org/events",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      singleEvents: "true",
      showDeleted: "true",
      timeMin: "2026-10-25T08:00:00.000Z",
      timeMax: "2027-11-30T08:00:00.000Z",
      maxResults: "2500",
      fields:
        "items(id,status,summary,description,location,start,end,recurringEventId,visibility),nextPageToken",
    });
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-1",
    );
    const [zweiteUrl] = stub.mock.calls[1] as unknown as [string];
    expect(new URL(zweiteUrl).searchParams.get("pageToken")).toBe("seite-2");
  });

  test.each<[string, Response | Error, string]>([
    [
      "HTTP 500",
      new Response("kaputt", { status: 500 }),
      "Google antwortet mit HTTP 500",
    ],
    ["kein JSON", new Response("<html></html>"), ANTWORT_UNGUELTIG],
    ["Netzfehler", new Error("fetch failed"), NICHT_ERREICHBAR],
  ])(
    "%s: fester Text ohne Kalender-ID und Token",
    async (_, antwort, meldung) => {
      stubAntworten(antwort);
      await expect(
        holeSeiten("token-1", KALENDER_ID, JETZT),
      ).rejects.toMatchObject({ message: meldung });
    },
  );
});

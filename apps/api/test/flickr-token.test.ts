import { describe, expect, test } from "vitest";
import { signiere as signiereServer } from "../src/fotos/flickr.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { laufe, signiere } from "../scripts/flickr-token.mjs";

// Das Skript, das das Lese-Token holt (#690), gegen eine Attrappe von Flickr mit erfundenen Werten
const KEY = "abcdef0123456789abcdef0123456789";
const SECRET = "ffeeddccbbaa9988";

function attrappe() {
  const aufrufe: URL[] = [];
  const abruf = (async (url: URL) => {
    aufrufe.push(new URL(String(url)));
    const pfad = new URL(String(url)).pathname;
    if (pfad.endsWith("/request_token")) {
      return new Response(
        "oauth_callback_confirmed=true&oauth_token=72157600000000001-aaaaaaaaaaaaaaaa&oauth_token_secret=1111111111111111",
      );
    }
    return new Response(
      "fullname=Erfunden&oauth_token=72157600000000002-bbbbbbbbbbbbbbbb&oauth_token_secret=2222222222222222&user_nsid=12345678%40N00&username=erfunden",
    );
  }) as unknown as typeof fetch;
  return { abruf, aufrufe };
}

describe("flickr-token.mjs", () => {
  test("die Signatur ist dieselbe wie im Server", () => {
    const p = { a: "1 2", b: "!*'()", oauth_nonce: "x" };
    expect(signiere("GET", "https://example.org/x", p, SECRET, "t")).toBe(
      signiereServer("GET", "https://example.org/x", p, SECRET, "t"),
    );
  });

  test("der Ablauf: Anfrage-Token, Freigabe nur lesend, Code, Zugangs-Token; ausgegeben, nie gespeichert", async () => {
    const { abruf, aufrufe } = attrappe();
    const zeilen: string[] = [];
    const r = await laufe({
      env: { FLICKR_API_KEY: KEY, FLICKR_API_SECRET: SECRET },
      abruf,
      frage: async () => "123-456-789",
      ausgabe: (z: string) => zeilen.push(z),
      jetzt: () => 1_780_000_000_000,
      nonce: () => "nonce",
    });
    expect(r.nsid).toBe("12345678@N00");
    // Anfrage-Token: mit oob und signiert mit dem Secret der App allein
    expect(aufrufe[0]!.searchParams.get("oauth_callback")).toBe("oob");
    expect(aufrufe[0]!.searchParams.get("oauth_consumer_key")).toBe(KEY);
    expect(aufrufe[0]!.searchParams.get("oauth_signature")).toBeTruthy();
    // Zugangs-Token: mit dem Code ohne Bindestriche und dem Anfrage-Token
    expect(aufrufe[1]!.searchParams.get("oauth_verifier")).toBe("123456789");
    expect(aufrufe[1]!.searchParams.get("oauth_token")).toBe(
      "72157600000000001-aaaaaaaaaaaaaaaa",
    );
    const text = zeilen.join("\n");
    // Die Freigabe darf nur lesen
    expect(text).toContain("perms=read");
    expect(text).toContain(
      "FLICKR_OAUTH_TOKEN=72157600000000002-bbbbbbbbbbbbbbbb",
    );
    expect(text).toContain("FLICKR_OAUTH_TOKEN_SECRET=2222222222222222");
    expect(text).toContain("12345678@N00");
    // Das Secret der App steht nicht in der Ausgabe und nie in einer Adresse
    expect(text).not.toContain(SECRET);
    for (const u of aufrufe) expect(u.href).not.toContain(SECRET);
  });

  test("ohne Schlüssel oder mit falschem Code bricht es ab, ohne Werte zu nennen", async () => {
    await expect(
      laufe({ env: {}, frage: async () => "1", ausgabe: () => {} }),
    ).rejects.toThrow(/FLICKR_API_KEY/);
    const { abruf } = attrappe();
    await expect(
      laufe({
        env: { FLICKR_API_KEY: KEY, FLICKR_API_SECRET: SECRET },
        abruf,
        frage: async () => "abc",
        ausgabe: () => {},
      }),
    ).rejects.toThrow(/Ziffern/);
    const kaputt = (async () =>
      new Response("oauth_problem=signature_invalid&secret=" + SECRET, {
        status: 401,
      })) as unknown as typeof fetch;
    const fehler = await laufe({
      env: { FLICKR_API_KEY: KEY, FLICKR_API_SECRET: SECRET },
      abruf: kaputt,
      frage: async () => "123456789",
      ausgabe: () => {},
    }).catch((f: Error) => f);
    expect(fehler).toBeInstanceOf(Error);
    expect((fehler as Error).message).not.toContain(SECRET);
  });
});

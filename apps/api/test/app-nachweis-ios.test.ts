import { createHash, X509Certificate } from "node:crypto";
import { beforeEach, describe, expect, test } from "vitest";
import {
  APPLE_APP_ATTEST_WURZEL,
  APPLE_APP_ATTEST_WURZEL_FINGERABDRUCK,
} from "../src/app-nachweis/apple-wurzel.js";
import { dekodiereCbor } from "../src/app-nachweis/cbor.js";
import {
  erstelleIosPruefer,
  type Geraeteablage,
} from "../src/app-nachweis/ios.js";
import {
  authDaten,
  BUNDLE,
  neuePki,
  TEAM,
  TestGeraet,
  type Pki,
} from "./hilfen/app-attest.js";
import { baueZertifikat } from "./hilfen/x509-bauen.js";

// Die Prüfung von Apple App Attest (#785) gegen selbst erzeugte Fixtures: eine eigene Wurzel, Zwischenstelle und Gerät. Echte Antworten von Apple sind hier NICHT getestet; der Aufbau folgt Apples Anleitung «Validating apps that connect to your server».

const hash = (text: string) => createHash("sha256").update(text).digest();
const hashB64 = (text: string) => hash(text).toString("base64url");

function speicher(): Geraeteablage & {
  zeilen: Map<string, { oeffentlicherSchluessel: string; zaehler: number }>;
} {
  const zeilen = new Map<
    string,
    { oeffentlicherSchluessel: string; zaehler: number }
  >();
  return {
    zeilen,
    holen: async (id) => zeilen.get(id),
    anlegen: async ({ schluesselId, oeffentlicherSchluessel }) => {
      if (zeilen.has(schluesselId)) return false;
      zeilen.set(schluesselId, { oeffentlicherSchluessel, zaehler: 0 });
      return true;
    },
    zaehlerErhoehen: async (id, neu) => {
      const z = zeilen.get(id);
      if (!z || z.zaehler >= neu) return false;
      z.zaehler = neu;
      return true;
    },
  };
}

let pki: Pki;
let ablage: ReturnType<typeof speicher>;
let geraet: TestGeraet;
const pruefer = (
  optionen: {
    umgebung?: "production" | "development";
    jetzt?: () => Date;
  } = {},
) =>
  erstelleIosPruefer({
    teamId: TEAM,
    bundleId: BUNDLE,
    umgebung: optionen.umgebung ?? "development",
    wurzel: pki.wurzel.pem,
    geraete: ablage,
    jetzt: optionen.jetzt,
  });

beforeEach(() => {
  pki = neuePki();
  ablage = speicher();
  geraet = new TestGeraet(pki);
});

// Die Bindung der Anfrage: 32 Byte, die die App als clientDataHash gibt
const bindungsHash = hash("bindung");
const nonce = bindungsHash.toString("base64url");

describe("Attestation", () => {
  test("gültig: legt Schlüssel und Zähler 0 ab", async () => {
    const e = await pruefer().pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      attestation: geraet.attestiere(bindungsHash),
    });
    expect(e).toEqual({
      ok: true,
      plattform: "ios",
      geraetOk: true,
      schluesselId: geraet.schluesselId,
    });
    expect(ablage.zeilen.get(geraet.schluesselId)?.zaehler).toBe(0);
  });

  test("production: aaguid «appattest» mit Nullbyte", async () => {
    const aaguid = Buffer.concat([Buffer.from("appattest"), Buffer.alloc(7)]);
    const e = await pruefer({ umgebung: "production" }).pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      attestation: geraet.attestiere(bindungsHash, { auth: { aaguid } }),
    });
    expect(e.ok).toBe(true);
  });

  test("falsche Umgebung: development-Schlüssel in production", async () => {
    const e = await pruefer({ umgebung: "production" }).pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      attestation: geraet.attestiere(bindungsHash),
    });
    expect(e).toMatchObject({ ok: false, grund: "umgebung" });
  });

  test("Kette von einer fremden Wurzel", async () => {
    const e = await pruefer().pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      attestation: geraet.attestiere(bindungsHash, { pki: neuePki() }),
    });
    expect(e).toMatchObject({ ok: false, grund: "kette-signatur" });
  });

  test("Zwischenstelle ohne Signatur der Wurzel", async () => {
    const fremd = baueZertifikat({ cn: "Fremd", ca: true });
    const zwischen = baueZertifikat({
      cn: pki.zwischen.name,
      ca: true,
      ausgestelltVon: fremd,
    });
    const e = await pruefer().pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      attestation: geraet.attestiere(bindungsHash, {
        pki: { wurzel: pki.wurzel, zwischen },
      }),
    });
    expect(e).toMatchObject({ ok: false });
  });

  test("abgelaufenes Zertifikat", async () => {
    const e = await pruefer({
      jetzt: () => new Date(Date.now() + 2 * 3600_000),
    }).pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      attestation: geraet.attestiere(bindungsHash),
    });
    expect(e).toMatchObject({ ok: false, grund: "kette-zeit" });
  });

  test("Nonce gehört zu anderen Daten", async () => {
    const e = await pruefer().pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      attestation: geraet.attestiere(bindungsHash, {
        nonceVon: hash("andere"),
      }),
    });
    expect(e).toMatchObject({ ok: false, grund: "nonce" });
  });

  test("Bindung der Anfrage stimmt nicht (anderer Benutzername oder andere Herausforderung)", async () => {
    const e = await pruefer().pruefe({
      nonce: hashB64("anderer-benutzer"),
      schluesselId: geraet.schluesselId,
      attestation: geraet.attestiere(bindungsHash),
    });
    expect(e).toMatchObject({ ok: false, grund: "nonce" });
  });

  test("rpId einer anderen App", async () => {
    const e = await pruefer().pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      attestation: geraet.attestiere(bindungsHash, {
        auth: { rp: `${TEAM}.ch.example.andere` },
      }),
    });
    expect(e).toMatchObject({ ok: false, grund: "rp-id" });
  });

  test("Zähler nicht 0", async () => {
    const e = await pruefer().pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      attestation: geraet.attestiere(bindungsHash, { auth: { zaehler: 1 } }),
    });
    expect(e).toMatchObject({ ok: false, grund: "zaehler" });
  });

  test("Schlüsselkennung gehört zu einem anderen Schlüssel", async () => {
    const anderes = new TestGeraet(pki);
    const e = await pruefer().pruefe({
      nonce,
      schluesselId: anderes.schluesselId,
      attestation: geraet.attestiere(bindungsHash),
    });
    expect(e).toMatchObject({ ok: false, grund: "schluessel-id" });
  });

  test("derselbe Schlüssel wird nicht zweimal bestätigt", async () => {
    const p = pruefer();
    const eingabe = {
      nonce,
      schluesselId: geraet.schluesselId,
      attestation: geraet.attestiere(bindungsHash),
    };
    expect((await p.pruefe(eingabe)).ok).toBe(true);
    expect(await p.pruefe(eingabe)).toMatchObject({
      ok: false,
      grund: "schluessel-bekannt",
    });
  });

  test("kaputte Daten werfen nicht, sie lehnen ab", async () => {
    for (const attestation of [
      "AAAA",
      Buffer.from("kein cbor").toString("base64"),
      "",
    ]) {
      const e = await pruefer().pruefe({
        nonce,
        schluesselId: geraet.schluesselId,
        attestation,
      });
      expect(e.ok).toBe(false);
    }
    // Falsche Länge von Bindung oder Kennung
    expect(
      await pruefer().pruefe({
        nonce: "kurz",
        schluesselId: geraet.schluesselId,
        attestation: geraet.attestiere(bindungsHash),
      }),
    ).toMatchObject({ ok: false, grund: "eingabe" });
    // Beides oder nichts von attestation und assertion
    expect(
      await pruefer().pruefe({ nonce, schluesselId: geraet.schluesselId }),
    ).toMatchObject({ ok: false, grund: "eingabe" });
  });

  test("Kette mit nur einem Zertifikat", async () => {
    const e = await pruefer().pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      attestation: geraet.attestiere(bindungsHash, {
        kette: [pki.zwischen.der],
      }),
    });
    expect(e).toMatchObject({ ok: false, grund: "kette-aufbau" });
  });
});

describe("Assertion", () => {
  async function bestaetige() {
    const e = await pruefer().pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      attestation: geraet.attestiere(bindungsHash),
    });
    expect(e.ok).toBe(true);
  }

  test("gültig, der Zähler steigt", async () => {
    await bestaetige();
    const p = pruefer();
    for (const zaehler of [1, 2, 5]) {
      const e = await p.pruefe({
        nonce,
        schluesselId: geraet.schluesselId,
        assertion: geraet.assertiere(bindungsHash, { zaehler }),
      });
      expect(e).toMatchObject({ ok: true, schluesselId: geraet.schluesselId });
    }
    expect(ablage.zeilen.get(geraet.schluesselId)?.zaehler).toBe(5);
  });

  test("unbekannter Schlüssel", async () => {
    const e = await pruefer().pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      assertion: geraet.assertiere(bindungsHash),
    });
    expect(e).toMatchObject({ ok: false, grund: "schluessel-unbekannt" });
  });

  test("Wiederholung desselben Zählers und kleinerer Zähler", async () => {
    await bestaetige();
    const p = pruefer();
    const erste = geraet.assertiere(bindungsHash, { zaehler: 3 });
    const eingabe = (assertion: string) => ({
      nonce,
      schluesselId: geraet.schluesselId,
      assertion,
    });
    expect((await p.pruefe(eingabe(erste))).ok).toBe(true);
    expect(await p.pruefe(eingabe(erste))).toMatchObject({
      ok: false,
      grund: "zaehler",
    });
    expect(
      await p.pruefe(eingabe(geraet.assertiere(bindungsHash, { zaehler: 2 }))),
    ).toMatchObject({ ok: false, grund: "zaehler" });
  });

  test("Zähler 0 ist nie gültig", async () => {
    await bestaetige();
    const e = await pruefer().pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      assertion: geraet.assertiere(bindungsHash, { zaehler: 0 }),
    });
    expect(e).toMatchObject({ ok: false, grund: "zaehler" });
  });

  test("Signatur über andere Daten (andere Bindung)", async () => {
    await bestaetige();
    const e = await pruefer().pruefe({
      nonce: hashB64("andere-bindung"),
      schluesselId: geraet.schluesselId,
      assertion: geraet.assertiere(bindungsHash, { zaehler: 1 }),
    });
    expect(e).toMatchObject({ ok: false, grund: "signatur" });
  });

  test("Signatur eines anderen Geräts", async () => {
    await bestaetige();
    const fremd = new TestGeraet(pki);
    const e = await pruefer().pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      assertion: fremd.assertiere(bindungsHash, { zaehler: 1 }),
    });
    expect(e).toMatchObject({ ok: false, grund: "signatur" });
  });

  test("rpId einer anderen App", async () => {
    await bestaetige();
    const e = await pruefer().pruefe({
      nonce,
      schluesselId: geraet.schluesselId,
      assertion: geraet.assertiere(bindungsHash, {
        zaehler: 1,
        auth: { rp: `${TEAM}.ch.example.andere` },
      }),
    });
    expect(e).toMatchObject({ ok: false, grund: "rp-id" });
  });
});

describe("CBOR", () => {
  test("lehnt unbestimmte Längen, Nicht-Text-Schlüssel und Reste ab", () => {
    // Unbestimmt lange Liste
    expect(() => dekodiereCbor(Uint8Array.from([0x9f, 0xff]))).toThrow();
    // Map mit Zahl als Schlüssel
    expect(() => dekodiereCbor(Uint8Array.from([0xa1, 0x01, 0x01]))).toThrow();
    // Rest nach dem Wert
    expect(() => dekodiereCbor(Uint8Array.from([0x01, 0x01]))).toThrow();
    // Länge grösser als die Daten
    expect(() =>
      dekodiereCbor(Uint8Array.from([0x59, 0xff, 0xff, 0x01])),
    ).toThrow();
    // Doppelter Schlüssel
    expect(() =>
      dekodiereCbor(
        Uint8Array.from([0xa2, 0x61, 0x61, 0x01, 0x61, 0x61, 0x02]),
      ),
    ).toThrow();
  });

  test("liest Zahlen, Text, Bytes, Listen und Maps", () => {
    expect(
      dekodiereCbor(
        Uint8Array.from([
          0xa2, 0x61, 0x61, 0x82, 0x01, 0x18, 0x40, 0x61, 0x62, 0x42, 0xab,
          0xcd,
        ]),
      ),
    ).toEqual({ a: [1, 64], b: Uint8Array.from([0xab, 0xcd]) });
  });

  test("authDaten der Tests haben den Aufbau von Apple (37 Byte Kopf)", () => {
    expect(authDaten(undefined).length).toBe(37);
  });
});

describe("Wurzel von Apple", () => {
  test("das eingebaute Zertifikat hat den dokumentierten Fingerabdruck", () => {
    expect(new X509Certificate(APPLE_APP_ATTEST_WURZEL).fingerprint256).toBe(
      APPLE_APP_ATTEST_WURZEL_FINGERABDRUCK,
    );
  });
});

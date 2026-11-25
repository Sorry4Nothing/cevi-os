import { createHash, createSign, randomBytes } from "node:crypto";
import {
  baueZertifikat,
  neuerSchluessel,
  type Schluessel,
  type Zertifikat,
} from "./x509-bauen.js";

// Erzeugt Attestationen und Assertions im Aufbau von Apple App Attest für die Tests (#785): eine eigene Wurzel, eine Zwischenstelle und ein Gerät mit eigenem Schlüssel. Echte Antworten von Apple gibt es erst mit der fertigen App; dieses Gerüst bildet nur nach, was Apples Anleitung beschreibt.

// Ein kleiner CBOR-Schreiber, nur für diese Objekte
function cbor(wert: unknown): Buffer {
  const kopf = (art: number, n: number) =>
    n < 24
      ? Buffer.from([(art << 5) | n])
      : n < 256
        ? Buffer.from([(art << 5) | 24, n])
        : Buffer.from([(art << 5) | 25, n >> 8, n & 255]);
  if (typeof wert === "string") {
    const b = Buffer.from(wert);
    return Buffer.concat([kopf(3, b.length), b]);
  }
  if (Buffer.isBuffer(wert)) return Buffer.concat([kopf(2, wert.length), wert]);
  if (typeof wert === "number") return kopf(0, wert);
  if (Array.isArray(wert)) {
    return Buffer.concat([kopf(4, wert.length), ...wert.map(cbor)]);
  }
  const eintraege = Object.entries(wert as Record<string, unknown>);
  return Buffer.concat([
    kopf(5, eintraege.length),
    ...eintraege.flatMap(([k, v]) => [cbor(k), cbor(v)]),
  ]);
}

const sha256 = (...teile: Buffer[]) => {
  const h = createHash("sha256");
  for (const t of teile) h.update(t);
  return h.digest();
};

export const TEAM = "ABCDE12345";
export const BUNDLE = "ch.example.cevios";

export type Pki = { wurzel: Zertifikat; zwischen: Zertifikat };
export function neuePki(): Pki {
  const wurzel = baueZertifikat({ cn: "Test App Attestation Root", ca: true });
  const zwischen = baueZertifikat({
    cn: "Test App Attestation CA",
    ca: true,
    ausgestelltVon: wurzel,
  });
  return { wurzel, zwischen };
}

const punktVon = (schluessel: Schluessel) => {
  const jwk = schluessel.oeffentlich.export({ format: "jwk" });
  return Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x!, "base64url"),
    Buffer.from(jwk.y!, "base64url"),
  ]);
};

export type AuthDatenOptionen = {
  rp?: string;
  zaehler?: number;
  aaguid?: Buffer;
};

export function authDaten(
  schluesselId: Buffer | undefined,
  { rp = `${TEAM}.${BUNDLE}`, zaehler = 0, aaguid }: AuthDatenOptionen = {},
) {
  const z = Buffer.alloc(4);
  z.writeUInt32BE(zaehler);
  const kopf = Buffer.concat([sha256(Buffer.from(rp)), Buffer.from([0x40]), z]);
  if (schluesselId === undefined) return kopf;
  const l = Buffer.alloc(2);
  l.writeUInt16BE(schluesselId.length);
  return Buffer.concat([
    kopf,
    aaguid ?? Buffer.from("appattestdevelop"),
    l,
    schluesselId,
    // COSE-Schlüssel: der Prüfer liest ihn nicht
    cbor({ "1": 2 }),
  ]);
}

// Ein Gerät mit seinem Schlüssel; attestiere() liefert das Objekt, das die App an den Server schickt
export class TestGeraet {
  readonly schluessel: Schluessel = neuerSchluessel();
  readonly kennung = sha256(punktVon(this.schluessel));
  zaehler = 0;
  constructor(readonly pki: Pki) {}

  get schluesselId() {
    return this.kennung.toString("base64");
  }

  attestiere(
    clientDataHash: Buffer,
    {
      auth = {},
      nonceVon = clientDataHash,
      pki = this.pki,
      blatt = this.schluessel,
      kette,
    }: {
      auth?: AuthDatenOptionen;
      // Für den Test «Nonce falsch»: die Nonce wird aus anderen Daten gebildet
      nonceVon?: Buffer;
      pki?: Pki;
      blatt?: Schluessel;
      kette?: Buffer[];
    } = {},
  ) {
    const daten = authDaten(this.kennung, auth);
    const nonce = sha256(daten, nonceVon);
    const blattZertifikat = baueZertifikat({
      cn: "Test Attestation Leaf",
      schluessel: blatt,
      ausgestelltVon: pki.zwischen,
      ca: false,
      nonce,
    });
    return cbor({
      fmt: "apple-appattest",
      attStmt: {
        x5c: kette ?? [blattZertifikat.der, pki.zwischen.der],
        receipt: randomBytes(8),
      },
      authData: daten,
    }).toString("base64");
  }

  assertiere(
    clientDataHash: Buffer,
    {
      zaehler = ++this.zaehler,
      auth = {},
    }: { zaehler?: number; auth?: AuthDatenOptionen } = {},
  ) {
    const daten = authDaten(undefined, { ...auth, zaehler });
    const nonce = sha256(daten, clientDataHash);
    const signatur = createSign("sha256")
      .update(nonce)
      .sign(this.schluessel.privat);
    return cbor({ signature: signatur, authenticatorData: daten }).toString(
      "base64",
    );
  }
}

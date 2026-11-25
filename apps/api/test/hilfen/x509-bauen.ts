import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

// Baut X.509-Zertifikate für die Tests (ECDSA P-256 mit SHA-256), damit die Prüfung der Kette von App Attest ohne echte Antworten von Apple läuft (#785). Kein Werkzeug für den Betrieb.

const laenge = (n: number) =>
  n < 128
    ? Buffer.from([n])
    : n < 256
      ? Buffer.from([0x81, n])
      : Buffer.from([0x82, n >> 8, n & 255]);
export const der = (tag: number, ...teile: Buffer[]) => {
  const inhalt = Buffer.concat(teile);
  return Buffer.concat([Buffer.from([tag]), laenge(inhalt.length), inhalt]);
};
const seq = (...t: Buffer[]) => der(0x30, ...t);
const oid = (...bytes: number[]) => der(0x06, Buffer.from(bytes));
const OID_CN = oid(0x55, 0x04, 0x03);
const OID_ECDSA_SHA256 = oid(0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02);
const OID_BASIC = oid(0x55, 0x1d, 0x13);
const OID_APPLE_NONCE = oid(
  0x2a,
  0x86,
  0x48,
  0x86,
  0xf7,
  0x63,
  0x64,
  0x08,
  0x02,
);

const name = (cn: string) =>
  seq(der(0x31, seq(OID_CN, der(0x0c, Buffer.from(cn)))));
const zeit = (d: Date) =>
  der(
    0x17,
    Buffer.from(
      d
        .toISOString()
        .slice(2)
        .replace(/[-:T]|\.\d+/g, ""),
    ),
  );

export type Schluessel = { privat: KeyObject; oeffentlich: KeyObject };
export const neuerSchluessel = (): Schluessel => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  return { privat: privateKey, oeffentlich: publicKey };
};

export type Zertifikat = {
  der: Buffer;
  pem: string;
  schluessel: Schluessel;
  name: string;
};

export function baueZertifikat({
  cn,
  schluessel = neuerSchluessel(),
  ausgestelltVon,
  ca,
  nonce,
  von = new Date(Date.now() - 3600_000),
  bis = new Date(Date.now() + 3600_000),
}: {
  cn: string;
  schluessel?: Schluessel;
  // Der Aussteller; ohne Angabe ist das Zertifikat selbst signiert
  ausgestelltVon?: Zertifikat;
  ca: boolean;
  // Die Nonce von Apple in der Erweiterung 1.2.840.113635.100.8.2
  nonce?: Buffer;
  von?: Date;
  bis?: Date;
}): Zertifikat {
  const erweiterungen = [
    seq(
      OID_BASIC,
      der(0x01, Buffer.from([0xff])),
      der(0x04, seq(...(ca ? [der(0x01, Buffer.from([0xff]))] : []))),
    ),
    ...(nonce
      ? [seq(OID_APPLE_NONCE, der(0x04, seq(der(0xa1, der(0x04, nonce)))))]
      : []),
  ];
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.from([1, ...Buffer.from(cn).subarray(0, 4)])),
    seq(OID_ECDSA_SHA256),
    name(ausgestelltVon?.name ?? cn),
    seq(zeit(von), zeit(bis)),
    name(cn),
    schluessel.oeffentlich.export({
      format: "der",
      type: "spki",
    }),
    der(0xa3, seq(...erweiterungen)),
  );
  const signatur = sign(
    "sha256",
    tbs,
    (ausgestelltVon?.schluessel ?? schluessel).privat,
  );
  const zertifikat = seq(
    tbs,
    seq(OID_ECDSA_SHA256),
    der(0x03, Buffer.from([0]), signatur),
  );
  const zeilen = zertifikat
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n");
  const pem = `-----BEGIN CERTIFICATE-----\n${zeilen}\n-----END CERTIFICATE-----\n`;
  return { der: zertifikat, pem, schluessel, name: cn };
}

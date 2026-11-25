import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

// Das Refresh-Token verlässt die Datenbank nur verschlüsselt: AES-256-GCM mit einem eigenen Schlüssel aus BETTER_AUTH_SECRET (HKDF mit eigener Kennung, wie startpasswort.ts, aber ein anderer Schlüssel). Wechselt das Geheimnis, wird das Token unlesbar: Dann neu verbinden (docs/betrieb.md).
// Die Abteilung gehört zu den authentifizierten Daten: Eine Zeile lässt sich nicht in eine andere Abteilung kopieren.
const schluessel = () =>
  Buffer.from(
    hkdfSync(
      "sha256",
      process.env.BETTER_AUTH_SECRET ?? "",
      "",
      "outlook-refresh-token",
      32,
    ),
  );

export function verschluesseleToken(klartext: string, abteilungId: string) {
  const iv = randomBytes(12);
  const chiffre = createCipheriv("aes-256-gcm", schluessel(), iv);
  chiffre.setAAD(Buffer.from(abteilungId, "utf8"));
  const daten = Buffer.concat([
    chiffre.update(klartext, "utf8"),
    chiffre.final(),
  ]);
  return Buffer.concat([iv, chiffre.getAuthTag(), daten]).toString("base64url");
}

// null, wenn der Text nicht lesbar ist (anderes Geheimnis, beschädigt, andere Abteilung)
export function entschluesseleToken(text: string, abteilungId: string) {
  try {
    const roh = Buffer.from(text, "base64url");
    const dechiffre = createDecipheriv(
      "aes-256-gcm",
      schluessel(),
      roh.subarray(0, 12),
    );
    dechiffre.setAAD(Buffer.from(abteilungId, "utf8"));
    dechiffre.setAuthTag(roh.subarray(12, 28));
    return Buffer.concat([
      dechiffre.update(roh.subarray(28)),
      dechiffre.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

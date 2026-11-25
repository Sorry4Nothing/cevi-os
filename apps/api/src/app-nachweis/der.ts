import type { X509Certificate } from "node:crypto";

// Ein kleiner DER-Leser, nur um aus einem Zertifikat eine Erweiterung zu holen: Node zeigt Erweiterungen wie die Nonce von Apple nicht an. Wirft bei jeder Abweichung.
type Knoten = { tag: number; inhalt: Uint8Array };

function lies(
  daten: Uint8Array,
  pos: number,
): { knoten: Knoten; ende: number } {
  if (pos + 2 > daten.length) throw new Error("DER: Ende");
  const tag = daten[pos]!;
  let laenge = daten[pos + 1]!;
  let start = pos + 2;
  if (laenge & 0x80) {
    const n = laenge & 0x7f;
    if (n === 0 || n > 3 || start + n > daten.length) {
      throw new Error("DER: Länge");
    }
    laenge = 0;
    for (let i = 0; i < n; i++) laenge = laenge * 256 + daten[start + i]!;
    start += n;
  }
  if (start + laenge > daten.length) throw new Error("DER: Ende");
  return {
    knoten: { tag, inhalt: daten.subarray(start, start + laenge) },
    ende: start + laenge,
  };
}

function kinder(knoten: Knoten): Knoten[] {
  const liste: Knoten[] = [];
  for (let pos = 0; pos < knoten.inhalt.length;) {
    const { knoten: k, ende } = lies(knoten.inhalt, pos);
    liste.push(k);
    pos = ende;
  }
  return liste;
}

const gleich = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

// Der Inhalt (OCTET STRING) der Erweiterung mit dieser OID, oder undefined
export function erweiterung(
  zertifikat: X509Certificate,
  oid: Uint8Array,
): Uint8Array | undefined {
  const wurzel = lies(zertifikat.raw, 0).knoten;
  const tbs = kinder(wurzel)[0];
  if (!tbs || tbs.tag !== 0x30) throw new Error("DER: tbsCertificate");
  // [3] EXPLICIT: die Erweiterungen
  const erw = kinder(tbs).find((k) => k.tag === 0xa3);
  const liste = erw ? kinder(erw)[0] : undefined;
  if (!liste) return undefined;
  for (const eintrag of kinder(liste)) {
    const teile = kinder(eintrag);
    const [kennung] = teile;
    if (kennung?.tag === 0x06 && gleich(kennung.inhalt, oid)) {
      // Danach optional «critical» (BOOLEAN), dann der OCTET STRING
      const wert = teile.at(-1);
      if (wert?.tag !== 0x04) throw new Error("DER: Erweiterung");
      return wert.inhalt;
    }
  }
  return undefined;
}

// Die Erweiterung 1.2.840.113635.100.8.2 von Apple trägt die Nonce: SEQUENCE { [1] { OCTET STRING } }
export const OID_APPLE_NONCE = Uint8Array.from([
  0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02,
]);

export function appleNonce(
  zertifikat: X509Certificate,
): Uint8Array | undefined {
  const wert = erweiterung(zertifikat, OID_APPLE_NONCE);
  if (!wert) return undefined;
  const aussen = lies(wert, 0).knoten;
  const [eins] = kinder(aussen);
  const [bytes] = eins?.tag === 0xa1 ? kinder(eins) : [];
  return bytes?.tag === 0x04 ? bytes.inhalt : undefined;
}

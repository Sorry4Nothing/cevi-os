// Ein kleiner CBOR-Leser (RFC 8949) für die Objekte von Apple App Attest: Attestation und Assertion. Er kennt nur, was dort vorkommt: Zahlen, Byte- und Textfolgen, Listen, Maps mit Textschlüsseln, true, false und null. Feste Längen, Tiefe und Grösse begrenzt; alles andere wirft.

const MAX_TIEFE = 6;
const MAX_ELEMENTE = 64;
const MAX_BYTES = 32 * 1024;

export type Cbor =
  | number
  | bigint
  | boolean
  | null
  | string
  | Uint8Array
  | Cbor[]
  | { [schluessel: string]: Cbor };

export class CborFehler extends Error {}

export function dekodiereCbor(daten: Uint8Array): Cbor {
  if (daten.length === 0 || daten.length > MAX_BYTES) {
    throw new CborFehler("Grösse");
  }
  let pos = 0;
  let elemente = 0;

  const lies = (n: number) => {
    if (pos + n > daten.length) throw new CborFehler("Ende");
    const teil = daten.subarray(pos, pos + n);
    pos += n;
    return teil;
  };
  // Der Wert hinter dem Kopf: kleine Werte stecken im Kopf selbst, grössere folgen in 1, 2, 4 oder 8 Byte
  const laenge = (info: number): number => {
    if (info < 24) return info;
    const n = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
    if (n === undefined) throw new CborFehler("unbestimmte Länge");
    const b = lies(n);
    let wert = 0n;
    for (const byte of b) wert = (wert << 8n) | BigInt(byte);
    // Zahlen dürfen gross sein, Längen nicht: Wer eine Länge liest, prüft sie gegen den Rest der Daten
    return wert > BigInt(Number.MAX_SAFE_INTEGER) ? Infinity : Number(wert);
  };

  const element = (tiefe: number): Cbor => {
    if (tiefe > MAX_TIEFE || ++elemente > MAX_ELEMENTE) {
      throw new CborFehler("zu verschachtelt");
    }
    const [kopf] = lies(1);
    const art = kopf >> 5;
    const info = kopf & 31;
    switch (art) {
      case 0:
        return laenge(info);
      case 1:
        return -1 - laenge(info);
      case 2: {
        const n = laenge(info);
        if (n > daten.length - pos) throw new CborFehler("Ende");
        return lies(n);
      }
      case 3: {
        const n = laenge(info);
        if (n > daten.length - pos) throw new CborFehler("Ende");
        return new TextDecoder("utf-8", { fatal: true }).decode(lies(n));
      }
      case 4: {
        const n = laenge(info);
        if (n > MAX_ELEMENTE) throw new CborFehler("zu lang");
        return Array.from({ length: n }, () => element(tiefe + 1));
      }
      case 5: {
        const n = laenge(info);
        if (n > MAX_ELEMENTE) throw new CborFehler("zu lang");
        const map: { [schluessel: string]: Cbor } = Object.create(null);
        for (let i = 0; i < n; i++) {
          const schluessel = element(tiefe + 1);
          if (typeof schluessel !== "string") {
            throw new CborFehler("Schlüssel ist kein Text");
          }
          if (schluessel in map) throw new CborFehler("doppelter Schlüssel");
          map[schluessel] = element(tiefe + 1);
        }
        return map;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new CborFehler("einfacher Wert");
      default:
        throw new CborFehler("Typ");
    }
  };

  const wert = element(0);
  if (pos !== daten.length) throw new CborFehler("Rest");
  return wert;
}

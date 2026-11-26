// Bildabgleich für «medium-aus-flickr» (#868): Welches Foto der Alben ist die Quelle eines Medienbilds, und welcher Ausschnitt davon?
// Wahrnehmungs-Hash (dHash) aus Grauwerten: Das Bild wird in 17 × 16 Felder geteilt, jedes der 256 Bits sagt, ob ein Feld heller ist als sein rechter Nachbar. Neu kodiert, verkleinert oder leicht anders belichtet ändert das wenige Bits, ein anderes Motiv rund die Hälfte.
// Medien sind teils beschnitten (ein Band 1920 × 576 aus einem Foto 3:2): Das Foto wird darum mit Ausschnitten im Seitenverhältnis des Mediums verglichen, der beste zählt. Ohne Abhängigkeiten, rein rechnend; die Grauwerte liefert sharp im Befehl.

const N = 16;
export const BITS = N * N;

// Grauwerte (ein Byte je Pixel, zeilenweise) als Summentabelle: Der Mittelwert eines beliebigen Rechtecks kostet vier Zugriffe
export type Graubild = { breite: number; hoehe: number; summen: Uint32Array };

export function graubild(
  pixel: Uint8Array,
  breite: number,
  hoehe: number,
): Graubild {
  const w = breite + 1;
  const summen = new Uint32Array(w * (hoehe + 1));
  for (let y = 0; y < hoehe; y++) {
    let zeile = 0;
    for (let x = 0; x < breite; x++) {
      zeile += pixel[y * breite + x]!;
      summen[(y + 1) * w + x + 1] = summen[y * w + x + 1]! + zeile;
    }
  }
  return { breite, hoehe, summen };
}

// Ausschnitt als Anteil des Bildes (0 bis 1), damit er auf jede Grösse passt
export type Ausschnitt = { x: number; y: number; b: number; h: number };
const GANZ: Ausschnitt = { x: 0, y: 0, b: 1, h: 1 };

function mittel(g: Graubild, x0: number, y0: number, x1: number, y1: number) {
  const w = g.breite + 1;
  const a = Math.max(0, Math.min(g.breite - 1, Math.round(x0)));
  const c = Math.max(a + 1, Math.min(g.breite, Math.round(x1)));
  const b = Math.max(0, Math.min(g.hoehe - 1, Math.round(y0)));
  const d = Math.max(b + 1, Math.min(g.hoehe, Math.round(y1)));
  const s =
    g.summen[d * w + c]! -
    g.summen[b * w + c]! -
    g.summen[d * w + a]! +
    g.summen[b * w + a]!;
  return s / ((c - a) * (d - b));
}

// 256 Bits in acht Wörtern
export function dHash(g: Graubild, f: Ausschnitt = GANZ): Uint32Array {
  const hash = new Uint32Array(BITS / 32);
  const x = f.x * g.breite;
  const y = f.y * g.hoehe;
  const fb = (f.b * g.breite) / (N + 1);
  const fh = (f.h * g.hoehe) / N;
  for (let r = 0; r < N; r++) {
    const y0 = y + r * fh;
    let links = mittel(g, x, y0, x + fb, y0 + fh);
    for (let s = 0; s < N; s++) {
      const x0 = x + (s + 1) * fb;
      const rechts = mittel(g, x0, y0, x0 + fb, y0 + fh);
      const i = r * N + s;
      if (links < rechts) hash[i >>> 5]! |= 1 << (i & 31);
      links = rechts;
    }
  }
  return hash;
}

export function abstand(a: Uint32Array, b: Uint32Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    let v = a[i]! ^ b[i]!;
    v -= (v >>> 1) & 0x55555555;
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    n += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return n;
}

// Die Ausschnitte eines Fotos im Seitenverhältnis des Mediums: volle Breite oder volle Höhe, an «schritte» + 1 Stellen über die freie Achse. Gleiche Seitenverhältnisse (höchstens 2 % Unterschied): nur das ganze Bild
export function ausschnitte(
  foto: Pick<Graubild, "breite" | "hoehe">,
  verhaeltnis: number,
  schritte: number,
  von = 0,
  bis = 1,
): Ausschnitt[] {
  const fotoVerh = foto.breite / foto.hoehe;
  if (Math.abs(fotoVerh / verhaeltnis - 1) <= 0.02) return [GANZ];
  // Das Medium ist breiter: volle Breite, das Fenster wandert senkrecht; sonst volle Höhe, waagrecht
  const breiter = verhaeltnis > fotoVerh;
  const b = breiter ? 1 : verhaeltnis / fotoVerh;
  const h = breiter ? fotoVerh / verhaeltnis : 1;
  const liste: Ausschnitt[] = [];
  for (let i = 0; i <= schritte; i++) {
    const t = Math.min(1, Math.max(0, von + ((bis - von) * i) / schritte));
    liste.push(
      breiter ? { x: 0, y: t * (1 - h), b, h } : { x: t * (1 - b), y: 0, b, h },
    );
  }
  return liste;
}

const SCHRITTE = 16;

// Der beste Ausschnitt eines Fotos für ein Medium: erst grob über die freie Achse, dann fein um den besten Punkt
export function vergleiche(
  medium: Uint32Array,
  verhaeltnis: number,
  foto: Graubild,
): { abstand: number; ausschnitt: Ausschnitt } {
  let best = { abstand: Infinity, ausschnitt: GANZ, t: 0 };
  const pruefe = (liste: Ausschnitt[], von: number, bis: number) =>
    liste.forEach((a, i) => {
      const d = abstand(medium, dHash(foto, a));
      if (d < best.abstand) {
        const t = liste.length > 1 ? von + ((bis - von) * i) / SCHRITTE : 0;
        best = { abstand: d, ausschnitt: a, t };
      }
    });
  const grob = ausschnitte(foto, verhaeltnis, SCHRITTE);
  pruefe(grob, 0, 1);
  if (grob.length > 1) {
    const von = best.t - 1 / SCHRITTE;
    const bis = best.t + 1 / SCHRITTE;
    pruefe(ausschnitte(foto, verhaeltnis, SCHRITTE, von, bis), von, bis);
  }
  return { abstand: best.abstand, ausschnitt: best.ausschnitt };
}

// Grenzen in Bits von 256: Dasselbe Motiv neu kodiert liegt meist unter 10, als Ausschnitt aus der kleinen Stufe von Flickr unter 32; ein anderes Motiv bei 100 und mehr. Ähnliche Fotos einer Serie liegen nah beieinander: Sicher ist ein Treffer nur, wenn das zweitbeste Foto deutlich weiter weg ist
// shortcut: die Grenzen sind an gezeichneten Testbildern geeicht, nicht an echten Fotos; nach dem ersten Lauf auf dem Server anhand der Liste prüfen und bei Bedarf anpassen
export const SICHER = 32;
export const UNSICHER = 64;
export const VORSPRUNG = 24;

export type Urteil = "sicher" | "unsicher" | "kein Treffer";
export function urteile(bester: number, zweiter: number): Urteil {
  if (bester > UNSICHER) return "kein Treffer";
  return bester <= SICHER && zweiter - bester >= VORSPRUNG
    ? "sicher"
    : "unsicher";
}

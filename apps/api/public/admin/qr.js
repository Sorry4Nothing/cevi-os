// QR-Code für die Einrichtung des zweiten Faktors (#715): Byte-Modus, Fehlerkorrektur M, Versionen 1 bis 10 (bis 213 Byte). Reicht für den Link otpauth://… (rund 150 Zeichen). Ohne Abhängigkeit und ohne Skript von Dritten (strenge CSP); gezeichnet wird als SVG-Knoten, nie als HTML.
// Aufbau nach ISO/IEC 18004: Daten, Reed-Solomon je Block, Verschachtelung, Muster, Maske mit der kleinsten Strafe, Format- und Versionsinformation.

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_VERSION = 10;

// Fehlerkorrektur M je Version: [Korrekturbytes je Block, Blöcke der ersten Gruppe, Datenbytes dort, Blöcke der zweiten Gruppe, Datenbytes dort]
const BLOECKE_M = [
  null,
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];

// Mitten der Ausrichtungsmuster je Version
const AUSRICHTUNG = [
  null,
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const datenbytes = (version) => {
  const [, a, aBytes, b, bBytes] = BLOECKE_M[version];
  return a * aBytes + b * bBytes;
};

// Wie viele Bytes in die Version passen: 4 Bit Modus, 8 oder 16 Bit Länge, dann die Daten
const kapazitaet = (version) =>
  Math.floor((datenbytes(version) * 8 - 4 - (version < 10 ? 8 : 16)) / 8);

// ---------- Reed-Solomon über GF(256), Polynom 0x11D ----------

function malGf(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function teilerPolynom(grad) {
  const teiler = new Array(grad).fill(0);
  teiler[grad - 1] = 1;
  let wurzel = 1;
  for (let i = 0; i < grad; i++) {
    for (let j = 0; j < grad; j++) {
      teiler[j] = malGf(teiler[j], wurzel);
      if (j + 1 < grad) teiler[j] ^= teiler[j + 1];
    }
    wurzel = malGf(wurzel, 2);
  }
  return teiler;
}

function rest(daten, teiler) {
  const ergebnis = new Array(teiler.length).fill(0);
  for (const b of daten) {
    const faktor = b ^ ergebnis.shift();
    ergebnis.push(0);
    teiler.forEach((koeffizient, i) => {
      ergebnis[i] ^= malGf(koeffizient, faktor);
    });
  }
  return ergebnis;
}

// ---------- Datenwörter und Verschachtelung ----------

function datenwoerter(bytes, version) {
  const bits = [];
  const schreibe = (wert, laenge) => {
    for (let i = laenge - 1; i >= 0; i--) bits.push((wert >>> i) & 1);
  };
  schreibe(0b0100, 4);
  schreibe(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) schreibe(b, 8);
  const gesamt = datenbytes(version) * 8;
  schreibe(0, Math.min(4, gesamt - bits.length));
  schreibe(0, (8 - (bits.length % 8)) % 8);
  for (let fuell = 0xec; bits.length < gesamt; fuell ^= 0xec ^ 0x11) {
    schreibe(fuell, 8);
  }
  const woerter = [];
  for (let i = 0; i < bits.length; i += 8) {
    woerter.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  }
  return woerter;
}

function mitKorrektur(woerter, version) {
  const [korrektur, a, aBytes, b, bBytes] = BLOECKE_M[version];
  const teiler = teilerPolynom(korrektur);
  const bloecke = [];
  let pos = 0;
  for (let i = 0; i < a + b; i++) {
    const laenge = i < a ? aBytes : bBytes;
    const daten = woerter.slice(pos, pos + laenge);
    pos += laenge;
    bloecke.push({ daten, korrektur: rest(daten, teiler) });
  }
  const ergebnis = [];
  const laengster = Math.max(aBytes, bBytes);
  for (let i = 0; i < laengster; i++) {
    for (const block of bloecke) {
      if (i < block.daten.length) ergebnis.push(block.daten[i]);
    }
  }
  for (let i = 0; i < korrektur; i++) {
    for (const block of bloecke) ergebnis.push(block.korrektur[i]);
  }
  return ergebnis;
}

// ---------- Matrix ----------

const MASKEN = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

const bit = (zahl, i) => ((zahl >>> i) & 1) === 1;

// Format: 2 Bit Fehlerkorrektur (M = 00), 3 Bit Maske, 10 Bit BCH, mit 0x5412 verknüpft
function formatBits(maske) {
  let rest10 = maske;
  for (let i = 0; i < 10; i++)
    rest10 = (rest10 << 1) ^ ((rest10 >>> 9) * 0x537);
  return ((maske << 10) | rest10) ^ 0x5412;
}

function versionBits(version) {
  let rest12 = version;
  for (let i = 0; i < 12; i++) {
    rest12 = (rest12 << 1) ^ ((rest12 >>> 11) * 0x1f25);
  }
  return (version << 12) | rest12;
}

// Leeres Raster mit allen festen Mustern; fest[y][x] sagt, wo keine Daten liegen
function grundraster(version) {
  const groesse = 17 + 4 * version;
  const module = Array.from({ length: groesse }, () =>
    new Array(groesse).fill(false),
  );
  const fest = Array.from({ length: groesse }, () =>
    new Array(groesse).fill(false),
  );
  const setze = (x, y, dunkel) => {
    module[y][x] = dunkel;
    fest[y][x] = true;
  };
  for (let i = 0; i < groesse; i++) {
    setze(6, i, i % 2 === 0);
    setze(i, 6, i % 2 === 0);
  }
  const sucher = (mx, my) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = mx + dx;
        const y = my + dy;
        if (x < 0 || y < 0 || x >= groesse || y >= groesse) continue;
        const abstand = Math.max(Math.abs(dx), Math.abs(dy));
        setze(x, y, abstand !== 2 && abstand !== 4);
      }
    }
  };
  sucher(3, 3);
  sucher(groesse - 4, 3);
  sucher(3, groesse - 4);
  const mitten = AUSRICHTUNG[version];
  mitten.forEach((my, j) => {
    mitten.forEach((mx, i) => {
      const imSucher =
        (i === 0 && j === 0) ||
        (i === 0 && j === mitten.length - 1) ||
        (i === mitten.length - 1 && j === 0);
      if (imSucher) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setze(mx + dx, my + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });
  // Format und Version vorerst als hell reservieren; geschrieben wird erst mit der Maske
  zeichneFormat(setze, groesse, 0);
  if (version >= 7) zeichneVersion(setze, groesse, version);
  return { groesse, module, fest };
}

function zeichneFormat(setze, groesse, maske) {
  const bits = formatBits(maske);
  for (let i = 0; i <= 5; i++) setze(8, i, bit(bits, i));
  setze(8, 7, bit(bits, 6));
  setze(8, 8, bit(bits, 7));
  setze(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) setze(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) setze(groesse - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) setze(8, groesse - 15 + i, bit(bits, i));
  // Das dunkle Modul neben dem Format
  setze(8, groesse - 8, true);
}

function zeichneVersion(setze, groesse, version) {
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const a = groesse - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setze(a, b, bit(bits, i));
    setze(b, a, bit(bits, i));
  }
}

function legeDaten(raster, woerter) {
  const { groesse, module, fest } = raster;
  let i = 0;
  for (let rechts = groesse - 1; rechts >= 1; rechts -= 2) {
    if (rechts === 6) rechts = 5;
    for (let senkrecht = 0; senkrecht < groesse; senkrecht++) {
      for (let j = 0; j < 2; j++) {
        const x = rechts - j;
        const aufwaerts = ((rechts + 1) & 2) === 0;
        const y = aufwaerts ? groesse - 1 - senkrecht : senkrecht;
        if (!fest[y][x] && i < woerter.length * 8) {
          module[y][x] = bit(woerter[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

// Strafpunkte nach ISO 18004, 7.8.3: Reihen gleicher Farbe, 2x2-Blöcke, Sucher-ähnliche Muster, Verhältnis dunkel zu hell
function strafe(module) {
  const n = module.length;
  let summe = 0;
  const linien = [];
  for (let i = 0; i < n; i++) {
    linien.push(module[i]);
    linien.push(module.map((zeile) => zeile[i]));
  }
  for (const linie of linien) {
    let lauf = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && linie[i] === linie[i - 1]) {
        lauf++;
      } else {
        if (lauf >= 5) summe += 3 + (lauf - 5);
        lauf = 1;
      }
    }
    const text = linie.map((d) => (d ? "1" : "0")).join("");
    for (const muster of ["10111010000", "00001011101"]) {
      for (let at = text.indexOf(muster); at !== -1;) {
        summe += 40;
        at = text.indexOf(muster, at + 1);
      }
    }
  }
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const f = module[y][x];
      if (
        f === module[y][x + 1] &&
        f === module[y + 1][x] &&
        f === module[y + 1][x + 1]
      ) {
        summe += 3;
      }
    }
  }
  const dunkel = module.flat().filter(Boolean).length;
  const gesamt = n * n;
  summe += (Math.ceil(Math.abs(dunkel * 20 - gesamt * 10) / gesamt) - 1) * 10;
  return summe;
}

// Der Text als QR-Code (Byte-Modus, Fehlerkorrektur M). maske (0 bis 7) erzwingt eine Maske, sonst gilt die mit der kleinsten Strafe. Gibt Version, Seitenlänge und die Module (true = dunkel) zurück; wirft bei zu langem Text
export function erzeugeQr(text, { maske } = {}) {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  while (version <= MAX_VERSION && bytes.length > kapazitaet(version)) {
    version++;
  }
  if (version > MAX_VERSION) {
    throw new RangeError(
      `Der Text ist mit ${bytes.length} Byte zu lang für den QR-Code (höchstens ${kapazitaet(MAX_VERSION)}).`,
    );
  }
  const woerter = mitKorrektur(datenwoerter(bytes, version), version);
  let bester = null;
  for (let m = 0; m < 8; m++) {
    if (maske !== undefined && m !== maske) continue;
    const raster = grundraster(version);
    legeDaten(raster, woerter);
    const { groesse, module, fest } = raster;
    for (let y = 0; y < groesse; y++) {
      for (let x = 0; x < groesse; x++) {
        if (!fest[y][x] && MASKEN[m](x, y)) module[y][x] = !module[y][x];
      }
    }
    const setze = (x, y, dunkel) => {
      module[y][x] = dunkel;
    };
    zeichneFormat(setze, groesse, m);
    const punkte = strafe(module);
    if (!bester || punkte < bester.punkte) {
      bester = { version, groesse, module, maske: m, punkte };
    }
  }
  return bester;
}

// Zeichnet den Code als SVG: dunkle Module auf hellem Grund mit Ruhezone von vier Modulen. Die Farben sind fest (Schwarz auf Weiss), damit jede App den Code im hellen und im dunklen Theme liest. beschriftung: Text für Screenreader
export function zeichneQr(text, { beschriftung = "QR-Code" } = {}) {
  const { groesse, module } = erzeugeQr(text);
  const rand = 4;
  const seite = groesse + 2 * rand;
  const pfad = [];
  module.forEach((zeile, y) => {
    let x = 0;
    while (x < groesse) {
      if (!zeile[x]) {
        x++;
        continue;
      }
      let ende = x;
      while (ende < groesse && zeile[ende]) ende++;
      pfad.push(`M${x + rand} ${y + rand}h${ende - x}v1h${x - ende}z`);
      x = ende;
    }
  });
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "qr");
  svg.setAttribute("viewBox", `0 0 ${seite} ${seite}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", beschriftung);
  svg.setAttribute("shape-rendering", "crispEdges");
  const grund = document.createElementNS(SVG_NS, "rect");
  grund.setAttribute("width", String(seite));
  grund.setAttribute("height", String(seite));
  grund.setAttribute("fill", "#fff");
  const dunkel = document.createElementNS(SVG_NS, "path");
  dunkel.setAttribute("d", pfad.join(""));
  dunkel.setAttribute("fill", "#000");
  svg.append(grund, dunkel);
  return svg;
}

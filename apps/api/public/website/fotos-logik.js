// Fotoalben (#796): die reinen Teile von fotos.js (Gruppen nach Jahr, Suche, Schritte des Rasters, Namen der Bilder). Ohne DOM und ohne Abrufe, damit sie sich testen lassen (test/website-fotoalben.test.ts).

// Ab so vielen Alben gibt es Gruppen nach Jahr und die Suche; darunter steht ein einfaches Raster
export const VIELE_ALBEN = 9;
// So viele Alben sind beim Öffnen sichtbar, danach klappen die älteren Jahre zu
export const OFFEN_BIS_ALBEN = 12;
// So viele Bilder kommen je Schritt dazu
export const SCHRITT_BILDER = 48;

export const jahrVon = (datum) =>
  typeof datum === "string" && /^\d{4}-\d{2}-\d{2}$/.test(datum)
    ? datum.slice(0, 4)
    : null;

// Jahre absteigend, «ohne Datum» zuletzt (jahr: null); innerhalb eines Jahres bleibt die Reihenfolge der Abteilung
export function gruppiereNachJahr(alben) {
  const nachJahr = new Map();
  for (const a of alben) {
    const j = jahrVon(a.datum);
    if (!nachJahr.has(j)) nachJahr.set(j, []);
    nachJahr.get(j).push(a);
  }
  return [...nachJahr.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b.localeCompare(a)))
    .map(([jahr, liste]) => ({ jahr, alben: liste }));
}

// Welche Gruppen beim Öffnen aufgeklappt sind: die jüngste immer, die nächsten, solange nicht zu viele Alben stehen
export function standardOffen(gruppen) {
  const offen = new Set();
  let summe = 0;
  gruppen.forEach((g, i) => {
    if (i === 0 || summe < OFFEN_BIS_ALBEN) offen.add(g.jahr);
    summe += g.alben.length;
  });
  return offen;
}

// Gross und klein egal, Umlaute und «ae/oe/ue» gleich, «ß» wie «ss»: Wer «hornli» oder «hoernli» tippt, findet «Hörnli»
export const sucheSchluessel = (text) =>
  String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/([aou])e/g, "$1");

// Jedes Wort der Eingabe muss im Titel oder im Jahr vorkommen
export function filtereAlben(alben, begriff) {
  const worte = sucheSchluessel(begriff).split(/\s+/).filter(Boolean);
  if (worte.length === 0) return alben;
  return alben.filter((a) => {
    const s = sucheSchluessel(`${a.titel || ""} ${jahrVon(a.datum) ?? ""}`);
    return worte.every((w) => s.includes(w));
  });
}

export const albenText = (n) => `${n} ${n === 1 ? "Album" : "Alben"}`;
export const fotosText = (n) => `${n} ${n === 1 ? "Foto" : "Fotos"}`;

// «87 Alben» ohne Filter, sonst «23 von 87 Alben»
export const trefferText = (treffer, gesamt) =>
  treffer === gesamt
    ? albenText(gesamt)
    : `${treffer} von ${albenText(gesamt)}`;

// Das Seitenverhältnis als Klasse «fr15» (1.5), auf 0.1 gerundet und begrenzt auf 0.5 bis 3: Das Raster setzt daraus --r (fotos.css), ohne Stilattribut
export function verhaeltnisKlasse(breite, hoehe) {
  const b = Number(breite);
  const h = Number(hoehe);
  const v = b > 0 && h > 0 ? b / h : 1.5;
  const zehntel = Math.min(30, Math.max(5, Math.round(v * 10)));
  return `fr${String(zehntel).padStart(2, "0")}`;
}

// Stufen des Servers (#867), klein nach gross: die lange Seite in Pixeln, wie Flickr sie anbietet; dazu «original»
export const STUFEN = [
  "320",
  "400",
  "640",
  "800",
  "1024",
  "1600",
  "2048",
  "3072",
  "4096",
  "5120",
  "6144",
  "original",
];

// Die Stufen, die der Server für ein Bild meldet («groessen»: Stufe → [Breite, Höhe]), klein nach gross; nur mit gültigen Massen
export function vorhandeneGroessen(groessen) {
  if (groessen === null || typeof groessen !== "object") return [];
  return STUFEN.flatMap((stufe) => {
    const m = Object.hasOwn(groessen, stufe) ? groessen[stufe] : null;
    const breite = Array.isArray(m) ? Number(m[0]) : 0;
    const hoehe = Array.isArray(m) ? Number(m[1]) : 0;
    return Number.isInteger(breite) &&
      Number.isInteger(hoehe) &&
      breite > 0 &&
      hoehe > 0
      ? [{ stufe, breite, hoehe }]
      : [];
  });
}

// Die Stufen zwischen «von» und «bis» (lange Seite), ohne Original: für srcset
const zwischen = (groessen, von, bis) =>
  vorhandeneGroessen(groessen).filter(
    (g) =>
      g.stufe !== "original" &&
      Number(g.stufe) >= von &&
      Number(g.stufe) <= bis,
  );

// srcset mit w-Deskriptoren (echte Breite der Datei); adresse(stufe) gibt die Adresse. Leer, wenn keine Stufe passt
export const srcsetAus = (groessen, adresse, von, bis) =>
  zwischen(groessen, von, bis)
    .map((g) => `${adresse(g.stufe)} ${g.breite}w`)
    .join(", ");

// Die grösste Stufe bis «bis», oder null
export const groessteBis = (groessen, bis) =>
  zwischen(groessen, 0, bis).at(-1) ?? null;

// Zum Herunterladen je Gruppe die grösste Stufe, die es gibt, wie im Menü von Flickr; das Original nur, wenn Flickr es freigibt
const GRUPPEN = [
  ["Klein", ["320", "400"]],
  ["Mittel", ["640", "800"]],
  ["Gross", ["1024", "1600", "2048"]],
  ["Extragross", ["3072", "4096", "5120", "6144"]],
  ["Original", ["original"]],
];
export function herunterladeGroessen(groessen) {
  const da = vorhandeneGroessen(groessen);
  return GRUPPEN.flatMap(([name, stufen]) => {
    const g = da.filter((x) => stufen.includes(x.stufe)).at(-1);
    return g ? [{ name, ...g }] : [];
  });
}

// «2048 × 1365» mit geschützten Leerzeichen um das Malzeichen
export const masseText = (breite, hoehe) => `${breite}\u00a0×\u00a0${hoehe}`;

// Der Name des Links zum Bild: «Foto 3 von 393»; ein Titel von Flickr kommt dazu, ausser er ist ein Dateiname («IMG_4021.jpg», «DSC00042»)
const DATEINAME =
  /\.(jpe?g|png|gif|webp|heic)$|^(img|dsc|dscf|dscn|p|pxl|mvimg)[-_ ]?\d+/i;
export function bildName(nr, gesamt, titel) {
  const t = typeof titel === "string" ? titel.trim() : "";
  const grund = `Foto ${nr} von ${gesamt}`;
  return t && !DATEINAME.test(t) ? `${grund}: ${t}` : grund;
}

// Wie viele Bilder gezeigt sind, nachdem «Mehr anzeigen» gedrückt wurde
export const naechsteMenge = (gezeigt, gesamt, schritt = SCHRITT_BILDER) =>
  Math.min(gesamt, gezeigt + schritt);

// Wie viele Bilder gezeigt sein müssen, damit das Bild mit diesem Index dabei ist (in ganzen Schritten)
export const mengeBis = (gezeigt, index, gesamt, schritt = SCHRITT_BILDER) =>
  index < gezeigt
    ? gezeigt
    : Math.min(gesamt, Math.ceil((index + 1) / schritt) * schritt);

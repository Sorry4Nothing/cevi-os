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

// Breiten der Dateien für srcset: Die Stufen des Servers sind die lange Seite (klein 320, mittel 640)
export function bildBreiten(breite, hoehe) {
  const b = Number(breite);
  const h = Number(hoehe);
  const v = b > 0 && h > 0 ? b / h : 4 / 3;
  const breiter = (lang) => Math.round(v >= 1 ? lang : lang * v);
  return { klein: breiter(320), mittel: breiter(640) };
}

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

// Bild zuschneiden (#633): Eine zentrale Seite im Fluss für jede Stelle der Verwaltung, an der man ein Bild von der eigenen Platte wählt.
// Eigener Code ohne Bibliothek. Das Bild wird mit createImageBitmap gelesen (Ausrichtung nach EXIF) und nur auf Leinwänden gezeichnet; es gibt weder Bild-Elemente noch blob:-Adressen, die CSP (img-src 'self' data:) bleibt, wie sie ist.
// Das Ergebnis entsteht neu auf einer Leinwand: EXIF, Aufnahmeort und Kameradaten sind danach weg.
// Der Ausschnitt lässt sich ziehen (Maus, Finger), an den Ecken und Kanten ändern, mit zwei Fingern, Mausrad, Regler und Tasten zoomen; für alles ohne Ziehen gibt es Knöpfe und Regler (WCAG 2.5.7).
import { fehlertext as standardFehlertext } from "./api.js";
import { el, flussKopf, icon, knopf, neueId } from "./dom.js";
import { oeffneFluss } from "./fluss.js";

// ===== Reine Rechenfunktionen (testbar) =====
// Ein Rechteck ist { x, y, w, h } in Pixeln des Arbeitsbildes, ein Bild { b, h } seine Grösse.

export const MIN_SEITE = 48;
export const ZOOM_MAX = 8;
const clamp = (wert, min, max) => Math.min(Math.max(wert, min), max);
const minSeite = (bild) => Math.min(MIN_SEITE, bild.b, bild.h);

// «16:9» wird 16/9; «frei», leer oder Unsinn bleibt null (kein festes Verhältnis)
export function verhaeltnisWert(text) {
  if (typeof text === "number") return text > 0 ? text : null;
  const [a, b] = String(text ?? "")
    .split(":")
    .map(Number);
  return a > 0 && b > 0 ? a / b : null;
}

// Das grösste Rechteck mit dem Verhältnis, mittig im Bild; ohne Verhältnis das ganze Bild
export function groesstesRechteck(bild, verhaeltnis = null) {
  if (!verhaeltnis) return { x: 0, y: 0, w: bild.b, h: bild.h };
  let w = bild.b;
  let h = w / verhaeltnis;
  if (h > bild.h) {
    h = bild.h;
    w = h * verhaeltnis;
  }
  return { x: (bild.b - w) / 2, y: (bild.h - h) / 2, w, h };
}

// Schiebt das Rechteck ins Bild und kürzt, was darüber hinausragt
export function begrenze(r, bild) {
  const w = clamp(r.w, 1, bild.b);
  const h = clamp(r.h, 1, bild.h);
  return {
    x: clamp(r.x, 0, bild.b - w),
    y: clamp(r.y, 0, bild.h - h),
    w,
    h,
  };
}

export function verschiebe(r, dx, dy, bild) {
  return begrenze({ ...r, x: r.x + dx, y: r.y + dy }, bild);
}

// Ändert die Grösse mit gleichem Seitenverhältnis. faktor < 1 macht den Ausschnitt kleiner (hineinzoomen). anker: Punkt im Ausschnitt (0 bis 1), der stehen bleibt.
export function skaliere(r, faktor, bild, anker = { x: 0.5, y: 0.5 }) {
  const untergrenze = Math.max(minSeite(bild) / r.w, minSeite(bild) / r.h);
  const obergrenze = Math.min(bild.b / r.w, bild.h / r.h);
  const f = Math.min(obergrenze, Math.max(faktor, untergrenze));
  const w = r.w * f;
  const h = r.h * f;
  return begrenze(
    {
      x: r.x + (r.w - w) * clamp(anker.x, 0, 1),
      y: r.y + (r.h - h) * clamp(anker.y, 0, 1),
      w,
      h,
    },
    bild,
  );
}

// Setzt Breite und/oder Höhe um die Mitte (die Regler bei freiem Verhältnis)
export function setzeMasse(r, { b, h }, bild) {
  const m = minSeite(bild);
  const w = clamp(b ?? r.w, m, bild.b);
  const hh = clamp(h ?? r.h, m, bild.h);
  return begrenze(
    { x: r.x + (r.w - w) / 2, y: r.y + (r.h - hh) / 2, w, h: hh },
    bild,
  );
}

// Zoom 1 = grösster Ausschnitt, ZOOM_MAX = achtmal näher; der Regler läuft von 0 bis 100 und ist logarithmisch
export const zoomZuRegler = (zoom) =>
  clamp(Math.round((Math.log(zoom) / Math.log(ZOOM_MAX)) * 100), 0, 100);
export const reglerZuZoom = (wert) => ZOOM_MAX ** (clamp(wert, 0, 100) / 100);
export function zoomStufe(r, bild, verhaeltnis = null) {
  return groesstesRechteck(bild, verhaeltnis).w / r.w;
}

// Zieht an einer Ecke oder Kante. Mit festem Verhältnis gibt es nur Ecken; die gegenüberliegende Ecke bleibt stehen.
// handle: nw, n, ne, e, se, s, sw, w
export function aendereMitGriff(r, handle, dx, dy, bild, verhaeltnis = null) {
  const m = minSeite(bild);
  const west = handle.includes("w");
  const ost = handle.includes("e");
  const nord = handle.includes("n");
  const sued = handle.includes("s");
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.w;
  let y1 = r.y + r.h;
  if (!verhaeltnis) {
    if (west) x0 = clamp(x0 + dx, 0, x1 - m);
    if (ost) x1 = clamp(x1 + dx, x0 + m, bild.b);
    if (nord) y0 = clamp(y0 + dy, 0, y1 - m);
    if (sued) y1 = clamp(y1 + dy, y0 + m, bild.h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const ax = west ? x1 : x0;
  const ay = nord ? y1 : y0;
  const bx = (west ? x0 : x1) + dx;
  const by = (nord ? y0 : y1) + dy;
  const breiteX = west ? ax - bx : bx - ax;
  const hoeheY = nord ? ay - by : by - ay;
  const maxW = Math.min(
    west ? ax : bild.b - ax,
    (nord ? ay : bild.h - ay) * verhaeltnis,
  );
  const minW = Math.max(m, m * verhaeltnis);
  const w = clamp(
    Math.max(breiteX, hoeheY * verhaeltnis),
    Math.min(minW, maxW),
    maxW,
  );
  const h = w / verhaeltnis;
  return { x: west ? ax - w : ax, y: nord ? ay - h : ay, w, h };
}

// Dreht das Rechteck mit dem Bild um 90 Grad; bild ist die Grösse vor der Drehung
export function dreheRechteck(r, bild, rechts = true) {
  return rechts
    ? { x: bild.h - r.y - r.h, y: r.x, w: r.h, h: r.w }
    : { x: r.y, y: bild.b - r.x - r.w, w: r.h, h: r.w };
}

// Wechselt auf ein festes Verhältnis: das grösste Rechteck dieses Verhältnisses in der Mitte des bisherigen
export function passeAn(r, verhaeltnis, bild) {
  if (!verhaeltnis) return r;
  const w = Math.min(r.w, r.h * verhaeltnis);
  const h = w / verhaeltnis;
  return begrenze(
    { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h },
    bild,
  );
}

// Grösse des Ergebnisses: nie grösser als der Ausschnitt, die längere Seite höchstens maxSeite
export function ausgabeMasse(r, maxSeite) {
  const b = Math.max(1, Math.round(r.w));
  const h = Math.max(1, Math.round(r.h));
  const f = Math.min(1, maxSeite / Math.max(b, h));
  return {
    b: Math.max(1, Math.round(b * f)),
    h: Math.max(1, Math.round(h * f)),
  };
}

export function groesseText(bytes) {
  if (bytes < 1024) return `${bytes} Byte`;
  const zahl = (n) => n.toLocaleString("de-CH", { maximumFractionDigits: 1 });
  return bytes < 1024 * 1024
    ? `${zahl(bytes / 1024)} KB`
    : `${zahl(bytes / 1024 / 1024)} MB`;
}

// Name der neuen Datei: Name des Originals ohne Endung, Zusatz, Endung nach dem Typ
export function dateiname(original, typ) {
  const basis =
    String(original ?? "")
      .replace(/\.[^.]*$/, "")
      .replace(/[^\p{L}\p{N}._ -]+/gu, "")
      .trim()
      .slice(0, 80) || "bild";
  return `${basis}-zugeschnitten.${typ === "image/png" ? "png" : "jpg"}`;
}

// ===== Browser =====

const ARBEIT_MAX = 4096; // längste Seite des Arbeitsbildes; iOS rechnet Leinwände nur bis rund 16 Mio. Pixel
const EINGANG_MAX_PIXEL = 64_000_000;
const TEXT_LESEN = "Dieses Bild lässt sich nicht lesen. Wähle ein anderes.";
const TEXT_ZU_GROSS =
  "Dieses Bild hat zu viele Pixel. Wähle ein kleineres oder verkleinere es zuerst.";
const HANDLES_FREI = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLES_FEST = ["nw", "ne", "se", "sw"];
const CURSOR = {
  nw: "nwse",
  se: "nwse",
  ne: "nesw",
  sw: "nesw",
  n: "ns",
  s: "ns",
  e: "ew",
  w: "ew",
};

export const STANDARD_VERHAELTNISSE = [
  { text: "Frei", wert: null },
  { text: "1:1", wert: 1 },
  { text: "4:3", wert: 4 / 3 },
  { text: "16:9", wert: 16 / 9 },
  { text: "3:2", wert: 3 / 2 },
];

const leinwand = (b, h) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(b));
  c.height = Math.max(1, Math.round(h));
  return c;
};

// Liest das Bild mit der Ausrichtung aus den EXIF-Daten und legt es als Arbeitsbild ab (längste Seite höchstens ARBEIT_MAX)
async function leseBild(datei) {
  let bitmap;
  try {
    bitmap = await window.createImageBitmap(datei, {
      imageOrientation: "from-image",
    });
  } catch {
    try {
      bitmap = await window.createImageBitmap(datei);
    } catch {
      throw new Error(TEXT_LESEN);
    }
  }
  const pixel = bitmap.width * bitmap.height;
  if (pixel > EINGANG_MAX_PIXEL) {
    bitmap.close();
    throw new Error(TEXT_ZU_GROSS);
  }
  const f = Math.min(1, ARBEIT_MAX / Math.max(bitmap.width, bitmap.height));
  const arbeit = leinwand(bitmap.width * f, bitmap.height * f);
  const c = arbeit.getContext("2d");
  c.imageSmoothingQuality = "high";
  c.drawImage(bitmap, 0, 0, arbeit.width, arbeit.height);
  bitmap.close();
  return { arbeit, pixel };
}

const dreheLeinwand = (quelle, rechts) => {
  const neu = leinwand(quelle.height, quelle.width);
  const c = neu.getContext("2d");
  c.translate(neu.width / 2, neu.height / 2);
  c.rotate(((rechts ? 1 : -1) * Math.PI) / 2);
  c.drawImage(quelle, -quelle.width / 2, -quelle.height / 2);
  return neu;
};

// Gibt es durchsichtige Stellen? Geprüft an einer kleinen Kopie
function hatTransparenz(quelle) {
  const f = Math.min(1, 128 / Math.max(quelle.width, quelle.height));
  const klein = leinwand(quelle.width * f, quelle.height * f);
  const c = klein.getContext("2d", { willReadFrequently: true });
  c.drawImage(quelle, 0, 0, klein.width, klein.height);
  const px = c.getImageData(0, 0, klein.width, klein.height).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return true;
  return false;
}

// Durchsichtige Stellen werden weiss, denn JPEG kann sie nicht
function flach(quelle) {
  const neu = leinwand(quelle.width, quelle.height);
  const c = neu.getContext("2d");
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, neu.width, neu.height);
  c.drawImage(quelle, 0, 0);
  return neu;
}

const alsBlob = (quelle, typ, qualitaet) =>
  new Promise((ok) => quelle.toBlob(ok, typ, qualitaet));

// Kodiert, bis das Ergebnis unter der Grenze liegt: erst weniger Qualität, dann kleiner
async function kodiere(quelle, typ, maxBytes) {
  let c = quelle;
  for (let runde = 0; runde < 4; runde++) {
    const qualitaeten = typ === "image/jpeg" ? [0.9, 0.8, 0.65] : [undefined];
    for (const q of qualitaeten) {
      const blob = await alsBlob(c, typ, q);
      if (!blob) throw new Error("Das Bild lässt sich nicht speichern.");
      if (blob.size <= maxBytes) return blob;
    }
    const kleiner = leinwand(c.width * 0.75, c.height * 0.75);
    const k = kleiner.getContext("2d");
    k.imageSmoothingQuality = "high";
    k.drawImage(c, 0, 0, kleiner.width, kleiner.height);
    c = kleiner;
  }
  throw new Error(
    `Das Ergebnis ist grösser als ${groesseText(maxBytes)}. Wähle einen kleineren Ausschnitt.`,
  );
}

// Seite «Bild zuschneiden». Liefert { datei, zugeschnitten, antwort } oder null (Abbrechen, Zurück).
// datei: die gewählte Datei · verhaeltnisse: [{ text, wert }] (ein Eintrag = fest; wert null = frei) · standard: Index
// rund: Kreisvorschau (Profilbild) · maxSeite: längste Seite des Ergebnisses · maxBytes, maxPixel: Grenzen der Schnittstelle
// transparenz: Durchsichtiges bleibt (PNG); sonst immer JPEG · senden(datei): läuft beim Bestätigen; Fehler erscheinen auf der Seite
// Wirft einen Error mit lesbarem Text, wenn sich das Bild nicht lesen lässt; der Aufrufer zeigt ihn am Feld.
export async function zuschneiden({
  datei,
  titel = "Bild zuschneiden",
  beschreibung,
  verhaeltnisse = STANDARD_VERHAELTNISSE,
  standard = 0,
  rund = false,
  maxSeite = 2048,
  maxBytes = 5 * 1024 * 1024,
  maxPixel = 16_000_000,
  transparenz = true,
  ok = "Zuschneiden",
  senden,
  fehlertext = standardFehlertext,
}) {
  const gelesen = await leseBild(datei);
  let arbeit = gelesen.arbeit;
  const mitAlpha = transparenz && datei.type !== "image/jpeg";
  const fest = verhaeltnisse.length === 1;
  let verh = verhaeltnisse[standard]?.wert ?? null;
  let bild = { b: arbeit.width, h: arbeit.height };
  let rect = groesstesRechteck(bild, verh);
  const zurueck = document.activeElement;

  // ----- Aufbau -----
  const titelId = neueId("titel");
  const hinweisId = neueId("zs-hinweis");
  const canvas = el("canvas", { class: "zs-leinwand" });
  const flaeche = el(
    "div",
    {
      class: "zs-flaeche",
      tabindex: "0",
      role: "group",
      "aria-label": "Bildausschnitt",
      "aria-describedby": hinweisId,
    },
    canvas,
  );
  const hinweis = el(
    "p",
    { class: "hilfe", id: hinweisId },
    "Ziehe den Ausschnitt, um ihn zu verschieben, und die Ecken, um ihn zu ändern. Zwei Finger und das Mausrad zoomen. Mit der Tastatur: Pfeiltasten verschieben, Plus und Minus zoomen, mit der Umschalttaste in grösseren Schritten.",
  );
  const angabe = el("p", { class: "klein leise zs-angabe" });
  const ansage = el("p", { class: "nur-leser", role: "status" });

  const reglerZeile = (text, min, max, beiEingabe, links, rechts) => {
    const id = neueId("zs-regler");
    const eingabe = el("input", {
      class: "zs-regler",
      id,
      type: "range",
      min,
      max,
      step: 1,
      value: min,
    });
    const wert = el("span", {
      class: "zs-wert klein leise",
      "aria-hidden": "true",
    });
    eingabe.addEventListener("input", () => beiEingabe(Number(eingabe.value)));
    return {
      eingabe,
      wert,
      wurzel: el(
        "div",
        { class: "zs-reglerzeile" },
        el("label", { for: id }, text),
        wert,
        el("div", { class: "zs-reglerreihe" }, links, eingabe, rechts),
      ),
    };
  };

  const rundKnopf = (name, symbolName, beiKlick, klasse = "") =>
    el(
      "button",
      {
        type: "button",
        class: `knopf knopf--rund ${klasse}`.trim(),
        "aria-label": name,
        "data-tipp": name,
        onclick: beiKlick,
      },
      icon(symbolName),
    );

  // Grösse: bei festem Verhältnis ein Zoomregler mit Knöpfen, bei freiem Breite und Höhe
  const zoomRegler = reglerZeile(
    "Zoom",
    0,
    100,
    (v) => {
      setzeRect(
        skaliere(rect, zoomStufe(rect, bild, verh) / reglerZuZoom(v), bild),
      );
    },
    rundKnopf("Verkleinern", "minus", () => zoomUm(1.25, true)),
    rundKnopf("Vergrössern", "plus", () => zoomUm(0.8, true)),
  );
  const breiteRegler = reglerZeile("Breite", 1, 100, (v) => {
    setzeRect(setzeMasse(rect, { b: (v / 100) * bild.b }, bild));
  });
  const hoeheRegler = reglerZeile("Höhe", 1, 100, (v) => {
    setzeRect(setzeMasse(rect, { h: (v / 100) * bild.h }, bild));
  });
  const zoomBlock = zoomRegler.wurzel;
  const masseBlock = el(
    "div",
    { class: "zs-masse" },
    breiteRegler.wurzel,
    hoeheRegler.wurzel,
  );

  const gruppe = (legende, ...inhalt) =>
    el(
      "fieldset",
      { class: "zs-gruppe" },
      el("legend", {}, legende),
      ...inhalt,
    );

  // Seitenverhältnis (nur wenn es mehrere gibt)
  const verhName = neueId("zs-verh");
  const verhEintraege = verhaeltnisse.map((v, i) => {
    const id = `${verhName}-${i}`;
    return [
      el("input", {
        type: "radio",
        name: verhName,
        id,
        value: String(i),
        checked: i === standard,
      }),
      el("label", { for: id }, icon("haken"), v.text),
    ];
  });
  const verhGruppe = fest
    ? null
    : gruppe(
        "Seitenverhältnis",
        el("div", { class: "seg" }, verhEintraege.flat()),
      );

  const schritt = (dx, dy) => bewege(dx, dy, false, true);
  const kreuz = el(
    "div",
    { class: "zs-kreuz" },
    rundKnopf("Nach oben", "hoch", () => schritt(0, -1), "zs-oben"),
    rundKnopf("Nach links", "zurueck", () => schritt(-1, 0), "zs-links"),
    rundKnopf("Nach rechts", "weiter", () => schritt(1, 0), "zs-rechts"),
    rundKnopf("Nach unten", "runter", () => schritt(0, 1), "zs-unten"),
  );
  const drehen = el(
    "div",
    { class: "zs-drehen" },
    knopf("Links drehen", {
      klein: true,
      symbol: "aktualisieren",
      onclick: () => drehe(false),
    }),
    knopf("Rechts drehen", {
      klein: true,
      symbol: "aktualisieren",
      onclick: () => drehe(true),
    }),
  );
  drehen.firstChild.classList.add("zs-spiegel");
  const zuruecksetzen = knopf("Ausschnitt zurücksetzen", {
    klein: true,
    art: "still",
    onclick: () => {
      setzeRect(groesstesRechteck(bild, verh));
      ansagen(`Ausschnitt zurückgesetzt, ${masseText()}`);
    },
  });

  // Vorschau des Ergebnisses
  const vorschauLeinwand = el("canvas", {
    class: rund ? "zs-vorschaubild zs-rund" : "zs-vorschaubild",
    role: "img",
    "aria-label": "Vorschau des Ergebnisses",
  });
  const ergebnisText = el("p", { class: "klein zs-ergebnis" });
  const vorschau = el(
    "div",
    { class: "zs-vorschau" },
    el("div", { class: "zs-vorschaufeld" }, vorschauLeinwand),
    ergebnisText,
    el(
      "p",
      { class: "hilfe" },
      "Beim Zuschneiden werden Kameradaten und der Aufnahmeort aus dem Bild entfernt.",
    ),
  );

  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
    tabindex: "-1",
  });
  const abbrechen = knopf("Abbrechen", { onclick: () => seite.close() });
  const originalKnopf = knopf("Original verwenden", {
    art: "still",
    onclick: () => bestaetige(true),
  });
  const bestaetigen = knopf(ok, {
    art: "haupt",
    onclick: () => bestaetige(false),
  });
  const originalZuGross = gelesen.pixel > maxPixel;
  if (originalZuGross) {
    originalKnopf.disabled = true;
    // Ein gesperrter Knopf zeigt keinen Hinweis beim Darüberfahren: Der Grund steht als Text daneben
    originalKnopf.setAttribute("aria-describedby", "zs-original-grund");
  }
  const originalGrund = originalZuGross
    ? el(
        "p",
        { class: "hilfe", id: "zs-original-grund" },
        "Das Original hat zu viele Pixel. Zuschneiden verkleinert es.",
      )
    : null;

  const seitenleiste = el(
    "div",
    { class: "zs-seitenleiste" },
    vorschau,
    verhGruppe,
    gruppe("Grösse", zoomBlock, masseBlock),
    el(
      "div",
      { class: "zs-paar" },
      gruppe("Verschieben", kreuz),
      gruppe("Drehen", drehen),
    ),
    zuruecksetzen,
  );
  const inhalt = el(
    "div",
    { class: "zs-inhalt" },
    el("div", { class: "zs-buehne" }, flaeche, angabe, hinweis),
    seitenleiste,
    ansage,
  );
  // Eingaben auf dieser Seite sind keine «ungespeicherten Änderungen»: Zurück und Escape schliessen ohne Rückfrage
  for (const name of ["input", "change"]) {
    inhalt.addEventListener(name, (e) => e.stopPropagation());
  }
  const { kopf } = flussKopf({
    titelId,
    titel,
    beschreibung,
    beiZurueck: () => seite.close(),
  });
  const seite = el(
    "section",
    { class: "fluss-seite fluss-breit zs-seite", "aria-labelledby": titelId },
    kopf,
    el(
      "div",
      { class: "fluss-karte zs-karte" },
      inhalt,
      fehler,
      originalGrund,
      el(
        "div",
        { class: "dialog-knoepfe" },
        originalKnopf,
        abbrechen,
        bestaetigen,
      ),
    ),
  );

  // Feste Verhältnisse zoomt man proportional, ein freies Rechteck stellt man mit Breite und Höhe ein
  const zeigeRegler = () => {
    zoomBlock.hidden = !verh;
    masseBlock.hidden = Boolean(verh);
  };

  // ----- Zustand und Zeichnen -----
  let geo = { cw: 0, ch: 0, dpr: 1, s: 1, ox: 0, oy: 0 };
  let rafId = 0;
  let groessenLauf = 0;
  let groessenTimer = 0;
  let grund = "#e6ebf1";
  const handles = () => (verh ? HANDLES_FEST : HANDLES_FREI);
  const ctx2 = canvas.getContext("2d");
  const vctx = vorschauLeinwand.getContext("2d");

  const masseText = () => {
    const m = ausgabeMasse(rect, maxSeite);
    return `${m.b} mal ${m.h} Pixel`;
  };
  const ansagen = (text) => {
    ansage.textContent = text;
  };

  function messen() {
    const cw = flaeche.clientWidth;
    if (!cw) return;
    // Die Fläche folgt dem Seitenverhältnis des Bildes, zwischen 14 rem und 62 % der Fensterhöhe (höchstens 42 rem)
    const rem =
      parseFloat(window.getComputedStyle(document.documentElement).fontSize) ||
      16;
    const hoechst = Math.min(window.innerHeight * 0.62, 42 * rem);
    const wunsch = Math.round(
      Math.min(hoechst, Math.max(14 * rem, (cw * bild.h) / bild.b + 44)),
    );
    if (flaeche.style.height !== `${wunsch}px`)
      flaeche.style.height = `${wunsch}px`;
    const ch = flaeche.clientHeight;
    if (!ch) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    const rand = 22;
    const s = Math.min((cw - 2 * rand) / bild.b, (ch - 2 * rand) / bild.h);
    geo = {
      cw,
      ch,
      dpr,
      s,
      ox: (cw - bild.b * s) / 2,
      oy: (ch - bild.h * s) / 2,
    };
    grund = window.getComputedStyle(flaeche).backgroundColor || grund;
    // Sofort zeichnen: Das Setzen der Leinwandgrösse leert sie, bis zum nächsten Bild bliebe sie sonst leer
    zeichne();
  }

  function zeichne() {
    const { cw, ch, dpr, s, ox, oy } = geo;
    if (!cw) return;
    const c = ctx2;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = grund;
    c.fillRect(0, 0, cw, ch);
    c.imageSmoothingQuality = "high";
    c.drawImage(arbeit, ox, oy, bild.b * s, bild.h * s);
    const sx = ox + rect.x * s;
    const sy = oy + rect.y * s;
    const sw = rect.w * s;
    const sh = rect.h * s;
    // Ausserhalb des Ausschnitts abdunkeln
    c.beginPath();
    c.rect(ox, oy, bild.b * s, bild.h * s);
    if (rund) {
      c.moveTo(sx + sw, sy + sh / 2);
      c.arc(sx + sw / 2, sy + sh / 2, sw / 2, 0, Math.PI * 2);
    } else {
      c.rect(sx, sy, sw, sh);
    }
    c.fillStyle = "rgba(0, 0, 0, 0.55)";
    c.fill("evenodd");
    // Rahmen: hell mit dunklem Saum, damit er auf jedem Bild zu sehen ist
    const umriss = () => {
      c.beginPath();
      if (rund) c.arc(sx + sw / 2, sy + sh / 2, sw / 2, 0, Math.PI * 2);
      else c.rect(sx, sy, sw, sh);
    };
    c.lineWidth = 3.5;
    c.strokeStyle = "rgba(0, 0, 0, 0.55)";
    umriss();
    c.stroke();
    c.lineWidth = 1.5;
    c.strokeStyle = "#ffffff";
    umriss();
    c.stroke();
    if (rund) {
      c.setLineDash([4, 4]);
      c.strokeStyle = "rgba(255, 255, 255, 0.6)";
      c.strokeRect(sx, sy, sw, sh);
      c.setLineDash([]);
    } else {
      // Drittel-Linien
      c.lineWidth = 1;
      c.strokeStyle = "rgba(255, 255, 255, 0.4)";
      c.beginPath();
      for (const t of [1 / 3, 2 / 3]) {
        c.moveTo(sx + sw * t, sy);
        c.lineTo(sx + sw * t, sy + sh);
        c.moveTo(sx, sy + sh * t);
        c.lineTo(sx + sw, sy + sh * t);
      }
      c.stroke();
    }
    // Griffe
    for (const h of handles()) {
      const p = griffPunkt(h, sx, sy, sw, sh);
      c.fillStyle = "#ffffff";
      c.strokeStyle = "#1a1a1a";
      c.lineWidth = 1.5;
      c.beginPath();
      c.rect(p.x - 6, p.y - 6, 12, 12);
      c.fill();
      c.stroke();
    }
    zeichneVorschau();
  }

  const griffPunkt = (h, sx, sy, sw, sh) => ({
    x: h.includes("w") ? sx : h.includes("e") ? sx + sw : sx + sw / 2,
    y: h.includes("n") ? sy : h.includes("s") ? sy + sh : sy + sh / 2,
  });

  function zeichneVorschau() {
    const m = ausgabeMasse(rect, maxSeite);
    const box = rund ? 136 : 256;
    const f = Math.min(box / m.b, (rund ? box : 176) / m.h);
    const vw = Math.max(1, Math.round(m.b * f));
    const vh = Math.max(1, Math.round(m.h * f));
    const dpr = geo.dpr || 1;
    vorschauLeinwand.width = Math.round(vw * dpr);
    vorschauLeinwand.height = Math.round(vh * dpr);
    vorschauLeinwand.style.width = `${vw}px`;
    vorschauLeinwand.style.height = `${vh}px`;
    vctx.imageSmoothingQuality = "high";
    vctx.drawImage(
      arbeit,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      0,
      0,
      vorschauLeinwand.width,
      vorschauLeinwand.height,
    );
  }

  function plane() {
    if (rafId) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      zeichne();
    });
  }

  // Nach jeder Änderung des Ausschnitts: Regler, Angaben und die Berechnung der Dateigrösse
  function setzeRect(neu) {
    rect = neu;
    const z = zoomStufe(rect, bild, verh);
    zoomRegler.eingabe.value = String(zoomZuRegler(z));
    zoomRegler.wert.textContent = `${Math.round(z * 100)} %`;
    zoomRegler.eingabe.setAttribute(
      "aria-valuetext",
      `${Math.round(z * 100)} Prozent`,
    );
    const bp = Math.round((rect.w / bild.b) * 100);
    const hp = Math.round((rect.h / bild.h) * 100);
    breiteRegler.eingabe.value = String(bp);
    breiteRegler.wert.textContent = `${bp} %`;
    breiteRegler.eingabe.setAttribute(
      "aria-valuetext",
      `${bp} Prozent des Bildes`,
    );
    hoeheRegler.eingabe.value = String(hp);
    hoeheRegler.wert.textContent = `${hp} %`;
    hoeheRegler.eingabe.setAttribute(
      "aria-valuetext",
      `${hp} Prozent des Bildes`,
    );
    angabe.textContent = `Ausschnitt: ${Math.round(rect.w)} mal ${Math.round(rect.h)} Pixel von ${bild.b} mal ${bild.h}.`;
    const m = ausgabeMasse(rect, maxSeite);
    ergebnisText.textContent = `Ergebnis: ${m.b} mal ${m.h} Pixel · Dateigrösse wird berechnet …`;
    window.clearTimeout(groessenTimer);
    const lauf = ++groessenLauf;
    groessenTimer = window.setTimeout(async () => {
      try {
        const { blob } = await erzeuge();
        if (lauf === groessenLauf && seite.open) {
          ergebnisText.textContent = `Ergebnis: ${m.b} mal ${m.h} Pixel · ${groesseText(blob.size)}`;
        }
      } catch {
        if (lauf === groessenLauf) {
          ergebnisText.textContent = `Ergebnis: ${m.b} mal ${m.h} Pixel`;
        }
      }
    }, 350);
    plane();
  }

  // Das Ergebnis: Ausschnitt auf die Zielgrösse, als JPEG oder (bei Durchsichtigem) PNG
  async function erzeuge() {
    const m = ausgabeMasse(rect, maxSeite);
    const aus = leinwand(m.b, m.h);
    const c = aus.getContext("2d");
    c.imageSmoothingQuality = "high";
    c.drawImage(
      arbeit,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      0,
      0,
      aus.width,
      aus.height,
    );
    const durchsichtig = mitAlpha && hatTransparenz(aus);
    const typ = durchsichtig ? "image/png" : "image/jpeg";
    const quelle =
      durchsichtig || datei.type === "image/jpeg" ? aus : flach(aus);
    return { blob: await kodiere(quelle, typ, maxBytes), typ };
  }

  // ----- Bedienung -----
  const zoomUm = (faktor, ansagt, anker) => {
    setzeRect(skaliere(rect, faktor, bild, anker));
    if (ansagt) ansagen(`Ausschnitt ${masseText()}`);
  };
  function bewege(rx, ry, gross, ansagt) {
    const schritt = Math.max(
      1,
      Math.round(Math.min(bild.b, bild.h) * (gross ? 0.1 : 0.02)),
    );
    setzeRect(verschiebe(rect, rx * schritt, ry * schritt, bild));
    if (ansagt) {
      ansagen(
        `Ausschnitt bei ${Math.round(rect.x)} und ${Math.round(rect.y)}, ${masseText()}`,
      );
    }
  }

  function drehe(rechts) {
    const alt = bild;
    arbeit = dreheLeinwand(arbeit, rechts);
    bild = { b: arbeit.width, h: arbeit.height };
    rect = passeAn(dreheRechteck(rect, alt, rechts), verh, bild);
    messen();
    setzeRect(rect);
    ansagen(`Bild nach ${rechts ? "rechts" : "links"} gedreht`);
  }

  flaeche.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const gross = e.shiftKey;
    const pfeil = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[e.key];
    if (pfeil) {
      e.preventDefault();
      bewege(pfeil[0], pfeil[1], gross, true);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomUm(0.85, true);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomUm(1 / 0.85, true);
    }
  });

  // Zeiger: Ein Finger oder die Maus verschiebt oder zieht an einem Griff, zwei Finger zoomen
  const zeiger = new Map();
  let aktion = null;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const bildPunkt = (p) => ({
    x: (p.x - geo.ox) / geo.s,
    y: (p.y - geo.oy) / geo.s,
  });
  function treffer(p) {
    const { s, ox, oy } = geo;
    const sx = ox + rect.x * s;
    const sy = oy + rect.y * s;
    const sw = rect.w * s;
    const sh = rect.h * s;
    const radius = Math.min(24, Math.max(10, Math.min(sw, sh) * 0.3));
    let best = null;
    let bestAbstand = radius;
    for (const h of handles()) {
      const g = griffPunkt(h, sx, sy, sw, sh);
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      if (d <= bestAbstand) {
        best = h;
        bestAbstand = d;
      }
    }
    if (best) return { art: "griff", griff: best };
    if (p.x >= sx && p.x <= sx + sw && p.y >= sy && p.y <= sy + sh) {
      return { art: "bewegen" };
    }
    return null;
  }
  const setzeCursor = (t) => {
    canvas.dataset.zeiger = !t
      ? ""
      : t.art === "bewegen"
        ? "bewegen"
        : CURSOR[t.griff];
  };
  const abstand = () => {
    const [a, b] = [...zeiger.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  const mitte = () => {
    const [a, b] = [...zeiger.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const ankerIn = (p) => {
    const b = bildPunkt(p);
    return { x: (b.x - rect.x) / rect.w, y: (b.y - rect.y) / rect.h };
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    const p = pos(e);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Zeiger schon weg: weiter ohne Erfassung
    }
    zeiger.set(e.pointerId, p);
    if (zeiger.size === 2) {
      aktion = {
        art: "pinch",
        d0: abstand(),
        rect0: rect,
        anker: ankerIn(mitte()),
      };
    } else if (zeiger.size === 1) {
      const t = treffer(p);
      aktion = t ? { ...t, p0: p, rect0: rect } : null;
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pos(e);
    if (!zeiger.has(e.pointerId)) {
      if (e.pointerType === "mouse") setzeCursor(treffer(p));
      return;
    }
    zeiger.set(e.pointerId, p);
    if (!aktion) return;
    if (aktion.art === "pinch" && zeiger.size === 2) {
      rect = aktion.rect0;
      setzeRect(
        skaliere(aktion.rect0, aktion.d0 / abstand(), bild, aktion.anker),
      );
      return;
    }
    if (zeiger.size !== 1) return;
    const dx = (p.x - aktion.p0.x) / geo.s;
    const dy = (p.y - aktion.p0.y) / geo.s;
    if (aktion.art === "bewegen") {
      setzeRect(verschiebe(aktion.rect0, dx, dy, bild));
    } else if (aktion.art === "griff") {
      setzeRect(
        aendereMitGriff(aktion.rect0, aktion.griff, dx, dy, bild, verh),
      );
    }
  });
  const loslassen = (e) => {
    zeiger.delete(e.pointerId);
    // Bleibt ein Finger nach dem Zoomen liegen, beginnt keine neue Bewegung mit ihm
    aktion = null;
  };
  canvas.addEventListener("pointerup", loslassen);
  canvas.addEventListener("pointercancel", loslassen);
  canvas.addEventListener("pointerleave", (e) => {
    if (!zeiger.size && e.pointerType === "mouse") setzeCursor(null);
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const f = Math.exp(clamp(e.deltaY, -120, 120) * 0.002);
      zoomUm(f, false, ankerIn(pos(e)));
    },
    { passive: false },
  );

  // Seitenverhältnis wechseln
  for (const [eingabe] of verhEintraege) {
    eingabe.addEventListener("change", () => {
      if (!eingabe.checked) return;
      verh = verhaeltnisse[Number(eingabe.value)].wert;
      zeigeRegler();
      setzeRect(passeAn(rect, verh, bild));
      ansagen(
        `Seitenverhältnis ${verhaeltnisse[Number(eingabe.value)].text}, ${masseText()}`,
      );
    });
  }

  // ----- Abschluss -----
  const zeigeFehler = (text) => {
    fehler.textContent = text;
    fehler.hidden = false;
    fehler.focus();
  };
  const sperre = (an) => {
    for (const k of [abbrechen, originalKnopf, bestaetigen]) {
      k.disabled = an || (k === originalKnopf && originalZuGross);
    }
    bestaetigen.toggleAttribute("aria-busy", an);
    flaeche.toggleAttribute("inert", an);
    seitenleiste.toggleAttribute("inert", an);
  };
  let wert = null;
  let laeuft = false;
  async function bestaetige(original) {
    if (laeuft) return;
    laeuft = true;
    fehler.hidden = true;
    sperre(true);
    try {
      let ergebnis;
      if (original) {
        ergebnis = { datei, zugeschnitten: false };
      } else {
        const { blob, typ } = await erzeuge();
        ergebnis = {
          datei: new window.File([blob], dateiname(datei.name, typ), {
            type: typ,
          }),
          zugeschnitten: true,
        };
      }
      if (senden) ergebnis.antwort = await senden(ergebnis.datei);
      wert = ergebnis;
      seite.close();
    } catch (f) {
      zeigeFehler(f instanceof Error && !f.status ? f.message : fehlertext(f));
    } finally {
      laeuft = false;
      if (seite.open) sperre(false);
    }
  }

  return new Promise((aufloesen) => {
    const beobachter = new window.ResizeObserver(() => messen());
    seite.addEventListener("close", () => {
      window.clearTimeout(groessenTimer);
      window.cancelAnimationFrame(rafId);
      beobachter.disconnect();
      if (zurueck?.isConnected && zurueck !== document.body) {
        zurueck.focus({ preventScroll: true });
      }
      // Speicher freigeben (Leinwände mit mehreren Millionen Pixeln)
      arbeit.width = arbeit.height = 0;
      aufloesen(wert);
    });
    oeffneFluss(seite);
    beobachter.observe(flaeche);
    messen();
    zeigeRegler();
    setzeRect(rect);
    flaeche.focus({ preventScroll: true });
  });
}

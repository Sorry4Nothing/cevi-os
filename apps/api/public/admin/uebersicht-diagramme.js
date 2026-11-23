// Diagramme der Übersicht (#583): kleine Grafiken als Inline-SVG, ohne Bibliothek. Farben nur über Klassen (uebersicht.css, aus den Tokens, Tag und Nacht), nie als Wert im Code; die CSP erlaubt keine style-Attribute, darum stehen Masse als SVG-Attribute.
// Jede Grafik hat eine Entsprechung als Tabelle (Schalter «Tabellen statt Diagramme»), einen Satz mit allen Werten für Screenreader und eine Ablesung: Zeiger oder Pfeiltasten wählen einen Punkt, der Text darunter nennt Zeitraum und Wert.
// Vorlage für das Ablesen mit Pfeiltasten ist der Streifen «Status» (Kokonut UI Pro, status-footer); gezeichnet ist alles selbst.
import { el } from "./dom.js";

const NS = "http://www.w3.org/2000/svg";

export function svg(tag, attribute = {}, ...kinder) {
  const knoten = document.createElementNS(NS, tag);
  for (const [name, wert] of Object.entries(attribute)) {
    if (wert !== undefined && wert !== null && wert !== false) {
      knoten.setAttribute(name, String(wert));
    }
  }
  knoten.append(...kinder.flat().filter(Boolean));
  return knoten;
}

const zahl = new Intl.NumberFormat("de-CH");
export const fmt = (n) => zahl.format(n).replace(/’/g, "'");
// «+3», «−2» (echtes Minus), «±0»
export const vorzeichen = (n) =>
  n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : "±0";

// Säule mit gerundetem Kopf, am Boden gerade (der Wert endet oben, die Basis bleibt eckig)
function saeule(x, y, b, h, r = 3) {
  const rr = Math.min(r, b / 2, h);
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}h${b - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}V${y + h}z`;
}

// Eine ablesbare Grafik: Zeiger und Pfeiltasten wählen einen Punkt. marken[i] bekommt «ist-aktiv»; texte[i] steht unter der Grafik (aria-live)
export function ablesbar({ grafik, marken, texte, beschriftung, ruhe }) {
  const lese = el("p", { class: "ub-lese klein leise", "aria-live": "polite" });
  const ruheText = ruhe ?? "";
  lese.textContent = ruheText;
  const rahmen = el(
    "div",
    {
      class: "ub-grafik",
      role: "img",
      "aria-label": beschriftung,
      tabindex: "0",
    },
    grafik,
  );
  let aktiv = -1;
  const setze = (i) => {
    if (i === aktiv) return;
    aktiv = i;
    marken.forEach((gruppe, k) => {
      for (const m of [gruppe].flat()) m.classList.toggle("ist-aktiv", k === i);
    });
    lese.textContent = i < 0 ? ruheText : texte[i];
  };
  rahmen.addEventListener("pointermove", (e) => {
    const r = grafik.getBoundingClientRect();
    if (r.width === 0) return;
    const rel = (e.clientX - r.left) / r.width;
    setze(
      Math.min(marken.length - 1, Math.max(0, Math.floor(rel * marken.length))),
    );
  });
  rahmen.addEventListener("pointerleave", () => setze(-1));
  rahmen.addEventListener("blur", () => setze(-1));
  rahmen.addEventListener("keydown", (e) => {
    const letzte = marken.length - 1;
    const von = aktiv < 0 ? letzte + 1 : aktiv;
    const ziel = {
      ArrowLeft: von - 1,
      ArrowRight: von + 1,
      Home: 0,
      End: letzte,
    }[e.key];
    if (ziel === undefined) return;
    e.preventDefault();
    setze(Math.min(letzte, Math.max(0, ziel)));
  });
  return el("div", { class: "ub-ablesen" }, rahmen, lese);
}

// Alle Werte in einem Satz, damit ein Screenreader das Diagramm vollständig bekommt
const alsSatz = (titel, punkte) =>
  `${titel}: ${punkte.map((p) => `${p.name} ${p.text}`).join("; ")}.`;

// Tabelle als Entsprechung: caption, Kopf mit scope, Zahlen rechts
export function wertetabelle({ beschriftung, spalten, zeilen }) {
  return el(
    "div",
    { class: "ub-tabelle" },
    el(
      "table",
      { class: "ub-tabelle-t" },
      el("caption", { class: "klein leise" }, beschriftung),
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          spalten.map((s, i) =>
            el("th", { scope: "col", class: i > 0 ? "zahl" : undefined }, s),
          ),
        ),
      ),
      el(
        "tbody",
        {},
        zeilen.map((z) =>
          el(
            "tr",
            {},
            z.map((c, i) =>
              i === 0
                ? el("th", { scope: "row" }, c)
                : el("td", { class: "zahl" }, c),
            ),
          ),
        ),
      ),
    ),
  );
}

// Verlauf eines Bestands (Personen): Linie in der Randfarbe, das letzte Stück und der letzte Punkt im Akzent. punkte: [{ name, wert, text }], älteste zuerst
export function verlaufLinie({ punkte, titel, einheit }) {
  const B = 240;
  const H = 56;
  const rand = 6;
  const werte = punkte.map((p) => p.wert);
  const min = Math.min(...werte);
  const max = Math.max(...werte);
  const x = (i) => rand + (i * (B - 2 * rand)) / Math.max(1, punkte.length - 1);
  // Gleichbleibend: die Linie liegt in der Mitte; sonst füllt der Verlauf die Höhe
  const y = (w) =>
    max === min ? H / 2 : H - rand - ((w - min) / (max - min)) * (H - 2 * rand);
  const pfad = punkte.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.wert)}`);
  const letzte = punkte.length - 1;
  const marken = punkte.map((p, i) =>
    svg("circle", { class: "ub-punkt", cx: x(i), cy: y(p.wert), r: 4 }),
  );
  const grafik = svg(
    "svg",
    { viewBox: `0 0 ${B} ${H}`, "aria-hidden": "true", focusable: "false" },
    svg("line", {
      class: "ub-achse",
      x1: rand,
      x2: B - rand,
      y1: H - 1,
      y2: H - 1,
    }),
    svg("path", { class: "ub-linie", d: pfad.join("") }),
    letzte > 0 &&
      svg("path", {
        class: "ub-linie ub-linie--jetzt",
        d: `M${x(letzte - 1)},${y(punkte[letzte - 1].wert)}L${x(letzte)},${y(punkte[letzte].wert)}`,
      }),
    ...marken,
  );
  marken[letzte]?.classList.add("ist-jetzt");
  const gesamt = alsSatz(
    `${titel}, ${punkte.length} Zeitpunkte`,
    punkte.map((p) => ({ name: p.name, text: `${fmt(p.wert)} ${einheit}` })),
  );
  return ablesbar({
    grafik,
    marken,
    texte: punkte.map((p) => `${p.name}: ${fmt(p.wert)} ${einheit}`),
    beschriftung: gesamt,
  });
}

// Säulen mit Basis bei 0 (Zähler je Zeitraum). punkte: [{ name, wert, fehler?, text }]; mit «fehler» steht der Fehleranteil als zweiter Teil über dem Rest (zwei Teile, 2 px Luft)
export function saeulen({
  punkte,
  titel,
  einheit,
  hoehe = 56,
  fehlerName,
  weit = false,
}) {
  const n = punkte.length;
  const B = weit ? 480 : n > 12 ? 288 : 240;
  const H = hoehe;
  const oben = 4;
  const schritt = B / n;
  const breite = Math.max(4, Math.min(weit ? 32 : 14, schritt - 6));
  const max = Math.max(1, ...punkte.map((p) => p.wert));
  const hoeheVon = (w) => (w / max) * (H - oben - 1);
  const boden = H - 1;
  const marken = punkte.map((p, i) => {
    const x0 = i * schritt + (schritt - breite) / 2;
    const gesamtH = hoeheVon(p.wert);
    const fehlerH = p.fehler > 0 ? Math.max(2, hoeheVon(p.fehler)) : 0;
    // Zwei Teile übereinander lassen 2 px Luft, damit sie nicht verschmelzen
    const luft = fehlerH > 0 && gesamtH > fehlerH ? 2 : 0;
    const okH = Math.max(0, gesamtH - fehlerH - luft);
    const teile = [];
    if (okH > 0) {
      teile.push(
        svg("path", {
          class: "ub-saeule" + (i === n - 1 ? " ist-jetzt" : ""),
          d: saeule(x0, boden - okH, breite, okH, fehlerH > 0 ? 0 : 3),
        }),
      );
    }
    if (fehlerH > 0) {
      teile.push(
        svg("path", {
          class: "ub-saeule ub-saeule--fehler",
          d: saeule(x0, boden - okH - luft - fehlerH, breite, fehlerH, 2),
        }),
      );
    }
    // Fläche für das Hervorheben, auch bei Wert 0
    const traeger = svg("rect", {
      class: "ub-traeger",
      x: i * schritt,
      y: 0,
      width: schritt,
      height: H,
    });
    return svg("g", { class: "ub-marke" }, traeger, ...teile);
  });
  const grafik = svg(
    "svg",
    { viewBox: `0 0 ${B} ${H}`, "aria-hidden": "true", focusable: "false" },
    ...marken,
    svg("line", { class: "ub-achse", x1: 0, x2: B, y1: H - 0.5, y2: H - 0.5 }),
  );
  const nameMitFehler = (p) =>
    p.fehler !== undefined
      ? `${p.name}: ${fmt(p.wert)} ${einheit}, davon ${fmt(p.fehler)} ${fehlerName}`
      : `${p.name}: ${fmt(p.wert)} ${einheit}`;
  return ablesbar({
    grafik,
    marken,
    texte: punkte.map(nameMitFehler),
    beschriftung: alsSatz(
      `${titel}, ${n} Zeiträume`,
      punkte.map((p) => ({
        name: p.name,
        text:
          p.fehler !== undefined
            ? `${fmt(p.wert)}, davon ${fmt(p.fehler)} ${fehlerName}`
            : fmt(p.wert),
      })),
    ),
  });
}

// Rangliste mit Balken (Kinder je Stufe): ein Name, ein Balken auf gemeinsamer Basis, die Zahl. Als Liste, damit die Zahl für Screenreader beim Namen steht
export function rangBalken({ zeilen, einheit }) {
  const max = Math.max(1, ...zeilen.map((z) => z.wert));
  return el(
    "ul",
    { class: "ub-rang" },
    zeilen.map((z) =>
      el(
        "li",
        {},
        el("span", { class: "ub-rang-name" }, z.name),
        svg(
          "svg",
          {
            class: "ub-rang-balken",
            viewBox: "0 0 100 10",
            preserveAspectRatio: "none",
            "aria-hidden": "true",
            focusable: "false",
          },
          svg("rect", {
            class: "ub-rang-spur",
            x: 0,
            y: 0,
            width: 100,
            height: 10,
          }),
          z.wert > 0 &&
            svg("rect", {
              class: "ub-rang-wert",
              x: 0,
              y: 0,
              width: Math.max(2, (z.wert / max) * 100),
              height: 10,
            }),
        ),
        el(
          "span",
          { class: "ub-rang-zahl" },
          fmt(z.wert),
          el("span", { class: "nur-leser" }, ` ${einheit}`),
        ),
      ),
    ),
  );
}

// Ein Pfeil nach rechts für Verweise; Zierde
export function pfeil() {
  return svg(
    "svg",
    {
      class: "ub-pfeil",
      viewBox: "0 0 24 24",
      "aria-hidden": "true",
      focusable: "false",
    },
    svg("path", { d: "M5 12h14M13 6l6 6-6 6" }),
  );
}

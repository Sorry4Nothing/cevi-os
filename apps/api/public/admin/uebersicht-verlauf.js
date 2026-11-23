// Hauptdiagramm der Übersicht (#620): ein grosser Verlauf über die Zeit statt einer Kachelreihe. Oben der Umschalter für das Mass (Anmeldungen, Konten, Bestellungen) und für den Zeitraum (8 Wochen, 6 Monate, 1 Jahr), darunter die Zahl der gewählten Woche mit Veränderung, die Linie mit Achsen, Anmeldefristen als Marken und eine Zeile mit drei abgeleiteten Werten.
// Ablesen: Zeiger, Finger oder Pfeiltasten schieben ein Fadenkreuz; Zahl, Veränderung und Werte folgen ihm, die Linie dahinter wird grau, und eine Marke am Fadenkreuz nennt die Anmeldefrist. Der Schieber (role="slider") trägt Wert und Wochentext für Screenreader; ein Satz fasst das Diagramm zusammen.
// Vorlage für Aufbau und Verhalten (angesehen und nachgezeichnet, kein Quelltext übernommen): Kokonut UI Pro «dashboard-feature» (Umschalter für Mass und Zeitraum, Fadenkreuz mit Zahl, Ereignisse am Rand, Zeile mit Werten) und «chart-hero» (Achsen, Linie zeichnet sich ein). Daten: nur die Wochenzahlen der Übersichtsroute (52 Wochen) und die Anmeldefristen der Anlässe, nichts Erfundenes.
// Zeichnen: Inline-SVG in Pixelmassen (ResizeObserver), Farben nur über Klassen; die CSP erlaubt keine style-Attribute. Die Linie zeichnet sich per CSS ein, nur mit prefers-reduced-motion: no-preference.
import { el, filterGruppe, neueId } from "./dom.js";
import {
  deltaMarke,
  fmt,
  svg,
  weichePfad,
  zahlAnzeige,
} from "./uebersicht-diagramme.js";

const ZONE = "Europe/Zurich";
const de = (optionen) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: ZONE, ...optionen });
const fKurz = de({ day: "numeric", month: "short" });
const fLang = de({ day: "numeric", month: "long" });
const MS_WOCHE = 7 * 86_400_000;

// «summe»: Zähler je Woche; «bestand»: Stand am Ende der Woche
const REIHEN = [
  {
    schluessel: "anmeldungen",
    name: "Anmeldungen",
    art: "summe",
    einheit: ["Anmeldung", "Anmeldungen"],
  },
  {
    schluessel: "personen",
    name: "Konten",
    art: "bestand",
    einheit: ["Konto", "Konten"],
  },
  {
    schluessel: "bestellungen",
    name: "Bestellungen",
    art: "summe",
    einheit: ["Bestellung", "Bestellungen"],
  },
];
const ZEITRAEUME = [
  { wert: 8, text: "8 Wochen" },
  { wert: 26, text: "6 Monate" },
  { wert: 52, text: "1 Jahr" },
];

const einheitVon = (reihe, n) => reihe.einheit[n === 1 ? 0 : 1];

// Gerade Achsenwerte: Schritt 1, 2 oder 5 mal Zehnerpotenz, höchstens vier Bänder
export function achsenWerte(max) {
  const m = Math.max(1, max);
  let schritt = 1;
  for (const f of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) {
    schritt = f;
    if (m / f <= 4) break;
  }
  const oben = Math.ceil(m / schritt) * schritt;
  return Array.from({ length: oben / schritt + 1 }, (_, i) => i * schritt);
}

export function verlaufKarte(daten) {
  const k = daten.kennzahlen;
  const n = k.fenster;
  const erzeugt = new Date(daten.erzeugtAm).getTime();
  const reihen = REIHEN.filter((r) => {
    const v = k[r.schluessel]?.verlauf;
    // Bestellungen nur, wenn das Lädeli in diesem Jahr überhaupt benutzt wurde
    return v && (r.schluessel !== "bestellungen" || v.some((w) => w > 0));
  });
  if (reihen.length === 0) return null;

  const ende = (i) => new Date(erzeugt - (n - 1 - i) * MS_WOCHE);
  const kurz = (i) => (i === n - 1 ? "heute" : fKurz.format(ende(i)));
  const lang = (i) =>
    i === n - 1 ? "Letzte 7 Tage" : `7 Tage bis ${fLang.format(ende(i))}`;

  // Anmeldefristen im Jahr: Woche, Titel
  const fristen = (daten.anlaesse ?? [])
    .filter((a) => a.frist && new Date(a.frist).getTime() <= erzeugt)
    .map((a) => ({
      idx:
        n - 1 - Math.floor((erzeugt - new Date(a.frist).getTime()) / MS_WOCHE),
      titel: a.titel,
      frist: new Date(a.frist),
    }))
    .filter((f) => f.idx >= 0);

  let reihe = reihen[0];
  let zeitraum =
    ZEITRAEUME.find((z) => {
      const v = k[reihe.schluessel].verlauf;
      const erste = v.findIndex((w) => w > 0);
      return erste < 0 || erste >= n - z.wert;
    })?.wert ?? 52;
  let idx = n - 1;
  let gewaehlt = false;

  const werte = () => k[reihe.schluessel].verlauf;
  const start = () => n - zeitraum;

  // --- Kopf mit Zahl ----------------------------------------------------------------------
  const lbl = el("p", { class: "ud-lbl" });
  const gross = el("p", { class: "ud-gross" });
  const einheitEl = el("span", { class: "ud-einheit" });
  const delta = el("p", { class: "ud-delta" });
  const woche = el("p", { class: "ud-woche" });
  const wocheNote = el("p", { class: "ud-woche-note leise klein" });
  let zahl = zahlAnzeige(0);
  gross.append(zahl.wurzel, einheitEl);

  // --- Fläche mit Achsen, Linie und Schieber ----------------------------------------------
  const rasterSvg = svg("svg", {
    class: "ud-raster",
    "aria-hidden": "true",
    focusable: "false",
  });
  const linieSvg = svg("svg", {
    class: "ud-linie",
    "aria-hidden": "true",
    focusable: "false",
  });
  const beschreibung = el("p", { class: "nur-leser", id: neueId("udb") });
  const schieber = el("div", {
    class: "ud-schieber",
    role: "slider",
    tabindex: "0",
    "aria-describedby": beschreibung.id,
  });
  const flaeche = el(
    "div",
    { class: "ud-flaeche" },
    rasterSvg,
    linieSvg,
    schieber,
  );
  const note = el("p", { class: "ud-note leise klein", "aria-live": "polite" });
  const werteZeile = el("dl", { class: "ud-werte" });

  // Geometrie des letzten Zeichnens
  let g = null;

  function zeichne(animiert) {
    const B = Math.round(flaeche.clientWidth);
    if (B < 120) return;
    const schmal = B < 520;
    const H = schmal ? 200 : 280;
    flaeche.style.height = `${H}px`;
    const links = schmal ? 30 : 44;
    const rechts = 12;
    const oben = 10;
    const unten = 26;
    const pw = B - links - rechts;
    const ph = H - oben - unten;
    const v = werte();
    const von = start();
    const pts = v.slice(von);
    const ticks = achsenWerte(Math.max(...pts));
    const maxT = ticks.at(-1);
    const x = (i) => links + ((i - von) * pw) / Math.max(1, n - 1 - von);
    const y = (w) => oben + ph - (w / maxT) * ph;
    const punkte = pts.map((w, j) => [x(von + j), y(w)]);
    const linie = weichePfad(punkte);
    const boden = oben + ph;

    // Raster und Achsen
    rasterSvg.replaceChildren();
    rasterSvg.setAttribute("viewBox", `0 0 ${B} ${H}`);
    rasterSvg.setAttribute("height", H);
    for (const t of ticks) {
      rasterSvg.append(
        svg("line", {
          class: t === 0 ? "ud-boden" : "ud-gitter",
          x1: links,
          x2: B - rechts,
          y1: y(t),
          y2: y(t),
        }),
        svg(
          "text",
          { class: "ud-tick", x: links - 8, y: y(t) + 4, "text-anchor": "end" },
          fmt(t),
        ),
      );
    }
    const marken = schmal ? 3 : 5;
    for (let m = 0; m < marken; m++) {
      const i = Math.round(von + (m * (n - 1 - von)) / (marken - 1));
      rasterSvg.append(
        svg(
          "text",
          {
            class: "ud-tick",
            x: x(i),
            y: H - 6,
            "text-anchor":
              m === 0 ? "start" : m === marken - 1 ? "end" : "middle",
          },
          kurz(i),
        ),
      );
    }

    // Linie: grau ganz, im Akzent bis zum Fadenkreuz
    const cid = neueId("udc");
    const klammer = svg("rect", { x: 0, y: 0, width: x(idx), height: H });
    linieSvg.replaceChildren();
    linieSvg.setAttribute("viewBox", `0 0 ${B} ${H}`);
    linieSvg.setAttribute("height", H);
    linieSvg.classList.toggle("ud-zeichnen", Boolean(animiert));
    const sichtbareFristen =
      reihe.schluessel === "anmeldungen"
        ? fristen.filter((f) => f.idx >= von)
        : [];
    linieSvg.append(
      svg("defs", {}, svg("clipPath", { id: cid }, klammer)),
      ...sichtbareFristen.map((f) =>
        svg(
          "g",
          { class: "ud-frist", "data-idx": f.idx },
          svg("line", { x1: x(f.idx), x2: x(f.idx), y1: oben, y2: boden }),
          svg("path", {
            d: `M${x(f.idx)},${boden - 6}l5,6l-5,6l-5,-6z`,
          }),
        ),
      ),
      svg("path", { class: "ud-linie-grau", d: linie }),
      svg(
        "g",
        { "clip-path": `url(#${cid})` },
        svg("path", {
          class: "ud-flaeche-fuell",
          d: `${linie}L${x(n - 1)},${boden}L${x(von)},${boden}z`,
        }),
        svg("path", { class: "ud-linie-akzent", d: linie }),
      ),
    );
    const kreuz = svg("line", { class: "ud-kreuz", y1: oben, y2: boden });
    const punkt = svg("circle", { class: "ud-punkt", r: 5 });
    linieSvg.append(kreuz, punkt);
    g = { x, y, von, klammer, kreuz, punkt, v, B, links, pw };
    platziere();
  }

  function platziere() {
    if (!g) return;
    const px = g.x(idx);
    g.klammer.setAttribute("width", px);
    g.kreuz.setAttribute("x1", px);
    g.kreuz.setAttribute("x2", px);
    g.kreuz.classList.toggle("ist-sichtbar", gewaehlt);
    g.punkt.setAttribute("cx", px);
    g.punkt.setAttribute("cy", g.y(g.v[idx]));
    for (const f of linieSvg.querySelectorAll(".ud-frist")) {
      f.classList.toggle("ist-aktiv", Number(f.dataset.idx) === idx);
    }
  }

  // --- Zahlen und Texte, die dem Fadenkreuz folgen -----------------------------------------
  function aktualisiere(animiert = false) {
    const v = werte();
    const von = start();
    const w = v[idx];
    const vorher = idx > 0 ? v[idx - 1] : null;
    lbl.textContent =
      reihe.art === "summe"
        ? `${reihe.name} je 7 Tage`
        : `${reihe.name}, Stand`;
    zahl.setze(w, animiert);
    einheitEl.textContent = einheitVon(reihe, w);
    woche.textContent = lang(idx);
    wocheNote.textContent = gewaehlt ? "Gewählte Woche" : "Jüngste Woche";
    delta.replaceChildren();
    if (reihe.art === "summe" && vorher !== null) {
      delta.append(
        deltaMarke(w - vorher),
        el("span", {}, "gegenüber den 7 Tagen davor"),
      );
    } else if (reihe.art === "bestand" && idx > von) {
      delta.append(deltaMarke(w - v[von]), el("span", {}, `seit ${kurz(von)}`));
    }
    // Drei abgeleitete Werte
    const sicht = v.slice(von);
    const summe = sicht.reduce((s, x) => s + x, 0);
    const spitzeWert = Math.max(...sicht);
    const spitzeIdx = von + sicht.indexOf(spitzeWert);
    const zeilen =
      reihe.art === "summe"
        ? [
            ["Im Zeitraum", fmt(summe)],
            [
              "Schnitt je Woche",
              new Intl.NumberFormat("de-CH", {
                maximumFractionDigits: 1,
              }).format(summe / sicht.length),
            ],
            [
              "Beste Woche",
              spitzeWert > 0
                ? `${fmt(spitzeWert)}, ${kurz(spitzeIdx) === "heute" ? "letzte 7 Tage" : `bis ${kurz(spitzeIdx)}`}`
                : "keine",
            ],
          ]
        : [
            ["Stand zu Beginn", fmt(v[von])],
            [
              "Neu im Zeitraum",
              `${v[n - 1] - v[von] >= 0 ? "+" : "−"}${fmt(Math.abs(v[n - 1] - v[von]))}`,
            ],
            [
              "Neu in dieser Woche",
              vorher === null
                ? "–"
                : `${w - vorher >= 0 ? "+" : "−"}${fmt(Math.abs(w - vorher))}`,
            ],
          ];
    werteZeile.replaceChildren(
      ...zeilen.map(([name, wert]) =>
        el("div", {}, el("dt", {}, name), el("dd", {}, wert)),
      ),
    );
    // Satz für Screenreader und Wert des Schiebers
    const gesamt =
      reihe.art === "summe"
        ? `${reihe.name} in den letzten ${zeitraum} Wochen: insgesamt ${fmt(summe)}, höchstens ${fmt(spitzeWert)} in einer Woche, in den letzten 7 Tagen ${fmt(v[n - 1])}.`
        : `${reihe.name}: heute ${fmt(v[n - 1])}, vor ${zeitraum - 1} Wochen ${fmt(v[von])}.`;
    beschreibung.textContent = `${gesamt} Mit den Pfeiltasten wählst du eine Woche.`;
    schieber.setAttribute(
      "aria-label",
      `${reihe.name} nach Woche, ${ZEITRAEUME.find((z) => z.wert === zeitraum).text}`,
    );
    schieber.setAttribute("aria-valuemin", String(von));
    schieber.setAttribute("aria-valuemax", String(n - 1));
    schieber.setAttribute("aria-valuenow", String(idx));
    schieber.setAttribute(
      "aria-valuetext",
      `${lang(idx)}: ${fmt(w)} ${einheitVon(reihe, w)}`,
    );
    // Zeile unter der Grafik: Anmeldefrist dieser Woche oder die Bedienung
    const fr =
      reihe.schluessel === "anmeldungen"
        ? fristen.filter((f) => f.idx === idx)
        : [];
    note.textContent = fr.length
      ? fr
          .map((f) => `Anmeldefrist «${f.titel}» am ${fLang.format(f.frist)}`)
          .join("; ")
      : sicht.every((x) => x === 0)
        ? `In diesem Zeitraum gibt es keine ${reihe.einheit[1]}.`
        : fristen.length && reihe.schluessel === "anmeldungen"
          ? "Rauten markieren Anmeldefristen. Fahre über das Diagramm oder wähle mit den Pfeiltasten eine Woche."
          : "Fahre über das Diagramm oder wähle mit den Pfeiltasten eine Woche.";
    platziere();
  }

  function setzeIdx(neu) {
    idx = Math.min(n - 1, Math.max(start(), neu));
    gewaehlt = true;
    aktualisiere();
  }

  // --- Bedienung ---------------------------------------------------------------------------
  const ausPunkt = (e) => {
    if (!g) return idx;
    const r = schieber.getBoundingClientRect();
    const px = e.clientX - r.left;
    return start() + Math.round(((px - g.links) / g.pw) * (n - 1 - start()));
  };
  schieber.addEventListener("pointerdown", (e) => {
    schieber.setPointerCapture?.(e.pointerId);
    setzeIdx(ausPunkt(e));
  });
  schieber.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" || e.buttons) setzeIdx(ausPunkt(e));
  });
  const zurueck = () => {
    gewaehlt = false;
    idx = n - 1;
    aktualisiere();
  };
  schieber.addEventListener("pointerleave", (e) => {
    if (!e.buttons) zurueck();
  });
  schieber.addEventListener("pointercancel", zurueck);
  schieber.addEventListener("blur", zurueck);
  schieber.addEventListener("keydown", (e) => {
    const ziel = {
      ArrowLeft: idx - 1,
      ArrowDown: idx - 1,
      ArrowRight: idx + 1,
      ArrowUp: idx + 1,
      PageDown: idx - 4,
      PageUp: idx + 4,
      Home: start(),
      End: n - 1,
    }[e.key];
    if (ziel === undefined) return;
    e.preventDefault();
    setzeIdx(ziel);
  });

  // --- Umschalter --------------------------------------------------------------------------
  const masse = filterGruppe({
    beschriftung: "Mass",
    eintraege: reihen.map((r) => ({ text: r.name, wert: r.schluessel })),
    wert: reihe.schluessel,
    beiAenderung: (w) => {
      reihe = reihen.find((r) => r.schluessel === w);
      aktualisiere(true);
      zeichne(true);
    },
  });
  const zeitraeume = filterGruppe({
    beschriftung: "Zeitraum",
    eintraege: ZEITRAEUME.map((z) => ({ text: z.text, wert: z.wert })),
    wert: zeitraum,
    beiAenderung: (w) => {
      zeitraum = w;
      idx = n - 1;
      gewaehlt = false;
      aktualisiere(true);
      zeichne(true);
    },
  });
  masse.wurzel.classList.add("ud-umschalter");
  zeitraeume.wurzel.classList.add("ud-umschalter");

  const titelId = neueId("udt");
  const wurzel = el(
    "section",
    { class: "ud-karte ud-verlauf", "aria-labelledby": titelId },
    el(
      "div",
      { class: "ud-kopf" },
      el("h2", { id: titelId, class: "ud-titel" }, "Verlauf"),
      el(
        "div",
        { class: "ud-umschalter-zeile" },
        masse.wurzel,
        zeitraeume.wurzel,
      ),
    ),
    el(
      "div",
      { class: "ud-zahlzeile" },
      el("div", { class: "ud-zahlblock" }, lbl, gross, delta),
      el("div", { class: "ud-datum" }, woche, wocheNote),
    ),
    flaeche,
    beschreibung,
    el("div", { class: "ud-fuss" }, note, werteZeile),
  );

  aktualisiere(true);
  // Gezeichnet wird, sobald die Breite feststeht, und bei jeder Änderung der Breite
  const beobachter = new window.ResizeObserver(() => {
    // Nur eine neue Breite zeichnet neu (die Höhe setzt das Zeichnen selbst)
    if (g && Math.round(flaeche.clientWidth) === g.B) return;
    zeichne(!g);
  });
  beobachter.observe(flaeche);
  return wurzel;
}

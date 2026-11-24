// Bewegung und Ladezustände im Lager-Arbeitsbereich (#685): Sie gilt für Aufgaben, Zeitplan, To-dos und die Module «Menschen und Einteilung».
// Alle Bewegung läuft nur, wenn der Browser sie erlaubt (prefers-reduced-motion: no-preference); sonst steht alles sofort da. Die Animationen sind Web Animations (kein Inline-Stil, kein Inline-Skript, die CSP bleibt streng); die ruhigen Übergänge (Antippen, Balken) stehen in lager-anim.css.
import { el } from "./dom.js";
import { SKELETONS, sk } from "./lader.js";
import { nochmals, zustandsDaten, zustandsKarte } from "./zustaende.js";

const KURVE = "cubic-bezier(0.2, 0.7, 0.2, 1)";

export const darfBewegen = () =>
  window.matchMedia?.("(prefers-reduced-motion: no-preference)").matches ===
  true;

// Eine Animation, die den Zustand danach nicht festhält (der Knoten bleibt, wie er ist); ohne Bewegung passiert nichts
function spiele(knoten, schritte, dauer = 280, verzug = 0) {
  if (!darfBewegen() || !knoten?.animate) return null;
  return knoten.animate(schritte, {
    duration: dauer,
    delay: verzug,
    easing: KURVE,
    fill: "backwards",
  });
}

// Karte oder Zeile erscheint: blendet ein und steigt kurz auf
export const blendeEin = (knoten, verzug = 0) =>
  spiele(
    knoten,
    [
      { opacity: 0, transform: "translateY(8px)" },
      { opacity: 1, transform: "none" },
    ],
    280,
    verzug,
  );

// Die ersten Kinder erscheinen gestaffelt (höchstens 10 Stufen, damit lange Listen nicht warten lassen)
export function staffle(knoten, { stufe = 30, max = 10 } = {}) {
  [...knoten].slice(0, max + 8).forEach((k, i) => {
    blendeEin(k, Math.min(i, max) * stufe);
  });
}

// Kurzer Puls als Rückmeldung (Antippen, Speichern): die Zeile oder Zelle hebt sich für einen Moment ab
export const puls = (knoten, verzug = 0) =>
  spiele(
    knoten,
    [
      { transform: "scale(0.94)" },
      { transform: "scale(1.04)", offset: 0.55 },
      { transform: "none" },
    ],
    260,
    verzug,
  );

// Zeile oder Karte wurde gespeichert: der Hintergrund blitzt kurz in der Akzentfarbe auf
export const blitze = (knoten) =>
  spiele(
    knoten,
    [
      { backgroundColor: "color-mix(in srgb, var(--akzent) 22%, transparent)" },
      {},
    ],
    700,
  );

// Zahl zählt von der alten zur neuen hoch; ohne Bewegung steht sofort der Endwert da. Der Knoten ist aria-hidden, der Endwert steht im Text daneben (nicht jeder Schritt wird vorgelesen).
export function zaehleBis(knoten, ende, format = String, vonWert) {
  const von = vonWert ?? knoten._lgWert ?? 0;
  knoten._lgWert = ende;
  if (!darfBewegen() || von === ende) {
    knoten.textContent = format(ende);
    return;
  }
  const start = window.performance.now();
  const dauer = 420;
  const schritt = (jetzt) => {
    if (knoten._lgWert !== ende) return;
    const t = Math.min(1, (jetzt - start) / dauer);
    const weich = 1 - (1 - t) ** 3;
    knoten.textContent = format(Math.round(von + (ende - von) * weich));
    if (t < 1) window.requestAnimationFrame(schritt);
  };
  window.requestAnimationFrame(schritt);
}

// Eine Zahl für den Bildschirm: sichtbar zählend (aria-hidden), für Screenreader sofort der Endwert
export function zaehlZahl(wert, format = String, vonWert) {
  const sichtbar = el("span", { "aria-hidden": "true", class: "lg-zahl" });
  const leser = el("span", { class: "nur-leser" }, format(wert));
  const huelle = el("span", { class: "lg-zahl-huelle" }, sichtbar, leser);
  zaehleBis(sichtbar, wert, format, vonWert);
  huelle.setze = (neu) => {
    zaehleBis(sichtbar, neu, format);
    leser.textContent = format(neu);
  };
  return huelle;
}

// <progress> oder Balken: wächst vom alten zum neuen Wert. Das neue Element beginnt beim alten Wert und wechselt im nächsten Bild.
export function wachseBis(balken, vorher, jetzt) {
  if (!darfBewegen() || vorher === undefined || vorher === jetzt) {
    balken.value = jetzt;
    return;
  }
  balken.value = vorher;
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      balken.value = jetzt;
    }),
  );
}

// Auf- und Zuklappen eines Bereichs: Höhe und Deckkraft; danach steht er ohne Übergangsreste da
export function klappe(knoten, offen) {
  if (!darfBewegen() || !knoten.animate) {
    knoten.hidden = !offen;
    return Promise.resolve();
  }
  if (offen) {
    knoten.hidden = false;
    const h = knoten.getBoundingClientRect().height;
    const a = knoten.animate(
      [
        { height: "0px", opacity: 0 },
        { height: `${h}px`, opacity: 1 },
      ],
      { duration: 240, easing: KURVE },
    );
    knoten.style.overflow = "hidden";
    return a.finished
      .catch(() => {})
      .then(() => knoten.style.removeProperty("overflow"));
  }
  const h = knoten.getBoundingClientRect().height;
  knoten.style.overflow = "hidden";
  const a = knoten.animate(
    [
      { height: `${h}px`, opacity: 1 },
      { height: "0px", opacity: 0 },
    ],
    { duration: 200, easing: KURVE },
  );
  return a.finished
    .catch(() => {})
    .then(() => {
      knoten.hidden = true;
      knoten.style.removeProperty("overflow");
    });
}

// ---- Ersetzen mit Bewegung (FLIP) ----
// Zeilen und Karten tragen data-id oder data-schluessel. Beim Ersetzen merkt sich die Funktion ihre Plätze, baut neu und lässt
//  - bleibende Einträge von ihrem alten Platz an den neuen gleiten (Nachbarn rutschen, auch beim Zuteilen in eine andere Liste),
//  - neue Einträge einblenden,
//  - entfernte Einträge (ausser Tabellenzeilen) ausblenden.
// Der erste Aufbau staffelt die Einträge. Einträge, deren Schlüssel doppelt vorkommt, bewegen sich nicht (sie liessen sich nicht zuordnen).
const SCHLUESSEL = "[data-id], [data-schluessel]";
const schluesselVon = (k) => k.dataset.id ?? k.dataset.schluessel;

function oberste(ziel) {
  // Verschachtelte Treffer ausschliessen: Bewegt sich die Zeile, bewegt sich ihr Inhalt mit
  return [...ziel.querySelectorAll(SCHLUESSEL)].filter((k) => {
    const darueber = k.parentElement?.closest(SCHLUESSEL);
    return !(darueber && ziel.contains(darueber));
  });
}
function merke(ziel) {
  const karte = new Map();
  const doppelt = new Set();
  for (const k of oberste(ziel)) {
    const s = schluesselVon(k);
    if (karte.has(s)) doppelt.add(s);
    karte.set(s, { knoten: k, rect: k.getBoundingClientRect() });
  }
  return { karte, doppelt };
}

export const ersetzeMitBewegung = (ziel, ...kinder) =>
  bewegeUm(ziel, () => ziel.replaceChildren(...kinder.flat().filter(Boolean)));

// Wie ersetzeMitBewegung, nur baut aendere() den Inhalt von ziel selbst um (zum Beispiel einen Abschnitt per replaceWith ersetzen)
export function bewegeUm(ziel, aendere) {
  if (!darfBewegen() || !ziel.isConnected) {
    aendere();
    return;
  }
  const vorher = merke(ziel);
  const zielRect = ziel.getBoundingClientRect();
  const bezug = window.getComputedStyle(ziel).position !== "static";
  aendere();
  const nachher = oberste(ziel);
  const erster = vorher.karte.size === 0;
  const gesehen = new Set();
  let neuAnzahl = 0;
  for (const k of nachher) {
    const s = schluesselVon(k);
    if (gesehen.has(s) || vorher.doppelt.has(s)) continue;
    gesehen.add(s);
    const alt = vorher.karte.get(s);
    if (!alt) {
      // Nur in sichtbarer Nähe staffeln; spätere Einträge blenden ohne Verzug ein
      blendeEin(k, erster ? Math.min(neuAnzahl, 10) * 28 : 0);
      neuAnzahl++;
      continue;
    }
    const jetzt = k.getBoundingClientRect();
    const dx = alt.rect.left - jetzt.left;
    const dy = alt.rect.top - jetzt.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    spiele(
      k,
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      320,
    );
  }
  if (erster) return;
  // Entfernte Einträge: eine Kopie blendet an ihrem alten Platz aus (Tabellenzeilen lassen sich so nicht halten)
  const ausgeblendet = [...vorher.karte.entries()].filter(
    ([s, v]) =>
      !gesehen.has(s) &&
      !vorher.doppelt.has(s) &&
      !["TR", "TD", "TH"].includes(v.knoten.tagName),
  );
  if (ausgeblendet.length === 0) return;
  if (!bezug) ziel.classList.add("lg-bezug");
  for (const [, v] of ausgeblendet.slice(0, 12)) {
    const kopie = v.knoten.cloneNode(true);
    kopie.removeAttribute("data-id");
    kopie.removeAttribute("data-schluessel");
    for (const n of kopie.querySelectorAll(
      "[id], [data-id], [data-schluessel]",
    )) {
      n.removeAttribute("id");
      n.removeAttribute("data-id");
      n.removeAttribute("data-schluessel");
    }
    kopie.setAttribute("aria-hidden", "true");
    kopie.inert = true;
    kopie.classList.add("lg-geht");
    kopie.style.top = `${v.rect.top - zielRect.top + ziel.scrollTop}px`;
    kopie.style.left = `${v.rect.left - zielRect.left + ziel.scrollLeft}px`;
    kopie.style.width = `${v.rect.width}px`;
    ziel.append(kopie);
    const a = spiele(
      kopie,
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "scale(0.97)" },
      ],
      220,
    );
    const weg = () => {
      kopie.remove();
      if (!bezug && !ziel.querySelector(".lg-geht"))
        ziel.classList.remove("lg-bezug");
    };
    if (a) a.finished.then(weg, weg);
    else weg();
  }
}

// ---- Laden von Teilen ----
// Ein Teil der Seite (eine Liste, ein Tag, eine Matrix) lädt neu, ohne dass die Seite springt. Bis 250 ms bleibt der alte Inhalt stehen (ruhiger,
// mit aria-busy); dauert es länger, ersetzt ihn ein Skeleton in der Form des Inhalts (mindestens 400 ms, kein Flackern). Ohne alten Inhalt
// gibt es gleich das Skeleton nach 250 ms wie bei ctx.lade. Fehler: Zustandskarte mit «Nochmals versuchen».
// leere: true = anderer Inhalt vom Server (anderer Tag, anderer Filter): das Skeleton ersetzt den alten Inhalt; sonst (Aktualisieren) bleibt er stehen.
// Rückgabe: lade(laden, zeichnen, { skeleton, leere }); zeichnen(daten, neuLaden) baut den Inhalt von teil neu auf.
export function teilLader(teil) {
  let lauf = 0;
  const lade = async (laden, zeichnen, optionen = {}) => {
    const { skeleton = "tabelle", leere = false } = optionen;
    const meine = ++lauf;
    const hatInhalt = teil.firstChild !== null;
    teil.classList.add("lg-teil");
    teil.setAttribute("aria-busy", "true");
    let seit = 0;
    const timer = setTimeout(() => {
      if (skeleton === false || (hatInhalt && !leere)) return;
      const bauen =
        typeof skeleton === "function" ? skeleton : SKELETONS[skeleton];
      teil.replaceChildren(
        el(
          "div",
          { class: "sk-huelle", "aria-busy": "true" },
          bauen(),
          el("p", { class: "nur-leser", role: "status" }, "Lädt …"),
        ),
      );
      seit = Date.now();
    }, 250);
    let daten;
    let fehler = null;
    try {
      daten = await laden();
    } catch (f) {
      fehler = f;
    }
    clearTimeout(timer);
    if (seit) {
      const rest = 400 - (Date.now() - seit);
      if (rest > 0) await new Promise((r) => setTimeout(r, rest));
    }
    if (!teil.isConnected || meine !== lauf) return;
    teil.removeAttribute("aria-busy");
    teil.classList.remove("lg-teil");
    const erneut = () => lade(laden, zeichnen, optionen);
    if (fehler) {
      const karte = zustandsKarte(zustandsDaten(fehler), [
        nochmals(erneut, ""),
      ]);
      teil.replaceChildren(karte.wurzel);
      karte.titel.focus();
      return;
    }
    zeichnen(daten, erneut);
    if (seit || !hatInhalt) blendeEin(teil);
  };
  return lade;
}

// Ein Wechsel von Ansicht oder Reiter: der neue Inhalt blendet weich ein, der Fokus bleibt, wo er ist
export function wechsle(ziel, ...kinder) {
  ziel.replaceChildren(...kinder.flat().filter(Boolean));
  blendeEin(ziel);
}

// Balken aus einem span in .fortschritt: wächst von «vorher» auf «jetzt» Prozent (CSSOM, kein Inline-Attribut; der Übergang steht in lager-anim.css)
export function balkenBis(balken, jetzt, vorher) {
  const setze = (p) => balken.style.setProperty("width", `${p}%`);
  if (!darfBewegen() || vorher === undefined || vorher === jetzt)
    return setze(jetzt);
  setze(vorher);
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => setze(jetzt)),
  );
}

// Ein Skeleton in einem Teil, aber erst nach 250 ms (kein Flackern bei schnellen Antworten). Rückgabe: Funktion, die den Timer stoppt; der Aufrufer ersetzt den Inhalt danach selbst.
export function skeletonSpaeter(ziel, bauen, verzug = 250) {
  const t = setTimeout(() => {
    const huelle = el(
      "div",
      { class: "sk-huelle", "aria-busy": "true" },
      bauen(),
    );
    huelle.append(el("p", { class: "nur-leser", role: "status" }, "Lädt …"));
    ziel.replaceChildren(huelle);
  }, verzug);
  return () => clearTimeout(t);
}

// ---- Skeleton-Formen der Module Teilnehmende, Abzählen, Anwesenheit, Adressbuch (#685) ----
const reihe = (n, bau) => Array.from({ length: n }, (_, i) => bau(i));

// Filterleiste (Suche, Auswahlfelder mit Beschriftung), Trefferzeile und optional ein Knopf darüber; gleiche Höhen wie die echte Leiste
export const skeletonMitFilter = (inhalt, { felder = 2, knopf = false } = {}) =>
  el(
    "div",
    { class: "lg-sk-seite" },
    knopf &&
      el(
        "div",
        { class: "lg-sk-leiste" },
        el("span", { class: "sk lg-sk-knopf", "aria-hidden": "true" }),
      ),
    el(
      "div",
      { class: "lg-sk-leiste lg-sk-leiste--unten" },
      sk("b", 320),
      ...reihe(felder, () =>
        el("span", { class: "lg-sk-feld" }, sk("t", 64), sk("b", 160)),
      ),
    ),
    sk("t", 96),
    inhalt,
  );

// Abzählliste: Umschalter, Summe und ein Raster grosser Zeilen mit Haken, Name und Wort
export function skeletonAbzaehlen({ karten = 12, kopf = true } = {}) {
  return el(
    "div",
    { class: "lg-sk-seite" },
    kopf && el("div", { class: "lg-sk-leiste" }, sk("b", 260), sk("t", 112)),
    kopf && el("div", { class: "lg-sk-leiste" }, sk("b", 320), sk("b", 160)),
    el(
      "div",
      { class: "mn-abzaehl", "aria-hidden": "true" },
      reihe(karten, (i) =>
        el(
          "div",
          { class: "lg-sk-karte" },
          el("span", { class: "sk lg-sk-haken", "aria-hidden": "true" }),
          el(
            "span",
            { class: "lg-sk-name" },
            sk("t", [136, 112, 160, 96][i % 4]),
            sk("t", 64),
          ),
          sk("t", 64),
        ),
      ),
    ),
  );
}

// Matrix (Anwesenheit): Tagesleiste, Werkzeuge und Tabelle mit Feldern in Knopfhöhe
export function skeletonMatrix({ spalten = 4, zeilen = 8 } = {}) {
  return el(
    "div",
    { class: "lg-sk-seite" },
    el("div", { class: "lg-sk-leiste" }, sk("b", 380), sk("b", 160)),
    el(
      "div",
      { class: "box sk-tabelle", "aria-hidden": "true" },
      el(
        "table",
        {},
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            ...reihe(spalten + 1, () =>
              el("th", { scope: "col" }, sk("t", 64)),
            ),
          ),
        ),
        el(
          "tbody",
          {},
          ...reihe(zeilen, (z) =>
            el(
              "tr",
              {},
              el(
                "td",
                {},
                el(
                  "span",
                  { class: "sk-zeile" },
                  sk("k", 36),
                  sk("t", [112, 136, 96, 160][z % 4]),
                ),
              ),
              ...reihe(spalten, () =>
                el("td", {}, el("span", { class: "sk lg-sk-zelle" })),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

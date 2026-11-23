// Bewegung und Ladezustände im Lager-Arbeitsbereich (#685): Sie gilt für Aufgaben, Zeitplan, To-dos und die Module «Menschen und Einteilung».
// Alle Bewegung läuft nur, wenn der Browser sie erlaubt (prefers-reduced-motion: no-preference); sonst steht alles sofort da. Die Animationen sind Web Animations (kein Inline-Stil, kein Inline-Skript, die CSP bleibt streng); die ruhigen Übergänge (Antippen, Balken) stehen in lager-anim.css.
import { el } from "./dom.js";
import { erstelleLader } from "./lader.js";

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
export const puls = (knoten) =>
  spiele(
    knoten,
    [
      { transform: "scale(0.94)" },
      { transform: "scale(1.04)", offset: 0.55 },
      { transform: "none" },
    ],
    260,
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
  const start = performance.now();
  const dauer = 420;
  const schritt = (jetzt) => {
    if (knoten._lgWert !== ende) return;
    const t = Math.min(1, (jetzt - start) / dauer);
    const weich = 1 - (1 - t) ** 3;
    knoten.textContent = format(Math.round(von + (ende - von) * weich));
    if (t < 1) requestAnimationFrame(schritt);
  };
  requestAnimationFrame(schritt);
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
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
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

export function ersetzeMitBewegung(ziel, ...kinder) {
  const neue = kinder.flat().filter(Boolean);
  if (!darfBewegen() || !ziel.isConnected) {
    ziel.replaceChildren(...neue);
    return;
  }
  const vorher = merke(ziel);
  const zielRect = ziel.getBoundingClientRect();
  const bezug = getComputedStyle(ziel).position !== "static";
  ziel.replaceChildren(...neue);
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
// Ein Teil der Seite (eine Liste, ein Tag, eine Matrix) lädt neu, ohne dass die Seite springt: Das Skeleton hat die Form des Inhalts und
// ersetzt ihn erst nach 250 ms (Lader); kommt die Antwort früher, bleibt der alte Inhalt bis zur neuen Anzeige. leere: true leert vorher
// (anderer Tag, anderer Filter vom Server), sonst bleibt der alte Inhalt stehen und «Wird aktualisiert …» steht darüber.
// Rückgabe: lade(laden, zeichnen, { skeleton, leere }) wie ctx.lade
export function teilLader(teil) {
  const lade = erstelleLader(teil);
  return (laden, zeichnen, { skeleton, leere = false } = {}) => {
    if (leere) teil.replaceChildren();
    teil.setAttribute("aria-busy", "true");
    return lade(
      laden,
      (daten, neu) => {
        teil.removeAttribute("aria-busy");
        zeichnen(daten, neu);
        blendeEin(teil);
      },
      { skeleton },
    ).finally(() => teil.removeAttribute("aria-busy"));
  };
}

// Ein Wechsel von Ansicht oder Reiter: der neue Inhalt blendet weich ein, der Fokus bleibt, wo er ist
export function wechsle(ziel, ...kinder) {
  ziel.replaceChildren(...kinder.flat().filter(Boolean));
  blendeEin(ziel);
}

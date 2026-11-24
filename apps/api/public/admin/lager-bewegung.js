// Bewegung im Lager-Arbeitsbereich (#686): ruhig, nur bei erlaubter Bewegung (prefers-reduced-motion), nie ein Weg ohne Zweck.
//  - beobachteListen(): Zeilen und Listeneinträge eines Moduls gleiten an ihren neuen Platz, neue blenden ein. Der Rahmen schaltet es für jedes Modul ein, auch für Module, die nichts davon wissen.
//  - blendeEin(): ein Knoten, den ein Modul selbst einfügt, erscheint sanft.
//  - blendeAus(): ein Knoten verschwindet sanft; die Nachbarn rutschen nach.
//  - fuelle(): ein <progress> wächst auf seinen Wert.
// Die Stile stehen in lager-rahmen.css (Klassen lg-ein und lg-aus); das Gleiten läuft über Web Animations (element.animate), ohne style-Attribut.

// Wie --dauer-lang und --kurve in den Tokens (tokens.css); Web Animations lesen keine Variablen
export const DAUER_LANG_MS = 500;
export const KURVE = "cubic-bezier(0.2, 0.7, 0.2, 1)";

export const darfBewegen = () =>
  window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

// Ein Knoten erscheint (kurz, ohne Weg ausser einem Hauch nach unten)
export function blendeEin(knoten) {
  if (!darfBewegen()) return knoten;
  knoten.classList.remove("lg-ein");
  // Neu starten, falls dieselbe Zeile gleich nochmals gezeigt wird
  knoten.getBoundingClientRect();
  knoten.classList.add("lg-ein");
  knoten.addEventListener(
    "animationend",
    () => knoten.classList.remove("lg-ein"),
    {
      once: true,
    },
  );
  return knoten;
}

// Ein Knoten blendet aus und wird dann entfernt (ohne Bewegung sofort). Liefert ein Promise, das nach dem Entfernen aufgeht.
export function blendeAus(knoten) {
  if (!darfBewegen() || !knoten.isConnected) {
    knoten.remove();
    return Promise.resolve();
  }
  return new Promise((ok) => {
    const fertig = () => {
      knoten.remove();
      ok();
    };
    knoten.classList.add("lg-aus");
    knoten.addEventListener("animationend", fertig, { once: true });
    // Fällt die Animation aus (versteckter Tab), bleibt der Knoten nicht hängen
    window.setTimeout(fertig, 500);
  });
}

// Ein <progress> wächst vom alten (oder 0) auf den neuen Wert; ohne Bewegung steht er sofort
export function fuelle(balken, wert) {
  if (!darfBewegen() || balken.dataset.gefuellt) {
    balken.value = wert;
    return balken;
  }
  // Das erste Mal: bei 0 beginnen und erst einsetzen, wenn der Balken im Dokument steht
  balken.dataset.gefuellt = "1";
  balken.value = 0;
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      balken.value = wert;
    }),
  );
  return balken;
}

// ----- Listen: gleiten und einblenden ----------------------------------------------------------

// Zeilen, die sich bewegen dürfen: Tabellenzeilen und Listeneinträge im Inhalt eines Moduls. Sortierlisten (sortieren.js), Menüs, Auswahllisten und Skeletons haben ihre eigene Bewegung oder keine.
const ZEILE = "tbody > tr, ul > li, ol > li";
const NICHT =
  ".sortierliste, .sk-huelle, nav, details, [role='listbox'], [role='menu'], [role='tablist'], .menue, .auswahl";
const MAX_ZEILEN = 300;

const schluessel = (zeile) =>
  zeile.textContent.replace(/\s+/g, " ").trim().slice(0, 160);

const betrifftZeilen = (knoten) =>
  knoten.nodeType === 1 &&
  (knoten.matches(ZEILE) || knoten.querySelector(ZEILE) !== null);

// Beobachtet den Inhalt eines Moduls. Wo Zeilen verschwinden, dazukommen oder die Reihenfolge wechselt, rutschen die bleibenden Zeilen von ihrem alten an den neuen Platz und neue blenden ein. Eine Zeile gilt als dieselbe, wenn ihr Text derselbe ist.
// shortcut: Der Text ist der Schlüssel, eine bearbeitete Zeile gilt als neu; gibt es stabile Kennungen (data-id), wäre das der bessere Schlüssel.
export function beobachteListen(wurzel) {
  if (typeof MutationObserver === "undefined") return () => {};
  let stand = new Map();
  let gemerkt = false;
  let geplant = false;

  const zeilen = () =>
    [...wurzel.querySelectorAll(ZEILE)]
      .filter((z) => !z.closest(NICHT) && z.getClientRects().length > 0)
      .slice(0, MAX_ZEILEN);

  const merke = () => {
    const neu = new Map();
    for (const z of zeilen()) {
      const k = schluessel(z);
      const liste = neu.get(k) ?? [];
      liste.push(z.getBoundingClientRect().top + window.scrollY);
      neu.set(k, liste);
    }
    stand = neu;
    gemerkt = true;
  };

  const gleite = () => {
    const bewegt = [];
    const rest = new Map([...stand].map(([k, v]) => [k, [...v]]));
    for (const z of zeilen()) {
      const k = schluessel(z);
      const alt = rest.get(k)?.shift();
      if (alt === undefined) {
        // Das erste Zeichnen übernimmt der Eintritt des Moduls (gemerkt, sobald es Zeilen gab)
        if (gemerkt) blendeEin(z);
        continue;
      }
      const dy = alt - (z.getBoundingClientRect().top + window.scrollY);
      if (Math.abs(dy) >= 1) bewegt.push([z, dy]);
    }
    // Web Animations statt style-Attribut: die Zeile beginnt am alten Platz und gleitet an den neuen
    for (const [z, dy] of bewegt)
      z.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
        duration: DAUER_LANG_MS,
        easing: KURVE,
      });
  };

  const beobachter = new MutationObserver((eintraege) => {
    const zeilenGeaendert = eintraege.some((e) =>
      [...e.addedNodes, ...e.removedNodes].some(betrifftZeilen),
    );
    if (
      zeilenGeaendert &&
      darfBewegen() &&
      !wurzel.classList.contains("lg-modul--neu") &&
      !document.body.classList.contains("sortieren-aktiv")
    )
      gleite();
    if (geplant) return;
    geplant = true;
    window.requestAnimationFrame(() => {
      geplant = false;
      merke();
    });
  });
  beobachter.observe(wurzel, { childList: true, subtree: true });
  // Der Stand ist frisch, bevor die Person etwas anstösst (Klick, Taste) oder das Fenster seine Form ändert
  const stopp = () => {
    beobachter.disconnect();
    wurzel.removeEventListener("pointerdown", auffrischen, true);
    wurzel.removeEventListener("keydown", auffrischen, true);
    window.removeEventListener("resize", auffrischen);
  };
  function auffrischen() {
    // Der Rahmen baut den Inhalt bei jedem Wechsel neu; ein abgehängter Inhalt gibt seine Lauscher her
    if (!wurzel.isConnected) return stopp();
    merke();
  }
  wurzel.addEventListener("pointerdown", auffrischen, true);
  wurzel.addEventListener("keydown", auffrischen, true);
  window.addEventListener("resize", auffrischen);
  return stopp;
}

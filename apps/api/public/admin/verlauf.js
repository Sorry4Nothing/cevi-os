// Verlauf der Verwaltung (#578): Jede Ansicht ist eine Adresse mit eigenem Verlaufseintrag (Hash-Wechsel legt ihn an), «Zurück» im Browser und in der Seite führen an denselben Ort, und die Scrollposition kommt mit.
// replaceState schreibt nur Korrekturen: alte Adressen auf neue (admin.js) und den Stand des Eintrags (pos, y), nie die Adresse einer Ansicht.
import { nachVerlauf } from "./fluss.js";

window.history.scrollRestoration = "manual";

// Jeder Eintrag merkt, woher man kam (von): Das ist die Adresse davor in dieser Sitzung; beim ersten Eintrag (Tiefenlink, neuer Tab) fehlt sie
let letzter = null;

// Ruft navigiere() zu Beginn auf: legt im Zustand des Eintrags ab, woher man kam
export function merkeEintrag() {
  const s = window.history.state;
  if (s && "von" in s) {
    // Ein Eintrag aus dem Verlauf (Zurück, Vor, Neuladen) kennt sein Herkunft schon
    letzter = location.hash;
    return;
  }
  window.history.replaceState({ ...s, von: letzter }, "", location.href);
  letzter = location.hash;
}

// Wie Browser-Zurück: Kam man von der Adresse ziel, geht es im Verlauf zurück (kein neuer Eintrag, Scrollposition und Filter kommen mit); sonst, etwa nach einem Tiefenlink, führt es zu ziel
export function zurueck(ziel) {
  if (window.history.state?.von === ziel) window.history.back();
  else location.hash = ziel;
}

// Klick auf einen Zurück-Link mit href: normaler Klick geht über zurueck(), Strg/Cmd und mittlere Maustaste öffnen wie gewohnt
export function zurueckKlick(ereignis) {
  if (
    ereignis.button !== 0 ||
    ereignis.ctrlKey ||
    ereignis.metaKey ||
    ereignis.shiftKey
  )
    return;
  const ziel = ereignis.currentTarget.getAttribute("href");
  ereignis.preventDefault();
  zurueck(ziel);
}

// Für Ansichten, die ihre Adresse selbst nachführen (Liste mit Detail daneben): neuer Eintrag im Verlauf ohne neu zu laden (pushState löst kein hashchange aus) oder, für Korrekturen, derselbe Eintrag
export function schiebeAdresse(hash) {
  if (location.hash === hash) return;
  window.history.pushState({ von: location.hash }, "", hash);
  letzter = hash;
}

export function ersetzeAdresse(hash) {
  window.history.replaceState(window.history.state, "", hash);
  letzter = hash;
}

// Adresse ändern, nachdem eine Seite im Fluss geschlossen wurde (deren history.back() ist sonst noch unterwegs)
export function gehe(hash) {
  nachVerlauf(() => {
    location.hash = hash;
  });
}

// Scrollposition je Eintrag: wird beim Scrollen im Zustand des Eintrags abgelegt
let warte;
window.addEventListener(
  "scroll",
  () => {
    window.clearTimeout(warte);
    warte = window.setTimeout(() => {
      // Mit einer offenen Seite im Fluss gehört die Position der Seite, nicht dem Eintrag darunter
      if (window.history.state?.fluss !== undefined) return;
      window.history.replaceState(
        { ...window.history.state, y: window.scrollY },
        "",
        location.href,
      );
    }, 150);
  },
  { passive: true },
);

// Nach dem Aufbau einer Ansicht: zurück an die gemerkte Stelle (Eintrag aus dem Verlauf) oder nach oben (neuer Eintrag).
// Der Inhalt lädt nach, darum wird kurz nachgeführt, bis die Seite lang genug ist oder die Person selbst scrollt
let abbruch = null;
export function stelleWiederHer() {
  abbruch?.();
  const y = window.history.state?.y;
  if (!(y > 0)) {
    window.scrollTo(0, 0);
    return;
  }
  let fertig = false;
  let timer;
  const ende = () => {
    fertig = true;
    window.clearTimeout(timer);
    for (const art of ["wheel", "touchstart", "keydown"]) {
      window.removeEventListener(art, ende);
    }
  };
  abbruch = ende;
  for (const art of ["wheel", "touchstart", "keydown"]) {
    window.addEventListener(art, ende, { once: true, passive: true });
  }
  let versuche = 0;
  const schritt = () => {
    if (fertig) return;
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) < 2 || ++versuche > 40) return ende();
    timer = window.setTimeout(schritt, 50);
  };
  schritt();
}

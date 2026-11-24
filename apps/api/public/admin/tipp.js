// Eigener Hinweis statt des Tooltips des Browsers (#699): Das Attribut `title` zeichnet der Browser selbst (Aussehen, Verzögerung und Sprache nicht in unserer Hand, für Tastatur und Touch gar nicht da). Wo ein Element mehr sagt, als sein Name hergibt, steht stattdessen `data-tipp="Text"`.
// Ein Hinweis erscheint nach kurzer Zeit unter dem Zeiger, sofort beim Fokus per Tastatur, bleibt, solange Zeiger oder Fokus auf dem Element oder dem Hinweis sind (WCAG 1.4.13), und geht mit Escape weg. Er ist role="tooltip" und hängt per aria-describedby am Element; der Name des Elements bleibt sein Text oder aria-label.
// Ein Knoten für alle (position: fixed); kein style-Attribut im Markup, nur die Position per CSSOM (CSP). Aussehen: tipp.css.

const PAUSE_MS = 450;
let hinweis = null;
let ziel = null;
let timer = 0;

const tipp = (knoten) => knoten?.closest?.("[data-tipp]") ?? null;

function knoten() {
  if (hinweis) return hinweis;
  hinweis = document.createElement("div");
  hinweis.id = "tipp";
  hinweis.className = "tipp";
  hinweis.setAttribute("role", "tooltip");
  hinweis.hidden = true;
  // Mit dem Zeiger auf den Hinweis zu fahren, schliesst ihn nicht
  hinweis.addEventListener("pointerenter", () => window.clearTimeout(timer));
  hinweis.addEventListener("pointerleave", () => schliesse());
  document.body.append(hinweis);
  return hinweis;
}

function setze() {
  if (!ziel?.isConnected) return schliesse();
  const h = knoten();
  h.textContent = ziel.getAttribute("data-tipp");
  h.hidden = false;
  const z = ziel.getBoundingClientRect();
  const b = h.getBoundingClientRect();
  const rand = 8;
  // Unter dem Element; passt es dort nicht mehr ins Fenster, darüber
  let oben = z.bottom + 6;
  if (oben + b.height > window.innerHeight - rand) oben = z.top - b.height - 6;
  const links = Math.min(
    Math.max(rand, z.left + z.width / 2 - b.width / 2),
    window.innerWidth - b.width - rand,
  );
  h.style.top = `${Math.max(rand, oben)}px`;
  h.style.left = `${links}px`;
  ziel.setAttribute("aria-describedby", "tipp");
}

function schliesse() {
  window.clearTimeout(timer);
  if (ziel) ziel.removeAttribute("aria-describedby");
  ziel = null;
  if (hinweis) hinweis.hidden = true;
}

function planeBei(element, sofort) {
  if (element === ziel) return;
  schliesse();
  ziel = element;
  if (sofort) setze();
  else timer = window.setTimeout(setze, PAUSE_MS);
}

if (typeof document !== "undefined") {
  document.addEventListener("pointerover", (e) => {
    // Auf Touch gibt es kein Schweben; dort steht die Information im Namen oder im Text
    if (e.pointerType === "touch") return;
    const t = tipp(e.target);
    if (t) planeBei(t, false);
  });
  document.addEventListener("pointerout", (e) => {
    const t = tipp(e.target);
    if (!t || t !== ziel) return;
    // Der Zeiger geht auf den Hinweis: bleiben
    if (e.relatedTarget && hinweis?.contains(e.relatedTarget)) return;
    if (e.relatedTarget && t.contains(e.relatedTarget)) return;
    schliesse();
  });
  document.addEventListener("focusin", (e) => {
    const t = tipp(e.target);
    // Nur bei Bedienung per Tastatur: ein Klick mit der Maus löst keinen Hinweis am Fokus aus
    if (t?.matches(":focus-visible")) planeBei(t, true);
  });
  document.addEventListener("focusout", (e) => {
    if (tipp(e.target) === ziel) schliesse();
  });
  document.addEventListener("pointerdown", () => schliesse());
  document.addEventListener("scroll", () => schliesse(), true);
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !ziel) return;
      // Escape schliesst nur den Hinweis, nicht zugleich die Seite im Fluss
      e.stopImmediatePropagation();
      schliesse();
    },
    true,
  );
}

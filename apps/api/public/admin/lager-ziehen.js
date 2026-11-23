import { el, icon } from "./dom.js";

// Personen zwischen Listen ziehen (#675): Zimmer, Fahrten, Gruppen, Schichten. Ziehen am Griff mit Maus, Finger oder Stift; eine Hülle folgt dem Zeiger, die Fläche unter dem Zeiger hebt sich ab. Der Server bekommt erst beim Loslassen etwas.
// Das ist die Zeigerbedienung. Ohne Ziehen geht jede Zuteilung über das Menü «Verschieben» der Zeile und über die Auswahlleiste (WCAG 2.5.7); die Module bauen beides immer mit.

const ZIELE = new WeakMap();

const bewegungErlaubt = () =>
  window.matchMedia?.("(prefers-reduced-motion: no-preference)").matches;

// Macht ein Element zur Fläche, auf der man ablegen darf.
// akzeptiert(nutzlast) -> bool; beiAblegen(nutzlast) darf ein Promise liefern
export function zielFlaeche(flaeche, { akzeptiert = () => true, beiAblegen }) {
  ZIELE.set(flaeche, { akzeptiert, beiAblegen });
  flaeche.setAttribute("data-ziel", "");
  flaeche.classList.add("mn-ziel");
  return flaeche;
}

// Der Griff einer Zeile. nutzlast(): was gezogen wird (bei Auswahl mehrere); text(nutzlast): Beschriftung der Hülle
export function ziehGriff({ name, nutzlast, text }) {
  const griff = el(
    "button",
    {
      type: "button",
      class: "mn-griff",
      "aria-label": `Ziehen: ${name}`,
      title: "Ziehen. Ohne Maus: Menü «Verschieben» der Zeile.",
    },
    icon("sortieren"),
  );
  griff.addEventListener("pointerdown", (ereignis) => {
    if (ereignis.button !== 0 && ereignis.pointerType === "mouse") return;
    ereignis.preventDefault();
    starte(griff, ereignis, nutzlast(), text);
  });
  // Tastatur: Der Griff führt zum Menü der Zeile, das dieselbe Zuteilung kann
  griff.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    griff.closest("li, tr")?.querySelector("details.menue > summary")?.click();
    griff.closest("li, tr")?.querySelector("details.menue > summary")?.focus();
  });
  return griff;
}

function starte(griff, ereignis, last, text) {
  const hulle = el(
    "div",
    { class: "mn-huelle", "aria-hidden": "true" },
    text(last),
  );
  document.body.append(hulle);
  document.body.classList.add("mn-zieht");
  griff.setPointerCapture?.(ereignis.pointerId);
  let ziel = null;
  let lauf = true;
  let y = ereignis.clientY;
  const setze = (x, yy) => {
    hulle.style.transform = `translate(${x + 14}px, ${yy + 14}px)`;
  };
  setze(ereignis.clientX, ereignis.clientY);

  const finde = (x, yy) => {
    const kandidat = document.elementFromPoint(x, yy)?.closest?.("[data-ziel]");
    const eintrag = kandidat && ZIELE.get(kandidat);
    return kandidat && eintrag?.akzeptiert(last) ? kandidat : null;
  };
  const markiere = (neu) => {
    if (neu === ziel) return;
    ziel?.classList.remove("mn-ziel--aktiv");
    ziel = neu;
    ziel?.classList.add("mn-ziel--aktiv");
  };

  // Am oberen und unteren Rand des Fensters läuft die Seite mit
  const scroll = () => {
    if (!lauf) return;
    const rand = 72;
    if (y < rand) window.scrollBy(0, -Math.ceil((rand - y) / 6));
    else if (y > window.innerHeight - rand)
      window.scrollBy(0, Math.ceil((y - (window.innerHeight - rand)) / 6));
    window.requestAnimationFrame(scroll);
  };
  window.requestAnimationFrame(scroll);

  const bewegt = (e) => {
    y = e.clientY;
    setze(e.clientX, e.clientY);
    markiere(finde(e.clientX, e.clientY));
  };
  const ende = async (abbruch, e) => {
    lauf = false;
    griff.removeEventListener("pointermove", bewegt);
    griff.removeEventListener("pointerup", los);
    griff.removeEventListener("pointercancel", ab);
    document.removeEventListener("keydown", taste, true);
    const treffer = abbruch ? null : finde(e.clientX, e.clientY);
    markiere(null);
    document.body.classList.remove("mn-zieht");
    if (bewegungErlaubt()) {
      hulle.classList.add(treffer ? "mn-huelle--ab" : "mn-huelle--zurueck");
      window.setTimeout(() => hulle.remove(), 180);
    } else hulle.remove();
    if (treffer) await ZIELE.get(treffer).beiAblegen(last);
  };
  const los = (e) => ende(false, e);
  const ab = (e) => ende(true, e);
  const taste = (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    ende(true, e);
  };
  griff.addEventListener("pointermove", bewegt);
  griff.addEventListener("pointerup", los);
  griff.addEventListener("pointercancel", ab);
  document.addEventListener("keydown", taste, true);
}

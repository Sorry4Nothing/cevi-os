// Tastaturbedienung der Leiste (#549). Das Menü funktioniert auch ohne dieses Skript: Untermenüs öffnen sich bei Hover und Fokus (CSS), «Mehr» und das Menü am Handy sind details-Elemente.
// Das Skript ergänzt: Pfeiltasten wechseln zwischen den Punkten und in die Untermenüs, Esc schliesst und gibt den Fokus zurück (WCAG 1.4.13, 2.1.1), «Mehr» schliesst beim Verlassen.

const leiste = document.querySelector(".hauptnav");

const sichtbar = (e) => e.getClientRects().length > 0;

// Der Punkt der obersten Ebene, der den Fokus nimmt: Link oder summary von «Mehr»
const obere = () =>
  leiste
    ? [...leiste.querySelectorAll(":scope > ul > li")]
        .map((li) => li.querySelector(":scope > a, :scope > details > summary"))
        .filter((e) => e && sichtbar(e))
    : [];

const untermenue = (li) =>
  li.querySelector(":scope > .unter, :scope > details > .unter");

const eintraege = (li) => [...untermenue(li).querySelectorAll("a")];

function aktualisiere(li) {
  const offen =
    !li.hasAttribute("data-zu") &&
    (li.matches(":hover") || li.matches(":focus-within"));
  const kopf = li.querySelector(":scope > a");
  if (kopf) kopf.setAttribute("aria-expanded", String(offen));
}

function schliesse(li, fokusZurueck) {
  const kopf = li.querySelector(":scope > a, :scope > details > summary");
  const details = li.querySelector(":scope > details");
  if (details) details.open = false;
  li.setAttribute("data-zu", "");
  aktualisiere(li);
  if (fokusZurueck) kopf?.focus();
}

if (leiste) {
  for (const li of leiste.querySelectorAll(":scope > ul > li.mit-unter")) {
    const kopf = li.querySelector(":scope > a");
    if (kopf) kopf.setAttribute("aria-haspopup", "true");
    aktualisiere(li);
    // Ein neues Öffnen (Maus oder Fokus) hebt das Schliessen mit Esc wieder auf
    for (const ereignis of ["mouseenter", "focusin"]) {
      li.addEventListener(ereignis, () => {
        if (ereignis === "mouseenter") li.removeAttribute("data-zu");
        aktualisiere(li);
      });
    }
    for (const ereignis of ["mouseleave", "focusout"]) {
      li.addEventListener(ereignis, (e) => {
        if (ereignis === "focusout" && li.contains(e.relatedTarget)) return;
        li.removeAttribute("data-zu");
        // «Mehr» schliesst, sobald der Fokus die Gruppe verlässt
        const details = li.querySelector(":scope > details");
        if (details && ereignis === "focusout") details.open = false;
        aktualisiere(li);
      });
    }
  }

  leiste.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const li = e.target.closest("li.mit-unter");
    const imUnter = li && e.target.closest(".unter") !== null;
    const oben = obere();
    const kopf = li?.querySelector(":scope > a, :scope > details > summary");

    if (e.key === "Escape" && li) {
      e.preventDefault();
      schliesse(li, true);
      return;
    }
    if (imUnter) {
      const liste = eintraege(li);
      const i = liste.indexOf(e.target);
      if (e.key === "ArrowDown") liste[(i + 1) % liste.length]?.focus();
      else if (e.key === "ArrowUp")
        liste[(i - 1 + liste.length) % liste.length]?.focus();
      else if (e.key === "Home") liste[0]?.focus();
      else if (e.key === "End") liste.at(-1)?.focus();
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const j = oben.indexOf(kopf);
        const ziel =
          oben[
            (j + (e.key === "ArrowRight" ? 1 : -1) + oben.length) % oben.length
          ];
        schliesse(li, false);
        ziel?.focus();
      } else return;
      e.preventDefault();
      return;
    }
    const i = oben.indexOf(e.target);
    if (i === -1) return;
    if (e.key === "ArrowRight") oben[(i + 1) % oben.length].focus();
    else if (e.key === "ArrowLeft")
      oben[(i - 1 + oben.length) % oben.length].focus();
    else if (e.key === "ArrowDown" && li) {
      li.removeAttribute("data-zu");
      const details = li.querySelector(":scope > details");
      if (details) details.open = true;
      eintraege(li)[0]?.focus();
    } else return;
    e.preventDefault();
  });

  // Ein Klick ausserhalb schliesst «Mehr»
  document.addEventListener("click", (e) => {
    for (const details of leiste.querySelectorAll("details[open]")) {
      if (!details.contains(e.target)) details.open = false;
    }
  });
}

// Menü am Handy: Esc schliesst es und gibt den Fokus zurück
const mobil = document.querySelector(".menue-mobil");
mobil?.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && mobil.open) {
    mobil.open = false;
    mobil.querySelector("summary")?.focus();
  }
});

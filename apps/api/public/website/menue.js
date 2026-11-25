// Navigation im Kopf (#549, #558). Das Menü funktioniert ohne dieses Skript: Jedes Untermenü, «Mehr» und das Menü am Handy sind details-Elemente, die ihr Dreieck (summary) mit Maus, Finger und Tastatur öffnet.
// Das Skript ergänzt: Untermenüs öffnen sich beim Zeigen mit der Maus (mit kurzer Verzögerung, damit der Weg zur Tafel nichts schliesst), es ist immer nur eines offen,
// Esc schliesst und gibt den Fokus zurück (WCAG 1.4.13, 2.1.1), ein Klick daneben und das Verlassen mit der Tastatur schliessen, Pfeiltasten wechseln zwischen den Punkten und in die Tafel,
// und eine Tafel am rechten Rand öffnet nach links.

const leiste = document.querySelector(".hauptnav");
const mobil = document.querySelector(".menue-mobil");
const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)");
const maus = window.matchMedia("(hover: hover) and (pointer: fine)");

// Verhalten eines Untermenüs der Leiste (Zeigen, Fokus, Rand); ohne Leiste ein leerer Aufruf
export let bindeUntermenue = () => {};

const punktVon = (details) => details.closest("li.mit-unter");
const offene = () => [...leiste.querySelectorAll("details[open]")];

// Schliesst mit kurzem Ausblenden (kopf.css, data-geht); ohne Bewegung sofort
function schliesse(details, fokusZurueck) {
  if (fokusZurueck) details.querySelector("summary").focus();
  if (!details.open || details.hasAttribute("data-geht")) return;
  const zu = () => {
    details.open = false;
    details.removeAttribute("data-geht");
  };
  if (ruhig.matches) return zu();
  details.setAttribute("data-geht", "");
  setTimeout(zu, 120);
}

function oeffne(details) {
  details.removeAttribute("data-geht");
  details.open = true;
}

if (leiste) {
  const obere = () =>
    [...leiste.querySelectorAll(":scope > ul > li")].map((li) =>
      li.querySelector(":scope > a, :scope > details > summary"),
    );

  // Auch für Untermenüs, die navigation.js nachträglich anlegt (#795)
  bindeUntermenue = (details) => {
    const li = punktVon(details);
    let warten;

    details.addEventListener("toggle", () => {
      if (!details.open) return;
      // Nur eine Tafel ist offen (für Browser, die details[name] nicht kennen)
      for (const d of offene()) if (d !== details) d.open = false;
      // Ragt die Tafel über den rechten Rand, öffnet sie nach links
      li.removeAttribute("data-rechts");
      const tafel = details.querySelector(".unter");
      if (tafel.getBoundingClientRect().right > window.innerWidth - 8) {
        li.setAttribute("data-rechts", "");
      }
    });

    // Die Maus hat die Tafel schon durch Zeigen geöffnet: Ihr Klick auf das Dreieck schliesst sie nicht gleich wieder (Tastatur: detail ist 0)
    details.querySelector("summary").addEventListener("click", (e) => {
      if (
        details.open &&
        e.detail > 0 &&
        maus.matches &&
        li.matches(":hover")
      ) {
        e.preventDefault();
      }
    });
    // Zeigen mit der Maus öffnet; Finger und Stift tippen auf das Dreieck
    li.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse" || !maus.matches) return;
      clearTimeout(warten);
      warten = setTimeout(() => oeffne(details), details.open ? 0 : 80);
    });
    li.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse" || !maus.matches) return;
      clearTimeout(warten);
      warten = setTimeout(() => {
        // Wer mit der Tastatur in der Tafel steht, behält sie
        if (!li.contains(document.activeElement)) schliesse(details, false);
      }, 200);
    });
    // Verlässt der Fokus den Punkt, schliesst die Tafel
    li.addEventListener("focusout", (e) => {
      if (e.relatedTarget && !li.contains(e.relatedTarget)) {
        schliesse(details, false);
      }
    });
  };
  for (const details of leiste.querySelectorAll("details")) {
    bindeUntermenue(details);
  }

  leiste.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const li = e.target.closest(".hauptnav > ul > li");
    if (!li) return;
    const details = li.querySelector(":scope > details");
    const tafel = e.target.closest(".unter");
    const oben = obere();
    const i = oben.indexOf(
      li.querySelector(":scope > a, :scope > details > summary"),
    );
    const zu = (schritt) => oben[(i + schritt + oben.length) % oben.length];

    if (e.key === "Escape") {
      if (!details?.open) return;
      schliesse(details, true);
    } else if (tafel) {
      const links = [...tafel.querySelectorAll("a")];
      const j = links.indexOf(e.target);
      if (e.key === "ArrowDown") links[(j + 1) % links.length].focus();
      else if (e.key === "ArrowUp") {
        links[(j - 1 + links.length) % links.length].focus();
      } else if (e.key === "Home") links[0].focus();
      else if (e.key === "End") links.at(-1).focus();
      else if (e.key === "ArrowRight") zu(1).focus();
      else if (e.key === "ArrowLeft") zu(-1).focus();
      else return;
    } else if (e.key === "ArrowRight") zu(1).focus();
    else if (e.key === "ArrowLeft") zu(-1).focus();
    else if (e.key === "ArrowDown" && details) {
      oeffne(details);
      details.querySelector(".unter a").focus();
    } else return;
    e.preventDefault();
  });
}

// Ein Klick daneben schliesst, was offen ist
document.addEventListener("click", (e) => {
  if (leiste) {
    for (const d of offene()) {
      if (!punktVon(d).contains(e.target)) schliesse(d, false);
    }
  }
  if (mobil?.open && !mobil.contains(e.target)) mobil.open = false;
});

// Menü am Handy: Esc schliesst es und gibt den Fokus zurück
mobil?.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && mobil.open) {
    mobil.open = false;
    mobil.querySelector("summary").focus();
  }
});

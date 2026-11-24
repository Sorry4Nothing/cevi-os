import { anfrage, fehlertext } from "./api.js";
import { el, knopf, neueId } from "./dom.js";
import { sk } from "./lader.js";
import { symbol } from "./website-symbole.js";

// Bildwahl im Fluss der Seite (#591): Die Bilder der Medienbibliothek erscheinen unter dem Feld, nicht in einem Fenster über der Seite. Eine Anfrage je 24 Bilder und je Suche, erst wenn die Wahl aufgeht; kein Polling.
// Gewählt wird mit einem Klick auf ein Bild. Nur öffentliche Bilder: Logo, Zeichen und Lädeli-Bilder müssen ohne Anmeldung abrufbar sein (der Server prüft es ohnehin).
const API = "/api/v1/redaktion/medien";
const SEITE = 24;

// Bild mit ruhigem Platzhalter, bis es geladen ist (Skeleton statt leerer Fläche). Fehlt die Datei, steht ein Wort an ihrer Stelle.
// img: das Bild; klasse: Klasse der Hülle (legt Form und Grösse fest). Die Hülle trägt «bild-laedt», bis das Bild da ist.
export function bildMitLader(img, klasse = "") {
  const huelle = el("span", { class: `bild-box bild-laedt ${klasse}`.trim() });
  const fertig = () => huelle.classList.remove("bild-laedt");
  img.addEventListener("load", fertig, { once: true });
  img.addEventListener(
    "error",
    () => {
      fertig();
      img.replaceWith(el("span", { class: "bild-fehlt" }, "Vorschau fehlt"));
    },
    { once: true },
  );
  huelle.append(img);
  if (img.complete && img.naturalWidth > 0) fertig();
  return huelle;
}

// ausloeser: der Knopf, der die Wahl öffnet (der Aufrufer beschriftet ihn); beiWahl(medium) läuft nach einem Klick auf ein Bild
// Rückgabe: { panel, setze(id), schliesse() }; panel kommt dorthin, wo die Bilder erscheinen sollen
export function bildwahl({ ausloeser, beiWahl, gewaehlt = null }) {
  let aktuell = gewaehlt;
  let geladen = false;
  let lauf = 0;
  let anzahl = 0;
  let weitere = false;
  let timer = 0;
  const panelId = neueId("bildwahl");
  const suchId = neueId("suche");
  const suche = el("input", {
    class: "eingabe",
    id: suchId,
    type: "search",
    placeholder: "Nach Beschreibung suchen",
    autocomplete: "off",
    // Ein Enter in der Suche schickt kein umgebendes Formular ab
    onkeydown: (e) => e.key === "Enter" && e.preventDefault(),
    oninput: () => {
      window.clearTimeout(timer);
      timer = setTimeout(() => lade(true), 300);
    },
  });
  const raster = el("ul", { class: "bw-raster", "aria-label": "Bilder" });
  const zaehler = el("p", { class: "klein leise", role: "status" });
  const fehler = el("div", {});
  const mehr = knopf("Weitere Bilder laden", {
    klein: true,
    hidden: true,
    onclick: () => lade(false),
  });
  const panel = el(
    "div",
    { class: "bw", id: panelId, hidden: true },
    el(
      "div",
      { class: "suche" },
      el("label", { class: "nur-leser", for: suchId }, "Bilder suchen"),
      symbol("lupe"),
      suche,
    ),
    zaehler,
    fehler,
    raster,
    el("div", { class: "bw-fuss" }, mehr),
    el(
      "p",
      { class: "hilfe" },
      "Neue Bilder lädst du unter ",
      el("a", { href: "#website/medien" }, "Medien"),
      " hoch.",
    ),
  );
  ausloeser.setAttribute("aria-expanded", "false");
  ausloeser.setAttribute("aria-controls", panelId);

  const markiere = () => {
    for (const b of raster.querySelectorAll("button[data-id]")) {
      const an = b.dataset.id === aktuell;
      b.setAttribute("aria-pressed", String(an));
      b.classList.toggle("gewaehlt", an);
    }
  };

  const karte = (m) =>
    el(
      "li",
      {},
      el(
        "button",
        {
          type: "button",
          class: "bw-karte",
          "data-id": m.id,
          "aria-pressed": String(m.id === aktuell),
          onclick: () => {
            aktuell = m.id;
            markiere();
            beiWahl(m);
            schliesse(true);
          },
        },
        bildMitLader(
          el("img", {
            src: m.url,
            alt: "",
            loading: "lazy",
            decoding: "async",
          }),
          "bw-bild",
        ),
        el(
          "span",
          { class: "bw-text" },
          m.altText || (m.dekorativ ? "Nur Zierde" : "Ohne Beschreibung"),
        ),
        el("span", { class: "bw-haken" }, symbol("haken")),
      ),
    );

  const skeleton = () =>
    el(
      "div",
      { class: "sk-huelle bw-skeleton", "aria-busy": "true" },
      el(
        "ul",
        { class: "bw-raster", "aria-hidden": "true" },
        Array.from({ length: 6 }, () =>
          el("li", {}, sk("b", 380), sk("t", 112)),
        ),
      ),
      el(
        "p",
        { class: "nur-leser", role: "status" },
        "Bilder werden geladen …",
      ),
    );

  async function lade(neu) {
    const mein = ++lauf;
    fehler.replaceChildren();
    mehr.disabled = true;
    if (neu) {
      anzahl = 0;
      raster.replaceChildren();
      zaehler.textContent = "";
      fehler.replaceChildren(skeleton());
    }
    const q = new URLSearchParams({ limit: SEITE, offset: anzahl });
    if (suche.value.trim()) q.set("suche", suche.value.trim());
    try {
      const daten = await anfrage("GET", `${API}?${q}`);
      if (mein !== lauf) return;
      fehler.replaceChildren();
      // Der Versatz zählt die Medien der Antwort, nicht nur die öffentlichen Bilder
      anzahl += daten.medien.length;
      weitere = daten.weitere;
      for (const m of daten.medien) {
        if (m.sichtbarkeit === "oeffentlich" && m.mimeTyp.startsWith("image/"))
          raster.append(karte(m));
      }
      const n = raster.children.length;
      zaehler.textContent =
        n === 0
          ? suche.value.trim()
            ? "Kein öffentliches Bild passt zur Suche."
            : "Es gibt noch kein öffentliches Bild."
          : `${n} ${n === 1 ? "Bild" : "Bilder"}${weitere ? ", weitere folgen" : ""}`;
      mehr.hidden = !weitere;
    } catch (f) {
      if (mein !== lauf) return;
      fehler.replaceChildren(
        el(
          "div",
          { class: "hinweis hinweis--fehler", role: "alert" },
          `${fehlertext(f)} `,
          knopf("Nochmals versuchen", {
            klein: true,
            onclick: () => lade(neu),
          }),
        ),
      );
    } finally {
      if (mein === lauf) mehr.disabled = false;
    }
  }

  function schliesse(fokus = false) {
    panel.hidden = true;
    ausloeser.setAttribute("aria-expanded", "false");
    if (fokus) ausloeser.focus();
  }

  function oeffne() {
    panel.hidden = false;
    ausloeser.setAttribute("aria-expanded", "true");
    if (!geladen) {
      geladen = true;
      lade(true);
    }
    markiere();
    suche.focus();
  }

  ausloeser.addEventListener("click", () =>
    panel.hidden ? oeffne() : schliesse(),
  );
  // Escape schliesst nur die Wahl, nicht die Seite darum herum
  panel.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    schliesse(true);
  });

  return {
    panel,
    setze: (id) => {
      aktuell = id;
      markiere();
    },
    schliesse,
  };
}

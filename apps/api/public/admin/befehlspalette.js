// Befehlspalette (#602): Strg oder Cmd + K öffnet ein Suchfeld über der Seite. Es findet Seiten der Verwaltung, die Aktion «Neue Person» und Personen, deren Liste schon geladen ist.
// Muster «Action Search Bar» (Kokonut UI Pro) als Vorlage für den Aufbau; Code und Stil sind eigen.
// Nie Daten ohne Recht: Die Seiten kommen aus dem, was die Navigation der Person zeigt; Personen nur, wenn die Seite «Personen» die Liste geladen hat (sie ist nur für die Abteilungsleitung zu sehen); die Palette stellt selbst keine Abfrage.
// Es ist die einzige Überlagerung der Verwaltung: Ein Suchfeld mit Tastaturbedienung braucht den Fokus in einer Schicht, die Escape schliesst und den Fokus zurückgibt (nativer `dialog`).
import { adresseVon } from "./navigation.js";
import { el, icon, neueId } from "./dom.js";

// Personen, die eine Seite geladen hat (`meldePersonen`); die Palette liest nur diese Liste
let bekanntePersonen = [];
export const meldePersonen = (liste) => {
  bekanntePersonen = liste.map((p) => ({
    id: p.id,
    name: p.name,
    ceviName: p.ceviName ?? "",
  }));
};

// Wunsch an die nächste Seite: «Neue Person» öffnet das Formular, eine Person setzt die Suche. Die Seite holt ihn mit `nimmWunsch` ab; er gilt genau einmal.
let wunsch = null;
export function nimmWunsch() {
  const w = wunsch;
  wunsch = null;
  return w;
}

const istMac = () => /Mac|iPhone|iPad/.test(navigator.platform ?? "");
export const kuerzelText = () => (istMac() ? "⌘ K" : "Strg K");

// Ohne Umlaute und Grossschreibung vergleichen: «uebersicht» findet «Übersicht»
const glatt = (text) =>
  text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Alle Wörter der Frage müssen vorkommen; ein Treffer am Anfang eines Worts zählt mehr. null = kein Treffer
export function punkte(frage, text) {
  const woerter = glatt(frage).split(/\s+/).filter(Boolean);
  if (woerter.length === 0) return 0;
  const heu = glatt(text);
  let summe = 0;
  for (const w of woerter) {
    const i = heu.indexOf(w);
    if (i < 0) return null;
    summe += i === 0 || heu[i - 1] === " " ? 2 : 1;
  }
  return summe;
}

// Einträge der Palette für eine Frage. bereiche: sichtbare Bereiche der Person (navigation.js); personen: geladene Personen
// Ohne Frage: alle Seiten, in der Reihenfolge der Navigation. Mit Frage: sortiert nach Treffer, Personen erst ab zwei Zeichen, höchstens 6
export function eintraege({ frage, bereiche, personen }) {
  const seiten = [];
  for (const b of bereiche) {
    for (const u of b.unter) {
      seiten.push({
        gruppe: "Seiten",
        id: `${b.schluessel}/${u.schluessel}`,
        text: u.name,
        zusatz: b.unter.length > 1 && b.name !== u.name ? b.name : "",
        symbol: b.symbol,
        suche: `${u.name} ${b.name}`,
        adresse: adresseVon(b, u),
      });
    }
  }
  const darfPersonen = bereiche.some((b) =>
    b.unter.some(
      (u) => b.schluessel === "personen" && u.schluessel === "personen",
    ),
  );
  const aktionen = darfPersonen
    ? [
        {
          gruppe: "Aktionen",
          id: "person-neu",
          text: "Neue Person",
          zusatz: "Personen",
          symbol: "plus",
          suche: "neue person erfassen anlegen hinzufügen",
          adresse: "#personen/personen",
          wunsch: { art: "neu" },
        },
      ]
    : [];
  const leute =
    darfPersonen && frage.trim().length >= 2
      ? personen.map((p) => ({
          gruppe: "Personen",
          id: `person-${p.id}`,
          text: p.name,
          zusatz: p.ceviName,
          symbol: "personen",
          suche: `${p.name} ${p.ceviName}`,
          adresse: "#personen/personen",
          wunsch: { art: "person", frage: p.name },
        }))
      : [];
  const alle = [...aktionen, ...seiten, ...leute];
  if (!frage.trim()) return [...aktionen, ...seiten];
  const treffer = alle
    .map((e) => ({ e, p: punkte(frage, e.suche) }))
    .filter((t) => t.p !== null);
  const ordnung = { Aktionen: 0, Seiten: 1, Personen: 2 };
  treffer.sort(
    (a, b) => ordnung[a.e.gruppe] - ordnung[b.e.gruppe] || b.p - a.p,
  );
  const ohneLeute = treffer.filter((t) => t.e.gruppe !== "Personen");
  const nurLeute = treffer.filter((t) => t.e.gruppe === "Personen").slice(0, 6);
  return [...ohneLeute, ...nurLeute].map((t) => t.e);
}

// Palette bauen: gibt { oeffne, knopf } zurück. bereiche(): Funktion, die die jetzt sichtbaren Bereiche liefert; bereit(): false vor der Anmeldung (dann tut das Kürzel nichts)
export function erstellePalette({ bereiche, bereit = () => true }) {
  let offen = null;

  function oeffne() {
    if (offen || !bereit()) return;
    const listeId = neueId("palette-liste");
    const eingabe = el("input", {
      class: "palette-eingabe",
      type: "text",
      role: "combobox",
      "aria-label": "Seite oder Person suchen",
      "aria-expanded": "true",
      "aria-controls": listeId,
      "aria-autocomplete": "list",
      placeholder: "Seite oder Person suchen",
      autocomplete: "off",
      spellcheck: "false",
    });
    const liste = el("ul", {
      class: "palette-liste",
      id: listeId,
      role: "listbox",
      "aria-label": "Treffer",
    });
    const leer = el(
      "p",
      { class: "palette-leer", hidden: true },
      "Nichts gefunden.",
    );
    const status = el("p", {
      class: "nur-leser",
      role: "status",
      "aria-live": "polite",
    });
    const dialog = el(
      "dialog",
      { class: "palette", "aria-label": "Suchen" },
      el("div", { class: "palette-kopf" }, icon("lupe"), eingabe),
      liste,
      leer,
      status,
      el(
        "p",
        { class: "palette-fuss" },
        "Pfeiltasten wählen, Enter öffnet, Esc schliesst. Öffnen mit ",
        el("kbd", {}, kuerzelText()),
        ".",
      ),
    );
    let treffer = [];
    let aktiv = 0;

    const setzeAktiv = (i) => {
      aktiv = i;
      for (const [n, li] of [
        ...liste.querySelectorAll("[role=option]"),
      ].entries()) {
        li.setAttribute("aria-selected", String(n === i));
        if (n === i) {
          eingabe.setAttribute("aria-activedescendant", li.id);
          li.scrollIntoView({ block: "nearest" });
        }
      }
    };
    const waehle = (e) => {
      schliesse();
      wunsch = e.wunsch ?? null;
      if (location.hash === e.adresse) {
        // Schon dort: Die Seite lädt nicht neu, der Wunsch wäre verloren; darum neu laden lassen
        window.dispatchEvent(new window.HashChangeEvent("hashchange"));
      } else {
        location.hash = e.adresse;
      }
    };
    const zeichne = () => {
      treffer = eintraege({
        frage: eingabe.value,
        bereiche: bereiche(),
        personen: bekanntePersonen,
      });
      liste.replaceChildren();
      let gruppe = "";
      treffer.forEach((e, n) => {
        if (e.gruppe !== gruppe) {
          gruppe = e.gruppe;
          liste.append(
            el("li", { class: "palette-gruppe", role: "presentation" }, gruppe),
          );
        }
        liste.append(
          el(
            "li",
            {
              class: "palette-eintrag",
              role: "option",
              id: `${listeId}-${n}`,
              "aria-selected": "false",
              onclick: () => waehle(e),
              onmousemove: () => aktiv !== n && setzeAktiv(n),
            },
            icon(e.symbol),
            el("span", { class: "palette-text" }, e.text),
            e.zusatz && el("span", { class: "palette-zusatz" }, e.zusatz),
          ),
        );
      });
      leer.hidden = treffer.length > 0;
      eingabe.removeAttribute("aria-activedescendant");
      if (treffer.length > 0) setzeAktiv(0);
      status.textContent = "";
      window.setTimeout(() => {
        status.textContent =
          treffer.length === 0
            ? "Keine Treffer."
            : treffer.length === 1
              ? "1 Treffer."
              : `${treffer.length} Treffer.`;
      }, 50);
    };
    function schliesse() {
      if (!offen) return;
      offen = null;
      dialog.close();
      dialog.remove();
    }
    eingabe.addEventListener("input", zeichne);
    eingabe.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (treffer.length === 0) return;
        setzeAktiv(
          (aktiv + (e.key === "ArrowDown" ? 1 : -1) + treffer.length) %
            treffer.length,
        );
      } else if (e.key === "Home" && e.ctrlKey && treffer.length > 0) {
        e.preventDefault();
        setzeAktiv(0);
      } else if (e.key === "Enter" && treffer[aktiv]) {
        e.preventDefault();
        waehle(treffer[aktiv]);
      }
    });
    // Klick auf den Schleier (ausserhalb der Karte) schliesst
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) schliesse();
    });
    dialog.addEventListener("close", () => {
      offen = null;
      dialog.remove();
    });
    offen = dialog;
    document.body.append(dialog);
    zeichne();
    dialog.showModal();
    eingabe.focus();
  }

  document.addEventListener("keydown", (e) => {
    if (
      e.key.toLowerCase() === "k" &&
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      !e.altKey
    ) {
      if (!bereit()) return;
      e.preventDefault();
      if (offen) offen.querySelector("input")?.focus();
      else oeffne();
    }
  });

  // Der Knopf im Kopf: Symbol, Wort und Kürzel; schmal nur das Symbol
  const knopf = () =>
    el(
      "button",
      {
        type: "button",
        class: "knopf knopf--klein palette-knopf",
        "aria-keyshortcuts": "Control+K Meta+K",
        onclick: oeffne,
      },
      icon("lupe"),
      el("span", { class: "palette-knopf-text" }, "Suchen"),
      el(
        "kbd",
        { class: "palette-kuerzel", "aria-hidden": "true" },
        kuerzelText(),
      ),
    );
  return { oeffne, knopf };
}

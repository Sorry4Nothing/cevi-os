import { auswahl, avatar, el, icon, knopf, neueId } from "./dom.js";
import { ROLLEN } from "./lager-gemeinsam.js";

// Personen für ein Lager wählen (#592): Suchfeld, Personen mit Gesicht zum Ankreuzen, die Gewählten als Chips zum Entfernen, eine Rolle für alle Gewählten, ein Knopf «Hinzufügen». Mehrere Personen auf einmal. Die Liste der Personen lädt der Aufrufer (eine Abfrage); gespeichert wird in beiHinzufuegen.
// personen: [{ id, name, ceviName? }]; ausgeschlossen: Set der Personen, die schon dabei sind
// beiHinzufuegen(liste, rolle): darf ein Promise liefern und werfen; danach ist die Wahl leer
// Der Name der Rolle im Knopf und im Hinweis kommt aus ROLLEN; Lagerleitung darf immer alles
export function personenWahl({
  titel = "Personen hinzufügen",
  hilfe = "Nur Personen mit Konto lassen sich hinzufügen.",
  personen,
  ausgeschlossen = new Set(),
  rolle = "team",
  rollen = ROLLEN,
  beiHinzufuegen,
  fehlertext = (f) => f?.message ?? "Das hat nicht geklappt.",
}) {
  const gewaehlt = new Map();
  const id = neueId("lg-wahl");
  const status = el("p", { class: "nur-leser", role: "status" });
  const fehler = el("p", {
    class: "feld-fehler",
    role: "alert",
    hidden: true,
  });
  const suche = el("input", {
    class: "eingabe",
    id: `${id}-suche`,
    type: "search",
    placeholder: "Name suchen",
    autocomplete: "off",
    spellcheck: "false",
    "aria-controls": `${id}-liste`,
  });
  const liste = el("ul", { class: "lg-wahlliste", id: `${id}-liste` });
  const chips = el("ul", {
    class: "lg-gewaehlt",
    "aria-label": "Gewählte Personen",
  });
  const rolleFeld = auswahl({
    label: "Rolle der Gewählten",
    optionen: rollen,
    wert: rolle,
  });
  const hinzu = knopf("Hinzufügen", { art: "haupt", symbol: "plus" });
  const leerText = el("p", { class: "leise", hidden: true });
  const rollenName = (w) => rollen.find(([r]) => r === w)?.[1] ?? w;

  const kandidaten = () => personen.filter((p) => !ausgeschlossen.has(p.id));

  function zeichneChips() {
    chips.replaceChildren(
      ...[...gewaehlt.values()].map((p) =>
        el(
          "li",
          { class: "lg-chip" },
          avatar(p.name),
          el("span", {}, p.name),
          el(
            "button",
            {
              type: "button",
              class: "lg-chip-weg",
              "aria-label": `Entfernen: ${p.name}`,
              onclick: () => {
                gewaehlt.delete(p.id);
                zeichne();
                suche.focus();
              },
            },
            icon("schliessen"),
          ),
        ),
      ),
    );
    chips.hidden = gewaehlt.size === 0;
    const n = gewaehlt.size;
    hinzu.lastChild.textContent =
      n === 0
        ? "Hinzufügen"
        : n === 1
          ? `1 Person hinzufügen`
          : `${n} Personen hinzufügen`;
  }

  function zeichneListe() {
    const q = suche.value.trim().toLowerCase();
    const alle = kandidaten();
    const treffer = alle.filter(
      (p) =>
        q === "" || `${p.name} ${p.ceviName ?? ""}`.toLowerCase().includes(q),
    );
    liste.replaceChildren(
      ...treffer.map((p) => {
        const box = el("input", {
          type: "checkbox",
          checked: gewaehlt.has(p.id),
          onchange: () => {
            if (box.checked) gewaehlt.set(p.id, p);
            else gewaehlt.delete(p.id);
            zeichneChips();
          },
        });
        return el(
          "li",
          {},
          el(
            "label",
            { class: "lg-person" },
            box,
            avatar(p.name),
            el(
              "span",
              { class: "lg-person-text" },
              el("span", { class: "name" }, p.name),
              p.ceviName && el("span", { class: "klein leise" }, p.ceviName),
            ),
          ),
        );
      }),
    );
    liste.hidden = treffer.length === 0;
    leerText.hidden = treffer.length > 0;
    leerText.textContent =
      alle.length === 0
        ? "Alle Personen mit Konto sind schon Mitglied dieses Lagers."
        : `Niemand gefunden für «${suche.value.trim()}».`;
    status.textContent =
      treffer.length === 1 ? "1 Person." : `${treffer.length} Personen.`;
  }
  function zeichne() {
    zeichneListe();
    zeichneChips();
  }

  suche.addEventListener("input", zeichneListe);
  hinzu.addEventListener("click", async () => {
    fehler.hidden = true;
    if (gewaehlt.size === 0) {
      fehler.textContent = "Wähle mindestens eine Person.";
      fehler.hidden = false;
      suche.focus();
      return;
    }
    const wahl = [...gewaehlt.values()];
    const wer = rolleFeld.eingabe.value;
    hinzu.disabled = true;
    hinzu.setAttribute("aria-busy", "true");
    try {
      await beiHinzufuegen(wahl, wer);
      for (const p of wahl) ausgeschlossen.add(p.id);
      gewaehlt.clear();
      suche.value = "";
      zeichne();
      status.textContent = `${wahl.length === 1 ? "1 Person" : `${wahl.length} Personen`} als ${rollenName(wer)} hinzugefügt.`;
    } catch (f) {
      fehler.textContent = fehlertext(f);
      fehler.hidden = false;
    } finally {
      hinzu.disabled = false;
      hinzu.removeAttribute("aria-busy");
    }
  });

  const wurzel = el(
    "section",
    { class: "flaeche lg-wahlkarte", "aria-labelledby": `${id}-titel` },
    el("h2", { id: `${id}-titel` }, titel),
    hilfe && el("p", { class: "leise" }, hilfe),
    el(
      "div",
      { class: "suche" },
      el("label", { class: "nur-leser", for: `${id}-suche` }, "Person suchen"),
      icon("lupe"),
      suche,
    ),
    liste,
    leerText,
    chips,
    el("div", { class: "lg-wahlfuss" }, rolleFeld.wurzel, hinzu),
    fehler,
    status,
  );
  zeichne();
  return {
    wurzel,
    fokus: () => suche.focus(),
    // Die Aufrufer ändern die Menge der Mitglieder von aussen (Entfernen)
    aktualisiere: () => zeichne(),
    ausgeschlossen,
  };
}

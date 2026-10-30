import { anfrage, fehlertext } from "./api.js";
import { el, feld, knopf } from "./dom.js";

export function zeige(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", "/api/v1/hilfe"),
    (daten) => zeichne(bereich, ctx, daten.vertrauenspersonen ?? ""),
  );
}

function zeichne(bereich, ctx, text) {
  const eingabe = feld({
    label: "Vertrauenspersonen",
    hilfe:
      "Dieser Text steht in der App auf der Hilfe-Seite. Höchstens 2000 Zeichen. Ein leerer Text löscht den Eintrag.",
    mehrzeilig: true,
    wert: text,
    maxlength: 2000,
  });
  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
    tabindex: "-1",
  });
  const speichern = knopf("Speichern", {
    art: "haupt",
    symbol: "haken",
    type: "submit",
  });
  const formular = el(
    "form",
    { class: "formular", novalidate: true },
    eingabe.wurzel,
    fehler,
    el("div", { class: "aktionen" }, speichern),
  );
  formular.addEventListener("submit", async (ereignis) => {
    ereignis.preventDefault();
    fehler.hidden = true;
    speichern.disabled = true;
    try {
      await anfrage("PATCH", "/api/v1/admin/abteilung", {
        vertrauenspersonen: eingabe.eingabe.value,
      });
      ctx.melde("Gespeichert.");
    } catch (f) {
      fehler.textContent = fehlertext(f);
      fehler.hidden = false;
      fehler.focus();
    } finally {
      speichern.disabled = false;
    }
  });
  bereich.append(
    el(
      "section",
      { class: "panel panel--schmal", "aria-labelledby": "abteilung-hilfe" },
      el("h2", { id: "abteilung-hilfe" }, "Hilfe-Seite der App"),
      formular,
    ),
  );
}

import { anfrage, fehlertext } from "./api.js";
import {
  aktionenZelle,
  dialogFormular,
  el,
  feld,
  knopf,
  tabelle,
} from "./dom.js";

export function zeige(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", "/api/v1/stufen"),
    (daten, neu) => zeichne(bereich, ctx, daten.stufen, neu),
  );
}

function felder(stufe) {
  return {
    name: feld({
      label: "Name",
      wert: stufe?.name ?? "",
      maxlength: 100,
      required: true,
    }),
    kuerzel: feld({
      label: "Kürzel",
      wert: stufe?.kuerzel ?? "",
      maxlength: 20,
      required: true,
    }),
    reihenfolge: feld({
      label: "Reihenfolge",
      hilfe:
        "Eine ganze Zahl von 1 bis 999. Stufen mit kleineren Zahlen stehen weiter vorne.",
      typ: "number",
      min: 1,
      max: 999,
      step: 1,
      inputmode: "numeric",
      wert: stufe ? String(stufe.reihenfolge) : "",
      required: true,
    }),
  };
}

function lesen(f) {
  const reihenfolge = Number(f.reihenfolge.eingabe.value);
  if (!Number.isInteger(reihenfolge) || reihenfolge < 1 || reihenfolge > 999) {
    throw new Error("reihenfolge");
  }
  return {
    name: f.name.eingabe.value.trim(),
    kuerzel: f.kuerzel.eingabe.value.trim(),
    reihenfolge,
  };
}

// Ungültige Zahl: gleiche Anzeige wie ein 400 der API
const ungueltig = () => {
  throw Object.assign(new Error("400"), { status: 400, code: "UNGUELTIG" });
};

function dialog({ stufe, ctx, neu }) {
  const f = felder(stufe);
  dialogFormular({
    titel: stufe ? "Stufe bearbeiten" : "Stufe anlegen",
    beschreibung: stufe?.name,
    felder: [f.name.wurzel, f.kuerzel.wurzel, f.reihenfolge.wurzel],
    ok: stufe ? "Speichern" : "Anlegen",
    senden: () => {
      let body;
      try {
        body = lesen(f);
      } catch {
        return ungueltig();
      }
      return stufe
        ? anfrage("PATCH", `/api/v1/admin/stufen/${stufe.id}`, body)
        : anfrage("POST", "/api/v1/admin/stufen", body);
    },
    fehlertext: (fehler) =>
      fehler.code === "UNGUELTIG"
        ? "Die Reihenfolge muss eine ganze Zahl von 1 bis 999 sein."
        : fehlertext(fehler),
    danach: () => {
      neu();
      ctx.melde(stufe ? "Gespeichert." : "Stufe ist angelegt.");
    },
  });
}

function zeichne(bereich, ctx, stufen, neu) {
  bereich.append(
    el(
      "div",
      { class: "werkzeuge" },
      el(
        "p",
        { class: "meta zaehler", role: "status" },
        `${stufen.length} Stufen`,
      ),
      knopf("Stufe anlegen", {
        art: "haupt",
        onclick: () => dialog({ ctx, neu }),
      }),
    ),
    stufen.length === 0
      ? el("p", { class: "leer" }, "Es gibt noch keine Stufen.")
      : tabelle({
          beschriftung: "Stufen",
          spalten: ["Name", "Kürzel", "Reihenfolge", "Aktionen"],
          zeilen: stufen.map((stufe) =>
            el(
              "tr",
              {},
              el("th", { scope: "row" }, stufe.name),
              el("td", {}, stufe.kuerzel),
              el("td", {}, String(stufe.reihenfolge)),
              aktionenZelle(
                knopf("Bearbeiten", {
                  klein: true,
                  kontext: stufe.name,
                  onclick: () => dialog({ stufe, ctx, neu }),
                }),
              ),
            ),
          ),
        }).wurzel,
  );
}

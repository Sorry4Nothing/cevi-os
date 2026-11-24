import { anfrage } from "./api.js";
import { el } from "./dom.js";
import { skeletonVon } from "./lager-skeleton.js";
import {
  aufgabenListe,
  datumKurzTag,
  hoeckListe,
  karte,
} from "./lager-start-teile.js";

// Modul «Meine Woche» (#672): die sieben Tage ab heute aus deiner Sicht. GET /api/v1/lager/{id}/meine-woche: eigene offene Aufgaben mit Frist bis zum Ende der Woche (auch Überfälliges), eigene Schichten, Höcks der Woche. Ein Teil ohne Leserecht fehlt.

const von = (a) => a.frist ?? "9999-12-31";

function schichtListe(schichten) {
  if (schichten.length === 0)
    return el("p", { class: "leise" }, "Diese Woche hast du keine Schicht.");
  return el(
    "ul",
    { class: "lg-liste" },
    schichten.map((s) =>
      el(
        "li",
        { class: "lg-zeile" },
        el("span", { class: "lg-datum" }, datumKurzTag(s.datum)),
        el(
          "div",
          { class: "lg-zeile-text" },
          el("strong", {}, s.dienst?.name ?? "Dienst"),
        ),
        s.dienst?.nacht ? el("span", { class: "chip" }, "Nacht") : "",
      ),
    ),
  );
}

export function zeige(bereich, ctx, id, lager) {
  ctx.lade(
    () => anfrage("GET", `/api/v1/lager/${id}/meine-woche`),
    (w) => {
      ctx.titel(
        "Meine Woche",
        `${datumKurzTag(w.von)} bis ${datumKurzTag(w.bis)}`,
      );
      const karten = [];
      if (w.aufgaben)
        karten.push(
          karte(
            "Meine Aufgaben",
            aufgabenListe({
              aufgaben: [...w.aufgaben].sort((a, b) =>
                von(a).localeCompare(von(b)),
              ),
              lager,
              ctx,
              heute: w.von,
              leer: "Du hast diese Woche keine offene Aufgabe.",
            }),
          ),
        );
      if (w.schichten)
        karten.push(karte("Meine Schichten", schichtListe(w.schichten)));
      if (w.hoecks)
        karten.push(
          karte(
            "Höcks der Woche",
            hoeckListe({
              hoecks: w.hoecks,
              mitDatum: true,
              leer: "Diese Woche ist kein Höck.",
            }),
          ),
        );
      bereich.append(el("div", { class: "lg-kacheln" }, karten));
    },
    {
      skeleton: skeletonVon({ inhalt: "karten", zeilen: 3 }),
    },
  );
}

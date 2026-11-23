// Formularraster (#578, vereinheitlicht in #602): Zweispalter «Felder links, Bild oder Vorschau rechts». Vorgabe: ohne eigene Scrollbereiche. Die Seite scrollt wie jede andere, die rechte Spalte (Bild, Vorschau) bleibt beim Scrollen stehen; das gilt für kurze Formulare und für Seiten mit Kopf. Unter 1100 px steht alles in einer Spalte, die rechte nach den Feldern (oder zuerst, wenn die Seite es verlangt). Nichts wird abgeschnitten und nichts springt.
// felder: Knoten oder Liste von Knoten (links); seite: Knoten oder Liste (rechts), z. B. Logo in gross oder die Vorschau des Kopfs; seiteTitel: Überschrift der rechten Spalte (Screenreader und Anzeige)
// scroll: true gibt jeder Spalte ab 1100 px einen eigenen Scrollbereich in Fensterhöhe (wie der Editor einer Seite); nur für Ansichten, die das ganze Fenster füllen und keinen Kopf darüber haben
import { el, neueId } from "./dom.js";

export function formularRaster({ felder, seite, seiteTitel, scroll = false }) {
  const seiteId = neueId("raster-seite");
  return el(
    "div",
    { class: `formularraster${scroll ? " formularraster--scroll" : ""}` },
    el("div", { class: "formularraster-felder" }, felder),
    el(
      "aside",
      {
        class: "formularraster-seite",
        "aria-labelledby": seiteTitel ? seiteId : undefined,
      },
      seiteTitel &&
        el("h2", { id: seiteId, class: "formularraster-titel" }, seiteTitel),
      seite,
    ),
  );
}

// Formularraster (#578): Zweispalter «Felder links, Bild oder Vorschau rechts». Ab 1100 px hat jede Spalte ihren eigenen Scrollbereich (wie der Editor einer Seite), darunter steht alles in einer Spalte, die Vorschau nach den Feldern. Nichts wird abgeschnitten und nichts springt.
// felder: Knoten oder Liste von Knoten (links); seite: Knoten (rechts), z. B. Logo in gross oder die Vorschau des Kopfs; seiteTitel: Überschrift der rechten Spalte (Screenreader und Anzeige)
import { el, neueId } from "./dom.js";

export function formularRaster({ felder, seite, seiteTitel }) {
  const seiteId = neueId("raster-seite");
  return el(
    "div",
    { class: "formularraster" },
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

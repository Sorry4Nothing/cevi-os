import { el, neueId } from "./dom.js";

// Untergruppen der Sichtbarkeit «Bestimmte Gruppen» (#844): je gewählter Stufe, wer darin den Inhalt sieht. Anlass, Seite und Baustein teilen sie.
// Die Beschriftungen sind neutral; die Rollenform nach Geschlecht gilt nur dort, wo eine bestimmte Person steht (rollenname.js).
export const ROLLEN = [
  ["teilnehmende", "Teilnehmende"],
  ["leitung", "Gruppenleitung"],
  ["stufenleitung", "Stufenleitung"],
];

// Nur Stufen haben die Rollen Gruppenleitung und Stufenleitung
export const hatRollen = (tag) => tag.typ === "stufe";

// Auswahl für eine Stufe: «Alle» (start fehlt) oder eine Auswahl der Rollen. Ohne Haken bei einer Rolle gilt wieder «Alle»: Die Auswahl ist nie leer.
// hilfe: was «Teilnehmende» hier heisst. wert(): undefined für alle, sonst die Liste
export function rollenWahl(name, start, hilfe) {
  const box = (wert, text) => {
    const id = neueId("rolle");
    const eingabe = el("input", { type: "checkbox", id, value: wert });
    return {
      eingabe,
      wurzel: el(
        "div",
        { class: "wahl" },
        eingabe,
        el("label", { for: id }, text),
      ),
    };
  };
  const alle = box("alle", "Alle");
  const einzeln = ROLLEN.map(([w, t]) => box(w, t));
  const keine = () => !einzeln.some((b) => b.eingabe.checked);
  alle.eingabe.addEventListener("change", () => {
    if (alle.eingabe.checked)
      for (const b of einzeln) b.eingabe.checked = false;
    else if (keine()) alle.eingabe.checked = true;
  });
  for (const b of einzeln) {
    b.eingabe.addEventListener("change", () => {
      if (b.eingabe.checked) alle.eingabe.checked = false;
      else if (keine()) alle.eingabe.checked = true;
    });
  }
  const hilfeId = neueId("rollen-hilfe");
  const wurzel = el(
    "fieldset",
    { class: "sicht-rollen", "aria-describedby": hilfeId },
    el("legend", {}, `Wer in «${name}» sieht es?`),
    el(
      "div",
      { class: "sicht-rollen-wahl" },
      alle.wurzel,
      einzeln.map((b) => b.wurzel),
    ),
    el(
      "p",
      { class: "hilfe", id: hilfeId },
      `${hilfe} Die Stufenleitung sieht auch, was die Gruppenleitung sieht.`,
    ),
  );
  const setze = (rollen) => {
    alle.eingabe.checked = !rollen;
    for (const b of einzeln)
      b.eingabe.checked = !!rollen?.includes(b.eingabe.value);
  };
  setze(start);
  return {
    wurzel,
    setze,
    wert: () =>
      alle.eingabe.checked
        ? undefined
        : einzeln.filter((b) => b.eingabe.checked).map((b) => b.eingabe.value),
  };
}

// Die Rollen der gewählten Stufen für die API: [[tagId, rollenWahl], …]; ohne Einschränkung undefined (die ganze Gruppe wie bisher)
export function rollenWert(wahlen) {
  const rollen = {};
  for (const [id, wahl] of wahlen) {
    const wert = wahl.wert();
    if (wert) rollen[id] = wert;
  }
  return Object.keys(rollen).length > 0 ? rollen : undefined;
}

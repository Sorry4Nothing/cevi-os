import { avatar, el, icon, knopf } from "./dom.js";

// Gemeinsames für die drei Reiter von «Rollen und Rechte» (#623, #651)

export const ADRESSE = "#personen/rechte";
export const adresse = (...teile) =>
  [ADRESSE, ...teile.filter(Boolean)].join("/");

// «← Alle Gruppen» über dem Inhalt einer Unterseite
export const zurueckLink = (text, href) =>
  el(
    "a",
    { class: "knopf knopf--still knopf--klein rr-zurueck", href },
    icon("zurueck"),
    text,
  );

// Die Person für Listen: Bild oder Initialen, Name, Zusatz (Benutzername)
export const kandidatVon = (p) => ({
  id: p.id,
  name: p.name,
  zusatz: [p.ceviName, p.benutzername].filter(Boolean).join(" · ") || undefined,
  bildUrl: p.bildUrl,
});

export function personKopf(p, ...rest) {
  return el(
    "div",
    { class: "wer" },
    avatar(p.name, { hell: true, bildUrl: p.bildUrl }),
    el(
      "div",
      {},
      el("span", { class: "name" }, p.name),
      p.zusatz && el("span", { class: "klein leise" }, p.zusatz),
    ),
    ...rest,
  );
}

// Eine Rückfrage am Ort statt eines Popups: eine Zeile in `ort` mit Text und zwei Knöpfen; es steht höchstens eine
// Fokus geht auf «Bestätigen»; Esc oder «Abbrechen» nimmt sie zurück und gibt den Fokus zurück
export function bestaetigeAmOrt(ort, { text, ok, aktion, zurueckFokus }) {
  ort.querySelector(".rr-frage")?.remove();
  const bestaetigen = knopf(ok, { klein: true, art: "haupt" });
  const abbrechen = knopf("Abbrechen", { klein: true, art: "still" });
  const frage = el(
    "div",
    { class: "hinweis hinweis--warn rr-frage", role: "alert" },
    el("span", {}, text),
    el("span", { class: "rr-frage-knoepfe" }, bestaetigen, abbrechen),
  );
  const zu = () => {
    frage.remove();
    zurueckFokus?.focus();
  };
  abbrechen.addEventListener("click", zu);
  frage.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      zu();
    }
  });
  bestaetigen.addEventListener("click", async () => {
    bestaetigen.disabled = abbrechen.disabled = true;
    bestaetigen.setAttribute("aria-busy", "true");
    try {
      await aktion();
    } finally {
      frage.remove();
    }
  });
  ort.prepend(frage);
  bestaetigen.focus();
  return frage;
}

// Hängt Knoten an und lässt false, null und undefined weg (append() schriebe sie als Text)
export const haenge = (ziel, ...kinder) =>
  ziel.append(...kinder.filter(Boolean));

// Anzeige für eine Anzahl: «1 Person», «3 Personen»
export const personen = (n) => (n === 1 ? "1 Person" : `${n} Personen`);

// Typ der Gruppe in Klartext (Tags heissen in der Oberfläche Gruppen)
export const GRUPPENTYP = {
  stufe: "Stufe",
  funktion: "Funktion",
  team: "Team",
  lager: "Lager",
  anlass: "Anlass",
};
export const typText = (typ) => GRUPPENTYP[typ] ?? typ;

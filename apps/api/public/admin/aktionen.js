// Knöpfe mit mehr als einer Aktion (#578): der geteilte Knopf (Hauptaktion mit Menü der Varianten) und die Bestätigung am Ort (Knopf wächst zu einer kleinen Karte, kein Popup).
import { el, icon, knopf, neueId } from "./dom.js";

// Geteilter Knopf: links die Hauptaktion, rechts ein Pfeil, der die Varianten öffnet (role="menu", Pfeiltasten, Pos1/Ende, Escape, Tippen springt).
// eintraege: [{ text, onclick, gefaehrlich?, gesperrt? }]; art wie bei knopf() («haupt», «blau», …)
export function splitKnopf({ text, onclick, art, symbol, eintraege, kontext }) {
  const id = neueId("split");
  const haupt = knopf(text, { art, symbol, kontext, onclick });
  const oeffner = el(
    "button",
    {
      type: "button",
      class: `knopf split-oeffner${art ? ` knopf--${art}` : ""}`,
      "aria-label": `Weitere Aktionen${kontext ? `: ${kontext}` : ""}`,
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      "aria-controls": `${id}-menue`,
    },
    icon("runter"),
  );
  const liste = el("ul", {
    class: "split-menue",
    id: `${id}-menue`,
    role: "menu",
    hidden: true,
  });
  const knoepfe = eintraege.map((e) =>
    el(
      "button",
      {
        type: "button",
        role: "menuitem",
        tabindex: "-1",
        class: `split-eintrag${e.gefaehrlich ? " split-eintrag--gefahr" : ""}`,
        disabled: e.gesperrt,
        onclick: () => {
          schliesse(true);
          e.onclick();
        },
      },
      e.text,
    ),
  );
  for (const k of knoepfe) liste.append(el("li", { role: "none" }, k));
  const wurzel = el("div", { class: "split" }, haupt, oeffner, liste);
  const offen = () => !liste.hidden;
  const frei = () => knoepfe.filter((k) => !k.disabled);
  function oeffne(auf = 0) {
    liste.hidden = false;
    oeffner.setAttribute("aria-expanded", "true");
    frei().at(auf)?.focus();
    document.addEventListener("pointerdown", aussen, true);
  }
  function schliesse(fokus) {
    liste.hidden = true;
    oeffner.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", aussen, true);
    if (fokus) oeffner.focus();
  }
  const aussen = (e) => {
    if (!wurzel.contains(e.target)) schliesse(false);
  };
  oeffner.addEventListener("click", () =>
    offen() ? schliesse(true) : oeffne(0),
  );
  oeffner.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      oeffne(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      oeffne(-1);
    }
  });
  liste.addEventListener("keydown", (e) => {
    const alle = frei();
    const i = alle.indexOf(document.activeElement);
    if (e.key === "ArrowDown") alle[(i + 1) % alle.length]?.focus();
    else if (e.key === "ArrowUp")
      alle[(i - 1 + alle.length) % alle.length]?.focus();
    else if (e.key === "Home") alle[0]?.focus();
    else if (e.key === "End") alle.at(-1)?.focus();
    else if (e.key === "Escape") {
      e.stopPropagation();
      schliesse(true);
    } else if (e.key === "Tab") {
      schliesse(false);
      return;
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const treffer =
        alle.find(
          (k, j) =>
            j > i &&
            k.textContent.toLowerCase().startsWith(e.key.toLowerCase()),
        ) ??
        alle.find((k) =>
          k.textContent.toLowerCase().startsWith(e.key.toLowerCase()),
        );
      treffer?.focus();
    } else return;
    e.preventDefault();
  });
  return { wurzel, haupt, schliesse };
}

// Bestätigung am Ort: «Löschen» wächst zu einer kleinen Karte mit der Frage, was passiert, und «Abbrechen»/«Endgültig löschen».
// Mit erwartet (z. B. dem Namen) muss der Text getippt werden, bevor der Knopf freigegeben wird (Lager löschen). Fokus liegt auf «Abbrechen» (oder dem Feld), Escape bricht ab und der Fokus kehrt zum Knopf zurück.
// ausfuehren() darf werfen; die Meldung steht in der Karte. Sonst bleibt der Normalfall der Toast mit Rückgängig (ctx.mitRueckgaengig): Diese Karte ist für Aktionen, die nicht verzögert werden dürfen oder eine Eingabe brauchen.
export function bestaetigungAmOrt({
  text,
  frage,
  folge,
  bestaetigenText = text,
  symbol,
  klein,
  erwartet,
  ausfuehren,
  fehlertext = (f) => f?.message ?? "Das hat nicht geklappt.",
}) {
  const id = neueId("amort");
  const ausloeser = knopf(text, {
    art: "gefahr",
    symbol,
    klein,
    "aria-expanded": "false",
    "aria-controls": id,
  });
  const karte = el("div", {
    class: "amort",
    id,
    role: "group",
    "aria-labelledby": `${id}-frage`,
    hidden: true,
  });
  const wurzel = el("div", { class: "amort-wurzel" }, ausloeser, karte);
  const status = el("p", { class: "nur-leser", role: "status" });
  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
  });
  const abbrechen = knopf("Abbrechen", { onclick: () => zu(true) });
  const los = knopf(bestaetigenText, {
    art: "gefahr",
    disabled: Boolean(erwartet),
  });
  let eingabe = null;
  karte.append(
    el("p", { class: "fett", id: `${id}-frage` }, frage),
    folge && el("p", { class: "leise klein", id: `${id}-folge` }, folge),
  );
  // Der Screenreader liest mit der Frage auch, was verloren geht
  if (folge) karte.setAttribute("aria-describedby", `${id}-folge`);
  if (erwartet) {
    const eid = `${id}-eingabe`;
    eingabe = el("input", {
      class: "eingabe",
      id: eid,
      type: "text",
      autocomplete: "off",
      spellcheck: "false",
      "aria-describedby": `${id}-hilfe`,
    });
    eingabe.addEventListener("input", () => {
      los.disabled = eingabe.value.trim() !== erwartet;
    });
    // Enter löst nie das Formular um die Karte aus (etwa «Person speichern»); bei richtigem Text bestätigt es
    eingabe.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (!los.disabled) los.click();
    });
    karte.append(
      el(
        "div",
        { class: "feld" },
        el("label", { for: eid }, `Tippe «${erwartet}» zur Bestätigung`),
        eingabe,
        el(
          "p",
          { class: "hilfe", id: `${id}-hilfe` },
          "Das Löschen lässt sich nicht rückgängig machen.",
        ),
      ),
    );
  }
  karte.append(
    fehler,
    el("div", { class: "amort-knoepfe" }, abbrechen, los),
    status,
  );
  function auf() {
    karte.hidden = false;
    ausloeser.hidden = true;
    ausloeser.setAttribute("aria-expanded", "true");
    status.textContent = frage;
    (eingabe ?? abbrechen).focus();
  }
  function zu(fokus) {
    karte.hidden = true;
    ausloeser.hidden = false;
    ausloeser.setAttribute("aria-expanded", "false");
    fehler.hidden = true;
    if (eingabe) eingabe.value = "";
    los.disabled = Boolean(erwartet);
    if (fokus) ausloeser.focus();
  }
  ausloeser.addEventListener("click", auf);
  karte.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      zu(true);
    }
  });
  los.addEventListener("click", async () => {
    los.disabled = abbrechen.disabled = true;
    los.setAttribute("aria-busy", "true");
    try {
      await ausfuehren();
    } catch (f) {
      fehler.textContent = fehlertext(f);
      fehler.hidden = false;
      fehler.focus?.();
      los.disabled = eingabe ? eingabe.value.trim() !== erwartet : false;
      abbrechen.disabled = false;
      los.removeAttribute("aria-busy");
    }
  });
  return { wurzel, ausloeser, zu };
}

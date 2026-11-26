// Eigenes Auswahlfeld der Website (#564). Das <select> bleibt im Dokument: Es hält den Wert, sendet ihn mit dem Formular und meldet «change» wie bisher. Ohne Skript bleibt es das Feld des Browsers.
// Das Skript stellt eine Schaltfläche (role="combobox") und eine Liste (role="listbox") daneben, nach dem Muster «Select-Only Combobox» der ARIA Authoring Practices: Pfeiltasten, Pos1, Ende, Bild auf/ab, Eingabe, Leertaste, Escape, Tab, Tippen zum Springen.
// Kein style-Attribut und kein HTML aus Text (CSP). Stil: auswahl.css.

const SVG = "http://www.w3.org/2000/svg";
const TIPP_PAUSE_MS = 600;
let nummer = 0;

// Reine Funktion (testbar): Index der nächsten Option, deren Name mit dem Getippten beginnt; gleiche Buchstaben hintereinander («aaa») blättern durch die Treffer. -1 ohne Treffer
export function sucheTreffer(namen, getippt, ab, gesperrt = []) {
  const text = getippt.toLocaleLowerCase("de-CH");
  const gleich = [...text].every((z) => z === text[0]);
  const such = gleich ? text[0] : text;
  // Bei einem einzelnen Buchstaben nach der aktuellen Option weitersuchen, sonst bei ihr beginnen
  const start = gleich ? ab + 1 : ab;
  for (let n = 0; n < namen.length; n++) {
    const i = (((start + n) % namen.length) + namen.length) % namen.length;
    if (
      !gesperrt[i] &&
      namen[i].trim().toLocaleLowerCase("de-CH").startsWith(such)
    ) {
      return i;
    }
  }
  return -1;
}

function symbol(doc, klasse, pfad, gefuellt) {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", klasse);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = doc.createElementNS(SVG, "path");
  p.setAttribute("d", pfad);
  if (gefuellt) p.setAttribute("class", "f");
  svg.append(p);
  return svg;
}

// Zustand des <select>, den Hilfstechnik an der Schaltfläche hören muss. Ein Formular setzt und löscht aria-invalid und aria-describedby bei Fehlern (formular.js, #887): Die Schaltfläche übernimmt jede Änderung
const GESPIEGELT = ["aria-describedby", "aria-invalid", "aria-required"];
export function spiegle(select, knopf) {
  for (const n of GESPIEGELT) {
    if (select.hasAttribute(n)) knopf.setAttribute(n, select.getAttribute(n));
    else knopf.removeAttribute(n);
  }
  if (select.required) knopf.setAttribute("aria-required", "true");
  knopf.disabled = select.disabled;
}

export function verbessere(select) {
  if (select.multiple || select.dataset.auswahl !== undefined) return;
  select.dataset.auswahl = "";
  const doc = select.ownerDocument;
  const fenster = doc.defaultView;
  const id = `aw-${++nummer}`;

  const huelle = doc.createElement("div");
  huelle.className = "aw";
  const knopf = doc.createElement("button");
  knopf.type = "button";
  knopf.className = "aw-knopf";
  knopf.id = `${id}-k`;
  knopf.setAttribute("role", "combobox");
  knopf.setAttribute("aria-haspopup", "listbox");
  knopf.setAttribute("aria-expanded", "false");
  knopf.setAttribute("aria-controls", `${id}-l`);
  if (select.dataset.f) knopf.dataset.f = select.dataset.f;
  const wert = doc.createElement("span");
  wert.className = "aw-wert";
  // Dreieck aus dem Symbolsatz der Website (symbole.ts «dreieck»)
  knopf.append(wert, symbol(doc, "i aw-dreieck", "M6.5 9.5h11L12 16z", true));
  const liste = doc.createElement("ul");
  liste.className = "aw-liste";
  liste.id = `${id}-l`;
  liste.setAttribute("role", "listbox");
  liste.hidden = true;

  // labels ist leer, solange das Feld noch nicht im Dokument steht (dom.js «auswahl» verbessert vor dem Einhängen): dann das Label im selben Baum
  const label =
    select.labels?.[0] ??
    (select.id
      ? select.getRootNode().querySelector?.(`label[for="${select.id}"]`)
      : null);
  if (label) {
    label.id ||= `${id}-b`;
    knopf.setAttribute("aria-labelledby", label.id);
    liste.setAttribute("aria-labelledby", label.id);
  } else if (select.getAttribute("aria-label")) {
    knopf.setAttribute("aria-label", select.getAttribute("aria-label"));
    liste.setAttribute("aria-label", select.getAttribute("aria-label"));
  }
  spiegle(select, knopf);

  let aktiv = -1;
  let getippt = "";
  let tippUhr = 0;
  const optionen = () => [...liste.children];
  const gesperrt = (i) => select.options[i]?.disabled ?? true;

  // Eine Option kann ein Bild vor dem Namen tragen (data-bild, #578: Symbole der Stufen in der Verwaltung)
  function bildVon(o) {
    if (!o?.dataset.bild) return null;
    const b = doc.createElement("img");
    b.className = "aw-bild";
    b.alt = "";
    b.src = o.dataset.bild;
    return b;
  }
  function zeige() {
    const gewaehlt = select.selectedOptions[0];
    wert.textContent = gewaehlt?.textContent ?? "";
    const bild = bildVon(gewaehlt);
    if (bild) wert.prepend(bild);
    optionen().forEach((o, i) =>
      o.setAttribute(
        "aria-selected",
        i === select.selectedIndex ? "true" : "false",
      ),
    );
  }
  function baueListe() {
    liste.replaceChildren(
      ...[...select.options].map((o, i) => {
        const li = doc.createElement("li");
        li.id = `${id}-o${i}`;
        li.setAttribute("role", "option");
        if (o.disabled) li.setAttribute("aria-disabled", "true");
        const name = doc.createElement("span");
        name.textContent = o.textContent;
        const bild = bildVon(o);
        if (bild) name.prepend(bild);
        // Der Haken zeigt die gewählte Option, nicht nur die Farbe
        li.append(name, symbol(doc, "i aw-haken", "m5 12 5 5 9-10", false));
        return li;
      }),
    );
    zeige();
  }
  function setzeAktiv(i) {
    if (i < 0 || i >= select.options.length) return;
    optionen()[aktiv]?.classList.remove("aktiv");
    aktiv = i;
    const o = optionen()[i];
    o.classList.add("aktiv");
    knopf.setAttribute("aria-activedescendant", o.id);
    o.scrollIntoView?.({ block: "nearest" });
  }
  // Nächste wählbare Option in eine Richtung; bleibt stehen, wenn es keine gibt
  function schritt(von, richtung, weite = 1) {
    let ziel = von;
    for (let i = von + richtung, n = 0; i >= 0 && i < select.options.length;) {
      if (!gesperrt(i)) {
        ziel = i;
        if (++n >= weite) break;
      }
      i += richtung;
    }
    return ziel;
  }
  const offen = () => !liste.hidden;
  const aussen = (e) => {
    if (!huelle.contains(e.target)) schliesse();
  };
  function oeffne(start) {
    if (knopf.disabled || select.options.length === 0) return;
    if (!offen()) {
      liste.hidden = false;
      knopf.setAttribute("aria-expanded", "true");
      huelle.classList.remove("oben", "rechts");
      // Kein Abschneiden am Fensterrand: nach oben klappen, wenn unten der Platz fehlt und oben mehr ist; rechts ausrichten, wenn die Liste rechts hinausragt
      const k = knopf.getBoundingClientRect();
      const l = liste.getBoundingClientRect();
      const unten = fenster.innerHeight - k.bottom;
      huelle.classList.toggle("oben", l.height > unten && k.top > unten);
      huelle.classList.toggle(
        "rechts",
        l.right > doc.documentElement.clientWidth,
      );
      doc.addEventListener("pointerdown", aussen, true);
    }
    const i = start ?? select.selectedIndex;
    setzeAktiv(gesperrt(i) ? schritt(-1, 1) : i);
  }
  function schliesse() {
    if (!offen()) return;
    liste.hidden = true;
    knopf.setAttribute("aria-expanded", "false");
    knopf.removeAttribute("aria-activedescendant");
    optionen()[aktiv]?.classList.remove("aktiv");
    aktiv = -1;
    doc.removeEventListener("pointerdown", aussen, true);
  }
  function waehle(i) {
    if (i < 0 || gesperrt(i)) return;
    schliesse();
    if (select.selectedIndex === i) return;
    select.selectedIndex = i;
    zeige();
    // Wie beim Feld des Browsers: Wer auf das <select> hört, merkt keinen Unterschied
    select.dispatchEvent(new fenster.Event("input", { bubbles: true }));
    select.dispatchEvent(new fenster.Event("change", { bubbles: true }));
  }
  function tippe(zeichen) {
    fenster.clearTimeout(tippUhr);
    getippt += zeichen;
    tippUhr = fenster.setTimeout(() => (getippt = ""), TIPP_PAUSE_MS);
    const i = sucheTreffer(
      [...select.options].map((o) => o.textContent),
      getippt,
      Math.max(aktiv, 0),
      [...select.options].map((o) => o.disabled),
    );
    if (i >= 0) setzeAktiv(i);
  }

  knopf.addEventListener("click", () => {
    // Safari gibt einer Schaltfläche beim Klick keinen Fokus: Ohne ihn kämen keine Tasten an
    knopf.focus();
    if (offen()) schliesse();
    else oeffne();
  });
  knopf.addEventListener("blur", schliesse);
  knopf.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey) return;
    const z = e.key;
    const buchstabe = z.length === 1 && (z !== " " || getippt !== "");
    if (!offen()) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(z)) oeffne();
      else if (z === "Home") oeffne(schritt(-1, 1));
      else if (z === "End") oeffne(schritt(select.options.length, -1));
      else if (buchstabe) {
        oeffne();
        tippe(z);
      } else return;
      e.preventDefault();
      return;
    }
    if (z === "Tab") {
      // Tab übernimmt die Wahl und geht weiter
      waehle(aktiv);
      return;
    }
    if (buchstabe) tippe(z);
    else if (z === "ArrowUp" && e.altKey) waehle(aktiv);
    else if (z === "ArrowDown") setzeAktiv(schritt(aktiv, 1));
    else if (z === "ArrowUp") setzeAktiv(schritt(aktiv, -1));
    else if (z === "PageDown") setzeAktiv(schritt(aktiv, 1, 10));
    else if (z === "PageUp") setzeAktiv(schritt(aktiv, -1, 10));
    else if (z === "Home") setzeAktiv(schritt(-1, 1));
    else if (z === "End") setzeAktiv(schritt(select.options.length, -1));
    else if (z === "Enter" || z === " ") waehle(aktiv);
    else if (z === "Escape") schliesse();
    else return;
    // Escape schliesst nur die Liste, nicht den Dialog darum herum
    e.preventDefault();
    e.stopPropagation();
  });
  // Der Fokus bleibt auf der Schaltfläche, auch beim Klick in die Liste
  liste.addEventListener("mousedown", (e) => e.preventDefault());
  liste.addEventListener("click", (e) => {
    const o = e.target.closest?.('[role="option"]');
    if (o) waehle(optionen().indexOf(o));
  });
  liste.addEventListener("pointermove", (e) => {
    const i = optionen().indexOf(e.target.closest?.('[role="option"]'));
    if (i >= 0 && i !== aktiv && !gesperrt(i)) setzeAktiv(i);
  });

  // Das <select> bleibt für Formular und Wert, ist aber weder sichtbar noch in der Tab-Reihenfolge; Fokus darauf (Klick aufs Label, Meldung des Formulars) geht an die Schaltfläche
  select.classList.add("aw-nativ");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.addEventListener("focus", () => knopf.focus());
  select.addEventListener("change", zeige);
  select.form?.addEventListener("reset", () => fenster.setTimeout(zeige));
  // Ändert ein Skript die Optionen, sperrt das Feld (disabled, #578) oder meldet einen Fehler (aria-invalid, #887), folgt die Schaltfläche
  new fenster.MutationObserver((aenderungen) => {
    spiegle(select, knopf);
    // Die Liste nur neu bauen, wenn sich die Optionen ändern (auch eine gesperrte Option): Ein Fehler kommt auch bei offener Liste nicht dazwischen
    if (
      aenderungen.some(
        (m) => m.type !== "attributes" || m.attributeName === "disabled",
      )
    ) {
      baueListe();
    }
  }).observe(select, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["disabled", "required", ...GESPIEGELT],
  });

  baueListe();
  huelle.append(knopf, liste);
  const fokus = doc.activeElement === select;
  select.after(huelle);
  if (fokus) knopf.focus();
}

// Wertet alle Auswahlfelder im Dokument auf, auch solche, die ein Skript später einsetzt. «data-nativ» am <select> lässt eines aus
export function starte(doc) {
  const alle = (wurzel) => {
    if (wurzel.nodeType !== 1) return;
    if (wurzel.matches("select:not([data-nativ])")) verbessere(wurzel);
    wurzel.querySelectorAll("select:not([data-nativ])").forEach(verbessere);
  };
  alle(doc.documentElement);
  new doc.defaultView.MutationObserver((liste) => {
    for (const m of liste) m.addedNodes.forEach(alle);
  }).observe(doc.documentElement, { childList: true, subtree: true });
}

if (typeof document !== "undefined" && document.documentElement) {
  starte(document);
}
// Die Verwaltung stellt Felder, die sie selbst baut, sofort um (und nicht erst nach dem Einsetzen, #578)
if (typeof window !== "undefined") window.ceviAuswahl = { verbessere };

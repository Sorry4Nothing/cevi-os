import { anfrage, fehlertext } from "./api.js";
import { avatar, el, icon, knopf, neueId } from "./dom.js";

// Personenwahl mit Foto (#760) für die Bausteine «Personen», «Kontaktperson» und «Kontaktkarte», dazu die Anzeige beim «Leitungsteam».
// Die Auswahl ist ein Kombinationsfeld nach WAI-ARIA (APG «Combobox with listbox popup»): Das Feld ist ein einzelnes `input` mit Rolle combobox, der Fokus bleibt darin, die Zeilen der Liste erhalten ihn nie (aria-activedescendant).
// Bis 8 Personen ist das Feld schreibgeschützt (Tippen springt zum Namen), ab 9 ist es ein Suchfeld (Tippen filtert). Die Bilder sind dekorativ (alt=""), der Name steht daneben; sie laden einzeln und erst, wenn die Zeile sichtbar wird (loading="lazy").
// Die Bilder liefert GET /api/v1/redaktion/personen/:id/bild, nur für Personen, die auf der Website erscheinen dürfen. Kein HTML aus Text: alles Knoten.

const API = "/api/v1/redaktion";
export const SUCHE_AB = 9;
export const PERSON_HILFE =
  "Nur Leitende erscheinen auf der Website. Kinder und andere Personen stehen hier nicht zur Auswahl.";
export const FUNKTIONEN = {
  stufenleitung: "Stufenleitung",
  leitung: "Leitung",
};
export const VERALTET = "Bisherige Person (nicht mehr wählbar)";
const AKZENTE = /[̀-ͯ]/g;

// Kleinbuchstaben ohne Akzente: «Zoë» findet man mit «zoe»
const falte = (text) =>
  String(text).normalize("NFD").replace(AKZENTE, "").toLocaleLowerCase("de-CH");

// Die zweite Zeile einer Person: «Stufenleitung, Pilami»
export const personNeben = (p) =>
  `${FUNKTIONEN[p.funktion] ?? p.funktion}, ${p.gruppe}`;

// Reine Funktion (testbar): die Personen, deren Name, Funktion und Gruppe alle Wörter der Eingabe enthalten
export function filterePersonen(personen, text) {
  const woerter = falte(text).split(/\s+/).filter(Boolean);
  if (woerter.length === 0) return personen;
  return personen.filter((p) => {
    const heu = falte(`${p.anzeigename} ${personNeben(p)}`);
    return woerter.every((w) => heu.includes(w));
  });
}

// Reine Funktion (testbar): der Satz unter der Gruppenwahl des Leitungsteams, aus der Antwort von GET /redaktion/leitungsteam.
// «Zeigt 4 Personen der Gruppe Pilami: Stufenleitung: Anna, Ben; Leitung: Clara, Dani.» Gleiche Funktionen hintereinander stehen zusammen
export function teamText(team) {
  const n = team.personen.length;
  if (n === 0) {
    return team.stufe
      ? "In dieser Gruppe gibt es keine Leitenden, der Baustein bleibt leer."
      : "In dieser Gruppe gibt es niemanden mit Cevi-Namen, der Baustein bleibt leer.";
  }
  const gruppen = [];
  for (const p of team.personen) {
    const letzte = gruppen.at(-1);
    if (letzte && letzte.funktion === (p.funktion ?? "")) {
      letzte.namen.push(p.anzeigename);
    } else {
      gruppen.push({ funktion: p.funktion ?? "", namen: [p.anzeigename] });
    }
  }
  const teile = gruppen.map((g) =>
    g.funktion ? `${g.funktion}: ${g.namen.join(", ")}` : g.namen.join(", "),
  );
  return `Zeigt ${n === 1 ? "1 Person" : `${n} Personen`} der Gruppe ${team.gruppe}: ${teile.join("; ")}.`;
}

// --- Daten, je Editor einmal geladen --------------------------------------------------------------------------------

// Die Leitenden zur Auswahl; k.personen ist { laden, liste }
export function ladePersonen(k) {
  k.personen.laden ??= anfrage("GET", `${API}/personen`).then(
    (antwort) => {
      for (const p of antwort.personen) k.personNamen.set(p.id, p.anzeigename);
      k.personen.liste = antwort.personen;
      return antwort.personen;
    },
    (f) => {
      k.personen.laden = null;
      throw f;
    },
  );
  return k.personen.laden;
}

// Wer in einem Leitungsteam erscheint; k.teams ist { laden: Map, stand: Map } (Stand = die Antwort, für die Zeile der Bausteinliste)
export function ladeTeam(k, tagId) {
  if (!k.teams.laden.has(tagId)) {
    k.teams.laden.set(
      tagId,
      anfrage(
        "GET",
        `${API}/leitungsteam?tag=${encodeURIComponent(tagId)}`,
      ).then(
        (antwort) => {
          k.teams.stand.set(tagId, antwort);
          return antwort;
        },
        (f) => {
          k.teams.laden.delete(tagId);
          throw f;
        },
      ),
    );
  }
  return k.teams.laden.get(tagId);
}

// --- Die Auswahl --------------------------------------------------------------------------------------------------------

// personen: [{ id, anzeigename, funktion, gruppe, bildUrl }]; wert: die gewählte ID oder ""; veraltet: die gewählte Person steht nicht mehr zur Auswahl; optional: «Keine Person» ist möglich
// beiWahl(id): "" heisst «Keine Person». Liefert { wurzel, eingabe }; eingabe ist das Feld mit Fokus (für Fehler)
export function personenAuswahl({
  label,
  personen,
  wert = "",
  veraltet = false,
  optional = false,
  hilfeId,
  beiWahl,
}) {
  const id = neueId("personwahl");
  const listeId = `${id}-liste`;
  const labelId = `${id}-label`;
  const suche = personen.length >= SUCHE_AB;
  const nachId = new Map(personen.map((p) => [p.id, p]));
  let gewaehlt = wert;
  let filter = "";
  let zeilen = [];
  let aktiv = -1;
  let getippt = "";
  let tippUhr = 0;

  const leerText = optional
    ? "Keine Person"
    : personen.length > 0
      ? "Person wählen"
      : "Niemand zur Auswahl";
  const eingabe = el("input", {
    id,
    type: "text",
    role: "combobox",
    class: "pw-eingabe",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    readonly: !suche,
    "aria-haspopup": "listbox",
    "aria-expanded": "false",
    "aria-controls": listeId,
    "aria-autocomplete": suche ? "list" : "none",
    "aria-describedby": hilfeId,
    placeholder: leerText,
  });
  const marke = el("span", { class: "pw-gewaehlt", "aria-hidden": "true" });
  const pfeil = el(
    "span",
    { class: "pw-pfeil", "aria-hidden": "true" },
    icon("runter"),
  );
  const liste = el("ul", {
    id: listeId,
    class: "pw-liste",
    role: "listbox",
    "aria-labelledby": labelId,
  });
  const leer = el("p", { class: "pw-leer", hidden: true });
  const popup = el("div", { class: "pw-popup", hidden: true }, liste, leer);
  const ansage = el("p", {
    class: "nur-leser",
    role: "status",
    "aria-live": "polite",
  });
  const feld = el("div", { class: "pw-feld" }, marke, eingabe, pfeil, popup);
  const wurzel = el(
    "div",
    { class: "feld pw" },
    el("label", { for: id, id: labelId }, label),
    feld,
    ansage,
  );

  const offen = () => !popup.hidden;
  const gewaehlteZeile = () => nachId.get(gewaehlt);

  // Der Name im Feld und das Foto davor
  function zeigeWahl() {
    const p = gewaehlteZeile();
    const bisherig = veraltet && gewaehlt !== "" && !p;
    eingabe.value = p ? p.anzeigename : bisherig ? VERALTET : "";
    feld.classList.toggle("pw-feld--leer", !p && !bisherig);
    marke.replaceChildren(
      ...(p
        ? [avatar(p.anzeigename, { hell: true, bildUrl: p.bildUrl })]
        : bisherig
          ? [avatar("?", { hell: true })]
          : []),
    );
  }

  const sichtbareZeilen = () => {
    const treffer = filterePersonen(personen, filter);
    return [
      ...(optional && filter.trim() === "" ? [{ wert: "", person: null }] : []),
      ...treffer.map((p) => ({ wert: p.id, person: p })),
    ];
  };

  function zeichneListe() {
    zeilen = sichtbareZeilen();
    liste.replaceChildren(
      ...zeilen.map((z, i) =>
        el(
          "li",
          {
            id: `${id}-o${i}`,
            class: "pw-option",
            role: "option",
            "aria-selected": String(z.wert === gewaehlt),
            // Die Maus nimmt den Fokus nie aus dem Feld
            onmousedown: (e) => e.preventDefault(),
            onclick: () => waehle(i),
            onpointermove: () => aktiv !== i && setzeAktiv(i),
          },
          z.person
            ? avatar(z.person.anzeigename, {
                hell: true,
                bildUrl: z.person.bildUrl,
              })
            : el(
                "span",
                { class: "ava ava--hell", "aria-hidden": "true" },
                icon("minus"),
              ),
          el(
            "span",
            { class: "pw-text" },
            el(
              "span",
              { class: "pw-name" },
              z.person?.anzeigename ?? "Keine Person",
            ),
            z.person &&
              el("span", { class: "pw-neben" }, personNeben(z.person)),
          ),
          el(
            "span",
            { class: "pw-haken", "aria-hidden": "true" },
            icon("haken"),
          ),
        ),
      ),
    );
    liste.hidden = zeilen.length === 0;
    leer.hidden = zeilen.length > 0;
    leer.textContent =
      personen.length === 0 ? "Niemand zur Auswahl." : "Keine Person gefunden.";
  }

  function setzeAktiv(i) {
    for (const [n, o] of [...liste.children].entries()) {
      o.classList.toggle("aktiv", n === i);
    }
    aktiv = i;
    const o = liste.children[i];
    if (o) {
      eingabe.setAttribute("aria-activedescendant", o.id);
      o.scrollIntoView?.({ block: "nearest" });
    } else eingabe.removeAttribute("aria-activedescendant");
  }

  // markiere: den Namen im Feld markieren, damit die erste Eingabe ihn ersetzt (nicht, wenn die Eingabe die Liste öffnet)
  function oeffne({ markiere = true } = {}) {
    if (offen()) return;
    filter = "";
    zeichneListe();
    popup.style.translate = "";
    popup.hidden = false;
    eingabe.setAttribute("aria-expanded", "true");
    feld.classList.add("pw-feld--offen");
    // Nach oben klappen, wenn unten der Platz fehlt und oben mehr ist
    popup.classList.remove("oben");
    const f = feld.getBoundingClientRect();
    const p = popup.getBoundingClientRect();
    const unten = window.innerHeight - f.bottom;
    popup.classList.toggle("oben", p.height > unten && f.top > unten);
    // Nie über den Rand des Fensters hinaus: in einem schmalen Feld schiebt sich die Liste ins Bild
    const breite = document.documentElement.clientWidth;
    let dx = Math.min(0, breite - 8 - p.right);
    if (p.left + dx < 8) dx = 8 - p.left;
    popup.style.translate = dx === 0 ? "" : `${dx}px 0`;
    const i = zeilen.findIndex((z) => z.wert === gewaehlt);
    setzeAktiv(i >= 0 ? i : 0);
    if (suche) {
      eingabe.placeholder = "Name suchen";
      if (markiere) eingabe.select();
    }
    ansage.textContent = `${personen.length === 1 ? "1 Person" : `${personen.length} Personen`}. Mit den Pfeiltasten wählen, mit Enter übernehmen.`;
  }

  function schliesse() {
    if (!offen()) return;
    popup.hidden = true;
    eingabe.setAttribute("aria-expanded", "false");
    eingabe.removeAttribute("aria-activedescendant");
    eingabe.placeholder = leerText;
    feld.classList.remove("pw-feld--offen");
    aktiv = -1;
    filter = "";
    // Ohne Wahl kehrt das Feld zur bisherigen Person zurück
    zeigeWahl();
  }

  function waehle(i) {
    const z = zeilen[i];
    if (!z) return;
    const geaendert = z.wert !== gewaehlt;
    gewaehlt = z.wert;
    veraltet = false;
    schliesse();
    ansage.textContent = z.person
      ? `Person gewählt: ${z.person.anzeigename}.`
      : "Keine Person gewählt.";
    if (geaendert) beiWahl(z.wert);
  }

  // Schreibgeschütztes Feld: Tippen springt zum nächsten Namen, der so beginnt (gleiche Buchstaben blättern)
  function springe(zeichen) {
    clearTimeout(tippUhr);
    getippt += zeichen;
    tippUhr = setTimeout(() => (getippt = ""), 600);
    const text = falte(getippt);
    const gleich = [...text].every((z) => z === text[0]);
    const such = gleich ? text[0] : text;
    const start = gleich ? aktiv + 1 : Math.max(aktiv, 0);
    for (let n = 0; n < zeilen.length; n++) {
      const i = (start + n) % zeilen.length;
      const name = zeilen[i].person?.anzeigename ?? "Keine Person";
      if (falte(name).startsWith(such)) return setzeAktiv(i);
    }
  }

  eingabe.addEventListener("click", () =>
    offen() && !suche ? schliesse() : oeffne(),
  );
  eingabe.addEventListener("input", () => {
    if (!suche) return;
    if (!offen()) oeffne({ markiere: false });
    filter = eingabe.value;
    zeichneListe();
    setzeAktiv(zeilen.length > 0 ? 0 : -1);
    ansage.textContent =
      zeilen.length === 0
        ? "Keine Person gefunden."
        : `${zeilen.length === 1 ? "1 Person" : `${zeilen.length} Personen`} gefunden.`;
  });
  eingabe.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey) return;
    const n = zeilen.length;
    const z = e.key;
    if (z === "ArrowDown" || z === "ArrowUp") {
      e.preventDefault();
      if (!offen()) return oeffne();
      if (n === 0) return;
      const schritt = z === "ArrowDown" ? 1 : -1;
      setzeAktiv(aktiv < 0 && schritt < 0 ? n - 1 : (aktiv + schritt + n) % n);
    } else if ((z === "Home" || z === "End") && !suche) {
      e.preventDefault();
      if (!offen()) oeffne();
      setzeAktiv(z === "Home" ? 0 : zeilen.length - 1);
    } else if (z === "Enter" || (z === " " && !suche)) {
      // Enter schickt nie ein Formular ab
      e.preventDefault();
      if (!offen()) oeffne();
      else if (aktiv >= 0) waehle(aktiv);
    } else if (z === "Escape" && offen()) {
      // Schliesst nur die Liste, nicht das Blatt dahinter
      e.preventDefault();
      e.stopPropagation();
      schliesse();
    } else if (z === "Tab") schliesse();
    else if (!suche && z.length === 1) {
      e.preventDefault();
      if (!offen()) oeffne();
      springe(z);
    }
  });
  wurzel.addEventListener("focusout", (e) => {
    if (!wurzel.contains(e.relatedTarget)) schliesse();
  });

  zeigeWahl();
  return { wurzel, eingabe };
}

// --- Das Leitungsteam ------------------------------------------------------------------------------------------------

// Unter der Gruppenwahl: wer bei dieser Gruppe auf der Website erscheint, live vom Server. Eine Statusregion (aria-live), die beim Wechsel der Gruppe ihren Inhalt tauscht; bis die Antwort da ist, bleibt der alte Inhalt stehen, damit nichts springt.
// gruppe(): die gewählte Gruppe (ID) oder undefined. Liefert { wurzel, aktualisiere }
export function teamAnzeige(k, gruppe) {
  const text = el("p", { class: "pw-team-text" });
  const reihe = el("ul", { class: "pw-reihe", "aria-hidden": "true" });
  const wurzel = el(
    "div",
    { class: "pw-team", role: "status", "aria-live": "polite" },
    text,
    reihe,
  );
  let nummer = 0;
  const MAX_BILDER = 12;

  const zeige = (team) => {
    text.textContent = teamText(team);
    const mehr = team.personen.length - MAX_BILDER;
    reihe.replaceChildren(
      ...team.personen
        .slice(0, MAX_BILDER)
        .map((p) =>
          el(
            "li",
            {},
            avatar(p.anzeigename, { hell: true, bildUrl: p.bildUrl }),
          ),
        ),
      ...(mehr > 0 ? [el("li", { class: "pw-mehr" }, `+${mehr}`)] : []),
    );
    reihe.hidden = team.personen.length === 0;
    wurzel.classList.remove("pw-team--lade");
  };

  async function aktualisiere() {
    const meine = ++nummer;
    const tagId = gruppe();
    if (!tagId) {
      text.textContent =
        "Wähle eine Gruppe, dann siehst du hier, wer erscheint.";
      reihe.replaceChildren();
      reihe.hidden = true;
      return;
    }
    const stand = k.teams.stand.get(tagId);
    if (stand) return zeige(stand);
    wurzel.classList.add("pw-team--lade");
    wurzel.setAttribute("aria-busy", "true");
    if (!text.textContent) text.textContent = "Wird geladen …";
    try {
      const team = await ladeTeam(k, tagId);
      if (meine === nummer) zeige(team);
    } catch (f) {
      if (meine !== nummer) return;
      wurzel.classList.remove("pw-team--lade");
      text.textContent = `${fehlertext(f)} `;
      reihe.replaceChildren();
      reihe.hidden = true;
      text.append(
        knopf("Erneut laden", { klein: true, onclick: aktualisiere }),
      );
    } finally {
      if (meine === nummer) wurzel.removeAttribute("aria-busy");
    }
  }
  aktualisiere();
  return { wurzel, aktualisiere };
}

import { anfrage } from "./api.js";
import { el, icon, knopf, neueId } from "./dom.js";

// Adresssuche mit Vorschlägen (#695) als Kombinationsfeld nach WAI-ARIA (APG «Combobox with listbox popup»).
// Der Browser fragt nur den eigenen Server (GET /api/v1/redaktion/orte/suche); dieser fragt die Ortssuche des Bundes. Hier läuft kein Skript und kein Bild von Dritten.
// Aufbau und Verhalten folgen dem Muster «Address Input» von Kokonut UI Pro (Treffer in Tinte, Rest grau, Pfeile, Pos1, Ende, Enter, Esc); Code und Gestalt sind eigen.
const API = "/api/v1/redaktion/orte/suche";
const MIN_ZEICHEN = 3;
const WARTEN_MS = 300;
const SKELETT_ZEILEN = 3;
const TEILER = /[\s,]+/;
const WORTZEICHEN = /[\p{L}\p{N}]/u;
const AKZENTE = /[̀-ͯ]/g;

// Kleinbuchstaben ohne Akzente, ein Zeichen für jedes Zeichen: Positionen bleiben gleich
const falte = (text) =>
  Array.from(text, (z) => (z.normalize("NFD").replace(AKZENTE, "")[0] ?? z).toLowerCase()).join("");

// Welche Zeichen des Texts die Eingabe getroffen hat; Wortanfänge zuerst
function trefferMaske(text, woerter) {
  const gefaltet = falte(text);
  const maske = new Array(gefaltet.length).fill(false);
  for (const wort of woerter) {
    let stelle = gefaltet.indexOf(wort);
    let erste = -1;
    let gefunden = false;
    while (stelle !== -1) {
      if (erste === -1) erste = stelle;
      if (stelle === 0 || !WORTZEICHEN.test(gefaltet[stelle - 1])) {
        maske.fill(true, stelle, stelle + wort.length);
        gefunden = true;
      }
      stelle = gefaltet.indexOf(wort, stelle + 1);
    }
    if (!gefunden && erste !== -1) maske.fill(true, erste, erste + wort.length);
  }
  return maske;
}

// Der Text mit den getroffenen Stellen in Tinte (Knoten, nie HTML aus Text)
function hervorgehoben(text, woerter) {
  const maske = trefferMaske(text, woerter);
  const zeichen = Array.from(text);
  const teile = [];
  zeichen.forEach((z, i) => {
    const treffer = maske[i] === true;
    const letzter = teile.at(-1);
    if (letzter && letzter.treffer === treffer) letzter.text += z;
    else teile.push({ text: z, treffer });
  });
  return teile.map((t) =>
    t.treffer ? el("span", { class: "ort-treffer" }, t.text) : t.text,
  );
}

const MELDUNG = {
  keine: [
    "Keine Adresse gefunden.",
    "Prüfe die Schreibweise oder trage den Standort von Hand ein.",
  ],
  fehler: [
    "Die Adresssuche ist gerade nicht erreichbar.",
    "Du kannst den Standort auch von Hand eintragen.",
  ],
  zuviele: [
    "Zu viele Suchen in kurzer Zeit.",
    "Warte eine Minute oder trage den Standort von Hand ein.",
  ],
};

// beiWahl(vorschlag): ein Vorschlag des Servers {bezeichnung, strasse, plz, ort, breite, laenge}
// Rückgabe: wurzel, eingabe, suche(text) (Text einsetzen und sofort suchen), fokussiere()
export function adressSuche({ label, hilfe, beiWahl }) {
  const id = neueId("ortsuche");
  const listeId = `${id}-liste`;
  const hilfeId = `${id}-hilfe`;
  const eingabe = el("input", {
    id,
    type: "text",
    role: "combobox",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    maxlength: "100",
    enterkeyhint: "search",
    "aria-autocomplete": "list",
    "aria-expanded": "false",
    "aria-controls": listeId,
    "aria-describedby": hilfeId,
  });
  const lupe = el("span", { class: "ort-suche-lupe" }, icon("lupe"));
  const dreher = el("span", { class: "ort-suche-dreher", hidden: true });
  const leeren = el(
    "button",
    {
      type: "button",
      class: "ort-suche-leeren",
      "aria-label": "Suche leeren",
      hidden: true,
    },
    icon("schliessen"),
  );
  const liste = el("ul", {
    id: listeId,
    class: "ort-suche-liste",
    role: "listbox",
    "aria-label": "Vorschläge",
    hidden: true,
  });
  const skelett = el(
    "div",
    { class: "ort-suche-skelett", "aria-hidden": "true", hidden: true },
    Array.from({ length: SKELETT_ZEILEN }, () =>
      el(
        "div",
        { class: "ort-suche-sk-zeile" },
        el("span", { class: "ort-suche-sk ort-suche-sk--lang" }),
        el("span", { class: "ort-suche-sk ort-suche-sk--kurz" }),
      ),
    ),
  );
  const meldung = el("div", { class: "ort-suche-meldung", hidden: true });
  const popup = el(
    "div",
    { class: "ort-suche-popup", hidden: true },
    skelett,
    liste,
    meldung,
  );
  // Ansagen für Screenreader: Zahl der Vorschläge, «keine», Fehler, Wahl
  const ansage = el("p", {
    class: "nur-leser",
    role: "status",
    "aria-live": "polite",
  });
  const wurzel = el(
    "div",
    { class: "feld ort-suche" },
    el("label", { for: id }, label),
    el("div", { class: "ort-suche-feld" }, lupe, eingabe, dreher, leeren, popup),
    hilfe && el("p", { class: "hilfe", id: hilfeId }, hilfe),
    ansage,
  );
  if (!hilfe) eingabe.removeAttribute("aria-describedby");

  let vorschlaege = [];
  let aktiv = -1;
  let uhr = 0;
  let abbruch = null;
  let nummer = 0;
  let woerter = [];

  function setzeAktiv(i) {
    aktiv = i;
    for (const [n, option] of [...liste.children].entries()) {
      option.classList.toggle("aktiv", n === i);
      option.setAttribute("aria-selected", String(n === i));
    }
    if (i < 0) eingabe.removeAttribute("aria-activedescendant");
    else {
      const option = liste.children[i];
      eingabe.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    }
  }

  // zustand: zu | laedt | treffer | keine | fehler | zuviele
  function zeige(zustand) {
    const treffer = zustand === "treffer";
    popup.hidden = zustand === "zu";
    skelett.hidden = zustand !== "laedt";
    liste.hidden = !treffer;
    meldung.hidden = !(zustand === "keine" || zustand === "fehler" || zustand === "zuviele");
    dreher.hidden = zustand !== "laedt";
    popup.setAttribute("aria-busy", String(zustand === "laedt"));
    eingabe.setAttribute("aria-expanded", String(treffer));
    if (!treffer) setzeAktiv(-1);
    leeren.hidden = eingabe.value === "";
  }

  function zeigeMeldung(art) {
    const [titel, text] = MELDUNG[art];
    meldung.replaceChildren(
      icon(art === "keine" ? "info" : "warnung"),
      el(
        "div",
        { class: "ort-suche-meldung-text" },
        el("strong", {}, titel),
        el("span", {}, text),
        art === "fehler" &&
          knopf("Nochmals suchen", {
            klein: true,
            // Der Fokus bleibt im Feld, damit die Liste nicht schliesst
            onmousedown: (e) => e.preventDefault(),
            onclick: () => {
              starte(eingabe.value.trim());
              eingabe.focus();
            },
          }),
      ),
    );
    ansage.textContent = `${titel} ${text}`;
    zeige(art);
  }

  function zeichneListe() {
    liste.replaceChildren(
      ...vorschlaege.map((v, i) => {
        // Strasse und Ort getrennt zeigen, wo der Dienst sie getrennt liefert; sonst die ganze Bezeichnung
        const haupt = v.strasse ?? v.bezeichnung;
        const neben = v.strasse ? [v.plz, v.ort].filter(Boolean).join(" ") : "";
        return el(
          "li",
          {
            id: `${id}-o${i}`,
            class: "ort-suche-option",
            role: "option",
            "aria-selected": "false",
            // Der Screenreader liest die ganze Adresse, nicht zwei Teile
            "aria-label": v.bezeichnung,
            // Die Maus nimmt den Fokus nicht aus dem Feld
            onmousedown: (e) => e.preventDefault(),
            onclick: () => waehle(i),
            onmousemove: () => aktiv !== i && setzeAktiv(i),
          },
          el("span", { class: "ort-suche-haupt" }, hervorgehoben(haupt, woerter)),
          neben && el("span", { class: "ort-suche-neben" }, hervorgehoben(neben, woerter)),
        );
      }),
    );
    setzeAktiv(-1);
  }

  async function starte(text) {
    abbruch?.abort();
    const meine = ++nummer;
    abbruch = new AbortController();
    woerter = falte(text).split(TEILER).filter(Boolean);
    zeige("laedt");
    try {
      const antwort = await anfrage(
        "GET",
        `${API}?q=${encodeURIComponent(text)}`,
        undefined,
        abbruch.signal,
      );
      if (meine !== nummer) return;
      vorschlaege = antwort.vorschlaege;
      if (vorschlaege.length === 0) return zeigeMeldung("keine");
      zeichneListe();
      zeige("treffer");
      ansage.textContent = `${vorschlaege.length} ${vorschlaege.length === 1 ? "Vorschlag" : "Vorschläge"}. Mit den Pfeiltasten wählen, mit Enter übernehmen.`;
    } catch (f) {
      if (f?.name === "AbortError" || meine !== nummer) return;
      zeigeMeldung(f?.status === 429 ? "zuviele" : "fehler");
    }
  }

  function schliesse() {
    clearTimeout(uhr);
    abbruch?.abort();
    nummer++;
    zeige("zu");
  }

  function waehle(i) {
    const v = vorschlaege[i];
    if (!v) return;
    schliesse();
    vorschlaege = [];
    eingabe.value = v.bezeichnung;
    leeren.hidden = false;
    ansage.textContent = `Adresse übernommen: ${v.bezeichnung}.`;
    beiWahl(v);
  }

  eingabe.addEventListener("input", () => {
    clearTimeout(uhr);
    leeren.hidden = eingabe.value === "";
    const text = eingabe.value.trim();
    if (text.length < MIN_ZEICHEN) {
      abbruch?.abort();
      nummer++;
      zeige("zu");
      ansage.textContent = "";
      return;
    }
    uhr = setTimeout(() => starte(text), WARTEN_MS);
  });

  eingabe.addEventListener("keydown", (e) => {
    const offen = !liste.hidden;
    const n = vorschlaege.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const text = eingabe.value.trim();
      if (!offen) {
        // Eine geschlossene Liste mit Eingabe öffnet sich wieder
        if (text.length >= MIN_ZEICHEN && vorschlaege.length > 0) zeige("treffer");
        else if (text.length >= MIN_ZEICHEN) starte(text);
        e.preventDefault();
        return;
      }
      const schritt = e.key === "ArrowDown" ? 1 : -1;
      setzeAktiv(aktiv < 0 && schritt < 0 ? n - 1 : (aktiv + schritt + n) % n);
      e.preventDefault();
    } else if (offen && aktiv >= 0 && (e.key === "Home" || e.key === "End")) {
      setzeAktiv(e.key === "Home" ? 0 : n - 1);
      e.preventDefault();
    } else if (e.key === "Enter") {
      // Solange eine Liste offen ist, schickt Enter nie das Formular ab
      if (offen) {
        e.preventDefault();
        if (aktiv >= 0) waehle(aktiv);
      } else if (!popup.hidden) e.preventDefault();
    } else if (e.key === "Escape" && !popup.hidden) {
      // Schliesst nur die Liste, nicht die Seite dahinter
      e.preventDefault();
      e.stopPropagation();
      schliesse();
    }
  });

  eingabe.addEventListener("focus", () => {
    // Zurück ins Feld: die letzten Vorschläge wieder zeigen, solange der Text noch derselbe Suchtext ist
    if (vorschlaege.length > 0 && popup.hidden && eingabe.value.trim().length >= MIN_ZEICHEN) {
      zeige("treffer");
    }
  });
  wurzel.addEventListener("focusout", (e) => {
    if (!wurzel.contains(e.relatedTarget)) schliesse();
  });
  leeren.addEventListener("click", () => {
    schliesse();
    vorschlaege = [];
    eingabe.value = "";
    ansage.textContent = "";
    leeren.hidden = true;
    eingabe.focus();
  });

  return {
    wurzel,
    eingabe,
    fokussiere: () => eingabe.focus(),
    // Setzt den Text ein und sucht sofort (Knopf «Adresse suchen»)
    suche(text) {
      eingabe.value = text;
      leeren.hidden = text === "";
      eingabe.focus();
      if (text.trim().length >= MIN_ZEICHEN) {
        clearTimeout(uhr);
        starte(text.trim());
      }
    },
  };
}

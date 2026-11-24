import { anfrage, fehlertext } from "./api.js";
import { el, feld, knopf, neueId, seitenblatt, tag } from "./dom.js";
import {
  anzahlText,
  band,
  beschaeftigt,
  bei,
  fenster,
  sichtbarkeitText,
  zeigeFeldFehler,
} from "./website-dialoge.js";
import { schliesseOffenePanels, unteransicht } from "./website-unteransicht.js";
import { sichtbarkeitBlatt } from "./website-sichtbarkeit.js";
import {
  GRUPPEN,
  KATALOG,
  MAX_BAUSTEINE,
  TYPEN,
  feldName,
  groesseText,
  typName,
} from "./website-felder.js";
import { symbol } from "./website-symbole.js";
import {
  fehlerText,
  ladeVorschauen,
  vorschauRahmen,
  vorschauSkelett,
} from "./website-vorschau.js";
import { sk } from "./lader.js";

// Baustein hinzufügen (E3), Baustein bearbeiten (E4) und Bild wählen. Schnittstelle zum Editor: der Kontext k aus website-editor.js.

const API = "/api/v1/redaktion";
const kopie = (wert) => JSON.parse(JSON.stringify(wert));

// --- E3: Baustein hinzufügen ------------------------------------------------------------------------------------------

// Kacheln mit Vorschau (#739): Jeder Eintrag des Katalogs zeigt sich mit seinen Beispieldaten, gerendert wie auf der Website (website-vorschau.js).
// Tastatur: Pfeiltasten wandern durch die Kacheln (Tab springt nur hinein und hinaus), Enter oder Leertaste fügt ein, Escape schliesst, aus der Suche führt Pfeil nach unten oder Enter zur ersten Kachel
const TASTEN = new Set([
  "ArrowRight",
  "ArrowLeft",
  "ArrowDown",
  "ArrowUp",
  "Home",
  "End",
]);

export function katalogDialog(k) {
  if (k.dok.bausteine.length >= MAX_BAUSTEINE) {
    k.ctx.melde(
      `Mehr als ${MAX_BAUSTEINE} Bausteine sind nicht möglich.`,
      "fehler",
    );
    return;
  }
  const n = k.dok.bausteine.length;
  const sucheId = neueId("katalog-suche");
  const suche = el("input", {
    class: "eingabe",
    id: sucheId,
    type: "search",
    placeholder: "Baustein suchen",
    autocomplete: "off",
  });
  const ortId = neueId("ort");
  const ort = el(
    "select",
    { class: "ws-select", id: ortId },
    el("option", { value: "0" }, "Am Anfang"),
    k.dok.bausteine.map((b, i) =>
      el(
        "option",
        { value: String(i + 1) },
        i === n - 1 ? "Am Ende" : `Nach Baustein ${i + 1}: ${typName(b)}`,
      ),
    ),
  );
  ort.value = String(n);
  const zaehler = el("p", { class: "nur-leser", role: "status" });
  const ladeStatus = el("p", { class: "nur-leser", role: "status" });
  const fehlerPlatz = el("div", { class: "ws-katalog-fehler" });
  const keine = el(
    "div",
    { class: "zustand", role: "status", hidden: true },
    el("h3", {}, "Keinen Baustein gefunden."),
    el(
      "p",
      { class: "leise" },
      "Prüfe die Schreibweise oder wähle eine andere Gruppe. Karten und Videos gibt es nur als Link.",
    ),
    knopf("Suche zurücksetzen", {
      klein: true,
      onclick: () => {
        suche.value = "";
        gruppeFilter = null;
        aktualisiere();
        suche.focus();
      },
    }),
  );
  let dlg = null;
  let gruppeFilter = null;
  let aktuell = null;

  const waehle = (e) => {
    const pos = Number(ort.value);
    dlg.dialog.addEventListener(
      "close",
      () =>
        bearbeitenBlatt(
          k,
          {
            id: globalThis.crypto.randomUUID(),
            typ: e.typ,
            daten: e.neu(),
            sichtbarkeit: "erbt",
          },
          pos,
          { neu: true },
        ),
      { once: true },
    );
    dlg.schliesse();
  };

  const eintraege = KATALOG.map((e) => {
    const bild = el(
      "div",
      { class: "ws-kachel-bild", inert: true, "aria-hidden": "true" },
      vorschauSkelett(),
    );
    const knopfEl = el(
      "button",
      {
        type: "button",
        class: "ws-kachel-knopf",
        tabindex: "-1",
        onclick: () => waehle(e),
        onfocus: () => setzeAktuell(knopfEl),
        onkeydown: (ereignis) => taste(ereignis, knopfEl),
      },
      el("strong", {}, e.name),
      el("span", {}, e.beschreibung),
    );
    return {
      e,
      bild,
      knopf: knopfEl,
      // Ein Eintrag ohne Beispiel zeigt «Keine Vorschau», bleibt aber wählbar
      beispiel: e.beispiel
        ? {
            id: globalThis.crypto.randomUUID(),
            typ: e.typ,
            daten: e.beispiel(),
            sichtbarkeit: "erbt",
          }
        : null,
      li: el("li", { class: "ws-kachel" }, bild, knopfEl),
      text: `${e.name} ${e.beschreibung} ${e.gruppe ?? ""}`.toLowerCase(),
    };
  });

  // Gruppen in der Reihenfolge von GRUPPEN; ein Eintrag ohne bekannte Gruppe steht unter «Weitere»
  const gruppen = [...GRUPPEN, "Weitere"]
    .map((name) => ({
      name,
      eintraege: eintraege.filter(
        (x) => (GRUPPEN.includes(x.e.gruppe) ? x.e.gruppe : "Weitere") === name,
      ),
    }))
    .filter((g) => g.eintraege.length > 0)
    .map((g) => {
      const id = neueId("katalog-gruppe");
      return {
        ...g,
        wurzel: el(
          "section",
          { class: "ws-katalog-gruppe", "aria-labelledby": id },
          el("h3", { id }, g.name),
          el(
            "ul",
            { class: "ws-katalog", role: "list" },
            g.eintraege.map((x) => x.li),
          ),
        ),
      };
    });

  const sichtbareKnoepfe = () =>
    eintraege.filter((x) => !x.li.hidden).map((x) => x.knopf);

  // Nur eine Kachel ist per Tab erreichbar (roving tabindex): Tab führt hinein und wieder hinaus
  function setzeAktuell(knopfEl) {
    if (aktuell && aktuell !== knopfEl) aktuell.tabIndex = -1;
    aktuell = knopfEl;
    knopfEl.tabIndex = 0;
  }

  // Die Kachel, auf die eine Pfeiltaste zeigt; oben und unten über die Zeile der Kachel (die Spaltenzahl ändert sich mit der Breite)
  function ziel(von, taste) {
    const liste = sichtbareKnoepfe();
    const i = liste.indexOf(von);
    if (taste === "Home") return liste[0];
    if (taste === "End") return liste.at(-1);
    if (taste === "ArrowRight") return liste[Math.min(i + 1, liste.length - 1)];
    if (taste === "ArrowLeft") return liste[Math.max(i - 1, 0)];
    const r = von.closest("li").getBoundingClientRect();
    const richtung = taste === "ArrowDown" ? 1 : -1;
    const andere = liste
      .map((b) => ({ b, r: b.closest("li").getBoundingClientRect() }))
      .filter((x) =>
        richtung > 0 ? x.r.top > r.top + 4 : x.r.top < r.top - 4,
      );
    if (andere.length === 0) return von;
    const naechsteZeile = andere.reduce((m, x) =>
      Math.abs(x.r.top - r.top) < Math.abs(m.r.top - r.top) ? x : m,
    ).r.top;
    return andere
      .filter((x) => Math.abs(x.r.top - naechsteZeile) < 4)
      .reduce((m, x) =>
        Math.abs(x.r.left - r.left) < Math.abs(m.r.left - r.left) ? x : m,
      ).b;
  }

  function taste(ereignis, von) {
    if (!TASTEN.has(ereignis.key) || ereignis.altKey || ereignis.ctrlKey) {
      return;
    }
    ereignis.preventDefault();
    const nach = ziel(von, ereignis.key);
    nach.focus();
    nach.scrollIntoView({ block: "nearest" });
  }

  const gruppenwahl = el(
    "div",
    { class: "pillen", role: "group", "aria-label": "Gruppe" },
    [null, ...gruppen.map((g) => g.name)].map((name) =>
      el(
        "button",
        {
          type: "button",
          class: "pille",
          "aria-pressed": String(name === null),
          "data-gruppe": name ?? "",
          onclick: () => {
            gruppeFilter = name;
            aktualisiere();
          },
        },
        name ?? "Alle",
      ),
    ),
  );

  function aktualisiere() {
    const frage = suche.value.trim().toLowerCase();
    let treffer = 0;
    for (const x of eintraege) {
      x.li.hidden =
        !x.text.includes(frage) ||
        (gruppeFilter !== null && x.e.gruppe !== gruppeFilter);
      if (!x.li.hidden) treffer++;
    }
    for (const g of gruppen) {
      g.wurzel.hidden = g.eintraege.every((x) => x.li.hidden);
    }
    for (const b of gruppenwahl.querySelectorAll("button")) {
      b.setAttribute(
        "aria-pressed",
        String((b.dataset.gruppe || null) === gruppeFilter),
      );
    }
    keine.hidden = treffer > 0;
    // Die erste sichtbare Kachel ist der Einstieg per Tab
    const erste = sichtbareKnoepfe()[0];
    if (aktuell && aktuell !== erste) aktuell.tabIndex = -1;
    aktuell = erste ?? null;
    if (erste) erste.tabIndex = 0;
    zaehler.textContent =
      frage || gruppeFilter !== null
        ? anzahlText(treffer, "1 Baustein passt", "Bausteine passen")
        : "";
  }
  suche.addEventListener("input", aktualisiere);
  suche.addEventListener("keydown", (ereignis) => {
    if (ereignis.key === "ArrowDown" || ereignis.key === "Enter") {
      const erste = sichtbareKnoepfe()[0];
      if (erste) {
        ereignis.preventDefault();
        erste.focus();
      }
    }
  });

  // Die Vorschauen kommen in einer Anfrage; bis dahin stehen Skelette, und jede Kachel ist schon wählbar
  const zeigeVorschau = (x, v) => {
    x.bild.replaceChildren(
      v?.html
        ? vorschauRahmen(v.html, { titel: `Vorschau: ${x.e.name}` })
        : el("p", { class: "ws-kachel-leer" }, "Keine Vorschau"),
    );
  };
  async function ladeAlle() {
    fehlerPlatz.replaceChildren();
    ladeStatus.textContent = "Vorschauen laden …";
    const mit = eintraege.filter((x) => x.beispiel);
    for (const x of eintraege) {
      if (!x.beispiel) zeigeVorschau(x, null);
    }
    try {
      const liste = await ladeVorschauen(mit.map((x) => x.beispiel));
      if (!dlg?.dialog.isConnected) return;
      mit.forEach((x, i) => zeigeVorschau(x, liste[i]));
      ladeStatus.textContent = "Die Vorschauen sind geladen.";
    } catch (f) {
      if (!dlg?.dialog.isConnected) return;
      for (const x of mit) zeigeVorschau(x, null);
      ladeStatus.textContent = "";
      fehlerPlatz.replaceChildren(
        band(
          "warn",
          `${fehlerText(f)} Du kannst trotzdem einen Baustein wählen.`,
          knopf("Nochmals versuchen", {
            klein: true,
            onclick: () => {
              for (const x of mit) x.bild.replaceChildren(vorschauSkelett());
              void ladeAlle();
            },
          }),
        ),
      );
    }
  }

  dlg = fenster({
    titel: "Baustein hinzufügen",
    breit: true,
    inhalt: [
      el(
        "div",
        { class: "ws-katalogkopf" },
        el(
          "div",
          { class: "suche" },
          el("label", { class: "nur-leser", for: sucheId }, "Baustein suchen"),
          symbol("lupe"),
          suche,
        ),
        n > 0 &&
          el(
            "div",
            { class: "feld ws-ort" },
            el("label", { for: ortId }, "Einfügen"),
            ort,
          ),
      ),
      gruppenwahl,
      el(
        "p",
        { class: "klein leise" },
        "Jede Kachel zeigt den Baustein mit Beispielinhalt, so wie die Website ihn zeigt (hell). Pfeiltasten wählen, Enter fügt ein.",
      ),
      zaehler,
      ladeStatus,
      fehlerPlatz,
      keine,
      ...gruppen.map((g) => g.wurzel),
    ],
    fuss: [knopf("Abbrechen", { onclick: () => dlg.schliesse() })],
    fokus: suche,
  });
  aktualisiere();
  void ladeAlle();
}

// --- E4: Baustein bearbeiten ------------------------------------------------------------------------------------------

// k: Kontext des Editors; b: der Baustein (bei neu: noch nicht im Dokument); position: Index im Dokument bzw. Einfügeposition
// opt: { neu, fehler: [{ pfad, text }] (Meldungen des Servers, die gleich zu den Feldern kommen) }
export function bearbeitenBlatt(k, b, position, opt = {}) {
  if (!schliesseOffenePanels()) return null;
  const typ = TYPEN[b.typ];
  const arbeit = kopie(b);
  const alt = new Map();
  const felder = new Map();
  let reg = (pfad, wurzel, ziel) => felder.set(pfad, { wurzel, ziel });
  const kk = {
    ctx: k.ctx,
    tags: k.tags,
    tagNamen: k.tagNamen,
    personNamen: k.personNamen,
    personen: k.personen,
    medien: k.medien,
    kannAlt: k.kannAlt,
    waehleBild: (beiWahl) => bildDialog(k, beiWahl, { in: blatt }),
    aendere: () => {
      // Das Formular schreibt in die Kopie; die Fehler eines Feldes verschwinden dort selbst
    },
    formNeu: (_b, fokus) => baueForm(fokus),
    altText: (m) => alt.get(m.id) ?? m.altText ?? "",
    altAenderung: (id, text) => alt.set(id, text),
  };
  const formular = el("div", { class: "ws-blattform" });
  const erbtText = () => sichtbarkeitText(k.seite.sichtbarkeit, k.tagNamen);
  const sichtChip = el("span", { class: "chip" });
  const zeichneSicht = () =>
    sichtChip.replaceChildren(
      symbol("schild"),
      arbeit.sichtbarkeit === "erbt"
        ? `Wie die Seite (${erbtText()})`
        : sichtbarkeitText(arbeit.sichtbarkeit, k.tagNamen),
    );
  zeichneSicht();
  const sichtAbschnitt = el(
    "section",
    { class: "ws-teil" },
    el("h3", {}, "Sichtbarkeit"),
    el(
      "div",
      { class: "zeile" },
      sichtChip,
      knopf("Ändern", {
        klein: true,
        "aria-label": "Sichtbarkeit des Bausteins ändern",
        onclick: () =>
          sichtbarkeitBlatt({
            in: blatt,
            typ: "baustein",
            frage: "Wer sieht den Baustein?",
            titel: "Sichtbarkeit des Bausteins",
            untertitel: `${typName(b)} · ${k.seite.titel}`,
            start: arbeit.sichtbarkeit,
            erbtText: erbtText(),
            tagNamen: k.tagNamen,
            ladeTags: async () => {
              const { tags } = await anfrage("GET", `${API}/tags`);
              k.tags = tags;
              k.tagNamen = new Map(tags.map((t) => [t.id, t.name]));
              return tags;
            },
            speichere: async (wert) => {
              arbeit.sichtbarkeit = wert;
              zeichneSicht();
            },
          }),
      }),
    ),
  );
  const fehlerPlatz = el("div", { class: "ws-fehlerplatz" });
  const nr = opt.neu ? position + 1 : position + 1;
  const von = opt.neu ? k.dok.bausteine.length + 1 : k.dok.bausteine.length;

  function baueForm(fokus) {
    felder.clear();
    formular.replaceChildren(...typ.form(kk, arbeit, reg));
    if (fokus) setzeFokus(fokus);
  }

  // Nach einer Änderung an einer Liste (Karte, Galeriebild): derselbe Knopf, sonst der andere, sonst das erste Feld
  function setzeFokus({ index, was }) {
    const teil = formular.querySelectorAll(".sortier-eintrag")[index];
    const namen = {
      hoch: ["Nach oben", "Nach unten"],
      runter: ["Nach unten", "Nach oben"],
    }[was];
    const knopfEl = (n) =>
      teil?.querySelector(`button[aria-label^="${n}"]:not(:disabled)`);
    const ziel =
      (was === "griff" && teil?.querySelector(".sortier-griff")) ||
      (namen && (knopfEl(namen[0]) ?? knopfEl(namen[1]))) ||
      teil?.querySelector(
        ".sortier-inhalt input, .sortier-inhalt textarea, .sortier-inhalt select, .sortier-inhalt button:not(:disabled)",
      ) ||
      formular.querySelector('[data-teil="hinzu"]');
    ziel?.focus();
  }

  // eintraege: [[pfad, text]]; zeigt die Meldungen beim Feld und eine Liste oben mit Sprungmarken
  function zeigeFehler(eintraege) {
    fehlerPlatz.replaceChildren();
    if (eintraege.length === 0) return;
    const links = [];
    for (const [pfad, text, kurz] of eintraege) {
      const treffer = [...felder.keys()]
        .filter((p) => pfad === p || pfad.startsWith(`${p}.`))
        .sort((a, c) => c.length - a.length)[0];
      const f = treffer ? felder.get(treffer) : null;
      if (f) zeigeFeldFehler(f.wurzel, f.ziel, text);
      links.push(
        el(
          "a",
          {
            href: "#",
            onclick: (e) => {
              e.preventDefault();
              f?.ziel.scrollIntoView({ block: "center" });
              f?.ziel.focus();
            },
          },
          kurz ?? text,
        ),
      );
    }
    const b2 = el(
      "div",
      { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
      el(
        "span",
        {},
        `${anzahlText(eintraege.length, "1 Angabe", "Angaben")} prüfen: `,
        links.flatMap((l, i) => (i > 0 ? [", ", l] : [l])),
      ),
    );
    fehlerPlatz.append(b2);
    b2.focus();
  }

  const abbrechen = knopf("Abbrechen", { onclick: () => blatt.close() });
  const uebernehmen = knopf("Übernehmen", { art: "haupt" });
  bei(uebernehmen, async () => {
    const fehler = typ
      .pruefe(arbeit.daten, kk)
      // Ein geleerter Alt-Text: Das Medium nähme ihn nicht an
      .concat(
        [...alt]
          .filter(([, text]) => !text.trim())
          .map(([id]) => [`alt.${id}`, "fehlt."]),
      )
      .filter(([pfad], i, alle) => alle.findIndex((x) => x[0] === pfad) === i)
      .map(([pfad, text]) =>
        pfad.startsWith("alt.")
          ? [
              pfad,
              "Gib einen Alt-Text ein. Ohne ihn kannst du das Bild nicht übernehmen.",
              "Alt-Text fehlt",
            ]
          : [pfad, `${feldName(pfad)} ${text}`],
      );
    // Die Meldung vom Server zu einem Feld bleibt nicht stehen: Neu prüfen
    felder.forEach((f) => f.wurzel.classList.remove("fehler"));
    if (fehler.length > 0) {
      zeigeFehler(fehler);
      return;
    }
    fehlerPlatz.replaceChildren();
    beschaeftigt(uebernehmen, true);
    abbrechen.disabled = true;
    try {
      // Der Alt-Text gehört dem Medium: erst dort speichern
      for (const [id, text] of alt) {
        const m = k.medien.get(id);
        if (!m || text.trim() === (m.altText ?? "")) continue;
        const neu = await anfrage("PATCH", `${API}/medien/${id}`, {
          altText: text.trim(),
        });
        k.medien.set(id, neu);
      }
    } catch (f) {
      const b2 = band(
        "fehler",
        f?.status === 403
          ? "Den Alt-Text ändert die Abteilungsleitung unter «Medien»."
          : fehlertext(f),
      );
      b2.tabIndex = -1;
      fehlerPlatz.replaceChildren(b2);
      b2.focus();
      beschaeftigt(uebernehmen, false);
      abbrechen.disabled = false;
      return;
    }
    if (opt.neu) {
      k.dok.bausteine.splice(position, 0, arbeit);
    } else {
      b.daten = arbeit.daten;
      b.sichtbarkeit = arbeit.sichtbarkeit;
    }
    k.aenderung();
    blatt.addEventListener(
      "close",
      () => {
        k.zeichneListe({ id: arbeit.id, was: "bearbeiten" });
        k.ctx.melde(
          opt.neu
            ? `«${typName(b)}» ist hinzugefügt, an Position ${position + 1}. Speichern nicht vergessen.`
            : `«${typName(b)}» ist übernommen. Speichern nicht vergessen.`,
          "info",
        );
      },
      { once: true },
    );
    blatt.close();
  });
  const blatt = seitenblatt({
    panel: true,
    titel: `${typName(b)} ${opt.neu ? "hinzufügen" : "bearbeiten"}`,
    untertitel: `Baustein ${nr} von ${von} · ${k.seite.titel}`,
    inhalt: [
      el(
        "div",
        { class: "ws-blattinhalt" },
        fehlerPlatz,
        formular,
        sichtAbschnitt,
      ),
    ],
    fusszeile: [abbrechen, uebernehmen],
  });
  baueForm();
  if (opt.fehler?.length) zeigeFehler(opt.fehler.map((e) => [e.pfad, e.text]));
  return blatt;
}

// --- Bild wählen ------------------------------------------------------------------------------------------------------

// Die Bilder kommen seitenweise vom Server, die Suche läuft dort (nach Alt-Text); nichts wird vorab geladen
const MEDIEN_SEITE = 24;
// opt.in: das Panel des Bausteins; dann ersetzt die Wahl dessen Inhalt (nie ein zweites Panel über dem ersten)
export function bildDialog(k, beiWahl, opt = {}) {
  if (!opt.in && !schliesseOffenePanels()) return;
  const suche = feld({
    label: "Bild suchen (nach Beschreibung)",
    type: "search",
    autocomplete: "off",
  });
  const raster = el("ul", { class: "ws-wahlbilder" });
  const zaehler = el(
    "p",
    { class: "klein leise", role: "status" },
    "Wird geladen …",
  );
  const fehler = el("div");
  const weitere = knopf("Weitere Bilder laden", {
    klein: true,
    symbol: "plus",
    hidden: true,
    onclick: () => lade(false),
  });
  const inhalt = [
    el(
      "div",
      { class: "ws-blattinhalt" },
      suche.wurzel,
      zaehler,
      fehler,
      raster,
      weitere,
      el(
        "p",
        { class: "hilfe" },
        "Neue Bilder lädst du unter ",
        el("a", { href: "#website/medien" }, "Medien"),
        " hoch.",
      ),
    ),
  ];
  const blatt = opt.in
    ? unteransicht(opt.in, {
        titel: "Bild wählen",
        inhalt,
        zurueckText: "Zurück zum Baustein",
      })
    : seitenblatt({ panel: true, titel: "Bild wählen", inhalt });
  let anzahl = 0;
  let lauf = 0;
  const karte = (m) =>
    el(
      "li",
      {},
      el(
        "button",
        {
          type: "button",
          class: "ws-wahlbild",
          onclick: () => {
            blatt.addEventListener("close", () => beiWahl(m), { once: true });
            blatt.close();
          },
        },
        el("img", { src: m.url, alt: "", loading: "lazy" }),
        el(
          "span",
          {},
          m.dekorativ
            ? "Zierde, ohne Beschreibung"
            : (m.altText ?? "Ohne Beschreibung"),
        ),
        el(
          "span",
          { class: "klein leise" },
          `${tag(m.erstelltAm)} · ${groesseText(m.groesse)}`,
        ),
      ),
    );
  async function lade(neu) {
    const mein = ++lauf;
    fehler.replaceChildren();
    weitere.hidden = true;
    if (neu) {
      anzahl = 0;
      raster.replaceChildren();
      raster.append(
        el("li", { "aria-hidden": "true" }, sk("b", 320)),
        el("li", { "aria-hidden": "true" }, sk("b", 320)),
      );
    }
    zaehler.textContent = "Wird geladen …";
    const frage = suche.eingabe.value.trim();
    try {
      const antwort = await anfrage(
        "GET",
        `${API}/medien?limit=${MEDIEN_SEITE}&offset=${anzahl}${frage ? `&suche=${encodeURIComponent(frage)}` : ""}`,
      );
      if (mein !== lauf) return;
      if (neu) raster.replaceChildren();
      // Ein altes PDF-Medium (vor #428) ist kein Bild
      const bilder = antwort.medien.filter((m) =>
        m.mimeTyp.startsWith("image/"),
      );
      anzahl += antwort.medien.length;
      for (const m of bilder) {
        k.medien.set(m.id, m);
        raster.append(karte(m));
      }
      weitere.hidden = !antwort.weitere;
      zaehler.textContent =
        raster.children.length === 0
          ? frage
            ? "Kein Bild passt zur Suche."
            : "Es gibt noch keine Bilder."
          : anzahlText(raster.children.length, "1 Bild", "Bilder") +
            (antwort.weitere ? " (weitere folgen)" : "");
    } catch (f) {
      if (mein !== lauf) return;
      raster.replaceChildren();
      zaehler.textContent = "";
      fehler.replaceChildren(
        band("fehler", fehlertext(f)),
        knopf("Nochmals versuchen", {
          klein: true,
          symbol: "aktualisieren",
          onclick: () => lade(neu),
        }),
      );
    }
  }
  // Die Suche startet kurz nach der letzten Eingabe, nicht bei jedem Zeichen
  let timer = null;
  suche.eingabe.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => lade(true), 400);
  });
  lade(true);
}

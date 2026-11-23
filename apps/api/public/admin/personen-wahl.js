// Personen und Kinder zuordnen (Muster «team-invite-card» und «team-member-list»): ein Suchfeld mit Treffern und «Hinzufügen», die Gewählten stehen darunter als Liste mit «Entfernen». Ersetzt lange Checklisten (höchstens 10 Kästchen aller Konten skalieren nicht).
// Daten gelangen nur als Text in die Seite (el, createTextNode).
import { avatar, el, icon, knopf, neueId } from "./dom.js";

const TREFFER_MAX = 6;

const enthaelt = (k, frage) => {
  const heu = `${k.name} ${k.zusatz ?? ""}`.toLowerCase();
  return frage
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((teil) => heu.includes(teil));
};

// Eine Zeile mit Bild (oder Initialen), Name und Zusatz; rechts steht, was der Aufrufer mitgibt
export function personZeile(k, ...rechts) {
  return el(
    "li",
    { class: "pe-wahlzeile", "data-id": k.id },
    el(
      "div",
      { class: "wer" },
      avatar(k.name, { hell: true, bildUrl: k.bildUrl }),
      el(
        "div",
        {},
        el("span", { class: "name" }, k.name),
        k.zusatz && el("span", { class: "klein leise" }, k.zusatz),
      ),
    ),
    ...rechts,
  );
}

// Suchfeld mit Trefferliste
// kandidaten: [{ id, name, zusatz?, bildUrl? }]; beiWahl(kandidat) läuft bei «Hinzufügen»
// Liefert { wurzel, setzeKandidaten(liste), fokus(), sperre(text|null) }
export function kandidatenSuche({
  beschriftung,
  kandidaten,
  beiWahl,
  knopfText = "Hinzufügen",
  leerText = "Niemand mehr zu haben.",
}) {
  let liste = [...kandidaten];
  let sperreText = null;
  const id = neueId("wahl-suche");
  const eingabe = el("input", {
    class: "eingabe",
    id,
    type: "search",
    placeholder: beschriftung,
    autocomplete: "off",
    spellcheck: "false",
    oninput: () => zeichne(),
  });
  const treffer = el("ul", {
    class: "pe-treffer",
    "aria-label": `Treffer: ${beschriftung}`,
  });
  const status = el("p", { class: "klein leise", role: "status" });
  const wurzel = el(
    "div",
    { class: "pe-suchkarte" },
    el(
      "div",
      { class: "suche" },
      el("label", { class: "nur-leser", for: id }, beschriftung),
      icon("lupe"),
      eingabe,
    ),
    treffer,
    status,
  );

  function zeichne() {
    const frage = eingabe.value.trim();
    eingabe.disabled = sperreText !== null;
    if (sperreText !== null) {
      treffer.replaceChildren();
      status.textContent = sperreText;
      return;
    }
    const alle = liste
      .filter((k) => !frage || enthaelt(k, frage))
      .sort((a, b) => a.name.localeCompare(b.name, "de-CH"));
    const sichtbar = alle.slice(0, TREFFER_MAX);
    treffer.replaceChildren(
      ...sichtbar.map((k) =>
        personZeile(
          k,
          knopf(knopfText, {
            klein: true,
            symbol: "plus",
            kontext: k.name,
            onclick: () => {
              beiWahl(k);
              // Das Feld bleibt zum Weitermachen: Der Fokus geht zurück ins Suchfeld
              eingabe.focus();
            },
          }),
        ),
      ),
    );
    status.textContent =
      liste.length === 0
        ? leerText
        : alle.length === 0
          ? `Keine Treffer für «${frage}».`
          : alle.length > sichtbar.length
            ? `${alle.length - sichtbar.length} weitere. Tippe weiter, um sie zu finden.`
            : "";
  }
  zeichne();
  return {
    wurzel,
    setzeKandidaten(neu) {
      liste = [...neu];
      zeichne();
    },
    fokus: () => eingabe.focus(),
    // Text: Grund, warum nichts mehr zu wählen ist (zum Beispiel die Obergrenze); null hebt die Sperre auf
    sperre(text) {
      sperreText = text;
      zeichne();
    },
  };
}

// Auswahl mehrerer Personen oder Kinder: Gewählte als Liste, darunter die Suche
// optionen: { titel, beschriftung, kandidaten, gewaehlt: [ids], max?, leerText, entfernenText?, beiAenderung?() }
// Liefert { wurzel, wert() } (IDs in der Reihenfolge des Hinzufügens)
export function suchWahl({
  titel,
  beschriftung,
  kandidaten,
  gewaehlt = [],
  max,
  leerText,
  keinerText = "Noch niemand gewählt.",
}) {
  const bekannt = new Map(kandidaten.map((k) => [k.id, k]));
  let ids = gewaehlt.filter((x) => bekannt.has(x));
  const zaehler = el("span", { class: "klein leise" });
  const ansage = el("p", { class: "nur-leser", role: "status" });
  const gewaehltListe = el("ul", {
    class: "pe-gewaehlt",
    "aria-label": titel,
  });
  const wurzel = el("div", { class: "pe-wahl-block" });
  const suche = kandidatenSuche({
    beschriftung,
    kandidaten: [],
    leerText,
    beiWahl: (k) => {
      if (max && ids.length >= max) return;
      ids.push(k.id);
      aenderung(`«${k.name}» ist gewählt.`);
    },
  });

  function aenderung(text) {
    zeichne();
    // Der Zustand der Seite ändert sich: fluss.js merkt sich ungespeicherte Eingaben über «change»
    wurzel.dispatchEvent(new Event("change", { bubbles: true }));
    if (text) ansage.textContent = text;
  }

  function zeichne() {
    zaehler.textContent = max
      ? `${ids.length} gewählt, höchstens ${max}`
      : `${ids.length} gewählt`;
    gewaehltListe.replaceChildren(
      ...(ids.length
        ? ids.map((id) => {
            const k = bekannt.get(id);
            return personZeile(
              k,
              knopf("Entfernen", {
                klein: true,
                art: "still",
                symbol: "schliessen",
                kontext: k.name,
                onclick: () => {
                  ids = ids.filter((x) => x !== id);
                  aenderung(`«${k.name}» ist entfernt.`);
                  suche.fokus();
                },
              }),
            );
          })
        : [el("li", { class: "pe-keiner leise" }, keinerText)]),
    );
    suche.setzeKandidaten(kandidaten.filter((k) => !ids.includes(k.id)));
    suche.sperre(
      max && ids.length >= max
        ? `Mehr als ${max} sind nicht möglich. Entferne zuerst jemanden.`
        : null,
    );
  }
  wurzel.append(
    el("div", { class: "zeile" }, el("h3", {}, titel), zaehler),
    gewaehltListe,
    suche.wurzel,
    ansage,
  );
  zeichne();
  return { wurzel, wert: () => [...ids] };
}

// Datei wählen ohne das Feld des Browsers («Choose File», Sprache und Aussehen hängen vom Browser ab): Die echte Eingabe bleibt (unsichtbar, aber per Tastatur erreichbar und für Screenreader beschriftet), davor steht ein Knopf und der Name der gewählten Datei.
// Liefert { wurzel, eingabe }; eingabe.files und das Ereignis «change» wie beim normalen Feld
export function dateiFeld({ label, hilfe, accept }) {
  const id = neueId("datei");
  const hilfeId = hilfe ? `${id}-hilfe` : undefined;
  const eingabe = el("input", {
    id,
    type: "file",
    class: "datei-eingabe",
    accept,
    "aria-describedby": hilfeId,
  });
  const name = el("span", { class: "datei-name leise", role: "status" });
  const zeige = () => {
    name.textContent = eingabe.files[0]?.name ?? "Keine Datei gewählt";
  };
  eingabe.addEventListener("change", zeige);
  zeige();
  const wurzel = el(
    "div",
    { class: "feld datei-feld" },
    el("span", { class: "legende", id: `${id}-legende` }, label),
    el(
      "div",
      { class: "datei-zeile" },
      eingabe,
      el(
        "label",
        { class: "knopf knopf--klein", for: id },
        icon("ablage"),
        "Datei wählen",
      ),
      name,
    ),
    hilfe && el("p", { class: "hilfe", id: hilfeId }, hilfe),
  );
  eingabe.setAttribute("aria-labelledby", `${id}-legende`);
  return { wurzel, eingabe };
}

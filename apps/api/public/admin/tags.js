import { anfrage } from "./api.js";
import { flussOffen } from "./fluss.js";
import {
  aktionenZelle,
  chip,
  el,
  filterGruppe,
  icon,
  knopf,
  neueId,
  tabelle,
} from "./dom.js";
import {
  aktionenKopfVerstecken,
  macheSortierbar,
  mitFehlertitel,
  rundKnopf,
  seitenleiste,
  sortiere,
} from "./liste-hilfen.js";
import {
  TYPEN,
  tagDialog,
  tagLoeschen,
  typName,
  zeigeDetail,
} from "./tags-detail.js";
import { leerKarte } from "./zustaende.js";

// Gruppen und Tags (A3 bis A5): Liste mit Suche und Typ-Filter, Detail unter #personen/gruppen/<id>
// Suche, Filter und Sortierung überleben das Neuladen nach einer Aktion; fokus: Gruppe, deren Zeile danach den Fokus bekommt, «seite» = Titel
const zustand = {
  frage: "",
  typ: "alle",
  sort: { schluessel: "name", richtung: "auf" },
  fokus: null,
};

export function zeige(bereich, ctx) {
  const [id] = ctx.pfad;
  if (id) return zeigeDetail(bereich, ctx, id);
  zustand.frage = "";
  zustand.typ = "alle";
  zustand.sort = { schluessel: "name", richtung: "auf" };
  zustand.fokus = null;
  // Eine Abfrage für alle Gruppen mit der Zahl der Mitglieder; wer sie trägt, steht erst im Detail
  ctx.lade(
    mitFehlertitel("Die Gruppen konnten nicht geladen werden.", () =>
      anfrage("GET", "/api/v1/admin/tags"),
    ),
    ({ tags }, neu) => zeichne(bereich, ctx, tags, neu),
  );
}

const nachSchluessel = (t, schluessel) =>
  schluessel === "mitglieder" ? t.anzahlPersonen : t.name;

function zeile(tag, ctx, neu) {
  const bearbeiten = el(
    "a",
    {
      class: "knopf knopf--klein pe-bearbeiten",
      href: `#personen/gruppen/${tag.id}`,
      "aria-label": `Bearbeiten: ${tag.name}`,
    },
    icon("bearbeiten"),
    "Bearbeiten",
  );
  return {
    tag,
    link: bearbeiten,
    tr: el(
      "tr",
      { "data-tag": tag.id },
      el(
        "th",
        { scope: "row" },
        el("span", { class: "name" }, tag.name),
        tag.kuerzel &&
          el("span", { class: "klein leise" }, `Kürzel ${tag.kuerzel}`),
      ),
      el(
        "td",
        {},
        el(
          "ul",
          { class: "chips" },
          chip(
            typName(tag.typ),
            tag.typ === "stufe" ? "stufe" : undefined,
            "tag",
          ),
        ),
      ),
      el("td", { class: "pe-zahl" }, String(tag.anzahlPersonen)),
      aktionenZelle(
        bearbeiten,
        rundKnopf("papierkorb", `Löschen: ${tag.name}`, (e) =>
          tagLoeschen({
            tag,
            ereignis: e,
            ctx,
            neu: () => {
              zustand.fokus = "seite";
              neu();
            },
          }),
        ),
      ),
    ),
  };
}

function zeichne(bereich, ctx, tags, neu) {
  const anlegen = () =>
    tagDialog({
      ctx,
      neu,
      danach: (neuer) => {
        zustand.fokus = neuer?.id ?? "seite";
      },
    });
  ctx.kopfAktion(
    knopf("Neue Gruppe", { art: "haupt", symbol: "plus", onclick: anlegen }),
  );
  if (tags.length === 0) {
    bereich.append(
      leerKarte("Lege zuerst eine Gruppe an.", [
        knopf("Neue Gruppe", { symbol: "plus", onclick: anlegen }),
      ]),
    );
    return;
  }
  const eintraege = tags.map((t) => zeile(t, ctx, neu));
  const { wurzel, koerper } = tabelle({
    beschriftung: "Gruppen und Tags",
    spalten: ["Name", "Typ", "Mitglieder", "Aktionen"],
    zeilen: [],
  });
  const anzahl = el("p", { class: "klein leise", role: "status" });
  const keine = el("div");
  const suchId = neueId("suche");
  const suche = el("input", {
    class: "eingabe",
    id: suchId,
    type: "search",
    placeholder: "Gruppe suchen",
    autocomplete: "off",
    oninput: () => {
      zustand.frage = suche.value;
      seiten.anfang();
      aktualisiere();
    },
  });
  suche.value = zustand.frage;
  const filter = filterGruppe({
    beschriftung: "Typ",
    wert: zustand.typ,
    eintraege: [
      { text: "Alle", n: tags.length, wert: "alle" },
      ...TYPEN.map(([wert, text]) => ({
        text,
        n: tags.filter((t) => t.typ === wert).length,
        wert,
      })),
    ],
    beiAenderung: (wert) => {
      zustand.typ = wert;
      seiten.anfang();
      aktualisiere();
    },
  });
  const seiten = seitenleiste({ beiWechsel: () => aktualisiere() });
  const tabellenBox = el("div", {}, wurzel, seiten.wurzel);
  const zuruecksetzen = () => {
    zustand.frage = "";
    zustand.typ = "alle";
    suche.value = "";
    filter.setze("alle");
    seiten.anfang();
    aktualisiere();
    suche.focus();
  };
  function aktualisiere() {
    const frage = zustand.frage.trim().toLowerCase();
    const treffer = sortiere(
      eintraege.filter(
        (e) =>
          (zustand.typ === "alle" || e.tag.typ === zustand.typ) &&
          e.tag.name.toLowerCase().includes(frage),
      ),
      zustand.sort,
      (e, k) => nachSchluessel(e.tag, k),
    );
    const [von, bis] = seiten.fenster(treffer.length);
    koerper.replaceChildren(...treffer.slice(von, bis).map((e) => e.tr));
    tabellenBox.hidden = treffer.length === 0;
    anzahl.textContent =
      treffer.length === 1 ? "1 Gruppe" : `${treffer.length} Gruppen`;
    keine.replaceChildren(
      treffer.length === 0
        ? leerKarte(
            frage.trim()
              ? `Keine Treffer für «${zustand.frage.trim()}».`
              : "Keine Gruppen dieses Typs.",
            [knopf("Filter zurücksetzen", { onclick: zuruecksetzen })],
          )
        : [],
    );
  }
  macheSortierbar(
    wurzel,
    [
      { index: 0, schluessel: "name", name: "Name" },
      { index: 2, schluessel: "mitglieder", name: "Mitglieder" },
    ],
    zustand.sort,
    () => {
      seiten.anfang();
      aktualisiere();
    },
  );
  aktionenKopfVerstecken(wurzel);
  aktualisiere();
  bereich.append(
    el(
      "div",
      { class: "werkzeuge" },
      el(
        "div",
        { class: "suche" },
        el("label", { class: "nur-leser", for: suchId }, "Gruppe suchen"),
        icon("lupe"),
        suche,
      ),
      filter.wurzel,
    ),
    anzahl,
    keine,
    tabellenBox,
  );
  if (zustand.fokus) {
    const ziel = eintraege.find((e) => e.tag.id === zustand.fokus);
    zustand.fokus = null;
    // Nur eine sichtbare Zeile kann den Fokus bekommen; sonst bleibt er beim Titel
    if (ziel?.tr.isConnected && !flussOffen()) {
      ziel.link.focus();
    } else if (!flussOffen()) {
      document.querySelector("h1")?.focus();
    }
  }
}

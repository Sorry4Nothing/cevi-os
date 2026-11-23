import { anfrage } from "./api.js";
import { flussOffen } from "./fluss.js";
import { aktionenZelle, chip, el, icon, knopf, tabelle } from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import { anlassZeile } from "./tags-anlass.js";
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
      "aria-label": `Öffnen: ${tag.name}`,
    },
    icon("weiter"),
    "Öffnen",
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
        anlassZeile(tag),
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
            tag.typ === "anlass" ? "kalender" : "tag",
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
    bereich.append(leerKarte("Lege zuerst eine Gruppe an.", []));
    return;
  }
  const eintraege = tags.map((t) => zeile(t, ctx, neu));
  const { wurzel, koerper } = tabelle({
    beschriftung: "Gruppen und Tags",
    spalten: ["Name", "Typ", "Mitglieder", "Aktionen"],
    zeilen: [],
  });
  const keine = el("div");
  // Suche und Typ in einer Filterleiste mit gesetzten Filtern als Chips und laufender Trefferzahl
  const leiste = filterleiste({
    suche: { label: "Gruppe suchen", wert: zustand.frage },
    filter: [
      {
        schluessel: "typ",
        label: "Typ",
        optionen: [["alle", "Alle Typen"], ...TYPEN],
        wert: zustand.typ,
      },
    ],
    namen: { einzahl: "Gruppe", mehrzahl: "Gruppen" },
    beiAenderung: ({ suche, filter }) => {
      zustand.frage = suche;
      zustand.typ = filter.typ;
      seiten.anfang();
      aktualisiere();
    },
  });
  const seiten = seitenleiste({ beiWechsel: () => aktualisiere() });
  const tabellenBox = el("div", {}, wurzel, seiten.wurzel);
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
    leiste.setzeTreffer(treffer.length, tags.length);
    keine.replaceChildren(
      treffer.length === 0
        ? leerKarte(
            frage.trim()
              ? `Keine Treffer für «${zustand.frage.trim()}».`
              : "Keine Gruppen dieses Typs.",
            [
              knopf("Filter zurücksetzen", {
                onclick: () => leiste.setzeAlles(),
              }),
            ],
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
  bereich.append(leiste.wurzel, keine, tabellenBox);
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

import { anfrage, fehlertext } from "./api.js";
import { flussOffen } from "./fluss.js";
import {
  aktionenZelle,
  ankreuzen,
  auswahl,
  avatar,
  chip,
  el,
  feld,
  knopf,
  tabelle,
} from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import {
  aktionenKopfVerstecken,
  macheSortierbar,
  mitFehlertitel,
  seitenleiste,
  sortiere,
} from "./liste-hilfen.js";
import {
  fehltTelefon,
  kontoChips,
  oeffnePerson,
  systemRollen,
} from "./personen-blatt.js";
import { meldePersonen, nimmWunsch } from "./befehlspalette.js";
import { typName } from "./tags-detail.js";
import { leerKarte } from "./zustaende.js";

// Personen (A6, A7): Liste mit Filterleiste (Suche, Tag, Rolle, Konto, Trefferzahl), Auswahlleiste für Tags mit «Rückgängig» und eine Seite im Fluss zum Erfassen und Bearbeiten (personen-blatt.js)
// Suche und Filter überleben das Neuladen nach einer Aktion; fokus: Person, deren Zeile danach den Fokus bekommt
const zustand = {
  frage: "",
  filter: { tag: "", rolle: "alle", konto: "alle" },
  sort: { schluessel: "name", richtung: "auf" },
  fokus: null,
};

export function zeige(bereich, ctx) {
  // Wunsch der Befehlspalette: «Neue Person» öffnet das Formular, eine Person setzt die Suche
  const wunsch = nimmWunsch();
  zustand.frage = wunsch?.art === "person" ? wunsch.frage : "";
  zustand.filter = { tag: "", rolle: "alle", konto: "alle" };
  zustand.sort = { schluessel: "name", richtung: "auf" };
  zustand.fokus = null;
  ctx.lade(
    mitFehlertitel("Die Personen konnten nicht geladen werden.", ladeDaten),
    (daten, neu) => {
      meldePersonen(daten.personen);
      zeichne(bereich, ctx, daten, neu);
      if (wunsch?.art === "neu") {
        wunsch.art = "erledigt";
        document.querySelector("#seitenkopf .kopf-aktion button")?.click();
      }
    },
    { skeleton: "tabelle" },
  );
}

// Die API nennt die Tags einer Person nicht; sie stehen im Einzelabruf des Tags. Darum: Personen und Tags in einer Runde, danach je ein Abruf für jeden Tag, den jemand trägt (nicht je Person).
async function ladeDaten() {
  const [liste, tagListe] = await Promise.all([
    anfrage("GET", "/api/v1/admin/personen"),
    anfrage("GET", "/api/v1/admin/tags"),
  ]);
  const belegt = tagListe.tags.filter((t) => t.anzahlPersonen > 0);
  const details = await Promise.all(
    belegt.map((t) => anfrage("GET", `/api/v1/admin/tags/${t.id}`)),
  );
  const tagsJePerson = new Map();
  for (const d of details) {
    const tag = tagListe.tags.find((t) => t.id === d.id);
    for (const e of d.personen) {
      const eigene = tagsJePerson.get(e.userId) ?? [];
      eigene.push({ tag, rolle: e.rolle });
      tagsJePerson.set(e.userId, eigene);
    }
  }
  for (const eigene of tagsJePerson.values()) sortiereTags(eigene);
  return { ...liste, tags: tagListe.tags, tagsJePerson };
}

const sortiereTags = (eigene) =>
  eigene.sort(
    (a, b) =>
      (a.tag.typ === "stufe" ? 0 : 1) - (b.tag.typ === "stufe" ? 0 : 1) ||
      a.tag.name.localeCompare(b.tag.name, "de-CH"),
  );

// Tags für mehrere Personen: Die API kennt nur die Einzelzuordnung, darum je Person ein Aufruf, höchstens 5 gleichzeitig
async function nacheinander(aufgaben) {
  let misslungen = 0;
  for (let i = 0; i < aufgaben.length; i += 5) {
    const ergebnisse = await Promise.allSettled(
      aufgaben.slice(i, i + 5).map((a) => a()),
    );
    misslungen += ergebnisse.filter((e) => e.status === "rejected").length;
  }
  return misslungen;
}

const ROLLE = {
  alle: () => true,
  eltern: (p) => p.elternteilVon.length > 0,
  leitung: (p) => p.rollen.length > 0,
  admin: (p) => p.admin,
};
const KONTO = {
  alle: () => true,
  aktiv: (p) => !p.deaktiviert && !p.mussPasswortAendern,
  offen: (p) => !p.deaktiviert && p.mussPasswortAendern,
  deaktiviert: (p) => p.deaktiviert,
};
const personen = (n) => (n === 1 ? "1 Person" : `${n} Personen`);

function zeichne(bereich, ctx, daten, neu) {
  const erfassenKnopf = () =>
    oeffnePerson({ person: null, daten, ctx, neu, beiFokus });
  const beiFokus = (id) => {
    zustand.fokus = id;
  };
  ctx.kopfAktion(
    knopf("Person erfassen", {
      art: "haupt",
      symbol: "plus",
      onclick: erfassenKnopf,
    }),
  );
  if (daten.personen.length === 0) {
    bereich.append(
      leerKarte(
        "Es gibt noch keine Personen. Erfasse die erste oder übernimm eine Liste über «Import».",
        [],
      ),
    );
    return;
  }
  const gewaehlt = new Set();
  const tagsVon = (p) => daten.tagsJePerson.get(p.id) ?? [];
  const tagZelle = (person) => {
    const tags = tagsVon(person);
    return tags.length
      ? el(
          "ul",
          { class: "chips" },
          tags.map((e) =>
            chip(
              `${e.tag.name} · ${typName(e.tag.typ)}`,
              e.tag.typ === "stufe" ? "stufe" : undefined,
              "tag",
            ),
          ),
        )
      : el("span", { class: "leise" }, "–");
  };
  const eintraege = daten.personen.map((person) => {
    const eigenes = person.id === ctx.ich.id;
    const box = ankreuzen({ label: `${person.name} wählen`, wert: person.id });
    box.wurzel.querySelector("label").classList.add("nur-leser");
    box.eingabe.addEventListener("change", () => {
      if (box.eingabe.checked) gewaehlt.add(person.id);
      else gewaehlt.delete(person.id);
      zeichneAuswahl();
    });
    const rollen = systemRollen(person);
    const bearbeiten = knopf("Bearbeiten", {
      klein: true,
      kontext: person.name,
      symbol: "bearbeiten",
      onclick: () =>
        oeffnePerson({ person, daten, ctx, neu, beiFokus, tr: eintrag.tr }),
    });
    const tagTd = el("td", {}, tagZelle(person));
    const tr = el(
      "tr",
      { class: person.deaktiviert ? "inaktiv" : undefined },
      el("td", { class: "pe-wahl" }, box.wurzel),
      el(
        "th",
        { scope: "row" },
        el(
          "div",
          { class: "wer" },
          avatar(person.name, { hell: !eigenes, bildUrl: person.bildUrl }),
          el(
            "div",
            {},
            el("span", { class: "name" }, person.name, eigenes && " (du)"),
            person.ceviName &&
              el("span", { class: "klein leise" }, person.ceviName),
          ),
        ),
      ),
      tagTd,
      el(
        "td",
        {},
        rollen.length ? rollen.join(", ") : el("span", { class: "leise" }, "–"),
        fehltTelefon(person) &&
          el(
            "ul",
            { class: "chips" },
            chip("Telefon fehlt", "warn", "telefon"),
          ),
      ),
      el("td", {}, el("ul", { class: "chips" }, kontoChips(person))),
      aktionenZelle(bearbeiten),
    );
    const eintrag = {
      person,
      tr,
      box,
      tagTd,
      knopf: bearbeiten,
      tagNamen: "",
      tagIds: [],
    };
    return eintrag;
  });
  // Tag-Spalte und Filterwerte nach einer Änderung der Tags neu aus den Daten ableiten
  const frischeTags = (ids) => {
    for (const e of eintraege) {
      if (ids && !ids.includes(e.person.id)) continue;
      e.tagNamen = tagsVon(e.person)
        .map((t) => t.tag.name)
        .join(" ");
      e.tagIds = tagsVon(e.person).map((t) => t.tag.id);
      e.tagTd.replaceChildren(tagZelle(e.person));
    }
  };
  frischeTags();

  const { wurzel, koerper } = tabelle({
    beschriftung: "Personen",
    spalten: ["Auswahl", "Name", "Tags", "Rolle", "Konto", "Aktionen"],
    zeilen: [],
  });
  // Kopfzelle der Auswahlspalte: «Alle wählen» betrifft die Zeilen der Seite
  const alleBox = ankreuzen({ label: "Alle wählen" });
  alleBox.wurzel.querySelector("label").classList.add("nur-leser");
  wurzel.querySelector("thead th").replaceChildren(alleBox.wurzel);
  wurzel.querySelector("thead th").classList.add("pe-wahl");
  alleBox.eingabe.addEventListener("change", () => {
    for (const e of sichtbar) {
      e.box.eingabe.checked = alleBox.eingabe.checked;
      if (alleBox.eingabe.checked) gewaehlt.add(e.person.id);
      else gewaehlt.delete(e.person.id);
    }
    zeichneAuswahl();
  });
  let sichtbar = [];
  let treffer = [];
  const keine = el("div");
  const seiten = seitenleiste({ beiWechsel: () => aktualisiere() });
  const tabellenBox = el("div", {}, wurzel, seiten.wurzel);

  const leiste = filterleiste({
    suche: { label: "Name oder Cevi-Name", wert: zustand.frage },
    filter: [
      {
        schluessel: "tag",
        label: "Tag",
        optionen: [["", "Alle Tags"], ...daten.tags.map((t) => [t.id, t.name])],
        wert: zustand.filter.tag,
      },
      {
        schluessel: "rolle",
        label: "Rolle",
        optionen: [
          ["alle", "Alle Rollen"],
          ["eltern", "Eltern"],
          ["leitung", "Leitung"],
          ["admin", "Admin"],
        ],
        wert: zustand.filter.rolle,
      },
      {
        schluessel: "konto",
        label: "Konto",
        optionen: [
          ["alle", "Alle Konten"],
          ["aktiv", "Aktiv"],
          ["offen", "Startpasswort offen"],
          ["deaktiviert", "Deaktiviert"],
        ],
        wert: zustand.filter.konto,
      },
    ],
    namen: { einzahl: "Person", mehrzahl: "Personen" },
    beiAenderung: ({ suche, filter }) => {
      zustand.frage = suche;
      zustand.filter = filter;
      seiten.anfang();
      aktualisiere();
    },
  });

  // Auswahlleiste (Muster «action-toolbar»): sagt, wie viele gewählt sind, und bietet die Sammelaktionen; Tags setzen und entziehen lassen sich zurücknehmen
  const auswahlLeiste = el("div", {
    class: "auswahlleiste",
    role: "region",
    "aria-label": "Auswahl",
    hidden: true,
  });
  const nachAuswahl = () => {
    for (const e of eintraege)
      e.box.eingabe.checked = gewaehlt.has(e.person.id);
    zeichneAuswahl();
  };
  let offeneAktion = null; // "hinzufuegen" | "entfernen"
  function zeichneAuswahl() {
    auswahlLeiste.hidden = gewaehlt.size === 0;
    if (gewaehlt.size === 0) offeneAktion = null;
    const n = gewaehlt.size;
    const kopfZeile = el(
      "div",
      { class: "auswahlleiste-zeile" },
      el("span", { role: "status", class: "auswahl-zahl" }, `${n} gewählt`),
      knopf("Tag setzen", {
        klein: true,
        symbol: "tag",
        "aria-expanded": String(offeneAktion === "hinzufuegen"),
        onclick: () => oeffneAktion("hinzufuegen"),
      }),
      knopf("Tag entziehen", {
        klein: true,
        "aria-expanded": String(offeneAktion === "entfernen"),
        onclick: () => oeffneAktion("entfernen"),
      }),
      knopf("Auswahl aufheben", {
        klein: true,
        art: "still",
        onclick: () => {
          gewaehlt.clear();
          nachAuswahl();
          alleBox.eingabe.focus();
        },
      }),
    );
    auswahlLeiste.replaceChildren(
      kopfZeile,
      offeneAktion ? aktionsFormular(offeneAktion) : false,
    );
    alleBox.eingabe.checked =
      sichtbar.length > 0 && sichtbar.every((e) => gewaehlt.has(e.person.id));
  }
  function oeffneAktion(art) {
    offeneAktion = offeneAktion === art ? null : art;
    zeichneAuswahl();
    auswahlLeiste.querySelector(".auswahl-knopf, input")?.focus();
  }

  // Der Tag wird für die Auswahl gesetzt oder entzogen: sofort sichtbar, die Anfragen gehen nach der Frist (ctx.mitRueckgaengig)
  function aktionsFormular(art) {
    const hinzufuegen = art === "hinzufuegen";
    const ids = [...gewaehlt];
    const traeger = (tagId) =>
      ids.filter((id) => tagsVon({ id }).some((e) => e.tag.id === tagId));
    const verfuegbar = hinzufuegen
      ? daten.tags
      : daten.tags.filter((t) => traeger(t.id).length > 0);
    if (verfuegbar.length === 0) {
      return el(
        "p",
        { class: "auswahlleiste-hinweis" },
        "Die gewählten Personen tragen keinen Tag.",
      );
    }
    const tag = auswahl({
      label: "Tag",
      optionen: [
        ["", "Tag wählen"],
        ...verfuegbar.map((t) => [t.id, `${t.name} (${typName(t.typ)})`]),
      ],
      wert: "",
    });
    const rolle = hinzufuegen
      ? feld({
          label: "Rolle (optional)",
          hilfe: "Freier Text, höchstens 50 Zeichen.",
          maxlength: 50,
        })
      : null;
    const fehlerText = el(
      "p",
      { class: "feld-fehler", role: "alert", hidden: true },
      "Wähle einen Tag.",
    );
    const anwenden = knopf(hinzufuegen ? "Tag setzen" : "Tag entziehen", {
      art: hinzufuegen ? "haupt" : "gefahr",
      klein: true,
      onclick: () => {
        const tagId = tag.eingabe.value;
        if (!tagId) {
          fehlerText.hidden = false;
          tag.wurzel.querySelector(".auswahl-knopf").focus();
          return;
        }
        wende(art, tagId, ids, rolle?.eingabe.value.trim() || null);
      },
    });
    return el(
      "div",
      { class: "auswahlleiste-formular" },
      el("div", { class: "auswahlleiste-felder" }, tag.wurzel, rolle?.wurzel),
      fehlerText,
      el(
        "div",
        { class: "aktionen" },
        anwenden,
        knopf("Abbrechen", {
          klein: true,
          art: "still",
          onclick: () => oeffneAktion(art),
        }),
      ),
    );
  }

  function wende(art, tagId, ids, rolleText) {
    const hinzufuegen = art === "hinzufuegen";
    const tag = daten.tags.find((t) => t.id === tagId);
    const hat = (id) => tagsVon({ id }).some((e) => e.tag.id === tagId);
    const ziele = hinzufuegen
      ? ids.filter((id) => !hat(id))
      : ids.filter((id) => hat(id));
    const alt = new Map(
      ziele.map((id) => [id, daten.tagsJePerson.get(id)?.slice()]),
    );
    const setzeLokal = () => {
      for (const id of ziele) {
        const liste = (daten.tagsJePerson.get(id) ?? []).filter(
          (e) => e.tag.id !== tagId,
        );
        if (hinzufuegen) liste.push({ tag, rolle: rolleText });
        daten.tagsJePerson.set(id, sortiereTags(liste));
      }
      frischeTags(ziele);
      aktualisiere();
    };
    const holeZurueck = () => {
      for (const [id, liste] of alt) {
        if (liste === undefined) daten.tagsJePerson.delete(id);
        else daten.tagsJePerson.set(id, liste);
      }
      frischeTags(ziele);
      aktualisiere();
    };
    if (ziele.length === 0) {
      ctx.melde(
        hinzufuegen
          ? `Alle gewählten Personen tragen «${tag.name}» schon.`
          : `Keine der gewählten Personen trägt «${tag.name}».`,
        "info",
      );
      return;
    }
    gewaehlt.clear();
    offeneAktion = null;
    nachAuswahl();
    ctx.mitRueckgaengig({
      text: hinzufuegen
        ? `«${tag.name}» gilt für ${personen(ziele.length)}`
        : `«${tag.name}» ist ${personen(ziele.length)} entzogen`,
      ansicht: { weg: setzeLokal, zurueck: holeZurueck },
      ausfuehren: () =>
        nacheinander(
          ziele.map(
            (id) => () =>
              hinzufuegen
                ? anfrage(
                    "PUT",
                    `/api/v1/admin/tags/${tagId}/personen/${id}`,
                    rolleText ? { rolle: rolleText } : {},
                  )
                : anfrage(
                    "DELETE",
                    `/api/v1/admin/tags/${tagId}/personen/${id}`,
                  ),
          ),
        ),
      fehlertext,
      danach: (misslungen) => {
        if (misslungen > 0) {
          ctx.melde(
            `«${tag.name}»: ${misslungen} von ${ziele.length} Änderungen gingen nicht durch. Prüfe die Liste und versuche es nochmals.`,
            "warn",
          );
        }
        // Der Stand der API ist die Wahrheit: Liste neu holen
        neu();
      },
    });
  }

  function aktualisiere() {
    const frage = zustand.frage.trim().toLowerCase();
    const f = zustand.filter;
    treffer = sortiere(
      eintraege.filter(
        (e) =>
          ROLLE[f.rolle](e.person) &&
          KONTO[f.konto](e.person) &&
          (!f.tag || e.tagIds.includes(f.tag)) &&
          `${e.person.name} ${e.person.ceviName ?? ""} ${e.person.benutzername ?? ""}`
            .toLowerCase()
            .includes(frage),
      ),
      zustand.sort,
      (e, k) => (k === "tags" ? e.tagNamen : e.person.name),
    );
    const [von, bis] = seiten.fenster(treffer.length);
    sichtbar = treffer.slice(von, bis);
    koerper.replaceChildren(...sichtbar.map((e) => e.tr));
    tabellenBox.hidden = treffer.length === 0;
    leiste.setzeTreffer(treffer.length, daten.personen.length);
    keine.replaceChildren(
      treffer.length === 0
        ? leerKarte(
            frage.trim()
              ? `Keine Treffer für «${zustand.frage.trim()}».`
              : "Keine Personen für diese Filter.",
            [
              knopf("Filter zurücksetzen", {
                onclick: () => leiste.setzeAlles(),
              }),
            ],
          )
        : [],
    );
    zeichneAuswahl();
  }
  macheSortierbar(
    wurzel,
    [
      { index: 1, schluessel: "name", name: "Name" },
      { index: 2, schluessel: "tags", name: "Tags" },
    ],
    zustand.sort,
    () => {
      seiten.anfang();
      aktualisiere();
    },
  );
  aktionenKopfVerstecken(wurzel);
  aktualisiere();
  bereich.append(leiste.wurzel, auswahlLeiste, keine, tabellenBox);
  // Nach Speichern oder Kontoaktion zurück zur Zeile, wenn keine Seite im Fluss den Fokus hält
  if (zustand.fokus) {
    const ziel = eintraege.find((e) => e.person.id === zustand.fokus);
    zustand.fokus = null;
    // Steht die Person auf einer späteren Seite, blättert die Liste zu ihr, damit der Fokus eine sichtbare Zeile trifft
    if (ziel && !ziel.tr.isConnected && treffer.includes(ziel)) {
      seiten.zu(treffer.indexOf(ziel));
      aktualisiere();
    }
    if (!flussOffen()) {
      (ziel?.tr.isConnected
        ? ziel.knopf
        : document.querySelector("h1")
      )?.focus();
    }
  }
}

import { anfrage, fehlertext, kennungGueltig } from "./api.js";
import { flussOffen } from "./fluss.js";
import {
  aktionenZelle,
  ankreuzen,
  auswahl,
  chip,
  el,
  feld,
  icon,
  knopf,
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
import { skeletonTabelle } from "./lader.js";
import { rollenName } from "./rollenname.js";
import {
  abschnitte,
  ansichtsleiste,
  chipListe,
  gespeicherteAnsicht,
  gliedere,
  marke,
  mitgliedKarte,
  mitgliedKopf,
  skeletonKarten,
  stufenKennzeichen,
  zeichneAnsicht,
} from "./mitglieder.js";
import { leerKarte } from "./zustaende.js";

// Personen (A6, A7): Liste mit Filterleiste (Suche, Tag, Rolle, Konto, Trefferzahl), Auswahlleiste für Tags mit «Rückgängig» und eine Seite im Fluss zum Erfassen und Bearbeiten (personen-blatt.js)
// Suche und Filter überleben das Neuladen nach einer Aktion; fokus: Person, deren Zeile danach den Fokus bekommt
const zustand = {
  frage: "",
  filter: { tag: "", rolle: "alle", konto: "alle" },
  sort: { schluessel: "name", richtung: "auf" },
  gruppierung: "rolle",
  fokus: null,
  // Person, deren Blatt nach dem Laden aufgeht (Adresse #personen/personen/<id>, zum Beispiel aus der Liste einer Funktion)
  oeffne: null,
};

export function zeige(bereich, ctx) {
  const [id] = ctx.pfad;
  // Die Kennung geht nie in einen Pfad der API, aber nur eine echte UUID öffnet ein Blatt
  if (id && (!kennungGueltig(id) || ctx.pfad.length > 1)) {
    return ctx.nichtGefunden();
  }
  zustand.oeffne = id ?? null;
  // Wunsch der Befehlspalette: «Neue Person» öffnet das Formular, eine Person setzt die Suche
  const wunsch = nimmWunsch();
  zustand.frage = wunsch?.art === "person" ? wunsch.frage : "";
  // Die gewählte Person bekommt den Fokus, sobald die Liste steht
  const gesucht = wunsch?.art === "person" ? wunsch.id : null;
  zustand.filter = { tag: "", rolle: "alle", konto: "alle" };
  zustand.sort = { schluessel: "name", richtung: "auf" };
  zustand.fokus = gesucht ?? null;
  ctx.lade(
    mitFehlertitel("Die Personen konnten nicht geladen werden.", () =>
      ladeDaten({ funktionen: ctx.zugang?.darf("rechte.verwalten") === true }),
    ),
    (daten, neu) => {
      meldePersonen(daten, { systemRollen, kontoChips, typName });
      zeichne(bereich, ctx, daten, neu);
      if (wunsch?.art === "neu") {
        wunsch.art = "erledigt";
        document.querySelector("#seitenkopf .kopf-aktion button")?.click();
      }
    },
    {
      skeleton: () =>
        gespeicherteAnsicht() === "liste"
          ? skeletonTabelle({ spalten: 6 })
          : skeletonKarten(),
    },
  );
}

// Die API nennt die Tags einer Person nicht; sie stehen im Einzelabruf des Tags. Darum: Personen und Tags in einer Runde, danach je ein Abruf für jeden Tag, den jemand trägt (nicht je Person).
// funktionen: dazu die globalen Rollen laden (Funktionen wie Webmaster, mit ihren Personen). Das geht nur mit «Rechte und Rollen vergeben»; fehlt es oder der zweite Faktor, bleibt die Liste und das Blatt zeigt keine Funktionen
export async function ladeDaten({ funktionen = false } = {}) {
  const [liste, tagListe, rollen] = await Promise.all([
    anfrage("GET", "/api/v1/admin/personen"),
    anfrage("GET", "/api/v1/admin/tags"),
    funktionen
      ? anfrage("GET", "/api/v1/admin/rechte/rollen").catch(() => null)
      : null,
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
  return {
    ...liste,
    tags: tagListe.tags,
    tagsJePerson,
    funktionen: rollen?.rollen ?? null,
  };
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
  abteilungsleitung: (p) => p.abteilungsleitung,
  entwickler: (p) => p.entwickler,
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
  const stufenname = new Map(daten.stufen.map((s) => [s.id, s.name]));
  // Die Stufenrolle steht schon als Rolle da; der gleichnamige Stufen-Tag mit derselben Funktion wäre doppelt
  const eigeneTags = (person) => {
    const stufenrollen = new Set(
      person.rollen.map((r) => stufenname.get(r.stufeId)),
    );
    return tagsVon(person).filter(
      (e) =>
        !(
          e.tag.typ === "stufe" &&
          ["leitung", "stufenleitung"].includes(e.rolle) &&
          stufenrollen.has(e.tag.name)
        ),
    );
  };
  const tagChips = (person) =>
    eigeneTags(person).map((e) =>
      chip(
        `${e.tag.name} · ${typName(e.tag.typ)}`,
        e.tag.typ === "stufe" ? "stufe" : undefined,
        "tag",
      ),
    );
  const rollenChips = (person) =>
    [
      person.abteilungsleitung && chip("Abteilungsleitung", undefined, false),
      person.entwickler && chip("Entwickler", undefined, false),
      ...person.rollen.map((r) =>
        chip(
          `${rollenName(r.typ, person.geschlecht)} · ${stufenname.get(r.stufeId) ?? "Stufe"}`,
          "stufe",
          false,
        ),
      ),
      person.elternteilVon.length > 0 && chip("Eltern", undefined, false),
      fehltTelefon(person) && chip("Telefon fehlt", "warn", "telefon"),
    ].filter(Boolean);
  // Konto: Ein aktives Konto ist eine ruhige Marke, alles andere (Startpasswort, Sperre) bleibt ein Chip
  const kontoMarken = (person) => {
    const [zustandChip] = kontoChips(person);
    return [
      zustandChip.classList.contains("chip--ok")
        ? marke("Konto aktiv", "haken", "ok")
        : el("ul", { class: "chips" }, zustandChip),
      person.zweiterFaktor && marke("Zweiter Faktor", "schild"),
    ];
  };
  const chipSpalte = (chips) =>
    chips.length
      ? el("ul", { class: "chips" }, chips)
      : el("span", { class: "leise" }, "–");

  const eintraege = daten.personen.map((person) => {
    const eigenes = person.id === ctx.ich.id;
    const box = ankreuzen({ label: `${person.name} wählen`, wert: person.id });
    box.wurzel.querySelector("label").classList.add("nur-leser");
    box.eingabe.addEventListener("change", () => {
      if (box.eingabe.checked) gewaehlt.add(person.id);
      else gewaehlt.delete(person.id);
      zeichneAuswahl();
    });
    const eintrag = {
      person,
      eigenes,
      box,
      knoten: null, // Karte oder Zeile, je nach Ansicht neu gebaut
      knopf: null,
      tagNamen: "",
      tagIds: [],
    };
    eintrag.knopf = knopf("Bearbeiten", {
      klein: true,
      kontext: person.name,
      symbol: "bearbeiten",
      onclick: () =>
        oeffnePerson({
          person,
          daten,
          ctx,
          neu,
          beiFokus,
          tr: eintrag.knoten,
        }),
    });
    return eintrag;
  });
  // Kontakt nur dort, wo die Verwaltung die Nummer ohnehin sieht (Stufenleitung)
  const anrufen = (e) =>
    e.person.telefon &&
    el(
      "a",
      {
        class: "knopf knopf--klein mg-anruf",
        href: `tel:${e.person.telefon.replace(/[^\d+]/g, "")}`,
        "aria-label": `Anrufen: ${e.person.name}`,
        "data-tipp": "Anrufen",
      },
      icon("telefon"),
    );
  const ton = (p) =>
    p.abteilungsleitung || p.entwickler || p.rollen.length > 0
      ? "blau"
      : "hell";
  const karte = (e) => {
    const p = e.person;
    e.knoten = mitgliedKarte({
      id: p.id,
      aus: p.deaktiviert,
      kopf: mitgliedKopf({
        name: p.name,
        ceviName: p.ceviName,
        bildUrl: p.bildUrl,
        du: e.eigenes,
        gross: true,
        ton: ton(p),
        zusatz: kontoMarken(p),
      }),
      rollen: chipListe(rollenChips(p), { max: 3 }),
      tags: chipListe(tagChips(p), { max: 3 }),
      aktionen: [anrufen(e), e.knopf],
      wahl: e.box.wurzel,
    });
    return e.knoten;
  };
  const zeile = (e) => {
    const p = e.person;
    e.knoten = el(
      "tr",
      { class: p.deaktiviert ? "inaktiv" : undefined },
      el("td", { class: "pe-wahl" }, e.box.wurzel),
      el(
        "th",
        { scope: "row" },
        mitgliedKopf({
          name: p.name,
          ceviName: p.ceviName,
          bildUrl: p.bildUrl,
          du: e.eigenes,
          ton: ton(p),
        }),
      ),
      el("td", {}, chipSpalte(rollenChips(p))),
      el("td", {}, chipSpalte(tagChips(p))),
      el("td", {}, el("div", { class: "mg-zustand" }, kontoMarken(p))),
      aktionenZelle(anrufen(e), e.knopf),
    );
    return e.knoten;
  };
  // Filterwerte nach einer Änderung der Tags neu aus den Daten ableiten
  const frischeTags = (ids) => {
    for (const e of eintraege) {
      if (ids && !ids.includes(e.person.id)) continue;
      e.tagNamen = tagsVon(e.person)
        .map((t) => t.tag.name)
        .join(" ");
      e.tagIds = tagsVon(e.person).map((t) => t.tag.id);
    }
  };
  frischeTags();

  // «Alle wählen» betrifft die Einträge der Seite und steht in der Leiste über der Ansicht, für Karten und Liste gleich
  const alleBox = ankreuzen({ label: "Alle auf der Seite wählen" });
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
  const ansichtBox = el("div", { class: "mg-ansicht" });
  const seiten = seitenleiste({ beiWechsel: () => aktualisiere() });
  const tabellenBox = el("div", {}, ansichtBox, seiten.wurzel);

  // Abschnitte nach Rolle (Leitende, Abteilungsleitung, Eltern, Weitere) oder nach Stufe; «keine» zeigt alle in einem Raster
  const stufenRang = new Map(daten.stufen.map((s, i) => [s.id, i]));
  const kindStufe = new Map(daten.kinder.map((k) => [k.id, k.stufeId]));
  const stufeVon = (p) =>
    [
      ...p.rollen.map((r) => r.stufeId),
      ...p.elternteilVon.map((id) => kindStufe.get(id)),
    ]
      .filter((id) => stufenRang.has(id))
      .sort((a, b) => stufenRang.get(a) - stufenRang.get(b))[0] ?? "";
  const gruppenFuer = (art) =>
    art === "rolle"
      ? {
          gruppen: [
            { schluessel: "leitung", titel: "Leitende" },
            { schluessel: "abteilungsleitung", titel: "Abteilungsleitung" },
            { schluessel: "entwickler", titel: "Entwickler" },
            { schluessel: "eltern", titel: "Eltern" },
            { schluessel: "weitere", titel: "Weitere Personen" },
          ],
          schluesselVon: ({ person: p }) =>
            p.rollen.length > 0
              ? "leitung"
              : p.abteilungsleitung
                ? "abteilungsleitung"
                : p.entwickler
                  ? "entwickler"
                  : p.elternteilVon.length > 0
                    ? "eltern"
                    : "weitere",
        }
      : art === "stufe"
        ? {
            gruppen: [
              ...daten.stufen.map((s) => ({
                schluessel: s.id,
                titel: s.name,
                kennzeichen: stufenKennzeichen(s),
              })),
              { schluessel: "", titel: "Ohne Stufe" },
            ],
            schluesselVon: ({ person }) => stufeVon(person),
          }
        : { gruppen: null, schluesselVon: () => "" };
  const ansicht = ansichtsleiste({
    links: alleBox.wurzel,
    gruppierungen: [
      ["rolle", "Rolle"],
      ["stufe", "Stufe"],
      ["keine", "Keine"],
    ],
    gruppierung: zustand.gruppierung,
    beiAenderung: (stand) => {
      zustand.gruppierung = stand.gruppierung;
      seiten.anfang();
      aktualisiere(true);
    },
  });

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
          ["abteilungsleitung", "Abteilungsleitung"],
          ["entwickler", "Entwickler"],
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
      ...(offeneAktion ? [aktionsFormular(offeneAktion)] : []),
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

  function aktualisiere(animiert = false) {
    const frage = zustand.frage.trim().toLowerCase();
    const f = zustand.filter;
    const gefiltert = sortiere(
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
    const { gruppen, schluesselVon } = gruppenFuer(ansicht.stand().gruppierung);
    const geordnet = gliedere(gefiltert, gruppen, schluesselVon);
    treffer = geordnet.geordnet;
    const [von, bis] = seiten.fenster(treffer.length);
    sichtbar = treffer.slice(von, bis);
    const tabelleKnoten = zeichneAnsicht(ansichtBox, {
      ansicht: ansicht.stand().ansicht,
      beschriftung: "Personen",
      spalten: ["Auswahl", "Person", "Rolle", "Tags", "Konto", "Aktionen"],
      abschnitte: abschnitte(sichtbar, gruppen, schluesselVon, geordnet.gesamt),
      karte,
      zeile,
      animiert,
    });
    // Die Tabelle entsteht bei jeder Zeichnung neu: Sortierknöpfe gehen mit, der Fokus bleibt auf dem Knopf
    if (tabelleKnoten) {
      tabelleKnoten
        .querySelector("thead th")
        .replaceChildren(el("span", { class: "nur-leser" }, "Auswahl"));
      macheSortierbar(
        tabelleKnoten,
        [
          { index: 1, schluessel: "name", name: "Person" },
          { index: 3, schluessel: "tags", name: "Tags" },
        ],
        zustand.sort,
        () => {
          seiten.anfang();
          aktualisiere();
          ansichtBox
            .querySelector("th:not([aria-sort='none']) .pe-sortieren")
            ?.focus();
        },
      );
      aktionenKopfVerstecken(tabelleKnoten);
    }
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
  aktualisiere(true);
  bereich.append(
    leiste.wurzel,
    ansicht.wurzel,
    auswahlLeiste,
    keine,
    tabellenBox,
  );
  // Adresse mit Kennung: Das Blatt der Person geht auf (einmal)
  if (zustand.oeffne) {
    const ziel = eintraege.find((e) => e.person.id === zustand.oeffne);
    zustand.oeffne = null;
    ziel?.knopf.click();
  }
  // Nach Speichern oder Kontoaktion zurück zur Zeile, wenn keine Seite im Fluss den Fokus hält
  if (zustand.fokus) {
    const ziel = eintraege.find((e) => e.person.id === zustand.fokus);
    zustand.fokus = null;
    // Steht die Person auf einer späteren Seite, blättert die Liste zu ihr, damit der Fokus eine sichtbare Zeile trifft
    if (ziel && !ziel.knoten?.isConnected && treffer.includes(ziel)) {
      seiten.zu(treffer.indexOf(ziel));
      aktualisiere();
    }
    if (!flussOffen()) {
      (ziel?.knoten?.isConnected
        ? ziel.knopf
        : document.querySelector("h1")
      )?.focus();
    }
  }
}

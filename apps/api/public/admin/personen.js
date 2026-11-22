import { anfrage, fehlertext } from "./api.js";
import {
  aktionenZelle,
  ankreuzen,
  auswahl,
  avatar,
  chip,
  dialogFormular,
  el,
  feld,
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
  seitenleiste,
  sortiere,
} from "./liste-hilfen.js";
import {
  kinderFelder,
  oeffneBlatt,
  rollenFelder,
  startpasswortDialog,
  statusChips,
  systemRollen,
} from "./personen-blatt.js";
import { typName } from "./tags-detail.js";
import { leerKarte } from "./zustaende.js";

// Personen (A6, A7): Liste mit Suche, Tag, Status und Rolle, Mehrfachauswahl für Tags, Seitenblatt zum Bearbeiten
// Suche und Filter überleben das Neuladen nach einer Aktion; fokus: Person, deren Zeile danach den Fokus bekommt
const zustand = {
  frage: "",
  tag: "",
  status: "alle",
  rolle: "alle",
  sort: { schluessel: "name", richtung: "auf" },
  fokus: null,
};

export function zeige(bereich, ctx) {
  zustand.frage = "";
  zustand.tag = "";
  zustand.status = "alle";
  zustand.rolle = "alle";
  zustand.sort = { schluessel: "name", richtung: "auf" };
  zustand.fokus = null;
  ctx.lade(
    mitFehlertitel("Die Personen konnten nicht geladen werden.", ladeDaten),
    (daten, neu) => zeichne(bereich, ctx, daten, neu),
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
  for (const eigene of tagsJePerson.values()) {
    eigene.sort(
      (a, b) =>
        (a.tag.typ === "stufe" ? 0 : 1) - (b.tag.typ === "stufe" ? 0 : 1) ||
        a.tag.name.localeCompare(b.tag.name, "de-CH"),
    );
  }
  return { ...liste, tags: tagListe.tags, tagsJePerson };
}

// Person erfassen: Konto mit Startpasswort, Stufenrollen und Kindern
function erfassen(daten, ctx, neu) {
  const vorname = feld({ label: "Vorname", maxlength: 100, required: true });
  const nachname = feld({ label: "Nachname", maxlength: 100, required: true });
  const ceviName = feld({ label: "Cevi-Name (optional)", maxlength: 50 });
  const telefon = feld({
    label: "Telefon (optional)",
    typ: "tel",
    hilfe:
      "Nur für Stufenleitungen. Eltern, Leitende und Stufenleitung der Stufe sehen die Nummer bei den Kontakten. Leer lassen, um sie zu entfernen.",
    maxlength: 30,
    autocomplete: "off",
  });
  const benutzername = feld({
    label: "Benutzername",
    hilfe:
      "2 bis 64 Zeichen: Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich. Gross- und Kleinschreibung zählt nicht.",
    maxlength: 64,
    autocapitalize: "none",
    spellcheck: "false",
    required: true,
  });
  const admin = ankreuzen({ label: "Admin-Rechte" });
  const rollen = rollenFelder(daten.stufen, []);
  const kinder = kinderFelder(daten.kinder, daten.stufen, []);
  dialogFormular({
    titel: "Person erfassen",
    beschreibung:
      "Die Person erhält ein Startpasswort. Es bleibt im Blatt der Person sichtbar, bis sie es ersetzt hat.",
    felder: [
      vorname.wurzel,
      nachname.wurzel,
      ceviName.wurzel,
      telefon.wurzel,
      benutzername.wurzel,
      admin.wurzel,
      rollen.wurzel,
      kinder.wurzel,
    ],
    ok: "Erfassen",
    senden: () =>
      anfrage("POST", "/api/v1/admin/personen", {
        vorname: vorname.eingabe.value.trim(),
        nachname: nachname.eingabe.value.trim(),
        ceviName: ceviName.eingabe.value,
        telefon: telefon.eingabe.value,
        benutzername: benutzername.eingabe.value.trim(),
        admin: admin.eingabe.checked,
        rollen: rollen.wert(),
        elternteilVon: kinder.wert(),
      }),
    fehlertext: (f) =>
      f.code === "BENUTZERNAME_VERGEBEN"
        ? "Der Benutzername ist schon vergeben. Wähle einen anderen."
        : fehlertext(f),
    danach: (antwort) => {
      neu();
      ctx.melde(`Person «${antwort.benutzername}» ist erfasst.`);
      startpasswortDialog(antwort.benutzername, antwort.startpasswort);
    },
  });
}

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

function sammelAktion({ art, auswahlIds, daten, ctx, neu, danach }) {
  const hinzufuegen = art === "hinzufuegen";
  const traeger = (tagId) =>
    auswahlIds.filter((id) =>
      daten.tagsJePerson.get(id)?.some((e) => e.tag.id === tagId),
    );
  const verfuegbar = hinzufuegen
    ? daten.tags
    : daten.tags.filter((t) => traeger(t.id).length > 0);
  if (verfuegbar.length === 0) {
    ctx.melde("Die gewählten Personen tragen keinen Tag.", "info");
    return;
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
  const n = auswahlIds.length;
  dialogFormular({
    titel: hinzufuegen ? "Tag hinzufügen" : "Tag entfernen",
    beschreibung: `${n === 1 ? "1 Person ist" : `${n} Personen sind`} gewählt.`,
    felder: [tag.wurzel, rolle?.wurzel].filter(Boolean),
    ok: hinzufuegen ? "Hinzufügen" : "Entfernen",
    gefaehrlich: !hinzufuegen,
    pruefe: () => {
      if (tag.eingabe.value) return false;
      const fehler = el(
        "p",
        { class: "feld-fehler", role: "alert" },
        "Wähle einen Tag.",
      );
      tag.wurzel.querySelector(".feld-fehler")?.remove();
      tag.wurzel.append(fehler);
      tag.wurzel.querySelector(".auswahl-knopf").focus();
      return true;
    },
    senden: async () => {
      const tagId = tag.eingabe.value;
      const text = rolle?.eingabe.value.trim();
      const ziele = hinzufuegen
        ? auswahlIds.filter((id) => !traeger(tagId).includes(id))
        : traeger(tagId);
      const misslungen = await nacheinander(
        ziele.map(
          (id) => () =>
            hinzufuegen
              ? anfrage(
                  "PUT",
                  `/api/v1/admin/tags/${tagId}/personen/${id}`,
                  text ? { rolle: text } : {},
                )
              : anfrage("DELETE", `/api/v1/admin/tags/${tagId}/personen/${id}`),
        ),
      );
      return { tagId, ziele: ziele.length, misslungen };
    },
    danach: ({ tagId, ziele, misslungen }) => {
      const name = daten.tags.find((t) => t.id === tagId)?.name ?? "Tag";
      neu();
      danach();
      if (misslungen > 0) {
        ctx.melde(
          `«${name}»: ${misslungen} von ${ziele} Änderungen gingen nicht durch. Prüfe die Liste und versuche es nochmals.`,
          "warn",
        );
      } else {
        ctx.melde(
          hinzufuegen
            ? `«${name}» gilt jetzt für ${ziele === 1 ? "1 Person" : `${ziele} Personen`}.`
            : `«${name}» ist ${ziele === 1 ? "1 Person" : `${ziele} Personen`} entzogen.`,
        );
      }
    },
  });
}

const FILTER = {
  alle: () => true,
  eltern: (p) => p.elternteilVon.length > 0,
  leitung: (p) => p.rollen.length > 0,
  admin: (p) => p.admin,
};
const STATUS = {
  alle: () => true,
  offen: (p) => p.mussPasswortAendern,
  deaktiviert: (p) => p.deaktiviert,
};

function zeichne(bereich, ctx, daten, neu) {
  const erfassenKnopf = () => erfassen(daten, ctx, neu);
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
        [knopf("Person erfassen", { symbol: "plus", onclick: erfassenKnopf })],
      ),
    );
    return;
  }
  const gewaehlt = new Set();
  const tagsVon = (p) => daten.tagsJePerson.get(p.id) ?? [];
  const eintraege = daten.personen.map((person) => {
    const eigenes = person.id === ctx.ich.id;
    const box = ankreuzen({ label: `${person.name} wählen`, wert: person.id });
    box.wurzel.querySelector("label").classList.add("nur-leser");
    box.eingabe.addEventListener("change", () => {
      if (box.eingabe.checked) gewaehlt.add(person.id);
      else gewaehlt.delete(person.id);
      zeichneAuswahl();
    });
    const tags = tagsVon(person);
    const status = statusChips(person);
    const rollen = systemRollen(person);
    const bearbeiten = knopf("Bearbeiten", {
      klein: true,
      kontext: person.name,
      symbol: "bearbeiten",
      onclick: () =>
        oeffneBlatt({
          person,
          daten,
          ctx,
          neu,
          beiFokus: (id) => {
            zustand.fokus = id;
          },
          tr,
        }),
    });
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
      el(
        "td",
        {},
        tags.length
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
          : el("span", { class: "leise" }, "–"),
      ),
      el(
        "td",
        {},
        rollen.length ? rollen.join(", ") : el("span", { class: "leise" }, "–"),
      ),
      el(
        "td",
        {},
        status.length
          ? el("ul", { class: "chips" }, status)
          : el("span", { class: "leise" }, "–"),
      ),
      aktionenZelle(bearbeiten),
    );
    return {
      person,
      tr,
      box,
      knopf: bearbeiten,
      tagNamen: tags.map((e) => e.tag.name).join(" "),
      tagIds: tags.map((e) => e.tag.id),
    };
  });
  const { wurzel, koerper } = tabelle({
    beschriftung: "Personen",
    spalten: ["Auswahl", "Name", "Tags", "Rolle", "Status", "Aktionen"],
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
  const zaehler = el("p", { class: "klein leise", role: "status" });
  const keine = el("div");
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
  function zeichneAuswahl() {
    auswahlLeiste.hidden = gewaehlt.size === 0;
    const n = gewaehlt.size;
    auswahlLeiste.replaceChildren(
      el("span", { role: "status" }, `${n} gewählt`),
      knopf("Tag hinzufügen", {
        klein: true,
        symbol: "tag",
        onclick: () =>
          sammelAktion({
            art: "hinzufuegen",
            auswahlIds: [...gewaehlt],
            daten,
            ctx,
            neu,
            danach: () => gewaehlt.clear(),
          }),
      }),
      knopf("Tag entfernen", {
        klein: true,
        onclick: () =>
          sammelAktion({
            art: "entfernen",
            auswahlIds: [...gewaehlt],
            daten,
            ctx,
            neu,
            danach: () => gewaehlt.clear(),
          }),
      }),
      knopf("Auswahl aufheben", {
        klein: true,
        onclick: () => {
          gewaehlt.clear();
          nachAuswahl();
          alleBox.eingabe.focus();
        },
      }),
    );
    alleBox.eingabe.checked =
      sichtbar.length > 0 && sichtbar.every((e) => gewaehlt.has(e.person.id));
  }
  const seiten = seitenleiste({ beiWechsel: () => aktualisiere() });
  const tabellenBox = el("div", {}, wurzel, seiten.wurzel);
  const suchId = neueId("suche");
  const suche = el("input", {
    class: "eingabe",
    id: suchId,
    type: "search",
    placeholder: "Name oder Cevi-Name",
    autocomplete: "off",
    oninput: () => {
      zustand.frage = suche.value;
      vonVorn();
    },
  });
  suche.value = zustand.frage;
  const vonVorn = () => {
    seiten.anfang();
    aktualisiere();
  };
  const tagWahl = auswahl({
    label: "Tag",
    optionen: [["", "Alle Tags"], ...daten.tags.map((t) => [t.id, t.name])],
    wert: zustand.tag,
  });
  tagWahl.wurzel.classList.add("pe-filterfeld");
  tagWahl.eingabe.addEventListener("change", () => {
    zustand.tag = tagWahl.eingabe.value;
    vonVorn();
  });
  const statusWahl = auswahl({
    label: "Status",
    optionen: [
      ["alle", "Alle"],
      ["offen", "Startpasswort offen"],
      ["deaktiviert", "Deaktiviert"],
    ],
    wert: zustand.status,
  });
  statusWahl.wurzel.classList.add("pe-filterfeld");
  statusWahl.eingabe.addEventListener("change", () => {
    zustand.status = statusWahl.eingabe.value;
    vonVorn();
  });
  const anzahl = (wert) => daten.personen.filter(FILTER[wert]).length;
  const rollenFilter = filterGruppe({
    beschriftung: "Rolle",
    wert: zustand.rolle,
    eintraege: [
      { text: "Alle", wert: "alle" },
      { text: "Eltern", wert: "eltern" },
      { text: "Leitung", wert: "leitung" },
      { text: "Admin", wert: "admin" },
    ].map((e) => ({ ...e, n: anzahl(e.wert) })),
    beiAenderung: (wert) => {
      zustand.rolle = wert;
      vonVorn();
    },
  });
  // Die eigenen Auswahlfelder zeigen einen von aussen gesetzten Wert nicht an: Die Ansicht entsteht mit den Vorgaben neu
  const zuruecksetzen = () => {
    zustand.frage = "";
    zustand.tag = "";
    zustand.status = "alle";
    zustand.rolle = "alle";
    bereich.replaceChildren();
    zeichne(bereich, ctx, daten, neu);
    bereich.querySelector(".suche input")?.focus();
  };
  function aktualisiere() {
    const frage = zustand.frage.trim().toLowerCase();
    treffer = sortiere(
      eintraege.filter(
        (e) =>
          FILTER[zustand.rolle](e.person) &&
          STATUS[zustand.status](e.person) &&
          (!zustand.tag || e.tagIds.includes(zustand.tag)) &&
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
    zaehler.textContent = `${treffer.length} von ${daten.personen.length} Personen`;
    keine.replaceChildren(
      treffer.length === 0
        ? leerKarte(
            frage.trim()
              ? `Keine Treffer für «${zustand.frage.trim()}».`
              : "Keine Personen für diesen Filter.",
            [knopf("Filter zurücksetzen", { onclick: zuruecksetzen })],
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
    vonVorn,
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
        el("label", { class: "nur-leser", for: suchId }, "Name oder Cevi-Name"),
        icon("lupe"),
        suche,
      ),
      tagWahl.wurzel,
      statusWahl.wurzel,
      rollenFilter.wurzel,
    ),
    auswahlLeiste,
    zaehler,
    keine,
    tabellenBox,
  );
  // Nach Speichern oder Kontoaktion zurück zur Zeile, wenn kein Dialog den Fokus hält
  if (zustand.fokus) {
    const ziel = eintraege.find((e) => e.person.id === zustand.fokus);
    zustand.fokus = null;
    // Steht die Person auf einer späteren Seite, blättert die Liste zu ihr, damit der Fokus eine sichtbare Zeile trifft
    if (ziel && !ziel.tr.isConnected && treffer.includes(ziel)) {
      seiten.zu(treffer.indexOf(ziel));
      aktualisiere();
    }
    if (!document.querySelector("dialog[open]")) {
      (ziel?.tr.isConnected
        ? ziel.knopf
        : document.querySelector("h1")
      )?.focus();
    }
  }
}

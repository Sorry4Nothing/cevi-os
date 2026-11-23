import { ApiFehler, anfrage, fehlertext } from "./api.js";
import {
  chip,
  el,
  feld,
  filterGruppe,
  knopf,
  neueId,
  tabelle,
  zeit,
} from "./dom.js";
import { sk } from "./lader.js";
import { MAX_TIEFE, API, baue as baueBaum } from "./website-baum.js";
import {
  anzahlText,
  band,
  beschaeftigt,
  bei,
  fenster,
  keinRecht,
  kuerze,
  sichtbarkeitText,
  uhrzeit,
} from "./website-dialoge.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";
import { symbol } from "./website-symbole.js";
import { zustandsKarte } from "./zustaende.js";

// Seitenliste (Board E1): Der Seitenbaum mit Status, Sichtbarkeit und Zeit der letzten Änderung; «Bearbeiten» öffnet den Editor,
// «Löschen» und «Neue Seite» gibt es nur mit dem Recht dazu. Ein Abruf lädt die ganze Liste (der Baum entsteht hier aus elternId).
// Die Einstellungen, die Reihenfolge und die Sichtbarkeit einer Seite stehen im Editor (E2, E5).
// Schnittstelle zum Bereich: ctx aus admin.js; ctx.pfad[0] ist die Kennung einer Seite, dann übernimmt der Editor.

// Codes, deren Meldung der Server für Menschen formuliert hat
const SEITEN_CODES = new Set([
  "ADRESSE_RESERVIERT",
  "ADRESSE_VERGEBEN",
  "TAG_VERGEBEN",
  "TAG_ERFORDERLICH",
  "SEITE_ZYKLUS",
  "SEITE_ZU_TIEF",
  "SEITE_HAT_UNTERSEITEN",
]);
const seitenFehler = (f) =>
  f?.meldung && SEITEN_CODES.has(f.code) ? f.meldung : fehlertext(f);

// frage, filter: überleben das Neuladen nach einer Aktion; vorlagen: einmal je Besuch geladen
const zustand = { frage: "", filter: "alle", vorlagen: null };

export async function zeige(bereich, ctx) {
  if (ctx.pfad.length > 0) {
    const editor = await import("./website-editor.js");
    editor.zeige(bereich, ctx);
    return;
  }
  zustand.frage = "";
  zustand.filter = "alle";
  zustand.vorlagen = null;
  ctx.lade(
    () => ladeAlles(),
    (daten) => zeichne(bereich, ctx, daten),
    { skeleton: skeletonListe },
  );
}

async function ladeAlles() {
  try {
    const [liste, tags] = await Promise.all([
      anfrage("GET", `${API}/seiten`),
      anfrage("GET", `${API}/tags`),
    ]);
    return { seiten: liste.seiten, tags: tags.tags, stand: new Date() };
  } catch (f) {
    if (f instanceof ApiFehler && f.status === 403) return { keinRecht: true };
    throw f;
  }
}

// Die Liste, solange sie lädt: Werkzeugzeile und eine Tabelle mit denselben fünf Spalten (G3 «Seitenbaum»)
function skeletonListe() {
  const zelle = (inhalt) => el("td", {}, inhalt);
  const zeile = (i) =>
    el(
      "tr",
      { "aria-hidden": "true" },
      zelle(el("div", {}, sk("t", i % 2 ? 136 : 160), sk("t", 96))),
      zelle(sk("r", 96)),
      zelle(sk("r", 80)),
      zelle(sk("t", 160)),
      zelle(sk("r", 112)),
    );
  return el(
    "div",
    { class: "sk-seitenliste" },
    el("div", { class: "werkzeuge" }, sk("r", 380), sk("r", 380)),
    el(
      "div",
      { class: "box" },
      el(
        "table",
        { class: "tabelle" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            ["Seite", "Status", "Sichtbarkeit", "Zuletzt geändert", ""].map(
              () => el("th", { scope: "col" }, sk("t", 64)),
            ),
          ),
        ),
        el("tbody", {}, [0, 1, 2, 3, 4, 5].map(zeile)),
      ),
    ),
  );
}

function zeichne(bereich, ctx, daten) {
  if (daten.keinRecht) return keinRecht(bereich);
  bereich.replaceChildren();
  const verwalten = ctx.zugang.darf("seiten.anlegen_loeschen");
  const darfAnlegen = verwalten && ctx.zugang.darf("vorlagen.nutzen");
  const k = {
    ctx,
    bereich,
    daten,
    baum: baueBaum(daten.seiten),
    tagNamen: new Map(daten.tags.map((t) => [t.id, t.name])),
    verwalten,
  };
  ctx.kopfAktion(
    ...(darfAnlegen
      ? [
          knopf("Neue Seite", {
            art: "haupt",
            symbol: "plus",
            onclick: () => neueSeite(k),
          }),
        ]
      : []),
  );

  if (!verwalten) {
    bereich.append(
      band(
        "info",
        "Du siehst nur, was deine Rolle betrifft: die Seite deiner Stufe.",
      ),
    );
  }
  if (daten.seiten.length === 0) {
    const karte = zustandsKarte(
      {
        titel: darfAnlegen
          ? "Es gibt noch keine Seiten."
          : "Du kannst im Moment keine Seite bearbeiten.",
        text: darfAnlegen
          ? "Lege die erste Seite an. Am einfachsten mit der Vorlage «Textseite»."
          : "Wende dich an die Abteilungsleitung, wenn du eine Seite bearbeiten sollst.",
      },
      darfAnlegen ? [knopf("Neue Seite", { onclick: () => neueSeite(k) })] : [],
    );
    karte.wurzel.setAttribute("role", "status");
    bereich.append(karte.wurzel);
    return;
  }

  const eintraege = k.baum.zeilen.map((z) => zeile(k, z));
  const { wurzel } = tabelle({
    beschriftung: "Seiten der Website",
    spalten: [
      "Seite",
      "Status",
      "Sichtbarkeit",
      "Zuletzt geändert",
      "Aktionen",
    ],
    zeilen: eintraege.map((e) => e.tr),
  });
  const FILTER = {
    alle: () => true,
    entwurf: (s) => !s.veroeffentlicht,
    veroeffentlicht: (s) => s.veroeffentlicht,
  };
  const anzahl = (wert) => daten.seiten.filter(FILTER[wert]).length;
  const zaehler = el("p", { class: "klein leise", role: "status" });
  const suchId = neueId("suche");
  const suche = el("input", {
    class: "eingabe",
    id: suchId,
    type: "search",
    placeholder: "Titel oder Adresse",
    autocomplete: "off",
    oninput: () => {
      zustand.frage = suche.value;
      aktualisiere();
    },
  });
  suche.value = zustand.frage;
  const filter = filterGruppe({
    beschriftung: "Status",
    wert: zustand.filter,
    eintraege: [
      ["alle", "Alle"],
      ["entwurf", "Entwurf"],
      ["veroeffentlicht", "Veröffentlicht"],
    ].map(([wert, text]) => ({ text, wert, n: anzahl(wert) })),
    beiAenderung: (wert) => {
      zustand.filter = wert;
      aktualisiere();
    },
  });
  const keine = el("div", { class: "zustand", role: "status", hidden: true });
  const leseSuche = () => zustand.frage.trim();
  const zuruecksetzen = knopf("Suche zurücksetzen", {
    onclick: () => {
      zustand.frage = "";
      zustand.filter = "alle";
      suche.value = "";
      filter.setze("alle");
      aktualisiere();
      suche.focus();
    },
  });
  function aktualisiere() {
    const frage = leseSuche().toLowerCase();
    let n = 0;
    for (const e of eintraege) {
      const sichtbar =
        FILTER[zustand.filter](e.seite) && e.suche.includes(frage);
      e.tr.hidden = !sichtbar;
      if (sichtbar) n++;
    }
    zaehler.textContent = `${n} von ${anzahlText(daten.seiten.length, "1 Seite", "Seiten")}`;
    keine.hidden = n > 0;
    wurzel.hidden = n === 0;
    if (n === 0) {
      keine.replaceChildren(
        el(
          "h2",
          {},
          leseSuche()
            ? `Keine Seite passt zu «${kuerze(leseSuche(), 40)}».`
            : "Keine Seite passt zum Filter.",
        ),
        el(
          "p",
          { class: "leise" },
          "Prüfe die Schreibweise oder suche nach einem Teil des Titels.",
        ),
        zuruecksetzen,
      );
    }
  }
  aktualisiere();
  // Der Platz für «Keine Verbindung» liegt über der Liste
  k.meldeplatz = el("div", {});
  bereich.append(
    k.meldeplatz,
    el(
      "div",
      { class: "werkzeuge" },
      el(
        "div",
        { class: "suche" },
        el("label", { class: "nur-leser", for: suchId }, "Seite suchen"),
        symbol("lupe"),
        suche,
      ),
      filter.wurzel,
    ),
    zaehler,
    keine,
    wurzel,
  );
}

function zeile(k, z) {
  const { seite, ebene } = z;
  const name = el(
    "a",
    { class: "name ws-name", href: `#website/seiten/${seite.id}` },
    seite.titel,
  );
  const bearbeiten = el(
    "a",
    {
      class: "knopf knopf--klein",
      href: `#website/seiten/${seite.id}`,
      "aria-label": `Bearbeiten: ${seite.titel}`,
    },
    symbol("bearbeiten"),
    "Bearbeiten",
  );
  const loeschen =
    k.verwalten &&
    el(
      "button",
      {
        type: "button",
        class: "knopf knopf--rund",
        "aria-label": `Löschen: ${seite.titel}`,
        onclick: (e) => loesche(k, z, e),
      },
      symbol("papierkorb"),
    );
  const tr = el(
    "tr",
    {},
    el(
      "td",
      {},
      el(
        "div",
        { class: "ws-seitenzelle" },
        Array.from({ length: Math.min(ebene, 4) }, () =>
          el("span", { class: "baum-ebene", "aria-hidden": "true" }),
        ),
        el(
          "div",
          {},
          name,
          el("span", { class: "mono leise ws-pfad" }, seite.pfad),
          ebene > 0 &&
            el(
              "span",
              { class: "nur-leser" },
              `Unterseite, Ebene ${ebene + 1}`,
            ),
        ),
      ),
    ),
    el(
      "td",
      {},
      el(
        "ul",
        { class: "chips" },
        seite.veroeffentlicht
          ? chip("Veröffentlicht", "ok")
          : chip("Entwurf", "warn", "bearbeiten"),
      ),
    ),
    el(
      "td",
      {},
      el(
        "ul",
        { class: "chips" },
        chip(
          sichtbarkeitText(seite.sichtbarkeit, k.tagNamen),
          undefined,
          "schild",
        ),
      ),
    ),
    el(
      "td",
      { class: "klein leise" },
      el("time", { datetime: seite.geaendertAm }, zeit(seite.geaendertAm)),
    ),
    el(
      "td",
      { class: "rechts" },
      el("div", { class: "aktionen" }, bearbeiten, loeschen),
    ),
  );
  return {
    seite,
    tr,
    name,
    suche: `${seite.titel} ${seite.pfad}`.toLowerCase(),
  };
}

// Nach einer Änderung neu laden: Schlägt es fehl (offline), bleibt die Liste stehen und ein Band sagt, von wann sie ist
async function neuLaden(k, fokusId) {
  try {
    const daten = await ladeAlles();
    if (!k.bereich.isConnected) return;
    zeichneNeu(k, daten, fokusId);
  } catch (f) {
    if (!k.bereich.isConnected) return;
    const text =
      f?.status === 0
        ? `Keine Verbindung. Die Liste zeigt den Stand von ${uhrzeit.format(k.daten.stand)}. Prüfe dein Internet.`
        : `Die Liste konnte nicht aktualisiert werden. Sie zeigt den Stand von ${uhrzeit.format(k.daten.stand)}.`;
    k.meldeplatz.replaceChildren(
      band(
        "warn",
        text,
        knopf("Nochmals versuchen", {
          klein: true,
          onclick: () => neuLaden(k, fokusId),
        }),
      ),
    );
  }
}

function zeichneNeu(k, daten, fokusId) {
  zeichne(k.bereich, k.ctx, daten);
  if (fokusId === null) {
    (
      k.bereich.querySelector(".ws-name") ?? document.querySelector("h1")
    )?.focus();
  } else if (fokusId) {
    k.bereich.querySelector(`a.ws-name[href$="${fokusId}"]`)?.focus();
  }
}

// Mit «Rückgängig» (#578): Die Zeile verschwindet sofort, gelöscht wird nach der Frist (samt Entwurf und allen Versionen). Mit Unterseiten geht es nicht: nur ein Hinweis, keine Aktion
function loesche(k, z, ereignis) {
  const { seite } = z;
  const n = (k.baum.kinder.get(seite.id) ?? []).length;
  if (n > 0) {
    k.ctx.melde(
      `«${seite.titel}» hat ${anzahlText(n, "1 Unterseite", "Unterseiten")}. Verschiebe oder lösche sie zuerst, danach lässt sich die Seite löschen.`,
      "warn",
    );
    return;
  }
  k.ctx.mitRueckgaengig({
    text: `Seite «${kuerze(seite.titel, 50)}» gelöscht. Wer den Link aufruft, sieht «Diese Seite gibt es nicht»`,
    ansicht: ansichtVonKnopf(ereignis),
    ausfuehren: () => anfrage("DELETE", `${API}/seiten/${seite.id}`),
    fehlertext: seitenFehler,
    danach: () => {
      const i = k.baum.zeilen.indexOf(z);
      const nachbar = k.baum.zeilen[i + 1] ?? k.baum.zeilen[i - 1];
      neuLaden(k, nachbar ? nachbar.seite.id : null);
    },
  });
}

// Neue Seite (E1): Vorlage als Wahlkarte, Titel, Elternseite und, wo die Vorlage es braucht, die Gruppe
async function neueSeite(k) {
  if (!zustand.vorlagen) {
    try {
      zustand.vorlagen = (await anfrage("GET", `${API}/vorlagen`)).vorlagen;
    } catch (f) {
      k.ctx.melde(seitenFehler(f), "fehler");
      return;
    }
  }
  const vorlagen = zustand.vorlagen;
  const standard = (
    vorlagen.find((v) => v.schluessel === "stufenseite") ?? vorlagen[0]
  ).schluessel;
  let gewaehlt = standard;
  const vname = neueId("vorlage");
  const karten = vorlagen.map((v) => {
    const eingabe = el("input", {
      type: "radio",
      name: vname,
      value: v.schluessel,
      onchange: () => {
        gewaehlt = v.schluessel;
        aktualisiere();
      },
    });
    eingabe.checked = v.schluessel === gewaehlt;
    return el(
      "label",
      { class: "wahlkarte" },
      eingabe,
      el("div", {}, el("strong", {}, v.name), el("span", {}, v.beschreibung)),
    );
  });
  const titel = feld({
    label: "Titel",
    maxlength: 120,
    required: true,
    hilfe: "Die Adresse entsteht aus dem Titel. Du kannst sie danach ändern.",
  });
  const elternId = neueId("eltern");
  const eltern = el(
    "select",
    { id: elternId, class: "ws-select" },
    el("option", { value: "" }, "Oberste Ebene"),
    k.daten.seiten
      .filter((s) => (k.baum.ebenen.get(s.id) ?? 0) + 2 <= MAX_TIEFE)
      .map((s) => el("option", { value: s.id }, `${s.titel} (${s.pfad})`)),
  );
  const belegt = new Set(k.daten.seiten.map((s) => s.tagId).filter(Boolean));
  const freieTags = k.daten.tags.filter((t) => !belegt.has(t.id));
  const gruppeId = neueId("gruppe");
  const gruppeSel = el(
    "select",
    { id: gruppeId, class: "ws-select" },
    el("option", { value: "" }, "Gruppe wählen"),
    freieTags.map((t) => el("option", { value: t.id }, t.name)),
  );
  const gruppe = el(
    "div",
    { class: "feld" },
    el("label", { for: gruppeId }, "Gruppe"),
    gruppeSel,
  );
  function aktualisiere() {
    const v = vorlagen.find((x) => x.schluessel === gewaehlt);
    gruppe.hidden = !v?.brauchtTag;
  }
  aktualisiere();
  const abbrechen = knopf("Abbrechen", { onclick: () => f.schliesse() });
  const erstellen = knopf("Erstellen", { art: "haupt" });
  bei(erstellen, async () => {
    f.fehler(null);
    const v = vorlagen.find((x) => x.schluessel === gewaehlt);
    const tagId = v?.brauchtTag ? gruppeSel.value : "";
    if (!titel.eingabe.value.trim()) {
      f.fehler("Gib einen Titel ein.");
      titel.eingabe.focus();
      return;
    }
    if (v?.brauchtTag && !tagId) {
      f.fehler(
        freieTags.length === 0
          ? "Alle Gruppen haben schon eine Seite."
          : "Wähle die Gruppe, zu der die Seite gehört.",
      );
      return;
    }
    beschaeftigt(erstellen, true);
    abbrechen.disabled = true;
    try {
      // Ohne Vorgabe «öffentlich»: Wer anlegt, öffnet die Seite bewusst, im Editor unter «Sichtbarkeit»
      const neu = await anfrage("POST", `${API}/seiten/aus-vorlage`, {
        vorlage: gewaehlt,
        titel: titel.eingabe.value.trim(),
        elternId: eltern.value || null,
        ...(tagId && { tagId }),
        sichtbarkeit: { art: "angemeldet" },
      });
      zustand.frage = "";
      zustand.filter = "alle";
      f.dialog.addEventListener(
        "close",
        () => {
          k.ctx.melde(
            "Die Seite ist angelegt. Sie ist ein Entwurf und nur für Angemeldete sichtbar.",
            "ok",
            {
              text: "Seite bearbeiten",
              onclick: () => {
                location.hash = `#website/seiten/${neu.id}`;
              },
            },
          );
          neuLaden(k, neu.id);
        },
        { once: true },
      );
      f.schliesse();
    } catch (fehler) {
      f.fehler(seitenFehler(fehler));
      beschaeftigt(erstellen, false);
      abbrechen.disabled = false;
    }
  });
  const f = fenster({
    titel: "Neue Seite",
    inhalt: [
      el(
        "fieldset",
        { class: "ws-vorlagen" },
        el("legend", { class: "legende" }, "Vorlage"),
        karten,
      ),
      titel.wurzel,
      el(
        "div",
        { class: "feld" },
        el("label", { for: elternId }, "Elternseite"),
        eltern,
      ),
      gruppe,
    ],
    fuss: [abbrechen, erstellen],
    fokus: titel.eingabe,
  });
}

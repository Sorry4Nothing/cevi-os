import { ApiFehler, anfrage, fehlertext } from "./api.js";
import { el, feld, filterGruppe, knopf, neueId } from "./dom.js";
import { sk } from "./lader.js";
import {
  ADRESSE,
  MAX_TIEFE,
  API,
  RESERVIERT,
  adresseAusTitel,
  baue as baueBaum,
  patch,
} from "./website-baum.js";
import { baumAnsicht } from "./website-baumansicht.js";
import {
  anzahlText,
  band,
  beschaeftigt,
  bei,
  fenster,
  keinRecht,
  kuerze,
  uhrzeit,
} from "./website-dialoge.js";
import { ansichtVon } from "./rueckgaengig.js";
import { skizze } from "./website-skizzen.js";
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
const zustand = {
  frage: "",
  filter: "alle",
  vorlagen: null,
  zugeklappt: new Set(),
};

export async function zeige(bereich, ctx) {
  if (ctx.pfad.length > 0) {
    const editor = await import("./website-editor.js");
    editor.zeige(bereich, ctx);
    return;
  }
  zustand.frage = "";
  zustand.filter = "alle";
  zustand.vorlagen = null;
  zustand.zugeklappt = new Set();
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
    tagNamen: new Map(daten.tags.map((t) => [t.id, t.name])),
    verwalten,
    seitenFehler,
    beiLoeschen: (z, element) => loesche(k, z.seite, element),
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

  const baum = baumAnsicht(k, zustand);
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
  // Treffer und ihre Elternseiten bleiben im Baum sichtbar, damit die Einrückung verständlich bleibt
  function aktualisiere() {
    const frage = leseSuche().toLowerCase();
    const nachId = new Map(daten.seiten.map((s) => [s.id, s]));
    const treffer = new Set(
      daten.seiten
        .filter(
          (s) =>
            FILTER[zustand.filter](s) &&
            `${s.titel} ${s.pfad}`.toLowerCase().includes(frage),
        )
        .map((s) => s.id),
    );
    const aktiv = frage !== "" || zustand.filter !== "alle";
    const ids = new Set(treffer);
    if (aktiv) {
      for (const id of treffer) {
        for (let e = nachId.get(id)?.elternId; e; e = nachId.get(e)?.elternId) {
          ids.add(e);
        }
      }
    }
    baum.filtere(aktiv ? ids : null, treffer);
    const n = treffer.size;
    zaehler.textContent = `${n} von ${anzahlText(daten.seiten.length, "1 Seite", "Seiten")}`;
    keine.hidden = n > 0;
    baum.wurzel.hidden = n === 0;
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
    baum.wurzel,
  );
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
  const zeile = fokusId
    ? k.bereich.querySelector(`[role=treeitem][data-id="${fokusId}"]`)
    : null;
  (
    zeile ??
    k.bereich.querySelector("[role=treeitem]") ??
    document.querySelector("h1")
  )?.focus();
}

// Mit «Rückgängig» (#578): Die Zeile verschwindet sofort, gelöscht wird nach der Frist (samt Entwurf und allen Versionen). Mit Unterseiten geht es nicht: nur ein Hinweis, keine Aktion
function loesche(k, seite, element) {
  const n = k.daten.seiten.filter((s) => s.elternId === seite.id).length;
  if (n > 0) {
    k.ctx.melde(
      `«${seite.titel}» hat ${anzahlText(n, "1 Unterseite", "Unterseiten")}. Verschiebe oder lösche sie zuerst, danach lässt sich die Seite löschen.`,
      "warn",
    );
    return;
  }
  const nachbar =
    element?.nextElementSibling?.dataset.id ??
    element?.previousElementSibling?.dataset.id ??
    null;
  k.ctx.mitRueckgaengig({
    text: `Seite «${kuerze(seite.titel, 50)}» gelöscht. Wer den Link aufruft, sieht «Diese Seite gibt es nicht»`,
    ansicht: ansichtVon(element),
    ausfuehren: () => anfrage("DELETE", `${API}/seiten/${seite.id}`),
    fehlertext: seitenFehler,
    danach: () => neuLaden(k, nachbar),
  });
}

// Neue Seite (E1): Vorlage als Skizze, Titel, Adresse mit Live-Prüfung, Elternseite und, wo die Vorlage es braucht, die Gruppe
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
      { class: "wahlkarte ws-vorlage" },
      eingabe,
      skizze(v.schluessel),
      el("div", {}, el("strong", {}, v.name), el("span", {}, v.beschreibung)),
    );
  });
  const titel = feld({
    label: "Titel",
    maxlength: 120,
    required: true,
    hilfe: "So heisst die Seite in der Liste und in der Navigation.",
  });
  const baum = baueBaum(k.daten.seiten);
  const elternId = neueId("eltern");
  const eltern = el(
    "select",
    { id: elternId, class: "ws-select" },
    el("option", { value: "" }, "Oberste Ebene"),
    k.daten.seiten
      .filter((s) => (baum.ebenen.get(s.id) ?? 0) + 2 <= MAX_TIEFE)
      .map((s) => el("option", { value: s.id }, `${s.titel} (${s.pfad})`)),
  );
  eltern.addEventListener("change", () => aktualisiere());
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

  // Adresse: folgt dem Titel, bis die Person sie selbst ändert; Prüfung gegen die Seiten unter derselben Elternseite (der Server prüft zusätzlich)
  const adresseId = neueId("adresse");
  const praefix = el("span", { class: "ws-handle-praefix mono" }, "/");
  const adresse = el("input", {
    class: "eingabe mono",
    id: adresseId,
    type: "text",
    maxlength: "60",
    autocomplete: "off",
    spellcheck: "false",
    "aria-describedby": `${adresseId}-stand`,
  });
  const stand = el("p", {
    class: "hilfe ws-adressstand",
    id: `${adresseId}-stand`,
    role: "status",
  });
  let angepasst = false;
  adresse.addEventListener("input", () => {
    angepasst = adresse.value !== "";
    aktualisiere();
  });
  titel.eingabe.addEventListener("input", () => aktualisiere());
  const pruefeAdresse = () => {
    const wert = adresse.value.trim();
    const geschwister = k.daten.seiten.filter(
      (s) => (s.elternId ?? "") === eltern.value,
    );
    if (!wert)
      return { art: "info", text: "Die Adresse entsteht aus dem Titel." };
    if (!ADRESSE.test(wert))
      return {
        art: "fehler",
        text: "Nur Kleinbuchstaben, Ziffern und «-», höchstens 60 Zeichen.",
      };
    if (geschwister.some((s) => s.adresse === wert))
      return {
        art: angepasst ? "fehler" : "warn",
        text: angepasst
          ? "Diese Adresse ist hier schon vergeben. Wähle eine andere."
          : "Diese Adresse ist hier schon vergeben. Die Seite bekommt eine Zahl am Ende.",
      };
    if (eltern.value === "" && RESERVIERT.includes(wert))
      return {
        art: angepasst ? "fehler" : "warn",
        text: "Diese Adresse gehört der Verwaltung oder der Website. Wähle eine andere.",
      };
    return { art: "ok", text: "Die Adresse ist frei." };
  };
  function aktualisiere() {
    const v = vorlagen.find((x) => x.schluessel === gewaehlt);
    gruppe.hidden = !v?.brauchtTag;
    const vater = k.daten.seiten.find((s) => s.id === eltern.value);
    praefix.textContent = `${vater ? vater.pfad : ""}/`;
    if (!angepasst) {
      adresse.value = titel.eingabe.value.trim()
        ? adresseAusTitel(titel.eingabe.value)
        : "";
    }
    const r = pruefeAdresse();
    stand.replaceChildren(
      r.art === "fehler" || r.art === "warn"
        ? symbol("warnung")
        : r.art === "ok"
          ? symbol("haken")
          : "",
      r.text,
    );
    stand.dataset.art = r.art;
    adresse.setAttribute("aria-invalid", r.art === "fehler" ? "true" : "false");
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
    if (angepasst && pruefeAdresse().art === "fehler") {
      f.fehler(stand.textContent);
      adresse.focus();
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
    let adressText = "";
    try {
      // Ohne Vorgabe «öffentlich»: Wer anlegt, öffnet die Seite bewusst, im Editor unter «Zugriff»
      const neu = await anfrage("POST", `${API}/seiten/aus-vorlage`, {
        vorlage: gewaehlt,
        titel: titel.eingabe.value.trim(),
        elternId: eltern.value || null,
        ...(tagId && { tagId }),
        sichtbarkeit: { art: "angemeldet" },
      });
      // Die Route kennt keine Adresse: Eine eigene Wahl folgt als zweiter Schritt; scheitert er, bleibt die Adresse aus dem Titel
      const gewuenscht = adresse.value.trim();
      if (angepasst && gewuenscht && gewuenscht !== neu.adresse) {
        try {
          await patch(neu.id, { adresse: gewuenscht });
        } catch {
          adressText = ` Deine Adresse konnte nicht gesetzt werden, die Seite heisst «${neu.adresse}». Ändere sie im Editor.`;
        }
      }
      zustand.frage = "";
      zustand.filter = "alle";
      f.dialog.addEventListener(
        "close",
        () => {
          k.ctx.melde(
            `Die Seite ist angelegt. Sie ist ein Entwurf und nur für Angemeldete sichtbar.${adressText}`,
            adressText ? "warn" : "ok",
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
    breit: true,
    inhalt: [
      el(
        "div",
        { class: "ws-neu" },
        el(
          "fieldset",
          { class: "ws-vorlagen" },
          el("legend", { class: "legende" }, "Vorlage"),
          karten,
        ),
        el(
          "div",
          { class: "ws-neu-felder" },
          titel.wurzel,
          el(
            "div",
            { class: "feld" },
            el("label", { for: elternId }, "Elternseite"),
            eltern,
          ),
          el(
            "div",
            { class: "feld ws-handle" },
            el("label", { for: adresseId }, "Adresse"),
            el("div", { class: "ws-handle-zeile" }, praefix, adresse),
            stand,
          ),
          gruppe,
        ),
      ),
    ],
    fuss: [abbrechen, erstellen],
    fokus: titel.eingabe,
  });
}

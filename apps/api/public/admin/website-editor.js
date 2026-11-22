import { anfrage, fehlertext } from "./api.js";
import {
  ankreuzen,
  bestaetigen,
  chip,
  dialogFormular,
  el,
  feld,
  gruppe,
  icon,
  knopf,
  neueId,
  seitenblatt,
  zeit,
} from "./dom.js";
import {
  bloeckeZuText,
  textZuBloecken,
  zaehleZeichen,
} from "./website-richtext.js";

// Editor einer Seite (#358): Bausteine, Vorschau, Veröffentlichen und Versionen. Schnittstelle zum Bereich: siehe website.js.
//
// Das Dokument der Seite liegt als Objekt im Speicher und ist die einzige Wahrheit: Jedes Formularfeld schreibt beim Tippen dorthin,
// die Karten werden daraus gezeichnet. Der Server prüft alles (Fehler mit Pfad); der Browser prüft nur, was fehlt.
// Nur ein gültiges Dokument lässt sich speichern (der Entwurf ist immer gültig): Unfertiges bleibt hier, bis es fertig ist.
// Kein Autospeichern: Unfertige Bausteine lassen sich nicht speichern, ein Takt würde nur Fehler melden und die Datenbank belasten.
// Dafür geht nichts verloren: Rückfrage beim Verlassen, Warnung beim Schliessen des Tabs, und beim Zurückkehren auf dieselbe Seite die ungespeicherte Fassung.

const API = "/api/v1/redaktion";
const MAX_BAUSTEINE = 100;
const MAX_TEXT_ZEICHEN = 20000;
const MAX_KARTEN = 24;
const MAX_GALERIE = 50;

// Ungespeicherte Fassungen für den Rest des Besuchs (nur Arbeitsspeicher, nichts im Browser), je Konto und Seite: { dok, zaehler }
const puffer = new Map();

const uhrzeit = new Intl.DateTimeFormat("de-CH", { timeStyle: "short" });
const kopie = (wert) => JSON.parse(JSON.stringify(wert));
const neueUuid = () => globalThis.crypto.randomUUID();
const kuerze = (text, n = 60) =>
  text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text;
const anzahlText = (n, eins, viele) => (n === 1 ? eins : `${n} ${viele}`);

const ARTEN = {
  oeffentlich: "Öffentlich",
  angemeldet: "Nur angemeldet",
  tags: "Bestimmte Gruppen",
};
const LINK_HILFE =
  "Eine Seite dieser Website (zum Beispiel /stufen/woelfe), eine Webadresse mit https, eine E-Mail-Adresse mit mailto: oder eine Telefonnummer mit tel:.";

// Namen der Felder und Texte zu den Codes der Prüfung des Servers (zod und Verweisprüfung)
const FELDNAMEN = {
  titel: "Der Titel",
  text: "Der Text",
  ebene: "Die Ebene",
  inhalt: "Der Text",
  mediumId: "Das Bild",
  bilder: "Die Bilder",
  unterschrift: "Die Bildunterschrift",
  eintraege: "Die Einträge",
  darstellung: "Die Darstellung",
  beschriftung: "Die Beschriftung",
  ziel: "Das Ziel",
  link: "Der Link",
  typ: "Der Dateityp",
  groesse: "Die Grösse",
  url: "Die Adresse",
  art: "Die Art",
  personId: "Die Person",
  tagId: "Die Gruppe",
  anzahl: "Die Anzahl",
  sichtbarkeit: "Die Sichtbarkeit",
  tagIds: "Die Gruppen",
};
const CODE_TEXTE = {
  too_small: "fehlt oder ist zu kurz.",
  too_big: "ist zu lang, oder es sind zu viele.",
  invalid_type: "fehlt.",
  invalid_value: "hat einen ungültigen Wert.",
  invalid_format: "hat ein ungültiges Format.",
  invalid_union: "hat einen ungültigen Wert.",
  custom: "ist ungültig. Prüfe die Adresse und die Länge.",
  unrecognized_keys: "enthält etwas Unbekanntes.",
};
const VERWEIS_TEXTE = {
  MEDIUM_UNBEKANNT: "Das gewählte Bild gibt es nicht mehr. Wähle ein anderes.",
  MEDIUM_FORMAT:
    "Dieser Baustein braucht ein Bild, das gewählte Medium ist keines.",
  MEDIUM_NICHT_OEFFENTLICH:
    "Das Bild ist nicht öffentlich. Wähle ein öffentliches Bild oder stelle den Baustein auf «Nur angemeldet».",
  TAG_UNBEKANNT: "Die gewählte Gruppe gibt es nicht mehr.",
  PERSON_UNBEKANNT: "Die gewählte Person gibt es nicht mehr.",
  SEITE_UNBEKANNT:
    "Ein Link zeigt auf eine Seite, die es nicht gibt. Prüfe die Adresse.",
};

const feldName = (pfad) =>
  FELDNAMEN[
    pfad
      .split(".")
      .filter((s) => !/^\d+$/.test(s))
      .at(-1)
  ] ?? "Die Eingabe";

function sichtbarkeitText(s, tagNamen) {
  if (s.art !== "tags") return ARTEN[s.art] ?? "";
  if (s.tagIds.length === 0) return "Bestimmte Gruppen (keine gewählt)";
  return `Bestimmte Gruppen: ${s.tagIds
    .map((id) => tagNamen.get(id) ?? "unbekannte Gruppe")
    .join(", ")}`;
}

// --- Felder -----------------------------------------------------------------------------------------------------------

// Fehler eines Feldes: Meldung unter dem Feld, aria-invalid und aria-describedby am Ziel; weg, sobald die Person das Feld ändert
function zeigeFeldFehler(wurzel, ziel, text) {
  const alt = wurzel.querySelector(".feld-fehler");
  const meldung =
    alt ?? el("p", { class: "feld-fehler", id: neueId("fehler") });
  meldung.textContent = text;
  if (!alt) wurzel.append(meldung);
  ziel.setAttribute("aria-invalid", "true");
  const ids = (ziel.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean);
  if (!ids.includes(meldung.id)) ids.push(meldung.id);
  ziel.setAttribute("aria-describedby", ids.join(" "));
}

function loescheFeldFehler(wurzel) {
  const meldung = wurzel.querySelector(".feld-fehler");
  if (!meldung) return;
  const ziel = wurzel.querySelector("[aria-invalid]");
  ziel?.removeAttribute("aria-invalid");
  if (ziel) {
    const ids = (ziel.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter((i) => i && i !== meldung.id);
    if (ids.length > 0) ziel.setAttribute("aria-describedby", ids.join(" "));
    else ziel.removeAttribute("aria-describedby");
  }
  meldung.remove();
}

// Ein Feld an die Fehler anmelden
function anmelden(reg, pfad, f) {
  reg(pfad, f.wurzel, f.eingabe);
  const weg = () => loescheFeldFehler(f.wurzel);
  f.eingabe.addEventListener("input", weg);
  f.eingabe.addEventListener("change", weg);
}

// Textfeld oder Zahlfeld, das beim Tippen ins Dokument schreibt
function eingabe(k, b, reg, schluessel, label, optionen = {}) {
  const { optional, zahl, hilfe, ...rest } = optionen;
  const f = feld({
    label,
    wert: b.daten[schluessel] === undefined ? "" : String(b.daten[schluessel]),
    hilfe,
    autocomplete: "off",
    ...rest,
  });
  f.eingabe.addEventListener("input", () => {
    const wert = f.eingabe.value;
    if (wert.trim() === "" && (optional || zahl)) delete b.daten[schluessel];
    else b.daten[schluessel] = zahl ? Number(wert) : wert;
    k.aendere(b);
  });
  anmelden(reg, `daten.${schluessel}`, f);
  return f.wurzel;
}

// Wie eingabe(), für einen Eintrag einer Liste (Karte, Galeriebild)
function teilEingabe(
  k,
  b,
  reg,
  eintrag,
  schluessel,
  label,
  pfad,
  optionen = {},
) {
  const { optional, hilfe, ...rest } = optionen;
  const f = feld({
    label,
    wert: eintrag[schluessel] ?? "",
    hilfe,
    autocomplete: "off",
    ...rest,
  });
  f.eingabe.addEventListener("input", () => {
    const wert = f.eingabe.value;
    if (optional && wert.trim() === "") delete eintrag[schluessel];
    else eintrag[schluessel] = wert;
    k.aendere(b);
  });
  anmelden(reg, pfad, f);
  return f.wurzel;
}

// Auswahl aus einer Liste: das native Feld klappt am Rand des Fensters von selbst nach oben und funktioniert mit Tastatur und Screenreader ohne Zutun
function waehler({ label, optionen, wert }) {
  const id = neueId("waehler");
  const eingabe = el(
    "select",
    { id, class: "ws-editor-select" },
    optionen.map(([w, text]) => el("option", { value: w }, text)),
  );
  eingabe.value = wert;
  return {
    wurzel: el(
      "div",
      { class: "feld" },
      el("label", { for: id }, label),
      eingabe,
    ),
    eingabe,
  };
}

// Auswahl aus wenigen Werten; Zahlen bleiben Zahlen
function wahl(k, b, reg, schluessel, label, optionen) {
  const a = waehler({
    label,
    optionen: optionen.map(([w, text]) => [String(w), text]),
    wert: String(b.daten[schluessel]),
  });
  a.eingabe.addEventListener("change", () => {
    const roh = a.eingabe.value;
    b.daten[schluessel] =
      typeof optionen[0][0] === "number" ? Number(roh) : roh;
    k.aendere(b);
  });
  reg(`daten.${schluessel}`, a.wurzel, a.eingabe);
  return a.wurzel;
}

function textForm(k, b, reg) {
  const f = feld({
    label: "Text",
    mehrzeilig: true,
    rows: 10,
    wert: bloeckeZuText(b.daten.inhalt ?? []),
    lang: "de-CH",
    spellcheck: "true",
    hilfe:
      "Eine Zeile ist ein Absatz. Fett: **Text**. Kursiv: *Text*. Link: [Text](Adresse). Liste: Zeilen mit «- » am Anfang, nummeriert mit «1. ».",
  });
  const zaehler = el("p", { class: "hilfe" });
  const zaehle = () => {
    zaehler.textContent = `${zaehleZeichen(b.daten.inhalt ?? [])} von ${MAX_TEXT_ZEICHEN} Zeichen`;
  };
  f.eingabe.addEventListener("input", () => {
    b.daten.inhalt = textZuBloecken(f.eingabe.value);
    zaehle();
    k.aendere(b);
  });
  zaehle();
  f.wurzel.append(zaehler);
  anmelden(reg, "daten.inhalt", f);
  return f.wurzel;
}

function altTextInfo(m) {
  if (!m)
    return "Das Bild wird gezeigt. Sein Alt-Text erscheint, sobald die Bibliothek geladen ist.";
  if (m.dekorativ) return "Das Bild ist als dekorativ markiert.";
  if (m.altText) return `Alt-Text: «${m.altText}»`;
  return "Für dieses Bild fehlt der Alt-Text. Trage ihn unter «Medien» nach.";
}

// Ein Bild der Bibliothek: Vorschaubild, Alt-Text des Mediums und der Knopf zur Auswahl
function bildWahl(k, b, reg, ziel, pfad) {
  const wurzel = el("div", { class: "feld ws-editor-bild" });
  const titelId = neueId("bild");
  const zeichne = () => {
    const medium = k.medien.get(ziel.mediumId);
    const wahlKnopf = knopf(
      ziel.mediumId ? "Anderes Bild wählen" : "Bild wählen",
      {
        klein: true,
        symbol: "lupe",
        "aria-describedby": titelId,
        onclick: () =>
          k.waehleBild((m) => {
            ziel.mediumId = m.id;
            k.medien.set(m.id, m);
            k.aendere(b);
            zeichne();
            wurzel.querySelector("button")?.focus();
          }),
      },
    );
    wurzel.replaceChildren(
      el("span", { class: "feld-titel", id: titelId }, "Bild"),
      ziel.mediumId
        ? el(
            "div",
            { class: "ws-editor-bildzeile" },
            // Zierde: Der Alt-Text steht als Text daneben
            el("img", {
              class: "ws-editor-vorschaubild",
              src: `/api/v1/medien/${ziel.mediumId}`,
              alt: "",
              loading: "lazy",
            }),
            el("p", { class: "hilfe" }, altTextInfo(medium)),
          )
        : el("p", { class: "hilfe" }, "Noch kein Bild gewählt."),
      wahlKnopf,
    );
    reg(pfad, wurzel, wahlKnopf);
  };
  // Die Liste der Medien liefert den Alt-Text; sie wird erst geladen, wenn ein Bild darauf wartet
  if (ziel.mediumId && !k.medien.has(ziel.mediumId)) {
    k.ladeMedien().then(zeichne, () => {});
  }
  zeichne();
  return wurzel;
}

// Eine Liste von Teilen (Bilder, Karten) mit «Hinzufügen», «Nach oben», «Nach unten» und «Entfernen».
// Jede Änderung der Liste zeichnet das Formular des Bausteins neu und setzt den Fokus auf den betroffenen Teil.
function listenForm(
  k,
  b,
  { liste, max, hinzuText, hinzu, zeile, name, pfadName, listeName },
) {
  const eintraege = liste();
  const neu = (fokus) => k.formNeu(b, fokus);
  const ul = el("ol", { class: "ws-editor-teile", "aria-label": listeName });
  eintraege.forEach((eintrag, i) => {
    const bez = `${name} ${i + 1}`;
    const bewege = (delta, was) => {
      const ziel = i + delta;
      const [x] = eintraege.splice(i, 1);
      eintraege.splice(ziel, 0, x);
      k.aendere(b);
      neu({ index: ziel, was });
      k.ctx.melde(
        `${bez} steht jetzt an Position ${ziel + 1} von ${eintraege.length}.`,
      );
    };
    ul.append(
      el(
        "li",
        { class: "ws-editor-teil" },
        el("h4", {}, bez),
        ...zeile(eintrag, `${pfadName}.${i}`),
        el(
          "div",
          { class: "ws-editor-teilaktionen" },
          knopf("Nach oben", {
            klein: true,
            kontext: bez,
            disabled: i === 0,
            onclick: () => bewege(-1, "hoch"),
          }),
          knopf("Nach unten", {
            klein: true,
            kontext: bez,
            disabled: i === eintraege.length - 1,
            onclick: () => bewege(1, "runter"),
          }),
          knopf("Entfernen", {
            klein: true,
            kontext: bez,
            onclick: () => {
              eintraege.splice(i, 1);
              k.aendere(b);
              neu({ index: Math.min(i, eintraege.length - 1), was: "neu" });
              k.ctx.melde(`${bez} ist entfernt.`);
            },
          }),
        ),
      ),
    );
  });
  const hinzuKnopf = knopf(hinzuText, {
    klein: true,
    symbol: "plus",
    "data-teil": "hinzu",
    onclick: () => {
      if (eintraege.length >= max) {
        k.ctx.melde(`Mehr als ${max} sind nicht möglich.`, "fehler");
        return;
      }
      hinzu(eintraege, (index) => {
        k.aendere(b);
        neu({ index, was: "neu" });
      });
    },
  });
  return el("div", { class: "ws-editor-liste" }, ul, hinzuKnopf);
}

function galerieForm(k, b, reg) {
  return listenForm(k, b, {
    name: "Galeriebild",
    listeName: "Bilder der Galerie",
    pfadName: "daten.bilder",
    liste: () => b.daten.bilder,
    max: MAX_GALERIE,
    hinzuText: "Bild hinzufügen",
    hinzu: (liste, fertig) =>
      k.waehleBild((m) => {
        k.medien.set(m.id, m);
        liste.push({ mediumId: m.id });
        fertig(liste.length - 1);
      }),
    zeile: (eintrag, pfad) => [
      bildWahl(k, b, reg, eintrag, `${pfad}.mediumId`),
      teilEingabe(
        k,
        b,
        reg,
        eintrag,
        "unterschrift",
        "Bildunterschrift (optional)",
        `${pfad}.unterschrift`,
        {
          optional: true,
          maxlength: 300,
        },
      ),
    ],
  });
}

function kartenForm(k, b, reg) {
  return [
    wahl(k, b, reg, "darstellung", "Darstellung", [
      ["karten", "Karten"],
      ["liste", "Liste"],
    ]),
    listenForm(k, b, {
      name: "Eintrag",
      listeName: "Einträge",
      pfadName: "daten.eintraege",
      liste: () => b.daten.eintraege,
      max: MAX_KARTEN,
      hinzuText: "Eintrag hinzufügen",
      hinzu: (liste, fertig) => {
        liste.push({ titel: "" });
        fertig(liste.length - 1);
      },
      zeile: (eintrag, pfad) => [
        teilEingabe(k, b, reg, eintrag, "titel", "Titel", `${pfad}.titel`, {
          maxlength: 100,
        }),
        teilEingabe(
          k,
          b,
          reg,
          eintrag,
          "text",
          "Text (optional)",
          `${pfad}.text`,
          {
            optional: true,
            maxlength: 500,
            mehrzeilig: true,
            rows: 3,
          },
        ),
        teilEingabe(
          k,
          b,
          reg,
          eintrag,
          "link",
          "Link (optional)",
          `${pfad}.link`,
          {
            optional: true,
            maxlength: 2000,
            spellcheck: "false",
            hilfe:
              "Eine Seite dieser Website (zum Beispiel /stufen/woelfe) oder eine Webadresse mit https.",
          },
        ),
      ],
    }),
  ];
}

// Die Grösse der Datei: Der Server speichert Bytes, das Feld nimmt Kilobyte
function groesseFeld(k, b, reg) {
  const f = feld({
    label: "Grösse in Kilobyte (optional)",
    wert: b.daten.groesse === undefined ? "" : String(b.daten.groesse / 1000),
    inputmode: "decimal",
    autocomplete: "off",
  });
  f.eingabe.addEventListener("input", () => {
    const zahl = Number(f.eingabe.value.trim().replace(",", "."));
    if (f.eingabe.value.trim() === "") delete b.daten.groesse;
    else b.daten.groesse = Number.isFinite(zahl) ? Math.round(zahl * 1000) : -1;
    k.aendere(b);
  });
  anmelden(reg, "daten.groesse", f);
  return f.wurzel;
}

function tagWahl(k, b, reg, schluessel, label, optional) {
  const aktuell = b.daten[schluessel] ?? "";
  const a = waehler({
    label,
    optionen: [
      ["", optional ? "Keine Gruppe" : "Gruppe wählen"],
      ...(aktuell && !k.tagNamen.has(aktuell)
        ? [[aktuell, "Unbekannte Gruppe"]]
        : []),
      ...k.tags.map((t) => [t.id, t.name]),
    ],
    wert: aktuell,
  });
  a.eingabe.addEventListener("change", () => {
    if (a.eingabe.value) b.daten[schluessel] = a.eingabe.value;
    else delete b.daten[schluessel];
    k.aendere(b);
    loescheFeldFehler(a.wurzel);
  });
  reg(`daten.${schluessel}`, a.wurzel, a.eingabe);
  return a.wurzel;
}

// Erst die Gruppe, dann die Person der Gruppe (die Liste kommt vom Server, nur für die gewählte Gruppe)
function personWahl(k, b, reg) {
  const wurzel = el("div", { class: "ws-editor-person" });
  const personen = el("div");
  const gewaehlt = el("p", { class: "hilfe" });
  const zeigeGewaehlt = () => {
    const name = k.personNamen.get(b.daten.personId);
    gewaehlt.textContent = b.daten.personId
      ? name
        ? `Gewählt: ${name}`
        : "Eine Person ist gewählt. Ihr Name erscheint in der Vorschau."
      : "Noch keine Person gewählt.";
  };
  const gruppeWahl = waehler({
    label: "Gruppe der Person",
    optionen: [["", "Gruppe wählen"], ...k.tags.map((t) => [t.id, t.name])],
    wert: "",
  });
  const lade = async (tagId) => {
    personen.replaceChildren(
      el("p", { class: "hilfe", role: "status" }, "Personen werden geladen …"),
    );
    try {
      const antwort = await anfrage("GET", `${API}/personen?tag=${tagId}`);
      for (const p of antwort.personen) k.personNamen.set(p.id, p.anzeigename);
      const liste = waehler({
        label: "Person",
        optionen: [
          [
            "",
            antwort.personen.length > 0
              ? "Person wählen"
              : "Niemand in dieser Gruppe",
          ],
          ...antwort.personen.map((p) => [
            p.id,
            p.funktion ? `${p.anzeigename} (${p.funktion})` : p.anzeigename,
          ]),
        ],
        wert: antwort.personen.some((p) => p.id === b.daten.personId)
          ? b.daten.personId
          : "",
      });
      liste.eingabe.addEventListener("change", () => {
        if (liste.eingabe.value) b.daten.personId = liste.eingabe.value;
        else delete b.daten.personId;
        zeigeGewaehlt();
        k.aendere(b);
        loescheFeldFehler(wurzel);
      });
      personen.replaceChildren(liste.wurzel);
    } catch (f) {
      personen.replaceChildren(
        el("p", { class: "feld-fehler", role: "alert" }, fehlertext(f)),
      );
    }
  };
  gruppeWahl.eingabe.addEventListener("change", () => {
    if (gruppeWahl.eingabe.value) lade(gruppeWahl.eingabe.value);
    else personen.replaceChildren();
  });
  zeigeGewaehlt();
  wurzel.append(gewaehlt, gruppeWahl.wurzel, personen);
  reg("daten.personId", wurzel, gruppeWahl.eingabe);
  return wurzel;
}

// Wer den Baustein sieht: wie die Seite oder enger
function sichtbarkeitForm(k, b) {
  const start = b.sichtbarkeit;
  let art = start === "erbt" ? "erbt" : start.art;
  const boxen = k.tags.map((t) =>
    ankreuzen({
      label: t.name,
      gewaehlt:
        start !== "erbt" && start.art === "tags" && start.tagIds.includes(t.id),
      wert: t.id,
    }),
  );
  const liste = gruppe(
    "Gruppen",
    boxen.length > 0
      ? boxen.map((x) => x.wurzel)
      : el("p", { class: "hilfe" }, "Es gibt noch keine Gruppen."),
    { scrollen: true },
  );
  liste.hidden = art !== "tags";
  const uebernimm = () => {
    if (art === "erbt") b.sichtbarkeit = "erbt";
    else if (art === "tags") {
      b.sichtbarkeit = {
        art,
        tagIds: boxen
          .filter((x) => x.eingabe.checked)
          .map((x) => x.eingabe.value),
      };
    } else b.sichtbarkeit = { art };
    k.aendere(b);
    k.aktualisiereChips(b);
  };
  const a = waehler({
    label: "Wer sieht diesen Baustein?",
    optionen: [
      [
        "erbt",
        `Wie die Seite (${sichtbarkeitText(k.seite.sichtbarkeit, k.tagNamen)})`,
      ],
      ["oeffentlich", "Öffentlich"],
      ["angemeldet", "Nur angemeldet"],
      ["tags", "Bestimmte Gruppen"],
    ],
    wert: art,
  });
  a.eingabe.addEventListener("change", () => {
    art = a.eingabe.value;
    liste.hidden = art !== "tags";
    uebernimm();
  });
  for (const x of boxen) x.eingabe.addEventListener("change", uebernimm);
  return el(
    "fieldset",
    { class: "ws-editor-sicht" },
    el("legend", {}, "Sichtbarkeit"),
    a.wurzel,
    liste,
  );
}

// --- Katalog und Typen ------------------------------------------------------------------------------------------------

// Je Typ: Name, Kurztext der Karte, Prüfung (liefert [Pfad, Text]) und Formular. reg(pfad, wurzel, ziel) meldet ein Feld an die Fehler an
// (Pfad wie beim Server ohne «bausteine.<n>.», zum Beispiel «daten.text»; ziel bekommt den Fokus)
const TYPEN = {
  ueberschrift: {
    name: "Überschrift",
    kurz: (d) => d.text ?? "",
    pruefe: (d) => (d.text?.trim() ? [] : [["daten.text", "fehlt."]]),
    form: (k, b, reg) => [
      wahl(k, b, reg, "ebene", "Ebene", [
        [2, "Ebene 2: Abschnitt"],
        [3, "Ebene 3: Unterabschnitt"],
        [4, "Ebene 4: kleine Überschrift"],
      ]),
      eingabe(k, b, reg, "text", "Text der Überschrift", { maxlength: 200 }),
    ],
  },
  text: {
    name: "Text",
    // Der reine Text ohne die Zeichen der Schreibweise
    kurz: (d) =>
      kuerze(
        (d.inhalt ?? [])
          .flatMap((x) => (x.typ === "absatz" ? [x.inhalt] : x.eintraege))
          .map((abschnitte) => abschnitte.map((a) => a.text).join(""))
          .join(" · "),
        80,
      ),
    pruefe: (d) =>
      (d.inhalt ?? []).length === 0
        ? [["daten.inhalt", "fehlt."]]
        : zaehleZeichen(d.inhalt) > MAX_TEXT_ZEICHEN
          ? [
              [
                "daten.inhalt",
                `ist zu lang (höchstens ${MAX_TEXT_ZEICHEN} Zeichen).`,
              ],
            ]
          : [],
    form: (k, b, reg) => [textForm(k, b, reg)],
  },
  bild: {
    name: "Bild",
    kurz: (d, k) => k.medienName(d.mediumId),
    pruefe: (d) => (d.mediumId ? [] : [["daten.mediumId", "fehlt."]]),
    form: (k, b, reg) => [
      bildWahl(k, b, reg, b.daten, "daten.mediumId"),
      eingabe(k, b, reg, "unterschrift", "Bildunterschrift (optional)", {
        maxlength: 300,
        optional: true,
      }),
    ],
  },
  galerie: {
    name: "Galerie",
    kurz: (d) => anzahlText(d.bilder?.length ?? 0, "1 Bild", "Bilder"),
    pruefe: (d) => [
      ...((d.bilder ?? []).length === 0 ? [["daten.bilder", "fehlt."]] : []),
      ...(d.bilder ?? []).flatMap((x, i) =>
        x.mediumId ? [] : [[`daten.bilder.${i}.mediumId`, "fehlt."]],
      ),
    ],
    form: (k, b, reg) => [galerieForm(k, b, reg)],
  },
  karten: {
    name: "Karten oder Liste",
    kurz: (d) => anzahlText(d.eintraege?.length ?? 0, "1 Eintrag", "Einträge"),
    pruefe: (d) => [
      ...((d.eintraege ?? []).length === 0
        ? [["daten.eintraege", "fehlt."]]
        : []),
      ...(d.eintraege ?? []).flatMap((x, i) =>
        x.titel?.trim() ? [] : [[`daten.eintraege.${i}.titel`, "fehlt."]],
      ),
    ],
    form: kartenForm,
  },
  schaltflaeche: {
    name: "Schaltfläche oder Link",
    kurz: (d) => d.beschriftung ?? "",
    pruefe: (d) => [
      ...(d.beschriftung?.trim() ? [] : [["daten.beschriftung", "fehlt."]]),
      ...(d.ziel?.trim() ? [] : [["daten.ziel", "fehlt."]]),
    ],
    form: (k, b, reg) => [
      wahl(k, b, reg, "darstellung", "Darstellung", [
        ["schaltflaeche", "Schaltfläche"],
        ["link", "Link im Text"],
      ]),
      eingabe(k, b, reg, "beschriftung", "Beschriftung", { maxlength: 60 }),
      eingabe(k, b, reg, "ziel", "Ziel", {
        maxlength: 2000,
        spellcheck: "false",
        autocapitalize: "off",
        hilfe: LINK_HILFE,
      }),
    ],
  },
  // Eine Datei liegt im SharePoint der Abteilung und wird nur verknüpft (#428): Titel und Link, Typ und Grösse sind freiwillige Angaben
  datei: {
    name: "Datei",
    kurz: (d) => d.titel ?? "",
    pruefe: (d) => [
      ...(d.titel?.trim() ? [] : [["daten.titel", "fehlt."]]),
      ...(d.link?.trim() ? [] : [["daten.link", "fehlt."]]),
      ...(d.groesse === undefined || d.groesse >= 0
        ? []
        : [["daten.groesse", "ist eine Zahl ab 0."]]),
    ],
    form: (k, b, reg) => [
      eingabe(k, b, reg, "titel", "Titel der Datei", { maxlength: 100 }),
      eingabe(k, b, reg, "link", "Link zur Datei", {
        maxlength: 2048,
        spellcheck: "false",
        autocapitalize: "off",
        hilfe:
          "Der Freigabelink der Datei im SharePoint der Abteilung. Er beginnt mit https.",
      }),
      eingabe(k, b, reg, "typ", "Dateityp (optional)", {
        maxlength: 20,
        optional: true,
        hilfe: "Zum Beispiel PDF oder Word.",
      }),
      groesseFeld(k, b, reg),
    ],
  },
  kontaktperson: {
    name: "Kontaktperson",
    kurz: (d, k) => k.personNamen.get(d.personId) ?? "",
    pruefe: (d) => (d.personId ? [] : [["daten.personId", "fehlt."]]),
    form: (k, b, reg) => [
      personWahl(k, b, reg),
      el(
        "p",
        { class: "hilfe" },
        "Auf der Website erscheinen Cevi-Name und Funktion.",
      ),
    ],
  },
  leitungsteam: {
    name: "Leitungsteam",
    kurz: (d, k) => k.tagNamen.get(d.tagId) ?? "",
    pruefe: (d) => (d.tagId ? [] : [["daten.tagId", "fehlt."]]),
    form: (k, b, reg) => [
      tagWahl(k, b, reg, "tagId", "Gruppe", false),
      el(
        "p",
        { class: "hilfe" },
        "Zeigt alle Personen der Gruppe mit Cevi-Name und Funktion.",
      ),
    ],
  },
  terminliste: {
    name: "Termin-Liste",
    kurz: (d, k) => k.tagNamen.get(d.tagId) ?? "alle Termine",
    pruefe: (d) =>
      Number.isInteger(d.anzahl) && d.anzahl >= 3 && d.anzahl <= 10
        ? []
        : [["daten.anzahl", "ist eine ganze Zahl von 3 bis 10."]],
    form: (k, b, reg) => [
      tagWahl(k, b, reg, "tagId", "Gruppe (optional)", true),
      eingabe(k, b, reg, "anzahl", "Anzahl Termine (3 bis 10)", {
        zahl: true,
        inputmode: "numeric",
      }),
      el(
        "p",
        { class: "hilfe" },
        "Die Termine erscheinen, sobald die Terminverwaltung dafür bereit ist. Bis dahin bleibt der Platz leer.",
      ),
    ],
  },
  trenner: {
    name: "Trenner",
    kurz: (d) => (d.art === "linie" ? "Linie" : "Abstand"),
    pruefe: () => [],
    form: (k, b, reg) => [
      wahl(k, b, reg, "art", "Art", [
        ["abstand", "Abstand"],
        ["linie", "Linie"],
      ]),
    ],
  },
  videolink: {
    name: "Video-Link",
    kurz: (d) => d.beschriftung ?? "",
    pruefe: (d) => [
      ...(d.beschriftung?.trim() ? [] : [["daten.beschriftung", "fehlt."]]),
      ...(d.url?.trim() ? [] : [["daten.url", "fehlt."]]),
    ],
    form: (k, b, reg) => [
      wahl(k, b, reg, "art", "Art", [
        ["video", "Video"],
        ["social", "Social Media"],
      ]),
      eingabe(k, b, reg, "beschriftung", "Beschriftung", { maxlength: 60 }),
      eingabe(k, b, reg, "url", "Adresse", {
        maxlength: 2000,
        spellcheck: "false",
        autocapitalize: "off",
        hilfe:
          "Die Webadresse des Videos oder Beitrags, mit https. Sie wird nur als Link gezeigt, nie eingebettet.",
      }),
    ],
  },
  stufenfakten: {
    name: "Stufenfelder",
    kurz: () => "",
    pruefe: () => [],
    form: () => [
      el(
        "p",
        { class: "hilfe" },
        "Zeigt Datum, Treffpunkt, Schluss und Mitnehmen der nächsten Aktivität der Stufe. Die Werte pflegst du unter ",
        el("a", { href: "#website/stufenfakten" }, "Stufenfelder"),
        ".",
      ),
    ],
  },
};

// Was «Baustein hinzufügen» anbietet
const KATALOG = [
  {
    typ: "ueberschrift",
    name: "Überschrift",
    beschreibung: "Der Titel eines Abschnitts.",
    neu: () => ({ ebene: 2, text: "" }),
  },
  {
    typ: "text",
    name: "Text",
    beschreibung: "Absätze und Listen, mit fett, kursiv und Links.",
    neu: () => ({ inhalt: [] }),
  },
  {
    typ: "bild",
    name: "Bild",
    beschreibung: "Ein Bild aus der Medienbibliothek.",
    neu: () => ({}),
  },
  {
    typ: "galerie",
    name: "Galerie",
    beschreibung: "Mehrere Bilder aus der Medienbibliothek.",
    neu: () => ({ bilder: [{}] }),
  },
  {
    typ: "karten",
    name: "Karten oder Liste",
    beschreibung: "Einträge mit Titel, Text und Link.",
    neu: () => ({ darstellung: "karten", eintraege: [{ titel: "" }] }),
  },
  {
    typ: "schaltflaeche",
    name: "Schaltfläche oder Link",
    beschreibung: "Ein Link zu einer Seite, einer Webadresse oder E-Mail.",
    neu: () => ({ darstellung: "schaltflaeche", beschriftung: "", ziel: "" }),
  },
  {
    typ: "datei",
    name: "Datei",
    beschreibung: "Ein Link auf eine Datei im SharePoint der Abteilung.",
    neu: () => ({ titel: "", link: "" }),
  },
  {
    typ: "kontaktperson",
    name: "Kontaktperson",
    beschreibung: "Eine Person mit Cevi-Name und Funktion.",
    neu: () => ({ zusatz: [] }),
  },
  {
    typ: "leitungsteam",
    name: "Leitungsteam",
    beschreibung: "Alle Personen einer Gruppe.",
    neu: () => ({ zusatz: [] }),
  },
  {
    typ: "terminliste",
    name: "Termin-Liste",
    beschreibung: "Die nächsten Termine, auch einer Gruppe.",
    neu: () => ({ anzahl: 5 }),
  },
  {
    typ: "trenner",
    name: "Trenner",
    beschreibung: "Ein Abstand oder eine Linie.",
    neu: () => ({ art: "abstand" }),
  },
  {
    typ: "videolink",
    name: "Video-Link",
    beschreibung:
      "Ein Link auf ein Video oder einen Beitrag, nicht eingebettet.",
    neu: () => ({ art: "video", beschriftung: "", url: "" }),
  },
  {
    typ: "stufenfakten",
    name: "Stufenfelder",
    beschreibung: "Datum, Treffpunkt und Mitnehmen der Stufe.",
    neu: () => ({}),
  },
];

const typName = (b) => TYPEN[b.typ]?.name ?? b.typ;
const kurzText = (k, b) => {
  try {
    return TYPEN[b.typ]?.kurz(b.daten, k) ?? "";
  } catch {
    return "";
  }
};

// --- Der Editor -------------------------------------------------------------------------------------------------------

export function zeige(bereich, ctx) {
  const id = ctx.pfad[0];
  ctx.lade(
    async () => {
      const [seite, entwurf, tags] = await Promise.all([
        anfrage("GET", `${API}/seiten/${id}`),
        anfrage("GET", `${API}/seiten/${id}/entwurf`),
        anfrage("GET", `${API}/tags`),
      ]);
      return { seite, entwurf, tags: tags.tags };
    },
    (daten) => baue(bereich, ctx, id, daten),
  );
}

function baue(bereich, ctx, id, { seite, entwurf, tags }) {
  const leer = () => ({ v: 1, titel: seite.titel, bausteine: [] });
  const pufferId = `${ctx.ich?.id ?? ""}:${id}`;
  const gepuffert = puffer.get(pufferId);
  const k = {
    ctx,
    id,
    seite,
    tags,
    tagNamen: new Map(tags.map((t) => [t.id, t.name])),
    personNamen: new Map(),
    medien: new Map(),
    medienLaden: null,
    dok: gepuffert ? gepuffert.dok : (entwurf.dokument ?? leer()),
    zaehler: gepuffert ? gepuffert.zaehler : entwurf.zaehler,
    dirty: Boolean(gepuffert),
    nr: entwurf.veroeffentlichteNr,
    unveroeffentlicht: entwurf.unveroeffentlicht,
    gespeichertAm: null,
    speichert: false,
    offen: new Set(),
    formen: new Map(),
    felder: new Map(),
    blockFehler: new Map(),
    geloescht: null,
  };
  if (gepuffert) ctx.melde("Deine ungespeicherten Änderungen sind wieder da.");

  const wurzel = el("div", { class: "ws-editor" });
  bereich.append(wurzel);

  k.medienName = (mediumId) => {
    const m = k.medien.get(mediumId);
    return m ? (m.altText ?? (m.dekorativ ? "dekorativ" : "")) : "";
  };
  k.ladeMedien = () => {
    k.medienLaden ??= anfrage("GET", `${API}/medien`).then((antwort) => {
      for (const m of antwort.medien) k.medien.set(m.id, m);
    });
    k.medienLaden.catch(() => {
      k.medienLaden = null;
    });
    return k.medienLaden;
  };
  k.aendere = (b) => {
    if (!k.dirty) {
      k.dirty = true;
      zeichneStatus();
    }
    puffer.set(pufferId, { dok: k.dok, zaehler: k.zaehler });
    if (b) {
      const kurz = wurzel.querySelector(`[data-kurz="${b.id}"]`);
      if (kurz) kurz.textContent = kurzText(k, b);
    }
  };
  k.aktualisiereChips = (b) => {
    const chips = wurzel.querySelector(`[data-chips="${b.id}"]`);
    if (chips) chips.replaceChildren(...chipsFuer(b));
  };
  k.formNeu = (b, fokus) => {
    k.formen.delete(b.id);
    zeichneListe({ id: b.id, ...fokus });
  };
  k.waehleBild = (beiWahl) => bildDialog(k, beiWahl);
  k.statusNeu = () => zeichneStatus();
  // Nach «Zurückholen» und «Aktuelle übernehmen»: alles aus dem neuen Dokument
  k.neuZeichnen = () => {
    titelFeld.eingabe.value = k.dok.titel;
    zeichneListe();
    zeichneStatus();
  };

  // --- Kopf: Stand und Werkzeugleiste
  const status = el("p", { class: "ws-editor-status", role: "status" });
  const knoepfe = {};
  const kopf = el("div", { class: "ws-editor-werkzeuge" });

  // Die eine Hauptaktion wechselt mit dem Stand: erst speichern, dann veröffentlichen
  function zeichneStatus() {
    const teile = [];
    if (k.speichert) teile.push("Wird gespeichert …");
    else if (k.dirty) teile.push("Nicht gespeichert.");
    else if (k.gespeichertAm)
      teile.push(`Zuletzt gespeichert um ${uhrzeit.format(k.gespeichertAm)}.`);
    teile.push(
      k.nr === null
        ? "Noch nicht veröffentlicht."
        : k.unveroeffentlicht || k.dirty
          ? "Veröffentlicht, mit Änderungen, die noch nicht veröffentlicht sind."
          : "Veröffentlicht und aktuell.",
    );
    status.textContent = teile.join(" ");
    const haupt =
      k.dirty || k.speichert
        ? "speichern"
        : k.unveroeffentlicht
          ? "veroeffentlichen"
          : null;
    for (const [name, knopfEl] of Object.entries(knoepfe)) {
      knopfEl.classList.toggle("knopf--haupt", name === haupt);
    }
    knoepfe.speichern.classList.toggle("ws-editor-laeuft", k.speichert);
    if (k.speichert) knoepfe.speichern.setAttribute("aria-busy", "true");
    else knoepfe.speichern.removeAttribute("aria-busy");
    knoepfe.zurueckziehen.hidden = k.nr === null;
  }

  // --- Fehler
  const zusammenfassung = el("div", {
    class: "hinweis hinweis--fehler ws-editor-fehler",
    role: "alert",
    tabindex: "-1",
    hidden: true,
  });
  const titelFelder = new Map();

  function loescheFehler() {
    zusammenfassung.hidden = true;
    zusammenfassung.replaceChildren();
    for (const m of wurzel.querySelectorAll(".feld-fehler")) {
      loescheFeldFehler(m.parentElement);
      m.remove();
    }
    for (const bf of k.blockFehler.values()) {
      bf.hidden = true;
      bf.replaceChildren();
    }
    for (const c of wurzel.querySelectorAll(".ws-editor-pruefen")) c.remove();
  }

  // eintraege: [{ index (Baustein) oder null (Titel), pfad (nach «bausteine.<n>.»), text }]
  function zeigeFehler(eintraege, einleitung) {
    loescheFehler();
    const punkte = eintraege
      .map((e) => ({
        ...e,
        b: e.index === null ? null : k.dok.bausteine[e.index],
      }))
      .filter((e) => e.index === null || e.b);
    // Die Formulare mit Fehlern öffnen, damit die Meldungen im Dokument stehen
    for (const e of punkte) if (e.b) k.offen.add(e.b.id);
    zeichneListe();
    const liste = el("ul", { class: "ws-editor-fehlerliste" });
    for (const e of punkte) {
      const ort = e.b
        ? `Baustein ${e.index + 1} (${typName(e.b)})`
        : "Seitentitel";
      const felder = e.b ? k.felder.get(e.b.id) : titelFelder;
      const treffer = [...(felder?.keys() ?? [])]
        .filter((p) => e.pfad === p || e.pfad.startsWith(`${p}.`))
        .sort((a, c) => c.length - a.length)[0];
      let ziel = null;
      if (treffer) {
        const f = felder.get(treffer);
        zeigeFeldFehler(f.wurzel, f.ziel, e.text);
        ziel = f.ziel;
      } else if (e.b) {
        const bf = k.blockFehler.get(e.b.id);
        bf.hidden = false;
        bf.append(el("p", {}, e.text));
        ziel = bf;
      }
      liste.append(
        el(
          "li",
          {},
          el(
            "button",
            {
              type: "button",
              class: "ws-editor-sprung",
              onclick: () => {
                ziel?.scrollIntoView({ block: "center" });
                ziel?.focus();
              },
            },
            `${ort}: ${e.text}`,
          ),
        ),
      );
    }
    for (const b of new Set(punkte.map((e) => e.b).filter(Boolean))) {
      const c = chip("Bitte prüfen", "fehler");
      c.classList.add("ws-editor-pruefen");
      wurzel.querySelector(`[data-chips="${b.id}"]`)?.append(c);
    }
    zusammenfassung.append(el("p", { class: "fett" }, einleitung), liste);
    zusammenfassung.hidden = false;
    zusammenfassung.focus();
  }

  // Prüft, was dem Browser auffällt; der Server prüft danach alles
  function pruefeAlles() {
    const fehler = [];
    if (!k.dok.titel?.trim()) {
      fehler.push({ index: null, pfad: "titel", text: "Der Titel fehlt." });
    }
    k.dok.bausteine.forEach((b, index) => {
      for (const [pfad, text] of TYPEN[b.typ]?.pruefe(b.daten) ?? []) {
        fehler.push({ index, pfad, text: `${feldName(pfad)} ${text}` });
      }
      if (
        b.sichtbarkeit !== "erbt" &&
        b.sichtbarkeit.art === "tags" &&
        b.sichtbarkeit.tagIds.length === 0
      ) {
        fehler.push({
          index,
          pfad: "sichtbarkeit",
          text: "Wähle mindestens eine Gruppe oder eine andere Sichtbarkeit.",
        });
      }
    });
    return fehler;
  }

  // 400 mit Pfad und zod-Code, 422 mit Pfad «bausteine.<n>» und Code der Verweisprüfung
  function serverFehler(f) {
    const liste = f.daten?.fehler;
    if (!Array.isArray(liste) || liste.length === 0) return null;
    return liste.map(({ pfad, code }) => {
      const m = /^bausteine\.(\d+)(?:\.(.*))?$/.exec(pfad);
      const rest = m?.[2] ?? "";
      const text =
        VERWEIS_TEXTE[code] ??
        `${feldName(rest || pfad)} ${CODE_TEXTE[code] ?? "ist ungültig."}`;
      return m
        ? { index: Number(m[1]), pfad: rest || "daten", text }
        : { index: null, pfad, text };
    });
  }

  // --- Speichern
  async function speichere() {
    if (k.speichert) return false;
    const fehler = pruefeAlles();
    if (fehler.length > 0) {
      zeigeFehler(
        fehler,
        "Der Entwurf ist nicht gespeichert. Das musst du noch ändern:",
      );
      return false;
    }
    loescheFehler();
    k.speichert = true;
    zeichneStatus();
    try {
      const antwort = await anfrage("PUT", `${API}/seiten/${id}/entwurf`, {
        zaehler: k.zaehler,
        dokument: kopie(k.dok),
      });
      k.zaehler = antwort.zaehler;
      k.dirty = false;
      k.unveroeffentlicht = true;
      k.gespeichertAm = new Date();
      puffer.delete(pufferId);
      k.speichert = false;
      zeichneStatus();
      return true;
    } catch (f) {
      k.speichert = false;
      zeichneStatus();
      if (f.status === 409 && f.code === "KONFLIKT" && f.daten) {
        return konflikt(f.daten);
      }
      const eintraege =
        (f.status === 400 || f.status === 422) && serverFehler(f);
      if (eintraege) {
        zeigeFehler(
          eintraege,
          "Der Server hat den Entwurf nicht angenommen. Das musst du ändern:",
        );
      } else if (f.status === 413) {
        ctx.melde(
          "Die Seite ist zu gross für einen Entwurf. Kürze Texte oder entferne Bausteine.",
          "fehler",
        );
      } else {
        ctx.melde(
          `${fehlertext(f)} Deine Änderungen bleiben hier erhalten.`,
          "fehler",
        );
      }
      return false;
    }
  }
  k.speichere = speichere;

  // Zwei Sitzungen haben dieselbe Seite geändert: Nichts geht still verloren, die Person entscheidet
  function konflikt(aktuell) {
    return new Promise((fertig) => {
      const fremd = aktuell.dokument ?? leer();
      const spalte = (titel, dok) =>
        el(
          "div",
          { class: "ws-editor-fassung" },
          el(
            "h3",
            {},
            `${titel} (${anzahlText(dok.bausteine.length, "1 Baustein", "Bausteine")})`,
          ),
          el("p", { class: "hilfe" }, `Titel: ${dok.titel}`),
          el(
            "ol",
            {},
            dok.bausteine.map((b) => {
              const kurz = kurzText(k, b);
              return el(
                "li",
                {},
                kurz ? `${typName(b)}: ${kuerze(kurz, 40)}` : typName(b),
              );
            }),
          ),
        );
      entscheidung({
        titel: "Die Seite wurde inzwischen geändert",
        beschreibung:
          "Jemand hat den Entwurf in einer anderen Sitzung gespeichert, nachdem du ihn geöffnet hast. Die beiden Fassungen lassen sich nicht mischen: Wähle eine.",
        inhalt: el(
          "div",
          { class: "ws-editor-fassungen" },
          spalte("Deine Fassung", k.dok),
          spalte("Aktuelle Fassung", fremd),
        ),
        knoepfe: [
          {
            text: "Meine behalten",
            hilfe: "Überschreibt die aktuelle Fassung mit deiner.",
            onclick: async (schliesse) => {
              k.zaehler = aktuell.zaehler;
              schliesse();
              fertig(await speichere());
            },
          },
          {
            text: "Aktuelle übernehmen",
            hilfe: "Verwirft deine Änderungen.",
            onclick: (schliesse) => {
              k.dok = kopie(fremd);
              k.zaehler = aktuell.zaehler;
              k.dirty = false;
              k.unveroeffentlicht = true;
              puffer.delete(pufferId);
              k.formen.clear();
              k.offen.clear();
              k.geloescht = null;
              k.neuZeichnen();
              ctx.melde("Die aktuelle Fassung ist übernommen.");
              schliesse();
              fertig(true);
            },
          },
        ],
        beiAbbruch: () => fertig(false),
      });
    });
  }

  // --- Titel
  const titelFeld = feld({
    label: "Titel der Seite",
    wert: k.dok.titel,
    maxlength: 120,
    autocomplete: "off",
    hilfe:
      "Die Überschrift ganz oben auf der Seite. Der Name in der Seitenliste steht in den Einstellungen.",
  });
  titelFeld.eingabe.addEventListener("input", () => {
    k.dok.titel = titelFeld.eingabe.value;
    k.aendere();
    loescheFeldFehler(titelFeld.wurzel);
  });
  titelFelder.set("titel", {
    wurzel: titelFeld.wurzel,
    ziel: titelFeld.eingabe,
  });

  // --- Liste der Bausteine
  const liste = el("ol", {
    class: "ws-editor-bausteine",
    "aria-label": "Bausteine der Seite",
  });
  const leerHinweis = el(
    "p",
    { class: "leer" },
    "Diese Seite hat noch keine Bausteine. Füge den ersten hinzu.",
  );
  const hinzuKnopf = knopf("Baustein hinzufügen", {
    symbol: "plus",
    onclick: () => katalogDialog(k),
  });

  const commitGeloescht = () => {
    if (!k.geloescht) return;
    k.formen.delete(k.geloescht.block.id);
    k.felder.delete(k.geloescht.block.id);
    k.geloescht = null;
  };

  const chipsFuer = (b) =>
    b.sichtbarkeit === "erbt"
      ? []
      : [
          chip(
            sichtbarkeitText(b.sichtbarkeit, k.tagNamen),
            undefined,
            "schild",
          ),
        ];

  // fokus: { id, was, index } nach dem Zeichnen; was: hoch | runter | bearbeiten | neu | rueckgaengig
  function zeichneListe(fokus) {
    liste.replaceChildren();
    const n = k.dok.bausteine.length;
    k.dok.bausteine.forEach((b, i) => {
      if (k.geloescht?.index === i) liste.append(wegKarte());
      liste.append(karte(b, i, n));
    });
    if (k.geloescht && k.geloescht.index >= n) liste.append(wegKarte());
    leerHinweis.hidden = n > 0 || k.geloescht !== null;
    if (fokus) setzeFokus(fokus);
  }

  function setzeFokus({ id: bid, was, index }) {
    const block = liste.querySelector(`[data-block="${bid}"]`);
    let ziel = null;
    if (was === "rueckgaengig") {
      ziel = liste.querySelector("[data-rueckgaengig]");
    } else if (block && index !== undefined) {
      // Ein Teil einer Liste (Karte, Galeriebild)
      const teil = block.querySelectorAll(".ws-editor-teil")[index];
      // Verschieben: derselbe Knopf, sonst der andere (am Rand der Liste ist einer gesperrt)
      const namen = {
        hoch: ["Nach oben", "Nach unten"],
        runter: ["Nach unten", "Nach oben"],
      }[was];
      const knopfEl = (n) =>
        teil?.querySelector(`button[aria-label^="${n}"]:not(:disabled)`);
      ziel =
        (namen && (knopfEl(namen[0]) ?? knopfEl(namen[1]))) ||
        teil?.querySelector("input, textarea, select, button:not(:disabled)") ||
        block.querySelector('[data-teil="hinzu"]');
    } else if (block) {
      const such = (a) =>
        block.querySelector(`[data-aktion="${a}"]:not(:disabled)`);
      if (was === "neu") {
        ziel = block.querySelector(
          ".ws-editor-form input, .ws-editor-form textarea, .ws-editor-form select, .ws-editor-form button",
        );
      } else if (was === "hoch" || was === "runter") {
        ziel =
          such(was) ??
          such(was === "hoch" ? "runter" : "hoch") ??
          such("bearbeiten");
      } else ziel = such(was) ?? such("bearbeiten");
    }
    (ziel ?? hinzuKnopf).focus();
  }

  // Der Platz eines gelöschten Bausteins: «Rückgängig» bleibt, bis die Person etwas anderes tut
  function wegKarte() {
    const { block, index } = k.geloescht;
    const name = typName(block);
    return el(
      "li",
      { class: "ws-editor-weg" },
      el("p", {}, `«${name}» ist gelöscht.`),
      knopf("Rückgängig", {
        symbol: "aktualisieren",
        "data-rueckgaengig": "",
        onclick: () => {
          k.dok.bausteine.splice(
            Math.min(index, k.dok.bausteine.length),
            0,
            block,
          );
          k.geloescht = null;
          k.aendere();
          zeichneListe({ id: block.id, was: "bearbeiten" });
          ctx.melde(`«${name}» ist wiederhergestellt.`);
        },
      }),
    );
  }

  function karte(b, i, n) {
    const name = typName(b);
    const bezeichnung = `${name} ${i + 1}`;
    const offen = k.offen.has(b.id);
    const formId = `ws-form-${b.id}`;
    const titelId = `ws-titel-${b.id}`;
    const bearbeiten = knopf(offen ? "Fertig" : "Bearbeiten", {
      klein: true,
      symbol: offen ? "haken" : "bearbeiten",
      kontext: bezeichnung,
      "data-aktion": "bearbeiten",
      "aria-expanded": String(offen),
      "aria-controls": formId,
      onclick: () => {
        commitGeloescht();
        const oeffnet = !k.offen.has(b.id);
        if (oeffnet) k.offen.add(b.id);
        else k.offen.delete(b.id);
        zeichneListe({ id: b.id, was: oeffnet ? "neu" : "bearbeiten" });
      },
    });
    const pfeil = (richtung, text, delta) =>
      el(
        "button",
        {
          type: "button",
          class: "knopf knopf--rund ws-editor-pfeil",
          "aria-label": `${text}: ${bezeichnung}`,
          title: text,
          "data-aktion": richtung,
          disabled: richtung === "hoch" ? i === 0 : i === n - 1,
          onclick: () => {
            commitGeloescht();
            const ziel = i + delta;
            const [x] = k.dok.bausteine.splice(i, 1);
            k.dok.bausteine.splice(ziel, 0, x);
            k.aendere();
            zeichneListe({ id: b.id, was: richtung });
            ctx.melde(
              `«${name}» steht jetzt an Position ${ziel + 1} von ${n}.`,
            );
          },
        },
        icon(richtung),
      );
    return el(
      "li",
      {
        class: "ws-editor-karte",
        "data-block": b.id,
        "aria-labelledby": titelId,
      },
      el(
        "div",
        { class: "ws-editor-kartenkopf" },
        el(
          "div",
          { class: "ws-editor-kartentitel" },
          el(
            "h3",
            { id: titelId },
            el(
              "span",
              { class: "ws-editor-nr", "aria-hidden": "true" },
              String(i + 1),
            ),
            el("span", { class: "nur-leser" }, `Baustein ${i + 1} von ${n}: `),
            name,
          ),
          el(
            "p",
            { class: "ws-editor-kurz", "data-kurz": b.id },
            kurzText(k, b),
          ),
          el("ul", { class: "chips", "data-chips": b.id }, ...chipsFuer(b)),
        ),
        el(
          "div",
          { class: "ws-editor-aktionen" },
          bearbeiten,
          pfeil("hoch", "Nach oben", -1),
          pfeil("runter", "Nach unten", 1),
          knopf("Duplizieren", {
            klein: true,
            kontext: bezeichnung,
            onclick: () => dupliziere(b, i),
          }),
          knopf("Löschen", {
            klein: true,
            kontext: bezeichnung,
            onclick: () => loesche(b, i),
          }),
        ),
      ),
      formFuer(b, formId, offen),
    );
  }

  // Das Formular eines Bausteins wird erst beim ersten Öffnen gebaut und beim Umordnen weiterverwendet (Cursor und Text bleiben)
  function formFuer(b, formId, offen) {
    let form = k.formen.get(b.id);
    if (!form && !offen) {
      return el("div", { class: "ws-editor-form", id: formId, hidden: true });
    }
    if (!form) {
      const reg = (pfad, w, ziel) =>
        k.felder.get(b.id).set(pfad, { wurzel: w, ziel });
      k.felder.set(b.id, new Map());
      const blockFehler = el("div", {
        class: "hinweis hinweis--fehler",
        tabindex: "-1",
        hidden: true,
      });
      k.blockFehler.set(b.id, blockFehler);
      form = el(
        "div",
        { class: "ws-editor-form formular", id: formId },
        blockFehler,
        ...(TYPEN[b.typ]?.form(k, b, reg) ?? []),
        sichtbarkeitForm(k, b),
      );
      k.formen.set(b.id, form);
    }
    form.hidden = !offen;
    return form;
  }

  function dupliziere(b, i) {
    commitGeloescht();
    if (k.dok.bausteine.length >= MAX_BAUSTEINE) {
      ctx.melde(
        `Mehr als ${MAX_BAUSTEINE} Bausteine sind nicht möglich.`,
        "fehler",
      );
      return;
    }
    const neu = { ...kopie(b), id: neueUuid() };
    k.dok.bausteine.splice(i + 1, 0, neu);
    k.aendere();
    zeichneListe({ id: neu.id, was: "bearbeiten" });
    ctx.melde(
      `«${typName(b)}» ist dupliziert. Die Kopie steht an Position ${i + 2}.`,
    );
  }

  function loesche(b, i) {
    commitGeloescht();
    k.dok.bausteine.splice(i, 1);
    k.geloescht = { block: b, index: i };
    k.offen.delete(b.id);
    k.aendere();
    zeichneListe({ id: b.id, was: "rueckgaengig" });
    ctx.melde(
      `«${typName(b)}» ist gelöscht. Mit «Rückgängig» holst du ihn zurück.`,
    );
  }

  k.fuegeEin = (eintrag, position) => {
    commitGeloescht();
    const b = {
      id: neueUuid(),
      typ: eintrag.typ,
      daten: eintrag.neu(),
      sichtbarkeit: "erbt",
    };
    k.dok.bausteine.splice(position, 0, b);
    k.offen.add(b.id);
    k.aendere();
    zeichneListe({ id: b.id, was: "neu" });
    liste
      .querySelector(`[data-block="${b.id}"]`)
      ?.scrollIntoView({ block: "nearest" });
    ctx.melde(
      `«${eintrag.name}» ist hinzugefügt, an Position ${position + 1}.`,
    );
  };

  // --- Vorschau
  const vorschau = vorschauPanel(
    k,
    () => (k.dirty ? speichere() : Promise.resolve(true)),
    () =>
      knoepfe.vorschau?.setAttribute(
        "aria-expanded",
        String(!vorschau.wurzel.hidden),
      ),
  );
  k.zeigeVersion = (nr) => vorschau.zeige(nr);

  knoepfe.speichern = knopf("Speichern", {
    symbol: "haken",
    onclick: speichere,
  });
  knoepfe.vorschau = knopf("Vorschau", {
    symbol: "lupe",
    "aria-expanded": "false",
    "aria-controls": "ws-editor-vorschau",
    onclick: () => vorschau.zeige(null),
  });
  knoepfe.versionen = knopf("Versionen", {
    symbol: "uhr",
    onclick: () => versionenBlatt(k),
  });
  knoepfe.veroeffentlichen = knopf("Veröffentlichen", {
    symbol: "website",
    onclick: () => veroeffentlichen(k),
  });
  knoepfe.zurueckziehen = knopf("Zurückziehen", {
    symbol: "sperre",
    onclick: () => zurueckziehen(k),
  });
  kopf.append(...Object.values(knoepfe));

  wurzel.append(
    el(
      "a",
      { class: "knopf knopf--klein", href: "#website/seiten" },
      "Zur Seitenliste",
    ),
    el(
      "div",
      { class: "ws-editor-titelzeile" },
      el("h2", { tabindex: "-1" }, k.seite.titel),
      el(
        "p",
        { class: "meta" },
        `${k.seite.pfad} · ${sichtbarkeitText(k.seite.sichtbarkeit, k.tagNamen)}`,
      ),
    ),
    status,
    kopf,
    zusammenfassung,
    vorschau.wurzel,
    titelFeld.wurzel,
    el("h3", { class: "ws-editor-zwischentitel" }, "Bausteine"),
    leerHinweis,
    liste,
    el("div", { class: "ws-editor-unten" }, hinzuKnopf),
  );
  zeichneListe();
  zeichneStatus();

  // Strg+S oder Cmd+S speichert, solange der Editor sichtbar ist
  const taste = (e) => {
    if (!wurzel.isConnected)
      return document.removeEventListener("keydown", taste);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      speichere();
    }
  };
  document.addEventListener("keydown", taste);

  // Tab schliessen oder neu laden mit ungespeicherten Änderungen
  const vorDemSchliessen = (e) => {
    if (!wurzel.isConnected)
      return window.removeEventListener("beforeunload", vorDemSchliessen);
    if (k.dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", vorDemSchliessen);

  // Ein Link der Verwaltung mitten in ungespeicherten Änderungen: erst fragen. (Die Zurück-Taste fängt der Puffer auf.)
  const beiKlick = (e) => {
    if (!wurzel.isConnected)
      return document.removeEventListener("click", beiKlick, true);
    const a = e.target.closest?.("a[href^='#']");
    if (!a || !k.dirty) return;
    const ziel = a.getAttribute("href");
    if (ziel === "#inhalt" || ziel === location.hash) return;
    e.preventDefault();
    e.stopPropagation();
    verlassenDialog(k, pufferId, ziel);
  };
  document.addEventListener("click", beiKlick, true);
}

// --- Dialoge ------------------------------------------------------------------------------------------------------------

// Dialog mit eigenen Knöpfen. knoepfe: [{ text, hilfe, onclick(schliesse) }]; «Abbrechen» ist immer dabei und hat den Fokus.
// beiAbbruch läuft, wenn der Dialog ohne Wahl schliesst (Abbrechen, Escape)
function entscheidung({ titel, beschreibung, inhalt, knoepfe, beiAbbruch }) {
  const zurueck = document.activeElement;
  const titelId = neueId("titel");
  let entschieden = false;
  const schliesse = () => {
    entschieden = true;
    dialog.close();
  };
  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
    tabindex: "-1",
  });
  const abbrechen = knopf("Abbrechen", { onclick: () => dialog.close() });
  const dialog = el(
    "dialog",
    { "aria-labelledby": titelId, class: "ws-editor-dialog" },
    el("h2", { id: titelId, tabindex: "-1" }, titel),
    beschreibung && el("p", { class: "beschreibung" }, beschreibung),
    inhalt,
    el(
      "div",
      { class: "ws-editor-entscheidung" },
      knoepfe.map((x) =>
        el(
          "div",
          { class: "ws-editor-wahl" },
          knopf(x.text, {
            onclick: async () => {
              fehler.hidden = true;
              try {
                await x.onclick(schliesse);
              } catch (f) {
                fehler.textContent = fehlertext(f);
                fehler.hidden = false;
                fehler.focus();
              }
            },
          }),
          x.hilfe && el("p", { class: "hilfe" }, x.hilfe),
        ),
      ),
    ),
    fehler,
    el("div", { class: "dialog-knoepfe" }, abbrechen),
  );
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (!entschieden) beiAbbruch?.();
    if (zurueck?.isConnected) zurueck.focus();
    else document.querySelector("h1")?.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  abbrechen.focus();
}

function verlassenDialog(k, pufferId, ziel) {
  entscheidung({
    titel: "Ungespeicherte Änderungen",
    beschreibung: "Du hast Änderungen an dieser Seite noch nicht gespeichert.",
    knoepfe: [
      {
        text: "Speichern und verlassen",
        onclick: async (schliesse) => {
          const gespeichert = await k.speichere();
          schliesse();
          // Bei einem Fehler bleibt die Person auf der Seite: Die Meldung steht dort
          if (gespeichert) location.hash = ziel;
        },
      },
      {
        text: "Verwerfen und verlassen",
        hilfe: "Die Änderungen sind danach weg.",
        onclick: (schliesse) => {
          puffer.delete(pufferId);
          k.dirty = false;
          schliesse();
          location.hash = ziel;
        },
      },
    ],
  });
}

// Schliesst ein Seitenblatt und führt danach aus, was gewählt wurde: Der Rückfokus des Blatts kommt zuerst, die Wahl setzt den Fokus danach
function schliesseMit(blatt, fn) {
  blatt.addEventListener("close", fn, { once: true });
  blatt.close();
}

function katalogDialog(k) {
  if (k.dok.bausteine.length >= MAX_BAUSTEINE) {
    k.ctx.melde(
      `Mehr als ${MAX_BAUSTEINE} Bausteine sind nicht möglich.`,
      "fehler",
    );
    return;
  }
  const suche = feld({
    label: "Baustein suchen",
    type: "search",
    autocomplete: "off",
  });
  const n = k.dok.bausteine.length;
  const ort = waehler({
    label: "Einfügen",
    optionen:
      n === 0
        ? [["0", "Am Anfang"]]
        : [
            ["0", "Am Anfang"],
            ...k.dok.bausteine.map((b, i) => [
              String(i + 1),
              i === n - 1 ? "Am Ende" : `Nach Baustein ${i + 1}: ${typName(b)}`,
            ]),
          ],
    wert: String(n),
  });
  const ul = el("ul", { class: "ws-editor-katalog" });
  const zaehler = el("p", { class: "meta", role: "status" });
  const keine = el(
    "p",
    { class: "leer leer--klein", hidden: true },
    "Kein Baustein passt zur Suche.",
  );
  const blatt = seitenblatt({
    titel: "Baustein hinzufügen",
    inhalt: [suche.wurzel, n > 0 ? ort.wurzel : null, zaehler, keine, ul],
  });
  const eintraege = KATALOG.map((e) => ({
    li: el(
      "li",
      {},
      el(
        "button",
        {
          type: "button",
          class: "ws-editor-baustein",
          onclick: () => {
            const pos = Number(ort.eingabe.value);
            schliesseMit(blatt, () => k.fuegeEin(e, pos));
          },
        },
        el("span", { class: "ws-editor-baustein-name" }, e.name),
        el("span", { class: "hilfe" }, e.beschreibung),
      ),
    ),
    text: `${e.name} ${e.beschreibung}`.toLowerCase(),
  }));
  ul.append(...eintraege.map((x) => x.li));
  suche.eingabe.addEventListener("input", () => {
    const frage = suche.eingabe.value.trim().toLowerCase();
    let treffer = 0;
    for (const x of eintraege) {
      x.li.hidden = !x.text.includes(frage);
      if (!x.li.hidden) treffer++;
    }
    keine.hidden = treffer > 0;
    zaehler.textContent = frage
      ? anzahlText(treffer, "1 Baustein passt", "Bausteine passen")
      : "";
  });
}

function bildDialog(k, beiWahl) {
  const suche = feld({
    label: "Bild suchen (nach Beschreibung)",
    type: "search",
    autocomplete: "off",
  });
  const raster = el("ul", { class: "ws-editor-medien" });
  const zaehler = el("p", { class: "meta", role: "status" }, "Wird geladen …");
  const fehler = el("div");
  const blatt = seitenblatt({
    titel: "Bild wählen",
    inhalt: [
      suche.wurzel,
      zaehler,
      fehler,
      raster,
      el(
        "p",
        { class: "hilfe" },
        "Neue Bilder lädst du unter ",
        el("a", { href: "#website/medien" }, "Medien"),
        " hoch.",
      ),
    ],
  });
  let alle = [];
  const zeichne = () => {
    const frage = suche.eingabe.value.trim().toLowerCase();
    const passend = alle.filter((m) =>
      `${m.altText ?? ""} ${m.dekorativ ? "dekorativ" : ""}`
        .toLowerCase()
        .includes(frage),
    );
    raster.replaceChildren(
      ...passend.map((m) =>
        el(
          "li",
          {},
          el(
            "button",
            {
              type: "button",
              class: "ws-editor-medium",
              onclick: () => schliesseMit(blatt, () => beiWahl(m)),
            },
            el("img", { src: m.url, alt: "", loading: "lazy" }),
            el(
              "span",
              {},
              m.dekorativ
                ? "Dekoratives Bild"
                : (m.altText ?? "Ohne Beschreibung"),
            ),
          ),
        ),
      ),
    );
    zaehler.textContent =
      passend.length > 0
        ? `${anzahlText(passend.length, "1 Bild", "Bilder")} von ${alle.length}`
        : alle.length === 0
          ? "Es gibt noch keine Bilder."
          : "Kein Bild passt zur Suche.";
  };
  suche.eingabe.addEventListener("input", zeichne);
  const lade = async () => {
    fehler.replaceChildren();
    zaehler.textContent = "Wird geladen …";
    try {
      await k.ladeMedien();
      alle = [...k.medien.values()]
        .filter((m) => m.mimeTyp.startsWith("image/"))
        .sort((a, b) =>
          String(b.erstelltAm).localeCompare(String(a.erstelltAm)),
        );
      zeichne();
    } catch (f) {
      zaehler.textContent = "";
      fehler.replaceChildren(
        el("p", { class: "feld-fehler", role: "alert" }, fehlertext(f)),
        knopf("Nochmals versuchen", {
          klein: true,
          symbol: "aktualisieren",
          onclick: lade,
        }),
      );
    }
  };
  lade();
}

// --- Vorschau, Veröffentlichen, Versionen ----------------------------------------------------------------------------------

// Die Vorschau zeigt den gespeicherten Entwurf (oder eine Version) als Seite im Rahmen. Der Rahmen hat keine Skripte und liegt auf derselben Herkunft
function vorschauPanel(k, speichereZuerst, beiAenderung) {
  const rahmen = el("iframe", {
    class: "ws-editor-rahmen",
    sandbox: "allow-same-origin",
    referrerpolicy: "no-referrer",
    title: "Vorschau der Seite",
  });
  const huelle = el("div", { class: "ws-editor-huelle" }, rahmen);
  const ueberschrift = el(
    "h3",
    { id: "ws-editor-vorschau-titel", tabindex: "-1" },
    "Vorschau",
  );
  const art = el("p", { class: "meta" });
  let version = null;
  const gruppeName = neueId("breite");
  const optionen = [
    ["desktop", "Computer"],
    ["mobil", "Handy"],
  ].flatMap(([w, text]) => {
    const oid = neueId("breite-option");
    return [
      el("input", {
        type: "radio",
        id: oid,
        name: gruppeName,
        value: w,
        checked: w === "desktop",
        onchange: () =>
          huelle.classList.toggle("ws-editor-huelle--mobil", w === "mobil"),
      }),
      el("label", { for: oid }, icon("haken"), text),
    ];
  });
  const panel = el(
    "section",
    {
      class: "ws-editor-vorschau",
      id: "ws-editor-vorschau",
      "aria-labelledby": "ws-editor-vorschau-titel",
      hidden: true,
    },
    el(
      "div",
      { class: "ws-editor-vorschaukopf" },
      ueberschrift,
      el(
        "fieldset",
        { class: "ws-editor-breite" },
        el("legend", { class: "nur-leser" }, "Breite der Vorschau"),
        el("div", { class: "seg" }, optionen),
      ),
      knopf("Aktualisieren", {
        klein: true,
        symbol: "aktualisieren",
        onclick: () => zeige(version, false),
      }),
      knopf("Schliessen", {
        klein: true,
        symbol: "schliessen",
        onclick: () => {
          panel.hidden = true;
          rahmen.removeAttribute("src");
          beiAenderung();
          document
            .querySelector('[aria-controls="ws-editor-vorschau"]')
            ?.focus();
        },
      }),
    ),
    art,
    huelle,
  );
  async function zeige(nr, fokus = true) {
    // Die Vorschau zeigt den gespeicherten Entwurf: Erst speichern, damit sie stimmt
    if (nr === null && !(await speichereZuerst())) return;
    version = nr;
    art.textContent =
      nr === null
        ? "Der gespeicherte Entwurf. Auch Bausteine nur für Angemeldete oder Gruppen sind sichtbar. Links führen in der Vorschau nirgends hin."
        : `Version ${nr}, nicht der aktuelle Entwurf. Links führen in der Vorschau nirgends hin.`;
    huelle.setAttribute("aria-busy", "true");
    rahmen.setAttribute(
      "src",
      `${API}/seiten/${k.id}/vorschau${nr === null ? "" : `?version=${nr}`}`,
    );
    panel.hidden = false;
    beiAenderung();
    if (fokus) ueberschrift.focus();
  }
  rahmen.addEventListener("load", () => {
    // Auch ein leerer Rahmen meldet «load»
    if (!rahmen.hasAttribute("src")) return;
    huelle.removeAttribute("aria-busy");
    k.ctx.melde("Die Vorschau ist geladen.");
  });
  return { wurzel: panel, zeige };
}

async function veroeffentlichen(k) {
  if (!k.dirty && !k.unveroeffentlicht) {
    k.ctx.melde(
      "Nichts zu veröffentlichen: Der Entwurf ist gleich der veröffentlichten Version.",
    );
    return;
  }
  if (k.dirty && !(await k.speichere())) return;
  const bausteine = k.dok.bausteine;
  const eng = bausteine.filter((b) => b.sichtbarkeit !== "erbt").length;
  const fakten = el(
    "dl",
    { class: "ws-editor-fakten" },
    el("dt", {}, "Seite"),
    el("dd", {}, `${k.dok.titel} (${k.seite.pfad})`),
    el("dt", {}, "Wer sieht sie"),
    el("dd", {}, sichtbarkeitText(k.seite.sichtbarkeit, k.tagNamen)),
    el("dt", {}, "Inhalt"),
    el("dd", {}, anzahlText(bausteine.length, "1 Baustein", "Bausteine")),
    eng > 0 && el("dt", {}, "Eigene Sichtbarkeit"),
    eng > 0 && el("dd", {}, anzahlText(eng, "1 Baustein", "Bausteine")),
  );
  dialogFormular({
    titel: "Seite veröffentlichen",
    beschreibung:
      k.nr === null
        ? "Die Seite wird mit dem gespeicherten Entwurf sichtbar."
        : "Der gespeicherte Entwurf ersetzt die veröffentlichte Version. Die bisherige Version bleibt in der Versionsliste.",
    felder: [
      fakten,
      k.seite.sichtbarkeit.art === "oeffentlich" &&
        el(
          "p",
          { class: "hilfe" },
          "Die Seite ist öffentlich: Alle im Internet können sie lesen.",
        ),
    ].filter(Boolean),
    ok: "Veröffentlichen",
    fehlertext: (f) =>
      f.status === 409 && f.code === "NICHTS_ZU_VEROEFFENTLICHEN"
        ? "Nichts zu veröffentlichen: Der Entwurf ist gleich der veröffentlichten Version."
        : f.status === 422
          ? "Der Entwurf verweist auf etwas, das es nicht mehr gibt (zum Beispiel ein Bild). Prüfe die Bausteine und speichere nochmals."
          : fehlertext(f),
    senden: () => anfrage("POST", `${API}/seiten/${k.id}/veroeffentlichen`),
    danach: ({ nr }) => {
      k.nr = nr;
      k.unveroeffentlicht = false;
      k.statusNeu();
      k.ctx.melde(`Die Seite ist veröffentlicht (Version ${nr}).`);
    },
  });
}

function zurueckziehen(k) {
  bestaetigen({
    titel: "Seite zurückziehen",
    beschreibung: `«${k.dok.titel}» ist danach nicht mehr erreichbar. Der Entwurf und alle Versionen bleiben erhalten. Du kannst die Seite wieder veröffentlichen.`,
    ok: "Zurückziehen",
    aktion: () => anfrage("POST", `${API}/seiten/${k.id}/zurueckziehen`),
    danach: () => {
      k.nr = null;
      k.unveroeffentlicht = true;
      k.statusNeu();
      k.ctx.melde("Die Seite ist zurückgezogen.");
    },
  });
}

// Die Versionen werden erst geladen, wenn die Liste geöffnet wird
function versionenBlatt(k) {
  const inhalt = el("div", {});
  const blatt = seitenblatt({
    titel: "Versionen",
    untertitel: "Die jüngsten 100, neueste zuerst.",
    inhalt,
  });
  const lade = async () => {
    inhalt.replaceChildren(
      el("p", { class: "meta", role: "status" }, "Wird geladen …"),
    );
    try {
      const { versionen } = await anfrage(
        "GET",
        `${API}/seiten/${k.id}/versionen`,
      );
      if (versionen.length === 0) {
        inhalt.replaceChildren(
          el(
            "p",
            { class: "leer" },
            "Es gibt noch keine Version. Veröffentliche die Seite: Dann erscheint hier ihre erste.",
          ),
        );
        return;
      }
      inhalt.replaceChildren(
        el(
          "ul",
          { class: "ws-editor-versionen" },
          versionen.map((v) =>
            el(
              "li",
              {},
              el(
                "div",
                {},
                el("p", { class: "fett" }, `Version ${v.nr}`),
                el(
                  "p",
                  { class: "meta" },
                  el("time", { datetime: v.erstelltAm }, zeit(v.erstelltAm)),
                ),
                v.veroeffentlicht &&
                  el("ul", { class: "chips" }, chip("Veröffentlicht", "ok")),
              ),
              el(
                "div",
                { class: "ws-editor-aktionen" },
                knopf("Ansehen", {
                  klein: true,
                  kontext: `Version ${v.nr}`,
                  onclick: () =>
                    schliesseMit(blatt, () => k.zeigeVersion(v.nr)),
                }),
                knopf("Zurückholen", {
                  klein: true,
                  kontext: `Version ${v.nr}`,
                  onclick: () => zurueckholen(k, v.nr, blatt),
                }),
              ),
            ),
          ),
        ),
      );
    } catch (f) {
      inhalt.replaceChildren(
        el("p", { class: "feld-fehler", role: "alert" }, fehlertext(f)),
        knopf("Nochmals versuchen", {
          klein: true,
          symbol: "aktualisieren",
          onclick: lade,
        }),
      );
    }
  };
  lade();
}

function zurueckholen(k, nr, blatt) {
  bestaetigen({
    titel: `Version ${nr} zurückholen`,
    beschreibung: `Der Entwurf wird durch Version ${nr} ersetzt${
      k.dirty || k.unveroeffentlicht
        ? ". Der aktuelle Entwurf geht dabei verloren, soweit er nicht als Version veröffentlicht ist"
        : ""
    }. Veröffentlicht ist die zurückgeholte Fassung erst, wenn du auf «Veröffentlichen» klickst.`,
    ok: "Zurückholen",
    gefaehrlich: false,
    aktion: async () => {
      await anfrage(
        "POST",
        `${API}/seiten/${k.id}/versionen/${nr}/zurueckholen`,
      );
      const neu = await anfrage("GET", `${API}/seiten/${k.id}/entwurf`);
      k.dok = neu.dokument;
      k.zaehler = neu.zaehler;
      k.dirty = false;
      k.unveroeffentlicht = neu.unveroeffentlicht;
      puffer.delete(`${k.ctx.ich?.id ?? ""}:${k.id}`);
      k.formen.clear();
      k.offen.clear();
      k.geloescht = null;
    },
    danach: () => {
      blatt.close();
      k.neuZeichnen();
      k.ctx.melde(
        `Version ${nr} ist als Entwurf zurückgeholt. Veröffentlicht ist sie noch nicht.`,
      );
    },
  });
}

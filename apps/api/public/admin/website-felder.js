import { anfrage, fehlertext } from "./api.js";
import { el, feld, knopf, neueId, tag } from "./dom.js";
import { loescheFeldFehler } from "./website-dialoge.js";
import {
  bloeckeZuText,
  formatiere,
  textZuBloecken,
  zaehleZeichen,
} from "./website-richtext.js";
import { sk } from "./lader.js";
import { sortierListe } from "./sortieren.js";
import { symbol } from "./website-symbole.js";

// Felder und Typen der Bausteine (Boards E3 und E4). Ein Baustein hat einen Typ mit Name, Kurztext für die Liste, Prüfung und Formular.
// Das Formular arbeitet auf einer Kopie des Bausteins (b) im Seitenblatt «Baustein bearbeiten»; erst «Übernehmen» schreibt ins Dokument.
// k ist der Kontext des Formulars: { tags, tagNamen, personNamen, medien (Map), waehleBild(fn), aendere(), formNeu(b, fokus), kannAlt, altAenderung(mediumId, text) }
// reg(pfad, wurzel, ziel) meldet ein Feld an die Fehlerliste an (Pfad wie beim Server ohne «bausteine.<n>.», zum Beispiel «daten.text»).

const API = "/api/v1/redaktion";
const MAX_TEXT_ZEICHEN = 20000;
export const MAX_KARTEN = 24;
export const MAX_GALERIE = 50;
export const MIN_KARUSSELL = 3;
export const MAX_KARUSSELL = 8;
export const MAX_BAUSTEINE = 100;
// Bausteine der Inhaltsseiten (#560), wie in src/website/bausteine.ts
export const MAX_PERSONEN = 24;
export const MAX_ARTIKEL = 60;

// Darstellungen des Bausteins «karten»: Name im Editor und Name eines Eintrags
export const KARTEN_ARTEN = {
  karten: "Karten",
  liste: "Liste",
  stufen: "Bildkarten",
  merkmale: "Merkmale",
  zeitstrahl: "Zeitstrahl",
  zahlen: "Zahlen",
};
const EINTRAG_NAMEN = {
  karten: "Karte",
  stufen: "Bildkarte",
  merkmale: "Merkmal",
  zeitstrahl: "Station",
  zahlen: "Zahl",
};

const kuerze = (text, n = 60) =>
  text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text;
const anzahlText = (n, eins, viele) => (n === 1 ? eins : `${n} ${viele}`);
const LINK_HILFE =
  "Eine Seite dieser Website (zum Beispiel /stufen/woelfe), eine Webadresse mit https, eine E-Mail-Adresse mit mailto: oder eine Telefonnummer mit tel:.";

// Namen der Felder und Texte zu den Codes der Prüfung des Servers (zod und Verweisprüfung)
export const FELDNAMEN = {
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
  symbol: "Das Symbol",
  bild: "Das Bild",
  alter: "Das Etikett",
  sichtbarkeit: "Die Sichtbarkeit",
  tagIds: "Die Gruppen",
  bezeichnung: "Die Bezeichnung",
  wert: "Der Wert",
  zeit: "Die Zeitangabe",
  name: "Der Name",
  funktion: "Die Funktion",
  email: "Die E-Mail-Adresse",
  preis: "Der Preis",
  hinweis: "Der Hinweis",
};
export const CODE_TEXTE = {
  too_small: "fehlt oder ist zu kurz.",
  too_big: "ist zu lang, oder es sind zu viele.",
  invalid_type: "fehlt.",
  invalid_value: "hat einen ungültigen Wert.",
  invalid_format: "hat ein ungültiges Format.",
  invalid_union: "hat einen ungültigen Wert.",
  custom: "ist ungültig. Prüfe die Adresse und die Länge.",
  unrecognized_keys: "enthält etwas Unbekanntes.",
};
export const VERWEIS_TEXTE = {
  MEDIUM_UNBEKANNT: "Das gewählte Bild gibt es nicht mehr. Wähle ein anderes.",
  MEDIUM_FORMAT:
    "Dieser Baustein braucht ein Bild, das gewählte Medium ist keines.",
  MEDIUM_NICHT_OEFFENTLICH:
    "Das Bild ist nicht öffentlich. Wähle ein öffentliches Bild oder stelle den Baustein auf «Nur angemeldet».",
  MEDIUM_ALT_FEHLT:
    "Im Karussell braucht jedes Bild einen Alt-Text. Wähle ein Bild mit Alt-Text oder ergänze ihn in der Medienbibliothek.",
  TAG_UNBEKANNT: "Die gewählte Gruppe gibt es nicht mehr.",
  PERSON_UNBEKANNT: "Die gewählte Person gibt es nicht mehr.",
  SEITE_UNBEKANNT:
    "Ein Link zeigt auf eine Seite, die es nicht gibt. Prüfe die Adresse.",
};

export const feldName = (pfad) =>
  FELDNAMEN[
    pfad
      .split(".")
      .filter((s) => !/^\d+$/.test(s))
      .at(-1)
  ] ?? "Die Eingabe";

// Ein Feld an die Fehler anmelden: Der Fehler verschwindet, sobald die Person das Feld ändert
function anmelden(reg, pfad, f) {
  reg(pfad, f.wurzel, f.eingabe);
  const weg = () => loescheFeldFehler(f.wurzel);
  f.eingabe.addEventListener("input", weg);
  f.eingabe.addEventListener("change", weg);
}

// Textfeld oder Zahlfeld, das beim Tippen in die Kopie des Bausteins schreibt
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

// Auswahl aus einer Liste: das native Feld klappt am Rand des Fensters von selbst und funktioniert mit Tastatur und Screenreader
function waehler({ label, optionen, wert }) {
  const id = neueId("waehler");
  const eingabeEl = el(
    "select",
    { id, class: "ws-select" },
    optionen.map(([w, text]) => el("option", { value: w }, text)),
  );
  eingabeEl.value = wert;
  return {
    wurzel: el(
      "div",
      { class: "feld" },
      el("label", { for: id }, label),
      eingabeEl,
    ),
    eingabe: eingabeEl,
  };
}

// Auswahl aus wenigen Werten als Segment (Radios); Zahlen bleiben Zahlen
function wahl(k, b, reg, schluessel, label, optionen) {
  const name = neueId("segment");
  const wurzel = el(
    "fieldset",
    { class: "feld" },
    el("legend", { class: "legende" }, label),
  );
  const eintraege = optionen.map(([w, text]) => {
    const id = neueId("segment-option");
    const e = el("input", {
      type: "radio",
      id,
      name,
      value: String(w),
      onchange: () => {
        b.daten[schluessel] = typeof w === "number" ? w : String(w);
        k.aendere(b);
      },
    });
    e.checked = b.daten[schluessel] === w;
    return [e, el("label", { for: id }, symbol("haken"), text)];
  });
  wurzel.append(el("div", { class: "seg" }, eintraege.flat()));
  reg(
    `daten.${schluessel}`,
    wurzel,
    wurzel.querySelector("input:checked") ?? wurzel.querySelector("input"),
  );
  return wurzel;
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
  // Format-Leiste: Fett, Kursiv, Link, Liste; setzt die Schreibweise im Feld um, der Text bleibt derselbe (auch Strg+B und Strg+I)
  const wende = (art) => {
    const t = f.eingabe;
    const r = formatiere(t.value, t.selectionStart, t.selectionEnd, art);
    t.value = r.wert;
    t.focus();
    t.setSelectionRange(r.von, r.bis);
    t.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const leiste = el(
    "div",
    { class: "ws-format", role: "group", "aria-label": "Textformat" },
    [
      ["fett", "Fett", "Strg+B"],
      ["kursiv", "Kursiv", "Strg+I"],
      ["link", "Link"],
      ["liste", "Liste"],
      ["nummer", "Nummerierung"],
    ].map(([art, text, taste]) =>
      knopf(text, {
        klein: true,
        "data-tipp": taste ? `${text} (${taste})` : undefined,
        onclick: () => wende(art),
      }),
    ),
  );
  f.eingabe.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    const art = { b: "fett", i: "kursiv" }[e.key.toLowerCase()];
    if (!art) return;
    e.preventDefault();
    wende(art);
  });
  f.eingabe.before(leiste);
  f.wurzel.append(zaehler);
  anmelden(reg, "daten.inhalt", f);
  return f.wurzel;
}

const zahl = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 1 });
export const groesseText = (bytes) =>
  bytes < 1024 * 1024
    ? `${zahl.format(Math.max(1, Math.round(bytes / 1024)))} KB`
    : `${zahl.format(bytes / (1024 * 1024))} MB`;

// Ein Bild der Bibliothek (E4): Vorschau, Angaben, «Bild wählen» und beim Typ «Bild» der Alt-Text.
// Der Alt-Text gehört dem Medium, nicht dem Baustein: Wer Medien verwalten darf, ändert ihn hier; für alle anderen steht er zum Lesen da.
// schluessel: Feld des Eintrags mit der Bild-ID; optional: das Bild darf fehlen (Stufenkarte), «Bild entfernen» erscheint
// alt: «pflicht» (Bild, Karussell: ohne Alt-Text kein Übernehmen), «zeigen» (der Alt-Text steht da und lässt sich ändern) oder ein Satz, warum das Bild hier keinen braucht (Porträt)
// name: Beschriftung («Bild», «Foto der Station», «Porträt»); klein: Vorschau in halber Höhe, für Einträge einer Liste
function bildWahl(
  k,
  b,
  reg,
  ziel,
  pfad,
  {
    alt = "zeigen",
    schluessel = "mediumId",
    optional = false,
    name = "Bild",
    klein = false,
  } = {},
) {
  const wurzel = el("div", {
    class: klein ? "feld ws-bildwahl ws-bildwahl--klein" : "feld ws-bildwahl",
  });
  const zeichne = () => {
    const medium = k.medien.get(ziel[schluessel]);
    wurzel.replaceChildren();
    wurzel.classList.remove("fehler");
    const titelId = neueId("bild");
    const waehleFn = () =>
      k.waehleBild((m) => {
        ziel[schluessel] = m.id;
        k.medien.set(m.id, m);
        k.aendere(b);
        zeichne();
        wurzel.querySelector("button")?.focus();
      });
    const waehlen = knopf(
      ziel[schluessel] ? "Anderes Bild wählen" : "Bild wählen",
      {
        klein: true,
        "aria-describedby": titelId,
        onclick: waehleFn,
      },
    );
    wurzel.append(el("span", { class: "legende", id: titelId }, name));
    if (!ziel[schluessel]) {
      wurzel.append(
        el(
          "p",
          { class: "hilfe" },
          optional ? "Kein Bild (optional)." : "Noch kein Bild gewählt.",
        ),
        waehlen,
      );
      reg(pfad, wurzel, waehlen);
      return;
    }
    // Das Bild lädt über seine Adresse; fehlt es, steht der Zustand «nicht mehr da» an seiner Stelle
    const rahmen = el(
      "div",
      { class: "ws-bildvorschau", "aria-busy": "true" },
      sk("b", 320),
    );
    const bild = el("img", {
      src: `/api/v1/medien/${ziel[schluessel]}`,
      alt: "",
      class: "ws-bildvorschau-bild",
      onload: () => {
        rahmen.removeAttribute("aria-busy");
        rahmen.classList.add("geladen");
        rahmen.querySelector(".sk")?.remove();
        rahmen.querySelector("[role=status]")?.remove();
      },
      onerror: () => {
        wurzel.replaceChildren(
          el(
            "div",
            { class: "zustand", role: "alert" },
            el("h3", {}, "Das Bild gibt es nicht mehr."),
            el(
              "p",
              { class: "leise" },
              "Jemand hat es aus den Medien gelöscht. Wähle ein anderes.",
            ),
            knopf("Bild wählen", { klein: true, onclick: waehleFn }),
          ),
        );
        reg(pfad, wurzel, wurzel.querySelector("button"));
      },
    });
    rahmen.append(
      bild,
      el("p", { class: "nur-leser", role: "status" }, "Bild lädt …"),
    );
    // el() überspringt, was fehlt (append() schriebe «undefined» oder «false» auf die Seite)
    wurzel.append(
      rahmen,
      el(
        "div",
        { class: "ws-bildangaben" },
        medium &&
          el(
            "p",
            { class: "klein leise" },
            [
              `Bild vom ${tag(medium.erstelltAm)}`,
              groesseText(medium.groesse),
              medium.breite && `${medium.breite} × ${medium.hoehe} Pixel`,
            ]
              .filter(Boolean)
              .join(" · "),
          ),
        el(
          "div",
          { class: "ws-teilaktionen" },
          waehlen,
          optional &&
            knopf("Bild entfernen", {
              klein: true,
              "aria-describedby": titelId,
              onclick: () => {
                delete ziel[schluessel];
                k.aendere(b);
                zeichne();
                wurzel.querySelector("button")?.focus();
              },
            }),
        ),
      ),
    );
    reg(pfad, wurzel, waehlen);
    wurzel.append(altFeld(k, medium, alt, reg));
  };
  // Alt-Text (Pflicht) des gewählten Bildes
  zeichne();
  return wurzel;
}

function altFeld(k, medium, alt, reg) {
  const kannAendern = k.kannAlt && medium && !medium.dekorativ;
  if (alt !== "pflicht" && alt !== "zeigen")
    return el("p", { class: "hilfe" }, alt);
  if (!medium) {
    return el(
      "p",
      { class: "hilfe" },
      "Der Alt-Text dieses Bildes steht in der Medienbibliothek und erscheint mit dem Bild auf der Seite.",
    );
  }
  if (medium.dekorativ) {
    return el(
      "p",
      { class: "hilfe" },
      "Das Bild ist als Zierde markiert: Screenreader überspringen es. Das änderst du unter «Medien».",
    );
  }
  const f = feld({
    label: alt === "pflicht" ? "Alt-Text (Pflicht)" : "Alt-Text",
    mehrzeilig: true,
    rows: 3,
    maxlength: 500,
    wert: k.altText(medium),
    readonly: !kannAendern,
    hilfe: kannAendern
      ? "Beschreibe, was man sieht. Screenreader lesen diesen Text vor. Er gehört zum Bild und gilt überall, wo es steht."
      : "Screenreader lesen diesen Text vor. Ändern kann ihn, wer Medien verwaltet, unter «Medien».",
  });
  f.eingabe.addEventListener("input", () => {
    k.altAenderung(medium.id, f.eingabe.value);
  });
  anmelden(reg, `alt.${medium.id}`, f);
  return f.wurzel;
}

// Eine Liste von Teilen (Bilder, Karten) mit «Hinzufügen», «Entfernen» und der Reihenfolge wie bei den Bausteinen (Sortierliste: Griff, Tastatur, Hoch und Runter).
// Jede Änderung der Liste zeichnet das Formular des Bausteins neu und setzt den Fokus auf den betroffenen Teil.
function listenForm(
  k,
  b,
  { liste, max, hinzuText, hinzu, zeile, name, pfadName, listeName },
) {
  const eintraege = liste();
  const neu = (fokus) => k.formNeu(b, fokus);
  const inhalt = (eintrag, i) => {
    const bez = `${name} ${i + 1}`;
    return el(
      "div",
      { class: "ws-teil-karte" },
      el("h4", {}, bez),
      ...zeile(eintrag, `${pfadName}.${i}`),
      el(
        "div",
        { class: "ws-teilaktionen" },
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
    );
  };
  const reihe = sortierListe({
    beschriftung: listeName,
    eintraege: eintraege.map((e, i) => ({
      id: String(i),
      text: `${name} ${i + 1}`,
      inhalt: inhalt(e, i),
    })),
    // Die neue Reihenfolge gilt sofort im Baustein; das Formular wird neu gezeichnet, damit Nummern und Pfade stimmen
    beiNeu: (ids) => {
      const aktiv = document.activeElement;
      const li = aktiv?.closest?.(".sortier-eintrag");
      const index = li ? [...li.parentElement.children].indexOf(li) : 0;
      const sortiert = ids.map((id) => eintraege[Number(id)]);
      eintraege.splice(0, eintraege.length, ...sortiert);
      k.aendere(b);
      neu({ index, was: aktiv?.dataset?.art ?? "neu" });
    },
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
  return el("div", { class: "ws-liste" }, reihe.wurzel, hinzuKnopf);
}

// Galerie und Karussell: eine Liste von Bildern; im Karussell zeigt jede Zeile auch den Alt-Text (Pflicht)
function galerieForm(k, b, reg, karussell = false) {
  return listenForm(k, b, {
    name: karussell ? "Karussellbild" : "Galeriebild",
    listeName: karussell ? "Bilder des Karussells" : "Bilder der Galerie",
    pfadName: "daten.bilder",
    liste: () => b.daten.bilder,
    max: karussell ? MAX_KARUSSELL : MAX_GALERIE,
    hinzuText: "Bild hinzufügen",
    hinzu: (liste, fertig) =>
      k.waehleBild((m) => {
        k.medien.set(m.id, m);
        liste.push({ mediumId: m.id });
        fertig(liste.length - 1);
      }),
    zeile: (eintrag, pfad) => [
      bildWahl(k, b, reg, eintrag, `${pfad}.mediumId`, {
        alt: karussell ? "pflicht" : "zeigen",
        klein: true,
      }),
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
          // Im Karussell steht unter jedem Bild ein Text (#559)
          ...(karussell && {
            hilfe: "Ohne Bildunterschrift steht der Alt-Text unter dem Bild.",
          }),
        },
      ),
    ],
  });
}

function kartenForm(k, b, reg) {
  const art = b.daten.darstellung;
  const darstellung = wahl(
    k,
    b,
    reg,
    "darstellung",
    "Darstellung",
    Object.entries(KARTEN_ARTEN),
  );
  // Die Felder hängen von der Darstellung ab: Das Formular zeichnet sich neu, der Fokus bleibt auf der Wahl
  darstellung.addEventListener("change", () => {
    k.formNeu(b);
    document.querySelector(".ws-blattform input[type=radio]:checked")?.focus();
  });
  const hilfe = {
    merkmale:
      "Wenige Stichworte mit kurzem Text in einem blauen Band, ohne Link, auf Wunsch je mit Foto. Gut für «Das erwartet dich».",
    stufen:
      "Karten mit Foto, einem Etikett im Bild und einem Link auf die ganze Karte. Gut für Stufen (Etikett: Alter) und für Artikel (Etikett: Preis).",
    zeitstrahl:
      "Stationen einer Geschichte in ihrer Reihenfolge, in einem blauen Band: Im Titel steht das Jahr (kurz, es erscheint sehr gross), im Text, was geschah. Mit Foto stehen Bild und Text abwechselnd links und rechts.",
    zahlen:
      "Wenige grosse Zahlen mit kurzer Beschriftung: Im Titel steht die Zahl, im Text, was sie zählt.",
  }[art];
  const titelName =
    { zeitstrahl: "Jahr oder Datum", zahlen: "Zahl", merkmale: "Stichwort" }[
      art
    ] ?? "Titel";
  const bildName = { zeitstrahl: "Foto der Station", stufen: "Foto der Karte" }[
    art
  ];
  const mitBild = ["stufen", "merkmale", "zeitstrahl"].includes(art);
  const ohneLink = ["merkmale", "zeitstrahl", "zahlen"].includes(art);
  return [
    darstellung,
    ...(hilfe ? [el("p", { class: "hilfe" }, hilfe)] : []),
    listenForm(k, b, {
      name: EINTRAG_NAMEN[art] ?? "Eintrag",
      listeName: "Einträge",
      pfadName: "daten.eintraege",
      liste: () => b.daten.eintraege,
      max: MAX_KARTEN,
      hinzuText: `${EINTRAG_NAMEN[art] ?? "Eintrag"} hinzufügen`,
      hinzu: (liste, fertig) => {
        liste.push({ titel: "" });
        fertig(liste.length - 1);
      },
      zeile: (eintrag, pfad) => [
        teilEingabe(k, b, reg, eintrag, "titel", titelName, `${pfad}.titel`, {
          maxlength: 100,
        }),
        ...(art === "stufen"
          ? [
              teilEingabe(
                k,
                b,
                reg,
                eintrag,
                "alter",
                "Etikett im Bild (optional)",
                `${pfad}.alter`,
                {
                  optional: true,
                  maxlength: 40,
                  hilfe:
                    "Steht unten links im Foto, zum Beispiel 3./4. Klasse oder CHF 25.–.",
                },
              ),
            ]
          : []),
        ...(mitBild
          ? [
              bildWahl(k, b, reg, eintrag, `${pfad}.bild`, {
                schluessel: "bild",
                optional: true,
                klein: true,
                ...(bildName && { name: bildName }),
              }),
            ]
          : []),
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
        ...(ohneLink
          ? []
          : [
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
            ]),
      ],
    }),
  ];
}

// --- Bausteine der Inhaltsseiten (#560): Listen von Einträgen mit Pflicht- und freiwilligen Feldern ---------------------------

// Fehlt ein Pflichtfeld eines Eintrags, meldet die Prüfung den Pfad des Feldes
const pflicht = (d, ...felder) => [
  ...((d.eintraege ?? []).length === 0 ? [["daten.eintraege", "fehlt."]] : []),
  ...(d.eintraege ?? []).flatMap((x, i) =>
    felder.flatMap((f) =>
      x[f]?.trim() ? [] : [[`daten.eintraege.${i}.${f}`, "fehlt."]],
    ),
  ),
];

// Ein freiwilliges Bild je Eintrag: wählen, wechseln, entfernen. Der Alt-Text bleibt am Medium
// bild: true oder die Optionen von bildWahl (Beschriftung, Alt-Text)
function bildOptional(k, b, reg, eintrag, pfad, bild) {
  return [
    bildWahl(k, b, reg, eintrag, `${pfad}.mediumId`, {
      optional: true,
      klein: true,
      ...(bild === true ? {} : bild),
    }),
  ];
}

// felder: [Schlüssel, Beschriftung, Optionen von teilEingabe]; bild: der Eintrag hat ein freiwilliges Bild
function eintraegeForm(k, b, reg, { name, max, felder, bild = false }) {
  return listenForm(k, b, {
    name,
    listeName: "Einträge",
    pfadName: "daten.eintraege",
    liste: () => b.daten.eintraege,
    max,
    hinzuText: `${name} hinzufügen`,
    hinzu: (liste, fertig) => {
      liste.push({});
      fertig(liste.length - 1);
    },
    zeile: (eintrag, pfad) => [
      ...felder.map(([schluessel, label, optionen]) =>
        teilEingabe(
          k,
          b,
          reg,
          eintrag,
          schluessel,
          label,
          `${pfad}.${schluessel}`,
          optionen,
        ),
      ),
      ...(bild ? bildOptional(k, b, reg, eintrag, pfad, bild) : []),
    ],
  });
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
    const wert = Number(f.eingabe.value.trim().replace(",", "."));
    if (f.eingabe.value.trim() === "") delete b.daten.groesse;
    else b.daten.groesse = Number.isFinite(wert) ? Math.round(wert * 1000) : -1;
    k.aendere(b);
  });
  anmelden(reg, "daten.groesse", f);
  return f.wurzel;
}

// Eine Gruppe wählen: Pillen (genau eine; bei optional lässt sich die Wahl wieder abwählen)
function gruppenPillen(k, b, reg, schluessel, label, optional) {
  const wurzel = el("div", { class: "feld", role: "group" });
  const legendeId = neueId("legende");
  const pillen = el("div", { class: "pillen" });
  const zeichne = () => {
    const aktuell = b.daten[schluessel] ?? "";
    pillen.replaceChildren(
      ...k.tags.map((t) =>
        el(
          "button",
          {
            type: "button",
            class: "pille",
            "aria-pressed": String(t.id === aktuell),
            onclick: () => {
              if (t.id === b.daten[schluessel] && optional)
                delete b.daten[schluessel];
              else b.daten[schluessel] = t.id;
              k.aendere(b);
              loescheFeldFehler(wurzel);
              zeichne();
              pillen.querySelector(`[aria-pressed="true"]`)?.focus();
            },
          },
          t.name,
        ),
      ),
      ...(aktuell && !k.tagNamen.has(aktuell)
        ? [
            el(
              "button",
              { type: "button", class: "pille", "aria-pressed": "true" },
              "Unbekannte Gruppe",
            ),
          ]
        : []),
    );
  };
  wurzel.setAttribute("aria-labelledby", legendeId);
  wurzel.append(el("span", { class: "legende", id: legendeId }, label), pillen);
  if (k.tags.length === 0)
    wurzel.append(el("p", { class: "hilfe" }, "Es gibt noch keine Gruppen."));
  zeichne();
  reg(`daten.${schluessel}`, wurzel, pillen.querySelector("button") ?? wurzel);
  return wurzel;
}

// Erst die Gruppe, dann die Person der Gruppe (die Liste kommt vom Server, nur für die gewählte Gruppe)
function personWahl(k, b, reg) {
  const wurzel = el("div", { class: "feld" });
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
        el("p", { class: "fehlertext", role: "alert" }, fehlertext(f)),
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

// Der Link des Hinweisbands ist ein Teilobjekt: Felder lesen und schreiben darin, fehlen beide, entfällt der ganze Link
function linkTeil(b) {
  return new Proxy(
    {},
    {
      get: (_, schluessel) => b.daten.link?.[schluessel],
      set: (_, schluessel, wert) => {
        b.daten.link = { ...b.daten.link, [schluessel]: wert };
        return true;
      },
      deleteProperty: (_, schluessel) => {
        const link = { ...b.daten.link };
        delete link[schluessel];
        if (Object.keys(link).length === 0) delete b.daten.link;
        else b.daten.link = link;
        return true;
      },
    },
  );
}

// --- Typen -------------------------------------------------------------------------------------------------------------

const tagText = (d, k, leer) =>
  d.tagId ? `Gruppe ${k.tagNamen.get(d.tagId) ?? "unbekannt"}` : leer;

export const TYPEN = {
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
    kurz: (d, k) => {
      const m = k.medien.get(d.mediumId);
      const alt = m
        ? m.dekorativ
          ? "Zierde"
          : m.altText
            ? "Alt-Text vorhanden"
            : "Alt-Text fehlt"
        : "";
      return [d.unterschrift, alt].filter(Boolean).join(" · ") || "Bild";
    },
    pruefe: (d, k) => {
      const fehler = d.mediumId ? [] : [["daten.mediumId", "fehlt."]];
      const m = d.mediumId ? k?.medien.get(d.mediumId) : null;
      if (m && !m.dekorativ && !k.altText(m).trim())
        fehler.push([`alt.${m.id}`, "fehlt."]);
      return fehler;
    },
    form: (k, b, reg) => [
      bildWahl(k, b, reg, b.daten, "daten.mediumId", { alt: "pflicht" }),
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
  karussell: {
    name: "Karussell",
    kurz: (d) => anzahlText(d.bilder?.length ?? 0, "1 Bild", "Bilder"),
    pruefe: (d, k) => [
      ...((d.bilder ?? []).length < MIN_KARUSSELL
        ? [["daten.bilder", `braucht mindestens ${MIN_KARUSSELL} Bilder.`]]
        : []),
      ...(d.bilder ?? []).flatMap((x, i) =>
        !x.mediumId
          ? [[`daten.bilder.${i}.mediumId`, "fehlt."]]
          : k?.medien.get(x.mediumId)?.dekorativ
            ? [[`daten.bilder.${i}.mediumId`, "hat keinen Alt-Text."]]
            : [],
      ),
    ],
    form: (k, b, reg) => [galerieForm(k, b, reg, true)],
  },
  karten: {
    name: "Karten",
    kurz: (d) =>
      [
        anzahlText(d.eintraege?.length ?? 0, "1 Eintrag", "Einträge"),
        kuerze(
          (d.eintraege ?? [])
            .map((e) => e.titel)
            .filter(Boolean)
            .join(", "),
          70,
        ),
      ]
        .filter(Boolean)
        .join(": "),
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
    name: "Schaltfläche und Link",
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
    name: "Datei zum Herunterladen",
    kurz: (d) =>
      d.titel
        ? `${d.titel}${[d.typ, d.groesse !== undefined && groesseText(d.groesse)].filter(Boolean).length > 0 ? ` (${[d.typ, d.groesse !== undefined && groesseText(d.groesse)].filter(Boolean).join(", ")})` : ""}`
        : "",
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
  personen: {
    name: "Personen",
    kurz: (d) => anzahlText(d.eintraege?.length ?? 0, "1 Person", "Personen"),
    pruefe: (d) => pflicht(d, "name"),
    form: (k, b, reg) => [
      el(
        "p",
        { class: "hilfe" },
        "Ansprechpersonen mit Foto, Anzeigename, Funktion und E-Mail-Adresse. Trage nur ein, was die Person öffentlich zeigen will: die Adresse ihrer Funktion, keine private. Eine Telefonnummer gibt es hier nicht.",
      ),
      eintraegeForm(k, b, reg, {
        name: "Person",
        max: MAX_PERSONEN,
        bild: {
          name: "Porträt",
          alt: "Das Porträt braucht keinen Alt-Text: Der Name steht daneben. Ohne Porträt stehen die Anfangsbuchstaben.",
        },
        felder: [
          [
            "name",
            "Anzeigename",
            {
              maxlength: 100,
              hilfe:
                "Steht gross unter dem Bild, zum Beispiel der Cevi-Name, sonst der Vorname.",
            },
          ],
          [
            "funktion",
            "Funktion (optional)",
            { optional: true, maxlength: 100 },
          ],
          [
            "email",
            "E-Mail-Adresse der Funktion (optional)",
            {
              optional: true,
              maxlength: 254,
              type: "email",
              spellcheck: "false",
              autocapitalize: "off",
            },
          ],
        ],
      }),
    ],
  },
  artikel: {
    name: "Artikel",
    kurz: (d) => anzahlText(d.eintraege?.length ?? 0, "1 Artikel", "Artikel"),
    pruefe: (d) => pflicht(d, "name"),
    form: (k, b, reg) => [
      el(
        "p",
        { class: "hilfe" },
        "Karten mit Bild, Name und Preis, zum Beispiel für das Lädeli.",
      ),
      eintraegeForm(k, b, reg, {
        name: "Artikel",
        max: MAX_ARTIKEL,
        bild: true,
        felder: [
          ["name", "Name", { maxlength: 100 }],
          [
            "preis",
            "Preis (optional)",
            {
              optional: true,
              maxlength: 40,
              hilfe: "Zum Beispiel CHF 40.– oder gratis.",
            },
          ],
          ["hinweis", "Hinweis (optional)", { optional: true, maxlength: 200 }],
        ],
      }),
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
    kurz: (d, k) =>
      d.tagId
        ? `Aus der ${tagText(d, k, "").replace("Gruppe ", "Gruppe ")}`
        : "",
    pruefe: (d) => (d.tagId ? [] : [["daten.tagId", "fehlt."]]),
    form: (k, b, reg) => [
      gruppenPillen(k, b, reg, "tagId", "Gruppe", false),
      el(
        "p",
        { class: "hilfe" },
        "Zeigt alle Personen der Gruppe mit Cevi-Name und Funktion.",
      ),
    ],
  },
  terminliste: {
    name: "Termin-Liste",
    kurz: (d, k) =>
      `${tagText(d, k, "Alle Termine")} · nächste ${d.anzahl ?? ""} Termine`,
    pruefe: (d) =>
      Number.isInteger(d.anzahl) && d.anzahl >= 3 && d.anzahl <= 10
        ? []
        : [["daten.anzahl", "ist eine ganze Zahl von 3 bis 10."]],
    form: (k, b, reg) => [
      gruppenPillen(
        k,
        b,
        reg,
        "tagId",
        "Gruppen (ohne Wahl: alle Termine)",
        true,
      ),
      eingabe(k, b, reg, "anzahl", "Anzahl Termine", {
        zahl: true,
        inputmode: "numeric",
        hilfe: "3 bis 10",
        class: "ws-kurzfeld",
      }),
      el(
        "p",
        { class: "hilfe" },
        "Ohne Gruppe: die kommenden Termine öffentlicher Anlässe. Mit Gruppe: die kommenden Termine der Gruppe. Die Liste ändert sich auf der Website mit dem nächsten Abgleich (spätestens nach 10 Minuten).",
      ),
    ],
  },
  trenner: {
    name: "Abstand und Trennlinie",
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
    name: "Link zu Video oder Social",
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
  // Hinweisband (#549): ein Satz, optional mit Link
  hinweis: {
    name: "Hinweisband",
    kurz: (d) => d.text ?? "",
    pruefe: (d) => [
      ...(d.text?.trim() ? [] : [["daten.text", "fehlt."]]),
      ...(d.link && !d.link.beschriftung?.trim()
        ? [["daten.link.beschriftung", "fehlt."]]
        : []),
      ...(d.link && !d.link.ziel?.trim()
        ? [["daten.link.ziel", "fehlt."]]
        : []),
    ],
    form: (k, b, reg) => [
      eingabe(k, b, reg, "text", "Satz", {
        maxlength: 200,
        hilfe: "Zum Beispiel: Anmeldung zum Sommerlager offen bis 15. März.",
      }),
      el(
        "p",
        { class: "hilfe" },
        "Der Link ist freiwillig. Lass beide Felder leer, wenn der Satz allein steht.",
      ),
      teilEingabe(
        k,
        b,
        reg,
        linkTeil(b),
        "beschriftung",
        "Beschriftung des Links (optional)",
        "daten.link.beschriftung",
        {
          optional: true,
          maxlength: 60,
        },
      ),
      teilEingabe(
        k,
        b,
        reg,
        linkTeil(b),
        "ziel",
        "Ziel des Links (optional)",
        "daten.link.ziel",
        {
          optional: true,
          maxlength: 2000,
          spellcheck: "false",
          hilfe: LINK_HILFE,
        },
      ),
    ],
  },
  // Eckdaten (#555): frei benannte Angaben als Tafel neben dem Text
  eckdaten: {
    name: "Eckdaten",
    kurz: (d) => (d.eintraege ?? []).map((e) => e.bezeichnung).join(", "),
    pruefe: (d) =>
      (d.eintraege ?? []).flatMap((e, i) => [
        ...(e.bezeichnung?.trim()
          ? []
          : [[`daten.eintraege.${i}.bezeichnung`, "fehlt."]]),
        ...(e.wert?.trim() ? [] : [[`daten.eintraege.${i}.wert`, "fehlt."]]),
      ]),
    form: (k, b, reg) => [
      el(
        "p",
        { class: "hilfe" },
        "Das Wichtigste auf einen Blick, zum Beispiel Datum, Ort, Kosten und Anmeldeschluss. Steht der Baustein gleich nach einem Text, erscheint er rechts daneben. Gehört die Seite zu einem Anlass mit Anmeldung, steht darunter von selbst die Schaltfläche «Zur Anmeldung».",
      ),
      listenForm(k, b, {
        name: "Angabe",
        listeName: "Angaben",
        pfadName: "daten.eintraege",
        liste: () => b.daten.eintraege,
        max: 12,
        hinzuText: "Angabe hinzufügen",
        hinzu: (liste, fertig) => {
          liste.push({ bezeichnung: "", wert: "" });
          fertig(liste.length - 1);
        },
        zeile: (eintrag, pfad) => [
          teilEingabe(
            k,
            b,
            reg,
            eintrag,
            "bezeichnung",
            "Bezeichnung",
            `${pfad}.bezeichnung`,
            { maxlength: 60, hilfe: "Zum Beispiel: Datum." },
          ),
          teilEingabe(k, b, reg, eintrag, "wert", "Angabe", `${pfad}.wert`, {
            maxlength: 300,
          }),
          teilEingabe(
            k,
            b,
            reg,
            eintrag,
            "link",
            "Link an der Angabe (optional)",
            `${pfad}.link`,
            {
              optional: true,
              maxlength: 2000,
              spellcheck: "false",
              hilfe: LINK_HILFE,
            },
          ),
        ],
      }),
    ],
  },
  // Aufruf zum Handeln (#555): farbiges Band mit Titel, Text und Schaltfläche
  aufruf: {
    name: "Aufruf zum Handeln",
    kurz: (d) => d.titel ?? "",
    pruefe: (d) => [
      ...(d.titel?.trim() ? [] : [["daten.titel", "fehlt."]]),
      ...(d.beschriftung?.trim() ? [] : [["daten.beschriftung", "fehlt."]]),
      ...(d.ziel?.trim() ? [] : [["daten.ziel", "fehlt."]]),
    ],
    form: (k, b, reg) => [
      eingabe(k, b, reg, "titel", "Titel", {
        maxlength: 100,
        hilfe: "Zum Beispiel: Schnuppern im Cevi.",
      }),
      eingabe(k, b, reg, "text", "Text (optional)", {
        maxlength: 500,
        optional: true,
        mehrzeilig: true,
        rows: 3,
      }),
      eingabe(k, b, reg, "beschriftung", "Beschriftung der Schaltfläche", {
        maxlength: 60,
      }),
      eingabe(k, b, reg, "ziel", "Ziel der Schaltfläche", {
        maxlength: 2000,
        spellcheck: "false",
        autocapitalize: "off",
        hilfe: LINK_HILFE,
      }),
    ],
  },
  // Kontaktkarte (#549, #580): Telefon, E-Mail und Anschrift der Abteilung stehen in der Konfiguration des Servers
  kontaktkarte: {
    name: "Kontaktkarte",
    kurz: (d, k) =>
      k.personNamen.get(d.personId) ?? "Fragen? Melde dich bei uns.",
    pruefe: (d) =>
      (d.verweise ?? []).flatMap((v, i) => [
        ...(v.beschriftung?.trim()
          ? []
          : [[`daten.verweise.${i}.beschriftung`, "fehlt."]]),
        ...(v.ziel?.trim() ? [] : [[`daten.verweise.${i}.ziel`, "fehlt."]]),
      ]),
    form: (k, b, reg) => [
      eingabe(k, b, reg, "titel", "Titel (optional)", {
        maxlength: 100,
        optional: true,
        hilfe: "Ohne Eingabe steht dort: Fragen? Melde dich bei uns.",
      }),
      personWahl(k, b, reg),
      el(
        "p",
        { class: "hilfe" },
        "Die Person ist freiwillig; Cevi-Name und Funktion erscheinen unter dem Titel. Die Knöpfe «E-Mail schreiben» und «Anrufen» und die Angaben zu Anschrift, E-Mail und Telefon setzt der Server aus der Konfiguration der Abteilung ein.",
      ),
      eingabe(k, b, reg, "hinweis", "Hinweis zur Erreichbarkeit (optional)", {
        maxlength: 200,
        optional: true,
        mehrzeilig: true,
        rows: 2,
        hilfe:
          "Steht unter dem Titel, zum Beispiel wann man jemanden erreicht. Nur Angaben, die stimmen.",
      }),
      bildWahl(k, b, reg, b.daten, "daten.bild", {
        schluessel: "bild",
        optional: true,
        name: "Bild neben den Angaben",
      }),
      el(
        "p",
        { class: "hilfe" },
        "Weiterführende Verweise stehen als ruhige Zeile unter der Karte, zum Beispiel Cevi Schweiz. Fremde Seiten tragen den kleinen Pfeil nach oben rechts.",
      ),
      listenForm(k, b, {
        name: "Verweis",
        listeName: "Verweise",
        pfadName: "daten.verweise",
        liste: () => b.daten.verweise ?? [],
        max: 4,
        hinzuText: "Verweis hinzufügen",
        hinzu: (liste, fertig) => {
          // Das Feld entsteht erst mit dem ersten Verweis
          const verweise = (b.daten.verweise ??= liste);
          verweise.push({ beschriftung: "", ziel: "" });
          fertig(verweise.length - 1);
        },
        zeile: (eintrag, pfad) => [
          teilEingabe(
            k,
            b,
            reg,
            eintrag,
            "beschriftung",
            "Beschriftung",
            `${pfad}.beschriftung`,
            { maxlength: 60, hilfe: "Zum Beispiel: Cevi Schweiz." },
          ),
          teilEingabe(k, b, reg, eintrag, "ziel", "Ziel", `${pfad}.ziel`, {
            maxlength: 2000,
            spellcheck: "false",
            autocapitalize: "off",
            hilfe: LINK_HILFE,
          }),
        ],
      }),
    ],
  },
  laden: {
    name: "Lädeli",
    kurz: () => "Artikel der Abteilung mit Warenkorb und Bestellung",
    pruefe: () => [],
    form: () => [
      el(
        "p",
        { class: "hilfe" },
        "Zeigt alle Artikel des Lädelis mit Bild, Preis und Varianten. Angemeldete Personen legen Artikel in den Warenkorb und bestellen; ohne Anmeldung ist es eine Preisliste. Die Artikel pflegst du unter ",
        el("a", { href: "#laedeli/artikel" }, "Lädeli, Artikel"),
        ".",
      ),
    ],
  },
  fotoalben: {
    name: "Fotoalben",
    kurz: () => "Die Fotoalben der Abteilung aus Flickr, nur angemeldet",
    pruefe: () => [],
    form: () => [
      el(
        "p",
        { class: "hilfe" },
        "Zeigt die Alben, die du freigegeben hast, mit einer Grossansicht der Bilder. Die Seite ist für alle sichtbar, die Fotos sehen aber nur angemeldete Personen; alle anderen lesen «Nur angemeldet sichtbar» mit einem Link zur Anmeldung. Welche Alben erscheinen und in welcher Reihenfolge, stellst du unter ",
        el("a", { href: "#website/fotos" }, "Website, Fotos"),
        " ein.",
      ),
    ],
  },
  stufenfakten: {
    name: "Samstagsangaben der Stufen",
    kurz: () => "Datum, Treffpunkt und Mitnehmen der Stufe",
    pruefe: () => [],
    form: () => [
      el(
        "p",
        { class: "hilfe" },
        "Zeigt Datum, Treffpunkt, Schluss und Mitnehmen der nächsten Aktivität der Stufe. Die Werte pflegst du unter ",
        el(
          "a",
          { href: "#website/stufenfakten" },
          "Samstagsangaben der Stufen",
        ),
        ".",
      ),
    ],
  },
};

// Die Gruppen des Katalogs in der Reihenfolge, in der der Dialog «Baustein hinzufügen» sie zeigt
export const GRUPPEN = [
  "Text",
  "Bilder und Medien",
  "Karten und Listen",
  "Handlung",
  "Personen",
  "Dynamisch",
  "Gestaltung",
];

// Beispiele für die Vorschau im Katalog: feste IDs, die der Server durch Platzhalterbilder und Platzhalternamen ersetzt (nie echte Medien, Personen oder Namen)
const bspId = (nr) => `00000000-0000-4000-8000-${String(nr).padStart(12, "0")}`;
const bspBild = (nr, unterschrift) => ({
  mediumId: bspId(nr),
  ...(unterschrift && { unterschrift }),
});
const bspAbsatz = (...abschnitte) => ({ typ: "absatz", inhalt: abschnitte });
const bspKarten = (darstellung, eintraege) => ({ darstellung, eintraege });

// Was «Baustein hinzufügen» anbietet (Reihenfolge und Texte wie im Design E3).
// gruppe: Überschrift im Dialog (GRUPPEN). beispiel: Beispieldaten des Bausteins (das Feld «daten»), die der Server mit dem Renderer der Website zeigt; Platzhaltertexte, Bilder nur als Beispiel-ID. Jeder neue Eintrag braucht beides
export const KATALOG = [
  {
    typ: "ueberschrift",
    gruppe: "Text",
    beschreibung: "Ein Titel, um die Seite zu gliedern.",
    neu: () => ({ ebene: 2, text: "" }),
    beispiel: () => ({ ebene: 2, text: "Das machen wir im Cevi" }),
  },
  {
    typ: "text",
    gruppe: "Text",
    beschreibung: "Absätze mit Fett, Kursiv, Listen und Links.",
    neu: () => ({ inhalt: [] }),
    beispiel: () => ({
      inhalt: [
        bspAbsatz(
          { text: "Wir treffen uns jeden Samstag. " },
          { text: "Alle sind willkommen", fett: true },
          { text: ", auch wenn sie noch niemanden kennen." },
        ),
        {
          typ: "liste",
          geordnet: false,
          eintraege: [
            [{ text: "Spielen und Basteln" }],
            [{ text: "Draussen unterwegs sein" }],
          ],
        },
      ],
    }),
  },
  {
    typ: "bild",
    gruppe: "Bilder und Medien",
    beschreibung: "Ein Bild mit Alt-Text und Bildunterschrift.",
    neu: () => ({}),
    beispiel: () => bspBild(1, "Bildunterschrift zum Beispielbild"),
  },
  {
    typ: "galerie",
    gruppe: "Bilder und Medien",
    beschreibung: "Mehrere Bilder, je mit Alt-Text.",
    neu: () => ({ bilder: [{}] }),
    beispiel: () => ({ bilder: [2, 3, 4, 5].map((nr) => bspBild(nr)) }),
  },
  {
    typ: "karussell",
    gruppe: "Bilder und Medien",
    beschreibung: "3 bis 8 Bilder, die sich langsam abwechseln.",
    neu: () => ({ bilder: [{}, {}, {}] }),
    beispiel: () => ({ bilder: [6, 7, 8].map((nr) => bspBild(nr)) }),
  },
  ...[
    [
      "karten",
      "Kästchen mit Titel, Text und Link «Mehr zu …».",
      () =>
        bspKarten(
          "karten",
          ["Erster", "Zweiter", "Dritter"].map((t) => ({
            titel: `${t} Beispieltitel`,
            text: "Ein kurzer Text zur Karte.",
            link: "/",
          })),
        ),
    ],
    [
      "liste",
      "Zeilen mit Titel und Text, der Titel als Link.",
      () =>
        bspKarten(
          "liste",
          ["Erste", "Zweite", "Dritte"].map((t) => ({
            titel: `${t} Zeile`,
            text: "Ein kurzer Text zur Zeile.",
            link: "/",
          })),
        ),
    ],
    [
      "stufen",
      "Karten mit Foto, Etikett im Bild und Link, zum Beispiel für Stufen.",
      () =>
        bspKarten(
          "stufen",
          [9, 10, 11].map((nr, i) => ({
            titel: `Beispielstufe ${i + 1}`,
            text: "Ein kurzer Text zur Stufe.",
            alter: `${i + 2}. Klasse`,
            bild: bspId(nr),
            link: "/",
          })),
        ),
    ],
    [
      "merkmale",
      "Stichworte mit kurzem Text im blauen Band, auf Wunsch mit Foto.",
      () =>
        bspKarten(
          "merkmale",
          ["Gemeinschaft", "Abenteuer", "Glaube"].map((t) => ({
            titel: t,
            text: "Ein kurzer Satz dazu, was das für uns heisst.",
          })),
        ),
    ],
    [
      "zeitstrahl",
      "Stationen einer Geschichte mit Jahr, Text und Foto.",
      () =>
        bspKarten(
          "zeitstrahl",
          [
            ["1890", "Der Anfang"],
            ["1950", "Das erste Lager"],
            ["2020", "Heute"],
          ].map(([jahr, text]) => ({ titel: jahr, text })),
        ),
    ],
    [
      "zahlen",
      "Wenige grosse Zahlen mit kurzer Beschriftung.",
      () =>
        bspKarten("zahlen", [
          { titel: "120", text: "Kinder und Jugendliche" },
          { titel: "30", text: "Leitende" },
          { titel: "50", text: "Jahre Cevi" },
        ]),
    ],
  ].map(([darstellung, beschreibung, beispiel]) => ({
    typ: "karten",
    gruppe: "Karten und Listen",
    name: KARTEN_ARTEN[darstellung],
    beschreibung,
    neu: () => ({ darstellung, eintraege: [{ titel: "" }] }),
    beispiel,
  })),
  {
    typ: "schaltflaeche",
    gruppe: "Handlung",
    beschreibung: "Führt auf eine andere Seite oder Adresse.",
    neu: () => ({ darstellung: "schaltflaeche", beschriftung: "", ziel: "" }),
    beispiel: () => ({
      darstellung: "schaltflaeche",
      beschriftung: "Jetzt anmelden",
      ziel: "/anmelden",
    }),
  },
  {
    typ: "datei",
    gruppe: "Handlung",
    beschreibung:
      "Zum Beispiel ein PDF im SharePoint, mit Name, Grösse und Typ.",
    neu: () => ({ titel: "", link: "" }),
    beispiel: () => ({
      titel: "Beispieldatei zum Herunterladen",
      link: "https://beispiel.sharepoint.com/datei.pdf",
      typ: "PDF",
      groesse: 240000,
    }),
  },
  {
    typ: "personen",
    gruppe: "Personen",
    beschreibung: "Ansprechpersonen mit Foto, Name, Funktion und E-Mail.",
    neu: () => ({ eintraege: [{}] }),
    beispiel: () => ({
      eintraege: [12, 13, 14].map((nr) => ({
        personId: bspId(nr),
        funktion: "Leitung",
        email: "leitung@beispiel.example",
      })),
    }),
  },
  {
    typ: "artikel",
    gruppe: "Karten und Listen",
    beschreibung: "Karten mit Bild, Name und Preis.",
    neu: () => ({ eintraege: [{}] }),
    beispiel: () => ({
      eintraege: [15, 16, 17].map((nr, i) => ({
        name: `Beispielartikel ${i + 1}`,
        preis: `${(i + 2) * 10}.–`,
        mediumId: bspId(nr),
      })),
    }),
  },
  {
    typ: "kontaktperson",
    gruppe: "Personen",
    beschreibung: "Eine Person mit Cevi-Name und Funktion.",
    neu: () => ({ zusatz: [] }),
    beispiel: () => ({ personId: bspId(18), zusatz: [] }),
  },
  {
    typ: "leitungsteam",
    gruppe: "Personen",
    beschreibung: "Die Leitenden einer Gruppe.",
    neu: () => ({ zusatz: [] }),
    beispiel: () => ({ tagId: bspId(19), zusatz: [] }),
  },
  {
    typ: "terminliste",
    gruppe: "Dynamisch",
    beschreibung: "Die nächsten 3 bis 10 Termine, auch nur einer Gruppe.",
    neu: () => ({ anzahl: 5 }),
    beispiel: () => ({ anzahl: 3 }),
  },
  {
    typ: "trenner",
    gruppe: "Gestaltung",
    beschreibung: "Mehr Luft oder eine Linie zwischen Bausteinen.",
    neu: () => ({ art: "abstand" }),
    beispiel: () => ({ art: "linie" }),
  },
  {
    typ: "videolink",
    gruppe: "Bilder und Medien",
    beschreibung: "Nur als Link, ohne Einbetten.",
    neu: () => ({ art: "video", beschriftung: "", url: "" }),
    beispiel: () => ({
      art: "video",
      beschriftung: "Beispielvideo ansehen",
      url: "https://www.beispiel.example/video",
    }),
  },
  {
    typ: "stufenfakten",
    gruppe: "Dynamisch",
    beschreibung: "Datum, Treffpunkt und Mitnehmen der Stufe.",
    neu: () => ({}),
    beispiel: () => ({}),
  },
  {
    typ: "laden",
    gruppe: "Dynamisch",
    beschreibung: "Das Lädeli: Artikel, Warenkorb und Bestellung.",
    neu: () => ({}),
    beispiel: () => ({}),
  },
  {
    typ: "fotoalben",
    gruppe: "Dynamisch",
    beschreibung: "Fotoalben aus Flickr, nur für angemeldete Personen.",
    neu: () => ({}),
    beispiel: () => ({}),
  },
  {
    typ: "hinweis",
    gruppe: "Gestaltung",
    beschreibung: "Ein Satz mit Symbol, zum Beispiel «Anmeldung offen».",
    neu: () => ({ text: "" }),
    beispiel: () => ({
      text: "Anmeldung offen bis zum Beispieldatum",
      link: { beschriftung: "Zur Anmeldung", ziel: "/anmelden" },
    }),
  },
  {
    typ: "eckdaten",
    gruppe: "Karten und Listen",
    beschreibung: "Datum, Ort, Kosten und mehr auf einen Blick.",
    neu: () => ({ eintraege: [{ bezeichnung: "", wert: "" }] }),
    beispiel: () => ({
      eintraege: [
        { bezeichnung: "Datum", wert: "Beispieldatum" },
        { bezeichnung: "Ort", wert: "Beispielort" },
        { bezeichnung: "Kosten", wert: "CHF 00.–" },
      ],
    }),
  },
  {
    typ: "aufruf",
    gruppe: "Handlung",
    beschreibung: "Ein farbiges Band mit Titel, Text und Schaltfläche.",
    neu: () => ({ titel: "", beschriftung: "", ziel: "" }),
    beispiel: () => ({
      titel: "Komm vorbei!",
      text: "Schnuppern ist jederzeit möglich.",
      beschriftung: "Mehr erfahren",
      ziel: "/",
    }),
  },
  {
    typ: "kontaktkarte",
    gruppe: "Personen",
    beschreibung:
      "«Fragen? Melde dich bei uns.» mit Knöpfen für E-Mail und Telefon, Anschrift und Verweisen.",
    neu: () => ({}),
    beispiel: () => ({ titel: "Fragen? Melde dich bei uns." }),
  },
].map((e) => ({ name: TYPEN[e.typ].name, ...e }));

// Ein Karten-Baustein heisst nach seiner Darstellung («Zeitstrahl»): So findet man ihn in der Liste der Seite wieder
export const typName = (b) =>
  (b.typ === "karten" && KARTEN_ARTEN[b.daten?.darstellung]) ||
  (TYPEN[b.typ]?.name ?? b.typ);

// Alle Bilder, auf die ein Dokument verweist (für den Abruf ihrer Angaben und Alt-Texte)
export const medienIds = (dok) => [
  ...new Set(
    dok.bausteine
      .flatMap((b) => [
        b.daten.mediumId,
        b.daten.bild,
        ...(b.daten.bilder ?? []).map((x) => x.mediumId),
        ...(b.daten.eintraege ?? []).flatMap((x) => [x.bild, x.mediumId]),
      ])
      .filter(Boolean),
  ),
];
export const kurzText = (k, b) => {
  try {
    return TYPEN[b.typ]?.kurz(b.daten, k) ?? "";
  } catch {
    return "";
  }
};

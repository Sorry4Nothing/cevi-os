import { anfrage } from "./api.js";
import {
  aktionenZelle,
  dialogFormular,
  el,
  feld,
  knopf,
  tabelle,
} from "./dom.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";
import { leerKarte } from "./zustaende.js";
import {
  datumKurz,
  feldFehler,
  meldung,
  nichtGefunden,
} from "./lager-gemeinsam.js";

// Bereich «Lager», Unterseite «Vorlagen» (#527, Board A24): Vorlagen der Abteilung nach Art (Reiter Aufgaben und Packlisten), anlegen, umbenennen, löschen. Eine Abfrage je Reiter (höchstens 100 Vorlagen, kein Seitenwechsel nötig). Adressen: #lager/vorlagen und #lager/vorlagen/packlisten. Anwenden geschieht im Lager.

const BASIS = "/api/v1/admin/vorlagen";
const ARTEN = {
  aufgaben: {
    adresse: "#lager/vorlagen",
    name: "Aufgaben",
    eintrag: ["Aufgabe", "Aufgaben"],
    max: 200,
  },
  packliste: {
    adresse: "#lager/vorlagen/packlisten",
    name: "Packlisten",
    eintrag: ["Punkt", "Punkte"],
    max: 500,
  },
};

export function zeige(bereich, ctx) {
  const [reiter, weiter] = ctx.pfad;
  const art =
    reiter === undefined
      ? "aufgaben"
      : reiter === "packlisten"
        ? "packliste"
        : null;
  if (art === null || weiter !== undefined)
    return ctx.lade(nichtGefunden, () => {});
  ctx.kopfAktion();
  const tabs = el(
    "nav",
    { class: "tabs", "aria-label": "Reiter" },
    Object.entries(ARTEN).map(([schluessel, a]) =>
      el(
        "a",
        {
          class: "tab",
          href: a.adresse,
          "aria-current": schluessel === art ? "page" : undefined,
        },
        a.name,
      ),
    ),
  );
  bereich.append(tabs);
  const inhalt = el("div", { class: "lg-vorlagen" });
  bereich.append(inhalt);
  // Der Lader gehört dem Inhalt, damit die Reiter beim Laden stehen bleiben
  const lade = ctx.erstelleLader(inhalt);
  lade(
    () => anfrage("GET", `${BASIS}?art=${art}`),
    (daten, neu) => zeichne(inhalt, ctx, art, daten.vorlagen, neu),
  );
}

// Zeilen: «Name» je Zeile; Aufgaben: eine Aufgabe je Zeile; Packliste: «Abschnitt: Text», ohne Doppelpunkt gilt der Abschnitt «Allgemein»
function lies(art, text) {
  const zeilen = text
    .split(/\r?\n/)
    .map((z) => z.trim())
    .filter(Boolean);
  const { max, eintrag } = ARTEN[art];
  if (zeilen.length === 0)
    return { fehler: "Gib mindestens einen Eintrag ein." };
  if (zeilen.length > max)
    return {
      fehler: `Höchstens ${max} ${eintrag[1]}. Du hast ${zeilen.length}.`,
    };
  if (art === "aufgaben") {
    const lang = zeilen.find((z) => z.length > 200);
    if (lang)
      return {
        fehler: `Eine Aufgabe ist länger als 200 Zeichen: «${lang.slice(0, 40)} …»`,
      };
    return { inhalt: { aufgaben: zeilen.map((titel) => ({ titel })) } };
  }
  const punkte = [];
  for (const z of zeilen) {
    const i = z.indexOf(":");
    const abschnitt = i > 0 ? z.slice(0, i).trim() : "Allgemein";
    const punkt = i > 0 ? z.slice(i + 1).trim() : z;
    if (punkt === "")
      return { fehler: `Die Zeile «${z.slice(0, 40)}» hat keinen Text.` };
    if (abschnitt.length > 100 || punkt.length > 300)
      return {
        fehler: `Die Zeile «${z.slice(0, 40)} …» ist zu lang (Abschnitt höchstens 100, Text höchstens 300 Zeichen).`,
      };
    punkte.push({ abschnitt, text: punkt });
  }
  return { inhalt: { punkte } };
}

function anlegen(art, ctx, neu) {
  const name = feld({
    label: "Name",
    hilfe: "Höchstens 100 Zeichen. Jeder Name gilt je Art nur einmal.",
    maxlength: 100,
    autocomplete: "off",
  });
  const eintraege = feld({
    label: art === "aufgaben" ? "Aufgaben" : "Punkte der Packliste",
    hilfe:
      art === "aufgaben"
        ? "Eine Aufgabe pro Zeile, höchstens 200."
        : "Ein Punkt pro Zeile, in der Form «Abschnitt: Text», höchstens 500. Ohne Doppelpunkt kommt der Punkt in den Abschnitt «Allgemein».",
    mehrzeilig: true,
    rows: 8,
  });
  let inhalt;
  dialogFormular({
    titel: `${art === "aufgaben" ? "Aufgaben-Vorlage" : "Packlisten-Vorlage"} anlegen`,
    felder: [name.wurzel, eintraege.wurzel],
    ok: "Vorlage anlegen",
    pruefe: () => {
      feldFehler(name, "");
      feldFehler(eintraege, "");
      let erstes = true;
      if (name.eingabe.value.trim() === "") {
        feldFehler(name, "Gib der Vorlage einen Namen.", { fokus: erstes });
        erstes = false;
      }
      const r = lies(art, eintraege.eingabe.value);
      if (r.fehler) feldFehler(eintraege, r.fehler, { fokus: erstes });
      inhalt = r.inhalt;
      return !erstes || Boolean(r.fehler);
    },
    senden: () =>
      anfrage("POST", BASIS, { art, name: name.eingabe.value.trim(), inhalt }),
    fehlertext: meldung,
    danach: () => {
      neu();
      ctx.melde(`Vorlage «${name.eingabe.value.trim()}» ist angelegt.`);
    },
  });
}

function umbenennen(v, ctx, neu) {
  const name = feld({
    label: "Name",
    wert: v.name,
    maxlength: 100,
    autocomplete: "off",
  });
  dialogFormular({
    titel: `Vorlage «${v.name}» umbenennen`,
    felder: [name.wurzel],
    ok: "Speichern",
    pruefe: () => {
      feldFehler(name, "");
      if (name.eingabe.value.trim() !== "") return false;
      feldFehler(name, "Gib der Vorlage einen Namen.");
      return true;
    },
    senden: () =>
      anfrage("PATCH", `${BASIS}/${v.id}`, { name: name.eingabe.value.trim() }),
    fehlertext: meldung,
    danach: () => {
      neu();
      ctx.melde("Die Vorlage ist umbenannt.");
    },
  });
}

// Mit «Rückgängig» (#578): Lager, die die Vorlage schon übernommen haben, behalten ihre Aufgaben oder Punkte
function loeschen(v, ctx, neu, ereignis) {
  ctx.mitRueckgaengig({
    text: `Vorlage «${v.name}» gelöscht`,
    ansicht: ansichtVonKnopf(ereignis),
    ausfuehren: () => anfrage("DELETE", `${BASIS}/${v.id}`),
    fehlertext: (f) => `Die Vorlage wurde nicht gelöscht. ${meldung(f)}`,
    danach: neu,
  });
}

function zeichne(inhalt, ctx, art, vorlagen, neu) {
  ctx.kopfAktion(
    knopf("Vorlage anlegen", {
      art: "haupt",
      symbol: "plus",
      onclick: () => anlegen(art, ctx, neu),
    }),
  );
  if (vorlagen.length === 0) {
    inhalt.append(
      leerKarte("Es gibt noch keine Vorlage. Lege eine an.", [
        knopf("Vorlage anlegen", {
          symbol: "plus",
          onclick: () => anlegen(art, ctx, neu),
        }),
      ]),
    );
    return;
  }
  const { wurzel } = tabelle({
    beschriftung:
      art === "aufgaben" ? "Aufgaben-Vorlagen" : "Packlisten-Vorlagen",
    spalten: ["Vorlage", "Geändert", ["Einträge", "zahl"], "Aktionen"],
    zeilen: vorlagen.map((v) =>
      el(
        "tr",
        {},
        el("th", { scope: "row" }, el("span", { class: "name" }, v.name)),
        el("td", { class: "lg-zahlen" }, datumKurz(v.geaendertAm)),
        el("td", { class: "zahl lg-zahlen" }, String(v.anzahl)),
        aktionenZelle(
          knopf("Umbenennen", {
            klein: true,
            symbol: "bearbeiten",
            kontext: v.name,
            onclick: () => umbenennen(v, ctx, neu),
          }),
          knopf("Löschen", {
            klein: true,
            art: "gefahr",
            symbol: "papierkorb",
            kontext: v.name,
            onclick: (e) => loeschen(v, ctx, neu, e),
          }),
        ),
      ),
    ),
  });
  wurzel.querySelector("th").setAttribute("aria-sort", "ascending");
  inhalt.append(wurzel);
}

import { anfrage } from "./api.js";
import {
  aktionenZelle,
  el,
  feld,
  icon,
  knopf,
  seitenblatt,
  tabelle,
} from "./dom.js";
import { sortierListe } from "./sortieren.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";
import { leerKarte } from "./zustaende.js";
import {
  beschrifteZellen,
  kartenTabelle,
  datumKurz,
  meldung,
  nichtGefunden,
} from "./lager-gemeinsam.js";
import { skeletonVon } from "./lager-skeleton.js";

// Bereich «Lager», Unterseite «Vorlagen» (#527, Board A24; #592): Vorlagen der Abteilung nach Art (Reiter Aufgaben und Packlisten). Anlegen und Bearbeiten ist eine Seite im Fluss mit einer Liste, die man am Griff ordnet (Maus, Finger, Tastatur, Knöpfe Nach oben und Nach unten), Titel am Ort bearbeitet und Einträge hinzufügt oder entfernt. Eine Abfrage je Reiter (höchstens 100 Vorlagen, kein Seitenwechsel nötig), beim Bearbeiten eine für die Vorlage. Adressen: #lager/vorlagen und #lager/vorlagen/packlisten. Anwenden geschieht im Lager.

const BASIS = "/api/v1/admin/vorlagen";
const ARTEN = {
  aufgaben: {
    adresse: "#lager/vorlagen",
    name: "Aufgaben",
    titel: "Aufgaben-Vorlage",
    eintrag: ["Aufgabe", "Aufgaben"],
    max: 200,
  },
  packliste: {
    adresse: "#lager/vorlagen/packlisten",
    name: "Packlisten",
    titel: "Packlisten-Vorlage",
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
    {
      skeleton: skeletonVon({
        knopf: true,
        inhalt: "tabelle",
        zeilen: 4,
        spalten: 4,
      }),
    },
  );
}

// Eine Zeile Text → ein Eintrag: Aufgabe = Titel; Packliste = «Abschnitt: Text», ohne Doppelpunkt gilt «Allgemein». Leer, wenn die Zeile nichts hergibt
export function zeileZuEintrag(art, zeile) {
  const z = zeile.trim();
  if (z === "") return null;
  if (art === "aufgaben") return { titel: z.slice(0, 200) };
  const i = z.indexOf(":");
  const abschnitt = i > 0 ? z.slice(0, i).trim() : "Allgemein";
  const text = (i > 0 ? z.slice(i + 1) : z).trim();
  return text === ""
    ? null
    : { abschnitt: abschnitt.slice(0, 100), text: text.slice(0, 300) };
}

let nummer = 0;

// Die Seite zum Anlegen und Bearbeiten. start: { id?, name, eintraege: [{…}] }
function editor(art, ctx, neu, start) {
  const a = ARTEN[art];
  const bearbeitet = Boolean(start.id);
  const name = feld({
    label: "Name",
    wert: start.name,
    hilfe: "Höchstens 100 Zeichen. Jeder Name gilt je Art nur einmal.",
    maxlength: 100,
    autocomplete: "off",
  });
  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
    tabindex: "-1",
  });
  const rueck = el("p", { class: "klein", role: "status" });
  // Alle Zeilen: id -> { daten (mit allem, was die Vorlage sonst noch trägt), inhalt (Knoten), eingaben }
  const zeilen = new Map();
  let liste;
  const text = (e) =>
    art === "aufgaben"
      ? e.daten.titel
      : `${e.daten.abschnitt}: ${e.daten.text}`;
  const eintragFuer = (id) => ({
    id,
    text: text(zeilen.get(id)).slice(0, 60) || `${a.eintrag[0]} ohne Text`,
    inhalt: zeilen.get(id).inhalt,
  });

  function baueZeile(daten) {
    const id = `z${++nummer}`;
    const e = { daten: { ...daten }, eingaben: {} };
    const eingabe = (schluessel, label, max, klasse) => {
      const inp = el("input", {
        class: `eingabe ${klasse ?? ""}`.trim(),
        type: "text",
        maxlength: max,
        autocomplete: "off",
        "aria-label": label,
        placeholder: label,
        oninput: () => {
          e.daten[schluessel] = inp.value;
          inp.removeAttribute("aria-invalid");
        },
      });
      inp.value = e.daten[schluessel] ?? "";
      e.eingaben[schluessel] = inp;
      return inp;
    };
    const weg = el(
      "button",
      {
        type: "button",
        class: "knopf knopf--rund",
        "aria-label": `Entfernen: ${a.eintrag[0]}`,
        onclick: () => entferne(id),
      },
      icon("papierkorb"),
    );
    e.inhalt = el(
      "div",
      { class: `lg-vzeile${art === "packliste" ? " lg-vzeile--zwei" : ""}` },
      art === "aufgaben"
        ? eingabe("titel", "Aufgabe", 200)
        : [
            eingabe("abschnitt", "Abschnitt", 100, "lg-vabschnitt"),
            eingabe("text", "Punkt", 300),
          ],
      weg,
    );
    zeilen.set(id, e);
    return id;
  }

  const ids0 = start.eintraege.map(baueZeile);
  liste = sortierListe({
    beschriftung: `${a.name} der Vorlage`,
    eintraege: ids0.map(eintragFuer),
    // Das Speichern geschieht erst mit «Speichern»; hier hält nur der Zustand die Reihenfolge fest
    beiNeu: () => {},
  });

  // Zuletzt entfernt: Die Zeile lässt sich an ihre Stelle zurückholen
  let zuletzt = null;
  const zeigeRueck = () => {
    rueck.replaceChildren();
    if (!zuletzt) return;
    rueck.append(
      `Eintrag entfernt. `,
      el(
        "button",
        {
          type: "button",
          class: "lg-textknopf",
          onclick: () => {
            const reihe = liste.ids();
            reihe.splice(zuletzt.index, 0, zuletzt.id);
            zeilen.set(zuletzt.id, zuletzt.e);
            liste.setze(reihe.map(eintragFuer));
            zuletzt = null;
            zeigeRueck();
            neuEingabe.focus();
          },
        },
        "Rückgängig",
      ),
    );
  };
  function entferne(id) {
    const reihe = liste.ids();
    const index = reihe.indexOf(id);
    zuletzt = { id, index, e: zeilen.get(id) };
    zeilen.delete(id);
    liste.setze(reihe.filter((x) => x !== id).map(eintragFuer));
    zeigeRueck();
    (
      liste.wurzel.querySelectorAll(".sortier-eintrag input")[
        Math.min(index, zeilen.size - 1)
      ] ?? neuEingabe
    ).focus();
    liste.wurzel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const neuEingabe = el("input", {
    class: "eingabe",
    type: "text",
    id: `lg-neu-${++nummer}`,
    autocomplete: "off",
    placeholder:
      art === "aufgaben"
        ? "Neue Aufgabe"
        : "Neuer Punkt, z. B. «Schlafen: Schlafsack»",
  });
  const fuege = (roh = neuEingabe.value) => {
    const zeilenText = roh.split(/\r?\n/);
    const neue = zeilenText.map((z) => zeileZuEintrag(art, z)).filter(Boolean);
    if (neue.length === 0) return;
    if (zeilen.size + neue.length > a.max) {
      fehler.textContent = `Höchstens ${a.max} ${a.eintrag[1]}. Du hast ${zeilen.size + neue.length}.`;
      fehler.hidden = false;
      return;
    }
    fehler.hidden = true;
    const reihe = liste.ids();
    for (const d of neue) reihe.push(baueZeile(d));
    liste.setze(reihe.map(eintragFuer));
    neuEingabe.value = "";
    zuletzt = null;
    zeigeRueck();
    rueck.append(
      neue.length === 1
        ? "Eintrag hinzugefügt."
        : `${neue.length} Einträge hinzugefügt.`,
    );
    neuEingabe.focus();
    liste.wurzel.dispatchEvent(new Event("change", { bubbles: true }));
  };
  neuEingabe.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      fuege();
    }
  });
  // Mehrere Zeilen aus einer Liste einfügen: Jede Zeile wird ein Eintrag
  neuEingabe.addEventListener("paste", (e) => {
    const t = e.clipboardData?.getData("text") ?? "";
    if (!/\r?\n/.test(t.trim())) return;
    e.preventDefault();
    fuege(t);
  });

  const body = () => {
    const reihe = liste.ids().map((id) => zeilen.get(id));
    return art === "aufgaben"
      ? {
          aufgaben: reihe.map((e) => ({
            ...e.daten,
            titel: e.daten.titel.trim(),
          })),
        }
      : {
          punkte: reihe.map((e) => ({
            ...e.daten,
            abschnitt: e.daten.abschnitt.trim(),
            text: e.daten.text.trim(),
          })),
        };
  };
  const pruefe = () => {
    fehler.hidden = true;
    let erstes = null;
    const merke = (inp) => {
      inp.setAttribute("aria-invalid", "true");
      erstes ??= inp;
    };
    for (const e of zeilen.values())
      for (const [k, inp] of Object.entries(e.eingaben))
        if ((e.daten[k] ?? "").trim() === "") merke(inp);
    const grund =
      name.eingabe.value.trim() === ""
        ? "Gib der Vorlage einen Namen."
        : zeilen.size === 0
          ? `Füge mindestens ${a.eintrag[0] === "Aufgabe" ? "eine Aufgabe" : "einen Punkt"} hinzu.`
          : erstes
            ? "Fülle alle markierten Felder aus oder entferne die Zeilen."
            : "";
    if (grund) {
      fehler.textContent = grund;
      fehler.hidden = false;
      (name.eingabe.value.trim() === ""
        ? name.eingabe
        : (erstes ?? neuEingabe)
      ).focus();
    }
    return grund !== "";
  };

  const speichern = knopf(bearbeitet ? "Speichern" : "Vorlage anlegen", {
    art: "haupt",
    symbol: "haken",
  });
  const abbrechen = knopf("Abbrechen");
  speichern.addEventListener("click", async () => {
    if (pruefe()) return;
    speichern.disabled = abbrechen.disabled = true;
    speichern.setAttribute("aria-busy", "true");
    try {
      const wert = name.eingabe.value.trim();
      if (bearbeitet)
        await anfrage("PATCH", `${BASIS}/${start.id}`, {
          name: wert,
          inhalt: body(),
        });
      else await anfrage("POST", BASIS, { art, name: wert, inhalt: body() });
      blatt.close();
      neu();
      ctx.melde(
        bearbeitet
          ? `Vorlage «${wert}» ist gespeichert.`
          : `Vorlage «${wert}» ist angelegt.`,
      );
    } catch (f) {
      fehler.textContent = meldung(f);
      fehler.hidden = false;
      fehler.focus();
    } finally {
      speichern.disabled = abbrechen.disabled = false;
      speichern.removeAttribute("aria-busy");
    }
  });
  abbrechen.addEventListener("click", () => blatt.versuchSchliessen());

  const blatt = seitenblatt({
    titel: bearbeitet ? `${a.titel} bearbeiten` : `${a.titel} anlegen`,
    untertitel:
      art === "aufgaben"
        ? "Ordne die Aufgaben am Griff oder mit den Pfeilknöpfen. Weitere Angaben einer Aufgabe, etwa die Frist, bleiben erhalten."
        : "Ordne die Punkte am Griff oder mit den Pfeilknöpfen. Der Abschnitt gruppiert die Packliste im Lager.",
    inhalt: [
      el(
        "div",
        { class: "lg-editor" },
        fehler,
        name.wurzel,
        el(
          "div",
          { class: "feld" },
          el(
            "label",
            { for: neuEingabe.id },
            art === "aufgaben" ? "Aufgaben" : "Punkte der Packliste",
          ),
          liste.wurzel,
          rueck,
          el(
            "div",
            { class: "lg-vneu" },
            neuEingabe,
            knopf("Hinzufügen", { symbol: "plus", onclick: () => fuege() }),
          ),
          el(
            "p",
            { class: "hilfe" },
            `Eine Zeile je ${a.eintrag[0]}, höchstens ${a.max}. Füge eine Liste mit mehreren Zeilen ein, wird jede Zeile ein Eintrag.${art === "packliste" ? " Ohne Doppelpunkt kommt der Punkt in den Abschnitt «Allgemein»." : ""}`,
          ),
        ),
      ),
    ],
    fusszeile: [abbrechen, speichern],
  });
  return blatt;
}

async function oeffneEditor(art, ctx, neu, v) {
  if (!v) {
    editor(art, ctx, neu, { name: "", eintraege: [] });
    return;
  }
  let voll;
  try {
    voll = await anfrage("GET", `${BASIS}/${v.id}`);
  } catch (f) {
    ctx.melde(meldung(f), "fehler");
    return;
  }
  editor(art, ctx, neu, {
    id: v.id,
    name: voll.name,
    eintraege: voll.inhalt?.[art === "aufgaben" ? "aufgaben" : "punkte"] ?? [],
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
      onclick: () => oeffneEditor(art, ctx, neu, null),
    }),
  );
  if (vorlagen.length === 0) {
    inhalt.append(
      leerKarte(
        art === "aufgaben"
          ? "Es gibt noch keine Aufgaben-Vorlage. Lege eine an, um Lager schneller zu füllen."
          : "Es gibt noch keine Packlisten-Vorlage. Lege eine an, um Lager schneller zu füllen.",
      ),
    );
    return;
  }
  const { wurzel, koerper } = tabelle({
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
          knopf("Bearbeiten", {
            klein: true,
            symbol: "bearbeiten",
            kontext: v.name,
            onclick: () => oeffneEditor(art, ctx, neu, v),
          }),
          knopf("Löschen", {
            klein: true,
            art: "still",
            symbol: "papierkorb",
            kontext: v.name,
            onclick: (e) => loeschen(v, ctx, neu, e),
          }),
        ),
      ),
    ),
  });
  kartenTabelle(wurzel);
  beschrifteZellen(koerper, ["", "Geändert", "Einträge", ""]);
  wurzel.querySelector("th").setAttribute("aria-sort", "ascending");
  inhalt.append(wurzel);
}

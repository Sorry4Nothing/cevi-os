import { anfrage, fehlertext } from "./api.js";
import {
  aktionenZelle,
  auswahl,
  avatar,
  bestaetigen,
  chip,
  dialogFormular,
  el,
  feld,
  knopf,
  tabelle,
} from "./dom.js";
import {
  aktionenKopfVerstecken,
  entferneFehler,
  feldFehler,
  macheSortierbar,
  mitFehlertitel,
  pruefHinweis,
  rundKnopf,
  seitenleiste,
  sortiere,
} from "./liste-hilfen.js";
import { leerKarte } from "./zustaende.js";

// Gruppe (= Tag der Abteilung): Dialoge zum Anlegen, Umbenennen, Löschen und für die Mitglieder, dazu die Detailseite A5 (#personen/gruppen/<id>)
export const TYPEN = [
  ["stufe", "Stufe"],
  ["funktion", "Funktion"],
  ["team", "Team"],
  ["lager", "Lager"],
];
export const typName = (typ) => TYPEN.find(([w]) => w === typ)?.[1] ?? typ;
export const mitglieder = (n) => (n === 1 ? "1 Mitglied" : `${n} Mitglieder`);
const anzahlText = (n, eins, viele) => (n === 1 ? eins : `${n} ${viele}`);

// Sperrt ein Formular während des Speicherns (A4 «Speichert»): Felder nur lesbar, Knopf mit Ladekreis
export function sperre(dialog, an) {
  for (const e of dialog.querySelectorAll(".formular input")) e.readOnly = an;
  for (const e of dialog.querySelectorAll(".formular .auswahl-knopf")) {
    e.disabled = an;
  }
  dialog
    .querySelector('.formular button[type="submit"]')
    ?.setAttribute("aria-busy", String(an));
}

// Auswahlfeld mit sichtbarem Bedienelement für Fehler und Fokus
const mitFokus = (a) => ({
  ...a,
  fokus: a.wurzel.querySelector(".auswahl-knopf"),
});

// Neue Gruppe (A4) oder Umbenennen; danach(ergebnis) läuft nach dem Schliessen
export function tagDialog({ tag, ctx, neu, danach }) {
  const typ = tag
    ? null
    : mitFokus(
        auswahl({
          label: "Typ",
          optionen: [["", "Bitte wählen"], ...TYPEN],
          wert: "",
        }),
      );
  const name = feld({
    label: "Name",
    wert: tag?.name ?? "",
    maxlength: 100,
    "aria-required": "true",
  });
  const kuerzel = feld({
    label: "Kürzel (optional)",
    hilfe: "Höchstens 20 Zeichen.",
    wert: tag?.kuerzel ?? "",
    maxlength: 20,
  });
  const zusammenfassung = el("div", { class: "pe-zusammenfassung" });
  const nichtGespeichert = tag
    ? "Die Änderung wurde nicht gespeichert."
    : "Die Gruppe wurde nicht erstellt.";
  const dialog = dialogFormular({
    titel: tag ? "Gruppe umbenennen" : "Neue Gruppe",
    beschreibung: tag
      ? `${tag.name} · ${typName(tag.typ)}. Der Typ lässt sich nicht ändern.`
      : "Der Typ lässt sich später nicht mehr ändern.",
    felder: [zusammenfassung, name.wurzel, typ?.wurzel, kuerzel.wurzel].filter(
      Boolean,
    ),
    ok: tag ? "Speichern" : "Erstellen",
    pruefe: () => {
      zusammenfassung.replaceChildren();
      const fehler = [];
      entferneFehler(name);
      if (typ) entferneFehler(typ);
      if (!name.eingabe.value.trim()) {
        feldFehler(name, "Gib einen Namen ein.");
        fehler.push({ name: "Name", ...name });
      }
      if (typ && !typ.eingabe.value) {
        feldFehler(typ, "Wähle einen Typ.");
        fehler.push({ name: "Typ", ...typ });
      }
      if (fehler.length === 0) return false;
      const hinweis = pruefHinweis(fehler);
      zusammenfassung.append(hinweis);
      hinweis.focus();
      return true;
    },
    senden: async () => {
      sperre(dialog, true);
      try {
        const neuerName = name.eingabe.value.trim();
        const neuesKuerzel = kuerzel.eingabe.value.trim();
        if (!tag) {
          return await anfrage("POST", "/api/v1/admin/tags", {
            typ: typ.eingabe.value,
            name: neuerName,
            ...(neuesKuerzel && { kuerzel: neuesKuerzel }),
          });
        }
        // Ein Kürzel lässt sich ändern, aber nicht leeren: Die API verlangt mindestens ein Zeichen
        return await anfrage("PATCH", `/api/v1/admin/tags/${tag.id}`, {
          ...(neuerName !== tag.name && { name: neuerName }),
          ...(neuesKuerzel && neuesKuerzel !== tag.kuerzel
            ? { kuerzel: neuesKuerzel }
            : {}),
        });
      } finally {
        sperre(dialog, false);
      }
    },
    fehlertext: (f) => {
      if (f.code === "TAGNAME_VERGEBEN") {
        feldFehler(
          name,
          `Eine Gruppe «${name.eingabe.value.trim()}» gibt es schon. Wähle einen anderen Namen.`,
        );
        return `${nichtGespeichert} Der Name ist schon vergeben.`;
      }
      return `${nichtGespeichert} ${fehlertext(f)} Deine Eingaben sind noch da, versuche es nochmals.`;
    },
    danach: (ergebnis) => {
      neu();
      ctx.melde(
        tag
          ? "Gespeichert."
          : `Gruppe «${name.eingabe.value.trim()}» ist erstellt.`,
      );
      danach?.(ergebnis);
    },
  });
  dialog.classList.add("pe-dialog");
}

export function tagLoeschen({ tag, anzahl, ctx, neu, danach }) {
  const n = anzahl ?? tag.anzahlPersonen ?? 0;
  const dialog = dialogFormular({
    titel: "Gruppe löschen",
    beschreibung: `«${tag.name}» wird gelöscht. Das lässt sich nicht rückgängig machen.${
      n > 0
        ? ` ${anzahlText(n, "1 Person trägt", "Personen tragen")} sie noch. Entferne zuerst alle Mitglieder.`
        : ""
    }`,
    ok: "Löschen",
    gefaehrlich: true,
    senden: () => anfrage("DELETE", `/api/v1/admin/tags/${tag.id}`),
    fehlertext: (f) => {
      if (f.code !== "TAG_BELEGT") return fehlertext(f);
      const m = f.verwendung?.personen;
      return `${typeof m === "number" ? `${anzahlText(m, "1 Person trägt", "Personen tragen")} die Gruppe` : "Personen tragen die Gruppe"} noch. Entferne zuerst alle Mitglieder und lösche sie danach.`;
    },
    danach: () => {
      neu();
      ctx.melde(`«${tag.name}» ist gelöscht.`);
      danach?.();
    },
  });
  dialog.classList.add("pe-dialog");
}

const rolleFeld = (typ, wert = "") =>
  feld({
    label: "Rolle (optional)",
    hilfe:
      typ === "stufe"
        ? "Freier Text, höchstens 50 Zeichen. Die Rollen «Leitung» und «Stufenleitung» vergibst du bei der Person."
        : "Freier Text, höchstens 50 Zeichen.",
    wert,
    maxlength: 50,
  });

function mitgliedHinzufuegen({ tag, kandidaten, ctx, neu }) {
  const person = mitFokus(
    auswahl({
      label: "Person",
      optionen: [
        ["", "Person wählen"],
        ...kandidaten.map((p) => [p.id, p.name]),
      ],
      wert: "",
    }),
  );
  const rolle = rolleFeld(tag.typ);
  const zusammenfassung = el("div", { class: "pe-zusammenfassung" });
  const dialog = dialogFormular({
    titel: "Mitglied hinzufügen",
    beschreibung: tag.name,
    felder: [zusammenfassung, person.wurzel, rolle.wurzel],
    ok: "Hinzufügen",
    pruefe: () => {
      zusammenfassung.replaceChildren();
      entferneFehler(person);
      if (person.eingabe.value) return false;
      feldFehler(person, "Wähle eine Person.");
      const hinweis = pruefHinweis([{ name: "Person", ...person }]);
      zusammenfassung.append(hinweis);
      hinweis.focus();
      return true;
    },
    senden: async () => {
      sperre(dialog, true);
      try {
        const text = rolle.eingabe.value.trim();
        return await anfrage(
          "PUT",
          `/api/v1/admin/tags/${tag.id}/personen/${person.eingabe.value}`,
          text ? { rolle: text } : {},
        );
      } finally {
        sperre(dialog, false);
      }
    },
    fehlertext: (f) => `Das Mitglied wurde nicht hinzugefügt. ${fehlertext(f)}`,
    danach: () => {
      neu();
      ctx.melde("Mitglied ist hinzugefügt.");
    },
  });
  dialog.classList.add("pe-dialog");
}

function rolleAendern({ tag, eintrag, name, ctx, neu }) {
  const rolle = rolleFeld(tag.typ, eintrag.rolle ?? "");
  dialogFormular({
    titel: "Rolle ändern",
    beschreibung: `${name} · ${tag.name}`,
    felder: [rolle.wurzel],
    ok: "Speichern",
    senden: () =>
      anfrage(
        "PUT",
        `/api/v1/admin/tags/${tag.id}/personen/${eintrag.userId}`,
        { rolle: rolle.eingabe.value.trim() || null },
      ),
    danach: () => {
      neu();
      ctx.melde("Rolle ist gespeichert.");
    },
  });
}

function entfernen({ tag, eintrag, name, ctx, neu }) {
  bestaetigen({
    titel: "Mitglied entfernen",
    beschreibung: `${name} wird aus «${tag.name}» entfernt. Du kannst die Person jederzeit wieder hinzufügen.`,
    ok: "Entfernen",
    gefaehrlich: false,
    aktion: () =>
      anfrage(
        "DELETE",
        `/api/v1/admin/tags/${tag.id}/personen/${eintrag.userId}`,
      ),
    danach: () => {
      neu();
      ctx.melde(`${name} ist aus «${tag.name}» entfernt.`);
    },
  });
}

const zustand = { sort: { schluessel: "name", richtung: "auf" } };

export function zeigeDetail(bereich, ctx, id) {
  zustand.sort = { schluessel: "name", richtung: "auf" };
  ctx.lade(
    mitFehlertitel("Die Mitglieder konnten nicht geladen werden.", async () => {
      const [tag, personen] = await Promise.all([
        anfrage("GET", `/api/v1/admin/tags/${encodeURIComponent(id)}`),
        anfrage("GET", "/api/v1/admin/personen"),
      ]);
      return { tag, personen: personen.personen };
    }),
    (daten, neu) => zeichneDetail(bereich, ctx, daten, neu),
  );
}

function zeichneDetail(bereich, ctx, { tag, personen }, neu) {
  const bekannt = new Map(personen.map((p) => [p.id, p]));
  const vergeben = new Set(tag.personen.map((e) => e.userId));
  const kandidaten = personen.filter(
    (p) => !p.deaktiviert && !vergeben.has(p.id),
  );
  ctx.titel(
    tag.name,
    `${typName(tag.typ)} · ${mitglieder(tag.verwendung.personen)}`,
  );
  // Nach Entfernen oder Ändern ist der Knopf, der den Dialog öffnete, durch das Neuzeichnen weg: Der Fokus gehört dann dem Titel
  if (!document.querySelector("dialog[open]")) {
    document.querySelector("h1")?.focus();
  }
  const hinzufuegen = () => mitgliedHinzufuegen({ tag, kandidaten, ctx, neu });
  ctx.kopfAktion(
    knopf("Umbenennen", {
      symbol: "bearbeiten",
      onclick: () => tagDialog({ tag, ctx, neu }),
    }),
    kandidaten.length > 0 &&
      knopf("Mitglied hinzufügen", {
        art: "haupt",
        symbol: "plus",
        onclick: hinzufuegen,
      }),
  );
  if (tag.personen.length === 0) {
    bereich.append(
      leerKarte(
        kandidaten.length > 0
          ? "Die Gruppe hat noch keine Mitglieder. Füge die erste Person hinzu."
          : "Die Gruppe hat noch keine Mitglieder. Es gibt auch keine aktive Person, die du hinzufügen könntest.",
        kandidaten.length > 0
          ? [
              knopf("Mitglied hinzufügen", {
                symbol: "plus",
                onclick: hinzufuegen,
              }),
            ]
          : [],
      ),
    );
    return;
  }
  const eintraege = tag.personen.map((eintrag) => {
    const person = bekannt.get(eintrag.userId);
    const name = person?.name ?? "Unbekannte Person";
    const zusatz = [person?.ceviName, person?.deaktiviert && "deaktiviert"]
      .filter(Boolean)
      .join(" · ");
    return {
      name,
      tr: el(
        "tr",
        {},
        el(
          "th",
          { scope: "row" },
          el(
            "div",
            { class: "wer" },
            avatar(name, { hell: true, bildUrl: person?.bildUrl }),
            el(
              "div",
              {},
              el("span", { class: "name" }, name),
              zusatz && el("span", { class: "klein leise" }, zusatz),
            ),
          ),
        ),
        el(
          "td",
          {},
          el(
            "ul",
            { class: "chips" },
            chip(eintrag.rolle ?? "ohne Funktion", undefined, false),
          ),
        ),
        aktionenZelle(
          knopf("Rolle ändern", {
            klein: true,
            symbol: "bearbeiten",
            kontext: name,
            onclick: () => rolleAendern({ tag, eintrag, name, ctx, neu }),
          }),
          rundKnopf("schliessen", `Entfernen: ${name}`, () =>
            entfernen({ tag, eintrag, name, ctx, neu }),
          ),
        ),
      ),
    };
  });
  const { wurzel, koerper } = tabelle({
    beschriftung: `Mitglieder von «${tag.name}»`,
    spalten: ["Name (Cevi-Name)", "Rolle", "Aktionen"],
    zeilen: [],
  });
  const seiten = seitenleiste({ beiWechsel: () => zeichneZeilen() });
  const zeichneZeilen = () => {
    const sortiert = sortiere(eintraege, zustand.sort, (e) => e.name);
    const [von, bis] = seiten.fenster(sortiert.length);
    koerper.replaceChildren(...sortiert.slice(von, bis).map((e) => e.tr));
  };
  macheSortierbar(
    wurzel,
    [{ index: 0, schluessel: "name", name: "Name (Cevi-Name)" }],
    zustand.sort,
    () => {
      seiten.anfang();
      zeichneZeilen();
    },
  );
  aktionenKopfVerstecken(wurzel);
  zeichneZeilen();
  bereich.append(wurzel, seiten.wurzel);
}

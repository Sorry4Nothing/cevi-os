import { anfrage, fehlertext } from "./api.js";
import {
  aktionenZelle,
  auswahl,
  bestaetigen,
  chip,
  dialogFormular,
  el,
  feld,
  filterGruppe,
  knopf,
  tabelle,
} from "./dom.js";

const TYPEN = [
  ["stufe", "Stufe"],
  ["funktion", "Funktion"],
  ["team", "Team"],
  ["lager", "Lager"],
];
const typName = (typ) => TYPEN.find(([w]) => w === typ)?.[1] ?? typ;
const anzahlText = (n, eins, viele) => (n === 1 ? eins : `${n} ${viele}`);

// Der Filter überlebt das Neuladen nach einer Aktion
// fokus: Tag, dessen Karte nach dem Neuladen den Fokus bekommt; «seite» = Titel der Seite (der Auslöser ist dann weg)
const zustand = { typ: "alle", fokus: null };

function fertig(tag, text, ctx, neu) {
  zustand.fokus = tag?.id ?? "seite";
  neu();
  ctx.melde(text);
}

export function zeige(bereich, ctx) {
  zustand.typ = "alle";
  zustand.fokus = null;
  ctx.lade(
    async () => {
      const [liste, personen] = await Promise.all([
        anfrage("GET", "/api/v1/admin/tags"),
        anfrage("GET", "/api/v1/admin/personen"),
      ]);
      // Die Liste kennt nur die Zahl; wer den Tag trägt, steht erst im Einzelabruf
      const tags = await Promise.all(
        liste.tags.map((t) => anfrage("GET", `/api/v1/admin/tags/${t.id}`)),
      );
      return { tags, personen: personen.personen };
    },
    (daten, neu) => zeichne(bereich, ctx, daten, neu),
  );
}

function tagDialog({ tag, ctx, neu }) {
  const typ = tag
    ? null
    : auswahl({ label: "Typ", optionen: TYPEN, wert: "funktion" });
  const name = feld({
    label: "Name",
    wert: tag?.name ?? "",
    maxlength: 100,
    required: true,
  });
  const kuerzel = feld({
    label: "Kürzel (optional)",
    wert: tag?.kuerzel ?? "",
    maxlength: 20,
  });
  dialogFormular({
    titel: tag ? "Tag umbenennen" : "Tag anlegen",
    beschreibung: tag
      ? `${tag.name} · Typ ${typName(tag.typ)}. Der Typ lässt sich nicht ändern.`
      : "Der Typ lässt sich später nicht mehr ändern.",
    felder: [typ?.wurzel, name.wurzel, kuerzel.wurzel].filter(Boolean),
    ok: tag ? "Speichern" : "Anlegen",
    senden: () => {
      const neuerName = name.eingabe.value.trim();
      const neuesKuerzel = kuerzel.eingabe.value.trim();
      if (!tag) {
        return anfrage("POST", "/api/v1/admin/tags", {
          typ: typ.eingabe.value,
          name: neuerName,
          ...(neuesKuerzel && { kuerzel: neuesKuerzel }),
        });
      }
      // Ein Kürzel lässt sich ändern, aber nicht leeren: Die API verlangt mindestens ein Zeichen
      return anfrage("PATCH", `/api/v1/admin/tags/${tag.id}`, {
        ...(neuerName !== tag.name && { name: neuerName }),
        ...(neuesKuerzel && neuesKuerzel !== tag.kuerzel
          ? { kuerzel: neuesKuerzel }
          : {}),
      });
    },
    danach: (ergebnis) =>
      fertig(
        tag ?? ergebnis,
        tag ? "Gespeichert." : "Tag ist angelegt.",
        ctx,
        neu,
      ),
  });
}

const rolleFeld = (wert = "") =>
  feld({
    label: "Rolle (optional)",
    hilfe: "Freier Text, höchstens 50 Zeichen.",
    wert,
    maxlength: 50,
  });

function zuweisen({ tag, kandidaten, ctx, neu }) {
  const person = auswahl({
    label: "Person",
    optionen: [["", "Person wählen"], ...kandidaten.map((p) => [p.id, p.name])],
    wert: "",
  });
  const rolle = rolleFeld();
  dialogFormular({
    titel: "Person zuweisen",
    beschreibung: tag.name,
    felder: [person.wurzel, rolle.wurzel],
    ok: "Zuweisen",
    senden: () => {
      if (!person.eingabe.value) {
        throw Object.assign(new Error("PERSON_FEHLT"), {
          code: "PERSON_FEHLT",
        });
      }
      const text = rolle.eingabe.value.trim();
      return anfrage(
        "PUT",
        `/api/v1/admin/tags/${tag.id}/personen/${person.eingabe.value}`,
        text ? { rolle: text } : {},
      );
    },
    fehlertext: (f) =>
      f.code === "PERSON_FEHLT" ? "Wähle eine Person." : fehlertext(f),
    danach: () => fertig(tag, "Person ist zugewiesen.", ctx, neu),
  });
}

function rolleAendern({ tag, eintrag, name, ctx, neu }) {
  const rolle = rolleFeld(eintrag.rolle ?? "");
  dialogFormular({
    titel: "Rolle ändern",
    beschreibung: `${name} · ${tag.name}`,
    felder: [rolle.wurzel],
    ok: "Speichern",
    senden: () =>
      anfrage(
        "PUT",
        `/api/v1/admin/tags/${tag.id}/personen/${eintrag.userId}`,
        {
          rolle: rolle.eingabe.value.trim() || null,
        },
      ),
    danach: () => fertig(tag, "Rolle ist gespeichert.", ctx, neu),
  });
}

function entziehen({ tag, eintrag, name, ctx, neu }) {
  bestaetigen({
    titel: "Tag entziehen",
    beschreibung: `«${tag.name}» wird ${name} entzogen. Du kannst ihn jederzeit wieder zuweisen.`,
    ok: "Entziehen",
    gefaehrlich: false,
    aktion: () =>
      anfrage(
        "DELETE",
        `/api/v1/admin/tags/${tag.id}/personen/${eintrag.userId}`,
      ),
    danach: () => fertig(tag, `«${tag.name}» ist ${name} entzogen.`, ctx, neu),
  });
}

function loeschen({ tag, ctx, neu }) {
  dialogFormular({
    titel: "Tag löschen",
    beschreibung: `«${tag.name}» wird gelöscht. Das lässt sich nicht rückgängig machen.${
      tag.verwendung.personen > 0
        ? ` ${anzahlText(tag.verwendung.personen, "1 Person trägt", "Personen tragen")} ihn noch. Entziehe ihn zuerst.`
        : ""
    }`,
    ok: "Löschen",
    gefaehrlich: true,
    senden: () => anfrage("DELETE", `/api/v1/admin/tags/${tag.id}`),
    fehlertext: (f) => {
      if (f.code !== "TAG_BELEGT") return fehlertext(f);
      const n = f.verwendung?.personen;
      return `${typeof n === "number" ? `${anzahlText(n, "1 Person trägt", "Personen tragen")} den Tag` : "Personen tragen den Tag"} noch. Entziehe ihn zuerst allen Personen und lösche ihn danach.`;
    },
    danach: () => fertig(null, `«${tag.name}» ist gelöscht.`, ctx, neu),
  });
}

function personenTabelle(tag, namen, ctx, neu) {
  const { wurzel } = tabelle({
    beschriftung: `Personen mit dem Tag «${tag.name}»`,
    spalten: ["Person", "Rolle", "Aktionen"],
    zeilen: tag.personen.map((eintrag) => {
      const name = namen.get(eintrag.userId) ?? "Unbekannte Person";
      return el(
        "tr",
        {},
        el("th", { scope: "row" }, el("span", { class: "name" }, name)),
        el("td", {}, eintrag.rolle ?? "Keine"),
        aktionenZelle(
          knopf("Rolle ändern", {
            klein: true,
            symbol: "bearbeiten",
            kontext: name,
            onclick: () => rolleAendern({ tag, eintrag, name, ctx, neu }),
          }),
          knopf("Entziehen", {
            klein: true,
            symbol: "schliessen",
            kontext: name,
            onclick: () => entziehen({ tag, eintrag, name, ctx, neu }),
          }),
        ),
      );
    }),
  });
  return wurzel;
}

function karte(tag, personen, namen, ctx, neu) {
  const vergeben = new Set(tag.personen.map((e) => e.userId));
  const kandidaten = personen.filter(
    (p) => !p.deaktiviert && !vergeben.has(p.id),
  );
  return el(
    "li",
    { class: "karte tag-karte", "data-tag": tag.id },
    el("h2", { class: "name", tabindex: "-1" }, tag.name),
    el(
      "ul",
      { class: "chips" },
      chip(typName(tag.typ), undefined, false),
      tag.kuerzel && chip(`Kürzel ${tag.kuerzel}`, undefined, false),
      chip(
        anzahlText(tag.personen.length, "1 Person", "Personen"),
        undefined,
        false,
      ),
    ),
    tag.personen.length > 0
      ? personenTabelle(tag, namen, ctx, neu)
      : el("p", { class: "leise" }, "Niemand trägt diesen Tag."),
    kandidaten.length === 0 &&
      el(
        "p",
        { class: "hilfe" },
        "Alle aktiven Personen tragen diesen Tag schon.",
      ),
    el(
      "div",
      { class: "stufe-aktionen" },
      kandidaten.length > 0 &&
        knopf("Person zuweisen", {
          klein: true,
          symbol: "plus",
          kontext: tag.name,
          onclick: () => zuweisen({ tag, kandidaten, ctx, neu }),
        }),
      knopf("Umbenennen", {
        klein: true,
        symbol: "bearbeiten",
        kontext: tag.name,
        onclick: () => tagDialog({ tag, ctx, neu }),
      }),
      knopf("Löschen", {
        klein: true,
        art: "gefahr",
        symbol: "papierkorb",
        kontext: tag.name,
        onclick: () => loeschen({ tag, ctx, neu }),
      }),
    ),
  );
}

function zeichne(bereich, ctx, { tags, personen }, neu) {
  ctx.kopfAktion(
    knopf("Tag anlegen", {
      art: "haupt",
      symbol: "plus",
      onclick: () => tagDialog({ ctx, neu }),
    }),
  );
  if (tags.length === 0) {
    bereich.append(
      el(
        "p",
        { class: "leer" },
        "Es gibt noch keine Tags. Lege den ersten an.",
      ),
    );
    return;
  }
  const namen = new Map(
    personen.map((p) => [
      p.id,
      p.deaktiviert ? `${p.name} (deaktiviert)` : p.name,
    ]),
  );
  const liste = el("ul", { class: "tag-liste", "aria-label": "Tags" });
  const anzahl = el("p", { class: "meta klein", role: "status" });
  const leer = el(
    "p",
    { class: "leer", hidden: true },
    "Keine Tags dieses Typs.",
  );
  function aktualisiere() {
    const sichtbar = tags.filter(
      (t) => zustand.typ === "alle" || t.typ === zustand.typ,
    );
    liste.replaceChildren(
      ...sichtbar.map((t) => karte(t, personen, namen, ctx, neu)),
    );
    leer.hidden = sichtbar.length > 0;
    anzahl.textContent = anzahlText(sichtbar.length, "1 Tag", "Tags");
  }
  const filter = filterGruppe({
    beschriftung: "Typ",
    wert: zustand.typ,
    eintraege: [
      { text: "Alle", n: tags.length, wert: "alle" },
      ...TYPEN.map(([wert, text]) => ({
        text,
        n: tags.filter((t) => t.typ === wert).length,
        wert,
      })),
    ],
    beiAenderung: (wert) => {
      zustand.typ = wert;
      aktualisiere();
    },
  });
  aktualisiere();
  bereich.append(filter.wurzel, anzahl, leer, liste);
  if (zustand.fokus) {
    const karteMitFokus = [...liste.children].find(
      (k) => k.dataset.tag === zustand.fokus,
    );
    (
      karteMitFokus?.querySelector("h2") ?? document.querySelector("h1")
    )?.focus();
    zustand.fokus = null;
  }
}

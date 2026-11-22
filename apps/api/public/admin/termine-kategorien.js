import { anfrage, fehlertext } from "./api.js";
import {
  aktionenZelle,
  auswahl,
  dialogFormular,
  el,
  feld,
  knopf,
  tabelle,
} from "./dom.js";

// Reiter «Kategorien» (#434, TA3): Welche Outlook-Kategorie meint welchen Tag, wenn der Name abweicht. Schnittstelle: siehe termine.js
// Die Adresse #termine/kategorien/<Kategorie> (URL-kodiert) öffnet den Dialog «Kategorie zuordnen» mit dieser Kategorie; die Warnliste (#433) kann darauf verlinken.
const TYPEN = {
  stufe: "Stufe",
  funktion: "Funktion",
  team: "Team",
  lager: "Lager",
};
const BASIS = "/api/v1/admin/kategorie-zuordnungen";

function fertig(ctx, neu, text) {
  neu();
  ctx.melde(text);
}

function dialog({ eintrag, kategorie = "", tags, ctx, neu }) {
  const name = feld({
    label: "Kategorie",
    hilfe: "So, wie sie in Outlook heisst. Höchstens 100 Zeichen.",
    wert: eintrag?.kategorie ?? kategorie,
    maxlength: 100,
    required: true,
    ...(eintrag && { readonly: true }),
  });
  const tag = auswahl({
    label: "Tag",
    optionen: [
      ["", "Tag wählen"],
      ...tags.map((t) => [t.id, `${t.name} (${TYPEN[t.typ] ?? t.typ})`]),
    ],
    wert: eintrag?.tagId ?? "",
  });
  dialogFormular({
    titel: eintrag ? "Zuordnung ändern" : "Kategorie zuordnen",
    beschreibung:
      "Die Änderung wirkt beim nächsten Abgleich mit Outlook, in höchstens 5 Minuten.",
    felder: [name.wurzel, tag.wurzel],
    ok: "Speichern",
    senden: () => {
      if (!tag.eingabe.value) {
        throw Object.assign(new Error("TAG_FEHLT"), { code: "TAG_FEHLT" });
      }
      return anfrage("PUT", BASIS, {
        kategorie: name.eingabe.value.trim(),
        tagId: tag.eingabe.value,
      });
    },
    fehlertext: (f) => {
      if (f.code === "TAG_FEHLT") return "Wähle einen Tag.";
      if (f.code === "TAG_UNBEKANNT")
        return "Diesen Tag gibt es nicht mehr. Lade die Seite neu.";
      return fehlertext(f);
    },
    danach: () => fertig(ctx, neu, "Zuordnung ist gespeichert."),
  });
}

function entfernen({ eintrag, ctx, neu }) {
  dialogFormular({
    titel: "Zuordnung entfernen",
    beschreibung: `«${eintrag.kategorie}» ist dann nicht mehr dem Tag «${eintrag.tagName}» zugeordnet und zählt nur noch, wenn ein Tag genau so heisst. Das gilt beim nächsten Abgleich mit Outlook, in höchstens 5 Minuten.`,
    ok: "Entfernen",
    gefaehrlich: true,
    senden: () => anfrage("DELETE", `${BASIS}/${eintrag.id}`),
    danach: () =>
      fertig(ctx, neu, `Zuordnung «${eintrag.kategorie}» ist entfernt.`),
  });
}

export function zeige(bereich, ctx) {
  const [roh] = ctx.pfad;
  let vorgabe = "";
  try {
    vorgabe = roh ? decodeURIComponent(roh).slice(0, 100) : "";
  } catch {
    // Kaputte Kodierung in der Adresse: ohne Vorgabe öffnen
  }
  ctx.lade(
    async () => {
      // Drei Abfragen, unabhängig von der Zahl der Zeilen. Die Liste der Kategorien ohne Tag kommt aus der Warnliste (#433, limit=1 spart die Termine); fehlt sie oder scheitert, bleibt der Abschnitt weg
      const [liste, tags, warnung] = await Promise.all([
        anfrage("GET", BASIS),
        anfrage("GET", "/api/v1/admin/tags"),
        anfrage("GET", "/api/v1/admin/termine/warnungen?limit=1").catch(
          () => null,
        ),
      ]);
      return {
        zuordnungen: liste.zuordnungen,
        tags: tags.tags,
        unbekannt: warnung?.unbekannteKategorien ?? [],
      };
    },
    (daten, neu) => {
      zeichne(bereich, ctx, daten, neu);
      if (vorgabe && daten.tags.length > 0) {
        const v = vorgabe;
        vorgabe = "";
        dialog({ kategorie: v, tags: daten.tags, ctx, neu });
      }
    },
  );
}

function zeichne(bereich, ctx, { zuordnungen, tags, unbekannt }, neu) {
  bereich.append(
    el("h2", { class: "tm-kategorien-titel", tabindex: "-1" }, "Kategorien"),
    el(
      "p",
      { class: "hilfe tm-kategorien-hinweis" },
      "Eine Outlook-Kategorie, die genau so heisst wie ein Tag, braucht keine Zuordnung. Hier legst du fest, welchen Tag eine Kategorie meint, wenn der Name abweicht. Änderungen wirken beim nächsten Abgleich mit Outlook, in höchstens 5 Minuten.",
    ),
  );
  if (tags.length > 0) {
    ctx.kopfAktion(
      knopf("Kategorie zuordnen", {
        art: "haupt",
        symbol: "plus",
        onclick: () => dialog({ tags, ctx, neu }),
      }),
    );
  }
  if (tags.length === 0) {
    bereich.append(
      el(
        "p",
        { class: "leer" },
        "Es gibt noch keine Tags. Lege zuerst einen Tag an.",
      ),
    );
    return;
  }
  bereich.append(el("h3", { class: "tm-kategorien-unter" }, "Zuordnungen"));
  if (zuordnungen.length === 0) {
    bereich.append(
      el(
        "p",
        { class: "leer" },
        "Noch keine Zuordnungen. Lege eine an, wenn eine Kategorie in Outlook anders heisst als ihr Tag.",
      ),
    );
  } else {
    bereich.append(zuordnungenTabelle(zuordnungen, tags, ctx, neu));
  }
  if (unbekannt.length > 0) {
    bereich.append(
      el("h3", { class: "tm-kategorien-unter" }, "Kategorien ohne Tag"),
      el(
        "p",
        { class: "hilfe tm-kategorien-hinweis" },
        "Diese Kategorien kommen in kommenden Terminen vor und entsprechen keinem Tag. Solche Termine sieht niemand.",
      ),
      unbekanntTabelle(unbekannt, tags, ctx, neu),
    );
  }
}

function unbekanntTabelle(unbekannt, tags, ctx, neu) {
  return tabelle({
    beschriftung: "Kategorien ohne Tag",
    spalten: ["Kategorie", ["Termine", "zahl"], "Aktionen"],
    zeilen: unbekannt.map((u) =>
      el(
        "tr",
        {},
        el("th", { scope: "row" }, el("span", { class: "name" }, u.name)),
        el("td", { class: "zahl" }, String(u.anzahl)),
        aktionenZelle(
          knopf("Tag zuordnen", {
            klein: true,
            symbol: "plus",
            kontext: u.name,
            onclick: () => dialog({ kategorie: u.name, tags, ctx, neu }),
          }),
        ),
      ),
    ),
  }).wurzel;
}

function zuordnungenTabelle(zuordnungen, tags, ctx, neu) {
  const { wurzel } = tabelle({
    beschriftung: "Zuordnungen von Outlook-Kategorien zu Tags",
    spalten: ["Kategorie", "Tag", "Aktionen"],
    zeilen: zuordnungen.map((z) =>
      el(
        "tr",
        {},
        el("th", { scope: "row" }, el("span", { class: "name" }, z.kategorie)),
        el(
          "td",
          {},
          el("span", { class: "tm-kategorien-tag" }, z.tagName),
          el(
            "span",
            { class: "leise tm-kategorien-typ" },
            ` · ${TYPEN[z.tagTyp] ?? z.tagTyp}`,
          ),
        ),
        aktionenZelle(
          knopf("Ändern", {
            klein: true,
            symbol: "bearbeiten",
            kontext: z.kategorie,
            onclick: () => dialog({ eintrag: z, tags, ctx, neu }),
          }),
          knopf("Entfernen", {
            klein: true,
            art: "gefahr",
            symbol: "papierkorb",
            kontext: z.kategorie,
            onclick: () => entfernen({ eintrag: z, ctx, neu }),
          }),
        ),
      ),
    ),
  });
  return wurzel;
}

import { anfrage } from "./api.js";
import { zustandsKarte } from "./zustaende.js";
import {
  aktionenZelle,
  auswahl,
  bestaetigen,
  chip,
  dialogFormular,
  el,
  feld,
  knopf,
  tabelle,
} from "./dom.js";

// Stufenfelder (#355): Datum, Treffzeit, Treffpunkt, Schlusszeit, Schlussort und Mitnehmen je Stufe und Datum.
// Adresse: #website/stufenfakten und #website/stufenfakten/<stufeId>. Die Werte wirken sofort, ohne Veröffentlichen.
const MAX_ORT = 500;
const MAX_MITNEHMEN = 1000;

const heute = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
const tagFormat = new Intl.DateTimeFormat("de-CH", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const datumText = (iso) => tagFormat.format(new Date(`${iso}T12:00:00Z`));
const url = (stufeId, tag) =>
  `/api/v1/redaktion/stufen/${stufeId}/eckdaten${tag ? `/${tag}` : ""}`;

export function zeige(bereich, ctx) {
  ctx.lade(
    async () => {
      const { tags } = await anfrage("GET", "/api/v1/redaktion/tags");
      const stufen = tags.filter((t) => t.typ === "stufe");
      const gewaehlt = stufen.find((s) => s.id === ctx.pfad[0]) ?? stufen[0];
      const eckdaten = gewaehlt
        ? (await anfrage("GET", url(gewaehlt.id))).eckdaten
        : [];
      return { stufen, gewaehlt, eckdaten };
    },
    (daten, neu) => zeichne(bereich, ctx, daten, neu),
  );
}

function zeichne(bereich, ctx, daten, neu) {
  if (!daten.gewaehlt) {
    bereich.append(
      zustandsKarte({
        titel: "Es gibt noch keine Stufe.",
        text: "Lege zuerst eine Stufe an, dann pflegst du hier ihre Angaben.",
      }).wurzel,
    );
    return;
  }
  const { gewaehlt, stufen, eckdaten } = daten;
  const stufenwahl = auswahl({
    label: "Stufe",
    optionen: stufen.map((s) => [s.id, s.name]),
    wert: gewaehlt.id,
  });
  stufenwahl.eingabe.addEventListener("change", () => {
    location.hash = `#website/stufenfakten/${stufenwahl.eingabe.value}`;
  });
  ctx.kopfAktion(
    knopf("Neues Datum", {
      art: "haupt",
      symbol: "plus",
      onclick: () => formular({ stufe: gewaehlt, ctx, neu }),
    }),
  );
  bereich.append(
    el(
      "p",
      { class: "hilfe" },
      "Diese Angaben zeigt die Stufenseite für das nächste Datum. Sie wirken sofort, ohne Veröffentlichen.",
    ),
    el("div", { class: "ws-stufenfakten-kopf" }, stufenwahl.wurzel),
  );
  if (eckdaten.length === 0) {
    bereich.append(
      zustandsKarte({
        titel: "Keine kommenden Daten.",
        text: "Für diese Stufe sind keine kommenden Daten eingetragen. Lege mit «Neues Datum» das erste an.",
      }).wurzel,
    );
    return;
  }
  const { wurzel } = tabelle({
    beschriftung: `Kommende Daten der Stufe ${gewaehlt.name}`,
    spalten: ["Datum", "Treffpunkt", "Quelle", "Aktionen"],
    zeilen: eckdaten.map((z) => zeile(z, gewaehlt, ctx, neu)),
  });
  bereich.append(wurzel);
}

function zeile(z, stufe, ctx, neu) {
  const gepflegt = z.quelle === "seite";
  const kontext = datumText(z.tag);
  return el(
    "tr",
    {},
    el("th", { scope: "row" }, kontext),
    el(
      "td",
      {},
      [z.treffZeit && `${z.treffZeit} Uhr`, z.treffpunkt]
        .filter(Boolean)
        .join(", "),
    ),
    el(
      "td",
      {},
      el(
        "ul",
        { class: "chips" },
        chip(
          gepflegt ? "Hier gepflegt" : "Von der alten Seite",
          undefined,
          false,
        ),
      ),
    ),
    aktionenZelle(
      knopf("Bearbeiten", {
        klein: true,
        kontext,
        onclick: () => formular({ stufe, ctx, neu, zeile: z }),
      }),
      gepflegt &&
        knopf("Löschen", {
          klein: true,
          art: "gefahr",
          kontext,
          onclick: () =>
            bestaetigen({
              titel: "Datum löschen?",
              beschreibung: `${kontext}: Die Angaben verschwinden von der Stufenseite.`,
              ok: "Löschen",
              aktion: () => anfrage("DELETE", url(stufe.id, z.tag)),
              danach: () => {
                neu();
                ctx.melde("Das Datum ist gelöscht.");
              },
            }),
        }),
    ),
  );
}

function formular({ stufe, ctx, neu, zeile }) {
  const neuesDatum = zeile === undefined;
  const tag = feld({
    label: "Datum",
    typ: "date",
    wert: zeile?.tag ?? "",
    required: true,
    min: heute(),
    readOnly: !neuesDatum,
  });
  const treffZeit = feld({
    label: "Treffzeit",
    typ: "time",
    wert: zeile?.treffZeit ?? "",
  });
  const treffpunkt = feld({
    label: "Treffpunkt",
    wert: zeile?.treffpunkt ?? "",
    maxlength: MAX_ORT,
  });
  const schlussZeit = feld({
    label: "Schlusszeit",
    typ: "time",
    wert: zeile?.schlussZeit ?? "",
  });
  const schlussOrt = feld({
    label: "Schlussort",
    wert: zeile?.schlussOrt ?? "",
    maxlength: MAX_ORT,
  });
  const mitnehmen = feld({
    label: "Mitnehmen",
    mehrzeilig: true,
    rows: 4,
    wert: zeile?.mitnehmen ?? "",
    maxlength: MAX_MITNEHMEN,
    hilfe: "Ein Gegenstand pro Zeile.",
  });
  const alle = [tag, treffZeit, treffpunkt, schlussZeit, schlussOrt, mitnehmen];
  dialogFormular({
    titel: neuesDatum ? "Neues Datum" : "Angaben bearbeiten",
    beschreibung: `Stufe ${stufe.name}. Wirkt sofort, ohne Veröffentlichen.`,
    felder: alle.map((f) => f.wurzel),
    ok: "Speichern",
    senden: () => {
      const werte = {
        treffZeit: treffZeit.eingabe.value,
        treffpunkt: treffpunkt.eingabe.value,
        schlussZeit: schlussZeit.eingabe.value,
        schlussOrt: schlussOrt.eingabe.value,
        mitnehmen: mitnehmen.eingabe.value,
      };
      if (Object.values(werte).every((w) => w.trim() === "")) {
        throw new Error("leer");
      }
      return anfrage("PUT", url(stufe.id, tag.eingabe.value), werte);
    },
    fehlertext: (f) =>
      f.message === "leer"
        ? "Trage mindestens ein Feld ein."
        : f.code === "DATUM_VERGANGEN"
          ? "Das Datum liegt in der Vergangenheit."
          : f.code === "ECKDATEN_ZU_VIELE"
            ? "Es sind höchstens 20 kommende Daten möglich. Lösche zuerst ein altes."
            : "Das Speichern hat nicht geklappt. Prüfe die Angaben und versuche es nochmals.",
    danach: () => {
      neu();
      ctx.melde("Die Angaben sind gespeichert.");
    },
  });
}

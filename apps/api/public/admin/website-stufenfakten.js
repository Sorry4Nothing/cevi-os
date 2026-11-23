import { anfrage, fehlertext } from "./api.js";
import { zustandsKarte } from "./zustaende.js";
import {
  aktionenZelle,
  chip,
  dialogFormular,
  el,
  feld,
  filterGruppe,
  knopf,
  tabelle,
} from "./dom.js";
import { datumsfeld, zeitfeld } from "./datumsfeld.js";
import { formularRaster } from "./formularraster.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";
import {
  kartenVerweis,
  ladeOrte,
  ortAuswahl,
  reiter,
  zeigeOrte,
} from "./website-orte.js";

// Samstagsangaben der Stufen (#355): Datum, Treffzeit, Treffpunkt, Schlusszeit, Schlussort und Mitnehmen je Stufe und Datum.
// Adresse: #website/stufenfakten und #website/stufenfakten/<stufeId>. Die Werte wirken sofort, ohne Veröffentlichen.
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

// 403 heisst hier «nicht deine Stufe», kein Fehler: Die Stufenleitung darf nur die eigene Stufe pflegen
async function ladeEckdaten(stufeId) {
  try {
    return (await anfrage("GET", url(stufeId))).eckdaten;
  } catch (f) {
    if (f?.status === 403) return null;
    throw f;
  }
}

export function zeige(bereich, ctx) {
  if (ctx.pfad[0] === "orte") {
    zeigeOrte(bereich, ctx);
    return;
  }
  ctx.lade(
    async () => {
      // Die Orte der Bibliothek (#646) kommen mit; ohne Recht daran bleibt es bei Freitext
      const [angaben, orte] = await Promise.all([ladeAngaben(ctx), ladeOrte()]);
      return { ...angaben, orte };
    },
    (daten, neu) => zeichne(bereich, ctx, daten, neu),
  );
}

async function ladeAngaben(ctx) {
  const { tags } = await anfrage("GET", "/api/v1/redaktion/tags");
  const stufen = tags.filter((t) => t.typ === "stufe");
  // Die gewünschte Stufe zuerst; wer sie nicht pflegen darf, bekommt die eigene (die Antworten sagen es, die API nennt die Stufen der Person nicht)
  const gewuenscht = stufen.find((s) => s.id === ctx.pfad[0]) ?? stufen[0];
  if (!gewuenscht) return { stufen, gewaehlt: undefined, eckdaten: [] };
  const erste = await ladeEckdaten(gewuenscht.id);
  if (erste) return { stufen, gewaehlt: gewuenscht, eckdaten: erste };
  const uebrige = stufen.filter((s) => s.id !== gewuenscht.id);
  const antworten = await Promise.all(
    uebrige.map(async (s) => [s, await ladeEckdaten(s.id)]),
  );
  const erlaubt = antworten.filter(([, e]) => e);
  if (erlaubt.length === 0) {
    return {
      stufen: [],
      gewaehlt: undefined,
      eckdaten: [],
      keinRecht: true,
    };
  }
  return {
    stufen: erlaubt.map(([s]) => s),
    gewaehlt: erlaubt[0][0],
    eckdaten: erlaubt[0][1],
  };
}

function zeichne(bereich, ctx, daten, neu) {
  if (!daten.gewaehlt) {
    bereich.append(
      zustandsKarte(
        daten.keinRecht
          ? {
              titel: "Für dich ist hier keine Stufe frei.",
              text: "Du darfst die Angaben einer Stufe nur pflegen, wenn du dort Stufenleitung bist. Wende dich an die Abteilungsleitung.",
            }
          : {
              titel: "Es gibt noch keine Stufe.",
              text: "Lege zuerst eine Stufe an, dann pflegst du hier ihre Angaben.",
            },
      ).wurzel,
    );
    return;
  }
  const { gewaehlt, stufen, eckdaten } = daten;
  // Die Stufen als Pillen: ein Tipp wechselt, alle sind auf einen Blick da
  const stufenwahl = filterGruppe({
    beschriftung: "Stufe",
    wert: gewaehlt.id,
    eintraege: stufen.map((s) => ({ text: s.name, wert: s.id })),
    beiAenderung: (id) => {
      location.hash = `#website/stufenfakten/${id}`;
    },
  });
  ctx.kopfAktion(
    knopf("Neues Datum", {
      art: "haupt",
      symbol: "plus",
      onclick: () => formular({ stufe: gewaehlt, ctx, neu, orte: daten.orte }),
    }),
  );
  bereich.append(
    ...(daten.orte === null ? [] : [reiter("angaben")]),
    el(
      "p",
      { class: "hilfe ws-stufenfakten-einleitung" },
      "Hier trägst du für jede Stufe ein, wann und wo das nächste Treffen ist: Treffzeit, Treffpunkt, Schlusszeit, Schlussort und was die Kinder mitnehmen. Die Stufenseite auf der Website zeigt die Tafel zum nächsten Datum ab heute. Was du hier änderst, ist sofort sichtbar. Du musst nichts veröffentlichen.",
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
    zeilen: eckdaten.map((z) => zeile(z, gewaehlt, ctx, neu, daten.orte)),
  });
  bereich.append(wurzel);
}

function zeile(z, stufe, ctx, neu, orte) {
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
        onclick: () => formular({ stufe, ctx, neu, zeile: z, orte }),
      }),
      gepflegt &&
        knopf("Löschen", {
          klein: true,
          art: "gefahr",
          kontext,
          onclick: (e) =>
            ctx.mitRueckgaengig({
              text: `${kontext} gelöscht. Die Angaben verschwinden von der Stufenseite`,
              ansicht: ansichtVonKnopf(e),
              ausfuehren: () => anfrage("DELETE", url(stufe.id, z.tag)),
              fehlertext,
              danach: neu,
            }),
        }),
    ),
  );
}

// Neues Datum oder Angaben bearbeiten: links die Felder, rechts die Angaben so, wie die Stufenseite sie ordnet (die Vorschau geht beim Tippen mit)
function formular({ stufe, ctx, neu, zeile, orte }) {
  const neuesDatum = zeile === undefined;
  // Das Datum eines bestehenden Eintrags bleibt, wie es ist: Ein anderes Datum wäre ein neuer Eintrag
  const tag = neuesDatum
    ? datumsfeld({ label: "Datum", required: true, min: heute() })
    : feld({
        label: "Datum",
        wert: datumText(zeile.tag),
        readOnly: true,
        hilfe:
          "Das Datum lässt sich nicht ändern. Lege dafür ein neues Datum an.",
      });
  const datumWert = () => (neuesDatum ? tag.eingabe.value : zeile.tag);
  const treffZeit = zeitfeld({
    label: "Treffzeit",
    wert: zeile?.treffZeit ?? "",
  });
  // Treffpunkt und Schlussort wählst du aus den Orten der Abteilung (#646); «Anderer Ort» bleibt ein Text
  const treffpunkt = ortAuswahl({
    label: "Treffpunkt",
    orte,
    ortId: zeile?.treffpunktOrtId,
    text: zeile?.treffpunkt,
    ctx,
  });
  const schlussZeit = zeitfeld({
    label: "Schlusszeit",
    wert: zeile?.schlussZeit ?? "",
  });
  const schlussOrt = ortAuswahl({
    label: "Schlussort",
    orte,
    ortId: zeile?.schlussOrtId,
    text: zeile?.schlussOrt,
    ctx,
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
  // Die Ortswahl hat mehrere Eingaben (Auswahl und Text), die anderen Felder eine
  const eingaben = alle.flatMap((f) => f.eingaben ?? [f.eingabe]);

  const vorschau = el("dl", { class: "ws-stufenvorschau" });
  const zeigeVorschau = () => {
    const wert = datumWert();
    const mitZeit = (zeit, ort) =>
      [zeit && `${zeit} Uhr`, ort.name].filter(Boolean).join(", ");
    // Der Ort mit Adresszeile und dem Verweis zur Karte, wie die Stufenseite ihn zeigt
    const ortZeile = (zeit, ort) => {
      const kopf = mitZeit(zeit, ort);
      const verweis = kartenVerweis(ort.link);
      return !kopf
        ? leer.cloneNode(true)
        : el(
            "dd",
            {},
            kopf,
            ort.zusatz &&
              el("span", { class: "ort-vorschau-zusatz" }, ort.zusatz),
            verweis && el("span", { class: "ort-vorschau-zusatz" }, verweis),
          );
    };
    const dinge = mitnehmen.eingabe.value
      .split("\n")
      .map((d) => d.trim())
      .filter(Boolean);
    const leer = el("dd", { class: "leise" }, "noch leer");
    const text = (t) => (t ? el("dd", {}, t) : leer.cloneNode(true));
    const reihe = (name, inhalt) =>
      el(
        "div",
        { class: "ws-stufenvorschau-zeile" },
        el("dt", {}, name),
        inhalt,
      );
    vorschau.replaceChildren(
      reihe("Datum", text(wert ? datumText(wert) : "")),
      reihe("Treffen", ortZeile(treffZeit.eingabe.value, treffpunkt.anzeige())),
      reihe(
        "Schluss",
        ortZeile(schlussZeit.eingabe.value, schlussOrt.anzeige()),
      ),
      reihe(
        "Mitnehmen",
        dinge.length > 0
          ? el(
              "dd",
              {},
              el(
                "ul",
                {},
                dinge.map((d) => el("li", {}, d)),
              ),
            )
          : leer.cloneNode(true),
      ),
    );
  };
  for (const e of eingaben) {
    e.addEventListener("input", zeigeVorschau);
    e.addEventListener("change", zeigeVorschau);
  }
  zeigeVorschau();

  dialogFormular({
    titel: neuesDatum ? "Neues Datum" : "Angaben bearbeiten",
    beschreibung: `Stufe ${stufe.name}. Wirkt sofort, ohne Veröffentlichen.`,
    felder: [
      formularRaster({
        felder: alle.map((f) => f.wurzel),
        seiteTitel: "So steht es auf der Stufenseite",
        seite: vorschau,
      }),
    ],
    ok: "Speichern",
    senden: () => {
      const treff = treffpunkt.werte();
      const schluss = schlussOrt.werte();
      const werte = {
        treffZeit: treffZeit.eingabe.value,
        treffpunkt: treff.text,
        treffpunktOrtId: treff.ortId,
        schlussZeit: schlussZeit.eingabe.value,
        schlussOrt: schluss.text,
        schlussOrtId: schluss.ortId,
        mitnehmen: mitnehmen.eingabe.value,
      };
      if (Object.values(werte).every((w) => w.trim() === "")) {
        throw new Error("leer");
      }
      return anfrage("PUT", url(stufe.id, datumWert()), werte);
    },
    // Ein neues Datum ohne Wahl: Meldung beim Feld, Fokus dorthin
    pruefe: () => {
      if (!neuesDatum || tag.eingabe.value !== "") return false;
      const m = el(
        "p",
        { class: "feld-fehler", role: "alert" },
        "Wähle ein Datum.",
      );
      tag.wurzel.append(m);
      tag.eingabe.focus();
      tag.eingabe.addEventListener("input", () => m.remove(), { once: true });
      return true;
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

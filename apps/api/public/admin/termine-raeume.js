import { anfrage, fehlertext } from "./api.js";
import {
  aktionenZelle,
  ankreuzen,
  auswahl,
  chip,
  dialogFormular,
  el,
  feld,
  knopf,
  tabelle,
} from "./dom.js";

// Reiter «Räume» (#446, TG1): Die Abteilungsleitung legt Räume an, ändert, deaktiviert und löscht sie. Die Raumanfragen (#447) kommen später. Schnittstelle: siehe termine.js
const BASIS = "/api/v1/admin/raeume";
const SEITE = 50;
const TYPEN = {
  stufe: "Stufe",
  funktion: "Funktion",
  team: "Team",
  lager: "Lager",
};
const TEXTE = {
  PLAETZE_UNGUELTIG: "Die Plätze sind eine ganze Zahl von 1 bis 1000.",
  TEAM_UNBEKANNT:
    "Dieses Team gibt es nicht mehr. Lade die Seite neu und wähle es nochmals.",
  RAUM_VORHANDEN: "Es gibt schon einen Raum mit diesem Namen.",
  ANFRAGEN_OFFEN:
    "Es gibt noch offene Raumanfragen. Deaktiviere den Raum stattdessen.",
};
const meldung = (f) => TEXTE[f?.code] ?? fehlertext(f);

// Die Tags für die Auswahl des Teams, höchstens einmal je Besuch des Reiters und erst, wenn ein Dialog sie braucht
let tagsMerker = null;
const ladeTags = () => {
  tagsMerker ??= anfrage("GET", "/api/v1/admin/tags").then((a) => a.tags);
  tagsMerker.catch(() => (tagsMerker = null));
  return tagsMerker;
};

const platzText = (r) =>
  r.kapazitaet === null
    ? "–"
    : `${r.kapazitaet} ${r.kapazitaet === 1 ? "Platz" : "Plätze"}`;

function zeile(r, ctx, neu) {
  return el(
    "tr",
    {},
    el(
      "th",
      { scope: "row" },
      el("span", { class: "name" }, r.name),
      r.ort && el("span", { class: "leise tm-raeume-ort" }, r.ort),
    ),
    el("td", {}, platzText(r)),
    el("td", {}, r.team ? r.team.name : "–"),
    el(
      "td",
      {},
      el(
        "ul",
        { class: "chips" },
        r.aktiv ? chip("Aktiv", "ok") : chip("Deaktiviert", "warn"),
      ),
    ),
    aktionenZelle(
      knopf("Ändern", {
        klein: true,
        symbol: "bearbeiten",
        kontext: r.name,
        onclick: () => dialog({ raum: r, ctx, neu }),
      }),
      knopf("Löschen", {
        klein: true,
        art: "gefahr",
        symbol: "papierkorb",
        kontext: r.name,
        onclick: () => loeschen({ raum: r, ctx, neu }),
      }),
    ),
  );
}

async function dialog({ raum, ctx, neu }) {
  let tags;
  try {
    tags = await ladeTags();
  } catch (f) {
    ctx.melde(meldung(f), "fehler");
    return;
  }
  const name = feld({
    label: "Name",
    hilfe: "Höchstens 100 Zeichen. Jeder Name gilt nur einmal.",
    wert: raum?.name ?? "",
    maxlength: 100,
    required: true,
  });
  const ort = feld({
    label: "Ort",
    hilfe:
      "Zum Beispiel das Gebäude und das Stockwerk. Freiwillig, höchstens 200 Zeichen.",
    wert: raum?.ort ?? "",
    maxlength: 200,
  });
  const beschreibung = feld({
    label: "Beschreibung",
    hilfe: "Ausstattung und Hinweise. Freiwillig, höchstens 1000 Zeichen.",
    wert: raum?.beschreibung ?? "",
    maxlength: 1000,
    mehrzeilig: true,
    rows: 3,
  });
  const plaetze = feld({
    label: "Plätze",
    hilfe: "Wie viele Personen Platz haben, von 1 bis 1000. Freiwillig.",
    typ: "number",
    wert: raum?.kapazitaet ?? "",
    min: 1,
    max: 1000,
    step: 1,
    inputmode: "numeric",
  });
  const team = auswahl({
    label: "Zuständiges Team",
    optionen: [
      ["", "Kein Team"],
      ...tags.map((t) => [t.id, `${t.name} (${TYPEN[t.typ] ?? t.typ})`]),
    ],
    wert: raum?.team?.id ?? "",
  });
  const aktiv = ankreuzen({
    label: "Aktiv: Mitglieder sehen den Raum",
    gewaehlt: raum?.aktiv ?? true,
    wert: "aktiv",
  });
  dialogFormular({
    titel: raum ? "Raum ändern" : "Raum anlegen",
    felder: [
      name.wurzel,
      ort.wurzel,
      beschreibung.wurzel,
      plaetze.wurzel,
      team.wurzel,
      aktiv.wurzel,
    ],
    ok: "Speichern",
    senden: () => {
      const roh = plaetze.eingabe.value.trim();
      const n = Number(roh);
      if (roh !== "" && !(Number.isInteger(n) && n >= 1 && n <= 1000)) {
        throw Object.assign(new Error("PLAETZE"), {
          code: "PLAETZE_UNGUELTIG",
        });
      }
      const leer = (feldEingabe) => feldEingabe.value.trim() || null;
      const koerper = {
        name: name.eingabe.value.trim(),
        ort: leer(ort.eingabe),
        beschreibung: leer(beschreibung.eingabe),
        kapazitaet: roh === "" ? null : n,
        teamId: team.eingabe.value || null,
        aktiv: aktiv.eingabe.checked,
      };
      return raum
        ? anfrage("PATCH", `${BASIS}/${raum.id}`, koerper)
        : anfrage("POST", BASIS, koerper);
    },
    fehlertext: meldung,
    danach: () => {
      neu();
      ctx.melde(raum ? "Raum ist gespeichert." : "Raum ist angelegt.");
    },
  });
}

function loeschen({ raum, ctx, neu }) {
  dialogFormular({
    titel: "Raum löschen",
    beschreibung: `«${raum.name}» wird endgültig gelöscht. Willst du ihn nur ausblenden, deaktiviere ihn stattdessen.`,
    ok: "Löschen",
    gefaehrlich: true,
    senden: () => anfrage("DELETE", `${BASIS}/${raum.id}`),
    fehlertext: meldung,
    danach: () => {
      neu();
      ctx.melde(`Raum «${raum.name}» ist gelöscht.`);
    },
  });
}

export function zeige(bereich, ctx) {
  tagsMerker = null;
  ctx.lade(
    () => anfrage("GET", `${BASIS}?limit=${SEITE}`),
    (erste, neu) => zeichne(bereich, ctx, erste, neu),
  );
}

function zeichne(bereich, ctx, erste, neu) {
  let naechste = erste.naechste;
  ctx.kopfAktion(
    knopf("Raum anlegen", {
      art: "haupt",
      symbol: "plus",
      onclick: () => dialog({ ctx, neu }),
    }),
  );
  const leer = el(
    "p",
    { class: "leer" },
    "Noch keine Räume. Lege den ersten an.",
  );
  const { wurzel: rahmen, koerper } = tabelle({
    beschriftung: "Räume",
    spalten: ["Raum", "Plätze", "Team", "Stand", "Aktionen"],
    zeilen: erste.raeume.map((r) => zeile(r, ctx, neu)),
  });
  const status = el("p", { class: "klein tm-raeume-status", role: "status" });
  const mehr = knopf("Weitere laden", {
    symbol: "runter",
    onclick: async () => {
      mehr.disabled = true;
      mehr.setAttribute("aria-busy", "true");
      status.textContent = "Weitere Räume werden geladen …";
      try {
        const seite = await anfrage(
          "GET",
          `${BASIS}?limit=${SEITE}&nach=${encodeURIComponent(naechste)}`,
        );
        if (!bereich.isConnected) return;
        koerper.append(...seite.raeume.map((r) => zeile(r, ctx, neu)));
        naechste = seite.naechste;
        status.textContent = `${seite.raeume.length} weitere Räume geladen.`;
        mehr.hidden = !seite.weitere;
        // Der Knopf verschwindet mit der letzten Seite: Der Fokus geht an die Tabelle statt ins Leere
        if (!seite.weitere) rahmen.focus();
      } catch (f) {
        status.textContent = `${fehlertext(f)} Versuche es nochmals.`;
      } finally {
        mehr.disabled = false;
        mehr.removeAttribute("aria-busy");
      }
    },
  });
  rahmen.hidden = erste.raeume.length === 0;
  leer.hidden = erste.raeume.length !== 0;
  mehr.hidden = !erste.weitere;
  bereich.append(
    el("h2", { class: "tm-raeume-titel", tabindex: "-1" }, "Räume"),
    el(
      "p",
      { class: "leise tm-raeume-text" },
      "Hier pflegst du die Räume der Abteilung. Alle Mitglieder sehen die aktiven Räume. Ein deaktivierter Raum bleibt hier stehen und ist für die Mitglieder ausgeblendet. Die Räume stehen nach Name geordnet.",
    ),
    leer,
    rahmen,
    status,
    el("div", { class: "tm-raeume-mehr" }, mehr),
  );
}

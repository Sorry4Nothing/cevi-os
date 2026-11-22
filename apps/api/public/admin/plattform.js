import { anfrage } from "./api.js";
import {
  aktionenZelle,
  bestaetigen,
  chip,
  dialogFormular,
  el,
  feld,
  knopf,
  tabelle,
  zeit,
} from "./dom.js";

// Bereich «Plattform» (#424): Wartungsmodus je Bereich schalten und aufheben. Wer hier schalten darf, sagt der Server (GET /api/v1/plattform/schalter: «bereiche»); jede Schaltung prüft er selbst.
const BEREICHE = [
  ["alles", "Alles", "Jeder Bereich von Cevi OS."],
  ["website", "Website", "Seiten und Medien der Website, die Verwaltung der Website."],
  ["lager", "Lager", "Das Lager-Modul und seine Verwaltung."],
  ["chat", "Chat", "Die Chats der App."],
  ["programme", "Programme und Termine", "Programme, Anmeldungen, Termine."],
  ["verwaltung", "Verwaltung", "Alle Verwaltungsseiten dieser Seite."],
];

export function zeige(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", "/api/v1/plattform/schalter"),
    (daten, neu) => zeichne(bereich, ctx, daten, neu),
  );
}

// «2026-11-23T21:00» (lokale Zeit) -> ISO mit Zeitzone; leer -> null
const alsIso = (wert) => (wert ? new Date(wert).toISOString() : null);
// ISO -> Wert für datetime-local in lokaler Zeit
function alsLokal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const zweistellig = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}T${zweistellig(d.getHours())}:${zweistellig(d.getMinutes())}`;
}

function dialog({ eintrag, schalter, ctx, neu }) {
  const [schluessel, name] = eintrag;
  const hinweis = feld({
    label: "Hinweistext",
    wert: schalter?.hinweis ?? "",
    mehrzeilig: true,
    rows: 3,
    maxlength: 500,
    hilfe:
      "Diesen Text sehen Personen, die in dieser Zeit etwas ändern wollen. Zum Beispiel «Wir spielen ein Update ein.» Keine Namen schreiben.",
  });
  const ende = feld({
    label: "Geplantes Ende (optional)",
    typ: "datetime-local",
    wert: alsLokal(schalter?.ende),
    hilfe:
      "Nur eine Angabe für die Anzeige. Die Wartung endet erst, wenn du sie aufhebst.",
  });
  dialogFormular({
    titel: schalter
      ? `Wartung ändern: ${name}`
      : `Wartung einschalten: ${name}`,
    beschreibung:
      "Der Bereich ist dann nur lesbar: Ansehen geht, jede Änderung und jede Bearbeitungsansicht ist gesperrt. Abteilungsleitung und Entwickler arbeiten weiter.",
    felder: [hinweis.wurzel, ende.wurzel],
    ok: schalter ? "Speichern" : "Wartung einschalten",
    senden: () =>
      anfrage("PUT", "/api/v1/plattform/schalter", {
        art: "wartung",
        bereich: schluessel,
        hinweis: hinweis.eingabe.value.trim() || null,
        ende: alsIso(ende.eingabe.value),
      }),
    danach: () => {
      neu();
      ctx.melde(
        schalter
          ? "Gespeichert."
          : `${name} ist in Wartung und nur noch lesbar.`,
      );
    },
  });
}

function aufheben(eintrag, ctx, neu) {
  const [schluessel, name] = eintrag;
  bestaetigen({
    titel: `Wartung aufheben: ${name}`,
    beschreibung: "Der Bereich ist sofort wieder ganz benutzbar.",
    ok: "Wartung aufheben",
    gefaehrlich: false,
    aktion: () =>
      anfrage(
        "DELETE",
        `/api/v1/plattform/schalter?art=wartung&bereich=${schluessel}`,
      ),
    danach: () => {
      neu();
      ctx.melde(`${name} ist wieder frei.`);
    },
  });
}

function zeichne(bereich, ctx, daten, neu) {
  const wartung = new Map(
    daten.schalter
      .filter((s) => s.art === "wartung")
      .map((s) => [s.bereich, s]),
  );
  const sichtbar = BEREICHE.filter(([s]) => daten.bereiche.includes(s));
  bereich.append(
    el(
      "p",
      { class: "meta" },
      "Im Wartungsmodus ist ein Bereich nur lesbar. Schreibende Anfragen und Bearbeitungsansichten antworten mit dem Hinweistext; Abteilungsleitung und Entwickler arbeiten weiter.",
    ),
  );
  const { wurzel } = tabelle({
    beschriftung: "Wartungsmodus je Bereich",
    spalten: ["Bereich", "Zustand", "Aktionen"],
    zeilen: sichtbar.map((eintrag) => {
      const [schluessel, name, beschreibung] = eintrag;
      const schalter = wartung.get(schluessel);
      return el(
        "tr",
        {},
        el(
          "th",
          { scope: "row" },
          el("span", { class: "name" }, name),
          el("span", { class: "meta klein" }, ` ${beschreibung}`),
        ),
        el(
          "td",
          {},
          schalter
            ? [
                el("ul", { class: "chips" }, chip("In Wartung", "warn", "uhr")),
                schalter.hinweis &&
                  el("p", { class: "klein" }, schalter.hinweis),
                el(
                  "p",
                  { class: "meta klein" },
                  schalter.ende
                    ? `Geplantes Ende: ${zeit(schalter.ende)}`
                    : "Kein Ende angegeben.",
                ),
              ]
            : el("ul", { class: "chips" }, chip("Frei", "ok")),
        ),
        aktionenZelle(
          ...(schalter
            ? [
                knopf("Ändern", {
                  klein: true,
                  symbol: "bearbeiten",
                  kontext: name,
                  onclick: () => dialog({ eintrag, schalter, ctx, neu }),
                }),
                knopf("Aufheben", {
                  klein: true,
                  symbol: "haken",
                  kontext: name,
                  onclick: () => aufheben(eintrag, ctx, neu),
                }),
              ]
            : [
                knopf("Einschalten", {
                  klein: true,
                  symbol: "uhr",
                  kontext: name,
                  onclick: () => dialog({ eintrag, schalter, ctx, neu }),
                }),
              ]),
        ),
      );
    }),
  });
  bereich.append(wurzel);
}

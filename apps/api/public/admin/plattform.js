import { anfrage } from "./api.js";
import {
  aktionenZelle,
  ankreuzen,
  bestaetigen,
  chip,
  dialogFormular,
  el,
  feld,
  knopf,
  tabelle,
  zeit,
} from "./dom.js";

// Bereich «Plattform» (#424 Wartungsmodus, #425 Informationssperre): Schalter je Bereich setzen und aufheben. Wer hier schalten darf, sagt der Server (GET /api/v1/plattform/schalter: «bereiche», «darfSperre»); jede Schaltung prüft er selbst.
const BEREICHE = [
  ["alles", "Alles", "Jeder Bereich von Cevi OS."],
  [
    "website",
    "Website",
    "Seiten, Medien, Weiterleitungen und Vorlagen der Website.",
  ],
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

function wartungDialog({ eintrag, schalter, ctx, neu }) {
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

function wartungAufheben(eintrag, ctx, neu) {
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

function sperreDialog({ eintrag, daten, ctx, neu }) {
  const [schluessel, name] = eintrag;
  const hinweis = feld({
    label: "Notiz (optional)",
    mehrzeilig: true,
    rows: 3,
    maxlength: 500,
    hilfe:
      "Nur für Entwickler und Abteilungsleitung sichtbar, zum Beispiel der Anlass. Alle anderen sehen nur «vorübergehend nicht verfügbar». Keine Namen schreiben.",
  });
  const sitzungen = ankreuzen({
    label: "Alle Sitzungen der Abteilung beenden (deine bleibt)",
  });
  // Nur, wo es eine Website gibt, die sich vom Netz nehmen lässt
  const website = ankreuzen({
    label: "Öffentliche Website vom Netz nehmen",
  });
  const mitWebsite =
    daten.websiteVorhanden &&
    (schluessel === "website" || schluessel === "alles");
  dialogFormular({
    titel: `Informationssperre auslösen: ${name}`,
    beschreibung:
      "Die API liefert dann keine Inhalte dieses Bereichs mehr (423), auch nicht der Abteilungsleitung. Nur Entwickler und Abteilungsleitung heben die Sperre wieder auf.",
    felder: [
      hinweis.wurzel,
      sitzungen.wurzel,
      ...(mitWebsite ? [website.wurzel] : []),
    ],
    ok: "Informationssperre auslösen",
    gefaehrlich: true,
    senden: () =>
      anfrage("PUT", "/api/v1/plattform/schalter", {
        art: "sperre",
        bereich: schluessel,
        hinweis: hinweis.eingabe.value.trim() || null,
        sitzungenBeenden: sitzungen.eingabe.checked,
        websiteOffline: mitWebsite && website.eingabe.checked,
      }),
    danach: (antwort) => {
      neu();
      const teile = [`${name} ist gesperrt.`];
      if (antwort?.sitzungenBeendet != null) {
        teile.push(`${antwort.sitzungenBeendet} Sitzungen beendet.`);
      }
      if (antwort?.websiteOffline) {
        teile.push(
          antwort.websiteVomNetz
            ? "Die öffentliche Website ist vom Netz."
            : "Die öffentliche Website liess sich nicht vom Netz nehmen. Prüfe sie von Hand.",
        );
      }
      ctx.melde(
        teile.join(" "),
        antwort?.websiteOffline && !antwort.websiteVomNetz ? "fehler" : "ok",
      );
    },
  });
}

function sperreAufheben(eintrag, ctx, neu) {
  const [schluessel, name] = eintrag;
  bestaetigen({
    titel: `Informationssperre aufheben: ${name}`,
    beschreibung:
      "Der Bereich liefert sofort wieder Inhalte. Beendete Sitzungen kommen nicht zurück: Die Personen melden sich neu an.",
    ok: "Sperre aufheben",
    gefaehrlich: false,
    aktion: () =>
      anfrage(
        "DELETE",
        `/api/v1/plattform/schalter?art=sperre&bereich=${schluessel}`,
      ),
    danach: () => {
      neu();
      ctx.melde(`${name} ist wieder freigegeben.`);
    },
  });
}

// Eine Tabelle je Art: art «wartung» oder «sperre»; der Zustand steht im Wort und als Symbol, nie nur über Farbe
function zustandsTabelle({ art, eintraege, schalter, ctx, daten, neu }) {
  const istSperre = art === "sperre";
  const nachBereich = new Map(
    schalter.filter((s) => s.art === art).map((s) => [s.bereich, s]),
  );
  return tabelle({
    beschriftung: istSperre
      ? "Informationssperre je Bereich"
      : "Wartungsmodus je Bereich",
    spalten: ["Bereich", "Zustand", "Aktionen"],
    zeilen: eintraege.map((eintrag) => {
      const [schluessel, name, beschreibung] = eintrag;
      const aktiv = nachBereich.get(schluessel);
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
          aktiv
            ? [
                el(
                  "ul",
                  { class: "chips" },
                  istSperre
                    ? chip("Gesperrt", "fehler", "sperre")
                    : chip("In Wartung", "warn", "uhr"),
                ),
                aktiv.hinweis && el("p", { class: "klein" }, aktiv.hinweis),
                istSperre
                  ? aktiv.websiteOffline &&
                    el(
                      "p",
                      { class: "meta klein" },
                      "Öffentliche Website vom Netz.",
                    )
                  : el(
                      "p",
                      { class: "meta klein" },
                      aktiv.ende
                        ? `Geplantes Ende: ${zeit(aktiv.ende)}`
                        : "Kein Ende angegeben.",
                    ),
                el(
                  "p",
                  { class: "meta klein" },
                  `Seit ${zeit(aktiv.ausgeloestAm)}`,
                ),
              ]
            : el(
                "ul",
                { class: "chips" },
                chip(istSperre ? "Offen" : "Frei", "ok"),
              ),
        ),
        aktionenZelle(
          ...(aktiv
            ? [
                !istSperre &&
                  knopf("Ändern", {
                    klein: true,
                    symbol: "bearbeiten",
                    kontext: name,
                    onclick: () =>
                      wartungDialog({ eintrag, schalter: aktiv, ctx, neu }),
                  }),
                knopf("Aufheben", {
                  klein: true,
                  symbol: "haken",
                  kontext: name,
                  onclick: () =>
                    (istSperre ? sperreAufheben : wartungAufheben)(
                      eintrag,
                      ctx,
                      neu,
                    ),
                }),
              ]
            : [
                istSperre
                  ? knopf("Sperren", {
                      klein: true,
                      art: "gefahr",
                      symbol: "sperre",
                      kontext: name,
                      onclick: () => sperreDialog({ eintrag, daten, ctx, neu }),
                    })
                  : knopf("Einschalten", {
                      klein: true,
                      symbol: "uhr",
                      kontext: name,
                      onclick: () =>
                        wartungDialog({ eintrag, schalter: aktiv, ctx, neu }),
                    }),
              ]),
        ),
      );
    }),
  }).wurzel;
}

function zeichne(bereich, ctx, daten, neu) {
  const alleBereiche = BEREICHE.filter(([s]) => daten.bereiche.includes(s));
  bereich.append(
    el(
      "p",
      { class: "meta" },
      "Im Wartungsmodus ist ein Bereich nur lesbar. Schreibende Anfragen und Bearbeitungsansichten antworten mit dem Hinweistext; Abteilungsleitung und Entwickler arbeiten weiter.",
    ),
    zustandsTabelle({
      art: "wartung",
      eintraege: alleBereiche,
      schalter: daten.schalter,
      ctx,
      daten,
      neu,
    }),
  );
  if (!daten.darfSperre) return;
  bereich.append(
    el("h2", { class: "abschnitt" }, "Informationssperre"),
    el(
      "p",
      { class: "meta" },
      "Bei einem Vorfall, zum Beispiel einer Datenpanne, liefert ein gesperrter Bereich keine Inhalte mehr, auch nicht der Abteilungsleitung. Nur diese Seite bleibt offen: Hier hebst du die Sperre wieder auf. Wer die Verwaltung nicht mehr erreicht, meldet sich an und öffnet diese Seite.",
    ),
    zustandsTabelle({
      art: "sperre",
      eintraege: alleBereiche,
      schalter: daten.schalter,
      ctx,
      daten,
      neu,
    }),
  );
}

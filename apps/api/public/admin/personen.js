import { anfrage } from "./api.js";
import {
  aktionenZelle,
  ankreuzen,
  auswahl,
  bestaetigen,
  chip,
  dialogFormular,
  el,
  feld,
  geheimnisDialog,
  gruppe,
  knopf,
  menue,
  tabelle,
  tag,
} from "./dom.js";

const ROLLEN = [
  ["", "Keine Rolle"],
  ["leitung", "Leitung"],
  ["stufenleitung", "Stufenleitung"],
];
const ROLLENNAME = { leitung: "Leitung", stufenleitung: "Stufenleitung" };

export function zeige(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", "/api/v1/admin/personen"),
    (daten, neu) => zeichne(bereich, ctx, daten, neu),
  );
}

// Rollen-Editor: eine Auswahl je Stufe
function rollenFelder(stufen, rollen) {
  const aktuell = new Map(rollen.map((r) => [r.stufeId, r.typ]));
  const zeilen = stufen.map((stufe) => {
    const auswahlfeld = auswahl({
      label: `Rolle in ${stufe.name}`,
      optionen: ROLLEN,
      wert: aktuell.get(stufe.id) ?? "",
    });
    auswahlfeld.eingabe.dataset.stufeId = stufe.id;
    return auswahlfeld;
  });
  return {
    wurzel: gruppe(
      "Stufenrollen",
      zeilen.length
        ? zeilen.map((z) => z.wurzel)
        : el("p", { class: "hilfe" }, "Es gibt noch keine Stufen."),
    ),
    wert: () =>
      zeilen
        .filter((z) => z.eingabe.value)
        .map((z) => ({
          stufeId: z.eingabe.dataset.stufeId,
          typ: z.eingabe.value,
        })),
  };
}

function kinderFelder(kinder, stufen, gewaehlt) {
  const stufenname = new Map(stufen.map((s) => [s.id, s.name]));
  const boxen = kinder.map((kind) =>
    ankreuzen({
      label: `${kind.vorname} ${kind.nachname} (${stufenname.get(kind.stufeId) ?? "ohne Stufe"})`,
      gewaehlt: gewaehlt.includes(kind.id),
      wert: kind.id,
    }),
  );
  return {
    wurzel: gruppe(
      "Elternteil von",
      boxen.length
        ? boxen.map((b) => b.wurzel)
        : el("p", { class: "hilfe" }, "Es gibt noch keine Kinder."),
      { scrollen: true },
    ),
    wert: () =>
      boxen.filter((b) => b.eingabe.checked).map((b) => b.eingabe.value),
  };
}

function anlegen(daten, ctx, neu) {
  const vorname = feld({ label: "Vorname", maxlength: 100, required: true });
  const nachname = feld({ label: "Nachname", maxlength: 100, required: true });
  const benutzername = feld({
    label: "Benutzername",
    hilfe:
      "3 bis 64 Zeichen: Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich. Gross- und Kleinschreibung zählt nicht.",
    maxlength: 64,
    autocapitalize: "none",
    spellcheck: "false",
    required: true,
  });
  const admin = ankreuzen({ label: "Admin-Rechte" });
  const rollen = rollenFelder(daten.stufen, []);
  const kinder = kinderFelder(daten.kinder, daten.stufen, []);
  dialogFormular({
    titel: "Person anlegen",
    beschreibung:
      "Die Person erhält ein Startpasswort. Es wird nur einmal angezeigt.",
    felder: [
      vorname.wurzel,
      nachname.wurzel,
      benutzername.wurzel,
      admin.wurzel,
      rollen.wurzel,
      kinder.wurzel,
    ],
    ok: "Anlegen",
    senden: () =>
      anfrage("POST", "/api/v1/admin/personen", {
        vorname: vorname.eingabe.value.trim(),
        nachname: nachname.eingabe.value.trim(),
        benutzername: benutzername.eingabe.value.trim(),
        admin: admin.eingabe.checked,
        rollen: rollen.wert(),
        elternteilVon: kinder.wert(),
      }),
    danach: (antwort) => {
      neu();
      ctx.melde(`Person «${antwort.benutzername}» ist angelegt.`);
      geheimnisDialog({
        titel: "Startpasswort",
        beschreibung: `Gib das Startpasswort für «${antwort.benutzername}» sicher weiter. Es gilt 7 Tage und wird nicht nochmals angezeigt.`,
        wert: antwort.startpasswort,
      });
    },
  });
}

function bearbeiten(person, daten, ctx, neu) {
  const name = feld({
    label: "Name",
    hilfe: "Vorname und Nachname in einem Feld.",
    wert: person.name,
    maxlength: 201,
    required: true,
  });
  const admin = ankreuzen({
    label: "Admin-Rechte",
    gewaehlt: person.admin,
  });
  const rollen = rollenFelder(daten.stufen, person.rollen);
  const kinder = kinderFelder(daten.kinder, daten.stufen, person.elternteilVon);
  dialogFormular({
    titel: `Person bearbeiten`,
    beschreibung: person.name,
    felder: [name.wurzel, admin.wurzel, rollen.wurzel, kinder.wurzel],
    ok: "Speichern",
    senden: () =>
      anfrage("PATCH", `/api/v1/admin/personen/${person.id}`, {
        name: name.eingabe.value.trim(),
        admin: admin.eingabe.checked,
        rollen: rollen.wert(),
        elternteilVon: kinder.wert(),
      }),
    danach: () => {
      neu();
      ctx.melde("Gespeichert.");
    },
  });
}

function neuesStartpasswort(person, ctx, neu) {
  bestaetigen({
    titel: "Neues Startpasswort erzeugen",
    beschreibung: `«${person.name}» wird überall abgemeldet und muss beim nächsten Login ein neues Passwort wählen. Das Startpasswort gilt 7 Tage.`,
    ok: "Startpasswort erzeugen",
    aktion: () =>
      anfrage("POST", `/api/v1/admin/personen/${person.id}/startpasswort`),
    danach: (antwort) => {
      neu();
      ctx.melde(`Neues Startpasswort für «${person.name}» ist erzeugt.`);
      geheimnisDialog({
        titel: "Startpasswort",
        beschreibung: `Gib das Startpasswort für «${person.name}» sicher weiter. Es gilt 7 Tage und wird nicht nochmals angezeigt.`,
        wert: antwort.startpasswort,
      });
    },
  });
}

function umschalten(person, ctx, neu) {
  const deaktivieren = !person.deaktiviert;
  bestaetigen({
    titel: deaktivieren ? "Person deaktivieren" : "Person aktivieren",
    beschreibung: deaktivieren
      ? `«${person.name}» kann sich nicht mehr anmelden und wird überall abgemeldet.`
      : `«${person.name}» kann sich wieder anmelden.`,
    ok: deaktivieren ? "Deaktivieren" : "Aktivieren",
    gefaehrlich: deaktivieren,
    aktion: () =>
      anfrage(
        "POST",
        `/api/v1/admin/personen/${person.id}/${deaktivieren ? "deaktivieren" : "aktivieren"}`,
      ),
    danach: () => {
      neu();
      ctx.melde(
        deaktivieren
          ? `«${person.name}» ist deaktiviert.`
          : `«${person.name}» ist aktiviert.`,
      );
    },
  });
}

function faktorZuruecksetzen(person, ctx, neu) {
  bestaetigen({
    titel: "Zweiten Faktor zurücksetzen",
    beschreibung: `«${person.name}» muss den zweiten Faktor danach neu einrichten.`,
    ok: "Zurücksetzen",
    aktion: () =>
      anfrage(
        "POST",
        `/api/v1/admin/personen/${person.id}/zweiter-faktor-zuruecksetzen`,
      ),
    danach: () => {
      neu();
      ctx.melde(`Der zweite Faktor von «${person.name}» ist zurückgesetzt.`);
    },
  });
}

const leer = () => el("span", { class: "leise" }, "–");

function zeile(person, daten, ctx, neu) {
  const stufenname = new Map(daten.stufen.map((s) => [s.id, s.name]));
  const kindname = new Map(
    daten.kinder.map((k) => [k.id, `${k.vorname} ${k.nachname}`]),
  );
  const eigenes = person.id === ctx.ich.id;
  const rollenTypen = [...new Set(person.rollen.map((r) => r.typ))];
  const status = [
    person.deaktiviert ? chip("Deaktiviert", "fehler") : chip("Aktiv", "ok"),
    person.zweiterFaktor && chip("2FA", "ok"),
    person.mussPasswortAendern &&
      chip(
        person.startpasswortGueltigBis
          ? `Startpasswort bis ${tag(person.startpasswortGueltigBis)}`
          : "Passwortwechsel offen",
        "warn",
      ),
  ];
  return el(
    "tr",
    {
      class: person.deaktiviert ? "inaktiv" : undefined,
      "data-suche": `${person.name} ${person.benutzername ?? ""}`.toLowerCase(),
    },
    el("th", { scope: "row" }, person.name, eigenes && " (du)"),
    el("td", {}, person.benutzername ?? leer()),
    el(
      "td",
      {},
      person.admin || rollenTypen.length > 0
        ? el("ul", { class: "chips" }, [
            person.admin && chip("Admin", "stufe"),
            ...rollenTypen.map((t) => chip(ROLLENNAME[t])),
          ])
        : leer(),
    ),
    el(
      "td",
      {},
      person.rollen.length > 0
        ? el(
            "ul",
            { class: "zeilen" },
            person.rollen.map((r) =>
              el(
                "li",
                {},
                `${stufenname.get(r.stufeId) ?? "Stufe"} (${ROLLENNAME[r.typ]})`,
              ),
            ),
          )
        : leer(),
    ),
    el(
      "td",
      {},
      person.elternteilVon.length > 0
        ? el(
            "ul",
            { class: "zeilen" },
            person.elternteilVon.map((id) =>
              el("li", {}, kindname.get(id) ?? "Kind"),
            ),
          )
        : leer(),
    ),
    el("td", {}, el("ul", { class: "chips" }, status)),
    aktionenZelle(
      knopf("Bearbeiten", {
        klein: true,
        kontext: person.name,
        onclick: () => bearbeiten(person, daten, ctx, neu),
      }),
      // Was die API für das eigene Konto ablehnt, gibt es gar nicht erst
      !eigenes &&
        menue(person.name, [
          {
            text: "Startpasswort",
            onclick: () => neuesStartpasswort(person, ctx, neu),
          },
          {
            text: person.deaktiviert ? "Aktivieren" : "Deaktivieren",
            gefaehrlich: !person.deaktiviert,
            onclick: () => umschalten(person, ctx, neu),
          },
          person.zweiterFaktor && {
            text: "Zweiten Faktor zurücksetzen",
            gefaehrlich: true,
            onclick: () => faktorZuruecksetzen(person, ctx, neu),
          },
        ]),
    ),
  );
}

function zeichne(bereich, ctx, daten, neu) {
  const { wurzel, koerper } = tabelle({
    beschriftung: "Personen",
    spalten: [
      "Name",
      "Benutzername",
      "Rollen",
      "Stufen",
      "Elternteil von",
      "Status",
      "Aktionen",
    ],
    zeilen: daten.personen.map((p) => zeile(p, daten, ctx, neu)),
  });
  const zaehler = el("p", { class: "meta zaehler", role: "status" });
  const suche = feld({ label: "Suchen", typ: "search", autocomplete: "off" });
  const aktualisiere = () => {
    const frage = suche.eingabe.value.trim().toLowerCase();
    let treffer = 0;
    for (const eintrag of koerper.children) {
      eintrag.hidden = !eintrag.dataset.suche.includes(frage);
      if (!eintrag.hidden) treffer++;
    }
    zaehler.textContent = `${treffer} von ${daten.personen.length} Personen`;
  };
  suche.eingabe.addEventListener("input", aktualisiere);
  aktualisiere();
  bereich.append(
    el(
      "div",
      { class: "werkzeuge" },
      suche.wurzel,
      zaehler,
      knopf("Person anlegen", {
        art: "haupt",
        onclick: () => anlegen(daten, ctx, neu),
      }),
    ),
    wurzel,
  );
}

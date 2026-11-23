import { anfrage } from "./api.js";
import {
  aktionenZelle,
  ankreuzen,
  auswahl,
  chip,
  dialogFormular,
  STANDARD_LOGO,
  el,
  feld,
  knopf,
  seitenwahl,
  tabelle,
} from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import { suchWahl } from "./personen-wahl.js";
import { leerKarte } from "./zustaende.js";

export function zeige(bereich, ctx) {
  ctx.lade(
    async () => {
      const [kinder, personen, stufen] = await Promise.all([
        anfrage("GET", "/api/v1/admin/kinder"),
        anfrage("GET", "/api/v1/admin/personen"),
        anfrage("GET", "/api/v1/stufen"),
      ]);
      return {
        kinder: kinder.kinder,
        personen: personen.personen,
        stufen: stufen.stufen,
      };
    },
    (daten, neu) => zeichne(bereich, ctx, daten, neu),
  );
}

const stufenOptionen = (stufen) =>
  stufen.map((s) => [s.id, s.name, s.logoUrl ?? STANDARD_LOGO]);

function anlegen(daten, ctx, neu) {
  const vorname = feld({ label: "Vorname", maxlength: 100, required: true });
  const nachname = feld({ label: "Nachname", maxlength: 100, required: true });
  const ceviName = feld({
    label: "Cevi-Name (optional)",
    maxlength: 50,
  });
  const stufe = auswahl({
    label: "Stufe",
    optionen: stufenOptionen(daten.stufen),
    wert: daten.stufen[0]?.id ?? "",
  });
  dialogFormular({
    titel: "Kind anlegen",
    beschreibung: "Elternteile verknüpfst du danach beim Bearbeiten.",
    felder: [vorname.wurzel, nachname.wurzel, ceviName.wurzel, stufe.wurzel],
    ok: "Anlegen",
    senden: () =>
      anfrage("POST", "/api/v1/admin/kinder", {
        vorname: vorname.eingabe.value.trim(),
        nachname: nachname.eingabe.value.trim(),
        ceviName: ceviName.eingabe.value,
        stufeId: stufe.eingabe.value,
      }),
    danach: () => {
      neu();
      ctx.melde("Kind ist angelegt.");
    },
  });
}

function bearbeiten(kind, daten, ctx, neu) {
  const vorname = feld({
    label: "Vorname",
    wert: kind.vorname,
    maxlength: 100,
    required: true,
  });
  const nachname = feld({
    label: "Nachname",
    wert: kind.nachname,
    maxlength: 100,
    required: true,
  });
  const ceviName = feld({
    label: "Cevi-Name (optional)",
    wert: kind.ceviName ?? "",
    maxlength: 50,
  });
  const stufe = auswahl({
    label: "Stufe",
    optionen: stufenOptionen(daten.stufen),
    wert: kind.stufeId,
  });
  const aktiv = ankreuzen({ label: "Aktiv", gewaehlt: kind.aktiv });
  const eltern = suchWahl({
    titel: "Elternteile",
    beschriftung: "Person suchen",
    kandidaten: daten.personen.map((p) => ({
      id: p.id,
      name: p.name,
      zusatz:
        [p.ceviName, p.deaktiviert && "deaktiviert"]
          .filter(Boolean)
          .join(" · ") || undefined,
      bildUrl: p.bildUrl,
    })),
    gewaehlt: kind.eltern,
    max: 10,
    leerText: "Es gibt noch keine Personen.",
    keinerText: "Noch keine Eltern verknüpft.",
  });
  dialogFormular({
    titel: "Kind bearbeiten",
    beschreibung: `${kind.vorname} ${kind.nachname}`,
    felder: [
      vorname.wurzel,
      nachname.wurzel,
      ceviName.wurzel,
      stufe.wurzel,
      aktiv.wurzel,
      eltern.wurzel,
    ],
    ok: "Speichern",
    senden: () =>
      anfrage("PATCH", `/api/v1/admin/kinder/${kind.id}`, {
        vorname: vorname.eingabe.value.trim(),
        nachname: nachname.eingabe.value.trim(),
        ceviName: ceviName.eingabe.value,
        stufeId: stufe.eingabe.value,
        aktiv: aktiv.eingabe.checked,
        eltern: eltern.wert(),
      }),
    danach: () => {
      neu();
      ctx.melde("Gespeichert.");
    },
  });
}

function elternZelle(kind, personen) {
  if (kind.eltern.length === 0) {
    return el("ul", { class: "chips" }, chip("Keine Eltern verknüpft", "warn"));
  }
  return el(
    "ul",
    { class: "zeilen" },
    kind.eltern.map((id) => {
      const person = personen.get(id);
      return el(
        "li",
        { class: "eltern-zeile" },
        person?.name ?? "Person",
        person?.deaktiviert &&
          el("ul", { class: "chips" }, chip("Konto deaktiviert", "fehler")),
      );
    }),
  );
}

function zeichne(bereich, ctx, daten, neu) {
  const stufenname = new Map(daten.stufen.map((s) => [s.id, s.name]));
  const personen = new Map(daten.personen.map((p) => [p.id, p]));
  ctx.kopfAktion(
    daten.stufen.length > 0
      ? knopf("Kind anlegen", {
          art: "haupt",
          symbol: "plus",
          onclick: () => anlegen(daten, ctx, neu),
        })
      : el("p", { class: "hilfe" }, "Lege zuerst eine Stufe an."),
  );
  if (daten.kinder.length === 0) {
    bereich.append(
      leerKarte(
        daten.stufen.length > 0
          ? "Es gibt noch keine Kinder. Lege das erste an oder übernimm eine Liste über «Import»."
          : "Es gibt noch keine Kinder. Lege zuerst eine Stufe an.",
        [],
      ),
    );
    return;
  }
  const eintraege = daten.kinder.map((kind) => {
    const name = `${kind.vorname} ${kind.nachname}`;
    return {
      kind,
      suche: `${name} ${kind.ceviName ?? ""}`.toLowerCase(),
      tr: el(
        "tr",
        { class: kind.aktiv ? undefined : "inaktiv" },
        el(
          "th",
          { scope: "row" },
          el("span", { class: "name" }, name),
          kind.ceviName && el("span", { class: "leise" }, kind.ceviName),
        ),
        el(
          "td",
          {},
          el(
            "ul",
            { class: "chips" },
            chip(stufenname.get(kind.stufeId) ?? "Ohne Stufe", "stufe"),
          ),
        ),
        el("td", {}, elternZelle(kind, personen)),
        el(
          "td",
          {},
          el(
            "ul",
            { class: "chips" },
            kind.aktiv
              ? chip("Aktiv", "ok")
              : chip("Inaktiv", undefined, "schliessen"),
          ),
        ),
        aktionenZelle(
          knopf("Bearbeiten", {
            klein: true,
            symbol: "bearbeiten",
            kontext: name,
            onclick: () => bearbeiten(kind, daten, ctx, neu),
          }),
        ),
      ),
    };
  });
  const { wurzel, koerper } = tabelle({
    beschriftung: "Kinder",
    spalten: ["Kind", "Stufe", "Eltern", "Zustand", "Aktionen"],
    zeilen: [],
  });
  const ohneEltern = daten.kinder.filter((k) => k.eltern.length === 0).length;
  const keine = el("div");
  const seiten = seitenwahl({ beiWechsel: () => aktualisiere() });
  const leiste = filterleiste({
    suche: { label: "Name oder Cevi-Name" },
    filter: [
      {
        schluessel: "stufe",
        label: "Stufe",
        optionen: [
          ["", "Alle Stufen"],
          ...daten.stufen.map((s) => [s.id, s.name]),
        ],
      },
      {
        schluessel: "eltern",
        label: "Eltern",
        optionen: [
          ["", "Alle"],
          ["ohne", "Ohne Eltern"],
        ],
      },
    ],
    namen: { einzahl: "Kind", mehrzahl: "Kinder" },
    beiAenderung: () => {
      seiten.anfang();
      aktualisiere();
    },
  });
  function aktualisiere() {
    const { suche, filter } = leiste.stand();
    const frage = suche.trim().toLowerCase();
    const treffer = eintraege.filter(
      (e) =>
        e.suche.includes(frage) &&
        (!filter.stufe || e.kind.stufeId === filter.stufe) &&
        (filter.eltern !== "ohne" || e.kind.eltern.length === 0),
    );
    const [von, bis] = seiten.fenster(treffer.length);
    koerper.replaceChildren(...treffer.slice(von, bis).map((e) => e.tr));
    wurzel.hidden = treffer.length === 0;
    leiste.setzeTreffer(treffer.length, daten.kinder.length);
    keine.replaceChildren(
      treffer.length === 0
        ? leerKarte("Kein Kind passt zu diesen Filtern.", [
            knopf("Filter zurücksetzen", {
              onclick: () => leiste.setzeAlles(),
            }),
          ])
        : [],
    );
  }
  aktualisiere();
  bereich.append(
    ...[
      ohneEltern > 0 &&
        el(
          "p",
          { class: "hinweis hinweis--warn" },
          ohneEltern === 1
            ? "1 Kind hat noch keine Eltern verknüpft."
            : `${ohneEltern} Kinder haben noch keine Eltern verknüpft.`,
        ),
      leiste.wurzel,
      keine,
      wurzel,
      seiten.wurzel,
    ].filter(Boolean),
  );
}

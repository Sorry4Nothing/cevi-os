import { anfrage } from "./api.js";
import {
  ankreuzen,
  auswahl,
  chip,
  dialogFormular,
  el,
  feld,
  gruppe,
  knopf,
} from "./dom.js";

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

const stufenOptionen = (stufen) => stufen.map((s) => [s.id, s.name]);

function anlegen(daten, ctx, neu) {
  const vorname = feld({ label: "Vorname", maxlength: 100, required: true });
  const nachname = feld({ label: "Nachname", maxlength: 100, required: true });
  const stufe = auswahl({
    label: "Stufe",
    optionen: stufenOptionen(daten.stufen),
    wert: daten.stufen[0]?.id ?? "",
  });
  dialogFormular({
    titel: "Kind anlegen",
    beschreibung: "Elternteile verknüpfst du danach beim Bearbeiten.",
    felder: [vorname.wurzel, nachname.wurzel, stufe.wurzel],
    ok: "Anlegen",
    senden: () =>
      anfrage("POST", "/api/v1/admin/kinder", {
        vorname: vorname.eingabe.value.trim(),
        nachname: nachname.eingabe.value.trim(),
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
  const stufe = auswahl({
    label: "Stufe",
    optionen: stufenOptionen(daten.stufen),
    wert: kind.stufeId,
  });
  const aktiv = ankreuzen({ label: "Aktiv", gewaehlt: kind.aktiv });
  const boxen = daten.personen.map((person) =>
    ankreuzen({
      label: `${person.name} (${person.benutzername ?? "ohne Benutzernamen"})`,
      gewaehlt: kind.eltern.includes(person.id),
      wert: person.id,
    }),
  );
  dialogFormular({
    titel: "Kind bearbeiten",
    beschreibung: `${kind.vorname} ${kind.nachname}`,
    felder: [
      vorname.wurzel,
      nachname.wurzel,
      stufe.wurzel,
      aktiv.wurzel,
      gruppe(
        "Elternteile (höchstens 10)",
        boxen.map((b) => b.wurzel),
        { scrollen: true },
      ),
    ],
    ok: "Speichern",
    senden: () =>
      anfrage("PATCH", `/api/v1/admin/kinder/${kind.id}`, {
        vorname: vorname.eingabe.value.trim(),
        nachname: nachname.eingabe.value.trim(),
        stufeId: stufe.eingabe.value,
        aktiv: aktiv.eingabe.checked,
        eltern: boxen
          .filter((b) => b.eingabe.checked)
          .map((b) => b.eingabe.value),
      }),
    danach: () => {
      neu();
      ctx.melde("Gespeichert.");
    },
  });
}

function zeichne(bereich, ctx, daten, neu) {
  const stufenname = new Map(daten.stufen.map((s) => [s.id, s.name]));
  const personenname = new Map(daten.personen.map((p) => [p.id, p.name]));
  const liste = el(
    "ul",
    { class: "liste", "aria-label": "Kinder" },
    daten.kinder.map((kind) =>
      el(
        "li",
        {
          class: kind.aktiv ? "karte" : "karte karte--inaktiv",
          "data-suche": `${kind.vorname} ${kind.nachname}`.toLowerCase(),
        },
        el("h3", {}, `${kind.vorname} ${kind.nachname}`),
        el(
          "ul",
          { class: "chips" },
          chip(stufenname.get(kind.stufeId) ?? "Ohne Stufe", "stufe"),
          chip(kind.aktiv ? "Aktiv" : "Inaktiv", kind.aktiv ? "ok" : "fehler"),
        ),
        el(
          "p",
          { class: "meta" },
          kind.eltern.length > 0
            ? `Eltern: ${kind.eltern.map((id) => personenname.get(id) ?? "Person").join(", ")}`
            : "Keine Eltern verknüpft",
        ),
        el(
          "div",
          { class: "aktionen" },
          knopf("Bearbeiten", {
            kontext: `${kind.vorname} ${kind.nachname}`,
            onclick: () => bearbeiten(kind, daten, ctx, neu),
          }),
        ),
      ),
    ),
  );
  const zaehler = el("p", { class: "meta", role: "status" });
  const suche = feld({ label: "Suchen", typ: "search", autocomplete: "off" });
  const aktualisiere = () => {
    const frage = suche.eingabe.value.trim().toLowerCase();
    let treffer = 0;
    for (const eintrag of liste.children) {
      eintrag.hidden = !eintrag.dataset.suche.includes(frage);
      if (!eintrag.hidden) treffer++;
    }
    zaehler.textContent = `${treffer} von ${daten.kinder.length} Kindern`;
  };
  suche.eingabe.addEventListener("input", aktualisiere);
  aktualisiere();
  bereich.append(
    el(
      "div",
      { class: "werkzeuge" },
      suche.wurzel,
      daten.stufen.length > 0
        ? knopf("Kind anlegen", {
            art: "haupt",
            onclick: () => anlegen(daten, ctx, neu),
          })
        : el("p", { class: "hilfe" }, "Lege zuerst eine Stufe an."),
    ),
    zaehler,
    liste,
  );
}

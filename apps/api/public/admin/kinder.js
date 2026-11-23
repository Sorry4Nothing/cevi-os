import { anfrage, fehlertext } from "./api.js";
import {
  aktionenZelle,
  ankreuzen,
  auswahl,
  avatar,
  chip,
  STANDARD_LOGO,
  el,
  feld,
  flussKopf,
  knopf,
  neueId,
  seitenwahl,
  tabelle,
} from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import { oeffneFluss } from "./fluss.js";
import { formularRaster } from "./formularraster.js";
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

function karte(titel, text, ...inhalt) {
  return el(
    "section",
    { class: "pe-karte" },
    el("h2", {}, titel),
    text && el("p", { class: "leise" }, text),
    ...inhalt,
  );
}

// Zugang eines Kindes: Sehen kann es in der App nur, wer als Elternteil verknüpft ist. Ein Kind ohne Elternteil hat keinen Zugang: nicht gleich ein Fehler, aber für die App unsichtbar
const zugangChip = (mitEltern) =>
  mitEltern
    ? chip("Eltern verknüpft", "ok")
    : chip("Kein Zugang", undefined, "info");

// In der Liste steht ohne Eltern nur ruhiger Text: Dutzende gleiche Chips untereinander wirken wie ein Alarm
const keinZugangText = () => el("span", { class: "leise" }, "Kein Zugang");

// Eine Seite im Fluss zum Anlegen (kind = null) und Bearbeiten, aufgebaut wie die Seite einer Person: Karten links, das Kind mit seinem Zustand rechts
function oeffneKind({ kind, daten, ctx, neu }) {
  const titelId = neueId("titel");
  const zurueck = document.activeElement;
  const vorname = feld({
    label: "Vorname",
    wert: kind?.vorname ?? "",
    maxlength: 100,
    required: true,
  });
  const nachname = feld({
    label: "Nachname",
    wert: kind?.nachname ?? "",
    maxlength: 100,
    required: true,
  });
  const ceviName = feld({
    label: "Cevi-Name (optional)",
    wert: kind?.ceviName ?? "",
    maxlength: 50,
  });
  const stufe = auswahl({
    label: "Stufe",
    optionen: stufenOptionen(daten.stufen),
    wert: kind?.stufeId ?? daten.stufen[0]?.id ?? "",
  });
  const aktiv = kind
    ? ankreuzen({ label: "Aktiv", gewaehlt: kind.aktiv })
    : null;
  const eltern = kind
    ? suchWahl({
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
      })
    : null;

  // Rechts: das Kind, wie die Verwaltung es zeigt; folgt den Feldern
  const bild = el("div", { class: "pe-bild" });
  const name = el("p", { class: "pe-profil-name" });
  const zusatz = el("p", { class: "leise" });
  const chips = el("ul", { class: "chips" });
  const stufenname = new Map(daten.stufen.map((s) => [s.id, s.name]));
  const zugang = el("p", { class: "klein", role: "status" });
  const zeichneProfil = () => {
    const voll =
      `${vorname.eingabe.value.trim()} ${nachname.eingabe.value.trim()}`.trim();
    bild.replaceChildren(avatar(voll || "Neues Kind", { hell: true }));
    name.textContent = voll || "Neues Kind";
    zusatz.textContent = ceviName.eingabe.value.trim();
    const mitEltern = eltern ? eltern.wert().length > 0 : false;
    chips.replaceChildren(
      chip(stufenname.get(stufe.eingabe.value) ?? "Ohne Stufe", "stufe"),
      aktiv && !aktiv.eingabe.checked
        ? chip("Inaktiv", undefined, "schliessen")
        : chip("Aktiv", "ok"),
      ...(kind ? [zugangChip(mitEltern)] : []),
    );
    zugang.textContent = mitEltern
      ? "Zugang: Die verknüpften Eltern sehen die Programme und den Chat der Stufe."
      : "Zugang: keiner. Ohne verknüpften Elternteil kann niemand das Kind in der App sehen.";
  };
  for (const f of [vorname, nachname, ceviName, stufe]) {
    f.eingabe.addEventListener("input", zeichneProfil);
    f.eingabe.addEventListener("change", zeichneProfil);
  }
  aktiv?.eingabe.addEventListener("change", zeichneProfil);
  eltern?.wurzel.addEventListener("change", zeichneProfil);

  const fehler = el("div", { class: "pe-zusammenfassung" });
  const speichern = el(
    "button",
    { type: "submit", class: "knopf knopf--haupt" },
    kind ? "Speichern" : "Anlegen",
  );
  const abbrechen = knopf("Abbrechen", {
    onclick: () => seite.versuchSchliessen(),
  });
  const formular = el(
    "form",
    { class: "pe-formular", novalidate: true },
    karte(
      "Angaben",
      null,
      el("div", { class: "pe-paar" }, vorname.wurzel, nachname.wurzel),
      ceviName.wurzel,
    ),
    karte(
      "Stufe",
      "Die Stufe bestimmt, welche Programme und welchen Chat die Eltern sehen.",
      stufe.wurzel,
      aktiv &&
        el(
          "div",
          { class: "pe-wahlfeld" },
          aktiv.wurzel,
          el(
            "p",
            { class: "hilfe" },
            "Ein inaktives Kind bleibt gespeichert, öffnet seinen Eltern aber keinen Zugang mehr zur Stufe.",
          ),
        ),
    ),
    karte(
      "Eltern und Zugang",
      kind
        ? "Eltern sehen die Programme und den Chat der Stufe ihres Kindes. Verknüpfe nur auf Angabe der Erziehungsberechtigten."
        : "Elternteile verknüpfst du, sobald das Kind angelegt ist.",
      eltern?.wurzel,
      kind && zugang,
    ),
    el("div", { class: "pe-fuss" }, fehler, abbrechen, speichern),
  );
  const { kopf } = flussKopf({
    titelId,
    titel: kind ? `${kind.vorname} ${kind.nachname}` : "Kind anlegen",
    untertitel: kind?.ceviName ?? undefined,
    beschreibung: kind
      ? undefined
      : "Eltern verknüpfst du danach, sobald das Kind angelegt ist.",
    beiZurueck: () => seite.versuchSchliessen(),
  });
  const seite = el(
    "section",
    { class: "fluss-seite fluss-breit pe-seite", "aria-labelledby": titelId },
    kopf,
    formularRaster({
      felder: formular,
      seite: el(
        "div",
        { class: "pe-profil" },
        bild,
        name,
        zusatz,
        chips,
        el("p", { class: "hilfe" }, "Von Kindern gibt es kein Profilbild."),
      ),
      seiteTitel: "Kind",
    }),
  );
  zeichneProfil();

  formular.addEventListener("submit", async (ereignis) => {
    ereignis.preventDefault();
    fehler.replaceChildren();
    const fehlt = [vorname, nachname].filter((f) => !f.eingabe.value.trim());
    if (fehlt.length > 0) {
      const hinweis = el(
        "p",
        { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
        "Bitte Vorname und Nachname ausfüllen.",
      );
      fehler.append(hinweis);
      hinweis.focus();
      return;
    }
    abbrechen.disabled = speichern.disabled = true;
    speichern.setAttribute("aria-busy", "true");
    try {
      const body = {
        vorname: vorname.eingabe.value.trim(),
        nachname: nachname.eingabe.value.trim(),
        ceviName: ceviName.eingabe.value,
        stufeId: stufe.eingabe.value,
      };
      if (kind) {
        await anfrage("PATCH", `/api/v1/admin/kinder/${kind.id}`, {
          ...body,
          aktiv: aktiv.eingabe.checked,
          eltern: eltern.wert(),
        });
      } else {
        await anfrage("POST", "/api/v1/admin/kinder", body);
      }
      seite.close();
      neu();
      ctx.melde(kind ? "Gespeichert." : "Kind ist angelegt.");
    } catch (f) {
      const hinweis = el(
        "p",
        { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
        fehlertext(f),
      );
      fehler.replaceChildren(hinweis);
      hinweis.focus();
    } finally {
      abbrechen.disabled = speichern.disabled = false;
      speichern.removeAttribute("aria-busy");
    }
  });
  seite.addEventListener("close", () => {
    // Zurück zum Auslöser; ist er nach dem Neuladen weg, bleibt der Fokus beim Titel der Seite
    if (zurueck?.isConnected) zurueck.focus({ preventScroll: true });
    else document.querySelector("h1")?.focus();
  });
  oeffneFluss(seite);
  vorname.eingabe.focus();
}

function elternZelle(kind, personen) {
  if (kind.eltern.length === 0) {
    return keinZugangText();
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
          onclick: () => oeffneKind({ kind: null, daten, ctx, neu }),
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
            onclick: () => oeffneKind({ kind, daten, ctx, neu }),
          }),
        ),
      ),
    };
  });
  const { wurzel, koerper } = tabelle({
    beschriftung: "Kinder",
    spalten: ["Kind", "Stufe", "Zugang", "Zustand", "Aktionen"],
    zeilen: [],
  });
  const ohneZugang = daten.kinder.filter((k) => k.eltern.length === 0).length;
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
        schluessel: "zugang",
        label: "Zugang",
        optionen: [
          ["", "Alle"],
          ["ohne", "Ohne Zugang"],
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
        (filter.zugang !== "ohne" || e.kind.eltern.length === 0),
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
      ohneZugang > 0 &&
        el(
          "p",
          { class: "hinweis" },
          ohneZugang === 1
            ? "1 Kind hat keinen Zugang: Ohne verknüpften Elternteil kann niemand es in der App sehen."
            : `${ohneZugang} Kinder haben keinen Zugang: Ohne verknüpften Elternteil kann niemand sie in der App sehen.`,
        ),
      leiste.wurzel,
      keine,
      wurzel,
      seiten.wurzel,
    ].filter(Boolean),
  );
}

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
  rufname,
  vollerNameZusatz,
} from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import { oeffneFluss } from "./fluss.js";
import { formularRaster } from "./formularraster.js";
import { suchWahl } from "./personen-wahl.js";
import { skeletonTabelle } from "./lader.js";
import {
  abschnitte,
  ansichtsleiste,
  gespeicherteAnsicht,
  gliedere,
  mitgliedKarte,
  mitgliedKopf,
  skeletonKarten,
  stufenKennzeichen,
  zeichneAnsicht,
} from "./mitglieder.js";
import {
  kontoKarte,
  oeffneKontoEinstellung,
  zugangMarke,
  zugangText,
  zugangVon,
} from "./kinder-konto.js";
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
        einstellung: kinder.einstellung,
        personen: personen.personen,
        stufen: stufen.stufen,
      };
    },
    (daten, neu) => zeichne(bereich, ctx, daten, neu),
    {
      skeleton: () =>
        gespeicherteAnsicht() === "liste"
          ? skeletonTabelle({ spalten: 4 })
          : skeletonKarten(),
    },
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

// Zugang eines Kindes: Sehen kann es in der App, wer als Elternteil verknüpft ist (und Einsicht hat) oder wer das eigene Konto des Kindes ist. Ein Kind ohne beides hat keinen Zugang: nicht gleich ein Fehler, aber für die App unsichtbar
const zugangChip = (zugang) =>
  zugang === "keiner"
    ? chip(zugangText(zugang), undefined, "info")
    : chip(zugangText(zugang), "ok");

const ZUGANG_ERKLAERUNG = {
  keiner:
    "Zugang: keiner. Ohne verknüpften Elternteil und ohne eigenes Konto kann niemand das Kind in der App sehen.",
  eltern:
    "Zugang: Die verknüpften Eltern sehen die Programme und den Chat der Stufe.",
  konto:
    "Zugang: Das Kind sieht die Programme seiner Stufe mit seinem eigenen Konto. Die Eltern sehen nichts.",
  beides:
    "Zugang: Das Kind sieht die Programme seiner Stufe mit seinem eigenen Konto, die verknüpften Eltern sehen sie auch.",
};

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
          name: rufname(p),
          zusatz:
            [vollerNameZusatz(p), p.deaktiviert && "deaktiviert"]
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
    const art = zugangVon(
      eltern ? eltern.wert().length : 0,
      Boolean(kind?.konto),
      kind?.konto?.elternEinsicht ?? true,
    );
    chips.replaceChildren(
      chip(stufenname.get(stufe.eingabe.value) ?? "Ohne Stufe", "stufe"),
      aktiv && !aktiv.eingabe.checked
        ? chip("Inaktiv", undefined, "schliessen")
        : chip("Aktiv", "ok"),
      ...(kind ? [zugangChip(art)] : []),
    );
    zugang.textContent = ZUGANG_ERKLAERUNG[art];
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
        : "Elternteile und ein eigenes Konto richtest du ein, sobald das Kind angelegt ist.",
      eltern?.wurzel,
      kind && zugang,
    ),
    kind &&
      kontoKarte({
        kind,
        einstellung: daten.einstellung,
        ctx,
        neu,
        schliesse: () => seite.close(),
      }),
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

// Eltern als Text: Wer als Elternteil verknüpft ist, steht mit Namen da; ein deaktiviertes Konto trägt den Zusatz
function elternText(kind, personen) {
  return kind.eltern
    .map((id) => {
      const person = personen.get(id);
      return `${person?.name ?? "Person"}${person?.deaktiviert ? " (Konto deaktiviert)" : ""}`;
    })
    .join(", ");
}

// Ansicht und Gruppierung bleiben beim Neuladen nach einer Aktion; die Ansicht merkt sich mitglieder.js im Browser
const zustand = { gruppierung: "stufe" };

const GRUPPIERUNGEN = [
  ["stufe", "Stufe"],
  ["zugang", "Zugang"],
  ["keine", "Keine"],
];

function zeichne(bereich, ctx, daten, neu) {
  const stufenname = new Map(daten.stufen.map((s) => [s.id, s.name]));
  const personen = new Map(daten.personen.map((p) => [p.id, p]));
  ctx.kopfAktion(
    knopf("Konten für Kinder", {
      symbol: "schluessel",
      onclick: () =>
        oeffneKontoEinstellung({ einstellung: daten.einstellung, ctx, neu }),
    }),
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
  // Steht das Kind schon unter dem Titel seiner Stufe, nennt die Karte sie nicht nochmals
  const stufeChips = (kind, mitStufe = true) =>
    mitStufe || !kind.aktiv
      ? el(
          "ul",
          { class: "chips" },
          mitStufe &&
            chip(stufenname.get(kind.stufeId) ?? "Ohne Stufe", "stufe", false),
          !kind.aktiv && chip("Inaktiv", undefined, "schliessen"),
        )
      : null;
  // Zugang als ruhige Marke: Ein Kind ohne Elternteil und ohne eigenes Konto ist für die App unsichtbar, aber kein Fehler
  const zugang = (kind) => zugangMarke(kind.zugang);
  const eintraege = daten.kinder.map((kind) => {
    const name = `${kind.vorname} ${kind.nachname}`;
    return {
      kind,
      name,
      suche: `${name} ${kind.ceviName ?? ""}`.toLowerCase(),
    };
  });
  const bearbeiten = (e) =>
    knopf("Bearbeiten", {
      klein: true,
      symbol: "bearbeiten",
      kontext: e.name,
      onclick: () => oeffneKind({ kind: e.kind, daten, ctx, neu }),
    });
  // Wer das Kind sieht, in einem Satz: die Eltern und, wenn vorhanden, das Konto mit Benutzername und Stand
  const kartenHinweis = (kind) => {
    const teile = [
      kind.eltern.length > 0 && `Eltern: ${elternText(kind, personen)}`,
      kind.konto &&
        `Konto: ${kind.konto.benutzername ?? "–"}${kind.konto.gesperrt ? " (gesperrt)" : ""}${kind.konto.elternEinsicht ? "" : ", Eltern ohne Einsicht"}`,
    ].filter(Boolean);
    return (
      teile.length > 0 && el("p", { class: "mg-hinweis" }, teile.join(" · "))
    );
  };
  const karte = (e) =>
    mitgliedKarte({
      id: e.kind.id,
      aus: !e.kind.aktiv,
      kopf: mitgliedKopf({
        name: e.name,
        ceviName: e.kind.ceviName,
        vorname: e.kind.vorname,
        gross: true,
        ton: "stufe",
        zusatz: zugang(e.kind),
      }),
      rollen: stufeChips(e.kind, ansicht.stand().gruppierung !== "stufe"),
      hinweis: kartenHinweis(e.kind),
      aktionen: bearbeiten(e),
    });
  const zeile = (e) =>
    el(
      "tr",
      { class: e.kind.aktiv ? undefined : "inaktiv" },
      el(
        "th",
        { scope: "row" },
        mitgliedKopf({
          name: e.name,
          ceviName: e.kind.ceviName,
          vorname: e.kind.vorname,
          ton: "stufe",
        }),
      ),
      el("td", {}, stufeChips(e.kind)),
      el(
        "td",
        {},
        el(
          "div",
          { class: "mg-text" },
          zugang(e.kind),
          e.kind.eltern.length > 0 &&
            el("span", { class: "mg-zweit" }, elternText(e.kind, personen)),
          e.kind.konto &&
            el(
              "span",
              { class: "mg-zweit" },
              `Konto: ${e.kind.konto.benutzername ?? "–"}${e.kind.konto.gesperrt ? " (gesperrt)" : ""}`,
            ),
        ),
      ),
      aktionenZelle(bearbeiten(e)),
    );

  const ohneZugang = daten.kinder.filter((k) => k.zugang === "keiner").length;
  const keine = el("div");
  const liste = el("div", { class: "mg-ansicht" });
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
          ["konto", "Mit eigenem Konto"],
        ],
      },
    ],
    namen: { einzahl: "Kind", mehrzahl: "Kinder" },
    beiAenderung: () => {
      seiten.anfang();
      aktualisiere();
    },
  });
  const ansicht = ansichtsleiste({
    gruppierungen: GRUPPIERUNGEN,
    gruppierung: zustand.gruppierung,
    beiAenderung: (neuerStand) => {
      zustand.gruppierung = neuerStand.gruppierung;
      seiten.anfang();
      aktualisiere(true);
    },
  });

  // Abschnitte nach Stufe (mit Kennzeichen) oder nach Zugang; «keine» zeigt alles in einem Raster
  const gruppenFuer = (art) =>
    art === "stufe"
      ? {
          gruppen: [
            ...daten.stufen.map((s) => ({
              schluessel: s.id,
              titel: s.name,
              kennzeichen: stufenKennzeichen(s),
            })),
            { schluessel: "", titel: "Ohne Stufe" },
          ],
          schluesselVon: (e) =>
            stufenname.has(e.kind.stufeId) ? e.kind.stufeId : "",
        }
      : art === "zugang"
        ? {
            gruppen: [
              { schluessel: "eltern", titel: "Eltern verknüpft" },
              { schluessel: "beides", titel: "Eltern und eigenes Konto" },
              { schluessel: "konto", titel: "Eigenes Konto" },
              { schluessel: "keiner", titel: "Ohne Zugang" },
            ],
            schluesselVon: (e) => e.kind.zugang,
          }
        : { gruppen: null, schluesselVon: () => "" };

  function aktualisiere(animiert = false) {
    const { suche, filter } = leiste.stand();
    const { ansicht: art, gruppierung } = ansicht.stand();
    const frage = suche.trim().toLowerCase();
    const treffer = eintraege.filter(
      (e) =>
        e.suche.includes(frage) &&
        (!filter.stufe || e.kind.stufeId === filter.stufe) &&
        (filter.zugang !== "ohne" || e.kind.zugang === "keiner") &&
        (filter.zugang !== "konto" || e.kind.konto !== null),
    );
    const { gruppen, schluesselVon } = gruppenFuer(gruppierung);
    const { geordnet, gesamt } = gliedere(treffer, gruppen, schluesselVon);
    const [von, bis] = seiten.fenster(geordnet.length);
    zeichneAnsicht(liste, {
      ansicht: art,
      beschriftung: "Kinder",
      spalten: ["Kind", "Stufe", "Zugang", "Aktionen"],
      abschnitte: abschnitte(
        geordnet.slice(von, bis),
        gruppen,
        schluesselVon,
        gesamt,
      ),
      karte,
      zeile,
      animiert,
    });
    liste.hidden = treffer.length === 0;
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
  aktualisiere(true);
  bereich.append(
    ...[
      ohneZugang > 0 &&
        el(
          "p",
          { class: "hinweis" },
          ohneZugang === 1
            ? "1 Kind hat keinen Zugang: Ohne verknüpften Elternteil und ohne eigenes Konto kann niemand es in der App sehen."
            : `${ohneZugang} Kinder haben keinen Zugang: Ohne verknüpften Elternteil und ohne eigenes Konto kann niemand sie in der App sehen.`,
        ),
      leiste.wurzel,
      ansicht.wurzel,
      keine,
      liste,
      seiten.wurzel,
    ].filter(Boolean),
  );
}

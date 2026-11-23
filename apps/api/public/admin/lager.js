import { anfrage } from "./api.js";
import { splitKnopf, bestaetigungAmOrt } from "./aktionen.js";
import { filterleiste } from "./filterleiste.js";
import { auswahl, dialogFormular, el, knopf, tabelle } from "./dom.js";
import { skeletonFlaeche, skeletonTabelle } from "./lader.js";
import { macheSortierbar, seitenleiste, sortiere } from "./liste-hilfen.js";
import { leerKarte } from "./zustaende.js";
import {
  ADRESSE,
  haenge,
  BASIS,
  beschrifteZellen,
  kartenTabelle,
  ID,
  ROLLEN,
  feldFehler,
  grunddaten,
  knopfMit,
  meldung,
  merkeMeldung,
  nichtGefunden,
  statusChip,
  symbol,
  zeigeWartende,
  zeitraum,
  zurueckLink,
} from "./lager-gemeinsam.js";

// Bereich «Lager», Unterseite «Lager» (#527, Boards A20, A22, A29; #592): Liste, Detail mit einer Hauptaktion und Varianten (geteilter Knopf), Löschen mit Namenseingabe am Ort. Adressen: #lager/lager, …/neu (und …/neu/<schritt>), …/<id>, …/<id>/mitglieder, …/<id>/rechte, …/<id>/ausdrucke. Kein Polling; die Liste ist eine Abfrage, das Detail zwei (Lager und Mitglieder).

export function zeige(bereich, ctx) {
  const [erster, zweiter, weiter] = ctx.pfad;
  if (erster === undefined) return liste(bereich, ctx);
  if (erster === "neu")
    return import("./lager-anlegen.js").then((m) => m.zeige(bereich, ctx));
  if (!ID.test(erster) || weiter !== undefined)
    return ctx.lade(nichtGefunden, () => {});
  if (zweiter === undefined) return detail(bereich, ctx, erster);
  if (zweiter === "mitglieder")
    return import("./lager-mitglieder.js").then((m) =>
      m.zeige(bereich, ctx, erster),
    );
  if (zweiter === "rechte")
    return import("./lager-rechte.js").then((m) =>
      m.zeige(bereich, ctx, erster),
    );
  if (zweiter === "ausdrucke")
    return import("./lager-ausdrucke.js").then((m) =>
      m.zeige(bereich, ctx, erster),
    );
  return ctx.lade(nichtGefunden, () => {});
}

// Liste (A20) ---------------------------------------------------------------

const STATUS_FILTER = [
  ["alle", "Alle"],
  ["aktiv", "Aktiv"],
  ["entwurf", "Entwurf"],
  ["abgeschlossen", "Abgeschlossen"],
  ["archiviert", "Archiviert"],
];
const STATUS_FOLGE = ["entwurf", "aktiv", "abgeschlossen", "archiviert"];

function liste(bereich, ctx) {
  zeigeWartende(ctx);
  ctx.kopfAktion(
    knopf("Neues Lager", {
      art: "haupt",
      symbol: "plus",
      onclick: () => (location.hash = `${ADRESSE}/neu`),
    }),
  );
  ctx.lade(
    () => anfrage("GET", BASIS),
    (daten) => zeichneListe(bereich, daten.lager),
    {
      skeleton: () => skeletonTabelle({ spalten: 4, zeilen: 3, avatar: false }),
    },
  );
}

function zeichneListe(bereich, alle) {
  if (alle.length === 0) {
    bereich.append(leerKarte("Es gibt noch kein Lager. Lege das erste an."));
    return;
  }
  const zustand = { schluessel: "von", richtung: "ab" };
  const stand = { suche: "", filter: { status: "alle" } };
  // «Alle» zeigt keine archivierten Lager; sie stehen unter ihrem eigenen Filter
  const gibtArchiv = alle.some((l) => l.status === "archiviert");
  const leiste = filterleiste({
    suche: { label: "Lager suchen" },
    filter: [
      {
        schluessel: "status",
        label: "Status",
        grundwert: "alle",
        optionen: STATUS_FILTER.filter(
          ([g]) => g !== "archiviert" || gibtArchiv,
        ),
      },
    ],
    namen: { einzahl: "Lager", mehrzahl: "Lager" },
    beiAenderung: (neu) => {
      stand.suche = neu.suche.trim().toLowerCase();
      stand.filter = neu.filter;
      seiten.anfang();
      zeichne();
    },
  });
  const seiten = seitenleiste({ beiWechsel: () => zeichne() });
  const { wurzel: rahmen, koerper } = tabelle({
    beschriftung: "Lager",
    spalten: ["Name", "Zeitraum", "Ort", "Status"],
    zeilen: [],
  });
  kartenTabelle(rahmen);
  macheSortierbar(
    rahmen,
    [
      { index: 0, schluessel: "name", name: "Name" },
      { index: 1, schluessel: "von", name: "Zeitraum" },
      { index: 2, schluessel: "ort", name: "Ort" },
      { index: 3, schluessel: "status", name: "Status" },
    ],
    zustand,
    () => zeichne(),
  );
  const leer = el("div");
  const schluesselVon = (l, k) =>
    k === "name"
      ? l.titel
      : k === "von"
        ? l.von
        : k === "ort"
          ? (l.ort ?? "")
          : STATUS_FOLGE.indexOf(l.status);

  function zeichne() {
    const gefiltert = alle
      .filter((l) =>
        stand.filter.status === "alle"
          ? l.status !== "archiviert"
          : l.status === stand.filter.status,
      )
      .filter(
        (l) =>
          stand.suche === "" ||
          l.titel.toLowerCase().includes(stand.suche) ||
          (l.ort ?? "").toLowerCase().includes(stand.suche),
      );
    const treffer = sortiere(gefiltert, zustand, schluesselVon);
    const [von, bis] = seiten.fenster(treffer.length);
    koerper.replaceChildren(
      ...treffer
        .slice(von, bis)
        .map((l) =>
          el(
            "tr",
            {},
            el(
              "th",
              { scope: "row" },
              el(
                "a",
                { class: "name lg-name", href: `${ADRESSE}/${l.id}` },
                l.titel,
              ),
            ),
            el("td", { class: "lg-zahlen" }, zeitraum(l.von, l.bis)),
            el("td", {}, l.ort ?? "–"),
            el("td", {}, statusChip(l.status)),
          ),
        ),
    );
    beschrifteZellen(koerper, ["", "Zeitraum", "Ort", "Status"]);
    rahmen.hidden = treffer.length === 0;
    leer.replaceChildren();
    if (treffer.length === 0)
      leer.append(
        leerKarte(
          stand.suche
            ? `Keine Treffer für «${stand.suche}».`
            : "Kein Lager in diesem Status.",
          [
            knopf("Filter zurücksetzen", {
              onclick: () => leiste.setzeAlles(),
            }),
          ],
        ),
      );
    leiste.setzeTreffer(treffer.length, alle.length);
  }
  bereich.append(leiste.wurzel, rahmen, leer, seiten.wurzel);
  zeichne();
}

// Detail (A22) --------------------------------------------------------------

function loeschenKarte(lager) {
  const { wurzel } = bestaetigungAmOrt({
    text: "Lager löschen",
    frage: `«${lager.titel}» endgültig löschen?`,
    folge:
      "Das Lager und alle Daten gehen mit: Aufgaben, Einteilung, Pinnwand und alles Übrige.",
    bestaetigenText: "Endgültig löschen",
    erwartet: lager.titel,
    ausfuehren: async () => {
      await anfrage("DELETE", `${BASIS}/${lager.id}`, { titel: lager.titel });
      merkeMeldung(`«${lager.titel}» ist gelöscht.`);
      // Das gelöschte Lager soll nicht im Verlauf zurückkommen
      location.replace(ADRESSE);
    },
    fehlertext: (f) => `Nicht gelöscht. ${meldung(f)}`,
  });
  return el(
    "section",
    { class: "flaeche lg-gefahr" },
    el("h2", {}, "Lager löschen"),
    el(
      "p",
      { class: "leise" },
      lager.status === "archiviert"
        ? "Nur ein Entwurf oder ein archiviertes Lager lässt sich löschen. Das geht nicht rückgängig."
        : "Nur ein Entwurf oder ein archiviertes Lager lässt sich löschen. Archiviere es zuerst, wenn du die Daten behalten willst.",
    ),
    wurzel,
  );
}

function aendernDialog(lager, ctx, neu) {
  const g = grunddaten(lager);
  const { name, von, bis, ort } = g.felder;
  dialogFormular({
    titel: "Angaben ändern",
    felder: [
      name.wurzel,
      el("div", { class: "lg-zweispaltig" }, von.wurzel, bis.wurzel),
      ort.wurzel,
    ],
    ok: "Speichern",
    pruefe: () => {
      const fehler = g.pruefe();
      fehler.forEach((e, i) => feldFehler(e.f, e.text, { fokus: i === 0 }));
      return fehler.length > 0;
    },
    senden: () =>
      anfrage("PATCH", `${BASIS}/${lager.id}`, g.koerper({ aendern: true })),
    fehlertext: meldung,
    danach: () => {
      neu();
      ctx.melde("Die Angaben sind gespeichert.");
    },
  });
}

// Die Vorlagen laden, erst wenn man sie braucht; gibt es keine, steht der Hinweis in der Karte und führt zum Anlegen
async function vorlageDialog(lager, ctx, neu, hinweis) {
  let vorlagen;
  try {
    vorlagen = (await anfrage("GET", "/api/v1/admin/vorlagen")).vorlagen;
  } catch (f) {
    ctx.melde(meldung(f), "fehler");
    return;
  }
  if (vorlagen.length === 0) {
    hinweis.replaceChildren(
      "Es gibt noch keine Vorlage. ",
      el(
        "a",
        { class: "lg-verweis", href: "#lager/vorlagen" },
        "Vorlage anlegen",
      ),
    );
    hinweis.hidden = false;
    return;
  }
  const wahl = auswahl({
    label: "Vorlage",
    optionen: vorlagen.map((v) => [
      v.id,
      `${v.name} (${v.art === "aufgaben" ? "Aufgaben" : "Packliste"}, ${v.anzahl})`,
    ]),
    wert: vorlagen[0].id,
  });
  dialogFormular({
    titel: "Vorlage anwenden",
    beschreibung:
      "Die Einträge der Vorlage kommen ans Ende der Aufgaben oder der Packliste dieses Lagers. Wendest du dieselbe Vorlage zweimal an, stehen sie zweimal da.",
    felder: [wahl.wurzel],
    ok: "Anwenden",
    senden: () =>
      anfrage(
        "POST",
        `/api/v1/lager/${lager.id}/vorlagen/${wahl.eingabe.value}/anwenden`,
      ),
    fehlertext: meldung,
    danach: (r) => {
      const n = (r?.aufgaben ?? r?.punkte ?? []).length;
      neu();
      ctx.melde(
        r?.art === "aufgaben"
          ? `${n} ${n === 1 ? "Aufgabe" : "Aufgaben"} aus der Vorlage ergänzt.`
          : `${n} ${n === 1 ? "Punkt" : "Punkte"} der Packliste aus der Vorlage ergänzt.`,
      );
    },
  });
}

// Statuswechsel sofort, mit «Rückgängig» in der Meldung: Der alte Status lässt sich jederzeit wieder setzen (die Meldung bleibt, bis man sie schliesst)
async function wechsle(lager, status, text, ctx, neu) {
  const alt = lager.status;
  try {
    await anfrage("PATCH", `${BASIS}/${lager.id}`, { status });
  } catch (f) {
    ctx.melde(`Nicht geändert. ${meldung(f)}`, "fehler");
    return;
  }
  await neu();
  ctx.melde(text, "ok", {
    text: "Rückgängig",
    onclick: async () => {
      try {
        await anfrage("PATCH", `${BASIS}/${lager.id}`, { status: alt });
        ctx.melde(`«${lager.titel}» ist wieder ${statusWort(alt)}.`);
      } catch (f) {
        ctx.melde(`Nicht zurückgesetzt. ${meldung(f)}`, "fehler");
      }
      await neu();
    },
  });
}
const statusWort = (s) =>
  ({
    entwurf: "ein Entwurf",
    aktiv: "aktiv",
    abgeschlossen: "abgeschlossen",
    archiviert: "archiviert",
  })[s];

const zahlKnopf = (text, href, symbolName) => {
  const a = el("a", { class: "knopf", href }, text);
  if (symbolName) a.prepend(symbol(symbolName));
  return a;
};

function skeletonDetail() {
  return el(
    "div",
    { class: "lg-raster" },
    [0, 1, 2, 3].map(() => skeletonFlaeche({ zeilen: 3 })),
  );
}

function detail(bereich, ctx, id) {
  zeigeWartende(ctx);
  // Mitglieder und Rollen vergibt nur, wer Rechte vergeben darf (Abteilungsleitung); wer nur Lager verwaltet (#648), sieht die Angaben und den Stand, nicht die Mitglieder
  const mitMitgliedern = ctx.zugang?.darf("rechte.verwalten") !== false;
  ctx.lade(
    () =>
      Promise.all([
        anfrage("GET", `${BASIS}/${id}`),
        mitMitgliedern
          ? anfrage("GET", `${BASIS}/${id}/mitglieder`)
          : { mitglieder: null },
      ]),
    ([lager, { mitglieder }], neu) =>
      zeichneDetail(bereich, ctx, lager, mitglieder, neu),
    { skeleton: skeletonDetail },
  );
}

// Eine Hauptaktion je Status; was sonst noch geht, steht im Menü daneben (Archivieren) oder unten (Löschen)
function aktionen(lager, hatLeitung, ctx, neu) {
  const archivieren = {
    text: "Archivieren",
    onclick: () =>
      wechsle(
        lager,
        "archiviert",
        `«${lager.titel}» ist archiviert. Du findest es in der Liste unter «Archiviert».`,
        ctx,
        neu,
      ),
  };
  if (lager.status === "entwurf") {
    // Ohne Lagerleitung antwortet der Server mit 409: Der Knopf ist gesperrt, der Grund steht im Hinweis darunter (aria-describedby) mit dem Weg zu den Mitgliedern
    const aktivieren = splitKnopf({
      text: "Aktivieren",
      art: "haupt",
      symbol: "haken",
      onclick: () =>
        wechsle(lager, "aktiv", `«${lager.titel}» ist aktiv.`, ctx, neu),
      eintraege: [archivieren],
    });
    if (!hatLeitung) {
      aktivieren.haupt.disabled = true;
      aktivieren.haupt.setAttribute("aria-describedby", "lg-ohne-leitung");
    }
    return [aktivieren];
  }
  if (lager.status === "aktiv")
    return [
      splitKnopf({
        text: "Abschliessen",
        art: "blau",
        symbol: "schloss",
        onclick: () =>
          wechsle(
            lager,
            "abgeschlossen",
            `«${lager.titel}» ist abgeschlossen und schreibgeschützt. Du kannst es jederzeit wieder öffnen.`,
            ctx,
            neu,
          ),
        eintraege: [archivieren],
      }),
    ];
  if (lager.status === "abgeschlossen")
    return [
      knopfMit("Wieder öffnen", {
        art: "haupt",
        symbol: "aktualisieren",
        onclick: () =>
          wechsle(
            lager,
            "aktiv",
            `«${lager.titel}» ist wieder geöffnet.`,
            ctx,
            neu,
          ),
      }),
    ];
  return [
    knopfMit("Wiederherstellen", {
      art: "haupt",
      symbol: "aktualisieren",
      onclick: () =>
        wechsle(
          lager,
          "abgeschlossen",
          `«${lager.titel}» ist wiederhergestellt, abgeschlossen und schreibgeschützt.`,
          ctx,
          neu,
        ),
    }),
  ];
}

function zeichneDetail(bereich, ctx, lager, mitglieder, neu) {
  const geschlossen =
    lager.status === "abgeschlossen" || lager.status === "archiviert";
  ctx.titel(
    lager.titel,
    [zeitraum(lager.von, lager.bis), lager.ort].filter(Boolean).join(" · "),
  );
  // mitglieder === null: Die Person darf sie nicht sehen; der Server prüft die Leitung beim Aktivieren trotzdem
  const ohneMitglieder = mitglieder === null;
  const rolle = (r) => (mitglieder ?? []).filter((m) => m.rolle === r).length;
  ctx.kopfAktion(
    ...aktionen(
      lager,
      ohneMitglieder || rolle("lagerleitung") > 0,
      ctx,
      neu,
    ).map((a) => a.wurzel ?? a),
  );

  const hinweis =
    lager.status === "entwurf" && !ohneMitglieder && rolle("lagerleitung") === 0
      ? el(
          "div",
          { class: "hinweis hinweis--warn", id: "lg-ohne-leitung" },
          el(
            "span",
            {},
            "Zum Aktivieren fehlt die Lagerleitung. Ein aktives Lager braucht mindestens eine Person mit dieser Rolle.",
          ),
          el(
            "a",
            {
              class: "knopf knopf--klein",
              href: `${ADRESSE}/${lager.id}/mitglieder`,
            },
            "Mitglieder öffnen",
          ),
        )
      : lager.status === "abgeschlossen"
        ? el(
            "div",
            { class: "hinweis hinweis--info", role: "status" },
            el("span", {}, "Das Lager ist schreibgeschützt."),
          )
        : lager.status === "archiviert"
          ? el(
              "div",
              { class: "hinweis hinweis--info", role: "status" },
              el(
                "span",
                {},
                "Archiviert, nicht in der Liste «Alle». Die Daten bleiben erhalten.",
              ),
            )
          : null;

  const werte = (paare) =>
    el(
      "dl",
      { class: "werte" },
      paare.map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, v))),
    );
  const vorlagenHinweis = el("p", {
    class: "hinweis hinweis--info",
    role: "status",
    hidden: true,
  });
  haenge(
    bereich,
    zurueckLink("Alle Lager", ADRESSE),
    el("p", { class: "lg-status" }, statusChip(lager.status)),
    hinweis,
    el(
      "div",
      { class: "lg-raster" },
      el(
        "section",
        { class: "flaeche" },
        el("h2", {}, "Angaben"),
        werte([
          ["Zeitraum", zeitraum(lager.von, lager.bis)],
          [
            "Vorbereitung ab",
            lager.vorbereitungAb
              ? zeitraum(lager.vorbereitungAb, lager.vorbereitungAb)
              : "–",
          ],
          ["Ort", lager.ort ?? "–"],
          ["Adresse", lager.adresse ?? "–"],
        ]),
        !geschlossen &&
          el(
            "div",
            { class: "lg-fuss" },
            knopfMit("Angaben ändern", {
              symbol: "bearbeiten",
              onclick: () => aendernDialog(lager, ctx, neu),
            }),
          ),
      ),
      !ohneMitglieder &&
        el(
          "section",
          { class: "flaeche" },
          el("h2", {}, "Mitglieder"),
          werte(ROLLEN.map(([r, text]) => [text, String(rolle(r))])),
          el(
            "div",
            { class: "lg-fuss" },
            zahlKnopf(
              "Mitglieder und Rollen",
              `${ADRESSE}/${lager.id}/mitglieder`,
              "personen",
            ),
          ),
        ),
      !ohneMitglieder &&
        el(
          "section",
          { class: "flaeche" },
          el("h2", {}, "Vorlagen"),
          el(
            "p",
            { class: "leise" },
            "Ergänze die Aufgaben oder die Packliste dieses Lagers aus einer Vorlage der Abteilung.",
          ),
          vorlagenHinweis,
          el(
            "div",
            { class: "lg-fuss" },
            !geschlossen &&
              knopfMit("Vorlage anwenden", {
                symbol: "plus",
                onclick: () => vorlageDialog(lager, ctx, neu, vorlagenHinweis),
              }),
            zahlKnopf("Vorlagen verwalten", "#lager/vorlagen"),
          ),
        ),
      !ohneMitglieder &&
        el(
          "section",
          { class: "flaeche" },
          el("h2", {}, "Ausdrucke und Rechte"),
          el(
            "p",
            { class: "leise" },
            "Aushänge als PDF und was Leitung, Team und Lesen in diesem Lager dürfen. Die Lagerleitung darf immer alles.",
          ),
          el(
            "div",
            { class: "lg-fuss" },
            zahlKnopf("Ausdrucke", `${ADRESSE}/${lager.id}/ausdrucke`, "pdf"),
            zahlKnopf(
              "Rechte der Rollen",
              `${ADRESSE}/${lager.id}/rechte`,
              "schluessel",
            ),
          ),
        ),
    ),
    (lager.status === "entwurf" || lager.status === "archiviert") &&
      loeschenKarte(lager),
  );
}

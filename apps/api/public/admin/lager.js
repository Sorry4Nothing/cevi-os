import { anfrage } from "./api.js";
import { gehe } from "./verlauf.js";
import {
  auswahl,
  dialogFormular,
  el,
  filterGruppe,
  icon,
  knopf,
  seitenwahl,
  tabelle,
} from "./dom.js";
import { skeletonFlaeche, skeletonTabelle } from "./lader.js";
import { leerKarte } from "./zustaende.js";
import {
  ADRESSE,
  haenge,
  BASIS,
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
} from "./lager-gemeinsam.js";

// Bereich «Lager», Unterseite «Lager» (#527, Boards A20, A22, A29): Liste, Detail mit den Dialogen Abschliessen, Archivieren und Löschen. Adressen: #lager/lager, …/neu, …/<id>, …/<id>/mitglieder, …/<id>/rechte, …/<id>/ausdrucke. Kein Polling; die Liste ist eine Abfrage, das Detail zwei (Lager und Mitglieder).

export function zeige(bereich, ctx) {
  const [erster, zweiter, weiter] = ctx.pfad;
  if (erster === undefined) return liste(bereich, ctx);
  if (erster === "neu" && zweiter === undefined)
    return import("./lager-anlegen.js").then((m) => m.zeige(bereich, ctx));
  if (!ID.test(erster) || weiter !== undefined)
    return ctx.lade(nichtGefunden, () => {});
  if (zweiter === undefined) return detail(bereich, ctx, erster);
  if (zweiter === "mitglieder" || zweiter === "rechte")
    return import("./lager-mitglieder.js").then((m) =>
      m.zeige(bereich, ctx, erster, zweiter),
    );
  if (zweiter === "ausdrucke")
    return import("./lager-ausdrucke.js").then((m) =>
      m.zeige(bereich, ctx, erster),
    );
  return ctx.lade(nichtGefunden, () => {});
}

// Liste (A20) ---------------------------------------------------------------

const GRUPPEN = [
  ["alle", "Alle"],
  ["aktiv", "Aktiv"],
  ["entwurf", "Entwurf"],
  ["abgeschlossen", "Abgeschlossen"],
  ["archiviert", "Archiviert"],
];
const sortiere = (a, b) =>
  a.titel.localeCompare(b.titel, "de-CH", { numeric: true });

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
    (daten) => zeichneListe(bereich, ctx, daten.lager),
    {
      skeleton: () => skeletonTabelle({ spalten: 4, zeilen: 3, avatar: false }),
    },
  );
}

function zeichneListe(bereich, ctx, alle) {
  if (alle.length === 0) {
    bereich.append(
      leerKarte("Es gibt noch kein Lager. Lege das erste an.", [
        knopf("Neues Lager", {
          symbol: "plus",
          onclick: () => (location.hash = `${ADRESSE}/neu`),
        }),
      ]),
    );
    return;
  }
  const zustand = { frage: "", gruppe: "alle", aufsteigend: true };
  // «Alle» zeigt keine archivierten Lager; sie stehen unter ihrem eigenen Filter
  const zaehle = (g) =>
    alle.filter((l) =>
      g === "alle" ? l.status !== "archiviert" : l.status === g,
    ).length;
  const gruppen = GRUPPEN.filter(([g]) => g !== "archiviert" || zaehle(g) > 0);
  const filter = filterGruppe({
    beschriftung: "Status",
    eintraege: gruppen.map(([wert, text]) => ({ text, wert, n: zaehle(wert) })),
    wert: "alle",
    beiAenderung: (g) => {
      zustand.gruppe = g;
      seiten.anfang();
      zeichne();
    },
  });
  const suchId = "lg-suche";
  const suche = el("input", {
    class: "eingabe",
    id: suchId,
    type: "search",
    placeholder: "Lager suchen",
    autocomplete: "off",
    oninput: () => {
      zustand.frage = suche.value.trim().toLowerCase();
      seiten.anfang();
      zeichne();
    },
  });
  const seiten = seitenwahl({ beiWechsel: () => zeichne() });
  const { wurzel: rahmen, koerper } = tabelle({
    beschriftung: "Lager",
    spalten: ["Name", "Zeitraum", "Ort", "Status"],
    zeilen: [],
  });
  const kopfName = rahmen.querySelector("th");
  const sortKnopf = el("button", {
    type: "button",
    class: "lg-sort",
    onclick: () => {
      zustand.aufsteigend = !zustand.aufsteigend;
      zeichne();
      sortKnopf.focus();
    },
  });
  kopfName.replaceChildren(sortKnopf);
  const leer = el("div");
  const status = el("p", { class: "nur-leser", role: "status" });

  function zeichne() {
    sortKnopf.replaceChildren(
      "Name",
      el(
        "span",
        { class: "lg-sortwort" },
        symbol(zustand.aufsteigend ? "hoch" : "runter"),
        zustand.aufsteigend ? "aufsteigend" : "absteigend",
      ),
    );
    kopfName.setAttribute(
      "aria-sort",
      zustand.aufsteigend ? "ascending" : "descending",
    );
    const treffer = alle
      .filter((l) =>
        zustand.gruppe === "alle"
          ? l.status !== "archiviert"
          : l.status === zustand.gruppe,
      )
      .filter(
        (l) =>
          zustand.frage === "" ||
          l.titel.toLowerCase().includes(zustand.frage) ||
          (l.ort ?? "").toLowerCase().includes(zustand.frage),
      )
      .sort((a, b) => (zustand.aufsteigend ? sortiere(a, b) : sortiere(b, a)));
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
    rahmen.hidden = treffer.length === 0;
    leer.replaceChildren();
    if (treffer.length === 0) {
      leer.append(
        leerKarte(
          zustand.frage
            ? `Keine Treffer für «${suche.value.trim()}».`
            : "Kein Lager in diesem Status.",
          [
            knopf("Filter zurücksetzen", {
              onclick: () => {
                suche.value = "";
                zustand.frage = "";
                zustand.gruppe = "alle";
                filter.setze("alle");
                seiten.anfang();
                zeichne();
                suche.focus();
              },
            }),
          ],
        ),
      );
    }
    status.textContent =
      treffer.length === 1 ? "1 Lager." : `${treffer.length} Lager.`;
  }
  bereich.append(
    el(
      "div",
      { class: "werkzeuge" },
      el(
        "div",
        { class: "suche" },
        el("label", { class: "nur-leser", for: suchId }, "Lager suchen"),
        icon("lupe"),
        suche,
      ),
      filter.wurzel,
    ),
    rahmen,
    leer,
    seiten.wurzel,
    status,
  );
  zeichne();
}

// Detail (A22) und Dialoge (A29) --------------------------------------------

const DIALOGE = {
  abschliessen: {
    titel: "Lager abschliessen?",
    text: "Das Lager wird schreibgeschützt. Alle Mitglieder sehen es weiter, ändern kann niemand mehr. Du kannst es später wieder öffnen.",
    ok: "Abschliessen",
    symbol: "schloss",
    status: "abgeschlossen",
    nicht: "Nicht abgeschlossen.",
    erfolg: (t) =>
      `«${t}» ist abgeschlossen und schreibgeschützt. Du kannst es jederzeit wieder öffnen.`,
  },
  archivieren: {
    titel: "Lager archivieren?",
    text: "Das Lager verschwindet aus den Listen. Daten bleiben erhalten und lassen sich wiederherstellen.",
    ok: "Archivieren",
    symbol: "archiv",
    status: "archiviert",
    nicht: "Nicht archiviert.",
    erfolg: (t) =>
      `«${t}» ist archiviert. Du findest es in der Liste unter «Archiviert».`,
  },
};

// Rückfrage mit blauem Knopf (nicht rot: Abschliessen und Archivieren lassen sich zurücknehmen); danach zurück zur Liste
function statusDialog(art, lager) {
  const d = DIALOGE[art];
  const dialog = dialogFormular({
    titel: d.titel,
    beschreibung: d.text,
    ok: d.ok,
    senden: () =>
      anfrage("PATCH", `${BASIS}/${lager.id}`, { status: d.status }),
    fehlertext: (f) => `${d.nicht} ${meldung(f)}`,
    danach: () => {
      merkeMeldung(d.erfolg(lager.titel));
      gehe(ADRESSE);
    },
  });
  const ok = dialog.querySelector('button[type="submit"]');
  ok.className = "knopf knopf--blau";
  ok.prepend(symbol(d.symbol));
}

function loeschenDialog(lager) {
  const name = el("input", {
    class: "eingabe",
    id: "lg-loeschen-name",
    type: "text",
    autocomplete: "off",
    "aria-describedby": "lg-loeschen-hilfe",
  });
  const wurzel = el(
    "div",
    { class: "feld" },
    el(
      "label",
      { for: "lg-loeschen-name" },
      "Tippe den Namen des Lagers zur Bestätigung",
    ),
    el("p", { class: "hilfe", id: "lg-loeschen-hilfe" }, lager.titel),
    name,
  );
  const dialog = dialogFormular({
    titel: "Lager endgültig löschen?",
    beschreibung:
      "Das Lager und alle Daten werden gelöscht: Aufgaben, Einteilung, Pinnwand und alles Übrige. Das geht nicht rückgängig.",
    ok: "Löschen",
    gefaehrlich: true,
    felder: [wurzel],
    pruefe: () => {
      if (name.value.trim() === lager.titel) return false;
      feldFehler(
        { wurzel, eingabe: name },
        `Der Name stimmt nicht. Tippe «${lager.titel}».`,
      );
      return true;
    },
    senden: () =>
      anfrage("DELETE", `${BASIS}/${lager.id}`, { titel: name.value.trim() }),
    fehlertext: (f) => `Nicht gelöscht. ${meldung(f)}`,
    danach: () => {
      merkeMeldung(`«${lager.titel}» ist gelöscht.`);
      gehe(ADRESSE);
    },
  });
  dialog.querySelector('button[type="submit"]').prepend(symbol("papierkorb"));
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

async function vorlageDialog(lager, ctx, neu) {
  let vorlagen;
  try {
    vorlagen = (await anfrage("GET", "/api/v1/admin/vorlagen")).vorlagen;
  } catch (f) {
    ctx.melde(meldung(f), "fehler");
    return;
  }
  if (vorlagen.length === 0) {
    ctx.melde(
      "Es gibt noch keine Vorlage. Lege eine unter «Vorlagen» an.",
      "info",
    );
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

async function statusSetzen(k, lager, status, text, ctx, neu) {
  k.disabled = true;
  k.setAttribute("aria-busy", "true");
  try {
    await anfrage("PATCH", `${BASIS}/${lager.id}`, { status });
    neu();
    ctx.melde(text);
  } catch (f) {
    k.disabled = false;
    k.removeAttribute("aria-busy");
    ctx.melde(meldung(f), "fehler");
  }
}

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
  ctx.lade(
    () =>
      Promise.all([
        anfrage("GET", `${BASIS}/${id}`),
        anfrage("GET", `${BASIS}/${id}/mitglieder`),
      ]),
    ([lager, { mitglieder }], neu) =>
      zeichneDetail(bereich, ctx, lager, mitglieder, neu),
    { skeleton: skeletonDetail },
  );
}

function zeichneDetail(bereich, ctx, lager, mitglieder, neu) {
  const geschlossen =
    lager.status === "abgeschlossen" || lager.status === "archiviert";
  ctx.titel(
    lager.titel,
    [zeitraum(lager.von, lager.bis), lager.ort].filter(Boolean).join(" · "),
  );
  const aktionen = [];
  if (lager.status === "entwurf") {
    const aktivieren = knopf("Aktivieren", { art: "haupt", symbol: "haken" });
    aktivieren.addEventListener("click", () =>
      statusSetzen(
        aktivieren,
        lager,
        "aktiv",
        `«${lager.titel}» ist aktiv.`,
        ctx,
        neu,
      ),
    );
    aktionen.push(aktivieren);
  }
  if (lager.status === "aktiv")
    aktionen.push(
      knopfMit("Abschliessen", {
        symbol: "schloss",
        onclick: () => statusDialog("abschliessen", lager),
      }),
    );
  if (lager.status === "entwurf" || lager.status === "aktiv")
    aktionen.push(
      knopfMit("Archivieren", {
        symbol: "archiv",
        onclick: () => statusDialog("archivieren", lager),
      }),
    );
  if (lager.status === "entwurf" || lager.status === "archiviert")
    aktionen.push(
      knopf("Löschen", {
        art: "gefahr",
        symbol: "papierkorb",
        onclick: () => loeschenDialog(lager),
      }),
    );
  if (lager.status === "archiviert") {
    const wieder = knopf("Wiederherstellen", {
      art: "haupt",
      symbol: "aktualisieren",
    });
    wieder.addEventListener("click", () =>
      statusSetzen(
        wieder,
        lager,
        "abgeschlossen",
        `«${lager.titel}» ist wiederhergestellt, abgeschlossen und schreibgeschützt.`,
        ctx,
        neu,
      ),
    );
    aktionen.unshift(wieder);
  }
  ctx.kopfAktion(...aktionen);

  const rolle = (r) => mitglieder.filter((m) => m.rolle === r).length;
  const hinweis =
    lager.status === "abgeschlossen"
      ? el(
          "div",
          { class: "hinweis hinweis--info", role: "status" },
          el("span", {}, "Das Lager ist schreibgeschützt."),
          (() => {
            const k = knopf("Wieder öffnen", { klein: true });
            k.addEventListener("click", () =>
              statusSetzen(
                k,
                lager,
                "aktiv",
                `«${lager.titel}» ist wieder geöffnet.`,
                ctx,
                neu,
              ),
            );
            return k;
          })(),
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
  haenge(
    bereich,
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
      el(
        "section",
        { class: "flaeche" },
        el("h2", {}, "Vorlagen"),
        el(
          "p",
          { class: "leise" },
          "Ergänze die Aufgaben oder die Packliste dieses Lagers aus einer Vorlage der Abteilung.",
        ),
        el(
          "div",
          { class: "lg-fuss" },
          !geschlossen &&
            knopfMit("Vorlage anwenden", {
              symbol: "plus",
              onclick: () => vorlageDialog(lager, ctx, neu),
            }),
          zahlKnopf("Vorlagen verwalten", "#lager/vorlagen"),
        ),
      ),
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
  );
}

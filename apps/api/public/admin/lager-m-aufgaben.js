import { ApiFehler, anfrage } from "./api.js";
import { datumsfeld } from "./datumsfeld.js";
import {
  ankreuzen,
  auswahl,
  el,
  filterGruppe,
  knopf,
  menue,
  tabelle,
} from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import {
  blitze,
  ersetzeMitBewegung,
  puls,
  wechsle,
  zaehlZahl,
} from "./lager-anim.js";
import { macheSortierbar, sortiere } from "./liste-hilfen.js";
import { sortierListe } from "./sortieren.js";
import { leerKarte } from "./zustaende.js";
import {
  ID,
  beschrifteZellen,
  kartenTabelle,
  nichtGefunden,
  symbol,
} from "./lager-gemeinsam.js";
import {
  API,
  adresse,
  ersetzeKinder,
  fehlerText,
  fristChip,
  geschlossenHinweis,
  istGeschlossen,
  istKonflikt,
  ladeAufgaben,
  ladeLagerMitRechten,
  ladeMitglieder,
  ladeRessorts,
  personZeile,
  personenOptionen,
  rechteVon,
  ressortOptionen,
  skeletonAufgaben,
  statusChip,
  sternMarke,
} from "./lager-aufgaben-gemeinsam.js";
import {
  FRIST_FILTER,
  STATUS,
  STATUS_WAHL,
  STATUSNAME,
  abschnitt,
  datumMitTag,
  eintraegeNach,
  filtere,
  fristWort,
  gruppiere,
  heute,
  istErledigt,
  istVertagt,
  meine,
  personName,
  nachReihenfolge,
  spalten,
} from "./lager-aufgaben-logik.js";

// Modul «Aufgaben» des Lager-Arbeitsbereichs (#670): Tabelle mit Gruppen und Sortierung, Board, «Meine», die Reihenfolge der Leitung zum Ziehen; Filter, Mehrfachauswahl, Schnelleingabe, Vorlagen. Adressen: #lager/lager/<id>/aufgaben und …/aufgaben/<aufgabeId> (Detail). Rechte der Rolle blenden aus, was sie nicht darf; der Server prüft jede Anfrage. Kein Polling: Die Liste lädt beim Öffnen, «Aktualisieren» holt den Stand neu.

export function zeige(bereich, ctx, lagerId, lager) {
  const aufgabeId = ctx.pfad[2];
  if (aufgabeId !== undefined) {
    if (!ID.test(aufgabeId)) return ctx.lade(nichtGefunden, () => {});
    return import("./lager-aufgaben-detail.js").then((m) =>
      m.zeige(bereich, ctx, lagerId, lager, aufgabeId),
    );
  }
  // Beim ersten Laden gilt der Stand des Rahmens, danach holt «Aktualisieren» die Rechte neu
  let erstes = true;
  ctx.lade(
    async () => {
      const l = await ladeLagerMitRechten(lagerId, erstes ? lager : undefined);
      erstes = false;
      const rechte = rechteVon(l);
      if (!rechte.lesen) throw new ApiFehler(403);
      const aufgaben = await ladeAufgaben(lagerId);
      const [mitglieder, ressorts] = await Promise.all([
        ladeMitglieder(lagerId, aufgaben, ctx.ich),
        ladeRessorts(lagerId, aufgaben, rechte.ressorts),
      ]);
      return { lager: l, rechte, aufgaben, mitglieder, ressorts };
    },
    (daten, neu) => zeichne(bereich, ctx, lagerId, daten, neu),
    { skeleton: () => skeletonAufgaben() },
  );
}

const ANSICHTEN = [
  { wert: "tabelle", text: "Tabelle" },
  { wert: "board", text: "Board" },
  { wert: "meine", text: "Meine" },
  { wert: "reihenfolge", text: "Reihenfolge" },
];
const GRUPPEN = [
  ["abschnitt", "Nach Frist"],
  ["person", "Nach Person"],
  ["ressort", "Nach Ressort"],
  ["keine", "Nicht gruppieren"],
];
const SPALTEN = [
  "Aufgabe",
  "Status",
  "Verantwortlich",
  "Ressort",
  "Frist",
  "Aktionen",
];

function zeichne(bereich, ctx, lagerId, daten, neuLaden) {
  const { rechte } = daten;
  const S = {
    aufgaben: daten.aufgaben,
    personen: daten.mitglieder.personen,
    ressorts: daten.ressorts,
    ansicht: "tabelle",
    gruppe: "abschnitt",
    auswahl: new Set(),
    verborgen: new Set(),
    filter: {
      suche: "",
      ressort: "alle",
      person: "alle",
      status: "alle",
      frist: "alle",
      gemerkt: "alle",
    },
    sort: { schluessel: "frist", richtung: "auf" },
    jetzt: heute(),
  };
  const ich = ctx.ich?.id;
  const ids = () => ({
    ressorts: new Map(S.ressorts.map((r) => [r.id, `${r.kuerzel} ${r.name}`])),
    personen: new Map(S.personen.map((p) => [p.id, p.name])),
  });

  // ---- Änderungen am Stand ----
  const ersetze = (neu) => {
    const i = S.aufgaben.findIndex((a) => a.id === neu.id);
    if (i >= 0) S.aufgaben[i] = neu;
    else S.aufgaben.push(neu);
  };
  const entferne = (id) => {
    S.aufgaben = S.aufgaben.filter((a) => a.id !== id);
    S.auswahl.delete(id);
  };
  async function holeEine(id) {
    try {
      const neu = await anfrage("GET", `${API(lagerId)}/aufgaben/${id}`);
      ersetze(neu);
      return neu;
    } catch (f) {
      if (f.status === 404) entferne(id);
      return null;
    }
  }
  // Ein Fehler beim Schreiben: Konflikt (Stand des Servers zeigen und die eigene Änderung anbieten), geschlossenes Lager, alles andere als Meldung
  async function behandle(f, a, nochmals) {
    if (istKonflikt(f)) {
      const neu = await holeEine(a.id);
      zeichneKoerper();
      ctx.melde(
        neu
          ? `«${a.titel}» hat jemand inzwischen geändert. Du siehst jetzt den Stand des Servers.`
          : `«${a.titel}» gibt es nicht mehr.`,
        "warn",
        neu && nochmals
          ? { text: "Meine Änderung übernehmen", onclick: () => nochmals(neu) }
          : undefined,
      );
      return;
    }
    if (istGeschlossen(f)) {
      rechte.zu = true;
      rechte.bearbeiten = rechte.status = false;
    }
    ctx.melde(`Nicht gespeichert. ${fehlerText(f)}`, "fehler");
    if (istGeschlossen(f)) neuLaden();
  }
  // Nach dem Speichern: die Zeile oder Karte hebt sich kurz ab, der Haken pulsiert
  const rueckmeldung = (id) => {
    const k = koerper.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!k) return;
    blitze(k);
    puls(k.querySelector(".la-tick"));
  };
  async function setzeStatus(a, status, { undo = true } = {}) {
    const vorher = a.status;
    try {
      const neu = await anfrage(
        "PUT",
        `${API(lagerId)}/aufgaben/${a.id}/status`,
        {
          version: a.version,
          status,
        },
      );
      ersetze(neu);
      // Erledigt eine Aufgabe mit Wiederholung, legt der Server die nächste an
      if (status === "erledigt" && a.wiederholung) {
        S.aufgaben = await ladeAufgaben(lagerId);
      }
      zeichneKoerper();
      rueckmeldung(a.id);
      if (undo)
        ctx.melde(
          status === "erledigt"
            ? `«${a.titel}» ist erledigt.`
            : `«${a.titel}»: ${STATUSNAME[status]}.`,
          "ok",
          {
            text: "Rückgängig",
            onclick: async () => {
              const jetzt = S.aufgaben.find((x) => x.id === a.id);
              if (jetzt) await setzeStatus(jetzt, vorher, { undo: false });
            },
          },
        );
      return neu;
    } catch (f) {
      await behandle(f, a, (aktuell) => setzeStatus(aktuell, status, { undo }));
      return null;
    }
  }
  async function aendere(a, werte, text) {
    try {
      const neu = await anfrage("PATCH", `${API(lagerId)}/aufgaben/${a.id}`, {
        version: a.version,
        ...werte,
      });
      ersetze(neu);
      zeichneKoerper();
      rueckmeldung(a.id);
      if (text) ctx.melde(text);
      return neu;
    } catch (f) {
      await behandle(f, a, (aktuell) => aendere(aktuell, werte, text));
      return null;
    }
  }

  // ---- Kopf ----
  const kopfKnoepfe = [];
  if (rechte.bearbeiten) {
    kopfKnoepfe.push(
      knopf("Neue Aufgabe", {
        art: "haupt",
        symbol: "plus",
        onclick: () =>
          import("./lager-aufgaben-neu.js").then((m) =>
            m.neueAufgabe({
              ctx,
              lagerId,
              S,
              ids: ids(),
              beiNeu: (a) => {
                ersetze(a);
                zeichneKoerper();
              },
            }),
          ),
      }),
      knopf("Schnell erfassen", {
        symbol: "bearbeiten",
        onclick: () =>
          import("./lager-aufgaben-neu.js").then((m) =>
            m.schnellErfassen({ ctx, lagerId, S, beiNeu: neuLaden }),
          ),
      }),
    );
  }
  if (rechte.vorlagen) {
    kopfKnoepfe.push(
      knopf("Vorlage anwenden", {
        onclick: () =>
          import("./lager-aufgaben-neu.js").then((m) =>
            m.vorlageAnwenden({ ctx, lagerId, beiNeu: neuLaden }),
          ),
      }),
    );
  }
  ctx.kopfAktion(...kopfKnoepfe);

  // ---- Filter ----
  const optionen = {
    ressort: () => [
      ["alle", "Alle Ressorts"],
      ["keins", "Kein Ressort"],
      ...S.ressorts.map((r) => [r.id, `${r.kuerzel} ${r.name}`]),
    ],
    person: () => [
      ["alle", "Alle Personen"],
      ["niemand", "Ohne Verantwortliche"],
      ...S.personen.map((p) => [p.id, p.name]),
    ],
  };
  const leiste = filterleiste({
    suche: { label: "Aufgaben suchen" },
    filter: [
      {
        schluessel: "ressort",
        label: "Ressort",
        grundwert: "alle",
        optionen: optionen.ressort(),
      },
      {
        schluessel: "person",
        label: "Person",
        grundwert: "alle",
        optionen: optionen.person(),
      },
      {
        schluessel: "status",
        label: "Status",
        grundwert: "alle",
        optionen: [["alle", "Alle"], ["offene", "Nicht erledigt"], ...STATUS],
      },
      {
        schluessel: "frist",
        label: "Frist",
        grundwert: "alle",
        optionen: FRIST_FILTER,
      },
      {
        schluessel: "gemerkt",
        label: "Gemerkt",
        grundwert: "alle",
        optionen: [
          ["alle", "Alle"],
          ["ja", "Nur gemerkte"],
        ],
      },
    ],
    namen: { einzahl: "Aufgabe", mehrzahl: "Aufgaben" },
    beiAenderung: (neu) => {
      S.filter = { suche: neu.suche, ...neu.filter };
      zeichneKoerper();
    },
  });

  // ---- Ansicht und Gruppen ----
  const ansichten = filterGruppe({
    beschriftung: "Ansicht",
    eintraege: ANSICHTEN.filter(
      (x) => x.wert !== "reihenfolge" || rechte.bearbeiten,
    ),
    wert: S.ansicht,
    beiAenderung: (w) => {
      S.ansicht = w;
      S.auswahl.clear();
      zeichneKoerper();
    },
  });
  const gruppenWahl = auswahl({
    label: "Gruppieren",
    optionen: GRUPPEN,
    wert: S.gruppe,
  });
  gruppenWahl.eingabe.addEventListener("change", () => {
    S.gruppe = gruppenWahl.eingabe.value;
    zeichneKoerper();
  });
  const gruppenOrt = el("div", { class: "la-gruppenwahl" }, gruppenWahl.wurzel);
  const zahlOffen = zaehlZahl(0);
  const zahlUeberfaellig = zaehlZahl(0);
  const zahlErledigt = zaehlZahl(0);
  const kennzahlen = el(
    "p",
    { class: "leise klein la-kennzahlen", role: "status" },
    zahlOffen,
    " offen, ",
    zahlUeberfaellig,
    " überfällig, ",
    zahlErledigt,
    " erledigt",
  );
  const koerper = el("div", { class: "la-koerper" });
  const leiste2 = el(
    "div",
    { class: "la-umschalter" },
    ansichten.wurzel,
    gruppenOrt,
  );

  // ---- Auswahlleiste (Mehrfachauswahl) ----
  const auswahlZahl = el("span", { class: "la-auswahlzahl", role: "status" });
  const auswahlForm = el("div", { class: "la-auswahlform" });
  const auswahlKnoepfe = el("div", { class: "la-auswahlknoepfe" });
  const auswahlLeiste = el(
    "section",
    {
      class: "la-auswahlleiste",
      "aria-label": "Mehrfachauswahl",
      hidden: true,
    },
    auswahlZahl,
    auswahlKnoepfe,
    auswahlForm,
  );

  function zeichneAuswahl() {
    const gewaehlt = S.aufgaben.filter((a) => S.auswahl.has(a.id));
    auswahlLeiste.hidden = gewaehlt.length === 0;
    if (gewaehlt.length === 0) {
      auswahlForm.replaceChildren();
      return;
    }
    auswahlZahl.textContent =
      gewaehlt.length === 1
        ? "1 Aufgabe gewählt"
        : `${gewaehlt.length} Aufgaben gewählt`;
    const bulk = (text, bauen) =>
      knopf(text, {
        klein: true,
        onclick: () => auswahlForm.replaceChildren(bauen(gewaehlt)),
      });
    ersetzeKinder(
      auswahlKnoepfe,
      rechte.status && bulk("Status", (g) => bulkStatus(g)),
      rechte.bearbeiten && bulk("Person", (g) => bulkPerson(g)),
      rechte.bearbeiten && bulk("Frist", (g) => bulkFrist(g)),
      rechte.bearbeiten && bulk("Ressort", (g) => bulkRessort(g)),
      rechte.bearbeiten &&
        knopf("Löschen", {
          klein: true,
          art: "gefahr",
          onclick: () => loesche(gewaehlt),
        }),
      knopf("Auswahl aufheben", {
        klein: true,
        art: "still",
        onclick: () => {
          S.auswahl.clear();
          zeichneKoerper();
        },
      }),
    );
  }
  // Ein kleines Formular in der Leiste: ein Feld, «Anwenden» und «Abbrechen»
  function bulkFormular(feldKnoten, anwenden, zusatz) {
    const ok = knopf("Anwenden", { art: "haupt", klein: true });
    ok.addEventListener("click", async () => {
      ok.disabled = true;
      ok.setAttribute("aria-busy", "true");
      try {
        await anwenden();
      } finally {
        ok.disabled = false;
        ok.removeAttribute("aria-busy");
      }
    });
    return el(
      "div",
      { class: "la-bulkform" },
      feldKnoten,
      ok,
      zusatz,
      knopf("Abbrechen", {
        klein: true,
        art: "still",
        onclick: () => auswahlForm.replaceChildren(),
      }),
    );
  }
  const bulkStatus = (g) => {
    const f = auswahl({
      label: "Status setzen",
      optionen: STATUS_WAHL,
      wert: "offen",
    });
    return bulkFormular(f.wurzel, () =>
      bulkSchreiben(g, () => ({ status: f.eingabe.value }), "status"),
    );
  };
  const bulkPerson = (g) => {
    const f = auswahl({
      label: "Verantwortliche setzen",
      optionen: personenOptionen(S.personen, "Niemand"),
      wert: "",
    });
    return bulkFormular(f.wurzel, () =>
      bulkSchreiben(g, () => ({
        verantwortlichPersonId: f.eingabe.value || null,
      })),
    );
  };
  const bulkRessort = (g) => {
    const f = auswahl({
      label: "Ressort setzen",
      optionen: ressortOptionen(S.ressorts, "Kein Ressort"),
      wert: "",
    });
    return bulkFormular(f.wurzel, () =>
      bulkSchreiben(g, () => ({ ressortId: f.eingabe.value || null })),
    );
  };
  const bulkFrist = (g) => {
    const f = datumsfeld({ label: "Frist setzen" });
    const entfernen = knopf("Frist entfernen", {
      klein: true,
      onclick: () => bulkSchreiben(g, () => ({ frist: null })),
    });
    return bulkFormular(
      f.wurzel,
      () => {
        if (!f.eingabe.value) {
          ctx.melde("Wähle zuerst ein Datum.", "warn");
          return;
        }
        return bulkSchreiben(g, () => ({ frist: f.eingabe.value }));
      },
      entfernen,
    );
  };
  // Die Änderung einzeln senden (jede Aufgabe mit ihrer Version); wer inzwischen anders geändert wurde, bleibt unberührt und steht in der Meldung
  async function bulkSchreiben(liste, werteVon, art) {
    let ok = 0;
    const konflikt = [];
    const sonst = [];
    for (const a of liste) {
      try {
        const werte = werteVon(a);
        const neu =
          art === "status"
            ? await anfrage("PUT", `${API(lagerId)}/aufgaben/${a.id}/status`, {
                version: a.version,
                status: werte.status,
              })
            : await anfrage("PATCH", `${API(lagerId)}/aufgaben/${a.id}`, {
                version: a.version,
                ...werte,
              });
        ersetze(neu);
        ok++;
      } catch (f) {
        if (istKonflikt(f)) {
          konflikt.push(a);
          await holeEine(a.id);
        } else sonst.push([a, f]);
      }
    }
    if (art === "status" && liste.some((a) => a.wiederholung)) {
      S.aufgaben = await ladeAufgaben(lagerId);
    }
    auswahlForm.replaceChildren();
    zeichneKoerper();
    const teile = [
      ok === 1 ? "1 Aufgabe geändert." : `${ok} Aufgaben geändert.`,
    ];
    if (konflikt.length)
      teile.push(
        `${konflikt.length === 1 ? "Eine hat" : `${konflikt.length} haben`} inzwischen jemand anderes geändert und ${konflikt.length === 1 ? "bleibt" : "bleiben"} unberührt: ${konflikt.map((a) => `«${a.titel}»`).join(", ")}.`,
      );
    if (sonst.length)
      teile.push(`Nicht gespeichert: ${fehlerText(sonst[0][1])}`);
    ctx.melde(teile.join(" "), konflikt.length || sonst.length ? "warn" : "ok");
  }

  // Löschen mit «Rückgängig»: Die Anfrage geht erst nach der Frist hinaus
  function loesche(liste) {
    const idsListe = liste.map((a) => a.id);
    ctx.mitRueckgaengig({
      text:
        liste.length === 1
          ? `«${liste[0].titel}» gelöscht`
          : `${liste.length} Aufgaben gelöscht`,
      erledigt: "Gelöscht.",
      ansicht: {
        weg: () => {
          for (const id of idsListe) S.verborgen.add(id);
          S.auswahl.clear();
          zeichneKoerper();
        },
        zurueck: () => {
          for (const id of idsListe) S.verborgen.delete(id);
          zeichneKoerper();
        },
      },
      ausfuehren: async () => {
        const r = await Promise.allSettled(
          liste.map((a) =>
            anfrage(
              "DELETE",
              `${API(lagerId)}/aufgaben/${a.id}?version=${a.version}`,
            ),
          ),
        );
        const fehler = r.find((x) => x.status === "rejected");
        if (fehler) throw fehler.reason;
      },
      danach: () => {
        for (const id of idsListe) {
          entferne(id);
          S.verborgen.delete(id);
        }
        zeichneKoerper();
      },
      fehlertext: (f) =>
        istKonflikt(f)
          ? "Eine Aufgabe hat jemand inzwischen geändert und wurde nicht gelöscht."
          : `Nicht gelöscht. ${fehlerText(f)}`,
      beiFehler: () => neuLaden(),
    });
  }

  // ---- Zeilen ----
  const sichtbar = () => {
    const nachFilter = filtere(
      S.aufgaben.filter((a) => !S.verborgen.has(a.id)),
      S.filter,
      S.jetzt,
    );
    return S.ansicht === "meine" ? meine(nachFilter, ich) : nachFilter;
  };

  function tick(a) {
    const erledigt = istErledigt(a);
    return el(
      "button",
      {
        type: "button",
        class: `knopf knopf--rund la-tick${erledigt ? " la-tick--erledigt" : ""}`,
        "aria-pressed": String(erledigt),
        "aria-label": `${erledigt ? "Wieder öffnen" : "Erledigt"}: ${a.titel}`,
        disabled: !rechte.status,
        onclick: () => setzeStatus(a, erledigt ? "offen" : "erledigt"),
      },
      symbol("haken"),
    );
  }
  function titelBlock(a) {
    return el(
      "span",
      { class: "la-titel" },
      el(
        "a",
        { class: "name la-name", href: adresse(lagerId, "aufgaben", a.id) },
        a.titel,
      ),
      a.stern && sternMarke(),
      a.laufend && el("span", { class: "chip" }, "Laufend"),
      a.wiederholung &&
        el(
          "span",
          { class: "chip" },
          symbol("aktualisieren"),
          "Wiederholt sich",
        ),
      a.teil && el("span", { class: "leise klein la-teil" }, a.teil),
    );
  }
  function fristZelle(a) {
    return el(
      "span",
      { class: "la-frist" },
      el("span", {}, a.frist ? datumMitTag(a.frist) : "Keine Frist"),
      fristChip(a, S.jetzt),
      istVertagt(a, S.jetzt) &&
        el(
          "span",
          { class: "leise klein" },
          `Zurück am ${datumMitTag(a.spaeterAb)}`,
        ),
    );
  }
  function menueFuer(a) {
    const erledigt = istErledigt(a);
    return menue(a.titel, [
      rechte.bearbeiten &&
        !erledigt &&
        a.verantwortlich?.id !== ich &&
        a.verantwortlichPersonId !== ich && {
          text: "Ich übernehme",
          onclick: () =>
            aendere(
              a,
              { verantwortlichPersonId: ich },
              `«${a.titel}» gehört jetzt dir.`,
            ),
        },
      ...(rechte.status
        ? STATUS_WAHL.filter(([w]) => w !== a.status).map(([w, t]) => ({
            text: `Status: ${t}`,
            onclick: () => setzeStatus(a, w),
          }))
        : []),
      rechte.bearbeiten &&
        !erledigt && {
          text:
            a.spaeterAb && a.spaeterAb > S.jetzt
              ? "Erinnerung entfernen"
              : "Später erinnern",
          onclick: () =>
            a.spaeterAb && a.spaeterAb > S.jetzt
              ? aendere(a, { spaeterAb: null }, "Die Erinnerung ist entfernt.")
              : spaeterErinnern(a),
        },
      rechte.bearbeiten && {
        text: a.stern ? "Merken aufheben" : "Merken",
        onclick: () => aendere(a, { stern: !a.stern }),
      },
      rechte.bearbeiten && {
        text: "Löschen",
        gefaehrlich: true,
        onclick: () => loesche([a]),
      },
    ]);
  }
  function spaeterErinnern(a) {
    import("./lager-aufgaben-neu.js").then((m) =>
      m.spaeterErinnern({
        a,
        senden: (datum) =>
          aendere(
            a,
            { spaeterAb: datum },
            `«${a.titel}» kommt am ${datumMitTag(datum)} zurück.`,
          ),
      }),
    );
  }

  function zeileVon(a) {
    const wahl = ankreuzen({
      label: `Auswählen: ${a.titel}`,
      gewaehlt: S.auswahl.has(a.id),
      wert: a.id,
    });
    wahl.wurzel.querySelector("label").classList.add("nur-leser");
    wahl.eingabe.addEventListener("change", () => {
      if (wahl.eingabe.checked) S.auswahl.add(a.id);
      else S.auswahl.delete(a.id);
      tr.classList.toggle("gewaehlt", wahl.eingabe.checked);
      zeichneAuswahl();
    });
    const tr = el(
      "tr",
      { "data-id": a.id, class: S.auswahl.has(a.id) ? "gewaehlt" : undefined },
      el(
        "td",
        { class: "la-wahl" },
        rechte.status || rechte.bearbeiten ? wahl.wurzel : null,
      ),
      el(
        "th",
        { scope: "row" },
        el("span", { class: "la-erste" }, tick(a), titelBlock(a)),
      ),
      el("td", {}, statusChip(a.status)),
      el(
        "td",
        {},
        personZeile(a.verantwortlich, {
          automatisch: a.verantwortlich?.automatisch,
          leer: "Niemand",
        }),
        a.unterstuetzung.length > 0 &&
          el(
            "span",
            { class: "leise klein la-unterstuetzung" },
            `+ ${a.unterstuetzung.length} Unterstützung`,
          ),
      ),
      el("td", {}, a.ressort ? `${a.ressort.kuerzel}` : "–"),
      el("td", {}, fristZelle(a)),
      el(
        "td",
        { class: "rechts" },
        el(
          "div",
          { class: "aktionen" },
          el(
            "a",
            {
              class: "knopf knopf--klein",
              href: adresse(lagerId, "aufgaben", a.id),
              "aria-label": `Öffnen: ${a.titel}`,
            },
            "Öffnen",
          ),
          menueFuer(a),
        ),
      ),
    );
    return tr;
  }

  const schluesselVon = (a, k) => {
    switch (k) {
      case "frist":
        return a.frist ?? "9999-12-31";
      case "status":
        return STATUS.findIndex(([w]) => w === a.status);
      case "person":
        return a.verantwortlich ? personName(a.verantwortlich) : "￿";
      case "ressort":
        return a.ressort ? a.ressort.kuerzel : "￿";
      default:
        return a.titel;
    }
  };

  function zeichneTabelle(liste) {
    if (liste.length === 0) return keineTreffer();
    const gruppen = gruppiere(
      liste,
      S.ansicht === "meine" ? "abschnitt" : S.gruppe,
      S.jetzt,
    );
    const { wurzel, koerper: tb } = tabelle({
      beschriftung: "Aufgaben",
      spalten: ["Wahl", ...SPALTEN],
      zeilen: [],
    });
    kartenTabelle(wurzel);
    const kopf0 = wurzel.querySelector("thead th");
    kopf0.replaceChildren(
      el("span", { class: "nur-leser" }, "Auswahl"),
      alleWaehlen(liste),
    );
    kopf0.classList.add("la-wahlkopf");
    macheSortierbar(
      wurzel,
      [
        { index: 1, schluessel: "titel", name: "Aufgabe" },
        { index: 2, schluessel: "status", name: "Status" },
        { index: 3, schluessel: "person", name: "Verantwortlich" },
        { index: 4, schluessel: "ressort", name: "Ressort" },
        { index: 5, schluessel: "frist", name: "Frist" },
      ],
      S.sort,
      () => zeichneKoerper({ fokusSortierung: true }),
    );
    for (const g of gruppen) {
      if (g.titel)
        tb.append(
          el(
            "tr",
            { class: "la-gruppe" },
            el(
              "th",
              { colspan: String(SPALTEN.length + 1), scope: "colgroup" },
              `${g.titel} (${g.aufgaben.length})`,
            ),
          ),
        );
      for (const a of sortiere(g.aufgaben, S.sort, schluesselVon))
        tb.append(zeileVon(a));
    }
    beschrifteZellen(tb, [
      "",
      "",
      "Status",
      "Verantwortlich",
      "Ressort",
      "Frist",
      "",
    ]);
    return wurzel;
  }
  function alleWaehlen(liste) {
    const alle = ankreuzen({
      label: "Alle gezeigten auswählen",
      gewaehlt: false,
      wert: "alle",
    });
    alle.wurzel.querySelector("label").classList.add("nur-leser");
    alle.eingabe.checked =
      liste.length > 0 && liste.every((a) => S.auswahl.has(a.id));
    alle.eingabe.disabled = !(rechte.status || rechte.bearbeiten);
    alle.eingabe.addEventListener("change", () => {
      for (const a of liste) {
        if (alle.eingabe.checked) S.auswahl.add(a.id);
        else S.auswahl.delete(a.id);
      }
      zeichneKoerper();
    });
    return alle.wurzel;
  }

  // ---- Board ----
  function karte(a) {
    return el(
      "div",
      { class: "la-karte" },
      el("div", { class: "la-karte-kopf" }, tick(a), titelBlock(a)),
      el(
        "div",
        { class: "la-karte-fuss" },
        personZeile(a.verantwortlich, { leer: "Niemand" }),
        a.frist && el("span", { class: "leise klein" }, fristWort(a, S.jetzt)),
        fristChip(a, S.jetzt),
        rechte.status && boardMenue(a),
      ),
    );
  }
  const boardMenue = (a) =>
    menue(
      a.titel,
      STATUS_WAHL.filter(([w]) => w !== a.status).map(([w, t]) => ({
        text: `Verschieben nach «${t}»`,
        onclick: () => setzeStatus(a, w),
      })),
    );
  function zeichneBoard(liste) {
    if (liste.length === 0) return keineTreffer();
    return el(
      "div",
      {
        class: "la-board",
        role: "region",
        "aria-label": "Board mit Spalten je Status",
        tabindex: "0",
      },
      spalten(liste).map((s) => {
        const kopf = el(
          "h2",
          { class: "la-spaltentitel" },
          `${s.titel} `,
          el("span", { class: "n" }, String(s.aufgaben.length)),
        );
        const inhalt =
          s.aufgaben.length === 0
            ? el("p", { class: "leise klein" }, "Keine Aufgaben")
            : rechte.bearbeiten && s.aufgaben.length <= 200
              ? sortierListe({
                  beschriftung: `Aufgaben mit Status ${s.titel}`,
                  eintraege: s.aufgaben.map((a) => ({
                    id: a.id,
                    text: a.titel,
                    inhalt: karte(a),
                  })),
                  mitRueckgaengig: ctx.mitRueckgaengig,
                  aktionstext: "Reihenfolge geändert",
                  beiNeu: (neu) => speichereReihenfolge(neu),
                }).wurzel
              : el(
                  "ul",
                  { class: "la-karten" },
                  s.aufgaben.map((a) =>
                    el("li", { "data-id": a.id }, karte(a)),
                  ),
                );
        return el(
          "section",
          { class: "la-spalte", "aria-label": s.titel },
          kopf,
          inhalt,
        );
      }),
    );
  }
  async function speichereReihenfolge(neu) {
    try {
      await anfrage("PUT", `${API(lagerId)}/aufgaben/reihenfolge`, {
        eintraege: eintraegeNach(S.aufgaben, neu),
      });
      // Die Stelle in der Liste ist die neue Reihenfolge: Versionen und Reihenfolge neu holen
      S.aufgaben = await ladeAufgaben(lagerId);
      zeichneKoerper();
    } catch (f) {
      // Den Text zeigt die Rückmeldung der Rückgängig-Leiste; die Liste zeigt den Stand des Servers
      S.aufgaben = await ladeAufgaben(lagerId).catch(() => S.aufgaben);
      zeichneKoerper();
      throw new Error(
        istKonflikt(f)
          ? "Jemand hat die Reihenfolge inzwischen geändert. Du siehst jetzt den Stand des Servers."
          : fehlerText(f),
        { cause: f },
      );
    }
  }

  // ---- Reihenfolge der Leitung ----
  function zeichneReihenfolge(liste) {
    if (liste.length === 0) return keineTreffer();
    const sortiert = [...liste].sort(nachReihenfolge);
    if (sortiert.length > 200)
      return el(
        "div",
        { class: "hinweis hinweis--info", role: "status" },
        el(
          "span",
          {},
          "Mehr als 200 Aufgaben lassen sich nicht auf einmal ordnen. Filtere zuerst, zum Beispiel nach Ressort.",
        ),
      );
    const gefiltert = sortiert.length < S.aufgaben.length;
    return el(
      "div",
      {},
      el(
        "p",
        { class: "leise" },
        gefiltert
          ? "Du ordnest nur die gezeigten Aufgaben. Die übrigen behalten ihre Plätze."
          : "Ziehe eine Aufgabe am Griff oder nutze die Knöpfe «Nach oben» und «Nach unten». Das ist die Reihenfolge der Lagerleitung in allen Ansichten.",
      ),
      sortierListe({
        beschriftung: "Aufgaben in der Reihenfolge der Lagerleitung",
        eintraege: sortiert.map((a) => ({
          id: a.id,
          text: a.titel,
          inhalt: el(
            "div",
            { class: "la-reihe" },
            el("span", { class: "la-reihe-titel" }, a.titel),
            statusChip(a.status),
            personZeile(a.verantwortlich, { leer: "Niemand" }),
            el(
              "span",
              { class: "leise klein" },
              a.frist ? datumMitTag(a.frist) : "Keine Frist",
            ),
          ),
        })),
        mitRueckgaengig: ctx.mitRueckgaengig,
        beiNeu: (neu) => speichereReihenfolge(neu),
      }).wurzel,
    );
  }

  function keineTreffer() {
    return leerKarte(
      S.aufgaben.length === 0
        ? "In diesem Lager gibt es noch keine Aufgaben."
        : S.ansicht === "meine"
          ? "Du hast keine Aufgaben, die zu diesem Filter passen."
          : "Keine Aufgaben passen zu diesem Filter.",
      S.aufgaben.length === 0 && rechte.bearbeiten
        ? [
            knopf("Neue Aufgabe", {
              art: "haupt",
              symbol: "plus",
              onclick: () => kopfKnoepfe[0]?.click(),
            }),
          ]
        : [
            knopf("Filter zurücksetzen", {
              onclick: () => leiste.setzeAlles(),
            }),
          ],
    );
  }

  let gezeigt = null;
  function zeichneKoerper({ fokusSortierung = false } = {}) {
    const liste = sichtbar();
    const alleSichtbar = S.aufgaben.filter((a) => !S.verborgen.has(a.id));
    gruppenOrt.hidden = S.ansicht !== "tabelle";
    leiste.setzeTreffer(liste.length, alleSichtbar.length);
    const offen = alleSichtbar.filter((a) => !istErledigt(a));
    const ueberfaellig = offen.filter(
      (a) => abschnitt(a, S.jetzt) === "ueberfaellig",
    ).length;
    zahlOffen.setze(offen.length);
    zahlUeberfaellig.setze(ueberfaellig);
    zahlErledigt.setze(alleSichtbar.length - offen.length);
    const inhalt =
      S.ansicht === "board"
        ? zeichneBoard(liste)
        : S.ansicht === "reihenfolge"
          ? zeichneReihenfolge(liste)
          : zeichneTabelle(liste);
    // Eine andere Ansicht blendet weich ein; innerhalb einer Ansicht gleiten die Zeilen und Karten an ihren neuen Platz
    if (gezeigt === S.ansicht) ersetzeMitBewegung(koerper, inhalt);
    else wechsle(koerper, inhalt);
    gezeigt = S.ansicht;
    zeichneAuswahl();
    if (fokusSortierung) koerper.querySelector("th[aria-sort] button")?.focus();
  }

  bereich.append(
    ...[
      rechte.zu && geschlossenHinweis(),
      !rechte.lesenAlle &&
        el(
          "p",
          { class: "leise", role: "note" },
          "Du siehst nur die Aufgaben, bei denen du verantwortlich bist oder die du unterstützt.",
        ),
      leiste2,
      leiste.wurzel,
      kennzahlen,
      koerper,
      auswahlLeiste,
    ].filter(Boolean),
  );
  zeichneKoerper();
}

import { anfrage, fehlertext } from "./api.js";
import { mitRueckgaengig } from "./rueckgaengig.js";
import { gehe, zurueckKlick } from "./verlauf.js";
import { datumZeitFeld } from "./datumsfeld.js";
import { sortierListe } from "./sortieren.js";
import {
  ankreuzen,
  auswahl,
  chip,
  dialogFormular,
  el,
  feld,
  gruppe,
  icon,
  knopf,
  neueId,
} from "./dom.js";
import {
  datumsZelle,
  entferneFeldFehler,
  feldFehler,
  heuteZuerich,
  keineTreffer,
  pruefHinweis,
  stempel,
  suchfeld,
  trifft,
  zaehlwort,
  zeitraumText,
  ersetze,
  speicherLeiste,
  termineTabelle,
} from "./kalenderhilfen.js";
import { skeletonDetail, skeletonFormular, skeletonTabelle } from "./lader.js";
import { leerKarte } from "./zustaende.js";

// Bereich «Anlässe», Unterseite «Anlässe» (A17, A18, #445, Epic #430): Anlässe anlegen und verwalten, Zusatzfelder der Anmeldung pflegen. Die Anmeldungen stehen in der Unterseite «Anmeldungen» (termine-anmeldungen.js).
// Adressen: #anlaesse/anlaesse (Liste) · #anlaesse/anlaesse/<id> (ein Anlass) · #anlaesse/anlaesse/<id>/felder (Zusatzfelder)
// Abfragen: Liste beim Öffnen 1 (und je «Weitere laden» 1); Anlass und Zusatzfelder 1 beim Öffnen, «Speichern» der Felder 2 (Abgleich mit dem Stand auf dem Server, dann Speichern). «Anlass anlegen» holt beim Öffnen des Dialogs 2 (Termine, Gruppen), «Einstellungen ändern» 1 (Gruppen). Kein Polling, kein Abruf je Zeile. Die Rechte prüft der Server (nur Abteilungsleitung).
// Lücken gegenüber dem Design: Die Liste hat keine Spalte «Anmeldungen» mit der Zahl (die API zählt sie nicht in der Liste; ein Abruf je Zeile wäre zu teuer), die Spalte «Seite» zeigt einen Link auf die Anlassseite statt ihres Pfads, und beim Konflikt der Zusatzfelder fehlt der Name der Person, die geändert hat.

const BASIS = "/api/v1/admin/anlaesse";
const MAX_FELDER = 20;
const SEITE = 50;

const FUER = { kind: "Kinder", person: "Personen" };
const SICHT = {
  oeffentlich: "Öffentlich",
  angemeldet: "Nur angemeldet",
  tags: "Bestimmte Gruppen",
};
const sichtText = (s) =>
  s.art === "tags" ? `Bestimmte Gruppen (${s.tagIds.length})` : SICHT[s.art];
const fristText = (a) => (a.frist ? `${stempel(a.frist)} Uhr` : "Keine Frist");

const TEXTE = {
  TAG_UNBEKANNT:
    "Eine gewählte Gruppe gibt es nicht mehr. Lade die Seite neu und wähle die Gruppen nochmals.",
  FELD_GESUNDHEIT:
    "Ein Feld fragt nach Gesundheitsdaten. Das nimmt die Anmeldung nicht auf. Gesperrt sind zum Beispiel Wörter rund um Allergien, Medikamente, Krankheiten und Behinderungen, auch in den Antworten zur Auswahl. Formuliere die Frage anders oder lass sie weg.",
};
const meldungVon = (f) => TEXTE[f.code] ?? fehlertext(f);

function vorbei(a) {
  return a.ganztaegig
    ? a.tagBis < heuteZuerich()
    : new Date(a.ende) < new Date();
}

// Der Stand der Anmeldung als Wort mit Symbol, nie nur Farbe
function statusChip(a) {
  if (vorbei(a)) return chip("Termin vorbei", undefined, false);
  if (!a.anmeldungOffen) return chip("Anmeldung geschlossen", "warn");
  if (a.frist && new Date(a.frist) < new Date())
    return chip("Frist vorbei", "warn");
  return chip("Anmeldung offen", "ok");
}

export function zeige(bereich, ctx) {
  const [id, unter] = ctx.pfad;
  if (id && unter === "felder") zeigeFelder(bereich, ctx, id);
  else if (id) zeigeAnlass(bereich, ctx, id);
  else zeigeListe(bereich, ctx);
}

/* ---------- Liste (A17) ---------- */

function zeigeListe(bereich, ctx) {
  const lade = () =>
    ctx.lade(
      () => anfrage("GET", `${BASIS}?limit=${SEITE}`),
      (erste) => zeichneListe(bereich, ctx, erste, lade),
      {
        skeleton: () => skeletonTabelle({ spalten: 6, avatar: false }),
        fehlerTitel: "Die Anlässe konnten nicht geladen werden.",
      },
    );
  ctx.kopfAktion(
    knopf("Neuer Anlass", {
      art: "haupt",
      symbol: "plus",
      onclick: (e) => anlegen(ctx, e.currentTarget),
    }),
  );
  return lade();
}

function zeichneListe(bereich, ctx, erste) {
  const anlaesse = [...erste.anlaesse];
  let weitere = erste.weitere;
  let naechste = erste.naechste;
  let begriff = "";

  const suche = suchfeld({
    label: "Anlass suchen",
    beiAenderung: (wert) => {
      begriff = wert;
      zeichneTabelle();
    },
  });
  const liste = el("div", {});
  const meldung = el("p", { class: "klein tm-meldung", role: "status" });
  const mehr = knopf("Weitere laden", {
    symbol: "runter",
    onclick: () => ladeWeitere(),
  });

  const zeile = (a) =>
    el(
      "tr",
      {},
      el(
        "th",
        { scope: "row" },
        el(
          "a",
          { class: "name tm-link", href: `#anlaesse/anlaesse/${a.id}` },
          a.titel,
        ),
      ),
      datumsZelle(a),
      el(
        "td",
        {},
        a.seiteId
          ? el(
              "a",
              {
                class: "tm-tabellenlink",
                href: `#website/seiten/${a.seiteId}`,
              },
              "Anlassseite",
            )
          : el("span", { class: "leise" }, "keine"),
      ),
      el("td", {}, el("ul", { class: "chips" }, statusChip(a))),
      el("td", { class: "tm-ziffern" }, fristText(a)),
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
              href: `#anlaesse/anlaesse/${a.id}/felder`,
              "aria-label": `Zusatzfelder (${a.anzahlFelder}): ${a.titel}`,
            },
            `Zusatzfelder (${a.anzahlFelder})`,
          ),
          el(
            "a",
            {
              class: "knopf knopf--klein",
              href: `#anlaesse/anmeldungen/${a.id}`,
              "aria-label": `Anmeldungen: ${a.titel}`,
            },
            "Anmeldungen",
          ),
        ),
      ),
    );

  function zeichneTabelle() {
    mehr.hidden = !weitere;
    if (anlaesse.length === 0) {
      suche.wurzel.hidden = true;
      ersetze(
        liste,
        leerKarte("Es gibt noch keine Anlässe mit Anmeldung.", [
          knopf("Neuer Anlass", {
            symbol: "plus",
            onclick: (e) => anlegen(ctx, e.currentTarget),
          }),
        ]),
      );
      return;
    }
    suche.wurzel.hidden = false;
    const treffer = anlaesse.filter(
      (a) => !begriff || trifft(a.titel, begriff),
    );
    if (treffer.length === 0) {
      ersetze(
        liste,
        keineTreffer(begriff, () => {
          suche.eingabe.value = "";
          begriff = "";
          zeichneTabelle();
          suche.eingabe.focus();
        }),
      );
      return;
    }
    const t = termineTabelle({
      beschriftung: "Anlässe, die neuesten zuerst",
      spalten: [
        "Titel",
        "Datum",
        "Seite",
        "Anmeldung",
        "Anmeldeschluss",
        "Aktionen",
      ],
      zeilen: treffer.map(zeile),
    });
    // Die Liste kommt vom Server mit den neuesten Anlässen zuerst; die Spalte «Datum» sagt es
    t.wurzel.querySelectorAll("th")[1]?.setAttribute("aria-sort", "descending");
    ersetze(liste, t.wurzel);
  }

  async function ladeWeitere() {
    mehr.disabled = true;
    mehr.setAttribute("aria-busy", "true");
    meldung.textContent = "Weitere Anlässe werden geladen …";
    try {
      const seite = await anfrage(
        "GET",
        `${BASIS}?limit=${SEITE}&nach=${encodeURIComponent(naechste)}`,
      );
      if (!bereich.isConnected) return;
      anlaesse.push(...seite.anlaesse);
      weitere = seite.weitere;
      naechste = seite.naechste;
      meldung.textContent = `${zaehlwort(seite.anlaesse.length, "weiterer Anlass", "weitere Anlässe")} geladen.`;
      zeichneTabelle();
    } catch (f) {
      meldung.textContent = `${fehlertext(f)} Versuche es nochmals.`;
    } finally {
      mehr.disabled = false;
      mehr.removeAttribute("aria-busy");
    }
  }

  bereich.append(
    el("div", { class: "werkzeuge" }, suche.wurzel),
    liste,
    meldung,
    el("div", { class: "tm-mehr" }, mehr),
  );
  zeichneTabelle();
}

/* ---------- Einstellungen (Anlegen und Ändern teilen die Felder) ---------- */

// Browserzeit statt Schweizer Zeit. shortcut: Wer von ausserhalb der Schweiz arbeitet, sieht und gibt Zeiten in der eigenen Zone ein; bei Bedarf mit der Zone Europe/Zurich umrechnen.
function lokal(iso) {
  const d = new Date(iso);
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}

function einstellungsFelder(tags, start) {
  const fuer = auswahl({
    label: "Wer meldet sich an?",
    optionen: [
      ["kind", "Eltern melden ihre Kinder an"],
      ["person", "Jede Person meldet sich selbst an"],
    ],
    wert: start.anmeldungFuer,
  });
  const offen = ankreuzen({
    label: "Die Anmeldung ist offen",
    gewaehlt: start.anmeldungOffen,
    wert: "1",
  });
  const frist = datumZeitFeld({
    label: "Anmeldeschluss (optional)",
    hilfe:
      "Ohne Anmeldeschluss ist die Anmeldung bis zum Ende des Termins möglich.",
    wert: start.frist ? lokal(start.frist) : "",
  });
  const sicht = auswahl({
    label: "Wer sieht den Anlass?",
    optionen: [
      ["angemeldet", SICHT.angemeldet],
      ["oeffentlich", SICHT.oeffentlich],
      ...(tags.length > 0 ? [["tags", SICHT.tags]] : []),
    ],
    wert: start.sichtbarkeit.art,
  });
  const gewaehlt = new Set(
    start.sichtbarkeit.art === "tags" ? start.sichtbarkeit.tagIds : [],
  );
  const tagWahl = tags.map((t) =>
    ankreuzen({ label: t.name, gewaehlt: gewaehlt.has(t.id), wert: t.id }),
  );
  const tagGruppe = gruppe(
    "Gruppen",
    el(
      "div",
      {},
      tagWahl.map((w) => w.wurzel),
    ),
    { scrollen: true },
  );
  const tagFehler = el("p", {
    class: "feld-fehler",
    role: "alert",
    hidden: true,
  });
  const zeigeTags = () => {
    tagGruppe.hidden = sicht.eingabe.value !== "tags";
    tagFehler.hidden = true;
  };
  sicht.eingabe.addEventListener("change", zeigeTags);
  zeigeTags();
  return {
    knoten: [
      fuer.wurzel,
      offen.wurzel,
      frist.wurzel,
      sicht.wurzel,
      tagGruppe,
      tagFehler,
    ],
    // true, wenn etwas fehlt (Meldung und Fokus setzt die Funktion selbst)
    pruefe() {
      if (
        sicht.eingabe.value === "tags" &&
        !tagWahl.some((w) => w.eingabe.checked)
      ) {
        tagFehler.textContent = "Wähle mindestens eine Gruppe.";
        tagFehler.hidden = false;
        tagWahl[0].eingabe.focus();
        return true;
      }
      return false;
    },
    lies() {
      const art = sicht.eingabe.value;
      return {
        anmeldungFuer: fuer.eingabe.value,
        anmeldungOffen: offen.eingabe.checked,
        frist: frist.eingabe.value
          ? new Date(frist.eingabe.value).toISOString()
          : null,
        sichtbarkeit:
          art === "tags"
            ? {
                art,
                tagIds: tagWahl
                  .filter((w) => w.eingabe.checked)
                  .map((w) => w.eingabe.value),
              }
            : { art },
      };
    },
  };
}

async function anlegen(ctx, ausloeser) {
  const von = heuteZuerich();
  const bis = new Date(Date.parse(von) + 399 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  ausloeser.disabled = true;
  ausloeser.setAttribute("aria-busy", "true");
  let termine;
  let tags;
  try {
    [termine, tags] = await Promise.all([
      anfrage("GET", `/api/v1/termine/alle?von=${von}&bis=${bis}&limit=100`),
      anfrage("GET", "/api/v1/admin/tags"),
    ]);
  } catch (f) {
    ctx.melde(meldungVon(f), "fehler");
    return;
  } finally {
    ausloeser.disabled = false;
    ausloeser.removeAttribute("aria-busy");
  }
  const frei = termine.termine.filter((t) => !t.anlass);
  if (frei.length === 0) {
    ctx.melde(
      "Es gibt keinen kommenden Termin ohne Anlass. Termine kommen aus Outlook.",
      "fehler",
    );
    return;
  }
  const wahl = auswahl({
    label: "Termin",
    optionen: [
      ["", "Termin wählen"],
      ...frei.map((t) => [t.id, `${t.titel} · ${zeitraumText(t)}`]),
    ],
    wert: "",
  });
  const terminFehler = el("p", {
    class: "feld-fehler",
    role: "alert",
    hidden: true,
  });
  const rest = einstellungsFelder(tags.tags, {
    anmeldungFuer: "kind",
    anmeldungOffen: true,
    frist: null,
    sichtbarkeit: { art: "angemeldet" },
  });
  dialogFormular({
    titel: "Neuer Anlass",
    beschreibung:
      "Ein Anlass macht aus einem Termin einen Termin mit Anmeldung. Die Zusatzfragen ergänzt du danach.",
    felder: [
      wahl.wurzel,
      terminFehler,
      termine.weitere &&
        el(
          "p",
          { class: "hilfe" },
          "Die Liste zeigt die nächsten 100 Termine.",
        ),
      ...rest.knoten,
    ],
    ok: "Anlass anlegen",
    pruefe() {
      if (!wahl.eingabe.value) {
        terminFehler.textContent = "Wähle einen Termin.";
        terminFehler.hidden = false;
        wahl.wurzel.querySelector(".auswahl-knopf").focus();
        return true;
      }
      terminFehler.hidden = true;
      return rest.pruefe();
    },
    senden: () =>
      anfrage("POST", BASIS, {
        programmId: wahl.eingabe.value,
        ...rest.lies(),
      }),
    fehlertext: meldungVon,
    danach: (neu) => {
      gehe(`#anlaesse/anlaesse/${neu.id}`);
    },
  });
}

/* ---------- Ein Anlass ---------- */

function zeigeAnlass(bereich, ctx, id) {
  const pfad = `${BASIS}/${encodeURIComponent(id)}`;
  const lade = () =>
    ctx.lade(
      () => anfrage("GET", pfad),
      (anlass) => zeichneAnlass(bereich, ctx, pfad, anlass, lade),
      {
        skeleton: skeletonDetail,
        fehlerTitel: "Der Anlass konnte nicht geladen werden.",
      },
    );
  return lade();
}

function zeichneAnlass(bereich, ctx, pfad, a, neu) {
  ctx.titel(a.titel, zeitraumText(a));

  async function einstellungen() {
    let tags;
    try {
      tags = (await anfrage("GET", "/api/v1/admin/tags")).tags;
    } catch (f) {
      ctx.melde(meldungVon(f), "fehler");
      return;
    }
    const rest = einstellungsFelder(tags, a);
    dialogFormular({
      titel: "Einstellungen ändern",
      beschreibung: `Für «${a.titel}». Wer sich anmeldet, lässt sich nur ändern, solange es keine Anmeldungen gibt.`,
      felder: rest.knoten,
      ok: "Speichern",
      pruefe: () => rest.pruefe(),
      senden: () => anfrage("PATCH", pfad, rest.lies()),
      fehlertext: meldungVon,
      danach: async () => {
        ctx.melde("Die Einstellungen sind gespeichert.");
        await neu();
        document.querySelector("h1")?.focus();
      },
    });
  }

  async function umschalten(knoten) {
    const offen = !a.anmeldungOffen;
    knoten.disabled = true;
    knoten.setAttribute("aria-busy", "true");
    try {
      await anfrage("PATCH", pfad, { anmeldungOffen: offen });
      ctx.melde(
        offen ? "Die Anmeldung ist offen." : "Die Anmeldung ist geschlossen.",
      );
      await neu();
      document.querySelector("h1")?.focus();
    } catch (f) {
      ctx.melde(meldungVon(f), "fehler");
      knoten.disabled = false;
      knoten.removeAttribute("aria-busy");
    }
  }

  // Mit «Rückgängig» (#578): Die Liste öffnet sofort, gelöscht wird nach der Frist. Das geht nur ohne Anmeldungen; der Termin und die Anlassseite im Bereich «Website» bleiben
  function loeschen() {
    const hier = window.location.hash;
    ctx.mitRueckgaengig({
      text: `«${a.titel}» ist kein Anlass mehr. Der Termin bleibt`,
      ansicht: {
        weg: () => gehe("#anlaesse/anlaesse"),
        zurueck: () => gehe(hier),
      },
      ausfuehren: () => anfrage("DELETE", pfad),
      fehlertext: meldungVon,
    });
  }

  ctx.kopfAktion(
    knopf("Einstellungen ändern", {
      art: "haupt",
      symbol: "bearbeiten",
      onclick: () => einstellungen(),
    }),
  );
  const zeilen = [
    ["Wann", zeitraumText(a)],
    ["Anmeldung für", FUER[a.anmeldungFuer]],
    ["Anmeldeschluss", fristText(a)],
    ["Sichtbar für", sichtText(a.sichtbarkeit)],
    ["Stand", el("ul", { class: "chips tm-rechts" }, statusChip(a))],
    a.seiteId && [
      "Anlassseite",
      el(
        "a",
        {
          class: "knopf knopf--klein",
          href: `#website/seiten/${a.seiteId}`,
        },
        "Im Bereich «Website» öffnen",
      ),
    ],
  ].filter(Boolean);
  bereich.append(
    el(
      "p",
      {},
      el(
        "a",
        {
          class: "knopf knopf--still knopf--klein",
          href: "#anlaesse/anlaesse",
          onclick: zurueckKlick,
        },
        icon("zurueck"),
        "Alle Anlässe",
      ),
    ),
    el(
      "section",
      { class: "flaeche", "aria-labelledby": "an-einst" },
      el("h2", { id: "an-einst" }, "Einstellungen"),
      el(
        "dl",
        { class: "werte" },
        zeilen.map(([n, w]) => el("div", {}, el("dt", {}, n), el("dd", {}, w))),
      ),
      el(
        "div",
        { class: "reihe" },
        knopf(a.anmeldungOffen ? "Anmeldung schliessen" : "Anmeldung öffnen", {
          onclick: (e) => umschalten(e.currentTarget),
        }),
        knopf("Anlass löschen", {
          art: "gefahr",
          symbol: "papierkorb",
          onclick: () => loeschen(),
        }),
      ),
    ),
    el(
      "div",
      { class: "tm-zweispalt tm-gleich" },
      el(
        "section",
        { class: "flaeche", "aria-labelledby": "an-felder" },
        el("h2", { id: "an-felder" }, "Zusatzfelder"),
        el(
          "p",
          { class: "leise" },
          a.felder.length === 0
            ? "Noch keine Zusatzfragen. Die Anmeldung fragt dann nur nach der Person oder dem Kind."
            : `${zaehlwort(a.felder.length, "Zusatzfeld", "Zusatzfelder")}: ${a.felder.map((f) => f.beschriftung).join(", ")}`,
        ),
        el(
          "a",
          { class: "knopf", href: `#anlaesse/anlaesse/${a.id}/felder` },
          "Zusatzfelder bearbeiten",
        ),
      ),
      el(
        "section",
        { class: "flaeche", "aria-labelledby": "an-anm" },
        el("h2", { id: "an-anm" }, "Anmeldungen"),
        el(
          "p",
          { class: "leise" },
          "Wer sich angemeldet hat, mit Antworten und Export.",
        ),
        el(
          "a",
          { class: "knopf", href: `#anlaesse/anmeldungen/${a.id}` },
          "Anmeldungen ansehen",
        ),
      ),
    ),
  );
}

/* ---------- Zusatzfelder (A18) ---------- */

const TYPEN = [
  ["text", "Text"],
  ["ja_nein", "Ja oder Nein"],
  ["auswahl", "Auswahl aus einer Liste"],
];
const TYP_TEXT = { text: "Text", ja_nein: "Ja/Nein", auswahl: "Auswahl" };
const UMLAUTE = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

// Schlüssel nur aus Kleinbuchstaben, Ziffern und «_» (wie der Server verlangt), eindeutig innerhalb des Anlasses
function schluesselAus(text, vergeben) {
  const basis =
    text
      .toLowerCase()
      .replace(/[äöüß]/g, (z) => UMLAUTE[z])
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36) || "feld";
  let s = basis;
  for (let n = 2; vergeben.has(s); n++) s = `${basis}_${n}`;
  return s;
}

// «Ja/Nein · Pflicht», «Auswahl: 128, 140 · Pflicht», «Text · optional»
const beschreibung = (f) =>
  `${f.typ === "auswahl" ? `Auswahl: ${f.optionen.join(", ")}` : TYP_TEXT[f.typ]} · ${f.pflicht ? "Pflicht" : "optional"}`;

// Fokus auf einen Text, der selbst kein Bedienelement ist (nach dem Neuzeichnen ist der Auslöser weg)
function fokusAuf(knoten) {
  knoten?.setAttribute("tabindex", "-1");
  knoten?.focus();
}

const normal = (felder) =>
  JSON.stringify(
    felder.map((f) => [
      f.schluessel,
      f.beschriftung,
      f.typ,
      f.optionen,
      f.pflicht,
    ]),
  );

function zeigeFelder(bereich, ctx, id) {
  const pfad = `${BASIS}/${encodeURIComponent(id)}`;
  const lade = () =>
    ctx.lade(
      () => anfrage("GET", pfad),
      (anlass) => zeichneFelder(bereich, ctx, pfad, anlass),
      {
        skeleton: () => skeletonFormular({ felder: 4 }),
        fehlerTitel: "Die Zusatzfelder konnten nicht geladen werden.",
      },
    );
  return lade();
}

function zeichneFelder(bereich, ctx, pfad, anlass) {
  ctx.titel(
    "Zusatzfelder",
    `${anlass.titel} · was bei der Anmeldung zusätzlich gefragt wird.`,
  );
  // basis: der Stand, den der Server zuletzt geliefert hat; felder: die Arbeitskopie
  let basis = anlass.felder.map((f) => ({ ...f }));
  let felder = basis.map((f) => ({
    ...f,
    optionen: [...f.optionen],
    _id: neueId("f"),
  }));
  let geaendert = false;
  let bearbeite = null;

  const status = el("p", { class: "nur-leser", role: "status" });
  const meldungen = el("div", {});
  const liste = el("div", {});
  const editor = el("div", {});
  const hinweisGesundheit = el(
    "div",
    { class: "hinweis hinweis--warn", role: "status" },
    "Keine Gesundheitsdaten abfragen.",
  );
  // Kein Speichern-Knopf im Kopf: Die Leiste unten erscheint erst, wenn etwas geändert ist
  const leiste = speicherLeiste({
    beiSpeichern: () => speichern(),
    beiVerwerfen: () => {
      felder = alsArbeitskopie(basis);
      geaendert = false;
      bearbeite = null;
      ersetze(editor);
      ersetze(meldungen);
      leiste.verstecke();
      sage("");
      zeichneListe();
      fokusAuf(liste.querySelector("h2"));
    },
  });
  const speichernKnopf = leiste.speichern;

  const sage = (text) => {
    status.textContent = text;
  };
  function markiere() {
    if (geaendert) return;
    geaendert = true;
    leiste.zeige(
      "Änderungen an den Zusatzfeldern sind noch nicht gespeichert.",
    );
    sage("");
  }
  const rundKnopf = (symbol, label, aktion, onclick) =>
    el(
      "button",
      {
        type: "button",
        class: "knopf knopf--rund",
        "aria-label": label,
        "data-aktion": aktion,
        onclick,
      },
      icon(symbol),
    );

  function zeichneListe() {
    // Griff und Knöpfe «Nach oben» und «Nach unten» kommen aus der Sortierliste (sortieren.js); Bearbeiten und Entfernen stehen in der Zeile
    const sortierung =
      felder.length > 1
        ? sortierListe({
            beschriftung: "Zusatzfelder",
            eintraege: felder.map((f) => ({
              id: f._id,
              text: f.beschriftung,
              inhalt: zeilenInhalt(f),
            })),
            beiNeu: (ids) => {
              const nach = new Map(felder.map((f) => [f._id, f]));
              felder = ids.map((id) => nach.get(id));
              markiere();
            },
          })
        : null;
    ersetze(
      liste,
      el(
        "section",
        { class: "flaeche", "aria-labelledby": "zf-liste" },
        el("h2", { id: "zf-liste" }, "Zusatzfelder"),
        felder.length === 0
          ? el(
              "p",
              { class: "leise" },
              "Noch keine Zusatzfragen. Die Anmeldung fragt dann nur nach der Person oder dem Kind.",
            )
          : sortierung
            ? [
                el(
                  "p",
                  { class: "klein leise" },
                  "Ordne die Fragen per Ziehen am Griff oder mit den Pfeilknöpfen. Die Reihenfolge gilt erst nach «Speichern».",
                ),
                sortierung.wurzel,
              ]
            : el(
                "ul",
                { class: "liste-zeilen" },
                el("li", {}, zeilenInhalt(felder[0])),
              ),
        felder.length >= MAX_FELDER
          ? el("p", { class: "hilfe" }, `Höchstens ${MAX_FELDER} Felder.`)
          : knopf("Feld hinzufügen", {
              symbol: "plus",
              onclick: () => oeffneEditor(null),
            }),
      ),
    );
  }

  // Name, Typ und die beiden Aktionen eines Feldes
  function zeilenInhalt(f) {
    return el(
      "div",
      { class: "tm-feldzeile", "data-id": f._id },
      el(
        "div",
        { class: "text" },
        el("span", { class: "name" }, f.beschriftung),
        el("span", { class: "klein leise" }, beschreibung(f)),
      ),
      el(
        "div",
        { class: "tm-feldaktionen" },
        knopf("Bearbeiten", {
          klein: true,
          symbol: "bearbeiten",
          kontext: f.beschriftung,
          onclick: () => oeffneEditor(f),
        }),
        rundKnopf("papierkorb", `Entfernen: ${f.beschriftung}`, "weg", () =>
          entferne(f),
        ),
      ),
    );
  }

  // Mit «Rückgängig» (#578): Das Feld verschwindet sofort aus der Liste, bei «Rückgängig» steht es wieder an seiner Stelle. Erst «Speichern» übernimmt es; gibt es schon Antworten zu dem Feld, lehnt der Server das Speichern ab
  function entferne(f) {
    const i = felder.indexOf(f);
    mitRueckgaengig({
      text: `Feld «${f.beschriftung}» entfernt, noch nicht gespeichert`,
      ansicht: {
        weg: () => {
          felder.splice(i, 1);
          markiere();
          zeichneListe();
          fokusAuf(
            liste.querySelector(
              `[data-id="${(felder[i] ?? felder[i - 1])?._id}"] .name`,
            ) ?? liste.querySelector("h2"),
          );
        },
        zurueck: () => {
          felder.splice(i, 0, f);
          markiere();
          zeichneListe();
        },
      },
      ausfuehren: async () => {},
    });
  }

  // Der Editor für ein neues oder ein bestehendes Feld (f), solange es ungespeichert in der Liste steht
  function oeffneEditor(f) {
    bearbeite = f;
    const titel = el(
      "h2",
      { tabindex: "-1" },
      f ? "Feld bearbeiten" : "Neues Feld",
    );
    const name = feld({
      label: "Feldname",
      hilfe:
        "Die Frage, wie Eltern oder Teilnehmende sie lesen. Höchstens 100 Zeichen.",
      wert: f?.beschriftung ?? "",
      maxlength: 100,
    });
    const typ = auswahl({
      label: "Typ",
      optionen: TYPEN,
      wert: f?.typ ?? "text",
    });
    const optionen = feld({
      label: "Antworten zur Auswahl",
      mehrzeilig: true,
      rows: 4,
      wert: (f?.optionen ?? []).join("\n"),
      hilfe: "Eine Antwort pro Zeile. Mindestens 2, höchstens 20.",
    });
    const pflicht = ankreuzen({
      label: "Pflichtfeld: Ohne Antwort geht die Anmeldung nicht",
      gewaehlt: f?.pflicht ?? false,
      wert: "1",
    });
    const meld = el("div", {});
    const zeigeOptionen = () => {
      optionen.wurzel.hidden = typ.eingabe.value !== "auswahl";
    };
    typ.eingabe.addEventListener("change", zeigeOptionen);
    zeigeOptionen();
    const optionenVon = () =>
      optionen.eingabe.value
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);

    function uebernehmen() {
      entferneFeldFehler(editor);
      ersetze(meld);
      const fehler = [];
      const wert = name.eingabe.value.trim();
      if (!wert) {
        feldFehler(
          name,
          "Gib dem Feld einen Namen, zum Beispiel «Zelt-Wunsch».",
        );
        fehler.push({ name: "Feldname", eingabe: name.eingabe });
      }
      const o = optionenVon();
      if (typ.eingabe.value === "auswahl") {
        const text = o.some((t) => t.length > 100)
          ? "Jede Antwort darf höchstens 100 Zeichen lang sein."
          : o.length < 2
            ? "Gib mindestens 2 Antworten an, eine pro Zeile."
            : o.length > 20
              ? "Gib höchstens 20 Antworten an."
              : new Set(o).size !== o.length
                ? "Jede Antwort darf nur einmal vorkommen."
                : null;
        if (text) {
          feldFehler(optionen, text);
          fehler.push({ name: "Antworten", eingabe: optionen.eingabe });
        }
      }
      if (fehler.length > 0) {
        const hinweis = pruefHinweis(fehler);
        ersetze(meld, hinweis);
        hinweis.focus();
        return;
      }
      const neu = {
        schluessel: f?.schluessel ?? null,
        beschriftung: wert,
        typ: typ.eingabe.value,
        optionen: typ.eingabe.value === "auswahl" ? o : [],
        pflicht: pflicht.eingabe.checked,
      };
      if (f) Object.assign(f, neu);
      else felder.push({ ...neu, _id: neueId("f") });
      bearbeite = null;
      ersetze(editor);
      markiere();
      zeichneListe();
      const ziel = f ?? felder.at(-1);
      sage(`«${wert}» ist übernommen, noch nicht gespeichert.`);
      fokusAuf(liste.querySelector(`[data-id="${ziel._id}"] .name`));
    }

    ersetze(
      editor,
      el(
        "section",
        {
          class: "flaeche",
          "aria-label": f ? "Feld bearbeiten" : "Neues Feld",
        },
        titel,
        meld,
        name.wurzel,
        typ.wurzel,
        optionen.wurzel,
        pflicht.wurzel,
        el(
          "div",
          { class: "reihe" },
          knopf("Feld übernehmen", { art: "blau", onclick: uebernehmen }),
          knopf("Abbrechen", {
            onclick: () => {
              bearbeite = null;
              ersetze(editor);
              fokusAuf(
                liste.querySelector(f ? `[data-id="${f._id}"] .name` : "h2"),
              );
            },
          }),
        ),
      ),
    );
    titel.focus();
  }

  // Stand der Felder, den der Server schickt (für den Konflikt und nach dem Speichern)
  const alsArbeitskopie = (serverFelder) =>
    serverFelder.map((f) => ({
      ...f,
      optionen: [...f.optionen],
      _id: neueId("f"),
    }));

  function koerper(liste_) {
    const vergeben = new Set(liste_.map((f) => f.schluessel).filter(Boolean));
    return liste_.map((f) => {
      const schluessel =
        f.schluessel ?? schluesselAus(f.beschriftung, vergeben);
      vergeben.add(schluessel);
      return {
        schluessel,
        beschriftung: f.beschriftung,
        typ: f.typ,
        optionen: f.typ === "auswahl" ? f.optionen : [],
        pflicht: f.pflicht,
      };
    });
  }

  // 409 FELD_IN_BENUTZUNG nennt die Schlüssel; der Text nennt die Fragen
  function belegt(f, gesendet) {
    if (f.code !== "FELD_IN_BENUTZUNG") return null;
    const namen = (f.daten?.schluessel ?? [])
      .map(
        (s) =>
          gesendet.find((x) => x.schluessel === s)?.beschriftung ??
          basis.find((x) => x.schluessel === s)?.beschriftung ??
          s,
      )
      .map((n) => `«${n}»`)
      .join(", ");
    return `Zu diesen Feldern gibt es schon Antworten: ${namen}. Sie lassen sich weder entfernen noch auf einen anderen Typ umstellen. Stelle sie wieder her oder lade die Seite neu.`;
  }

  async function schreibe(gesendet) {
    const antwort = await anfrage("PUT", `${pfad}/felder`, {
      felder: gesendet,
    });
    basis = antwort.felder.map((f) => ({ ...f }));
    felder = alsArbeitskopie(antwort.felder);
    geaendert = false;
    leiste.verstecke();
    sage("");
    ersetze(meldungen);
    ersetze(editor);
    bearbeite = null;
    zeichneListe();
    ctx.melde(
      "Zusatzfelder gespeichert. Neue Anmeldungen fragen sie ab sofort ab.",
    );
  }

  function zeigeFehler(text) {
    const hinweis = el(
      "div",
      { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
      `Nicht gespeichert. ${text} Deine Felder sind noch da, speichere nochmals.`,
    );
    ersetze(meldungen, hinweis);
    hinweis.focus();
  }

  async function speichern() {
    ersetze(meldungen);
    if (bearbeite !== null || editor.firstChild) {
      zeigeFehler("Du bearbeitest gerade ein Feld. Übernimm es oder brich ab.");
      return;
    }
    speichernKnopf.disabled = true;
    speichernKnopf.setAttribute("aria-busy", "true");
    const gesendet = koerper(felder);
    try {
      // Hat inzwischen jemand anders die Felder geändert? Dann entscheidet die Person, welche Fassung gilt.
      const aktuell = (await anfrage("GET", pfad)).felder;
      if (normal(aktuell) !== normal(basis)) {
        zeigeKonflikt(gesendet, aktuell);
        return;
      }
      await schreibe(gesendet);
    } catch (f) {
      zeigeFehler(belegt(f, gesendet) ?? meldungVon(f));
    } finally {
      speichernKnopf.disabled = false;
      speichernKnopf.removeAttribute("aria-busy");
    }
  }

  // Konflikt (A18): Deine Fassung neben der aktuellen; geänderte Zeilen sind markiert
  function zeigeKonflikt(meine, aktuell) {
    const zeile = (f) => `${f.beschriftung} · ${beschreibung(f)}`;
    const andere = (liste_) => new Set(liste_.map(zeile));
    const spalte = (titel, felderListe, gegen) =>
      el(
        "section",
        { class: "flaeche", "aria-label": titel },
        el("h3", {}, titel),
        felderListe.length === 0
          ? el("p", { class: "klein leise" }, "Keine Zusatzfelder")
          : felderListe.map((f) => {
              const geandert = !gegen.has(zeile(f));
              return el(
                "p",
                { class: "klein" },
                geandert &&
                  el("span", { class: "chip chip--warn" }, "geändert"),
                geandert && " ",
                el(
                  "span",
                  { class: geandert ? "markiert" : undefined },
                  zeile(f),
                ),
              );
            }),
      );
    const hinweis = el(
      "div",
      { class: "hinweis hinweis--warn", role: "alert", tabindex: "-1" },
      el(
        "span",
        {},
        el("strong", {}, "Jemand hat die Zusatzfelder gerade geändert."),
        " Wähle, welche Fassung gilt.",
      ),
    );
    ersetze(
      editor,
      el(
        "div",
        { class: "tm-konflikt-block" },
        hinweis,
        el(
          "div",
          { class: "konflikt" },
          spalte("Deine Fassung", meine, andere(aktuell)),
          spalte("Aktuelle Fassung", aktuell, andere(meine)),
        ),
        el(
          "div",
          { class: "reihe" },
          knopf("Meine behalten", {
            onclick: async (e) => {
              e.currentTarget.disabled = true;
              try {
                // Der Stand des Servers gilt jetzt als Ausgangslage; meine Fassung überschreibt ihn bewusst
                basis = aktuell.map((f) => ({ ...f }));
                await schreibe(meine);
              } catch (f) {
                zeigeFehler(belegt(f, meine) ?? meldungVon(f));
              }
            },
          }),
          knopf("Aktuelle übernehmen", {
            art: "blau",
            onclick: () => {
              basis = aktuell.map((f) => ({ ...f }));
              felder = alsArbeitskopie(aktuell);
              geaendert = false;
              leiste.verstecke();
              sage("");
              ersetze(editor);
              zeichneListe();
              ctx.melde(
                "Die aktuelle Fassung der Zusatzfelder ist übernommen.",
                "info",
              );
            },
          }),
        ),
      ),
    );
    hinweis.focus();
  }

  bereich.append(
    el(
      "section",
      { class: "flaeche", "aria-labelledby": "zf-konto" },
      el("h2", { id: "zf-konto" }, "Kommt aus dem Konto"),
      el(
        "p",
        { class: "klein leise" },
        "Nur lesbar. Eltern ändern es in ihrem Profil.",
      ),
      el(
        "ul",
        { class: "chips" },
        (anlass.anmeldungFuer === "kind"
          ? ["Name", "Kind", "Stufe", "Telefon"]
          : ["Name", "Telefon"]
        ).map((t) => chip(t, "ok")),
      ),
    ),
    meldungen,
    liste,
    editor,
    hinweisGesundheit,
    status,
    leiste.wurzel,
  );
  zeichneListe();
}

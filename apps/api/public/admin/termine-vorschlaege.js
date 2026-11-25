import { anfrage, fehlertext } from "./api.js";
import { ersetzeAdresse, schiebeAdresse } from "./verlauf.js";
import {
  chip,
  dialogFormular,
  el,
  feld,
  filterGruppe,
  knopf,
  zeit,
} from "./dom.js";
import {
  entferneFeldFehler,
  feldFehler,
  meldungsDialog,
  terminAnzeige,
  zaehlwort,
  ersetze,
} from "./kalenderhilfen.js";
import { skeletonListe } from "./lader.js";
import {
  leerKarte,
  nochmals,
  zustandsDaten,
  zustandsKarte,
} from "./zustaende.js";

// Unterseite «Vorschläge» (A9, A10, Epic #430): Die Abteilungsleitung prüft Terminvorschläge, gibt sie frei oder lehnt sie ab und meldet freigegebene als in Outlook eingetragen. Cevi OS legt Termine nie in Outlook an (Kategorien schreibt es seit #835, nur mit der Anbindung): Die Schnittstelle zum Schreiben gibt es nicht, darum ist «Freigeben» immer die Fassung «Verbindung nicht eingerichtet» des Designs.
// Adressen: #termine/vorschlaege (offene) · #termine/vorschlaege/<status> (freigegeben, abgelehnt, eingetragen) · #termine/vorschlaege/<id> (ein Vorschlag, die Liste zeigt seinen Stand)
// Datenbanklast: eine Abfrage der Liste beim Öffnen, beim Wechsel des Stands und je «Weitere laden» (50 Zeilen); eine Abfrage des Details je Auswahl und je Entscheid. Kein Polling. Die Rechte prüft der Server.

const BASIS = "/api/v1/admin/termin-vorschlaege";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// [Adresse, Status der API, Name im Filter, Zähler (ein, mehrere), Text bei leerer Liste]
const STATI = [
  [
    "offen",
    "offen",
    "Offen",
    ["offener Vorschlag", "offene Vorschläge"],
    "Gerade wartet kein Vorschlag auf dich.",
  ],
  [
    "freigegeben",
    "freigegeben",
    "Freigegeben",
    ["freigegebener Vorschlag", "freigegebene Vorschläge"],
    "Es gibt keine freigegebenen Vorschläge, die noch in Outlook einzutragen sind.",
  ],
  [
    "abgelehnt",
    "abgelehnt",
    "Abgelehnt",
    ["abgelehnter Vorschlag", "abgelehnte Vorschläge"],
    "Es gibt keine abgelehnten Vorschläge.",
  ],
  [
    "eingetragen",
    "in_outlook_eingetragen",
    "Eingetragen",
    ["eingetragener Vorschlag", "eingetragene Vorschläge"],
    "Es gibt keine Vorschläge, die als in Outlook eingetragen markiert sind.",
  ],
];
const adresseVon = (status) =>
  STATI.find(([, api]) => api === status)?.[0] ?? "offen";

// Der Status steht als Wort mit Symbol, nie nur als Farbe: [Text, Art, Symbol]
const STATUS = {
  offen: ["Offen", "warn", "uhr"],
  freigegeben: ["Freigegeben", "ok"],
  abgelehnt: ["Abgelehnt", "fehler"],
  in_outlook_eingetragen: ["In Outlook eingetragen", "ok"],
};
function statusChip(status) {
  const [text, art, symbol] = STATUS[status] ?? [status, undefined, false];
  return el("ul", { class: "chips" }, chip(text, art, symbol));
}

const GELOESCHT = "Gelöschtes Konto";

function fehlerText(f) {
  if (f.status === 403 && f.code === "EIGENER_VORSCHLAG") {
    return "Über deinen eigenen Vorschlag entscheidet eine andere Person.";
  }
  if (f.status === 404) {
    return "Diesen Vorschlag gibt es nicht mehr. Lade die Seite neu.";
  }
  return fehlertext(f);
}

const ladeListe = (status, nach) => {
  const q = new URLSearchParams({ status });
  if (nach) q.set("nach", nach);
  return anfrage("GET", `${BASIS}?${q}`);
};
const ladeDetail = (id) => anfrage("GET", `${BASIS}/${id.toLowerCase()}`);

export function zeige(bereich, ctx) {
  const [erst] = ctx.pfad;
  const eintrag =
    erst && !UUID.test(erst) ? STATI.find(([a]) => a === erst) : null;
  if (erst && !UUID.test(erst) && !eintrag) {
    bereich.append(
      leerKarte(
        "Diese Ansicht gibt es nicht. Wähle «Offen», «Freigegeben», «Abgelehnt» oder «Eingetragen».",
        [
          el(
            "a",
            { class: "knopf", href: "#termine/vorschlaege" },
            "Zu den Vorschlägen",
          ),
        ],
      ),
    );
    return;
  }
  ctx.lade(
    async () => {
      // Mit einer ID: erst der Vorschlag, dann die Liste seines Stands. Sonst die Liste und der erste Vorschlag.
      if (erst && UUID.test(erst)) {
        const detail = await ladeDetail(erst);
        return {
          status: detail.status,
          seite: await ladeListe(detail.status),
          detail,
        };
      }
      const status = eintrag ? eintrag[1] : "offen";
      const seite = await ladeListe(status);
      const erster = seite.vorschlaege[0];
      return {
        status,
        seite,
        detail: erster ? await ladeDetail(erster.id) : null,
      };
    },
    (daten) => zeichne(bereich, ctx, daten),
    {
      skeleton: skeletonListe,
      fehlerTitel: "Die Vorschläge konnten nicht geladen werden.",
    },
  );
}

function zeichne(bereich, ctx, start) {
  let status = start.status;
  let vorschlaege = [...start.seite.vorschlaege];
  let weitere = start.seite.weitere;
  let naechste = start.seite.naechste;
  let aktuell = start.detail;
  let lauf = 0;

  const filter = filterGruppe({
    beschriftung: "Stand",
    eintraege: STATI.map(([, api, name]) => ({ text: name, wert: api })),
    wert: status,
    beiAenderung: (neu) => wechsle(neu),
  });
  const zaehler = el("p", { class: "klein leise", role: "status" });
  const meldung = el("p", { class: "klein tm-meldung", role: "status" });
  const listeBox = el("div", {});
  const detail = el("section", { class: "flaeche tm-detail" });
  const mehr = knopf("Weitere laden", {
    symbol: "runter",
    onclick: () => ladeWeitere(),
  });
  const grid = el("div", { class: "tm-zweispalt" });

  const woerter = () => STATI.find(([, api]) => api === status)[3];

  function meldeZaehler() {
    if (status !== "offen") return;
    // Nur eine ganze Liste ergibt eine richtige Zahl für die Unterleiste
    if (!weitere) ctx.zaehler("vorschlaege", vorschlaege.length);
  }

  function zeichneListe() {
    zaehler.textContent =
      vorschlaege.length === 0
        ? ""
        : `${weitere ? "Mindestens " : ""}${vorschlaege.length} ${woerter()[vorschlaege.length === 1 ? 0 : 1]}`;
    mehr.hidden = !weitere;
    // Ohne Vorschlag gibt es nichts zu zeigen: Die Fläche entfällt
    detail.hidden = vorschlaege.length === 0;
    grid.classList.toggle("tm-einspaltig", vorschlaege.length === 0);
    if (vorschlaege.length === 0) {
      ersetze(listeBox, leerKarte(STATI.find(([, api]) => api === status)[4]));
      return;
    }
    ersetze(
      listeBox,
      el(
        "ul",
        { class: "tm-vorliste", "aria-label": "Vorschläge" },
        vorschlaege.map((v) => {
          const gewaehlt = aktuell?.id === v.id;
          return el(
            "li",
            {},
            el(
              "a",
              {
                class: "tm-vor",
                href: `#termine/vorschlaege/${v.id}`,
                "aria-current": gewaehlt ? "true" : undefined,
                onclick: (e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
                  e.preventDefault();
                  waehle(v.id, { neuerEintrag: true });
                },
              },
              el("span", { class: "name" }, v.titel),
              el(
                "span",
                { class: "klein leise" },
                `${v.vorgeschlagenVonName ?? GELOESCHT} · ${terminAnzeige(v).tag}`,
              ),
              statusChip(v.status),
            ),
          );
        }),
      ),
    );
  }

  // Der Fokus kehrt nach einem Dialog an den Titel des Details zurück, denn der Auslöser wurde neu gezeichnet
  function zeichneDetail(v, { fokus = false, vermerk = null } = {}) {
    const titel = el("h2", { tabindex: "-1" }, v.titel);
    const eigener = v.vorgeschlagenVon === ctx.ich.id;
    const zeilen = [
      ["Datum", terminAnzeige(v).tag],
      [
        "Zeit",
        v.ganztaegig
          ? "ganztägig"
          : terminAnzeige(v).zeit.replace("–", " bis "),
      ],
      v.ort && ["Ort", v.ort],
      [
        "Gruppen",
        v.tags.length === 0
          ? el(
              "span",
              { class: "leise" },
              "Keine. Die Gruppen dieses Vorschlags gibt es nicht mehr.",
            )
          : el(
              "ul",
              { class: "chips tm-rechts" },
              v.tags.map((t) => chip(t.name, undefined, "tag")),
            ),
      ],
      [
        "Vorgeschlagen von",
        v.vorgeschlagenVonName ?? el("span", { class: "leise" }, GELOESCHT),
      ],
      ["Eingereicht am", zeit(v.erstelltAm)],
      v.kategorien?.length > 0 && [
        "Kategorien in Outlook",
        el(
          "ul",
          { class: "chips tm-rechts tm-roh" },
          v.kategorien.map((k) => chip(k, undefined, false)),
        ),
      ],
      v.entschiedenAm && ["Entschieden am", zeit(v.entschiedenAm)],
    ].filter(Boolean);
    const block = (name, text) =>
      text &&
      el(
        "div",
        { class: "tm-block" },
        el("h3", {}, name),
        el("p", { class: "tm-text" }, text),
      );
    ersetze(
      detail,
      el("div", { class: "zeile tm-kopfzeile" }, titel, statusChip(v.status)),
      vermerk,
      el(
        "dl",
        { class: "werte" },
        zeilen.map(([n, w]) => el("div", {}, el("dt", {}, n), el("dd", {}, w))),
      ),
      block("Beschreibung", v.beschreibung),
      block("Bemerkung", v.bemerkung),
      v.status === "abgelehnt" && block("Begründung", v.begruendung),
      aktionen(v, eigener),
    );
    detail.removeAttribute("aria-busy");
    if (fokus) titel.focus();
  }

  function aktionen(v, eigener) {
    if (v.status === "offen") {
      if (eigener) {
        return el(
          "p",
          { class: "hinweis" },
          "Über deinen eigenen Vorschlag entscheidet eine andere Person.",
        );
      }
      return el(
        "div",
        { class: "reihe" },
        knopf("Freigeben", {
          art: "haupt",
          symbol: "haken",
          onclick: () => freigeben(v),
        }),
        knopf("Ablehnen", { symbol: "sperre", onclick: () => ablehnen(v) }),
      );
    }
    if (v.status !== "freigegeben") return false;
    return el(
      "div",
      { class: "tm-ausfuehren" },
      el(
        "p",
        { class: "leise" },
        "Trag den Termin in Outlook von Hand ein, mit den Kategorien oben. Melde danach hier, dass er eingetragen ist.",
      ),
      el(
        "div",
        { class: "reihe" },
        v.kategorien?.length > 0 &&
          knopf("Kategorien kopieren", {
            symbol: "kopieren",
            onclick: async () => {
              try {
                await navigator.clipboard.writeText(v.kategorien.join("; "));
                ctx.melde("Kategorien kopiert.");
              } catch {
                ctx.melde(
                  "Kopieren ist nicht möglich. Markiere die Kategorien von Hand.",
                  "fehler",
                );
              }
            },
          }),
        knopf("Als in Outlook eingetragen markieren", {
          art: "haupt",
          symbol: "haken",
          onclick: () => eingetragen(v),
        }),
      ),
    );
  }

  // Detail laden (eine Abfrage) und zeichnen; bei einem Fehler Karte mit «Nochmals versuchen» im Detail
  async function waehle(id, optionen = {}) {
    const mein = ++lauf;
    detail.setAttribute("aria-busy", "true");
    // Ein Klick legt einen Eintrag im Verlauf an, Korrekturen (erster Vorschlag, Stand nach einem Entscheid) ersetzen ihn (#578)
    if (optionen.neuerEintrag) schiebeAdresse(`#termine/vorschlaege/${id}`);
    else ersetzeAdresse(`#termine/vorschlaege/${id}`);
    try {
      const v = await ladeDetail(id);
      if (mein !== lauf || !bereich.isConnected) return;
      aktuell = v;
      // Die Zeile der Liste führt den Stand nach
      const zeileV = vorschlaege.find((x) => x.id === v.id);
      if (zeileV) zeileV.status = v.status;
      zeichneListe();
      meldeZaehlerNachEntscheid();
      zeichneDetail(v, optionen);
    } catch (f) {
      if (mein !== lauf || !bereich.isConnected) return;
      const karte = zustandsKarte(
        zustandsDaten(f),
        [nochmals(() => waehle(id, optionen))],
        "h2",
      );
      ersetze(detail, karte.wurzel);
      detail.removeAttribute("aria-busy");
      karte.titel.focus();
    }
  }

  // Wer im Stand «Offen» entschieden hat, zählt nicht mehr zu den offenen
  function meldeZaehlerNachEntscheid() {
    if (status !== "offen" || weitere) return;
    ctx.zaehler(
      "vorschlaege",
      vorschlaege.filter((x) => x.status === "offen").length,
    );
  }

  async function wechsle(neu, { neuerEintrag = true } = {}) {
    const mein = ++lauf;
    const alt = status;
    status = neu;
    const ziel = `#termine/vorschlaege/${adresseVon(neu)}`;
    if (neuerEintrag) schiebeAdresse(ziel);
    else ersetzeAdresse(ziel);
    listeBox.setAttribute("aria-busy", "true");
    zaehler.textContent = "Wird geladen …";
    try {
      const seite = await ladeListe(neu);
      if (mein !== lauf || !bereich.isConnected) return;
      vorschlaege = [...seite.vorschlaege];
      weitere = seite.weitere;
      naechste = seite.naechste;
      aktuell = null;
      zeichneListe();
      meldeZaehler();
      listeBox.removeAttribute("aria-busy");
      if (vorschlaege[0]) await waehle(vorschlaege[0].id);
      else {
        ersetze(
          detail,
          el("p", { class: "leise" }, "Kein Vorschlag ausgewählt."),
        );
      }
    } catch (f) {
      if (mein !== lauf || !bereich.isConnected) return;
      // Der Filter zeigt wieder den Stand, den die Liste noch hat
      status = alt;
      filter.setze(alt);
      ctx.melde(`${fehlerText(f)} Versuche es nochmals.`, "fehler");
      zeichneListe();
    } finally {
      if (mein === lauf) listeBox.removeAttribute("aria-busy");
    }
  }

  async function ladeWeitere() {
    const mein = lauf;
    mehr.disabled = true;
    mehr.setAttribute("aria-busy", "true");
    meldung.textContent = "Weitere Vorschläge werden geladen …";
    try {
      const seite = await ladeListe(status, naechste);
      // Zwischen Anfrage und Antwort kann man Stand oder Seite gewechselt haben
      if (mein !== lauf || !bereich.isConnected) return;
      vorschlaege.push(...seite.vorschlaege);
      weitere = seite.weitere;
      naechste = seite.naechste;
      ctx.melde(
        `${zaehlwort(seite.vorschlaege.length, "weiterer Vorschlag", "weitere Vorschläge")} geladen.`,
      );
      zeichneListe();
      meldeZaehler();
    } catch (f) {
      if (mein === lauf)
        ctx.melde(`${fehlerText(f)} Versuche es nochmals.`, "fehler");
    } finally {
      meldung.textContent = "";
      mehr.disabled = false;
      mehr.removeAttribute("aria-busy");
    }
  }

  // Ein Dialog mit Rückfrage. Hat jemand anders schon entschieden (409), schliesst er sich, das Detail zeigt den aktuellen Stand und ein Dialog sagt es.
  function entscheide({ v, pfad, body, erfolg, ...dialog }) {
    const d = dialogFormular({
      ...dialog,
      fehlertext: fehlerText,
      senden: async () => {
        try {
          return await anfrage("POST", `${BASIS}/${v.id}/${pfad}`, body?.());
        } catch (f) {
          if (f.code !== "STATUS_UNGUELTIG") throw f;
          return "konflikt";
        }
      },
      danach: async (ergebnis) => {
        if (ergebnis === "konflikt") {
          await waehle(v.id, { fokus: false });
          const neu = aktuell;
          meldungsDialog({
            titel: "Vorschlag schon entschieden",
            hinweis: `Dieser Vorschlag ist inzwischen «${STATUS[neu?.status]?.[0] ?? "entschieden"}»${neu?.entschiedenAm ? ` (${zeit(neu.entschiedenAm)})` : ""}.`,
            text: "Du musst nichts mehr tun. Hier siehst du den aktuellen Stand.",
            ok: "Zur Liste",
            beiOk: () => listeBox.querySelector("a")?.focus(),
          });
          return;
        }
        ctx.melde(erfolg, "ok");
        await waehle(v.id, { fokus: true });
      },
    });
    return d;
  }

  function freigeben(v) {
    const kategorien = v.kategorien ?? [];
    const vergib =
      kategorien.length > 0
        ? `vergib die ${kategorien.length === 1 ? "Kategorie" : "Kategorien"} ${kategorien.map((k) => `«${k}»`).join(", ")}`
        : "vergib die passenden Kategorien";
    entscheide({
      v,
      pfad: "entscheid",
      body: () => ({ entscheid: "freigeben" }),
      titel: "Vorschlag freigeben?",
      beschreibung: `«${v.titel}» wird freigegeben. Die vorschlagende Person sieht den Entscheid in der App.`,
      felder: [
        el(
          "p",
          { class: "hinweis", role: "status" },
          `Die Verbindung zu Outlook ist noch nicht zum Schreiben eingerichtet. Trag den Termin selbst in Outlook ein und ${vergib}. Wir markieren den Vorschlag als freigegeben.`,
        ),
      ],
      ok: "Freigeben",
      erfolg: `«${v.titel}» ist freigegeben. Trag ihn jetzt in Outlook ein. ${v.vorgeschlagenVonName ?? "Die vorschlagende Person"} bekommt eine Mitteilung.`,
    });
  }

  function ablehnen(v) {
    const grund = feld({
      label: "Begründung",
      hilfe: `${v.vorgeschlagenVonName ?? "Die vorschlagende Person"} sieht sie in der App. Höchstens 500 Zeichen.`,
      mehrzeilig: true,
      rows: 4,
      maxlength: 500,
    });
    entscheide({
      v,
      pfad: "entscheid",
      body: () => ({
        entscheid: "ablehnen",
        begruendung: grund.eingabe.value.trim(),
      }),
      titel: "Vorschlag ablehnen?",
      beschreibung: `«${v.titel}» wird abgelehnt. Das lässt sich nicht rückgängig machen.`,
      felder: [grund.wurzel],
      ok: "Ablehnen",
      gefaehrlich: true,
      pruefe: () => {
        entferneFeldFehler(grund.wurzel);
        if (grund.eingabe.value.trim()) return false;
        feldFehler(
          grund,
          "Schreib eine Begründung, damit die Person weiss, warum.",
        );
        grund.eingabe.focus();
        return true;
      },
      erfolg: `«${v.titel}» ist abgelehnt.`,
    });
  }

  function eingetragen(v) {
    entscheide({
      v,
      pfad: "eingetragen",
      titel: "Als in Outlook eingetragen markieren?",
      beschreibung: `Bestätige nur, wenn «${v.titel}» in Outlook eingetragen ist. Der Abgleich mit Outlook übernimmt ihn dann als Termin.`,
      ok: "Als eingetragen markieren",
      erfolg: `«${v.titel}» ist als in Outlook eingetragen markiert.`,
    });
  }

  // Browser-Zurück und -Vor: Die Ansicht folgt der Adresse (Stand oder Vorschlag), ohne einen neuen Eintrag anzulegen (#578)
  const beiVerlauf = () => {
    if (!bereich.isConnected) {
      return window.removeEventListener("popstate", beiVerlauf);
    }
    const [, , , rest] = location.hash.split("/");
    if (location.hash.split("/")[1] !== "vorschlaege") return;
    if (rest && UUID.test(rest)) {
      if (aktuell?.id?.toLowerCase() !== rest.toLowerCase()) {
        waehle(rest, { fokus: false });
      }
      return;
    }
    const eintrag = STATI.find(([a]) => a === (rest ?? "offen"));
    if (eintrag && eintrag[1] !== status) {
      filter.setze(eintrag[1]);
      wechsle(eintrag[1], { neuerEintrag: false });
    }
  };
  window.addEventListener("popstate", beiVerlauf);
  bereich.append(el("div", { class: "tm-filterzeile" }, filter.wurzel), grid);
  grid.append(
    el(
      "div",
      { class: "tm-links" },
      zaehler,
      listeBox,
      meldung,
      el("div", { class: "tm-mehr" }, mehr),
    ),
    detail,
  );
  zeichneListe();
  meldeZaehler();
  if (aktuell) zeichneDetail(aktuell);
  else
    ersetze(
      detail,
      el(
        "p",
        { class: "leise" },
        vorschlaege.length === 0 ? "" : "Kein Vorschlag ausgewählt.",
      ),
    );
}

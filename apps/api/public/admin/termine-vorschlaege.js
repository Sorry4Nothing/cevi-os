import { anfrage, fehlertext } from "./api.js";
import {
  chip,
  dialogFormular,
  el,
  feld,
  filterGruppe,
  knopf,
  tabelle,
  zeit,
} from "./dom.js";

// Reiter «Vorschläge» (#441, TD3, Epic #430): Die Abteilungsleitung prüft Terminvorschläge, gibt sie frei oder lehnt sie ab und meldet freigegebene als in Outlook eingetragen. Cevi OS schreibt nie nach Outlook. Schnittstelle: siehe termine.js.
// Adressen: #termine/vorschlaege (offene) · #termine/vorschlaege/<status> (freigegeben, abgelehnt, eingetragen) · #termine/vorschlaege/<id> (Detail)
// Datenbanklast: eine Abfrage beim Öffnen der Liste und je Statuswechsel oder «Weitere laden» (50 Zeilen), eine beim Öffnen des Details, danach eine je Aktion; kein Polling. Die Rechte prüft der Server.

const BASIS = "/api/v1/admin/termin-vorschlaege";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// [Adresse, Status der API, Name im Filter, Zähler (ein, mehrere), Text bei leerer Liste]
const STATI = [
  [
    "offen",
    "offen",
    "Offen",
    ["offener Vorschlag", "offene Vorschläge"],
    "Es gibt keine offenen Vorschläge. Sobald jemand einen Termin vorschlägt, erscheint er hier.",
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
  offen: ["Offen", undefined, "uhr"],
  freigegeben: ["Freigegeben", "ok"],
  abgelehnt: ["Abgelehnt", "fehler"],
  in_outlook_eingetragen: ["In Outlook eingetragen", "ok"],
};
function statusChip(status) {
  const [text, art, symbol] = STATUS[status] ?? [status, undefined, false];
  return el("ul", { class: "chips" }, chip(text, art, symbol));
}

const ZONE = "Europe/Zurich";
const format = (zone) =>
  new Intl.DateTimeFormat("de-CH", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: zone,
  });
const tagFormat = format(ZONE);
const tagUtc = format("UTC");
const uhrFormat = new Intl.DateTimeFormat("de-CH", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ZONE,
});

// Ganztägige Vorschläge haben nur Tage (tagVon bis tagBis, der letzte Tag zählt mit), alle anderen Beginn und Ende als Zeitpunkt
function zeitraum(v) {
  if (v.ganztaegig) {
    const von = tagUtc.format(new Date(`${v.tagVon}T12:00:00Z`));
    if (v.tagVon === v.tagBis) return `${von}, ganztägig`;
    return `${von} – ${tagUtc.format(new Date(`${v.tagBis}T12:00:00Z`))}, ganztägig`;
  }
  const beginn = new Date(v.beginn);
  const ende = new Date(v.ende);
  const tag = tagFormat.format(beginn);
  const bis =
    tagFormat.format(ende) === tag
      ? uhrFormat.format(ende)
      : `${tagFormat.format(ende)} ${uhrFormat.format(ende)}`;
  return `${tag}, ${uhrFormat.format(beginn)} – ${bis} Uhr`;
}

const GELOESCHT = "Gelöschtes Konto";

// Einmalige Hinweise für die nächste Zeichnung des Details (die Aktionen laden das Detail über denselben Weg nochmals)
let nachAktion = false;
let vermerk = "";
const KONFLIKT =
  "Jemand war schneller: Der Vorschlag hat inzwischen einen anderen Stand. Hier siehst du den aktuellen Stand.";
const KONFLIKT_MARKE = "konflikt";

export function zeige(bereich, ctx) {
  const [erst] = ctx.pfad;
  if (erst && UUID.test(erst)) {
    ctx.lade(
      () => anfrage("GET", `${BASIS}/${erst.toLowerCase()}`),
      (vorschlag, neu) => zeichneDetail(bereich, ctx, vorschlag, neu),
    );
    return;
  }
  const eintrag = erst ? STATI.find(([adresse]) => adresse === erst) : STATI[0];
  if (!eintrag) {
    bereich.append(
      el(
        "p",
        { class: "leer" },
        "Diese Ansicht gibt es nicht. Wähle «Offen», «Freigegeben», «Abgelehnt» oder «Eingetragen».",
      ),
      el(
        "p",
        {},
        el(
          "a",
          { class: "knopf", href: "#termine/vorschlaege" },
          "Zu den Vorschlägen",
        ),
      ),
    );
    return;
  }
  const status = eintrag[1];
  ctx.lade(
    () => ladeSeite(status),
    (erste) => zeichneListe(bereich, status, erste),
  );
}

function ladeSeite(status, nach) {
  const q = new URLSearchParams({ status });
  if (nach) q.set("nach", nach);
  return anfrage("GET", `${BASIS}?${q}`);
}

// Liste

// Der Status steht nicht in der Zeile: Der Filter nennt ihn für die ganze Liste
function zeile(v) {
  return el(
    "tr",
    {},
    el(
      "th",
      { scope: "row" },
      el(
        "a",
        {
          class: "name tm-vorschlaege-link",
          href: `#termine/vorschlaege/${v.id}`,
        },
        v.titel,
      ),
    ),
    el("td", {}, zeitraum(v)),
    el(
      "td",
      {},
      v.vorgeschlagenVonName ?? el("span", { class: "leise" }, GELOESCHT),
    ),
  );
}

function zeichneListe(bereich, start, erste) {
  let aktuell = start;
  let lauf = 0;
  let geladen = 0;
  let weitere = false;
  let naechste = null;
  let koerper = null;

  const zaehler = el("p", {
    class: "meta tm-vorschlaege-zaehler",
    role: "status",
  });
  const meldung = el("p", {
    class: "klein tm-vorschlaege-meldung",
    role: "status",
  });
  const liste = el("div", { class: "tm-vorschlaege-liste" });
  const mehr = knopf("Weitere laden", {
    symbol: "runter",
    onclick: () => ladeWeitere(),
  });
  mehr.hidden = true;
  const freigabeHinweis = el(
    "p",
    { class: "hilfe tm-vorschlaege-hinweis" },
    "Diese Vorschläge trägst du von Hand in Outlook ein und meldest sie danach als eingetragen.",
  );

  const filter = filterGruppe({
    beschriftung: "Status",
    eintraege: STATI.map(([, api, name]) => ({ text: name, wert: api })),
    wert: start,
    beiAenderung: (status) => wechsle(status),
  });

  function setze(seite, anhaengen) {
    const [, , , woerter, leerText] = STATI.find(([, api]) => api === aktuell);
    if (anhaengen) {
      koerper.append(...seite.vorschlaege.map(zeile));
      geladen += seite.vorschlaege.length;
    } else {
      geladen = seite.vorschlaege.length;
      if (geladen === 0) {
        koerper = null;
        liste.replaceChildren(el("p", { class: "leer" }, leerText));
      } else {
        const t = tabelle({
          beschriftung: `Terminvorschläge: ${woerter[1]}`,
          spalten: ["Vorschlag", "Wann", "Vorgeschlagen von"],
          zeilen: seite.vorschlaege.map(zeile),
        });
        koerper = t.koerper;
        liste.replaceChildren(t.wurzel);
      }
    }
    weitere = seite.weitere;
    naechste = seite.naechste;
    zaehler.textContent =
      geladen === 0
        ? ""
        : `${weitere ? "Mindestens " : ""}${geladen} ${woerter[geladen === 1 ? 0 : 1]}`;
    mehr.hidden = !weitere;
    freigabeHinweis.hidden = aktuell !== "freigegeben";
  }

  async function wechsle(status) {
    const mein = ++lauf;
    aktuell = status;
    meldung.textContent = "";
    // Die Adresse folgt dem Filter, ohne den Bereich neu zu bauen: Der Fokus bleibt auf dem Knopf
    window.history.replaceState(
      null,
      "",
      `#termine/vorschlaege/${adresseVon(status)}`,
    );
    liste.setAttribute("aria-busy", "true");
    zaehler.textContent = "Wird geladen …";
    try {
      const seite = await ladeSeite(status);
      if (mein !== lauf || !bereich.isConnected) return;
      setze(seite, false);
    } catch (f) {
      if (mein !== lauf || !bereich.isConnected) return;
      zaehler.textContent = "";
      mehr.hidden = true;
      liste.replaceChildren(
        el(
          "p",
          { class: "hinweis hinweis--fehler", role: "alert" },
          fehlertext(f),
        ),
        el(
          "p",
          {},
          knopf("Nochmals versuchen", {
            art: "haupt",
            symbol: "aktualisieren",
            onclick: () => wechsle(status),
          }),
        ),
      );
    } finally {
      if (mein === lauf) liste.removeAttribute("aria-busy");
    }
  }

  async function ladeWeitere() {
    const mein = lauf;
    mehr.disabled = true;
    mehr.setAttribute("aria-busy", "true");
    meldung.textContent = "Weitere Vorschläge werden geladen …";
    try {
      const seite = await ladeSeite(aktuell, naechste);
      // Zwischen Anfrage und Antwort kann man Reiter oder Status gewechselt haben
      if (mein !== lauf || !bereich.isConnected) return;
      setze(seite, true);
      meldung.textContent = `${seite.vorschlaege.length} weitere geladen.`;
      // Der Knopf verschwindet mit der letzten Seite: Der Fokus geht an die Tabelle statt ins Leere
      if (!weitere) liste.querySelector("[tabindex]")?.focus();
    } catch (f) {
      if (mein === lauf) {
        meldung.textContent = `${fehlertext(f)} Versuche es nochmals.`;
      }
    } finally {
      mehr.disabled = false;
      mehr.removeAttribute("aria-busy");
    }
  }

  bereich.append(
    el("h2", { class: "tm-vorschlaege-titel" }, "Vorschläge"),
    el(
      "p",
      { class: "leise tm-vorschlaege-hinweis" },
      "Leitende schlagen neue Termine vor. Du entscheidest. Cevi OS trägt nichts in Outlook ein: Freigegebene Vorschläge trägst du dort von Hand ein.",
    ),
    el("div", { class: "tm-vorschlaege-filter" }, filter.wurzel),
    freigabeHinweis,
    zaehler,
    liste,
    meldung,
    el("div", { class: "tm-vorschlaege-mehr" }, mehr),
  );
  setze(erste, false);
}

// Detail

function werteZeilen(zeilen) {
  return el(
    "dl",
    { class: "tm-vorschlaege-werte" },
    zeilen
      .filter(Boolean)
      .map(([name, wert]) =>
        el("div", {}, el("dt", {}, name), el("dd", {}, wert)),
      ),
  );
}

const text = (inhalt) => el("span", { class: "tm-vorschlaege-text" }, inhalt);

function fehlerText(f) {
  if (f.status === 403 && f.code === "EIGENER_VORSCHLAG") {
    return "Über deinen eigenen Vorschlag entscheidet eine andere Person.";
  }
  if (f.status === 404) {
    return "Diesen Vorschlag gibt es nicht mehr. Lade die Seite neu.";
  }
  return fehlertext(f);
}

// Der Dialog gibt den Fokus erst nach dem Neuzeichnen des Details zurück, und zwar an den Auslöser, den es dann nicht mehr gibt: Der Fokus geht darum nach seinem close-Ereignis an den Hinweis oder den Titel
const fokusiere = () =>
  (
    document.querySelector(".tm-vorschlaege-konflikt") ??
    document.querySelector(".tm-vorschlaege-titel")
  )?.focus();

// Ein Dialog mit Rückfrage; bei 409 (jemand war schneller) schliesst er sich, das Detail lädt neu und zeigt den aktuellen Stand mit einem Hinweis
function aktion({ v, ctx, neu, pfad, body, erfolg, ...dialog }) {
  const d = dialogFormular({
    ...dialog,
    fehlertext: fehlerText,
    senden: async () => {
      try {
        return await anfrage("POST", `${BASIS}/${v.id}/${pfad}`, body?.());
      } catch (f) {
        if (f.status !== 409) throw f;
        vermerk = KONFLIKT;
        d.addEventListener("close", fokusiere, { once: true });
        d.close();
        neu();
        return KONFLIKT_MARKE;
      }
    },
    danach: (ergebnis) => {
      if (ergebnis === KONFLIKT_MARKE) return;
      nachAktion = true;
      d.addEventListener("close", fokusiere, { once: true });
      ctx.melde(erfolg);
      neu();
    },
  });
}

function freigeben(v, ctx, neu) {
  aktion({
    v,
    ctx,
    neu,
    pfad: "entscheid",
    body: () => ({ entscheid: "freigeben" }),
    titel: "Vorschlag freigeben?",
    beschreibung: `«${v.titel}» wird freigegeben. Die vorschlagende Person sieht den Entscheid in der App. Danach trägst du den Termin in Outlook von Hand ein.`,
    ok: "Freigeben",
    erfolg: "Der Vorschlag ist freigegeben. Trage ihn jetzt in Outlook ein.",
  });
}

function ablehnen(v, ctx, neu) {
  const grund = feld({
    label: "Begründung",
    hilfe: "Die vorschlagende Person sieht sie. Höchstens 500 Zeichen.",
    mehrzeilig: true,
    rows: 4,
    maxlength: 500,
    required: true,
  });
  aktion({
    v,
    ctx,
    neu,
    pfad: "entscheid",
    body: () => ({
      entscheid: "ablehnen",
      begruendung: grund.eingabe.value.trim(),
    }),
    titel: "Vorschlag ablehnen?",
    beschreibung: `«${v.titel}» wird abgelehnt. Das lässt sich nicht rückgängig machen.`,
    felder: [grund.wurzel],
    ok: "Ablehnen",
    erfolg: "Der Vorschlag ist abgelehnt.",
  });
}

function eingetragen(v, ctx, neu) {
  aktion({
    v,
    ctx,
    neu,
    pfad: "eingetragen",
    titel: "Als in Outlook eingetragen markieren?",
    beschreibung: `Bestätige nur, wenn «${v.titel}» in Outlook eingetragen ist. Der Abgleich mit Outlook übernimmt ihn dann als Termin.`,
    ok: "Als eingetragen markieren",
    erfolg: "Der Vorschlag ist als in Outlook eingetragen markiert.",
  });
}

function kategorienZeile(kategorien) {
  if (kategorien.length === 0) {
    return el(
      "span",
      { class: "leise" },
      "Keine. Die Tags dieses Vorschlags gibt es nicht mehr.",
    );
  }
  return el(
    "ul",
    { class: "chips tm-vorschlaege-kategorien" },
    kategorien.map((k) => chip(k, undefined, false)),
  );
}

// Der Kasten mit den Aktionen des Stands; abgelehnte und eingetragene Vorschläge haben keine
function aktionen(v, ctx, neu) {
  if (v.status === "offen") {
    const eigener = v.vorgeschlagenVon === ctx.ich.id;
    return el(
      "section",
      { class: "panel panel--schmal" },
      el("h3", {}, "Entscheiden"),
      eigener
        ? el(
            "p",
            { class: "hinweis" },
            "Über deinen eigenen Vorschlag entscheidet eine andere Person.",
          )
        : [
            el(
              "p",
              { class: "leise" },
              "Mit «Freigeben» trägst du den Termin danach in Outlook von Hand ein. «Ablehnen» braucht eine Begründung, die die vorschlagende Person sieht.",
            ),
            el(
              "div",
              { class: "aktionen" },
              knopf("Freigeben", {
                art: "haupt",
                symbol: "haken",
                onclick: () => freigeben(v, ctx, neu),
              }),
              knopf("Ablehnen", {
                symbol: "sperre",
                onclick: () => ablehnen(v, ctx, neu),
              }),
            ),
          ],
    );
  }
  if (v.status !== "freigegeben") return null;
  const rueck = el("p", { class: "klein", role: "status" });
  return el(
    "section",
    { class: "panel panel--schmal" },
    el("h3", {}, "In Outlook von Hand eintragen"),
    el(
      "p",
      { class: "leise" },
      "Cevi OS schreibt nie nach Outlook. Lege den Termin dort an, mit den Kategorien oben. Melde danach hier, dass er eingetragen ist.",
    ),
    el(
      "div",
      { class: "aktionen" },
      v.kategorien.length > 0 &&
        knopf("Kategorien kopieren", {
          symbol: "kopieren",
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(v.kategorien.join("; "));
              rueck.textContent = "Kategorien kopiert.";
            } catch {
              rueck.textContent =
                "Kopieren ist nicht möglich. Markiere die Kategorien von Hand.";
            }
          },
        }),
      knopf("Als in Outlook eingetragen markieren", {
        art: "haupt",
        symbol: "haken",
        onclick: () => eingetragen(v, ctx, neu),
      }),
    ),
    rueck,
  );
}

function zeichneDetail(bereich, ctx, v, neu) {
  const titel = el(
    "h2",
    { class: "tm-vorschlaege-titel", tabindex: "-1" },
    v.titel,
  );
  const konflikt =
    vermerk &&
    el(
      "p",
      {
        class: "hinweis hinweis--warn tm-vorschlaege-konflikt",
        role: "alert",
        tabindex: "-1",
      },
      vermerk,
    );
  const fokusTitel = nachAktion;
  vermerk = "";
  nachAktion = false;

  bereich.append(
    el(
      "p",
      {},
      el(
        "a",
        {
          class: "knopf knopf--klein",
          href: `#termine/vorschlaege/${adresseVon(v.status)}`,
        },
        "Zur Liste der Vorschläge",
      ),
    ),
    el("div", { class: "tm-vorschlaege-kopf" }, titel, statusChip(v.status)),
    konflikt,
    werteZeilen([
      ["Wann", zeitraum(v)],
      v.ort && ["Ort", v.ort],
      v.beschreibung && ["Beschreibung", text(v.beschreibung)],
      v.bemerkung && ["Bemerkung", text(v.bemerkung)],
      [
        "Vorgeschlagen von",
        v.vorgeschlagenVonName ?? el("span", { class: "leise" }, GELOESCHT),
      ],
      ["Eingereicht am", zeit(v.erstelltAm)],
      ["Kategorien in Outlook", kategorienZeile(v.kategorien)],
      v.entschiedenAm && ["Entschieden am", zeit(v.entschiedenAm)],
      v.status === "abgelehnt" &&
        v.begruendung && ["Begründung", text(v.begruendung)],
    ]),
    aktionen(v, ctx, neu),
  );
  if (konflikt) konflikt.focus();
  else if (fokusTitel) titel.focus();
}

import { anfrage, fehlertext } from "./api.js";
import { chip, dialogFormular, el, feld, knopf } from "./dom.js";
import {
  ZONE,
  entferneFeldFehler,
  feldFehler,
  terminAnzeige,
  uhr,
  zaehlwort,
  ersetze,
  termineTabelle,
} from "./kalenderhilfen.js";
import { skeletonTabelle } from "./lader.js";
import { leerKarte } from "./zustaende.js";

// Unterseite «Anfragen» (A16, #447): Offene Raumanfragen, über die die angemeldete Person entscheidet (Räume ohne Team: die Abteilungsleitung; sonst das Team des Raums). Bestätigen oder ablehnen.
// Datenbanklast: eine Abfrage beim Öffnen und je «Weitere laden» (50 Anfragen), eine je Entscheid. Die Zahl für die Unterleiste kommt aus derselben Abfrage. Kein Polling.
// Wofür der Raum gedacht ist (#622): Eine Anfrage trägt heute nur den Zweck als Freitext (zum Beispiel «Sitzung OK»), keine Stufe, Gruppe oder Verknüpfung auf einen Anlass. Der Zweck steht darum an erster Stelle (erste Spalte, Titel des Details); der Raum ist die zweite Angabe. Eine strukturierte Stufe oder ein Anlass braucht eine Erweiterung von API und Apps (Entwurf, Entscheid offen).
// Lücke gegenüber dem Design: Bei einer Überschneidung nennt die API den Termin nicht, mit dem sie sich überschneidet; der Hinweis sagt nur, dass der Raum belegt ist.

const BASIS = "/api/v1/raeume/anfragen";
const SEITE = 50;

const TEXTE = {
  RAUM_BELEGT:
    "Der Raum ist in dieser Zeit schon gebucht. Bestätigen ist gesperrt. Du kannst die Anfrage ablehnen.",
  STATUS_UNGUELTIG:
    "Über diese Anfrage ist schon entschieden. Die Liste ist neu geladen.",
  EIGENE_ANFRAGE: "Über deine eigene Anfrage entscheidet eine andere Person.",
};
const meldungVon = (f) => TEXTE[f?.code] ?? fehlertext(f);

const langTag = new Intl.DateTimeFormat("de-CH", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: ZONE,
});
// «Samstag, 20. Februar, 14:00 bis 17:00»; über mehrere Tage mit beiden Tagen
function langZeit(a) {
  const beginn = new Date(a.beginn);
  const ende = new Date(a.ende);
  const von = langTag.format(beginn);
  const bis = langTag.format(ende);
  return von === bis
    ? `${von}, ${uhr(beginn)} bis ${uhr(ende)}`
    : `${von}, ${uhr(beginn)} bis ${bis}, ${uhr(ende)}`;
}

export function zeige(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", `${BASIS}/offen?limit=${SEITE}`),
    (erste, neu) => zeichne(bereich, ctx, erste, neu),
    {
      skeleton: () => skeletonTabelle({ spalten: 5, avatar: false }),
      fehlerTitel: "Die Raumanfragen konnten nicht geladen werden.",
    },
  );
}

function zeichne(bereich, ctx, erste, neu) {
  const anfragen = [...erste.anfragen];
  let weitere = erste.weitere;
  let naechste = erste.naechste;
  let gewaehlt = anfragen[0]?.id ?? null;
  // Anfragen, für die der Server «Raum belegt» gemeldet hat: Bestätigen bleibt gesperrt, bis die Seite neu lädt
  const belegt = new Set();

  const liste = el("div", {});
  const detail = el("section", { class: "flaeche" });
  const meldung = el("p", { class: "klein tm-meldung", role: "status" });
  const mehr = knopf("Weitere laden", {
    symbol: "runter",
    onclick: () => ladeWeitere(),
  });

  const aktuelle = () => anfragen.find((a) => a.id === gewaehlt);

  function meldeZaehler() {
    if (!weitere) ctx.zaehler("anfragen", anfragen.length);
  }

  function zeichneAlles() {
    mehr.hidden = !weitere;
    if (anfragen.length === 0) {
      ersetze(liste, leerKarte("Gerade wartet keine Raumanfrage."));
      detail.hidden = true;
      return;
    }
    if (!aktuelle()) gewaehlt = anfragen[0].id;
    detail.hidden = false;
    const t = termineTabelle({
      beschriftung: "Offene Raumanfragen",
      spalten: ["Wofür", "Raum", "Zeitraum", "Person", "Status"],
      zeilen: anfragen.map((a) =>
        el(
          "tr",
          { class: a.id === gewaehlt ? "gewaehlt" : undefined },
          el(
            "th",
            { scope: "row" },
            el(
              "button",
              {
                type: "button",
                class: "tm-wahl name",
                "aria-pressed": String(a.id === gewaehlt),
                "aria-label": `${a.zweck}, ${a.raumName}, ${terminAnzeige(a).tag}: Details zeigen`,
                onclick: () => {
                  gewaehlt = a.id;
                  zeichneAlles();
                  liste.querySelector('[aria-pressed="true"]')?.focus();
                },
              },
              a.zweck,
            ),
          ),
          el("td", {}, a.raumName),
          el(
            "td",
            { class: "tm-ziffern" },
            `${terminAnzeige(a).tag}, ${terminAnzeige(a).zeit}`,
          ),
          el("td", {}, a.vonName),
          el(
            "td",
            {},
            el("ul", { class: "chips" }, chip("Offen", "warn", "uhr")),
          ),
        ),
      ),
    });
    ersetze(liste, t.wurzel);
    zeichneDetail(aktuelle());
  }

  function zeichneDetail(a) {
    const fehlerZone = el("div", {});
    const rueck = belegt.has(a.id) ? TEXTE.RAUM_BELEGT : null;
    const bestaetigen = knopf("Bestätigen", {
      art: "haupt",
      symbol: "haken",
      "aria-describedby": rueck ? "tm-belegt" : undefined,
      "aria-disabled": rueck ? "true" : undefined,
      onclick: () => {
        if (!belegt.has(a.id)) bestaetige(a, bestaetigen, fehlerZone);
      },
    });
    ersetze(
      detail,
      el("p", { class: "klein leise" }, "Wofür der Raum gedacht ist"),
      el("h2", { class: "tm-wofuer" }, a.zweck),
      rueck &&
        el(
          "div",
          { class: "hinweis hinweis--warn", role: "status" },
          "Der Raum ist in dieser Zeit schon gebucht. Bestätigen ist gesperrt.",
        ),
      fehlerZone,
      el(
        "dl",
        { class: "werte" },
        ...[
          ["Raum", a.raumName],
          ["Zeitraum", langZeit(a)],
          ["Person", a.vonName],
        ].map(([n, w]) => el("div", {}, el("dt", {}, n), el("dd", {}, w))),
      ),
      el(
        "div",
        { class: "reihe" },
        bestaetigen,
        knopf("Ablehnen", { symbol: "schliessen", onclick: () => ablehnen(a) }),
      ),
      rueck && el("p", { class: "hilfe", id: "tm-belegt" }, rueck),
    );
  }

  // Aus der Liste nehmen, was entschieden ist; die Auswahl springt auf die nächste Anfrage
  function entschieden(a, text) {
    const i = anfragen.indexOf(a);
    anfragen.splice(i, 1);
    gewaehlt = (anfragen[i] ?? anfragen[i - 1])?.id ?? null;
    ctx.melde(text, "ok");
    meldeZaehler();
    zeichneAlles();
    // Der Auslöser ist weg: Der Fokus geht an den Titel der nächsten Anfrage, sonst an den der Seite
    const ziel =
      anfragen.length > 0
        ? detail.querySelector("h2")
        : document.querySelector("h1");
    ziel?.setAttribute("tabindex", "-1");
    ziel?.focus();
  }

  async function bestaetige(a, knopfNode, fehlerZone) {
    knopfNode.disabled = true;
    knopfNode.setAttribute("aria-busy", "true");
    ersetze(fehlerZone);
    try {
      await anfrage("POST", `${BASIS}/${a.id}/entscheid`, {
        entscheid: "annehmen",
      });
    } catch (f) {
      knopfNode.disabled = false;
      knopfNode.removeAttribute("aria-busy");
      if (f?.code === "RAUM_BELEGT") {
        belegt.add(a.id);
        zeichneDetail(a);
        detail.querySelector(".hinweis")?.setAttribute("tabindex", "-1");
        detail.querySelector(".hinweis")?.focus();
        return;
      }
      if (f?.code === "STATUS_UNGUELTIG") {
        ctx.melde(TEXTE.STATUS_UNGUELTIG, "warn");
        neu();
        return;
      }
      const hinweis = el(
        "div",
        { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
        `Nicht bestätigt. ${meldungVon(f)} Versuche es nochmals.`,
      );
      ersetze(fehlerZone, hinweis);
      hinweis.focus();
      return;
    }
    entschieden(
      a,
      `Die Anfrage von ${a.vonName} («${a.zweck}», ${a.raumName}) ist bestätigt. ${a.vonName} bekommt eine Mitteilung.`,
    );
  }

  function ablehnen(a) {
    const grund = feld({
      label: "Begründung",
      hilfe: `${a.vonName} sieht sie in der App. Höchstens 500 Zeichen.`,
      mehrzeilig: true,
      rows: 4,
      maxlength: 500,
    });
    dialogFormular({
      titel: "Anfrage ablehnen?",
      beschreibung: `«${a.zweck}», ${a.raumName}, ${langZeit(a)}. Die Anfrage wird abgelehnt. Das lässt sich nicht rückgängig machen.`,
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
      senden: async () => {
        try {
          return await anfrage("POST", `${BASIS}/${a.id}/entscheid`, {
            entscheid: "ablehnen",
            begruendung: grund.eingabe.value.trim(),
          });
        } catch (f) {
          // Hat schon jemand entschieden, lädt die Liste neu; der Dialog zeigt die Meldung
          if (f?.code === "STATUS_UNGUELTIG") neu();
          throw f;
        }
      },
      fehlertext: meldungVon,
      danach: () =>
        entschieden(
          a,
          `Die Anfrage von ${a.vonName} («${a.zweck}», ${a.raumName}) ist abgelehnt.`,
        ),
    });
  }

  async function ladeWeitere() {
    mehr.disabled = true;
    mehr.setAttribute("aria-busy", "true");
    meldung.textContent = "Weitere Anfragen werden geladen …";
    try {
      const seite = await anfrage(
        "GET",
        `${BASIS}/offen?limit=${SEITE}&nach=${encodeURIComponent(naechste)}`,
      );
      if (!bereich.isConnected) return;
      anfragen.push(...seite.anfragen);
      weitere = seite.weitere;
      naechste = seite.naechste;
      meldung.textContent = `${zaehlwort(seite.anfragen.length, "weitere Anfrage", "weitere Anfragen")} geladen.`;
      meldeZaehler();
      zeichneAlles();
    } catch (f) {
      meldung.textContent = `${fehlertext(f)} Versuche es nochmals.`;
    } finally {
      mehr.disabled = false;
      mehr.removeAttribute("aria-busy");
    }
  }

  bereich.append(
    el(
      "div",
      { class: "tm-anfragen" },
      el("div", {}, liste, meldung, el("div", { class: "tm-mehr" }, mehr)),
      detail,
    ),
  );
  meldeZaehler();
  zeichneAlles();
}

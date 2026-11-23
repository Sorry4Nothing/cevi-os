// Seite «Termin vorschlagen» (#530, Board W7): Formular, Prüfung im Browser, Senden an POST /termin-vorschlaege.
// Abfragen: einmal GET /termin-vorschlaege/optionen (Recht und Gruppen), dann nur beim Senden. Der Entwurf bleibt im Formular, bis der Server den Vorschlag angenommen hat.
import {
  api,
  baue,
  bandView,
  fehlerView,
  h,
  heute,
  icon,
  melde,
  nichtAngemeldetView,
  sk,
  tageImMonat,
  zuerichZuIso,
  zustandView,
} from "./tm.js";

export const MAX_TITEL = 120;
export const MAX_ORT = 120;
export const MAX_BESCHREIBUNG = 500;

const zwei = (n) => String(n).padStart(2, "0");

// «6.2.2027» oder «06.02.2027» → «2027-02-06»; null, wenn es den Tag nicht gibt
export function datumLesen(text) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [d, mo, y] = [+m[1], +m[2], +m[3]];
  if (
    y < 1900 ||
    y > 2999 ||
    mo < 1 ||
    mo > 12 ||
    d < 1 ||
    d > tageImMonat(y, mo)
  )
    return null;
  return `${y}-${zwei(mo)}-${zwei(d)}`;
}

// «9:00», «09:00» oder «9.00» → {h, min}; null bei Unsinn
export function zeitLesen(text) {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(text.trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return { h: +m[1], min: +m[2] };
}

// Prüft die Eingaben und baut den Körper für die API. Ergebnis: { fehler: [{feld, text}] } oder { body }.
// werte: { titel, datum, von, bis, ort, beschreibung, tagIds }; heuteTag: «JJJJ-MM-TT»
export function pruefeVorschlag(werte, heuteTag) {
  const fehler = [];
  const f = (feld, text) => fehler.push({ feld, text });
  const titel = werte.titel.trim();
  if (!titel) f("t-titel", "Gib einen Titel ein.");
  else if (titel.length > MAX_TITEL)
    f("t-titel", `Höchstens ${MAX_TITEL} Zeichen.`);

  const tag = datumLesen(werte.datum);
  if (!werte.datum.trim()) f("t-datum", "Gib das Datum ein.");
  else if (!tag) f("t-datum", "Gib das Datum so ein: TT.MM.JJJJ.");
  else if (tag < heuteTag)
    f("t-datum", "Das Datum liegt in der Vergangenheit.");

  const hatVon = werte.von.trim() !== "";
  const hatBis = werte.bis.trim() !== "";
  const von = hatVon ? zeitLesen(werte.von) : null;
  const bis = hatBis ? zeitLesen(werte.bis) : null;
  if (hatVon && !von) f("t-von", "Gib die Uhrzeit so ein: HH:MM.");
  if (hatBis && !bis) f("t-bis", "Gib die Uhrzeit so ein: HH:MM.");
  if (hatVon && !hatBis) f("t-bis", "Gib auch das Ende ein.");
  if (!hatVon && hatBis) f("t-von", "Gib auch den Beginn ein.");
  if (von && bis) {
    const a = von.h * 60 + von.min;
    const b = bis.h * 60 + bis.min;
    if (b < a) f("t-bis", "Das Ende liegt vor dem Beginn.");
    else if (b === a) f("t-bis", "Das Ende muss nach dem Beginn liegen.");
  }
  if (werte.ort.trim().length > MAX_ORT)
    f("t-ort", `Höchstens ${MAX_ORT} Zeichen.`);
  if (werte.tagIds.length === 0) f("t-gr-l", "Wähle mindestens eine Gruppe.");
  const zuViel = werte.beschreibung.trim().length - MAX_BESCHREIBUNG;
  if (zuViel > 0)
    f(
      "t-b",
      `Höchstens ${MAX_BESCHREIBUNG} Zeichen. Du hast ${zuViel} zu viel.`,
    );
  if (fehler.length) return { fehler };

  const [y, mo, d] = tag.split("-").map(Number);
  const body = {
    titel,
    ganztaegig: !hatVon,
    ...(hatVon
      ? {
          beginn: zuerichZuIso(y, mo, d, von.h, von.min),
          ende: zuerichZuIso(y, mo, d, bis.h, bis.min),
        }
      : { tagVon: tag, tagBis: tag }),
    ort: werte.ort.trim() || null,
    beschreibung: werte.beschreibung.trim() || null,
    tagIds: werte.tagIds,
  };
  return { body };
}

// Antwort des Servers auf das Senden → was die Seite zeigt
export function sendeFehler(r) {
  if (r.status === 0) return r.offline ? { art: "offline" } : { art: "server" };
  if (r.status === 401) return { art: "abgemeldet" };
  if (r.status === 403) return { art: "keinZugriff" };
  if (r.status === 400 && r.daten?.code === "TERMIN_VERGANGEN") {
    return {
      art: "feld",
      feld: "t-datum",
      text: "Das Datum liegt in der Vergangenheit.",
    };
  }
  if (r.status === 409 && typeof r.daten?.message === "string") {
    return { art: "band", titel: r.daten.message };
  }
  if (r.status === 429) {
    return {
      art: "band",
      titel: "Zu viele Vorschläge.",
      text: "Warte ein paar Minuten und versuche es nochmals.",
    };
  }
  return { art: "server" };
}

// --- Ansichten
const feld = (id, label, { fehler, hilfe, opt, control }) =>
  h(
    "div",
    { class: `feld${fehler ? " fehler" : ""}` },
    h(
      "label",
      { for: id },
      label,
      opt ? [" ", h("span", { class: "opt" }, "(optional)")] : null,
    ),
    hilfe ? h("p", { class: "hilfe", id: `${id}-h` }, hilfe) : null,
    control,
    fehler
      ? h("p", { class: "fehlertext", id: `${id}-f` }, icon("warnung"), fehler)
      : null,
  );

const beschr = (id, fehler, hilfe) =>
  [fehler ? `${id}-f` : null, hilfe ? `${id}-h` : null]
    .filter(Boolean)
    .join(" ") || null;

// s: { werte, fehler: {feldId: text}, optionen: null|[{id,name}], zusammenfassung: [{feld,text}], senden: bool, band }
export function formularView(s) {
  const { werte, fehler = {}, optionen, senden = false, band = null } = s;
  const ro = senden ? { readonly: true } : {};
  const eingabe = (id, extra = {}) => {
    const hilfeId = extra.hilfe ? `${id}-h` : null;
    return h("input", {
      class: "eingabe",
      id,
      type: "text",
      value: werte[extra.name] ?? "",
      "data-name": extra.name,
      "aria-describedby": beschr(id, fehler[id], extra.hilfe) ?? hilfeId,
      "aria-invalid": fehler[id] ? "true" : null,
      autocomplete: extra.auto ?? "off",
      inputmode: extra.modus ?? null,
      ...ro,
    });
  };
  const fehlerListe = s.zusammenfassung ?? [];
  const gruppenFehler = fehler["t-gr-l"];
  return h(
    "form",
    { class: "formular", novalidate: true, id: "tm-form" },
    band,
    fehlerListe.length
      ? bandView({
          art: "fe",
          rolle: "alert",
          titel:
            fehlerListe.length === 1
              ? "1 Angabe prüfen"
              : `${fehlerListe.length} Angaben prüfen`,
          text: h(
            "ul",
            {},
            fehlerListe.map((e) =>
              h(
                "li",
                {},
                h("a", { href: `#${e.feld}`, "data-ziel": e.feld }, e.text),
              ),
            ),
          ),
          attr: {
            class: "band fe zusammenfassung",
            tabindex: "-1",
            id: "tm-zusammenfassung",
          },
        })
      : null,
    feld("t-titel", "Titel", {
      fehler: fehler["t-titel"],
      control: eingabe("t-titel", { name: "titel" }),
    }),
    feld("t-datum", "Datum", {
      fehler: fehler["t-datum"],
      hilfe: "TT.MM.JJJJ",
      control: eingabe("t-datum", {
        name: "datum",
        hilfe: true,
        modus: "numeric",
      }),
    }),
    h(
      "div",
      { class: "feld" },
      h(
        "div",
        { class: "zweispaltig" },
        feld("t-von", "von", {
          fehler: fehler["t-von"],
          control: eingabe("t-von", { name: "von", modus: "numeric" }),
        }),
        feld("t-bis", "bis", {
          fehler: fehler["t-bis"],
          control: eingabe("t-bis", { name: "bis", modus: "numeric" }),
        }),
      ),
      h(
        "p",
        { class: "hilfe" },
        "Beide leer lassen für einen ganztägigen Termin.",
      ),
    ),
    feld("t-ort", "Ort", {
      fehler: fehler["t-ort"],
      opt: true,
      control: eingabe("t-ort", { name: "ort" }),
    }),
    optionen === null
      ? h(
          "div",
          { class: "feld", "aria-busy": "true" },
          h("span", { class: "legende" }, "Gruppen"),
          h(
            "div",
            { class: "skelett pillen", "aria-hidden": "true" },
            sk("r h48 bpx70"),
            sk("r h48 bpx70"),
            sk("r h48 bpx70"),
            sk("r h48 bpx160"),
          ),
          h("p", { class: "nur-leser", role: "status" }, "Lädt …"),
        )
      : h(
          "div",
          {
            class: `feld${gruppenFehler ? " fehler" : ""}`,
            role: "group",
            "aria-labelledby": "t-gr-l",
            "aria-describedby": gruppenFehler ? "t-gr-f" : null,
          },
          h("span", { class: "legende", id: "t-gr-l" }, "Gruppen"),
          h(
            "div",
            { class: "pillen" },
            optionen.map((g) => {
              const an = werte.tagIds.includes(g.id);
              return h(
                "button",
                {
                  type: "button",
                  class: "pille",
                  "aria-pressed": an ? "true" : "false",
                  "data-tag": g.id,
                  ...(senden && { "aria-disabled": "true" }),
                },
                an ? icon("haken") : null,
                g.name,
              );
            }),
          ),
          gruppenFehler
            ? h(
                "p",
                { class: "fehlertext", id: "t-gr-f" },
                icon("warnung"),
                gruppenFehler,
              )
            : null,
        ),
    feld("t-b", "Beschreibung", {
      opt: true,
      fehler: fehler["t-b"],
      hilfe: `Höchstens ${MAX_BESCHREIBUNG} Zeichen.`,
      control: h(
        "textarea",
        {
          class: "eingabe",
          id: "t-b",
          "data-name": "beschreibung",
          "aria-describedby": beschr("t-b", fehler["t-b"], true),
          "aria-invalid": fehler["t-b"] ? "true" : null,
          ...ro,
        },
        werte.beschreibung,
      ),
    }),
    h(
      "div",
      { class: "knopfreihe" },
      senden
        ? h(
            "button",
            {
              type: "button",
              class: "btn p gross",
              "aria-disabled": "true",
              "aria-busy": "true",
            },
            h("span", { class: "lade", "aria-hidden": "true" }),
            "Sende …",
          )
        : s.offline
          ? h(
              "div",
              { class: "feld" },
              h(
                "button",
                {
                  type: "button",
                  class: "btn gross",
                  "aria-disabled": "true",
                  "aria-describedby": "t-off",
                },
                "Vorschlag senden",
              ),
              h(
                "p",
                { class: "hilfe", id: "t-off" },
                "Senden geht wieder, sobald du online bist.",
              ),
            )
          : h(
              "button",
              {
                type: "submit",
                class: "btn p gross",
                ...(optionen === null && { "aria-disabled": "true" }),
              },
              "Vorschlag senden",
            ),
      h("a", { class: "btn t", href: "/termine/" }, "Abbrechen"),
    ),
  );
}

export const hinweisView = () =>
  bandView({
    text: "Die Abteilungsleitung prüft deinen Vorschlag. Erst nach der Freigabe erscheint er im Kalender.",
  });

export const erfolgView = () =>
  bandView({
    art: "ok",
    symbol: "haken",
    titel: "Gesendet.",
    text: "Du erfährst es, sobald die Leitung entschieden hat.",
    attr: { tabindex: "-1", id: "tm-erfolg" },
    aktion: h(
      "div",
      { class: "knopfreihe" },
      h(
        "button",
        { type: "button", class: "btn s", "data-aktion": "neu" },
        "Weiteren Termin vorschlagen",
      ),
      h("a", { class: "verweis", href: "/termine/" }, "Zu den Terminen"),
    ),
  });

export const keinZugriffView = () =>
  zustandView({
    symbol: "schloss",
    titel: "Dieser Bereich ist für andere Gruppen.",
    aktion: h("a", { class: "btn s gross", href: "/" }, "Zurück zum Start"),
  });

// --- Verbindung mit dem Dokument
const leereWerte = () => ({
  titel: "",
  datum: "",
  von: "",
  bis: "",
  ort: "",
  beschreibung: "",
  tagIds: [],
});

function start(doc, wurzel) {
  const z = {
    werte: leereWerte(),
    fehler: {},
    optionen: null,
    zusammenfassung: [],
    senden: false,
    offline: false,
    band: null,
  };
  const kopf = doc.createElement("div");
  const inhalt = doc.createElement("div");
  wurzel.replaceChildren(kopf, inhalt);
  kopf.className = "vorschlag-hinweis";
  let modus = "laedt";

  const lies = () => {
    for (const e of wurzel.querySelectorAll("[data-name]"))
      z.werte[e.dataset.name] = e.value;
    z.werte.tagIds = [
      ...wurzel.querySelectorAll('[data-tag][aria-pressed="true"]'),
    ].map((b) => b.dataset.tag);
  };

  function zeichne(fokus) {
    kopf.replaceChildren(baue(doc, hinweisView()));
    kopf.hidden = modus !== "form";
    let ansicht;
    if (modus === "form") ansicht = formularView(z);
    else if (modus === "abgemeldet")
      ansicht = nichtAngemeldetView("/termine/vorschlagen");
    else if (modus === "keinZugriff") ansicht = keinZugriffView();
    else if (modus === "fehler") ansicht = fehlerView("nochmal");
    else if (modus === "erfolg") ansicht = erfolgView();
    else ansicht = formularView(z);
    inhalt.replaceChildren(baue(doc, ansicht));
    if (fokus) doc.getElementById(fokus)?.focus();
  }

  async function ladeOptionen() {
    modus = "form";
    z.optionen = null;
    zeichne();
    const r = await api("/termin-vorschlaege/optionen");
    if (r.status === 401) modus = "abgemeldet";
    else if (r.status === 200 && !r.daten.darfVorschlagen)
      modus = "keinZugriff";
    else if (r.status === 200) z.optionen = r.daten.tags;
    else modus = "fehler";
    zeichne();
    melde(doc, modus === "form" ? "" : "Das hat nicht geklappt.");
  }

  async function sende() {
    lies();
    z.band = null;
    const p = pruefeVorschlag(z.werte, heute());
    z.fehler = Object.fromEntries(
      (p.fehler ?? []).map((e) => [e.feld, e.text]),
    );
    z.zusammenfassung = p.fehler ?? [];
    if (p.fehler) {
      zeichne("tm-zusammenfassung");
      return;
    }
    z.senden = true;
    zeichne();
    const r = await api("/termin-vorschlaege", {
      methode: "POST",
      body: p.body,
    });
    z.senden = false;
    if (r.status === 201) {
      z.werte = leereWerte();
      modus = "erfolg";
      zeichne("tm-erfolg");
      return;
    }
    const f = sendeFehler(r);
    z.offline = f.art === "offline";
    if (f.art === "abgemeldet") modus = "abgemeldet";
    else if (f.art === "keinZugriff") modus = "keinZugriff";
    else if (f.art === "feld") {
      z.fehler = { [f.feld]: f.text };
      z.zusammenfassung = [{ feld: f.feld, text: f.text }];
    } else if (f.art === "band") {
      z.band = bandView({
        art: "fe",
        symbol: "warnung",
        titel: f.titel,
        text: f.text,
        rolle: "alert",
      });
    } else if (f.art === "offline") {
      z.band = bandView({
        art: "wa",
        titel: "Keine Verbindung.",
        text: "Prüfe dein Internet und versuche es nochmals. Dein Entwurf bleibt erhalten.",
      });
    } else {
      z.band = bandView({
        art: "fe",
        rolle: "alert",
        titel: "Der Server antwortet nicht.",
        text: "Deine Angaben sind noch da.",
        aktion: h(
          "button",
          { type: "button", class: "btn s", "data-aktion": "nochmal-senden" },
          icon("neu"),
          "Nochmals senden",
        ),
      });
    }
    zeichne(f.art === "feld" ? "tm-zusammenfassung" : null);
  }

  wurzel.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!z.senden && z.optionen !== null && !z.offline) sende();
  });
  wurzel.addEventListener("click", (e) => {
    const ziel = e.target.closest?.("[data-ziel]");
    if (ziel) {
      e.preventDefault();
      const id = ziel.dataset.ziel;
      (id === "t-gr-l"
        ? doc.querySelector("[data-tag]")
        : doc.getElementById(id)
      )?.focus();
      return;
    }
    const pille = e.target.closest?.("[data-tag]");
    if (pille) {
      if (z.senden) return;
      lies();
      const id = pille.dataset.tag;
      z.werte.tagIds = z.werte.tagIds.includes(id)
        ? z.werte.tagIds.filter((x) => x !== id)
        : [...z.werte.tagIds, id];
      z.zusammenfassung = z.zusammenfassung.filter((x) => x.feld !== "t-gr-l");
      delete z.fehler["t-gr-l"];
      zeichne();
      doc.querySelector(`[data-tag="${id}"]`)?.focus();
      return;
    }
    const b = e.target.closest?.("[data-aktion]");
    if (!b) return;
    if (b.dataset.aktion === "nochmal") ladeOptionen();
    else if (b.dataset.aktion === "nochmal-senden") sende();
    else if (b.dataset.aktion === "neu") {
      z.werte = leereWerte();
      z.fehler = {};
      z.zusammenfassung = [];
      modus = "form";
      zeichne("t-titel");
    }
  });
  doc.defaultView.addEventListener("online", () => {
    if (z.offline) {
      z.offline = false;
      lies();
      z.band = null;
      zeichne();
    }
  });
  ladeOptionen();
}

const wurzel =
  typeof document === "undefined" ? null : document.getElementById("tm-app");
if (wurzel?.dataset.seite === "vorschlag") start(document, wurzel);

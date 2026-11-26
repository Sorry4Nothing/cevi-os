// Seite «Anlass-Anmeldung» (#530, Board W8): Anmeldung zu einem Anlass, ändern und abmelden.
// Abfragen: einmal GET /anlaesse/{id}, danach nur beim Senden (PUT) und Abmelden (DELETE) und anschliessend wieder GET.
import {
  api,
  baue,
  bandView,
  bestaetige,
  fehlerView,
  h,
  heute,
  icon,
  loginLink,
  ladeAnsage,
  melde,
  skelett,
  sk,
  zeitpunktText,
  zustandView,
} from "./tm.js";
import { anlassAdresse, anlassId, geschlossenText, vorname } from "./anlass.js";
import { toast } from "./toast.js";

export const MAX_TEXT = 500;
const feldId = (f) => `a-${f.schluessel}`;

// --- Angaben aus der Cevi-Datenbank (#691)
// Hat ein Textfeld des Anlasses eine Quelle, fragt die Seite den Server einmal beim Öffnen nach einem Vorschlag und füllt nur leere Felder. Der eigene Wert gewinnt immer; die Person kann jeden Wert ändern. Gespeichert wird erst mit dem Absenden. Ohne JavaScript bleibt das Formular normal nutzbar, die Felder sind dann einfach leer.
// c: { laedt: Schlüssel der Person oder null, fehler: Cevi-Datenbank antwortet nicht, herkunft: { feld: Wert aus der Cevi-Datenbank } }
export const KEIN_CEVI = { laedt: null, fehler: false, herkunft: {} };
export const hatCevi = (a) => a.felder.some((f) => f.ceviQuelle);

// Die Zeile über den Feldern: Ladezustand, Fehler oder was übernommen wurde. Eine Region mit aria-live: Der Ausgang wird einmal angesagt
export function ceviStatusInhalt(c) {
  if (c.laedt) return ["Angaben aus der Cevi-Datenbank werden geholt …"];
  if (c.fehler)
    return [
      icon("info"),
      "Die Cevi-Datenbank antwortet gerade nicht. Bitte füll die Angaben selbst aus.",
    ];
  const n = Object.keys(c.herkunft).length;
  if (n === 0) return [];
  return [
    icon("haken"),
    `${n === 1 ? "1 Angabe" : `${n} Angaben`} aus der Cevi-Datenbank übernommen. Bitte prüfen.`,
  ];
}

// Die Herkunft unter einem Feld: Symbol und Text, nie nur Farbe; beim Laden ein Platzhalter gleicher Höhe (kein Sprung)
export function ceviNotizInhalt(f, c, text) {
  if (!f.ceviQuelle) return [];
  if (c.laedt) return [skelett(sk("t b40"))];
  const her = c.herkunft[f.schluessel];
  if (her === undefined) return [];
  return text === her
    ? [icon("haken"), "Aus der Cevi-Datenbank übernommen"]
    : [icon("info"), "Aus der Cevi-Datenbank, von dir geändert"];
}

// Antworten aus den Eingaben prüfen und für die API aufbereiten. werte: Schlüssel → Text (Text, Auswahl) oder true/false (ja_nein)
// Ergebnis: { fehler: [{id, feld, inline, summe}] } oder { antworten }
export function pruefeAntworten(felder, werte) {
  const fehler = [];
  const antworten = {};
  for (const f of felder) {
    const w = werte[f.schluessel];
    const id = feldId(f);
    if (f.typ === "ja_nein") {
      if (typeof w === "boolean") antworten[f.schluessel] = w;
      else if (f.pflicht)
        fehler.push({
          id: `${id}-l`,
          feld: f.schluessel,
          inline: "Beantworte diese Frage.",
          summe: `Beantworte die Frage «${f.beschriftung}».`,
        });
    } else if (f.typ === "auswahl") {
      if (typeof w === "string" && f.optionen.includes(w))
        antworten[f.schluessel] = w;
      else if (f.pflicht)
        fehler.push({
          id: `${id}-l`,
          feld: f.schluessel,
          inline: "Wähle eine Option.",
          summe: `Wähle eine Option bei «${f.beschriftung}».`,
        });
    } else {
      const text = (typeof w === "string" ? w : "").trim();
      if (text.length > MAX_TEXT) {
        fehler.push({
          id,
          feld: f.schluessel,
          inline: `Höchstens ${MAX_TEXT} Zeichen. Du hast ${text.length - MAX_TEXT} zu viel.`,
          summe: `Kürze «${f.beschriftung}».`,
        });
      } else if (text) antworten[f.schluessel] = text;
      else if (f.pflicht)
        fehler.push({
          id,
          feld: f.schluessel,
          inline: "Fülle dieses Feld aus.",
          summe: `Fülle «${f.beschriftung}» aus.`,
        });
    }
  }
  return fehler.length ? { fehler } : { antworten };
}

// Antwort des Servers auf PUT/DELETE → was die Seite zeigt
export function sendeFehler(r) {
  if (r.status === 0) return { art: r.offline ? "offline" : "server" };
  if (r.status === 401) return { art: "abgemeldet" };
  if (r.status === 404 || r.status === 403) return { art: "nichtGefunden" };
  if (r.status === 409) return { art: "geschlossen" };
  if (r.status === 429)
    return {
      art: "band",
      titel: "Zu viele Versuche.",
      text: "Warte ein paar Minuten und versuche es nochmals.",
    };
  if (
    r.status === 400 &&
    r.daten?.code === "ANTWORTEN_UNGUELTIG" &&
    Array.isArray(r.daten.fehler)
  ) {
    const text = {
      ZU_LANG: `Höchstens ${MAX_TEXT} Zeichen.`,
      STEUERZEICHEN: "Dieser Text enthält ein Zeichen, das nicht erlaubt ist.",
      PFLICHT: "Diese Angabe fehlt.",
    };
    return {
      art: "felder",
      felder: r.daten.fehler.map((f) => ({
        schluessel: f.schluessel,
        text: text[f.code] ?? "Diese Angabe stimmt nicht.",
      })),
    };
  }
  return { art: "server" };
}

// --- Ansichten
// z: { a, wahl (Index der Person), werte: {schluessel: Wert}, fehler: {schluessel: Text}, zusammenfassung, senden, offline, band, bearbeiten }
// Bei mehreren Personen (die Person selbst und ihre Kinder, #844): für wen die Anmeldung gilt
export function wahlView(z) {
  if (z.a.teilnehmende.length < 2) return null;
  return h(
    "div",
    { class: "feld", role: "group", "aria-labelledby": "tm-wer-l" },
    h("span", { class: "legende", id: "tm-wer-l" }, "Für wen meldest du an?"),
    h(
      "div",
      { class: "pillen" },
      z.a.teilnehmende.map((p, i) =>
        h(
          "button",
          {
            type: "button",
            class: "pille",
            "aria-pressed": i === z.wahl ? "true" : "false",
            "data-wer": i,
            ...(z.senden && { "aria-disabled": "true" }),
          },
          i === z.wahl ? icon("haken") : null,
          p.kindId ? vorname(p) : "Dich selbst",
        ),
      ),
    ),
  );
}

export function kontoKarte(z) {
  const t = z.a.teilnehmende[z.wahl];
  return h(
    "section",
    { class: "karte", "aria-labelledby": "tm-k-t" },
    h("h2", { id: "tm-k-t" }, "Aus deinem Konto"),
    h(
      "dl",
      { class: "konto-daten" },
      t.konto.map((k) => [h("dt", {}, k.beschriftung), h("dd", {}, k.wert)]),
    ),
    h(
      "p",
      { class: "klein leise" },
      "Stimmt etwas nicht? Sag es der Abteilungsleitung.",
    ),
  );
}

export function kontoLadeKarte() {
  const zeile = (b) => [h("dt", {}, sk("t bpx70")), h("dd", {}, sk(`t ${b}`))];
  return h(
    "section",
    { class: "karte", "aria-labelledby": "tm-k-t", "aria-busy": "true" },
    h("h2", { id: "tm-k-t" }, "Aus deinem Konto"),
    skelett(
      h(
        "dl",
        { class: "konto-daten" },
        zeile("b60"),
        zeile("b50"),
        zeile("b30"),
        zeile("b70"),
      ),
    ),
  );
}

function feldView(f, z) {
  const id = feldId(f);
  const fehler = z.fehler[f.schluessel];
  const wert = z.werte[f.schluessel];
  const ro = z.senden ? { readonly: true } : {};
  const klasse = `feld${fehler ? " fehler" : ""}`;
  const fehlerText = fehler
    ? h("p", { class: "fehlertext", id: `${id}-f` }, icon("warnung"), fehler)
    : null;
  if (f.typ === "ja_nein" || f.typ === "auswahl") {
    const optionen =
      f.typ === "ja_nein"
        ? [
            { w: true, n: "Ja" },
            { w: false, n: "Nein" },
          ]
        : f.optionen.map((o) => ({ w: o, n: o }));
    const gewaehlt = optionen.findIndex((o) => o.w === wert);
    return h(
      "div",
      {
        class: klasse,
        role: "radiogroup",
        "aria-labelledby": `${id}-l`,
        "aria-describedby": fehler ? `${id}-f` : null,
        "aria-required": f.pflicht ? "true" : null,
      },
      h(
        "span",
        { class: "legende", id: `${id}-l` },
        f.beschriftung,
        f.pflicht ? null : [" ", h("span", { class: "opt" }, "(optional)")],
      ),
      h(
        "div",
        { class: "pillen" },
        optionen.map((o, i) =>
          h(
            "button",
            {
              type: "button",
              class: "pille",
              role: "radio",
              "aria-checked": i === gewaehlt ? "true" : "false",
              tabindex:
                i === gewaehlt || (gewaehlt < 0 && i === 0) ? "0" : "-1",
              "data-feld": f.schluessel,
              "data-i": i,
              ...(z.senden && { "aria-disabled": "true" }),
            },
            i === gewaehlt ? icon("haken") : null,
            o.n,
          ),
        ),
      ),
      fehlerText,
    );
  }
  const text = typeof wert === "string" ? wert : "";
  const cevi = z.cevi ?? KEIN_CEVI;
  return h(
    "div",
    { class: klasse },
    h(
      "label",
      { for: id },
      f.beschriftung,
      f.pflicht ? null : [" ", h("span", { class: "opt" }, "(optional)")],
    ),
    h(
      "p",
      { class: "hilfe", id: `${id}-h` },
      `${text.length} von ${MAX_TEXT} Zeichen`,
    ),
    h(
      "textarea",
      {
        class: "eingabe",
        id,
        "data-feld": f.schluessel,
        "aria-describedby": [
          fehler ? `${id}-f` : null,
          `${id}-h`,
          f.ceviQuelle ? `${id}-c` : null,
        ]
          .filter(Boolean)
          .join(" "),
        "aria-invalid": fehler ? "true" : null,
        "aria-required": f.pflicht ? "true" : null,
        ...ro,
      },
      text,
    ),
    f.ceviQuelle
      ? h(
          "div",
          { class: "cevi-note", id: `${id}-c` },
          ceviNotizInhalt(f, cevi, text),
        )
      : null,
    fehlerText,
  );
}

export function formularView(z) {
  const t = z.a.teilnehmende[z.wahl];
  const bestehend = t.anmeldung?.status === "angemeldet";
  const summe = z.zusammenfassung ?? [];
  return h(
    "form",
    { class: "formular", novalidate: true, id: "tm-form" },
    z.band,
    wahlView(z),
    summe.length
      ? bandView({
          art: "fe",
          rolle: "alert",
          titel:
            summe.length === 1
              ? "1 Angabe prüfen"
              : `${summe.length} Angaben prüfen`,
          text: h(
            "ul",
            {},
            summe.map((e) =>
              h(
                "li",
                {},
                h("a", { href: `#${e.id}`, "data-ziel": e.id }, e.summe),
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
    kontoKarte(z),
    z.a.felder.length
      ? h(
          "section",
          { class: "karte", "aria-labelledby": "tm-z-t" },
          h("h2", { id: "tm-z-t" }, "Zusätzliche Angaben"),
          hatCevi(z.a)
            ? h(
                "p",
                {
                  class: "hilfe cevi-status",
                  id: "tm-cevi-status",
                  "aria-live": "polite",
                },
                ceviStatusInhalt(z.cevi ?? KEIN_CEVI),
              )
            : null,
          z.a.felder.map((f) => feldView(f, z)),
          bandView({
            art: "wa",
            text: "Bitte keine Gesundheitsdaten eintragen.",
          }),
        )
      : null,
    h(
      "div",
      { class: "knopfreihe" },
      z.senden
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
        : z.offline
          ? h(
              "div",
              { class: "feld" },
              h(
                "button",
                {
                  type: "button",
                  class: "btn gross",
                  "aria-disabled": "true",
                  "aria-describedby": "a-off",
                },
                bestehend ? "Änderungen speichern" : "Anmelden",
              ),
              h(
                "p",
                { class: "hilfe", id: "a-off" },
                "Senden geht wieder, sobald du online bist.",
              ),
            )
          : h(
              "button",
              { type: "submit", class: "btn p gross" },
              bestehend ? "Änderungen speichern" : "Anmelden",
            ),
      h("a", { class: "btn t", href: anlassAdresse(z.a.id) }, "Abbrechen"),
      bestehend && !z.senden
        ? h(
            "button",
            { type: "button", class: "btn s", "data-aktion": "abmelden" },
            "Abmelden",
          )
        : null,
    ),
  );
}

// Was die Seite statt des Formulars zeigt, wenn nichts angemeldet werden kann; sonst null
export function sperreView(z, heuteTag) {
  const a = z.a;
  const t = a.teilnehmende[z.wahl];
  // Weder die Person noch ein verbundenes Kind gehört zur Zielgruppe des Anlasses (#844)
  if (a.teilnehmende.length === 0) {
    return zustandView({
      symbol: "info",
      titel: "Für diesen Anlass kannst du niemanden anmelden.",
      text: "Er richtet sich an eine andere Gruppe. Fehlt ein Kind in deinem Konto, wende dich an die Abteilungsleitung.",
    });
  }
  const bestehend = t.anmeldung?.status === "angemeldet";
  if (bestehend && !z.bearbeiten) {
    return bandView({
      art: "ok",
      symbol: "haken",
      titel: `${t.kindId ? vorname(t) + " ist" : "Du bist"} schon angemeldet.`,
      text: `Angemeldet am ${zeitpunktText(t.anmeldung.geaendertAm)}.`,
      attr: { tabindex: "-1", id: "tm-erfolg" },
      aktion: a.anmeldungOffen
        ? h(
            "button",
            { type: "button", class: "btn s", "data-aktion": "ansehen" },
            "Anmeldung ansehen",
          )
        : null,
    });
  }
  if (!a.anmeldungOffen) {
    return zustandView({
      symbol: "info",
      titel: geschlossenText(a, heuteTag),
      text: "Fragen beantwortet dir die Leitung.",
    });
  }
  return null;
}

// --- Verbindung mit dem Dokument
function start(doc, wurzel) {
  const id = anlassId(doc.location.search);
  const kopf = doc.getElementById("tm-kopf");
  const z = {
    a: null,
    wahl: 0,
    werte: {},
    fehler: {},
    zusammenfassung: [],
    senden: false,
    offline: false,
    band: null,
    bearbeiten: false,
    // Vorschläge der Cevi-Datenbank: stand je Person (Schlüssel des Kindes oder «selbst») für die Dauer der Seite
    cevi: { ...KEIN_CEVI, stand: new Map() },
  };
  const inhalt = doc.createElement("div");
  wurzel.replaceChildren(inhalt);
  const rueck = Object.assign(doc.createElement("p"), { className: "rueck" });
  kopf.prepend(rueck);
  let modus = "laedt";

  const werteVon = (t) =>
    t.anmeldung?.status === "angemeldet" ? { ...t.anmeldung.antworten } : {};

  const lies = () => {
    for (const e of wurzel.querySelectorAll("textarea[data-feld]"))
      z.werte[e.dataset.feld] = e.value;
  };

  function zeichne(fokus) {
    let d;
    if (modus === "laedt") {
      d = h("div", { class: "formular" }, kontoLadeKarte());
    } else if (modus === "abgemeldet") {
      d = zustandView({
        symbol: "schloss",
        titel: "Melde dich an, um dich anzumelden.",
        aktion: h(
          "a",
          {
            class: "btn p gross",
            href: loginLink(id ? `/anlass/anmeldung?id=${id}` : "/"),
          },
          "Anmelden",
        ),
      });
    } else if (modus === "nichtGefunden") {
      d = zustandView({
        symbol: "info",
        titel: "Diesen Anlass gibt es nicht.",
        aktion: h(
          "a",
          { class: "btn s gross", href: "/termine/" },
          "Zu den Terminen",
        ),
      });
    } else if (modus === "fehler") {
      d = fehlerView("nochmal");
    } else {
      const sperre = sperreView(z, heute());
      d = sperre
        ? h("div", { class: "formular" }, wahlView(z), sperre)
        : formularView(z);
    }
    inhalt.replaceChildren(baue(doc, d));
    rueck.replaceChildren(
      baue(
        doc,
        h(
          "a",
          { href: id ? anlassAdresse(id) : "/termine/" },
          icon("zurueck"),
          z.a ? `Zurück zu «${z.a.titel}»` : "Zurück zum Anlass",
        ),
      ),
    );
    if (fokus) doc.getElementById(fokus)?.focus();
  }

  async function lade(fokus) {
    modus = "laedt";
    zeichne();
    const stopp = ladeAnsage(doc, "Die Anmeldung wird geladen.");
    const r = await api(`/anlaesse/${id}`);
    stopp();
    if (r.status === 200) {
      z.a = r.daten;
      z.wahl = Math.min(z.wahl, z.a.teilnehmende.length - 1);
      z.wahl = Math.max(z.wahl, 0);
      z.werte = z.a.teilnehmende.length
        ? werteVon(z.a.teilnehmende[z.wahl])
        : {};
      z.fehler = {};
      z.zusammenfassung = [];
      z.cevi = { ...KEIN_CEVI, stand: new Map() };
      doc.getElementById("tm-titel").textContent = `Anmeldung ${z.a.titel}`;
      modus = "form";
      melde(doc, "Die Anmeldung ist geladen.");
    } else if (r.status === 401) modus = "abgemeldet";
    else if (r.status === 404 || r.status === 403) modus = "nichtGefunden";
    else modus = "fehler";
    zeichne(fokus);
    if (modus === "form") ladeCevi();
  }

  const ceviSchluessel = () => z.a.teilnehmende[z.wahl]?.kindId ?? "selbst";

  // Schreibt Werte, Notizen und die Zeile über den Feldern direkt ins Dokument, ohne neu zu zeichnen: Fokus und Eingaben bleiben
  function zeigeCevi() {
    for (const f of z.a.felder) {
      if (!f.ceviQuelle) continue;
      const feldEl = doc.getElementById(feldId(f));
      if (!feldEl) continue;
      const wert = z.werte[f.schluessel];
      if (typeof wert === "string" && feldEl.value !== wert) {
        feldEl.value = wert;
        const zaehler = doc.getElementById(`${feldEl.id}-h`);
        if (zaehler)
          zaehler.textContent = `${wert.length} von ${MAX_TEXT} Zeichen`;
      }
      doc
        .getElementById(`${feldEl.id}-c`)
        ?.replaceChildren(
          ...ceviNotizInhalt(f, z.cevi, feldEl.value).map((d) => baue(doc, d)),
        );
    }
    doc
      .getElementById("tm-cevi-status")
      ?.replaceChildren(...ceviStatusInhalt(z.cevi).map((d) => baue(doc, d)));
  }

  // Holt den Vorschlag einmal je Person und füllt nur leere Felder (der eigene Wert gewinnt)
  async function ladeCevi() {
    if (modus !== "form" || !z.a || !hatCevi(z.a)) return;
    if (sperreView(z, heute())) return;
    const t = z.a.teilnehmende[z.wahl];
    if (!t) return;
    const key = ceviSchluessel();
    z.cevi.herkunft = {};
    z.cevi.fehler = false;
    let r = z.cevi.stand.get(key);
    if (!r) {
      z.cevi.laedt = key;
      zeigeCevi();
      const antwort = await api(
        `/cevi-db/vorschlag?anlassId=${id}${t.kindId ? `&kindId=${t.kindId}` : ""}`,
      );
      // Ein Fehler der Verbindung oder des Servers heisst: antwortet nicht; alles andere (zum Beispiel zu viele Abrufe) bleibt still
      r =
        antwort.status === 200
          ? antwort.daten
          : {
              status:
                antwort.status === 0 || antwort.status >= 500
                  ? "nicht_erreichbar"
                  : "aus",
              felder: {},
            };
      z.cevi.stand.set(key, r);
      // Die Person hat inzwischen gewechselt oder die Seite neu geladen: Dieser Vorschlag gehört nicht mehr hierher
      if (ceviSchluessel() !== key || z.cevi.laedt !== key) return;
      z.cevi.laedt = null;
    }
    lies();
    z.cevi.fehler = r.status === "nicht_erreichbar";
    for (const f of z.a.felder) {
      const v = r.felder?.[f.schluessel]?.wert;
      const eigen = z.werte[f.schluessel];
      if (!f.ceviQuelle || typeof v !== "string") continue;
      if (typeof eigen === "string" && eigen.trim() !== "") continue;
      z.werte[f.schluessel] = v;
      z.cevi.herkunft[f.schluessel] = v;
    }
    zeigeCevi();
  }

  async function sende() {
    lies();
    const t = z.a.teilnehmende[z.wahl];
    const p = pruefeAntworten(z.a.felder, z.werte);
    z.band = null;
    z.fehler = Object.fromEntries(
      (p.fehler ?? []).map((e) => [e.feld, e.inline]),
    );
    z.zusammenfassung = p.fehler ?? [];
    if (p.fehler) return zeichne("tm-zusammenfassung");
    z.senden = true;
    zeichne();
    const bestehend = t.anmeldung?.status === "angemeldet";
    const r = await api(`/anlaesse/${id}/anmeldung`, {
      methode: "PUT",
      body: { ...(t.kindId && { kindId: t.kindId }), antworten: p.antworten },
    });
    z.senden = false;
    if (r.status === 200) {
      z.bearbeiten = false;
      // Der Stand kommt neu vom Server; die Seite zeigt ihn («schon angemeldet»), der Toast meldet das Speichern
      const neu = await api(`/anlaesse/${id}`);
      if (neu.status === 200) z.a = neu.daten;
      zeichne("tm-erfolg");
      toast(bestehend ? "Änderungen gespeichert." : "Anmeldung gespeichert.");
      return;
    }
    return fehlerBehandeln(sendeFehler(r), "nochmal-senden");
  }

  function fehlerBehandeln(f, aktion) {
    z.offline = f.art === "offline";
    if (f.art === "abgemeldet") modus = "abgemeldet";
    else if (f.art === "nichtGefunden") modus = "nichtGefunden";
    else if (f.art === "geschlossen") return lade();
    else if (f.art === "felder") {
      z.fehler = Object.fromEntries(
        f.felder.map((x) => [x.schluessel, x.text]),
      );
      z.zusammenfassung = f.felder.map((x) => {
        const feld = z.a.felder.find((q) => q.schluessel === x.schluessel);
        return {
          id: feld
            ? `a-${feld.schluessel}${feld.typ === "text" ? "" : "-l"}`
            : "tm-form",
          feld: x.schluessel,
          inline: x.text,
          summe: `${feld?.beschriftung ?? "Eine Angabe"}: ${x.text}`,
        };
      });
      return zeichne("tm-zusammenfassung");
    } else if (f.art === "band") {
      toast(`${f.titel} ${f.text}`, "fehler");
    } else if (f.art === "offline") {
      z.band = bandView({
        art: "wa",
        titel: "Keine Verbindung.",
        text: "Prüfe dein Internet und versuche es nochmals. Deine Angaben bleiben erhalten.",
      });
    } else {
      z.band = bandView({
        art: "fe",
        rolle: "alert",
        titel: "Der Server antwortet nicht.",
        text: "Deine Angaben sind noch da.",
        aktion: h(
          "button",
          { type: "button", class: "btn s", "data-aktion": aktion },
          icon("neu"),
          "Nochmals senden",
        ),
      });
    }
    zeichne();
  }

  async function meldeAb() {
    const t = z.a.teilnehmende[z.wahl];
    const ja = await bestaetige(doc, wurzel, {
      titel: "Abmelden?",
      text: `${t.kindId ? vorname(t) + " wird" : "Du wirst"} von «${z.a.titel}» abgemeldet. Die Angaben werden gelöscht.`,
      ja: "Abmelden",
    });
    if (!ja) return;
    z.senden = true;
    zeichne();
    const r = await api(
      `/anlaesse/${id}/anmeldung${t.kindId ? `?kindId=${t.kindId}` : ""}`,
      { methode: "DELETE" },
    );
    z.senden = false;
    if (r.status === 204) {
      z.bearbeiten = false;
      await lade();
      toast("Abgemeldet.");
      return;
    }
    return fehlerBehandeln(sendeFehler(r), "abmelden");
  }

  wurzel.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!z.senden && !z.offline) sende();
  });
  wurzel.addEventListener("input", (e) => {
    // Zähler der Zeichen laufend nachführen, ohne neu zu zeichnen (der Cursor bleibt)
    const zaehler = e.target.id && doc.getElementById(`${e.target.id}-h`);
    if (zaehler && e.target.dataset.feld)
      zaehler.textContent = `${e.target.value.length} von ${MAX_TEXT} Zeichen`;
    // Die Herkunft zeigt, ob der Wert noch der aus der Cevi-Datenbank ist
    const f = z.a?.felder.find((q) => q.schluessel === e.target.dataset?.feld);
    if (f?.ceviQuelle)
      doc
        .getElementById(`${e.target.id}-c`)
        ?.replaceChildren(
          ...ceviNotizInhalt(f, z.cevi, e.target.value).map((d) =>
            baue(doc, d),
          ),
        );
  });
  wurzel.addEventListener("click", (e) => {
    const ziel = e.target.closest?.("[data-ziel]");
    if (ziel) {
      e.preventDefault();
      const el = doc.getElementById(ziel.dataset.ziel);
      (el?.matches?.("span")
        ? el.parentElement.querySelector("button")
        : el
      )?.focus();
      return;
    }
    const wer = e.target.closest?.("[data-wer]");
    if (wer && !z.senden) {
      lies();
      z.wahl = Number(wer.dataset.wer);
      z.werte = werteVon(z.a.teilnehmende[z.wahl]);
      z.fehler = {};
      z.zusammenfassung = [];
      z.bearbeiten = false;
      z.cevi.laedt = null;
      zeichne();
      doc.querySelector(`[data-wer="${z.wahl}"]`)?.focus();
      ladeCevi();
      return;
    }
    const pille = e.target.closest?.("[data-feld][data-i]");
    if (pille && !z.senden) {
      lies();
      const f = z.a.felder.find((q) => q.schluessel === pille.dataset.feld);
      const i = Number(pille.dataset.i);
      z.werte[f.schluessel] = f.typ === "ja_nein" ? i === 0 : f.optionen[i];
      delete z.fehler[f.schluessel];
      z.zusammenfassung = z.zusammenfassung.filter(
        (x) => x.feld !== f.schluessel,
      );
      zeichne();
      doc
        .querySelector(`[data-feld="${f.schluessel}"][data-i="${i}"]`)
        ?.focus();
      return;
    }
    const b = e.target.closest?.("[data-aktion]");
    if (!b) return;
    const aktion = b.dataset.aktion;
    if (aktion === "nochmal") lade();
    else if (aktion === "nochmal-senden") sende();
    else if (aktion === "ansehen") {
      z.bearbeiten = true;
      zeichne("tm-k-t");
      ladeCevi();
    } else if (aktion === "abmelden") meldeAb();
  });
  // Auswahl mit Pfeiltasten (Radiogruppe): Pfeil wählt den Nachbarn
  wurzel.addEventListener("keydown", (e) => {
    const pille = e.target.closest?.("[data-feld][data-i]");
    const schritt = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
      e.key
    ];
    if (!pille || !schritt) return;
    e.preventDefault();
    const gruppe = [...pille.parentElement.children];
    gruppe[
      (gruppe.indexOf(pille) + schritt + gruppe.length) % gruppe.length
    ].click();
  });
  doc.defaultView.addEventListener("online", () => {
    if (z.offline && modus === "form") {
      z.offline = false;
      lies();
      z.band = null;
      zeichne();
    }
  });
  if (!id) {
    modus = "nichtGefunden";
    zeichne();
  } else lade();
}

const wurzel =
  typeof document === "undefined" ? null : document.getElementById("tm-app");
if (wurzel?.dataset.seite === "anmeldung") start(document, wurzel);

// Seite «Termin» (#671): Eckdaten eines Termins, Antwort (Ja oder Nein) für jedes eigene Kind und für mich als Leitung, Kontakt der Stufenleitung und für Leitende die Zahlen der Antworten.
// Dasselbe wie die App (Programm-Detail und «Anmeldungen»), über dieselben Routen: GET /termine/{id}, PUT /programme/{id}/teilnahmen/{kindId} und /leitung, GET /programme/{id}/kontakte und /teilnahmen.
// Abfragen: beim Öffnen GET /termine/{id}; danach nur, was die Seite zeigt (Kontakt für alle, Teilnahmen nur wenn die Person sie sehen darf: 403 heisst «nicht für dich», dann fehlt der Abschnitt). Kein Abruf im Takt.
// Die Adresse trägt die ID als «?id=». Es gibt keine Kinderdaten im HTML: alles kommt nach der Anmeldung aus der API.
import {
  api,
  baue,
  bandView,
  fehlerView,
  h,
  icon,
  loginLink,
  ladeAnsage,
  melde,
  skelett,
  sk,
  zustandView,
} from "./tm.js";
import { toast } from "./toast.js";
import { anlassAdresse, anlassDatum, anlassId } from "./anlass.js";

export const terminAdresse = (id) => `/termin/?id=${id}`;

const ANTWORT = { ja: "Ja", nein: "Nein" };

const fakt = (symbol, name, wert, lang = false) =>
  h(
    "div",
    { class: lang ? "fakt fakt--lang" : "fakt" },
    icon(symbol, false),
    h("dt", {}, name),
    h("dd", {}, wert),
  );

// «Treffpunkt», «Schluss», «Mitnehmen» stehen nur, wenn die Stufe sie für den Tag eingetragen hat
export function faktenView(t) {
  const schluss = [t.schlussOrt, t.schlussZeit].filter(Boolean).join(", ");
  return h(
    "dl",
    { class: "karte fakten" },
    fakt("kalender", "Datum", anlassDatum(t)),
    t.ort ? fakt("ort", "Ort", t.ort) : null,
    t.treffpunkt ? fakt("ort", "Treffpunkt", t.treffpunkt) : null,
    schluss ? fakt("uhr", "Schluss", schluss) : null,
    t.mitnehmen ? fakt("info", "Mitnehmen", t.mitnehmen, true) : null,
  );
}

export function statusBand(t) {
  if (t.status === "abgesagt") {
    return bandView({
      art: "fe",
      symbol: "warnung",
      titel: "Dieser Termin ist abgesagt.",
    });
  }
  if (t.status === "pruefen") {
    return bandView({
      art: "wa",
      symbol: "info",
      titel: "Noch unklar.",
      text: "Der Termin wird noch geprüft. Die Leitung meldet sich.",
    });
  }
  return null;
}

// Wer antworten kann: jedes eigene Kind und, wenn die Person Leitung ist, sie selbst. Die API gibt `eigeneAnmeldung` nur dann mit
export function personen(t) {
  return [
    ...t.kinder.map((k) => ({
      wer: `kind:${k.id}`,
      name: k.vorname,
      status: k.status ?? null,
    })),
    ...(t.eigeneAnmeldung
      ? [
          {
            wer: "ich",
            name: "Du",
            status: t.eigeneAnmeldung === "offen" ? null : t.eigeneAnmeldung,
          },
        ]
      : []),
  ];
}

const statusText = (s) => ANTWORT[s] ?? "Noch keine Antwort";

// Eine Zeile: Name und zwei Schalter. Geschlossen (abgesagt oder begonnen) zeigt die Zeile die Antwort nur noch als Text
function antwortZeile(p, offen, beschaeftigt) {
  const gruppe = `tm-ant-${p.wer.replace(":", "-")}`;
  return h(
    "li",
    { class: "antwort" },
    h("span", { class: "antwort-name", id: gruppe }, p.name),
    offen
      ? h(
          "div",
          {
            class: "seg",
            role: "group",
            "aria-labelledby": gruppe,
            "aria-busy": beschaeftigt === p.wer ? "true" : null,
          },
          ["ja", "nein"].map((s) =>
            h(
              "button",
              {
                type: "button",
                "aria-pressed": p.status === s ? "true" : "false",
                "aria-disabled": beschaeftigt ? "true" : null,
                "data-aktion": "antwort",
                "data-wer": p.wer,
                "data-status": s,
              },
              ANTWORT[s],
            ),
          ),
        )
      : h(
          "span",
          { class: `chip ${p.status === "ja" ? "ok" : ""}`.trim() },
          statusText(p.status),
        ),
    offen && p.status === null
      ? h("span", { class: "antwort-offen" }, "Noch keine Antwort")
      : null,
  );
}

export function teilnahmeView(t, { beschaeftigt = null, fehler = null } = {}) {
  const liste = personen(t);
  if (liste.length === 0) return null;
  const offen = t.teilnahmeOffen !== false && t.status !== "abgesagt";
  return h(
    "section",
    { class: "karte seite-spalte", "aria-labelledby": "tm-teil-t" },
    h("h2", { id: "tm-teil-t" }, "Teilnahme"),
    fehler,
    offen
      ? null
      : h(
          "p",
          { class: "hilfe" },
          "Antworten ist nicht mehr möglich: Der Termin ist abgesagt oder hat begonnen.",
        ),
    h(
      "ul",
      { class: "antworten" },
      liste.map((p) => antwortZeile(p, offen, beschaeftigt)),
    ),
  );
}

export function anlassKasten(t) {
  if (!t.anlass) return null;
  return h(
    "section",
    { class: "karte seite-spalte", "aria-labelledby": "tm-anl-t" },
    h("h2", { id: "tm-anl-t" }, "Anmeldung"),
    t.anlass.angemeldet
      ? bandView({
          art: "ok",
          symbol: "haken",
          titel: "Du bist angemeldet.",
          aktion: h(
            "a",
            { class: "verweis", href: anlassAdresse(t.anlass.id) },
            "Anmeldung ansehen",
          ),
        })
      : h(
          "a",
          { class: "btn p gross", href: anlassAdresse(t.anlass.id) },
          t.anlass.anmeldungOffen ? "Zur Anmeldung" : "Zum Anlass",
        ),
  );
}

// Nummer als Telefonlink: nur Ziffern, Leerzeichen und «+» (die API liefert sie im Format der Abteilung)
const telLink = (nr) => `tel:${String(nr).replace(/[^+\d]/g, "")}`;

export function kontaktView(kontakte) {
  if (!kontakte || kontakte.length === 0) return null;
  return h(
    "section",
    { class: "karte seite-spalte", "aria-labelledby": "tm-kon-t" },
    h("h2", { id: "tm-kon-t" }, "Kontakt"),
    h(
      "ul",
      { class: "antworten" },
      kontakte.map((k) =>
        h(
          "li",
          { class: "antwort" },
          h(
            "span",
            { class: "antwort-name" },
            k.ceviName ? `${k.name} (${k.ceviName})` : k.name,
          ),
          k.telefon
            ? h("a", { class: "verweis", href: telLink(k.telefon) }, k.telefon)
            : null,
        ),
      ),
    ),
  );
}

const zahlText = (z) => `${z.ja} Ja · ${z.nein} Nein · ${z.offen} offen`;

// Für Leitende: wer hat geantwortet. Name und Antwort stehen als Text, nie nur als Farbe
export function zusagenView(r) {
  if (!r) return null;
  const zeile = (name, status) =>
    h(
      "li",
      { class: "antwort" },
      h("span", { class: "antwort-name" }, name),
      h(
        "span",
        { class: `chip ${status === "ja" ? "ok" : ""}`.trim() },
        status === "offen" ? "Noch keine Antwort" : ANTWORT[status],
      ),
    );
  return h(
    "section",
    { class: "karte seite-spalte", "aria-labelledby": "tm-zus-t" },
    h("h2", { id: "tm-zus-t" }, "Antworten"),
    h("h3", { class: "teil-titel" }, `Kinder: ${zahlText(r.zahlen.kinder)}`),
    r.kinder.length === 0
      ? h("p", { class: "hilfe" }, "Keine Kinder in dieser Stufe.")
      : h(
          "ul",
          { class: "antworten" },
          r.kinder.map((k) =>
            zeile(`${k.vorname} ${k.nachname}`.trim(), k.status),
          ),
        ),
    h(
      "h3",
      { class: "teil-titel" },
      `Leitende: ${zahlText(r.zahlen.leitende)}`,
    ),
    r.leitende.length === 0
      ? h("p", { class: "hilfe" }, "Keine Leitenden in dieser Stufe.")
      : h(
          "ul",
          { class: "antworten" },
          r.leitende.map((l) =>
            zeile(l.ceviName ? `${l.name} (${l.ceviName})` : l.name, l.status),
          ),
        ),
  );
}

export function terminView(s) {
  const { t } = s;
  return h(
    "div",
    { class: "seite-spalte breit" },
    statusBand(t),
    faktenView(t),
    teilnahmeView(t, s),
    anlassKasten(t),
    kontaktView(s.kontakte),
    zusagenView(s.zusagen),
  );
}

export function ladeView() {
  return h(
    "div",
    { class: "seite-spalte", "aria-busy": "true" },
    skelett(sk("r h56 b100"), sk("r h56 b100")),
  );
}

export function zustandAnsicht(art, id) {
  if (art === "abgemeldet") {
    return zustandView({
      symbol: "schloss",
      titel: "Melde dich an, um den Termin zu sehen.",
      aktion: h(
        "a",
        {
          class: "btn p gross",
          href: loginLink(id ? `/termin?id=${id}` : "/termine"),
        },
        "Anmelden",
      ),
    });
  }
  if (art === "nichtGefunden") {
    return zustandView({
      symbol: "info",
      titel: "Diesen Termin gibt es nicht.",
      text: "Prüfe den Link oder gehe zu den Terminen.",
      aktion: h(
        "a",
        { class: "btn s gross", href: "/termine/" },
        "Zu den Terminen",
      ),
    });
  }
  return fehlerView("nochmal");
}

// Antwort der API auf das Speichern → Text für das Band; null heisst gespeichert
export function speicherFehler(r) {
  if (r.status === 204) return null;
  if (r.status === 0) {
    return r.offline
      ? "Du bist offline. Die Antwort ist nicht gespeichert."
      : "Der Server antwortet nicht. Die Antwort ist nicht gespeichert.";
  }
  if (r.status === 401)
    return "Du bist abgemeldet. Melde dich an und antworte nochmals.";
  if (r.status === 403) return "Für diese Person darfst du nicht antworten.";
  if (r.status === 409) {
    return (
      r.daten?.message ??
      "Der Termin ist abgesagt oder hat begonnen. Antworten ist nicht mehr möglich."
    );
  }
  if (r.status === 429)
    return "Zu viele Anfragen. Warte kurz und versuche es nochmals.";
  return "Das hat nicht geklappt. Versuche es nochmals.";
}

function start(doc, wurzel) {
  const id = anlassId(doc.location.search);
  const kopf = doc.getElementById("tm-kopf");
  const inhalt = doc.createElement("div");
  wurzel.replaceChildren(inhalt);
  const zeige = (d) => inhalt.replaceChildren(baue(doc, d));
  const zustand = {
    t: null,
    kontakte: null,
    zusagen: null,
    beschaeftigt: null,
    fehler: null,
  };

  const setzeKopf = (t) => {
    kopf.querySelector("h1").textContent = t.titel;
    const k = kopf.querySelector(".kicker");
    k.textContent = anlassDatum(t);
    k.hidden = false;
    doc.title = `${t.titel} | ${doc.title.split(" | ").slice(1).join(" | ")}`;
  };
  const zeichne = (fokus) => {
    zeige(terminView(zustand));
    if (fokus) {
      doc
        .querySelector(
          `[data-aktion="antwort"][data-wer="${fokus.wer}"][data-status="${fokus.status}"]`,
        )
        ?.focus();
    }
  };

  async function lade() {
    if (!id) return zeige(zustandAnsicht("nichtGefunden"));
    zeige(ladeView());
    const stopp = ladeAnsage(doc, "Der Termin wird geladen.");
    const r = await api(`/termine/${id}`);
    stopp();
    if (r.status === 401) return zeige(zustandAnsicht("abgemeldet", id));
    if (r.status === 404 || r.status === 403)
      return zeige(zustandAnsicht("nichtGefunden"));
    if (r.status !== 200) {
      zeige(zustandAnsicht("fehler"));
      melde(doc, "Das hat nicht geklappt.");
      return;
    }
    zustand.t = r.daten;
    setzeKopf(r.daten);
    zeichne();
    melde(doc, "Der Termin ist geladen.");
    // Kontakt und Antworten kommen danach: Der Termin steht schon da
    const [kon, zus] = await Promise.all([
      api(`/programme/${id}/kontakte`),
      api(`/programme/${id}/teilnahmen`),
    ]);
    zustand.kontakte = kon.status === 200 ? kon.daten.kontakte : null;
    // Die Liste gibt es auch für Eltern, dann aber nur mit den eigenen Kindern: Der Abschnitt gilt nur für Leitende (Leitende in der Antwort oder eigene Anmeldung)
    zustand.zusagen =
      zus.status === 200 &&
      (zus.daten.leitende.length > 0 || zustand.t.eigeneAnmeldung !== undefined)
        ? zus.daten
        : null;
    zeichne();
  }

  async function antworte(wer, status) {
    if (zustand.beschaeftigt) return;
    zustand.beschaeftigt = wer;
    zeichne({ wer, status });
    const pfad =
      wer === "ich"
        ? `/programme/${id}/leitung`
        : `/programme/${id}/teilnahmen/${wer.slice(5)}`;
    const r = await api(pfad, { methode: "PUT", body: { status } });
    zustand.beschaeftigt = null;
    const fehler = speicherFehler(r);
    if (fehler) {
      zeichne({ wer, status });
      toast(fehler, "fehler");
      return;
    }
    if (wer === "ich") zustand.t.eigeneAnmeldung = status;
    else
      zustand.t.kinder = zustand.t.kinder.map((k) =>
        `kind:${k.id}` === wer ? { ...k, status } : k,
      );
    zeichne({ wer, status });
    toast(`Antwort gespeichert: ${ANTWORT[status]}.`);
    // Zahlen der Leitenden nachziehen, wenn sie sichtbar sind
    if (zustand.zusagen) {
      const z = await api(`/programme/${id}/teilnahmen`);
      if (z.status === 200) {
        zustand.zusagen = z.daten;
        zeichne({ wer, status });
      }
    }
  }

  wurzel.addEventListener("click", (e) => {
    if (e.target.closest?.('[data-aktion="nochmal"]')) return lade();
    const b = e.target.closest?.('[data-aktion="antwort"]');
    if (b) antworte(b.dataset.wer, b.dataset.status);
  });
  lade();
}

const wurzel =
  typeof document === "undefined" ? null : document.getElementById("tm-app");
if (wurzel?.dataset.seite === "termin") start(document, wurzel);

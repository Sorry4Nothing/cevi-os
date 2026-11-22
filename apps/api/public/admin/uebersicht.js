// Übersicht (A1, A2): «Das braucht dich» (was auf eine Entscheidung wartet), «Bestand» und der Zustand der Datenbank. Nur die Abteilungsleitung bekommt Zahlen; alle anderen Rollen sehen den Hinweis, dass die Seite nur zeigt, was ihre Rolle betrifft. Der alte Zustand der API (Anfragen, letzte Fehler) steht unter «System».
//
// Datenbanklast (eine Abfrage je Route beim Öffnen der Seite, kein Polling): GET /api/v1/admin/termin-vorschlaege?status=offen&limit=100 · GET /api/v1/raeume/anfragen/offen?limit=100 · GET /api/v1/admin/termine/warnungen?limit=100 (im Server zwei Abfragen) · GET /api/v1/admin/system · GET /api/v1/admin/tags · GET /api/v1/lager · GET /api/v1/termine/alle?limit=5.
// Lücken der API: Keine Route liefert nur eine Zahl; die Zähler sind die Länge der ersten Seite (bis 100, «100+» bei mehr). Die «Sicherung» des Designs entfällt (Sicherungen sind gestrichen). Die Rolle «Team» kommt nicht in die Verwaltung (nur Konten mit Admin- oder Redaktionsrecht): Die Raumanfragen des eigenen Teams (A1, «Rolle eingeschränkt») siehst du dort also nicht.
import { anfrage } from "./api.js";
import { chip, el, knopf } from "./dom.js";
import { sk } from "./lader.js";
import { leerKarte } from "./zustaende.js";

const SEITE = 100;
const ZONE = "Europe/Zurich";

// Wohin die Knöpfe führen; die Ansichten bauen die Folge-Issues neu auf, die Adresse bleibt hier an einer Stelle
const ZIEL = {
  vorschlaege: "#termine/vorschlaege",
  anfragen: "#raeume/raeume",
  ohneKategorie: "#termine/warnliste",
};

const tagFormat = new Intl.DateTimeFormat("de-CH", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: ZONE,
});
const heuteIso = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date());
const plusTage = (iso, tage) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
};

// «Sa. 6. Feb.»: ganztägige Termine haben nur einen Kalendertag, die anderen einen Zeitpunkt
function terminTag(t) {
  const roh = t.ganztaegig ? `${t.tagVon}T12:00:00Z` : t.beginn;
  return tagFormat.format(new Date(roh));
}

function laden() {
  const heute = heuteIso();
  const bis = plusTage(heute, 365);
  const g = (pfad) => anfrage("GET", pfad);
  return Promise.allSettled([
    g(`/api/v1/admin/termin-vorschlaege?status=offen&limit=${SEITE}`),
    g(`/api/v1/raeume/anfragen/offen?limit=${SEITE}`),
    g(`/api/v1/admin/termine/warnungen?limit=${SEITE}`),
    g("/api/v1/admin/system"),
    g("/api/v1/admin/tags"),
    g("/api/v1/lager"),
    g(`/api/v1/termine/alle?von=${heute}&bis=${bis}&limit=5`),
  ]).then(([vor, anf, ohne, system, tags, lager, termine]) => {
    // Fehlen die offenen Punkte ganz, gibt es nichts Sinnvolles zu zeigen: Fehlerkarte wie in A1
    if ([vor, anf, ohne].every((r) => r.status === "rejected")) {
      throw vor.reason;
    }
    return { vor, anf, ohne, system, tags, lager, termine };
  });
}

// Zahl mit «+» bei weiteren Seiten
const anzeige = (n, weitere) => (weitere ? `${n}+` : String(n));

// Zeilen von «Das braucht dich»; Zähler: [Bereich, Unterseite] der Unterleiste
function offenePunkte(daten) {
  const zeilen = [];
  const punkt = (r, f) => {
    if (r.status !== "fulfilled") return;
    const n = f.liste(r.value).length;
    if (n > 0) zeilen.push({ ...f, n, weitere: r.value.weitere });
  };
  punkt(daten.vor, {
    liste: (w) => w.vorschlaege,
    text: (n) =>
      n === 1
        ? "Terminvorschlag wartet auf dich"
        : "Terminvorschläge warten auf dich",
    knopf: "Prüfen",
    ziel: ZIEL.vorschlaege,
  });
  punkt(daten.anf, {
    liste: (w) => w.anfragen,
    text: (n) => (n === 1 ? "Raumanfrage wartet" : "Raumanfragen warten"),
    knopf: "Ansehen",
    ziel: ZIEL.anfragen,
  });
  punkt(daten.ohne, {
    liste: (w) => w.termine,
    text: (n) =>
      n === 1
        ? "Termin hat keine Kategorie und ist für niemanden sichtbar"
        : "Termine haben keine Kategorie und sind für niemanden sichtbar",
    knopf: "Beheben",
    ziel: ZIEL.ohneKategorie,
  });
  return zeilen;
}

function braucht(zeilen) {
  const id = "ueb-braucht";
  return el(
    "section",
    { class: "flaeche", "aria-labelledby": id },
    el("h2", { id, class: "gross" }, "Das braucht dich"),
    el(
      "ul",
      { class: "liste-zeilen braucht" },
      zeilen.map((z) =>
        el(
          "li",
          {},
          el(
            "span",
            { class: "zahl-kreis" },
            anzeige(z.n, z.weitere),
            z.weitere && el("span", { class: "nur-leser" }, " oder mehr"),
          ),
          el("span", { class: "text" }, z.text(z.n)),
          el("a", { class: "knopf knopf--klein", href: z.ziel }, z.knopf),
        ),
      ),
    ),
  );
}

const wertZeile = (name, wert) =>
  el("div", {}, el("dt", {}, name), el("dd", {}, wert));

function bestand(daten) {
  const zeilen = [];
  const system = daten.system.status === "fulfilled" && daten.system.value;
  if (system) {
    zeilen.push(wertZeile("Personen", String(system.bestand.aktivePersonen)));
  }
  if (daten.tags.status === "fulfilled") {
    // Gruppen sind Stufen, Teams und Lager; Funktionen sind reine Tags
    const gruppen = daten.tags.value.tags.filter((t) => t.typ !== "funktion");
    zeilen.push(wertZeile("Gruppen", String(gruppen.length)));
  }
  if (daten.lager.status === "fulfilled") {
    const aktiv = daten.lager.value.lager.filter((l) => l.status === "aktiv");
    zeilen.push(wertZeile("Aktive Lager", String(aktiv.length)));
  }
  if (daten.termine.status === "fulfilled") {
    const naechster = daten.termine.value.termine.find(
      (t) => t.status === "aktiv",
    );
    zeilen.push(
      wertZeile(
        "Nächster Termin",
        naechster ? `${terminTag(naechster)}, ${naechster.titel}` : "Keiner",
      ),
    );
  }
  const bloecke = [];
  if (zeilen.length > 0) {
    bloecke.push(
      el(
        "section",
        { class: "flaeche" },
        el("h2", {}, "Bestand"),
        el("dl", { class: "werte" }, zeilen),
      ),
    );
  }
  if (
    [daten.system, daten.tags, daten.lager, daten.termine].some(
      (r) => r.status === "rejected",
    )
  ) {
    bloecke.push(
      el(
        "div",
        { class: "hinweis hinweis--warn", role: "status" },
        el("span", {}, "Nicht alle Zahlen konnten geladen werden."),
      ),
    );
  }
  if (system) {
    const ok = system.datenbank.erreichbar;
    bloecke.push(
      el(
        "section",
        { class: "flaeche" },
        el(
          "dl",
          { class: "werte" },
          wertZeile(
            "Datenbank",
            el(
              "ul",
              { class: "chips" },
              chip(
                ok ? "Erreichbar" : "Nicht erreichbar",
                ok ? "ok" : "fehler",
              ),
            ),
          ),
        ),
      ),
    );
  }
  return bloecke;
}

// Formgleich zu «Das braucht dich» und «Bestand» (A1, Laden)
function skeleton() {
  const zeilen = el(
    "section",
    { class: "flaeche", "aria-hidden": "true" },
    sk("t", 200),
    [260, 320, 380, 260].map((b) =>
      el(
        "div",
        { class: "sk-zeile sk-zeile--knopf" },
        sk("k", 36),
        sk("t", b),
        sk("r", 96),
      ),
    ),
  );
  const werte = el(
    "section",
    { class: "flaeche", "aria-hidden": "true" },
    sk("t", 136),
    [112, 160, 200, 112].map((b) =>
      el("div", { class: "sk-zeile sk-zeile--paar" }, sk("t", b), sk("t", 80)),
    ),
  );
  return el("div", { class: "spalte" }, zeilen, werte);
}

function zeichne(bereich, ctx, daten, neuLaden) {
  const zeilen = offenePunkte(daten);
  // Zähler der Unterleiste aus denselben Antworten, ohne eigene Abfrage; nur vollständige Zahlen
  for (const [r, bereichName, unter] of [
    [daten.vor, "termine", "vorschlaege"],
    [daten.anf, "raeume", "anfragen"],
    [daten.ohne, "termine", "warnliste"],
  ]) {
    if (r.status !== "fulfilled" || r.value.weitere) continue;
    const liste = r.value.vorschlaege ?? r.value.anfragen ?? r.value.termine;
    ctx.zaehler(unter, liste.length, bereichName);
  }
  const teile = [];
  const fehlt = [daten.vor, daten.anf, daten.ohne].some(
    (r) => r.status === "rejected",
  );
  if (fehlt) {
    teile.push(
      el(
        "div",
        { class: "hinweis hinweis--warn", role: "status" },
        el("span", {}, "Nicht alle offenen Punkte konnten geladen werden."),
        knopf("Nochmals versuchen", { klein: true, onclick: neuLaden }),
      ),
    );
  }
  if (zeilen.length > 0) teile.push(braucht(zeilen));
  else if (!fehlt) teile.push(leerKarte("Gerade ist nichts offen."));
  teile.push(...bestand(daten));
  bereich.append(...teile);
}

export function zeige(bereich, ctx) {
  // Rollen ohne Zahlen: nur der Hinweis und der Leer-Zustand, es werden keine Daten geladen
  if (ctx.ich.role !== "admin") {
    bereich.append(
      el(
        "div",
        { class: "hinweis", role: "status" },
        el("span", {}, "Du siehst nur, was deine Rolle betrifft."),
      ),
      leerKarte("Gerade ist nichts offen."),
    );
    return;
  }
  ctx.lade(laden, (daten, neuLaden) => zeichne(bereich, ctx, daten, neuLaden), {
    skeleton,
    fehlerTitel: "Die offenen Punkte konnten nicht geladen werden.",
    fehlerText: "Prüfe die Verbindung und versuche es nochmals.",
  });
}

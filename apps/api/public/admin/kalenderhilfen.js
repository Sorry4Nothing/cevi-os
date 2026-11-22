// Gemeinsame Bausteine der Bereiche «Termine», «Räume» und «Anlässe»: Zeitangaben nach dem Design («Sa 06.02.2027», «14:00–17:00»), Suchfeld, «Keine Treffer», sortierbare Spaltenköpfe, Meldungen beim Feld und ein Hinweis-Dialog.
import { chip, el, icon, knopf, neueId, tabelle } from "./dom.js";
import { leerKarte } from "./zustaende.js";

export const ZONE = "Europe/Zurich";

// Wie replaceChildren, aber ohne null, undefined und false: Das DOM schriebe sie als Text «null» in die Seite
export const ersetze = (knoten, ...kinder) =>
  knoten.replaceChildren(...kinder.flat().filter(Boolean));

const formate = new Map();
function fmt(art, zone) {
  const schluessel = `${art}/${zone}`;
  if (!formate.has(schluessel)) {
    const optionen = {
      tag: { day: "2-digit", month: "2-digit", year: "numeric" },
      wochentag: { weekday: "short" },
      uhr: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
      stempel: {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      },
    }[art];
    formate.set(
      schluessel,
      new Intl.DateTimeFormat("de-CH", { ...optionen, timeZone: zone }),
    );
  }
  return formate.get(schluessel);
}

// «Sa 06.02.2027»; zone «UTC» für Kalendertage ohne Uhrzeit (tagVon, tagBis)
export function kurzTag(datum, zone = ZONE) {
  const wochentag = fmt("wochentag", zone).format(datum).replace(/\.$/, "");
  return `${wochentag} ${fmt("tag", zone).format(datum)}`;
}

export const uhr = (datum) => fmt("uhr", ZONE).format(datum);
export const stempel = (iso) => `${fmt("stempel", ZONE).format(new Date(iso))}`;

const ganzerTag = (tag) => kurzTag(new Date(`${tag}T12:00:00Z`), "UTC");

// Zeitangabe eines Termins in zwei Zeilen: tag «Sa 06.02.2027» (bei mehreren Tagen von – bis) und zeit «14:00–17:00» oder «ganztägig»
// t: ganztaegig, tagVon, tagBis, beginn, ende (Termin, Vorschlag, Raumanfrage)
export function terminAnzeige(t) {
  if (t.ganztaegig) {
    const tag =
      t.tagVon === t.tagBis
        ? ganzerTag(t.tagVon)
        : `${ganzerTag(t.tagVon)} – ${ganzerTag(t.tagBis)}`;
    return { tag, zeit: "ganztägig" };
  }
  const beginn = new Date(t.beginn);
  const ende = new Date(t.ende);
  const von = kurzTag(beginn);
  const bis = kurzTag(ende);
  if (von === bis) return { tag: von, zeit: `${uhr(beginn)}–${uhr(ende)}` };
  return {
    tag: `${von} – ${bis}`,
    zeit: `${uhr(beginn)} – ${uhr(ende)}`,
  };
}

// Ein Satz: «Sa 06.02.2027, 14:00–17:00 Uhr»
export function zeitraumText(t) {
  const { tag, zeit } = terminAnzeige(t);
  return t.ganztaegig ? `${tag}, ${zeit}` : `${tag}, ${zeit} Uhr`;
}

// Zelle mit Datum und darunter der Uhrzeit
export function datumsZelle(t, element = "td") {
  const { tag, zeit } = terminAnzeige(t);
  return el(
    element,
    {},
    el("span", { class: "name tm-ziffern" }, tag),
    el("span", { class: "tm-zeit klein leise tm-ziffern" }, zeit),
  );
}

export const heuteZuerich = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE }).format(new Date());

export const plusTage = (tag, n) =>
  new Date(Date.parse(`${tag}T12:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);

export const zaehlwort = (n, ein, mehr) => `${n} ${n === 1 ? ein : mehr}`;

// «vor 3 Minuten», «vor 2 Stunden», sonst das Datum
export function vorText(iso) {
  const minuten = Math.max(
    0,
    Math.round((Date.now() - Date.parse(iso)) / 60000),
  );
  if (minuten < 1) return "gerade eben";
  if (minuten < 60) return `vor ${zaehlwort(minuten, "Minute", "Minuten")}`;
  const stunden = Math.round(minuten / 60);
  if (stunden < 24) return `vor ${zaehlwort(stunden, "Stunde", "Stunden")}`;
  return `am ${stempel(iso)}`;
}

// Gruppen eines Termins als Chips; ohne Gruppe der Hinweis, dass ihn niemand in «Mein Kalender» sieht
export function gruppenChips(tags, art = "stufe") {
  return el(
    "ul",
    { class: "chips" },
    tags.length === 0
      ? chip("Keine Gruppe", "warn")
      : tags.map((t) => chip(t.name, art, "tag")),
  );
}

// Tabelle wie tabelle() aus dom.js, mit der Klasse für lange Namen und breite Spalten (termine.css)
export function termineTabelle(optionen) {
  const t = tabelle(optionen);
  t.wurzel.classList.add("tm-tabelle");
  return t;
}

// Suchfeld mit Lupe; beiAenderung läuft bei jeder Eingabe
export function suchfeld({ label, wert = "", beiAenderung }) {
  const id = neueId("suche");
  const eingabe = el("input", {
    class: "eingabe",
    id,
    type: "search",
    placeholder: label,
    autocomplete: "off",
    spellcheck: "false",
    oninput: () => beiAenderung(eingabe.value),
  });
  eingabe.value = wert;
  return {
    wurzel: el(
      "div",
      { class: "suche" },
      el("label", { class: "nur-leser", for: id }, label),
      icon("lupe"),
      eingabe,
    ),
    eingabe,
  };
}

// «Keine Treffer für «Mat».» mit «Suche zurücksetzen»
export function keineTreffer(begriff, beiZuruecksetzen) {
  return leerKarte(`Keine Treffer für «${begriff}».`, [
    knopf("Suche zurücksetzen", { onclick: beiZuruecksetzen }),
  ]);
}

// Kleinschreibung ohne Umlautunterschiede reicht für die Suche in Namen
export const trifft = (text, begriff) =>
  String(text ?? "")
    .toLocaleLowerCase("de-CH")
    .includes(begriff.trim().toLocaleLowerCase("de-CH"));

// Spaltenkopf zum Sortieren: macht aus dem Kopf der Tabelle (th) einen Knopf mit Sortierwort und setzt aria-sort
// richtung: «ascending» oder «descending»; beiWechsel(neueRichtung) sortiert die Zeilen
export function sortKopf(th, { richtung = "ascending", beiWechsel }) {
  const text = th.textContent;
  const wort = el("span", { class: "tm-sortwort" });
  const knopfNode = el("button", { type: "button", class: "tm-sortknopf" });
  const zeichne = () => {
    th.setAttribute("aria-sort", richtung);
    ersetze(
      wort,
      icon(richtung === "ascending" ? "hoch" : "runter"),
      richtung === "ascending" ? "aufsteigend" : "absteigend",
    );
  };
  knopfNode.append(text, wort);
  knopfNode.addEventListener("click", () => {
    richtung = richtung === "ascending" ? "descending" : "ascending";
    zeichne();
    beiWechsel(richtung);
  });
  ersetze(th, knopfNode);
  zeichne();
  return { wert: () => richtung };
}

// Meldung beim Feld (Text mit Symbol, nicht nur Farbe); verschwindet beim nächsten Tippen oder Ändern
export function feldFehler(f, text) {
  const eingabe = f.eingabe;
  const p = el(
    "p",
    { class: "feld-fehler", id: neueId("fehler"), role: "alert" },
    text,
  );
  f.wurzel.append(p);
  eingabe.setAttribute("aria-invalid", "true");
  const vorher = eingabe.getAttribute("aria-describedby");
  eingabe.setAttribute(
    "aria-describedby",
    [vorher, p.id].filter(Boolean).join(" "),
  );
  const weg = () => {
    eingabe.removeAttribute("aria-invalid");
    if (vorher) eingabe.setAttribute("aria-describedby", vorher);
    else eingabe.removeAttribute("aria-describedby");
    p.remove();
  };
  eingabe.addEventListener("input", weg, { once: true });
  eingabe.addEventListener("change", weg, { once: true });
  return p;
}

export function entferneFeldFehler(wurzel) {
  for (const p of wurzel.querySelectorAll(".feld-fehler")) p.remove();
  for (const e of wurzel.querySelectorAll("[aria-invalid]")) {
    e.removeAttribute("aria-invalid");
  }
}

// «2 Angaben prüfen» mit einem Knopf je Feld, der das Feld fokussiert (kein Link: Ein «#» in der Adresse würde die Seite wechseln)
// fehler: [{ name, eingabe }]
export function pruefHinweis(fehler) {
  const hinweis = el(
    "div",
    { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
    el(
      "span",
      {},
      el(
        "strong",
        {},
        fehler.length === 1
          ? "1 Angabe prüfen"
          : `${fehler.length} Angaben prüfen`,
      ),
      el("br"),
      fehler.flatMap((f, i) => [
        i > 0 && " · ",
        el(
          "button",
          {
            type: "button",
            class: "tm-linkknopf",
            onclick: () => f.eingabe.focus(),
          },
          f.name,
        ),
      ]),
    ),
  );
  return hinweis;
}

// Kleiner Dialog mit einem Knopf (Design A10 «Vorschlag schon entschieden»): Titel, Hinweis, Text, Knopf; der Fokus kehrt danach zum Titel der Seite zurück
export function meldungsDialog({ titel, hinweis, text, ok, beiOk }) {
  const titelId = neueId("titel");
  const dialog = el(
    "dialog",
    { "aria-labelledby": titelId },
    el("h2", { id: titelId, tabindex: "-1" }, titel),
    hinweis &&
      el("p", { class: "hinweis hinweis--warn", role: "status" }, hinweis),
    text && el("p", { class: "beschreibung" }, text),
    el(
      "div",
      { class: "dialog-knoepfe" },
      knopf(ok, {
        art: "blau",
        onclick: () => {
          dialog.close();
          beiOk?.();
        },
      }),
    ),
  );
  dialog.addEventListener("close", () => {
    dialog.remove();
    document.querySelector("h1")?.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector(".knopf").focus();
  return dialog;
}

import { anfrage } from "./api.js";
import { avatar, el, knopf } from "./dom.js";
import { sk } from "./lader.js";
import { ersetzeMitBewegung } from "./lager-anim.js";
import { symbol } from "./lager-gemeinsam.js";
import {
  istGeschlossen,
  istVersionKonflikt,
  schreibFehlertext,
} from "./lager-konflikt.js";
import {
  FELDNAMEN,
  STATUSNAME,
  feldWert,
  heute,
  istErledigt,
  personName,
  ueberfaelligTage,
} from "./lager-aufgaben-logik.js";

// Gemeinsames der Module «Aufgaben», «Zeitplan» und «To-dos» (#670): Rechte der Rolle, Laden, Meldungen, Chips und die Karte für einen Versionskonflikt. Klassen mit dem Vorsatz «la-».

// Ersetzt den Inhalt und lässt false, null und undefined weg (replaceChildren schriebe sie als Text)
export const ersetzeKinder = (ziel, ...kinder) =>
  ersetzeMitBewegung(ziel, ...kinder);

export const API = (lagerId) => `/api/v1/lager/${lagerId}`;
export const ADRESSE_LAGER = "#lager/lager";
export const adresse = (lagerId, modul, id) =>
  `${ADRESSE_LAGER}/${lagerId}/${modul}${id ? `/${id}` : ""}`;

// Was die Rolle in diesem Lager darf, nach dem Lagerdetail (GET /api/v1/lager/{id}: rechte, schreibgeschuetzt). Die Oberfläche blendet nur aus; der Server prüft jede Anfrage.
export function rechteVon(lager) {
  const r = new Set(lager?.rechte ?? []);
  const hat = (...namen) => namen.some((n) => r.has(n));
  const zu =
    Boolean(lager?.schreibgeschuetzt) ||
    lager?.status === "abgeschlossen" ||
    lager?.status === "archiviert";
  return {
    zu,
    // «alle» liest, wer alle Aufgaben lesen oder bearbeiten darf; «eigene» sieht nur die eigenen
    lesenAlle: hat("aufgaben.lesen_alle", "aufgaben.bearbeiten"),
    lesen: hat("aufgaben.lesen_alle", "aufgaben.bearbeiten", "aufgaben.eigene"),
    bearbeiten: !zu && hat("aufgaben.bearbeiten"),
    status: !zu && hat("aufgaben.bearbeiten", "aufgaben.eigene"),
    verlauf: hat("verlauf.lesen"),
    ressorts: hat("ressorts.lesen", "ressorts.bearbeiten"),
    zeitplanLesen: hat("zeitplan.lesen"),
    zeitplanBearbeiten: !zu && hat("zeitplan.bearbeiten"),
    // Die Verschiebung ändert Fristen von Aufgaben: beide Rechte
    verschieben:
      !zu && hat("zeitplan.bearbeiten") && hat("aufgaben.bearbeiten"),
    vorlagen: !zu && hat("vorlagen.anwenden"),
  };
}

// Das Lager mit den Rechten der eigenen Rolle; hat der Rahmen sie schon geliefert, kommt keine Abfrage dazu
export async function ladeLagerMitRechten(lagerId, lager) {
  if (lager && Array.isArray(lager.rechte)) return lager;
  return anfrage("GET", API(lagerId));
}

const TEXTE = {
  VERSION_KONFLIKT: "Jemand hat das inzwischen geändert.",
  VORSCHAU_VERALTET:
    "Die Aufgaben am Meilenstein haben sich geändert. Prüfe die neue Vorschau.",
};
// Die Meldung für einen Fehler der Lager-Routen: Der Server nennt bei vielen Prüfungen einen deutschen Satz; sonst gilt der Text des Gerüsts
export function fehlerText(f) {
  if (f?.code && TEXTE[f.code]) return TEXTE[f.code];
  if (f?.status === 400 && f.meldung && f.code) return f.meldung;
  if (f?.status === 409 && f.meldung && f.code) return f.meldung;
  return schreibFehlertext(f);
}
export { istVersionKonflikt as istKonflikt, istGeschlossen };

// Alle Aufgaben, die die Rolle sieht, seitenweise (höchstens 200 je Anfrage, höchstens zehn Seiten: 2000 Aufgaben pro Lager sind weit über dem, was ein Lager braucht)
export async function ladeAufgaben(lagerId) {
  const alle = [];
  let nach;
  for (let seite = 0; seite < 10; seite++) {
    const r = await anfrage(
      "GET",
      `${API(lagerId)}/aufgaben?limit=200${nach ? `&nach=${nach}` : ""}`,
    );
    alle.push(...r.aufgaben);
    nach = r.naechster;
    if (!nach) break;
  }
  return alle;
}

// Die Personen zur Auswahl: die Mitglieder, soweit die Rolle sie lesen darf (einteilung.lesen), sonst alle, die in den Aufgaben vorkommen, und die eigene
export async function ladeMitglieder(lagerId, aufgaben, ich) {
  try {
    const r = await anfrage("GET", `${API(lagerId)}/mitglieder`);
    return {
      personen: r.mitglieder.map((m) => ({ id: m.personId, name: m.name })),
      vollstaendig: true,
    };
  } catch {
    const nachId = new Map();
    if (ich?.id) nachId.set(ich.id, { id: ich.id, name: ich.name ?? "Ich" });
    for (const a of aufgaben) {
      for (const p of [a.verantwortlich, ...a.unterstuetzung]) {
        if (p) nachId.set(p.id, { id: p.id, name: personName(p) });
      }
    }
    return {
      personen: [...nachId.values()].sort((a, b) =>
        a.name.localeCompare(b.name, "de-CH"),
      ),
      vollstaendig: false,
    };
  }
}

// Die Ressorts zur Auswahl: aus der Liste der Ressorts, soweit die Rolle sie lesen darf, sonst die, die in den Aufgaben vorkommen
export async function ladeRessorts(lagerId, aufgaben, darfLesen) {
  if (darfLesen) {
    try {
      const r = await anfrage("GET", `${API(lagerId)}/ressorts?limit=200`);
      return r.ressorts.map((x) => ({
        id: x.id,
        kuerzel: x.kuerzel,
        name: x.name,
      }));
    } catch {
      // fällt auf die Ressorts der Aufgaben zurück
    }
  }
  const nachId = new Map();
  for (const a of aufgaben) if (a.ressort) nachId.set(a.ressort.id, a.ressort);
  return [...nachId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "de-CH"),
  );
}

export const personenOptionen = (personen, leer = "Niemand") => [
  ["", leer],
  ...personen.map((p) => [p.id, p.name]),
];
export const ressortOptionen = (ressorts, leer = "Kein Ressort") => [
  ["", leer],
  ...ressorts.map((r) => [r.id, `${r.kuerzel} ${r.name}`]),
];

// Person mit Gesicht (Initialen), Name daneben; ohne Person steht der Hinweis
export function personZeile(p, { automatisch = false, leer = "Niemand" } = {}) {
  if (!p) return el("span", { class: "leise" }, leer);
  const name = personName(p);
  return el(
    "span",
    { class: "la-person" },
    el(
      "span",
      { class: "la-person-zeile" },
      avatar(name, { hell: true, bildUrl: p.bildUrl }),
      el("span", {}, name),
    ),
    automatisch &&
      el("span", { class: "leise klein" }, "als Leitung des Ressorts"),
  );
}

// Zustand nie nur über Farbe: Wort und Symbol
const STATUS_SYMBOL = {
  offen: "info",
  laeuft: "aktualisieren",
  wartet: "uhr",
  erledigt: "haken",
  naechster_hoeck: "weiter",
};
export function statusChip(status) {
  return el(
    "span",
    { class: status === "erledigt" ? "chip chip--ok" : "chip" },
    symbol(STATUS_SYMBOL[status] ?? "info"),
    STATUSNAME[status] ?? status,
  );
}
export function fristChip(a, jetzt = heute()) {
  const n = ueberfaelligTage(a, jetzt);
  if (n === null) return null;
  return el(
    "span",
    { class: "chip chip--fehler" },
    symbol("warnung"),
    `Überfällig seit ${n} ${n === 1 ? "Tag" : "Tagen"}`,
  );
}
export const sternMarke = () =>
  el(
    "span",
    { class: "la-stern", title: "Gemerkt" },
    symbol("stern"),
    el("span", { class: "nur-leser" }, "Gemerkt"),
  );

// Zustand der Aufgabe in einem Satz für Screenreader: «Offen, Frist 15.03.2027, überfällig»
export const aufgabeSatz = (a, jetzt) =>
  [
    STATUSNAME[a.status],
    a.frist && `Frist ${a.frist}`,
    !istErledigt(a) && ueberfaelligTage(a, jetzt) !== null && "überfällig",
  ]
    .filter(Boolean)
    .join(", ");

// Die Karte für einen Versionskonflikt (409 VERSION_KONFLIKT): Sie nennt, welche Felder jemand inzwischen geändert hat, zeigt «Du» und «Server» nebeneinander und lässt entscheiden. Sie ändert nichts selbst.
// fehler: der ApiFehler; meine: die Felder, die du senden wolltest ({ feld: wert }); ids: { ressorts, personen } zum Auflösen von IDs
// uebernehmen(aktuell): sendet meine Änderung auf dem Stand des Servers; verwerfen(aktuell): zeigt den Stand des Servers
export function konfliktKarte({ fehler, meine, ids, uebernehmen, verwerfen }) {
  const aktuell = fehler.daten?.aktuell ?? {};
  const felder = (
    fehler.daten?.abweichend?.length
      ? fehler.daten.abweichend
      : Object.keys(meine)
  ).filter((f) => f in meine);
  const zeilen = felder.map((f) =>
    el(
      "tr",
      {},
      el("th", { scope: "row" }, FELDNAMEN[f] ?? f),
      el("td", { "data-label": "Du" }, feldWert(f, meine[f], ids)),
      el("td", { "data-label": "Server" }, feldWert(f, aktuell[f], ids)),
    ),
  );
  const wurzel = el(
    "section",
    {
      class: "hinweis hinweis--warn la-konflikt",
      role: "alert",
      tabindex: "-1",
    },
    el("h2", { class: "klein fett" }, "Jemand hat das inzwischen geändert"),
    el(
      "p",
      {},
      "Dein Stand und der Stand auf dem Server sind verschieden. Wähle, was gilt. Es geht nichts verloren, bis du wählst.",
    ),
    zeilen.length > 0 &&
      el(
        "table",
        { class: "tabelle la-konflikttabelle" },
        el("caption", { class: "nur-leser" }, "Abweichende Felder"),
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", { scope: "col" }, "Feld"),
            el("th", { scope: "col" }, "Du"),
            el("th", { scope: "col" }, "Server"),
          ),
        ),
        el("tbody", {}, zeilen),
      ),
    el(
      "div",
      { class: "reihe" },
      knopf("Meine Änderung übernehmen", {
        art: "haupt",
        onclick: () => uebernehmen(aktuell),
      }),
      knopf("Stand des Servers übernehmen", {
        onclick: () => verwerfen(aktuell),
      }),
    ),
  );
  return wurzel;
}

// Hinweis über dem Inhalt, wenn das Lager schreibgeschützt ist
export const geschlossenHinweis = () =>
  el(
    "div",
    { class: "hinweis hinweis--info", role: "status" },
    el(
      "span",
      {},
      "Das Lager ist schreibgeschützt. Öffne es wieder, wenn du etwas ändern willst.",
    ),
  );

// ---- Skeletons (#685): gleiche Klassen und Masse wie der echte Inhalt, damit beim Wechsel nichts springt ----
const zeileMit = (...kinder) => el("div", { class: "sk-zeile" }, kinder);

// Aufgaben: Ansicht und Gruppierung, Filterleiste, Kennzahlen, Tabelle mit sieben Spalten
// Feld mit Beschriftung
const feldSk = (breite) =>
  el("div", { class: "la-sk-feld" }, sk("t", 64), sk("b", breite));

export function skeletonAufgaben({ zeilen = 6 } = {}) {
  const zelle = (inhalt) => el("td", {}, inhalt);
  return el(
    "div",
    { class: "la-sk", "aria-hidden": "true" },
    el("div", { class: "la-umschalter" }, sk("b", 360), feldSk(200)),
    el(
      "div",
      { class: "la-sk-filter" },
      sk("b", 380),
      feldSk(200),
      feldSk(200),
      feldSk(200),
    ),
    el("div", { class: "la-sk-filter2" }, feldSk(200), feldSk(200)),
    sk("t", 96),
    sk("t", 200),
    el(
      "div",
      { class: "box sk-tabelle" },
      el(
        "table",
        {},
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            Array.from({ length: 7 }, () =>
              el("th", { scope: "col" }, sk("t", 64)),
            ),
          ),
        ),
        el(
          "tbody",
          {},
          Array.from({ length: zeilen }, (_, i) =>
            el(
              "tr",
              {},
              zelle(sk("k", 24)),
              zelle(zeileMit(sk("k", 48), sk("t", [260, 200, 320][i % 3]))),
              zelle(sk("r", 80)),
              zelle(zeileMit(sk("k", 36), sk("t", 96))),
              zelle(sk("t", 36)),
              zelle(sk("t", 112)),
              zelle(sk("r", 96)),
            ),
          ),
        ),
      ),
    ),
  );
}

// Zeitplan: Ansicht, drei Tageskarten mit Einträgen, zwei Verwaltungskarten
export function skeletonZeitplan() {
  const tag = (eintraege) =>
    el(
      "li",
      { class: "la-tag" },
      el("div", { class: "la-tag-kopf" }, sk("t", 160), sk("r", 80)),
      el(
        "ul",
        { class: "la-eintraege" },
        Array.from({ length: eintraege }, (_, i) =>
          el(
            "li",
            { class: "la-eintrag" },
            sk("r", 96),
            sk("t", [200, 260, 160][i % 3]),
          ),
        ),
      ),
    );
  const karte = () =>
    el(
      "section",
      { class: "flaeche" },
      sk("t", 160),
      sk("t", 320),
      sk("r", 136),
    );
  return el(
    "div",
    { class: "la-zeitplan", "aria-hidden": "true" },
    el("div", { class: "la-umschalter" }, sk("b", 160)),
    el("ol", { class: "la-tage" }, tag(1), tag(1), tag(1), tag(1)),
    el("div", { class: "la-verwaltung" }, karte(), karte()),
  );
}

// To-dos: Hinweis, Zählzeile, Liste mit Kästchen, Feld zum Hinzufügen
export function skeletonTodos({ zeilen = 4 } = {}) {
  return el(
    "div",
    { class: "la-todos-sk", "aria-hidden": "true" },
    sk("t", 380),
    sk("t", 260),
    sk("t", 96),
    el(
      "ul",
      { class: "la-liste" },
      Array.from({ length: zeilen }, (_, i) =>
        el(
          "li",
          {},
          el(
            "div",
            { class: "la-punkt" },
            sk("k", 24),
            sk("t", [260, 200, 320, 160][i % 4]),
          ),
        ),
      ),
    ),
    sk("b", 380),
  );
}

// Detail einer Aufgabe: Angaben mit Feldern, Checkliste, Links
export function skeletonAufgabeDetail() {
  const feldDetail = () =>
    el("div", { class: "feld" }, sk("t", 80), sk("b", 380));
  const flaeche = (...kinder) =>
    el("section", { class: "flaeche" }, sk("t", 200), ...kinder);
  return el(
    "div",
    { "aria-hidden": "true" },
    el("div", { class: "la-kopf" }, sk("t", 136)),
    el(
      "div",
      { class: "la-detail" },
      flaeche(
        zeileMit(sk("r", 80), sk("r", 96)),
        feldDetail(),
        feldDetail(),
        feldDetail(),
      ),
      flaeche(
        ...[260, 200, 320].map((b) =>
          el("div", { class: "la-punkt" }, sk("k", 24), sk("t", b)),
        ),
      ),
      flaeche(sk("t", 260), sk("t", 200)),
    ),
  );
}

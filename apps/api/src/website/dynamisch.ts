import { pruefeLink } from "../link-pruefung.js";
import type { DynamischerBaustein } from "./bausteine-dynamisch.js";
import type { AnlassInfo, Kennzahl } from "./dynamisch-daten.js";
import {
  el,
  symbol,
  verlinke,
  type Daten,
  type HtmlKnoten,
} from "./rendern.js";

// Renderer der Bausteine aus bausteine-dynamisch.ts (#740). Wie der übrige Renderer: nur typisierte Knoten, jeder Text wird beim Ausgeben maskiert, Adressen laufen durch verlinke() oder pruefeLink().
// Die Daten stehen fertig in daten.dynamisch (dynamisch-daten.ts); fehlt der Eintrag, entfällt der Baustein. Stil: public/website/dynamisch.css, nur Tokens aus website.css.

export const STIL_DYNAMISCH = "/website/dynamisch.css";
// Karten in einem Raster über die ganze Breite (Titel links, Raster darunter); die übrigen stehen in der Spalte neben dem Titel
export const BREITE_DYNAMISCHE = new Set<string>([
  "anlaesse",
  "treffpunkte",
  "kennzahlen",
]);
const ANLASS_PFAD = "/anlass";

const fmt = (o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("de-CH", { ...o, timeZone: "UTC" });
const TAG_KURZ = fmt({ weekday: "short" });
const MONAT_KURZ = fmt({ month: "short" });
const MONAT_LANG = fmt({ month: "long" });
const DATUM = fmt({
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const DATUM_OHNE_TAG = fmt({ day: "numeric", month: "long", year: "numeric" });
const mittag = (tag: string) => new Date(`${tag}T12:00:00Z`);

// «Feb.», aber «Mai» (die Kurzform ist dort das ganze Wort)
function monatKurz(tag: string) {
  const kurz = MONAT_KURZ.format(mittag(tag));
  return kurz === MONAT_LANG.format(mittag(tag)) ? kurz : `${kurz}.`;
}

export function datumText(a: Pick<AnlassInfo, "von" | "bis">): string {
  return a.von === a.bis
    ? DATUM.format(mittag(a.von))
    : `${DATUM_OHNE_TAG.format(mittag(a.von))} bis ${DATUM_OHNE_TAG.format(mittag(a.bis))}`;
}
export function zeitText(a: AnlassInfo): string | null {
  if (!a.zeitVon || a.von !== a.bis) return null;
  return `${a.zeitVon}${a.zeitBis ? `–${a.zeitBis}` : ""} Uhr`;
}
const fristText = (a: AnlassInfo) =>
  a.fristTag
    ? `${DATUM_OHNE_TAG.format(mittag(a.fristTag))}${a.fristZeit && a.fristZeit !== "00:00" ? `, ${a.fristZeit} Uhr` : ""}`
    : null;

const ARTEN = { anlass: "Anlass", lager: "Lager" } as const;

function datumsfeld(a: AnlassInfo): HtmlKnoten {
  return el(
    "span",
    { class: "datum", "aria-hidden": "true" },
    el("span", { class: "tag" }, TAG_KURZ.format(mittag(a.von))),
    el("span", { class: "nr" }, String(Number(a.von.slice(8)))),
    el("span", { class: "mo" }, monatKurz(a.von)),
  );
}

const angabe = (bezeichnung: string, wert: HtmlKnoten | string): HtmlKnoten =>
  el(
    "div",
    undefined,
    el("dt", undefined, bezeichnung),
    el("dd", undefined, wert),
  );

// Die Angaben eines Anlasses: nur, was es gibt. kosten und hinweis sind Angaben der Seite (Lagerkarte)
function angaben(
  a: AnlassInfo,
  extra: { kosten?: string; ausfuehrlich: boolean },
): HtmlKnoten[] {
  const zeit = zeitText(a);
  const frist = fristText(a);
  return [
    angabe("Datum", el("time", { datetime: a.von }, datumText(a))),
    ...(zeit ? [angabe("Zeit", zeit)] : []),
    ...(a.ort ? [angabe("Ort", a.ort)] : []),
    ...(extra.ausfuehrlich && frist && a.anmeldungOffen
      ? [angabe("Anmeldeschluss", frist)]
      : []),
    ...(extra.kosten ? [angabe("Kosten", extra.kosten)] : []),
  ];
}

// Anmelden nur, solange die Anmeldung offen ist; sonst führt der Knopf auf die Seite des Anlasses (öffentliche Seite, sonst die Ansicht der Plattform)
function knopf(
  a: AnlassInfo,
  letzte: { schalter: number },
  hauptaktion: boolean,
): HtmlKnoten {
  const anmelden = a.anmeldungOffen;
  const klasse = `btn ${anmelden && hauptaktion && letzte.schalter++ === 0 ? "p" : "s"} gross`;
  return el(
    "a",
    {
      class: klasse,
      href: anmelden
        ? `${ANLASS_PFAD}?id=${a.id}`
        : (a.seitePfad ?? `${ANLASS_PFAD}?id=${a.id}`),
    },
    anmelden ? "Anmelden" : "Mehr erfahren",
    el("span", { class: "nur-sr" }, ` zu ${a.titel}`),
  );
}

function anlasskarte(
  a: AnlassInfo,
  ebene: number,
  letzte: { schalter: number },
  opt: { kosten?: string; hinweis?: string; ausfuehrlich?: boolean } = {},
): HtmlKnoten {
  const ausfuehrlich = opt.ausfuehrlich ?? false;
  return el(
    "article",
    { class: `anlasskarte karte anlasskarte--${a.art}` },
    datumsfeld(a),
    el(
      "div",
      { class: "anlasskarte-text" },
      el(
        "p",
        { class: "anlasskarte-art" },
        el("span", { class: "chip st" }, ARTEN[a.art]),
        ...(a.anmeldungOffen
          ? [el("span", { class: "chip ok" }, "Anmeldung offen")]
          : []),
      ),
      el(`h${ebene}`, { class: "titel" }, a.titel),
      el(
        "dl",
        { class: "anlasskarte-angaben" },
        ...angaben(a, { kosten: opt.kosten, ausfuehrlich }),
      ),
      ...(opt.hinweis
        ? [el("p", { class: "anlasskarte-hinweis" }, opt.hinweis)]
        : []),
      el("div", { class: "knopfreihe" }, knopf(a, letzte, ausfuehrlich)),
    ),
  );
}

function countdown(
  tage: number,
  zielTag: string,
  a: AnlassInfo,
  bis: "beginn" | "frist",
): HtmlKnoten {
  const ziel =
    bis === "frist"
      ? `bis zum Anmeldeschluss für ${a.titel}`
      : `bis ${a.titel}`;
  const satz: HtmlKnoten[] =
    tage === 0
      ? [
          el("strong", { class: "countdown-zahl" }, "Heute"),
          bis === "frist"
            ? ` ist Anmeldeschluss für ${a.titel}`
            : `: ${a.titel}`,
        ]
      : [
          "Noch ",
          el("strong", { class: "countdown-zahl" }, String(tage)),
          ` ${tage === 1 ? "Tag" : "Tage"} ${ziel}`,
        ];
  return el(
    "div",
    { class: "countdown karte" },
    el("p", { class: "countdown-satz" }, ...satz),
    el(
      "p",
      { class: "countdown-datum" },
      el("time", { datetime: zielTag }, DATUM.format(mittag(zielTag))),
    ),
  );
}

const groesseText = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const ZAHL_NAMEN: Record<Kennzahl["art"], [string, string]> = {
  stufen: ["Stufe", "Stufen"],
  leitende: ["Leitende Person", "Leitende"],
  anlaesse: ["kommender Anlass", "kommende Anlässe"],
};

// letzte.ebene: Ebene der letzten Überschrift der Seite; Titel in den Karten liegen eine darunter, höchstens Ebene 3
export function rendereDynamischenBaustein(
  b: DynamischerBaustein,
  daten: Daten,
  letzte: { ebene: number; schalter: number },
): HtmlKnoten | null {
  const ebene = Math.min(3, letzte.ebene + 1);
  // Die Dokumente haben keine Daten aus der Datenbank, alle anderen entfallen ohne
  const e = daten.dynamisch.get(b.id);
  if (!e && b.typ !== "dokumente") return null;
  switch (b.typ) {
    case "naechsterAnlass":
    case "lagerkarte": {
      if (e?.typ !== "anlaesse" || !e.anlaesse[0]) return null;
      return anlasskarte(e.anlaesse[0], ebene, letzte, {
        ausfuehrlich: b.typ === "lagerkarte",
        ...(b.typ === "lagerkarte" && {
          kosten: b.daten.kosten,
          hinweis: b.daten.hinweis,
        }),
      });
    }
    case "anlaesse": {
      if (e?.typ !== "anlaesse") return null;
      return e.anlaesse.length === 0
        ? el(
            "div",
            { class: "zustand" },
            el("p", undefined, "Im Moment sind keine Anlässe eingetragen."),
          )
        : el(
            "ul",
            { class: "anlassliste" },
            ...e.anlaesse.map((a) =>
              el("li", { class: "einblenden" }, anlasskarte(a, ebene, letzte)),
            ),
          );
    }
    case "countdown":
      return e?.typ === "countdown"
        ? countdown(e.tage, e.zielTag, e.anlass, b.daten.bis)
        : null;
    case "treffpunkte": {
      if (e?.typ !== "orte") return null;
      return el(
        "ul",
        { class: "treffpunkte" },
        ...e.orte.map((o) =>
          el(
            "li",
            { class: "karte einblenden" },
            el("span", { class: "treffpunkt-symbol" }, symbol("ort")),
            el(
              "div",
              undefined,
              el(`h${ebene}`, { class: "titel" }, o.name),
              ...(o.beschreibung ? [el("p", undefined, o.beschreibung)] : []),
              ...(o.karte
                ? [
                    el(
                      "p",
                      undefined,
                      ...verlinke(
                        o.karte,
                        [
                          "Auf Google Maps ansehen",
                          el("span", { class: "nur-sr" }, `: ${o.name}`),
                        ],
                        "verweis",
                      ),
                    ),
                  ]
                : []),
            ),
          ),
        ),
      );
    }
    case "dokumente": {
      const zeilen = b.daten.eintraege.flatMap((d) => {
        const l = pruefeLink(d.link);
        if (!l.ok) return [];
        const info = [
          d.typ,
          d.groesse === undefined ? undefined : groesseText(d.groesse),
        ].filter((t) => t !== undefined);
        return [
          el(
            "li",
            { class: "karte" },
            el(
              "a",
              { href: l.link, rel: "noopener noreferrer" },
              d.titel,
              el("span", { class: "nur-sr" }, " (externe Seite)"),
            ),
            ...(info.length > 0
              ? [" ", el("span", { class: "info" }, `(${info.join(", ")})`)]
              : []),
            ...(d.hinweis ? [el("p", { class: "hinweis" }, d.hinweis)] : []),
          ),
        ];
      });
      return zeilen.length === 0
        ? null
        : el("ul", { class: "dokumentliste" }, ...zeilen);
    }
    case "kennzahlen": {
      if (e?.typ !== "kennzahlen") return null;
      return el(
        "ul",
        { class: "zahlen" },
        ...e.zahlen.map((z) =>
          el(
            "li",
            undefined,
            el("strong", { class: "zahl" }, String(z.zahl)),
            el("span", undefined, ZAHL_NAMEN[z.art][z.zahl === 1 ? 0 : 1]),
          ),
        ),
      );
    }
  }
}

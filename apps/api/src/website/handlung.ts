import { linkArt, type Baustein } from "./bausteine.js";
import { HANDLUNG_TYPEN } from "./bausteine-handlung.js";
import { linkKnoten, telefonZiel } from "./kontakt.js";
import {
  el,
  medienUrl,
  symbol,
  verlinke,
  type Daten,
  type HtmlKnoten,
  type NavPunkt,
} from "./rendern.js";

// Renderer der Bausteine «Einstieg und Handlung» (#743). Wie der übrige Renderer: nur typisierte Knoten, jeder Text wird beim Ausgeben maskiert, Adressen laufen durch verlinke() oder linkArt().
// Stil: ein eigener Abschnitt in public/website/website.css («Einstieg und Handlung»). Schemas: bausteine-handlung.ts.

export type HandlungsBaustein = Extract<
  Baustein,
  { typ: (typeof HANDLUNG_TYPEN)[number] }
>;
export const istHandlungsBaustein = (b: Baustein): b is HandlungsBaustein =>
  (HANDLUNG_TYPEN as readonly string[]).includes(b.typ);

// Was die Seite über sich weiss, für Weitersagen, Brotkrumen und Seitenwechsel; fehlt es (nachgeladene geschützte Bausteine), entfallen diese drei
export type SeitenInfo = {
  titel: string;
  pfad: string;
  basisUrl: string;
  navigation: NavPunkt[];
};
// Der Stand beim Rendern einer Seite (Teil von Stand in rendern.ts): ebene = letzte Überschrift, schalter = Zahl der Schaltflächen bisher (nur die erste ist rot);
// verzeichnis = die Überschriften der Ebene 2 mit ihrem Anker, die der Renderer vorab sammelt (das Verzeichnis kann vor ihnen stehen)
export type HandlungsStand = {
  ebene: number;
  schalter: number;
  verzeichnis: { text: string; id: string }[];
  seite?: SeitenInfo;
};

const enc = encodeURIComponent;

function kopfbereich(
  b: Extract<HandlungsBaustein, { typ: "kopfbereich" }>,
  daten: Daten,
  stand: HandlungsStand,
): HtmlKnoten {
  const d = b.daten;
  const ebene = Math.min(2, stand.ebene + 1);
  stand.ebene = ebene;
  const knoepfe = (d.schaltflaechen ?? []).flatMap((s) =>
    verlinke(
      s.ziel,
      [s.beschriftung],
      `btn ${stand.schalter++ === 0 ? "p" : "s"} gross`,
    ),
  );
  const inhalt: HtmlKnoten[] = [
    el(`h${ebene}`, undefined, d.titel),
    ...(d.untertitel
      ? [el("p", { class: "kopf-untertitel" }, d.untertitel)]
      : []),
    ...(knoepfe.length > 0
      ? [el("div", { class: "knopfreihe" }, ...knoepfe)]
      : []),
  ];
  const m = d.bild ? daten.medien.get(d.bild) : undefined;
  // Ohne Bild, oder wenn das Medium kein Bild ist, steht das blaue Band
  if (!d.bild || !m?.mimeTyp.startsWith("image/")) {
    return el(
      "div",
      { class: "kopfbereich kopfbereich--band" },
      el("div", { class: "wrap" }, ...inhalt),
    );
  }
  return el(
    "div",
    { class: "kopfbereich kopfbereich--bild" },
    el(
      "figure",
      { class: "titelbild" },
      el("img", {
        src: medienUrl(d.bild),
        alt: m.altText ?? "",
        ...(m.breite &&
          m.hoehe && { width: String(m.breite), height: String(m.hoehe) }),
        loading: "lazy",
        decoding: "async",
      }),
    ),
    el(
      "div",
      { class: "kopf-kasten" },
      el("div", { class: "wrap" }, el("div", { class: "fahne" }, ...inhalt)),
    ),
  );
}

function verzeichnis(
  b: Extract<HandlungsBaustein, { typ: "inhaltsverzeichnis" }>,
  stand: HandlungsStand,
): HtmlKnoten | null {
  // Ohne Menübaum (Vorschau im Editor und im Katalog) zeigt der Baustein bei zu wenigen Überschriften ein Beispiel ohne Links
  const beispiel =
    stand.verzeichnis.length < 2 && stand.seite && ohneBaum(stand.seite);
  // Ein Verzeichnis mit einem Eintrag führt nirgends hin
  if (stand.verzeichnis.length < 2 && !beispiel) return null;
  const id = `verz-${b.id}`;
  return el(
    "nav",
    {
      class: `verzeichnis verzeichnis--${b.daten.darstellung}`,
      "aria-labelledby": id,
    },
    el(
      "p",
      { class: "verzeichnis-titel", id },
      b.daten.titel ?? "Auf dieser Seite",
    ),
    el(
      "ul",
      { role: "list" },
      // Der Anker besteht nur aus a-z, 0-9 und «-» (anker() in rendern.ts)
      ...(beispiel
        ? ["Erster Abschnitt", "Zweiter Abschnitt", "Dritter Abschnitt"].map(
            (t) => el("li", undefined, el("span", { class: "beispiel" }, t)),
          )
        : stand.verzeichnis.map((e) =>
            el("li", undefined, el("a", { href: `#${e.id}` }, e.text)),
          )),
    ),
  );
}

function weiterfuehrend(
  b: Extract<HandlungsBaustein, { typ: "weiterfuehrend" }>,
  daten: Daten,
): HtmlKnoten | null {
  // Ein Eintrag, der auf eine Seite führt, die Besucher nicht sehen, entfällt (wie bei den Karten)
  const eintraege = b.daten.eintraege.filter(
    (e) => !daten.verborgen?.has(e.ziel.split("#")[0]!),
  );
  const zeilen = eintraege.flatMap((e) => {
    const extern = linkArt(e.ziel) === "https";
    const a = linkKnoten(
      e.ziel,
      [
        el(
          "span",
          { class: "weiter-text" },
          el("span", { class: "weiter-titel" }, e.titel),
          ...(e.text
            ? [el("span", { class: "weiter-beschreibung" }, e.text)]
            : []),
        ),
        el(
          "span",
          { class: "weiter-pfeil", "aria-hidden": "true" },
          symbol("pfeil"),
        ),
      ],
      extern ? "weiter-link weiter-link--extern" : "weiter-link",
    );
    return a ? [el("li", undefined, a)] : [];
  });
  if (zeilen.length === 0) return null;
  return el(
    "ul",
    { class: `weiter weiter--${b.daten.darstellung}`, role: "list" },
    ...zeilen,
  );
}

function kontaktleiste(
  b: Extract<HandlungsBaustein, { typ: "kontaktleiste" }>,
  daten: Daten,
): HtmlKnoten | null {
  const k = daten.kontakt;
  if (!k) return null;
  const zeile = (
    art: string,
    symbolName: string,
    wert: string,
    ziel?: string,
  ): HtmlKnoten => {
    const innen = [
      el("span", { class: "leiste-symbol" }, symbol(symbolName)),
      el(
        "span",
        { class: "leiste-text" },
        el("span", { class: "leiste-art" }, art),
        " ",
        el("span", { class: "leiste-wert" }, wert),
      ),
    ];
    return el(
      "li",
      undefined,
      (ziel && linkKnoten(ziel, innen, "leiste-zeile")) ||
        el("span", { class: "leiste-zeile" }, ...innen),
    );
  };
  const zeilen = b.daten.felder.flatMap((f) => {
    if (f === "telefon" && k.telefon) {
      return [zeile("Telefon", "telefon", k.telefon, telefonZiel(k.telefon))];
    }
    if (f === "email" && k.email) {
      return [zeile("E-Mail", "mail", k.email, `mailto:${k.email}`)];
    }
    if (f === "adresse" && k.adresse) {
      return [zeile("Anschrift", "ort", k.adresse)];
    }
    return [];
  });
  if (zeilen.length === 0) return null;
  return el(
    "address",
    { class: "kontaktleiste" },
    ...(b.daten.titel
      ? [el("p", { class: "leiste-titel" }, b.daten.titel)]
      : []),
    el("ul", { role: "list" }, ...zeilen),
  );
}

function weitersagen(
  b: Extract<HandlungsBaustein, { typ: "weitersagen" }>,
  stand: HandlungsStand,
): HtmlKnoten | null {
  const s = stand.seite;
  if (!s) return null;
  // Ohne Adresse der Website (Vorschau im Editor) steht nur die Nachricht
  const text = [
    b.daten.nachricht ?? "Das könnte dich interessieren:",
    ...(s.basisUrl ? [s.basisUrl + s.pfad] : []),
  ].join("\r\n\r\n");
  return el(
    "p",
    { class: "weitersagen" },
    el(
      "a",
      {
        class: "btn s gross",
        href: `mailto:?subject=${enc(s.titel)}&body=${enc(text)}`,
      },
      symbol("mail"),
      b.daten.beschriftung ?? "Per E-Mail weitersagen",
    ),
  );
}

// Die Seite im Menübaum: die Kette ihrer Vorfahren samt ihr selbst und die Seiten auf ihrer Ebene
function finde(
  liste: NavPunkt[],
  pfad: string,
  kette: NavPunkt[] = [],
): { kette: NavPunkt[]; geschwister: NavPunkt[] } | null {
  for (const p of liste) {
    if (p.pfad === pfad) return { kette: [...kette, p], geschwister: liste };
    const r = finde(p.kinder, pfad, [...kette, p]);
    if (r) return r;
  }
  return null;
}

// Ohne Menübaum (Vorschau im Editor und im Katalog) zeigt der Baustein ein Beispiel ohne Links; auf der Website hat jede Seite einen Baum
const ohneBaum = (s: SeitenInfo) => s.navigation.length === 0;

function brotkrumen(stand: HandlungsStand): HtmlKnoten | null {
  const s = stand.seite;
  if (!s || s.pfad === "/") return null;
  const start = s.navigation.find((p) => p.pfad === "/")?.titel ?? "Start";
  const aktuell = (text: string) =>
    el("li", undefined, el("span", { "aria-current": "page" }, text));
  const mitLink = (p: NavPunkt) => {
    const a =
      linkArt(p.pfad) === "seite" ? linkKnoten(p.pfad, [p.titel]) : null;
    return el("li", undefined, a ?? p.titel);
  };
  let krumen: HtmlKnoten[];
  if (ohneBaum(s)) {
    krumen = [
      el("li", undefined, start),
      el("li", undefined, "Übergeordnete Seite"),
      aktuell(s.titel),
    ];
  } else {
    const f = finde(s.navigation, s.pfad);
    krumen = [
      mitLink({ pfad: "/", titel: start, kinder: [] }),
      ...(f ? f.kette.slice(0, -1).map(mitLink) : []),
      aktuell(f ? f.kette.at(-1)!.titel : s.titel),
    ];
  }
  return el(
    "nav",
    { class: "brotkrumen", "aria-label": "Du bist hier" },
    el("ol", { role: "list" }, ...krumen),
  );
}

function seitenwechsel(stand: HandlungsStand): HtmlKnoten | null {
  const s = stand.seite;
  if (!s) return null;
  const knopf = (
    richtung: "zurueck" | "weiter",
    wort: string,
    p: NavPunkt | undefined,
  ): HtmlKnoten | null => {
    if (!p) return null;
    const innen = [
      el(
        "span",
        { class: "seitenwechsel-pfeil", "aria-hidden": "true" },
        symbol("pfeil"),
      ),
      el(
        "span",
        { class: "seitenwechsel-text" },
        el("span", { class: "seitenwechsel-richtung" }, wort),
        el("span", { class: "seitenwechsel-titel" }, p.titel),
      ),
    ];
    const klasse = `seitenwechsel-link seitenwechsel-link--${richtung}`;
    return linkArt(p.pfad) === "seite" && !ohneBaum(s)
      ? el(
          "a",
          {
            class: klasse,
            href: p.pfad,
            rel: richtung === "zurueck" ? "prev" : "next",
          },
          ...innen,
        )
      : el("span", { class: klasse }, ...innen);
  };
  let vor: NavPunkt | undefined;
  let nach: NavPunkt | undefined;
  if (ohneBaum(s)) {
    vor = { pfad: "", titel: "Vorherige Seite im Menü", kinder: [] };
    nach = { pfad: "", titel: "Nächste Seite im Menü", kinder: [] };
  } else {
    const f = finde(s.navigation, s.pfad);
    // Die Startseite gehört nicht in die Abfolge
    const reihe = f?.geschwister.filter((p) => p.pfad !== "/") ?? [];
    const i = reihe.findIndex((p) => p.pfad === s.pfad);
    if (i < 0) return null;
    vor = reihe[i - 1];
    nach = reihe[i + 1];
  }
  const teile = [
    knopf("zurueck", "Vorherige Seite", vor),
    knopf("weiter", "Nächste Seite", nach),
  ].filter((k) => k !== null);
  if (teile.length === 0) return null;
  return el(
    "nav",
    { class: "seitenwechsel", "aria-label": "Weitere Seiten" },
    ...teile,
  );
}

export function rendereHandlungsBaustein(
  b: HandlungsBaustein,
  daten: Daten,
  stand: HandlungsStand,
): HtmlKnoten | null {
  switch (b.typ) {
    case "kopfbereich":
      return kopfbereich(b, daten, stand);
    case "inhaltsverzeichnis":
      return verzeichnis(b, stand);
    case "weiterfuehrend":
      return weiterfuehrend(b, daten);
    case "kontaktleiste":
      return kontaktleiste(b, daten);
    case "weitersagen":
      return weitersagen(b, stand);
    case "seitenwechsel":
      return seitenwechsel(stand);
    case "brotkrumen":
      return brotkrumen(stand);
  }
}

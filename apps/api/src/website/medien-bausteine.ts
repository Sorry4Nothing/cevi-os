import type { Baustein } from "./bausteine.js";
import { MEDIEN_TYPEN } from "./medien-schema.js";
import {
  bild,
  el,
  groesse,
  medienUrl,
  verlinke,
  type Daten,
  type HtmlKnoten,
  type MedienDaten,
} from "./rendern.js";
import { pruefeLink } from "../link-pruefung.js";

// Renderer der Bausteine für Bilder und Medien (#742). Wie der übrige Renderer: nur typisierte Knoten, jeder Text wird beim Ausgeben maskiert, Adressen laufen durch verlinke() oder pruefeLink(), Bilder nur über /api/v1/medien/<ID>.
// Kein style-Attribut (die CSP erlaubt keines): Abstufungen sind Klassen. Stil: public/website/medien.css, Skript des Bildvergleichs: public/website/vergleich.js.

export const STIL_MEDIEN = "/website/medien.css";
export const SKRIPT_VERGLEICH = "/website/vergleich.js";

type Typ = (typeof MEDIEN_TYPEN)[number];
export type MedienBaustein = Extract<Baustein, { typ: Typ }>;

export const istMedienBaustein = (b: Baustein): b is MedienBaustein =>
  (MEDIEN_TYPEN as readonly string[]).includes(b.typ);

// Bausteine, deren Bilder sich gross öffnen lassen (lichtkasten.js)
export const LICHTKASTEN_TYPEN: readonly string[] = [
  "bildraster",
  "bildstreifen",
  "panorama",
];
// Bausteine, die in einem Abschnitt unter dem Titel über die ganze Breite stehen (statt rechts neben dem Titel)
export const MEDIEN_BREIT: ReadonlySet<string> = new Set([
  "bildraster",
  "bildstreifen",
  "logoreihe",
  "bildtext",
  "panorama",
  "bildvergleich",
]);

// Stil und Skript einer Seite: nur, wenn sie einen dieser Bausteine hat (auch einen geschützten, der nachgeladen wird)
export function medienAnforderungen(bausteine: readonly Baustein[]): {
  stile: string[];
  skripte: string[];
  lichtkasten: boolean;
} {
  const mit = (f: (b: Baustein) => boolean) => bausteine.some(f);
  return {
    stile: mit(
      (b) => istMedienBaustein(b) || (b.typ === "videolink" && !!b.daten.bild),
    )
      ? [STIL_MEDIEN]
      : [],
    skripte: mit((b) => b.typ === "bildvergleich") ? [SKRIPT_VERGLEICH] : [],
    lichtkasten: mit((b) => LICHTKASTEN_TYPEN.includes(b.typ)),
  };
}

const istBild = (m: MedienDaten | undefined): m is MedienDaten =>
  !!m && m.mimeTyp.startsWith("image/");

// Das Bild mit Breite und Höhe der Datei: Der Platz steht fest, bevor es geladen ist. Alt-Text nur vom Medium (null = dekorativ)
function bildElement(id: string, m: MedienDaten, alt?: string): HtmlKnoten {
  return el("img", {
    src: medienUrl(id),
    alt: alt ?? m.altText ?? "",
    ...(m.breite &&
      m.hoehe && { width: String(m.breite), height: String(m.hoehe) }),
    loading: "lazy",
    decoding: "async",
  });
}

// Ein Objekt statt el(): Diese Datei und rendern.ts importieren einander, beim Laden gibt es el noch nicht
const EXTERN_HINWEIS: HtmlKnoten = {
  tag: "span",
  attr: { class: "nur-sr" },
  kinder: [" (externe Seite)"],
};
const zahl = new Intl.NumberFormat("de-CH");

// Klassen und Figuren eines Bildes mit Grossansicht
function figuren(
  eintraege: { mediumId: string; unterschrift?: string }[],
  daten: Daten,
): HtmlKnoten[] {
  return eintraege
    .map((e) => bild(e.mediumId, daten.medien.get(e.mediumId), e.unterschrift))
    .filter((k) => k !== null);
}

function rendereVergleich(
  b: Extract<MedienBaustein, { typ: "bildvergleich" }>,
  daten: Daten,
): HtmlKnoten | null {
  const [vorher, nachher] = b.daten.bilder.map((e) => ({
    id: e.mediumId,
    m: daten.medien.get(e.mediumId),
  }));
  if (!vorher || !nachher || !istBild(vorher.m) || !istBild(nachher.m)) {
    return null;
  }
  const seite = (
    klasse: string,
    z: { id: string; m: MedienDaten },
    text: string,
  ) =>
    el(
      "figure",
      { class: klasse },
      bildElement(z.id, z.m),
      el("figcaption", undefined, text),
    );
  return el(
    "figure",
    { class: "vergleich" },
    el(
      "div",
      { class: "vergleich-bilder" },
      seite(
        "v-vorher",
        { id: vorher.id, m: vorher.m },
        b.daten.vorherText ?? "Vorher",
      ),
      seite(
        "v-nachher",
        { id: nachher.id, m: nachher.m },
        b.daten.nachherText ?? "Nachher",
      ),
    ),
    ...(b.daten.unterschrift
      ? [el("figcaption", { class: "vergleich-text" }, b.daten.unterschrift)]
      : []),
  );
}

// letzte.ebene: Ebene der letzten Überschrift der Seite; der Titel auf dem Bild liegt eine darunter
export function rendereMedienBaustein(
  b: MedienBaustein,
  daten: Daten,
  letzte: { ebene: number },
): HtmlKnoten | null {
  const ebene = Math.min(3, letzte.ebene + 1);
  switch (b.typ) {
    case "bildraster": {
      const liste = figuren(b.daten.bilder, daten);
      return liste.length === 0
        ? null
        : el(
            "ul",
            {
              class: `bildraster bildraster--${b.daten.spalten} bildraster--${b.daten.format}`,
              role: "list",
            },
            ...liste.map((f) => el("li", { class: "einblenden" }, f)),
          );
    }
    case "bildstreifen": {
      const liste = figuren(b.daten.bilder, daten);
      return liste.length === 0
        ? null
        : el(
            "div",
            {
              class: "bildstreifen",
              role: "group",
              "aria-label": `Bildstreifen mit ${liste.length} ${liste.length === 1 ? "Bild" : "Bildern"}`,
            },
            el(
              "ul",
              { class: "streifen", role: "list" },
              ...liste.map((f) => el("li", undefined, f)),
            ),
          );
    }
    case "bildtext": {
      const m = daten.medien.get(b.daten.mediumId);
      if (!istBild(m)) return null;
      const l = b.daten.link;
      return el(
        "div",
        { class: `bildtext bildtext--${b.daten.position ?? "unten"}` },
        bildElement(b.daten.mediumId, m),
        el(
          "div",
          { class: "bildtext-text" },
          el(`h${ebene}`, { class: "titel" }, b.daten.titel),
          ...(b.daten.text ? [el("p", undefined, b.daten.text)] : []),
          ...(l ? verlinke(l.ziel, [l.beschriftung], "btn w") : []),
        ),
      );
    }
    case "bildvergleich":
      return rendereVergleich(b, daten);
    case "logoreihe": {
      const logos = b.daten.bilder.flatMap((e) => {
        const m = daten.medien.get(e.mediumId);
        if (!istBild(m)) return [];
        const img = bildElement(e.mediumId, m);
        return [
          el(
            "li",
            { class: "einblenden" },
            ...(e.link
              ? verlinke(e.link, [img], "logo-kachel")
              : [el("span", { class: "logo-kachel" }, img)]),
          ),
        ];
      });
      return logos.length === 0
        ? null
        : el(
            "ul",
            {
              class: `logoreihe logoreihe--${b.daten.darstellung}`,
              role: "list",
            },
            ...logos,
          );
    }
    case "panorama": {
      const m = daten.medien.get(b.daten.mediumId);
      const f = bild(b.daten.mediumId, m, b.daten.unterschrift);
      if (!f || typeof f === "string") return null;
      return {
        ...f,
        attr: {
          class: `panorama panorama--${b.daten.hoehe} panorama--x-${b.daten.fokusX ?? "mitte"} panorama--y-${b.daten.fokusY ?? "mitte"}`,
        },
      };
    }
    case "bilderpaket": {
      // Die Adresse prüft der Renderer noch einmal streng (die Norm-Schreibweise geht ins Markup)
      const l = pruefeLink(b.daten.link);
      if (!l.ok) return null;
      const m = b.daten.bild ? daten.medien.get(b.daten.bild) : undefined;
      const info = [
        b.daten.typ,
        b.daten.anzahl === undefined
          ? undefined
          : `${zahl.format(b.daten.anzahl)} ${b.daten.anzahl === 1 ? "Bild" : "Bilder"}`,
        b.daten.groesse === undefined ? undefined : groesse(b.daten.groesse),
      ].filter((t) => t !== undefined);
      const vorschau =
        b.daten.bild && istBild(m)
          ? bildElement(
              b.daten.bild,
              m,
              // Der Titel steht daneben: Wiederholt der Alt-Text nur ihn, bleibt er leer
              (m.altText ?? "").trim().toLowerCase() ===
                b.daten.titel.trim().toLowerCase()
                ? ""
                : undefined,
            )
          : null;
      return el(
        "div",
        { class: vorschau ? "paket paket--bild" : "paket" },
        ...(vorschau ? [el("div", { class: "paket-bild" }, vorschau)] : []),
        el(
          "div",
          { class: "paket-text" },
          el(`h${ebene}`, { class: "titel" }, b.daten.titel),
          ...(b.daten.text ? [el("p", undefined, b.daten.text)] : []),
          ...(info.length > 0
            ? [el("p", { class: "paket-info" }, info.join(", "))]
            : []),
          el(
            "a",
            { class: "btn s", href: l.link, rel: "noopener noreferrer" },
            "Bilder ansehen und herunterladen",
            EXTERN_HINWEIS,
          ),
        ),
      );
    }
  }
}

// Video mit Vorschaubild (#742): Die Karte ist ein Link auf die Seite des Videos, nie eine Wiedergabe bei uns. Ohne gültiges Vorschaubild bleibt es bei der Zeile mit dem Link
export function rendereVideolink(
  b: Extract<Baustein, { typ: "videolink" }>,
  daten: Daten,
): HtmlKnoten {
  const m = b.daten.bild ? daten.medien.get(b.daten.bild) : undefined;
  if (!b.daten.bild || !istBild(m)) {
    return el(
      "p",
      undefined,
      ...verlinke(b.daten.url, [b.daten.beschriftung], "verweis"),
    );
  }
  // Der Name des Ziels sagt, wohin der Link führt; die Adresse hat das Schema schon als https mit Host geprüft
  let host = "";
  try {
    host = new URL(b.daten.url).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  const quelle = `${b.daten.art === "video" ? "Video" : "Beitrag"}${host ? ` auf ${host}` : ""}`;
  const alt =
    (m.altText ?? "").trim().toLowerCase() ===
    b.daten.beschriftung.trim().toLowerCase()
      ? ""
      : undefined;
  return el(
    "p",
    { class: "video" },
    ...verlinke(
      b.daten.url,
      [
        el(
          "span",
          { class: "video-bild" },
          bildElement(b.daten.bild, m, alt),
          el("span", { class: "video-start", "aria-hidden": "true" }),
        ),
        el(
          "span",
          { class: "video-text" },
          el("strong", undefined, b.daten.beschriftung),
          el("span", { class: "video-quelle" }, quelle),
        ),
      ],
      "videokarte",
    ),
  );
}

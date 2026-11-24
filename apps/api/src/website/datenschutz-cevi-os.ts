import { rahmen, esc, type Kontext } from "./rendern.js";
import { DATENSCHUTZ_CEVI_OS_TEXT } from "./datenschutz-cevi-os-text.js";

// Die feste Seite «Datenschutz: Cevi OS, App, Verwaltung und Website» (#712). Der Text liegt im Code (datenschutz-cevi-os-text.ts); der Abgleich schreibt daraus die Datei datenschutz-cevi-os/index.html in die Ausgabe.
// Sie ist eine erzeugte Datei wie «termine» und «anmelden»: Der Edge liefert sie aus dem Volume, die API hat keine Route dafür. Die Adresse ist reserviert (RESERVIERTE_ADRESSEN in seiten.ts).
// Stil: public/website/datenschutz.css (nur diese Seite)
export const DATENSCHUTZ_CEVI_OS_ADRESSE = "datenschutz-cevi-os";
export const DATENSCHUTZ_CEVI_OS_DATEI = `${DATENSCHUTZ_CEVI_OS_ADRESSE}/index.html`;
export const DATENSCHUTZ_CEVI_OS_TITEL =
  "Datenschutz: Cevi OS, App, Verwaltung und Website";
export const STIL_DATENSCHUTZ = "/website/datenschutz.css";
const ALLGEMEIN = "/datenschutz-website";
const ALLGEMEIN_TEXT =
  "Allgemeine Datenschutzerklärung des Cevi Stäfa-Hombrechtikon";

// Links: nur ein Pfad auf derselben Domain oder https; alles andere (javascript:, data:, //host) wird zu Text ohne Link
const SICHERES_ZIEL = /^(?:\/(?!\/)[\w\-./#?=%]*|https:\/\/[^\s<>"'`]+)$/;
// Fett, kursiv, Link; eine Zeichenkette ohne Treffer ist Text
const INLINE = /\*\*(.+?)\*\*|\*(\S(?:.*?\S)?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

// Text immer maskiert: Roher Text aus der Quelle gelangt nie als Markup in die Seite
function inline(text: string): string {
  let aus = "";
  let ab = 0;
  for (const m of text.matchAll(INLINE)) {
    aus += esc(text.slice(ab, m.index));
    ab = m.index + m[0].length;
    if (m[1] !== undefined) aus += `<strong>${inline(m[1])}</strong>`;
    else if (m[2] !== undefined) aus += `<em>${inline(m[2])}</em>`;
    else if (SICHERES_ZIEL.test(m[4]!)) {
      const extern = m[4]!.startsWith("https:")
        ? ` rel="noopener noreferrer"`
        : "";
      aus += `<a href="${esc(m[4]!)}"${extern}>${inline(m[3]!)}</a>`;
    } else aus += inline(m[3]!);
  }
  return aus + esc(text.slice(ab));
}

export type Ueberschrift = { ebene: number; text: string; id?: string };

// Ein kleiner, strenger Umwandler: Überschriften der Ebenen 2 bis 4, Absätze, flache Listen mit «- ». Alles andere ist Absatztext. Kein rohes HTML, keine Tabellen, keine verschachtelten Listen.
// Überschriften der Ebene 3, die mit einer Nummer wie «11.1» beginnen, tragen einen Anker (abschnitt-11-1)
export function markdownZuHtml(markdown: string): {
  html: string;
  ueberschriften: Ueberschrift[];
} {
  const teile: string[] = [];
  const ueberschriften: Ueberschrift[] = [];
  let absatz: string[] = [];
  let liste: string[] = [];
  const schliesse = () => {
    if (absatz.length > 0) teile.push(`<p>${inline(absatz.join(" "))}</p>`);
    if (liste.length > 0) {
      teile.push(
        `<ul>\n${liste.map((p) => `<li>${inline(p)}</li>`).join("\n")}\n</ul>`,
      );
    }
    absatz = [];
    liste = [];
  };
  for (const zeile of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const h = /^(#{2,4}) +(\S.*?) *$/.exec(zeile);
    if (zeile.trim() === "") schliesse();
    else if (h) {
      schliesse();
      const ebene = h[1]!.length;
      const nummer = ebene === 3 ? /^(\d+(?:\.\d+)+)\s/.exec(h[2]!) : null;
      const id = nummer
        ? `abschnitt-${nummer[1]!.replaceAll(".", "-")}`
        : undefined;
      ueberschriften.push({ ebene, text: h[2]!, ...(id && { id }) });
      teile.push(
        `<h${ebene}${id ? ` id="${id}"` : ""}>${inline(h[2]!)}</h${ebene}>`,
      );
    } else if (/^- +\S/.test(zeile)) {
      if (absatz.length > 0) schliesse();
      liste.push(zeile.slice(2).trim());
    } else {
      if (liste.length > 0) schliesse();
      absatz.push(zeile.trim());
    }
  }
  schliesse();
  return { html: teile.join("\n"), ueberschriften };
}

// [Dateipfad, Inhalt] für den Abgleich
export function rendereDatenschutzCeviOs(
  k: Kontext,
  text = DATENSCHUTZ_CEVI_OS_TEXT,
): [string, string] {
  const { html, ueberschriften } = markdownZuHtml(text);
  const verzeichnis = ueberschriften
    .filter((u) => u.id)
    .map((u) => `<li><a href="#${u.id}">${esc(u.text)}</a></li>`)
    .join("\n");
  const zurueck = `<p class="datenschutz-zurueck"><a class="verweis" href="${ALLGEMEIN}">${ALLGEMEIN_TEXT}</a></p>`;
  return [
    DATENSCHUTZ_CEVI_OS_DATEI,
    rahmen(k, {
      titel: DATENSCHUTZ_CEVI_OS_TITEL,
      aktuell: null,
      canonical: `${k.basisUrl}/${DATENSCHUTZ_CEVI_OS_ADRESSE}`,
      stile: [STIL_DATENSCHUTZ],
      vollbreit: true,
      inhalt: `<div class="seitenband"><div class="wrap"><h1>${esc(DATENSCHUTZ_CEVI_OS_TITEL)}</h1></div></div>
<section class="sektion sektion--text">
<div class="wrap">
<div class="sektion-rumpf">
<div class="text lesetext datenschutz">
${zurueck}
<nav class="datenschutz-inhalt" aria-labelledby="datenschutz-inhalt">
<p id="datenschutz-inhalt"><strong>Auf dieser Seite</strong></p>
<ul>
${verzeichnis}
</ul>
</nav>
${html}
${zurueck}
</div>
</div>
</div>
</section>`,
    }),
  ];
}

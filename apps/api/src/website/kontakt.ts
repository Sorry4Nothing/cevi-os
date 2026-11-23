import type { Baustein } from "./bausteine.js";
import {
  el,
  esc,
  medienUrl,
  serialisiere,
  symbol,
  verlinke,
  type Daten,
  type HtmlKnoten,
  type Kontext,
} from "./rendern.js";

// Der Abschluss der Seiten (#580): die Kontaktkarte am Ende der Startseite und der Fuss auf jeder Seite.
// Stil: public/website/fuss.css (jede Seite lädt ihn). Beides ist ohne Skript benutzbar; Telefon, E-Mail und Anschrift kommen aus der Konfiguration des Servers, nie aus dem Dokument.
export const STIL_FUSS = "/website/fuss.css";

// «043 543 96 82» wird zu tel:+41435439682 (Schweizer Nummern; mit «+» oder «00» am Anfang bleibt die Landesvorwahl)
export function telefonZiel(nummer: string): string {
  const ziffern = nummer.replace(/[^\d+]/g, "");
  const intl = ziffern.startsWith("+")
    ? ziffern
    : ziffern.startsWith("00")
      ? `+${ziffern.slice(2)}`
      : `+41${ziffern.replace(/^0/, "")}`;
  return `tel:${intl}`;
}

// Ein Link nur, wenn die Adresse eine erlaubte Art hat; sonst fehlt er (nie ein Link ohne Ziel)
const linkKnoten = (
  ziel: string,
  innen: HtmlKnoten[],
  klasse?: string,
): HtmlKnoten | null => {
  const k = verlinke(ziel, innen, klasse)[0];
  return typeof k === "object" ? k : null;
};

type KontaktDaten = Extract<Baustein, { typ: "kontaktkarte" }>["daten"];

// Kontaktkarte: links die Frage mit der einen Hauptaktion (E-Mail schreiben) und der zweiten Möglichkeit (Anrufen), rechts das Bild und die Angaben zum Nachlesen,
// darunter die ruhige Gruppe der weiterführenden Verweise. Ohne Bild stehen die Angaben rechts. Gibt es nichts zu zeigen, entfällt die Karte
export function kontaktkarte(
  d: KontaktDaten,
  daten: Daten,
  ebene: number,
): HtmlKnoten | null {
  const k = daten.kontakt;
  const person = d.personId ? daten.personen.get(d.personId) : undefined;
  const aktionen = [
    k?.email
      ? { ziel: `mailto:${k.email}`, text: "E-Mail schreiben" }
      : undefined,
    k?.telefon ? { ziel: telefonZiel(k.telefon), text: "Anrufen" } : undefined,
  ]
    .filter((a) => a !== undefined)
    .map((a, i) =>
      linkKnoten(a.ziel, [a.text], i === 0 ? "btn p gross" : "btn s gross"),
    )
    .filter((a) => a !== null);
  const zeilen = [
    k?.adresse ? ["Anschrift", k.adresse] : undefined,
    k?.email
      ? ["E-Mail", linkKnoten(`mailto:${k.email}`, [k.email]) ?? k.email]
      : undefined,
    k?.telefon
      ? [
          "Telefon",
          linkKnoten(telefonZiel(k.telefon), [k.telefon]) ?? k.telefon,
        ]
      : undefined,
  ].filter((z) => z !== undefined) as [string, HtmlKnoten][];
  const verweise = (d.verweise ?? []).map((v) =>
    el("li", undefined, ...verlinke(v.ziel, [v.beschriftung], "verweis")),
  );
  const m = d.bild ? daten.medien.get(d.bild) : undefined;
  const bild =
    d.bild && m?.mimeTyp.startsWith("image/")
      ? el(
          "figure",
          { class: "kontakt-bild" },
          el("img", {
            src: medienUrl(d.bild),
            alt: m.altText ?? "",
            ...(m.breite &&
              m.hoehe && { width: String(m.breite), height: String(m.hoehe) }),
            loading: "lazy",
            decoding: "async",
          }),
        )
      : undefined;
  if (!person && aktionen.length === 0 && zeilen.length === 0) return null;
  return el(
    "section",
    { class: bild ? "kontaktkarte kontaktkarte--bild" : "kontaktkarte" },
    el(
      "div",
      { class: "kontakt-haupt" },
      el(`h${ebene}`, undefined, d.titel ?? "Fragen? Melde dich bei uns."),
      ...(person
        ? [
            el(
              "p",
              { class: "kontakt-person" },
              person.funktion
                ? `${person.name}, ${person.funktion}`
                : person.name,
            ),
          ]
        : []),
      ...(d.hinweis ? [el("p", { class: "kontakt-hinweis" }, d.hinweis)] : []),
      ...(aktionen.length > 0
        ? [el("div", { class: "knopfreihe aktionen" }, ...aktionen)]
        : []),
    ),
    ...(bild ? [bild] : []),
    ...(zeilen.length > 0
      ? [
          el(
            "dl",
            { class: "kontakt-angaben" },
            ...zeilen.map(([name, wert]) =>
              el(
                "div",
                undefined,
                el("dt", undefined, name),
                el("dd", undefined, wert),
              ),
            ),
          ),
        ]
      : []),
    ...(verweise.length > 0
      ? [
          el(
            "div",
            { class: "kontakt-verweise" },
            el(`h${ebene + 1}`, undefined, "Weitere Informationen"),
            el("ul", undefined, ...verweise),
          ),
        ]
      : []),
  );
}

// «Cevi Stäfa» wird zu «CEVI» und «Stäfa» (wie im Kopf): Das Logo trägt das Wort Cevi schon
const markenname = (abteilung: string) =>
  abteilung.replace(/^cevi\s+/i, "").trim() || abteilung;

// Die Marke im Fuss, der auf blauem Grund steht: Mit einer Fassung des Logos für Dunkel (helle Schrift, ohne Hintergrund) steht sie so da.
// Gibt es nur die helle Fassung, sitzt das Logo auf einem hellen Feld (es hat dunkle Schrift); ohne Logo steht die Wortmarke
function fussMarke(k: Kontext): string {
  const name = esc(markenname(k.abteilung));
  if (!k.logo) {
    return `<a class="fuss-marke" href="/"><b>CEVI</b><span>${name}</span></a>`;
  }
  const quelle = k.logo.dunkel ?? k.logo;
  const masse =
    quelle.breite && quelle.hoehe
      ? ` width="${quelle.breite}" height="${quelle.hoehe}"`
      : "";
  return `<a class="fuss-marke fuss-marke--logo" href="/"><img class="${k.logo.dunkel ? "fuss-logo" : "fuss-logo fuss-logo--feld"}" src="${medienUrl(quelle.id)}" alt="${esc(k.logo.altText ?? "")}"${masse}><span class="nur-sr">${name}</span></a>`;
}

// Fuss (#580): ein Band mit drei Stufen. Oben die Marke, die Hauptbereiche der Navigation (nur die oberste Ebene) und «Nach oben»;
// in der Mitte Anschrift, E-Mail und Telefon; unten «©» und Rechtliches. Was es nicht gibt, fehlt; ein Impressum nennt der Fuss nur, wenn es die Seite gibt
export function fuss(k: Kontext): string {
  const c = k.daten.kontakt ?? {};
  const link = (ziel: string, text: string) =>
    serialisiere(linkKnoten(ziel, [text]) ?? text);
  const angaben = [
    c.adresse
      ? `<div><dt>Anschrift</dt><dd>${esc(k.abteilung)}<br>${esc(c.adresse)}</dd></div>`
      : "",
    c.email
      ? `<div><dt>E-Mail</dt><dd>${link(`mailto:${c.email}`, c.email)}</dd></div>`
      : "",
    c.telefon
      ? `<div><dt>Telefon</dt><dd>${link(telefonZiel(c.telefon), c.telefon)}</dd></div>`
      : "",
  ].filter((a) => a !== "");
  const seiten = k.navigation
    .slice(0, 8)
    .map((p) => `<li><a href="${esc(p.pfad)}">${esc(p.titel)}</a></li>`);
  const recht = [
    c.impressum ? `<li><a href="${esc(c.impressum)}">Impressum</a></li>` : "",
    `<li><a href="${esc(c.datenschutz ?? "/datenschutz")}">Datenschutz</a></li>`,
  ].filter((a) => a !== "");
  return `<footer class="fuss">
<div class="wrap">
<div class="fuss-kopf">${fussMarke(k)}${seiten.length > 0 ? `<nav class="fuss-seiten" aria-label="Seiten"><ul>${seiten.join("")}</ul></nav>` : ""}</div>
<div class="fuss-mitte">${angaben.length > 0 ? `<address><dl class="fuss-angaben">${angaben.join("")}</dl></address>` : ""}<a class="btn s fuss-oben" href="#">Nach oben${serialisiere(symbol("pfeil"))}</a></div>
<div class="fuss-recht"><p>© ${new Date().getFullYear()} ${esc(k.abteilung)}</p><nav aria-label="Rechtliches"><ul>${recht.join("")}</ul></nav></div>
</div>
</footer>`;
}

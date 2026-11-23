import type { Seitendokument } from "./dokument.js";
import {
  esc,
  istOeffentlich,
  medienUrl,
  rahmen,
  serialisiere,
  symbol,
  TERMINE_PFAD,
  type Daten,
  type Kontext,
  type NavPunkt,
} from "./rendern.js";

// Fehler- und Wartungsseiten (#567). Die Idee: ein Wegweiser am Wanderweg. Links steht gross, was los ist, ein Satz und die Hauptaktion;
// rechts ein Feld bis zum Fensterrand (auf der 404-Seite mit einem Foto), darin der Pfosten mit Tafeln, die auf zwei, drei sinnvolle Ziele zeigen.
// Die Seiten wiederholen das Menü nicht. 500.html und wartung.html tragen kein Bild und rufen nichts ab: Der Host liefert sie auch, wenn die API nicht antwortet.
export const STIL_FEHLER = "/website/fehler.css";

// Eine Tafel: mit «ziel» ein Link, ohne ein Schild (zum Beispiel bei Wartung). «zusatz» steht klein rechts, wie die Wanderzeit
export type Tafel = { titel: string; zusatz?: string; ziel?: string };

type Buehne = {
  titel: string;
  // Fertig maskiert
  satz: string;
  // Fertig maskiertes Markup der Hauptaktion
  aktion: string;
  tafeln: Tafel[];
  code?: string;
  // Fertig maskiertes <img> als Stimmungsbild hinter dem Wegweiser
  bild?: string;
};

const tafelHtml = (t: Tafel) => {
  const inhalt = `<span class="tafel-ziel">${esc(t.titel)}</span>${t.zusatz ? `<span class="tafel-zusatz">${esc(t.zusatz)}</span>` : ""}`;
  return t.ziel === undefined
    ? `<li><span class="tafel tafel--schild">${inhalt}</span></li>`
    : `<li><a class="tafel" href="${esc(t.ziel)}">${inhalt}</a></li>`;
};

// Auch für die Seiten ohne Rahmen (Weiterleitung): Sie setzen die Bühne direkt in <main>
export const fehlerBuehne = ({
  titel,
  satz,
  aktion,
  tafeln,
  code,
  bild,
}: Buehne) => `<div class="irr">
<div class="irr-text">
<h1>${esc(titel)}</h1>
<p class="irr-satz">${satz}</p>
<div class="knopfreihe aktionen">${aktion}</div>${code ? `\n<p class="klein leise">${esc(code)}</p>` : ""}
</div>
<div class="irr-feld${bild ? " irr-feld--bild" : ""}">${bild ?? ""}
<${tafeln.some((t) => t.ziel !== undefined) ? 'nav class="wegweiser" aria-label="Wohin jetzt?"' : 'div class="wegweiser"'}>
<ul>
${tafeln.map(tafelHtml).join("\n")}
</ul>
</${tafeln.some((t) => t.ziel !== undefined) ? "nav" : "div"}>
</div>
</div>`;

// Ohne Skript: ein Link auf dieselbe Adresse lädt die Seite neu
export const NOCHMALS = `<a class="btn p gross" href="">${serialisiere(symbol("nochmals"))}Nochmals versuchen</a>`;
const START = `<a class="btn p gross" href="/">Zur Startseite</a>`;

// Das Stimmungsbild der 404-Seite: das Titelbild der Startseite (ihr erster Baustein, wenn er ein öffentliches Bild ist). Sonst steht der Wegweiser auf der blauen Fläche
export function stimmungsbild(
  start: Seitendokument | undefined,
  daten: Daten,
): string | undefined {
  const erster = start?.bausteine[0];
  if (!erster || erster.typ !== "bild" || !istOeffentlich(erster)) {
    return undefined;
  }
  const m = daten.medien.get(erster.daten.mediumId);
  return m?.mimeTyp.startsWith("image/") ? erster.daten.mediumId : undefined;
}

// Die erste Seite der Navigation, deren Adresse auf eines der Stücke endet (auch in Untermenüs)
function seiteMit(punkte: NavPunkt[], stuecke: string[]): NavPunkt | undefined {
  for (const p of punkte) {
    if (stuecke.includes(p.pfad.split("/").pop()!)) return p;
    const kind = seiteMit(p.kinder, stuecke);
    if (kind) return kind;
  }
  return undefined;
}

// Die Ziele der 404-Seite: die Seite der Gruppen (Adresse «gruppen» oder «stufen»), die Termine (feste Seite) und der Kontakt (Seite «kontakt», sonst die E-Mail der Abteilung). Was es nicht gibt, fehlt
function ziele(k: Kontext): Tafel[] {
  const gruppen = seiteMit(k.navigation, ["gruppen", "stufen"]);
  const kontakt = seiteMit(k.navigation, ["kontakt"]);
  const email = k.daten.kontakt?.email;
  return [
    ...(gruppen
      ? [{ titel: gruppen.titel, zusatz: "1 Klick", ziel: gruppen.pfad }]
      : []),
    { titel: "Termine", zusatz: "1 Klick", ziel: TERMINE_PFAD },
    ...(kontakt
      ? [{ titel: kontakt.titel, zusatz: "1 Klick", ziel: kontakt.pfad }]
      : email
        ? [{ titel: "Schreib uns", zusatz: "1 Mail", ziel: `mailto:${email}` }]
        : []),
  ];
}

// 404.html: der Host liefert sie bei unbekannten Adressen; sie verrät nichts über geschützte Seiten.
// «bild» ist die ID eines öffentlichen Bildes (siehe stimmungsbild); es ist Schmuck und hat keinen Alt-Text
export function rendereFehlerseite(k: Kontext, bild?: string): string {
  const m = bild ? k.daten.medien.get(bild) : undefined;
  return rahmen(k, {
    titel: "Seite nicht gefunden",
    aktuell: null,
    robots: "noindex",
    vollbreit: true,
    stile: [STIL_FEHLER],
    inhalt: fehlerBuehne({
      titel: "Falsch abgebogen.",
      satz: "Diese Seite gibt es nicht. Vielleicht ist der Link alt oder hat einen Tippfehler.",
      aktion: START,
      tafeln: ziele(k),
      code: "Fehler 404",
      ...(bild &&
        m && {
          bild: `<img src="${medienUrl(bild)}" alt=""${m.breite && m.hoehe ? ` width="${m.breite}" height="${m.hoehe}"` : ""} decoding="async">`,
        }),
    }),
  });
}

// 500.html: der Host liefert sie, wenn die Website selbst nicht antwortet
export function rendereServerfehler(k: Kontext): string {
  return rahmen(k, {
    titel: "Fehler",
    aktuell: null,
    robots: "noindex",
    nurMarke: true,
    vollbreit: true,
    stile: [STIL_FEHLER],
    inhalt: fehlerBuehne({
      titel: "Hier geht es gerade nicht weiter.",
      satz: "Bei uns ist etwas schiefgegangen, das liegt nicht an dir. Versuche es in ein paar Minuten nochmals.",
      aktion: NOCHMALS,
      tafeln: [{ titel: "Zur Startseite", zusatz: "1 Klick", ziel: "/" }],
      code: "Fehler 500",
    }),
  });
}

// wartung.html: der Host liefert sie mit dem Status 503, wenn die Website gewartet wird
export function rendereWartung(k: Kontext): string {
  return rahmen(k, {
    titel: "Wartung",
    aktuell: null,
    robots: "noindex",
    nurMarke: true,
    vollbreit: true,
    stile: [STIL_FEHLER],
    inhalt: fehlerBuehne({
      titel: "Wir sind gleich wieder da.",
      satz: "Die Website wird gerade aktualisiert. Versuche es in ein paar Minuten nochmals.",
      aktion: NOCHMALS,
      tafeln: [{ titel: "Weg wird gerichtet", zusatz: "ein paar Minuten" }],
      code: "Fehler 503",
    }),
  });
}

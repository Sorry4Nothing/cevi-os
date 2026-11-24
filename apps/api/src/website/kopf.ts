import {
  ANMELDEN_PFAD,
  esc,
  medienUrl,
  serialisiere,
  symbol,
  type Kontext,
  type NavPunkt,
} from "./rendern.js";

// Kopf der Website (#558): ein Band, das oben stehen bleibt. Links die Marke, daneben die Navigation, rechts «Anmelden», der Umschalter Hell und Dunkel und am Handy das Menü.
// Stil: public/website/kopf.css, Verhalten: public/website/menue.js und theme.js. Alles ist ohne Skript bedienbar: Jedes Untermenü, «Mehr» und das Menü am Handy sind details-Elemente.
export const STIL_KOPF = "/website/kopf.css";

// «Cevi Stäfa» wird zu «CEVI» und «Stäfa»: Das Logo trägt das Wort Cevi schon
const markenname = (abteilung: string) =>
  abteilung.replace(/^cevi\s+/i, "").trim() || abteilung;

const istVorfahr = (pfad: string, aktuell: string | null) =>
  aktuell !== null && pfad !== "/" && aktuell.startsWith(`${pfad}/`);

const istHier = (p: NavPunkt, aktuell: string | null): boolean =>
  p.pfad === aktuell ||
  istVorfahr(p.pfad, aktuell) ||
  p.kinder.some((k) => istHier(k, aktuell));

function navLink(p: NavPunkt, aktuell: string | null): string {
  const stand =
    p.pfad === aktuell
      ? ' aria-current="page"'
      : istVorfahr(p.pfad, aktuell)
        ? ' aria-current="true"'
        : "";
  return `<a href="${esc(p.pfad)}"${stand}>${esc(p.titel)}</a>`;
}

// Eine Liste mit allen Ebenen darunter, eingerückt
const liste = (punkte: NavPunkt[], aktuell: string | null): string =>
  `<ul>${punkte
    .map(
      (p) =>
        `<li>${navLink(p, aktuell)}${p.kinder.length > 0 ? liste(p.kinder, aktuell) : ""}</li>`,
    )
    .join("")}</ul>`;

// Der Knopf, der ein Untermenü öffnet: die Zusammenfassung eines details-Elements, nur ein Dreieck, der Name steht im aria-label
const oeffner = (titel: string) =>
  `<summary aria-label="Unterseiten von ${esc(titel)}">${serialisiere(symbol("dreieck"))}</summary>`;

// Umschalter Hell und Dunkel: zwei Knöpfe nur mit Symbol, der Name steht im aria-label. Ohne Skript bleibt er verborgen (hidden), website/theme.js zeigt ihn;
// ohne gespeicherte Wahl markiert es den Knopf, der zum System passt, und speichert erst beim Klick
const THEMA_WAHL: [string, string, string][] = [
  ["light", "sonne", "Hell"],
  ["dark", "mond", "Dunkel"],
];
const themaSchalter = () =>
  `<div class="thema" role="group" aria-label="Darstellung" hidden>${THEMA_WAHL.map(
    ([wert, icon, name]) =>
      `<button type="button" data-thema="${wert}" aria-pressed="false" aria-label="${name}">${serialisiere(symbol(icon))}</button>`,
  ).join("")}</div>`;

// Das Konto-Menü für Angemeldete (#669): eine Vorlage, die konto-menue.js nach dem Laden anstelle von «Anmelden» einsetzt, sobald GET /api/v1/website/konto eine Sitzung bestätigt.
// Die Seite bleibt für alle gleich und trägt nichts über eine Person (kein Name, kein Bild, kein Zugang): Die Vorlage hat nur leere Felder (data-konto) und feste Texte; das Bild legt das Skript an. Ein template ist inert, ohne Skript sieht und hört niemand es.
// Aufbau wie ein Offenlegungsmenü (details mit Links und einem Knopf, kein ARIA-«menu»); am Computer klappt es auf, im Menü am Handy steht es ausgeklappt in der Liste (konto-menue.js setzt open).
const kontoVorlage = () => {
  const ava = `<span class="konto-ava" aria-hidden="true"><span data-konto="initialen"></span></span>`;
  return `<template id="konto-vorlage"><details class="konto-menue"><summary class="konto-knopf">${ava}<span class="konto-name"><span class="nur-sr">Konto: </span><span data-konto="name"></span></span>${serialisiere(symbol("dreieck"))}</summary><div class="konto-tafel"><div class="konto-kopf">${ava}<p><strong data-konto="name"></strong><span>Angemeldet</span></p></div><ul class="konto-liste"><li data-konto="verwaltung"><a href="/admin">${serialisiere(symbol("verwaltung"))}Verwaltung</a></li><li><a href="/konto">${serialisiere(symbol("person"))}Mein Konto</a></li><li><button type="button" data-konto="abmelden">${serialisiere(symbol("abmelden"))}Abmelden</button></li></ul><p class="konto-meldung" role="status"></p></div></details></template>`;
};

// Mit Logo trägt das Bild die Marke (das Logo der Abteilung enthält ihren Namen); der Name bleibt für Screenreader im Link. Ohne Logo steht die Wortmarke.
// Gibt es eine Fassung für den dunklen Modus, stehen beide Bilder im Markup und der Stil zeigt je nach Darstellung eines (das verborgene ist display: none und wird nicht vorgelesen)
function markeHtml(k: Kontext): string {
  const name = esc(markenname(k.abteilung));
  if (!k.logo) {
    return `<a class="marke" href="/"><b>CEVI</b><span>${name}</span></a>`;
  }
  const { id, altText, breite, hoehe, dunkel } = k.logo;
  const alt = esc(altText ?? "");
  const bild = (
    klasse: string,
    b: { id: string; breite: number | null; hoehe: number | null },
  ) =>
    `<img class="${klasse}" src="${medienUrl(b.id)}" alt="${alt}"${b.breite && b.hoehe ? ` width="${b.breite}" height="${b.hoehe}"` : ""}>`;
  return dunkel
    ? `<a class="marke marke--logo marke--zwei" href="/">${bild("logo logo--hell", { id, breite, hoehe })}${bild("logo logo--dunkel", dunkel)}<span class="nur-sr">${name}</span></a>`
    : `<a class="marke marke--logo" href="/">${bild("logo", { id, breite, hoehe })}<span class="nur-sr">${name}</span></a>`;
}

// Die Navigation am Computer hat eine Zeile. Der Server kennt die Titel, aber nicht ihre Breite im Browser:
// shortcut: die Breite ist geschätzt (em je Zeichen der Schrift Archivo 600, dazu Innenabstand und Dreieck); CSS kann keinen Überlauf in ein Menü schieben. Reicht die Schätzung nicht, bricht die Zeile um (kopf.css), nichts wird abgeschnitten
const EM_JE_ZEICHEN = 0.53;
const EM_PUNKT = 1.5;
const EM_DREIECK = 1.4;
const breiteVon = (p: { titel: string; kinder: unknown[] }) =>
  p.titel.length * EM_JE_ZEICHEN +
  EM_PUNKT +
  (p.kinder.length > 0 ? EM_DREIECK : 0);
// So viel Platz hat die Zeile der Navigation im schmalsten Fenster mit Leiste (64 em, kleinere Schrift)
const EM_ZEILE = 64;
const EM_MEHR = breiteVon({ titel: "Mehr", kinder: [1] });

// Was nicht in die Zeile passt, steht unter «Mehr»; ein einzelner Punkt wandert nie allein dorthin, wenn er selbst Platz hat
function teileNavigation(punkte: NavPunkt[]) {
  const ganz = punkte.reduce((s, p) => s + breiteVon(p), 0);
  if (ganz <= EM_ZEILE) return { leiste: punkte, mehr: [], breite: ganz };
  let breite = EM_MEHR;
  let n = 0;
  while (n < punkte.length && breite + breiteVon(punkte[n]!) <= EM_ZEILE) {
    breite += breiteVon(punkte[n]!);
    n++;
  }
  n = Math.max(n, 1);
  return { leiste: punkte.slice(0, n), mehr: punkte.slice(n), breite };
}

// Ab welcher Fensterbreite Marke, Navigation und Knöpfe in eine Zeile passen, hängt von der Breite der Navigation ab; kopf.css kennt die vier Stufen
const stufe = (breite: number) =>
  breite <= 38
    ? " kopf--kurz"
    : breite <= 48
      ? " kopf--mittel"
      : breite <= 56
        ? " kopf--lang"
        : " kopf--weit";

// Ein Punkt mit Unterseiten: der Link führt zur Seite, das Dreieck daneben öffnet das Untermenü (details, darum ohne Skript und mit Tastatur und Finger bedienbar; mit menue.js öffnet es sich auch beim Zeigen).
// Haben die Unterseiten selbst Unterseiten, wird das Untermenü zur Tafel mit einer Spalte je Unterseite
function hauptPunkt(p: NavPunkt, aktuell: string | null): string {
  if (p.kinder.length === 0) return `<li>${navLink(p, aktuell)}</li>`;
  const gruppen = p.kinder.some((k) => k.kinder.length > 0);
  return `<li class="mit-unter">${navLink(p, aktuell)}<details name="hauptnav">${oeffner(p.titel)}<div class="unter${gruppen ? " unter--gruppen" : ""}">${liste(p.kinder, aktuell)}</div></details></li>`;
}

// «Mehr»: dieselbe Tafel; die Unterseiten der Punkte darin stehen eingerückt darunter
const mehrPunkt = (punkte: NavPunkt[], aktuell: string | null) =>
  `<li class="mit-unter weitere${punkte.some((p) => istHier(p, aktuell)) ? " hier" : ""}"><details name="hauptnav"><summary>Mehr${serialisiere(symbol("dreieck"))}</summary><div class="unter">${liste(punkte, aktuell)}</div></details></li>`;

// Menü am Handy: der ganze Baum. Unterseiten sind zugeklappt (details), nur der Zweig der aktuellen Seite ist offen
const mobilListe = (punkte: NavPunkt[], aktuell: string | null): string =>
  `<ul>${punkte
    .map((p) =>
      p.kinder.length === 0
        ? `<li>${navLink(p, aktuell)}</li>`
        : `<li class="mit-unter">${navLink(p, aktuell)}<details${istHier(p, aktuell) ? " open" : ""}>${oeffner(p.titel)}${mobilListe(p.kinder, aktuell)}</details></li>`,
    )
    .join("")}</ul>`;

export function kopf(
  k: Kontext,
  aktuell: string | null,
  nurMarke: boolean,
): string {
  if (nurMarke)
    return `<header class="kopf">
<div class="wrap kopf-in">${markeHtml(k)}<div class="kopf-rechts">${themaSchalter()}</div></div>
</header>`;
  const { leiste, mehr, breite } = teileNavigation(k.navigation);
  const anmelden = (klasse: string) =>
    `<a class="${klasse}" href="${ANMELDEN_PFAD}">${serialisiere(symbol("person"))}Anmelden</a>`;
  const haupt =
    k.navigation.length === 0
      ? ""
      : `
<nav class="hauptnav" aria-label="Hauptnavigation"><ul>${leiste.map((p) => hauptPunkt(p, aktuell)).join("")}${mehr.length > 0 ? mehrPunkt(mehr, aktuell) : ""}</ul></nav>`;
  // Die Unterseiten des gewählten Bereichs stehen in einer zweiten Leiste unter dem Band; sie scrollt mit dem Inhalt weg
  const bereich = k.navigation.find(
    (p) =>
      p.kinder.length > 0 &&
      (p.pfad === aktuell || istVorfahr(p.pfad, aktuell)),
  );
  return `<header class="kopf${stufe(breite)}">
<div class="wrap kopf-in">
${markeHtml(k)}${haupt}
<div class="kopf-rechts">${anmelden("anmelden")}${themaSchalter()}<details class="menue-mobil"><summary>${serialisiere(symbol("menue"))}${serialisiere(symbol("schliessen"))}<span class="auf">Menü</span><span class="zu">Schliessen</span></summary><div class="menue-tafel"><nav aria-label="Menü">${mobilListe(k.navigation, aktuell)}</nav><div class="menue-fuss">${anmelden("anmelden")}${themaSchalter()}</div></div></details></div>
</div>
${kontoVorlage()}</header>${
    bereich
      ? `
<nav class="unterleiste" aria-label="Unterseiten von ${esc(bereich.titel)}"><div class="wrap"><ul>${bereich.kinder.map((p) => `<li>${navLink(p, aktuell)}</li>`).join("")}</ul></div></nav>`
      : ""
  }`;
}

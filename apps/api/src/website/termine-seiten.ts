import {
  esc,
  rahmen,
  serialisiere,
  terminZeile,
  type Kontext,
  type TerminEintrag,
} from "./rendern.js";
import { DATENPLAN, planFenster } from "./termine-liste.js";

// Die Seiten für Termine und Anlässe (#530, Boards W3, W5 bis W8). Es sind fertige Dateien ohne Daten: Inhalt, Zustände und Anmeldung kommen im Browser aus der API (Skript im eigenen Modul unter /website/), weil sie von der Sitzung der Person abhängen. Ohne Skript zeigt jede Seite den Hinweis.
// Ausnahme ist der öffentliche Datenplan (#564): Die Seite «Termine» trägt die Termine der nächsten drei Monate als Liste im HTML (lesbar ohne Skript), und daneben liegt termine.json mit dem ganzen Fenster für Liste, Monat und Filter. Beides schreibt der Abgleich; ein Besuch fragt die Datenbank nie.
// Die Adressen «termine» und «anlass» gehören dazu (RESERVIERTE_ADRESSEN in seiten.ts), damit keine Seite aus dem Editor sie überdeckt.

export const STIL_TERMINE = "/website/termine.css";
// Das eigene Auswahlfeld (#564): Stil zu public/website/auswahl.js
export const STIL_AUSWAHL = "/website/auswahl.css";
// Mein Konto (#689): Profilkarte, Schalter und Passwortfeld
export const STIL_KONTO = "/website/konto.css";

type Definition = {
  datei: string;
  titel: string;
  seite: string;
  skript: string;
  // Die Kopfzeile: bei Anlassseiten füllt das Skript Titel und Datum nach
  kopf: "einfach" | "anlass";
  // Weitere Stile nur dieser Seite (Mein Konto, #689)
  stile?: string[];
};

const SEITEN: Definition[] = [
  {
    datei: "termine/index.html",
    titel: "Termine",
    seite: "termine",
    skript: "termine",
    kopf: "einfach",
  },
  {
    datei: "termine/vorschlagen/index.html",
    titel: "Termin vorschlagen",
    seite: "vorschlag",
    skript: "vorschlag",
    kopf: "einfach",
  },
  {
    datei: "anlass/index.html",
    titel: "Anlass",
    seite: "anlass",
    skript: "anlass",
    kopf: "anlass",
  },
  {
    datei: "anlass/anmeldung/index.html",
    titel: "Anmeldung",
    seite: "anmeldung",
    skript: "anmeldung",
    kopf: "einfach",
  },
  // Termin mit Antwort je Kind und Mein Konto für Angemeldete (#671); beide füllt das Skript nach der Anmeldung aus der API
  {
    datei: "termin/index.html",
    titel: "Termin",
    seite: "termin",
    skript: "termin",
    kopf: "anlass",
  },
  {
    datei: "konto/index.html",
    titel: "Mein Konto",
    seite: "konto",
    skript: "konto",
    kopf: "einfach",
    stile: [STIL_KONTO],
  },
];

export const DATENPLAN_DATEI = "termine/termine.json";

// Für Besucher führt ein Termin nur dann weiter, wenn sein Anlass eine öffentliche Seite hat: «/anlass?id=» verlangt eine Anmeldung
const oeffentlich = (k: Kontext): TerminEintrag[] =>
  (k.daten.termine.get(DATENPLAN) ?? []).map((t) => ({
    ...t,
    anlassId: t.seitePfad ? t.anlassId : null,
  }));

// Die Datei für das Skript: nur, was die Zeile zeigt. Keine IDs, keine Personen, keine Zahlen
export function rendereDatenplan(
  k: Kontext,
  jetzt = new Date(),
): [string, string] {
  const { von, bis } = planFenster(jetzt);
  return [
    DATENPLAN_DATEI,
    JSON.stringify({
      von,
      bis,
      termine: oeffentlich(k).map((t) => ({
        titel: t.titel,
        von: t.von,
        bis: t.bis,
        zeitVon: t.zeitVon,
        zeitBis: t.zeitBis,
        ort: t.ort,
        stufen: t.stufen,
        ...(t.seitePfad && { seite: t.seitePfad }),
      })),
    }),
  ];
}

const MONAT_JAHR = new Intl.DateTimeFormat("de-CH", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

// Die Liste im HTML: von heute an drei Monate, wie die Ansicht, mit der das Skript beginnt. Ohne geladenen Datenplan (Vorschau, Tests ohne Datenquelle) bleibt sie weg
function planListe(k: Kontext, jetzt: Date): string {
  if (!k.daten.termine.has(DATENPLAN)) return "";
  const { heute } = planFenster(jetzt);
  const [y, m, d] = heute.split("-").map(Number) as [number, number, number];
  const ende = new Date(Date.UTC(y, m - 1 + 3, d - 1))
    .toISOString()
    .slice(0, 10);
  const monate = new Map<string, TerminEintrag[]>();
  for (const t of oeffentlich(k)) {
    if (t.bis < heute || t.von > ende) continue;
    const monat = t.von.slice(0, 7);
    monate.set(monat, [...(monate.get(monat) ?? []), t]);
  }
  const inhalt =
    monate.size === 0
      ? `<div class="zustand"><p class="kopfzeile">Gerade stehen keine Termine an.</p><p>Schau später wieder vorbei.</p></div>`
      : [...monate]
          .map(
            ([monat, liste]) =>
              `<h2 class="monat-titel">${esc(MONAT_JAHR.format(new Date(`${monat}-15T12:00:00Z`)))}</h2>
<ul class="termine">${liste.map((t) => `<li>${serialisiere(terminZeile(t))}</li>`).join("")}</ul>`,
          )
          .join("\n");
  return `<div class="plan" id="tm-plan">
${inhalt}
</div>
`;
}

export const TERMINE_DATEIEN = SEITEN.map((s) => s.datei);

function seite(s: Definition, k: Kontext, jetzt: Date): string {
  const plan = s.seite === "termine" ? planListe(k, jetzt) : "";
  const kopf =
    s.kopf === "anlass"
      ? `<div class="seitenkopf" id="tm-kopf">
<p class="kicker" hidden></p>
<h1 id="tm-titel">${s.titel}</h1>
</div>`
      : `<div class="seitenkopf" id="tm-kopf">
<h1 id="tm-titel">${s.titel}</h1>
</div>`;
  return rahmen(k, {
    titel: s.titel,
    aktuell: null,
    robots: "noindex",
    skript: `/website/${s.skript}.js`,
    stile: [STIL_TERMINE, STIL_AUSWAHL, ...(s.stile ?? [])],
    inhalt: `<div class="tm">
${kopf}
<div id="tm-app" data-seite="${s.seite}">
${plan}<noscript><div class="band wa" role="status"><div class="text">${plan ? "<strong>Monatsansicht, Filter und Anmeldung brauchen JavaScript.</strong>Die Liste zeigt die Termine der nächsten drei Monate." : "<strong>Diese Seite braucht JavaScript.</strong>Schalte es in deinem Browser ein, um die Seite zu nutzen."}</div></div></noscript>
</div>
<p class="nur-leser" id="tm-status" role="status" aria-live="polite"></p>
</div>`,
  });
}

// [Dateipfad, Inhalt] für den Abgleich
export const rendereTermineSeiten = (
  k: Kontext,
  jetzt = new Date(),
): [string, string][] => SEITEN.map((s) => [s.datei, seite(s, k, jetzt)]);

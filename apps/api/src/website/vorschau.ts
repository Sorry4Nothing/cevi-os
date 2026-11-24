import type { Db } from "../db/client.js";
import { ladeLadenDaten } from "../laden/laden.js";
import type { Person } from "../rechte.js";
import { ladeDaten } from "./abgleich.js";
import type { Baustein } from "./bausteine.js";
import { sammleVerweise, type Seitendokument } from "./dokument.js";
import {
  keineDaten,
  rendereAbschnittsfolge,
  type Daten,
  type Fakt,
  type Kontakt,
  type MedienDaten,
  type StufenMitglied,
  type TerminEintrag,
} from "./rendern.js";
import { ladeStufenfaktenGemerkt } from "./stufenfakten.js";
import { ladeAnlassSeiten, ladeTerminlisten } from "./termine-liste.js";

// Vorschau einzelner Bausteine (#739): derselbe Renderer wie die Auslieferung, nie ein gezeichnetes Bild.
// Zwei Quellen für die Daten, auf die ein Baustein verweist (Bilder, Personen, Gruppen, Termine):
//  - ohne Seite (Katalog «Baustein hinzufügen»): Platzhalter aus diesem Code, nichts aus der Datenbank, keine echten Medien oder Namen;
//  - mit Seite (Editor): die echten Daten der Abteilung, wie bei der Vorschau der ganzen Seite.
// Wer einen Baustein mit eigenen Daten baut (Daten in `Daten`), ergänzt hier einen Platzhalter in beispielDaten UND in ladeVorschauDaten.

// Höchstens so viele Bausteine je Anfrage: der Katalog (heute rund 30 Einträge) mit Reserve
export const MAX_VORSCHAU_BAUSTEINE = 80;

// Die Seite der Beispiele: die Samstagsangaben der Stufe hängen an der Seite
export const BEISPIEL_SEITE_ID = "00000000-0000-4000-8000-000000000001";
// Feste IDs der Beispielartikel und ihrer Bilder
const beispielId = (nr: number) =>
  `00000000-0000-4000-8000-${String(nr).padStart(12, "0")}`;

// Die Vorschau läuft in einem Rahmen ohne Skripte (sandbox) unter der CSP der Verwaltung; ihre eigene Regel erlaubt dazu nur Stil, Schrift und Bilder der eigenen Herkunft sowie die Platzhalterbilder (data:)
export const VORSCHAU_CSP =
  "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'";

// Der Stil ist der der Verwaltung (seiten.ts): Die Website selbst liefert die API nicht aus
const STIL = "/admin/website-vorschau.css";

// Rahmen der Vorschau: Seitenhülle ohne Kopf, Fuss, Titel und Skript, immer hell (so sehen die meisten Besucher die Seite)
export function vorschauSeite(inhalt: string): string {
  return `<!doctype html>
<html lang="de-CH" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="${VORSCHAU_CSP}">
<meta name="referrer" content="no-referrer">
<link rel="stylesheet" href="${STIL}">
</head>
<body>
<main id="inhalt">
${inhalt}
</main>
</body>
</html>
`;
}

// Links führen in der Vorschau nirgends hin: ohne href sind sie weder anklickbar noch ein Tabstopp, der Text bleibt lesbar
const ohneZiele = (html: string) =>
  html.replace(/<a\b[^>]*>/g, (tag) => tag.replace(/\shref=/, " data-ziel="));

// Ein Platzhalterbild: Farbfläche mit Sonne und Hügel, aus dem Code (kein Medium, keine Datei)
const FARBEN = [
  ["#cfe3f6", "#7fb0dd"],
  ["#f6dcc9", "#e4a375"],
  ["#d8ecd3", "#8cc283"],
  ["#e6d9f1", "#b293d1"],
  ["#f3e7b8", "#dcc15f"],
] as const;
function platzhalterBild(nr: number): string {
  const [hell, dunkel] = FARBEN[nr % FARBEN.length]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="${hell}"/><circle cx="880" cy="250" r="90" fill="#ffffff" fill-opacity=".7"/><path d="M0 800V560C220 430 380 430 560 540S900 640 1200 470V800z" fill="${dunkel}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const mediumPlatzhalter: MedienDaten = {
  mimeTyp: "image/svg+xml",
  groesse: 1024,
  breite: 1200,
  hoehe: 800,
  altText: "Platzhalterbild",
};

const NAMEN = ["Kiwi", "Luchs", "Pippo", "Mira", "Sunneschii", "Flip"];
const FUNKTIONEN = [
  "Stufenleitung",
  "Leitung",
  "Leitung",
  "Leitung",
  "Kasse",
  "Material",
];
const mitglied = (nr: number): StufenMitglied => ({
  name: NAMEN[nr % NAMEN.length]!,
  funktion: FUNKTIONEN[nr % FUNKTIONEN.length]!,
});

const tagString = (d: Date) => d.toISOString().slice(0, 10);
// Die nächsten Samstage ab heute, ohne Bezug zu einem echten Programm
function beispielTermine(anzahl: number, vorne: string): TerminEintrag[] {
  const tag = new Date();
  tag.setUTCDate(tag.getUTCDate() + ((6 - tag.getUTCDay() + 7) % 7 || 7));
  return Array.from({ length: anzahl }, (_, i) => {
    const t = new Date(tag);
    t.setUTCDate(t.getUTCDate() + 7 * i);
    return {
      id: `${vorne}-${i}`,
      titel: i === 0 ? "Beispiel: Samstagsaktivität" : "Beispiel: Aktivität",
      von: tagString(t),
      bis: tagString(t),
      zeitVon: "14:00",
      zeitBis: "17:00",
      ort: "Beispielort",
      stufen: i % 2 === 0 ? ["Beispielstufe"] : [],
      anlassId: null,
    };
  });
}

const BEISPIEL_FAKTEN: Fakt[] = [
  { bezeichnung: "Datum", wert: "Samstag, 14.00 bis 17.00 Uhr" },
  { bezeichnung: "Treffpunkt", wert: "Beispielort, vor dem Gemeindehaus" },
  { bezeichnung: "Schluss", wert: "Beispielort, Gemeindehaus" },
  {
    bezeichnung: "Mitnehmen",
    wert: "Gutes Schuhwerk, Znüni",
    lang: true,
    liste: ["Gutes Schuhwerk", "Znüni", "Trinkflasche"],
  },
];

// Platzhalterdaten für alles, worauf die Bausteine verweisen (nichts aus der Datenbank): nur für den Katalog
export function beispielDaten(dokumente: Seitendokument[]): Daten {
  const daten = keineDaten();
  const medien = new Map<string, MedienDaten>();
  const personen = new Map<string, { name: string; funktion: string | null }>();
  const websitePersonen = new Map<string, { name: string }>();
  const teams = new Map<
    string,
    { name: string; mitglieder: { name: string; funktion: string | null }[] }
  >();
  const stufenteams = new Map<string, StufenMitglied[]>();
  const termine = new Map<string, TerminEintrag[]>();
  for (const dok of dokumente) {
    const v = sammleVerweise(dok);
    v.medien.forEach((id) => medien.set(id, mediumPlatzhalter));
    v.personen.forEach((id, i) => {
      const m = mitglied(personen.size + i);
      personen.set(id, m);
      websitePersonen.set(id, { name: m.name });
    });
    v.tags.forEach((id) => {
      const leitung = [0, 1, 2].map(mitglied);
      teams.set(id, { name: "Beispielgruppe", mitglieder: leitung });
      stufenteams.set(id, leitung);
    });
    for (const b of dok.bausteine as Baustein[]) {
      if (b.typ === "terminliste") {
        termine.set(b.id, beispielTermine(b.daten.anzahl, b.id));
      }
    }
  }
  const mitLaden = dokumente.some((d) =>
    d.bausteine.some((b) => b.typ === "laden"),
  );
  const artikel = [
    ["Beispiel: Pullover", 4500, ["S", "M", "L"]],
    ["Beispiel: Trinkflasche", 1800, []],
    ["Beispiel: Mütze", 2200, []],
    ["Beispiel: Tasche", 1500, []],
  ] as const;
  if (mitLaden) {
    artikel.forEach((_, i) =>
      medien.set(beispielId(10 + i), mediumPlatzhalter),
    );
  }
  const kontakt: Kontakt = {
    adresse: "Beispielweg 1, 8000 Beispielort",
    telefon: "044 000 00 00",
    email: "kontakt@beispiel.example",
  };
  return {
    ...daten,
    medien,
    personen,
    websitePersonen,
    teams,
    stufenteams,
    termine,
    stufenfakten: new Map([[BEISPIEL_SEITE_ID, BEISPIEL_FAKTEN]]),
    kontakt,
    ...(mitLaden && {
      laden: new Map(
        artikel.map(([name, preisRappen, varianten], i) => {
          const id = beispielId(20 + i);
          return [
            id,
            {
              id,
              name,
              preisRappen,
              mediumId: beispielId(10 + i),
              varianten: [...varianten],
              nichtVerfuegbar: [],
              hinweis: null,
              verfuegbar: true,
            },
          ];
        }),
      ),
      ladenUebergabe: new Map([["Abholung am Samstag", true as const]]),
    }),
  };
}

// Die echten Daten der Abteilung für ein Dokument der Seite `seiteId` (Vorschau der Seite und der Bausteine im Editor).
// Die Bausteine erscheinen offen, auch die mit engerer Sichtbarkeit: Wer die Seite bearbeitet, darf sie sehen
export async function ladeVorschauDaten(
  db: Db,
  person: Person,
  seiteId: string,
  dokument: Seitendokument,
  kontakt?: Kontakt,
): Promise<Daten> {
  // Termin-Liste und «Zur Anmeldung» (#570) aus denselben Quellen wie der Abgleich; die Termine nur, wenn die Seite eine Liste hat (dann drei Abfragen mehr, sonst eine)
  const [daten, laden, fakten, termine, anlaesse] = await Promise.all([
    ladeDaten(db, person.abteilungId, [dokument], false),
    // Lädeli (#566): Die Vorschau zeigt die Artikel wie die Website; die Abfragen laufen nur, wenn die Seite den Baustein hat
    ladeLadenDaten(
      db,
      person.abteilungId,
      [seiteId],
      new Map([[seiteId, dokument]]),
    ),
    ladeStufenfaktenGemerkt(db, person.abteilungId, seiteId),
    dokument.bausteine.some((b) => b.typ === "terminliste")
      ? ladeTerminlisten(
          db,
          person.abteilungId,
          [seiteId],
          new Map([[seiteId, dokument]]),
        )
      : {},
    ladeAnlassSeiten(db, person.abteilungId, [seiteId]),
  ]);
  if (fakten) daten.stufenfakten = new Map([[seiteId, fakten]]);
  if (laden.laden) {
    daten.laden = laden.laden;
    if (laden.ladenUebergabe) daten.ladenUebergabe = laden.ladenUebergabe;
    if (laden.ladenEinstellung) daten.ladenEinstellung = laden.ladenEinstellung;
    daten.medien = new Map([...daten.medien, ...(laden.medien ?? [])]);
  }
  Object.assign(daten, termine, anlaesse, kontakt && { kontakt });
  return daten;
}

export type Vorschau = { html: string | null; grund?: "leer" };

// Ein Baustein für sich als Seite im Rahmen. Leer, wenn der Renderer nichts zeigt (Medium fehlt, keine Daten)
export function rendereBausteinVorschau(
  baustein: Baustein,
  daten: Daten,
  seiteId: string,
  ersatz?: ReadonlyMap<string, string>,
): Vorschau {
  const dok: Seitendokument = {
    v: 1,
    titel: "Vorschau",
    bausteine: [baustein],
  };
  let inhalt = rendereAbschnittsfolge(dok, seiteId, daten).trim();
  if (inhalt === "") return { html: null, grund: "leer" };
  inhalt = ohneZiele(inhalt);
  // Platzhalterbilder: Aus der Adresse des Mediums wird das Bild aus dem Code
  for (const [id, bild] of ersatz ?? []) {
    inhalt = inhalt.replaceAll(`/api/v1/medien/${id}`, bild);
  }
  return { html: vorschauSeite(inhalt) };
}

// Die Platzhalterbilder aller Medien der Beispiele, nach ID
export function platzhalterBilder(daten: Daten): Map<string, string> {
  return new Map(
    [...daten.medien.keys()].map((id, i) => [id, platzhalterBild(i)]),
  );
}

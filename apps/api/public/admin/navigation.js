// Aufbau der Verwaltung: Bereiche (Bereichsleiste im Kopf) mit Unterseiten (Unterleiste darunter). Hier, und nur hier, meldet sich ein Modul an: Wer eine Ansicht baut, trägt in seine Zeile den Pfad seines Moduls ein (`modul`), ohne admin.js oder index.html anzufassen. Die Module werden erst geladen, wenn die Seite aufgerufen wird.
//
// Bereich:     { schluessel, name, symbol, start?, unter: [Unterseite] }
// Unterseite:  { schluessel, name, modul, untertitel, zugang? }
//   modul      Pfad der Datei mit `export function zeige(bereich, ctx)`; eine Unterseite ohne eigenes Modul zeigt «platzhalter.js»
//   zugang     wer die Seite sehen darf: «admin» (Vorgabe, Abteilungsleitung mit zweitem Faktor), «alle» (jede Person mit Zugang zur Verwaltung) oder ein Bereich aus GET /api/v1/redaktion/ich (heute «website» und «plattform»). Die Anzeige folgt nur dem Server; jede Route prüft selbst.
//   start      (am Bereich) die Unterseite, auf der die Bereichsleiste landet; sonst die erste
// Adressen (Hash): #<bereich> · #<bereich>/<unterseite> · #<bereich>/<unterseite>/<rest…>. Bei einem Bereich mit nur einer Unterseite gehört alles nach dem Bereich dem Modul (#website/seiten/<id>).

export const BEREICHE = [
  {
    schluessel: "uebersicht",
    name: "Übersicht",
    symbol: "uebersicht",
    unter: [
      {
        schluessel: "uebersicht",
        name: "Übersicht",
        modul: "./uebersicht.js",
        untertitel: "Was offen ist und wie es der Abteilung geht.",
        zugang: "alle",
      },
    ],
  },
  {
    schluessel: "personen",
    name: "Personen",
    symbol: "personen",
    unter: [
      {
        schluessel: "personen",
        name: "Personen",
        modul: "./personen.js",
        untertitel: "Konten, Rollen in den Stufen und Eltern-Zuordnung.",
      },
      {
        schluessel: "gruppen",
        name: "Gruppen und Tags",
        modul: "./tags.js",
        untertitel: "Tags anlegen und Personen zuweisen.",
      },
      {
        schluessel: "kinder",
        name: "Kinder",
        modul: "./kinder.js",
        untertitel: "Kinder, ihre Stufe und ihre Eltern.",
      },
      {
        schluessel: "import",
        name: "Import",
        modul: "./import.js",
        untertitel:
          "Kinder und Leitende aus einem Export der Cevi-Datenbank anlegen.",
      },
      // Übergang: Die Stufen gehen in «Gruppen und Tags» auf (Neuaufbau der Gruppen); bis dahin bleibt die alte Ansicht erreichbar
      {
        schluessel: "stufen",
        name: "Stufen",
        modul: "./stufen.js",
        untertitel: "Die Stufen der Abteilung.",
      },
      // Übergang: Die Anwesenheit hat im Design keinen eigenen Platz
      {
        schluessel: "anwesenheit",
        name: "Anwesenheit",
        modul: "./anwesenheit.js",
        untertitel: "Wer in den letzten Anlässen der Stufe da war.",
      },
    ],
  },
  {
    schluessel: "website",
    name: "Website",
    symbol: "website",
    unter: [
      {
        schluessel: "website",
        name: "Website",
        modul: "./website.js",
        untertitel: "Seiten und Medien der Website der Abteilung.",
        zugang: "website",
      },
    ],
  },
  {
    schluessel: "termine",
    name: "Termine",
    symbol: "termine",
    start: "vorschlaege",
    unter: [
      {
        schluessel: "kalender",
        name: "Kalender",
        modul: "./termine-kalender.js",
        untertitel:
          "Anstehende Termine aus Outlook mit den Gruppen aus den Kategorien.",
      },
      {
        schluessel: "vorschlaege",
        name: "Vorschläge",
        modul: "./termine-vorschlaege.js",
        untertitel: "Termine, die Leitende vorgeschlagen haben.",
      },
      {
        schluessel: "warnliste",
        name: "Ohne Kategorie",
        modul: "./termine-warnliste.js",
        untertitel:
          "Termine in Outlook, denen noch keine Gruppe zugeordnet ist.",
      },
      {
        schluessel: "kategorien",
        name: "Kategorien",
        modul: "./termine-kategorien.js",
        untertitel: "Welche Outlook-Kategorie zu welcher Gruppe gehört.",
      },
      {
        schluessel: "outlook",
        name: "Outlook",
        modul: "./termine-outlook.js",
        untertitel: "Die Verbindung zum Kalender der Abteilung.",
      },
    ],
  },
  {
    schluessel: "raeume",
    name: "Räume",
    symbol: "kalender",
    unter: [
      {
        schluessel: "raeume",
        name: "Räume",
        modul: "./termine-raeume.js",
        untertitel: "Räume der Abteilung und wer Anfragen bestätigt.",
      },
      {
        schluessel: "anfragen",
        name: "Anfragen",
        modul: "./termine-anfragen.js",
        untertitel: "Anfragen, die dein Team bestätigt oder ablehnt.",
      },
    ],
  },
  {
    schluessel: "anlaesse",
    name: "Anlässe",
    symbol: "stern",
    unter: [
      {
        schluessel: "anlaesse",
        name: "Anlässe",
        modul: "./termine-anlaesse.js",
        untertitel: "Anlässe mit Anmeldung über das Konto.",
      },
      {
        schluessel: "anmeldungen",
        name: "Anmeldungen",
        modul: "./termine-anmeldungen.js",
        untertitel: "Anmeldungen zu den Anlässen.",
      },
    ],
  },
  {
    schluessel: "lager",
    name: "Lager",
    symbol: "haken",
    unter: [
      {
        schluessel: "lager",
        name: "Lager",
        untertitel: "Die Lager der Abteilung.",
      },
      {
        schluessel: "vorlagen",
        name: "Vorlagen",
        untertitel: "Vorlagen für neue Lager.",
      },
    ],
  },
  {
    schluessel: "mitteilungen",
    name: "Mitteilungen",
    symbol: "glocke",
    unter: [
      {
        schluessel: "mitteilungen",
        name: "Mitteilungen",
        modul: "./mitteilungen.js",
        untertitel: "Push-Mitteilung an Eltern und Leitende senden.",
      },
    ],
  },
  {
    schluessel: "system",
    name: "System",
    symbol: "system",
    unter: [
      {
        schluessel: "system",
        name: "System",
        modul: "./system.js",
        untertitel: "Zustand von API, Datenbank und Anfragen.",
      },
      {
        schluessel: "plattform",
        name: "Plattform",
        modul: "./plattform.js",
        untertitel:
          "Wartungsmodus und Informationssperre für Bereiche schalten.",
        zugang: "plattform",
      },
      {
        schluessel: "zeitregeln",
        name: "Erinnerungen",
        modul: "./zeitregeln.js",
        untertitel: "Pushes an Eltern, die noch nicht geantwortet haben.",
      },
      {
        schluessel: "komponenten",
        name: "Komponenten",
        modul: "./komponenten.js",
        untertitel:
          "Skeleton-Lader und Zustände aller Bausteine, Tag und Nacht.",
      },
    ],
  },
];

// Alte Adressen (vor dem Neuaufbau) und die neue Heimat der Ansichten: [alt, neu], verglichen mit dem Anfang des Hashs ohne «#»
export const ALIASE = [
  ["tags", "personen/gruppen"],
  ["stufen", "personen/stufen"],
  ["kinder", "personen/kinder"],
  ["import", "personen/import"],
  ["anwesenheit", "personen/anwesenheit"],
  ["zeitregeln", "system/zeitregeln"],
  ["plattform", "system/plattform"],
  ["termine/anlaesse", "anlaesse/anlaesse"],
  ["termine/raeume", "raeume/raeume"],
];

// Schreibt eine alte Adresse auf die neue um; unbekannte Adressen bleiben wie sie sind
export function neueAdresse(hash) {
  const roh = hash.replace(/^#/, "");
  for (const [alt, neu] of ALIASE) {
    if (roh === alt || roh.startsWith(`${alt}/`)) {
      return `#${neu}${roh.slice(alt.length)}`;
    }
  }
  return hash;
}

// Darf die Person die Unterseite sehen? zugang: Antwort von GET /api/v1/redaktion/ich mit bereiche[]
export function darfSehen(unterseite, { istAdmin, zugang }) {
  if (istAdmin) return true;
  const wer = unterseite.zugang ?? "admin";
  if (wer === "admin") return false;
  if (wer === "alle") return true;
  return zugang?.bereiche.includes(wer) ?? false;
}

// Bereiche mit nur den sichtbaren Unterseiten; ein Bereich ohne sichtbare Unterseite entfällt
export function sichtbareBereiche(person) {
  return BEREICHE.map((b) => ({
    ...b,
    unter: b.unter.filter((u) => darfSehen(u, person)),
  })).filter((b) => b.unter.length > 0);
}

// Hash -> { bereich, unter, pfad } oder null bei einem toten Link. Ohne Hash gilt die Übersicht.
export function loese(hash, bereiche) {
  const [gesucht = "", zweiter, ...rest] = hash.replace(/^#/, "").split("/");
  const bereich = gesucht
    ? bereiche.find((b) => b.schluessel === gesucht)
    : bereiche[0];
  if (!bereich) return null;
  if (bereich.unter.length === 1) {
    // Alles nach dem Bereich gehört dem Modul
    return {
      bereich,
      unter: bereich.unter[0],
      pfad: zweiter === undefined ? [] : [zweiter, ...rest],
    };
  }
  const unter = zweiter
    ? bereich.unter.find((u) => u.schluessel === zweiter)
    : (bereich.unter.find((u) => u.schluessel === bereich.start) ??
      bereich.unter[0]);
  if (!unter) return null;
  return { bereich, unter, pfad: rest };
}

export const adresseVon = (bereich, unter) =>
  unter.schluessel === bereich.unter[0].schluessel && bereich.unter.length === 1
    ? `#${bereich.schluessel}`
    : `#${bereich.schluessel}/${unter.schluessel}`;

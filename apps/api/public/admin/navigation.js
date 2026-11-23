// Aufbau der Verwaltung: Bereiche (Bereichsleiste im Kopf) mit Unterseiten (Unterleiste darunter). Hier, und nur hier, meldet sich ein Modul an: Wer eine Ansicht baut, trägt in seine Zeile den Pfad seines Moduls ein (`modul`), ohne admin.js oder index.html anzufassen. Die Module werden erst geladen, wenn die Seite aufgerufen wird.
//
// Bereich:     { schluessel, name, symbol, start?, unter: [Unterseite] }
// Unterseite:  { schluessel, name, modul, untertitel, zugang? }
//   modul      Pfad der Datei mit `export function zeige(bereich, ctx)`; eine Unterseite ohne eigenes Modul zeigt «platzhalter.js»
//   zugang     wer die Seite sehen darf: «admin» (Vorgabe, Abteilungsleitung mit zweitem Faktor), «alle» (jede Person mit Zugang zur Verwaltung), ein Bereich aus GET /api/v1/redaktion/ich (heute «website» und «plattform»), «entwickler» (nur wer den Namen der Abteilung ändern darf, Signal `nameAenderbar` in GET /api/v1/redaktion/website) oder «recht:<name>» (die Person hat dieses Plattformrecht; Abteilungsleitung hat alle). Die Anzeige folgt nur dem Server; jede Route prüft selbst. Ein Eintrag, der für die Person in ein 403 liefe, erscheint gar nicht.
//   start      (am Bereich) die Unterseite, auf der die Bereichsleiste landet; sonst die erste
// Adressen (Hash): #<bereich> · #<bereich>/<unterseite> · #<bereich>/<unterseite>/<rest…>. Bei einem Bereich mit nur einer Unterseite gehört alles nach dem Bereich dem Modul (#<bereich>/<rest>).

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
        untertitel: "Konten, Rollen und Tags der Abteilung.",
      },
      {
        schluessel: "gruppen",
        name: "Gruppen und Tags",
        modul: "./tags.js",
        untertitel:
          "Wer zu welcher Gruppe gehört, steuert, wer was sieht und bearbeiten darf.",
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
    start: "seiten",
    unter: [
      {
        schluessel: "seiten",
        name: "Seiten",
        modul: "./website-seiten.js",
        untertitel: "Die Seiten der Website, ihr Status und wer sie sieht.",
        zugang: "website",
      },
      {
        schluessel: "medien",
        name: "Medien",
        modul: "./website-medien.js",
        untertitel: "Bilder der Website mit ihrem Alt-Text.",
        zugang: "website",
      },
      {
        schluessel: "stufenfakten",
        name: "Stufenfelder",
        modul: "./website-stufenfakten.js",
        untertitel: "Treffpunkt, Zeit und Mitnehmen der Stufen.",
        zugang: "website",
      },
      {
        schluessel: "einstellungen",
        name: "Einstellungen",
        modul: "./website-einstellungen.js",
        untertitel: "Name und Logo im Kopf der Website.",
        // Die Route verlangt «Seiten veröffentlichen»; Stufenleitung und Bearbeitende ohne dieses Recht liefen sonst in ein 403
        zugang: "recht:seiten.veroeffentlichen",
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
    ],
  },
  {
    schluessel: "laedeli",
    name: "Lädeli",
    symbol: "tag",
    start: "bestellungen",
    unter: [
      {
        schluessel: "bestellungen",
        name: "Bestellungen",
        modul: "./laedeli.js",
        untertitel: "Bestellungen der Website und ihr Stand.",
      },
      {
        schluessel: "artikel",
        name: "Artikel",
        modul: "./laedeli.js",
        untertitel: "Was das Lädeli anbietet, mit Preis und Varianten.",
      },
      {
        schluessel: "einstellungen",
        name: "Einstellungen",
        modul: "./laedeli.js",
        untertitel: "Wie Bestellungen übergeben werden.",
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
        modul: "./lager.js",
        untertitel: "Lager anlegen, betreuen und abschliessen.",
      },
      {
        schluessel: "vorlagen",
        name: "Vorlagen",
        modul: "./lager-vorlagen.js",
        untertitel:
          "Aufgaben und Packlisten, die neue Lager übernehmen können.",
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
        untertitel:
          "Push-Mitteilung an Stufen, Teams und andere Gruppen senden.",
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
        name: "Wartung und Sperre",
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
    ],
  },
];

// «Mein Konto» (#621) ist kein Bereich der Leiste: Der Name im Kopf öffnet die Seite (#konto). Jede Person mit Zugang sieht sie; sie zeigt nur die eigenen Daten
export const KONTO = {
  schluessel: "konto",
  name: "Mein Konto",
  modul: "./konto.js",
  untertitel:
    "Deine Angaben, deine Sicherheit und was die Website von dir zeigt.",
  zugang: "alle",
};
export const KONTO_BEREICH = {
  schluessel: "konto",
  name: "Mein Konto",
  symbol: "personen",
  unter: [KONTO],
};

// Alte Adressen (vor dem Neuaufbau) und die neue Heimat der Ansichten: [alt, neu], verglichen mit dem Anfang des Hashs ohne «#»
export const ALIASE = [
  ["tags", "personen/gruppen"],
  ["stufen", "personen/stufen"],
  ["kinder", "personen/kinder"],
  ["import", "personen/import"],
  ["anwesenheit", "personen/anwesenheit"],
  ["zeitregeln", "system/zeitregeln"],
  ["plattform", "system/plattform"],
  // Der Bereich Anlässe hat nur eine Unterseite: Die Liste liegt unter #anlaesse, ein Anlass unter #anlaesse/<id> (#608)
  ["termine/anlaesse", "anlaesse"],
  ["anlaesse/anlaesse", "anlaesse"],
  // Anmeldungen sind kein eigener Punkt mehr: Sie gehören zum Anlass (#607); die Adresse mit Kennung führt zum Anlass, ohne Kennung zur Liste
  ["anlaesse/anmeldungen", "anlaesse"],
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

// Darf die Person die Unterseite sehen? zugang: Antwort von GET /api/v1/redaktion/ich mit bereiche[] und rechte[]; entwickler: true, wenn der Server den Namen der Abteilung für diese Person änderbar nennt (nameAenderbar)
export function darfSehen(
  unterseite,
  { istAdmin, zugang, entwickler = false },
) {
  const wer = unterseite.zugang ?? "admin";
  // Die Abteilungsleitung sieht alles ausser dem, was nur der Entwickler darf
  if (wer === "entwickler") return entwickler === true;
  if (istAdmin) return true;
  if (wer === "admin") return false;
  if (wer === "alle") return true;
  if (wer.startsWith("recht:")) {
    return zugang?.rechte?.includes(wer.slice("recht:".length)) ?? false;
  }
  return zugang?.bereiche.includes(wer) ?? false;
}

// Rolle unter dem Namen im Kopf, nur zur Anzeige (die Rechte entscheidet der Server): was die Person tatsächlich ist, nicht ein Sammelwort
// profil: Antwort von GET /api/v1/ich (rollen, stufen) oder null; zugang: Antwort von GET /api/v1/redaktion/ich
export function rolleVon({ istAdmin, entwickler = false, zugang, profil }) {
  if (istAdmin) {
    return entwickler ? "Entwickler · Abteilungsleitung" : "Abteilungsleitung";
  }
  const stufenName = new Map((profil?.stufen ?? []).map((s) => [s.id, s.name]));
  const namen = (typ) =>
    (profil?.rollen ?? [])
      .filter((r) => r.typ === typ)
      .map((r) => stufenName.get(r.stufeId))
      .filter(Boolean);
  const teile = [];
  if (entwickler) teile.push("Entwickler");
  const sl = namen("stufenleitung");
  if (sl.length > 0) teile.push(`Stufenleitung ${sl.join(", ")}`);
  const leitung = namen("leitung");
  if (leitung.length > 0) teile.push(`Leitung ${leitung.join(", ")}`);
  const rechte = zugang?.rechte ?? [];
  if (rechte.some((r) => !r.startsWith("wartungsmodus."))) {
    teile.push("Website-Redaktion");
  } else if (rechte.length > 0) {
    teile.push("Wartung der Website");
  }
  return teile.length > 0 ? teile.join(" · ") : "Konto mit Zugang";
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
  if (gesucht === KONTO.schluessel) {
    return {
      bereich: KONTO_BEREICH,
      unter: KONTO,
      pfad: zweiter === undefined ? [] : [zweiter, ...rest],
    };
  }
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

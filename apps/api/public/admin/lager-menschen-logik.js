// Reine Logik für die Lager-Module «Menschen und Einteilung» (#675): Teilnehmende, Abzählen, Anwesenheit, Zimmer, Fahrten, Gruppen, Schichtplan, Diensttausch, Adressbuch. Kein DOM, damit sie sich im Test prüfen lässt.

const WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

// «Sa 17.07.» aus «2027-07-17»; ein ungültiges Datum bleibt, wie es ist
export function tagText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "");
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${WOCHENTAGE[d.getUTCDay()]} ${m[3]}.${m[2]}.`;
}

// «17.07.2027» aus «2027-07-17»
export function datumText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? "");
}

export const mehrzahl = (n, eins, viele) => `${n} ${n === 1 ? eins : viele}`;

// Wörter der Anwesenheit; Zustand nie nur über Farbe: Wort und Symbol
export const ANWESENHEIT = {
  A: { wort: "Da", symbol: "haken" },
  F: { wort: "Frei", symbol: "minus" },
  O: { wort: "Offen", symbol: "uhr" },
};
// Antippen wechselt Offen, Da, Frei, Offen
export const naechsterWert = (w) => ({ O: "A", A: "F", F: "O" })[w] ?? "A";

export const nameVergleich = (a, b) =>
  String(a).localeCompare(String(b), "de", { sensitivity: "base" });

// Anzeigename eines Teilnehmenden: «Nachname Vorname» für Listen, «Vorname Nachname» im Satz
export const teilnehmerName = (t) => `${t.vorname} ${t.nachname}`.trim();
export const teilnehmerSortName = (t) => `${t.nachname} ${t.vorname}`.trim();

// Schlüssel einer Person über beide Arten: «t:<id>» für Teilnehmende, «p:<id>» für Mitglieder
export const personSchluessel = (typ, id) =>
  `${typ === "teilnehmer" ? "t" : "p"}:${id}`;
export const eintragSchluessel = (e) =>
  e.teilnehmerId
    ? personSchluessel("teilnehmer", e.teilnehmerId)
    : personSchluessel("person", e.personId);

// Belegung eines Zimmers oder einer Fahrt: «3 von 4 Plätzen belegt»; mehr als Plätze ist erlaubt und wird gemeldet
export function belegung({ belegt, plaetze }) {
  if (plaetze === null || plaetze === undefined)
    return { text: mehrzahl(belegt, "Person", "Personen"), ueberbelegt: false };
  return {
    text: `${belegt} von ${plaetze} ${plaetze === 1 ? "Platz" : "Plätzen"} belegt`,
    ueberbelegt: belegt > plaetze,
    frei: Math.max(plaetze - belegt, 0),
  };
}

// --- Import aus einer Tabelle -----------------------------------------------------

export const IMPORT_MAX_ZEILEN = 500;
export const IMPORT_MAX_ZEICHEN = 40_000;

// Zählt die Datenzeilen vor dem Senden (leere Zeilen und eine Kopfzeile zählen nicht), damit das Limit früh gemeldet wird
export function zaehleImport(text) {
  const t = String(text ?? "");
  const zeilen = t.split(/\r\n|\r|\n/).filter((z) => z.trim() !== "");
  const kopf =
    zeilen.length > 0 && /^vorname\s*[\t;]\s*nachname/i.test(zeilen[0].trim());
  const daten = zeilen.length - (kopf ? 1 : 0);
  return {
    zeilen: daten,
    zeichen: t.length,
    zuViele: daten > IMPORT_MAX_ZEILEN,
    zuLang: t.length > IMPORT_MAX_ZEICHEN,
  };
}

export function importZusammenfassung(ergebnis) {
  const neu = ergebnis.neu?.length ?? 0;
  const fehler = ergebnis.fehler?.length ?? 0;
  const doppelt = ergebnis.doppelt?.length ?? 0;
  const teile = [mehrzahl(neu, "neue Person", "neue Personen")];
  if (doppelt > 0)
    teile.push(
      mehrzahl(doppelt, "Zeile schon vorhanden", "Zeilen übersprungen"),
    );
  if (fehler > 0)
    teile.push(mehrzahl(fehler, "Zeile mit Fehler", "Zeilen mit Fehlern"));
  return teile.join(", ");
}

export const GRUND_TEXT = {
  vorhanden: "Die Person ist schon im Lager.",
  im_text: "Die Person steht weiter oben schon in der Liste.",
};

// --- Konflikte ------------------------------------------------------------------------

export const istKonflikt = (f) =>
  f?.status === 409 && f?.code === "VERSION_KONFLIKT" && !!f?.daten?.aktuell;

// Die Zeilen der Konfliktansicht: nur Felder, die sich unterscheiden. felder: [[schluessel, label, format?]]
export function konfliktZeilen(daten, felder, meine) {
  const abweichend = new Set(daten.abweichend ?? []);
  return felder
    .filter(([k]) => abweichend.size === 0 || abweichend.has(k))
    .map(([k, label, format = (w) => w]) => ({
      schluessel: k,
      label,
      dein: leerText(format(meine[k])),
      server: leerText(format(daten.aktuell[k])),
    }));
}
const leerText = (w) =>
  w === null || w === undefined || w === "" ? "leer" : String(w);

// --- Zimmer, Gruppen, Mitfahrende: wer ist noch nicht eingeteilt -----------------

// Wer in keiner Liste steht. alle: [{ schluessel, … }], eingeteilt: Set von Schlüsseln
export const nichtEingeteilt = (alle, eingeteilt) =>
  alle.filter((p) => !eingeteilt.has(p.schluessel));

// Schlüssel aller Mitglieder aus Listen mit { mitglieder: [{ typ, id }] }
export function eingeteilteSchluessel(listen) {
  const s = new Set();
  for (const l of listen)
    for (const m of l.mitglieder ?? []) s.add(personSchluessel(m.typ, m.id));
  return s;
}

// Aufteilung der Auswahl in die zwei Listen, die die Routen erwarten
export function nachArt(personen) {
  const teilnehmerIds = [];
  const personIds = [];
  for (const p of personen)
    (p.typ === "teilnehmer" ? teilnehmerIds : personIds).push(p.id);
  return { teilnehmerIds, personIds };
}

// --- Fahrten --------------------------------------------------------------------------

export const RICHTUNGEN = [
  ["hin", "Hinfahrt"],
  ["rueck", "Rückfahrt"],
];

// «Auto Anna» oder «ÖV-Gruppe», mit dem Namen der Fahrt, falls es einen gibt
export function fahrtTitel(f) {
  if (f.name) return f.name;
  if (f.art === "auto")
    return f.fahrer?.name ? `Auto ${f.fahrer.name}` : "Auto ohne Fahrer";
  return "ÖV-Gruppe";
}

// «Sa 17.07., 08:30» oder nur eines von beidem
export function fahrtZeit(f) {
  const teile = [f.datum ? tagText(f.datum) : "", f.zeit ?? ""].filter(Boolean);
  return teile.join(", ");
}

// Nur Adressen mit https lassen wir als Link zu (der Server prüft dasselbe)
export const istHttps = (url) => /^https:\/\//i.test(String(url ?? "").trim());

// Fahrten nach Datum und Zeit; ohne Angabe ans Ende
export function sortiereFahrten(liste) {
  const schluessel = (f) => `${f.datum ?? "9999-99-99"} ${f.zeit ?? "99:99"}`;
  return [...liste].sort(
    (a, b) =>
      schluessel(a).localeCompare(schluessel(b)) ||
      fahrtTitel(a).localeCompare(fahrtTitel(b), "de"),
  );
}

// --- Schichtplan ----------------------------------------------------------------------

// Wer steht in welchem Dienst an welchem Tag: Map «dienstId|tagId» -> Schichten
export function schichtZellen(schichten) {
  const m = new Map();
  for (const s of schichten) {
    const k = `${s.dienstId}|${s.lagertagId}`;
    m.set(k, [...(m.get(k) ?? []), s]);
  }
  return m;
}

// «noch ein Platz frei», «voll besetzt», «niemand eingeteilt»
export function besetzungText(anzahl, mindest) {
  if (anzahl === 0) return "niemand eingeteilt";
  if (anzahl >= mindest) return "voll besetzt";
  const fehlt = mindest - anzahl;
  return fehlt === 1 ? "noch ein Platz frei" : `noch ${fehlt} Plätze frei`;
}

// Dienste nach Abschnitt des Tages gruppiert, in der Reihenfolge der Abschnitte
export function gruppiereDienste(dienste, abschnitte) {
  const je = new Map(abschnitte.map((a) => [a.id, []]));
  for (const d of dienste) je.get(d.tagesabschnittId)?.push(d);
  return abschnitte
    .map((a) => ({ abschnitt: a, dienste: je.get(a.id) ?? [] }))
    .filter((g) => g.dienste.length > 0);
}

// Neue Besetzung eines Dienstes an einem Tag, wenn Personen dazukommen oder gehen
export function besetzung(aktuell, { dazu = [], weg = [] }) {
  const gone = new Set(weg.map((p) => personSchluessel(p.typ, p.id)));
  const alle = [...aktuell, ...dazu].filter(
    (p) => !gone.has(personSchluessel(p.typ, p.id)),
  );
  const gesehen = new Set();
  const eindeutig = alle.filter((p) => {
    const k = personSchluessel(p.typ, p.id);
    if (gesehen.has(k)) return false;
    gesehen.add(k);
    return true;
  });
  return nachArt(eindeutig);
}

// --- Diensttausch ---------------------------------------------------------------------

export const TAUSCH_STATUS = {
  offen: "Offen",
  angenommen: "Angenommen",
  abgelehnt: "Abgelehnt",
  zurueckgezogen: "Zurückgezogen",
};

// «Anna möchte Küche am Sa 17.07. mit Ben tauschen» / «… abgeben»
export function tauschSatz(t) {
  const von = t.vonName ?? "Jemand";
  const schicht = t.schicht
    ? `${t.schicht.dienst} am ${tagText(t.schicht.datum)}`
    : "einen Dienst";
  if (t.mitSchichtId && t.mitName)
    return `${von} möchte ${schicht} mit ${t.mitName} tauschen`;
  if (t.mitName) return `${von} möchte ${schicht} an ${t.mitName} abgeben`;
  return `${von} möchte ${schicht} abgeben`;
}

// --- Adressbuch -----------------------------------------------------------------------

// Hinweis zur Aufräumfrist: «Wird am 12.01.2028 gelöscht» oder «Bleibt erhalten»
export function aufraeumenText(k) {
  return k.behalten || !k.aufraeumenAb
    ? "Bleibt erhalten"
    : `Wird am ${datumText(k.aufraeumenAb)} gelöscht`;
}

// Leerer Text wird null (löscht ein freiwilliges Feld beim Ändern)
export const leerZuNull = (w) => {
  const t = String(w ?? "").trim();
  return t === "" ? null : t;
};

// Nur geänderte Felder senden: vergleicht alt und neu je Schlüssel
export function aenderungen(alt, neu) {
  const aus = {};
  for (const k of Object.keys(neu)) {
    if ((alt?.[k] ?? null) !== (neu[k] ?? null)) aus[k] = neu[k];
  }
  return aus;
}

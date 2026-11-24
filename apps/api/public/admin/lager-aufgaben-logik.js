// Aufgaben und Zeitplan eines Lagers im Web (#670): die reinen Rechnungen ohne Oberfläche (Abschnitte, Filter, Gruppen, Reihenfolge, Zeitplan-Liste, Schnelleingabe). Kein DOM, kein Netz: Alles hier ist ohne Browser prüfbar. Namen und Regeln folgen dem Server (src/lager/aufgaben.ts, zeitplan.ts) und der App (lager/TaskLogic.kt).

export const STATUS = [
  ["offen", "Offen"],
  ["laeuft", "Läuft"],
  ["wartet", "Wartet"],
  ["erledigt", "Erledigt"],
  ["naechster_hoeck", "Nächster Höck"],
];
export const STATUSNAME = Object.fromEntries(STATUS);
// Was man von Hand setzt; «Nächster Höck» setzt, wer die Aufgabe für den Höck vormerkt
export const STATUS_WAHL = STATUS.filter(([w]) => w !== "naechster_hoeck");

export const WIEDERHOLUNG = [
  ["", "Keine"],
  ["w1", "Jede Woche"],
  ["w2", "Alle zwei Wochen"],
  ["m1", "Jeden Monat"],
];
export const WIEDERHOLUNGSNAME = Object.fromEntries(WIEDERHOLUNG);

export const ABSCHNITTE = [
  ["ueberfaellig", "Überfällig"],
  ["bald", "In den nächsten zwei Wochen"],
  ["spaeter", "Später"],
  ["ohneFrist", "Ohne Frist"],
  ["erledigt", "Erledigt"],
];
export const BALD_TAGE = 14;
const TAG_MS = 86_400_000;

// Heute in der Schweiz als «JJJJ-MM-TT»: Die Frist ist ein Datum ohne Uhrzeit, der Server rechnet gleich
export const heute = (jetzt = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(jetzt);

const tagNummer = (iso) => {
  const [j, m, t] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(j, m - 1, t) / TAG_MS;
};
// Tage von a bis b (b minus a)
export const tageZwischen = (a, b) => tagNummer(b) - tagNummer(a);
export const addiereTage = (iso, n) =>
  new Date((tagNummer(iso) + n) * TAG_MS).toISOString().slice(0, 10);

const WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const wochentag = (iso) =>
  WOCHENTAGE[new Date(tagNummer(iso) * TAG_MS).getUTCDay()];
// «15.03.2027»
export const datumText = (iso) => {
  if (!iso) return "";
  const [j, m, t] = iso.slice(0, 10).split("-");
  return `${t}.${m}.${j}`;
};
// «Mo, 15.03.2027»
export const datumMitTag = (iso) =>
  iso ? `${wochentag(iso)}, ${datumText(iso)}` : "";

// «Name (Cevi-Name)»; fehlt einer, steht der andere allein da (wie die App)
export function personName(p) {
  if (!p) return "";
  const name = (p.name ?? "").trim();
  const cevi = (p.ceviName ?? "").trim();
  if (name && cevi && name !== cevi) return `${name} (${cevi})`;
  return name || cevi || "Unbekannt";
}

export const istErledigt = (a) => a.status === "erledigt";
// Wie viele Tage die Frist her ist; null, wenn die Aufgabe nicht überfällig ist (Erledigtes ist nie überfällig)
export function ueberfaelligTage(a, jetzt) {
  if (!a.frist || istErledigt(a)) return null;
  const n = tageZwischen(a.frist, jetzt);
  return n > 0 ? n : null;
}
// «Später erinnern»: bis zu diesem Datum bleibt die Aufgabe ruhig im Abschnitt «Später»
export const istVertagt = (a, jetzt) =>
  !istErledigt(a) && Boolean(a.spaeterAb) && a.spaeterAb > jetzt;

export function abschnitt(a, jetzt) {
  if (istErledigt(a)) return "erledigt";
  if (istVertagt(a, jetzt)) return "spaeter";
  if (ueberfaelligTage(a, jetzt) !== null) return "ueberfaellig";
  if (!a.frist) return "ohneFrist";
  return tageZwischen(jetzt, a.frist) <= BALD_TAGE ? "bald" : "spaeter";
}

// Erst die Frist (ohne Frist zuletzt), dann die Reihenfolge der Lagerleitung, dann der Titel
export const nachFrist = (a, b) =>
  (a.frist ?? "9999-12-31").localeCompare(b.frist ?? "9999-12-31") ||
  a.reihenfolge - b.reihenfolge ||
  a.titel.localeCompare(b.titel, "de-CH", { sensitivity: "base" });
export const nachReihenfolge = (a, b) =>
  a.reihenfolge - b.reihenfolge ||
  a.titel.localeCompare(b.titel, "de-CH", { sensitivity: "base" });

export const FRIST_FILTER = [
  ["alle", "Alle"],
  ["ueberfaellig", "Überfällig"],
  ["bald", "In den nächsten zwei Wochen"],
  ["ohne", "Ohne Frist"],
];

// Beteiligt ist, wer verantwortlich ist (auch als einspringende Leitung des Ressorts) oder unterstützt
export const beteiligt = (a, personId) =>
  a.verantwortlich?.id === personId ||
  a.unterstuetzung.some((p) => p.id === personId);

// Der Filter der Tabelle: suche (Titel, Teilbereich, Notiz), ressort ("alle", "keins" oder ID), person ("alle", "niemand" oder ID), status ("alle", "offene" oder ein Status), frist (FRIST_FILTER), gemerkt ("alle" oder "ja")
export function filtere(aufgaben, f, jetzt) {
  const suche = (f.suche ?? "").trim().toLowerCase();
  return aufgaben.filter((a) => {
    if (
      suche &&
      ![a.titel, a.teil, a.notiz].some((t) =>
        (t ?? "").toLowerCase().includes(suche),
      )
    )
      return false;
    if (f.ressort === "keins") {
      if (a.ressortId) return false;
    } else if (f.ressort && f.ressort !== "alle" && a.ressortId !== f.ressort)
      return false;
    if (f.person === "niemand") {
      if (a.verantwortlich) return false;
    } else if (f.person && f.person !== "alle" && !beteiligt(a, f.person))
      return false;
    if (f.status === "offene") {
      if (istErledigt(a)) return false;
    } else if (f.status && f.status !== "alle" && a.status !== f.status)
      return false;
    if (f.frist === "ueberfaellig" && ueberfaelligTage(a, jetzt) === null)
      return false;
    if (
      f.frist === "bald" &&
      !(
        abschnitt(a, jetzt) === "bald" || abschnitt(a, jetzt) === "ueberfaellig"
      )
    )
      return false;
    if (f.frist === "ohne" && a.frist) return false;
    if (f.gemerkt === "ja" && !a.stern) return false;
    return true;
  });
}

// Gruppen der Tabelle: «abschnitt» (Fristen), «person», «ressort» oder «keine» (eine Gruppe in der Reihenfolge der Leitung). Leere Gruppen fehlen.
export function gruppiere(aufgaben, art, jetzt) {
  if (art === "keine")
    return [
      {
        schluessel: "alle",
        titel: "",
        aufgaben: [...aufgaben].sort(nachReihenfolge),
      },
    ];
  if (art === "abschnitt") {
    const nach = new Map(ABSCHNITTE.map(([k]) => [k, []]));
    for (const a of aufgaben) nach.get(abschnitt(a, jetzt)).push(a);
    return ABSCHNITTE.filter(([k]) => nach.get(k).length > 0).map(
      ([k, titel]) => ({
        schluessel: k,
        titel,
        aufgaben: nach.get(k).sort(nachFrist),
      }),
    );
  }
  const schluesselVon = (a) =>
    art === "person" ? (a.verantwortlich?.id ?? "") : (a.ressort?.id ?? "");
  const titelVon = (a) =>
    art === "person"
      ? a.verantwortlich
        ? personName(a.verantwortlich)
        : "Ohne Verantwortliche"
      : a.ressort
        ? `${a.ressort.kuerzel} ${a.ressort.name}`
        : "Kein Ressort";
  const nach = new Map();
  for (const a of aufgaben) {
    const k = schluesselVon(a);
    if (!nach.has(k))
      nach.set(k, {
        schluessel: k || "keine",
        titel: titelVon(a),
        aufgaben: [],
      });
    nach.get(k).aufgaben.push(a);
  }
  // Ohne Person oder Ressort zuletzt, sonst nach Name
  return [...nach.entries()]
    .sort(([ka, a], [kb, b]) =>
      ka === ""
        ? 1
        : kb === ""
          ? -1
          : a.titel.localeCompare(b.titel, "de-CH", { sensitivity: "base" }),
    )
    .map(([, g]) => ({ ...g, aufgaben: g.aufgaben.sort(nachFrist) }));
}

// Meine Aufgaben: offene, bei denen ich beteiligt bin, nach Frist; Erledigte am Ende
export function meine(aufgaben, personId) {
  const eigene = aufgaben.filter((a) => beteiligt(a, personId));
  return [
    ...eigene.filter((a) => !istErledigt(a)).sort(nachFrist),
    ...eigene.filter(istErledigt).sort(nachFrist),
  ];
}

// Die Spalten des Boards: Offen, Läuft, Wartet, Erledigt; «Nächster Höck» nur, wenn es solche Aufgaben gibt
export function spalten(aufgaben) {
  const status = [...STATUS_WAHL.map(([w]) => w)];
  if (aufgaben.some((a) => a.status === "naechster_hoeck"))
    status.push("naechster_hoeck");
  return status.map((s) => ({
    schluessel: s,
    titel: STATUSNAME[s],
    aufgaben: aufgaben.filter((a) => a.status === s).sort(nachReihenfolge),
  }));
}

// Eine Frist in Worten: «Überfällig seit 3 Tagen», «Heute», «Morgen», «In 5 Tagen» oder das Datum
export function fristWort(a, jetzt) {
  if (!a.frist) return "Keine Frist";
  if (istErledigt(a)) return datumMitTag(a.frist);
  const n = tageZwischen(jetzt, a.frist);
  if (n < 0) return `Überfällig seit ${-n} ${-n === 1 ? "Tag" : "Tagen"}`;
  if (n === 0) return "Heute";
  if (n === 1) return "Morgen";
  if (n <= 6) return `In ${n} Tagen`;
  return datumMitTag(a.frist);
}

// Die Einträge für PUT …/aufgaben/reihenfolge: Die Stelle in der Liste ist die neue Reihenfolge. Null, wenn sich nichts bewegt.
export function reihenfolgeEintraege(liste, id, delta) {
  const von = liste.findIndex((a) => a.id === id);
  const nach = von + delta;
  if (von < 0 || nach < 0 || nach >= liste.length) return null;
  const neu = [...liste];
  neu.splice(nach, 0, neu.splice(von, 1)[0]);
  return neu.map((a) => ({ id: a.id, version: a.version }));
}
// Dieselbe Liste als Eintraege für die Anfrage, wenn die IDs schon in der neuen Reihenfolge stehen
export const eintraegeNach = (liste, ids) => {
  const nachId = new Map(liste.map((a) => [a.id, a]));
  return ids
    .filter((id) => nachId.has(id))
    .map((id) => ({ id, version: nachId.get(id).version }));
};

// Der Körper für POST …/aufgaben aus einem Vorschlag der Schnelleingabe; ein mehrdeutiger oder unbekannter Treffer setzt nichts (die Person wählt)
export function vorschlagZuAufgabe(v, wahl = {}) {
  // wahl.person: undefined = nicht entschieden, "" = bewusst niemand, sonst die ID
  const gefunden = (t) =>
    t?.status === "gefunden" ? t.kandidaten[0]?.id : undefined;
  const person =
    wahl.person !== undefined ? wahl.person || undefined : gefunden(v.person);
  const ressort =
    wahl.ressort !== undefined
      ? wahl.ressort || undefined
      : gefunden(v.ressort);
  const frist = wahl.frist === undefined ? v.frist?.datum : wahl.frist;
  return {
    titel: v.titel,
    ...(person ? { verantwortlichPersonId: person } : {}),
    ...(ressort ? { ressortId: ressort } : {}),
    ...(frist ? { frist } : {}),
  };
}
export const HINWEISE = {
  TITEL_FEHLT: "Der Titel fehlt.",
  TITEL_ZU_LANG: "Der Titel ist zu lang (höchstens 200 Zeichen).",
  DATUM_UNGUELTIG: "Das Datum gibt es nicht.",
};
// Eine Zeile ist bereit, wenn sie einen Titel hat, kein Hinweis offen ist und Person und Ressort entschieden sind
export function vorschlagBereit(v, wahl = {}) {
  if (v.hinweise.length > 0) return false;
  const offen = (t, gewaehlt) =>
    t && t.status !== "gefunden" && gewaehlt === undefined;
  return !(offen(v.person, wahl.person) || offen(v.ressort, wahl.ressort));
}

// Eine relative Frist in Worten: «3 Tage vor «Anreise»», «Am Tag von «Packen»», «2 Tage nach Lagerbeginn»
export function relativeFristText(versatz, meilenstein) {
  if (typeof versatz !== "number") return "";
  const bezug = meilenstein ? `«${meilenstein}»` : "Lagerbeginn";
  if (versatz === 0)
    return meilenstein ? `Am Tag von ${bezug}` : "Am Tag des Lagerbeginns";
  const n = Math.abs(versatz);
  return `${n} ${n === 1 ? "Tag" : "Tage"} ${versatz < 0 ? "vor" : "nach"} ${bezug}`;
}

// ---- Zeitplan ----

// Alle Tage von von bis bis, einschliesslich
export function tageImLager(von, bis) {
  const tage = [];
  if (!von || !bis || bis < von) return tage;
  for (let t = von; t <= bis && tage.length < 400; t = addiereTage(t, 1))
    tage.push(t);
  return tage;
}
// Die Tage des Lagers, die noch keinen Lagertag haben
export const fehlendeLagertage = (lager, lagertage) => {
  const da = new Set(lagertage.map((t) => t.datum));
  return tageImLager(lager.von, lager.bis).filter((d) => !da.has(d));
};

// Die Liste des Zeitplans: Lagertage, Meilensteine und Fristen der Aufgaben, nach Datum. Je Tag eine Gruppe; innerhalb: erst Lagertag, dann Meilensteine, dann Fristen.
export function zeitplanTage(zeitplan, aufgaben, lager, jetzt) {
  const nach = new Map();
  const tag = (datum) => {
    if (!nach.has(datum))
      nach.set(datum, { datum, lagertag: null, meilensteine: [], fristen: [] });
    return nach.get(datum);
  };
  const tage = [...zeitplan.lagertage].sort((a, b) =>
    a.datum.localeCompare(b.datum),
  );
  for (const t of tage)
    tag(t.datum).lagertag = { ...t, nummer: tage.indexOf(t) + 1 };
  for (const m of zeitplan.meilensteine) tag(m.datum).meilensteine.push(m);
  for (const a of aufgaben)
    if (a.frist && !istErledigt(a)) tag(a.frist).fristen.push(a);
  return [...nach.values()]
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .map((t) => ({
      ...t,
      imLager: Boolean(lager) && t.datum >= lager.von && t.datum <= lager.bis,
      vergangen: t.datum < jetzt,
      heute: t.datum === jetzt,
    }));
}

// Monatsraster (Montag zuerst) mit allen Tagen des Monats; Tage ausserhalb sind null
export function monatsZellen(jahr, monat) {
  const erster = Date.UTC(jahr, monat, 1);
  const vorn = (new Date(erster).getUTCDay() + 6) % 7;
  const anzahl = new Date(Date.UTC(jahr, monat + 1, 0)).getUTCDate();
  const zellen = Array(vorn).fill(null);
  for (let t = 1; t <= anzahl; t++)
    zellen.push(
      `${jahr}-${String(monat + 1).padStart(2, "0")}-${String(t).padStart(2, "0")}`,
    );
  while (zellen.length % 7 !== 0) zellen.push(null);
  return zellen;
}
export const MONATE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

// Die Vorschau einer Verschiebung als Satz: «3 Aufgaben ändern ihre Frist.»
export const verschiebungSatz = (n) =>
  n === 0
    ? "An diesem Meilenstein hängt keine Aufgabe. Nur das Datum ändert sich."
    : n === 1
      ? "1 Aufgabe ändert ihre Frist."
      : `${n} Aufgaben ändern ihre Frist.`;

export const verschiebungErledigt = (n) =>
  n === 0
    ? "Keine Aufgabe hing daran."
    : n === 1
      ? "1 Aufgabe hat eine neue Frist."
      : `${n} Aufgaben haben eine neue Frist.`;

// Die Felder einer Aufgabe für die Meldung bei einem Konflikt
export const FELDNAMEN = {
  titel: "Titel",
  status: "Status",
  notiz: "Notiz",
  frist: "Frist",
  verantwortlichPersonId: "Verantwortliche",
  ressortId: "Ressort",
  stern: "Gemerkt",
  spaeterAb: "Erinnerung ab",
  teil: "Teilbereich",
  wiederholung: "Wiederholung",
  laufend: "Laufende Aufgabe",
  fristMeilensteinId: "Bezug der Frist",
  fristVersatzTage: "Abstand der Frist",
  unterstuetzungPersonIds: "Unterstützung",
  reihenfolge: "Reihenfolge",
};
// Der Wert eines Feldes als Text für den Vergleich im Konflikt; ids löst IDs in Namen auf ({ ressorts: Map, personen: Map })
export function feldWert(feld, wert, ids = {}) {
  if (wert === null || wert === undefined || wert === "") return "leer";
  if (feld === "status") return STATUSNAME[wert] ?? String(wert);
  if (feld === "frist" || feld === "spaeterAb") return datumText(wert);
  if (feld === "stern" || feld === "laufend") return wert ? "Ja" : "Nein";
  if (feld === "wiederholung") return WIEDERHOLUNGSNAME[wert] ?? String(wert);
  if (feld === "ressortId") return ids.ressorts?.get(wert) ?? "anderes Ressort";
  if (feld === "verantwortlichPersonId")
    return ids.personen?.get(wert) ?? "andere Person";
  return String(wert);
}

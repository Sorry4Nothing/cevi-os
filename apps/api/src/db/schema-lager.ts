import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Zyklus mit schema.ts (das diese Datei weiterreicht), harmlos: Die Verweise stehen nur in Funktionen, die erst beim Aufbau der Fremdschlüssel laufen
import { abteilung, kind, medium, user } from "./schema.js";

// Lager (#364), Modul Lager-Backend. Alle späteren Lager-Tabellen hängen mit ON DELETE CASCADE an lager.id und liegen ab Migration 0061 in eigenen Dateien dieses Verzeichnisses
// Das Lager gehört einer Abteilung; jede Lager-Route lädt es auf die Abteilung der Sitzung gefiltert (fremd = 404)
export const lager = pgTable(
  "lager",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    // Ohne Fremdschlüssel, bis der Auftrag Termine die Anlass-Tabelle anlegt
    anlassId: uuid("anlass_id"),
    titel: text("titel").notNull(),
    von: date("von").notNull(),
    bis: date("bis").notNull(),
    vorbereitungAb: date("vorbereitung_ab"),
    ort: text("ort"),
    adresse: text("adresse"),
    status: text("status", {
      enum: ["entwurf", "aktiv", "abgeschlossen", "archiviert"],
    })
      .notNull()
      .default("entwurf"),
    // Übungslager mit erfundenen Daten (kommt mit der Übung, #403)
    uebung: boolean("uebung").notNull().default(false),
    // Hex-Farbe «#rrggbb», kleingeschrieben
    farbe: text("farbe"),
    // Bis wann das Team die eigene Anwesenheit direkt einträgt (#390); danach nur noch per Anfrage. Leer: keine Frist. Setzt die Lagerleitung über PUT /lager/{id}/anwesenheit/frist
    anwesenheitFrist: timestamp("anwesenheit_frist", { withTimezone: true }),
    // Link zur Lageradresse in einer Karten-App (#393), nur gespeichert: Der Server ruft keinen Kartendienst ab. Setzt die Lagerleitung über PUT /lager/{id}/notfall/karte
    kartenLink: text("karten_link"),
    // Ort für das Wetter (#391, #694): Breite und Länge in Grad, auf zwei Stellen gerundet. Niemand gibt sie ein: Der Server bestimmt sie aus «ort» (lager/wetter-ort.ts). Nur sie gehen an den Wetterdienst; beide leer: kein Wetter
    breite: doublePrecision("breite"),
    laenge: doublePrecision("laenge"),
    // Stand der Ortssuche (#694): der Schlüssel des Textes, für den gesucht wurde (aus ort und adresse; ein anderer Text heisst «neu suchen»), der gefundene Name («Musterstadt, Kanton Beispiel»), das Ergebnis und der letzte Versuch
    wetterOrtSchluessel: text("wetter_ort_schluessel"),
    wetterOrtName: text("wetter_ort_name"),
    wetterOrtErgebnis: text("wetter_ort_ergebnis", {
      enum: ["gefunden", "nicht_gefunden", "mehrdeutig", "fehler"],
    }),
    wetterOrtVersuchAm: timestamp("wetter_ort_versuch_am", {
      withTimezone: true,
    }),
    // Dass das Medium zur Abteilung gehört und ein Bild ist, prüft die Route
    logoMediumId: uuid("logo_medium_id").references(() => medium.id, {
      onDelete: "set null",
    }),
    // Folgenummer des Lagers (#366): Stand der letzten Änderung. Wer schreibt, zählt sie unter der Zeilensperre dieser Zeile hoch (lager/sync.ts)
    seq: bigint("seq", { mode: "number" }).notNull().default(0),
    // Älteste Folgenummer, ab der der Änderungsfeed lückenlos ist; ein Client mit seit < seq_min - 1 bekommt 410 (der Aufräumjob hebt sie an)
    seqMin: bigint("seq_min", { mode: "number" }).notNull().default(1),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("lager_abteilung_id_idx").on(t.abteilungId, t.von),
    check("lager_seq_check", sql`${t.seq} >= 0 and ${t.seqMin} >= 1`),
    // text({ enum }) prüft nur in TypeScript, nicht in der Datenbank
    check(
      "lager_status_check",
      sql`${t.status} in ('entwurf', 'aktiv', 'abgeschlossen', 'archiviert')`,
    ),
    check(
      "lager_zeitraum_check",
      sql`${t.bis} >= ${t.von} and (${t.vorbereitungAb} is null or ${t.vorbereitungAb} <= ${t.von})`,
    ),
    check(
      "lager_karten_link_check",
      sql`${t.kartenLink} is null or (${t.kartenLink} ~ '^https://[^[:space:]]+$' and strpos(${t.kartenLink}, chr(92)) = 0 and char_length(${t.kartenLink}) <= 2048)`,
    ),
    check(
      "lager_ort_check",
      sql`(${t.breite} is null) = (${t.laenge} is null) and (${t.breite} is null or (${t.breite} between -90 and 90 and ${t.laenge} between -180 and 180))`,
    ),
    check(
      "lager_wetter_ort_ergebnis_check",
      sql`${t.wetterOrtErgebnis} is null or ${t.wetterOrtErgebnis} in ('gefunden', 'nicht_gefunden', 'mehrdeutig', 'fehler')`,
    ),
    check(
      "lager_farbe_check",
      sql`${t.farbe} is null or ${t.farbe} ~ '^#[0-9a-f]{6}$'`,
    ),
  ],
);

// Die Lager-Rolle einer Person; die Policy liest sie bei jeder Anfrage hier, nie aus Token oder Sitzung (lager/policy.ts). Dass die Person zur Abteilung des Lagers gehört, prüfen die Verwaltungsrouten; die Policy lädt das Lager ohnehin nur in der Abteilung der Sitzung, eine fremde Zeile gäbe nichts frei
export const lagerMitglied = pgTable(
  "lager_mitglied",
  {
    lagerId: uuid("lager_id")
      .notNull()
      .references(() => lager.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rolle: text("rolle", {
      enum: ["lagerleitung", "leitung", "team", "lesen"],
    }).notNull(),
    // Das Ressort der Person (#371); die API setzt es noch nicht (offen). Der Fremdschlüssel nimmt das Lager mit, damit es kein Ressort eines anderen Lagers sein kann
    ressortId: uuid("ressort_id"),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.lagerId, t.personId] }),
    index("lager_mitglied_person_id_idx").on(t.personId),
    // In der Migration ON DELETE SET NULL (ressort_id): Postgres 15 setzt nur die eine Spalte; drizzle kennt die Spaltenliste nicht
    foreignKey({
      name: "lager_mitglied_ressort_fk",
      columns: [t.lagerId, t.ressortId],
      foreignColumns: [ressort.lagerId, ressort.id],
    }).onDelete("set null"),
    check(
      "lager_mitglied_rolle_check",
      sql`${t.rolle} in ('lagerleitung', 'leitung', 'team', 'lesen')`,
    ),
  ],
);

// Gemeinsame Spalten jeder Lager-Tabelle mit Feed (#366). Jedes Modul schreibt pgTable("name", { ...lagerSpalten(), eigeneSpalten }) und beschreibt die Spalten in datenkategorien.ts mit LAGER_BASIS_SPALTEN. Verknüpfungen auf andere Zeilen nur als ID, nie als Anzeigename. Einen Index auf lager_id legt das Modul in seiner Tabelle an
// Geschrieben wird nur über lager/sync.ts: Es setzt version, lager_seq, geaendert_* und geloescht_*; ein eigenes UPDATE daran umginge den Feed
export function lagerSpalten() {
  return {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    lagerId: uuid("lager_id")
      .notNull()
      .references(() => lager.id, { onDelete: "cascade" }),
    // Zeilenversion: beginnt bei 1 und steigt bei jeder Änderung um 1
    version: integer("version").notNull().default(1),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
    erstelltVon: uuid("erstellt_von").references(() => user.id, {
      onDelete: "set null",
    }),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
    geaendertVon: uuid("geaendert_von").references(() => user.id, {
      onDelete: "set null",
    }),
    // Folgenummer des Lagers bei der letzten Änderung dieser Zeile
    lagerSeq: bigint("lager_seq", { mode: "number" }).notNull(),
  };
}

// Index des Änderungsfeeds (#366): eine Zeile je Schreibvorgang, ohne Inhalte. Der Feed sagt nur, welche Zeile (Tabelle und ID) in welcher Version neu, geändert oder gelöscht ist; den Inhalt holt die App über die Route des Moduls, wo die Rechte der Rolle gelten. «tabelle» ist der Tabellenname, zeile_id hat keinen Fremdschlüssel, weil sie auf viele Tabellen zeigt
export const lagerAenderung = pgTable(
  "lager_aenderung",
  {
    lagerId: uuid("lager_id")
      .notNull()
      .references(() => lager.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    tabelle: text("tabelle").notNull(),
    zeileId: uuid("zeile_id").notNull(),
    art: text("art", { enum: ["neu", "geaendert", "geloescht"] }).notNull(),
    version: integer("version").notNull(),
    // clock_timestamp() statt now(): Der Wert wächst mit seq, weil die Zeilensperre die Schreiber ordnet; der Aufräumjob entfernt so einen Anfang des Feeds
    zeitpunkt: timestamp("zeitpunkt", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    primaryKey({ columns: [t.lagerId, t.seq] }),
    index("lager_aenderung_zeitpunkt_idx").on(t.zeitpunkt),
    check(
      "lager_aenderung_seq_check",
      sql`${t.seq} >= 1 and ${t.version} >= 1`,
    ),
    check(
      "lager_aenderung_art_check",
      sql`${t.art} in ('neu', 'geaendert', 'geloescht')`,
    ),
  ],
);

// Einstellbare Rechte je Lager (#365): eine Zeile je Rolle und Recht, beim Anlegen des Lagers mit den Standardwerten des Katalogs geschrieben. Fehlt eine Zeile, gilt der Standard; ein unbekanntes Recht gilt als verboten (lager/policy.ts). Die Lagerleitung hat keine Zeilen: Sie hat immer alles und lässt sich nicht aussperren (der CHECK hält es auch ohne die Routen)
export const lagerRolleRecht = pgTable(
  "lager_rolle_recht",
  {
    lagerId: uuid("lager_id")
      .notNull()
      .references(() => lager.id, { onDelete: "cascade" }),
    rolle: text("rolle", { enum: ["leitung", "team", "lesen"] }).notNull(),
    recht: text("recht").notNull(),
    erlaubt: boolean("erlaubt").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.lagerId, t.rolle, t.recht] }),
    check(
      "lager_rolle_recht_rolle_check",
      sql`${t.rolle} in ('leitung', 'team', 'lesen')`,
    ),
  ],
);

// Benachrichtigungen des Lagers (#369): eine Zeile je Person, Art und Objekt, nur für die Glocke und den Deep Link. Kein Text und kein Inhalt: Die App liest das Objekt über seine eigene Route, die ihre Rechte prüft. Zeilen anderer Personen sind nie lesbar (Routen filtern auf person_id)
export const lagerBenachrichtigung = pgTable(
  "lager_benachrichtigung",
  {
    // UUIDv7 ordnet nach Zeit: Die ID ist der Cursor der Liste (wie bei den Chats)
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    lagerId: uuid("lager_id")
      .notNull()
      .references(() => lager.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Eine Art aus lager/benachrichtigung-arten.ts; ohne CHECK, damit eine neue Art keine Migration braucht
    art: text("art").notNull(),
    // Was die App öffnet, zum Beispiel «aufgabe»; ohne Fremdschlüssel, weil das Ziel in einer Tabelle des jeweiligen Moduls liegt
    objektTyp: text("objekt_typ").notNull(),
    objektId: uuid("objekt_id").notNull(),
    gelesenAm: timestamp("gelesen_am", { withTimezone: true }),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("lager_benachrichtigung_liste_idx").on(t.personId, t.lagerId, t.id),
    index("lager_benachrichtigung_objekt_idx").on(t.personId, t.objektId),
  ],
);

// Abgeschaltete Arten je Person, über alle Lager. Standard ist an; eine Zeile gibt es erst, wenn die Person einen Schalter bedient
export const lagerBenachrichtigungEinstellung = pgTable(
  "lager_benachrichtigung_einstellung",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    art: text("art").notNull(),
    aktiv: boolean("aktiv").notNull(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.art] })],
);

// Ergebnisse der Warteschlange für Offline-Änderungen (#367): eine Zeile je Operation, die eine Person mit ihrer clientOpId geschickt hat. Eine Wiederholung derselben clientOpId liefert das gespeicherte Ergebnis, statt noch einmal zu schreiben. Das Ergebnis trägt IDs und Versionen; bei einem Konflikt auch den Stand der Zeile in der Ansicht der Person. Der Eintrag entfällt nach 30 Tagen (lager/aufraeumen.ts)
export const lagerClientOp = pgTable(
  "lager_client_op",
  {
    lagerId: uuid("lager_id")
      .notNull()
      .references(() => lager.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientOpId: uuid("client_op_id").notNull(),
    ergebnis: jsonb("ergebnis"),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.lagerId, t.personId, t.clientOpId] }),
    index("lager_client_op_erstellt_am_idx").on(t.erstelltAm),
  ],
);

// Ressorts des Lagers (#371): Leitung und Stellvertretung sind Personen-IDs (Mitglieder des Lagers, die Route prüft es), nie Anzeigenamen; die API löst die Namen beim Lesen auf. parent_id baut den Baum (Unterressorts, ohne Zyklus, die Route prüft es). Geschrieben wird nur über lager/sync.ts. Das Kürzel ist je Lager eindeutig, solange das Ressort nicht gelöscht ist
export const ressort = pgTable(
  "ressort",
  {
    ...lagerSpalten(),
    kuerzel: text("kuerzel").notNull(),
    name: text("name").notNull(),
    leitungPersonId: uuid("leitung_person_id").references(() => user.id, {
      onDelete: "set null",
    }),
    stvPersonId: uuid("stv_person_id").references(() => user.id, {
      onDelete: "set null",
    }),
    notiz: text("notiz"),
    parentId: uuid("parent_id"),
    reihenfolge: integer("reihenfolge").notNull().default(0),
    // Ruhiges Ressort (#520): hat gerade nichts zu tun; die Apps blenden es aus oder zeigen es grau
    ruhig: boolean("ruhig").notNull().default(false),
  },
  (t) => [
    // Ziel der Fremdschlüssel mit Lager: ein Ressort, ein Unterressort, ein Link oder eine Notiz kann nie ein Ressort eines anderen Lagers meinen
    unique("ressort_lager_id_id_uq").on(t.lagerId, t.id),
    foreignKey({
      name: "ressort_parent_fk",
      columns: [t.lagerId, t.parentId],
      foreignColumns: [t.lagerId, t.id],
    }),
    index("ressort_liste_idx").on(t.lagerId, t.reihenfolge, t.id),
    index("ressort_parent_idx").on(t.lagerId, t.parentId),
    uniqueIndex("ressort_kuerzel_uq").on(t.lagerId, sql`lower(${t.kuerzel})`),
    check("ressort_eltern_check", sql`${t.parentId} is distinct from ${t.id}`),
    check(
      "ressort_text_check",
      sql`char_length(${t.kuerzel}) between 1 and 20 and char_length(${t.name}) between 1 and 100 and (${t.notiz} is null or char_length(${t.notiz}) <= 5000) and ${t.reihenfolge} >= 0`,
    ),
  ],
);

// Ein Link eines Ressorts (#371): nur https, der Server ruft ihn nie ab (SR-26)
export const ressortLink = pgTable(
  "ressort_link",
  {
    ...lagerSpalten(),
    ressortId: uuid("ressort_id").notNull(),
    titel: text("titel").notNull(),
    url: text("url").notNull(),
  },
  (t) => [
    foreignKey({
      name: "ressort_link_ressort_fk",
      columns: [t.lagerId, t.ressortId],
      foreignColumns: [ressort.lagerId, ressort.id],
    }).onDelete("cascade"),
    index("ressort_link_liste_idx").on(t.lagerId, t.ressortId, t.id),
    check(
      "ressort_link_check",
      sql`char_length(${t.titel}) between 1 and 200 and char_length(${t.url}) <= 2000 and ${t.url} ~ '^https://[^[:space:]]+$'`,
    ),
  ],
);

// Eine Notiz eines Ressorts (#371); wer sie geschrieben hat, steht in erstellt_von
export const ressortNotiz = pgTable(
  "ressort_notiz",
  {
    ...lagerSpalten(),
    ressortId: uuid("ressort_id").notNull(),
    text: text("text").notNull(),
  },
  (t) => [
    foreignKey({
      name: "ressort_notiz_ressort_fk",
      columns: [t.lagerId, t.ressortId],
      foreignColumns: [ressort.lagerId, ressort.id],
    }).onDelete("cascade"),
    index("ressort_notiz_liste_idx").on(t.lagerId, t.ressortId, t.id),
    check(
      "ressort_notiz_check",
      sql`char_length(${t.text}) between 1 and 10000`,
    ),
  ],
);

// Aufgaben des Lagers (#372). Die Verantwortliche ist eine Personen-ID eines Mitglieds dieses Lagers (zusammengesetzter Fremdschlüssel auf lager_mitglied: Wer das Mitglied entfernt, leert die Spalte). Ohne Verantwortliche gilt die Leitung des Ressorts als Verantwortliche; die API rechnet das beim Lesen aus, gespeichert wird es nicht (wechselt die Leitung, wechselt die Aufgabe mit). Geschrieben wird nur über lager/sync.ts
// erledigt_am gehört zum Status «erledigt» (CHECK): Der Server setzt und leert es, nie der Client. wiederholung, frist_erinnert_am und quelle füllen die Folge-Issues (#373, #374, #375, #376, #380); hier sind es nur Spalten
export const AUFGABE_STATUS = [
  "offen",
  "laeuft",
  "wartet",
  "erledigt",
  "naechster_hoeck",
] as const;
export type AufgabeStatus = (typeof AUFGABE_STATUS)[number];

export const aufgabe = pgTable(
  "aufgabe",
  {
    ...lagerSpalten(),
    titel: text("titel").notNull(),
    // Das Ressort muss zum selben Lager gehören (zusammengesetzter Fremdschlüssel); wird es endgültig gelöscht, bleibt die Aufgabe ohne Ressort
    ressortId: uuid("ressort_id"),
    // Teilbereich innerhalb des Ressorts, freier Text
    teil: text("teil"),
    verantwortlichPersonId: uuid("verantwortlich_person_id"),
    status: text("status", { enum: AUFGABE_STATUS }).notNull().default("offen"),
    notiz: text("notiz"),
    frist: date("frist"),
    stern: boolean("stern").notNull().default(false),
    laufend: boolean("laufend").notNull().default(false),
    // «Später erinnern»: ab diesem Tag taucht die Aufgabe wieder auf
    spaeterAb: date("spaeter_ab"),
    wiederholung: text("wiederholung", { enum: ["w1", "w2", "m1"] }),
    reihenfolge: integer("reihenfolge").notNull().default(0),
    quelle: text("quelle"),
    erledigtAm: timestamp("erledigt_am", { withTimezone: true }),
    fristErinnertAm: timestamp("frist_erinnert_am", { withTimezone: true }),
    // Relative Frist (#374): Die Frist ist das Datum des Meilensteins plus Versatz in Tagen; ohne Meilenstein ist der Beginn des Lagers die Bezugsgrösse. Beides null: absolute Frist. frist bleibt gespeichert (Listen, Filter und Erinnerung brauchen kein Rechnen); die Verschiebung eines Meilensteins schreibt sie neu
    fristMeilensteinId: uuid("frist_meilenstein_id"),
    fristVersatzTage: integer("frist_versatz_tage"),
  },
  (t) => [
    // Ziel des Fremdschlüssels der Unterstützung: eine Zeile dort kann nie eine Aufgabe eines anderen Lagers meinen
    unique("aufgabe_lager_id_id_uq").on(t.lagerId, t.id),
    // In der Migration ON DELETE SET NULL (ressort_id) beziehungsweise (verantwortlich_person_id): Postgres setzt nur die eine Spalte; drizzle kennt die Spaltenliste nicht
    foreignKey({
      name: "aufgabe_ressort_fk",
      columns: [t.lagerId, t.ressortId],
      foreignColumns: [ressort.lagerId, ressort.id],
    }).onDelete("set null"),
    foreignKey({
      name: "aufgabe_verantwortlich_fk",
      columns: [t.lagerId, t.verantwortlichPersonId],
      foreignColumns: [lagerMitglied.lagerId, lagerMitglied.personId],
    }).onDelete("set null"),
    // Die Listen der Routen: nach Reihenfolge, gefiltert nach Person, Status, Ressort oder Frist
    index("aufgabe_liste_idx").on(t.lagerId, t.reihenfolge, t.id),
    index("aufgabe_person_idx").on(t.lagerId, t.verantwortlichPersonId),
    index("aufgabe_status_idx").on(t.lagerId, t.status),
    index("aufgabe_ressort_idx").on(t.lagerId, t.ressortId),
    // In der Migration ohne ON DELETE (NO ACTION): Der Meilenstein verschwindet erst, wenn keine Aufgabe mehr auf ihn zeigt (lager/zeitplan.ts löst die Bezüge vorher). SET NULL liesse den Versatz stehen und die Frist stillschweigend auf den Lagerbeginn zeigen
    foreignKey({
      name: "aufgabe_frist_meilenstein_fk",
      columns: [t.lagerId, t.fristMeilensteinId],
      foreignColumns: [meilenstein.lagerId, meilenstein.id],
    }),
    index("aufgabe_frist_idx")
      .on(t.lagerId, t.frist)
      .where(sql`${t.frist} is not null`),
    // Der Erinnerungslauf (lager/fristen.ts) fragt über alle Lager nach Fristen der nächsten Tage: eine Abfrage über diesen Index
    index("aufgabe_erinnerung_idx")
      .on(t.frist)
      .where(sql`${t.frist} is not null and ${t.status} <> 'erledigt'`),
    index("aufgabe_frist_meilenstein_idx")
      .on(t.lagerId, t.fristMeilensteinId)
      .where(sql`${t.fristMeilensteinId} is not null`),
    check(
      "aufgabe_relative_frist_check",
      sql`(${t.fristMeilensteinId} is null or ${t.fristVersatzTage} is not null) and (${t.fristVersatzTage} is null or (${t.frist} is not null and ${t.fristVersatzTage} between -3650 and 3650))`,
    ),
    check(
      "aufgabe_status_check",
      sql`${t.status} in ('offen', 'laeuft', 'wartet', 'erledigt', 'naechster_hoeck')`,
    ),
    check(
      "aufgabe_wiederholung_check",
      sql`${t.wiederholung} is null or ${t.wiederholung} in ('w1', 'w2', 'm1')`,
    ),
    check(
      "aufgabe_erledigt_check",
      sql`(${t.status} = 'erledigt') = (${t.erledigtAm} is not null)`,
    ),
    check(
      "aufgabe_text_check",
      sql`char_length(${t.titel}) between 1 and 200 and (${t.teil} is null or char_length(${t.teil}) between 1 and 100) and (${t.notiz} is null or char_length(${t.notiz}) <= 5000) and (${t.quelle} is null or char_length(${t.quelle}) between 1 and 100) and ${t.reihenfolge} >= 0`,
    ),
  ],
);

// Zeitplan des Lagers (#374): Meilensteine, Lagertage und Tagesabschnitte sind Zeilen des Sync-Kerns (Version, Feed). Die Fremdschlüssel mit Lager sind das Ziel für Aufgaben (relative Frist), Anwesenheit und die späteren Module (Schichten, Tagesseiten): Sie können nie auf eine Zeile eines anderen Lagers zeigen
export const meilenstein = pgTable(
  "meilenstein",
  {
    ...lagerSpalten(),
    titel: text("titel").notNull(),
    datum: date("datum").notNull(),
    // Freie Bezeichnung der Art (die Werte stehen nicht fest), höchstens 50 Zeichen
    art: text("art"),
  },
  (t) => [
    unique("meilenstein_lager_id_id_uq").on(t.lagerId, t.id),
    index("meilenstein_liste_idx").on(t.lagerId, t.datum, t.id),
    check(
      "meilenstein_text_check",
      sql`char_length(${t.titel}) between 1 and 200 and (${t.art} is null or char_length(${t.art}) between 1 and 50)`,
    ),
  ],
);

// Ein Tag des Lagers (Datum, optional eine Bezeichnung); je Datum und Lager höchstens einer, solange er nicht gelöscht ist
export const lagertag = pgTable(
  "lagertag",
  {
    ...lagerSpalten(),
    datum: date("datum").notNull(),
    label: text("label"),
  },
  (t) => [
    unique("lagertag_lager_id_id_uq").on(t.lagerId, t.id),
    uniqueIndex("lagertag_datum_uq").on(t.lagerId, t.datum),
    check(
      "lagertag_label_check",
      sql`${t.label} is null or char_length(${t.label}) between 1 and 100`,
    ),
  ],
);

// Ein Abschnitt des Tages (zum Beispiel Vormittag, Nachmittag, Abend, Nacht), je Lager einstellbar. zeit ist der Beginn als «HH:MM» (freiwillig); die Reihenfolge ordnet die Abschnitte eines Tages
export const tagesabschnitt = pgTable(
  "tagesabschnitt",
  {
    ...lagerSpalten(),
    name: text("name").notNull(),
    zeit: text("zeit"),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [
    unique("tagesabschnitt_lager_id_id_uq").on(t.lagerId, t.id),
    uniqueIndex("tagesabschnitt_name_uq").on(t.lagerId, sql`lower(${t.name})`),
    index("tagesabschnitt_liste_idx").on(t.lagerId, t.reihenfolge, t.id),
    check(
      "tagesabschnitt_check",
      sql`char_length(${t.name}) between 1 and 50 and (${t.zeit} is null or ${t.zeit} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') and ${t.reihenfolge} >= 0`,
    ),
  ],
);

// Wer eine Aufgabe unterstützt (#372): eine Zeile je Person und Aufgabe, ohne Feed und Version (die Aufgabe zählt die Version hoch, wenn sich die Liste ändert). Die Person muss Mitglied des Lagers sein; entfernt die Leitung das Mitglied oder fällt die Aufgabe weg, geht die Zeile mit
export const aufgabeUnterstuetzung = pgTable(
  "aufgabe_unterstuetzung",
  {
    lagerId: uuid("lager_id").notNull(),
    aufgabeId: uuid("aufgabe_id").notNull(),
    personId: uuid("person_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.aufgabeId, t.personId] }),
    foreignKey({
      name: "aufgabe_unterstuetzung_aufgabe_fk",
      columns: [t.lagerId, t.aufgabeId],
      foreignColumns: [aufgabe.lagerId, aufgabe.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "aufgabe_unterstuetzung_mitglied_fk",
      columns: [t.lagerId, t.personId],
      foreignColumns: [lagerMitglied.lagerId, lagerMitglied.personId],
    }).onDelete("cascade"),
    index("aufgabe_unterstuetzung_person_idx").on(t.lagerId, t.personId),
  ],
);

// Ein Punkt der Checkliste einer Aufgabe (#373): eine Zeile je Punkt, damit zwei Personen nicht dieselbe Liste überschreiben. person_id ist, wer den Punkt abgehakt hat (der Server setzt und leert sie mit erledigt); verlässt die Person das Lager, bleibt der Punkt abgehakt ohne Person
export const aufgabeCheckpunkt = pgTable(
  "aufgabe_checkpunkt",
  {
    ...lagerSpalten(),
    aufgabeId: uuid("aufgabe_id").notNull(),
    text: text("text").notNull(),
    erledigt: boolean("erledigt").notNull().default(false),
    personId: uuid("person_id"),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: "aufgabe_checkpunkt_aufgabe_fk",
      columns: [t.lagerId, t.aufgabeId],
      foreignColumns: [aufgabe.lagerId, aufgabe.id],
    }).onDelete("cascade"),
    // In der Migration ON DELETE SET NULL (person_id): Postgres setzt nur die eine Spalte; drizzle kennt die Spaltenliste nicht
    foreignKey({
      name: "aufgabe_checkpunkt_person_fk",
      columns: [t.lagerId, t.personId],
      foreignColumns: [lagerMitglied.lagerId, lagerMitglied.personId],
    }).onDelete("set null"),
    index("aufgabe_checkpunkt_liste_idx").on(
      t.lagerId,
      t.aufgabeId,
      t.reihenfolge,
      t.id,
    ),
    check(
      "aufgabe_checkpunkt_check",
      sql`char_length(${t.text}) between 1 and 500 and ${t.reihenfolge} >= 0 and (${t.erledigt} or ${t.personId} is null)`,
    ),
  ],
);

// Ein Link einer Aufgabe (#373): nur https, der Server ruft ihn nie ab (SR-26)
export const aufgabeLink = pgTable(
  "aufgabe_link",
  {
    ...lagerSpalten(),
    aufgabeId: uuid("aufgabe_id").notNull(),
    titel: text("titel").notNull(),
    url: text("url").notNull(),
  },
  (t) => [
    foreignKey({
      name: "aufgabe_link_aufgabe_fk",
      columns: [t.lagerId, t.aufgabeId],
      foreignColumns: [aufgabe.lagerId, aufgabe.id],
    }).onDelete("cascade"),
    index("aufgabe_link_liste_idx").on(t.lagerId, t.aufgabeId, t.id),
    check(
      "aufgabe_link_check",
      sql`char_length(${t.titel}) between 1 and 200 and char_length(${t.url}) <= 2000 and ${t.url} ~ '^https://[^[:space:]]+$'`,
    ),
  ],
);

// Stichworte einer Aufgabe (#373): eine Zeile je Stichwort, ohne Feed und Version (die Aufgabe zählt die Version hoch, wenn sich die Liste ändert, wie bei der Unterstützung). Ein Stichwort gilt je Aufgabe einmal, ohne Rücksicht auf Gross- und Kleinschreibung
export const aufgabeStichwort = pgTable(
  "aufgabe_stichwort",
  {
    lagerId: uuid("lager_id").notNull(),
    aufgabeId: uuid("aufgabe_id").notNull(),
    stichwort: text("stichwort").notNull(),
  },
  (t) => [
    foreignKey({
      name: "aufgabe_stichwort_aufgabe_fk",
      columns: [t.lagerId, t.aufgabeId],
      foreignColumns: [aufgabe.lagerId, aufgabe.id],
    }).onDelete("cascade"),
    uniqueIndex("aufgabe_stichwort_uq").on(
      t.aufgabeId,
      sql`lower(${t.stichwort})`,
    ),
    index("aufgabe_stichwort_suche_idx").on(
      t.lagerId,
      sql`lower(${t.stichwort})`,
    ),
    check(
      "aufgabe_stichwort_check",
      sql`char_length(${t.stichwort}) between 1 and 40 and ${t.stichwort} = btrim(${t.stichwort})`,
    ),
  ],
);

// Höcks (#378): Sitzungstermine des Lagers. «team» ist für alle Mitglieder sichtbar (nur Datum, Zeit, Titel, Ort), «lagerleitung» nur für Rollen mit hoecks.lesen_alle. Die Zeit ist «HH:MM» in der Zeit des Lagers (ohne Zeitzone, ohne Ende); ohne Zeit ist der Höck ein Tag. gaeste: Namen von Gästen als Freitext, nur für Rollen mit hoecks.lesen_alle. protokoll_id: Verknüpfung auf das Protokoll (#379), bewusst ohne Fremdschlüssel; sie wird nur vom Server gesetzt (lager/protokolle.ts: Sitzungsprotokoll des Höcks), nie über die Höck-Route. Anwesende stehen in hoeck_anwesenheit
export const HOECK_ART = ["lagerleitung", "team"] as const;
export type HoeckArt = (typeof HOECK_ART)[number];

export const hoeck = pgTable(
  "hoeck",
  {
    ...lagerSpalten(),
    art: text("art", { enum: HOECK_ART }).notNull(),
    datum: date("datum").notNull(),
    zeit: text("zeit"),
    titel: text("titel").notNull(),
    ort: text("ort"),
    gaeste: text("gaeste"),
    protokollId: uuid("protokoll_id"),
  },
  (t) => [
    // Ziel der Fremdschlüssel von Traktandum und Anwesenheit: Ein Höck eines anderen Lagers ist nie gemeint
    unique("hoeck_lager_id_id_uq").on(t.lagerId, t.id),
    index("hoeck_liste_idx").on(t.lagerId, t.datum, t.id),
    check("hoeck_art_check", sql`${t.art} in ('lagerleitung', 'team')`),
    check(
      "hoeck_text_check",
      sql`char_length(${t.titel}) between 1 and 200 and (${t.zeit} is null or ${t.zeit} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') and (${t.ort} is null or char_length(${t.ort}) between 1 and 200) and (${t.gaeste} is null or char_length(${t.gaeste}) between 1 and 500)`,
    ),
  ],
);

// Wer beim Höck da war (#378): eine Zeile je Person und Höck, ohne Feed und Version (Haken im Höck-Modus). Nur Mitglieder des Lagers; entfernt die Verwaltung das Mitglied oder fällt der Höck weg, geht die Zeile mit
export const hoeckAnwesenheit = pgTable(
  "hoeck_anwesenheit",
  {
    lagerId: uuid("lager_id").notNull(),
    hoeckId: uuid("hoeck_id").notNull(),
    personId: uuid("person_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.hoeckId, t.personId] }),
    foreignKey({
      name: "hoeck_anwesenheit_hoeck_fk",
      columns: [t.lagerId, t.hoeckId],
      foreignColumns: [hoeck.lagerId, hoeck.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "hoeck_anwesenheit_mitglied_fk",
      columns: [t.lagerId, t.personId],
      foreignColumns: [lagerMitglied.lagerId, lagerMitglied.personId],
    }).onDelete("cascade"),
    index("hoeck_anwesenheit_person_idx").on(t.lagerId, t.personId),
  ],
);

// Traktanden (#378). Ohne Höck (hoeck_id leer) ist es ein Punkt für «den nächsten Höck». «text» sind die Notizen, «entscheid» der kurze Beschluss (die Entscheide-Sammlung liest ihn); das Protokoll liegt als Verknüpfung im SharePoint (#379). links: Liste von {titel, url}, nur https, der Server ruft sie nie ab (SR-26). aufgabe_id: Aufgabe, aus der der Punkt stammt oder auf die er zeigt; fällt die Aufgabe endgültig weg, bleibt das Traktandum ohne sie. Verantwortliche stehen in traktandum_verantwortlich
export const TRAKTANDUM_STATUS = ["offen", "besprochen"] as const;
export type TraktandumStatus = (typeof TRAKTANDUM_STATUS)[number];

export const traktandum = pgTable(
  "traktandum",
  {
    ...lagerSpalten(),
    hoeckId: uuid("hoeck_id"),
    titel: text("titel").notNull(),
    text: text("text"),
    entscheid: text("entscheid"),
    links: jsonb("links")
      .$type<{ titel: string; url: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    reihenfolge: integer("reihenfolge").notNull().default(0),
    aufgabeId: uuid("aufgabe_id"),
    status: text("status", { enum: TRAKTANDUM_STATUS })
      .notNull()
      .default("offen"),
    // Geplante Dauer in Minuten (#520), optional
    dauerMinuten: integer("dauer_minuten"),
  },
  (t) => [
    unique("traktandum_lager_id_id_uq").on(t.lagerId, t.id),
    // Höck weg: Traktanden weg (der Höck lässt sich über die API nur ohne Traktanden löschen)
    foreignKey({
      name: "traktandum_hoeck_fk",
      columns: [t.lagerId, t.hoeckId],
      foreignColumns: [hoeck.lagerId, hoeck.id],
    }).onDelete("cascade"),
    // In der Migration ON DELETE SET NULL (aufgabe_id): Postgres setzt nur die eine Spalte; drizzle kennt die Spaltenliste nicht
    foreignKey({
      name: "traktandum_aufgabe_fk",
      columns: [t.lagerId, t.aufgabeId],
      foreignColumns: [aufgabe.lagerId, aufgabe.id],
    }).onDelete("set null"),
    index("traktandum_liste_idx").on(t.lagerId, t.hoeckId, t.reihenfolge, t.id),
    index("traktandum_aufgabe_idx")
      .on(t.lagerId, t.aufgabeId)
      .where(sql`${t.aufgabeId} is not null`),
    check(
      "traktandum_status_check",
      sql`${t.status} in ('offen', 'besprochen')`,
    ),
    check(
      "traktandum_dauer_check",
      sql`${t.dauerMinuten} is null or ${t.dauerMinuten} between 1 and 600`,
    ),
    check(
      "traktandum_text_check",
      sql`char_length(${t.titel}) between 1 and 200 and (${t.text} is null or char_length(${t.text}) <= 5000) and (${t.entscheid} is null or char_length(${t.entscheid}) between 1 and 1000) and ${t.reihenfolge} >= 0 and jsonb_typeof(${t.links}) = 'array' and jsonb_array_length(${t.links}) <= 10`,
    ),
  ],
);

// Wer ein Traktandum vorbereitet oder vorträgt (#378): eine Zeile je Person und Traktandum, ohne Feed (das Traktandum zählt die Version hoch, wenn sich die Liste ändert). Nur Mitglieder des Lagers
export const traktandumVerantwortlich = pgTable(
  "traktandum_verantwortlich",
  {
    lagerId: uuid("lager_id").notNull(),
    traktandumId: uuid("traktandum_id").notNull(),
    personId: uuid("person_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.traktandumId, t.personId] }),
    foreignKey({
      name: "traktandum_verantwortlich_traktandum_fk",
      columns: [t.lagerId, t.traktandumId],
      foreignColumns: [traktandum.lagerId, traktandum.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "traktandum_verantwortlich_mitglied_fk",
      columns: [t.lagerId, t.personId],
      foreignColumns: [lagerMitglied.lagerId, lagerMitglied.personId],
    }).onDelete("cascade"),
    index("traktandum_verantwortlich_person_idx").on(t.lagerId, t.personId),
  ],
);

// Verknüpfung auf eine Datei im SharePoint der Abteilung (#370). Cevi OS speichert nur die Adresse, nie den Inhalt, und ruft sie nie ab (SR-26). Wer die Datei öffnen darf, regelt der Ablageort; in Cevi OS sieht den Eintrag, wer den verweisenden Datensatz lesen darf (lager/datei-verweise.ts). Hinzugefügt von = erstellt_von. Die CHECKs halten die Link-Prüfung (lager/datei.ts) auch ohne die Routen: nur https, begrenzte Länge
export const lagerDatei = pgTable(
  "lager_datei",
  {
    ...lagerSpalten(),
    anzeigename: text("anzeigename").notNull(),
    link: text("link").notNull(),
    // MIME-Typ, falls bekannt
    typ: text("typ"),
    // Bytes, falls bekannt
    groesse: bigint("groesse", { mode: "number" }),
  },
  (t) => [
    // Ziel des zusammengesetzten Fremdschlüssels von dokument (#396): ein Dokument kann nie auf eine Datei eines anderen Lagers zeigen
    unique("lager_datei_lager_id_id_uq").on(t.lagerId, t.id),
    index("lager_datei_lager_idx").on(t.lagerId),
    index("lager_datei_erstellt_idx").on(t.erstelltAm),
    check(
      "lager_datei_anzeigename_check",
      sql`char_length(${t.anzeigename}) between 1 and 200`,
    ),
    check(
      "lager_datei_link_check",
      sql`${t.link} ~ '^https://[^[:space:]]+$' and strpos(${t.link}, chr(92)) = 0 and char_length(${t.link}) <= 2048`,
    ),
    check(
      "lager_datei_typ_groesse_check",
      sql`(${t.typ} is null or char_length(${t.typ}) <= 100) and (${t.groesse} is null or ${t.groesse} >= 0)`,
    ),
  ],
);

// Anwesenheit im Lager (#390): eine Zeile je Person (Leitende: user.id) oder Teilnehmende (teilnehmer_id) und Abschnitt eines Lagertags, nur für A (anwesend) und F (abwesend); «O» (offen) heisst keine Zeile, eine Zeile mit O entsteht nur, wenn die Lagerleitung ein eingetragenes Feld wieder öffnet. Ein eingetragenes Feld (A oder F) ist für das Team gesperrt: Änderungen laufen über anwesenheit_anfrage. Lagertag und Abschnitt (#374) haben Fremdschlüssel mit Lager (Migration 0095), ebenso die Teilnehmenden (Migration 0103, anwesenheit_teilnehmer_fk): Sie gehen mit der endgültigen Löschung der Teilnehmenden mit. Geschrieben wird nur über lager/sync.ts
export const anwesenheit = pgTable(
  "anwesenheit",
  {
    ...lagerSpalten(),
    personId: uuid("person_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    teilnehmerId: uuid("teilnehmer_id"),
    lagertagId: uuid("lagertag_id").notNull(),
    tagesabschnittId: uuid("tagesabschnitt_id").notNull(),
    wert: text("wert", { enum: ["A", "F", "O"] }).notNull(),
  },
  (t) => [
    // Lagertag und Abschnitt gehören zum selben Lager (#374); fällt einer weg, gehen die Einträge dafür mit
    foreignKey({
      name: "anwesenheit_lagertag_fk",
      columns: [t.lagerId, t.lagertagId],
      foreignColumns: [lagertag.lagerId, lagertag.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "anwesenheit_abschnitt_fk",
      columns: [t.lagerId, t.tagesabschnittId],
      foreignColumns: [tagesabschnitt.lagerId, tagesabschnitt.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "anwesenheit_teilnehmer_fk",
      columns: [t.lagerId, t.teilnehmerId],
      foreignColumns: [teilnehmer.lagerId, teilnehmer.id],
    }).onDelete("cascade"),
    index("anwesenheit_abschnitt_idx").on(t.lagerId, t.tagesabschnittId),
    // Ein Feld gibt es je Person und Abschnitt einmal; eine gelöschte Zeile blockiert es nicht
    uniqueIndex("anwesenheit_person_uq")
      .on(t.lagerId, t.personId, t.lagertagId, t.tagesabschnittId)
      .where(sql`${t.personId} is not null`),
    uniqueIndex("anwesenheit_teilnehmer_uq")
      .on(t.lagerId, t.teilnehmerId, t.lagertagId, t.tagesabschnittId)
      .where(sql`${t.teilnehmerId} is not null`),
    // Die Matrix eines Zeitraums (ein Abruf je Lager und Lagertage), nach ID seitenweise
    index("anwesenheit_tag_idx").on(t.lagerId, t.lagertagId, t.id),
    check("anwesenheit_wert_check", sql`${t.wert} in ('A', 'F', 'O')`),
    check(
      "anwesenheit_anwesende_check",
      sql`num_nonnulls(${t.personId}, ${t.teilnehmerId}) = 1`,
    ),
  ],
);

// Anfrage des Teams, ein eingetragenes Feld zu ändern, oder ein Feld nach der Frist zu setzen (#390). Die Lagerleitung nimmt sie an (die Anwesenheit ändert sich) oder lehnt sie ab. Eine offene Anfrage je Person und Feld
export const anwesenheitAnfrage = pgTable(
  "anwesenheit_anfrage",
  {
    ...lagerSpalten(),
    personId: uuid("person_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lagertagId: uuid("lagertag_id").notNull(),
    tagesabschnittId: uuid("tagesabschnitt_id").notNull(),
    wert: text("wert", { enum: ["A", "F", "O"] }).notNull(),
    notiz: text("notiz"),
    status: text("status", { enum: ["offen", "angenommen", "abgelehnt"] })
      .notNull()
      .default("offen"),
    entschiedenVon: uuid("entschieden_von").references(() => user.id, {
      onDelete: "set null",
    }),
    entschiedenAm: timestamp("entschieden_am", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "anwesenheit_anfrage_lagertag_fk",
      columns: [t.lagerId, t.lagertagId],
      foreignColumns: [lagertag.lagerId, lagertag.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "anwesenheit_anfrage_abschnitt_fk",
      columns: [t.lagerId, t.tagesabschnittId],
      foreignColumns: [tagesabschnitt.lagerId, tagesabschnitt.id],
    }).onDelete("cascade"),
    uniqueIndex("anwesenheit_anfrage_offen_uq")
      .on(t.lagerId, t.personId, t.lagertagId, t.tagesabschnittId)
      .where(sql`${t.status} = 'offen'`),
    index("anwesenheit_anfrage_liste_idx").on(t.lagerId, t.status, t.id),
    index("anwesenheit_anfrage_person_idx").on(t.lagerId, t.personId, t.id),
    check("anwesenheit_anfrage_wert_check", sql`${t.wert} in ('A', 'F', 'O')`),
    check(
      "anwesenheit_anfrage_status_check",
      sql`${t.status} in ('offen', 'angenommen', 'abgelehnt') and (${t.status} = 'offen') = (${t.entschiedenAm} is null)`,
    ),
    check(
      "anwesenheit_anfrage_notiz_check",
      sql`${t.notiz} is null or char_length(${t.notiz}) between 1 and 500`,
    ),
  ],
);

// Pinnwand des Lagers (#381). Ein Beitrag hat Titel, Text, die Kennzeichen «wichtig» und «angeheftet» und ein Zeitfenster (sichtbar_ab, sichtbar_bis; leer = unbegrenzt). Wer ihn geschrieben hat, steht in erstellt_von. Die Zeitfenster wertet die Abfrage aus, es gibt keinen Job. Geschrieben wird nur über lager/sync.ts
export const pinnwandBeitrag = pgTable(
  "pinnwand_beitrag",
  {
    ...lagerSpalten(),
    titel: text("titel").notNull(),
    text: text("text").notNull().default(""),
    wichtig: boolean("wichtig").notNull().default(false),
    angeheftet: boolean("angeheftet").notNull().default(false),
    sichtbarAb: timestamp("sichtbar_ab", { withTimezone: true }),
    sichtbarBis: timestamp("sichtbar_bis", { withTimezone: true }),
  },
  (t) => [
    // Ziel der Fremdschlüssel mit Lager: Empfänger und Datei eines Beitrags können nie zu einem Beitrag eines anderen Lagers gehören
    unique("pinnwand_beitrag_lager_id_id_uq").on(t.lagerId, t.id),
    index("pinnwand_beitrag_lager_idx").on(t.lagerId),
    check(
      "pinnwand_beitrag_check",
      sql`char_length(${t.titel}) between 1 and 200 and char_length(${t.text}) <= 10000 and (${t.sichtbarAb} is null or ${t.sichtbarBis} is null or ${t.sichtbarBis} > ${t.sichtbarAb})`,
    ),
  ],
);

// Teilnehmende des Lagers (#384): nur Name und Stufe, bewusst keine Gesundheitsdaten, kein Telefon und keine Adresse (Test in lager/teilnehmer.test.ts hält die Spaltenliste fest). cevi_name ist der Anzeigename für Aushänge (Cevi-Name, sonst Vorname). kind_id verknüpft mit dem Kind, wenn Vor- und Nachname zu genau einem Kind der Abteilung passen (lager/teilnehmer.ts, nie geraten); löscht die Verwaltung das Kind, gehen die Teilnehmenden mit (#779, ON DELETE CASCADE). anmeldung_id ist die spätere Verknüpfung zur Anlass-Anmeldung, ohne Fremdschlüssel, bis der Auftrag Termine die Anmeldung anlegt; beide sind über die API nicht setzbar. Geschrieben wird nur über lager/sync.ts. Nach dem Lager löscht ein täglicher Lauf die Zeilen (lager/teilnehmer.ts)
export const teilnehmer = pgTable(
  "teilnehmer",
  {
    ...lagerSpalten(),
    kindId: uuid("kind_id").references(() => kind.id, {
      onDelete: "cascade",
    }),
    anmeldungId: uuid("anmeldung_id"),
    vorname: text("vorname").notNull(),
    nachname: text("nachname").notNull(),
    ceviName: text("cevi_name"),
    stufe: text("stufe"),
    // «Nicht dabei» (#387): Wer abgewählt ist, erscheint weder in der Einteilung noch beim Mischen und lässt sich wieder zuwählen; die Zeile bleibt, bis die Lagerleitung sie löscht
    abgewaehlt: boolean("abgewaehlt").notNull().default(false),
  },
  (t) => [
    // Ziel des Fremdschlüssels von abzaehlen: Ein Eintrag kann nie ein Kind eines anderen Lagers meinen
    unique("teilnehmer_lager_id_id_uq").on(t.lagerId, t.id),
    // Die Liste: sortiert nach Name, mit Seitenwechsel über (nachname, vorname, id)
    index("teilnehmer_liste_idx").on(t.lagerId, t.nachname, t.vorname, t.id),
    // Löschen eines Kindes (#779): die Teilnehmenden des Kindes finden
    index("teilnehmer_kind_idx")
      .on(t.kindId)
      .where(sql`${t.kindId} is not null`),
    check(
      "teilnehmer_text_check",
      sql`char_length(${t.vorname}) between 1 and 100 and char_length(${t.nachname}) between 1 and 100 and (${t.ceviName} is null or char_length(${t.ceviName}) between 1 and 50) and (${t.stufe} is null or char_length(${t.stufe}) between 1 and 50)`,
    ),
  ],
);

// Empfänger eines Beitrags: eine Rolle, eine Person, ein Ressort oder eine Gruppe je Zeile (#520; Ressort und Gruppe ohne Fremdschlüssel, damit ein gelöschtes Ziel den Beitrag nie für alle öffnet, Migration 0107). Ohne Zeile gilt der Beitrag für alle Mitglieder. Keine eigenen Feed-Spalten: Die Empfänger gehören zum Beitrag und werden mit ihm gesetzt (die Version des Beitrags steigt dabei)
export const pinnwandEmpfaenger = pgTable(
  "pinnwand_empfaenger",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    lagerId: uuid("lager_id")
      .notNull()
      .references(() => lager.id, { onDelete: "cascade" }),
    beitragId: uuid("beitrag_id").notNull(),
    rolle: text("rolle", { enum: ["leitung", "team", "lesen"] }),
    personId: uuid("person_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    ressortId: uuid("ressort_id"),
    gruppeId: uuid("gruppe_id"),
  },
  (t) => [
    foreignKey({
      name: "pinnwand_empfaenger_beitrag_fk",
      columns: [t.lagerId, t.beitragId],
      foreignColumns: [pinnwandBeitrag.lagerId, pinnwandBeitrag.id],
    }).onDelete("cascade"),
    uniqueIndex("pinnwand_empfaenger_rolle_uq")
      .on(t.beitragId, t.rolle)
      .where(sql`${t.rolle} is not null`),
    uniqueIndex("pinnwand_empfaenger_person_uq")
      .on(t.beitragId, t.personId)
      .where(sql`${t.personId} is not null`),
    uniqueIndex("pinnwand_empfaenger_ressort_uq")
      .on(t.beitragId, t.ressortId)
      .where(sql`${t.ressortId} is not null`),
    uniqueIndex("pinnwand_empfaenger_gruppe_uq")
      .on(t.beitragId, t.gruppeId)
      .where(sql`${t.gruppeId} is not null`),
    check(
      "pinnwand_empfaenger_check",
      sql`((case when ${t.rolle} is null then 0 else 1 end) + (case when ${t.personId} is null then 0 else 1 end) + (case when ${t.ressortId} is null then 0 else 1 end) + (case when ${t.gruppeId} is null then 0 else 1 end)) = 1 and (${t.rolle} is null or ${t.rolle} in ('leitung', 'team', 'lesen'))`,
    ),
  ],
);

// Wer einen Beitrag geöffnet hat (#520): eine Zeile je Beitrag und Person, Zeitpunkt des ersten Öffnens. Kein Sync-Kern, kein Feed. Die Zeile geht mit dem Beitrag und mit dem Konto
export const pinnwandGesehen = pgTable(
  "pinnwand_gesehen",
  {
    lagerId: uuid("lager_id").notNull(),
    beitragId: uuid("beitrag_id").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    gesehenAm: timestamp("gesehen_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.beitragId, t.personId] }),
    foreignKey({
      name: "pinnwand_gesehen_beitrag_fk",
      columns: [t.lagerId, t.beitragId],
      foreignColumns: [pinnwandBeitrag.lagerId, pinnwandBeitrag.id],
    }).onDelete("cascade"),
    index("pinnwand_gesehen_person_idx").on(t.personId),
  ],
);

// Eine Datei am Beitrag: Verweis auf lager_datei (#370, eine Verknüpfung auf den SharePoint, kein Upload). Wer die Datei sieht, bestimmt der Beitrag (lager/pinnwand.ts meldet den Verweis an). ON DELETE RESTRICT: Eine eingebundene Datei entfernt der Aufräumlauf nie
export const pinnwandDatei = pgTable(
  "pinnwand_datei",
  {
    ...lagerSpalten(),
    beitragId: uuid("beitrag_id").notNull(),
    dateiId: uuid("datei_id")
      .notNull()
      .references(() => lagerDatei.id, { onDelete: "restrict" }),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: "pinnwand_datei_beitrag_fk",
      columns: [t.lagerId, t.beitragId],
      foreignColumns: [pinnwandBeitrag.lagerId, pinnwandBeitrag.id],
    }).onDelete("cascade"),
    index("pinnwand_datei_beitrag_idx").on(t.beitragId),
    index("pinnwand_datei_datei_idx").on(t.dateiId),
    uniqueIndex("pinnwand_datei_uq").on(t.beitragId, t.dateiId),
    check("pinnwand_datei_check", sql`${t.reihenfolge} >= 0`),
  ],
);

// Umfrage an einem Beitrag (#382): höchstens eine je Beitrag. Die Frage ist der Titel des Beitrags. mehrfach: mehrere Stimmen je Person erlaubt. Geschlossen ist sie mit geschlossen = true oder ab schliesst_am (die Abfrage wertet es aus, kein Job). namen_fuer_team: Annahme (offene Frage «Wer sieht die Namen?»): Vorgabe false, dann sehen nur Rollen mit pinnwand.bearbeiten die Namen der Stimmen, alle anderen nur Zahlen; true zeigt die Namen allen, die den Beitrag lesen
export const umfrage = pgTable(
  "umfrage",
  {
    ...lagerSpalten(),
    beitragId: uuid("beitrag_id").notNull(),
    mehrfach: boolean("mehrfach").notNull().default(false),
    schliesstAm: timestamp("schliesst_am", { withTimezone: true }),
    geschlossen: boolean("geschlossen").notNull().default(false),
    namenFuerTeam: boolean("namen_fuer_team").notNull().default(false),
  },
  (t) => [
    // Ziel der Fremdschlüssel mit Lager: Option und Stimme können nie zu einer Umfrage eines anderen Lagers gehören
    unique("umfrage_lager_id_id_uq").on(t.lagerId, t.id),
    foreignKey({
      name: "umfrage_beitrag_fk",
      columns: [t.lagerId, t.beitragId],
      foreignColumns: [pinnwandBeitrag.lagerId, pinnwandBeitrag.id],
    }).onDelete("cascade"),
    uniqueIndex("umfrage_beitrag_uq").on(t.beitragId),
  ],
);

// Antwortmöglichkeit einer Umfrage; nach dem Anlegen unveränderlich (Stimmen hängen daran)
export const umfrageOption = pgTable(
  "umfrage_option",
  {
    ...lagerSpalten(),
    umfrageId: uuid("umfrage_id").notNull(),
    text: text("text").notNull(),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [
    unique("umfrage_option_lager_id_id_uq").on(t.lagerId, t.id),
    foreignKey({
      name: "umfrage_option_umfrage_fk",
      columns: [t.lagerId, t.umfrageId],
      foreignColumns: [umfrage.lagerId, umfrage.id],
    }).onDelete("cascade"),
    index("umfrage_option_umfrage_idx").on(t.umfrageId),
    check(
      "umfrage_option_check",
      sql`char_length(${t.text}) between 1 and 200 and ${t.reihenfolge} >= 0`,
    ),
  ],
);

// Eine Stimme: eine Zeile je Person und Option, damit sich Stimmen nie überschreiben. Gehört der Person (person_id); die Route setzt nur die eigene. Zurückgezogen = gelöscht (endgültig, #427)
export const umfrageStimme = pgTable(
  "umfrage_stimme",
  {
    ...lagerSpalten(),
    umfrageId: uuid("umfrage_id").notNull(),
    optionId: uuid("option_id").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    foreignKey({
      name: "umfrage_stimme_umfrage_fk",
      columns: [t.lagerId, t.umfrageId],
      foreignColumns: [umfrage.lagerId, umfrage.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "umfrage_stimme_option_fk",
      columns: [t.lagerId, t.optionId],
      foreignColumns: [umfrageOption.lagerId, umfrageOption.id],
    }).onDelete("cascade"),
    uniqueIndex("umfrage_stimme_uq").on(t.optionId, t.personId),
    index("umfrage_stimme_umfrage_idx").on(t.umfrageId),
  ],
);

// Reaktion einer Person auf ein Ziel (#382): ein Emoji je Person und Ziel. ziel_typ kommt aus einer Allowlist (heute nur der Pinnwand-Beitrag), emoji ist ein fester Schlüssel statt eines Zeichens: Der Server speichert nie Emoji-Zeichen, die App ordnet die Schlüssel ihren Symbolen zu. ziel_id hat keinen Fremdschlüssel (das Ziel hängt vom Typ ab); die Route prüft Lager und Lesbarkeit des Ziels
export const reaktion = pgTable(
  "reaktion",
  {
    ...lagerSpalten(),
    zielTyp: text("ziel_typ", { enum: ["pinnwand_beitrag"] }).notNull(),
    zielId: uuid("ziel_id").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    emoji: text("emoji", {
      enum: ["daumen", "herz", "lachen", "staunen", "danke"],
    }).notNull(),
  },
  (t) => [
    uniqueIndex("reaktion_uq").on(t.zielTyp, t.zielId, t.personId),
    index("reaktion_ziel_idx").on(t.zielTyp, t.zielId),
    check(
      "reaktion_check",
      sql`${t.zielTyp} in ('pinnwand_beitrag') and ${t.emoji} in ('daumen', 'herz', 'lachen', 'staunen', 'danke')`,
    ),
  ],
);

// Eingang für Ideen, Wünsche, Fragen und Feedback an die Lagerleitung (#383). Bewusst ohne lagerSpalten(): Der Sync-Kern schriebe erstellt_von, einen genauen Zeitpunkt und eine lager_seq, die neben anderen Einträgen derselben Sekunde stünde, und der Feed liesse die Meldung einer Person zuordnen. Darum gibt es hier
//   - keine Zeit ausser dem Tag (erstellt_tag, beantwortet_tag) und keine uuidv7 (die ID ordnet nicht nach Zeit),
//   - keinen Feed, keine Revision, keinen Verlauf und kein Audit für diese Tabelle,
//   - bei einer anonymen Meldung (anonym) keine Person: person_id ist leer, der Check hält es in der Datenbank fest. Statt dessen steht ein Hash des Rückfragecodes (rueckfragecode_hash), mit dem die meldende Person die Antwort liest; der Code selbst wird nie gespeichert und hat 100 Bit, ein unsalzter SHA-256 genügt.
// Eine nicht anonyme Meldung (person_id) darf die Person selbst lesen und die Lagerleitung sehen. ressort_id und traktandum_id setzt die Lagerleitung; fällt das Ressort oder das Traktandum weg, bleibt die Meldung ohne sie. Kein Feld für Gesundheitsdaten
export const EINGANG_ARTEN = ["idee", "wunsch", "frage", "feedback"] as const;
export const EINGANG_STATUS = ["neu", "in_arbeit", "erledigt"] as const;

export const eingang = pgTable(
  "eingang",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    lagerId: uuid("lager_id")
      .notNull()
      .references(() => lager.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    art: text("art", { enum: EINGANG_ARTEN }).notNull(),
    text: text("text").notNull(),
    anonym: boolean("anonym").notNull(),
    personId: uuid("person_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    rueckfragecodeHash: text("rueckfragecode_hash"),
    erstelltTag: date("erstellt_tag", { mode: "string" })
      .notNull()
      .default(sql`current_date`),
    status: text("status", { enum: EINGANG_STATUS }).notNull().default("neu"),
    antwort: text("antwort"),
    beantwortetTag: date("beantwortet_tag", { mode: "string" }),
    ressortId: uuid("ressort_id"),
    traktandumId: uuid("traktandum_id"),
  },
  (t) => [
    // In der Migration ON DELETE SET NULL (spalte): Postgres setzt nur die eine Spalte; drizzle kennt die Spaltenliste nicht
    foreignKey({
      name: "eingang_ressort_fk",
      columns: [t.lagerId, t.ressortId],
      foreignColumns: [ressort.lagerId, ressort.id],
    }).onDelete("set null"),
    foreignKey({
      name: "eingang_traktandum_fk",
      columns: [t.lagerId, t.traktandumId],
      foreignColumns: [traktandum.lagerId, traktandum.id],
    }).onDelete("set null"),
    index("eingang_liste_idx").on(t.lagerId, t.erstelltTag, t.id),
    index("eingang_person_idx")
      .on(t.lagerId, t.personId)
      .where(sql`${t.personId} is not null`),
    uniqueIndex("eingang_code_uq")
      .on(t.rueckfragecodeHash)
      .where(sql`${t.rueckfragecodeHash} is not null`),
    check(
      "eingang_check",
      sql`${t.art} in ('idee', 'wunsch', 'frage', 'feedback') and ${t.status} in ('neu', 'in_arbeit', 'erledigt') and char_length(${t.text}) between 1 and 5000 and (${t.antwort} is null or char_length(${t.antwort}) between 1 and 5000) and (${t.antwort} is null) = (${t.beantwortetTag} is null)`,
    ),
    // Anonym: keine Person, dafür der Hash; sonst die Person und kein Hash
    check(
      "eingang_anonym_check",
      sql`(${t.anonym} and ${t.personId} is null and ${t.rueckfragecodeHash} is not null) or (not ${t.anonym} and ${t.personId} is not null and ${t.rueckfragecodeHash} is null)`,
    ),
  ],
);

// Abzählen (#384): ein Haken je Teilnehmende oder Person des Lagers (Team), eine Zeile entsteht beim ersten Abhaken. Genau eines von teilnehmer_id und person_id; geprueft_am ist gesetzt, wenn geprueft gilt. Die Teilnehmerzeilen gehen mit der Löschung der Teilnehmenden
export const abzaehlen = pgTable(
  "abzaehlen",
  {
    ...lagerSpalten(),
    teilnehmerId: uuid("teilnehmer_id"),
    personId: uuid("person_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    geprueft: boolean("geprueft").notNull().default(false),
    geprueftAm: timestamp("geprueft_am", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "abzaehlen_teilnehmer_fk",
      columns: [t.lagerId, t.teilnehmerId],
      foreignColumns: [teilnehmer.lagerId, teilnehmer.id],
    }).onDelete("cascade"),
    uniqueIndex("abzaehlen_teilnehmer_uq")
      .on(t.lagerId, t.teilnehmerId)
      .where(sql`${t.teilnehmerId} is not null`),
    uniqueIndex("abzaehlen_person_uq")
      .on(t.lagerId, t.personId)
      .where(sql`${t.personId} is not null`),
    check(
      "abzaehlen_ziel_check",
      sql`(${t.teilnehmerId} is null) <> (${t.personId} is null) and ${t.geprueft} = (${t.geprueftAm} is not null)`,
    ),
  ],
);

// Programmgruppen des Lagers (#387): Name und Reihenfolge; wer dazugehört, steht in gruppe_zuordnung. Geschrieben wird nur über lager/sync.ts
export const gruppe = pgTable(
  "gruppe",
  {
    ...lagerSpalten(),
    name: text("name").notNull(),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [
    // Ziel des Fremdschlüssels von gruppe_zuordnung: Eine Zuordnung kann nie eine Gruppe eines anderen Lagers meinen
    unique("gruppe_lager_id_id_uq").on(t.lagerId, t.id),
    index("gruppe_liste_idx").on(t.lagerId, t.reihenfolge, t.name, t.id),
    check(
      "gruppe_check",
      sql`char_length(${t.name}) between 1 and 100 and ${t.reihenfolge} >= 0`,
    ),
  ],
);

// Wer in welcher Gruppe ist (#387): genau eines von teilnehmer_id (Teilnehmende, immer «mitglied») und person_id (Mitglied des Lagers, «leitung» oder «mitglied»). Eine Person und ein Teilnehmender stehen höchstens in einer Gruppe (Teilindex ohne gelöschte Zeilen). Die Zeilen gehen mit der Gruppe, den Teilnehmenden und dem Konto
export const gruppeZuordnung = pgTable(
  "gruppe_zuordnung",
  {
    ...lagerSpalten(),
    gruppeId: uuid("gruppe_id").notNull(),
    teilnehmerId: uuid("teilnehmer_id"),
    personId: uuid("person_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    rolle: text("rolle", { enum: ["leitung", "mitglied"] })
      .notNull()
      .default("mitglied"),
  },
  (t) => [
    foreignKey({
      name: "gruppe_zuordnung_gruppe_fk",
      columns: [t.lagerId, t.gruppeId],
      foreignColumns: [gruppe.lagerId, gruppe.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "gruppe_zuordnung_teilnehmer_fk",
      columns: [t.lagerId, t.teilnehmerId],
      foreignColumns: [teilnehmer.lagerId, teilnehmer.id],
    }).onDelete("cascade"),
    index("gruppe_zuordnung_gruppe_idx").on(t.gruppeId),
    uniqueIndex("gruppe_zuordnung_teilnehmer_uq")
      .on(t.lagerId, t.teilnehmerId)
      .where(sql`${t.teilnehmerId} is not null`),
    uniqueIndex("gruppe_zuordnung_person_uq")
      .on(t.lagerId, t.personId)
      .where(sql`${t.personId} is not null`),
    check(
      "gruppe_zuordnung_check",
      sql`(${t.teilnehmerId} is null) <> (${t.personId} is null) and ${t.rolle} in ('leitung', 'mitglied') and (${t.teilnehmerId} is null or ${t.rolle} = 'mitglied')`,
    ),
  ],
);

// Zimmer und Zelte des Lagers (#385): Name, Art, Plätze und eine Notiz. Die Belegung ist keine Spalte, sie ergibt sich aus zimmer_zuordnung (eine Abfrage mit GROUP BY); mehr Zuordnungen als Plätze sind erlaubt und nur eine Warnung (ueberbelegt). Geschrieben wird nur über lager/sync.ts
export const zimmer = pgTable(
  "zimmer",
  {
    ...lagerSpalten(),
    name: text("name").notNull(),
    art: text("art", { enum: ["zimmer", "zelt"] }).notNull(),
    plaetze: integer("plaetze").notNull(),
    notiz: text("notiz"),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [
    // Ziel des Fremdschlüssels von zimmer_zuordnung: Eine Zuordnung kann nie ein Zimmer eines anderen Lagers meinen
    unique("zimmer_lager_id_id_uq").on(t.lagerId, t.id),
    index("zimmer_liste_idx").on(t.lagerId, t.reihenfolge, t.name, t.id),
    check("zimmer_art_check", sql`${t.art} in ('zimmer', 'zelt')`),
    check(
      "zimmer_check",
      sql`char_length(${t.name}) between 1 and 100 and ${t.plaetze} between 1 and 1000 and (${t.notiz} is null or char_length(${t.notiz}) between 1 and 500) and ${t.reihenfolge} between 0 and 100000`,
    ),
  ],
);

// Wer in welchem Zimmer liegt: eine Zeile je Teilnehmende (teilnehmer_id) oder Mitglied des Lagers (person_id), genau eines von beiden. Höchstens ein Zimmer je Person oder Teilnehmende, solange die Zeile nicht gelöscht ist (eindeutiger Index). Die Zeilen der Teilnehmenden und des Zimmers gehen mit diesen (CASCADE)
export const zimmerZuordnung = pgTable(
  "zimmer_zuordnung",
  {
    ...lagerSpalten(),
    zimmerId: uuid("zimmer_id").notNull(),
    teilnehmerId: uuid("teilnehmer_id"),
    personId: uuid("person_id").references(() => user.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    foreignKey({
      name: "zimmer_zuordnung_zimmer_fk",
      columns: [t.lagerId, t.zimmerId],
      foreignColumns: [zimmer.lagerId, zimmer.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "zimmer_zuordnung_teilnehmer_fk",
      columns: [t.lagerId, t.teilnehmerId],
      foreignColumns: [teilnehmer.lagerId, teilnehmer.id],
    }).onDelete("cascade"),
    index("zimmer_zuordnung_zimmer_idx").on(t.zimmerId),
    uniqueIndex("zimmer_zuordnung_teilnehmer_uq")
      .on(t.lagerId, t.teilnehmerId)
      .where(sql`${t.teilnehmerId} is not null`),
    uniqueIndex("zimmer_zuordnung_person_uq")
      .on(t.lagerId, t.personId)
      .where(sql`${t.personId} is not null`),
    check(
      "zimmer_zuordnung_ziel_check",
      sql`(${t.teilnehmerId} is null) <> (${t.personId} is null)`,
    ),
  ],
);

// Packliste der Lagerleitung (#393): die Vorlage des Lagers, Abschnitt und Punkt. Jede Person hat eine eigene Kopie, aber nicht als Kopie in der Datenbank: packliste_abhaken hält nur die Abweichungen je Person (abgehakt, entfernt), packliste_eigen die eigenen Punkte. Geschrieben wird nur über lager/sync.ts. Mit nur_lagerleitung liest den Punkt nur, wer vertrauliches.lesen hat
export const packlistePunkt = pgTable(
  "packliste_punkt",
  {
    ...lagerSpalten(),
    abschnitt: text("abschnitt").notNull(),
    text: text("text").notNull(),
    nurLagerleitung: boolean("nur_lagerleitung").notNull().default(false),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [
    // Ziel des Fremdschlüssels mit Lager: Eine Abweichung kann nie einen Punkt eines anderen Lagers meinen
    unique("packliste_punkt_lager_id_id_uq").on(t.lagerId, t.id),
    index("packliste_punkt_liste_idx").on(t.lagerId, t.reihenfolge, t.id),
    check(
      "packliste_punkt_text_check",
      sql`char_length(${t.abschnitt}) between 1 and 100 and char_length(${t.text}) between 1 and 300 and ${t.reihenfolge} >= 0`,
    ),
  ],
);

// Die Abweichung einer Person von der Vorlage: eine Zeile nur für einen abgehakten oder entfernten Punkt, «offen» ist der Normalfall und hat keine Zeile. Persönlich und ohne Feed (der Zeilenfilter des Feeds kennt die Person nicht): Nur die Person liest und schreibt sie, ein Aufruf wiederholt dasselbe Ergebnis. Fällt mit dem Konto, dem Lager und dem Punkt weg
export const packlisteAbhaken = pgTable(
  "packliste_abhaken",
  {
    lagerId: uuid("lager_id")
      .notNull()
      .references(() => lager.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    punktId: uuid("punkt_id").notNull(),
    zustand: text("zustand", { enum: ["abgehakt", "entfernt"] }).notNull(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.punktId] }),
    foreignKey({
      name: "packliste_abhaken_punkt_fk",
      columns: [t.lagerId, t.punktId],
      foreignColumns: [packlistePunkt.lagerId, packlistePunkt.id],
    }).onDelete("cascade"),
    index("packliste_abhaken_punkt_idx").on(t.lagerId, t.punktId),
    check(
      "packliste_abhaken_zustand_check",
      sql`${t.zustand} in ('abgehakt', 'entfernt')`,
    ),
  ],
);

// Eigene Punkte einer Person (#393): nur für sie sichtbar, auch die Lagerleitung liest sie nicht. Persönlich und ohne Feed wie packliste_abhaken; löschen entfernt die Zeile, weil niemand sonst auf sie zeigt
export const packlisteEigen = pgTable(
  "packliste_eigen",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    lagerId: uuid("lager_id")
      .notNull()
      .references(() => lager.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    abschnitt: text("abschnitt").notNull(),
    text: text("text").notNull(),
    abgehakt: boolean("abgehakt").notNull().default(false),
    reihenfolge: integer("reihenfolge").notNull().default(0),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("packliste_eigen_liste_idx").on(
      t.lagerId,
      t.personId,
      t.reihenfolge,
      t.id,
    ),
    index("packliste_eigen_person_idx").on(t.personId),
    check(
      "packliste_eigen_text_check",
      sql`char_length(${t.abschnitt}) between 1 and 100 and char_length(${t.text}) between 1 and 300 and ${t.reihenfolge} >= 0`,
    ),
  ],
);

// Notfall-Kontakte (#393): die Sicherheitsverantwortlichen und weitere Anlaufstellen mit Telefon, entweder ein Konto des Lagers (person_id; die Nummer kommt aus dem Konto, solange keine eigene steht) oder ein Name ausserhalb von Cevi OS (dann mit Nummer). Geschrieben wird nur über lager/sync.ts. Das Team sieht sie, sonst nirgends im Lager eine Telefonnummer
export const notfallKontakt = pgTable(
  "notfall_kontakt",
  {
    ...lagerSpalten(),
    funktion: text("funktion").notNull(),
    personId: uuid("person_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    name: text("name"),
    telefon: text("telefon"),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [
    index("notfall_kontakt_liste_idx").on(t.lagerId, t.reihenfolge, t.id),
    index("notfall_kontakt_person_idx").on(t.personId),
    check(
      "notfall_kontakt_check",
      sql`char_length(${t.funktion}) between 1 and 100 and num_nonnulls(${t.personId}, ${t.name}) = 1 and (${t.name} is null or (char_length(${t.name}) between 1 and 100 and ${t.telefon} is not null)) and (${t.telefon} is null or ${t.telefon} ~ '^\\+?[0-9][0-9 ()/.-]{4,28}[0-9]$') and ${t.reihenfolge} >= 0`,
    ),
  ],
);

// Info-Abschnitte (#393): Titel, Text, Links (https, höchstens 20 als Liste) und über info_abschnitt_datei Dateien als Verknüpfungen. «notfall» zeigt den Abschnitt auch im Notfall-Fenster, «nur_lagerleitung» liest nur, wer vertrauliches.lesen hat
export const infoAbschnitt = pgTable(
  "info_abschnitt",
  {
    ...lagerSpalten(),
    titel: text("titel").notNull(),
    text: text("text"),
    links: jsonb("links")
      .$type<{ titel: string; url: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    nurLagerleitung: boolean("nur_lagerleitung").notNull().default(false),
    notfall: boolean("notfall").notNull().default(false),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [
    unique("info_abschnitt_lager_id_id_uq").on(t.lagerId, t.id),
    index("info_abschnitt_liste_idx").on(t.lagerId, t.reihenfolge, t.id),
    check(
      "info_abschnitt_check",
      sql`char_length(${t.titel}) between 1 and 200 and (${t.text} is null or char_length(${t.text}) <= 20000) and jsonb_typeof(${t.links}) = 'array' and jsonb_array_length(${t.links}) <= 20 and ${t.reihenfolge} >= 0`,
    ),
  ],
);

// Eine Datei-Verknüpfung (lager_datei, #370) an einem Info-Abschnitt. Der Fremdschlüssel auf lager_datei (ON DELETE RESTRICT) hält den Aufräumlauf davon ab, einen eingebundenen Eintrag zu entfernen; lager/lagerinfos.ts meldet die Spalte im Verweisregister an
export const infoAbschnittDatei = pgTable(
  "info_abschnitt_datei",
  {
    ...lagerSpalten(),
    abschnittId: uuid("abschnitt_id").notNull(),
    dateiId: uuid("datei_id")
      .notNull()
      .references(() => lagerDatei.id, { onDelete: "restrict" }),
  },
  (t) => [
    foreignKey({
      name: "info_abschnitt_datei_abschnitt_fk",
      columns: [t.lagerId, t.abschnittId],
      foreignColumns: [infoAbschnitt.lagerId, infoAbschnitt.id],
    }).onDelete("cascade"),
    index("info_abschnitt_datei_liste_idx").on(t.lagerId, t.abschnittId, t.id),
    index("info_abschnitt_datei_datei_idx").on(t.dateiId),
    uniqueIndex("info_abschnitt_datei_uq").on(t.abschnittId, t.dateiId),
  ],
);

// Warengruppen der Einkaufsliste (#392). Die Schlüssel stehen in der Datenbank, die Anzeigenamen kennt die App (Obst und Gemüse, Brot, Milch und Käse, Fleisch und Fisch, Vorrat, Getränke, Haushalt, Diverses). Die Liste steht auch in lager/einkauf.ts
export const EINKAUF_WARENGRUPPEN = [
  "obst_gemuese",
  "brot",
  "milch_kaese",
  "fleisch_fisch",
  "vorrat",
  "getraenke",
  "haushalt",
  "diverses",
] as const;
const warengruppeListe = sql.raw(
  EINKAUF_WARENGRUPPEN.map((w) => `'${w}'`).join(", "),
);

// Ein Artikel der Einkaufsliste des Lagers (#392). name_norm ist der Name ohne Gross- und Kleinschreibung und Umlaute (lager/einkauf.ts, normalisiereName): Er ist der Schlüssel, nach dem die Abfrage gleiche Artikel zusammenzählt. Die Menge ist eine Dezimalzahl (die Summe in der Datenbank ist exakt), die Einheit freier Text: Mengen werden nur bei gleicher Einheit gezählt. Wer einkauft, ist ein Mitglied des Lagers; verlässt es das Lager, wird die Angabe leer (in der Migration ON DELETE SET NULL (einkaeufer_person_id): Postgres 15 setzt nur die eine Spalte, drizzle kennt die Spaltenliste nicht)
export const einkaufArtikel = pgTable(
  "einkauf_artikel",
  {
    ...lagerSpalten(),
    name: text("name").notNull(),
    nameNorm: text("name_norm").notNull(),
    menge: numeric("menge", { precision: 12, scale: 3 }),
    einheit: text("einheit"),
    warengruppe: text("warengruppe", { enum: EINKAUF_WARENGRUPPEN }).notNull(),
    einkaeuferPersonId: uuid("einkaeufer_person_id"),
    erledigt: boolean("erledigt").notNull().default(false),
  },
  (t) => [
    foreignKey({
      name: "einkauf_artikel_einkaeufer_fk",
      columns: [t.lagerId, t.einkaeuferPersonId],
      foreignColumns: [lagerMitglied.lagerId, lagerMitglied.personId],
    }).onDelete("set null"),
    index("einkauf_artikel_liste_idx").on(t.lagerId, t.id),
    check(
      "einkauf_artikel_check",
      sql`char_length(${t.name}) between 1 and 100 and char_length(${t.nameNorm}) between 1 and 200 and (${t.menge} is null or ${t.menge} > 0) and (${t.einheit} is null or char_length(${t.einheit}) between 1 and 20) and ${t.warengruppe} in (${warengruppeListe})`,
    ),
  ],
);

// Merkt, welcher Warengruppe ein Artikel in diesem Lager gehört, wenn die Lagerleitung die Vorgabe aus der Stichwortliste (lager/einkauf.ts) korrigiert hat. Nur der Server pflegt die Tabelle (beim Anlegen oder Ändern eines Artikels mit eigener Warengruppe); keine Zeilenversion, kein Feed: Die Apps lesen die Warengruppe am Artikel
export const einkaufArtikelstamm = pgTable(
  "einkauf_artikelstamm",
  {
    lagerId: uuid("lager_id")
      .notNull()
      .references(() => lager.id, { onDelete: "cascade" }),
    nameNorm: text("name_norm").notNull(),
    warengruppe: text("warengruppe", { enum: EINKAUF_WARENGRUPPEN }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.lagerId, t.nameNorm] }),
    check(
      "einkauf_artikelstamm_check",
      sql`char_length(${t.nameNorm}) between 1 and 200 and ${t.warengruppe} in (${warengruppeListe})`,
    ),
  ],
);

// Vorschläge beim Tippen (#392): wie oft ein Artikel in diesem Lager angelegt wurde, mit der zuletzt getippten Schreibweise. Nur der Server pflegt die Tabelle (hochzählen beim Anlegen); keine Zeilenversion, kein Feed
export const einkaufVorschlag = pgTable(
  "einkauf_vorschlag",
  {
    lagerId: uuid("lager_id")
      .notNull()
      .references(() => lager.id, { onDelete: "cascade" }),
    nameNorm: text("name_norm").notNull(),
    name: text("name").notNull(),
    haeufigkeit: integer("haeufigkeit").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.lagerId, t.nameNorm] }),
    check(
      "einkauf_vorschlag_check",
      sql`char_length(${t.name}) between 1 and 100 and char_length(${t.nameNorm}) between 1 and 200 and ${t.haeufigkeit} >= 1`,
    ),
  ],
);

// Dokument im Lager (#396): ein Titel, ein Verweis auf eine Datei im SharePoint (lager_datei, #370), Stichworte und die Freigabe für das Team. Cevi OS speichert nur den Link, nie den Inhalt. Stichworte als text[] (klein geschrieben, ohne Doppelte, höchstens 20): Sie stehen in derselben Zeile wie das Dokument und kosten in der Liste keine zweite Abfrage; der GIN-Index trägt den Filter «Stichwort». Der Fremdschlüssel auf lager_datei ist RESTRICT und trägt das Lager mit: Der Aufräumlauf (lager/datei-verweise.ts) entfernt nie eine Datei, die ein Dokument einbindet, und ein Dokument zeigt nie auf eine Datei eines anderen Lagers. Geschrieben wird nur über lager/sync.ts
export const dokument = pgTable(
  "dokument",
  {
    ...lagerSpalten(),
    titel: text("titel").notNull(),
    dateiId: uuid("datei_id").notNull(),
    stichworte: text("stichworte")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Wer nur dokumente.team_lesen hat (das Team), sieht nur Dokumente mit true
    teamSichtbar: boolean("team_sichtbar").notNull().default(false),
  },
  (t) => [
    foreignKey({
      name: "dokument_datei_fk",
      columns: [t.lagerId, t.dateiId],
      foreignColumns: [lagerDatei.lagerId, lagerDatei.id],
    }).onDelete("restrict"),
    index("dokument_liste_idx").on(t.lagerId, t.id),
    index("dokument_datei_idx").on(t.dateiId),
    index("dokument_stichworte_idx").using("gin", t.stichworte),
    check(
      "dokument_check",
      sql`char_length(${t.titel}) between 1 and 200 and cardinality(${t.stichworte}) <= 20 and char_length(array_to_string(${t.stichworte}, ',')) <= 900`,
    ),
  ],
);

// Adressbuch des Lagers (#397): externe Kontakte (Bäckerei, Platzwart, Behörde) mit Name, Funktion, Gruppe, Telefon, E-Mail und Notiz. Personendaten Dritter, nur für die Lagerleitung (adressbuch.lesen und adressbuch.bearbeiten). «behalten» («Fürs nächste Lager behalten») nimmt den Kontakt aus der Aufräumfrist: Alle anderen löscht der tägliche Lauf (lager/adressbuch.ts) 180 Tage nach dem Lagerende; die Frist folgt dem Lagerende (lager.bis) und steht darum nicht als Spalte. Geschrieben wird nur über lager/sync.ts
export const adressbuchKontakt = pgTable(
  "adressbuch_kontakt",
  {
    ...lagerSpalten(),
    name: text("name").notNull(),
    funktion: text("funktion"),
    gruppe: text("gruppe"),
    telefon: text("telefon"),
    email: text("email"),
    notiz: text("notiz"),
    behalten: boolean("behalten").notNull().default(false),
  },
  (t) => [
    index("adressbuch_kontakt_liste_idx").on(
      t.lagerId,
      sql`lower(${t.name})`,
      t.id,
    ),
    check(
      "adressbuch_kontakt_check",
      sql`char_length(${t.name}) between 1 and 100 and (${t.funktion} is null or char_length(${t.funktion}) between 1 and 100) and (${t.gruppe} is null or char_length(${t.gruppe}) between 1 and 100) and (${t.telefon} is null or ${t.telefon} ~ '^\+?[0-9][0-9 ()/.-]{4,28}[0-9]$') and (${t.email} is null or (char_length(${t.email}) <= 254 and ${t.email} ~ '^[^@[:space:]]+@[^@[:space:]]+$')) and (${t.notiz} is null or char_length(${t.notiz}) <= 2000)`,
    ),
  ],
);

// Protokolle im Lager (#379): Das Protokoll liegt als Datei im SharePoint der Abteilung; Cevi OS speichert nur Art, Titel, Datum, den Verweis auf die Datei (lager_datei, #370, dort Link und Anzeigename) und optional den Höck. Kein Protokolltext, keine Abschnitte, keine Revisionen des Inhalts. Wer die Datei öffnen darf, regelt der Ablageort. hoeck_id: ein Protokoll eines Höcks der Art «lagerleitung» sehen nur Rollen, die alle Höcks lesen (nie das Team). Die Fremdschlüssel auf lager_datei und hoeck sind NO ACTION (kein SET NULL: Sonst würde ein Protokoll der Lagerleitung sichtbar, wenn der Höck endgültig fällt). Geschrieben wird nur über lager/sync.ts
export const PROTOKOLL_ART = ["sitzung", "notiz", "kontakt", "idee"] as const;
export type ProtokollArt = (typeof PROTOKOLL_ART)[number];

export const protokoll = pgTable(
  "protokoll",
  {
    ...lagerSpalten(),
    art: text("art", { enum: PROTOKOLL_ART }).notNull(),
    titel: text("titel").notNull(),
    datum: date("datum").notNull(),
    hoeckId: uuid("hoeck_id"),
    dateiId: uuid("datei_id").notNull(),
  },
  (t) => [
    // Ziel des Fremdschlüssels von beschluss
    unique("protokoll_lager_id_id_uq").on(t.lagerId, t.id),
    foreignKey({
      name: "protokoll_datei_fk",
      columns: [t.lagerId, t.dateiId],
      foreignColumns: [lagerDatei.lagerId, lagerDatei.id],
    }).onDelete("no action"),
    foreignKey({
      name: "protokoll_hoeck_fk",
      columns: [t.lagerId, t.hoeckId],
      foreignColumns: [hoeck.lagerId, hoeck.id],
    }).onDelete("no action"),
    index("protokoll_liste_idx").on(t.lagerId, t.datum, t.id),
    index("protokoll_datei_idx").on(t.dateiId),
    index("protokoll_hoeck_idx")
      .on(t.lagerId, t.hoeckId)
      .where(sql`${t.hoeckId} is not null`),
    check(
      "protokoll_check",
      sql`${t.art} in ('sitzung', 'notiz', 'kontakt', 'idee') and char_length(${t.titel}) between 1 and 200`,
    ),
  ],
);

// Beschlüsse im Lager (#379): ein kurzer Text mit optionalem Verweis auf das Protokoll und den Höck, für die Entscheide-Sammlung. Sie bleiben in Cevi OS (anders als das Protokoll selbst). Löschen ist endgültig (#427): Fällt das Protokoll weg, bleibt der Beschluss ohne diesen Verweis (ON DELETE SET NULL auf die eine Spalte; der Sync-Kern meldet die geänderte Zeile im Feed). Der Höck bleibt NO ACTION (wie bei protokoll): Ein Höck mit Protokollen oder Beschlüssen lässt sich nicht löschen (409 IN_VERWENDUNG), weil beide über den Höck für das Team verborgen sein können und sonst sichtbar würden. Geschrieben wird nur über lager/sync.ts
export const beschluss = pgTable(
  "beschluss",
  {
    ...lagerSpalten(),
    text: text("text").notNull(),
    protokollId: uuid("protokoll_id"),
    hoeckId: uuid("hoeck_id"),
  },
  (t) => [
    foreignKey({
      name: "beschluss_protokoll_fk",
      columns: [t.lagerId, t.protokollId],
      foreignColumns: [protokoll.lagerId, protokoll.id],
    }).onDelete("set null"),
    foreignKey({
      name: "beschluss_hoeck_fk",
      columns: [t.lagerId, t.hoeckId],
      foreignColumns: [hoeck.lagerId, hoeck.id],
    }).onDelete("no action"),
    index("beschluss_liste_idx").on(t.lagerId, t.id),
    index("beschluss_protokoll_idx")
      .on(t.lagerId, t.protokollId)
      .where(sql`${t.protokollId} is not null`),
    index("beschluss_hoeck_idx")
      .on(t.lagerId, t.hoeckId)
      .where(sql`${t.hoeckId} is not null`),
    check("beschluss_check", sql`char_length(${t.text}) between 1 and 1000`),
  ],
);

// Erwähnungen im Lager (#380): eine Zeile je erwähnter Person und Inhalt. Der Inhalt (Aufgabe, Traktandum, Pinnwand-Beitrag, Beschluss) trägt die Marke «@{person:<id>}»; lager/erwaehnungen.ts gleicht sie ab. quelle_id ohne Fremdschlüssel (vier Tabellen); die Liste filtert gelöschte Inhalte. Die Zeile hat keinen Text: Die App liest den Inhalt über seine Route. erledigt_am setzt die erwähnte Person. aufgabe_id: die Aufgabe, die «Als Aufgabe» angelegt hat (höchstens eine je Erwähnung); fällt sie endgültig weg, bleibt die Erwähnung ohne sie. Fällt das Mitglied weg, gehen seine Erwähnungen mit. In der Migration ON DELETE SET NULL (aufgabe_id): Postgres setzt nur die eine Spalte; drizzle kennt die Spaltenliste nicht. Kein Sync-Kern: Die Zeilen der Person sind keine geteilten Daten
export const ERWAEHNUNG_QUELLE = [
  "aufgabe",
  "traktandum",
  "pinnwand",
  "beschluss",
] as const;
export type ErwaehnungQuelle = (typeof ERWAEHNUNG_QUELLE)[number];

export const erwaehnung = pgTable(
  "erwaehnung",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    lagerId: uuid("lager_id")
      .notNull()
      .references(() => lager.id, { onDelete: "cascade" }),
    quelleTyp: text("quelle_typ", { enum: ERWAEHNUNG_QUELLE }).notNull(),
    quelleId: uuid("quelle_id").notNull(),
    personId: uuid("person_id").notNull(),
    erledigtAm: timestamp("erledigt_am", { withTimezone: true }),
    aufgabeId: uuid("aufgabe_id"),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("erwaehnung_quelle_person_uq").on(
      t.lagerId,
      t.quelleTyp,
      t.quelleId,
      t.personId,
    ),
    foreignKey({
      name: "erwaehnung_mitglied_fk",
      columns: [t.lagerId, t.personId],
      foreignColumns: [lagerMitglied.lagerId, lagerMitglied.personId],
    }).onDelete("cascade"),
    foreignKey({
      name: "erwaehnung_aufgabe_fk",
      columns: [t.lagerId, t.aufgabeId],
      foreignColumns: [aufgabe.lagerId, aufgabe.id],
    }).onDelete("set null"),
    // Die Liste der Person: neueste zuerst, Cursor über die ID
    index("erwaehnung_person_idx").on(t.lagerId, t.personId, t.id),
    index("erwaehnung_quelle_idx").on(t.quelleId),
    check(
      "erwaehnung_quelle_check",
      sql`${t.quelleTyp} in ('aufgabe', 'traktandum', 'pinnwand', 'beschluss')`,
    ),
  ],
);

// Fahrten des Lagers (#386): Hin- und Rückfahrt getrennt (richtung), Auto oder ÖV-Gruppe (art). «plaetze» sind die Plätze für Mitfahrende ohne den Fahrer («x von y»); eine ÖV-Gruppe hat weder Plätze noch Fahrer. Der Fahrer ist Mitglied des Lagers. «link» ist der Link auf den Fahrplan der ÖV-Gruppe, der Kartenpunkt (ziel_*) das Ziel der Fahrt mit Bezeichnung und Adresse, Koordinaten oder Link, das die App in der Karten-App öffnet. Der Server speichert beides nur und ruft nie einen Dienst ab (SR-26). Art und Richtung ändern sich nicht (Mitfahrende tragen die Richtung mit). In der Migration ON DELETE SET NULL (fahrer_person_id): Postgres setzt nur die eine Spalte; drizzle kennt die Spaltenliste nicht. Geschrieben wird nur über lager/sync.ts
export const fahrt = pgTable(
  "fahrt",
  {
    ...lagerSpalten(),
    richtung: text("richtung", { enum: ["hin", "rueck"] }).notNull(),
    art: text("art", { enum: ["auto", "oev"] }).notNull(),
    name: text("name"),
    fahrerPersonId: uuid("fahrer_person_id"),
    plaetze: integer("plaetze"),
    datum: date("datum"),
    zeit: text("zeit"),
    von: text("von"),
    nach: text("nach"),
    treffpunkt: text("treffpunkt"),
    link: text("link"),
    zielBezeichnung: text("ziel_bezeichnung"),
    zielAdresse: text("ziel_adresse"),
    zielLat: doublePrecision("ziel_lat"),
    zielLon: doublePrecision("ziel_lon"),
    zielLink: text("ziel_link"),
  },
  (t) => [
    // Ziel des Fremdschlüssels von fahrt_mitfahrer: Eine Mitfahrt kann weder ein anderes Lager noch eine andere Richtung meinen
    unique("fahrt_lager_id_id_richtung_uq").on(t.lagerId, t.id, t.richtung),
    foreignKey({
      name: "fahrt_fahrer_fk",
      columns: [t.lagerId, t.fahrerPersonId],
      foreignColumns: [lagerMitglied.lagerId, lagerMitglied.personId],
    }).onDelete("set null"),
    // Eine Person fährt je Richtung höchstens eine Fahrt (als Fahrer; als Mitfahrende prüft die Route gegen fahrt_mitfahrer)
    uniqueIndex("fahrt_fahrer_uq")
      .on(t.lagerId, t.richtung, t.fahrerPersonId)
      .where(sql`${t.fahrerPersonId} is not null`),
    // Die Liste: nach ID (UUIDv7 = Reihenfolge des Anlegens), Seitenwechsel über die ID
    index("fahrt_liste_idx").on(t.lagerId, t.id),
    check(
      "fahrt_richtung_art_check",
      sql`${t.richtung} in ('hin', 'rueck') and ${t.art} in ('auto', 'oev')`,
    ),
    check(
      "fahrt_art_check",
      sql`(${t.art} = 'auto' and ${t.plaetze} is not null and ${t.plaetze} between 1 and 99 and ${t.link} is null) or (${t.art} = 'oev' and ${t.plaetze} is null and ${t.fahrerPersonId} is null)`,
    ),
    check(
      "fahrt_text_check",
      sql`(${t.name} is null or char_length(${t.name}) between 1 and 100) and (${t.von} is null or char_length(${t.von}) between 1 and 200) and (${t.nach} is null or char_length(${t.nach}) between 1 and 200) and (${t.treffpunkt} is null or char_length(${t.treffpunkt}) between 1 and 200) and (${t.zeit} is null or ${t.zeit} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')`,
    ),
    check(
      "fahrt_link_check",
      sql`(${t.link} is null or (${t.link} ~ '^https://[^[:space:]]+$' and strpos(${t.link}, chr(92)) = 0 and char_length(${t.link}) <= 2048)) and (${t.zielLink} is null or (${t.zielLink} ~ '^https://[^[:space:]]+$' and strpos(${t.zielLink}, chr(92)) = 0 and char_length(${t.zielLink}) <= 2048))`,
    ),
    check(
      "fahrt_ziel_check",
      sql`(${t.zielBezeichnung} is null or char_length(${t.zielBezeichnung}) between 1 and 100) and (${t.zielAdresse} is null or char_length(${t.zielAdresse}) between 1 and 200) and ((${t.zielLat} is null) = (${t.zielLon} is null)) and (${t.zielLat} is null or (${t.zielLat} between -90 and 90 and ${t.zielLon} between -180 and 180)) and ((${t.zielBezeichnung} is null and ${t.zielAdresse} is null and ${t.zielLat} is null and ${t.zielLink} is null) or (${t.zielBezeichnung} is not null and (${t.zielAdresse} is not null or ${t.zielLat} is not null or ${t.zielLink} is not null)))`,
    ),
  ],
);

// Eine Mitfahrt: eine Person des Lagers (Leitung, Team) oder ein Teilnehmender, je eine Zeile. Die Richtung steht hier noch einmal, damit die Datenbank hält, dass jemand je Richtung höchstens in einer Fahrt sitzt (Fremdschlüssel über Lager, Fahrt und Richtung). Fällt die Fahrt, die Person aus dem Lager oder der Teilnehmende weg, geht die Zeile mit. Geschrieben wird nur über lager/sync.ts
export const fahrtMitfahrer = pgTable(
  "fahrt_mitfahrer",
  {
    ...lagerSpalten(),
    fahrtId: uuid("fahrt_id").notNull(),
    richtung: text("richtung", { enum: ["hin", "rueck"] }).notNull(),
    personId: uuid("person_id"),
    teilnehmerId: uuid("teilnehmer_id"),
  },
  (t) => [
    foreignKey({
      name: "fahrt_mitfahrer_fahrt_fk",
      columns: [t.lagerId, t.fahrtId, t.richtung],
      foreignColumns: [fahrt.lagerId, fahrt.id, fahrt.richtung],
    }).onDelete("cascade"),
    foreignKey({
      name: "fahrt_mitfahrer_person_fk",
      columns: [t.lagerId, t.personId],
      foreignColumns: [lagerMitglied.lagerId, lagerMitglied.personId],
    }).onDelete("cascade"),
    foreignKey({
      name: "fahrt_mitfahrer_teilnehmer_fk",
      columns: [t.lagerId, t.teilnehmerId],
      foreignColumns: [teilnehmer.lagerId, teilnehmer.id],
    }).onDelete("cascade"),
    uniqueIndex("fahrt_mitfahrer_person_uq")
      .on(t.lagerId, t.richtung, t.personId)
      .where(sql`${t.personId} is not null`),
    uniqueIndex("fahrt_mitfahrer_teilnehmer_uq")
      .on(t.lagerId, t.richtung, t.teilnehmerId)
      .where(sql`${t.teilnehmerId} is not null`),
    index("fahrt_mitfahrer_fahrt_idx").on(t.lagerId, t.fahrtId),
    check(
      "fahrt_mitfahrer_check",
      sql`${t.richtung} in ('hin', 'rueck') and num_nonnulls(${t.personId}, ${t.teilnehmerId}) = 1`,
    ),
  ],
);

// Dienste des Lagers (#388), zum Beispiel «Frühstück», «Abwasch» oder «Nachtwache»: Jeder gehört zu einem Tagesabschnitt und gilt an jedem Lagertag. mindestbesetzung ist die Zahl der Personen, die der Dienst je Tag braucht (mehr einzuteilen ist erlaubt). nacht kennzeichnet Nachtwachen, die der Vorschlag nicht an zwei Tagen hintereinander an dieselbe Person gibt. Der Abschnitt lässt sich nach dem Anlegen nicht ändern, weil die Schichten ihn mitführen. Geschrieben wird nur über lager/sync.ts
export const dienst = pgTable(
  "dienst",
  {
    ...lagerSpalten(),
    name: text("name").notNull(),
    beschreibung: text("beschreibung"),
    mindestbesetzung: integer("mindestbesetzung").notNull().default(1),
    nacht: boolean("nacht").notNull().default(false),
    tagesabschnittId: uuid("tagesabschnitt_id").notNull(),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [
    unique("dienst_lager_id_id_uq").on(t.lagerId, t.id),
    // Ziel des Fremdschlüssels von schicht: Eine Schicht kann nie einen anderen Abschnitt als ihr Dienst haben
    unique("dienst_lager_id_id_abschnitt_uq").on(
      t.lagerId,
      t.id,
      t.tagesabschnittId,
    ),
    foreignKey({
      name: "dienst_abschnitt_fk",
      columns: [t.lagerId, t.tagesabschnittId],
      foreignColumns: [tagesabschnitt.lagerId, tagesabschnitt.id],
    }).onDelete("cascade"),
    uniqueIndex("dienst_name_uq").on(
      t.lagerId,
      t.tagesabschnittId,
      sql`lower(${t.name})`,
    ),
    index("dienst_liste_idx").on(t.lagerId, t.reihenfolge, t.id),
    check(
      "dienst_check",
      sql`char_length(${t.name}) between 1 and 100 and (${t.beschreibung} is null or char_length(${t.beschreibung}) between 1 and 500) and ${t.mindestbesetzung} between 1 and 20 and ${t.reihenfolge} >= 0`,
    ),
  ],
);

// Eine eingeteilte Person (Mitglied des Lagers) oder ein eingeteilter Teilnehmender an einem Lagertag in einem Dienst (#388). tagesabschnitt_id ist der Abschnitt des Dienstes (der zusammengesetzte Fremdschlüssel hält sie gleich); eine Person ist je Lagertag und Abschnitt höchstens in einem Dienst (Teilindex ohne gelöschte Zeilen). Die Zeilen gehen mit dem Dienst, dem Lagertag, dem Teilnehmenden und der Mitgliedschaft
export const schicht = pgTable(
  "schicht",
  {
    ...lagerSpalten(),
    lagertagId: uuid("lagertag_id").notNull(),
    tagesabschnittId: uuid("tagesabschnitt_id").notNull(),
    dienstId: uuid("dienst_id").notNull(),
    personId: uuid("person_id"),
    teilnehmerId: uuid("teilnehmer_id"),
  },
  (t) => [
    foreignKey({
      name: "schicht_lagertag_fk",
      columns: [t.lagerId, t.lagertagId],
      foreignColumns: [lagertag.lagerId, lagertag.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "schicht_dienst_fk",
      columns: [t.lagerId, t.dienstId, t.tagesabschnittId],
      foreignColumns: [dienst.lagerId, dienst.id, dienst.tagesabschnittId],
    }).onDelete("cascade"),
    foreignKey({
      name: "schicht_person_fk",
      columns: [t.lagerId, t.personId],
      foreignColumns: [lagerMitglied.lagerId, lagerMitglied.personId],
    }).onDelete("cascade"),
    foreignKey({
      name: "schicht_teilnehmer_fk",
      columns: [t.lagerId, t.teilnehmerId],
      foreignColumns: [teilnehmer.lagerId, teilnehmer.id],
    }).onDelete("cascade"),
    uniqueIndex("schicht_person_uq")
      .on(t.lagerId, t.lagertagId, t.tagesabschnittId, t.personId)
      .where(sql`${t.personId} is not null`),
    uniqueIndex("schicht_teilnehmer_uq")
      .on(t.lagerId, t.lagertagId, t.tagesabschnittId, t.teilnehmerId)
      .where(sql`${t.teilnehmerId} is not null`),
    index("schicht_dienst_idx").on(t.lagerId, t.dienstId, t.lagertagId),
    check(
      "schicht_check",
      sql`num_nonnulls(${t.personId}, ${t.teilnehmerId}) = 1`,
    ),
  ],
);

// Anfrage eines Mitglieds, eine eigene Schicht zu tauschen oder abzugeben (#389). schicht_id ist die eigene Schicht. Mit mit_schicht_id (Schicht einer anderen Person) tauschen beide, mit nur mit_person_id übernimmt diese Person die Schicht, ohne beides wählt die Lagerleitung beim Entscheid die Person. Ob die Wunschperson einverstanden ist, klärt die Lagerleitung; Cevi OS fragt sie nicht. Erst der Entscheid «angenommen» bucht die Schichten um (lager/diensttausch.ts). Beim Zurückziehen und Entscheiden setzt entschieden_am den Zeitpunkt, entschieden_von die Person (beim Zurückziehen die anfragende). schicht_id und mit_schicht_id haben keinen Fremdschlüssel mit Lager (schicht hat keinen Schlüssel dafür): Der Code lädt Schichten immer mit lager_id. Geschrieben wird nur über lager/sync.ts
export const diensttausch = pgTable(
  "diensttausch",
  {
    ...lagerSpalten(),
    vonPersonId: uuid("von_person_id").notNull(),
    schichtId: uuid("schicht_id")
      .notNull()
      .references(() => schicht.id, { onDelete: "cascade" }),
    mitPersonId: uuid("mit_person_id"),
    mitSchichtId: uuid("mit_schicht_id").references(() => schicht.id, {
      onDelete: "cascade",
    }),
    notiz: text("notiz"),
    status: text("status", {
      enum: ["offen", "angenommen", "abgelehnt", "zurueckgezogen"],
    })
      .notNull()
      .default("offen"),
    entschiedenVon: uuid("entschieden_von").references(() => user.id, {
      onDelete: "set null",
    }),
    entschiedenAm: timestamp("entschieden_am", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "diensttausch_von_fk",
      columns: [t.lagerId, t.vonPersonId],
      foreignColumns: [lagerMitglied.lagerId, lagerMitglied.personId],
    }).onDelete("cascade"),
    foreignKey({
      name: "diensttausch_mit_fk",
      columns: [t.lagerId, t.mitPersonId],
      foreignColumns: [lagerMitglied.lagerId, lagerMitglied.personId],
    }).onDelete("cascade"),
    uniqueIndex("diensttausch_offen_uq")
      .on(t.lagerId, t.schichtId)
      .where(sql`${t.status} = 'offen'`),
    index("diensttausch_liste_idx").on(t.lagerId, t.status, t.id),
    index("diensttausch_person_idx").on(t.lagerId, t.vonPersonId, t.id),
    check(
      "diensttausch_status_check",
      sql`${t.status} in ('offen', 'angenommen', 'abgelehnt', 'zurueckgezogen') and (${t.status} = 'offen') = (${t.entschiedenAm} is null)`,
    ),
    check(
      "diensttausch_wunsch_check",
      sql`(${t.mitSchichtId} is null or ${t.mitPersonId} is not null) and ${t.mitPersonId} is distinct from ${t.vonPersonId} and ${t.mitSchichtId} is distinct from ${t.schichtId}`,
    ),
    check(
      "diensttausch_notiz_check",
      sql`${t.notiz} is null or char_length(${t.notiz}) between 1 and 500`,
    ),
  ],
);

// Tagesseite (#391): eine Seite je Lagertag mit Tageschef und Notiz. Die Seite entsteht beim ersten Schreiben (Seite oder Block); je Lagertag höchstens eine nicht gelöschte. Der Tageschef ist Mitglied des Lagers; verlässt er es, wird die Angabe leer (in der Migration ON DELETE SET NULL (tageschef_person_id): Postgres 15 setzt nur die eine Spalte, drizzle kennt die Spaltenliste nicht). To-dos der Tagesseite sind keine Zeilen hier, sie zeigen die Aufgaben mit Frist an diesem Tag (#372)
export const tagesseite = pgTable(
  "tagesseite",
  {
    ...lagerSpalten(),
    lagertagId: uuid("lagertag_id").notNull(),
    tageschefPersonId: uuid("tageschef_person_id"),
    notiz: text("notiz"),
  },
  (t) => [
    unique("tagesseite_lager_id_id_uq").on(t.lagerId, t.id),
    foreignKey({
      name: "tagesseite_lagertag_fk",
      columns: [t.lagerId, t.lagertagId],
      foreignColumns: [lagertag.lagerId, lagertag.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "tagesseite_tageschef_fk",
      columns: [t.lagerId, t.tageschefPersonId],
      foreignColumns: [lagerMitglied.lagerId, lagerMitglied.personId],
    }).onDelete("set null"),
    uniqueIndex("tagesseite_lagertag_uq").on(t.lagertagId),
    index("tagesseite_lagertag_idx").on(t.lagerId, t.lagertagId),
    check(
      "tagesseite_notiz_check",
      sql`${t.notiz} is null or char_length(${t.notiz}) <= 5000`,
    ),
  ],
);

// Block einer Tagesseite (#391), eine Zeile je Block: «wichtig» (Hinweis des Tages), «idee» und «programmbild» (Verknüpfung auf eine Datei im SharePoint über lager_datei, der Text ist die Beschriftung). Zu besprechen wird ein Traktandum (#378), nicht ein Block
export const TAGESSEITE_BLOCK_ARTEN = [
  "wichtig",
  "idee",
  "programmbild",
] as const;
export const tagesseiteBlock = pgTable(
  "tagesseite_block",
  {
    ...lagerSpalten(),
    seiteId: uuid("seite_id").notNull(),
    art: text("art", { enum: TAGESSEITE_BLOCK_ARTEN }).notNull(),
    text: text("text").notNull(),
    // Nur beim Programmbild; ON DELETE RESTRICT wie bei den anderen Modulen: Der Aufräumlauf entfernt nie einen Eintrag, den ein Block einbindet
    dateiId: uuid("datei_id").references(() => lagerDatei.id, {
      onDelete: "restrict",
    }),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: "tagesseite_block_seite_fk",
      columns: [t.lagerId, t.seiteId],
      foreignColumns: [tagesseite.lagerId, tagesseite.id],
    }).onDelete("cascade"),
    index("tagesseite_block_liste_idx").on(
      t.lagerId,
      t.seiteId,
      t.reihenfolge,
      t.id,
    ),
    index("tagesseite_block_datei_idx").on(t.dateiId),
    check(
      "tagesseite_block_check",
      sql`${t.art} in ('wichtig', 'idee', 'programmbild') and char_length(${t.text}) between 1 and 1000 and (${t.art} = 'programmbild') = (${t.dateiId} is not null) and ${t.reihenfolge} >= 0`,
    ),
  ],
);

// Zwischenspeicher des Wetters (#391), eine Zeile je Lager, ohne Feed und Version: Der Server holt die Vorhersage für den Ort des Lagers höchstens alle paar Stunden (lager/wetter.ts) und gibt sie allen Mitgliedern aus. «tage» sind die Tageswerte des Dienstes (Datum, Wettercode, Temperatur, Regen, Böen), keine Personendaten. breite und laenge sind der Ort, für den die Zeile gilt: Ändert die Lagerleitung den Ort, ist sie veraltet. abgerufen_am: letzter gelungener Abruf; versuch_am: letzter Versuch (auch misslungen), damit ein Ausfall des Dienstes nicht bei jeder Anfrage einen Abruf auslöst
export const wetterCache = pgTable(
  "wetter_cache",
  {
    lagerId: uuid("lager_id")
      .primaryKey()
      .references(() => lager.id, { onDelete: "cascade" }),
    breite: doublePrecision("breite").notNull(),
    laenge: doublePrecision("laenge").notNull(),
    abgerufenAm: timestamp("abgerufen_am", { withTimezone: true }),
    versuchAm: timestamp("versuch_am", { withTimezone: true }).notNull(),
    tage: jsonb("tage")
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (t) => [
    check(
      "wetter_cache_check",
      sql`jsonb_typeof(${t.tage}) = 'array' and jsonb_array_length(${t.tage}) <= 30`,
    ),
  ],
);

// Eigene Check-Punkte des Lagers (#377): Was die Lagerleitung zusätzlich zu den Prüfern des Lager-Checks (lager/check.ts) abhaken will, zum Beispiel «Versicherung geklärt». erledigt setzt, wer zeitplan.bearbeiten hat. Ein Punkt ist nur ein Titel und ein Haken, keine Person, kein Inhalt. Geschrieben wird nur über lager/sync.ts
export const lagerCheckPunkt = pgTable(
  "lager_check_punkt",
  {
    ...lagerSpalten(),
    titel: text("titel").notNull(),
    erledigt: boolean("erledigt").notNull().default(false),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [
    index("lager_check_punkt_liste_idx").on(t.lagerId, t.reihenfolge, t.id),
    check(
      "lager_check_punkt_check",
      sql`char_length(${t.titel}) between 1 and 200 and ${t.reihenfolge} >= 0`,
    ),
  ],
);

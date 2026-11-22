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
      "lager_farbe_check",
      sql`${t.farbe} is null or ${t.farbe} ~ '^#[0-9a-f]{6}$'`,
    ),
  ],
);

// Die Lager-Rolle einer Person; die Policy liest sie bei jeder Anfrage hier, nie aus Token oder Sitzung (lager/policy.ts). Dass die Person zur Abteilung des Lagers gehört, prüfen die Admin-Routen; die Policy lädt das Lager ohnehin nur in der Abteilung der Sitzung, eine fremde Zeile gäbe nichts frei
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
    // Soft-Delete: Die Zeile bleibt (Papierkorb, #368), der Feed meldet «geloescht»
    geloeschtAm: timestamp("geloescht_am", { withTimezone: true }),
    geloeschtVon: uuid("geloescht_von").references(() => user.id, {
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
    uniqueIndex("ressort_kuerzel_uq")
      .on(t.lagerId, sql`lower(${t.kuerzel})`)
      .where(sql`${t.geloeschtAm} is null`),
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
    index("aufgabe_frist_idx")
      .on(t.lagerId, t.frist)
      .where(sql`${t.frist} is not null`),
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

// Anwesenheit im Lager (#390): eine Zeile je Person (Leitende: user.id) oder Teilnehmende (teilnehmer_id) und Abschnitt eines Lagertags, nur für A (anwesend) und F (abwesend); «O» (offen) heisst keine Zeile, eine Zeile mit O entsteht nur, wenn die Lagerleitung ein eingetragenes Feld wieder öffnet. Ein eingetragenes Feld (A oder F) ist für das Team gesperrt: Änderungen laufen über anwesenheit_anfrage. Lagertag und Abschnitt (#374) und Teilnehmende (#384) ohne Fremdschlüssel, bis diese Tabellen im Schema stehen. Geschrieben wird nur über lager/sync.ts
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
    // Ein Feld gibt es je Person und Abschnitt einmal; eine gelöschte Zeile blockiert es nicht
    uniqueIndex("anwesenheit_person_uq")
      .on(t.lagerId, t.personId, t.lagertagId, t.tagesabschnittId)
      .where(sql`${t.personId} is not null and ${t.geloeschtAm} is null`),
    uniqueIndex("anwesenheit_teilnehmer_uq")
      .on(t.lagerId, t.teilnehmerId, t.lagertagId, t.tagesabschnittId)
      .where(sql`${t.teilnehmerId} is not null and ${t.geloeschtAm} is null`),
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
    uniqueIndex("anwesenheit_anfrage_offen_uq")
      .on(t.lagerId, t.personId, t.lagertagId, t.tagesabschnittId)
      .where(sql`${t.status} = 'offen' and ${t.geloeschtAm} is null`),
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

// Teilnehmende des Lagers (#384): nur Name und Stufe, bewusst keine Gesundheitsdaten, kein Telefon und keine Adresse (Test in lager/teilnehmer.test.ts hält die Spaltenliste fest). cevi_name ist der Anzeigename für Aushänge (Cevi-Name, sonst Vorname). kind_id und anmeldung_id sind die spätere Verknüpfung zum Kind und zur Anlass-Anmeldung: anmeldung_id ohne Fremdschlüssel, bis der Auftrag Termine die Anmeldung anlegt; beide sind über die API noch nicht setzbar. Geschrieben wird nur über lager/sync.ts. Nach dem Lager löscht ein täglicher Lauf die Zeilen (lager/teilnehmer.ts)
export const teilnehmer = pgTable(
  "teilnehmer",
  {
    ...lagerSpalten(),
    kindId: uuid("kind_id").references(() => kind.id, {
      onDelete: "set null",
    }),
    anmeldungId: uuid("anmeldung_id"),
    vorname: text("vorname").notNull(),
    nachname: text("nachname").notNull(),
    ceviName: text("cevi_name"),
    stufe: text("stufe"),
  },
  (t) => [
    // Ziel des Fremdschlüssels von abzaehlen: Ein Eintrag kann nie ein Kind eines anderen Lagers meinen
    unique("teilnehmer_lager_id_id_uq").on(t.lagerId, t.id),
    // Die Liste: sortiert nach Name, mit Seitenwechsel über (nachname, vorname, id)
    index("teilnehmer_liste_idx").on(t.lagerId, t.nachname, t.vorname, t.id),
    check(
      "teilnehmer_text_check",
      sql`char_length(${t.vorname}) between 1 and 100 and char_length(${t.nachname}) between 1 and 100 and (${t.ceviName} is null or char_length(${t.ceviName}) between 1 and 50) and (${t.stufe} is null or char_length(${t.stufe}) between 1 and 50)`,
    ),
  ],
);

// Empfänger eines Beitrags: eine Rolle oder eine Person je Zeile. Ohne Zeile gilt der Beitrag für alle Mitglieder. Keine eigenen Feed-Spalten: Die Empfänger gehören zum Beitrag und werden mit ihm gesetzt (die Version des Beitrags steigt dabei)
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
    check(
      "pinnwand_empfaenger_check",
      sql`(${t.rolle} is null) <> (${t.personId} is null) and (${t.rolle} is null or ${t.rolle} in ('leitung', 'team', 'lesen'))`,
    ),
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
    uniqueIndex("pinnwand_datei_uq")
      .on(t.beitragId, t.dateiId)
      .where(sql`${t.geloeschtAm} is null`),
    check("pinnwand_datei_check", sql`${t.reihenfolge} >= 0`),
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
      .where(sql`${t.teilnehmerId} is not null and ${t.geloeschtAm} is null`),
    uniqueIndex("abzaehlen_person_uq")
      .on(t.lagerId, t.personId)
      .where(sql`${t.personId} is not null and ${t.geloeschtAm} is null`),
    check(
      "abzaehlen_ziel_check",
      sql`(${t.teilnehmerId} is null) <> (${t.personId} is null) and ${t.geprueft} = (${t.geprueftAm} is not null)`,
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
    uniqueIndex("info_abschnitt_datei_uq")
      .on(t.abschnittId, t.dateiId)
      .where(sql`${t.geloeschtAm} is null`),
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
      .where(sql`${t.fahrerPersonId} is not null and ${t.geloeschtAm} is null`),
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
      .where(sql`${t.personId} is not null and ${t.geloeschtAm} is null`),
    uniqueIndex("fahrt_mitfahrer_teilnehmer_uq")
      .on(t.lagerId, t.richtung, t.teilnehmerId)
      .where(sql`${t.teilnehmerId} is not null and ${t.geloeschtAm} is null`),
    index("fahrt_mitfahrer_fahrt_idx").on(t.lagerId, t.fahrtId),
    check(
      "fahrt_mitfahrer_check",
      sql`${t.richtung} in ('hin', 'rueck') and num_nonnulls(${t.personId}, ${t.teilnehmerId}) = 1`,
    ),
  ],
);

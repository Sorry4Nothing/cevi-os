import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
// Zyklus mit schema.ts (das diese Datei weiterreicht), harmlos: Die Verweise stehen nur in Funktionen, die erst beim Aufbau der Fremdschlüssel laufen
import { abteilung, medium, user } from "./schema.js";

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
    // Ohne Fremdschlüssel bis zu den Ressorts (L1a); die API nimmt es bis dahin nicht an
    ressortId: uuid("ressort_id"),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.lagerId, t.personId] }),
    index("lager_mitglied_person_id_idx").on(t.personId),
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

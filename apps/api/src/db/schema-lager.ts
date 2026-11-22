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

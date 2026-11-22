import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
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
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("lager_abteilung_id_idx").on(t.abteilungId, t.von),
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

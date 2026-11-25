import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { abteilung, tag, user } from "./schema.js";

// Plattformrollen (#423). schema.ts re-exportiert diese Datei; die Importe aus schema.ts stehen nur in Rückruffunktionen, der Zyklus ist damit harmlos.
// Nicht «rolle»: So heissen die Stufenrollen (Sicht auf person_tag). Entwickler und Abteilungsleitung stehen nicht hier, sie sind fest im Code (plattform.ts)
const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);
const zeitpunkt = (name: string) => timestamp(name, { withTimezone: true });

// Eine Rolle der Abteilung mit einstellbaren Rechten (plattform_rolle_recht). schluessel «webmaster» kennzeichnet die Vorgabe jeder Abteilung: Sie lässt sich nicht löschen und nicht umbenennen, ihre Rechte sind einstellbar
export const plattformRolle = pgTable(
  "plattform_rolle",
  {
    id: id(),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    schluessel: text("schluessel", { enum: ["webmaster"] }),
    // Hochgezählt bei jeder Änderung: Die Matrix speichert nur auf dem Stand, den sie gelesen hat (If-Match, 409)
    version: integer("version").notNull().default(1),
    erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("plattform_rolle_name_pro_abteilung").on(
      t.abteilungId,
      sql`lower(${t.name})`,
    ),
    uniqueIndex("plattform_rolle_schluessel_pro_abteilung")
      .on(t.abteilungId, t.schluessel)
      .where(sql`${t.schluessel} is not null`),
    // text({ enum }) prüft nur in TypeScript, nicht in der Datenbank
    check(
      "plattform_rolle_schluessel_check",
      sql`${t.schluessel} is null or ${t.schluessel} in ('webmaster')`,
    ),
    check(
      "plattform_rolle_name_check",
      sql`char_length(${t.name}) between 1 and 50`,
    ),
  ],
);

// Ein Recht der Rolle, benannt nach dem Rechtekatalog im Code. Die Datenbank kennt den Katalog nicht: Ein Name, den der Katalog nicht (mehr) kennt, gibt nichts (fail-closed, plattform.ts)
export const plattformRolleRecht = pgTable(
  "plattform_rolle_recht",
  {
    rolleId: uuid("rolle_id")
      .notNull()
      .references(() => plattformRolle.id, { onDelete: "cascade" }),
    recht: text("recht").notNull(),
  },
  (t) => [primaryKey({ columns: [t.rolleId, t.recht] })],
);

// Wer welche Rolle trägt. Dass Person und Rolle zur selben Abteilung gehören, prüfen die Routen und jede Abfrage in plattform.ts (die Rolle muss in der Abteilung der Person liegen)
export const personPlattformRolle = pgTable(
  "person_plattform_rolle",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rolleId: uuid("rolle_id")
      .notNull()
      .references(() => plattformRolle.id, { onDelete: "cascade" }),
    erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.rolleId] }),
    index("person_plattform_rolle_rolle_id_idx").on(t.rolleId),
  ],
);

// Entwickler der Plattform: nur die Kommandozeile schreibt hier (cli/entwickler.ts), nie eine Route
export const plattformEntwickler = pgTable("plattform_entwickler", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
});

// Die Abteilungsleitung (#720): Wer eine Zeile hat, gehört zur Abteilungsleitung seiner Abteilung (user.abteilung_id). Ihre Rechte stehen in abteilungsleitung_recht. Die Tabelle ist die einzige Quelle; user.role ist seit Teil 10 des Epics #714 (#784) immer «user»
export const abteilungsleitungPerson = pgTable("abteilungsleitung_person", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
});

// Gruppenrollen (#643): Rollen einer einzelnen Gruppe (Tag jedes Typs), von der Abteilungsleitung erstellt und eingestellt; ihre Rechte gelten für Objekte der Gruppe («eigene») oder der ganzen Abteilung («alle»), je nach Katalog (rechtemodell/katalog.ts). Keine Frist: Sie gelten, bis Rolle, Zuordnung oder Gruppe gelöscht sind.
// schluessel kennzeichnet die Systemrollen jeder Gruppe (Stufe: leitung, stufenleitung; sonst verantwortlich): Sie lassen sich nicht löschen und nicht umbenennen, ihre Rechte sind einstellbar. verantwortlich ist das Kennzeichen «Verantwortliche/r» (Ziel «Verantwortliche» der Mitteilungen). Dass abteilung_id zum Tag passt, prüfen die Routen
export const gruppenRolle = pgTable(
  "gruppen_rolle",
  {
    id: id(),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    beschreibung: text("beschreibung"),
    verantwortlich: boolean("verantwortlich").notNull().default(false),
    reihenfolge: integer("reihenfolge").notNull().default(1000),
    schluessel: text("schluessel", {
      enum: ["leitung", "stufenleitung", "verantwortlich"],
    }),
    version: integer("version").notNull().default(1),
    erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
    geaendertAm: zeitpunkt("geaendert_am").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gruppen_rolle_name_pro_gruppe").on(
      t.tagId,
      sql`lower(${t.name})`,
    ),
    uniqueIndex("gruppen_rolle_schluessel_pro_gruppe")
      .on(t.tagId, t.schluessel)
      .where(sql`${t.schluessel} is not null`),
    index("gruppen_rolle_abteilung_id_idx").on(t.abteilungId),
    // text({ enum }) prüft nur in TypeScript, nicht in der Datenbank
    check(
      "gruppen_rolle_name_check",
      sql`char_length(${t.name}) between 1 and 50`,
    ),
    check(
      "gruppen_rolle_beschreibung_check",
      sql`${t.beschreibung} is null or char_length(${t.beschreibung}) <= 300`,
    ),
    check("gruppen_rolle_reihenfolge_check", sql`${t.reihenfolge} >= 1`),
    check(
      "gruppen_rolle_schluessel_check",
      sql`${t.schluessel} is null or ${t.schluessel} in ('leitung', 'stufenleitung', 'verantwortlich')`,
    ),
  ],
);

// Ein Recht der Gruppenrolle, benannt nach dem Katalog im Code, mit seiner Geltung. Ein Name oder eine Geltung, die der Katalog nicht kennt, gibt nichts (fail-closed)
export const gruppenRolleRecht = pgTable(
  "gruppen_rolle_recht",
  {
    rolleId: uuid("rolle_id")
      .notNull()
      .references(() => gruppenRolle.id, { onDelete: "cascade" }),
    recht: text("recht").notNull(),
    geltung: text("geltung", { enum: ["alle", "eigene"] })
      .notNull()
      .default("eigene"),
  },
  (t) => [
    primaryKey({ columns: [t.rolleId, t.recht] }),
    check(
      "gruppen_rolle_recht_geltung_check",
      sql`${t.geltung} in ('alle', 'eigene')`,
    ),
  ],
);

// Die Rechte der Abteilungsleitung (#663): eine einstellbare Systemrolle je Abteilung. Gespeichert sind nur die Abzüge: Standard sind alle vergebbaren Rechte des Katalogs, «ohne» nimmt dem Konto mit der Rolle «admin» einzelne weg. Ein neues Recht im Katalog gilt für die Abteilungsleitung damit von selbst. Ohne Zeile gilt der Standard. Nur der Entwickler ändert die Zeile (Recht rechte.abteilungsleitung); die Abteilungsleitung ändert ihre eigenen Rechte nie. Ein Name, den der Katalog nicht (mehr) kennt, nimmt nichts weg.
export const abteilungsleitungRecht = pgTable(
  "abteilungsleitung_recht",
  {
    abteilungId: uuid("abteilung_id")
      .primaryKey()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    ohne: text("ohne")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Hochgezählt bei jeder Änderung: Die Matrix speichert nur auf dem Stand, den sie gelesen hat (409)
    version: integer("version").notNull().default(1),
    geaendertAm: zeitpunkt("geaendert_am").notNull().defaultNow(),
  },
  (t) => [
    check(
      "abteilungsleitung_recht_ohne_check",
      sql`cardinality(${t.ohne}) <= 200`,
    ),
  ],
);

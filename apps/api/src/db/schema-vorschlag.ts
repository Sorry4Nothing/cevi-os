import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
// Zyklus mit schema.ts (das diese Datei weiterreicht), harmlos: Die Verweise stehen nur in Funktionen, die erst beim Aufbau der Fremdschlüssel laufen
import { abteilung, user } from "./schema.js";

const zeitpunkt = (name: string) => timestamp(name, { withTimezone: true });

// Terminvorschläge (#439, Epic #430): Eine berechtigte Person schlägt einen Termin vor, die Abteilungsleitung entscheidet (#440). Cevi OS legt Termine nie in Outlook an (Kategorien schreibt es seit #835, nur mit der Anbindung); «freigegeben» heisst: in Outlook von Hand einzutragen.
// tag_ids sind die gewünschten Kategorien (Tags der Abteilung); die Zugehörigkeit zur Abteilung prüft die Route, kein Fremdschlüssel hält ein Array. Ein gelöschter Tag verschwindet in der Anzeige. Zurückziehen löscht die Zeile.
export const terminVorschlag = pgTable(
  "termin_vorschlag",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    vorgeschlagenVon: uuid("vorgeschlagen_von").references(() => user.id, {
      onDelete: "set null",
    }),
    titel: text("titel").notNull(),
    ganztaegig: boolean("ganztaegig").notNull(),
    beginn: zeitpunkt("beginn"),
    ende: zeitpunkt("ende"),
    tagVon: date("tag_von"),
    // Letzter Tag, wie bei programm
    tagBis: date("tag_bis"),
    ort: text("ort"),
    beschreibung: text("beschreibung"),
    // Hinweis an die Abteilungsleitung, kein Teil des Termins
    bemerkung: text("bemerkung"),
    tagIds: uuid("tag_ids").array().notNull(),
    status: text("status", {
      enum: ["offen", "freigegeben", "abgelehnt", "in_outlook_eingetragen"],
    })
      .notNull()
      .default("offen"),
    entschiedenVon: uuid("entschieden_von").references(() => user.id, {
      onDelete: "set null",
    }),
    entschiedenAm: zeitpunkt("entschieden_am"),
    begruendung: text("begruendung"),
    erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
  },
  (t) => [
    // Die eigene Liste (neueste zuerst) und die Zahl der offenen Vorschläge je Person
    index("termin_vorschlag_person_idx").on(t.vorgeschlagenVon, t.id),
    index("termin_vorschlag_abteilung_idx").on(t.abteilungId, t.status),
    check(
      "termin_vorschlag_status_check",
      sql`${t.status} in ('offen', 'freigegeben', 'abgelehnt', 'in_outlook_eingetragen')`,
    ),
    // Wie programm: ganztägig genau dann, wenn Tage gesetzt und Zeitpunkte leer sind
    check(
      "termin_vorschlag_zeiten_passen_zu_ganztaegig",
      sql`(${t.ganztaegig} and ${t.tagVon} is not null and ${t.tagBis} is not null and ${t.beginn} is null and ${t.ende} is null and ${t.tagBis} >= ${t.tagVon}) or (not ${t.ganztaegig} and ${t.beginn} is not null and ${t.ende} is not null and ${t.tagVon} is null and ${t.tagBis} is null and ${t.ende} > ${t.beginn})`,
    ),
    // Ein Termin ohne Kategorie wäre unsichtbar
    check(
      "termin_vorschlag_tags_check",
      sql`cardinality(${t.tagIds}) between 1 and 20`,
    ),
    check(
      "termin_vorschlag_laengen_check",
      sql`char_length(${t.titel}) between 1 and 120 and char_length(${t.ort}) <= 120 and char_length(${t.beschreibung}) <= 2000 and char_length(${t.bemerkung}) <= 1000 and char_length(${t.begruendung}) <= 1000`,
    ),
  ],
);

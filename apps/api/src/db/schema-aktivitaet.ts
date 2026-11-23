import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Aktivitätsprotokoll (#637): was in Cevi OS geschrieben oder geändert wird, mit Benutzerstempel; nur der Entwickler liest es (GET /api/v1/admin/protokoll).
// Nur anfügen: Die API-Rolle darf nicht ändern und nicht löschen; die Löschung nach der Frist macht die Funktion aktivitaet_aufraeumen() (Migration 0139).
// Nie hinein: Inhalte von Anfragen und Antworten, Passwörter, Tokens, Cookies, Push-Texte, Namen von Kindern. user_id und abteilung_id ohne Fremdschlüssel, damit das Protokoll Löschungen übersteht
export const AKTIVITAET_ARTEN = [
  "aktion",
  "anmeldung",
  "audit",
  "zugriff",
  "system",
] as const;
export const AKTIVITAET_AKTEURE = [
  "person",
  "anonym",
  "cli",
  "system",
] as const;
export const AKTIVITAET_ERGEBNISSE = ["erfolg", "fehler"] as const;

export const aktivitaet = pgTable(
  "aktivitaet",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    // Beginn des Ereignisses (UTC); die Verwaltung zeigt Europe/Zurich
    zeit: timestamp("zeit", { withTimezone: true }).notNull().defaultNow(),
    art: text("art", { enum: AKTIVITAET_ARTEN }).notNull(),
    abteilungId: uuid("abteilung_id"),
    userId: uuid("user_id"),
    akteur: text("akteur", { enum: AKTIVITAET_AKTEURE })
      .notNull()
      .default("anonym"),
    // Anzeigename zum Zeitpunkt des Ereignisses (Schnappschuss, spätere Umbenennung ändert ihn nicht)
    name: text("name"),
    // Funktionen zum Zeitpunkt: abteilungsleitung, stufenleitung, leitung, webmaster, entwickler, eltern
    rollen: text("rollen")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    methode: text("methode"),
    // Routenmuster («PATCH /api/v1/admin/personen/:id», nie der echte Pfad) oder der Name des Ereignisses
    aktion: text("aktion").notNull(),
    bereich: text("bereich").notNull(),
    objektTyp: text("objekt_typ"),
    objektId: uuid("objekt_id"),
    // Nur Namen von Feldern, nie Werte
    felder: text("felder").array(),
    status: integer("status"),
    ergebnis: text("ergebnis", { enum: AKTIVITAET_ERGEBNISSE }).notNull(),
    fehlerCode: text("fehler_code"),
    dauerMs: integer("dauer_ms"),
    // Gekürzter Hash der IP mit einem Tagessalz, das nur im Speicher liegt: innerhalb eines Tages vergleichbar, danach nicht mehr zuordenbar
    herkunft: text("herkunft"),
    // Browser-Familie, nie der volle User-Agent
    geraet: text("geraet"),
    anfrageId: text("anfrage_id"),
    // Zahl bei Systemereignissen (gelöscht, gesendet, geändert)
    anzahl: integer("anzahl"),
  },
  (t) => [
    index("aktivitaet_zeit_idx").on(t.zeit.desc(), t.id.desc()),
    index("aktivitaet_user_idx").on(t.userId, t.zeit.desc()),
    index("aktivitaet_aktion_idx").on(t.aktion, t.zeit.desc()),
    index("aktivitaet_bereich_idx").on(t.bereich, t.zeit.desc()),
    check(
      "aktivitaet_art_check",
      sql`${t.art} in ('aktion', 'anmeldung', 'audit', 'zugriff', 'system')`,
    ),
    check(
      "aktivitaet_akteur_check",
      sql`${t.akteur} in ('person', 'anonym', 'cli', 'system')`,
    ),
    check(
      "aktivitaet_ergebnis_check",
      sql`${t.ergebnis} in ('erfolg', 'fehler')`,
    ),
    // Die Grenzen fangen einen Fehler im Code ab, bevor die Tabelle mit langem Text wächst
    check(
      "aktivitaet_laenge_check",
      sql`char_length(${t.aktion}) <= 200 and char_length(${t.bereich}) <= 60 and (${t.name} is null or char_length(${t.name}) <= 120) and (${t.fehlerCode} is null or char_length(${t.fehlerCode}) <= 60) and (${t.herkunft} is null or char_length(${t.herkunft}) <= 32) and (${t.geraet} is null or char_length(${t.geraet}) <= 40) and (${t.anfrageId} is null or char_length(${t.anfrageId}) <= 64)`,
    ),
  ],
);

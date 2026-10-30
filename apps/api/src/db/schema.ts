import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
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

const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);
const bytea = customType<{ data: Uint8Array }>({
  dataType: () => "bytea",
});
const zeitpunkt = (name: string) => timestamp(name, { withTimezone: true });

export const abteilung = pgTable("abteilung", {
  id: id(),
  name: text("name").notNull(),
  // Steht nur in der Datenbank, nie im Repo
  googleKalenderId: text("google_kalender_id"),
  // Text für die Hilfe-Seite
  vertrauenspersonen: text("vertrauenspersonen"),
  syncOkAm: zeitpunkt("sync_ok_am"),
  syncFehler: text("sync_fehler"),
});

// Tabellen von better-auth: Der Adapter findet sie über den Export-Namen und ihre Spalten über die Eigenschaft, darum genau seine Namen
export const user = pgTable("user", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  // Bleibt leer; better-auth verlangt die Spalte
  image: text("image"),
  createdAt: zeitpunkt("created_at").notNull().defaultNow(),
  updatedAt: zeitpunkt("updated_at").notNull().defaultNow(),
  username: text("username").unique(),
  displayUsername: text("display_username"),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: zeitpunkt("ban_expires"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  abteilungId: uuid("abteilung_id")
    .notNull()
    .references(() => abteilung.id, { onDelete: "restrict" }),
  // Im Zweifel muss die Person das Passwort wechseln
  mussPasswortAendern: boolean("muss_passwort_aendern").notNull().default(true),
  startpasswortGueltigBis: zeitpunkt("startpasswort_gueltig_bis"),
  fehlversuche: integer("fehlversuche").notNull().default(0),
  naechsterVersuchAb: zeitpunkt("naechster_versuch_ab"),
  deaktiviertAm: zeitpunkt("deaktiviert_am"),
  telefon: text("telefon"),
  pushChat: boolean("push_chat").notNull().default(true),
  pushProgramme: boolean("push_programme").notNull().default(true),
  datenschutzGelesenAm: zeitpunkt("datenschutz_gelesen_am"),
});

export const session = pgTable(
  "session",
  {
    id: id(),
    expiresAt: zeitpunkt("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: zeitpunkt("created_at").notNull().defaultNow(),
    updatedAt: zeitpunkt("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Bleibt leer, es gibt keine Identitätsübernahme; better-auth verlangt die Spalte
    impersonatedBy: text("impersonated_by"),
  },
  (t) => [
    index("session_user_id_idx").on(t.userId),
    // better-auth verlangt beide Spalten; der Hook in auth.ts leert sie, und die Datenbank lehnt jeden Wert ab
    check(
      "session_ohne_ip_und_user_agent",
      sql`${t.ipAddress} is null and ${t.userAgent} is null`,
    ),
  ],
);

export const account = pgTable(
  "account",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: zeitpunkt("access_token_expires_at"),
    refreshTokenExpiresAt: zeitpunkt("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: zeitpunkt("created_at").notNull().defaultNow(),
    updatedAt: zeitpunkt("updated_at").notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: zeitpunkt("expires_at").notNull(),
    createdAt: zeitpunkt("created_at").notNull().defaultNow(),
    updatedAt: zeitpunkt("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const rateLimit = pgTable("rate_limit", {
  id: id(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  // Ohne Standardwert: Das Rate-Limit schreibt die Zeit immer selbst
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const twoFactor = pgTable(
  "two_factor",
  {
    id: id(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    // better-auth setzt hier keine Löschregel; ohne CASCADE scheitert das Löschen einer Person mit zweitem Faktor
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: zeitpunkt("locked_until"),
  },
  (t) => [
    index("two_factor_secret_idx").on(t.secret),
    index("two_factor_user_id_idx").on(t.userId),
  ],
);

// Umbenennbar, aber nicht löschbar: Die API-Rolle hat darauf kein DELETE (Migration 0001)
export const stufe = pgTable("stufe", {
  id: id(),
  abteilungId: uuid("abteilung_id")
    .notNull()
    .references(() => abteilung.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  kuerzel: text("kuerzel").notNull(),
  reihenfolge: integer("reihenfolge").notNull(),
});

// Dass Person, Kind und Stufe zur selben Abteilung gehören, prüfen die Routen, nicht die Datenbank
export const rolle = pgTable(
  "rolle",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stufeId: uuid("stufe_id")
      .notNull()
      .references(() => stufe.id, { onDelete: "restrict" }),
    typ: text("typ", { enum: ["leitung", "stufenleitung"] }).notNull(),
    erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.stufeId] }),
    // text({ enum }) prüft nur in TypeScript, nicht in der Datenbank
    check("rolle_typ_check", sql`${t.typ} in ('leitung', 'stufenleitung')`),
  ],
);

export const kind = pgTable("kind", {
  id: id(),
  abteilungId: uuid("abteilung_id")
    .notNull()
    .references(() => abteilung.id, { onDelete: "restrict" }),
  vorname: text("vorname").notNull(),
  nachname: text("nachname").notNull(),
  stufeId: uuid("stufe_id")
    .notNull()
    .references(() => stufe.id, { onDelete: "restrict" }),
  stufeSeit: zeitpunkt("stufe_seit").notNull().defaultNow(),
  // Ohne Datum ist das Kind aktiv
  inaktivSeit: zeitpunkt("inaktiv_seit"),
});

export const kindEltern = pgTable(
  "kind_eltern",
  {
    kindId: uuid("kind_id")
      .notNull()
      .references(() => kind.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.kindId, t.userId] })],
);

export const programm = pgTable(
  "programm",
  {
    id: id(),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    googleEventId: text("google_event_id").notNull(),
    // Roher recurringEventId; #28 kürzt den Stamm (_R…) erst beim Suchen
    googleSerie: text("google_serie"),
    titel: text("titel").notNull(),
    ganztaegig: boolean("ganztaegig").notNull(),
    beginn: zeitpunkt("beginn"),
    ende: zeitpunkt("ende"),
    tagVon: date("tag_von"),
    // Googles Enddatum ist exklusiv; hier steht der letzte Programmtag
    tagBis: date("tag_bis"),
    googleOrt: text("google_ort"),
    // Aus dem HTML der Google-Beschreibung; gilt als intern, Eltern sehen sie nie
    googleBeschreibung: text("google_beschreibung"),
    status: text("status", { enum: ["aktiv", "abgesagt", "pruefen"] })
      .notNull()
      .default("aktiv"),
    // Fail-closed: Neues bleibt intern, bis SL oder Admin zuordnen
    sichtbarkeit: text("sichtbarkeit", {
      enum: ["intern", "leitende", "eltern"],
    })
      .notNull()
      .default("intern"),
  },
  (t) => [
    unique("programm_abteilung_google_event_eindeutig").on(
      t.abteilungId,
      t.googleEventId,
    ),
    check(
      "programm_status_check",
      sql`${t.status} in ('aktiv', 'abgesagt', 'pruefen')`,
    ),
    check(
      "programm_sichtbarkeit_check",
      sql`${t.sichtbarkeit} in ('intern', 'leitende', 'eltern')`,
    ),
    // Ganztägig genau dann, wenn Tage gesetzt und Zeitpunkte leer sind
    check(
      "programm_zeiten_passen_zu_ganztaegig",
      sql`(${t.ganztaegig} and ${t.tagVon} is not null and ${t.tagBis} is not null and ${t.beginn} is null and ${t.ende} is null) or (not ${t.ganztaegig} and ${t.beginn} is not null and ${t.ende} is not null and ${t.tagVon} is null and ${t.tagBis} is null)`,
    ),
  ],
);

// Von der Webseite der Stufe abgerufen (kalender/eckdaten-sync.ts), nicht aus dem Kalender: Der Kalender-Upsert berührt sie nie.
// Der Schlüssel ist Stufe und Tag; die Route hängt sie über beides an das Programm
export const programmEckdaten = pgTable(
  "programm_eckdaten",
  {
    stufeId: uuid("stufe_id")
      .notNull()
      .references(() => stufe.id, { onDelete: "restrict" }),
    tag: date("tag").notNull(),
    treffpunkt: text("treffpunkt"),
    schlussOrt: text("schluss_ort"),
    // HH:mm
    schlussZeit: text("schluss_zeit"),
    mitnehmen: text("mitnehmen"),
    abgerufenAm: zeitpunkt("abgerufen_am").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.stufeId, t.tag] })],
);

export const programmStufe = pgTable(
  "programm_stufe",
  {
    programmId: uuid("programm_id")
      .notNull()
      .references(() => programm.id, { onDelete: "cascade" }),
    stufeId: uuid("stufe_id")
      .notNull()
      .references(() => stufe.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.programmId, t.stufeId] })],
);

// Ohne Zeile gilt «offen»; ein Kind ohne Antwort ist keine Absage
export const teilnahme = pgTable(
  "teilnahme",
  {
    programmId: uuid("programm_id")
      .notNull()
      .references(() => programm.id, { onDelete: "cascade" }),
    kindId: uuid("kind_id")
      .notNull()
      .references(() => kind.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["ja", "nein"] }).notNull(),
    geaendertVon: uuid("geaendert_von").references(() => user.id, {
      onDelete: "set null",
    }),
    geaendertAm: zeitpunkt("geaendert_am").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.programmId, t.kindId] }),
    // text({ enum }) prüft nur in TypeScript, nicht in der Datenbank
    check("teilnahme_status_check", sql`${t.status} in ('ja', 'nein')`),
  ],
);

// Keine Zeile heisst «offen»; dass die Person Leitung einer Stufe des Programms ist, prüft die Route
export const leitungAnmeldung = pgTable(
  "leitung_anmeldung",
  {
    programmId: uuid("programm_id")
      .notNull()
      .references(() => programm.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["ja", "nein"] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.programmId, t.userId] }),
    // text({ enum }) prüft nur in TypeScript, nicht in der Datenbank
    check("leitung_anmeldung_status_check", sql`${t.status} in ('ja', 'nein')`),
  ],
);

// Mitgliedschaften stehen in keiner Tabelle; rechte.ts leitet sie aus Rollen und Kindern ab
export const chat = pgTable(
  "chat",
  {
    id: id(),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    typ: text("typ", { enum: ["stufe", "direkt"] }).notNull(),
    stufeId: uuid("stufe_id")
      .notNull()
      .references(() => stufe.id, { onDelete: "restrict" }),
    // Nur bei typ direkt: das Elternteil des Einzelchats
    elternUserId: uuid("eltern_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    // NULL gilt im UNIQUE als verschieden, darum Teilindizes statt unique()
    uniqueIndex("chat_gruppe_pro_stufe")
      .on(t.stufeId)
      .where(sql`${t.typ} = 'stufe'`),
    uniqueIndex("chat_direkt_pro_eltern")
      .on(t.stufeId, t.elternUserId)
      .where(sql`${t.typ} = 'direkt'`),
    check("chat_typ_check", sql`${t.typ} in ('stufe', 'direkt')`),
    check(
      "chat_eltern_nur_direkt",
      sql`(${t.typ} = 'stufe') = (${t.elternUserId} is null)`,
    ),
  ],
);

export const nachricht = pgTable("nachricht", {
  id: id(),
  chatId: uuid("chat_id")
    .notNull()
    .references(() => chat.id, { onDelete: "cascade" }),
  autorId: uuid("autor_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  programmId: uuid("programm_id").references(() => programm.id, {
    onDelete: "set null",
  }),
  erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
});

// Eine Zeile entsteht erst mit dem ersten Lesen, darum gelesen_bis NOT NULL
export const chatStatus = pgTable(
  "chat_status",
  {
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    gelesenBis: zeitpunkt("gelesen_bis").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chatId, t.userId] })],
);

export const blockierung = pgTable(
  "blockierung",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    blockiertId: uuid("blockiert_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.blockiertId] })],
);

// Ein Token pro Sitzung; endet die Sitzung (Abmelden, überall abmelden, Deaktivieren, Konto löschen, täglicher Job), nimmt CASCADE das Token mit
export const pushToken = pgTable(
  "push_token",
  {
    sessionId: uuid("session_id")
      .primaryKey()
      .references(() => session.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    plattform: text("plattform", { enum: ["ios", "android"] }).notNull(),
    zuletztGesehen: zeitpunkt("zuletzt_gesehen").notNull().defaultNow(),
  },
  (t) => [
    // text({ enum }) prüft nur in TypeScript, nicht in der Datenbank
    check(
      "push_token_plattform_check",
      sql`${t.plattform} in ('ios', 'android')`,
    ),
  ],
);

// akteur_id und ziel_id ohne Fremdschlüssel, damit das Log Löschungen übersteht
export const auditLog = pgTable("audit_log", {
  id: id(),
  abteilungId: uuid("abteilung_id")
    .notNull()
    .references(() => abteilung.id, { onDelete: "restrict" }),
  // UUID einer Person, «cli» für die Kommandozeile, die kein Konto hat, oder «system» für die automatische Zuordnung des Kalender-Syncs
  akteurId: text("akteur_id").notNull(),
  aktion: text("aktion").notNull(),
  zielTyp: text("ziel_typ").notNull(),
  zielId: uuid("ziel_id").notNull(),
  // Ohne Personendaten
  details: jsonb("details"),
  erstelltAm: zeitpunkt("erstellt_am").notNull().defaultNow(),
});

// Das Profilbild einer Person (#173): höchstens eines, vom Server auf 256 × 256 JPEG neu kodiert; die Zeile geht mit dem Konto
export const profilbild = pgTable(
  "profilbild",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    inhalt: bytea("inhalt").notNull(),
    geaendertAm: zeitpunkt("geaendert_am").notNull().defaultNow(),
  },
  (t) => [
    // Die Route kodiert auf rund 20 KB; die Grenze fängt einen Fehler im Code ab, bevor die Tabelle wächst
    check("profilbild_inhalt_klein", sql`octet_length(${t.inhalt}) <= 262144`),
  ],
);

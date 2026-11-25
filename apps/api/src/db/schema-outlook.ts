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
  uuid,
} from "drizzle-orm/pg-core";
// Zyklus mit schema.ts (das diese Datei weiterreicht), harmlos: Die Verweise stehen nur in Funktionen, die erst beim Aufbau der Fremdschlüssel laufen
import { abteilung, programm } from "./schema.js";

const zeitpunkt = (name: string) => timestamp(name, { withTimezone: true });

// Schreibanbindung an den Outlook-Kalender (#835): die Verbindung einer Abteilung. refresh_token ist das Geheimnis der delegierten Anmeldung und steht nur verschlüsselt hier (outlook/geheimnis.ts), nie im Repo, nie in einem Log oder einer Antwort.
// kategorien_offen: Die Kategorienliste des Postfachs ist noch nachzuführen (Tag angelegt, umbenannt, gelöscht); der Lauf holt es nach, mit Backoff über versuche und naechster_versuch.
export const outlookVerbindung = pgTable(
  "outlook_verbindung",
  {
    abteilungId: uuid("abteilung_id")
      .primaryKey()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    refreshToken: text("refresh_token").notNull(),
    // «abgelaufen»: Microsoft hat das Token widerrufen oder es ist verfallen; Cevi OS schreibt nicht mehr, bis die Verbindung neu hergestellt ist
    status: text("status", { enum: ["aktiv", "abgelaufen"] })
      .notNull()
      .default("aktiv"),
    verbundenAm: zeitpunkt("verbunden_am").notNull().defaultNow(),
    erneuertAm: zeitpunkt("erneuert_am"),
    kategorienOffen: boolean("kategorien_offen").notNull().default(true),
    // UUID der Person, «cli» oder «system»: wer das Nachführen zuletzt ausgelöst hat (für den Audit-Eintrag)
    akteurId: text("akteur_id").notNull().default("cli"),
    versuche: integer("versuche").notNull().default(0),
    naechsterVersuch: zeitpunkt("naechster_versuch").notNull().defaultNow(),
    // Fester Code (outlook/fehler.ts), nie Text der Antwort von Microsoft
    letzterFehler: text("letzter_fehler"),
  },
  (t) => [
    check(
      "outlook_verbindung_status_check",
      sql`${t.status} in ('aktiv', 'abgelaufen')`,
    ),
  ],
);

// Kategorien, die Cevi OS selbst in der Liste des Postfachs angelegt hat: Nur diese räumt Cevi OS wieder weg (#835)
export const outlookKategorie = pgTable(
  "outlook_kategorie",
  {
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    // Kleingeschrieben und getrimmt, wie der Vergleich mit den Tags
    nameKlein: text("name_klein").notNull(),
    name: text("name").notNull(),
    outlookId: text("outlook_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.abteilungId, t.nameKlein] })],
);

// Eine Änderung der Tags eines Termins, die nach Outlook gehört (#835). Die Zeile ist zugleich Schutz: Solange sie steht, rechnet der Lese-Abgleich die Tags dieses Termins nicht aus den (noch alten) Kategorien des Feeds neu. Sie fällt weg, sobald der Feed die Änderung zeigt, spätestens nach 24 Stunden (dann gewinnt Outlook).
// geschrieben_am leer: Outlook ist noch nachzuführen (versuche und naechster_versuch steuern den Backoff)
export const outlookAenderung = pgTable(
  "outlook_aenderung",
  {
    programmId: uuid("programm_id")
      .primaryKey()
      .references(() => programm.id, { onDelete: "cascade" }),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilung.id, { onDelete: "restrict" }),
    akteurId: text("akteur_id").notNull(),
    geaendertAm: zeitpunkt("geaendert_am").notNull().defaultNow(),
    geschriebenAm: zeitpunkt("geschrieben_am"),
    versuche: integer("versuche").notNull().default(0),
    naechsterVersuch: zeitpunkt("naechster_versuch").notNull().defaultNow(),
    letzterFehler: text("letzter_fehler"),
  },
  (t) => [
    index("outlook_aenderung_offen_idx")
      .on(t.abteilungId, t.naechsterVersuch)
      .where(sql`${t.geschriebenAm} is null`),
  ],
);

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { auditLog, kalenderToken, user } from "../db/schema.js";

// Persönlicher ICS-Token (TC1 #437). Der Klartext lebt nur in der Antwort von erzeuge(); die Datenbank hält den SHA-256-Hash (256 Bit Zufall, ein Passwort-Hash wäre unnötig langsam) und die letzten vier Zeichen für die Anzeige. Er steht nie in Log, Audit oder Fehlermeldung: Dieses Modul loggt nichts und gibt ihn nur zurück.

// 32 Byte als base64url, ohne Füllzeichen
export const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
// Wie lange eine widerrufene Zeile stehen bleibt, bevor der tägliche Lauf sie entfernt
export const WIDERRUFEN_TAGE = 30;
// Der Feed schreibt «zuletzt abgerufen» höchstens einmal in diesem Abstand
const ABRUF_ABSTAND = "1 hour";

export const pfadFuer = (token: string) => `/ical/${token}.ics`;
const hashVon = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export type Kalenderlink = {
  aktiv: boolean;
  erstelltAm: Date | null;
  zuletztAbgerufenAm: Date | null;
  endung: string | null;
};

// Eine Abfrage; die Zeile mit widerrufen_am wird nie gezeigt
export async function ladeStatus(
  db: Db,
  userId: string,
): Promise<Kalenderlink> {
  const [zeile] = await db
    .select({
      erstelltAm: kalenderToken.erstelltAm,
      zuletztAbgerufenAm: kalenderToken.zuletztAbgerufenAm,
      endung: kalenderToken.endung,
    })
    .from(kalenderToken)
    .where(
      and(eq(kalenderToken.userId, userId), isNull(kalenderToken.widerrufenAm)),
    );
  return zeile
    ? { aktiv: true, ...zeile }
    : {
        aktiv: false,
        erstelltAm: null,
        zuletztAbgerufenAm: null,
        endung: null,
      };
}

// Erzeugt einen neuen Token und widerruft den aktiven (sofort ungültig), in einer Transaktion. Die Zeile der Person wird gesperrt, damit zwei gleichzeitige Aufrufe nicht am Unique-Index scheitern, sondern nacheinander laufen. Audit ohne Token
export async function erzeuge(
  db: Db,
  person: { id: string; abteilungId: string },
) {
  const token = randomBytes(32).toString("base64url");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from ${user} where id = ${person.id} for update`,
    );
    const alte = await tx
      .update(kalenderToken)
      .set({ widerrufenAm: sql`now()` })
      .where(
        and(
          eq(kalenderToken.userId, person.id),
          isNull(kalenderToken.widerrufenAm),
        ),
      )
      .returning({ id: kalenderToken.id });
    const [neu] = await tx
      .insert(kalenderToken)
      .values({
        userId: person.id,
        tokenHash: hashVon(token),
        endung: token.slice(-4),
      })
      .returning({
        id: kalenderToken.id,
        erstelltAm: kalenderToken.erstelltAm,
        endung: kalenderToken.endung,
      });
    await tx.insert(auditLog).values([
      ...alte.map((a) => ({
        abteilungId: person.abteilungId,
        akteurId: person.id,
        aktion: "ical_token_widerrufen",
        zielTyp: "kalender_token",
        zielId: a.id,
      })),
      {
        abteilungId: person.abteilungId,
        akteurId: person.id,
        aktion: "ical_token_erzeugt",
        zielTyp: "kalender_token",
        zielId: neu!.id,
      },
    ]);
    return { token, erstelltAm: neu!.erstelltAm, endung: neu!.endung };
  });
}

// Widerruft den aktiven Token; ohne aktiven geschieht nichts (idempotent)
export async function widerrufe(
  db: Db,
  person: { id: string; abteilungId: string },
) {
  await db.transaction(async (tx) => {
    const alte = await tx
      .update(kalenderToken)
      .set({ widerrufenAm: sql`now()` })
      .where(
        and(
          eq(kalenderToken.userId, person.id),
          isNull(kalenderToken.widerrufenAm),
        ),
      )
      .returning({ id: kalenderToken.id });
    if (alte.length === 0) return;
    await tx.insert(auditLog).values(
      alte.map((a) => ({
        abteilungId: person.abteilungId,
        akteurId: person.id,
        aktion: "ical_token_widerrufen",
        zielTyp: "kalender_token",
        zielId: a.id,
      })),
    );
  });
}

// Für den Feed (#438): liefert die Person, zu der ein aktiver Token eines aktiven Kontos gehört, sonst null (unbekannt, widerrufen, deaktiviertes Konto sehen gleich aus). Eine Abfrage; «zuletzt abgerufen» wird höchstens einmal je Stunde geschrieben, damit der Feed die Datenbank nicht bei jedem Abruf beschreibt. Wer das Format nicht prüft, spart sich mit TOKEN_FORMAT die Abfrage
export async function pruefeToken(
  db: Db,
  token: string,
): Promise<{ userId: string; abteilungId: string } | null> {
  if (!TOKEN_FORMAT.test(token)) return null;
  const hash = hashVon(token);
  const zeilen = await db.execute<{
    user_id: string;
    abteilung_id: string;
    token_hash: string;
  }>(sql`
    with t as (
      select k.id, k.user_id, k.token_hash, k.zuletzt_abgerufen_am, u.abteilung_id
      from kalender_token k
      join "user" u on u.id = k.user_id
      where k.token_hash = ${hash} and k.widerrufen_am is null
        and u.deaktiviert_am is null and u.banned is not true
    ),
    w as (
      update kalender_token set zuletzt_abgerufen_am = now()
      where id in (
        select id from t
        where zuletzt_abgerufen_am is null
          or zuletzt_abgerufen_am < now() - ${ABRUF_ABSTAND}::interval
      )
    )
    select user_id, abteilung_id, token_hash from t`);
  const zeile = zeilen[0];
  // Die Suche lief über den Hash; der Vergleich in konstanter Zeit ist die zweite Absicherung
  if (
    !zeile ||
    !timingSafeEqual(Buffer.from(zeile.token_hash), Buffer.from(hash))
  ) {
    return null;
  }
  return { userId: zeile.user_id, abteilungId: zeile.abteilung_id };
}

// Täglicher Lauf: entfernt widerrufene Zeilen nach 30 Tagen; liefert ihre Zahl
export async function loescheWiderrufene(db: Db) {
  const weg = await db
    .delete(kalenderToken)
    .where(
      and(
        isNotNull(kalenderToken.widerrufenAm),
        lt(
          kalenderToken.widerrufenAm,
          sql`now() - make_interval(days => ${WIDERRUFEN_TAGE})`,
        ),
      ),
    )
    .returning({ id: kalenderToken.id });
  return weg.length;
}

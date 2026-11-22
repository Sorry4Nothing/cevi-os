import type { Context } from "hono";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  lager,
  lagerBenachrichtigung,
  lagerBenachrichtigungEinstellung,
  lagerMitglied,
  user,
} from "../db/schema.js";
import { sendePush, type Fcm } from "../push.js";
import { ARTEN, type BenachrichtigungsArt } from "./benachrichtigung-arten.js";

// Benachrichtigungen des Lagers (#369): Jedes Modul, das jemanden benachrichtigt, ruft benachrichtige() in seiner Schreib-Transaktion auf und senden() nach dem Commit:
//
//   const zustellung = await db.transaction(async (tx) => {
//     ...Änderung schreiben...
//     return benachrichtige(tx, {
//       lagerId, empfaengerIds: [aufgabe.verantwortlichPersonId],
//       art: "aufgabe_zugeteilt", objekt: { typ: "aufgabe", id: aufgabe.id },
//       ausgeloestVon: person.id,
//     });
//   });
//   await zustellung.senden({ db, fcm, c });
//
// Die Routen des Moduls bekommen fcm wie die Chat-Routen über ihre Fabrik. Rollback nimmt die Zeilen mit; ohne senden() geht nichts hinaus.

// Eine Transaktion (oder die Datenbank selbst)
type Schreiber = Pick<Db, "select" | "insert">;

export type BenachrichtigungObjekt = {
  // Was die App öffnet, zum Beispiel «aufgabe»; steht in der Liste, nie im Push
  typ: string;
  id: string;
};

export type Zustellung = {
  // Wer eine Zeile bekommen hat (Mitglieder des Lagers mit eingeschalteter Art, ohne den Auslöser)
  empfaengerIds: string[];
  // Pusht nach dem Commit. Wirft nie: Ein Fehler beim Push lässt die gespeicherte Änderung stehen
  senden(ctx: { db: Db; fcm?: Fcm; c?: Context }): Promise<void>;
};

const NICHTS: Zustellung = { empfaengerIds: [], senden: async () => {} };

// Empfänger sind nur aktive Mitglieder des Lagers aus dessen Abteilung: Eine fremde ID in empfaengerIds bekommt nichts. Wer die Art abgeschaltet hat, bekommt weder Zeile noch Push; der Auslöser nie
export async function benachrichtige(
  tx: Schreiber,
  {
    lagerId,
    empfaengerIds,
    art,
    objekt,
    ausgeloestVon,
  }: {
    lagerId: string;
    empfaengerIds: string[];
    art: BenachrichtigungsArt;
    objekt: BenachrichtigungObjekt;
    ausgeloestVon?: string;
  },
): Promise<Zustellung> {
  const kandidaten = [...new Set(empfaengerIds)].filter(
    (id) => id !== ausgeloestVon,
  );
  if (kandidaten.length === 0) return NICHTS;

  const mitglieder = await tx
    .select({ id: user.id, titel: lager.titel })
    .from(lagerMitglied)
    .innerJoin(lager, eq(lager.id, lagerMitglied.lagerId))
    .innerJoin(
      user,
      and(
        eq(user.id, lagerMitglied.personId),
        eq(user.abteilungId, lager.abteilungId),
      ),
    )
    .where(
      and(
        eq(lagerMitglied.lagerId, lagerId),
        inArray(lagerMitglied.personId, kandidaten),
        isNull(user.deaktiviertAm),
        sql`coalesce(${user.banned}, false) = false`,
      ),
    );
  if (mitglieder.length === 0) return NICHTS;

  const aus = await tx
    .select({ id: lagerBenachrichtigungEinstellung.personId })
    .from(lagerBenachrichtigungEinstellung)
    .where(
      and(
        eq(lagerBenachrichtigungEinstellung.art, art),
        eq(lagerBenachrichtigungEinstellung.aktiv, false),
        inArray(
          lagerBenachrichtigungEinstellung.personId,
          mitglieder.map((m) => m.id),
        ),
      ),
    );
  const abgeschaltet = new Set(aus.map((z) => z.id));
  const ids = mitglieder.map((m) => m.id).filter((id) => !abgeschaltet.has(id));
  if (ids.length === 0) return NICHTS;

  await tx.insert(lagerBenachrichtigung).values(
    ids.map((personId) => ({
      lagerId,
      personId,
      art,
      objektTyp: objekt.typ,
      objektId: objekt.id,
    })),
  );

  const lagerTitel = mitglieder[0]!.titel;
  return {
    empfaengerIds: ids,
    async senden(ctx) {
      try {
        // Nur der feste Titel der Art und der Lagertitel: nie ein Name, ein Aufgabentitel oder ein Inhalt
        await sendePush(ctx, ids, {
          typ: ARTEN[art].push,
          id: objekt.id,
          titel: ARTEN[art].titel,
          text: lagerTitel,
        });
      } catch {
        // sendePush wirft nie; das hier hält die Zusage auch für eine künftige Änderung
      }
    },
  };
}

// Gelesene Einträge bleiben so lange für die Glocke (Annahme, im PR zu bestätigen); ungelesene bleiben, bis das Lager gelöscht wird
export const GELESEN_AUFBEWAHRUNG_TAGE = 90;

export async function loescheGeleseneBenachrichtigungen(
  db: Db,
  jetzt = new Date(),
) {
  const grenze = new Date(
    jetzt.getTime() - GELESEN_AUFBEWAHRUNG_TAGE * 24 * 60 * 60 * 1000,
  );
  const geloescht = await db
    .delete(lagerBenachrichtigung)
    .where(lt(lagerBenachrichtigung.gelesenAm, grenze))
    .returning({ id: lagerBenachrichtigung.id });
  return geloescht.length;
}

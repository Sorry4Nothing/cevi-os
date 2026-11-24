import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  personPlattformRolle,
  personTag,
  session,
  user,
} from "../db/schema.js";
import type { Person } from "../rechte.js";
import { RECHT_IDS } from "./katalog.js";
import { ladePerson } from "./person.js";
import { ladeRechteSatz } from "./satz.js";

// Zweiter Faktor als Pflicht für die Verwaltung (#715): Die Abteilungsleitung und jede Person mit einem Recht, das den zweiten Faktor verlangt (Risiko «erweitert» oder «fest», ausser der Arbeit der Stufenleitung an der eigenen Stufenseite). Der Entwickler hat solche Rechte. Ohne Objekt gefragt: Gibt es ein Recht irgendwo?
export async function brauchtFaktorFuerVerwaltung(
  db: Pick<Db, "execute">,
  person: Person,
): Promise<boolean> {
  if (person.abteilungsleitung) return true;
  const satz = await ladeRechteSatz(db, person);
  return RECHT_IDS.some((r) => satz.hat(r) && satz.braucht2Faktor(r));
}

// Nach einer Änderung der Rechte: Wer den zweiten Faktor jetzt braucht und keinen hat, wird abgemeldet, damit er sich neu anmeldet und die Einrichtung sieht (der Faktor gilt in der Verwaltung, die Sitzung vom Rechtewechsel wüsste nichts davon). Wer ihn schon hat oder ihn nicht braucht, bleibt angemeldet. Nach dem Commit der Änderung aufrufen; gibt die Zahl der abgemeldeten Personen zurück
export async function beendeSitzungenBeiNeuerPflicht(
  db: Db,
  abteilungId: string,
  userIds: readonly string[],
): Promise<number> {
  let abgemeldet = 0;
  for (const id of new Set(userIds)) {
    const person = await ladePerson(db, abteilungId, id);
    if (!person || person.zweiterFaktor) continue;
    if (!(await brauchtFaktorFuerVerwaltung(db, person))) continue;
    await db.delete(session).where(eq(session.userId, id));
    abgemeldet += 1;
  }
  return abgemeldet;
}

// Die Personen einer Abteilung, die diese Plattformrolle tragen
export async function personenDerPlattformRolle(
  db: Pick<Db, "select">,
  abteilungId: string,
  rolleId: string,
): Promise<string[]> {
  const zeilen = await db
    .select({ id: personPlattformRolle.userId })
    .from(personPlattformRolle)
    .innerJoin(user, eq(user.id, personPlattformRolle.userId))
    .where(
      and(
        eq(personPlattformRolle.rolleId, rolleId),
        eq(user.abteilungId, abteilungId),
      ),
    );
  return zeilen.map((z) => z.id);
}

// Die Personen einer Abteilung, die diese Gruppenrolle tragen
export async function personenDerGruppenrolle(
  db: Pick<Db, "select">,
  abteilungId: string,
  rolleId: string,
): Promise<string[]> {
  const zeilen = await db
    .select({ id: personTag.userId })
    .from(personTag)
    .innerJoin(user, eq(user.id, personTag.userId))
    .where(
      and(eq(personTag.rolleId, rolleId), eq(user.abteilungId, abteilungId)),
    );
  return zeilen.map((z) => z.id);
}

import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { istAbteilungsleitungSql } from "../admins.js";
import { rolle, stufe, user } from "../db/schema.js";
import type { Person } from "../rechte.js";

// Die Person einer Abteilung als Person-Objekt, wie personAusSitzung es aus der Sitzung baut: für «Was darf wer?» (die Rechte einer anderen Person). Fremde und unbekannte Personen sind undefined (die Route antwortet 404). Zwei Abfragen
export async function ladePerson(
  db: Pick<Db, "select">,
  abteilungId: string,
  userId: string,
): Promise<(Person & { name: string }) | undefined> {
  const [konto] = await db
    .select({
      id: user.id,
      name: user.name,
      twoFactorEnabled: user.twoFactorEnabled,
      abteilungsleitung: istAbteilungsleitungSql(user.id),
    })
    .from(user)
    .where(and(eq(user.id, userId), eq(user.abteilungId, abteilungId)));
  if (!konto) return undefined;
  const rollen = await db
    .select({ stufeId: rolle.stufeId, typ: rolle.typ })
    .from(rolle)
    .innerJoin(
      stufe,
      and(eq(rolle.stufeId, stufe.id), eq(stufe.abteilungId, abteilungId)),
    )
    .where(eq(rolle.userId, userId));
  return {
    id: konto.id,
    name: konto.name,
    abteilungId,
    admin: konto.abteilungsleitung,
    zweiterFaktor: konto.twoFactorEnabled === true,
    rollen,
  };
}

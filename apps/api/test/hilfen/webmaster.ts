import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { legeWebmasterAn, type PlattformRecht } from "../../src/plattform.js";

// Die Fabrik der Tests legt Abteilungen ohne die Vorgabe «Webmaster» an (die CLI und die Migration tun es sonst). Legt sie bei Bedarf an und gibt ihre ID
export async function webmasterRolle(db: Db, abteilungId: string) {
  const suche = () =>
    db
      .select({ id: schema.plattformRolle.id })
      .from(schema.plattformRolle)
      .where(
        and(
          eq(schema.plattformRolle.abteilungId, abteilungId),
          eq(schema.plattformRolle.schluessel, "webmaster"),
        ),
      );
  let [zeile] = await suche();
  if (!zeile) {
    await legeWebmasterAn(db, abteilungId);
    [zeile] = await suche();
  }
  return zeile.id;
}

// Gibt der Person die Vorgabe «Webmaster» (alle Rechte ausser dem Wartungsmodus). Mit «rechte»: eine eigene Rolle mit genau diesen Rechten, ein eingeschränkter Webmaster
export async function macheWebmaster(
  db: Db,
  abteilungId: string,
  userId: string,
  rechte?: readonly PlattformRecht[],
) {
  let rolleId: string;
  if (rechte) {
    const [rolle] = await db
      .insert(schema.plattformRolle)
      .values({ abteilungId, name: `Eingeschränkt ${randomUUID()}` })
      .returning({ id: schema.plattformRolle.id });
    rolleId = rolle.id;
    if (rechte.length > 0) {
      await db
        .insert(schema.plattformRolleRecht)
        .values(rechte.map((recht) => ({ rolleId, recht })));
    }
  } else {
    rolleId = await webmasterRolle(db, abteilungId);
  }
  await db.insert(schema.personPlattformRolle).values({ userId, rolleId });
}

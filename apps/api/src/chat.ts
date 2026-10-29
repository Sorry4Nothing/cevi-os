import type { Db } from "./db/client.js";
import { chat } from "./db/schema.js";

// Der Gruppenchat einer Stufe; idempotent über den Teilindex chat_gruppe_pro_stufe. Akzeptiert auch eine Transaktion (db.transaction(tx => …))
export async function legeGruppenchatAn(
  db: Pick<Db, "insert">,
  { abteilungId, stufeId }: { abteilungId: string; stufeId: string },
) {
  await db
    .insert(chat)
    .values({ abteilungId, typ: "stufe", stufeId })
    .onConflictDoNothing();
}

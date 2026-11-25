import { eq, sql as roh } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { outlookVerbindung } from "../db/schema.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Ein Tag wurde angelegt, umbenannt oder gelöscht: Die Kategorienliste des Postfachs ist nachzuführen (#835). Läuft in der Transaktion der Änderung; der Lauf im Hintergrund macht den Rest, auch nach einem Ausfall. Ohne Verbindung der Abteilung tut es nichts: «npm run kalender:outlook-abgleichen» holt dann alles nach.
export async function meldeKategorienAenderung(
  tx: Tx,
  abteilungId: string,
  akteurId: string,
) {
  await tx
    .update(outlookVerbindung)
    .set({
      kategorienOffen: true,
      versuche: 0,
      naechsterVersuch: roh`now()`,
      akteurId,
    })
    .where(eq(outlookVerbindung.abteilungId, abteilungId));
}

import { HTTPException } from "hono/http-exception";
import type { Db } from "../db/client.js";
import type { Person } from "../rechte.js";
import { darf, verlange } from "./darf.js";
import type { Objekt } from "./satz.js";

type Lesbar = Pick<Db, "select" | "execute">;

// Wie verlange(), aber eines von mehreren Rechten genügt (zum Beispiel «Lädeli-Verwaltung ansehen» oder «Artikel pflegen» für die Artikelliste). Fehlen alle: 403. Hat die Person eines, gilt dessen zweiter Faktor (403 ZWEITER_FAKTOR_FEHLT) wie bei verlange(). Reihenfolge wie überall: Objekt laden (404) vor dem Aufruf
export async function verlangeEines(
  db: Lesbar,
  person: Person,
  rechte: readonly string[],
  objekt?: Objekt,
): Promise<void> {
  for (const recht of rechte) {
    if (await darf(db, person, recht, objekt)) {
      return verlange(db, person, recht, objekt);
    }
  }
  throw new HTTPException(403);
}

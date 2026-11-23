import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { abteilungsleitungRecht } from "../db/schema.js";
import { VERGEBBARE_RECHTE, type RechtId } from "./katalog.js";

// Die Rechte der Abteilungsleitung (#663): eine einstellbare Systemrolle je Abteilung. Die Abteilungsleitung ist technisch das Konto mit der Rolle «admin»; im Code und in der Oberfläche heisst sie Abteilungsleitung. Gespeichert sind nur die Abzüge (abteilungsleitung_recht.ohne): Standard sind alle vergebbaren Rechte, ein neues Recht im Katalog gilt für sie von selbst. Feste und strukturelle Rechte bleiben ihr immer, sonst könnte sich die Abteilung aussperren.

// Was die Abteilungsleitung der Abteilung heute hat: Version und Abzüge. Ohne Zeile (eine neue Abteilung) gilt der Standard in Version 1
export async function ladeAbteilungsleitung(
  db: Pick<Db, "select">,
  abteilungId: string,
) {
  const [zeile] = await db
    .select({
      ohne: abteilungsleitungRecht.ohne,
      version: abteilungsleitungRecht.version,
    })
    .from(abteilungsleitungRecht)
    .where(eq(abteilungsleitungRecht.abteilungId, abteilungId));
  return { version: zeile?.version ?? 1, ohne: zeile?.ohne ?? [] };
}

// Die Rechte, die sie hat, in der Reihenfolge des Katalogs; ein Name, den der Katalog nicht kennt, nimmt nichts weg
export const rechteDerAbteilungsleitung = (
  ohne: readonly string[],
): RechtId[] => VERGEBBARE_RECHTE.filter((r) => !ohne.includes(r));

// Speichert die neuen Abzüge, wenn die Version noch stimmt (sonst «konflikt»). Eine Abteilung ohne Zeile beginnt bei Version 1
export async function speichereAbteilungsleitung(
  tx: Pick<Db, "update" | "insert">,
  abteilungId: string,
  erwartet: number,
  ohne: readonly string[],
): Promise<number | "konflikt"> {
  const [zeile] = await tx
    .update(abteilungsleitungRecht)
    .set({
      ohne: [...ohne],
      version: sql`${abteilungsleitungRecht.version} + 1`,
      geaendertAm: sql`now()`,
    })
    .where(
      and(
        eq(abteilungsleitungRecht.abteilungId, abteilungId),
        eq(abteilungsleitungRecht.version, erwartet),
      ),
    )
    .returning({ version: abteilungsleitungRecht.version });
  if (zeile) return zeile.version;
  if (erwartet !== 1) return "konflikt";
  const [neu] = await tx
    .insert(abteilungsleitungRecht)
    .values({ abteilungId, ohne: [...ohne], version: 2 })
    .onConflictDoNothing()
    .returning({ version: abteilungsleitungRecht.version });
  return neu?.version ?? "konflikt";
}

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  gruppenRolle,
  gruppenRolleRecht,
  personTag,
  user,
} from "../db/schema.js";
import {
  GRUPPENROLLEN_RECHTE,
  kenntGeltung,
  type Geltung,
  type RechtId,
} from "./katalog.js";
import { systemrollenFuer, type Zuteilung } from "./standard.js";

// Gruppenrollen (#643): was die Routen der Matrix und das Anlegen einer Gruppe teilen

type Schreibbar = Pick<Db, "insert">;

// Eine neue Gruppe bekommt ihre Systemrollen samt Standardrechten (standard.ts): Stufe «Stufenleitung» und «Leitung», jede andere «Verantwortliche/r». Läuft in der Transaktion, die die Gruppe anlegt; fehlt der Aufruf, hat die Gruppe keine Systemrollen und der Freitext der Rolle gibt der neuen Gruppe keine Rechte (der alte Weg gilt weiter)
export async function legeSystemrollenAn(
  tx: Schreibbar,
  abteilungId: string,
  tagId: string,
  typ: string,
) {
  for (const r of systemrollenFuer(typ)) {
    const [zeile] = await tx
      .insert(gruppenRolle)
      .values({
        abteilungId,
        tagId,
        name: r.name,
        beschreibung: r.beschreibung,
        verantwortlich: r.verantwortlich,
        reihenfolge: r.reihenfolge,
        schluessel: r.schluessel,
      })
      .returning({ id: gruppenRolle.id });
    if (r.rechte.length > 0) {
      await tx.insert(gruppenRolleRecht).values(
        r.rechte.map((z) => ({
          rolleId: zeile.id,
          recht: z.recht,
          geltung: z.geltung,
        })),
      );
    }
  }
}

// Ein Recht mit seiner Geltung, wie die Routen es annehmen: das Recht aus den Gruppenrechten des Katalogs, die Geltung, die der Katalog dafür kennt; jedes Recht höchstens einmal
export const zuteilungSchema = z
  .strictObject({
    recht: z.enum(GRUPPENROLLEN_RECHTE as [RechtId, ...RechtId[]]),
    geltung: z.enum(["alle", "eigene"]),
  })
  .refine((z) => kenntGeltung(z.recht, z.geltung));

export const zuteilungenSchema = z
  .array(zuteilungSchema)
  .max(GRUPPENROLLEN_RECHTE.length)
  .refine((liste) => new Set(liste.map((z) => z.recht)).size === liste.length);

// In der Reihenfolge des Katalogs, damit zwei gleiche Mengen gleich aussehen
export function ordneZuteilungen(liste: readonly Zuteilung[]): Zuteilung[] {
  return GRUPPENROLLEN_RECHTE.flatMap((recht) =>
    liste.filter((z) => z.recht === recht),
  );
}

// Was sich ändert, ohne Personen: für das Audit und die Vorschau
export function unterschied(
  vorher: readonly Zuteilung[],
  nachher: readonly Zuteilung[],
) {
  const schluessel = (z: Zuteilung) => `${z.recht}:${z.geltung}`;
  const v = new Set(vorher.map(schluessel));
  const n = new Set(nachher.map(schluessel));
  return {
    hinzu: nachher.filter((z) => !v.has(schluessel(z))),
    weg: vorher.filter((z) => !n.has(schluessel(z))),
  };
}

// Die Mitglieder einer Rolle in einer Gruppe, mit Namen (nur für die Abteilungsleitung; die Route prüft). Eine Abfrage
export function mitgliederDerRollen(db: Pick<Db, "select">, tagId: string) {
  return db
    .select({ rolleId: personTag.rolleId, id: user.id, name: user.name })
    .from(personTag)
    .innerJoin(user, eq(user.id, personTag.userId))
    .where(
      and(eq(personTag.tagId, tagId), sql`${personTag.rolleId} is not null`),
    );
}

export type { Geltung };

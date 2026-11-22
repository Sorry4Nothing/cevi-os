import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { lager, lagerMitglied } from "../db/schema.js";
import type { Person } from "../rechte.js";
import {
  standardErlaubt,
  type LagerRecht,
  type LagerRolle,
} from "./rechte-katalog.js";

// Policy-Schicht des Lagers (#364): Jede Lager-Route unter /api/v1/lager hängt lagerZugriff() vor ihren Handler und fragt darin mit darf(). Die Reihenfolge ist fest und gleich wie in rechte.ts:
//   1. Lager laden, in SQL auf die Abteilung der Sitzung gefiltert: fremd oder unbekannt = 404
//   2. Mitgliedschaft: Nicht-Mitglied = 404 (die Abteilungsleitung gilt als Lagerleitung)
//   3. Recht (optionen.recht): fehlt es = 403
//   4. Schreibschutz: Ein abgeschlossenes oder archiviertes Lager lässt nur lesende Methoden zu = 409 LAGER_GESCHLOSSEN
// Die Rolle kommt bei jeder Anfrage aus lager_mitglied, nie aus Token oder Sitzung: Rollenwechsel und Entfernen wirken bei der nächsten Anfrage

export type LagerZeile = typeof lager.$inferSelect;

export type LagerZugriff = {
  lager: LagerZeile;
  // Wirksame Rolle: die Abteilungsleitung (person.admin) ist in der eigenen Abteilung immer Lagerleitung, auch mit einer anderen Zeile in lager_mitglied
  rolle: LagerRolle;
  // Gibt es eine Zeile in lager_mitglied? Die Abteilungsleitung braucht keine
  mitglied: boolean;
  // Abgeschlossen oder archiviert
  geschlossen: boolean;
};

export type LagerEnv = {
  Variables: { person: Person; lager: LagerZugriff };
};

export const istGeschlossen = (status: LagerZeile["status"]) =>
  status === "abgeschlossen" || status === "archiviert";

// Die Stelle, die L0b (#365) umbaut: Dann liest lagerZugriff() die Zeilen von lager_rolle_recht für (Lager, Rolle) in den Zugriff, und darf() bleibt synchron. Bis dahin gilt die Standardmatrix aus rechte-katalog.ts
export function darf(zugriff: Pick<LagerZugriff, "rolle">, recht: LagerRecht) {
  return standardErlaubt(zugriff.rolle, recht);
}

// undefined: Das Lager gibt es für diese Person nicht (fremde Abteilung, unbekannt oder Nicht-Mitglied); die Route antwortet 404
export async function ladeLagerZugriff(
  db: Db,
  person: Pick<Person, "id" | "abteilungId" | "admin">,
  lagerId: string,
): Promise<LagerZugriff | undefined> {
  const [zeile] = await db
    .select({ lager, rolle: lagerMitglied.rolle })
    .from(lager)
    .leftJoin(
      lagerMitglied,
      and(
        eq(lagerMitglied.lagerId, lager.id),
        eq(lagerMitglied.personId, person.id),
      ),
    )
    .where(
      and(eq(lager.id, lagerId), eq(lager.abteilungId, person.abteilungId)),
    );
  if (!zeile) return undefined;
  const rolle = person.admin ? "lagerleitung" : zeile.rolle;
  if (!rolle) return undefined;
  return {
    lager: zeile.lager,
    rolle,
    mitglied: zeile.rolle !== null,
    geschlossen: istGeschlossen(zeile.lager.status),
  };
}

const LESEND = new Set(["GET", "HEAD", "OPTIONS"]);
const lagerId = z.uuid();

export type LagerZugriffOptionen = {
  // Das Recht, das die Route braucht; ohne Angabe genügt die Mitgliedschaft
  recht?: LagerRecht;
  // Für die wenigen schreibenden Routen, die auch ein geschlossenes Lager ändern dürfen; sonst gilt der Schreibschutz für jede Methode ausser GET, HEAD und OPTIONS
  auchGeschlossen?: true;
};

// Der Pfad trägt die Lager-ID als «:id». Das Ergebnis liegt unter c.get("lager")
export function lagerZugriff(db: Db, optionen: LagerZugriffOptionen = {}) {
  return createMiddleware<LagerEnv>(async (c, next) => {
    const id = lagerId.safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(400);
    const zugriff = await ladeLagerZugriff(db, c.get("person"), id.data);
    if (!zugriff) throw new HTTPException(404);
    if (optionen.recht && !darf(zugriff, optionen.recht)) {
      throw new HTTPException(403);
    }
    if (
      zugriff.geschlossen &&
      !LESEND.has(c.req.method) &&
      !optionen.auchGeschlossen
    ) {
      return c.json(
        {
          code: "LAGER_GESCHLOSSEN",
          message: "Das Lager ist abgeschlossen und lässt sich nicht ändern.",
        },
        409,
      );
    }
    c.set("lager", zugriff);
    await next();
  });
}

import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { lager, lagerMitglied } from "../db/schema.js";
import { zweiterFaktorFehlt, type Person } from "../rechte.js";
import { ladeRollenRechte } from "./rechte.js";
import {
  istGeschlossen,
  RECHTE_KATALOG,
  standardErlaubt,
  type LagerRecht,
  type LagerRolle,
} from "./rechte-katalog.js";

// Policy-Schicht des Lagers (#364): Jede Lager-Route unter /api/v1/lager hängt lagerZugriff() vor ihren Handler und fragt darin mit darf(). Die Reihenfolge ist fest und gleich wie in rechte.ts:
//   1. Lager laden, in SQL auf die Abteilung der Sitzung gefiltert: fremd oder unbekannt = 404
//   2. Mitgliedschaft: Nicht-Mitglied = 404 (die Abteilungsleitung gilt als Lagerleitung)
//   2b. Die Lagerleitung (auch die Abteilungsleitung) braucht den zweiten Faktor: sonst 403 ZWEITER_FAKTOR_FEHLT (#423); leitung, team und lesen nicht
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
  // Die eingestellten Rechte dieser Rolle im Lager (lager_rolle_recht, #365): Recht -> erlaubt. Die Lagerleitung hat keine Einstellungen. Eine fehlende Zeile gilt als Standard (darf)
  rechte: ReadonlyMap<string, boolean>;
};

export type LagerEnv = {
  Variables: { person: Person; lager: LagerZugriff };
};

export { istGeschlossen };

// Ein eingestelltes Recht (lager_rolle_recht) gilt vor dem Standard des Katalogs; ohne Zeile gilt der Standard, ein unbekanntes Recht ist verboten. Die Lagerleitung hat immer jedes Recht des Katalogs und ist nicht einstellbar
export function darf(
  zugriff: Pick<LagerZugriff, "rolle"> & Partial<Pick<LagerZugriff, "rechte">>,
  recht: LagerRecht,
) {
  if (
    zugriff.rolle === "lagerleitung" ||
    !Object.hasOwn(RECHTE_KATALOG, recht)
  ) {
    return standardErlaubt(zugriff.rolle, recht);
  }
  return zugriff.rechte?.get(recht) ?? standardErlaubt(zugriff.rolle, recht);
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
    // Wirkt bei der nächsten Anfrage: Die Einstellungen werden bei jeder Anfrage gelesen, nie zwischengespeichert
    rechte:
      rolle === "lagerleitung"
        ? new Map()
        : await ladeRollenRechte(db, zeile.lager.id, rolle),
  };
}

const LESEND = new Set(["GET", "HEAD", "OPTIONS"]);
const lagerId = z.uuid();

export type LagerZugriffOptionen = {
  // Das Recht, das die Route braucht; ohne Angabe genügt die Mitgliedschaft
  recht?: LagerRecht;
  // Nur die Lagerleitung (und damit die Abteilungsleitung): für die festen Rechte, die sich nicht einstellen lassen, etwa die Rechte der Rollen selbst. Wie «recht»: fehlt sie, 403 vor dem Schreibschutz
  nurLagerleitung?: true;
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
    if (zugriff.rolle === "lagerleitung" && !c.get("person").zweiterFaktor) {
      return c.json(
        zweiterFaktorFehlt(
          "Für die Lagerleitung braucht es zuerst einen zweiten Faktor.",
        ),
        403,
      );
    }
    if (optionen.recht && !darf(zugriff, optionen.recht)) {
      throw new HTTPException(403);
    }
    if (optionen.nurLagerleitung && zugriff.rolle !== "lagerleitung") {
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

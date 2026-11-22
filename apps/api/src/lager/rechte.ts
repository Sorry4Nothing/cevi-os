import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { auditLog, lager, lagerRolleRecht } from "../db/schema.js";
import { ereignisverteiler } from "./ereignisse.js";
import {
  istGeschlossen,
  LAGER_RECHTE,
  RECHTE_KATALOG,
  standardErlaubt,
  type LagerRecht,
} from "./rechte-katalog.js";

// Einstellbare Rechte je Lager (#365): Lesen und Schreiben der Tabelle lager_rolle_recht. Die Policy (policy.ts) liest sie bei jeder Anfrage; die Routen (routes/lager/rechte.ts und routes/admin/lager-rechte.ts) lesen und ändern sie für die Lagerleitung und die Abteilungsleitung.
// Eingestellt werden nur Leitung, Team und Lesen; die Lagerleitung hat immer alles und keine Zeilen

export const EINSTELLBARE_ROLLEN = ["leitung", "team", "lesen"] as const;
export type EinstellbareRolle = (typeof EINSTELLBARE_ROLLEN)[number];

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type RechtEintrag = {
  rolle: EinstellbareRolle;
  recht: LagerRecht;
  erlaubt: boolean;
};

// Allowlist aus dem Katalog: Eine Einstellung setzt nur Rechte des Katalogs für die drei Rollen. «lagerleitung» und jedes andere Recht sind 400. Jedes Paar höchstens einmal, damit die Reihenfolge nichts entscheidet
export const rechteSchema = z
  .strictObject({
    rechte: z
      .array(
        z.strictObject({
          rolle: z.enum(EINSTELLBARE_ROLLEN),
          recht: z.enum(LAGER_RECHTE),
          erlaubt: z.boolean(),
        }),
      )
      .min(1)
      .max(EINSTELLBARE_ROLLEN.length * LAGER_RECHTE.length),
  })
  .refine(
    ({ rechte }) =>
      new Set(rechte.map((r) => `${r.rolle}/${r.recht}`)).size ===
      rechte.length,
  );

// Die Standardwerte des Katalogs als Einträge, alle Rollen mal alle Rechte
export const standardEintraege = (): RechtEintrag[] =>
  EINSTELLBARE_ROLLEN.flatMap((rolle) =>
    LAGER_RECHTE.map((recht) => ({
      rolle,
      recht,
      erlaubt: standardErlaubt(rolle, recht),
    })),
  );

// Beim Anlegen eines Lagers: die Standardwerte als Zeilen
export const schreibeStandardrechte = (d: Db | Tx, lagerId: string) =>
  d
    .insert(lagerRolleRecht)
    .values(standardEintraege().map((e) => ({ lagerId, ...e })));

// Recht -> erlaubt für eine Rolle; Zeilen mit einem Recht, das der Katalog nicht kennt, zählen nicht
export async function ladeRollenRechte(
  d: Db | Tx,
  lagerId: string,
  rolle: EinstellbareRolle,
): Promise<ReadonlyMap<string, boolean>> {
  const zeilen = await d
    .select({ recht: lagerRolleRecht.recht, erlaubt: lagerRolleRecht.erlaubt })
    .from(lagerRolleRecht)
    .where(
      and(
        eq(lagerRolleRecht.lagerId, lagerId),
        eq(lagerRolleRecht.rolle, rolle),
      ),
    );
  return new Map(
    zeilen
      .filter((z) => Object.hasOwn(RECHTE_KATALOG, z.recht))
      .map((z) => [z.recht, z.erlaubt]),
  );
}

const rolleRecht = (rolle: string, recht: string) => `${rolle}/${recht}`;

async function ladeAlle(d: Db | Tx, lagerId: string) {
  const zeilen = await d
    .select()
    .from(lagerRolleRecht)
    .where(eq(lagerRolleRecht.lagerId, lagerId));
  return new Map(zeilen.map((z) => [rolleRecht(z.rolle, z.recht), z.erlaubt]));
}

const wert = (
  eingestellt: Map<string, boolean>,
  rolle: EinstellbareRolle,
  recht: LagerRecht,
) => eingestellt.get(rolleRecht(rolle, recht)) ?? standardErlaubt(rolle, recht);

// Der Katalog mit Standard und aktuellem Wert je Rolle
export async function leseRechte(d: Db | Tx, lagerId: string) {
  const eingestellt = await ladeAlle(d, lagerId);
  const je = (f: (rolle: EinstellbareRolle) => boolean) =>
    Object.fromEntries(EINSTELLBARE_ROLLEN.map((r) => [r, f(r)])) as Record<
      EinstellbareRolle,
      boolean
    >;
  return {
    rechte: LAGER_RECHTE.map((recht) => ({
      recht,
      bedeutung: RECHTE_KATALOG[recht].bedeutung,
      standard: je((r) => standardErlaubt(r, recht)),
      aktuell: je((r) => wert(eingestellt, r, recht)),
    })),
  };
}

// Schreibt die Einträge in einer Transaktion unter der Zeilensperre des Lagers. Die Aufrufer haben das Lager schon auf die Abteilung der Sitzung gefiltert geladen; hier gilt es noch einmal, damit nie ein fremdes Lager geändert wird. Audit je Eintrag, dessen Wert sich ändert: Rolle, Recht, Wert, nie Inhalte
export async function aendereRechte(
  db: Db,
  person: { id: string; abteilungId: string },
  lagerId: string,
  eintraege: readonly RechtEintrag[],
): Promise<"ok" | "unbekannt" | "geschlossen"> {
  const ergebnis = await db.transaction(async (tx) => {
    const [ziel] = await tx
      .select({ status: lager.status })
      .from(lager)
      .where(
        and(eq(lager.id, lagerId), eq(lager.abteilungId, person.abteilungId)),
      )
      .for("update");
    if (!ziel) return "unbekannt";
    if (istGeschlossen(ziel.status)) return "geschlossen";
    const eingestellt = await ladeAlle(tx, lagerId);
    const geaendert = eintraege.filter(
      (e) => wert(eingestellt, e.rolle, e.recht) !== e.erlaubt,
    );
    await tx
      .insert(lagerRolleRecht)
      .values(eintraege.map((e) => ({ lagerId, ...e })))
      .onConflictDoUpdate({
        target: [
          lagerRolleRecht.lagerId,
          lagerRolleRecht.rolle,
          lagerRolleRecht.recht,
        ],
        set: { erlaubt: sql`excluded.erlaubt` },
      });
    if (geaendert.length > 0) {
      await tx.insert(auditLog).values(
        geaendert.map((e) => ({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "lager_recht_geaendert",
          zielTyp: "lager",
          zielId: lagerId,
          details: { rolle: e.rolle, recht: e.recht, erlaubt: e.erlaubt },
        })),
      );
    }
    return "ok" as const;
  });
  // Offene Ansichten des Lagers verbinden neu und bekommen ihre neuen lesbaren Typen (#367)
  if (ergebnis === "ok") ereignisverteiler.beendeLager(lagerId);
  return ergebnis;
}

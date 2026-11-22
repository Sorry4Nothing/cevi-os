import { and, asc, eq, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog, weiterleitung } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";
import { meldeWebsiteEreignis } from "../../website/ereignisse.js";
import { darfSeitenVerwalten } from "../../website/seiten.js";
import {
  alterPfadSchema,
  MAX_WEITERLEITUNGEN,
  pruefeKette,
  statusSchema,
  zielPfadSchema,
} from "../../website/weiterleitungen.js";

// Ein Schema pro Route. Beide Pfade sind relativ zur Website (Muster in website/weiterleitungen.ts): Eine Adresse mit Host, Schema oder «//» ist 400
const anlegenSchema = z.strictObject({
  alterPfad: alterPfadSchema,
  zielPfad: zielPfadSchema,
  status: statusSchema.optional(),
});
const aendernSchema = z
  .strictObject({
    alterPfad: alterPfadSchema.optional(),
    zielPfad: zielPfadSchema.optional(),
    status: statusSchema.optional(),
  })
  .refine((f) => Object.keys(f).length > 0);
const pfad = () => z.strictObject({ id: z.uuid() });

const SCHLEIFE = {
  code: "WEITERLEITUNG_SCHLEIFE",
  message: "Die Weiterleitung führt im Kreis.",
} as const;
const KETTE = {
  code: "WEITERLEITUNG_KETTE",
  message:
    "Das Ziel ist selbst eine alte Adresse, oder die alte Adresse ist Ziel einer anderen Weiterleitung. Leite direkt auf die neue Seite.",
} as const;
const ADRESSE_VERGEBEN = {
  code: "WEITERLEITUNG_ADRESSE_VERGEBEN",
  message: "Für diese alte Adresse gibt es schon eine Weiterleitung.",
} as const;
const ZU_VIELE = {
  code: "WEITERLEITUNG_ZU_VIELE",
  message: `Es gibt höchstens ${MAX_WEITERLEITUNGEN} Weiterleitungen.`,
} as const;

// Bricht die Transaktion ab und wird zur Antwort
class Abbruch extends Error {
  constructor(readonly antwort: { code: string; message: string }) {
    super();
  }
}

// Drizzle legt den Fehler von Postgres in cause: 23505 = Index verletzt
const pgFehler = (fehler: unknown) =>
  (fehler as { cause?: { code?: string } })?.cause;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function erstelleWeiterleitungsRouten({ db }: { db: Db }) {
  // Änderungen laufen je Abteilung nacheinander: So prüft jede die Kette gegen den Stand, den die vorige hinterlassen hat
  const sperre = (tx: Tx, abteilungId: string) =>
    tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`weiterleitung:${abteilungId}`}, 0))`,
    );

  async function pruefe(
    tx: Tx,
    abteilungId: string,
    neu: { alterPfad: string; zielPfad: string },
    ausser?: string,
  ) {
    const andere = await tx
      .select({
        alterPfad: weiterleitung.alterPfad,
        zielPfad: weiterleitung.zielPfad,
      })
      .from(weiterleitung)
      .where(
        and(
          eq(weiterleitung.abteilungId, abteilungId),
          ausser ? ne(weiterleitung.id, ausser) : undefined,
        ),
      );
    const kette = pruefeKette(neu, andere);
    if (kette === "schleife") throw new Abbruch(SCHLEIFE);
    if (kette === "kette") throw new Abbruch(KETTE);
    return andere.length;
  }

  // Erst die Zeile der Abteilung der Sitzung (fremde und unbekannte IDs sind 404), dann das Recht
  async function ladeZeile(tx: Tx, person: Person, id: string) {
    const [zeile] = await tx
      .select()
      .from(weiterleitung)
      .where(
        and(
          eq(weiterleitung.id, id),
          eq(weiterleitung.abteilungId, person.abteilungId),
        ),
      );
    if (!zeile) throw new HTTPException(404);
    if (!(await darfSeitenVerwalten(tx, person))) {
      throw new HTTPException(403);
    }
    return zeile;
  }

  const meldeAenderung = (abteilungId: string) =>
    meldeWebsiteEreignis({ art: "weiterleitung_geaendert", abteilungId });

  // Nur Abteilungsleitung und Redaktion (wie Seiten anlegen); die Alternative, jeder mit Zugang zu den Seiten, würde einer Stufenleitung erlauben, fremde Adressen umzuleiten
  const pruefeRecht = async (person: Person) => {
    if (!(await darfSeitenVerwalten(db, person))) {
      throw new HTTPException(403);
    }
  };

  return new Hono<{ Variables: { person: Person } }>()
    .get("/", async (c) => {
      const person = c.get("person");
      await pruefeRecht(person);
      // Ohne Seitenwechsel: höchstens MAX_WEITERLEITUNGEN Zeilen je Abteilung
      const zeilen = await db
        .select()
        .from(weiterleitung)
        .where(eq(weiterleitung.abteilungId, person.abteilungId))
        .orderBy(asc(weiterleitung.alterPfad));
      return c.json({
        weiterleitungen: zeilen.map((z) => ({
          id: z.id,
          alterPfad: z.alterPfad,
          zielPfad: z.zielPfad,
          status: z.status,
          erstelltAm: z.erstelltAm,
        })),
      });
    })
    .post("/", eingabe("json", anlegenSchema), async (c) => {
      const person = c.get("person");
      await pruefeRecht(person);
      const felder = c.req.valid("json");
      try {
        const neu = await db.transaction(async (tx) => {
          await sperre(tx, person.abteilungId);
          const anzahl = await pruefe(tx, person.abteilungId, felder);
          if (anzahl >= MAX_WEITERLEITUNGEN) throw new Abbruch(ZU_VIELE);
          const [zeile] = await tx
            .insert(weiterleitung)
            .values({
              abteilungId: person.abteilungId,
              alterPfad: felder.alterPfad,
              zielPfad: felder.zielPfad,
              status: felder.status ?? 301,
              erstelltVon: person.id,
            })
            .returning({ id: weiterleitung.id })
            .catch((fehler) => {
              if (pgFehler(fehler)?.code === "23505") {
                throw new Abbruch(ADRESSE_VERGEBEN);
              }
              throw fehler;
            });
          // Nur Kennung und Status, nie die Pfade
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "weiterleitung_angelegt",
            zielTyp: "weiterleitung",
            zielId: zeile.id,
            details: { status: felder.status ?? 301 },
          });
          return zeile;
        });
        meldeAenderung(person.abteilungId);
        return c.json({ id: neu.id }, 201);
      } catch (fehler) {
        if (fehler instanceof Abbruch) return c.json(fehler.antwort, 409);
        throw fehler;
      }
    })
    .patch(
      "/:id",
      eingabe("param", pfad()),
      eingabe("json", aendernSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const felder = c.req.valid("json");
        try {
          await db.transaction(async (tx) => {
            await sperre(tx, person.abteilungId);
            const alt = await ladeZeile(tx, person, id);
            await pruefe(
              tx,
              person.abteilungId,
              {
                alterPfad: felder.alterPfad ?? alt.alterPfad,
                zielPfad: felder.zielPfad ?? alt.zielPfad,
              },
              id,
            );
            await tx
              .update(weiterleitung)
              .set(felder)
              .where(eq(weiterleitung.id, id))
              .catch((fehler) => {
                if (pgFehler(fehler)?.code === "23505") {
                  throw new Abbruch(ADRESSE_VERGEBEN);
                }
                throw fehler;
              });
            // Nur die Namen der Felder, nie die Werte
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "weiterleitung_geaendert",
              zielTyp: "weiterleitung",
              zielId: id,
              details: { felder: Object.keys(felder) },
            });
          });
          meldeAenderung(person.abteilungId);
          return c.body(null, 204);
        } catch (fehler) {
          if (fehler instanceof Abbruch) return c.json(fehler.antwort, 409);
          throw fehler;
        }
      },
    )
    .delete("/:id", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      await db.transaction(async (tx) => {
        await sperre(tx, person.abteilungId);
        await ladeZeile(tx, person, id);
        await tx.delete(weiterleitung).where(eq(weiterleitung.id, id));
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "weiterleitung_geloescht",
          zielTyp: "weiterleitung",
          zielId: id,
          details: {},
        });
      });
      meldeAenderung(person.abteilungId);
      return c.body(null, 204);
    });
}

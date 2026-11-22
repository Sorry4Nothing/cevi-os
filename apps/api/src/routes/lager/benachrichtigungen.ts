import { and, count, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  lagerBenachrichtigung as benachrichtigung,
  lagerBenachrichtigungEinstellung as einstellung,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  ART_IDS,
  ARTEN,
  type BenachrichtigungsArt,
} from "../../lager/benachrichtigung-arten.js";
import {
  ladeLagerZugriff,
  lagerZugriff,
  type LagerEnv,
} from "../../lager/policy.js";
import { LAGER_PUSH_TYPEN } from "../../push.js";
import type { Person } from "../../rechte.js";

const SEITE = 50;
const MAX_IDS = 100;

const seiteSchema = z.strictObject({
  // Cursor: die ID des ältesten bekannten Eintrags; UUIDv7 ordnet nach Zeit
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(SEITE),
});
const gelesenSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(MAX_IDS).optional(),
});
const aufloesenSchema = z.strictObject({
  typ: z.enum(LAGER_PUSH_TYPEN),
  id: z.uuid(),
});
const einstellungenSchema = z.strictObject({
  arten: z
    .array(z.strictObject({ art: z.enum(ART_IDS), aktiv: z.boolean() }))
    .min(1)
    .max(ART_IDS.length)
    .refine((liste) => new Set(liste.map((e) => e.art)).size === liste.length),
});

// Benachrichtigungen im Lager (#369): immer nur die eigenen Zeilen der Person. Die Mitgliedschaft prüft lagerZugriff (Nicht-Mitglied 404); ein eigenes Recht gibt es nicht, jede Rolle liest und markiert ihre eigenen
export function erstelleLagerBenachrichtigungenRouten({ db }: { db: Db }) {
  return (
    new Hono<LagerEnv>()
      .get(
        "/aufloesen/:typ/:id",
        eingabe("param", aufloesenSchema),
        async (c) => {
          const person = c.get("person");
          const { typ, id } = c.req.valid("param");
          // Nur wer für dieses Objekt benachrichtigt wurde, bekommt eine Antwort: Die Route verrät sonst weder, ob es das Objekt gibt, noch in welchem Lager es liegt
          const arten = ART_IDS.filter((art) => ARTEN[art].push === typ);
          const [zeile] = await db
            .select({
              lagerId: benachrichtigung.lagerId,
              objektTyp: benachrichtigung.objektTyp,
            })
            .from(benachrichtigung)
            .where(
              and(
                eq(benachrichtigung.personId, person.id),
                eq(benachrichtigung.objektId, id),
                inArray(benachrichtigung.art, arten),
              ),
            )
            .orderBy(desc(benachrichtigung.id))
            .limit(1);
          if (!zeile) throw new HTTPException(404);
          // Lager der eigenen Abteilung und noch Mitglied; sonst dasselbe 404
          const zugriff = await ladeLagerZugriff(db, person, zeile.lagerId);
          if (!zugriff) throw new HTTPException(404);
          return c.json({
            lagerId: zeile.lagerId,
            objektTyp: zeile.objektTyp,
            objektId: id,
          });
        },
      )
      .get(
        "/:id/benachrichtigungen",
        lagerZugriff(db),
        eingabe("query", seiteSchema),
        async (c) => {
          const person = c.get("person");
          const { nach, limit } = c.req.valid("query");
          const zeilen = await db
            .select({
              id: benachrichtigung.id,
              art: benachrichtigung.art,
              objektTyp: benachrichtigung.objektTyp,
              objektId: benachrichtigung.objektId,
              gelesenAm: benachrichtigung.gelesenAm,
              erstelltAm: benachrichtigung.erstelltAm,
            })
            .from(benachrichtigung)
            .where(
              and(
                eq(benachrichtigung.personId, person.id),
                eq(benachrichtigung.lagerId, c.get("lager").lager.id),
                nach ? lt(benachrichtigung.id, nach) : undefined,
              ),
            )
            .orderBy(desc(benachrichtigung.id))
            .limit(limit + 1);
          const seite = zeilen.slice(0, limit);
          // Neueste zuerst; naechster ist der Cursor für ältere Einträge, null am Ende
          return c.json({
            eintraege: seite.map(({ gelesenAm, ...rest }) => ({
              ...rest,
              gelesen: gelesenAm !== null,
            })),
            naechster: zeilen.length > limit ? seite[limit - 1]!.id : null,
          });
        },
      )
      .get("/:id/benachrichtigungen/ungelesen", lagerZugriff(db), async (c) => {
        const [zeile] = await db
          .select({ anzahl: count() })
          .from(benachrichtigung)
          .where(
            and(
              eq(benachrichtigung.personId, c.get("person").id),
              eq(benachrichtigung.lagerId, c.get("lager").lager.id),
              isNull(benachrichtigung.gelesenAm),
            ),
          );
        return c.json({ anzahl: zeile!.anzahl });
      })
      // Auch im abgeschlossenen Lager: Eine Glocke leeren ändert keine Lagerdaten
      .post(
        "/:id/benachrichtigungen/gelesen",
        lagerZugriff(db, { auchGeschlossen: true }),
        eingabe("json", gelesenSchema),
        async (c) => {
          const { ids } = c.req.valid("json");
          await db
            .update(benachrichtigung)
            .set({ gelesenAm: sql`now()` })
            .where(
              and(
                eq(benachrichtigung.personId, c.get("person").id),
                eq(benachrichtigung.lagerId, c.get("lager").lager.id),
                isNull(benachrichtigung.gelesenAm),
                ids ? inArray(benachrichtigung.id, ids) : undefined,
              ),
            );
          return c.body(null, 204);
        },
      )
  );
}

// Schalter je Art unter /api/v1/ich/lager-benachrichtigungen (ich.ts hängt sie ein): über alle Lager, nur die eigenen, Standard an
export function erstelleLagerBenachrichtigungEinstellungRouten({
  db,
}: {
  db: Db;
}) {
  return (
    new Hono<{ Variables: { person: Person } }>()
      .get("/", async (c) => {
        const zeilen = await db
          .select({ art: einstellung.art, aktiv: einstellung.aktiv })
          .from(einstellung)
          .where(eq(einstellung.personId, c.get("person").id));
        const gesetzt = new Map(zeilen.map((z) => [z.art, z.aktiv]));
        return c.json({
          arten: ART_IDS.map((art) => ({
            art,
            aktiv: gesetzt.get(art) ?? true,
          })),
        });
      })
      // Nur die genannten Arten ändern sich
      .put("/", eingabe("json", einstellungenSchema), async (c) => {
        const personId = c.get("person").id;
        const { arten } = c.req.valid("json");
        await db
          .insert(einstellung)
          .values(
            arten.map(
              ({
                art,
                aktiv,
              }: {
                art: BenachrichtigungsArt;
                aktiv: boolean;
              }) => ({
                personId,
                art,
                aktiv,
              }),
            ),
          )
          .onConflictDoUpdate({
            target: [einstellung.personId, einstellung.art],
            set: { aktiv: sql`excluded.aktiv` },
          });
        return c.body(null, 204);
      })
  );
}

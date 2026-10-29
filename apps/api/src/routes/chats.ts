import { and, count, desc, eq, exists, gt, isNull, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  chat,
  nachricht,
  programm,
  programmStufe,
  stufe,
  user,
} from "../db/schema.js";
import { eingabe } from "../eingabe.js";
import {
  chatFuerPerson,
  chatMitglieder,
  sichtbareNachrichten,
  type Person,
} from "../rechte.js";

const SEITE = 50;
const MAX_ZEICHEN = 2000;
const NACHRICHTEN_PRO_MINUTE = 20;

const pfadSchema = z.strictObject({ id: z.uuid() });
// Der Cursor ist die ID der ältesten bekannten Nachricht; UUIDv7 ordnet nach Zeit
const seiteSchema = z.strictObject({ vor: z.uuid().optional() });
const sendenSchema = z.strictObject({
  // Postgres lehnt NUL in text ab (22021); ohne Prüfung wäre das ein 500
  text: z
    .string()
    .trim()
    .min(1)
    .max(MAX_ZEICHEN)
    .refine((text) => !text.includes("\u0000")),
  programmId: z.uuid().toLowerCase().optional(),
});

// Auch in den Importen ohne node:* und process: Die App prüft diese Datei über AppType
export function erstelleChatRouten({ db }: { db: Db }) {
  // Nur Programme, die auch Eltern der Stufe sehen: Sonst landete ein interner Titel im Chat
  const fuerElternDerStufe = (stufeId: string, abteilungId: string) =>
    and(
      eq(programm.abteilungId, abteilungId),
      eq(programm.sichtbarkeit, "eltern"),
      exists(
        db
          .select({ eins: sql`1` })
          .from(programmStufe)
          .where(
            and(
              eq(programmStufe.programmId, programm.id),
              eq(programmStufe.stufeId, stufeId),
            ),
          ),
      ),
    );

  return (
    new Hono<{ Variables: { person: Person } }>()
      // Einzelchats folgen mit #50 und erscheinen erst dann in der Liste
      .get("/", async (c) => {
        const person = c.get("person");
        const mitglieder = chatMitglieder(db, person.abteilungId);
        const chats = await db
          .select({
            id: chat.id,
            typ: chat.typ,
            stufe: { id: stufe.id, name: stufe.name, kuerzel: stufe.kuerzel },
          })
          .from(chat)
          .innerJoin(mitglieder, eq(mitglieder.chatId, chat.id))
          .innerJoin(stufe, eq(stufe.id, chat.stufeId))
          .where(and(eq(mitglieder.userId, person.id), eq(chat.typ, "stufe")))
          .orderBy(stufe.reihenfolge, chat.id);
        return c.json({ chats });
      })
      // Neueste zuerst; naechster ist der Cursor für ältere Nachrichten, null am Anfang des Verlaufs
      .get(
        "/:id/nachrichten",
        eingabe("param", pfadSchema),
        eingabe("query", seiteSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const { vor } = c.req.valid("query");
          const eigener = await chatFuerPerson(db, person, id);
          if (!eigener) throw new HTTPException(404);
          const n = sichtbareNachrichten(db, person);
          const zeilen = await db
            .select({
              id: n.id,
              text: n.text,
              erstelltAm: n.erstelltAm,
              autor: { id: user.id, name: user.name },
              // Verschwindet ein Programm aus der Elternsicht, verschwindet auch sein Titel aus dem Chat
              programm: { id: programm.id, titel: programm.titel },
            })
            .from(n)
            .innerJoin(user, eq(user.id, n.autorId))
            .leftJoin(
              programm,
              and(
                eq(programm.id, n.programmId),
                fuerElternDerStufe(eigener.stufeId, person.abteilungId),
              ),
            )
            .where(
              and(
                eq(n.chatId, id),
                // Ausgeblendete zeigt erst #52, mit Hinweis für die Autorin
                isNull(n.ausgeblendetAm),
                vor ? lt(n.id, vor) : undefined,
              ),
            )
            .orderBy(desc(n.id))
            .limit(SEITE + 1);
          const seite = zeilen.slice(0, SEITE);
          return c.json({
            nachrichten: seite.map((zeile) => ({
              ...zeile,
              eigene: zeile.autor.id === person.id,
            })),
            naechster:
              zeilen.length > SEITE
                ? (seite[seite.length - 1]?.id ?? null)
                : null,
          });
        },
      )
      .post(
        "/:id/nachrichten",
        eingabe("param", pfadSchema),
        eingabe("json", sendenSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const { text, programmId } = c.req.valid("json");
          const eigener = await chatFuerPerson(db, person, id);
          if (!eigener) throw new HTTPException(404);
          if (programmId) {
            const [zeile] = await db
              .select({ id: programm.id })
              .from(programm)
              .where(
                and(
                  eq(programm.id, programmId),
                  fuerElternDerStufe(eigener.stufeId, person.abteilungId),
                ),
              );
            if (!zeile) throw new HTTPException(400);
          }
          const neu = await db.transaction(async (tx) => {
            // Sperre pro Person: Gleichzeitige Anfragen zählen sonst alle denselben Stand
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${person.id}, 0))`,
            );
            const [{ anzahl }] = await tx
              .select({ anzahl: count() })
              .from(nachricht)
              .where(
                and(
                  eq(nachricht.autorId, person.id),
                  gt(nachricht.erstelltAm, sql`now() - interval '1 minute'`),
                ),
              );
            if (anzahl >= NACHRICHTEN_PRO_MINUTE) {
              throw new HTTPException(429);
            }
            const [zeile] = await tx
              .insert(nachricht)
              .values({
                chatId: id,
                autorId: person.id,
                text,
                programmId: programmId ?? null,
              })
              .returning({ id: nachricht.id });
            return zeile;
          });
          return c.json(neu, 201);
        },
      )
  );
}

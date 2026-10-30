import {
  and,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { pushNeueNachricht } from "../chat.js";
import type { Fcm } from "../push.js";
import {
  chat,
  chatStatus,
  nachricht,
  programm,
  programmStufe,
  rolle,
  stufe,
  user,
} from "../db/schema.js";
import { eingabe } from "../eingabe.js";
import {
  chatFuerPerson,
  chatMitglieder,
  hatRolle,
  sichtbareNachrichten,
  stufenleitungDerStufen,
  type Person,
} from "../rechte.js";

const SEITE = 50;
const MAX_ZEICHEN = 2000;
const NACHRICHTEN_PRO_MINUTE = 20;

const pfadSchema = z.strictObject({ id: z.uuid() });
// Der Cursor ist die ID der ältesten bekannten Nachricht; UUIDv7 ordnet nach Zeit
const seiteSchema = z.strictObject({ vor: z.uuid().optional() });
// Eltern nennen nur die Stufe; eine SL zusätzlich das Elternteil. Mehr Felder, vor allem die SL einer Person, gibt es nicht (Mehr-Augen-Prinzip)
const direktSchema = z.strictObject({
  stufeId: z.uuid().toLowerCase(),
  elternUserId: z.uuid().toLowerCase().optional(),
});
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
export function erstelleChatRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
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
      .get("/", async (c) => {
        const person = c.get("person");
        const mitglieder = chatMitglieder(db, person.abteilungId);
        const eltern = alias(user, "eltern");
        const chats = await db
          .select({
            id: chat.id,
            typ: chat.typ,
            stufe: { id: stufe.id, name: stufe.name, kuerzel: stufe.kuerzel },
            eltern: { id: eltern.id, name: eltern.name },
          })
          .from(chat)
          .innerJoin(mitglieder, eq(mitglieder.chatId, chat.id))
          .innerJoin(stufe, eq(stufe.id, chat.stufeId))
          .leftJoin(eltern, eq(eltern.id, chat.elternUserId))
          .where(eq(mitglieder.userId, person.id))
          // Gruppenchats vor Einzelchats («stufe» sortiert nach «direkt»), dann nach Stufe und Elternteil
          .orderBy(desc(chat.typ), stufe.reihenfolge, eltern.name, chat.id);
        // Fremde, sichtbare Nachrichten nach gelesen_bis; ohne Zeile ist alles ungelesen, was die Person sehen darf
        // shortcut: Der Zähler wird bei jedem Abruf der Chatliste neu gezählt und die App fragt per Polling nach (Liste alle 30 s, offener Chat alle 5 s); auf SSE oder WebSocket umstellen, erst wenn Polling spürbar stört
        const n = sichtbareNachrichten(db, person);
        const ungelesen = await db
          .select({ chatId: n.chatId, anzahl: count() })
          .from(n)
          .leftJoin(
            chatStatus,
            and(
              eq(chatStatus.chatId, n.chatId),
              eq(chatStatus.userId, person.id),
            ),
          )
          .where(
            and(
              ne(n.autorId, person.id),
              or(
                isNull(chatStatus.gelesenBis),
                gt(n.erstelltAm, chatStatus.gelesenBis),
              ),
            ),
          )
          .groupBy(n.chatId);
        // Wer mitliest, steht in jedem Chat der Stufe: Im Gruppenchat die Liste «Stufenleitung», im Einzelchat der Kopf
        const leitung =
          chats.length === 0
            ? []
            : await stufenleitungDerStufen(db, person.abteilungId, [
                ...new Set(chats.map((k) => k.stufe.id)),
              ]);
        return c.json({
          chats: chats.map(({ eltern: e, ...k }) => ({
            ...k,
            ungelesen: ungelesen.find((u) => u.chatId === k.id)?.anzahl ?? 0,
            // Der Join liefert bei Gruppenchats ein Objekt aus null
            eltern: e && e.id ? e : null,
            stufenleitung: leitung
              .filter((l) => l.stufeId === k.stufe.id)
              .map(({ id, name }) => ({ id, name })),
          })),
        });
      })
      // Idempotent: Der Einzelchat eines Elternteils in einer Stufe entsteht beim ersten Aufruf, danach liefert die Route denselben
      .post("/direkt", eingabe("json", direktSchema), async (c) => {
        const person = c.get("person");
        const { stufeId, elternUserId } = c.req.valid("json");
        const istSl = hatRolle(person, stufeId, "stufenleitung");
        // Eine SL nennt das Elternteil, ein Elternteil kann nur sich selbst meinen; ein fremder Name ist wie ein fremder Chat
        if (istSl && !elternUserId) throw new HTTPException(400);
        if (!istSl && elternUserId && elternUserId !== person.id) {
          throw new HTTPException(404);
        }
        const ziel = istSl ? elternUserId! : person.id;
        // Kein Fremdschlüssel sichert die Abteilung; und eine unbekannte ID wäre sonst ein 500. Eine SL ist nie das Elternteil: Der Chat bliebe sonst ein Kanal unter SL
        const [stufeZeile, zielZeile, zielIstSl] = await Promise.all([
          db
            .select({ id: stufe.id })
            .from(stufe)
            .where(
              and(
                eq(stufe.id, stufeId),
                eq(stufe.abteilungId, person.abteilungId),
              ),
            ),
          db
            .select({ id: user.id })
            .from(user)
            .where(
              and(eq(user.id, ziel), eq(user.abteilungId, person.abteilungId)),
            ),
          db
            .select({ id: rolle.userId })
            .from(rolle)
            .where(
              and(
                eq(rolle.userId, ziel),
                eq(rolle.stufeId, stufeId),
                eq(rolle.typ, "stufenleitung"),
              ),
            ),
        ]);
        if (!stufeZeile[0] || !zielZeile[0]) throw new HTTPException(404);
        if (istSl && zielIstSl[0]) throw new HTTPException(404);

        // Zeile anlegen oder finden; ob beide Seiten Mitglied sind, entscheidet danach die abgeleitete Mitgliedschaft (rechte.ts), nicht ein zweites Regelwerk hier
        const [neu] = await db
          .insert(chat)
          .values({
            abteilungId: person.abteilungId,
            typ: "direkt",
            stufeId,
            elternUserId: ziel,
          })
          .onConflictDoNothing()
          .returning({ id: chat.id });
        const [bestehend] = neu
          ? [neu]
          : await db
              .select({ id: chat.id })
              .from(chat)
              .where(
                and(
                  eq(chat.typ, "direkt"),
                  eq(chat.stufeId, stufeId),
                  eq(chat.elternUserId, ziel),
                ),
              );
        // Nur im Wettlauf mit dem Aufräumen einer gleichzeitigen, unzulässigen Anfrage derselben Paarung
        if (!bestehend) throw new HTTPException(404);
        const chatId = bestehend.id;
        const mitglieder = chatMitglieder(db, person.abteilungId);
        const vorhanden = await db
          .select({ userId: mitglieder.userId })
          .from(mitglieder)
          .where(
            and(
              eq(mitglieder.chatId, chatId),
              inArray(mitglieder.userId, [person.id, ziel]),
            ),
          );
        // Die SL ist selbst Mitglied (SL-Zweig), das Elternteil über sein Kind in der Stufe
        if (
          new Set(vorhanden.map((v) => v.userId)).size !==
          new Set([person.id, ziel]).size
        ) {
          // Eine Zeile, die wir eben angelegt haben, ohne dass jemand Zugang hat, bleibt nicht liegen
          if (neu) await db.delete(chat).where(eq(chat.id, chatId));
          throw new HTTPException(404);
        }
        return c.json({ id: chatId });
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
              ausgeblendetAm: n.ausgeblendetAm,
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
            .where(and(eq(n.chatId, id), vor ? lt(n.id, vor) : undefined))
            .orderBy(desc(n.id))
            .limit(SEITE + 1);
          const seite = zeilen.slice(0, SEITE);
          return c.json({
            // Ausgeblendete liefert sichtbareNachrichten nur der Autorin: ohne Text und Programm, die App zeigt den Hinweis
            nachrichten: seite.map(({ ausgeblendetAm, ...zeile }) => ({
              ...zeile,
              text: ausgeblendetAm ? null : zeile.text,
              programm: ausgeblendetAm ? null : zeile.programm,
              ausgeblendet: ausgeblendetAm !== null,
              eigene: zeile.autor.id === person.id,
            })),
            naechster:
              zeilen.length > SEITE
                ? (seite[seite.length - 1]?.id ?? null)
                : null,
          });
        },
      )
      // Setzt gelesen_bis auf die Serverzeit und nie zurück; Lesebestätigungen für andere gibt es nicht (nicht Teil von V1)
      .put("/:id/gelesen", eingabe("param", pfadSchema), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        if (!(await chatFuerPerson(db, person, id))) {
          throw new HTTPException(404);
        }
        await db
          .insert(chatStatus)
          .values({ chatId: id, userId: person.id, gelesenBis: sql`now()` })
          .onConflictDoUpdate({
            target: [chatStatus.chatId, chatStatus.userId],
            set: {
              gelesenBis: sql`greatest(${chatStatus.gelesenBis}, excluded.gelesen_bis)`,
            },
          });
        return c.body(null, 204);
      })
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
          await pushNeueNachricht(
            { db, fcm, c },
            { chatId: id, abteilungId: person.abteilungId, autorId: person.id },
          );
          return c.json(neu, 201);
        },
      )
  );
}

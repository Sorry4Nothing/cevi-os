import {
  and,
  eq,
  exists,
  gte,
  isNull,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { erstelleAuth } from "./auth.js";
import type { Db } from "./db/client.js";
import {
  chat,
  kind,
  kindEltern,
  nachricht,
  rolle,
  stufe,
  user,
} from "./db/schema.js";

// Eltern haben keine Stufenrolle: Ihre Rechte hängen am Kind, die Routen joinen kind_eltern direkt in SQL
export type Person = {
  id: string;
  abteilungId: string;
  admin: boolean;
  rollen: { stufeId: string; typ: "leitung" | "stufenleitung" }[];
};

// Jede Route unter /api/v1 lädt ihr Objekt in SQL auf person.abteilungId gefiltert, sonst HTTPException(404); erst dann prüft sie das Recht, sonst HTTPException(403)
export function personAusSitzung(
  auth: ReturnType<typeof erstelleAuth>,
  db: Db,
) {
  return createMiddleware<{ Variables: { person: Person } }>(
    async (c, next) => {
      // disableRefresh: Die Verlängerung gehört zu get-session; hier schriebe sie die Zeile und verlöre ihr Set-Cookie
      const sitzung = await auth.api.getSession({
        headers: c.req.raw.headers,
        query: { disableRefresh: true },
      });
      // banned prüft better-auth nur beim Anlegen einer Sitzung, nicht beim Lesen
      if (!sitzung || sitzung.user.banned) throw new HTTPException(401);
      // Kein Fremdschlüssel sichert zu, dass die Stufe zur Abteilung der Person gehört, darum die Bedingung im Join
      const rollen = await db
        .select({ stufeId: rolle.stufeId, typ: rolle.typ })
        .from(rolle)
        .innerJoin(
          stufe,
          and(
            eq(rolle.stufeId, stufe.id),
            eq(stufe.abteilungId, sitzung.user.abteilungId),
          ),
        )
        .where(eq(rolle.userId, sitzung.user.id));
      c.set("person", {
        id: sitzung.user.id,
        abteilungId: sitzung.user.abteilungId,
        admin: sitzung.user.role === "admin",
        rollen,
      });
      await next();
    },
  );
}

// Chat: Mitgliedschaft wird nie gespeichert, sondern pro Anfrage aus Rollen und Kindern abgeleitet

// Alle Chat-Mitglieder der Abteilung als Unterabfrage { chatId, userId, sichtAb }; sichtAb null heisst ganzer Verlauf
export function chatMitglieder(db: Db, abteilungId: string) {
  // Die Union nimmt Spaltennamen und Decoder aus dem ersten Zweig, darum in jedem Zweig derselbe Alias und der Decoder einer timestamptz-Spalte
  const sichtAb = (ausdruck: SQL) =>
    (ausdruck.mapWith(kind.stufeSeit) as SQL<Date | null>).as("sicht_ab");
  // banned ist null-sicher geprüft; Deaktivieren setzt beide Felder, jedes allein beendet die Mitgliedschaft
  const kontoAktiv = and(
    eq(user.abteilungId, abteilungId),
    isNull(user.deaktiviertAm),
    sql`${user.banned} is not true`,
  );
  const istSlDerStufe = (
    userId: typeof kindEltern.userId | typeof chat.elternUserId,
  ) =>
    db
      .select({ eins: sql`1` })
      .from(rolle)
      .where(
        and(
          eq(rolle.userId, userId),
          eq(rolle.stufeId, chat.stufeId),
          eq(rolle.typ, "stufenleitung"),
        ),
      );

  // SL lesen jeden Chat ihrer Stufe, auch den Einzelchat eines Elternteils, der den Zugang verloren hat
  const sl = db
    .select({
      chatId: chat.id,
      userId: rolle.userId,
      sichtAb: sichtAb(sql`null::timestamptz`),
    })
    .from(chat)
    .innerJoin(
      rolle,
      and(eq(rolle.stufeId, chat.stufeId), eq(rolle.typ, "stufenleitung")),
    )
    .innerJoin(user, and(eq(user.id, rolle.userId), kontoAktiv))
    .where(eq(chat.abteilungId, abteilungId));

  // Wer in der Stufe SL ist, nimmt nur als SL teil, darum lassen beide Eltern-Zweige diese Konten aus
  const eltern = db
    .select({
      chatId: chat.id,
      userId: kindEltern.userId,
      sichtAb: sichtAb(
        // min(): Beim frühesten aktiven Kind beginnt die Sicht; Drizzles min() nähme den String-Decoder
        sql`min(greatest(${kindEltern.erstelltAm}, ${kind.stufeSeit}))`,
      ),
    })
    .from(chat)
    .innerJoin(
      kind,
      and(
        eq(kind.stufeId, chat.stufeId),
        eq(kind.abteilungId, abteilungId),
        isNull(kind.inaktivSeit),
      ),
    )
    .innerJoin(kindEltern, eq(kindEltern.kindId, kind.id))
    .innerJoin(user, and(eq(user.id, kindEltern.userId), kontoAktiv))
    .where(
      and(
        eq(chat.abteilungId, abteilungId),
        eq(chat.typ, "stufe"),
        notExists(istSlDerStufe(kindEltern.userId)),
      ),
    )
    .groupBy(chat.id, kindEltern.userId);

  // exists statt Join: Zwei aktive Kinder in der Stufe gäben sonst zwei Zeilen pro Einzelchat
  const einzel = db
    .select({
      chatId: chat.id,
      userId: sql<string>`${chat.elternUserId}`.as("user_id"),
      // Das Beitrittsdatum gilt nur im Gruppenchat; den eigenen Einzelchat sieht das Elternteil ganz
      sichtAb: sichtAb(sql`null::timestamptz`),
    })
    .from(chat)
    .innerJoin(user, and(eq(user.id, chat.elternUserId), kontoAktiv))
    .where(
      and(
        eq(chat.abteilungId, abteilungId),
        eq(chat.typ, "direkt"),
        exists(
          db
            .select({ eins: sql`1` })
            .from(kind)
            .innerJoin(kindEltern, eq(kindEltern.kindId, kind.id))
            .where(
              and(
                eq(kindEltern.userId, chat.elternUserId),
                eq(kind.stufeId, chat.stufeId),
                eq(kind.abteilungId, abteilungId),
                isNull(kind.inaktivSeit),
              ),
            ),
        ),
        notExists(istSlDerStufe(chat.elternUserId)),
      ),
    );

  return unionAll(sl, eltern, einzel).as("chat_mitglieder");
}

// undefined heisst: Für diese Person existiert der Chat nicht, die Route antwortet 404; Nichtmitglieder sehen nie einen Chat, darum gibt es kein 403
export async function chatFuerPerson(
  db: Db,
  person: Pick<Person, "id" | "abteilungId">,
  chatId: string,
) {
  const mitglieder = chatMitglieder(db, person.abteilungId);
  const [eigener] = await db
    .select({
      id: chat.id,
      typ: chat.typ,
      stufeId: chat.stufeId,
      elternUserId: chat.elternUserId,
      sichtAb: mitglieder.sichtAb,
    })
    .from(chat)
    .innerJoin(mitglieder, eq(mitglieder.chatId, chat.id))
    .where(and(eq(chat.id, chatId), eq(mitglieder.userId, person.id)));
  return eigener;
}

// Nachrichten in den Chats der Person, Eltern ab Beitritt (einschliesslich); #52 und #53 ergänzen Ausblenden und Blockieren hier, nicht in den Routen
export function sichtbareNachrichten(
  db: Db,
  person: Pick<Person, "id" | "abteilungId">,
) {
  const mitglieder = chatMitglieder(db, person.abteilungId);
  return db
    .select({
      id: nachricht.id,
      chatId: nachricht.chatId,
      autorId: nachricht.autorId,
      text: nachricht.text,
      programmId: nachricht.programmId,
      erstelltAm: nachricht.erstelltAm,
      ausgeblendetVon: nachricht.ausgeblendetVon,
      ausgeblendetAm: nachricht.ausgeblendetAm,
    })
    .from(nachricht)
    .innerJoin(
      mitglieder,
      and(
        eq(mitglieder.chatId, nachricht.chatId),
        eq(mitglieder.userId, person.id),
      ),
    )
    .where(
      or(
        isNull(mitglieder.sichtAb),
        gte(nachricht.erstelltAm, mitglieder.sichtAb),
      ),
    )
    .as("sichtbare_nachrichten");
}

// «stufenleitung» erfüllt nur die SL, «leitung» auch die SL derselben Stufe; Admin ist keine Stufenrolle
export function hatRolle(
  person: Person,
  stufeId: string,
  typ: "leitung" | "stufenleitung",
) {
  return person.rollen.some(
    (r) =>
      r.stufeId === stufeId && (r.typ === "stufenleitung" || typ === "leitung"),
  );
}

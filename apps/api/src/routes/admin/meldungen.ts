import {
  aliasedTable,
  and,
  desc,
  eq,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  auditLog,
  chat,
  meldung,
  nachricht,
  stufe,
  user,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";

const SEITE = 50;

const pfadSchema = z.strictObject({ id: z.uuid() });
// Der Cursor ist die ID der ältesten bekannten Meldung; UUIDv7 ordnet nach Zeit
const seiteSchema = z.strictObject({ vor: z.uuid().optional() });
const erledigenSchema = z.strictObject({ erledigt: z.literal(true) });

export function erstelleMeldungenRouten({ db }: { db: Db }) {
  // Alle Admins ausser der gemeldeten Person: Eine Meldung über den eigenen Beitrag sieht, liest und erledigt niemand für sich selbst. autor_id null (Konto gelöscht) trifft keinen Admin
  const sichtbar = (person: Person) =>
    and(
      eq(meldung.abteilungId, person.abteilungId),
      or(isNull(meldung.autorId), ne(meldung.autorId, person.id)),
    );

  return (
    new Hono<{ Variables: { person: Person } }>()
      // Offene Meldungen, neueste zuerst; naechster ist der Cursor für ältere, null am Ende
      .get("/", eingabe("query", seiteSchema), async (c) => {
        const person = c.get("person");
        if (!person.admin) throw new HTTPException(403);
        const { vor } = c.req.valid("query");
        const autor = aliasedTable(user, "autor");
        const melder = aliasedTable(user, "melder");
        const zeilen = await db
          .select({
            id: meldung.id,
            erstelltAm: meldung.erstelltAm,
            text: meldung.textKopie,
            nachrichtId: nachricht.id,
            ausgeblendet: sql<boolean>`${nachricht.ausgeblendetAm} is not null`,
            chatTyp: chat.typ,
            stufeId: stufe.id,
            stufeName: stufe.name,
            stufeKuerzel: stufe.kuerzel,
            autorId: autor.id,
            autorName: autor.name,
            autorBanned: autor.banned,
            melderName: melder.name,
          })
          .from(meldung)
          .leftJoin(nachricht, eq(nachricht.id, meldung.nachrichtId))
          .leftJoin(chat, eq(chat.id, nachricht.chatId))
          .leftJoin(stufe, eq(stufe.id, chat.stufeId))
          .leftJoin(autor, eq(autor.id, meldung.autorId))
          .leftJoin(melder, eq(melder.id, meldung.gemeldetVon))
          .where(
            and(
              sichtbar(person),
              isNull(meldung.erledigtAm),
              vor ? lt(meldung.id, vor) : undefined,
            ),
          )
          .orderBy(desc(meldung.id))
          .limit(SEITE + 1);
        const seite = zeilen.slice(0, SEITE);
        // Nie email, benutzername oder banReason: Die Meldung braucht Name, Chat und Text
        return c.json({
          meldungen: seite.map((z) => ({
            id: z.id,
            erstelltAm: z.erstelltAm,
            // null: Die Kopie ist gelöscht
            text: z.text,
            // null: Die Nachricht ist gelöscht, die Meldung behält den Beleg
            nachrichtId: z.nachrichtId,
            ausgeblendet: z.ausgeblendet,
            chat:
              z.chatTyp && z.stufeId
                ? {
                    typ: z.chatTyp,
                    stufe: {
                      id: z.stufeId,
                      name: z.stufeName!,
                      kuerzel: z.stufeKuerzel!,
                    },
                  }
                : null,
            autor: z.autorId
              ? {
                  id: z.autorId,
                  name: z.autorName!,
                  deaktiviert: z.autorBanned === true,
                }
              : null,
            gemeldetVon: z.melderName,
          })),
          naechster:
            zeilen.length > SEITE
              ? (seite[seite.length - 1]?.id ?? null)
              : null,
        });
      })
      // Erledigen leert die Kopie des Textes und steht im Audit-Log; wiederholt ist es ein No-op. Ausblenden und Deaktivieren laufen über ihre eigenen Routen
      .patch(
        "/:id",
        eingabe("param", pfadSchema),
        eingabe("json", erledigenSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          // Erst laden (404, auch für die gemeldete Person), dann das Recht prüfen (403), wie bei den Personen
          const [vorhanden] = await db
            .select({ id: meldung.id })
            .from(meldung)
            .where(and(eq(meldung.id, id), sichtbar(person)));
          if (!vorhanden) throw new HTTPException(404);
          if (!person.admin) throw new HTTPException(403);
          await db.transaction(async (tx) => {
            const [geaendert] = await tx
              .update(meldung)
              .set({
                erledigtVon: person.id,
                erledigtAm: sql`now()`,
                textKopie: null,
              })
              .where(and(eq(meldung.id, id), isNull(meldung.erledigtAm)))
              .returning({ id: meldung.id });
            if (!geaendert) return;
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "meldung_erledigt",
              zielTyp: "meldung",
              zielId: id,
            });
          });
          return c.body(null, 204);
        },
      )
  );
}

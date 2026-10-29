import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../db/client.js";
import { kind, kindEltern, stufe, user } from "../db/schema.js";
import type { Person } from "../rechte.js";

// Auch in den Importen ohne node:* und process: Die App prüft diese Datei über AppType
export function erstelleIchRouten({ db }: { db: Db }) {
  return (
    new Hono<{ Variables: { person: Person } }>()
      .get("/", async (c) => {
        const person = c.get("person");
        // Nie email, Bremsfelder, banned, startpasswortGueltigBis oder Geheimnisse und Codes des zweiten Faktors: Die App braucht sie nicht
        const [profil] = await db
          .select({
            id: user.id,
            name: user.name,
            benutzername: user.username,
            mussPasswortAendern: user.mussPasswortAendern,
            datenschutzGelesenAm: user.datenschutzGelesenAm,
            telefon: user.telefon,
            pushChat: user.pushChat,
            pushProgramme: user.pushProgramme,
          })
          .from(user)
          .where(
            and(
              eq(user.id, person.id),
              eq(user.abteilungId, person.abteilungId),
            ),
          );
        const kinder = await db
          .select({
            id: kind.id,
            vorname: kind.vorname,
            nachname: kind.nachname,
            stufeId: kind.stufeId,
          })
          .from(kind)
          .innerJoin(kindEltern, eq(kindEltern.kindId, kind.id))
          .where(
            and(
              eq(kindEltern.userId, person.id),
              eq(kind.abteilungId, person.abteilungId),
              isNull(kind.inaktivSeit),
            ),
          )
          .orderBy(asc(kind.id));
        // Die Sitzung löscht die Datenbank mit der Person (CASCADE); ohne Zeile ist sie nicht mehr gültig
        if (!profil) throw new HTTPException(401);
        // Die Stufen der Rollen und der Kinder; inArray mit leerer Liste wird zu «false»
        const stufenIds = [
          ...new Set([
            ...person.rollen.map((r) => r.stufeId),
            ...kinder.map((k) => k.stufeId),
          ]),
        ];
        const stufen =
          stufenIds.length === 0
            ? []
            : await db
                .select({
                  id: stufe.id,
                  name: stufe.name,
                  kuerzel: stufe.kuerzel,
                })
                .from(stufe)
                .where(
                  and(
                    inArray(stufe.id, stufenIds),
                    eq(stufe.abteilungId, person.abteilungId),
                  ),
                )
                .orderBy(asc(stufe.reihenfolge));
        return c.json({
          ...profil,
          admin: person.admin,
          zweiterFaktor: person.zweiterFaktor,
          rollen: person.rollen,
          stufen,
          kinder,
        });
      })
      // Kenntnisnahme, keine Einwilligung: einmal pro Person, das erste Datum bleibt
      .post("/datenschutz", async (c) => {
        const person = c.get("person");
        await db
          .update(user)
          .set({ datenschutzGelesenAm: sql`now()` })
          .where(
            and(eq(user.id, person.id), isNull(user.datenschutzGelesenAm)),
          );
        return c.body(null, 204);
      })
  );
}

import { isAPIError } from "better-auth/api";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { aktiveAdminIds, istLetzterAdmin, LETZTER_ADMIN } from "../admins.js";
import {
  wartezeitMinuten,
  ZU_VIELE_ANFRAGEN,
  type erstelleAuth,
} from "../auth.js";
import type { Db } from "../db/client.js";
import {
  auditLog,
  kind,
  kindEltern,
  profilbild,
  stufe,
  user,
  verification,
} from "../db/schema.js";
import { bildUrl } from "../bild.js";
import { eingabe } from "../eingabe.js";
import type { Person } from "../rechte.js";

// Länger als eine scrypt-Prüfung; läuft nur ab, wenn der Prozess dazwischen stirbt
const PRUEFDAUER_MS = 10_000;
// 128 wie das Standard-Maximum von better-auth; die Länge ist keine Regel, sondern nur die Grenze der Eingabe
const loeschenSchema = z.strictObject({ passwort: z.string().min(1).max(128) });
// Freiwillig, nur SL; leer oder null entfernt die Nummer. Nur Ziffern und die üblichen Trennzeichen, damit der Wert in «tel:» taugt
const telefonSchema = z
  .string()
  .trim()
  .transform((wert) => wert || null)
  .refine((wert) => wert === null || /^\+?\d[\d ()/.-]{4,28}\d$/.test(wert))
  .nullable();
// Mindestens ein Feld: Ein leeres set() wirft in Drizzle («No values to set»)
const profilSchema = z
  .strictObject({
    pushChat: z.boolean(),
    pushProgramme: z.boolean(),
    telefon: telefonSchema,
  })
  .partial()
  .refine((b) => Object.values(b).some((wert) => wert !== undefined));

// Auch in den Importen ohne node:* und process: Die App prüft diese Datei über AppType
export function erstelleIchRouten({
  db,
  auth,
}: {
  db: Db;
  auth: ReturnType<typeof erstelleAuth>;
}) {
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
            bildUrl,
          })
          .from(user)
          .leftJoin(profilbild, eq(profilbild.userId, user.id))
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
      // Nur die eigenen Schalter und die eigene Nummer; die Person kommt aus der Sitzung, nie aus dem Body
      .patch("/", eingabe("json", profilSchema), async (c) => {
        const person = c.get("person");
        const daten = c.req.valid("json");
        // Eine Nummer speichern nur SL; entfernen darf jede Person, auch eine, die die Rolle verloren hat
        if (
          daten.telefon &&
          !person.rollen.some((r) => r.typ === "stufenleitung")
        ) {
          throw new HTTPException(403);
        }
        await db.update(user).set(daten).where(eq(user.id, person.id));
        return c.body(null, 204);
      })
      // Passwort wie bei der Anmeldung (Bremse #15); deleteUser von better-auth prüft es nur, wenn eines mitkommt, und braucht eine zweite Verbindung
      .delete("/", eingabe("json", loeschenSchema), async (c) => {
        const person = c.get("person");
        const { passwort } = c.req.valid("json");
        // Ein Versuch zur Zeit: Wer die Wartezeit frei findet, setzt sie für die Dauer der Prüfung selbst (bedingtes UPDATE, atomar); parallele Versuche bekommen 429
        const [reserviert] = await db
          .update(user)
          .set({ naechsterVersuchAb: new Date(Date.now() + PRUEFDAUER_MS) })
          .where(
            and(
              eq(user.id, person.id),
              or(
                isNull(user.naechsterVersuchAb),
                lte(user.naechsterVersuchAb, new Date()),
              ),
            ),
          )
          .returning({ id: user.id });
        if (!reserviert) return c.json(ZU_VIELE_ANFRAGEN, 429);
        // Nach der Prüfung gilt die Wartezeit des Zählers oder keine; ein richtiges Passwort lässt den Zähler unberührt
        let naechsterVersuchAb: Date | null = null;
        let falsch = false;
        try {
          // Läuft vor der Transaktion: scrypt hält keine Sperre; disableRefresh, damit /api/v1 keine Sitzung verlängert
          await auth.api.verifyPassword({
            body: { password: passwort },
            headers: c.req.raw.headers,
            query: { disableRefresh: true },
          });
        } catch (fehler) {
          if (!isAPIError(fehler) || fehler.body?.code !== "INVALID_PASSWORD") {
            throw fehler;
          }
          falsch = true;
          const [erhoeht] = await db
            .update(user)
            .set({ fehlversuche: sql`${user.fehlversuche} + 1` })
            .where(eq(user.id, person.id))
            .returning({ fehlversuche: user.fehlversuche });
          const minuten = wartezeitMinuten(erhoeht?.fehlversuche ?? 0);
          if (minuten > 0) {
            naechsterVersuchAb = new Date(Date.now() + minuten * 60_000);
          }
        } finally {
          await db
            .update(user)
            .set({ naechsterVersuchAb })
            .where(eq(user.id, person.id));
        }
        if (falsch) {
          return c.json(
            {
              code: "PASSWORT_FALSCH",
              message: "Das Passwort stimmt nicht.",
            },
            400,
          );
        }
        const geloescht = await db.transaction(async (tx) => {
          // Aus der Datenbank, nicht aus der Sitzung: Die Rolle kann sich seither geändert haben
          const admins = await aktiveAdminIds(tx, person.abteilungId);
          if (istLetzterAdmin(admins, person.id)) return false;
          // Ohne Fremdschlüssel: Der zweite Faktor legt die Person-ID als Wert ab; better-auth räumt sie nicht weg
          await tx
            .delete(verification)
            .where(eq(verification.value, person.id));
          // Sitzungen, Konten, Rollen, Zuordnungen und Push-Tokens löscht die Datenbank per CASCADE
          await tx.delete(user).where(eq(user.id, person.id));
          // Zuletzt, ohne Details: Das Log behält die ID, aber keine Personendaten
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "person_geloescht",
            zielTyp: "person",
            zielId: person.id,
          });
          return true;
        });
        if (!geloescht) return c.json(LETZTER_ADMIN, 409);
        return c.body(null, 204);
      })
  );
}

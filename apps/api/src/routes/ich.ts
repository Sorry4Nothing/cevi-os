import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { kind, kindZugang, profilbild, stufe, user } from "../db/schema.js";
import { bildUrl } from "../bild.js";
import { eingabe } from "../eingabe.js";
import { ladeKindKontoEinstellung } from "../kind-konto.js";
import type { Person } from "../rechte.js";
import { eintragVon, RECHT_IDS } from "../rechtemodell/katalog.js";
import { ladeRechteSatz } from "../rechtemodell/satz.js";
import { erstelleLagerBenachrichtigungEinstellungRouten } from "./lager/benachrichtigungen.js";
import { telefonSchema } from "../telefon.js";

// Mindestens ein Feld: Ein leeres set() wirft in Drizzle («No values to set»)
const profilSchema = z
  .strictObject({
    pushChat: z.boolean(),
    pushProgramme: z.boolean(),
    pushAnmeldungen: z.boolean(),
    telefon: telefonSchema,
  })
  .partial()
  .refine((b) => Object.values(b).some((wert) => wert !== undefined));

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
            ceviName: user.ceviName,
            benutzername: user.username,
            mussPasswortAendern: user.mussPasswortAendern,
            datenschutzGelesenAm: user.datenschutzGelesenAm,
            telefon: user.telefon,
            pushChat: user.pushChat,
            pushProgramme: user.pushProgramme,
            pushAnmeldungen: user.pushAnmeldungen,
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
          .innerJoin(kindZugang, eq(kindZugang.kindId, kind.id))
          .where(
            and(
              eq(kindZugang.userId, person.id),
              eq(kind.abteilungId, person.abteilungId),
              isNull(kind.inaktivSeit),
            ),
          )
          .orderBy(asc(kind.id));
        // Die Sitzung löscht die Datenbank mit der Person (CASCADE); ohne Zeile ist sie nicht mehr gültig
        if (!profil) throw new HTTPException(401);
        // Das eigene Konto eines Kindes (#644): nur dieses Kind, nie ein anderes. chat sagt, was das Konto im Gruppenchat darf («aus», «lesen», «schreiben»)
        let teilnehmer: {
          kindId: string;
          stufeId: string;
          aktiv: boolean;
          chat: "aus" | "lesen" | "schreiben";
        } | null = null;
        if (person.kindId) {
          const [eigenes, einstellung] = await Promise.all([
            db
              .select({ stufeId: kind.stufeId, inaktivSeit: kind.inaktivSeit })
              .from(kind)
              .where(eq(kind.id, person.kindId)),
            ladeKindKontoEinstellung(db, person.abteilungId),
          ]);
          if (eigenes[0]) {
            teilnehmer = {
              kindId: person.kindId,
              stufeId: eigenes[0].stufeId,
              aktiv: eigenes[0].inaktivSeit === null,
              chat: einstellung.erlaubt ? einstellung.chat : "aus",
            };
          }
        }
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
                .orderBy(asc(stufe.name), asc(stufe.id));
        // Die Rechte der Person (#650), damit die Verwaltung nur zeigt, was der Server erlaubt: je Recht des Katalogs, das sich vergeben lässt oder fest ist, die Geltung «alle» oder «eigene». Nur Kennungen; die Prüfung bleibt auf dem Server. Eine Abfrage
        const satz = await ladeRechteSatz(db, person);
        const rechte = RECHT_IDS.flatMap((recht) => {
          if (eintragVon(recht).art === "struktur") return [];
          const herkunft = satz.herkuenfte(recht);
          return herkunft.length === 0
            ? []
            : [
                {
                  recht,
                  geltung: herkunft.some((h) => h.geltung === "alle")
                    ? ("alle" as const)
                    : ("eigene" as const),
                },
              ];
        });
        // Der Anmelde-Push gilt nur Leitenden: Allen anderen zeigt die API den Schalter nicht
        const { pushAnmeldungen, ...rest } = profil;
        return c.json({
          ...rest,
          ...(person.rollen.length > 0 && { pushAnmeldungen }),
          admin: person.admin,
          // Das Konto hat ihn eingerichtet; ob diese Sitzung den Code geprüft hat, steht nicht hier (App-Sitzungen nie, #721)
          zweiterFaktor: person.zweiterFaktorKonto ?? person.zweiterFaktor,
          rollen: person.rollen,
          rechte,
          stufen,
          kinder,
          // Nur beim eigenen Konto eines Kindes; für alle anderen bleibt die Antwort, wie sie war
          ...(teilnehmer && { teilnehmer }),
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
      // Schalter der Lager-Benachrichtigungen je Art (#369)
      .route(
        "/lager-benachrichtigungen",
        erstelleLagerBenachrichtigungEinstellungRouten({ db }),
      )
  );
}

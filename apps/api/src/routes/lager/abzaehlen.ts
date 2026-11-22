import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { abzaehlen, lagerMitglied, teilnehmer, user } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { sperreLager } from "../../lager/ressorts.js";
import { legeZeilenAn, setzeZeilen } from "../../lager/sync.js";
// Meldet die Tabellen im Register des Sync-Kerns an
import "../../lager/teilnehmer.js";

const SEITE = 100;
// Höchstens so viele Haken je Anfrage (SR-71)
export const MAX_HAKEN = 200;

const lagerPfad = z.strictObject({ id: z.uuid() });
const listeAbfrage = z.strictObject({
  // «teilnehmer»: die Teilnehmenden, «team»: die Mitglieder des Lagers
  art: z.enum(["teilnehmer", "team"]).default("teilnehmer"),
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(SEITE),
  // Nur diese Stufe (nur bei art=teilnehmer), ohne Beachtung der Gross- und Kleinschreibung
  stufe: z.string().trim().min(1).max(50).optional(),
  // Nur die Mitglieder dieser Gruppe (#387): bei art=teilnehmer die Teilnehmenden, bei art=team die Leitenden und Mitglieder der Gruppe
  gruppe: z.uuid().optional(),
});
const haken = z
  .strictObject({
    geprueft: z.boolean(),
    teilnehmerIds: z.array(z.uuid()).max(MAX_HAKEN).default([]),
    personIds: z.array(z.uuid()).max(MAX_HAKEN).default([]),
  })
  .refine(
    (b) =>
      b.teilnehmerIds.length + b.personIds.length >= 1 &&
      b.teilnehmerIds.length + b.personIds.length <= MAX_HAKEN &&
      new Set(b.teilnehmerIds).size === b.teilnehmerIds.length &&
      new Set(b.personIds).size === b.personIds.length,
  );
// Zurücksetzen verlangt die ausdrückliche Bestätigung im Body: Ein vergessener Aufruf oder ein falscher Pfad löscht keinen Stand
const zuruecksetzen = z.strictObject({ bestaetigt: z.literal(true) });

// Abzählliste des Lagers (#384): eine gemeinsame Liste für alle, die abzählen («x von y da»). Lesen braucht teilnehmer.lesen, Abhaken und Zurücksetzen abzaehlen.schreiben (Standard: Lagerleitung, Leitung und Team). Beides ändert nur den Haken, nie die Teilnehmenden: Das Team löscht nichts. Der Haken ist ein Zustand, den jeder Schreiber auf denselben Wert setzt; er hat darum keine Versionsprüfung und kein 409 bei zwei gleichzeitigen Antworten (lager/sync.ts setzeZeilen)
export function erstelleAbzaehlenRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db, { recht: "teilnehmer.lesen" });
  const schreiben = lagerZugriff(db, { recht: "abzaehlen.schreiben" });

  // Eine Abfrage für die Seite (Teilnehmende oder Mitglieder mit ihrem Haken, Join statt Abfrage je Zeile), eine für die Summen über den ganzen Filter
  async function lade(
    lagerId: string,
    abteilungId: string,
    p: z.infer<typeof listeAbfrage>,
  ) {
    const { art, nach, limit, stufe, gruppe } = p;
    // Gehört die Person oder der Teilnehmende zur Gruppe: ein Teilnehmer in einer Gruppe, die es nicht gibt, ergibt eine leere Liste
    const inGruppe = (spalte: "teilnehmer_id" | "person_id", id: unknown) =>
      gruppe
        ? sql`exists (select 1 from gruppe_zuordnung z where z.lager_id = ${lagerId} and z.gruppe_id = ${gruppe} and z.${sql.raw(spalte)} = ${id})`
        : undefined;
    if (art === "teilnehmer") {
      const gleich = and(
        eq(abzaehlen.lagerId, teilnehmer.lagerId),
        eq(abzaehlen.teilnehmerId, teilnehmer.id),
      );
      const filter = and(
        eq(teilnehmer.lagerId, lagerId),
        // Wer nicht dabei ist, wird nicht abgezählt (#387)
        eq(teilnehmer.abgewaehlt, false),
        stufe ? sql`lower(${teilnehmer.stufe}) = lower(${stufe})` : undefined,
        inGruppe("teilnehmer_id", teilnehmer.id),
      );
      const [zeilen, [summe]] = await Promise.all([
        db
          .select({
            id: teilnehmer.id,
            vorname: teilnehmer.vorname,
            nachname: teilnehmer.nachname,
            stufe: teilnehmer.stufe,
            geprueft: sql<boolean>`coalesce(${abzaehlen.geprueft}, false)`,
            geprueftAm: abzaehlen.geprueftAm,
          })
          .from(teilnehmer)
          .leftJoin(abzaehlen, gleich)
          .where(
            and(
              filter,
              nach
                ? sql`(${teilnehmer.nachname}, ${teilnehmer.vorname}, ${teilnehmer.id}) > (select t.nachname, t.vorname, t.id from teilnehmer t where t.id = ${nach} and t.lager_id = ${lagerId})`
                : undefined,
            ),
          )
          .orderBy(
            asc(teilnehmer.nachname),
            asc(teilnehmer.vorname),
            asc(teilnehmer.id),
          )
          .limit(limit + 1),
        db
          .select({
            gesamt: sql<number>`count(*)::int`,
            da: sql<number>`count(*) filter (where ${abzaehlen.geprueft})::int`,
          })
          .from(teilnehmer)
          .leftJoin(abzaehlen, gleich)
          .where(filter),
      ]);
      const seite = zeilen.slice(0, limit);
      return {
        eintraege: seite.map((z) => ({ ...z, teilnehmerId: z.id })),
        naechster: zeilen.length > limit ? seite[limit - 1]!.id : null,
        da: summe!.da,
        gesamt: summe!.gesamt,
      };
    }
    // Die Mitglieder des Lagers mit aktivem Konto
    const gleich = and(
      eq(abzaehlen.lagerId, lagerMitglied.lagerId),
      eq(abzaehlen.personId, lagerMitglied.personId),
    );
    const filter = and(
      eq(lagerMitglied.lagerId, lagerId),
      // Nur Konten der Abteilung: Eine falsche Mitgliedszeile eines fremden Kontos nennt keinen Namen
      eq(user.abteilungId, abteilungId),
      isNull(user.deaktiviertAm),
      sql`coalesce(${user.banned}, false) = false`,
      inGruppe("person_id", lagerMitglied.personId),
    );
    const [zeilen, [summe]] = await Promise.all([
      db
        .select({
          id: lagerMitglied.personId,
          name: user.name,
          ceviName: user.ceviName,
          geprueft: sql<boolean>`coalesce(${abzaehlen.geprueft}, false)`,
          geprueftAm: abzaehlen.geprueftAm,
        })
        .from(lagerMitglied)
        .innerJoin(user, eq(user.id, lagerMitglied.personId))
        .leftJoin(abzaehlen, gleich)
        .where(
          and(
            filter,
            nach
              ? sql`(${user.name}, ${user.id}) > (select u.name, u.id from "user" u where u.id = ${nach})`
              : undefined,
          ),
        )
        .orderBy(asc(user.name), asc(user.id))
        .limit(limit + 1),
      db
        .select({
          gesamt: sql<number>`count(*)::int`,
          da: sql<number>`count(*) filter (where ${abzaehlen.geprueft})::int`,
        })
        .from(lagerMitglied)
        .innerJoin(user, eq(user.id, lagerMitglied.personId))
        .leftJoin(abzaehlen, gleich)
        .where(filter),
    ]);
    const seite = zeilen.slice(0, limit);
    return {
      eintraege: seite.map((z) => ({ ...z, personId: z.id })),
      naechster: zeilen.length > limit ? seite[limit - 1]!.id : null,
      da: summe!.da,
      gesamt: summe!.gesamt,
    };
  }

  return new Hono<LagerEnv>()
    .get(
      "/:id/abzaehlen",
      lesen,
      eingabe("param", lagerPfad),
      eingabe("query", listeAbfrage),
      async (c) =>
        c.json(
          await lade(
            c.get("lager").lager.id,
            c.get("person").abteilungId,
            c.req.valid("query"),
          ),
        ),
    )
    .put(
      "/:id/abzaehlen",
      schreiben,
      eingabe("param", lagerPfad),
      eingabe("json", haken),
      async (c) => {
        const lagerId = c.get("lager").lager.id;
        const k = { lagerId, personId: c.get("person").id };
        const { geprueft, teilnehmerIds, personIds } = c.req.valid("json");
        const geaendert = await db.transaction(async (tx) => {
          await sperreLager(tx, lagerId);
          // Alle genannten Einträge müssen zu diesem Lager gehören: sonst 404, auch für Einträge eines fremden Lagers
          const [kinder, mitglieder, vorhanden] = await Promise.all([
            teilnehmerIds.length === 0
              ? []
              : tx
                  .select({ id: teilnehmer.id })
                  .from(teilnehmer)
                  .where(
                    and(
                      eq(teilnehmer.lagerId, lagerId),
                      inArray(teilnehmer.id, teilnehmerIds),
                    ),
                  ),
            personIds.length === 0
              ? []
              : tx
                  .select({ id: lagerMitglied.personId })
                  .from(lagerMitglied)
                  .innerJoin(user, eq(user.id, lagerMitglied.personId))
                  .where(
                    and(
                      eq(lagerMitglied.lagerId, lagerId),
                      eq(user.abteilungId, c.get("person").abteilungId),
                      inArray(lagerMitglied.personId, personIds),
                    ),
                  ),
            tx
              .select()
              .from(abzaehlen)
              .where(
                and(
                  eq(abzaehlen.lagerId, lagerId),
                  or(
                    teilnehmerIds.length > 0
                      ? inArray(abzaehlen.teilnehmerId, teilnehmerIds)
                      : undefined,
                    personIds.length > 0
                      ? inArray(abzaehlen.personId, personIds)
                      : undefined,
                  ),
                ),
              ),
          ]);
          if (
            kinder.length !== teilnehmerIds.length ||
            mitglieder.length !== personIds.length
          ) {
            throw new HTTPException(404);
          }
          const schonDa = new Set(
            vorhanden.map((z) => z.teilnehmerId ?? z.personId),
          );
          // Was schon stimmt, bleibt unberührt (keine neue Version, kein Feed-Eintrag)
          const zuAendern = vorhanden
            .filter((z) => z.geprueft !== geprueft)
            .map((z) => z.id);
          const zuAnlegen = geprueft
            ? [
                ...teilnehmerIds
                  .filter((id) => !schonDa.has(id))
                  .map((teilnehmerId) => ({ teilnehmerId })),
                ...personIds
                  .filter((id) => !schonDa.has(id))
                  .map((personId) => ({ personId })),
              ]
            : [];
          const jetzt = new Date();
          const geaendertZeilen = await setzeZeilen(tx, abzaehlen, k, {
            ids: zuAendern,
            werte: { geprueft, geprueftAm: geprueft ? jetzt : null },
          });
          const neu = await legeZeilenAn(
            tx,
            abzaehlen,
            k,
            zuAnlegen.map((z) => ({ ...z, geprueft: true, geprueftAm: jetzt })),
          );
          return geaendertZeilen.length + neu.length;
        });
        return c.json({ geaendert });
      },
    )
    .post(
      "/:id/abzaehlen/zuruecksetzen",
      schreiben,
      eingabe("param", lagerPfad),
      eingabe("json", zuruecksetzen),
      async (c) => {
        const lagerId = c.get("lager").lager.id;
        const k = { lagerId, personId: c.get("person").id };
        const zurueckgesetzt = await db.transaction(async (tx) => {
          await sperreLager(tx, lagerId);
          // Nur die gesetzten Haken: eine Abfrage, ein Update
          const gesetzt = await tx
            .select({ id: abzaehlen.id })
            .from(abzaehlen)
            .where(
              and(eq(abzaehlen.lagerId, lagerId), eq(abzaehlen.geprueft, true)),
            );
          const zeilen = await setzeZeilen(tx, abzaehlen, k, {
            ids: gesetzt.map((z) => z.id),
            werte: { geprueft: false, geprueftAm: null },
          });
          return zeilen.length;
        });
        return c.json({ zurueckgesetzt });
      },
    );
}

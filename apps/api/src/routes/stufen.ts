import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  anwesenheitKind,
  anwesenheitLeitung,
  kind,
  leitungAnmeldung,
  programm,
  programmStufe,
  rolle,
  stufe,
  teilnahme,
  user,
} from "../db/schema.js";
import { eingabe } from "../eingabe.js";
import { kontakteMitTelefon, stufenMitKind } from "../kontakte.js";
import {
  aktivesKonto,
  hatRolle,
  programmBeginn,
  stufenleitungDerStufen,
  type Person,
} from "../rechte.js";

const pfadSchema = z.strictObject({ id: z.uuid() });
const anwesenheitSchema = z.strictObject({
  anzahl: z.coerce.number().int().min(1).max(20).default(5),
});
const kindPfadSchema = z.strictObject({
  id: z.uuid(),
  programmId: z.uuid(),
  kindId: z.uuid(),
});
const leitungPfadSchema = z.strictObject({
  id: z.uuid(),
  programmId: z.uuid(),
  userId: z.uuid(),
});
// null nimmt den Eintrag zurück: wieder «nicht erfasst»
const erfassenSchema = z.strictObject({ da: z.boolean().nullable() });

// So lange nach Beginn des Programms lässt sich die Anwesenheit noch erfassen und ändern
const ANWESENHEIT_FRIST_TAGE = 14;
const ANWESENHEIT_GESCHLOSSEN = {
  code: "ANWESENHEIT_GESCHLOSSEN",
  message: `Die Anwesenheit lässt sich erst nach Beginn des Programms und bis ${ANWESENHEIT_FRIST_TAGE} Tage danach erfassen.`,
};

type Antwort = "ja" | "nein" | "offen";

// Nicht erfasst zählt weder als da noch als nicht da; ohne erfasste Anlässe gibt es keine Quote
const quote = (da: number, von: number) => ({
  da,
  von,
  prozent: von === 0 ? null : Math.round((da * 100) / von),
});

export function erstelleStufenRouten({ db }: { db: Db }) {
  // Stufen und Anwesenheit sehen nur Admins und die Leitung der Stufe; fremde Stufen sind 404
  async function stufeMitLeitung(person: Person, id: string) {
    const [zeile] = await db
      .select({ id: stufe.id, name: stufe.name })
      .from(stufe)
      .where(and(eq(stufe.id, id), eq(stufe.abteilungId, person.abteilungId)));
    if (!zeile) throw new HTTPException(404);
    if (!(person.admin || hatRolle(person, id, "leitung"))) {
      throw new HTTPException(403);
    }
    return zeile;
  }

  // Aktives Programm der Stufe: unbekannte sind 404, bekannte ausserhalb der Frist false
  async function erfassbar(
    person: Person,
    stufeId: string,
    programmId: string,
  ) {
    const [zeile] = await db
      .select({
        offen: sql<boolean>`${programmBeginn} <= now() and ${programmBeginn} > now() - make_interval(days => ${ANWESENHEIT_FRIST_TAGE})`,
      })
      .from(programm)
      .innerJoin(
        programmStufe,
        and(
          eq(programmStufe.programmId, programm.id),
          eq(programmStufe.stufeId, stufeId),
        ),
      )
      .where(
        and(
          eq(programm.id, programmId),
          eq(programm.abteilungId, person.abteilungId),
          eq(programm.status, "aktiv"),
          inArray(programm.sichtbarkeit, ["leitende", "eltern"]),
        ),
      );
    if (!zeile) throw new HTTPException(404);
    return zeile.offen;
  }

  return new Hono<{ Variables: { person: Person } }>()
    .get("/", async (c) => {
      const person = c.get("person");
      // Alle mit Sitzung: Stufen tragen keine Personendaten, «Stufen wählen» und die Verwaltung brauchen sie
      const stufen = await db
        .select({
          id: stufe.id,
          name: stufe.name,
          kuerzel: stufe.kuerzel,
          reihenfolge: stufe.reihenfolge,
        })
        .from(stufe)
        .where(eq(stufe.abteilungId, person.abteilungId))
        .orderBy(asc(stufe.reihenfolge), asc(stufe.name), asc(stufe.id));
      return c.json({ stufen });
    })
    .get(
      "/:id/anwesenheit",
      eingabe("param", pfadSchema),
      eingabe("query", anwesenheitSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const { anzahl } = c.req.valid("query");
        // Namen und Anwesenheit der Kinder: nie in einen Cache
        c.header("Cache-Control", "no-store");
        const zeile = await stufeMitLeitung(person, id);
        // Die letzten begonnenen Anlässe und der nächste kommende
        const anlass = (vergangen: boolean) =>
          db
            .select({
              id: programm.id,
              titel: programm.titel,
              ganztaegig: programm.ganztaegig,
              beginn: programm.beginn,
              ende: programm.ende,
              tagVon: programm.tagVon,
              tagBis: programm.tagBis,
              erfassbar: sql<boolean>`${programmBeginn} <= now() and ${programmBeginn} > now() - make_interval(days => ${ANWESENHEIT_FRIST_TAGE})`,
            })
            .from(programm)
            .innerJoin(
              programmStufe,
              and(
                eq(programmStufe.programmId, programm.id),
                eq(programmStufe.stufeId, id),
              ),
            )
            .where(
              and(
                eq(programm.abteilungId, person.abteilungId),
                eq(programm.status, "aktiv"),
                inArray(programm.sichtbarkeit, ["leitende", "eltern"]),
                vergangen
                  ? sql`${programmBeginn} <= now()`
                  : sql`${programmBeginn} > now()`,
              ),
            )
            .orderBy(
              vergangen ? desc(programmBeginn) : asc(programmBeginn),
              asc(programm.id),
            )
            .limit(vergangen ? anzahl : 1);
        const [vergangene, kommende] = await Promise.all([
          anlass(true),
          anlass(false),
        ]);
        const anlaesse = [
          ...vergangene.reverse().map((a) => ({ ...a, vergangen: true })),
          ...kommende.map((a) => ({ ...a, vergangen: false })),
        ];
        const programmIds = anlaesse.map((a) => a.id);
        const nurMit = <T>(abfrage: () => Promise<T[]>) =>
          programmIds.length === 0 ? Promise.resolve([]) : abfrage();
        const [
          kinder,
          leitende,
          kinderZusagen,
          kinderDa,
          leitendeZusagen,
          leitendeDa,
        ] = await Promise.all([
          db
            .select({
              id: kind.id,
              vorname: kind.vorname,
              nachname: kind.nachname,
            })
            .from(kind)
            .where(
              and(
                eq(kind.stufeId, id),
                eq(kind.abteilungId, person.abteilungId),
                isNull(kind.inaktivSeit),
              ),
            )
            .orderBy(asc(kind.vorname), asc(kind.nachname), asc(kind.id)),
          db
            .select({ id: user.id, name: user.name, rolle: rolle.typ })
            .from(rolle)
            .innerJoin(
              user,
              and(eq(user.id, rolle.userId), aktivesKonto(person.abteilungId)),
            )
            .where(eq(rolle.stufeId, id))
            .orderBy(asc(user.name), asc(user.id)),
          nurMit(() =>
            db
              .select({
                personId: teilnahme.kindId,
                programmId: teilnahme.programmId,
                wert: teilnahme.status,
              })
              .from(teilnahme)
              .where(inArray(teilnahme.programmId, programmIds)),
          ),
          nurMit(() =>
            db
              .select({
                personId: anwesenheitKind.kindId,
                programmId: anwesenheitKind.programmId,
                wert: anwesenheitKind.da,
              })
              .from(anwesenheitKind)
              .where(inArray(anwesenheitKind.programmId, programmIds)),
          ),
          nurMit(() =>
            db
              .select({
                personId: leitungAnmeldung.userId,
                programmId: leitungAnmeldung.programmId,
                wert: leitungAnmeldung.status,
              })
              .from(leitungAnmeldung)
              .where(inArray(leitungAnmeldung.programmId, programmIds)),
          ),
          nurMit(() =>
            db
              .select({
                personId: anwesenheitLeitung.userId,
                programmId: anwesenheitLeitung.programmId,
                wert: anwesenheitLeitung.da,
              })
              .from(anwesenheitLeitung)
              .where(inArray(anwesenheitLeitung.programmId, programmIds)),
          ),
        ]);
        const nachSchluessel = <T>(
          eintraege: { personId: string; programmId: string; wert: T }[],
        ) => new Map(eintraege.map((e) => [e.personId + e.programmId, e.wert]));
        const mitStaenden = <T extends { id: string }>(
          personen: T[],
          zusagen: Map<string, "ja" | "nein">,
          anwesend: Map<string, boolean>,
        ) =>
          personen.map((p) => {
            const zusage: Antwort[] = anlaesse.map(
              (a) => zusagen.get(p.id + a.id) ?? "offen",
            );
            // Nur vergangene Anlässe haben einen Stand; ohne Eintrag null
            const anwesenheit = anlaesse.map((a) => {
              const da = a.vergangen ? anwesend.get(p.id + a.id) : undefined;
              return da === undefined ? null : da ? "da" : "nicht_da";
            });
            return {
              ...p,
              zusage,
              anwesenheit,
              ...quote(
                anwesenheit.filter((x) => x === "da").length,
                anwesenheit.filter((x) => x !== null).length,
              ),
            };
          });
        const kinderListe = mitStaenden(
          kinder,
          nachSchluessel(kinderZusagen),
          nachSchluessel(kinderDa),
        );
        const leitendeListe = mitStaenden(
          leitende,
          nachSchluessel(leitendeZusagen),
          nachSchluessel(leitendeDa),
        );
        const summe = (liste: { da: number; von: number }[]) =>
          quote(
            liste.reduce((n, p) => n + p.da, 0),
            liste.reduce((n, p) => n + p.von, 0),
          );
        // Zusagen zum nächsten Anlass: die letzte Spalte, wenn er noch aussteht
        const zusagen = (liste: { zusage: Antwort[] }[]) => ({
          ja: liste.filter((p) => p.zusage.at(-1) === "ja").length,
          nein: liste.filter((p) => p.zusage.at(-1) === "nein").length,
          offen: liste.filter((p) => p.zusage.at(-1) === "offen").length,
        });
        return c.json({
          stufe: zeile,
          anlaesse,
          zahlen: {
            kinder: summe(kinderListe),
            leitende: summe(leitendeListe),
          },
          naechster:
            kommende.length === 0
              ? null
              : {
                  programmId: kommende[0].id,
                  kinder: zusagen(kinderListe),
                  leitende: zusagen(leitendeListe),
                },
          kinder: kinderListe,
          leitende: leitendeListe,
        });
      },
    )
    .put(
      "/:id/anwesenheit/:programmId/kinder/:kindId",
      eingabe("param", kindPfadSchema),
      eingabe("json", erfassenSchema),
      async (c) => {
        const person = c.get("person");
        const { id, programmId, kindId } = c.req.valid("param");
        const { da } = c.req.valid("json");
        await stufeMitLeitung(person, id);
        const [ziel] = await db
          .select({ id: kind.id })
          .from(kind)
          .where(
            and(
              eq(kind.id, kindId),
              eq(kind.stufeId, id),
              eq(kind.abteilungId, person.abteilungId),
              isNull(kind.inaktivSeit),
            ),
          );
        if (!ziel) throw new HTTPException(404);
        if (!(await erfassbar(person, id, programmId))) {
          return c.json(ANWESENHEIT_GESCHLOSSEN, 409);
        }
        if (da === null) {
          await db
            .delete(anwesenheitKind)
            .where(
              and(
                eq(anwesenheitKind.programmId, programmId),
                eq(anwesenheitKind.kindId, kindId),
              ),
            );
        } else {
          await db
            .insert(anwesenheitKind)
            .values({ programmId, kindId, da, erfasstVon: person.id })
            .onConflictDoUpdate({
              target: [anwesenheitKind.programmId, anwesenheitKind.kindId],
              set: { da, erfasstVon: person.id, erfasstAm: sql`now()` },
            });
        }
        return c.body(null, 204);
      },
    )
    .put(
      "/:id/anwesenheit/:programmId/leitende/:userId",
      eingabe("param", leitungPfadSchema),
      eingabe("json", erfassenSchema),
      async (c) => {
        const person = c.get("person");
        const { id, programmId, userId } = c.req.valid("param");
        const { da } = c.req.valid("json");
        await stufeMitLeitung(person, id);
        const [ziel] = await db
          .select({ id: rolle.userId })
          .from(rolle)
          .innerJoin(
            user,
            and(eq(user.id, rolle.userId), aktivesKonto(person.abteilungId)),
          )
          .where(and(eq(rolle.userId, userId), eq(rolle.stufeId, id)));
        if (!ziel) throw new HTTPException(404);
        if (!(await erfassbar(person, id, programmId))) {
          return c.json(ANWESENHEIT_GESCHLOSSEN, 409);
        }
        if (da === null) {
          await db
            .delete(anwesenheitLeitung)
            .where(
              and(
                eq(anwesenheitLeitung.programmId, programmId),
                eq(anwesenheitLeitung.userId, userId),
              ),
            );
        } else {
          await db
            .insert(anwesenheitLeitung)
            .values({ programmId, userId, da, erfasstVon: person.id })
            .onConflictDoUpdate({
              target: [
                anwesenheitLeitung.programmId,
                anwesenheitLeitung.userId,
              ],
              set: { da, erfasstVon: person.id, erfasstAm: sql`now()` },
            });
        }
        return c.body(null, 204);
      },
    )
    .get("/:id/kontakte", eingabe("param", pfadSchema), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      // Antworten mit Nummern gehören nie in einen Cache
      c.header("Cache-Control", "no-store");
      const [zeile] = await db
        .select({ id: stufe.id })
        .from(stufe)
        .where(
          and(eq(stufe.id, id), eq(stufe.abteilungId, person.abteilungId)),
        );
      // Fremde Stufen bleiben verborgen: Wer weder Admin noch Leitung noch Elternteil der Stufe ist, bekommt 404
      if (
        !zeile ||
        !(
          person.admin ||
          hatRolle(person, id, "leitung") ||
          (await stufenMitKind(db, person, [id])).has(id)
        )
      ) {
        throw new HTTPException(404);
      }
      const sl = await stufenleitungDerStufen(db, person.abteilungId, [id]);
      return c.json({ kontakte: await kontakteMitTelefon(db, person, sl) });
    });
}

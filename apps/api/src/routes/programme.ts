import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  kind,
  kindZugang,
  leitungAnmeldung,
  programm,
  programmEckdaten,
  profilbild,
  rolle,
  stufe,
  teilnahme,
  user,
} from "../db/schema.js";
import { bildUrl } from "../bild.js";
import { pushAnmeldung } from "../anmeldung-push.js";
import { eingabe } from "../eingabe.js";
import { programmStufen } from "../termine/stufen-sicht.js";
import { kontakteMitTelefon } from "../kontakte.js";
import type { Fcm } from "../push.js";
import {
  aktivesKonto,
  darfLeitungAnmelden,
  programmBeginn,
  stufenleitungDerStufen,
  type Person,
} from "../rechte.js";
import { programmSichtbar } from "../programmsicht.js";
import { darf } from "../rechtemodell/darf.js";
import {
  hatRechtMitFaktor,
  stufeObjekt,
} from "../rechtemodell/personenrechte.js";

// PostgreSQL 18 lehnt das Jahr 0000 ab (Fehler 22008), zod lässt es durch
// «offen» hat keine Zeile; die Routen füllen es mit coalesce
type Antwort = "ja" | "nein" | "offen";

const tag = z.iso.date().refine((wert) => !wert.startsWith("0000"));
// «alle=1» holt auch ausgeblendete (intern) Programme, nur für die Abteilungsleitung; für alle anderen gilt es nicht
const fensterSchema = z.strictObject({
  von: tag,
  bis: tag,
  alle: z.literal("1").optional(),
});
const pfadSchema = z.strictObject({ id: z.uuid() });
const leitungSchema = z.strictObject({ status: z.enum(["ja", "nein"]) });
const teilnahmePfad = z.strictObject({ id: z.uuid(), kindId: z.uuid() });
const teilnahmeSchema = z.strictObject({ status: z.enum(["ja", "nein"]) });
// Beginn in Schweizer Zeit: Ein ganztägiges Programm beginnt um Mitternacht seines ersten Tages
const BEGINN = sql`coalesce(programm.beginn, programm.tag_von::timestamp at time zone 'Europe/Zurich')`;

// Ein Satz Felder für Liste und Detail; nie abteilung_id, google_event_id oder google_serie
function programmFelder() {
  return {
    id: programm.id,
    titel: programm.titel,
    status: programm.status,
    sichtbarkeit: programm.sichtbarkeit,
    ganztaegig: programm.ganztaegig,
    beginn: programm.beginn,
    ende: programm.ende,
    tagVon: programm.tagVon,
    tagBis: programm.tagBis,
    // Mit Namen für die App: die Stufen-Tags des Programms (#449), nur aus der eigenen Abteilung
    stufen: sql<
      { id: string; name: string }[]
    >`coalesce((select jsonb_agg(jsonb_build_object('id', tag.id, 'name', tag.name) order by tag.id) from programm_tag join tag on tag.id = programm_tag.tag_id and tag.typ = 'stufe' and tag.abteilung_id = programm.abteilung_id where programm_tag.programm_id = programm.id), '[]'::jsonb)`,
  };
}

export function erstelleProgrammRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  // Aktiv und noch nicht begonnen: nur dann lässt sich die Teilnahme melden und ändern
  async function teilnahmeOffen(programmId: string) {
    const [zeile] = await db
      .select({ id: programm.id })
      .from(programm)
      .where(
        and(
          eq(programm.id, programmId),
          eq(programm.status, "aktiv"),
          sql`${BEGINN} > now()`,
        ),
      );
    return !!zeile;
  }

  // Nur die eigenen, aktiven Kinder in einer zugeordneten Stufe, für alle Programme in einer Abfrage; Leitende korrigieren per PUT und sehen die Übersicht über GET /:id/teilnahmen
  async function eigeneKinder(person: Person, programmIds: string[]) {
    const nachProgramm = new Map<
      string,
      { id: string; vorname: string; status: "ja" | "nein" | null }[]
    >();
    if (programmIds.length === 0) return nachProgramm;
    const zeilen = await db
      .select({
        programmId: programmStufen.programmId,
        id: kind.id,
        vorname: kind.vorname,
        status: teilnahme.status,
      })
      .from(kind)
      .innerJoin(
        kindZugang,
        and(eq(kindZugang.kindId, kind.id), eq(kindZugang.userId, person.id)),
      )
      .innerJoin(
        programmStufen,
        and(
          eq(programmStufen.stufeId, kind.stufeId),
          inArray(programmStufen.programmId, programmIds),
        ),
      )
      .leftJoin(
        teilnahme,
        and(
          eq(teilnahme.kindId, kind.id),
          eq(teilnahme.programmId, programmStufen.programmId),
        ),
      )
      .where(
        and(eq(kind.abteilungId, person.abteilungId), isNull(kind.inaktivSeit)),
      )
      .orderBy(kind.vorname, kind.id);
    for (const { programmId, ...eintrag } of zeilen) {
      const liste = nachProgramm.get(programmId) ?? [];
      liste.push(eintrag);
      nachProgramm.set(programmId, liste);
    }
    return nachProgramm;
  }

  return new Hono<{ Variables: { person: Person } }>()
    .get("/", eingabe("query", fensterSchema), async (c) => {
      const person = c.get("person");
      const { von, bis, alle } = c.req.valid("query");
      const internSehen =
        alle && (await darf(db, person, "programm.intern_sehen"));
      const programme = await db
        .select(programmFelder())
        .from(programm)
        .where(
          and(
            programmSichtbar(person),
            // «intern» heisst in der App für niemanden sichtbar; die Verwaltung holt sie mit alle=1 zum Einblenden, wer das Recht dazu hat (#650)
            alle && internSehen
              ? undefined
              : ne(programm.sichtbarkeit, "intern"),
            // Inklusive Schweizer Kalendertage: Ein Lager zählt an jedem seiner Tage
            sql`coalesce(programm.tag_bis, (programm.ende at time zone 'Europe/Zurich')::date) >= ${von}`,
            sql`coalesce(programm.tag_von, (programm.beginn at time zone 'Europe/Zurich')::date) <= ${bis}`,
          ),
        )
        .orderBy(
          sql`coalesce(programm.beginn, programm.tag_von::timestamp at time zone 'Europe/Zurich')`,
          programm.id,
        );
      const kinder = await eigeneKinder(
        person,
        programme.map((p) => p.id),
      );
      return c.json({
        programme: programme.map((p) => ({
          ...p,
          kinder: kinder.get(p.id) ?? [],
        })),
      });
    })
    .get("/:id", eingabe("param", pfadSchema), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      const [zeile] = await db
        .select(programmFelder())
        .from(programm)
        .where(and(eq(programm.id, id), programmSichtbar(person)));
      if (!zeile) throw new HTTPException(404);
      // Nur wer sich anmelden dürfte, bekommt den Schlüssel; undefined fällt aus dem JSON, für alle anderen fehlt er
      let eigeneAnmeldung: "ja" | "nein" | "offen" | undefined;
      // Die Stufen-Tags kommen schon mit dem Programm (zeile.stufen), keine zweite Abfrage
      if (
        darfLeitungAnmelden(
          person,
          zeile.stufen.map((s) => s.id),
        )
      ) {
        const [anmeldung] = await db
          .select({ status: leitungAnmeldung.status })
          .from(leitungAnmeldung)
          .where(
            and(
              eq(leitungAnmeldung.programmId, id),
              eq(leitungAnmeldung.userId, person.id),
            ),
          );
        eigeneAnmeldung = anmeldung?.status ?? "offen";
      }
      const kinder = (await eigeneKinder(person, [id])).get(id) ?? [];
      // Eckdaten der Webseite: Tag und Stufe müssen passen; bei mehreren Stufen gewinnt die erste nach Name
      const [eckdaten] = await db
        .select({
          treffpunkt: programmEckdaten.treffpunkt,
          schlussOrt: programmEckdaten.schlussOrt,
          schlussZeit: programmEckdaten.schlussZeit,
          mitnehmen: programmEckdaten.mitnehmen,
        })
        .from(programmStufen)
        .innerJoin(
          stufe,
          and(
            eq(stufe.id, programmStufen.stufeId),
            eq(stufe.abteilungId, person.abteilungId),
          ),
        )
        .innerJoin(
          programmEckdaten,
          and(
            eq(programmEckdaten.stufeId, stufe.id),
            eq(
              programmEckdaten.tag,
              sql`(select coalesce(p.tag_von, (p.beginn at time zone 'Europe/Zurich')::date) from programm p where p.id = ${id})`,
            ),
          ),
        )
        .where(eq(programmStufen.programmId, id))
        .orderBy(stufe.name, stufe.id)
        .limit(1);
      return c.json({
        ...zeile,
        treffpunkt: eckdaten?.treffpunkt ?? null,
        schlussOrt: eckdaten?.schlussOrt ?? null,
        schlussZeit: eckdaten?.schlussZeit ?? null,
        mitnehmen: eckdaten?.mitnehmen ?? null,
        teilnahmeOffen: await teilnahmeOffen(id),
        kinder,
        eigeneAnmeldung,
      });
    })
    .get("/:id/teilnahmen", eingabe("param", pfadSchema), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      const [zeile] = await db
        .select({ id: programm.id })
        .from(programm)
        .where(and(eq(programm.id, id), programmSichtbar(person)));
      if (!zeile) throw new HTTPException(404);
      const stufen = await db
        .select({ id: stufe.id })
        .from(programmStufen)
        .innerJoin(
          stufe,
          and(
            eq(stufe.id, programmStufen.stufeId),
            eq(stufe.abteilungId, person.abteilungId),
          ),
        )
        .where(eq(programmStufen.programmId, id));
      // Ganze Liste: die Abteilungsleitung, die Leitung der Stufe (SL eingeschlossen) und wer «Teilnahmen und Kontakte der Stufe sehen» als Rolle trägt (#650); sonst nur die eigenen Kinder
      const leitungStufen: string[] = [];
      for (const s of stufen) {
        if (
          await hatRechtMitFaktor(
            db,
            person,
            "stufe.einblick",
            stufeObjekt(person, s.id),
          )
        ) {
          leitungStufen.push(s.id);
        }
      }
      const kinder = await db
        .select({
          id: kind.id,
          vorname: kind.vorname,
          nachname: kind.nachname,
          stufeId: kind.stufeId,
          status: sql<Antwort>`coalesce(${teilnahme.status}, 'offen')`,
        })
        .from(kind)
        .innerJoin(
          programmStufen,
          and(
            eq(programmStufen.stufeId, kind.stufeId),
            eq(programmStufen.programmId, id),
          ),
        )
        .leftJoin(
          teilnahme,
          and(eq(teilnahme.kindId, kind.id), eq(teilnahme.programmId, id)),
        )
        .where(
          and(
            eq(kind.abteilungId, person.abteilungId),
            isNull(kind.inaktivSeit),
            or(
              inArray(kind.stufeId, leitungStufen),
              exists(
                db
                  .select({ eins: sql`1` })
                  .from(kindZugang)
                  .where(
                    and(
                      eq(kindZugang.kindId, kind.id),
                      eq(kindZugang.userId, person.id),
                    ),
                  ),
              ),
            ),
          ),
        )
        .orderBy(asc(kind.vorname), asc(kind.nachname), asc(kind.id));
      // Sichtbar, aber weder Einblick in eine Stufe des Programms (die Abteilungsleitung hat ihn abteilungsweit) noch Elternteil eines Kindes im Programm (z. B. SL einer anderen Stufe): kein Recht
      if (
        leitungStufen.length === 0 &&
        kinder.length === 0 &&
        !(await hatRechtMitFaktor(db, person, "stufe.einblick", {
          abteilungId: person.abteilungId,
          abteilungsweit: true,
        }))
      ) {
        throw new HTTPException(403);
      }
      const leitende =
        leitungStufen.length === 0
          ? []
          : await db
              .select({
                id: user.id,
                name: user.name,
                ceviName: user.ceviName,
                bildUrl,
                stufeId: rolle.stufeId,
                rolle: rolle.typ,
                status: sql<Antwort>`coalesce(${leitungAnmeldung.status}, 'offen')`,
              })
              .from(rolle)
              .innerJoin(
                user,
                and(
                  eq(user.id, rolle.userId),
                  aktivesKonto(person.abteilungId),
                ),
              )
              .leftJoin(profilbild, eq(profilbild.userId, user.id))
              .leftJoin(
                leitungAnmeldung,
                and(
                  eq(leitungAnmeldung.programmId, id),
                  eq(leitungAnmeldung.userId, rolle.userId),
                ),
              )
              .where(inArray(rolle.stufeId, leitungStufen))
              .orderBy(asc(user.name), asc(user.id));
      const zaehle = (liste: { status: Antwort }[]) => ({
        ja: liste.filter((e) => e.status === "ja").length,
        nein: liste.filter((e) => e.status === "nein").length,
        offen: liste.filter((e) => e.status === "offen").length,
      });
      return c.json({
        zahlen: { kinder: zaehle(kinder), leitende: zaehle(leitende) },
        kinder,
        leitende,
      });
    })
    .get("/:id/kontakte", eingabe("param", pfadSchema), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      // Antworten mit Nummern gehören nie in einen Cache
      c.header("Cache-Control", "no-store");
      // Kontakte: ein Kontakt je Stufe, die erste SL in der Reihenfolge der Stufenleitung ohne Absage (Status Nein); «offen» zählt als Zusage. Haben alle abgesagt, bleibt der Hauptkontakt. Die leere Liste heisst für die App «Stufenleitung»
      const [zeile] = await db
        .select({ id: programm.id })
        .from(programm)
        .where(and(eq(programm.id, id), programmSichtbar(person)));
      if (!zeile) throw new HTTPException(404);
      const stufen = await db
        .select({ stufeId: programmStufen.stufeId })
        .from(programmStufen)
        .where(eq(programmStufen.programmId, id));
      const sl =
        stufen.length === 0
          ? []
          : await stufenleitungDerStufen(
              db,
              person.abteilungId,
              stufen.map((s) => s.stufeId),
            );
      const abgemeldet =
        sl.length === 0
          ? []
          : await db
              .select({ userId: leitungAnmeldung.userId })
              .from(leitungAnmeldung)
              .where(
                and(
                  eq(leitungAnmeldung.programmId, id),
                  eq(leitungAnmeldung.status, "nein"),
                  inArray(
                    leitungAnmeldung.userId,
                    sl.map((z) => z.id),
                  ),
                ),
              );
      const nein = new Set(abgemeldet.map((a) => a.userId));
      // sl ist nach Priorität sortiert: je Stufe zählt die erste Zeile ohne Absage, sonst die allererste
      const gewaehlt = new Map<string, (typeof sl)[number]>();
      for (const z of sl) {
        const bisher = gewaehlt.get(z.stufeId);
        if (!bisher || (nein.has(bisher.id) && !nein.has(z.id)))
          gewaehlt.set(z.stufeId, z);
      }
      const kontakte = await kontakteMitTelefon(
        db,
        person,
        sl.filter((z) => gewaehlt.get(z.stufeId) === z),
      );
      return c.json({ kontakte });
    })
    .put(
      "/:id/leitung",
      eingabe("param", pfadSchema),
      eingabe("json", leitungSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const { status } = c.req.valid("json");
        // Die Uhr der Datenbank entscheidet, nicht JavaScript
        const [zeile] = await db
          .select({
            begonnen: sql<boolean>`${programmBeginn} <= now()`,
            stufen: sql<
              string[]
            >`coalesce((select array_agg(programm_tag.tag_id) from programm_tag join tag on tag.id = programm_tag.tag_id and tag.typ = 'stufe' where programm_tag.programm_id = programm.id), '{}')`,
          })
          .from(programm)
          .where(and(eq(programm.id, id), programmSichtbar(person)));
        if (!zeile) throw new HTTPException(404);
        if (!darfLeitungAnmelden(person, zeile.stufen)) {
          throw new HTTPException(403);
        }
        // Eigener Code per c.json: onError machte aus einem unbekannten HTTPException-Status den allgemeinen Text
        if (zeile.begonnen) {
          return c.json(
            {
              code: "PROGRAMM_BEGONNEN",
              message: "Das Programm hat schon begonnen.",
            },
            409,
          );
        }
        await db
          .insert(leitungAnmeldung)
          .values({ programmId: id, userId: person.id, status })
          .onConflictDoUpdate({
            target: [leitungAnmeldung.programmId, leitungAnmeldung.userId],
            set: { status },
          });
        return c.body(null, 204);
      },
    )
    .put(
      "/:id/teilnahmen/:kindId",
      eingabe("param", teilnahmePfad),
      eingabe("json", teilnahmeSchema),
      async (c) => {
        const person = c.get("person");
        const { id, kindId } = c.req.valid("param");
        const { status } = c.req.valid("json");
        // Fremde wie unbekannte Programme und Kinder sind 404, erst danach zählt das Recht
        const [zeile] = await db
          .select({ id: programm.id })
          .from(programm)
          .where(and(eq(programm.id, id), programmSichtbar(person)));
        const [ziel] = await db
          .select({ stufeId: kind.stufeId, inaktivSeit: kind.inaktivSeit })
          .from(kind)
          .where(
            and(eq(kind.id, kindId), eq(kind.abteilungId, person.abteilungId)),
          );
        if (!zeile || !ziel) throw new HTTPException(404);
        const [eigenes] = await db
          .select({ eins: sql`1` })
          .from(kindZugang)
          .where(
            and(
              eq(kindZugang.kindId, kindId),
              eq(kindZugang.userId, person.id),
            ),
          );
        const zustaendig =
          !!eigenes ||
          (await hatRechtMitFaktor(
            db,
            person,
            "stufe.einblick",
            stufeObjekt(person, ziel.stufeId),
          ));
        const [zugeordnet] = await db
          .select({ eins: sql`1` })
          .from(programmStufen)
          .where(
            and(
              eq(programmStufen.programmId, id),
              eq(programmStufen.stufeId, ziel.stufeId),
            ),
          );
        if (!zustaendig || !zugeordnet || ziel.inaktivSeit) {
          throw new HTTPException(403);
        }
        if (!(await teilnahmeOffen(id))) {
          return c.json(
            {
              code: "PROGRAMM_GESCHLOSSEN",
              message:
                "Das Programm ist abgesagt oder hat schon begonnen. Die Teilnahme lässt sich nicht mehr ändern.",
            },
            409,
          );
        }
        // Ohne Zeile in returning blieb der Wert gleich: Das löst keinen Push aus
        const geaendert = await db
          .insert(teilnahme)
          .values({
            programmId: id,
            kindId,
            status,
            geaendertVon: person.id,
          })
          .onConflictDoUpdate({
            target: [teilnahme.programmId, teilnahme.kindId],
            set: { status, geaendertVon: person.id, geaendertAm: sql`now()` },
            setWhere: sql`${teilnahme.status} is distinct from ${status}`,
          })
          .returning({ kindId: teilnahme.kindId });
        if (geaendert.length > 0) {
          await pushAnmeldung(
            { db, fcm, c },
            {
              programmId: id,
              abteilungId: person.abteilungId,
              userId: person.id,
              status,
            },
          );
        }
        return c.body(null, 204);
      },
    );
}

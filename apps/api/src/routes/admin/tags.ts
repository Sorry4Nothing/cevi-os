import { and, asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { legeGruppenchatAn } from "../../chat.js";
import type { Db } from "../../db/client.js";
import {
  anlass,
  auditLog,
  personTag,
  programm,
  tag,
  user,
} from "../../db/schema.js";
import { TEAM_ROLLE } from "../../bearbeiten.js";
import { eingabe } from "../../eingabe.js";
import { keinKindKonto } from "../../kind-konto.js";
import type { Person } from "../../rechte.js";
import { darf, verlange } from "../../rechtemodell/darf.js";
import { legeSystemrollenAn } from "../../rechtemodell/gruppenrollen.js";
import {
  gruppeObjekt,
  hatRechtMitFaktor,
  verlangeEines,
} from "../../rechtemodell/personenrechte.js";
import { meldeKategorienAenderung } from "../../outlook/melden.js";
import { legeSeiteFuerTagAn } from "../../website/automatik.js";
import { meldeWebsiteEreignis } from "../../website/ereignisse.js";

const typ = z.enum(["stufe", "funktion", "team", "lager", "anlass"]);
// Ohne Komma und Steuerzeichen: In Outlook trennt das Komma zwei Kategorien, und der Tag-Name ist zugleich der Name der Kategorie (#835)
const name = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^,\p{Cc}]+$/u);
const kuerzel = z.string().trim().min(1).max(20);
const rolle = z.string().trim().min(1).max(50);
const prioritaet = z.number().int().min(1).max(1000);

// Ein Schema pro Route, mit keiner Route ausserhalb der Verwaltung geteilt. Der Typ eines Tags bleibt nach dem Anlegen fest.
// Der Typ «anlass» verlangt den Anlass (anlassId), alle anderen Typen kennen ihn nicht (#626)
const anlegenSchema = z
  .strictObject({
    typ,
    name,
    kuerzel: kuerzel.optional(),
    anlassId: z.uuid().optional(),
  })
  .refine((f) => (f.typ === "anlass") === (f.anlassId !== undefined));
const aendernSchema = z.strictObject({
  name: name.optional(),
  kuerzel: kuerzel.optional(),
});
// Ohne Schlüssel bleibt der Wert, wie er ist (bei einer neuen Zuordnung: leer); null leert ihn
const zuweisenSchema = z.strictObject({
  rolle: rolle.nullable().optional(),
  prioritaet: prioritaet.nullable().optional(),
});
// Diese Rollenwerte an einem Stufen-Tag sind echte Stufenrollen mit Rechten (Sicht «rolle»); sie setzt nur PATCH /admin/personen/:id, mit Audit-Log und Push (#344)
const STUFENROLLEN = ["leitung", "stufenleitung"];
// Lesen darf, wer Gruppen verwaltet oder Mitglieder einer Gruppe ändert
const LESEN = ["gruppen.verwalten", "gruppen.mitglieder"] as const;
const MITGLIEDER = ["gruppen.mitglieder"] as const;
const pfad = () => z.strictObject({ id: z.uuid() });
const pfadPerson = () => z.strictObject({ id: z.uuid(), userId: z.uuid() });

const ANLASS_UNBEKANNT = {
  code: "ANLASS_UNBEKANNT",
  message: "Diesen Anlass gibt es nicht.",
} as const;
const ANLASS_HAT_GRUPPE = {
  code: "ANLASS_HAT_GRUPPE",
  message: "Zu diesem Anlass gibt es schon eine Gruppe.",
} as const;

const NAME_VERGEBEN = {
  code: "TAGNAME_VERGEBEN",
  message: "Es gibt schon einen Tag mit diesem Namen.",
} as const;

// Drizzle legt den Fehler von Postgres in cause: 23505 = Index verletzt, 23503 = Fremdschlüssel verletzt
const pgCode = (fehler: unknown) =>
  (fehler as { cause?: { code?: string } })?.cause?.code;
const pgIndex = (fehler: unknown) =>
  (fehler as { cause?: { constraint_name?: string } })?.cause?.constraint_name;

// Der Anlass einer Gruppe vom Typ «anlass» mit den Angaben seines Termins; leer, wenn es keinen mehr gibt
const anlassSpalten = {
  id: anlass.id,
  titel: programm.titel,
  ganztaegig: programm.ganztaegig,
  beginn: programm.beginn,
  ende: programm.ende,
  tagVon: programm.tagVon,
  tagBis: programm.tagBis,
};

class AnlassFehlt extends Error {}

class Belegt extends Error {
  constructor(readonly personen: number) {
    super();
  }
}

// outlook: true, wenn die Schreibanbindung an Outlook läuft; dann führt jede Änderung an den Namen der Tags die Kategorienliste des Postfachs nach (#835)
export function erstelleTagRouten({
  db,
  outlook = false,
}: {
  db: Db;
  outlook?: boolean;
}) {
  // In SQL auf die Abteilung der Sitzung gefiltert: fremde wie unbekannte IDs sind 404, erst danach zählt das Recht (#650): Gruppen verwalten (alle) oder, für die Mitglieder, das Recht an dieser Gruppe
  async function ladeTag(
    person: Person,
    id: string,
    rechte: readonly string[] = ["gruppen.verwalten"],
  ) {
    const [ziel] = await db
      .select({
        id: tag.id,
        typ: tag.typ,
        name: tag.name,
        kuerzel: tag.kuerzel,
      })
      .from(tag)
      .where(and(eq(tag.id, id), eq(tag.abteilungId, person.abteilungId)));
    if (!ziel) throw new HTTPException(404);
    await verlangeEines(db, person, rechte, gruppeObjekt(person, id));
    return ziel;
  }

  return new Hono<{ Variables: { person: Person } }>()
    .get("/", async (c) => {
      const person = c.get("person");
      // Die Tür: Gruppen verwalten oder Mitglieder irgendeiner Gruppe ändern; wer nur Mitglieder ändert, sieht nur seine Gruppen
      await verlangeEines(db, person, LESEN);
      const alle = await hatRechtMitFaktor(db, person, "gruppen.verwalten");
      const tags = await db
        .select({
          id: tag.id,
          typ: tag.typ,
          name: tag.name,
          kuerzel: tag.kuerzel,
          anzahlPersonen: count(personTag.userId),
          anlass: anlassSpalten,
        })
        .from(tag)
        .leftJoin(personTag, eq(personTag.tagId, tag.id))
        .leftJoin(anlass, eq(anlass.id, tag.anlassId))
        .leftJoin(programm, eq(programm.id, anlass.programmId))
        .where(eq(tag.abteilungId, person.abteilungId))
        .groupBy(tag.id, anlass.id, programm.id)
        .orderBy(asc(tag.typ), asc(tag.name), asc(tag.id));
      const sichtbar: typeof tags = [];
      for (const t of tags) {
        if (
          alle ||
          (await hatRechtMitFaktor(
            db,
            person,
            "gruppen.mitglieder",
            gruppeObjekt(person, t.id),
          ))
        ) {
          sichtbar.push(t);
        }
      }
      // Ohne Anlass liefert der Join lauter null: dann kein Objekt
      return c.json({
        tags: sichtbar.map((t) => ({
          ...t,
          anlass: t.anlass?.id ? t.anlass : null,
        })),
      });
    })
    .post("/", eingabe("json", anlegenSchema), async (c) => {
      const person = c.get("person");
      await verlange(db, person, "gruppen.verwalten", {
        abteilungId: person.abteilungId,
      });
      const felder = c.req.valid("json");
      try {
        const neu = await db.transaction(async (tx) => {
          // Der Anlass muss zur Abteilung gehören und die Art «anlass» haben (ein Lager ist kein Anlass); fremd und unbekannt sind gleich
          if (felder.anlassId) {
            const [ziel] = await tx
              .select({ id: anlass.id })
              .from(anlass)
              .where(
                and(
                  eq(anlass.id, felder.anlassId),
                  eq(anlass.abteilungId, person.abteilungId),
                  eq(anlass.art, "anlass"),
                ),
              );
            if (!ziel) throw new AnlassFehlt();
          }
          const [zeile] = await tx
            .insert(tag)
            .values({
              ...felder,
              kuerzel: felder.kuerzel ?? "",
              abteilungId: person.abteilungId,
            })
            .returning({ id: tag.id });
          // Jede Gruppe hat ihre Systemrollen (#643)
          await legeSystemrollenAn(
            tx,
            person.abteilungId,
            zeile.id,
            felder.typ,
          );
          // Ein Tag vom Typ «stufe» ist eine Stufe (#332) und braucht wie jede Stufe ihren Gruppenchat
          if (felder.typ === "stufe") {
            await legeGruppenchatAn(tx, {
              abteilungId: person.abteilungId,
              stufeId: zeile.id,
            });
          }
          // Zu einer Stufe oder einem Team entsteht eine Seite als Entwurf (#352); scheitert sie, entsteht auch der Tag nicht
          const seiten = await legeSeiteFuerTagAn(tx, {
            abteilungId: person.abteilungId,
            autorId: person.id,
            tagId: zeile.id,
            typ: felder.typ,
            name: felder.name,
          });
          // Nur der Typ, nie der Name
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "tag_angelegt",
            zielTyp: "tag",
            zielId: zeile.id,
            details: { typ: felder.typ, anlassId: felder.anlassId },
          });
          if (outlook) {
            await meldeKategorienAenderung(tx, person.abteilungId, person.id);
          }
          return { ...zeile, seiten };
        });
        for (const seiteId of neu.seiten) {
          meldeWebsiteEreignis({
            art: "seite_geaendert",
            abteilungId: person.abteilungId,
            seiteId,
          });
        }
        return c.json({ id: neu.id }, 201);
      } catch (fehler) {
        if (fehler instanceof AnlassFehlt) return c.json(ANLASS_UNBEKANNT, 400);
        // 23503: der Anlass fiel gleichzeitig weg
        if (pgCode(fehler) === "23503") return c.json(ANLASS_UNBEKANNT, 400);
        if (pgCode(fehler) === "23505") {
          return pgIndex(fehler) === "tag_anlass_eindeutig"
            ? c.json(ANLASS_HAT_GRUPPE, 409)
            : c.json(NAME_VERGEBEN, 409);
        }
        throw fehler;
      }
    })
    .get("/:id", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const ziel = await ladeTag(person, c.req.valid("param").id, LESEN);
      // Der Anlass einer Gruppe vom Typ «anlass», nur für diese (eine zusätzliche Abfrage); null, wenn der Anlass gelöscht wurde
      const [anlassZeile] =
        ziel.typ === "anlass"
          ? await db
              .select(anlassSpalten)
              .from(tag)
              .innerJoin(anlass, eq(anlass.id, tag.anlassId))
              .innerJoin(programm, eq(programm.id, anlass.programmId))
              .where(eq(tag.id, ziel.id))
          : [];
      // Wo der Tag verwendet wird: bisher nur die Zuordnung zu Personen; Sichtbarkeit und Rechte kommen mit #333 und #334
      const personen = await db
        .select({
          userId: personTag.userId,
          rolle: personTag.rolle,
          prioritaet: personTag.prioritaet,
        })
        .from(personTag)
        .where(eq(personTag.tagId, ziel.id))
        .orderBy(asc(personTag.prioritaet), asc(personTag.userId));
      return c.json({
        ...ziel,
        anlass: anlassZeile ?? null,
        verwendung: { personen: personen.length },
        personen,
      });
    })
    .patch(
      "/:id",
      eingabe("param", pfad()),
      eingabe("json", aendernSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const felder = c.req.valid("json");
        await ladeTag(person, id);
        // Ohne Schlüssel wirft Drizzle bei set({}): kein Schreibzugriff
        if (Object.keys(felder).length > 0) {
          try {
            await db.transaction(async (tx) => {
              await tx.update(tag).set(felder).where(eq(tag.id, id));
              // Welche Felder, nie die Werte
              await tx.insert(auditLog).values({
                abteilungId: person.abteilungId,
                akteurId: person.id,
                aktion: "tag_geaendert",
                zielTyp: "tag",
                zielId: id,
                details: {
                  name: felder.name !== undefined,
                  kuerzel: felder.kuerzel !== undefined,
                },
              });
              if (outlook && felder.name !== undefined) {
                await meldeKategorienAenderung(
                  tx,
                  person.abteilungId,
                  person.id,
                );
              }
            });
          } catch (fehler) {
            if (pgCode(fehler) === "23505") return c.json(NAME_VERGEBEN, 409);
            throw fehler;
          }
        }
        return c.body(null, 204);
      },
    )
    .delete("/:id", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      const ziel = await ladeTag(person, id);
      try {
        await db.transaction(async (tx) => {
          const [{ n }] = await tx
            .select({ n: count() })
            .from(personTag)
            .where(eq(personTag.tagId, id));
          if (n > 0) throw new Belegt(n);
          await tx.delete(tag).where(eq(tag.id, id));
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "tag_geloescht",
            zielTyp: "tag",
            zielId: id,
            details: { typ: ziel.typ },
          });
          if (outlook) {
            await meldeKategorienAenderung(tx, person.abteilungId, person.id);
          }
        });
      } catch (fehler) {
        // 23503: eine Zuordnung, die gleichzeitig entsteht
        if (fehler instanceof Belegt || pgCode(fehler) === "23503") {
          return c.json(
            {
              code: "TAG_BELEGT",
              message:
                "Der Tag ist noch Personen zugewiesen. Entziehe ihn zuerst allen Personen.",
              verwendung: {
                personen: fehler instanceof Belegt ? fehler.personen : null,
              },
            },
            409,
          );
        }
        throw fehler;
      }
      return c.body(null, 204);
    })
    .put(
      "/:id/personen/:userId",
      eingabe("param", pfadPerson()),
      eingabe("json", zuweisenSchema),
      async (c) => {
        const person = c.get("person");
        const { id, userId } = c.req.valid("param");
        const felder = c.req.valid("json");
        const { typ: tagTyp } = await ladeTag(person, id, MITGLIEDER);
        // Wer nicht Rechte vergeben darf, ändert keine Rolle, die Rechte gibt, und nimmt sich nicht selbst auf: Die Rolle «verantwortlich» und jede Rolle aus der Verwaltung der Rechte gibt der Gruppe Rechte (#650)
        if (!(await darf(db, person, "rechte.verwalten"))) {
          if (userId === person.id) throw new HTTPException(403);
          if (felder.rolle !== undefined) {
            const [bisher] = await db
              .select({ rolleId: personTag.rolleId })
              .from(personTag)
              .where(
                and(eq(personTag.tagId, id), eq(personTag.userId, userId)),
              );
            if (bisher?.rolleId) throw new HTTPException(403);
            if (felder.rolle?.toLowerCase() === TEAM_ROLLE) {
              throw new HTTPException(403);
            }
          }
        }
        if (
          tagTyp === "stufe" &&
          felder.rolle &&
          STUFENROLLEN.includes(felder.rolle)
        ) {
          throw new HTTPException(400);
        }
        // Eine Person einer anderen Abteilung ist für diese Route unbekannt
        const [ziel] = await db
          .select({ id: user.id })
          .from(user)
          .where(
            and(
              eq(user.id, userId),
              eq(user.abteilungId, person.abteilungId),
              keinKindKonto(user.id),
            ),
          );
        if (!ziel) throw new HTTPException(404);
        await db.transaction(async (tx) => {
          // Anlegen und Ändern in einem Schritt; ein Schlüssel ohne Wert bleibt bei einer bestehenden Zuordnung stehen
          const einfuegen = tx.insert(personTag).values({
            userId,
            tagId: id,
            rolle: felder.rolle ?? null,
            prioritaet: felder.prioritaet ?? null,
          });
          // Ohne Schlüssel wirft Drizzle bei set({}): dann bleibt eine bestehende Zuordnung, wie sie ist
          await (Object.keys(felder).length > 0
            ? einfuegen.onConflictDoUpdate({
                target: [personTag.userId, personTag.tagId],
                set: felder,
              })
            : einfuegen.onConflictDoNothing());
          // Ohne die Rolle: Sie ist Freitext
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "tag_zugewiesen",
            zielTyp: "tag",
            zielId: id,
            details: {
              userId,
              rolle:
                felder.rolle === undefined ? undefined : felder.rolle !== null,
              prioritaet: felder.prioritaet,
            },
          });
        });
        return c.body(null, 204);
      },
    )
    .delete(
      "/:id/personen/:userId",
      eingabe("param", pfadPerson()),
      async (c) => {
        const person = c.get("person");
        const { id, userId } = c.req.valid("param");
        await ladeTag(person, id, MITGLIEDER);
        // Wie beim Zuweisen: Wer nicht Rechte vergeben darf, entzieht keine Rolle, die Rechte gibt (Gruppenrolle, Stufenleitung, «verantwortlich», #777)
        if (!(await darf(db, person, "rechte.verwalten"))) {
          const [bisher] = await db
            .select({ rolleId: personTag.rolleId, rolle: personTag.rolle })
            .from(personTag)
            .where(and(eq(personTag.tagId, id), eq(personTag.userId, userId)));
          const text = bisher?.rolle?.toLowerCase();
          if (
            bisher?.rolleId ||
            (text !== undefined &&
              (STUFENROLLEN.includes(text) || text === TEAM_ROLLE))
          ) {
            throw new HTTPException(403);
          }
        }
        await db.transaction(async (tx) => {
          const entfernt = await tx
            .delete(personTag)
            .where(and(eq(personTag.tagId, id), eq(personTag.userId, userId)))
            .returning({ userId: personTag.userId });
          // Die Person trägt den Tag nicht (oder gehört nicht zur Abteilung: dann gibt es keine Zuordnung zu einem Tag dieser Abteilung)
          if (entfernt.length === 0) throw new HTTPException(404);
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "tag_entzogen",
            zielTyp: "tag",
            zielId: id,
            details: { userId },
          });
        });
        return c.body(null, 204);
      },
    );
}

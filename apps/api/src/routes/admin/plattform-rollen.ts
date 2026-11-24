import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  auditLog,
  personPlattformRolle,
  plattformRolle,
  plattformRolleRecht,
  user,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  istPlattformRecht,
  PLATTFORM_RECHT_NAMEN,
  PLATTFORM_RECHTE,
  type PlattformRecht,
} from "../../plattform.js";
import { keinKindKonto } from "../../kind-konto.js";
import type { Person } from "../../rechte.js";
import { darf, verlange } from "../../rechtemodell/darf.js";
import { pruefeEigeneRechte as pruefeEigeneRechteModell } from "../../rechtemodell/eskalation.js";
import { istRecht, type RechtId } from "../../rechtemodell/katalog.js";
import { verlangeEines } from "../../rechtemodell/tuer.js";

// Plattformrollen der Abteilung (#423): anlegen, Rechte einstellen, einer Person zuweisen und entziehen. Die Abteilungsleitung (zweiter Faktor wie überall unter /admin); die Rechte der Rollen (Liste ohne Namen, anlegen, ändern, löschen) seit #663 auch der Entwickler mit zweitem Faktor, einer Person zuweisen und entziehen nur die Abteilungsleitung. Die Rolle «Abteilungsleitung» steht hier nicht: Ihre Rechte ändert nur der Entwickler, über /admin/rechte/abteilungsleitung.
// Der Entwickler ist nie hier: Ihn vergibt und entzieht nur die Kommandozeile. Die festen Rechte von Entwickler und Abteilungsleitung stehen im Code und nicht in der Datenbank, sie lassen sich darum nicht ändern.
// Eine Rolle gibt nur Rechte des Katalogs (plattform.ts); weiter als die eigenen Rechte reicht keine Vergabe

const name = z.string().trim().min(1).max(50);
// Aufzählung aus dem Katalog: ein unbekannter Name ist 400, nie ein Eintrag in der Datenbank
const rechte = z
  .array(z.enum(PLATTFORM_RECHT_NAMEN as [PlattformRecht, ...PlattformRecht[]]))
  .max(PLATTFORM_RECHT_NAMEN.length)
  .refine((liste) => new Set(liste).size === liste.length);
const anlegenSchema = z.strictObject({ name, rechte });
const aendernSchema = z
  .strictObject({ name: name.optional(), rechte: rechte.optional() })
  .refine((f) => f.name !== undefined || f.rechte !== undefined);
const pfad = () => z.strictObject({ id: z.uuid() });
const pfadPerson = () => z.strictObject({ id: z.uuid(), userId: z.uuid() });

// Der Name der Systemrolle bleibt ihr (#663): keine zweite Rolle «Abteilungsleitung»
const istSystemname = (name: string) =>
  name.trim().toLowerCase() === "abteilungsleitung";

const NAME_VERGEBEN = {
  code: "ROLLENNAME_VERGEBEN",
  message: "Es gibt schon eine Rolle mit diesem Namen.",
} as const;
const ROLLE_VORGEGEBEN = {
  code: "ROLLE_VORGEGEBEN",
  message:
    "Diese Rolle ist vorgegeben und lässt sich nicht löschen oder umbenennen.",
} as const;

// Drizzle legt den Fehler von Postgres in cause: 23505 = Index verletzt
const pgCode = (fehler: unknown) =>
  (fehler as { cause?: { code?: string } })?.cause?.code;

// In der Reihenfolge des Katalogs; ein Name, den der Katalog nicht kennt, fällt weg
const imKatalog = (namen: readonly string[]) =>
  PLATTFORM_RECHT_NAMEN.filter((r) => namen.includes(r));

export function erstellePlattformRollenRouten({ db }: { db: Db }) {
  // In SQL auf die Abteilung der Sitzung gefiltert: fremde wie unbekannte IDs sind 404, erst danach zählt das Recht
  async function ladeRolle(person: Person, id: string) {
    const [rolle] = await db
      .select({
        id: plattformRolle.id,
        name: plattformRolle.name,
        schluessel: plattformRolle.schluessel,
        rechte: sql<
          string[]
        >`coalesce(array_agg(${plattformRolleRecht.recht}) filter (where ${plattformRolleRecht.recht} is not null), '{}')`,
      })
      .from(plattformRolle)
      .leftJoin(
        plattformRolleRecht,
        eq(plattformRolleRecht.rolleId, plattformRolle.id),
      )
      .where(
        and(
          eq(plattformRolle.id, id),
          eq(plattformRolle.abteilungId, person.abteilungId),
        ),
      )
      .groupBy(plattformRolle.id);
    if (!rolle) throw new HTTPException(404);
    return rolle;
  }

  // Rollen und ihre Rechte vergeben ist fest (rechte.verwalten): die Abteilungsleitung (#650); die Rechte der Rollen stellt seit #663 auch der Entwickler ein
  const tuer = (person: Person) =>
    verlangeEines(db, person, ["rechte.verwalten", "rechte.abteilungsleitung"]);
  // Rollen zuweisen und entziehen: nur die Abteilungsleitung. Der Entwickler weist keiner Person Rechte zu, auch sich selbst nicht
  const nurAbteilungsleitung = (person: Person) =>
    verlange(db, person, "rechte.verwalten");

  // Eskalationsschutz: Wer Rechte vergibt, hat sie selbst, und zwar so, wie das Rechtemodell sie der Person gibt: Hat der Entwickler der Abteilungsleitung ein Recht weggenommen, vergibt sie es nicht mehr (#663)
  async function pruefeEigeneRechte(
    person: Person,
    verlangt: readonly string[],
  ) {
    if (!verlangt.every(istPlattformRecht)) throw new HTTPException(403);
    await pruefeEigeneRechteModell(
      db,
      person,
      verlangt.map((recht) => ({
        recht: recht as RechtId,
        geltung: "alle" as const,
      })),
    );
  }

  async function ladeZiel(person: Person, userId: string) {
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
  }

  return new Hono<{ Variables: { person: Person } }>()
    .get("/", async (c) => {
      const person = c.get("person");
      await tuer(person);
      const mitNamen = await darf(db, person, "rechte.verwalten");
      // Zwei Abfragen für die ganze Liste: Rollen mit ihren Rechten, dann alle Vergaben (ohne Namen für den Entwickler: keine Abfrage)
      const [rollen, vergaben] = await Promise.all([
        db
          .select({
            id: plattformRolle.id,
            name: plattformRolle.name,
            schluessel: plattformRolle.schluessel,
            rechte: sql<
              string[]
            >`coalesce(array_agg(${plattformRolleRecht.recht}) filter (where ${plattformRolleRecht.recht} is not null), '{}')`,
          })
          .from(plattformRolle)
          .leftJoin(
            plattformRolleRecht,
            eq(plattformRolleRecht.rolleId, plattformRolle.id),
          )
          .where(eq(plattformRolle.abteilungId, person.abteilungId))
          .groupBy(plattformRolle.id)
          .orderBy(asc(plattformRolle.name), asc(plattformRolle.id)),
        mitNamen
          ? db
              .select({
                rolleId: personPlattformRolle.rolleId,
                id: user.id,
                name: user.name,
              })
              .from(personPlattformRolle)
              .innerJoin(
                plattformRolle,
                and(
                  eq(plattformRolle.id, personPlattformRolle.rolleId),
                  eq(plattformRolle.abteilungId, person.abteilungId),
                ),
              )
              .innerJoin(user, eq(user.id, personPlattformRolle.userId))
              .orderBy(asc(user.name), asc(user.id))
          : [],
      ]);
      return c.json({
        katalog: PLATTFORM_RECHT_NAMEN.map((recht) => ({
          recht,
          bedeutung: PLATTFORM_RECHTE[recht].bedeutung,
          erweitert: PLATTFORM_RECHTE[recht].erweitert,
        })),
        rollen: rollen.map((r) => ({
          id: r.id,
          name: r.name,
          vorgabe: r.schluessel !== null,
          rechte: imKatalog(r.rechte),
          personen: vergaben
            .filter((v) => v.rolleId === r.id)
            .map((v) => ({ id: v.id, name: v.name })),
        })),
      });
    })
    .post("/", eingabe("json", anlegenSchema), async (c) => {
      const person = c.get("person");
      await tuer(person);
      const eingang = c.req.valid("json");
      if (istSystemname(eingang.name)) return c.json(NAME_VERGEBEN, 409);
      await pruefeEigeneRechte(person, eingang.rechte);
      try {
        const neu = await db.transaction(async (tx) => {
          const [zeile] = await tx
            .insert(plattformRolle)
            .values({ abteilungId: person.abteilungId, name: eingang.name })
            .returning({ id: plattformRolle.id });
          if (eingang.rechte.length > 0) {
            await tx
              .insert(plattformRolleRecht)
              .values(
                eingang.rechte.map((recht) => ({ rolleId: zeile.id, recht })),
              );
          }
          // Ohne den Namen der Rolle: nur Kennung und Rechte
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "plattform_rolle_angelegt",
            zielTyp: "plattform_rolle",
            zielId: zeile.id,
            details: { rechte: eingang.rechte },
          });
          return zeile;
        });
        return c.json({ id: neu.id }, 201);
      } catch (fehler) {
        if (pgCode(fehler) === "23505") return c.json(NAME_VERGEBEN, 409);
        throw fehler;
      }
    })
    .patch(
      "/:id",
      eingabe("param", pfad()),
      eingabe("json", aendernSchema),
      async (c) => {
        const person = c.get("person");
        const rolle = await ladeRolle(person, c.req.valid("param").id);
        await tuer(person);
        const aenderung = c.req.valid("json");
        if (aenderung.name !== undefined && istSystemname(aenderung.name)) {
          return c.json(NAME_VERGEBEN, 409);
        }
        // Die Vorgabe behält ihren Namen (#426 findet sie über den Schlüssel, die Oberfläche über den Namen)
        if (
          aenderung.name !== undefined &&
          rolle.schluessel !== null &&
          aenderung.name !== rolle.name
        ) {
          return c.json(ROLLE_VORGEGEBEN, 409);
        }
        // Nur neu hinzukommende Rechte brauchen das eigene Recht; Entziehen darf jede Abteilungsleitung
        const vorher = imKatalog(rolle.rechte);
        const nachher = aenderung.rechte ?? vorher;
        await pruefeEigeneRechte(
          person,
          nachher.filter((r) => !vorher.includes(r)),
        );
        try {
          await db.transaction(async (tx) => {
            // Zwei gleichzeitige Änderungen laufen nacheinander
            await tx
              .select({ id: plattformRolle.id })
              .from(plattformRolle)
              .where(eq(plattformRolle.id, rolle.id))
              .for("no key update");
            // Jede Änderung zählt die Version hoch: Die Matrix (rechte-matrix.ts) speichert nur auf dem Stand, den sie gelesen hat (#643)
            await tx
              .update(plattformRolle)
              .set({
                ...(aenderung.name === undefined
                  ? {}
                  : { name: aenderung.name }),
                version: sql`${plattformRolle.version} + 1`,
              })
              .where(eq(plattformRolle.id, rolle.id));
            if (aenderung.rechte !== undefined) {
              // Nur die Rechte dieses Katalogs ersetzen: Rechte, die die Matrix der Rolle zusätzlich gibt (Mitteilungen, Räume, Lädeli ...), bleiben
              await tx
                .delete(plattformRolleRecht)
                .where(
                  and(
                    eq(plattformRolleRecht.rolleId, rolle.id),
                    inArray(plattformRolleRecht.recht, [
                      ...PLATTFORM_RECHT_NAMEN,
                    ]),
                  ),
                );
              if (nachher.length > 0) {
                await tx
                  .insert(plattformRolleRecht)
                  .values(
                    nachher.map((recht) => ({ rolleId: rolle.id, recht })),
                  );
              }
            }
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "plattform_rolle_geaendert",
              zielTyp: "plattform_rolle",
              zielId: rolle.id,
              details: {
                umbenannt:
                  aenderung.name !== undefined && aenderung.name !== rolle.name,
                rechteVorher: vorher,
                rechteNachher: nachher,
              },
            });
          });
        } catch (fehler) {
          if (pgCode(fehler) === "23505") return c.json(NAME_VERGEBEN, 409);
          throw fehler;
        }
        return c.body(null, 204);
      },
    )
    .delete("/:id", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const rolle = await ladeRolle(person, c.req.valid("param").id);
      await tuer(person);
      if (rolle.schluessel !== null) return c.json(ROLLE_VORGEGEBEN, 409);
      await db.transaction(async (tx) => {
        // Rechte und Vergaben fallen mit (CASCADE): Der Entzug wirkt bei der nächsten Anfrage der Personen
        const entfernt = await tx
          .delete(plattformRolle)
          .where(eq(plattformRolle.id, rolle.id))
          .returning({ id: plattformRolle.id });
        if (entfernt.length === 0) throw new HTTPException(404);
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "plattform_rolle_geloescht",
          zielTyp: "plattform_rolle",
          zielId: rolle.id,
          details: { rechte: imKatalog(rolle.rechte) },
        });
      });
      return c.body(null, 204);
    })
    .put("/:id/personen/:userId", eingabe("param", pfadPerson()), async (c) => {
      const person = c.get("person");
      const { id, userId } = c.req.valid("param");
      const rolle = await ladeRolle(person, id);
      await ladeZiel(person, userId);
      await nurAbteilungsleitung(person);
      // Die Rechte dieses Katalogs wie bisher; die übrigen, die die Matrix der Rolle gibt, prüft der Eskalationsschutz des Rechtemodells (#643)
      await pruefeEigeneRechte(person, imKatalog(rolle.rechte));
      await pruefeEigeneRechteModell(
        db,
        person,
        rolle.rechte
          .filter((r) => istRecht(r) && !istPlattformRecht(r))
          .map((recht) => ({
            recht: recht as RechtId,
            geltung: "alle" as const,
          })),
      );
      await db.transaction(async (tx) => {
        const neu = await tx
          .insert(personPlattformRolle)
          .values({ userId, rolleId: rolle.id })
          .onConflictDoNothing()
          .returning({ userId: personPlattformRolle.userId });
        // Schon vergeben: nichts zu tun und nichts im Audit-Log
        if (neu.length === 0) return;
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "plattform_rolle_vergeben",
          zielTyp: "person",
          zielId: userId,
          details: { rolleId: rolle.id },
        });
      });
      return c.body(null, 204);
    })
    .delete(
      "/:id/personen/:userId",
      eingabe("param", pfadPerson()),
      async (c) => {
        const person = c.get("person");
        const { id, userId } = c.req.valid("param");
        const rolle = await ladeRolle(person, id);
        await ladeZiel(person, userId);
        await nurAbteilungsleitung(person);
        await db.transaction(async (tx) => {
          const entfernt = await tx
            .delete(personPlattformRolle)
            .where(
              and(
                eq(personPlattformRolle.rolleId, rolle.id),
                eq(personPlattformRolle.userId, userId),
              ),
            )
            .returning({ userId: personPlattformRolle.userId });
          // Die Person trägt die Rolle nicht (oder ein gleichzeitiger Entzug war schneller)
          if (entfernt.length === 0) throw new HTTPException(404);
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "plattform_rolle_entzogen",
            zielTyp: "person",
            zielId: userId,
            details: { rolleId: rolle.id },
          });
        });
        return c.body(null, 204);
      },
    );
}

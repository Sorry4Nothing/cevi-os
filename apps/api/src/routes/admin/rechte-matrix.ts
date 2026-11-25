import { and, asc, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  auditLog,
  gruppenRolle,
  gruppenRolleRecht,
  personPlattformRolle,
  personTag,
  plattformRolle,
  plattformRolleRecht,
  tag,
  user,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";
import {
  ladeAbteilungsleitung,
  rechteDerAbteilungsleitung,
  speichereAbteilungsleitung,
} from "../../rechtemodell/abteilungsleitung.js";
import { darf, verlange } from "../../rechtemodell/darf.js";
import {
  beendeSitzungenBeiNeuerPflicht,
  personenDerGruppenrolle,
  personenDerPlattformRolle,
} from "../../rechtemodell/faktor-pflicht.js";
import { pruefeEigeneRechte } from "../../rechtemodell/eskalation.js";
import {
  mitgliederDerRollen,
  ordneZuteilungen,
  unterschied,
  zuteilungenSchema,
} from "../../rechtemodell/gruppenrollen.js";
import {
  BEREICH_NAMEN,
  BEREICHE,
  eintragVon,
  istRecht,
  RECHT_IDS,
  VERGEBBARE_RECHTE,
  type RechtId,
} from "../../rechtemodell/katalog.js";
import { rechteModus } from "../../rechtemodell/modus.js";
import { verlangeEines } from "../../rechtemodell/tuer.js";
import { ladePerson } from "../../rechtemodell/person.js";
import { ladeRechteSatz } from "../../rechtemodell/satz.js";
import {
  STUFENROLLEN_STANDARD,
  type Zuteilung,
} from "../../rechtemodell/standard.js";

// Matrix-API (#643): die Rechte der Abteilung lesen und einstellen, je Gruppe und global. Die Abteilungsleitung mit zweitem Faktor (Pfad /admin, dazu verlange «rechte.verwalten»: ein festes Recht) und seit #663 der Entwickler mit zweitem Faktor («rechte.abteilungsleitung»): Seit #722 hat er jedes Recht, auch «Rechte und Rollen vergeben»: Er sieht Namen, ordnet Personen zu und liest «Was darf wer?» wie die Abteilungsleitung. Die Rechte der Abteilungsleitung ändert nur der Entwickler, nie sie selbst. Der Server prüft alles: Abteilung (fremd = 404, vor dem 403), Katalog (ein Name oder eine Geltung ausserhalb ist 400), Eskalation (wer vergibt, hat), Version (409 bei gleichzeitiger Änderung).
// Die Seite «Rollen und Rechte» zeigt weiter /zuordnungen (rechte.ts) und die Plattformrollen (plattform-rollen.ts); beide bleiben, wie sie sind.
// Nie in einer Antwort oder im Audit: Kontaktdaten. Die Namen von Personen stehen nur dort, wo die Abteilungsleitung sie ohnehin sieht (Mitglieder einer Rolle, Herkunft der Rechte einer Person).

const MAX_ROLLEN_JE_GRUPPE = 30;
const name = z.string().trim().min(1).max(50);
const beschreibung = z.string().trim().max(300);
const version = z.number().int().min(1).max(1_000_000);
const pfadGruppe = () => z.strictObject({ tagId: z.uuid() });
const pfadRolle = () => z.strictObject({ tagId: z.uuid(), rolleId: z.uuid() });
const pfadMitglied = () =>
  z.strictObject({ tagId: z.uuid(), userId: z.uuid() });
const pfadGlobal = () => z.strictObject({ id: z.uuid() });
const pfadPerson = () => z.strictObject({ userId: z.uuid() });

const anlegenGruppeSchema = z.strictObject({
  name,
  beschreibung: beschreibung.nullable().optional(),
  verantwortlich: z.boolean().optional(),
  reihenfolge: z.number().int().min(1).max(1000).optional(),
  rechte: zuteilungenSchema,
});
const aendernGruppeSchema = z
  .strictObject({
    version,
    name: name.optional(),
    beschreibung: beschreibung.nullable().optional(),
    verantwortlich: z.boolean().optional(),
    reihenfolge: z.number().int().min(1).max(1000).optional(),
    rechte: zuteilungenSchema.optional(),
  })
  .refine((f) => Object.keys(f).some((k) => k !== "version"));
const loeschenSchema = z.strictObject({
  version: z.coerce.number().int().min(1).optional(),
});
const vorschauSchema = z.strictObject({
  rolleId: z.uuid().optional(),
  rechte: zuteilungenSchema,
});
const zuordnenSchema = z.strictObject({ rolleId: z.uuid().nullable() });

const rechteGlobal = z
  .array(z.enum(VERGEBBARE_RECHTE as [RechtId, ...RechtId[]]))
  .max(VERGEBBARE_RECHTE.length)
  .refine((liste) => new Set(liste).size === liste.length);
const anlegenGlobalSchema = z.strictObject({ name, rechte: rechteGlobal });
const aendernGlobalSchema = z
  .strictObject({
    version,
    name: name.optional(),
    rechte: rechteGlobal.optional(),
  })
  .refine((f) => f.name !== undefined || f.rechte !== undefined);

const aendernAbteilungsleitungSchema = z.strictObject({
  version,
  rechte: rechteGlobal,
});

const listeSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  nach: z.uuid().optional(),
});

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
const ZU_VIELE_ROLLEN = {
  code: "ZU_VIELE_ROLLEN",
  message: `Eine Gruppe hat höchstens ${MAX_ROLLEN_JE_GRUPPE} Rollen.`,
} as const;

// Drizzle legt den Fehler von Postgres in cause: 23505 = Index verletzt
const pgCode = (fehler: unknown) =>
  (fehler as { cause?: { code?: string } })?.cause?.code;

// Die Aktionen im Audit-Log, die die Matrix schreibt (und die alte Plattformrollen-API), für die Liste der Änderungen
const AENDERUNGS_AKTIONEN = [
  "gruppen_rolle_angelegt",
  "gruppen_rolle_geaendert",
  "gruppen_rolle_geloescht",
  "gruppen_rolle_zugeordnet",
  "plattform_rolle_angelegt",
  "plattform_rolle_geaendert",
  "plattform_rolle_geloescht",
  "plattform_rolle_vergeben",
  "plattform_rolle_entzogen",
  "abteilungsleitung_rechte_geaendert",
];

const alsZuteilung = (z: { recht: string; geltung: string }): Zuteilung => ({
  recht: z.recht as RechtId,
  geltung: z.geltung as Zuteilung["geltung"],
});

// Nur Zeilen, die der Katalog kennt und die Gruppenrollen tragen dürfen: Was dort nicht (mehr) steht, gibt nichts und erscheint nicht
const gueltig = (z: { recht: string; geltung: string }) =>
  istRecht(z.recht) &&
  eintragVon(z.recht).art === "vergebbar" &&
  (eintragVon(z.recht).geltungen as readonly string[]).includes(z.geltung);

export function erstelleRechteMatrixRouten({ db }: { db: Db }) {
  // Tür der Routen: das feste Recht «Rechte und Rollen vergeben» (Abteilungsleitung) oder «Rechte der Abteilungsleitung ändern» (Entwickler); erst nach dem Laden des Objekts
  const tuer = (person: Person) =>
    verlangeEines(db, person, ["rechte.verwalten", "rechte.abteilungsleitung"]);
  // Tür für alles mit Personen (Zuordnen, «Was darf wer?»): wer «Rechte und Rollen vergeben» hat, also die Abteilungsleitung und der Entwickler (er hat jedes Recht, #722)
  const nurAbteilungsleitung = (person: Person) =>
    verlange(db, person, "rechte.verwalten");
  // Sieht die Person Namen von Personen? Wer «Rechte und Rollen vergeben» hat: Abteilungsleitung und Entwickler (SR-41, Abweichung #722)
  const sieheNamen = (person: Person) => darf(db, person, "rechte.verwalten");

  async function ladeGruppe(person: Person, tagId: string) {
    const [gruppe] = await db
      .select({ id: tag.id, typ: tag.typ, name: tag.name })
      .from(tag)
      .where(and(eq(tag.id, tagId), eq(tag.abteilungId, person.abteilungId)));
    if (!gruppe) throw new HTTPException(404);
    return gruppe;
  }

  async function ladeRolle(person: Person, tagId: string, rolleId: string) {
    const [rolle] = await db
      .select()
      .from(gruppenRolle)
      .where(
        and(
          eq(gruppenRolle.id, rolleId),
          eq(gruppenRolle.tagId, tagId),
          eq(gruppenRolle.abteilungId, person.abteilungId),
        ),
      );
    if (!rolle) throw new HTTPException(404);
    return rolle;
  }

  async function rechteDerRolle(rolleId: string): Promise<Zuteilung[]> {
    const zeilen = await db
      .select({
        recht: gruppenRolleRecht.recht,
        geltung: gruppenRolleRecht.geltung,
      })
      .from(gruppenRolleRecht)
      .where(eq(gruppenRolleRecht.rolleId, rolleId));
    return ordneZuteilungen(zeilen.filter(gueltig).map(alsZuteilung));
  }

  // Die Antwort für eine Rolle: ihre Rechte, die festen des Codes (nur Systemrollen der Stufe) und ihre Mitglieder
  const alsAntwort = (
    r: typeof gruppenRolle.$inferSelect,
    gruppenTyp: string,
    rechte: Zuteilung[],
    personen: { id: string; name: string }[],
  ) => ({
    id: r.id,
    name: r.name,
    beschreibung: r.beschreibung,
    verantwortlich: r.verantwortlich,
    reihenfolge: r.reihenfolge,
    system: r.schluessel !== null,
    schluessel: r.schluessel,
    version: r.version,
    rechte,
    // Was im Code fest steht und sich nicht abstellen lässt: die Rechte der Stufenrolle (Stufenleitung, Leitung)
    fest:
      gruppenTyp === "stufe" &&
      (r.schluessel === "leitung" || r.schluessel === "stufenleitung")
        ? [...STUFENROLLEN_STANDARD[r.schluessel]]
        : [],
    personen,
  });

  return (
    new Hono<{ Variables: { person: Person } }>()
      .get("/katalog", async (c) => {
        const person = c.get("person");
        await tuer(person);
        return c.json({
          modus: rechteModus(),
          // Was die Person hier darf; die Oberfläche blendet danach Zuordnen, Namen und die Zeile «Abteilungsleitung» ein oder sperrt sie
          ich: {
            rechteVerwalten: await darf(db, person, "rechte.verwalten"),
            abteilungsleitungAendern: await darf(
              db,
              person,
              "rechte.abteilungsleitung",
            ),
          },
          bereiche: BEREICHE.map((id) => ({ id, name: BEREICH_NAMEN[id] })),
          rechte: RECHT_IDS.map((id) => {
            const e = eintragVon(id);
            return {
              id,
              bereich: e.bereich,
              klartext: e.klartext,
              erklaerung: e.erklaerung,
              risiko: e.risiko,
              art: e.art,
              geltungen: e.geltungen,
              bezug: e.bezug ?? null,
              zweiterFaktor: e.risiko !== "normal",
              nurEntwickler: e.nurEntwickler === true,
              // Rechte, die eine Gruppenrolle tragen darf (alles Vergebbare)
              gruppenrolle: e.art === "vergebbar",
            };
          }),
        });
      })
      .get("/gruppen", async (c) => {
        const person = c.get("person");
        await tuer(person);
        // Eine Abfrage: je Gruppe die Zahl der Rollen und der Mitglieder
        const zeilen = await db
          .select({
            id: tag.id,
            typ: tag.typ,
            name: tag.name,
            rollen: sql<number>`(select count(*)::int from ${gruppenRolle} where ${gruppenRolle.tagId} = "tag"."id")`,
            mitglieder: sql<number>`(select count(*)::int from ${personTag} where ${personTag.tagId} = "tag"."id")`,
            mitRolle: sql<number>`(select count(*)::int from ${personTag} where ${personTag.tagId} = "tag"."id" and ${personTag.rolleId} is not null)`,
          })
          .from(tag)
          .where(eq(tag.abteilungId, person.abteilungId))
          .orderBy(asc(tag.typ), asc(tag.name), asc(tag.id));
        return c.json({ gruppen: zeilen });
      })
      .get(
        "/gruppen/:tagId/rollen",
        eingabe("param", pfadGruppe()),
        async (c) => {
          const person = c.get("person");
          const gruppe = await ladeGruppe(person, c.req.valid("param").tagId);
          await tuer(person);
          // Drei Abfragen für die ganze Gruppe: Rollen, ihre Rechte, ihre Mitglieder
          const rollen = await db
            .select()
            .from(gruppenRolle)
            .where(eq(gruppenRolle.tagId, gruppe.id))
            .orderBy(
              asc(gruppenRolle.reihenfolge),
              asc(gruppenRolle.name),
              asc(gruppenRolle.id),
            );
          const [rechte, mitglieder] = await Promise.all([
            rollen.length === 0
              ? []
              : db
                  .select({
                    rolleId: gruppenRolleRecht.rolleId,
                    recht: gruppenRolleRecht.recht,
                    geltung: gruppenRolleRecht.geltung,
                  })
                  .from(gruppenRolleRecht)
                  .where(
                    inArray(
                      gruppenRolleRecht.rolleId,
                      rollen.map((r) => r.id),
                    ),
                  ),
            (await sieheNamen(person))
              ? mitgliederDerRollen(db, gruppe.id).orderBy(
                  asc(user.name),
                  asc(user.id),
                )
              : [],
          ]);
          return c.json({
            gruppe,
            rollen: rollen.map((r) =>
              alsAntwort(
                r,
                gruppe.typ,
                ordneZuteilungen(
                  rechte
                    .filter((z) => z.rolleId === r.id && gueltig(z))
                    .map(alsZuteilung),
                ),
                mitglieder
                  .filter((m) => m.rolleId === r.id)
                  .map((m) => ({ id: m.id, name: m.name })),
              ),
            ),
          });
        },
      )
      .post(
        "/gruppen/:tagId/rollen",
        eingabe("param", pfadGruppe()),
        eingabe("json", anlegenGruppeSchema),
        async (c) => {
          const person = c.get("person");
          const gruppe = await ladeGruppe(person, c.req.valid("param").tagId);
          await tuer(person);
          const eingang = c.req.valid("json");
          await pruefeEigeneRechte(db, person, eingang.rechte);
          try {
            const neu = await db.transaction(async (tx) => {
              const [{ n }] = await tx
                .select({ n: count() })
                .from(gruppenRolle)
                .where(eq(gruppenRolle.tagId, gruppe.id));
              if (n >= MAX_ROLLEN_JE_GRUPPE) throw new HTTPException(409);
              const [zeile] = await tx
                .insert(gruppenRolle)
                .values({
                  abteilungId: person.abteilungId,
                  tagId: gruppe.id,
                  name: eingang.name,
                  beschreibung: eingang.beschreibung ?? null,
                  verantwortlich: eingang.verantwortlich ?? false,
                  reihenfolge: eingang.reihenfolge ?? 1000,
                })
                .returning({
                  id: gruppenRolle.id,
                  version: gruppenRolle.version,
                });
              if (eingang.rechte.length > 0) {
                await tx.insert(gruppenRolleRecht).values(
                  eingang.rechte.map((z) => ({
                    rolleId: zeile.id,
                    recht: z.recht,
                    geltung: z.geltung,
                  })),
                );
              }
              // Ohne den Namen der Rolle: nur Kennungen und Rechte
              await tx.insert(auditLog).values({
                abteilungId: person.abteilungId,
                akteurId: person.id,
                aktion: "gruppen_rolle_angelegt",
                zielTyp: "gruppen_rolle",
                zielId: zeile.id,
                details: { tagId: gruppe.id, rechte: eingang.rechte },
              });
              return zeile;
            });
            return c.json({ id: neu.id, version: neu.version }, 201);
          } catch (fehler) {
            if (fehler instanceof HTTPException && fehler.status === 409) {
              return c.json(ZU_VIELE_ROLLEN, 409);
            }
            if (pgCode(fehler) === "23505") return c.json(NAME_VERGEBEN, 409);
            throw fehler;
          }
        },
      )
      .patch(
        "/gruppen/:tagId/rollen/:rolleId",
        eingabe("param", pfadRolle()),
        eingabe("json", aendernGruppeSchema),
        async (c) => {
          const person = c.get("person");
          const { tagId, rolleId } = c.req.valid("param");
          await ladeGruppe(person, tagId);
          const rolle = await ladeRolle(person, tagId, rolleId);
          await tuer(person);
          const { version: erwartet, rechte, ...felder } = c.req.valid("json");
          // Systemrollen behalten Namen und Kennzeichen; ihre Rechte sind einstellbar
          if (
            rolle.schluessel !== null &&
            ((felder.name !== undefined && felder.name !== rolle.name) ||
              (felder.verantwortlich !== undefined &&
                felder.verantwortlich !== rolle.verantwortlich))
          ) {
            return c.json(ROLLE_VORGEGEBEN, 409);
          }
          const vorher = await rechteDerRolle(rolle.id);
          const nachher = rechte ? ordneZuteilungen(rechte) : vorher;
          const { hinzu, weg } = unterschied(vorher, nachher);
          // Nur neu hinzukommende Rechte brauchen das eigene Recht; Entziehen darf jede Abteilungsleitung
          await pruefeEigeneRechte(db, person, hinzu);
          try {
            const ergebnis = await db.transaction(async (tx) => {
              const [zeile] = await tx
                .update(gruppenRolle)
                .set({
                  ...felder,
                  version: sql`${gruppenRolle.version} + 1`,
                  geaendertAm: sql`now()`,
                })
                .where(
                  and(
                    eq(gruppenRolle.id, rolle.id),
                    eq(gruppenRolle.version, erwartet),
                  ),
                )
                .returning({ version: gruppenRolle.version });
              if (!zeile) return "konflikt" as const;
              if (rechte) {
                await tx
                  .delete(gruppenRolleRecht)
                  .where(eq(gruppenRolleRecht.rolleId, rolle.id));
                if (nachher.length > 0) {
                  await tx.insert(gruppenRolleRecht).values(
                    nachher.map((z) => ({
                      rolleId: rolle.id,
                      recht: z.recht,
                      geltung: z.geltung,
                    })),
                  );
                }
              }
              await tx.insert(auditLog).values({
                abteilungId: person.abteilungId,
                akteurId: person.id,
                aktion: "gruppen_rolle_geaendert",
                zielTyp: "gruppen_rolle",
                zielId: rolle.id,
                details: {
                  tagId,
                  umbenannt:
                    felder.name !== undefined && felder.name !== rolle.name,
                  hinzu,
                  weg,
                },
              });
              return zeile;
            });
            if (ergebnis === "konflikt") {
              // Der Stand, der dazwischenkam, damit die Oberfläche ihn zeigt, statt zu überschreiben
              const aktuell = await ladeRolle(person, tagId, rolleId);
              return c.json(
                {
                  code: "VERSION_KONFLIKT",
                  message: "Die Rolle wurde inzwischen geändert.",
                  aktuell: {
                    version: aktuell.version,
                    rechte: await rechteDerRolle(rolle.id),
                  },
                },
                409,
              );
            }
            // Verlangt ein Recht der Rolle jetzt den zweiten Faktor, melden sich die Personen ohne ihn neu an (#715)
            if (rechte) {
              await beendeSitzungenBeiNeuerPflicht(
                db,
                person.abteilungId,
                await personenDerGruppenrolle(db, person.abteilungId, rolle.id),
              );
            }
            return c.json({ version: ergebnis.version });
          } catch (fehler) {
            if (pgCode(fehler) === "23505") return c.json(NAME_VERGEBEN, 409);
            throw fehler;
          }
        },
      )
      .delete(
        "/gruppen/:tagId/rollen/:rolleId",
        eingabe("param", pfadRolle()),
        eingabe("query", loeschenSchema),
        async (c) => {
          const person = c.get("person");
          const { tagId, rolleId } = c.req.valid("param");
          await ladeGruppe(person, tagId);
          const rolle = await ladeRolle(person, tagId, rolleId);
          await tuer(person);
          if (rolle.schluessel !== null) return c.json(ROLLE_VORGEGEBEN, 409);
          const erwartet = c.req.valid("query").version;
          const vorher = await rechteDerRolle(rolle.id);
          const ergebnis = await db.transaction(async (tx) => {
            const entfernt = await tx
              .delete(gruppenRolle)
              .where(
                and(
                  eq(gruppenRolle.id, rolle.id),
                  erwartet === undefined
                    ? undefined
                    : eq(gruppenRolle.version, erwartet),
                ),
              )
              .returning({ id: gruppenRolle.id });
            if (entfernt.length === 0) return "konflikt" as const;
            // Die Personen behalten ihre Mitgliedschaft und verlieren die Rolle (SET NULL): Der Entzug wirkt bei ihrer nächsten Anfrage
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "gruppen_rolle_geloescht",
              zielTyp: "gruppen_rolle",
              zielId: rolle.id,
              details: { tagId, rechte: vorher },
            });
            return "ok" as const;
          });
          if (ergebnis === "konflikt") {
            return c.json(
              {
                code: "VERSION_KONFLIKT",
                message: "Die Rolle wurde inzwischen geändert.",
              },
              409,
            );
          }
          return c.body(null, 204);
        },
      )
      // Wer ist betroffen? Nur Zahlen, nie Namen, und nichts wird geschrieben. Mit rolleId die bestehende Rolle mit den vorgeschlagenen Rechten, ohne sie ein neues Rechteset
      .post(
        "/gruppen/:tagId/rollen/vorschau",
        eingabe("param", pfadGruppe()),
        eingabe("json", vorschauSchema),
        async (c) => {
          const person = c.get("person");
          const { tagId } = c.req.valid("param");
          await ladeGruppe(person, tagId);
          const eingang = c.req.valid("json");
          const rolle = eingang.rolleId
            ? await ladeRolle(person, tagId, eingang.rolleId)
            : undefined;
          await tuer(person);
          const vorher = rolle ? await rechteDerRolle(rolle.id) : [];
          const { hinzu, weg } = unterschied(
            vorher,
            ordneZuteilungen(eingang.rechte),
          );
          const [{ n }] = rolle
            ? await db
                .select({ n: count() })
                .from(personTag)
                .where(
                  and(
                    eq(personTag.tagId, tagId),
                    eq(personTag.rolleId, rolle.id),
                  ),
                )
            : [{ n: 0 }];
          return c.json({
            // Personen, die die Rolle heute tragen und die Änderung spüren
            personen: n,
            gewinnen: hinzu.map((z) => ({ ...z, personen: n })),
            verlieren: weg.map((z) => ({ ...z, personen: n })),
          });
        },
      )
      // Eine Person in der Gruppe einer Rolle zuordnen oder die Rolle entziehen (rolleId null)
      .put(
        "/gruppen/:tagId/personen/:userId/rolle",
        eingabe("param", pfadMitglied()),
        eingabe("json", zuordnenSchema),
        async (c) => {
          const person = c.get("person");
          const { tagId, userId } = c.req.valid("param");
          await ladeGruppe(person, tagId);
          const [mitglied] = await db
            .select({ rolleId: personTag.rolleId })
            .from(personTag)
            .innerJoin(user, eq(user.id, personTag.userId))
            .where(
              and(
                eq(personTag.tagId, tagId),
                eq(personTag.userId, userId),
                eq(user.abteilungId, person.abteilungId),
              ),
            );
          if (!mitglied) throw new HTTPException(404);
          const { rolleId } = c.req.valid("json");
          const rolle = rolleId
            ? await ladeRolle(person, tagId, rolleId)
            : undefined;
          await nurAbteilungsleitung(person);
          // Wer eine Rolle zuordnet, hat die Rechte der Rolle selbst
          if (rolle) {
            await pruefeEigeneRechte(
              db,
              person,
              await rechteDerRolle(rolle.id),
            );
          }
          await db.transaction(async (tx) => {
            await tx
              .update(personTag)
              .set({ rolleId: rolle?.id ?? null })
              .where(
                and(eq(personTag.tagId, tagId), eq(personTag.userId, userId)),
              );
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "gruppen_rolle_zugeordnet",
              zielTyp: "person",
              zielId: userId,
              details: {
                tagId,
                rolleId: rolle?.id ?? null,
                vorher: mitglied.rolleId,
              },
            });
          });
          if (rolle) {
            await beendeSitzungenBeiNeuerPflicht(db, person.abteilungId, [
              userId,
            ]);
          }
          return c.body(null, 204);
        },
      )
      // Globale Rollen (Plattformrollen, abteilungsweit) mit dem ganzen Katalog. Die ältere API unter /admin/plattform/rollen bleibt: Sie kennt nur die sieben Rechte der Website und lässt die übrigen Rechte einer Rolle stehen. Personen ordnet weiter /admin/plattform/rollen/:id/personen/:userId zu
      .get("/rollen", async (c) => {
        const person = c.get("person");
        await tuer(person);
        const mitNamen = await sieheNamen(person);
        const al = await ladeAbteilungsleitung(db, person.abteilungId);
        const [rollen, rechte, vergaben] = await Promise.all([
          db
            .select()
            .from(plattformRolle)
            .where(eq(plattformRolle.abteilungId, person.abteilungId))
            .orderBy(asc(plattformRolle.name), asc(plattformRolle.id)),
          db
            .select({
              rolleId: plattformRolleRecht.rolleId,
              recht: plattformRolleRecht.recht,
            })
            .from(plattformRolleRecht)
            .innerJoin(
              plattformRolle,
              and(
                eq(plattformRolle.id, plattformRolleRecht.rolleId),
                eq(plattformRolle.abteilungId, person.abteilungId),
              ),
            ),
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
          // Die Systemrolle «Abteilungsleitung» (#663): Standard sind alle vergebbaren Rechte, der Entwickler nimmt weg. «fest» sind die Rechte, die ihr nie fehlen; «aenderbar» sagt, ob die anfragende Person sie ändern darf (nur der Entwickler)
          abteilungsleitung: {
            version: al.version,
            rechte: rechteDerAbteilungsleitung(al.ohne),
            fest: RECHT_IDS.filter(
              (r) =>
                eintragVon(r).art === "fest" && !eintragVon(r).nurEntwickler,
            ),
            aenderbar: await darf(db, person, "rechte.abteilungsleitung"),
          },
          rollen: rollen.map((r) => ({
            id: r.id,
            name: r.name,
            vorgabe: r.schluessel !== null,
            version: r.version,
            // In der Reihenfolge des Katalogs; was er nicht (mehr) kennt, fällt weg
            rechte: VERGEBBARE_RECHTE.filter((recht) =>
              rechte.some((z) => z.rolleId === r.id && z.recht === recht),
            ),
            personen: vergaben
              .filter((v) => v.rolleId === r.id)
              .map((v) => ({ id: v.id, name: v.name })),
          })),
        });
      })
      .post("/rollen", eingabe("json", anlegenGlobalSchema), async (c) => {
        const person = c.get("person");
        await tuer(person);
        const eingang = c.req.valid("json");
        if (istSystemname(eingang.name)) return c.json(NAME_VERGEBEN, 409);
        await pruefeEigeneRechte(
          db,
          person,
          eingang.rechte.map((recht) => ({ recht, geltung: "alle" as const })),
        );
        try {
          const neu = await db.transaction(async (tx) => {
            const [zeile] = await tx
              .insert(plattformRolle)
              .values({ abteilungId: person.abteilungId, name: eingang.name })
              .returning({
                id: plattformRolle.id,
                version: plattformRolle.version,
              });
            if (eingang.rechte.length > 0) {
              await tx
                .insert(plattformRolleRecht)
                .values(
                  eingang.rechte.map((recht) => ({ rolleId: zeile.id, recht })),
                );
            }
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
          return c.json({ id: neu.id, version: neu.version }, 201);
        } catch (fehler) {
          if (pgCode(fehler) === "23505") return c.json(NAME_VERGEBEN, 409);
          throw fehler;
        }
      })
      .patch(
        "/rollen/:id",
        eingabe("param", pfadGlobal()),
        eingabe("json", aendernGlobalSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const [rolle] = await db
            .select()
            .from(plattformRolle)
            .where(
              and(
                eq(plattformRolle.id, id),
                eq(plattformRolle.abteilungId, person.abteilungId),
              ),
            );
          if (!rolle) throw new HTTPException(404);
          await tuer(person);
          const {
            version: erwartet,
            name: neuerName,
            rechte,
          } = c.req.valid("json");
          if (
            neuerName !== undefined &&
            rolle.schluessel !== null &&
            neuerName !== rolle.name
          ) {
            return c.json(ROLLE_VORGEGEBEN, 409);
          }
          if (neuerName !== undefined && istSystemname(neuerName)) {
            return c.json(NAME_VERGEBEN, 409);
          }
          const vorherZeilen = await db
            .select({ recht: plattformRolleRecht.recht })
            .from(plattformRolleRecht)
            .where(eq(plattformRolleRecht.rolleId, rolle.id));
          const vorher = VERGEBBARE_RECHTE.filter((r) =>
            vorherZeilen.some((z) => z.recht === r),
          );
          const nachher = rechte
            ? VERGEBBARE_RECHTE.filter((r) => rechte.includes(r))
            : vorher;
          const hinzu = nachher.filter((r) => !vorher.includes(r));
          await pruefeEigeneRechte(
            db,
            person,
            hinzu.map((recht) => ({ recht, geltung: "alle" as const })),
          );
          try {
            const ergebnis = await db.transaction(async (tx) => {
              const [zeile] = await tx
                .update(plattformRolle)
                .set({
                  ...(neuerName === undefined ? {} : { name: neuerName }),
                  version: sql`${plattformRolle.version} + 1`,
                })
                .where(
                  and(
                    eq(plattformRolle.id, rolle.id),
                    eq(plattformRolle.version, erwartet),
                  ),
                )
                .returning({ version: plattformRolle.version });
              if (!zeile) return "konflikt" as const;
              if (rechte) {
                // Nur die Rechte, die der Katalog kennt, ersetzen: Ein Name, den er nicht (mehr) kennt, bleibt unberührt
                await tx
                  .delete(plattformRolleRecht)
                  .where(
                    and(
                      eq(plattformRolleRecht.rolleId, rolle.id),
                      inArray(plattformRolleRecht.recht, [
                        ...VERGEBBARE_RECHTE,
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
                    neuerName !== undefined && neuerName !== rolle.name,
                  rechteVorher: vorher,
                  rechteNachher: nachher,
                },
              });
              return zeile;
            });
            if (ergebnis === "konflikt") {
              const [aktuell] = await db
                .select({ version: plattformRolle.version })
                .from(plattformRolle)
                .where(eq(plattformRolle.id, rolle.id));
              return c.json(
                {
                  code: "VERSION_KONFLIKT",
                  message: "Die Rolle wurde inzwischen geändert.",
                  aktuell: { version: aktuell?.version ?? null },
                },
                409,
              );
            }
            if (rechte) {
              await beendeSitzungenBeiNeuerPflicht(
                db,
                person.abteilungId,
                await personenDerPlattformRolle(
                  db,
                  person.abteilungId,
                  rolle.id,
                ),
              );
            }
            return c.json({ version: ergebnis.version });
          } catch (fehler) {
            if (pgCode(fehler) === "23505") return c.json(NAME_VERGEBEN, 409);
            throw fehler;
          }
        },
      )
      .delete(
        "/rollen/:id",
        eingabe("param", pfadGlobal()),
        eingabe("query", loeschenSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const [rolle] = await db
            .select()
            .from(plattformRolle)
            .where(
              and(
                eq(plattformRolle.id, id),
                eq(plattformRolle.abteilungId, person.abteilungId),
              ),
            );
          if (!rolle) throw new HTTPException(404);
          await tuer(person);
          if (rolle.schluessel !== null) return c.json(ROLLE_VORGEGEBEN, 409);
          const erwartet = c.req.valid("query").version;
          const ergebnis = await db.transaction(async (tx) => {
            const entfernt = await tx
              .delete(plattformRolle)
              .where(
                and(
                  eq(plattformRolle.id, rolle.id),
                  erwartet === undefined
                    ? undefined
                    : eq(plattformRolle.version, erwartet),
                ),
              )
              .returning({ id: plattformRolle.id });
            if (entfernt.length === 0) return "konflikt" as const;
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "plattform_rolle_geloescht",
              zielTyp: "plattform_rolle",
              zielId: rolle.id,
              details: {},
            });
            return "ok" as const;
          });
          if (ergebnis === "konflikt") {
            return c.json(
              {
                code: "VERSION_KONFLIKT",
                message: "Die Rolle wurde inzwischen geändert.",
              },
              409,
            );
          }
          return c.body(null, 204);
        },
      )
      // Die Rechte der Abteilungsleitung (#663): nur der Entwickler ändert sie, mit zweitem Faktor. Die Abteilungsleitung bekommt 403, auch für ihre eigene Rolle: Sie ändert ihre eigenen Rechte nie. Das gilt für jeden Weg, denn die Rolle liegt in keiner Tabelle der anderen Rollen (plattform_rolle, gruppen_rolle). Gespeichert werden nur die Abzüge vom Standard (alle vergebbaren Rechte)
      .patch(
        "/abteilungsleitung",
        eingabe("json", aendernAbteilungsleitungSchema),
        async (c) => {
          const person = c.get("person");
          await verlange(db, person, "rechte.abteilungsleitung");
          const { version: erwartet, rechte } = c.req.valid("json");
          const vorher = await ladeAbteilungsleitung(db, person.abteilungId);
          const vorherRechte = rechteDerAbteilungsleitung(vorher.ohne);
          const nachher = VERGEBBARE_RECHTE.filter((r) => rechte.includes(r));
          const ohne = VERGEBBARE_RECHTE.filter((r) => !rechte.includes(r));
          const ergebnis = await db.transaction(async (tx) => {
            const neu = await speichereAbteilungsleitung(
              tx,
              person.abteilungId,
              erwartet,
              ohne,
            );
            if (neu === "konflikt") return neu;
            // Nur Namen von Rechten: nie Personen
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "abteilungsleitung_rechte_geaendert",
              zielTyp: "abteilung",
              zielId: person.abteilungId,
              details: {
                hinzu: nachher.filter((r) => !vorherRechte.includes(r)),
                weg: vorherRechte.filter((r) => !nachher.includes(r)),
              },
            });
            return neu;
          });
          if (ergebnis === "konflikt") {
            const aktuell = await ladeAbteilungsleitung(db, person.abteilungId);
            return c.json(
              {
                code: "VERSION_KONFLIKT",
                message:
                  "Die Rechte der Abteilungsleitung wurden inzwischen geändert.",
                aktuell: {
                  version: aktuell.version,
                  rechte: rechteDerAbteilungsleitung(aktuell.ohne).map(
                    (recht) => ({ recht, geltung: "alle" }),
                  ),
                },
              },
              409,
            );
          }
          return c.json({ version: ergebnis });
        },
      )
      // Was darf wer, und woher? Jedes Recht der Person mit seinen Quellen. Eine Abfrage für den Satz, zwei für die Person
      .get("/personen/:userId", eingabe("param", pfadPerson()), async (c) => {
        const person = c.get("person");
        const ziel = await ladePerson(
          db,
          person.abteilungId,
          c.req.valid("param").userId,
        );
        if (!ziel) throw new HTTPException(404);
        await nurAbteilungsleitung(person);
        const satz = await ladeRechteSatz(db, ziel);
        const gruppen = await db
          .select({
            id: tag.id,
            typ: tag.typ,
            name: tag.name,
            rolle: gruppenRolle.name,
          })
          .from(personTag)
          .innerJoin(tag, eq(tag.id, personTag.tagId))
          .leftJoin(
            gruppenRolle,
            and(
              eq(gruppenRolle.id, personTag.rolleId),
              eq(gruppenRolle.tagId, personTag.tagId),
            ),
          )
          .where(
            and(
              eq(personTag.userId, ziel.id),
              eq(tag.abteilungId, person.abteilungId),
            ),
          )
          .orderBy(asc(tag.typ), asc(tag.name));
        return c.json({
          person: { id: ziel.id, name: ziel.name },
          abteilungsleitung: ziel.abteilungsleitung,
          entwickler: satz.entwickler,
          gruppen,
          rechte: RECHT_IDS.flatMap((id) => {
            const herkuenfte = satz.herkuenfte(id);
            if (herkuenfte.length === 0) return [];
            const e = eintragVon(id);
            return [
              {
                recht: id,
                bereich: e.bereich,
                klartext: e.klartext,
                risiko: e.risiko,
                zweiterFaktor: satz.braucht2Faktor(id),
                herkunft: herkuenfte,
              },
            ];
          }),
        });
      })
      // Änderungen an Rollen und Zuordnungen, neueste zuerst: die Zeilen des Audit-Logs, ohne Personendaten ausser dem Namen des Akteurs. Seitenweise (nach = die letzte Kennung der Vorseite)
      .get("/aenderungen", eingabe("query", listeSchema), async (c) => {
        const person = c.get("person");
        await tuer(person);
        const { limit, nach } = c.req.valid("query");
        const zeilen = await db
          .select({
            id: auditLog.id,
            zeit: auditLog.erstelltAm,
            akteurId: auditLog.akteurId,
            aktion: auditLog.aktion,
            zielTyp: auditLog.zielTyp,
            zielId: auditLog.zielId,
            details: auditLog.details,
          })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.abteilungId, person.abteilungId),
              inArray(auditLog.aktion, AENDERUNGS_AKTIONEN),
              nach ? lt(auditLog.id, nach) : undefined,
            ),
          )
          .orderBy(desc(auditLog.id))
          .limit(limit + 1);
        const seite = zeilen.slice(0, limit);
        const akteure = [
          ...new Set(
            seite
              .map((z) => z.akteurId)
              .filter((a) => /^[0-9a-f-]{36}$/.test(a)),
          ),
        ];
        const namen =
          akteure.length === 0 || !(await sieheNamen(person))
            ? []
            : await db
                .select({ id: user.id, name: user.name })
                .from(user)
                .where(
                  and(
                    inArray(user.id, akteure),
                    eq(user.abteilungId, person.abteilungId),
                  ),
                );
        return c.json({
          aenderungen: seite.map((z) => ({
            ...z,
            akteur: namen.find((n) => n.id === z.akteurId) ?? null,
          })),
          weitere: zeilen.length > limit,
          naechste: zeilen.length > limit ? seite[seite.length - 1]!.id : null,
        });
      })
  );
}

// Für den Test: Die Aktionen, die die Liste der Änderungen zeigt
export const AENDERUNGS_AKTIONEN_LISTE = AENDERUNGS_AKTIONEN;

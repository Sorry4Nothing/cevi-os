import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  anlass,
  anlassFeld,
  auditLog,
  programm,
  tag,
} from "../../db/schema.js";
import { meldeAenderung } from "../../aktivitaet-middleware.js";
import { eingabe } from "../../eingabe.js";
import {
  sichtbarkeitAusSpalten,
  type Sichtbarkeit,
  sichtbarkeitSchema,
  sichtbarkeitSpalten,
  tagsGehoerenZurAbteilung,
} from "../../sichtbarkeit.js";
import {
  schluesselMitAntworten,
  zaehleAnmeldungen,
} from "../../termine/anlass-anmeldungen.js";
import { terminVorbei } from "../../termine/anlass-sicht.js";
import {
  felderInBenutzung,
  felderSchema,
  findeGesundheitsfeld,
  schreibeFelder,
  type FeldEingabe,
} from "../../termine/anlass-felder.js";
import { verlange } from "../../rechtemodell/darf.js";
import {
  anlaesseMit,
  anlassRechte,
  verlangeEines,
} from "../../termine/rechte.js";
import { erzeugeSeiteAusVorlage } from "../../website/automatik.js";
import { meldeWebsiteEreignis } from "../../website/ereignisse.js";
import type { Person } from "../../rechte.js";
import type { TermineEnv } from "./index.js";

// Anlässe verwalten (#442, Epic #430): Ein Anlass ist ein Termin mit Anmeldung. Die Rechte «Anlässe anlegen und löschen» und «Anlässe verwalten» (rechtemodell/katalog.ts) prüft verlange(); standardmässig hat sie nur die Abteilungsleitung, «verwalten» kann zusätzlich eine Gruppenrolle des OK für den eigenen Anlass haben (#649). Die Pfade tragen /api/v1/admin und erben den zweiten Faktor der Abteilungsleitung; für alle anderen verlangt ihn verlange().
// Den Anlass lesen (Liste und Detail): wer ihn verwaltet oder seine Anmeldungen sieht oder exportiert; Ändern verlangt «anlass.verwalten»
const LESEN = [
  "anlass.verwalten",
  "anlass.anmeldungen_sehen",
  "anlass.anmeldungen_exportieren",
] as const;
const anmeldungFuer = z.enum(["kind", "person"]);
const frist = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const anlegenSchema = z.strictObject({
  programmId: z.uuid(),
  anmeldungFuer,
  anmeldungOffen: z.boolean(),
  frist: frist.nullable().optional(),
  sichtbarkeit: sichtbarkeitSchema,
  felder: felderSchema.default([]),
});
// Ohne Schlüssel bleibt der Wert; frist null löscht die Frist. «anmeldungFuer» nur ohne Anmeldungen
const aendernSchema = z.strictObject({
  anmeldungOffen: z.boolean().optional(),
  frist: frist.nullable().optional(),
  sichtbarkeit: sichtbarkeitSchema.optional(),
  anmeldungFuer: anmeldungFuer.optional(),
});
const felderBody = z.strictObject({ felder: felderSchema });
const listeSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  nach: z.uuid().optional(),
});
const pfad = () => z.strictObject({ id: z.uuid() });

const ANLASS_VORHANDEN = {
  code: "ANLASS_VORHANDEN",
  message: "Zu diesem Termin gibt es schon einen Anlass.",
} as const;
const TERMIN_VORBEI = {
  code: "TERMIN_VORBEI",
  message: "Der Termin ist schon vorbei.",
} as const;
const ANMELDUNGEN_VORHANDEN = {
  code: "ANMELDUNGEN_VORHANDEN",
  message: "Es gibt schon Anmeldungen.",
} as const;
const FELD_IN_BENUTZUNG = {
  code: "FELD_IN_BENUTZUNG",
  message: "Zu diesen Feldern gibt es Antworten: Schlüssel und Typ bleiben.",
} as const;
const FELD_GESUNDHEIT = {
  code: "FELD_GESUNDHEIT",
  message:
    "Ein Feld fragt nach Gesundheitsdaten. Die Anmeldung nimmt keine Gesundheitsdaten auf.",
} as const;
const TAG_UNBEKANNT = {
  code: "TAG_UNBEKANNT",
  message: "Ein Tag der Sichtbarkeit gehört nicht zur Abteilung.",
} as const;

// Drizzle legt den Fehler von Postgres in cause: 23505 = Index verletzt
const pgCode = (fehler: unknown) =>
  (fehler as { cause?: { code?: string } })?.cause?.code;

// Die Spalten einer Anlass-Zeile mit den Angaben des Termins, für Liste und Detail
const anlassSpalten = {
  id: anlass.id,
  programmId: anlass.programmId,
  titel: programm.titel,
  ganztaegig: programm.ganztaegig,
  beginn: programm.beginn,
  ende: programm.ende,
  tagVon: programm.tagVon,
  tagBis: programm.tagBis,
  art: anlass.art,
  anmeldungFuer: anlass.anmeldungFuer,
  anmeldungOffen: anlass.anmeldungOffen,
  frist: anlass.frist,
  sichtbarkeit: anlass.sichtbarkeit,
  sichtbarkeitTags: anlass.sichtbarkeitTags,
  seiteId: anlass.seiteId,
  // Die Gruppe vom Typ «anlass» zu diesem Anlass (zum Beispiel das OK), höchstens eine (#626); null ohne Gruppe
  gruppe: sql<{
    id: string;
    name: string;
  } | null>`(select jsonb_build_object('id', ${tag.id}, 'name', ${tag.name}) from ${tag} where ${tag.anlassId} = ${anlass.id})`,
  erstelltAm: anlass.erstelltAm,
};
function ausgabe<
  T extends {
    sichtbarkeit: Sichtbarkeit["art"];
    sichtbarkeitTags: string[];
  },
>(zeile: T) {
  const { sichtbarkeit, sichtbarkeitTags, ...rest } = zeile;
  return {
    ...rest,
    sichtbarkeit: sichtbarkeitAusSpalten({ sichtbarkeit, sichtbarkeitTags }),
  };
}

export function erstelleAdminAnlaesseRouten({ db }: { db: Db }) {
  // In SQL auf die Abteilung der Sitzung gefiltert: fremde wie unbekannte IDs sind 404, erst danach zählt das Recht
  async function ladeKurz(
    tx: Db | Parameters<Parameters<Db["transaction"]>[0]>[0],
    person: Person,
    id: string,
    // «anlass.anlegen» gilt für das Löschen, alles andere für «anlass.verwalten»
    recht: "anlass.verwalten" | "anlass.anlegen" = "anlass.verwalten",
    sperren = false,
  ) {
    const abfrage = tx
      .select({
        id: anlass.id,
        anmeldungFuer: anlass.anmeldungFuer,
        anmeldungOffen: anlass.anmeldungOffen,
        seiteId: anlass.seiteId,
      })
      .from(anlass)
      .where(
        and(eq(anlass.id, id), eq(anlass.abteilungId, person.abteilungId)),
      );
    const [ziel] = await (sperren ? abfrage.for("update") : abfrage);
    if (!ziel) throw new HTTPException(404);
    await verlange(tx, person, recht, {
      abteilungId: person.abteilungId,
      anlassId: id,
    });
    return ziel;
  }

  return (
    new Hono<TermineEnv>()
      .post("/admin/anlaesse", eingabe("json", anlegenSchema), async (c) => {
        const person = c.get("person");
        // Ohne Objekt im Pfad: erst das Recht (nur abteilungsweit), dann den Termin laden (ein fremder Termin ist 404)
        await verlange(db, person, "anlass.anlegen");
        const b = c.req.valid("json");
        if (findeGesundheitsfeld(b.felder) !== null) {
          return c.json(FELD_GESUNDHEIT, 400);
        }
        if (
          b.sichtbarkeit.art === "tags" &&
          !(await tagsGehoerenZurAbteilung(
            db,
            person.abteilungId,
            b.sichtbarkeit.tagIds,
          ))
        ) {
          return c.json(TAG_UNBEKANNT, 400);
        }
        const [termin] = await db
          .select({
            id: programm.id,
            titel: programm.titel,
            vorbei: terminVorbei,
          })
          .from(programm)
          .where(
            and(
              eq(programm.id, b.programmId),
              eq(programm.abteilungId, person.abteilungId),
            ),
          );
        if (!termin) throw new HTTPException(404);
        if (termin.vorbei) return c.json(TERMIN_VORBEI, 409);
        try {
          const neu = await db.transaction(async (tx) => {
            const [vorhanden] = await tx
              .select({ id: anlass.id })
              .from(anlass)
              .where(eq(anlass.programmId, termin.id));
            if (vorhanden) return null;
            // Scheitert die Seite, entsteht auch der Anlass nicht
            const seite = await erzeugeSeiteAusVorlage(tx, {
              abteilungId: person.abteilungId,
              vorlage: "anlass",
              titel: termin.titel.slice(0, 150),
              sichtbarkeit: b.sichtbarkeit,
              autorId: person.id,
            });
            const [zeile] = await tx
              .insert(anlass)
              .values({
                abteilungId: person.abteilungId,
                programmId: termin.id,
                anmeldungOffen: b.anmeldungOffen,
                frist: b.frist ?? null,
                anmeldungFuer: b.anmeldungFuer,
                ...sichtbarkeitSpalten(b.sichtbarkeit),
                seiteId: seite.id,
                erstelltVon: person.id,
              })
              .returning({ id: anlass.id });
            await schreibeFelder(tx, zeile.id, b.felder);
            // Nur Kennungen, nie Titel oder Beschriftungen
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "anlass_angelegt",
              zielTyp: "anlass",
              zielId: zeile.id,
              details: {
                programmId: termin.id,
                seiteId: seite.id,
                felder: b.felder.length,
              },
            });
            return { id: zeile.id, seiteId: seite.id, seiteNeu: seite.neu };
          });
          if (!neu) return c.json(ANLASS_VORHANDEN, 409);
          if (neu.seiteNeu) {
            meldeWebsiteEreignis({
              art: "seite_geaendert",
              abteilungId: person.abteilungId,
              seiteId: neu.seiteId,
            });
          }
          return c.json({ id: neu.id, seiteId: neu.seiteId }, 201);
        } catch (fehler) {
          // Zwei Aufrufe zugleich: Der zweite scheitert am eindeutigen Termin
          if (pgCode(fehler) === "23505") return c.json(ANLASS_VORHANDEN, 409);
          throw fehler;
        }
      })
      .get("/admin/anlaesse", eingabe("query", listeSchema), async (c) => {
        const person = c.get("person");
        // Die Tür: eines der Rechte irgendwo; die Liste zeigt nur die Anlässe, für die es gilt (alle oder die der eigenen Gruppen)
        await verlangeEines(db, person, LESEN);
        const sicht = await anlaesseMit(db, person, LESEN);
        const { limit, nach } = c.req.valid("query");
        if (sicht !== "alle" && sicht.length === 0) {
          return c.json({ anlaesse: [], weitere: false, naechste: null });
        }
        // Eine Abfrage für die Seite: Anlass, Termin, Zahl der Felder und die Rückmeldungen (zwei Zahlen aus einer Zählung je Anlass der Seite); neueste zuerst (uuidv7 ist zeitlich geordnet), nach = ID des letzten Eintrags
        const zeilen = await db
          .select({
            ...anlassSpalten,
            anzahlFelder: sql<number>`(select count(*)::int from anlass_feld where anlass_feld.anlass_id = ${anlass.id})`,
            angemeldet: sql<number>`(select count(*)::int from anlass_anmeldung a where a.anlass_id = ${anlass.id} and a.status = 'angemeldet')`,
            abgemeldet: sql<number>`(select count(*)::int from anlass_anmeldung a where a.anlass_id = ${anlass.id} and a.status = 'abgemeldet')`,
          })
          .from(anlass)
          .innerJoin(programm, eq(programm.id, anlass.programmId))
          .where(
            and(
              eq(anlass.abteilungId, person.abteilungId),
              sicht === "alle" ? undefined : inArray(anlass.id, sicht),
              nach ? lt(anlass.id, nach) : undefined,
            ),
          )
          .orderBy(desc(anlass.id))
          .limit(limit + 1);
        const seite = zeilen.slice(0, limit);
        const weitere = zeilen.length > limit;
        return c.json({
          anlaesse: await Promise.all(
            seite.map(async ({ angemeldet, abgemeldet, ...rest }) => ({
              ...ausgabe(rest),
              anmeldungen: { angemeldet, abgemeldet },
              // Für die Oberfläche: was die Person an diesem Anlass darf
              rechte: await anlassRechte(db, person, rest.id),
            })),
          ),
          weitere,
          naechste: weitere ? seite[seite.length - 1]!.id : null,
        });
      })
      // Die Gruppen für die Sichtbarkeit «Bestimmte Gruppen» (nur Name und Typ, keine Mitglieder): Wer Anlässe verwalten darf, braucht sie in den Einstellungen und liest dafür nicht die Gruppenverwaltung (#649). Vor «:id», sonst fängt der Pfad «gruppen» ab
      .get("/admin/anlaesse/gruppen", async (c) => {
        const person = c.get("person");
        await verlange(db, person, "anlass.verwalten");
        const tags = await db
          .select({ id: tag.id, typ: tag.typ, name: tag.name })
          .from(tag)
          .where(eq(tag.abteilungId, person.abteilungId))
          .orderBy(asc(tag.typ), asc(tag.name), asc(tag.id));
        return c.json({ tags });
      })
      .get("/admin/anlaesse/:id", eingabe("param", pfad()), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        // Eine Abfrage: Anlass, Termin und alle Felder (Join; ein Anlass hat höchstens 20)
        const zeilen = await db
          .select({
            ...anlassSpalten,
            feld: {
              schluessel: anlassFeld.schluessel,
              beschriftung: anlassFeld.beschriftung,
              typ: anlassFeld.typ,
              optionen: anlassFeld.optionen,
              pflicht: anlassFeld.pflicht,
              reihenfolge: anlassFeld.reihenfolge,
            },
          })
          .from(anlass)
          .innerJoin(programm, eq(programm.id, anlass.programmId))
          .leftJoin(anlassFeld, eq(anlassFeld.anlassId, anlass.id))
          .where(
            and(eq(anlass.id, id), eq(anlass.abteilungId, person.abteilungId)),
          )
          .orderBy(anlassFeld.reihenfolge);
        if (zeilen.length === 0) throw new HTTPException(404);
        await verlangeEines(db, person, LESEN, {
          abteilungId: person.abteilungId,
          anlassId: id,
        });
        // «feld: undefined» lässt JSON weg: Der Kopf trägt kein Feld, die Felder stehen in der Liste
        const kopf = { ...zeilen[0]!, feld: undefined };
        return c.json({
          ...ausgabe(kopf),
          rechte: await anlassRechte(db, person, id),
          felder: zeilen.flatMap((z) => (z.feld?.schluessel ? [z.feld] : [])),
        });
      })
      .patch(
        "/admin/anlaesse/:id",
        eingabe("param", pfad()),
        eingabe("json", aendernSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const b = c.req.valid("json");
          // Erst das Objekt (404), dann das Recht (403), dann die Eingabe gegen die Datenbank
          await ladeKurz(db, person, id);
          if (
            b.sichtbarkeit?.art === "tags" &&
            !(await tagsGehoerenZurAbteilung(
              db,
              person.abteilungId,
              b.sichtbarkeit.tagIds,
            ))
          ) {
            return c.json(TAG_UNBEKANNT, 400);
          }
          const antwort = await db.transaction(async (tx) => {
            // Sperrt den Anlass: Eine Anmeldung, die zugleich entsteht, wartet (Fremdschlüssel) und zählt dann mit
            const ziel = await ladeKurz(
              tx,
              person,
              id,
              "anlass.verwalten",
              true,
            );
            if (
              b.anmeldungFuer !== undefined &&
              b.anmeldungFuer !== ziel.anmeldungFuer &&
              (await zaehleAnmeldungen(tx, id)) > 0
            ) {
              return ANMELDUNGEN_VORHANDEN;
            }
            const aenderung = {
              ...(b.anmeldungOffen !== undefined && {
                anmeldungOffen: b.anmeldungOffen,
              }),
              ...(b.frist !== undefined && { frist: b.frist }),
              ...(b.sichtbarkeit && sichtbarkeitSpalten(b.sichtbarkeit)),
              ...(b.anmeldungFuer !== undefined && {
                anmeldungFuer: b.anmeldungFuer,
              }),
            };
            // Ohne Schlüssel wirft Drizzle bei set({}): kein Schreibzugriff
            if (Object.keys(aenderung).length === 0) return null;
            await tx.update(anlass).set(aenderung).where(eq(anlass.id, id));
            // Für das Änderungsprotokoll: Offen oder zu, vorher und nachher
            if (
              b.anmeldungOffen !== undefined &&
              b.anmeldungOffen !== ziel.anmeldungOffen
            ) {
              meldeAenderung(c, {
                vorher: { anmeldungOffen: ziel.anmeldungOffen },
                nachher: { anmeldungOffen: b.anmeldungOffen },
              });
            }
            // Welche Angaben, nie die Werte
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "anlass_geaendert",
              zielTyp: "anlass",
              zielId: id,
              details: { felder: Object.keys(b) },
            });
            return null;
          });
          if (antwort) return c.json(antwort, 409);
          return c.body(null, 204);
        },
      )
      .put(
        "/admin/anlaesse/:id/felder",
        eingabe("param", pfad()),
        eingabe("json", felderBody),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const { felder } = c.req.valid("json");
          await ladeKurz(db, person, id);
          if (findeGesundheitsfeld(felder) !== null) {
            return c.json(FELD_GESUNDHEIT, 400);
          }
          const fehler = await db.transaction(async (tx) => {
            await ladeKurz(tx, person, id, "anlass.verwalten", true);
            const bisher = await tx
              .select({
                schluessel: anlassFeld.schluessel,
                typ: anlassFeld.typ,
              })
              .from(anlassFeld)
              .where(eq(anlassFeld.anlassId, id));
            const gesperrt = felderInBenutzung(
              bisher,
              felder,
              await schluesselMitAntworten(tx, id),
            );
            if (gesperrt.length > 0) return gesperrt;
            await schreibeFelder(tx, id, felder);
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "anlass_felder_geaendert",
              zielTyp: "anlass",
              zielId: id,
              details: { felder: felder.length },
            });
            return null;
          });
          if (fehler)
            return c.json({ ...FELD_IN_BENUTZUNG, schluessel: fehler }, 409);
          return c.json({ felder: felder.map(mitReihenfolge) });
        },
      )
      .delete("/admin/anlaesse/:id", eingabe("param", pfad()), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        await ladeKurz(db, person, id, "anlass.anlegen");
        const belegt = await db.transaction(async (tx) => {
          const ziel = await ladeKurz(tx, person, id, "anlass.anlegen", true);
          if ((await zaehleAnmeldungen(tx, id)) > 0) return true;
          await tx.delete(anlass).where(eq(anlass.id, id));
          // Die Anlassseite bleibt (die Verwaltung der Website entscheidet über sie)
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "anlass_geloescht",
            zielTyp: "anlass",
            zielId: id,
            details: { seiteId: ziel.seiteId },
          });
          return false;
        });
        if (belegt) return c.json(ANMELDUNGEN_VORHANDEN, 409);
        return c.body(null, 204);
      })
  );
}

const mitReihenfolge = (f: FeldEingabe, reihenfolge: number) => ({
  ...f,
  reihenfolge,
});

import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { bearbeitbar, darfSeite } from "../../bearbeiten.js";
import type { Db } from "../../db/client.js";
import { auditLog, bearbeiter, seite, tag } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";
import { darf as darfRecht, verlange } from "../../rechtemodell/darf.js";
import {
  sichtbarkeitAusSpalten,
  sichtbarkeitSchema,
  sichtbarkeitSpalten,
  tagsGehoerenZurAbteilung,
  type Sichtbarkeit,
} from "../../sichtbarkeit.js";
import { meldeWebsiteEreignis } from "../../website/ereignisse.js";
import {
  adresseSchema,
  adressenVon,
  hatWebsiteZugang,
  MAX_TIEFE,
  pruefeLage,
  RESERVIERTE_ADRESSEN,
  type Knoten,
} from "../../website/seiten.js";

const titel = z.string().trim().min(1).max(150);
const reihenfolge = z.number().int().min(0).max(100_000);

// Ein Schema pro Route. Ohne Vorgabe für die Sichtbarkeit: Wer anlegt, entscheidet
const anlegenSchema = z.strictObject({
  titel,
  adresse: adresseSchema,
  elternId: z.uuid().nullable().optional(),
  sichtbarkeit: sichtbarkeitSchema,
  tagId: z.uuid().nullable().optional(),
  reihenfolge: reihenfolge.optional(),
});
// Ohne Schlüssel bleibt der Wert, wie er ist; elternId und tagId lassen sich mit null leeren
const aendernSchema = z
  .strictObject({
    titel: titel.optional(),
    adresse: adresseSchema.optional(),
    elternId: z.uuid().nullable().optional(),
    reihenfolge: reihenfolge.optional(),
    sichtbarkeit: sichtbarkeitSchema.optional(),
    tagId: z.uuid().nullable().optional(),
  })
  .refine((f) => Object.keys(f).length > 0);
const pfad = () => z.strictObject({ id: z.uuid() });

const ADRESSE_RESERVIERT = {
  code: "ADRESSE_RESERVIERT",
  message: "Diese Adresse ist auf der obersten Ebene reserviert.",
} as const;
const ADRESSE_VERGEBEN = {
  code: "ADRESSE_VERGEBEN",
  message:
    "Unter dieser Elternseite gibt es schon eine Seite mit dieser Adresse.",
} as const;
const TAG_VERGEBEN = {
  code: "TAG_VERGEBEN",
  message: "Für diese Gruppe gibt es schon eine Seite.",
} as const;
const SEITE_ZYKLUS = {
  code: "SEITE_ZYKLUS",
  message:
    "Eine Seite lässt sich nicht unter sich selbst oder ihre Unterseiten legen.",
} as const;
const SEITE_ZU_TIEF = {
  code: "SEITE_ZU_TIEF",
  message: `Der Baum darf höchstens ${MAX_TIEFE} Ebenen tief sein.`,
} as const;
const SEITE_HAT_UNTERSEITEN = {
  code: "SEITE_HAT_UNTERSEITEN",
  message: "Die Seite hat Unterseiten. Verschiebe oder lösche sie zuerst.",
} as const;

// Bricht die Transaktion ab und wird zur Antwort
class Abbruch extends Error {
  constructor(
    readonly antwort: { code: string; message: string },
    readonly status: 400 | 409,
  ) {
    super();
  }
}

// Drizzle legt den Fehler von Postgres in cause: 23505 = Index verletzt
const pgFehler = (fehler: unknown) =>
  (fehler as { cause?: { code?: string; constraint_name?: string } })?.cause;

// Eindeutigkeit der Datenbank (Adresse unter der Elternseite, eine Seite je Gruppe) als 409
function uebersetze(fehler: unknown): never {
  const cause = pgFehler(fehler);
  if (cause?.code === "23505") {
    if (cause.constraint_name === "seite_tag_eindeutig") {
      throw new Abbruch(TAG_VERGEBEN, 409);
    }
    if (cause.constraint_name === "seite_adresse_eindeutig") {
      throw new Abbruch(ADRESSE_VERGEBEN, 409);
    }
  }
  throw fehler;
}

type Zeile = typeof seite.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function erstelleSeitenRouten({ db }: { db: Db }) {
  const antwort = (z: Zeile, knoten: Knoten) => ({
    id: z.id,
    elternId: z.elternId,
    adresse: z.adresse,
    pfad: `/${adressenVon(knoten, z.id).join("/")}`,
    titel: z.titel,
    reihenfolge: z.reihenfolge,
    sichtbarkeit: sichtbarkeitAusSpalten(z),
    tagId: z.tagId,
    veroeffentlicht: z.veroeffentlichteVersionId !== null,
    geaendertAm: z.geaendertAm.toISOString(),
  });

  // Alle Seiten der Abteilung als Baum im Speicher: nur Struktur, nie Inhalt. Eine Abteilung hat Dutzende, nicht Tausende
  async function ladeKnoten(d: Pick<Db, "select">, abteilungId: string) {
    const zeilen = await d
      .select({
        id: seite.id,
        elternId: seite.elternId,
        adresse: seite.adresse,
        reihenfolge: seite.reihenfolge,
        tagId: seite.tagId,
      })
      .from(seite)
      .where(eq(seite.abteilungId, abteilungId));
    return new Map(zeilen.map((z) => [z.id, z])) as Knoten;
  }

  // Strukturänderungen laufen je Abteilung nacheinander: So entsteht aus zwei gleichzeitigen Verschiebungen kein Zyklus
  const sperre = (tx: Tx, abteilungId: string) =>
    tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`seite:${abteilungId}`}, 0))`,
    );

  // Auf die Abteilung der Sitzung gefiltert: fremde wie unbekannte IDs sind 404, erst danach zählt das Recht
  async function ladeSeite(d: Pick<Db, "select">, person: Person, id: string) {
    const [zeile] = await d
      .select()
      .from(seite)
      .where(and(eq(seite.id, id), eq(seite.abteilungId, person.abteilungId)));
    if (!zeile) throw new HTTPException(404);
    return zeile;
  }

  // Eine Seite einer Stufe (tagId = Stufe) bearbeitet auch deren Stufenleitung, die eines Teams dessen Verantwortliche
  const darf = (
    d: Pick<Db, "select" | "execute">,
    person: Person,
    z: { id: string; abteilungId?: string; tagId: string | null },
  ) => darfSeite(d, person, z);

  // Reservierte Adresse, Zyklus und Tiefe; die Eindeutigkeit der Adresse sichert zusätzlich die Datenbank
  function pruefeAdresseUndLage(
    knoten: Knoten,
    id: string | undefined,
    elternId: string | null,
    adresse: string,
  ) {
    if (elternId === null && RESERVIERTE_ADRESSEN.includes(adresse)) {
      throw new Abbruch(ADRESSE_RESERVIERT, 400);
    }
    const lage = pruefeLage(knoten, id, elternId);
    if (lage === "zyklus") throw new Abbruch(SEITE_ZYKLUS, 400);
    if (lage === "zu_tief") throw new Abbruch(SEITE_ZU_TIEF, 400);
  }

  // Ein Tag aus einer anderen Abteilung ist für diese Routen unbekannt
  async function pruefeTag(
    d: Pick<Db, "select">,
    person: Person,
    tagId: string,
  ) {
    const [z] = await d
      .select({ id: tag.id })
      .from(tag)
      .where(and(eq(tag.id, tagId), eq(tag.abteilungId, person.abteilungId)));
    if (!z) throw new HTTPException(404);
  }

  // Die Tags der Sichtbarkeit müssen zur Abteilung gehören, sonst kennt der Aufrufer fremde Tag-IDs (400)
  async function pruefeSichtbarkeit(person: Person, wert: Sichtbarkeit) {
    if (
      wert.art === "tags" &&
      !(await tagsGehoerenZurAbteilung(db, person.abteilungId, wert.tagIds))
    ) {
      throw new HTTPException(400);
    }
  }

  return new Hono<{ Variables: { person: Person } }>()
    .get("/", async (c) => {
      const person = c.get("person");
      if (!(await hatWebsiteZugang(db, person))) {
        throw new HTTPException(403);
      }
      // Nur Seiten, die die Person bearbeiten darf; ihre Elternseiten fehlen womöglich, elternId zeigt trotzdem auf sie
      const [zeilen, knoten] = await Promise.all([
        db
          .select()
          .from(seite)
          .where(
            bearbeitbar(person, "seite", {
              id: seite.id,
              abteilungId: seite.abteilungId,
              stufeId: seite.tagId,
              tagId: seite.tagId,
            }),
          )
          .orderBy(asc(seite.reihenfolge), asc(seite.adresse), asc(seite.id)),
        ladeKnoten(db, person.abteilungId),
      ]);
      return c.json({ seiten: zeilen.map((z) => antwort(z, knoten)) });
    })
    .post("/", eingabe("json", anlegenSchema), async (c) => {
      const person = c.get("person");
      if (!(await hatWebsiteZugang(db, person))) {
        throw new HTTPException(403);
      }
      const felder = c.req.valid("json");
      const elternId = felder.elternId ?? null;
      const tagId = felder.tagId ?? null;
      try {
        const neu = await db.transaction(async (tx) => {
          await sperre(tx, person.abteilungId);
          const knoten = await ladeKnoten(tx, person.abteilungId);
          // Erst die Elternseite laden (fremde ID = 404), dann das Recht
          if (elternId !== null && !knoten.has(elternId)) {
            throw new HTTPException(404);
          }
          await verlange(tx, person, "seiten.anlegen_loeschen");
          if (tagId !== null) await pruefeTag(tx, person, tagId);
          await pruefeSichtbarkeit(person, felder.sichtbarkeit);
          pruefeAdresseUndLage(knoten, undefined, elternId, felder.adresse);
          // Ohne Angabe ans Ende der Geschwister
          const letzte = Math.max(
            -1,
            ...[...knoten.values()]
              .filter((k) => k.elternId === elternId)
              .map((k) => k.reihenfolge),
          );
          const [zeile] = await tx
            .insert(seite)
            .values({
              abteilungId: person.abteilungId,
              elternId,
              adresse: felder.adresse,
              titel: felder.titel,
              reihenfolge: felder.reihenfolge ?? letzte + 1,
              tagId,
              ...sichtbarkeitSpalten(felder.sichtbarkeit),
            })
            .returning({ id: seite.id })
            .catch(uebersetze);
          // Nur Kennungen und die Art der Sichtbarkeit, nie Titel oder Inhalt
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "seite_angelegt",
            zielTyp: "seite",
            zielId: zeile.id,
            details: { elternId, tagId, sichtbarkeit: felder.sichtbarkeit.art },
          });
          return zeile;
        });
        meldeWebsiteEreignis({
          art: "seite_geaendert",
          abteilungId: person.abteilungId,
          seiteId: neu.id,
        });
        return c.json({ id: neu.id }, 201);
      } catch (fehler) {
        if (fehler instanceof Abbruch) {
          return c.json(fehler.antwort, fehler.status);
        }
        throw fehler;
      }
    })
    .get("/:id", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const zeile = await ladeSeite(db, person, c.req.valid("param").id);
      if (!(await darf(db, person, zeile))) throw new HTTPException(403);
      return c.json(antwort(zeile, await ladeKnoten(db, person.abteilungId)));
    })
    .patch(
      "/:id",
      eingabe("param", pfad()),
      eingabe("json", aendernSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const felder = c.req.valid("json");
        try {
          await db.transaction(async (tx) => {
            await sperre(tx, person.abteilungId);
            const alt = await ladeSeite(tx, person, id);
            if (!(await darf(tx, person, alt))) throw new HTTPException(403);
            const knoten = await ladeKnoten(tx, person.abteilungId);
            const elternId =
              felder.elternId === undefined ? alt.elternId : felder.elternId;
            const adresse = felder.adresse ?? alt.adresse;
            if (elternId !== alt.elternId) {
              // Wohin eine Seite wandert, muss die Person selbst bearbeiten dürfen; auf die oberste Ebene setzt nur, wer Seiten anlegen und löschen darf
              const ziel = elternId === null ? null : knoten.get(elternId);
              if (elternId !== null && !ziel) throw new HTTPException(404);
              const erlaubt = ziel
                ? await darf(tx, person, ziel)
                : await darfRecht(tx, person, "seiten.anlegen_loeschen");
              if (!erlaubt) throw new HTTPException(403);
            }
            // Die Gruppe einer Seite bestimmt, wer sie als Stufenleitung bearbeitet: nur wer Seiten anlegen und löschen darf, ändert sie
            if (felder.tagId !== undefined && felder.tagId !== alt.tagId) {
              await verlange(tx, person, "seiten.anlegen_loeschen");
              if (felder.tagId !== null) {
                await pruefeTag(tx, person, felder.tagId);
              }
            }
            if (felder.sichtbarkeit) {
              await pruefeSichtbarkeit(person, felder.sichtbarkeit);
            }
            if (elternId !== alt.elternId || adresse !== alt.adresse) {
              pruefeAdresseUndLage(knoten, id, elternId, adresse);
            }
            const { sichtbarkeit, ...rest } = felder;
            await tx
              .update(seite)
              .set({
                ...rest,
                ...(sichtbarkeit && sichtbarkeitSpalten(sichtbarkeit)),
                geaendertAm: new Date(),
              })
              .where(eq(seite.id, id))
              .catch(uebersetze);
            // Nur die Namen der Felder, nie die Werte
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "seite_geaendert",
              zielTyp: "seite",
              zielId: id,
              details: { felder: Object.keys(felder) },
            });
          });
          meldeWebsiteEreignis({
            art: "seite_geaendert",
            abteilungId: person.abteilungId,
            seiteId: id,
          });
          return c.body(null, 204);
        } catch (fehler) {
          if (fehler instanceof Abbruch) {
            return c.json(fehler.antwort, fehler.status);
          }
          throw fehler;
        }
      },
    )
    .delete("/:id", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      try {
        await db.transaction(async (tx) => {
          await sperre(tx, person.abteilungId);
          await ladeSeite(tx, person, id);
          // Löschen wie Anlegen nur mit dem Recht «Seiten anlegen und löschen»: Eine Stufenleitung löscht die Seite ihrer Stufe nicht
          await verlange(tx, person, "seiten.anlegen_loeschen");
          const [kind] = await tx
            .select({ id: seite.id })
            .from(seite)
            .where(eq(seite.elternId, id))
            .limit(1);
          if (kind) throw new Abbruch(SEITE_HAT_UNTERSEITEN, 409);
          await tx.delete(seite).where(eq(seite.id, id));
          // Ein Recht auf genau diese Seite hat danach kein Ziel mehr
          await tx
            .delete(bearbeiter)
            .where(
              and(
                eq(bearbeiter.abteilungId, person.abteilungId),
                eq(bearbeiter.objektTyp, "seite"),
                eq(bearbeiter.objektId, id),
              ),
            );
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "seite_geloescht",
            zielTyp: "seite",
            zielId: id,
            details: {},
          });
        });
        meldeWebsiteEreignis({
          art: "seite_geloescht",
          abteilungId: person.abteilungId,
          seiteId: id,
        });
        return c.body(null, 204);
      } catch (fehler) {
        if (fehler instanceof Abbruch) {
          return c.json(fehler.antwort, fehler.status);
        }
        throw fehler;
      }
    });
}

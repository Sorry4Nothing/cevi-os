import { and, asc, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { bearbeitbar } from "../../bearbeiten.js";
import type { Db } from "../../db/client.js";
import {
  auditLog,
  ort,
  programmEckdaten,
  seite,
  tag,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  kartenLink,
  MAX_ADRESSE,
  MAX_STANDORT_EINGABE,
  pruefeStandort,
  standortText,
  type Standort,
  type StandortGrund,
} from "../../karten-standort.js";
import { hatPlattformRecht } from "../../plattform.js";
import type { Person } from "../../rechte.js";
import { meldeWebsiteEreignis } from "../../website/ereignisse.js";
import {
  heuteZuerich,
  vergissStufenfakten,
} from "../../website/stufenfakten.js";

// Orte-Bibliothek der Abteilung (#646): Treffpunkte und Schlussorte, die oft vorkommen, einmal angelegt und in den Samstagsangaben der Stufen per Auswahl gewählt.
// Recht: Wer die Samstagsangaben mindestens einer Stufe pflegen darf (Abteilungsleitung, Stufenleitung, Plattformrecht «Seiten bearbeiten», Sonderrecht an einer Stufenseite). Die Orte gehören der ganzen Abteilung, die Auswahl steht in jeder Stufe; «Neuer Ort» soll die Stufenleitung ohne Umweg anlegen können. Die Gefahr ist klein: Löschen löst nur den Bezug auf, die Texte der Angaben bleiben.
export const MAX_ORTE = 200;
const MAX_NAME = 100;
const MAX_BESCHREIBUNG = 200;
// Nutzungsliste je Ort: so viele Samstage zeigt die Verwaltung beim Löschen
const MAX_NUTZUNG_ANZEIGE = 5;

// Steuerzeichen sind verboten; Leerraum an den Rändern fällt weg (wie bei den Samstagsangaben)
const OHNE_STEUERZEICHEN = /^[^\p{Cc}\p{Cf}]*$/u;
const name = z.string().trim().min(1).max(MAX_NAME).regex(OHNE_STEUERZEICHEN);
// Leer heisst «nicht gesetzt»
const leerZuNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;
const beschreibung = z.preprocess(
  leerZuNull,
  z
    .string()
    .trim()
    .max(MAX_BESCHREIBUNG)
    .regex(OHNE_STEUERZEICHEN)
    .nullable()
    .optional(),
);
// Der Rohtext des Standorts: Link, Adresse oder «Breite, Länge»; die Prüfung macht pruefeStandort (sonst 400 mit Code)
const standortFeld = z.string().max(MAX_STANDORT_EINGABE);

const anlegenSchema = z.strictObject({
  name,
  beschreibung,
  standort: standortFeld.optional(),
  aktiv: z.boolean().optional(),
});
const aendernSchema = z
  .strictObject({
    name: name.optional(),
    beschreibung,
    standort: standortFeld.optional(),
    aktiv: z.boolean().optional(),
  })
  .refine((f) => Object.keys(f).length > 0);
const reihenfolgeSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(MAX_ORTE),
});
const vorschauSchema = z.strictObject({ standort: standortFeld });
const pfad = () => z.strictObject({ id: z.uuid() });

const MELDUNG_STANDORT: Record<StandortGrund, string> = {
  ungueltig:
    "Der Standort ist nicht lesbar. Füge einen Link von Google Maps, eine Adresse oder «Breite, Länge» ein.",
  host: "Nur Links von Google Maps sind erlaubt (google.com/maps, maps.app.goo.gl).",
  zu_lang: `Der Standort ist zu lang (Adresse höchstens ${MAX_ADRESSE} Zeichen).`,
};
const standortFehler = (grund: StandortGrund) =>
  ({
    code: "ORT_STANDORT_UNGUELTIG",
    message: MELDUNG_STANDORT[grund],
  }) as const;
const NAME_VERGEBEN = {
  code: "ORT_NAME_VERGEBEN",
  message: "Einen Ort mit diesem Namen gibt es schon.",
} as const;
const ZU_VIELE = {
  code: "ORT_ZU_VIELE",
  message: `Es gibt höchstens ${MAX_ORTE} Orte.`,
} as const;

// Bricht die Transaktion ab und wird zur Antwort
class Abbruch extends Error {
  constructor(
    readonly antwort: { code: string; message: string },
    readonly status: 400 | 409 = 409,
  ) {
    super();
  }
}

// Drizzle legt den Fehler von Postgres in cause: 23505 = Index verletzt
const pgFehler = (fehler: unknown) =>
  (fehler as { cause?: { code?: string } })?.cause;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Zeile = typeof ort.$inferSelect;

const standortVon = (z: Zeile): Standort => ({
  adresse: z.karteAdresse,
  breite: z.breite,
  laenge: z.laenge,
  url: z.karteUrl,
});
const artVon = (s: Standort) =>
  s.breite !== null
    ? "koordinaten"
    : s.adresse !== null
      ? "adresse"
      : s.url !== null
        ? "link"
        : null;

// Wie die Antwort einen Standort beschreibt: Eingabetext (zum Bearbeiten), Art und der Link zur Karte
export const standortAntwort = (s: Standort) => ({
  standort: standortText(s),
  standortArt: artVon(s),
  kartenLink: kartenLink(s),
});

// Wer mindestens eine Stufenseite bearbeiten darf, pflegt die Orte. Eine Abfrage höchstens; Abteilungsleitung und Stufenleitung brauchen keine
export async function darfOrteVerwalten(db: Db, person: Person) {
  if (person.admin || person.rollen.some((r) => r.typ === "stufenleitung")) {
    return true;
  }
  if (await hatPlattformRecht(db, person, "seiten.bearbeiten")) return true;
  const [zeile] = await db
    .select({ id: seite.id })
    .from(seite)
    .innerJoin(tag, and(eq(tag.id, seite.tagId), eq(tag.typ, "stufe")))
    .where(
      bearbeitbar(person, "seite", {
        id: seite.id,
        abteilungId: seite.abteilungId,
        stufeId: seite.tagId,
      }),
    )
    .limit(1);
  return zeile !== undefined;
}

export function erstelleOrteRouten({ db }: { db: Db }) {
  const pruefeRecht = async (person: Person) => {
    if (!(await darfOrteVerwalten(db, person))) throw new HTTPException(403);
  };

  // Änderungen laufen je Abteilung nacheinander (Obergrenze, Reihenfolge, Namen)
  const sperre = (tx: Tx, abteilungId: string) =>
    tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`ort:${abteilungId}`}, 0))`,
    );

  // Erst der Ort der Abteilung der Sitzung (fremde und unbekannte IDs sind 404), dann das Recht
  async function ladeOrt(tx: Tx, person: Person, id: string) {
    const [zeile] = await tx
      .select()
      .from(ort)
      .where(and(eq(ort.id, id), eq(ort.abteilungId, person.abteilungId)));
    if (!zeile) throw new HTTPException(404);
    if (!(await darfOrteVerwalten(db, person))) throw new HTTPException(403);
    return zeile;
  }

  // Die Stufenseiten, auf denen der Ort steht (Treffpunkt oder Schlussort einer Angabe): Sie werden neu erzeugt, wenn sich der Ort ändert
  async function seitenMitOrt(tx: Tx, abteilungId: string, ortId: string) {
    const zeilen = await tx
      .selectDistinct({ id: seite.id })
      .from(programmEckdaten)
      .innerJoin(
        seite,
        and(
          eq(seite.tagId, programmEckdaten.stufeId),
          eq(seite.abteilungId, abteilungId),
        ),
      )
      .where(
        or(
          eq(programmEckdaten.treffpunktOrtId, ortId),
          eq(programmEckdaten.schlussOrtId, ortId),
        ),
      );
    return zeilen.map((z) => z.id);
  }
  const meldeSeiten = (abteilungId: string, seiten: string[]) => {
    vergissStufenfakten();
    for (const seiteId of seiten) {
      meldeWebsiteEreignis({ art: "seite_geaendert", abteilungId, seiteId });
    }
  };

  const standortFuer = (roh: string | undefined): Standort | undefined => {
    if (roh === undefined) return undefined;
    const g = pruefeStandort(roh);
    if (!g.ok) throw new Abbruch(standortFehler(g.grund), 400);
    return g.standort;
  };
  const spaltenAus = (s: Standort) => ({
    karteAdresse: s.adresse,
    breite: s.breite,
    laenge: s.laenge,
    karteUrl: s.url,
  });
  return (
    new Hono<{ Variables: { person: Person } }>()
      .get("/", async (c) => {
        const person = c.get("person");
        await pruefeRecht(person);
        // Zwei Abfragen: die Orte der Abteilung (höchstens MAX_ORTE) und die Samstage, an denen sie gebraucht werden
        const orte = await db
          .select()
          .from(ort)
          .where(eq(ort.abteilungId, person.abteilungId))
          .orderBy(asc(ort.reihenfolge), asc(sql`lower(${ort.name})`))
          .limit(MAX_ORTE);
        const nutzung = await db
          .select({
            stufe: tag.name,
            tag: programmEckdaten.tag,
            treff: programmEckdaten.treffpunktOrtId,
            schluss: programmEckdaten.schlussOrtId,
          })
          .from(programmEckdaten)
          .innerJoin(tag, eq(tag.id, programmEckdaten.stufeId))
          .where(
            and(
              eq(tag.abteilungId, person.abteilungId),
              gte(programmEckdaten.tag, heuteZuerich()),
              or(
                isNotNull(programmEckdaten.treffpunktOrtId),
                isNotNull(programmEckdaten.schlussOrtId),
              ),
            ),
          )
          .orderBy(asc(programmEckdaten.tag))
          .limit(2000);
        const je = new Map<string, { stufe: string; tag: string }[]>();
        for (const n of nutzung) {
          for (const id of new Set([n.treff, n.schluss])) {
            if (id)
              je.set(id, [
                ...(je.get(id) ?? []),
                { stufe: n.stufe, tag: n.tag },
              ]);
          }
        }
        return c.json({
          orte: orte.map((z) => ({
            id: z.id,
            name: z.name,
            beschreibung: z.beschreibung,
            ...standortAntwort(standortVon(z)),
            reihenfolge: z.reihenfolge,
            aktiv: z.aktiv,
            zuletztVerwendetAm: z.zuletztVerwendetAm,
            verwendet: je.get(z.id)?.length ?? 0,
            verwendung: (je.get(z.id) ?? []).slice(0, MAX_NUTZUNG_ANZEIGE),
          })),
        });
      })
      // Was der Server aus der Eingabe liest, ohne zu speichern: Die Verwaltung zeigt es beim Tippen (Art, Link zur Karte)
      .post("/vorschau", eingabe("json", vorschauSchema), async (c) => {
        await pruefeRecht(c.get("person"));
        const g = pruefeStandort(c.req.valid("json").standort);
        if (!g.ok) return c.json(standortFehler(g.grund), 400);
        return c.json(standortAntwort(g.standort));
      })
      .put("/reihenfolge", eingabe("json", reihenfolgeSchema), async (c) => {
        const person = c.get("person");
        await pruefeRecht(person);
        const { ids } = c.req.valid("json");
        if (new Set(ids).size !== ids.length) throw new HTTPException(400);
        await db.transaction(async (tx) => {
          await sperre(tx, person.abteilungId);
          const vorhanden = await tx
            .select({ id: ort.id })
            .from(ort)
            .where(eq(ort.abteilungId, person.abteilungId));
          const bekannt = new Set(vorhanden.map((o) => o.id));
          if (ids.some((id) => !bekannt.has(id))) throw new HTTPException(404);
          for (const [i, id] of ids.entries()) {
            await tx.update(ort).set({ reihenfolge: i }).where(eq(ort.id, id));
          }
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "ort_reihenfolge_geaendert",
            zielTyp: "ort",
            zielId: person.abteilungId,
            details: { anzahl: ids.length },
          });
        });
        return c.body(null, 204);
      })
      .post("/", eingabe("json", anlegenSchema), async (c) => {
        const person = c.get("person");
        await pruefeRecht(person);
        const felder = c.req.valid("json");
        try {
          const standort = standortFuer(felder.standort);
          const neu = await db.transaction(async (tx) => {
            await sperre(tx, person.abteilungId);
            const [{ n, hoechste }] = await tx
              .select({
                n: sql<number>`count(*)::int`,
                hoechste: sql<number>`coalesce(max(${ort.reihenfolge}), -1)::int`,
              })
              .from(ort)
              .where(eq(ort.abteilungId, person.abteilungId));
            if (n >= MAX_ORTE) throw new Abbruch(ZU_VIELE);
            const [zeile] = await tx
              .insert(ort)
              .values({
                abteilungId: person.abteilungId,
                name: felder.name,
                beschreibung: felder.beschreibung ?? null,
                ...(standort ? spaltenAus(standort) : {}),
                aktiv: felder.aktiv ?? true,
                reihenfolge: hoechste + 1,
              })
              .returning({ id: ort.id })
              .catch((f) => {
                if (pgFehler(f)?.code === "23505")
                  throw new Abbruch(NAME_VERGEBEN);
                throw f;
              });
            // Nur Kennung und Namen der Felder, nie die Werte
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "ort_angelegt",
              zielTyp: "ort",
              zielId: zeile.id,
              details: { felder: Object.keys(felder) },
            });
            return zeile;
          });
          return c.json({ id: neu.id }, 201);
        } catch (e) {
          if (e instanceof Abbruch) return c.json(e.antwort, e.status);
          throw e;
        }
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
            const standort = standortFuer(felder.standort);
            const seiten = await db.transaction(async (tx) => {
              await sperre(tx, person.abteilungId);
              await ladeOrt(tx, person, id);
              await tx
                .update(ort)
                .set({
                  ...(felder.name !== undefined && { name: felder.name }),
                  ...(felder.beschreibung !== undefined && {
                    beschreibung: felder.beschreibung,
                  }),
                  ...(standort && spaltenAus(standort)),
                  ...(felder.aktiv !== undefined && { aktiv: felder.aktiv }),
                })
                .where(eq(ort.id, id))
                .catch((f) => {
                  if (pgFehler(f)?.code === "23505")
                    throw new Abbruch(NAME_VERGEBEN);
                  throw f;
                });
              // Der Name in den Angaben der Stufen folgt (Schnappschuss), damit die Seiten den neuen Namen zeigen
              if (felder.name !== undefined) {
                await tx
                  .update(programmEckdaten)
                  .set({ treffpunkt: felder.name })
                  .where(eq(programmEckdaten.treffpunktOrtId, id));
                await tx
                  .update(programmEckdaten)
                  .set({ schlussOrt: felder.name })
                  .where(eq(programmEckdaten.schlussOrtId, id));
              }
              await tx.insert(auditLog).values({
                abteilungId: person.abteilungId,
                akteurId: person.id,
                aktion: "ort_geaendert",
                zielTyp: "ort",
                zielId: id,
                details: { felder: Object.keys(felder) },
              });
              // «aktiv» ändert nur die Auswahl, nie eine Seite
              const zeigt = Object.keys(felder).some((k) => k !== "aktiv");
              return zeigt ? seitenMitOrt(tx, person.abteilungId, id) : [];
            });
            meldeSeiten(person.abteilungId, seiten);
            return c.body(null, 204);
          } catch (e) {
            if (e instanceof Abbruch) return c.json(e.antwort, e.status);
            throw e;
          }
        },
      )
      // Der Bezug in den Samstagsangaben wird aufgelöst (Fremdschlüssel SET NULL); der Text bleibt. Wo der Ort noch gebraucht wird, sagt die Liste vorher (verwendet, verwendung)
      .delete("/:id", eingabe("param", pfad()), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const seiten = await db.transaction(async (tx) => {
          await sperre(tx, person.abteilungId);
          await ladeOrt(tx, person, id);
          const betroffen = await seitenMitOrt(tx, person.abteilungId, id);
          await tx.delete(ort).where(eq(ort.id, id));
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "ort_geloescht",
            zielTyp: "ort",
            zielId: id,
            details: {},
          });
          return betroffen;
        });
        meldeSeiten(person.abteilungId, seiten);
        return c.body(null, 204);
      })
  );
}

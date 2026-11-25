import { and, desc, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { meldeAenderung } from "../../aktivitaet-middleware.js";
import type { Db } from "../../db/client.js";
import { auditLog, formularAntwort, user } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  antwortenVon,
  istFormularId,
  ladeVeroeffentlichtes,
  ladeVersionen,
  listeFormulare,
  type FormularZeile,
} from "../../formular/formular.js";
import { erstelleBegrenzung } from "../../fotos/begrenzung.js";
import type { Person } from "../../rechte.js";
import { darf, verlange } from "../../rechtemodell/darf.js";
import { BOM, csvZeile } from "../../termine/csv.js";
import {
  antwortText,
  type Antworten,
  type Feld,
  type FormularBaustein,
} from "../../website/bausteine-formular.js";

// Antworten auf Formulare der Website in der Verwaltung (#819): Liste der Formulare, Antworten ansehen, als CSV exportieren, löschen. Die Pfade tragen /api/v1/admin/formulare und erben den zweiten Faktor.
// Eigene Rechte (formular.antworten_sehen, …_exportieren, …_loeschen): Die Redaktion sieht Antworten nicht automatisch, denn sie enthalten Personendaten. Ein Formular einer anderen Abteilung oder ein unbekanntes ist 404, erst danach das Recht (403).
// Eine Antwort wird mit den Beschriftungen angezeigt, mit denen sie entstand (Version der Seite): Spätere Änderungen am Formular machen sie nicht kaputt. Text kommt nur als Text in die Antwort; die Oberfläche setzt ihn nie als HTML ein.
const pfad = z.strictObject({ id: z.string().refine(istFormularId) });
const pfadAntwort = z.strictObject({
  id: z.string().refine(istFormularId),
  antwortId: z.uuid(),
});
const listeSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  nach: z.uuid().optional(),
});
const BLOCK = 500;
// Je Person ein Export in so kurzer Zeit: ein Schutz vor Dauerabrufen, die den Server und das Netz belasten (SR-71)
const EXPORTE = 10;
const FENSTER_MS = 10 * 60_000;

type Env = { Variables: { person: Person } };

export function erstelleAdminFormularRouten({ db }: { db: Db }) {
  const exportErlaubt = erstelleBegrenzung({
    max: EXPORTE,
    fensterMs: FENSTER_MS,
  });

  // Erst das Formular der eigenen Abteilung (404), dann das Recht (403)
  async function lade(person: Person, id: string, recht: string) {
    const liste = await listeFormulare(db, person.abteilungId);
    const z = liste.find((f) => f.formularId === id.toLowerCase());
    if (!z) throw new HTTPException(404);
    await verlange(db, person, recht);
    return z;
  }

  // Die aktuelle Definition: die veröffentlichte, sonst die der letzten Antwort
  async function aktuelleDefinition(
    abteilungId: string,
    z: FormularZeile,
  ): Promise<FormularBaustein | null> {
    const v = await ladeVeroeffentlichtes(db, z.formularId);
    if (v && v.abteilungId === abteilungId) return v.baustein;
    const [letzte] = await db
      .select({ versionId: formularAntwort.versionId })
      .from(formularAntwort)
      .where(antwortenVon(abteilungId, z.formularId))
      .orderBy(desc(formularAntwort.id))
      .limit(1);
    if (!letzte) return null;
    return (
      (await ladeVersionen(db, z.formularId, [letzte.versionId])).get(
        letzte.versionId,
      ) ?? null
    );
  }

  const rufname = (name: string | null, cevi: string | null) =>
    cevi?.trim() || name?.trim().split(/\s+/)[0] || "Unbekannt";

  return new Hono<Env>()
    // Alle Formulare der Abteilung mit der Zahl ihrer Antworten
    .get("/", async (c) => {
      const person = c.get("person");
      await verlange(db, person, "formular.antworten_sehen");
      const liste = await listeFormulare(db, person.abteilungId);
      return c.json({ formulare: liste });
    })
    .get("/:id", eingabe("param", pfad), async (c) => {
      const person = c.get("person");
      const z = await lade(person, c.req.valid("param").id, "formular.antworten_sehen");
      const b = await aktuelleDefinition(person.abteilungId, z);
      return c.json({
        formular: z,
        // Was die Person mit den Antworten darf: Die Oberfläche blendet Knöpfe ohne das Recht aus, jede Route prüft selbst
        rechte: {
          exportieren: await darf(db, person, "formular.antworten_exportieren"),
          loeschen: await darf(db, person, "formular.antworten_loeschen"),
        },
        felder: (b?.daten.felder ?? []).map((f) => ({
          id: f.id,
          beschriftung: f.beschriftung,
          typ: f.typ,
        })),
      });
    })
    // Eine Seite Antworten, neueste zuerst (uuidv7 ist nach Zeit geordnet); nach ist die ID der letzten Antwort der Vorseite
    .get(
      "/:id/antworten",
      eingabe("param", pfad),
      eingabe("query", listeSchema),
      async (c) => {
        const person = c.get("person");
        const z = await lade(
          person,
          c.req.valid("param").id,
          "formular.antworten_sehen",
        );
        const { limit, nach } = c.req.valid("query");
        const zeilen = await db
          .select({
            id: formularAntwort.id,
            erstelltAm: formularAntwort.erstelltAm,
            versionId: formularAntwort.versionId,
            antworten: formularAntwort.antworten,
            userId: formularAntwort.userId,
            name: user.name,
            ceviName: user.ceviName,
          })
          .from(formularAntwort)
          .leftJoin(user, eq(user.id, formularAntwort.userId))
          .where(
            and(
              antwortenVon(person.abteilungId, z.formularId),
              nach ? lt(formularAntwort.id, nach) : undefined,
            ),
          )
          .orderBy(desc(formularAntwort.id))
          .limit(limit + 1);
        const weitere = zeilen.length > limit;
        const seite = zeilen.slice(0, limit);
        const versionen = await ladeVersionen(db, z.formularId, [
          ...new Set(seite.map((s) => s.versionId)),
        ]);
        return c.json({
          antworten: seite.map((s) => {
            const felder = versionen.get(s.versionId)?.daten.felder ?? [];
            const werte = s.antworten as Antworten;
            return {
              id: s.id,
              erstelltAm: s.erstelltAm,
              // Anonym, wenn die Person nicht angemeldet war oder ihr Konto inzwischen gelöscht ist
              person: s.userId ? rufname(s.name, s.ceviName) : null,
              eintraege: felder
                .filter((f) => werte[f.id] !== undefined)
                .map((f) => ({
                  feldId: f.id,
                  beschriftung: f.beschriftung,
                  typ: f.typ,
                  wert: antwortText(f, werte[f.id]),
                })),
            };
          }),
          weitere,
          naechste: weitere ? seite[seite.length - 1]!.id : null,
        });
      },
    )
    // CSV für Excel in der Schweiz (UTF-8 mit BOM, Semikolon). Die Spalten sind die Felder der letzten Version zuerst, dann Felder älterer Versionen, die es nicht mehr gibt. Jede Zelle, die mit = + - @ beginnt, ist entschärft (termine/csv.ts)
    .get("/:id/antworten.csv", eingabe("param", pfad), async (c) => {
      const person = c.get("person");
      const z = await lade(
        person,
        c.req.valid("param").id,
        "formular.antworten_exportieren",
      );
      if (!exportErlaubt(person.id)) throw new HTTPException(429);
      const versionRows = await db
        .selectDistinct({ versionId: formularAntwort.versionId })
        .from(formularAntwort)
        .where(antwortenVon(person.abteilungId, z.formularId));
      const versionen = await ladeVersionen(
        db,
        z.formularId,
        versionRows.map((v) => v.versionId),
      );
      // Spalten: neueste Version zuerst. Die Reihenfolge der Versionen nach ID der Antwort ist hier nicht bekannt; die aktuelle Definition geht voran, dann die übrigen in der Reihenfolge ihres ersten Auftretens
      const aktuell = await aktuelleDefinition(person.abteilungId, z);
      const spalten = new Map<string, Feld>();
      for (const b of [
        ...(aktuell ? [aktuell] : []),
        ...versionen.values(),
      ]) {
        for (const f of b.daten.felder) if (!spalten.has(f.id)) spalten.set(f.id, f);
      }
      const felder = [...spalten.values()];
      await db.insert(auditLog).values({
        abteilungId: person.abteilungId,
        akteurId: person.id,
        aktion: "formular_export",
        zielTyp: "formular",
        zielId: z.formularId,
        details: { anzahl: z.anzahl },
      });
      const zeit = new Intl.DateTimeFormat("de-CH", {
        timeZone: "Europe/Zurich",
        dateStyle: "short",
        timeStyle: "short",
      });
      const text = new TextEncoder();
      let kopfGesendet = false;
      let nachId: string | undefined;
      const datei = new ReadableStream<Uint8Array>({
        // pull läuft erst, wenn der Client Daten abnimmt: Ein abgebrochener Download fragt keinen weiteren Block ab
        async pull(controller) {
          try {
            if (!kopfGesendet) {
              kopfGesendet = true;
              controller.enqueue(
                text.encode(
                  BOM +
                    csvZeile([
                      "Eingang",
                      "Person",
                      ...felder.map((f) => f.beschriftung),
                    ]),
                ),
              );
              return;
            }
            const block = await db
              .select({
                id: formularAntwort.id,
                erstelltAm: formularAntwort.erstelltAm,
                antworten: formularAntwort.antworten,
                userId: formularAntwort.userId,
                name: user.name,
                ceviName: user.ceviName,
              })
              .from(formularAntwort)
              .leftJoin(user, eq(user.id, formularAntwort.userId))
              .where(
                and(
                  antwortenVon(person.abteilungId, z.formularId),
                  nachId ? lt(formularAntwort.id, nachId) : undefined,
                ),
              )
              .orderBy(desc(formularAntwort.id))
              .limit(BLOCK);
            if (block.length > 0) {
              controller.enqueue(
                text.encode(
                  block
                    .map((s) => {
                      const werte = s.antworten as Antworten;
                      return csvZeile([
                        zeit.format(s.erstelltAm),
                        s.userId ? rufname(s.name, s.ceviName) : "",
                        ...felder.map((f) => antwortText(f, werte[f.id])),
                      ]);
                    })
                    .join(""),
                ),
              );
            }
            if (block.length < BLOCK) controller.close();
            else nachId = block[block.length - 1]!.id;
          } catch (fehler) {
            // Nur der Typ, nie Inhalt
            console.error(
              "formular_export abgebrochen",
              fehler instanceof Error ? fehler.name : typeof fehler,
            );
            controller.error(fehler);
          }
        },
      });
      return new Response(datei, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="formular-${z.formularId}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    })
    // Eine Antwort löschen (endgültig)
    .delete(
      "/:id/antworten/:antwortId",
      eingabe("param", pfadAntwort),
      async (c) => {
        const person = c.get("person");
        const { id, antwortId } = c.req.valid("param");
        const z = await lade(person, id, "formular.antworten_loeschen");
        const weg = await db
          .delete(formularAntwort)
          .where(
            and(
              antwortenVon(person.abteilungId, z.formularId),
              eq(formularAntwort.id, antwortId),
            ),
          )
          .returning({ id: formularAntwort.id });
        if (weg.length === 0) throw new HTTPException(404);
        await db.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "formular_antwort_geloescht",
          zielTyp: "formular",
          zielId: z.formularId,
          details: { anzahl: 1 },
        });
        meldeAenderung(c, { text: "Eine Antwort gelöscht" });
        return c.body(null, 204);
      },
    )
    // Alle Antworten eines Formulars löschen (endgültig); das Formular selbst bleibt auf der Seite
    .delete("/:id/antworten", eingabe("param", pfad), async (c) => {
      const person = c.get("person");
      const z = await lade(
        person,
        c.req.valid("param").id,
        "formular.antworten_loeschen",
      );
      const weg = await db
        .delete(formularAntwort)
        .where(antwortenVon(person.abteilungId, z.formularId))
        .returning({ id: formularAntwort.id });
      await db.insert(auditLog).values({
        abteilungId: person.abteilungId,
        akteurId: person.id,
        aktion: "formular_antworten_geloescht",
        zielTyp: "formular",
        zielId: z.formularId,
        details: { anzahl: weg.length },
      });
      meldeAenderung(c, { text: `${weg.length} Antworten gelöscht` });
      return c.json({ geloescht: weg.length });
    });
}


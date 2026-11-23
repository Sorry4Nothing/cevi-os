import { and, desc, eq, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  auditLog,
  ladenArtikel,
  ladenBestellung,
  ladenEinstellung,
  user,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  artikelAendernSchema,
  artikelAnlegenSchema,
  artikelAnsicht,
  darfLadenVerwalten,
  einstellungSchema,
  istLadenBild,
  ladeArtikel,
  ladeUebergabearten,
  listeSchema,
  MAX_ARTIKEL,
  pruefeGroesse,
  STATUS,
  WECHSEL,
} from "../../laden/laden.js";
import type { Person } from "../../rechte.js";
import { meldeWebsiteEreignis } from "../../website/ereignisse.js";
import { bestellungAnsicht, ladePositionen } from "./bestellungen.js";
import type { LadenEnv } from "./index.js";

// Lädeli verwalten (#566): Artikel pflegen, Bestellungen sehen und ihren Stand setzen, Übergabearten einstellen. Nur die Abteilungsleitung (laden/laden.ts: darfLadenVerwalten); die Pfade tragen /api/v1/admin und erben den zweiten Faktor.
// Objekte einer anderen Abteilung sind 404; erst das Objekt laden, dann das Recht (403). Nach jeder Änderung an Artikeln erzeugt der Abgleich die Seiten mit dem Laden neu.
const pfad = z.strictObject({ id: z.uuid() });
const bestellListeSchema = listeSchema.extend({
  status: z.enum(STATUS).optional(),
});
const statusSchema = z.strictObject({ status: z.enum(STATUS) });

const MEDIUM_UNGEEIGNET = {
  code: "MEDIUM_UNGEEIGNET",
  message:
    "Das Bild muss ein öffentliches Bild aus der Medienbibliothek der Abteilung sein.",
} as const;
const ARTIKEL_LIMIT = {
  code: "ARTIKEL_LIMIT",
  message: `Das Lädeli fasst höchstens ${MAX_ARTIKEL} Artikel.`,
} as const;
const STATUS_UNGUELTIG = {
  code: "STATUS_UNGUELTIG",
  message: "Diese Bestellung lässt sich in diesem Stand nicht so ändern.",
} as const;

function pruefeRecht(person: Pick<Person, "admin">) {
  if (!darfLadenVerwalten(person)) throw new HTTPException(403);
}

const ladeEinenArtikel = async (db: Db, abteilungId: string, id: string) =>
  (
    await db
      .select({ id: ladenArtikel.id })
      .from(ladenArtikel)
      .where(
        and(eq(ladenArtikel.id, id), eq(ladenArtikel.abteilungId, abteilungId)),
      )
  )[0];

export function erstelleAdminLadenRouten({ db }: { db: Db }) {
  const geaendert = (abteilungId: string) =>
    meldeWebsiteEreignis({ art: "laden_geaendert", abteilungId });

  return (
    new Hono<LadenEnv>()
      // Alle Artikel, auch die nicht verfügbaren. Eine Abfrage
      .get("/admin/laden/artikel", async (c) => {
        const person = c.get("person");
        pruefeRecht(person);
        return c.json({
          artikel: (await ladeArtikel(db, person.abteilungId)).map(
            artikelAnsicht,
          ),
        });
      })
      .post(
        "/admin/laden/artikel",
        eingabe("json", artikelAnlegenSchema),
        async (c) => {
          const person = c.get("person");
          // Ohne Objekt im Pfad: erst das Recht
          pruefeRecht(person);
          const { groessenart, ...b } = c.req.valid("json");
          const groesse = pruefeGroesse({ groessenart, ...b }, true);
          if ("fehler" in groesse) return c.json(groesse.fehler, 422);
          if (
            b.mediumId &&
            !(await istLadenBild(db, person.abteilungId, b.mediumId))
          ) {
            return c.json(MEDIUM_UNGEEIGNET, 400);
          }
          const id = await db.transaction(async (tx) => {
            // Je Abteilung nacheinander, damit zwei Anfragen die Obergrenze nicht überspringen
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${"laden-artikel " + person.abteilungId}, 0))`,
            );
            const [{ n }] = await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(ladenArtikel)
              .where(eq(ladenArtikel.abteilungId, person.abteilungId));
            if (n >= MAX_ARTIKEL) return null;
            const [zeile] = await tx
              .insert(ladenArtikel)
              .values({
                abteilungId: person.abteilungId,
                name: b.name,
                preisRappen: b.preisRappen,
                mediumId: b.mediumId ?? null,
                varianten: groesse.varianten ?? [],
                hinweis: b.hinweis ?? null,
                verfuegbar: b.verfuegbar ?? true,
                // Ohne Angabe ans Ende
                reihenfolge: b.reihenfolge ?? Math.min(n * 10, 9999),
              })
              .returning({ id: ladenArtikel.id });
            // Nur Kennungen, nie Namen
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "laden_artikel_angelegt",
              zielTyp: "laden_artikel",
              zielId: zeile!.id,
              details: {},
            });
            return zeile!.id;
          });
          if (id === null) return c.json(ARTIKEL_LIMIT, 409);
          geaendert(person.abteilungId);
          return c.json({ id }, 201);
        },
      )
      .patch(
        "/admin/laden/artikel/:id",
        eingabe("param", pfad),
        eingabe("json", artikelAendernSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const { groessenart, ...b } = c.req.valid("json");
          // Erst das Objekt (404), dann das Recht (403), dann die Eingabe gegen die Datenbank
          if (!(await ladeEinenArtikel(db, person.abteilungId, id))) {
            throw new HTTPException(404);
          }
          pruefeRecht(person);
          const groesse = pruefeGroesse({ groessenart, ...b }, false);
          if ("fehler" in groesse) return c.json(groesse.fehler, 422);
          if (groesse.varianten) b.varianten = groesse.varianten;
          if (
            b.mediumId &&
            !(await istLadenBild(db, person.abteilungId, b.mediumId))
          ) {
            return c.json(MEDIUM_UNGEEIGNET, 400);
          }
          // Ohne Schlüssel wirft Drizzle bei set({}): kein Schreibzugriff
          const felder = Object.keys(b).filter(
            (k) => b[k as keyof typeof b] !== undefined,
          );
          if (felder.length === 0) return c.body(null, 204);
          await db.transaction(async (tx) => {
            await tx.update(ladenArtikel).set(b).where(eq(ladenArtikel.id, id));
            // Welche Angaben, nie die Werte
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "laden_artikel_geaendert",
              zielTyp: "laden_artikel",
              zielId: id,
              details: { felder },
            });
          });
          geaendert(person.abteilungId);
          return c.body(null, 204);
        },
      )
      // Löschen ist endgültig. Positionen bestehender Bestellungen bleiben mit Name und Preis stehen (der Verweis auf den Artikel wird leer)
      .delete("/admin/laden/artikel/:id", eingabe("param", pfad), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        if (!(await ladeEinenArtikel(db, person.abteilungId, id))) {
          throw new HTTPException(404);
        }
        pruefeRecht(person);
        await db.transaction(async (tx) => {
          const [weg] = await tx
            .delete(ladenArtikel)
            .where(eq(ladenArtikel.id, id))
            .returning({ id: ladenArtikel.id });
          // Zwei Löschungen zugleich: Die zweite findet nichts mehr und schreibt kein Audit
          if (!weg) return;
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "laden_artikel_geloescht",
            zielTyp: "laden_artikel",
            zielId: id,
            details: {},
          });
        });
        geaendert(person.abteilungId);
        return c.body(null, 204);
      })
      // Bestellungen der Abteilung, neueste zuerst, wahlweise nur ein Stand; nach ist die ID des letzten Eintrags der Vorseite. Zwei Abfragen je Seite (Bestellungen mit Konto im Join, dann alle ihre Positionen)
      .get(
        "/admin/laden/bestellungen",
        eingabe("query", bestellListeSchema),
        async (c) => {
          const person = c.get("person");
          pruefeRecht(person);
          const { limit, nach, status } = c.req.valid("query");
          const zeilen = await db
            .select({
              b: ladenBestellung,
              name: user.name,
              ceviName: user.ceviName,
            })
            .from(ladenBestellung)
            .innerJoin(user, eq(user.id, ladenBestellung.userId))
            .where(
              and(
                eq(ladenBestellung.abteilungId, person.abteilungId),
                status ? eq(ladenBestellung.status, status) : undefined,
                nach ? lt(ladenBestellung.id, nach) : undefined,
              ),
            )
            .orderBy(desc(ladenBestellung.id))
            .limit(limit + 1);
          const weitere = zeilen.length > limit;
          const seite = zeilen.slice(0, limit);
          const positionen = await ladePositionen(
            db,
            seite.map((z) => z.b.id),
          );
          return c.json({
            bestellungen: seite.map((z) => ({
              ...bestellungAnsicht(z.b, positionen),
              person: { id: z.b.userId, name: z.name, ceviName: z.ceviName },
            })),
            weitere,
            naechste: weitere ? seite[seite.length - 1]!.b.id : null,
          });
        },
      )
      // Stand setzen: offen und bereit lassen sich wechseln, übergeben und storniert sind endgültig (laden/laden.ts: WECHSEL). Bedingtes UPDATE auf den gelesenen Stand: Ändert ihn gleichzeitig jemand anders, ist es 409
      .post(
        "/admin/laden/bestellungen/:id/status",
        eingabe("param", pfad),
        eingabe("json", statusSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const { status } = c.req.valid("json");
          const [ziel] = await db
            .select({ status: ladenBestellung.status })
            .from(ladenBestellung)
            .where(
              and(
                eq(ladenBestellung.id, id),
                eq(ladenBestellung.abteilungId, person.abteilungId),
              ),
            );
          if (!ziel) throw new HTTPException(404);
          pruefeRecht(person);
          if (ziel.status === status) return c.json({ id, status });
          if (!WECHSEL[ziel.status].includes(status)) {
            return c.json(STATUS_UNGUELTIG, 409);
          }
          const fertig = status === "uebergeben" || status === "storniert";
          const ok = await db.transaction(async (tx) => {
            const [zeile] = await tx
              .update(ladenBestellung)
              .set({
                status,
                geaendertAm: new Date(),
                abgeschlossenAm: fertig ? new Date() : null,
              })
              .where(
                and(
                  eq(ladenBestellung.id, id),
                  eq(ladenBestellung.status, ziel.status),
                ),
              )
              .returning({ id: ladenBestellung.id });
            if (!zeile) return false;
            // Nur die Kennung und der neue Stand
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "laden_status_geaendert",
              zielTyp: "laden_bestellung",
              zielId: id,
              details: { status },
            });
            return true;
          });
          if (!ok) return c.json(STATUS_UNGUELTIG, 409);
          return c.json({ id, status });
        },
      )
      .get("/admin/laden/einstellungen", async (c) => {
        const person = c.get("person");
        pruefeRecht(person);
        return c.json({
          uebergabearten: await ladeUebergabearten(db, person.abteilungId),
        });
      })
      // Die Übergabearten ersetzen. Bestehende Bestellungen behalten ihren Text
      .put(
        "/admin/laden/einstellungen",
        eingabe("json", einstellungSchema),
        async (c) => {
          const person = c.get("person");
          pruefeRecht(person);
          const { uebergabearten } = c.req.valid("json");
          await db.transaction(async (tx) => {
            await tx
              .insert(ladenEinstellung)
              .values({ abteilungId: person.abteilungId, uebergabearten })
              .onConflictDoUpdate({
                target: ladenEinstellung.abteilungId,
                set: { uebergabearten },
              });
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "laden_einstellung_geaendert",
              zielTyp: "abteilung",
              zielId: person.abteilungId,
              details: { uebergabearten: uebergabearten.length },
            });
          });
          // Die Übergabearten stehen im Laden der Website
          geaendert(person.abteilungId);
          return c.body(null, 204);
        },
      )
  );
}

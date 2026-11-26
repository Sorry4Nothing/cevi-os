import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  auditLog,
  ladenArtikel,
  ladenBestellposition,
  ladenBestellung,
  user,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { idempotenzSchluessel } from "../../idempotenz.js";
import {
  artikelAnsicht,
  artikelVerfuegbar,
  bestellenSchema,
  ladeArtikel,
  ladeEinstellung,
  listeSchema,
  mindestText,
  oeffentlicheEinstellung,
  EINSTELLUNG_VORGABE,
} from "../../laden/laden.js";
import type { LadenEnv } from "./index.js";

// Rate-Limit je Konto (SR-71): so viele Bestellversuche in diesem Fenster
const VERSUCHE = 10;
const FENSTER_MS = 10 * 60_000;

// Lädeli für angemeldete Personen (#566): Laden lesen, bestellen, eigene Bestellungen ansehen und stornieren. Jede Person der Abteilung darf bestellen (Annahme, vom Nutzer zu bestätigen).
// Eine Bestellung nennt nur Artikel, Variante und Menge; Name, Preis und Summe liest der Server in derselben Transaktion aus den Artikeln der eigenen Abteilung. Fremde Artikel und fremde Bestellungen sind unbekannt (404 oder «nicht verfügbar»).
const pfad = z.strictObject({ id: z.uuid() });

// Die Grenzen und Texte stellt die Abteilung ein (laden/laden.ts: LadenEinstellung); die Meldungen nennen die gültige Zahl
const bestellLimit = (n: number) =>
  ({
    code: "BESTELL_LIMIT",
    message: `Du hast schon ${n} offene Bestellungen. Warte, bis eine übergeben ist, oder storniere eine.`,
  }) as const;
const ladenGeschlossen = (text: string) =>
  ({ code: "LADEN_GESCHLOSSEN", message: text }) as const;
const mindestbestellung = (rappen: number) =>
  ({
    code: "MINDESTBESTELLUNG",
    message: mindestText(rappen),
    mindestRappen: rappen,
  }) as const;
const zuViele = (n: number) =>
  ({
    code: "POSITIONEN_ZU_VIELE",
    message: `Eine Bestellung hat höchstens ${n} verschiedene Artikel.`,
  }) as const;
const mengeZuGross = (n: number) =>
  ({
    code: "MENGE_ZU_GROSS",
    message: `Von einem Artikel lassen sich höchstens ${n} Stück bestellen.`,
  }) as const;
const ARTIKEL_NICHT_VERFUEGBAR = {
  code: "ARTIKEL_NICHT_VERFUEGBAR",
  message: "Mindestens ein Artikel ist nicht mehr verfügbar.",
} as const;
const VARIANTE_UNGUELTIG = {
  code: "VARIANTE_UNGUELTIG",
  message: "Mindestens eine Variante gibt es bei diesem Artikel nicht.",
} as const;
// 422 mit Feld und den betroffenen Positionen; die Meldung nennt Artikel und Grösse (laden/laden.ts: nichtVerfuegbar)
const groesseNichtVerfuegbar = (
  weg: { artikelId: string; name: string; variante: string }[],
) => ({
  code: "GROESSE_NICHT_VERFUEGBAR",
  feld: "positionen",
  message:
    weg.length === 1
      ? `Die Grösse ${weg[0]!.variante} von «${weg[0]!.name}» ist nicht mehr verfügbar. Wähle eine andere Grösse.`
      : `Diese Grössen sind nicht mehr verfügbar: ${weg.map((w) => `${w.name} in ${w.variante}`).join(", ")}. Wähle andere Grössen.`,
  positionen: weg.map(({ artikelId, variante }) => ({ artikelId, variante })),
});
const UEBERGABE_UNBEKANNT = {
  code: "UEBERGABE_UNBEKANNT",
  message: "Diese Übergabe gibt es nicht mehr. Wähle eine andere.",
} as const;
const PREIS_GEAENDERT = {
  code: "PREIS_GEAENDERT",
  message: "Ein Preis hat sich geändert. Prüfe die Summe und sende nochmals.",
} as const;
const STATUS_UNGUELTIG = {
  code: "STATUS_UNGUELTIG",
  message:
    "Diese Bestellung lässt sich nicht mehr stornieren. Melde dich bei der Abteilung.",
} as const;

type Bestellung = typeof ladenBestellung.$inferSelect;
type Position = typeof ladenBestellposition.$inferSelect;
export const bestellungAnsicht = (b: Bestellung, positionen: Position[]) => ({
  id: b.id,
  status: b.status,
  uebergabe: b.uebergabe,
  summeRappen: b.summeRappen,
  erstelltAm: b.erstelltAm,
  geaendertAm: b.geaendertAm,
  positionen: positionen
    .filter((p) => p.bestellungId === b.id)
    .map((p) => ({
      artikelId: p.artikelId,
      name: p.name,
      variante: p.variante,
      menge: p.menge,
      einzelpreisRappen: p.einzelpreisRappen,
    })),
});

// Die Positionen mehrerer Bestellungen in einer Abfrage
export const ladePositionen = (db: Pick<Db, "select">, ids: string[]) =>
  ids.length === 0
    ? Promise.resolve([] as Position[])
    : db
        .select()
        .from(ladenBestellposition)
        .where(inArray(ladenBestellposition.bestellungId, ids))
        .orderBy(ladenBestellposition.id);

export function erstelleBestellRouten({ db }: { db: Db }) {
  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const versuche = new Map<string, number[]>();
  const zuOft = (id: string) => {
    const jetzt = Date.now();
    const liste = (versuche.get(id) ?? []).filter(
      (t) => jetzt - t < FENSTER_MS,
    );
    const voll = liste.length >= VERSUCHE;
    if (!voll) liste.push(jetzt);
    versuche.set(id, liste);
    return voll;
  };

  return (
    new Hono<LadenEnv>()
      // Der Laden für Apps und Website: alle Artikel der Abteilung (auch nicht verfügbare, mit Kennzeichen), die Übergabearten, die Grenzen und wie die Person angemeldet ist (nur der eigene Name, für die Zeile «Angemeldet als …»). Drei Abfragen
      .get("/laden", async (c) => {
        const person = c.get("person");
        const [artikel, einstellung, [ich]] = await Promise.all([
          ladeArtikel(db, person.abteilungId),
          ladeEinstellung(db, person.abteilungId),
          db
            .select({ name: user.name, ceviName: user.ceviName })
            .from(user)
            .where(eq(user.id, person.id)),
        ]);
        // Cevi-Name, sonst der Vorname; ohne beides nichts (die Anzeige sagt dann nur «Angemeldet»)
        const angemeldetAls =
          ich?.ceviName?.trim() || ich?.name?.trim().split(/\s+/)[0] || null;
        return c.json({
          angemeldetAls,
          artikel: artikel.map(artikelAnsicht),
          uebergabearten: einstellung.uebergabearten,
          grenzen: {
            positionen: einstellung.maxPositionen,
            menge: einstellung.maxMenge,
            offeneBestellungen: einstellung.maxOffene,
          },
          // Regeln und Texte der Abteilung (#642); die Website zeigt dasselbe schon im Markup, hier steht der frische Stand
          einstellungen: oeffentlicheEinstellung(einstellung),
        });
      })
      // Die eigenen Bestellungen in jedem Stand, neueste zuerst (uuidv7 ist nach Zeit geordnet); nach ist die ID des letzten Eintrags der Vorseite. Zwei Abfragen je Seite (Bestellungen, dann alle ihre Positionen)
      .get(
        "/laden/bestellungen/meine",
        eingabe("query", listeSchema),
        async (c) => {
          const person = c.get("person");
          const { limit, nach } = c.req.valid("query");
          const zeilen = await db
            .select()
            .from(ladenBestellung)
            .where(
              and(
                eq(ladenBestellung.userId, person.id),
                eq(ladenBestellung.abteilungId, person.abteilungId),
                nach ? lt(ladenBestellung.id, nach) : undefined,
              ),
            )
            .orderBy(desc(ladenBestellung.id))
            .limit(limit + 1);
          const weitere = zeilen.length > limit;
          const seite = zeilen.slice(0, limit);
          const positionen = await ladePositionen(
            db,
            seite.map((b) => b.id),
          );
          return c.json({
            bestellungen: seite.map((b) => bestellungAnsicht(b, positionen)),
            weitere,
            naechste: weitere ? seite[seite.length - 1]!.id : null,
          });
        },
      )
      // Bestellen. Je Person eine Sperre, damit gleichzeitige Bestellungen die Obergrenze nicht überspringen; die Artikel sind gesperrt (FOR SHARE), damit Preis und Verfügbarkeit bis zum Schreiben gelten. Abfragen: Sperre, Zählen, Artikel, Übergabearten, Bestellung, Positionen, Audit
      .post(
        "/laden/bestellungen",
        idempotenzSchluessel(db),
        eingabe("json", bestellenSchema),
        async (c) => {
          const person = c.get("person");
          const b = c.req.valid("json");
          // Derselbe Artikel in derselben Variante steht nur einmal im Korb
          const schluessel = b.positionen.map(
            (p) => `${p.artikelId} ${p.variante ?? ""}`,
          );
          if (new Set(schluessel).size !== schluessel.length) {
            throw new HTTPException(400);
          }
          if (zuOft(person.id)) throw new HTTPException(429);
          const ergebnis = await db.transaction(async (tx) => {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${"laden " + person.id}, 0))`,
            );
            const einstellung = await ladeEinstellung(tx, person.abteilungId);
            if (!einstellung.bestellenOffen) {
              return {
                geschlossen: einstellung.geschlossenText || undefined,
              };
            }
            if (b.positionen.length > einstellung.maxPositionen) {
              return { positionenMax: einstellung.maxPositionen };
            }
            if (b.positionen.some((p) => p.menge > einstellung.maxMenge)) {
              return { mengeMax: einstellung.maxMenge };
            }
            const [{ offen }] = await tx
              .select({ offen: sql<number>`count(*)::int` })
              .from(ladenBestellung)
              .where(
                and(
                  eq(ladenBestellung.userId, person.id),
                  sql`${ladenBestellung.status} in ('offen', 'bereit')`,
                ),
              );
            if (offen >= einstellung.maxOffene) {
              return { limit: einstellung.maxOffene };
            }
            const ids = [...new Set(b.positionen.map((p) => p.artikelId))];
            const artikel = new Map(
              (
                await tx
                  .select()
                  .from(ladenArtikel)
                  .where(
                    and(
                      eq(ladenArtikel.abteilungId, person.abteilungId),
                      inArray(ladenArtikel.id, ids),
                    ),
                  )
                  .for("share")
              ).map((a) => [a.id, a]),
            );
            const fehlen = ids.filter((id) => {
              const a = artikel.get(id);
              return !a || !artikelVerfuegbar(a);
            });
            if (fehlen.length > 0) return { fehlen };
            for (const p of b.positionen) {
              const a = artikel.get(p.artikelId)!;
              const variante = p.variante ?? null;
              // Ein Artikel mit Varianten braucht eine aus seiner Liste, einer ohne darf keine nennen
              if (
                a.varianten.length === 0
                  ? variante !== null
                  : variante === null || !a.varianten.includes(variante)
              ) {
                return "variante" as const;
              }
            }
            // Eine Grösse, die nicht zu haben ist, lehnt die ganze Bestellung ab: Nichts wird teilweise angelegt
            const weg = b.positionen.flatMap((p) => {
              const a = artikel.get(p.artikelId)!;
              return p.variante && a.nichtVerfuegbar.includes(p.variante)
                ? [
                    {
                      artikelId: a.id,
                      name: a.name,
                      variante: p.variante,
                    },
                  ]
                : [];
            });
            if (weg.length > 0) return { weg };
            if (!einstellung.uebergabearten.includes(b.uebergabe)) {
              return "uebergabe" as const;
            }
            const summeRappen = b.positionen.reduce(
              (s, p) => s + p.menge * artikel.get(p.artikelId)!.preisRappen,
              0,
            );
            if (
              b.erwarteteSummeRappen !== undefined &&
              b.erwarteteSummeRappen !== summeRappen
            ) {
              return { summeRappen };
            }
            if (summeRappen < einstellung.mindestRappen) {
              return { mindest: einstellung.mindestRappen };
            }
            const [zeile] = await tx
              .insert(ladenBestellung)
              .values({
                abteilungId: person.abteilungId,
                userId: person.id,
                uebergabe: b.uebergabe,
                summeRappen,
              })
              .returning();
            const positionen = await tx
              .insert(ladenBestellposition)
              .values(
                b.positionen.map((p) => ({
                  bestellungId: zeile!.id,
                  artikelId: p.artikelId,
                  name: artikel.get(p.artikelId)!.name,
                  variante: p.variante ?? null,
                  menge: p.menge,
                  einzelpreisRappen: artikel.get(p.artikelId)!.preisRappen,
                })),
              )
              .returning();
            // Nur Kennung und Anzahl, nie was bestellt wurde
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "laden_bestellt",
              zielTyp: "laden_bestellung",
              zielId: zeile!.id,
              details: { positionen: positionen.length },
            });
            return { bestellung: bestellungAnsicht(zeile!, positionen) };
          });
          if (ergebnis === "variante") return c.json(VARIANTE_UNGUELTIG, 400);
          if (ergebnis === "uebergabe") return c.json(UEBERGABE_UNBEKANNT, 400);
          if ("geschlossen" in ergebnis) {
            return c.json(
              ladenGeschlossen(
                ergebnis.geschlossen ?? EINSTELLUNG_VORGABE.geschlossenText,
              ),
              409,
            );
          }
          if ("positionenMax" in ergebnis) {
            return c.json(zuViele(ergebnis.positionenMax!), 400);
          }
          if ("mengeMax" in ergebnis) {
            return c.json(mengeZuGross(ergebnis.mengeMax!), 400);
          }
          if ("mindest" in ergebnis) {
            return c.json(mindestbestellung(ergebnis.mindest!), 409);
          }
          if ("limit" in ergebnis) {
            return c.json(bestellLimit(ergebnis.limit!), 409);
          }
          if ("weg" in ergebnis) {
            return c.json(groesseNichtVerfuegbar(ergebnis.weg!), 422);
          }
          if ("fehlen" in ergebnis) {
            return c.json(
              { ...ARTIKEL_NICHT_VERFUEGBAR, artikelIds: ergebnis.fehlen },
              409,
            );
          }
          if ("summeRappen" in ergebnis) {
            return c.json(
              { ...PREIS_GEAENDERT, summeRappen: ergebnis.summeRappen },
              409,
            );
          }
          return c.json(ergebnis.bestellung, 201);
        },
      )
      // Stornieren: nur die eigene Bestellung und nur, solange sie offen ist. Die Zeile bleibt (Status «storniert») bis zur Löschfrist; ein zweites Mal ist 204. Fremde Bestellungen sind 404, auch für die Abteilungsleitung (sie nutzt die Verwaltung)
      .delete("/laden/bestellungen/:id", eingabe("param", pfad), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const [zeile] = await db
          .select({ status: ladenBestellung.status })
          .from(ladenBestellung)
          .where(
            and(
              eq(ladenBestellung.id, id),
              eq(ladenBestellung.userId, person.id),
              eq(ladenBestellung.abteilungId, person.abteilungId),
            ),
          );
        if (!zeile) throw new HTTPException(404);
        if (zeile.status === "storniert") return c.body(null, 204);
        const geaendert = await db.transaction(async (tx) => {
          // Bedingt: Stellt die Abteilung sie gerade bereit, trifft das UPDATE nichts
          const [weg] = await tx
            .update(ladenBestellung)
            .set({
              status: "storniert",
              geaendertAm: new Date(),
              abgeschlossenAm: new Date(),
            })
            .where(
              and(
                eq(ladenBestellung.id, id),
                eq(ladenBestellung.status, "offen"),
              ),
            )
            .returning({ id: ladenBestellung.id });
          if (!weg) return false;
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "laden_storniert",
            zielTyp: "laden_bestellung",
            zielId: id,
          });
          return true;
        });
        if (!geaendert) return c.json(STATUS_UNGUELTIG, 409);
        return c.body(null, 204);
      })
  );
}

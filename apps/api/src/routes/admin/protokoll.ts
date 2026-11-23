import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { AKTIVITAET_TITEL } from "../../aktivitaet-titel.js";
import type { Db } from "../../db/client.js";
import { aktivitaet, auditLog } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { verlangeEntwickler } from "../../plattform.js";
import type { Person } from "../../rechte.js";

// Aktivitätsprotokoll (#637): Was in Cevi OS geschrieben oder geändert wird, mit Benutzerstempel. Nur der Entwickler liest es (Zeile in plattform_entwickler, mit zweitem Faktor); auch die Abteilungsleitung bekommt 403, wenn sie nicht zugleich Entwickler ist. Das ist die einzige Erweiterung des Rechte-Modells: «Entwickler darf das Protokoll lesen». Der Server prüft, die Oberfläche blendet die Seite nur aus.
// Jede Antwort ist auf die Abteilung der Sitzung begrenzt; Zeilen ohne Abteilung (Anmeldeversuche ohne Konto, Systemereignisse) sieht jeder Entwickler dieser Plattform. Es gibt keine Route, die schreibt oder löscht; die Frist räumt die Datenbank auf (aktivitaet_aufraeumen).
// Abfragen je Aufruf: Liste und Detail eine, Verlauf drei (Summe und Säulen, Bereiche), Export eine plus eine Audit-Zeile.

const MAX_LIMIT = 100;
const EXPORT_MAX = 5000;
const UUID = z.uuid();
const TAG = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const filterFelder = {
  // Tage nach Schweizer Zeit; bis ist inklusiv
  von: TAG.optional(),
  bis: TAG.optional(),
  // Eine Kennung (UUID) oder ein Teil des Namens zum Zeitpunkt
  benutzer: z.string().trim().min(1).max(100).optional(),
  bereich: z.string().trim().min(1).max(60).optional(),
  art: z.enum(["aktion", "anmeldung", "audit", "zugriff", "system"]).optional(),
  ergebnis: z.enum(["erfolg", "fehler"]).optional(),
  objekt: UUID.optional(),
  // Alle Zeilen einer Anfrage (die Kennung steht in jeder Zeile und im Log der API)
  anfrage: z
    .string()
    .regex(/^[0-9A-Za-z-]{1,64}$/)
    .optional(),
  // Freitext über Aktion, Bereich und Fehlercode
  q: z.string().trim().min(1).max(100).optional(),
};
const listeSchema = z.strictObject({
  ...filterFelder,
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50),
  nach: z.string().max(200).optional(),
});
const verlaufSchema = z.strictObject({
  ...filterFelder,
  einheit: z.enum(["stunde", "tag"]).default("tag"),
});
const exportSchema = z.strictObject(filterFelder);
const pfadSchema = z.strictObject({ id: UUID });

type Filter = z.infer<typeof exportSchema>;

// LIKE-Zeichen in der Eingabe sind Text
const maskiere = (text: string) => text.replace(/[\\%_]/g, "\\$&");

function bedingungen(person: Pick<Person, "abteilungId">, f: Filter) {
  const b: (SQL | undefined)[] = [
    or(
      eq(aktivitaet.abteilungId, person.abteilungId),
      isNull(aktivitaet.abteilungId),
    ),
  ];
  if (f.von) {
    b.push(
      sql`${aktivitaet.zeit} >= (${f.von}::date)::timestamp at time zone 'Europe/Zurich'`,
    );
  }
  if (f.bis) {
    b.push(
      sql`${aktivitaet.zeit} < ((${f.bis}::date + 1)::timestamp at time zone 'Europe/Zurich')`,
    );
  }
  if (f.benutzer) {
    b.push(
      UUID.safeParse(f.benutzer).success
        ? eq(aktivitaet.userId, f.benutzer)
        : ilike(aktivitaet.name, `%${maskiere(f.benutzer)}%`),
    );
  }
  if (f.bereich) b.push(eq(aktivitaet.bereich, f.bereich));
  if (f.art) b.push(eq(aktivitaet.art, f.art));
  if (f.ergebnis) b.push(eq(aktivitaet.ergebnis, f.ergebnis));
  if (f.objekt) b.push(eq(aktivitaet.objektId, f.objekt));
  if (f.anfrage) b.push(eq(aktivitaet.anfrageId, f.anfrage));
  if (f.q) {
    const muster = `%${maskiere(f.q)}%`;
    b.push(
      or(
        ilike(aktivitaet.aktion, muster),
        ilike(aktivitaet.bereich, muster),
        ilike(aktivitaet.fehlerCode, muster),
      ),
    );
  }
  return and(...b);
}

// Der Klartext: aus dem Katalog der API (aktivitaet-titel.ts), sonst die Methode als Verb
const VERB: Record<string, string> = {
  POST: "Anlegen oder auslösen",
  PUT: "Ersetzen",
  PATCH: "Ändern",
  DELETE: "Löschen",
  GET: "Lesen",
};
export function titelVon(aktion: string, art: string) {
  if (art === "system") return aktion;
  const [methode = "", ...rest] = aktion.split(" ");
  const route = rest.join(" ");
  const schluessel = `${methode} ${route.replace(/:[A-Za-z0-9_]+/g, ":p")}`;
  return (
    AKTIVITAET_TITEL[schluessel] ??
    (art === "audit"
      ? aktion.replace(/_/g, " ")
      : `${VERB[methode] ?? methode}: ${route}`)
  );
}

type Zeile = typeof aktivitaet.$inferSelect;
const ansicht = (z: Zeile) => ({
  id: z.id,
  zeit: z.zeit,
  art: z.art,
  benutzer: {
    id: z.userId,
    // Der Name zum Zeitpunkt; ohne Konto (anonym, Kommandozeile, System) fehlt er
    name: z.name,
    akteur: z.akteur,
    rollen: z.rollen,
  },
  abteilungId: z.abteilungId,
  methode: z.methode,
  aktion: z.aktion,
  titel: titelVon(z.aktion, z.art),
  bereich: z.bereich,
  objekt:
    z.objektTyp || z.objektId ? { typ: z.objektTyp, id: z.objektId } : null,
  felder: z.felder,
  status: z.status,
  ergebnis: z.ergebnis,
  fehlerCode: z.fehlerCode,
  dauerMs: z.dauerMs,
  herkunft: z.herkunft,
  geraet: z.geraet,
  anfrageId: z.anfrageId,
  anzahl: z.anzahl,
});

// Cursor: Zeit und ID der letzten Zeile; die Sortierung (neu zuerst) ist stabil, weil die ID die Zeit bricht
const cursorSchema = z.tuple([z.iso.datetime(), UUID]);
const schreibeCursor = (z: Zeile) =>
  Buffer.from(JSON.stringify([z.zeit.toISOString(), z.id])).toString(
    "base64url",
  );
function liesCursor(nach: string) {
  try {
    const wert = cursorSchema.safeParse(
      JSON.parse(Buffer.from(nach, "base64url").toString("utf8")),
    );
    return wert.success ? wert.data : null;
  } catch {
    return null;
  }
}

// Eine Zelle, die als Formel gelesen würde, bekommt ein Hochkomma davor (SR-25)
const csvZelle = (wert: unknown) => {
  const text = wert === null || wert === undefined ? "" : String(wert);
  const sicher = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",;\n\r]/.test(sicher) ? `"${sicher.replace(/"/g, '""')}"` : sicher;
};

export function erstelleProtokollRouten({ db }: { db: Db }) {
  // Der Entwickler wird nur einmal je Anfrage gefragt; die Middleware prüft ihn samt zweitem Faktor, bevor eine Route läuft
  const nurEntwickler = verlangeEntwickler(db);
  // Dieselbe Prüfung für die Route, die erst ihr Objekt lädt: wirft 403 oder liefert die Antwort ZWEITER_FAKTOR_FEHLT
  const nurEntwicklerPruefung = (
    c: Context<{ Variables: { person: Person } }>,
  ) => nurEntwickler(c, async () => {});
  return (
    new Hono<{ Variables: { person: Person } }>()
      .get("/", nurEntwickler, eingabe("query", listeSchema), async (c) => {
        const person = c.get("person");
        const { limit, nach, ...filter } = c.req.valid("query");
        const cursor = nach === undefined ? undefined : liesCursor(nach);
        if (cursor === null) throw new HTTPException(400);
        const zeilen = await db
          .select()
          .from(aktivitaet)
          .where(
            and(
              bedingungen(person, filter),
              cursor
                ? sql`(${aktivitaet.zeit}, ${aktivitaet.id}) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`
                : undefined,
            ),
          )
          .orderBy(desc(aktivitaet.zeit), desc(aktivitaet.id))
          .limit(limit + 1);
        const seite = zeilen.slice(0, limit);
        return c.json({
          eintraege: seite.map(ansicht),
          weitere: zeilen.length > limit,
          naechste:
            zeilen.length > limit ? schreibeCursor(seite[limit - 1]!) : null,
        });
      })
      // Säulen und Bereiche für die Diagramme: Zahl der Zeilen und der Fehler je Stunde oder Tag nach Schweizer Zeit, lückenlos. Höchstens 7 Tage mit Stunden, 92 Tage mit Tagen
      .get(
        "/verlauf",
        nurEntwickler,
        eingabe("query", verlaufSchema),
        async (c) => {
          const person = c.get("person");
          const { einheit, ...filter } = c.req.valid("query");
          const jetzt = new Date();
          const heute = jetzt.toLocaleDateString("sv-SE", {
            timeZone: "Europe/Zurich",
          });
          const tage = einheit === "stunde" ? 7 : 92;
          const bis = filter.bis ?? heute;
          const von =
            filter.von ??
            new Date(
              Date.parse(`${bis}T12:00:00Z`) -
                (einheit === "stunde" ? 1 : 29) * 86_400_000,
            )
              .toISOString()
              .slice(0, 10);
          if (
            Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`) >=
            tage * 86_400_000
          ) {
            throw new HTTPException(400);
          }
          if (von > bis) throw new HTTPException(400);
          const bedingung = bedingungen(person, { ...filter, von, bis });
          const [punkte, bereiche] = await Promise.all([
            db.execute<{
              start: string;
              gesamt: number;
              fehler: number;
            }>(sql`
            select to_char(g.start, 'YYYY-MM-DD"T"HH24:MI') as start,
                   coalesce(z.gesamt, 0)::int as gesamt, coalesce(z.fehler, 0)::int as fehler
            from generate_series(
              date_trunc(${einheit === "stunde" ? "hour" : "day"}, ${von}::date::timestamp),
              date_trunc(${einheit === "stunde" ? "hour" : "day"}, (${bis}::date + 1)::timestamp - interval '1 second'),
              ${einheit === "stunde" ? "1 hour" : "1 day"}::interval
            ) as g(start)
            left join (
              select date_trunc(${einheit === "stunde" ? "hour" : "day"}, ${aktivitaet.zeit} at time zone 'Europe/Zurich') as start,
                     count(*) as gesamt, count(*) filter (where ${aktivitaet.ergebnis} = 'fehler') as fehler
              from ${aktivitaet} where ${bedingung} group by 1
            ) z on z.start = g.start
            order by g.start`),
            db
              .select({
                bereich: aktivitaet.bereich,
                gesamt: sql<number>`count(*)::int`,
                fehler: sql<number>`(count(*) filter (where ${aktivitaet.ergebnis} = 'fehler'))::int`,
              })
              .from(aktivitaet)
              .where(bedingung)
              .groupBy(aktivitaet.bereich)
              .orderBy(desc(sql`count(*)`), aktivitaet.bereich)
              .limit(30),
          ]);
          const liste = [...punkte];
          const gesamt = liste.reduce((s, p) => s + p.gesamt, 0);
          const fehler = liste.reduce((s, p) => s + p.fehler, 0);
          return c.json({
            einheit,
            von,
            bis,
            punkte: liste,
            bereiche,
            summe: { gesamt, fehler },
          });
        },
      )
      // CSV des gefilterten Ausschnitts, höchstens 5000 Zeilen; ohne Namen und Herkunft (die Kennung der Person genügt, den Namen zeigt die Verwaltung). Der Export steht selbst im Audit-Log
      .get(
        "/export.csv",
        nurEntwickler,
        eingabe("query", exportSchema),
        async (c) => {
          const person = c.get("person");
          const filter = c.req.valid("query");
          const zeilen = await db
            .select()
            .from(aktivitaet)
            .where(bedingungen(person, filter))
            .orderBy(desc(aktivitaet.zeit), desc(aktivitaet.id))
            .limit(EXPORT_MAX);
          // Nur die Zahl, nie der Filter: Er könnte einen Namen enthalten
          await db.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "protokoll_exportiert",
            zielTyp: "protokoll",
            zielId: person.abteilungId,
            details: { zeilen: zeilen.length },
          });
          const kopf = [
            "zeit",
            "art",
            "benutzer_id",
            "rollen",
            "aktion",
            "titel",
            "bereich",
            "objekt_typ",
            "objekt_id",
            "status",
            "ergebnis",
            "fehler_code",
            "dauer_ms",
            "anfrage_id",
          ];
          const text = [
            kopf.join(","),
            ...zeilen.map((z) =>
              [
                z.zeit.toISOString(),
                z.art,
                z.userId,
                z.rollen.join(" "),
                z.aktion,
                titelVon(z.aktion, z.art),
                z.bereich,
                z.objektTyp,
                z.objektId,
                z.status,
                z.ergebnis,
                z.fehlerCode,
                z.dauerMs,
                z.anfrageId,
              ]
                .map(csvZelle)
                .join(","),
            ),
          ].join("\r\n");
          return c.body(text, 200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="protokoll.csv"',
            "Cache-Control": "no-store",
          });
        },
      )
      // Erst das Objekt (404, auch bei einer anderen Abteilung), dann die Funktion (403): wie überall (Matrix-Regel für Pfad-Parameter). Die Kennung ist eine UUIDv7 und nicht zu erraten
      .get("/:id", eingabe("param", pfadSchema), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const [zeile] = await db
          .select()
          .from(aktivitaet)
          .where(
            and(
              eq(aktivitaet.id, id),
              or(
                eq(aktivitaet.abteilungId, person.abteilungId),
                isNull(aktivitaet.abteilungId),
              ),
            ),
          );
        if (!zeile) throw new HTTPException(404);
        const verweigert = await nurEntwicklerPruefung(c);
        if (verweigert) return verweigert;
        return c.json(ansicht(zeile));
      })
  );
}

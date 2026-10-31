import { monitorEventLoopDelay } from "node:perf_hooks";
import { asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Sql } from "postgres";
import type { Db } from "../../db/client.js";
import {
  abteilung,
  auditLog,
  programm,
  programmEckdaten,
  stufe,
} from "../../db/schema.js";
import { eckdatenLauf } from "../../kalender/laufstand.js";
import type { Metriken } from "../../metriken.js";
import type { Person } from "../../rechte.js";

// Ein Abruf von Hand: dieselbe Funktion wie der Takt im Hintergrund; «gesperrt» heisst, ein anderer Lauf arbeitet gerade
export type SyncStarter = () => Promise<"fertig" | "gesperrt">;
const MIN_ABSTAND_MS = 30_000;

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

// Nur Admins (die Middleware für /api/v1/admin/* verlangt zusätzlich den zweiten Faktor). Die Antworten enthalten nur Zahlen, Flags und feste Texte: keine Umgebungswerte, Hosts, Adressen, Namen oder IDs
export function erstelleSystemRouten({
  db,
  sql,
  metriken,
  syncs = {},
}: {
  db: Db;
  sql: Sql;
  metriken: Metriken;
  // Fehlt ein Starter (Tests, Betrieb ohne Sync), antwortet der Knopf mit 501
  syncs?: { eckdaten?: SyncStarter; kalender?: SyncStarter };
}) {
  // Pro Job und Abteilung; verhindert, dass ein Klick-Sturm die Webseite oder Google belastet
  const letzterStart = new Map<string, number>();
  async function anstossen(
    job: "eckdaten" | "kalender",
    person: Person,
  ): Promise<"fertig" | "gesperrt"> {
    const starter = syncs[job];
    if (!starter) throw new HTTPException(501);
    const schluessel = `${job}:${person.abteilungId}`;
    const jetzt = Date.now();
    if (jetzt - (letzterStart.get(schluessel) ?? 0) < MIN_ABSTAND_MS) {
      throw new HTTPException(429);
    }
    letzterStart.set(schluessel, jetzt);
    // Ohne Personendaten: wer es wann ausgelöst hat, steht im Protokoll
    await db.insert(auditLog).values({
      abteilungId: person.abteilungId,
      akteurId: person.id,
      aktion: `sync_angestossen_${job}`,
      zielTyp: "sync",
      zielId: person.abteilungId,
    });
    return starter();
  }

  // Verzögerung der Ereignisschleife seit dem letzten Abruf; die Messung hält den Prozess nicht am Leben
  const schleife = monitorEventLoopDelay({ resolution: 20 });
  schleife.enable();

  return (
    new Hono<{ Variables: { person: Person } }>()
      .get("/", async (c) => {
        const person = c.get("person");
        if (!person.admin) throw new HTTPException(403);

        const start = performance.now();
        let erreichbar = true;
        let verbindungen: number | null = null;
        let bestand = { personen: 0, kinder: 0, push: 0 };
        try {
          // Ein Aufruf: Er misst die Antwortzeit der Datenbank und zählt zugleich den Bestand der Abteilung
          const [z] = await sql<
            {
              personen: number;
              kinder: number;
              push: number;
              verbindungen: number;
            }[]
          >`select
            (select count(*) from "user" where abteilung_id = ${person.abteilungId} and banned is not true)::int as personen,
            (select count(*) from kind where abteilung_id = ${person.abteilungId} and inaktiv_seit is null)::int as kinder,
            (select count(*) from push_token p join "user" u on u.id = p.user_id where u.abteilung_id = ${person.abteilungId})::int as push,
            (select count(*) from pg_stat_activity where datname = current_database())::int as verbindungen`;
          bestand = z;
          verbindungen = z.verbindungen;
        } catch {
          erreichbar = false;
        }
        const pingMs = Math.round(performance.now() - start);

        const [sync] = await db
          .select({
            eingerichtet: abteilung.googleKalenderId,
            okAm: abteilung.syncOkAm,
            fehler: abteilung.syncFehler,
          })
          .from(abteilung)
          .where(eq(abteilung.id, person.abteilungId))
          .catch(() => []);

        const speicher = process.memoryUsage();
        const commit = process.env.COMMIT_SHA;
        const antwort = c.json({
          prozess: {
            node: process.version,
            gestartetAm: new Date(Date.now() - process.uptime() * 1000),
            laufzeitSekunden: Math.round(process.uptime()),
            rssMb: mb(speicher.rss),
            heapGenutztMb: mb(speicher.heapUsed),
            heapGesamtMb: mb(speicher.heapTotal),
            // p99 seit dem letzten Abruf, in ms; null ohne Messwerte
            schleifeP99Ms:
              schleife.count > 0
                ? Math.round(schleife.percentile(99) / 1e4) / 100
                : null,
            // Nur wenn der Build sie setzt: ein Commit-Hash, nie ein beliebiger Text
            commit: commit && /^[0-9a-f]{7,40}$/.test(commit) ? commit : null,
          },
          datenbank: {
            erreichbar,
            pingMs: erreichbar ? pingMs : null,
            verbindungen,
            poolMaximum: sql.options.max,
          },
          bestand: {
            aktivePersonen: bestand.personen,
            aktiveKinder: bestand.kinder,
            pushTokens: bestand.push,
          },
          // Der Fehlertext ist einer von wenigen festen Texten des Syncs (kalender/fehler.ts)
          kalender: {
            eingerichtet: Boolean(sync?.eingerichtet),
            letzterErfolgAm: sync?.okAm ?? null,
            fehler: sync?.fehler ?? null,
          },
          umgebung: {
            https: (process.env.BETTER_AUTH_URL ?? "").startsWith("https://"),
            produktion: process.env.NODE_ENV === "production",
            kalenderSchluessel: Boolean(
              process.env.GOOGLE_APPLICATION_CREDENTIALS,
            ),
          },
        });
        schleife.reset();
        return antwort;
      })
      // Was die Hintergrund-Abrufe zuletzt geliefert haben (#267): nur feste Ausgänge, Codes und gelesene Eckdaten, nie HTML oder Fehlertexte
      .get("/syncs", async (c) => {
        const person = c.get("person");
        if (!person.admin) throw new HTTPException(403);

        const stufen = await db
          .select({
            id: stufe.id,
            name: stufe.name,
            tag: programmEckdaten.tag,
            treffpunkt: programmEckdaten.treffpunkt,
            schlussOrt: programmEckdaten.schlussOrt,
            schlussZeit: programmEckdaten.schlussZeit,
            mitnehmen: programmEckdaten.mitnehmen,
            abgerufenAm: programmEckdaten.abgerufenAm,
          })
          .from(stufe)
          .leftJoin(programmEckdaten, eq(programmEckdaten.stufeId, stufe.id))
          .where(eq(stufe.abteilungId, person.abteilungId))
          .orderBy(asc(stufe.name), asc(stufe.id));
        const [abt] = await db
          .select({
            eingerichtet: abteilung.googleKalenderId,
            okAm: abteilung.syncOkAm,
            fehler: abteilung.syncFehler,
          })
          .from(abteilung)
          .where(eq(abteilung.id, person.abteilungId));
        const [{ programme }] = await db
          .select({ programme: count() })
          .from(programm)
          .where(eq(programm.abteilungId, person.abteilungId));

        return c.json({
          eckdaten: {
            letzterLaufAm: eckdatenLauf.am,
            stufen: stufen.map((z) => {
              const lauf = eckdatenLauf.stufen.get(z.id);
              return {
                id: z.id,
                name: z.name,
                adresse: lauf?.adresse ?? null,
                ausgang: lauf?.ausgang ?? null,
                fehlercode: lauf?.fehlercode ?? null,
                eckdaten: z.tag
                  ? {
                      tag: z.tag,
                      treffpunkt: z.treffpunkt,
                      schlussOrt: z.schlussOrt,
                      schlussZeit: z.schlussZeit,
                      mitnehmen: z.mitnehmen,
                      abgerufenAm: z.abgerufenAm,
                    }
                  : null,
              };
            }),
          },
          kalender: {
            eingerichtet: Boolean(abt?.eingerichtet),
            letzterErfolgAm: abt?.okAm ?? null,
            fehler: abt?.fehler ?? null,
            programme,
          },
        });
      })
      .post("/syncs/eckdaten", async (c) => {
        const person = c.get("person");
        if (!person.admin) throw new HTTPException(403);
        return c.json({ ergebnis: await anstossen("eckdaten", person) });
      })
      .post("/syncs/kalender", async (c) => {
        const person = c.get("person");
        if (!person.admin) throw new HTTPException(403);
        return c.json({ ergebnis: await anstossen("kalender", person) });
      })
      .get("/requests", (c) => {
        if (!c.get("person").admin) throw new HTTPException(403);
        return c.json(metriken.momentaufnahme());
      })
  );
}

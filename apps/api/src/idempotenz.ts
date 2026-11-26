import { createHash } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode, StatusCode } from "hono/utils/http-status";
import type { Db } from "./db/client.js";
import { idempotenz } from "./db/schema.js";

// So lange gibt eine Wiederholung mit demselben Schlüssel die erste Antwort zurück; danach gilt der Schlüssel als neu
export const IDEMPOTENZ_STUNDEN = 24;
// Ein Anspruch ohne Antwort, der so alt ist, gehört zu einer abgebrochenen Anfrage (Neustart des Servers): Die nächste Wiederholung mit demselben Körper übernimmt ihn
const ANSPRUCH_MINUTEN = 5;
// Grössere Antworten stehen nur mit ihrer ID: Die Tabelle hält keine Inhalte auf Vorrat
export const ANTWORT_MAX_ZEICHEN = 16_000;
// Eine UUID passt auch
const SCHLUESSEL = /^[A-Za-z0-9_-]{16,64}$/;

export const IDEMPOTENZ_KONFLIKT = {
  code: "IDEMPOTENZ_KONFLIKT",
  message:
    "Dieser Schlüssel gehört schon zu einer anderen Anfrage. Nimm für eine neue Anfrage einen neuen Schlüssel.",
} as const;
export const IN_BEARBEITUNG = {
  code: "IN_BEARBEITUNG",
  message: "Die gleiche Anfrage läuft noch. Versuche es gleich nochmals.",
} as const;

function gespeicherteAntwort(text: string): unknown {
  if (!text) return null;
  try {
    const wert: unknown = JSON.parse(text);
    if (text.length <= ANTWORT_MAX_ZEICHEN) return wert;
    const id = (wert as { id?: unknown } | null)?.id;
    return typeof id === "string" ? { id } : null;
  } catch {
    return null;
  }
}

// Optionaler Kopf «Idempotency-Key» für Direktanlagen der Apps (#873). Hinter der Policy der Route einhängen (Rechte zuerst), vor der Prüfung des Körpers. Ohne Kopf ändert sich nichts. Mit Kopf: Der erste Aufruf beansprucht den Schlüssel (Person, Methode mit Pfad, Schlüssel) mit dem Hash des Körpers und führt die Route aus; nur eine Antwort 2xx bleibt stehen, sonst fällt der Anspruch weg und eine Wiederholung führt die Route neu aus. Eine Wiederholung mit gleichem Körper bekommt die gespeicherte Antwort, ohne dass die Route noch einmal läuft; mit anderem Körper 422 IDEMPOTENZ_KONFLIKT; solange die erste läuft, 409 IN_BEARBEITUNG
export function idempotenzSchluessel(db: Db) {
  return createMiddleware<{ Variables: { person: { id: string } } }>(
    async (c, next) => {
      const schluessel = c.req.header("Idempotency-Key");
      if (schluessel === undefined) return next();
      if (!SCHLUESSEL.test(schluessel)) throw new HTTPException(400);
      const k = {
        personId: c.get("person").id,
        route: `${c.req.method} ${c.req.path}`,
        schluessel,
      };
      const hash = createHash("sha256")
        .update(await c.req.text())
        .digest("hex");
      const wo = and(
        eq(idempotenz.personId, k.personId),
        eq(idempotenz.route, k.route),
        eq(idempotenz.schluessel, k.schluessel),
      );
      // Ein abgelaufener Eintrag oder ein verwaister Anspruch mit gleichem Körper wird übernommen; ein laufender oder gültiger bleibt
      const anspruch = await db.execute(sql`
        insert into idempotenz (person_id, route, schluessel, hash)
        values (${k.personId}, ${k.route}, ${k.schluessel}, ${hash})
        on conflict (person_id, route, schluessel) do update
          set hash = excluded.hash, status = null, antwort = null, erstellt_am = now()
          where idempotenz.erstellt_am < now() - make_interval(hours => ${IDEMPOTENZ_STUNDEN})
            or (idempotenz.status is null and idempotenz.hash = excluded.hash
              and idempotenz.erstellt_am < now() - make_interval(mins => ${ANSPRUCH_MINUTEN}))
        returning 1`);
      if (anspruch.length === 0) {
        const [bekannt] = await db
          .select({
            hash: idempotenz.hash,
            status: idempotenz.status,
            antwort: idempotenz.antwort,
          })
          .from(idempotenz)
          .where(wo);
        if (bekannt && bekannt.hash !== hash) {
          return c.json(IDEMPOTENZ_KONFLIKT, 422);
        }
        // Läuft noch, oder der Anspruch fiel gerade weg (die erste scheiterte): Die App fragt gleich noch einmal
        if (!bekannt?.status) return c.json(IN_BEARBEITUNG, 409);
        return bekannt.antwort === null
          ? c.body(null, bekannt.status as StatusCode)
          : c.json(bekannt.antwort, bekannt.status as ContentfulStatusCode);
      }
      let gespeichert = false;
      try {
        await next();
        if (c.res.status >= 200 && c.res.status < 300) {
          await db
            .update(idempotenz)
            .set({
              status: c.res.status,
              antwort: gespeicherteAntwort(await c.res.clone().text()),
            })
            .where(wo);
          gespeichert = true;
        }
      } finally {
        if (!gespeichert) {
          await db.delete(idempotenz).where(and(wo, isNull(idempotenz.status)));
        }
      }
    },
  );
}

// Täglicher Lauf (server.ts): Einträge nach der Frist löschen; liefert die Anzahl
export async function loescheAlteIdempotenz(db: Db) {
  const weg = await db
    .delete(idempotenz)
    .where(
      lt(
        idempotenz.erstelltAm,
        sql`now() - make_interval(hours => ${IDEMPOTENZ_STUNDEN})`,
      ),
    )
    .returning({ schluessel: idempotenz.schluessel });
  return weg.length;
}

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { erstelleAuth } from "./auth.js";
import type { Db } from "./db/client.js";
import { programmStufe, rolle, stufe } from "./db/schema.js";

// Eltern haben keine Stufenrolle: Ihre Rechte hängen am Kind, die Routen joinen kind_eltern direkt in SQL
export type Person = {
  id: string;
  abteilungId: string;
  admin: boolean;
  rollen: { stufeId: string; typ: "leitung" | "stufenleitung" }[];
};

// Jede Route unter /api/v1 lädt ihr Objekt in SQL auf person.abteilungId gefiltert, sonst HTTPException(404); erst dann prüft sie das Recht, sonst HTTPException(403)
export function personAusSitzung(
  auth: ReturnType<typeof erstelleAuth>,
  db: Db,
) {
  return createMiddleware<{ Variables: { person: Person } }>(
    async (c, next) => {
      // disableRefresh: Die Verlängerung gehört zu get-session; hier schriebe sie die Zeile und verlöre ihr Set-Cookie
      const sitzung = await auth.api.getSession({
        headers: c.req.raw.headers,
        query: { disableRefresh: true },
      });
      // banned prüft better-auth nur beim Anlegen einer Sitzung, nicht beim Lesen
      if (!sitzung || sitzung.user.banned) throw new HTTPException(401);
      // Kein Fremdschlüssel sichert zu, dass die Stufe zur Abteilung der Person gehört, darum die Bedingung im Join
      const rollen = await db
        .select({ stufeId: rolle.stufeId, typ: rolle.typ })
        .from(rolle)
        .innerJoin(
          stufe,
          and(
            eq(rolle.stufeId, stufe.id),
            eq(stufe.abteilungId, sitzung.user.abteilungId),
          ),
        )
        .where(eq(rolle.userId, sitzung.user.id));
      c.set("person", {
        id: sitzung.user.id,
        abteilungId: sitzung.user.abteilungId,
        admin: sitzung.user.role === "admin",
        rollen,
      });
      await next();
    },
  );
}

// «stufenleitung» erfüllt nur die SL, «leitung» auch die SL derselben Stufe; Admin ist keine Stufenrolle
export function hatRolle(
  person: Person,
  stufeId: string,
  typ: "leitung" | "stufenleitung",
) {
  return person.rollen.some(
    (r) =>
      r.stufeId === stufeId && (r.typ === "stufenleitung" || typ === "leitung"),
  );
}

// Admins und SL sehen jedes Programm der Abteilung: SL brauchen den Eingang «Nicht zugeordnet» und fremde Stufen für Abteilungsanlässe
const adminOderSl = (person: Person) =>
  person.admin || person.rollen.some((r) => r.typ === "stufenleitung");

// Spalten bewusst als Text «programm.…»: In der Feldliste eines Selects liesse Drizzle den Tabellennamen weg
export function programmLeitungssicht(person: Person): SQL {
  const eigeneAbteilung = sql`programm.abteilung_id = ${person.abteilungId}`;
  if (adminOderSl(person)) return eigeneAbteilung;
  // inArray mit leerer Liste wird zu «false»: Ohne Rolle bleibt alles verborgen
  return sql`(${eigeneAbteilung} and programm.sichtbarkeit in ('leitende', 'eltern') and exists (select 1 from programm_stufe where programm_stufe.programm_id = programm.id and ${inArray(
    programmStufe.stufeId,
    person.rollen.map((r) => r.stufeId),
  )}))`;
}

// Fail-closed über das Kind: Es zählt nur aktiv und in der eigenen Abteilung
function programmElternsicht(person: Person): SQL {
  return sql`(programm.abteilung_id = ${person.abteilungId} and programm.sichtbarkeit = 'eltern' and exists (select 1 from programm_stufe inner join kind on kind.stufe_id = programm_stufe.stufe_id and kind.abteilung_id = ${person.abteilungId} and kind.inaktiv_seit is null inner join kind_eltern on kind_eltern.kind_id = kind.id and kind_eltern.user_id = ${person.id} where programm_stufe.programm_id = programm.id))`;
}

// Sichtbar ist ein Programm mit Leitungs- oder Elternsicht; beide schränken auf die Abteilung aus der Sitzung ein
export function programmSichtbar(person: Person): SQL {
  const leitungssicht = programmLeitungssicht(person);
  if (adminOderSl(person)) return leitungssicht;
  return sql`(${leitungssicht} or ${programmElternsicht(person)})`;
}

// Admin alles; eine SL nur Änderungen, die ausschliesslich eigene Stufen betreffen; Leitende und Eltern nie, auch kein No-op
export function darfZuordnen(
  person: Person,
  {
    vorher,
    nachher,
    sichtbarkeitAendert,
  }: {
    vorher: readonly string[];
    nachher: readonly string[];
    sichtbarkeitAendert: boolean;
  },
) {
  if (person.admin) return true;
  if (!person.rollen.some((r) => r.typ === "stufenleitung")) return false;
  const vorherMenge = new Set(vorher);
  const nachherMenge = new Set(nachher);
  // Jede hinzugefügte oder entfernte Stufe; ändert die Sichtbarkeit, jede beteiligte
  const betroffen = [...vorher, ...nachher].filter(
    (stufeId) =>
      sichtbarkeitAendert ||
      !vorherMenge.has(stufeId) ||
      !nachherMenge.has(stufeId),
  );
  return betroffen.every((stufeId) =>
    hatRolle(person, stufeId, "stufenleitung"),
  );
}

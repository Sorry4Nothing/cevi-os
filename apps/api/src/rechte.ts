import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { erstelleAuth } from "./auth.js";
import type { Db } from "./db/client.js";
import { rolle, stufe } from "./db/schema.js";

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

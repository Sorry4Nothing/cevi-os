import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { kind, kindEltern, user } from "./db/schema.js";
import type { Person } from "./rechte.js";

// Die Stufen unter den gefragten, in denen die Person ein aktives Kind hat
export async function stufenMitKind(
  db: Db,
  person: Pick<Person, "id" | "abteilungId">,
  stufeIds: string[],
) {
  if (stufeIds.length === 0) return new Set<string>();
  const zeilen = await db
    .selectDistinct({ stufeId: kind.stufeId })
    .from(kind)
    .innerJoin(kindEltern, eq(kindEltern.kindId, kind.id))
    .where(
      and(
        eq(kindEltern.userId, person.id),
        eq(kind.abteilungId, person.abteilungId),
        isNull(kind.inaktivSeit),
        inArray(kind.stufeId, stufeIds),
      ),
    );
  return new Set(zeilen.map((z) => z.stufeId));
}

// Eine Zeile pro SL; die Nummer liest die Datenbank nur, wenn die Person in einer Stufe dieser SL ein aktives Kind hat. Leitende, Admins und Eltern anderer Stufen bekommen sie nie: telefon bleibt für sie null
export async function kontakteMitTelefon(
  db: Db,
  person: Pick<Person, "id" | "abteilungId">,
  sl: { stufeId: string; id: string; name: string }[],
) {
  const stufenJeSl = new Map<string, { name: string; stufen: Set<string> }>();
  for (const z of sl) {
    const eintrag = stufenJeSl.get(z.id) ?? {
      name: z.name,
      stufen: new Set<string>(),
    };
    eintrag.stufen.add(z.stufeId);
    stufenJeSl.set(z.id, eintrag);
  }
  const meine = await stufenMitKind(db, person, [
    ...new Set(sl.map((z) => z.stufeId)),
  ]);
  const sichtbar = [...stufenJeSl].filter(([, e]) =>
    [...e.stufen].some((s) => meine.has(s)),
  );
  const nummern = new Map<string, string | null>();
  if (sichtbar.length > 0) {
    const zeilen = await db
      .select({ id: user.id, telefon: user.telefon })
      .from(user)
      .where(
        and(
          inArray(
            user.id,
            sichtbar.map(([id]) => id),
          ),
          eq(user.abteilungId, person.abteilungId),
        ),
      );
    for (const z of zeilen) nummern.set(z.id, z.telefon);
  }
  return [...stufenJeSl].map(([id, e]) => ({
    id,
    name: e.name,
    telefon: nummern.get(id) ?? null,
  }));
}

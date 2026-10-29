import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { isAPIError } from "better-auth/api";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  aktiveAdminIds,
  istLetzterAdmin,
  LETZTER_ADMIN,
} from "../../admins.js";
import { erstelleAuth, platzhalterEmail } from "../../auth.js";
import {
  BENUTZERNAME_MAX,
  BENUTZERNAME_MIN,
  BENUTZERNAME_MUSTER,
} from "../../benutzername.js";
import type { Db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import {
  auditLog,
  kind,
  kindEltern,
  rolle,
  stufe,
  user,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";
import {
  erzeugeStartpasswort,
  normalisiereStartpasswort,
  startpasswortFelder,
} from "../../startpasswort.js";
import { setzeZweitenFaktorZurueck } from "../../zweiter-faktor.js";

// Eigene 409-Codes mit eigener Antwort: onError machte aus einer HTTPException(409) nur «FEHLER»
const KONFLIKT = {
  BENUTZERNAME_VERGEBEN: {
    code: "BENUTZERNAME_VERGEBEN",
    message: "Dieser Benutzername ist schon vergeben.",
  },
  LETZTER_ADMIN,
  EIGENES_KONTO: {
    code: "EIGENES_KONTO",
    message:
      "Das eigene Konto lässt sich hier nicht zurücksetzen, deaktivieren oder löschen.",
  },
  EIGENER_ZWEITER_FAKTOR: {
    code: "EIGENER_ZWEITER_FAKTOR",
    message: "Den eigenen zweiten Faktor setzt ein anderer Admin zurück.",
  },
  KEIN_ZWEITER_FAKTOR: {
    code: "KEIN_ZWEITER_FAKTOR",
    message: "Diese Person hat keinen zweiten Faktor.",
  },
} as const;

// Trägt einen Konflikt aus einer Transaktion heraus; die Route antwortet 409 und alles ist zurückgerollt
class Konflikt extends Error {
  constructor(public konflikt: keyof typeof KONFLIKT) {
    super(KONFLIKT[konflikt].message);
  }
}

const benutzernameFeld = z
  .string()
  .min(BENUTZERNAME_MIN)
  .max(BENUTZERNAME_MAX)
  .regex(BENUTZERNAME_MUSTER);
const text = (max: number) => z.string().trim().min(1).max(max);
const rollenFeld = z
  .array(
    z.strictObject({
      stufeId: z.uuid(),
      typ: z.enum(["leitung", "stufenleitung"]),
    }),
  )
  .max(50)
  .refine(
    (rollen) => new Set(rollen.map((r) => r.stufeId)).size === rollen.length,
  );
const elternteilVonFeld = z
  .array(z.uuid())
  .max(50)
  .refine((kinder) => new Set(kinder).size === kinder.length);

// Ein Schema pro Route, mit keiner Nicht-Admin-Route geteilt
const anlegenSchema = z.strictObject({
  vorname: text(100),
  nachname: text(100),
  benutzername: benutzernameFeld,
  admin: z.boolean(),
  rollen: rollenFeld,
  elternteilVon: elternteilVonFeld,
});
// name fasst «Vorname Nachname» in einem Feld, wie user.name beim Anlegen (#20)
const aendernSchema = z.strictObject({
  name: text(201).optional(),
  admin: z.boolean().optional(),
  rollen: rollenFeld.optional(),
  elternteilVon: elternteilVonFeld.optional(),
});
const pfad = () => z.strictObject({ id: z.uuid() });

export function erstellePersonenRouten({
  db,
  auth,
}: {
  db: Db;
  auth: ReturnType<typeof erstelleAuth>;
}) {
  // Ziel in SQL auf die Abteilung der Sitzung gefiltert: fremde wie unbekannte IDs sind 404, erst danach zählt das Recht
  async function ladeZiel(person: Person, id: string) {
    const [ziel] = await db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.id, id), eq(user.abteilungId, person.abteilungId)));
    if (!ziel) throw new HTTPException(404);
    if (!person.admin) throw new HTTPException(403);
  }

  // Fremde wie unbekannte Stufen- und Kind-IDs sind eine ungültige Eingabe, vor jedem Schreibzugriff geprüft
  async function pruefeIds(
    person: Person,
    rollen: readonly { stufeId: string }[],
    elternteilVon: readonly string[],
  ) {
    const stufenIds = rollen.map((r) => r.stufeId);
    if (stufenIds.length > 0) {
      const eigene = await db
        .select({ id: stufe.id })
        .from(stufe)
        .where(
          and(
            inArray(stufe.id, stufenIds),
            eq(stufe.abteilungId, person.abteilungId),
          ),
        );
      if (eigene.length !== stufenIds.length) throw new HTTPException(400);
    }
    if (elternteilVon.length > 0) {
      const eigene = await db
        .select({ id: kind.id })
        .from(kind)
        .where(
          and(
            inArray(kind.id, [...elternteilVon]),
            eq(kind.abteilungId, person.abteilungId),
          ),
        );
      if (eigene.length !== elternteilVon.length) throw new HTTPException(400);
    }
  }

  // Im selben Commit wie die Aktion; details ohne Personendaten (IDs, Rollen, Flags)
  const protokolliere = (
    tx: Pick<Db, "insert">,
    person: Person,
    aktion: string,
    zielId: string,
    details?: Record<string, unknown>,
  ) =>
    tx.insert(auditLog).values({
      abteilungId: person.abteilungId,
      akteurId: person.id,
      aktion,
      zielTyp: "person",
      zielId,
      details,
    });

  // Ziel gelistet und keine zweite aktive Admin-ID: der letzte Admin bleibt
  async function sperreLetztenAdmin(
    tx: Pick<Db, "select">,
    abteilungId: string,
    zielId: string,
  ) {
    const admins = await aktiveAdminIds(tx, abteilungId);
    if (istLetzterAdmin(admins, zielId)) throw new Konflikt("LETZTER_ADMIN");
  }

  return new Hono<{ Variables: { person: Person } }>()
    .get("/", async (c) => {
      const person = c.get("person");
      if (!person.admin) throw new HTTPException(403);
      const abteilungId = person.abteilungId;
      const [personen, rollenZeilen, elternZeilen, stufen, kinder] =
        await Promise.all([
          db
            .select({
              id: user.id,
              name: user.name,
              benutzername: user.username,
              role: user.role,
              twoFactorEnabled: user.twoFactorEnabled,
              banned: user.banned,
              mussPasswortAendern: user.mussPasswortAendern,
              startpasswortGueltigBis: user.startpasswortGueltigBis,
            })
            .from(user)
            .where(eq(user.abteilungId, abteilungId))
            .orderBy(asc(user.name), asc(user.id)),
          db
            .select({
              userId: rolle.userId,
              stufeId: rolle.stufeId,
              typ: rolle.typ,
            })
            .from(rolle)
            .innerJoin(
              stufe,
              and(
                eq(rolle.stufeId, stufe.id),
                eq(stufe.abteilungId, abteilungId),
              ),
            )
            .orderBy(asc(stufe.reihenfolge)),
          db
            .select({ userId: kindEltern.userId, kindId: kindEltern.kindId })
            .from(kindEltern)
            .innerJoin(
              kind,
              and(
                eq(kindEltern.kindId, kind.id),
                eq(kind.abteilungId, abteilungId),
              ),
            )
            .orderBy(asc(kind.id)),
          db
            .select({ id: stufe.id, name: stufe.name, kuerzel: stufe.kuerzel })
            .from(stufe)
            .where(eq(stufe.abteilungId, abteilungId))
            .orderBy(asc(stufe.reihenfolge)),
          db
            .select({
              id: kind.id,
              vorname: kind.vorname,
              nachname: kind.nachname,
              stufeId: kind.stufeId,
              inaktivSeit: kind.inaktivSeit,
            })
            .from(kind)
            .where(eq(kind.abteilungId, abteilungId))
            .orderBy(asc(kind.nachname), asc(kind.vorname), asc(kind.id)),
        ]);
      // Nie email, telefon, banReason, Bremsfelder oder Geheimnisse und Codes des zweiten Faktors: Der Rollen-Editor braucht nur das hier
      return c.json({
        personen: personen.map((p) => ({
          id: p.id,
          name: p.name,
          benutzername: p.benutzername,
          admin: p.role === "admin",
          zweiterFaktor: p.twoFactorEnabled === true,
          deaktiviert: p.banned === true,
          mussPasswortAendern: p.mussPasswortAendern,
          startpasswortGueltigBis: p.startpasswortGueltigBis,
          rollen: rollenZeilen
            .filter((zeile) => zeile.userId === p.id)
            .map(({ stufeId, typ }) => ({ stufeId, typ })),
          elternteilVon: elternZeilen
            .filter((zeile) => zeile.userId === p.id)
            .map((zeile) => zeile.kindId),
        })),
        stufen,
        kinder,
      });
    })
    .post("/", eingabe("json", anlegenSchema), async (c) => {
      const person = c.get("person");
      if (!person.admin) throw new HTTPException(403);
      const eingaben = c.req.valid("json");
      await pruefeIds(person, eingaben.rollen, eingaben.elternteilVon);
      const startpasswort = erzeugeStartpasswort();
      try {
        const angelegt = await db.transaction(async (tx) => {
          // createUser legt den User vor der HIBP-Prüfung an; die Transaktion nimmt bei jedem Fehler alles zurück, sonst hielte ein Konto ohne Passwort den Benutzernamen fest
          const txAuth = erstelleAuth(
            drizzleAdapter(tx, { provider: "pg", schema, transaction: true }),
          );
          const { user: neu } = await txAuth.api.createUser({
            body: {
              email: platzhalterEmail(),
              password: normalisiereStartpasswort(startpasswort),
              name: `${eingaben.vorname} ${eingaben.nachname}`,
              role: eingaben.admin ? "admin" : "user",
              data: {
                username: eingaben.benutzername,
                abteilungId: person.abteilungId,
                ...startpasswortFelder(),
              },
            },
            // Mit den Headern der Admin-Anfrage; ohne sie prüfte createUser keine Rechte
            headers: c.req.raw.headers,
          });
          if (eingaben.rollen.length > 0) {
            await tx
              .insert(rolle)
              .values(eingaben.rollen.map((r) => ({ userId: neu.id, ...r })));
          }
          if (eingaben.elternteilVon.length > 0) {
            await tx.insert(kindEltern).values(
              eingaben.elternteilVon.map((kindId) => ({
                kindId,
                userId: neu.id,
              })),
            );
          }
          await protokolliere(tx, person, "person_angelegt", neu.id, {
            admin: eingaben.admin,
            rollen: eingaben.rollen,
            elternteilVon: eingaben.elternteilVon,
          });
          // Das Plugin speichert kleingeschrieben; sein Typ kennt das Feld nicht
          return {
            id: neu.id,
            benutzername:
              (neu as { username?: string }).username ??
              eingaben.benutzername.toLowerCase(),
          };
        });
        // 201 erst nach dem Commit: Ein zurückgenommenes Startpasswort darf die Antwort nie erreichen
        return c.json({ ...angelegt, startpasswort }, 201);
      } catch (fehler) {
        if (
          isAPIError(fehler) &&
          fehler.body?.code === "USERNAME_IS_ALREADY_TAKEN"
        ) {
          return c.json(KONFLIKT.BENUTZERNAME_VERGEBEN, 409);
        }
        throw fehler;
      }
    })
    .patch(
      "/:id",
      eingabe("param", pfad()),
      eingabe("json", aendernSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const aenderung = c.req.valid("json");
        await ladeZiel(person, id);
        await pruefeIds(
          person,
          aenderung.rollen ?? [],
          aenderung.elternteilVon ?? [],
        );
        try {
          await db.transaction(async (tx) => {
            if (aenderung.admin === false) {
              await sperreLetztenAdmin(tx, person.abteilungId, id);
            }
            const felder: Partial<{ name: string; role: string }> = {};
            // Nur geänderte Schlüssel; ein No-op des Rollen-Editors schreibt keinen Eintrag
            const details: Record<string, unknown> = {};
            if (aenderung.name !== undefined) felder.name = aenderung.name;
            if (aenderung.admin !== undefined) {
              felder.role = aenderung.admin ? "admin" : "user";
              const [bisher] = await tx
                .select({ role: user.role })
                .from(user)
                .where(eq(user.id, id));
              if ((bisher.role === "admin") !== aenderung.admin) {
                details.admin = aenderung.admin;
              }
            }
            if (Object.keys(felder).length > 0) {
              await tx.update(user).set(felder).where(eq(user.id, id));
            }
            if (aenderung.rollen) {
              const bisher = await tx
                .select({ stufeId: rolle.stufeId, typ: rolle.typ })
                .from(rolle)
                .where(eq(rolle.userId, id));
              const bisherTypen = new Map(
                bisher.map((zeile) => [zeile.stufeId, zeile.typ]),
              );
              if (
                bisherTypen.size !== aenderung.rollen.length ||
                aenderung.rollen.some(
                  (r) => bisherTypen.get(r.stufeId) !== r.typ,
                )
              ) {
                details.rollen = aenderung.rollen;
              }
              const neueIds = new Set(aenderung.rollen.map((r) => r.stufeId));
              const weg = bisher
                .map((zeile) => zeile.stufeId)
                .filter((stufeId) => !neueIds.has(stufeId));
              if (weg.length > 0) {
                await tx
                  .delete(rolle)
                  .where(
                    and(eq(rolle.userId, id), inArray(rolle.stufeId, weg)),
                  );
              }
              if (aenderung.rollen.length > 0) {
                await tx
                  .insert(rolle)
                  .values(aenderung.rollen.map((r) => ({ userId: id, ...r })))
                  .onConflictDoUpdate({
                    target: [rolle.userId, rolle.stufeId],
                    set: { typ: sql`excluded.typ` },
                  });
              }
            }
            if (aenderung.elternteilVon) {
              const bisher = await tx
                .select({ kindId: kindEltern.kindId })
                .from(kindEltern)
                .where(eq(kindEltern.userId, id));
              const neueMenge = new Set(aenderung.elternteilVon);
              const bisherMenge = new Set(bisher.map((z) => z.kindId));
              const weg = [...bisherMenge].filter(
                (kindId) => !neueMenge.has(kindId),
              );
              // Nur die Differenz: Unveränderte Zeilen behalten erstellt_am, wo die Chat-Sicht der Eltern beginnt
              const neu = aenderung.elternteilVon.filter(
                (kindId) => !bisherMenge.has(kindId),
              );
              if (weg.length > 0 || neu.length > 0) {
                details.elternteilVon = aenderung.elternteilVon;
              }
              if (weg.length > 0) {
                await tx
                  .delete(kindEltern)
                  .where(
                    and(
                      eq(kindEltern.userId, id),
                      inArray(kindEltern.kindId, weg),
                    ),
                  );
              }
              if (neu.length > 0) {
                await tx
                  .insert(kindEltern)
                  .values(neu.map((kindId) => ({ kindId, userId: id })));
              }
            }
            if (Object.keys(details).length > 0) {
              await protokolliere(tx, person, "rolle_geaendert", id, details);
            }
          });
        } catch (fehler) {
          if (fehler instanceof Konflikt) {
            return c.json(KONFLIKT[fehler.konflikt], 409);
          }
          throw fehler;
        }
        return c.body(null, 204);
      },
    )
    .post("/:id/startpasswort", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      await ladeZiel(person, id);
      // Vor jedem Aufruf: Ein Reset auf sich selbst meldete den Admin ab, bevor das Passwort notiert ist
      if (id === person.id) return c.json(KONFLIKT.EIGENES_KONTO, 409);
      const startpasswort = erzeugeStartpasswort();
      const headers = c.req.raw.headers;
      await auth.api.setUserPassword({
        body: {
          userId: id,
          newPassword: normalisiereStartpasswort(startpasswort),
        },
        headers,
      });
      // Alle Sitzungen enden, die Push-Tokens mit ihnen (#42); danach Pflichtwechsel, 7 Tage und Bremse von vorn
      await auth.api.revokeUserSessions({ body: { userId: id }, headers });
      await db.transaction(async (tx) => {
        await tx.update(user).set(startpasswortFelder()).where(eq(user.id, id));
        await protokolliere(tx, person, "startpasswort_neu", id);
      });
      return c.json({ startpasswort });
    })
    .post("/:id/deaktivieren", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      await ladeZiel(person, id);
      if (id === person.id) return c.json(KONFLIKT.EIGENES_KONTO, 409);
      try {
        await db.transaction(async (tx) => {
          await sperreLetztenAdmin(tx, person.abteilungId, id);
          // Vor banUser: Scheitert das, nimmt die Transaktion den Eintrag zurück
          await protokolliere(tx, person, "person_deaktiviert", id);
          // banUser löscht auch die Sitzungen und läuft auf eigener Verbindung; die Transaktion fasst vorher keine Zeile der Zielperson an, sonst drohte ein Deadlock
          await auth.api.banUser({
            body: { userId: id },
            headers: c.req.raw.headers,
          });
          await tx
            .update(user)
            .set({ deaktiviertAm: sql`now()` })
            .where(eq(user.id, id));
        });
      } catch (fehler) {
        if (fehler instanceof Konflikt) {
          return c.json(KONFLIKT[fehler.konflikt], 409);
        }
        throw fehler;
      }
      return c.body(null, 204);
    })
    .post("/:id/aktivieren", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      await ladeZiel(person, id);
      await auth.api.unbanUser({
        body: { userId: id },
        headers: c.req.raw.headers,
      });
      await db.transaction(async (tx) => {
        await tx
          .update(user)
          .set({ deaktiviertAm: null })
          .where(eq(user.id, id));
        await protokolliere(tx, person, "person_aktiviert", id);
      });
      return c.body(null, 204);
    })
    .post(
      "/:id/zweiter-faktor-zuruecksetzen",
      eingabe("param", pfad()),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        await ladeZiel(person, id);
        if (id === person.id)
          return c.json(KONFLIKT.EIGENER_ZWEITER_FAKTOR, 409);
        const zurueckgesetzt = await setzeZweitenFaktorZurueck(db, {
          zielId: id,
          abteilungId: person.abteilungId,
          akteurId: person.id,
        });
        if (!zurueckgesetzt) return c.json(KONFLIKT.KEIN_ZWEITER_FAKTOR, 409);
        return c.body(null, 204);
      },
    )
    .delete("/:id", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      await ladeZiel(person, id);
      if (id === person.id) return c.json(KONFLIKT.EIGENES_KONTO, 409);
      try {
        await db.transaction(async (tx) => {
          await sperreLetztenAdmin(tx, person.abteilungId, id);
          await protokolliere(tx, person, "person_geloescht", id);
          // removeUser läuft auf eigener Verbindung; Rollen, Kinder-Verknüpfungen und Sitzungen löscht die Datenbank per CASCADE
          await auth.api.removeUser({
            body: { userId: id },
            headers: c.req.raw.headers,
          });
        });
      } catch (fehler) {
        if (fehler instanceof Konflikt) {
          return c.json(KONFLIKT[fehler.konflikt], 409);
        }
        throw fehler;
      }
      return c.body(null, 204);
    });
}

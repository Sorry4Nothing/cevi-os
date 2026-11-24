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
import type { erstelleAuth } from "../../auth.js";
import { bildUrl } from "../../bild.js";
import { meldeWebsiteEreignis } from "../../website/ereignisse.js";
import { ceviNameFeld } from "../../cevi-name.js";
import {
  BENUTZERNAME_MAX,
  BENUTZERNAME_MIN,
  BENUTZERNAME_MUSTER,
} from "../../benutzername.js";
import type { Db } from "../../db/client.js";
import {
  auditLog,
  kind,
  kindEltern,
  personTag,
  profilbild,
  rolle,
  stufe,
  user,
  verification,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { telefonSchema } from "../../telefon.js";
import { keinKindKonto as keinKindKontoVon } from "../../kind-konto.js";
import { legePersonAn } from "../../personen-anlegen.js";
import type { Person } from "../../rechte.js";
import { verlange } from "../../rechtemodell/darf.js";
import {
  geschuetzteKonten,
  personenSicht,
  sichtbareKinderStufen,
  stufeObjekt,
} from "../../rechtemodell/personenrechte.js";
import {
  entschluesseleStartpasswort,
  erzeugeStartpasswort,
  normalisiereStartpasswort,
  startpasswortFelder,
} from "../../startpasswort.js";
import {
  beendeSitzungen,
  entferneKonto,
  entsperreKonto,
  setzePasswort,
  sperreKonto,
} from "../../konto-verwaltung.js";
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
    message:
      "Den eigenen zweiten Faktor setzt eine andere Person der Abteilungsleitung zurück.",
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

// Das eigene Konto eines Kindes (#644) gehört auf die Seite «Kinder», nie in die Personen: Hier erhielte es Rollen oder die Abteilungsleitung
const keinKindKonto = keinKindKontoVon(user.id);

// Ein Schema pro Route, mit keiner Route ausserhalb der Verwaltung geteilt
const anlegenSchema = z.strictObject({
  vorname: text(100),
  nachname: text(100),
  ceviName: ceviNameFeld.optional(),
  telefon: telefonSchema.optional(),
  benutzername: benutzernameFeld,
  admin: z.boolean(),
  rollen: rollenFeld,
  elternteilVon: elternteilVonFeld,
});
// name fasst «Vorname Nachname» in einem Feld, wie user.name beim Anlegen (#20)
const aendernSchema = z.strictObject({
  name: text(201).optional(),
  ceviName: ceviNameFeld.nullable().optional(),
  telefon: telefonSchema.optional(),
  admin: z.boolean().optional(),
  rollen: rollenFeld.optional(),
  elternteilVon: elternteilVonFeld.optional(),
});
const istSl = (r: { typ: string }) => r.typ === "stufenleitung";
const pfad = () => z.strictObject({ id: z.uuid() });

export function erstellePersonenRouten({
  db,
  auth,
}: {
  db: Db;
  auth: ReturnType<typeof erstelleAuth>;
}) {
  // Ziel in SQL auf die Abteilung der Sitzung gefiltert: fremde wie unbekannte IDs sind 404, erst danach zählt das Recht (#650: «Personen verwalten», nicht mehr nur die Abteilungsleitung)
  async function ladeZiel(person: Person, id: string) {
    const [ziel] = await db
      .select({ id: user.id, admin: sql<boolean>`${user.role} = 'admin'` })
      .from(user)
      .where(
        and(
          eq(user.id, id),
          eq(user.abteilungId, person.abteilungId),
          keinKindKonto,
        ),
      );
    if (!ziel) throw new HTTPException(404);
    await verlange(db, person, "personen.verwalten", {
      abteilungId: person.abteilungId,
    });
    // Eskalationsschutz: Die Konten der Abteilungsleitung betreut nur sie selbst
    if (ziel.admin && !person.admin) throw new HTTPException(403);
    return ziel;
  }

  // Zurücksetzen, aktivieren, deaktivieren und löschen übernehmen oder sperren ein Konto: Hat es Rechte (Rolle in einer Gruppe, Plattformrolle, Entwickler, Sonderrecht), betreut es nur die Abteilungsleitung, sonst gäbe «Personen verwalten» jedes Recht der Abteilung (#650, SR-10)
  async function schuetzeKonto(person: Person, id: string) {
    if (person.admin) return;
    if ((await geschuetzteKonten(db, person.abteilungId, [id])).has(id)) {
      throw new HTTPException(403);
    }
  }

  // Kinder, deren Eltern sich ändern: Wer Eltern einem Kind zuordnet, gibt ihnen Einblick in dessen Daten, also braucht er «Kinder verwalten» in der Stufe jedes Kindes (#650)
  async function verlangeKinderRecht(
    person: Person,
    kindIds: readonly string[],
  ) {
    if (kindIds.length === 0) return;
    const stufen = await db
      .selectDistinct({ stufeId: kind.stufeId })
      .from(kind)
      .where(
        and(
          inArray(kind.id, [...kindIds]),
          eq(kind.abteilungId, person.abteilungId),
        ),
      );
    for (const { stufeId } of stufen) {
      await verlange(
        db,
        person,
        "kinder.verwalten",
        stufeObjekt(person, stufeId),
      );
    }
  }

  // Was Rechte vergibt, bleibt bei der Abteilungsleitung: die Abteilungsleitung selbst und die Stufenrollen. Ein Rollen-Editor schickt das ganze Formular; geprüft wird nur, was sich ändert. Die Zuordnung zu Kindern braucht «Kinder verwalten» in deren Stufe (#650)
  async function pruefeRechteAenderung(
    person: Person,
    id: string,
    aenderung: z.infer<typeof aendernSchema>,
  ) {
    if (
      aenderung.admin === undefined &&
      aenderung.rollen === undefined &&
      aenderung.elternteilVon === undefined
    ) {
      return;
    }
    const [[bisher], rollen, eltern] = await Promise.all([
      db.select({ role: user.role }).from(user).where(eq(user.id, id)),
      db
        .select({ stufeId: rolle.stufeId, typ: rolle.typ })
        .from(rolle)
        .where(eq(rolle.userId, id)),
      db
        .select({ kindId: kindEltern.kindId })
        .from(kindEltern)
        .where(eq(kindEltern.userId, id)),
    ]);
    const adminGeaendert =
      aenderung.admin !== undefined &&
      (bisher.role === "admin") !== aenderung.admin;
    const alt = new Map(rollen.map((r) => [r.stufeId, r.typ]));
    const rollenGeaendert =
      aenderung.rollen !== undefined &&
      (alt.size !== aenderung.rollen.length ||
        aenderung.rollen.some((r) => alt.get(r.stufeId) !== r.typ));
    if (adminGeaendert || rollenGeaendert) {
      await verlange(db, person, "rechte.verwalten");
    }
    if (aenderung.elternteilVon !== undefined) {
      const vorher = new Set(eltern.map((e) => e.kindId));
      const nachher = new Set(aenderung.elternteilVon);
      await verlangeKinderRecht(person, [
        ...[...vorher].filter((k) => !nachher.has(k)),
        ...[...nachher].filter((k) => !vorher.has(k)),
      ]);
    }
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

  // Ziel gelistet und keine zweite aktive ID der Abteilungsleitung: die letzte Abteilungsleitung bleibt
  async function sperreLetztenAdmin(
    tx: Pick<Db, "select">,
    abteilungId: string,
    zielId: string,
  ) {
    const admins = await aktiveAdminIds(tx, abteilungId);
    if (istLetzterAdmin(admins, zielId)) throw new Konflikt("LETZTER_ADMIN");
  }

  // Neues Startpasswort setzen, alle Sitzungen beenden (Push-Tokens enden mit ihnen, #42), danach Pflichtwechsel, 7 Tage und Bremse von vorn
  async function setzeStartpasswortNeu(
    person: Person,
    id: string,
    aktion: string,
    weitereFelder: Partial<typeof user.$inferInsert> = {},
  ) {
    const startpasswort = erzeugeStartpasswort();
    await setzePasswort(auth, id, normalisiereStartpasswort(startpasswort));
    await beendeSitzungen(auth, id);
    await db.transaction(async (tx) => {
      await tx
        .update(user)
        .set({
          ...startpasswortFelder(new Date(), startpasswort),
          ...weitereFelder,
        })
        .where(eq(user.id, id));
      await protokolliere(tx, person, aktion, id);
    });
    return startpasswort;
  }

  return new Hono<{ Variables: { person: Person } }>()
    .get("/", async (c) => {
      const person = c.get("person");
      // «Personen verwalten» sieht alles, «Personen sehen» alles ausser den Startpasswörtern (#650)
      const sicht = await personenSicht(db, person);
      const abteilungId = person.abteilungId;
      const [personen, rollenZeilen, elternZeilen, stufen, kinder] =
        await Promise.all([
          db
            .select({
              id: user.id,
              name: user.name,
              ceviName: user.ceviName,
              telefon: user.telefon,
              benutzername: user.username,
              role: user.role,
              twoFactorEnabled: user.twoFactorEnabled,
              banned: user.banned,
              mussPasswortAendern: user.mussPasswortAendern,
              startpasswortGueltigBis: user.startpasswortGueltigBis,
              startpasswortVerschluesselt: user.startpasswortVerschluesselt,
              bildUrl,
            })
            .from(user)
            .leftJoin(profilbild, eq(profilbild.userId, user.id))
            .where(and(eq(user.abteilungId, abteilungId), keinKindKonto))
            .orderBy(asc(user.name), asc(user.id)),
          db
            .select({
              userId: rolle.userId,
              stufeId: rolle.stufeId,
              typ: rolle.typ,
              prioritaet: rolle.prioritaet,
            })
            .from(rolle)
            .innerJoin(
              stufe,
              and(
                eq(rolle.stufeId, stufe.id),
                eq(stufe.abteilungId, abteilungId),
              ),
            )
            .orderBy(asc(stufe.name), asc(stufe.id)),
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
            .select({
              id: stufe.id,
              name: stufe.name,
              kuerzel: stufe.kuerzel,
            })
            .from(stufe)
            .where(eq(stufe.abteilungId, abteilungId))
            .orderBy(asc(stufe.name), asc(stufe.id)),
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
      // Kinder nur der Stufen, die die Person sehen darf; die Zuordnung der Eltern nur zu diesen Kindern
      const sichtbareStufen = await sichtbareKinderStufen(
        db,
        person,
        kinder.map((k) => k.stufeId),
      );
      const sichtbareKinder = kinder.filter((k) =>
        sichtbareStufen.has(k.stufeId),
      );
      const kindIds = new Set(sichtbareKinder.map((k) => k.id));
      // Ein Startpasswort zeigt nur, wer Personen verwalten darf, und nur von Konten ohne Rechte, ausser der Abteilungsleitung (#650)
      const offeneStartpasswoerter = personen
        .filter(
          (p) =>
            p.mussPasswortAendern &&
            p.startpasswortGueltigBis &&
            p.startpasswortGueltigBis > new Date(),
        )
        .map((p) => p.id);
      const geschuetzt =
        sicht === "voll" && !person.admin && offeneStartpasswoerter.length > 0
          ? await geschuetzteKonten(db, abteilungId, offeneStartpasswoerter)
          : new Set<string>();
      // Nie email, banReason, Bremsfelder oder Geheimnisse und Codes des zweiten Faktors: Der Rollen-Editor braucht nur das hier
      return c.json({
        personen: personen.map((p) => ({
          id: p.id,
          name: p.name,
          ceviName: p.ceviName,
          bildUrl: p.bildUrl,
          telefon: p.telefon,
          benutzername: p.benutzername,
          admin: p.role === "admin",
          zweiterFaktor: p.twoFactorEnabled === true,
          deaktiviert: p.banned === true,
          mussPasswortAendern: p.mussPasswortAendern,
          startpasswortGueltigBis: p.startpasswortGueltigBis,
          // Nur solange es offen und gültig ist
          startpasswort:
            sicht === "voll" &&
            !geschuetzt.has(p.id) &&
            p.mussPasswortAendern &&
            p.startpasswortGueltigBis &&
            p.startpasswortGueltigBis > new Date()
              ? entschluesseleStartpasswort(p.startpasswortVerschluesselt)
              : null,
          rollen: rollenZeilen
            .filter((zeile) => zeile.userId === p.id)
            .map(({ stufeId, typ, prioritaet }) => ({
              stufeId,
              typ,
              prioritaet,
            })),
          elternteilVon: elternZeilen
            .filter(
              (zeile) => zeile.userId === p.id && kindIds.has(zeile.kindId),
            )
            .map((zeile) => zeile.kindId),
        })),
        stufen,
        kinder: sichtbareKinder,
      });
    })
    .post("/", eingabe("json", anlegenSchema), async (c) => {
      const person = c.get("person");
      await verlange(db, person, "personen.verwalten", {
        abteilungId: person.abteilungId,
      });
      const eingaben = c.req.valid("json");
      // Die Abteilungsleitung und die Stufenrollen sind Rechte: Sie vergibt nur, wer Rechte vergeben darf (#650)
      if (eingaben.admin || eingaben.rollen.length > 0) {
        await verlange(db, person, "rechte.verwalten");
      }
      await pruefeIds(person, eingaben.rollen, eingaben.elternteilVon);
      await verlangeKinderRecht(person, eingaben.elternteilVon);
      if (eingaben.telefon && !eingaben.rollen.some(istSl)) {
        throw new HTTPException(400);
      }
      const startpasswort = erzeugeStartpasswort();
      try {
        const angelegt = await db.transaction((tx) =>
          legePersonAn(tx, person, {
            ...eingaben,
            startpasswort,
          }),
        );
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
        await pruefeRechteAenderung(person, id, aenderung);
        // Eine Nummer speichern nur SL, gemessen an den Rollen nach dieser Änderung; entfernen geht immer
        if (aenderung.telefon) {
          const [sl] = aenderung.rollen
            ? aenderung.rollen.filter(istSl)
            : await db
                .select({ id: rolle.userId })
                .from(rolle)
                .where(
                  and(eq(rolle.userId, id), eq(rolle.typ, "stufenleitung")),
                )
                .limit(1);
          if (!sl) throw new HTTPException(400);
        }
        try {
          await db.transaction(async (tx) => {
            if (aenderung.admin === false) {
              await sperreLetztenAdmin(tx, person.abteilungId, id);
            }
            const felder: Partial<{
              name: string;
              ceviName: string | null;
              telefon: string | null;
              role: string;
            }> = {};
            // Nur geänderte Schlüssel; ein No-op des Rollen-Editors schreibt keinen Eintrag
            const details: Record<string, unknown> = {};
            let telefonDetails: Record<string, unknown> | undefined;
            if (aenderung.name !== undefined) felder.name = aenderung.name;
            if (aenderung.ceviName !== undefined) {
              felder.ceviName = aenderung.ceviName;
            }
            if (aenderung.telefon !== undefined) {
              felder.telefon = aenderung.telefon;
              const [bisher] = await tx
                .select({ telefon: user.telefon })
                .from(user)
                .where(eq(user.id, id));
              if (bisher.telefon !== aenderung.telefon) {
                // Nie die Nummer selbst ins Log
                telefonDetails = {
                  telefon: aenderung.telefon ? "gesetzt" : "entfernt",
                };
              }
            }
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
                // Direkt in person_tag: Über die Sicht «rolle» scheitert der Upsert (500), wenn die Person am Stufen-Tag schon eine freie Rolle trägt
                await tx
                  .insert(personTag)
                  .values(
                    aenderung.rollen.map((r) => ({
                      userId: id,
                      tagId: r.stufeId,
                      rolle: r.typ,
                    })),
                  )
                  .onConflictDoUpdate({
                    target: [personTag.userId, personTag.tagId],
                    set: { rolle: sql`excluded.rolle` },
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
            if (telefonDetails) {
              await protokolliere(
                tx,
                person,
                "telefon_geaendert",
                id,
                telefonDetails,
              );
            }
          });
        } catch (fehler) {
          if (fehler instanceof Konflikt) {
            return c.json(KONFLIKT[fehler.konflikt], 409);
          }
          throw fehler;
        }
        // Die Website zeigt oder vergisst die Person nach ihrer Rolle und ihrem Namen beim nächsten Abgleich (#610)
        if (
          aenderung.rollen !== undefined ||
          aenderung.ceviName !== undefined ||
          aenderung.name !== undefined
        ) {
          meldeWebsiteEreignis({
            art: "seite_geaendert",
            abteilungId: person.abteilungId,
          });
        }
        return c.body(null, 204);
      },
    )
    .delete("/:id/bild", eingabe("param", pfad()), async (c) => {
      // Entfernt das Profilbild einer Person (sie setzt es selbst). Erst das Objekt (404, auch fremde Abteilung), dann das Recht (403). Ohne Bild ebenfalls 204; der Protokolleintrag nennt nur die Person, nie das Bild
      const person = c.get("person");
      const { id } = c.req.valid("param");
      const [ziel] = await db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, id), eq(user.abteilungId, person.abteilungId)));
      if (!ziel) throw new HTTPException(404);
      // Das Recht «profilbild.entfernen» (Katalog): Abteilungsleitung und Entwickler, beide mit zweitem Faktor; die einzige Stelle dieser Regel
      await verlange(db, person, "profilbild.entfernen");
      const entfernt = await db.transaction(async (tx) => {
        const weg = await tx
          .delete(profilbild)
          .where(eq(profilbild.userId, id))
          .returning({ userId: profilbild.userId });
        if (weg.length > 0) {
          await protokolliere(tx, person, "profilbild_entfernt", id);
        }
        return weg.length > 0;
      });
      // Die Website vergisst das Bild beim nächsten Abgleich (Leitungsteams zeigen es)
      if (entfernt) {
        meldeWebsiteEreignis({
          art: "seite_geaendert",
          abteilungId: person.abteilungId,
        });
      }
      return c.body(null, 204);
    })
    .post("/:id/startpasswort", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      await ladeZiel(person, id);
      await schuetzeKonto(person, id);
      // Vor jedem Aufruf: Ein Reset auf sich selbst meldete die Abteilungsleitung ab, bevor das Passwort notiert ist
      if (id === person.id) return c.json(KONFLIKT.EIGENES_KONTO, 409);
      return c.json({
        startpasswort: await setzeStartpasswortNeu(
          person,
          id,
          "startpasswort_neu",
        ),
      });
    })
    .post("/:id/deaktivieren", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      await ladeZiel(person, id);
      await schuetzeKonto(person, id);
      if (id === person.id) return c.json(KONFLIKT.EIGENES_KONTO, 409);
      try {
        await db.transaction(async (tx) => {
          await sperreLetztenAdmin(tx, person.abteilungId, id);
          // Vor banUser: Scheitert das, nimmt die Transaktion den Eintrag zurück
          await protokolliere(tx, person, "person_deaktiviert", id);
          // banUser löscht auch die Sitzungen und läuft auf eigener Verbindung; die Transaktion fasst vorher keine Zeile der Zielperson an, sonst drohte ein Deadlock
          await sperreKonto(auth, id);
          await tx
            .update(user)
            .set({ deaktiviertAm: sql`now()` })
            .where(eq(user.id, id));
          // Das Profilbild geht mit dem Deaktivieren; Aktivieren bringt es nicht zurück (#173)
          await tx.delete(profilbild).where(eq(profilbild.userId, id));
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
      await schuetzeKonto(person, id);
      if (id === person.id) return c.json(KONFLIKT.EIGENES_KONTO, 409);
      // Zuerst das neue Startpasswort, dann die Sperre weg: Scheitert ein Schritt, bleibt das alte Passwort ungültig und die Person gesperrt. Das alte konnte während der Sperre in falsche Hände geraten (#226)
      const startpasswort = await setzeStartpasswortNeu(
        person,
        id,
        "person_aktiviert",
        { deaktiviertAm: null },
      );
      await entsperreKonto(auth, id);
      return c.json({ startpasswort });
    })
    .post(
      "/:id/zweiter-faktor-zuruecksetzen",
      eingabe("param", pfad()),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        await ladeZiel(person, id);
        await schuetzeKonto(person, id);
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
      // Konto löschen ist fest (konto.loeschen): nur die Abteilungsleitung (#650)
      await verlange(db, person, "konto.loeschen");
      if (id === person.id) return c.json(KONFLIKT.EIGENES_KONTO, 409);
      try {
        await db.transaction(async (tx) => {
          await sperreLetztenAdmin(tx, person.abteilungId, id);
          await protokolliere(tx, person, "person_geloescht", id);
          // Ohne Fremdschlüssel: Der zweite Faktor legt die Person-ID als Wert ab; better-auth räumt sie nicht weg
          await tx.delete(verification).where(eq(verification.value, id));
          // removeUser läuft auf eigener Verbindung; Rollen, Kinder-Verknüpfungen und Sitzungen löscht die Datenbank per CASCADE
          await entferneKonto(auth, id);
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

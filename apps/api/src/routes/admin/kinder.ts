import { isAPIError } from "better-auth/api";
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { erstelleAuth } from "../../auth.js";
import {
  BENUTZERNAME_MAX,
  BENUTZERNAME_MIN,
  BENUTZERNAME_MUSTER,
} from "../../benutzername.js";
import { ceviNameFeld } from "../../cevi-name.js";
import type { Db } from "../../db/client.js";
import {
  auditLog,
  KIND_CHAT_ARTEN,
  kind,
  kindEltern,
  kindKontoEinstellung,
  stufe,
  user,
  verification,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { ladeKindKontoEinstellung, zugangVon } from "../../kind-konto.js";
import { legePersonAn } from "../../personen-anlegen.js";
import { darf, verlange } from "../../rechtemodell/darf.js";
import {
  sichtbareKinderStufen,
  stufeObjekt,
  verlangeEines,
} from "../../rechtemodell/personenrechte.js";
import type { Person } from "../../rechte.js";
import {
  entschluesseleStartpasswort,
  erzeugeStartpasswort,
  normalisiereStartpasswort,
  startpasswortFelder,
} from "../../startpasswort.js";

const text = z.string().trim().min(1).max(100);
const elternFeld = z
  .array(z.uuid())
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length);

// Ein Schema pro Route, mit keiner Nicht-Admin-Route geteilt
const anlegenSchema = z.strictObject({
  vorname: text,
  nachname: text,
  ceviName: ceviNameFeld.optional(),
  stufeId: z.uuid(),
});
const aendernSchema = z.strictObject({
  vorname: text.optional(),
  nachname: text.optional(),
  ceviName: ceviNameFeld.nullable().optional(),
  stufeId: z.uuid().optional(),
  aktiv: z.boolean().optional(),
  eltern: elternFeld.optional(),
});
const pfad = () => z.strictObject({ id: z.uuid() });

// Konto eines Kindes (#644). Das Datum, an dem die Abteilung die Eltern informiert hat, ist Pflicht: der Vermerk ersetzt keine Einwilligung, er hält fest, dass jemand die Eltern gefragt hat
const datum = z.iso.date();
const kontoAnlegenSchema = z.strictObject({
  benutzername: z
    .string()
    .min(BENUTZERNAME_MIN)
    .max(BENUTZERNAME_MAX)
    .regex(BENUTZERNAME_MUSTER),
  elternInformiertAm: datum,
  elternEinsicht: z.boolean().optional(),
});
const kontoAendernSchema = z.strictObject({ elternEinsicht: z.boolean() });
const einstellungSchema = z.strictObject({
  erlaubt: z.boolean(),
  chat: z.enum(KIND_CHAT_ARTEN),
  mindestalter: z.number().int().min(6).max(18).nullable(),
  elternEinsichtVorgabe: z.boolean(),
});

const KONFLIKT = {
  KONTEN_AUS: {
    code: "KONTEN_AUS",
    message:
      "Konten für Kinder sind ausgeschaltet. Schalte sie in den Einstellungen ein.",
  },
  KIND_INAKTIV: {
    code: "KIND_INAKTIV",
    message: "Das Kind ist inaktiv. Aktiviere es zuerst.",
  },
  KONTO_VORHANDEN: {
    code: "KONTO_VORHANDEN",
    message: "Das Kind hat schon ein eigenes Konto.",
  },
  BENUTZERNAME_VERGEBEN: {
    code: "BENUTZERNAME_VERGEBEN",
    message: "Dieser Benutzername ist schon vergeben.",
  },
  DATUM_UNGUELTIG: {
    code: "DATUM_UNGUELTIG",
    message: "Das Datum liegt in der Zukunft oder zu weit zurück.",
  },
  ZU_VIELE_KONTEN: {
    code: "ZU_VIELE_KONTEN",
    message: "Zu viele neue Konten in kurzer Zeit. Versuche es später wieder.",
  },
} as const;

// So viele Konten für Kinder darf eine Abteilungsleitung pro Stunde erstellen: Jedes Konto hasht ein Passwort, und die Drosselung hält einen Fehlgriff oder ein gestohlenes Konto klein (SR-71)
const KONTEN_JE_STUNDE = 20;
// Der Vermerk reicht höchstens ein Jahr zurück
const VERMERK_TAGE = 366;

class Konflikt extends Error {
  constructor(public konflikt: keyof typeof KONFLIKT) {
    super(KONFLIKT[konflikt].message);
  }
}

type Tx = Pick<Db, "select" | "insert">;

export function erstelleKinderRouten({
  db,
  auth,
}: {
  db: Db;
  auth: ReturnType<typeof erstelleAuth>;
}) {
  // In SQL auf die Abteilung der Sitzung gefiltert: fremde wie unbekannte IDs sind 404, erst danach zählt das Recht
  const KONTO_RECHT = "kinder.konto_verwalten";
  async function ladeZiel(person: Person, id: string, konto = false) {
    const [ziel] = await db
      .select({
        stufeId: kind.stufeId,
        inaktivSeit: kind.inaktivSeit,
        userId: kind.userId,
        vorname: kind.vorname,
        nachname: kind.nachname,
        ceviName: kind.ceviName,
      })
      .from(kind)
      .where(and(eq(kind.id, id), eq(kind.abteilungId, person.abteilungId)));
    if (!ziel) throw new HTTPException(404);
    // Konten von Kindern prüft der Rechtekatalog (fest: nur die Abteilungsleitung); das Kind selbst «Kinder verwalten» in seiner Stufe: «eigene» sind die Kinder der Stufe der Rolle (#650)
    if (konto) await verlange(db, person, KONTO_RECHT);
    else {
      await verlange(
        db,
        person,
        "kinder.verwalten",
        stufeObjekt(person, ziel.stufeId),
      );
    }
    return ziel;
  }

  // Eine fremde oder unbekannte Stufe ist eine ungültige Eingabe, vor jedem Schreibzugriff geprüft
  async function pruefeStufe(person: Person, stufeId: string) {
    const [eigene] = await db
      .select({ id: stufe.id })
      .from(stufe)
      .where(
        and(eq(stufe.id, stufeId), eq(stufe.abteilungId, person.abteilungId)),
      );
    if (!eigene) throw new HTTPException(400);
  }

  async function pruefeEltern(person: Person, eltern: readonly string[]) {
    if (eltern.length === 0) return;
    const eigene = await db
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          inArray(user.id, [...eltern]),
          eq(user.abteilungId, person.abteilungId),
        ),
      );
    if (eigene.length !== eltern.length) throw new HTTPException(400);
  }

  // Jede Rollenänderung wird protokolliert (#22): ein Eintrag je Elternteil mit dessen neuer Kinderliste, ohne Namen
  async function protokolliere(
    tx: Tx,
    person: Person,
    elternIds: readonly string[],
  ) {
    if (elternIds.length === 0) return;
    const links = await tx
      .select({ userId: kindEltern.userId, kindId: kindEltern.kindId })
      .from(kindEltern)
      .where(inArray(kindEltern.userId, [...elternIds]))
      .orderBy(asc(kindEltern.kindId));
    await tx.insert(auditLog).values(
      elternIds.map((userId) => ({
        abteilungId: person.abteilungId,
        akteurId: person.id,
        aktion: "rolle_geaendert",
        zielTyp: "person",
        zielId: userId,
        details: {
          elternteilVon: links
            .filter((l) => l.userId === userId)
            .map((l) => l.kindId),
        },
      })),
    );
  }

  // Ein Eintrag je Aktion am Kind; details nur mit IDs, Flags und Daten, nie mit Namen
  const protokolliereKonto = (
    tx: Pick<Db, "insert">,
    person: Person,
    aktion: string,
    kindId: string,
    details?: Record<string, unknown>,
  ) =>
    tx.insert(auditLog).values({
      abteilungId: person.abteilungId,
      akteurId: person.id,
      aktion,
      zielTyp: "kind",
      zielId: kindId,
      details,
    });

  // Das Konto des Kindes oder 404: Die Aktionen am Konto gibt es nur, wenn es eines gibt
  async function ladeKonto(person: Person, id: string) {
    const ziel = await ladeZiel(person, id, true);
    if (!ziel.userId) throw new HTTPException(404);
    return { ...ziel, userId: ziel.userId };
  }

  // Neues Startpasswort, alle Sitzungen weg, Pflichtwechsel, 7 Tage und Bremse von vorn (wie bei den Personen)
  async function setzeStartpasswortNeu(
    headers: Headers,
    person: Person,
    kindId: string,
    userId: string,
    aktion: string,
    weitereFelder: Partial<typeof user.$inferInsert> = {},
  ) {
    const startpasswort = erzeugeStartpasswort();
    await auth.api.setUserPassword({
      body: {
        userId,
        newPassword: normalisiereStartpasswort(startpasswort),
      },
      headers,
    });
    await auth.api.revokeUserSessions({ body: { userId }, headers });
    await db.transaction(async (tx) => {
      await tx
        .update(user)
        .set({
          ...startpasswortFelder(new Date(), startpasswort),
          ...weitereFelder,
        })
        .where(eq(user.id, userId));
      await protokolliereKonto(tx, person, aktion, kindId);
    });
    return startpasswort;
  }

  // Konto weg: Der Benutzer geht mit Sitzungen und Nachrichten (CASCADE), die Verknüpfung am Kind wird per SET NULL leer. Der zweite Faktor legt die Person-ID als Wert ab; better-auth räumt sie nicht weg
  async function entferneKonto(headers: Headers, userId: string) {
    await db.delete(verification).where(eq(verification.value, userId));
    await auth.api.removeUser({ body: { userId }, headers });
  }

  return (
    new Hono<{ Variables: { person: Person } }>()
      .get("/", async (c) => {
        const person = c.get("person");
        // Die Tür: Kinder sehen oder verwalten, irgendwo; welche Stufen, entscheidet die Liste unten (#650)
        await verlangeEines(db, person, ["kinder.sehen", "kinder.verwalten"]);
        const abteilungId = person.abteilungId;
        const [kinder, links, konten, einstellung] = await Promise.all([
          db
            .select({
              id: kind.id,
              vorname: kind.vorname,
              nachname: kind.nachname,
              ceviName: kind.ceviName,
              stufeId: kind.stufeId,
              inaktivSeit: kind.inaktivSeit,
              userId: kind.userId,
              kontoSeit: kind.kontoSeit,
              elternInformiertAm: kind.elternInformiertAm,
              elternEinsicht: kind.elternEinsicht,
            })
            .from(kind)
            .where(eq(kind.abteilungId, abteilungId))
            .orderBy(asc(kind.nachname), asc(kind.vorname), asc(kind.id)),
          db
            .select({ kindId: kindEltern.kindId, userId: kindEltern.userId })
            .from(kindEltern)
            .innerJoin(
              kind,
              and(
                eq(kindEltern.kindId, kind.id),
                eq(kind.abteilungId, abteilungId),
              ),
            )
            .innerJoin(
              user,
              and(
                eq(kindEltern.userId, user.id),
                eq(user.abteilungId, abteilungId),
              ),
            )
            .orderBy(asc(kindEltern.userId)),
          // Nur die Konten dieser Kinder: Benutzername und Stand, nie Bremsfelder oder Geheimnisse
          db
            .select({
              id: user.id,
              benutzername: user.username,
              banned: user.banned,
              mussPasswortAendern: user.mussPasswortAendern,
              startpasswortGueltigBis: user.startpasswortGueltigBis,
              startpasswortVerschluesselt: user.startpasswortVerschluesselt,
            })
            .from(user)
            .innerJoin(kind, eq(kind.userId, user.id))
            .where(eq(user.abteilungId, abteilungId)),
          ladeKindKontoEinstellung(db, abteilungId),
        ]);
        // Nur die Kinder der Stufen, die die Person sehen darf; die Konten der Kinder (Benutzername, Startpasswort, Einstellung) nur mit dem festen Recht dafür
        const sichtbar = await sichtbareKinderStufen(
          db,
          person,
          kinder.map((k) => k.stufeId),
        );
        const mitKonten = await darf(db, person, KONTO_RECHT);
        // Keine Daten: Die Datumsfelder liest #48 in SQL
        return c.json({
          kinder: kinder
            .filter((k) => sichtbar.has(k.stufeId))
            .map((k) => {
              const eltern = links
                .filter((l) => l.kindId === k.id)
                .map((l) => l.userId);
              const konto = k.userId
                ? konten.find((z) => z.id === k.userId)
                : undefined;
              return {
                id: k.id,
                vorname: k.vorname,
                nachname: k.nachname,
                ceviName: k.ceviName,
                stufeId: k.stufeId,
                aktiv: k.inaktivSeit === null,
                eltern,
                zugang: zugangVon(eltern.length, !!konto, k.elternEinsicht),
                konto:
                  konto && mitKonten
                    ? {
                        benutzername: konto.benutzername,
                        gesperrt: konto.banned === true,
                        mussPasswortAendern: konto.mussPasswortAendern,
                        // Nur solange es offen und gültig ist
                        startpasswort:
                          konto.mussPasswortAendern &&
                          konto.startpasswortGueltigBis &&
                          konto.startpasswortGueltigBis > new Date()
                            ? entschluesseleStartpasswort(
                                konto.startpasswortVerschluesselt,
                              )
                            : null,
                        seit: k.kontoSeit,
                        elternInformiertAm: k.elternInformiertAm,
                        elternEinsicht: k.elternEinsicht,
                      }
                    : null,
              };
            }),
          einstellung,
        });
      })
      .get("/konto-einstellung", async (c) => {
        const person = c.get("person");
        await verlange(db, person, KONTO_RECHT);
        return c.json(await ladeKindKontoEinstellung(db, person.abteilungId));
      })
      .put(
        "/konto-einstellung",
        eingabe("json", einstellungSchema),
        async (c) => {
          const person = c.get("person");
          await verlange(db, person, KONTO_RECHT);
          const werte = c.req.valid("json");
          await db.transaction(async (tx) => {
            await tx
              .insert(kindKontoEinstellung)
              .values({ abteilungId: person.abteilungId, ...werte })
              .onConflictDoUpdate({
                target: kindKontoEinstellung.abteilungId,
                set: werte,
              });
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "kind_konto_einstellung_geaendert",
              zielTyp: "abteilung",
              zielId: person.abteilungId,
              details: werte,
            });
          });
          return c.body(null, 204);
        },
      )
      .post("/", eingabe("json", anlegenSchema), async (c) => {
        const person = c.get("person");
        const eingaben = c.req.valid("json");
        await verlange(
          db,
          person,
          "kinder.verwalten",
          stufeObjekt(person, eingaben.stufeId),
        );
        await pruefeStufe(person, eingaben.stufeId);
        const [neu] = await db
          .insert(kind)
          .values({ ...eingaben, abteilungId: person.abteilungId })
          .returning({ id: kind.id });
        return c.json({ id: neu.id }, 201);
      })
      .patch(
        "/:id",
        eingabe("param", pfad()),
        eingabe("json", aendernSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const { aktiv, eltern, ...aenderung } = c.req.valid("json");
          const bisher = await ladeZiel(person, id);
          if (aenderung.stufeId !== undefined) {
            // Ein Kind in eine andere Stufe zu setzen, braucht das Recht auch dort (#650)
            if (aenderung.stufeId !== bisher.stufeId) {
              await verlange(
                db,
                person,
                "kinder.verwalten",
                stufeObjekt(person, aenderung.stufeId),
              );
            }
            await pruefeStufe(person, aenderung.stufeId);
          }
          if (eltern) await pruefeEltern(person, eltern);
          await db.transaction(async (tx) => {
            // Die App schickt das ganze Formular: Nur echte Änderungen setzen die Zeitpunkte, auf die die Chat-Sicht baut (#48)
            const felder: Partial<typeof aenderung> & {
              stufeSeit?: SQL;
              inaktivSeit?: SQL | null;
            } = { ...aenderung };
            if (aenderung.stufeId === bisher.stufeId) {
              delete felder.stufeId;
            } else if (aenderung.stufeId !== undefined) {
              felder.stufeSeit = sql`now()`;
            }
            if (aktiv === false && bisher.inaktivSeit === null) {
              felder.inaktivSeit = sql`now()`;
            } else if (aktiv === true && bisher.inaktivSeit !== null) {
              felder.inaktivSeit = null;
            }
            // Ohne Schlüssel wirft Drizzle bei set({}): kein Schreibzugriff
            if (Object.keys(felder).length > 0) {
              await tx.update(kind).set(felder).where(eq(kind.id, id));
            }
            if (eltern) {
              const vorhanden = (
                await tx
                  .select({ userId: kindEltern.userId })
                  .from(kindEltern)
                  .where(eq(kindEltern.kindId, id))
              ).map((zeile) => zeile.userId);
              const weg = vorhanden.filter((u) => !eltern.includes(u));
              // Nur die Differenz: Unveränderte Zeilen behalten erstellt_am, wo die Chat-Sicht der Eltern beginnt
              const neu = eltern.filter((u) => !vorhanden.includes(u));
              if (weg.length > 0) {
                await tx
                  .delete(kindEltern)
                  .where(
                    and(
                      eq(kindEltern.kindId, id),
                      inArray(kindEltern.userId, weg),
                    ),
                  );
              }
              if (neu.length > 0) {
                await tx
                  .insert(kindEltern)
                  .values(neu.map((userId) => ({ kindId: id, userId })))
                  .onConflictDoNothing();
              }
              await protokolliere(tx, person, [...weg, ...neu]);
            }
          });
          return c.body(null, 204);
        },
      )
      .post(
        "/:id/konto",
        eingabe("param", pfad()),
        eingabe("json", kontoAnlegenSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const eingaben = c.req.valid("json");
          const ziel = await ladeZiel(person, id, true);
          const einstellung = await ladeKindKontoEinstellung(
            db,
            person.abteilungId,
          );
          if (!einstellung.erlaubt) return c.json(KONFLIKT.KONTEN_AUS, 409);
          if (ziel.inaktivSeit) return c.json(KONFLIKT.KIND_INAKTIV, 409);
          if (ziel.userId) return c.json(KONFLIKT.KONTO_VORHANDEN, 409);
          // Heute und höchstens ein Jahr zurück, nach Schweizer Zeit; ein Datum in der Zukunft wäre kein Vermerk
          const heute = new Date().toLocaleDateString("sv-SE", {
            timeZone: "Europe/Zurich",
          });
          const fruehestens = new Date(
            Date.now() - VERMERK_TAGE * 86_400_000,
          ).toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
          if (
            eingaben.elternInformiertAm > heute ||
            eingaben.elternInformiertAm < fruehestens
          ) {
            return c.json(KONFLIKT.DATUM_UNGUELTIG, 400);
          }
          const [{ anzahl }] = await db
            .select({ anzahl: count() })
            .from(auditLog)
            .where(
              and(
                eq(auditLog.akteurId, person.id),
                eq(auditLog.aktion, "kind_konto_erstellt"),
                gt(auditLog.erstelltAm, sql`now() - interval '1 hour'`),
              ),
            );
          if (anzahl >= KONTEN_JE_STUNDE) {
            return c.json(KONFLIKT.ZU_VIELE_KONTEN, 429);
          }
          const startpasswort = erzeugeStartpasswort();
          const elternEinsicht =
            eingaben.elternEinsicht ?? einstellung.elternEinsichtVorgabe;
          try {
            const benutzername = await db.transaction(async (tx) => {
              const angelegt = await legePersonAn(
                tx,
                person,
                c.req.raw.headers,
                {
                  vorname: ziel.vorname,
                  nachname: ziel.nachname,
                  ceviName: ziel.ceviName,
                  benutzername: eingaben.benutzername,
                  admin: false,
                  rollen: [],
                  elternteilVon: [],
                  startpasswort,
                },
              );
              // Nur wenn noch kein Konto da ist: Zwei gleichzeitige Anfragen legen nie zwei an
              const gesetzt = await tx
                .update(kind)
                .set({
                  userId: angelegt.id,
                  kontoSeit: sql`now()`,
                  elternInformiertAm: eingaben.elternInformiertAm,
                  elternEinsicht,
                })
                .where(and(eq(kind.id, id), isNull(kind.userId)))
                .returning({ id: kind.id });
              if (gesetzt.length === 0) throw new Konflikt("KONTO_VORHANDEN");
              await protokolliereKonto(tx, person, "kind_konto_erstellt", id, {
                elternInformiertAm: eingaben.elternInformiertAm,
                elternEinsicht,
              });
              return angelegt.benutzername;
            });
            // 201 erst nach dem Commit: Ein zurückgenommenes Startpasswort darf die Antwort nie erreichen
            return c.json({ benutzername, startpasswort }, 201);
          } catch (fehler) {
            if (fehler instanceof Konflikt) {
              return c.json(KONFLIKT[fehler.konflikt], 409);
            }
            if (
              isAPIError(fehler) &&
              fehler.body?.code === "USERNAME_IS_ALREADY_TAKEN"
            ) {
              return c.json(KONFLIKT.BENUTZERNAME_VERGEBEN, 409);
            }
            throw fehler;
          }
        },
      )
      // «Konto übergeben»: Die Eltern behalten die Einsicht oder nicht. Die Verknüpfung der Eltern bleibt in beiden Fällen bestehen
      .patch(
        "/:id/konto",
        eingabe("param", pfad()),
        eingabe("json", kontoAendernSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const { elternEinsicht } = c.req.valid("json");
          await ladeKonto(person, id);
          await db.transaction(async (tx) => {
            await tx
              .update(kind)
              .set({ elternEinsicht })
              .where(eq(kind.id, id));
            await protokolliereKonto(
              tx,
              person,
              "kind_konto_eltern_einsicht",
              id,
              { elternEinsicht },
            );
          });
          return c.body(null, 204);
        },
      )
      .post("/:id/konto/startpasswort", eingabe("param", pfad()), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const ziel = await ladeKonto(person, id);
        return c.json({
          startpasswort: await setzeStartpasswortNeu(
            c.req.raw.headers,
            person,
            id,
            ziel.userId,
            "kind_konto_startpasswort_neu",
          ),
        });
      })
      .post("/:id/konto/sperren", eingabe("param", pfad()), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const ziel = await ladeKonto(person, id);
        await db.transaction(async (tx) => {
          // Vor banUser: Scheitert das, nimmt die Transaktion den Eintrag zurück
          await protokolliereKonto(tx, person, "kind_konto_gesperrt", id);
          // banUser löscht auch die Sitzungen und läuft auf eigener Verbindung; die Transaktion fasst vorher keine Zeile des Kontos an, sonst drohte ein Deadlock
          await auth.api.banUser({
            body: { userId: ziel.userId },
            headers: c.req.raw.headers,
          });
          await tx
            .update(user)
            .set({ deaktiviertAm: sql`now()` })
            .where(eq(user.id, ziel.userId));
        });
        return c.body(null, 204);
      })
      .post("/:id/konto/entsperren", eingabe("param", pfad()), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const ziel = await ladeKonto(person, id);
        // Zuerst das neue Startpasswort, dann die Sperre weg: Scheitert ein Schritt, bleibt das alte Passwort ungültig und das Konto gesperrt
        const startpasswort = await setzeStartpasswortNeu(
          c.req.raw.headers,
          person,
          id,
          ziel.userId,
          "kind_konto_entsperrt",
          { deaktiviertAm: null },
        );
        await auth.api.unbanUser({
          body: { userId: ziel.userId },
          headers: c.req.raw.headers,
        });
        return c.json({ startpasswort });
      })
      // Konto entfernen: Das Kind bleibt, das Konto geht mit seinen Nachrichten. Die Eltern sehen danach wieder, was sie vorher sahen
      .delete("/:id/konto", eingabe("param", pfad()), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const ziel = await ladeKonto(person, id);
        await entferneKonto(c.req.raw.headers, ziel.userId);
        await db.transaction(async (tx) => {
          await tx
            .update(kind)
            .set({
              userId: null,
              kontoSeit: null,
              elternInformiertAm: null,
              elternEinsicht: true,
            })
            .where(eq(kind.id, id));
          await protokolliereKonto(tx, person, "kind_konto_entfernt", id);
        });
        return c.body(null, 204);
      })
      .delete("/:id", eingabe("param", pfad()), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const ziel = await ladeZiel(person, id);
        // Das Konto geht mit dem Kind. Zuerst das Konto: Es setzt kind.user_id per SET NULL, und das braucht die Zeile des Kindes noch ungesperrt
        if (ziel.userId) await entferneKonto(c.req.raw.headers, ziel.userId);
        await db.transaction(async (tx) => {
          // Vor dem Löschen lesen: kind_eltern verschwindet per CASCADE
          const eltern = (
            await tx
              .select({ userId: kindEltern.userId })
              .from(kindEltern)
              .where(eq(kindEltern.kindId, id))
          ).map((zeile) => zeile.userId);
          await tx.delete(kind).where(eq(kind.id, id));
          await protokolliere(tx, person, eltern);
        });
        return c.body(null, 204);
      })
  );
}

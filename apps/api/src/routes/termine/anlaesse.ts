import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  anlass,
  anlassAnmeldung,
  anlassFeld,
  auditLog,
  kind,
  kindZugang,
  programm,
  tag,
  user,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  MAX_ANTWORT_SCHLUESSEL,
  pruefeAntworten,
} from "../../termine/anlass-antworten.js";
import {
  anlassSichtbar,
  anmeldungOffenSql,
} from "../../termine/anlass-sicht.js";
import type { Person } from "../../rechte.js";
import type { TermineEnv } from "./index.js";

// Anmeldung zu einem Anlass über das Konto (#443, Epic #430): Vorlage, Anmelden, Ändern, Abmelden.
// Wer den Anlass sehen darf (termine/anlass-anmeldungen.ts, sichtbarkeit.ts), darf sich anmelden; bei «kind» melden Eltern nur ihre eigenen aktiven Kinder an, bei «person» jede Person sich selbst. Alles andere ist 404.
// Abfragen: GET 2 (Anlass mit Termin, Name und Feldern; Teilnehmende mit Anmeldungen), PUT höchstens 4 und DELETE höchstens 4 in einer Transaktion (Anlass sperren und lesen, Kind prüfen, Schreiben, Audit). Nie je Kind.

const pfadSchema = z.strictObject({ id: z.uuid() });
const putSchema = z.strictObject({
  kindId: z.uuid().optional(),
  // Die Werte prüft pruefeAntworten gegen die Felder; hier nur die Form (höchstens so viele Schlüssel wie ein Anlass Felder hat)
  antworten: z
    .record(z.string().max(60), z.unknown())
    .refine((a) => Object.keys(a).length <= MAX_ANTWORT_SCHLUESSEL),
});
const deleteSchema = z.strictObject({ kindId: z.uuid().optional() });

const ANMELDUNG_GESCHLOSSEN = {
  code: "ANMELDUNG_GESCHLOSSEN",
  message: "Die Anmeldung ist geschlossen.",
} as const;
const KIND_PFLICHT = {
  code: "KIND_ID_PFLICHT",
  message: "Bei diesem Anlass gehört die Anmeldung zu einem Kind.",
} as const;
const KIND_VERBOTEN = {
  code: "KIND_ID_VERBOTEN",
  message: "Bei diesem Anlass meldet sich die Person selbst an.",
} as const;
const ANTWORTEN_UNGUELTIG = {
  code: "ANTWORTEN_UNGUELTIG",
  message: "Die Antworten passen nicht zu den Feldern des Anlasses.",
} as const;

// Je Person höchstens so viele Anmeldungen und Abmeldungen je Minute
export const ANFRAGEN_PRO_MINUTE = 30;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function erstelleAnlaesseRouten({ db }: { db: Db }) {
  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const anfragen = new Map<string, number[]>();
  const zuViele = (personId: string) => {
    const jetzt = Date.now();
    const liste = (anfragen.get(personId) ?? []).filter(
      (t) => jetzt - t < 60_000,
    );
    const voll = liste.length >= ANFRAGEN_PRO_MINUTE;
    if (!voll) liste.push(jetzt);
    if (liste.length > 0) anfragen.set(personId, liste);
    else anfragen.delete(personId);
    return voll;
  };

  // Der Anlass mit Termin, Name der Person und allen Feldern in einer Abfrage, nur wenn die Person ihn sehen darf (fremd, unbekannt und unsichtbar sind 404). Mit sperren hält die Transaktion den Anlass fest (FOR SHARE): Die Verwaltung ändert Felder und «anmeldungFuer» nur mit FOR UPDATE und wartet, bis die Anmeldung committet ist
  async function ladeAnlass(
    q: Db | Tx,
    person: Person,
    id: string,
    sperren = false,
  ) {
    const abfrage = q
      .select({
        id: anlass.id,
        programmId: anlass.programmId,
        titel: programm.titel,
        ganztaegig: programm.ganztaegig,
        beginn: programm.beginn,
        ende: programm.ende,
        tagVon: programm.tagVon,
        tagBis: programm.tagBis,
        anmeldungFuer: anlass.anmeldungFuer,
        frist: anlass.frist,
        offen: anmeldungOffenSql,
        name: user.name,
        ceviName: user.ceviName,
        feld: {
          schluessel: anlassFeld.schluessel,
          beschriftung: anlassFeld.beschriftung,
          typ: anlassFeld.typ,
          optionen: anlassFeld.optionen,
          pflicht: anlassFeld.pflicht,
        },
      })
      .from(anlass)
      .innerJoin(programm, eq(programm.id, anlass.programmId))
      .innerJoin(user, eq(user.id, person.id))
      .leftJoin(anlassFeld, eq(anlassFeld.anlassId, anlass.id))
      .where(
        and(
          eq(anlass.id, id),
          eq(anlass.abteilungId, person.abteilungId),
          anlassSichtbar(person),
        ),
      )
      .orderBy(asc(anlassFeld.reihenfolge), asc(anlassFeld.schluessel));
    const zeilen = await (sperren
      ? abfrage.for("share", { of: anlass })
      : abfrage);
    const kopf = zeilen[0];
    if (!kopf) throw new HTTPException(404);
    // Die Felder stehen in felder; «feld» der ersten Zeile bleibt unbenutzt
    return {
      ...kopf,
      felder: zeilen.flatMap((z) => (z.feld?.schluessel ? [z.feld] : [])),
    };
  }

  // Das Kind muss ein aktives Kind der Person in ihrer Abteilung sein, sonst 404 (auch für Kinder anderer Eltern)
  async function pruefeKind(q: Db | Tx, person: Person, kindId: string) {
    const [eigenes] = await q
      .select({ id: kind.id })
      .from(kind)
      .innerJoin(
        kindZugang,
        and(eq(kindZugang.kindId, kind.id), eq(kindZugang.userId, person.id)),
      )
      .where(
        and(
          eq(kind.id, kindId),
          eq(kind.abteilungId, person.abteilungId),
          isNull(kind.inaktivSeit),
        ),
      );
    if (!eigenes) throw new HTTPException(404);
  }

  // kindId gehört nur zu «kind»; sonst 400. Gibt die Antwort mit Fehler zurück oder prüft das Kind
  async function pruefeZiel(
    q: Db | Tx,
    person: Person,
    ziel: { anmeldungFuer: "kind" | "person" },
    kindId: string | undefined,
  ) {
    if (ziel.anmeldungFuer === "kind") {
      if (kindId === undefined) return KIND_PFLICHT;
      await pruefeKind(q, person, kindId);
    } else if (kindId !== undefined) {
      return KIND_VERBOTEN;
    }
    return null;
  }

  const ausgabe = (z: {
    id: string;
    status: "angemeldet" | "abgemeldet";
    antworten: Record<string, string | boolean>;
    geaendertAm: Date;
  }) => ({
    id: z.id,
    status: z.status,
    antworten: z.antworten,
    geaendertAm: z.geaendertAm,
  });

  return new Hono<TermineEnv>()
    .get("/anlaesse/:id", eingabe("param", pfadSchema), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      const a = await ladeAnlass(db, person, id);
      const anmeldungSpalten = {
        anmeldungId: anlassAnmeldung.id,
        status: anlassAnmeldung.status,
        antworten: anlassAnmeldung.antworten,
        geaendertAm: anlassAnmeldung.geaendertAm,
      };
      const anmeldung = (z: {
        anmeldungId: string | null;
        status: "angemeldet" | "abgemeldet" | null;
        antworten: Record<string, string | boolean> | null;
        geaendertAm: Date | null;
      }) =>
        z.anmeldungId && z.status && z.antworten && z.geaendertAm
          ? ausgabe({
              id: z.anmeldungId,
              status: z.status,
              antworten: z.antworten,
              geaendertAm: z.geaendertAm,
            })
          : null;
      // Was das Konto kennt, steht in «konto» und gehört nicht ins Formular: die App zeigt es als «aus deinem Konto»
      const konto = (eintraege: [string, string, string | null][]) =>
        eintraege.flatMap(([schluessel, beschriftung, wert]) =>
          wert ? [{ schluessel, beschriftung, wert }] : [],
        );
      let teilnehmende;
      if (a.anmeldungFuer === "kind") {
        // Alle aktiven Kinder der Person mit ihrer Anmeldung, eine Abfrage (die Anmeldung gehört dem Kind, auch wenn der andere Elternteil sie angelegt hat)
        const kinder = await db
          .select({
            kindId: kind.id,
            vorname: kind.vorname,
            nachname: kind.nachname,
            ceviName: kind.ceviName,
            stufe: tag.name,
            ...anmeldungSpalten,
          })
          .from(kind)
          .innerJoin(
            kindZugang,
            and(
              eq(kindZugang.kindId, kind.id),
              eq(kindZugang.userId, person.id),
            ),
          )
          .innerJoin(tag, eq(tag.id, kind.stufeId))
          .leftJoin(
            anlassAnmeldung,
            and(
              eq(anlassAnmeldung.kindId, kind.id),
              eq(anlassAnmeldung.anlassId, id),
            ),
          )
          .where(
            and(
              eq(kind.abteilungId, person.abteilungId),
              isNull(kind.inaktivSeit),
            ),
          )
          .orderBy(asc(kind.vorname), asc(kind.id));
        teilnehmende = kinder.map((k) => ({
          kindId: k.kindId,
          name: k.ceviName ?? `${k.vorname} ${k.nachname}`,
          konto: konto([
            ["vorname", "Vorname", k.vorname],
            ["nachname", "Nachname", k.nachname],
            ["cevi_name", "Cevi-Name", k.ceviName],
            ["stufe", "Stufe", k.stufe],
          ]),
          anmeldung: anmeldung(k),
        }));
      } else {
        const [eigene] = await db
          .select(anmeldungSpalten)
          .from(anlassAnmeldung)
          .where(
            and(
              eq(anlassAnmeldung.anlassId, id),
              eq(anlassAnmeldung.userId, person.id),
              isNull(anlassAnmeldung.kindId),
            ),
          );
        teilnehmende = [
          {
            kindId: null,
            name: a.ceviName ?? a.name,
            konto: konto([
              ["name", "Name", a.name],
              ["cevi_name", "Cevi-Name", a.ceviName],
            ]),
            anmeldung: eigene ? anmeldung(eigene) : null,
          },
        ];
      }
      return c.json({
        id: a.id,
        terminId: a.programmId,
        titel: a.titel,
        ganztaegig: a.ganztaegig,
        beginn: a.beginn,
        ende: a.ende,
        tagVon: a.tagVon,
        tagBis: a.tagBis,
        anmeldungOffen: a.offen,
        frist: a.frist,
        anmeldungFuer: a.anmeldungFuer,
        felder: a.felder,
        teilnehmende,
      });
    })
    .put(
      "/anlaesse/:id/anmeldung",
      eingabe("param", pfadSchema),
      eingabe("json", putSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const { kindId, antworten } = c.req.valid("json");
        if (zuViele(person.id)) throw new HTTPException(429);
        const ergebnis = await db.transaction(async (tx) => {
          const a = await ladeAnlass(tx, person, id, true);
          const fehlerZiel = await pruefeZiel(tx, person, a, kindId);
          if (fehlerZiel) return { status: 400 as const, body: fehlerZiel };
          if (!a.offen)
            return { status: 409 as const, body: ANMELDUNG_GESCHLOSSEN };
          const geprueft = pruefeAntworten(a.felder, antworten);
          if ("fehler" in geprueft) {
            return {
              status: 400 as const,
              body: { ...ANTWORTEN_UNGUELTIG, fehler: geprueft.fehler },
            };
          }
          // Ein Kind hat eine Anmeldung je Anlass (auch wenn beide Eltern anmelden), eine Person ebenso
          const werte = {
            anlassId: id,
            userId: person.id,
            kindId: kindId ?? null,
            antworten: geprueft.antworten,
            status: "angemeldet" as const,
          };
          const [zeile] = await tx
            .insert(anlassAnmeldung)
            .values(werte)
            .onConflictDoUpdate({
              target: kindId
                ? [anlassAnmeldung.anlassId, anlassAnmeldung.kindId]
                : [
                    anlassAnmeldung.anlassId,
                    anlassAnmeldung.userId,
                    anlassAnmeldung.kindId,
                  ],
              targetWhere: kindId
                ? sql`${anlassAnmeldung.kindId} is not null`
                : undefined,
              set: {
                antworten: werte.antworten,
                status: "angemeldet",
                geaendertAm: sql`now()`,
              },
            })
            .returning({
              id: anlassAnmeldung.id,
              status: anlassAnmeldung.status,
              antworten: anlassAnmeldung.antworten,
              geaendertAm: anlassAnmeldung.geaendertAm,
            });
          // Nur Kennungen, nie Antworten
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "anlass_angemeldet",
            zielTyp: "anlass_anmeldung",
            zielId: zeile.id,
            details: { anlassId: id, kind: kindId !== undefined },
          });
          return { status: 200 as const, body: ausgabe(zeile) };
        });
        return c.json(ergebnis.body, ergebnis.status);
      },
    )
    .delete(
      "/anlaesse/:id/anmeldung",
      eingabe("param", pfadSchema),
      eingabe("query", deleteSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const { kindId } = c.req.valid("query");
        if (zuViele(person.id)) throw new HTTPException(429);
        const fehler = await db.transaction(async (tx) => {
          const a = await ladeAnlass(tx, person, id, true);
          const fehlerZiel = await pruefeZiel(tx, person, a, kindId);
          if (fehlerZiel) return { status: 400 as const, body: fehlerZiel };
          // Auch das Abmelden endet mit dem Anmeldeschluss: Danach gilt die Anmeldung, die die Leitung plant
          if (!a.offen)
            return { status: 409 as const, body: ANMELDUNG_GESCHLOSSEN };
          // Die Antworten werden gelöscht, die Zeile bleibt bis zur Löschfrist; wer schon abgemeldet ist oder nie angemeldet war, bekommt dasselbe 204
          const zeilen = await tx
            .update(anlassAnmeldung)
            .set({
              status: "abgemeldet",
              antworten: {},
              geaendertAm: sql`now()`,
            })
            .where(
              and(
                eq(anlassAnmeldung.anlassId, id),
                eq(anlassAnmeldung.status, "angemeldet"),
                kindId
                  ? eq(anlassAnmeldung.kindId, kindId)
                  : and(
                      eq(anlassAnmeldung.userId, person.id),
                      isNull(anlassAnmeldung.kindId),
                    ),
              ),
            )
            .returning({ id: anlassAnmeldung.id });
          if (zeilen[0]) {
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "anlass_abgemeldet",
              zielTyp: "anlass_anmeldung",
              zielId: zeilen[0].id,
              details: { anlassId: id, kind: kindId !== undefined },
            });
          }
          return null;
        });
        if (fehler) return c.json(fehler.body, fehler.status);
        return c.body(null, 204);
      },
    );
}

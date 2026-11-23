import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { TEAM_ROLLE } from "../../bearbeiten.js";
import type { Db } from "../../db/client.js";
import {
  auditLog,
  gruppenRolle,
  kind,
  kindEltern,
  personTag,
  rolle,
  tag,
  user,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { sendePush, type Fcm } from "../../push.js";
import { aktivesKonto, type Person } from "../../rechte.js";
import { darf, verlange } from "../../rechtemodell/darf.js";

// Höchstens so viele Mitteilungen pro Abteilung und Stunde: Ein gekapertes Konto soll nicht beliebig oft alle Geräte anstossen
const MITTEILUNGEN_PRO_STUNDE = 10;

// Höchstens so viele Ziele je Mitteilung: Die Auflösung braucht höchstens vier Abfragen, unabhängig von der Zahl, aber die Eingabe bleibt überschaubar
const MAX_ZIELE = 30;

// Das Recht aus dem Rechtekatalog (rechtemodell/katalog.ts): Gruppen und Rollen als Ziele, je Gruppe oder abteilungsweit
const MITTEILUNG_SENDEN = "mitteilung.senden";

// Rollen einer Stufe. Eltern sind die Teilnehmenden: Kinder haben kein Konto
const STUFEN_ROLLEN = ["stufenleitung", "leitung", "eltern"] as const;
// Rollen jeder anderen Gruppe (Funktion, Team, Lager, Anlass): alle Mitglieder oder nur die Verantwortlichen
const GRUPPEN_ROLLEN = ["alle", "verantwortliche"] as const;
type Rolle = (typeof STUFEN_ROLLEN)[number] | (typeof GRUPPEN_ROLLEN)[number];

const zielSchema = z.strictObject({
  gruppeId: z.uuid(),
  rollen: z
    .array(z.enum([...STUFEN_ROLLEN, ...GRUPPEN_ROLLEN]))
    .min(1)
    .max(STUFEN_ROLLEN.length),
});
type Ziel = z.infer<typeof zielSchema>;

// Die Wahl der Empfänger, wie sie auch die Vorschau nimmt. Zwei Formen: die bisherige (empfaenger, stufeIds, rollen) und die Liste der Ziele
const auswahlFelder = {
  empfaenger: z.enum(["alle", "stufen"]).optional(),
  stufeIds: z.array(z.uuid()).min(1).max(50).optional(),
  rollen: z
    .array(z.enum(STUFEN_ROLLEN))
    .min(1)
    .max(STUFEN_ROLLEN.length)
    .optional(),
  ziele: z.array(zielSchema).min(1).max(MAX_ZIELE).optional(),
};
type Auswahl = {
  empfaenger?: "alle" | "stufen";
  stufeIds?: string[];
  rollen?: (typeof STUFEN_ROLLEN)[number][];
  ziele?: Ziel[];
};

const auswahlGueltig = (e: Auswahl) =>
  e.ziele
    ? // Die Liste ersetzt die alte Form; dieselbe Gruppe oder Rolle zweimal ist ein Fehler der Eingabe
      e.empfaenger === undefined &&
      e.stufeIds === undefined &&
      e.rollen === undefined &&
      new Set(e.ziele.map((z) => z.gruppeId)).size === e.ziele.length &&
      e.ziele.every((z) => new Set(z.rollen).size === z.rollen.length)
    : e.empfaenger !== undefined &&
      (e.empfaenger === "stufen") === (e.stufeIds !== undefined);

// Titel und Beschreibung sind der ganze Push, darum kurz
const sendenSchema = z
  .strictObject({
    titel: z.string().trim().min(1).max(100),
    beschreibung: z.string().trim().min(1).max(300).optional(),
    ...auswahlFelder,
  })
  .refine(auswahlGueltig);
const vorschauSchema = z.strictObject(auswahlFelder).refine(auswahlGueltig);

const PUSH_NICHT_EINGERICHTET = {
  code: "PUSH_NICHT_EINGERICHTET",
  message: "Der Push-Dienst ist auf diesem Server nicht eingerichtet.",
} as const;

type Aufloesung = {
  ids: Set<string>;
  // Konten je Ziel, in der Reihenfolge der Ziele; leer bei «alle»
  jeZiel: { gruppeId: string; anzahl: number }[];
  // Für den Audit-Eintrag: Gruppen und Rollen, nie Namen
  details: Record<string, unknown>;
};

// Löst die Wahl in Konten auf: aktive Konten der Abteilung mit eingeschalteter Option «Mitteilungen» (push_programme). Fremde oder unbekannte Gruppen und Rollen, die nicht zum Typ der Gruppe passen, sind 400. Die Abfragen nehmen alle Ziele zusammen, nie eine je Ziel
async function loeseAuf(
  tx: Pick<Db, "select" | "execute">,
  person: Person,
  wahl: Auswahl,
): Promise<Aufloesung> {
  const mitOption = and(
    aktivesKonto(person.abteilungId),
    eq(user.pushProgramme, true),
  );
  // Ohne Angabe gelten alle Rollen, wie vor dem Filter
  const rollen = new Set(wahl.rollen ?? STUFEN_ROLLEN);
  const alleRollen = rollen.size === STUFEN_ROLLEN.length;

  // Alle Konten oder alle Stufen erreicht nur, wer das Recht abteilungsweit hat; ein Recht für die eigene Gruppe reicht dafür nie (#643)
  if (wahl.empfaenger === "alle") {
    if (
      !(await darf(tx, person, MITTEILUNG_SENDEN, {
        abteilungId: person.abteilungId,
        abteilungsweit: true,
      }))
    ) {
      throw new HTTPException(403);
    }
  }
  if (wahl.empfaenger === "alle" && alleRollen) {
    const zeilen = await tx.select({ id: user.id }).from(user).where(mitOption);
    return {
      ids: new Set(zeilen.map((z) => z.id)),
      jeZiel: [],
      details: { empfaenger: "alle" },
    };
  }

  // Alte Form: «stufen» sind die Stufen der Liste, «alle» mit einem Teil der Rollen sind alle Stufen der Abteilung
  let ziele: Ziel[];
  if (wahl.ziele) {
    ziele = wahl.ziele;
  } else {
    const stufenIds =
      wahl.empfaenger === "stufen"
        ? [...new Set(wahl.stufeIds)]
        : (
            await tx
              .select({ id: tag.id })
              .from(tag)
              .where(
                and(
                  eq(tag.typ, "stufe"),
                  eq(tag.abteilungId, person.abteilungId),
                ),
              )
          ).map((s) => s.id);
    ziele = stufenIds.map((gruppeId) => ({ gruppeId, rollen: [...rollen] }));
  }

  const typen = new Map<string, string>();
  if (ziele.length > 0) {
    const gruppen = await tx
      .select({ id: tag.id, typ: tag.typ })
      .from(tag)
      .where(
        and(
          inArray(
            tag.id,
            ziele.map((z) => z.gruppeId),
          ),
          eq(tag.abteilungId, person.abteilungId),
        ),
      );
    gruppen.forEach((g) => typen.set(g.id, g.typ));
  }
  for (const ziel of ziele) {
    const typ = typen.get(ziel.gruppeId);
    const erlaubt: readonly string[] =
      typ === "stufe" ? STUFEN_ROLLEN : GRUPPEN_ROLLEN;
    if (!typ || !ziel.rollen.every((r) => erlaubt.includes(r))) {
      throw new HTTPException(400);
    }
  }
  // Erst wenn jede Gruppe der Abteilung gehört (sonst 400), das Recht je Gruppe (#643): «alle» gilt für jede, «eigene» nur für die Gruppe der Rolle
  for (const ziel of ziele) {
    if (
      !(await darf(tx, person, MITTEILUNG_SENDEN, {
        abteilungId: person.abteilungId,
        tagId: ziel.gruppeId,
      }))
    ) {
      throw new HTTPException(403);
    }
  }
  const mit = (...arten: Rolle[]) => [
    ...new Set(
      ziele
        .filter((z) => z.rollen.some((r) => arten.includes(r)))
        .map((z) => z.gruppeId),
    ),
  ];
  const ziel = new Map(ziele.map((z) => [z.gruppeId, z]));

  const jeGruppe = new Map(ziele.map((z) => [z.gruppeId, new Set<string>()]));
  const nimm = (gruppeId: string, id: string) =>
    jeGruppe.get(gruppeId)!.add(id);

  const elternStufen = mit("eltern");
  if (elternStufen.length > 0) {
    const zeilen = await tx
      .select({ gruppeId: kind.stufeId, id: user.id })
      .from(kindEltern)
      .innerJoin(
        kind,
        and(eq(kind.id, kindEltern.kindId), isNull(kind.inaktivSeit)),
      )
      .innerJoin(user, and(eq(user.id, kindEltern.userId), mitOption))
      .where(inArray(kind.stufeId, elternStufen));
    zeilen.forEach((z) => nimm(z.gruppeId, z.id));
  }

  const leitungsStufen = mit("leitung", "stufenleitung");
  if (leitungsStufen.length > 0) {
    const zeilen = await tx
      .select({ gruppeId: rolle.stufeId, typ: rolle.typ, id: user.id })
      .from(rolle)
      .innerJoin(user, and(eq(user.id, rolle.userId), mitOption))
      .where(inArray(rolle.stufeId, leitungsStufen));
    for (const z of zeilen) {
      if (ziel.get(z.gruppeId)!.rollen.includes(z.typ)) nimm(z.gruppeId, z.id);
    }
  }

  const gruppenMitglieder = mit("alle", "verantwortliche");
  if (gruppenMitglieder.length > 0) {
    const zeilen = await tx
      .select({
        gruppeId: personTag.tagId,
        rolle: personTag.rolle,
        // Das Kennzeichen «Verantwortliche/r» der Gruppenrolle (#643); die Rolle muss zur Gruppe gehören
        kennzeichen: gruppenRolle.verantwortlich,
        id: user.id,
      })
      .from(personTag)
      .innerJoin(user, and(eq(user.id, personTag.userId), mitOption))
      .leftJoin(
        gruppenRolle,
        and(
          eq(gruppenRolle.id, personTag.rolleId),
          eq(gruppenRolle.tagId, personTag.tagId),
        ),
      )
      .where(inArray(personTag.tagId, gruppenMitglieder));
    for (const z of zeilen) {
      const rollenDesZiels = ziel.get(z.gruppeId)!.rollen;
      // Verantwortlich ist, wessen Rolle so gekennzeichnet ist, und wie bisher, wer den Text «verantwortlich» trägt
      const verantwortlich =
        z.kennzeichen === true || z.rolle?.toLowerCase() === TEAM_ROLLE;
      if (
        rollenDesZiels.includes("alle") ||
        (rollenDesZiels.includes("verantwortliche") && verantwortlich)
      ) {
        nimm(z.gruppeId, z.id);
      }
    }
  }

  const ids = new Set([...jeGruppe.values()].flatMap((s) => [...s]));
  // Die absendende Person bekommt den Push in der alten Form nur bei allen Rollen, sonst wüsste sie nicht, wen er trifft
  if (!wahl.ziele && alleRollen) {
    const absender = await tx
      .select({ id: user.id })
      .from(user)
      .where(and(mitOption, eq(user.id, person.id)));
    absender.forEach((z) => ids.add(z.id));
  }

  return {
    ids,
    jeZiel: ziele.map((z) => ({
      gruppeId: z.gruppeId,
      anzahl: jeGruppe.get(z.gruppeId)!.size,
    })),
    details: wahl.ziele
      ? { empfaenger: "ziele", ziele }
      : {
          empfaenger: wahl.empfaenger,
          ...(wahl.empfaenger === "stufen" && {
            stufeIds: [...new Set(wahl.stufeIds)],
          }),
          ...(!alleRollen && {
            rollen: STUFEN_ROLLEN.filter((r) => rollen.has(r)),
          }),
        },
  };
}

export function erstelleMitteilungenRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  return new Hono<{ Variables: { person: Person } }>()
    .post("/vorschau", eingabe("json", vorschauSchema), async (c) => {
      const person = c.get("person");
      // Die Tür: das Recht irgendwo, mit zweitem Faktor; welche Ziele, prüft die Auflösung (#643)
      await verlange(db, person, MITTEILUNG_SENDEN);
      // Nur Zahlen, nie Namen. Kein Audit-Eintrag und kein Versand, auch ohne Push-Dienst
      const { ids, jeZiel } = await loeseAuf(db, person, c.req.valid("json"));
      return c.json({ empfaenger: ids.size, ziele: jeZiel });
    })
    .post("/", eingabe("json", sendenSchema), async (c) => {
      const person = c.get("person");
      await verlange(db, person, MITTEILUNG_SENDEN);
      if (!fcm) return c.json(PUSH_NICHT_EINGERICHTET, 503);
      const { titel, beschreibung, ...wahl } = c.req.valid("json");

      // Die Zählung, die Empfängerwahl und der Audit-Eintrag stehen in einer Transaktion unter einer Sperre pro Abteilung: Gleichzeitige Anfragen sehen dasselbe Limit
      const ids = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${person.abteilungId}, 0))`,
        );
        const [{ anzahl: bisher }] = await tx
          .select({ anzahl: count() })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.abteilungId, person.abteilungId),
              eq(auditLog.aktion, "mitteilung_gesendet"),
              gt(auditLog.erstelltAm, sql`now() - interval '1 hour'`),
            ),
          );
        if (bisher >= MITTEILUNGEN_PRO_STUNDE) throw new HTTPException(429);

        const aufgeloest = await loeseAuf(tx, person, wahl);

        // Ziel ist die Abteilung (ziel_id ist Pflicht und ohne Fremdschlüssel): Eine Mitteilung gilt ihr, nicht einem einzelnen Objekt. Kein Text, keine Namen; nur die Gruppen, die Rollen und die Zahl
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "mitteilung_gesendet",
          zielTyp: "abteilung",
          zielId: person.abteilungId,
          details: { ...aufgeloest.details, anzahl: aufgeloest.ids.size },
        });
        return [...aufgeloest.ids];
      });

      // Nach dem Commit: Der Eintrag steht, auch wenn der Versand scheitert (sendePush wirft nie)
      if (ids.length > 0) {
        await sendePush({ db, fcm, c }, ids, {
          typ: "mitteilung",
          id: "",
          titel,
          text: beschreibung,
        });
      }
      return c.json({ empfaenger: ids.length });
    });
}

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  pinnwandBeitrag,
  reaktion,
  umfrage,
  umfrageOption,
  umfrageStimme,
  user,
} from "../db/schema.js";
import { darf, type LagerZugriff } from "./policy.js";
import {
  aendereZeile,
  legeZeileAn,
  legeZeilenAn,
  loescheZeile,
  LagerAntwortFehler,
  type SchreibKontext,
  type Tx,
} from "./sync.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Umfragen und Reaktionen des Lagers (#382). Eine Umfrage hängt an einem Pinnwand-Beitrag (die Frage ist sein Titel), Reaktionen an einem Ziel aus der Allowlist ZIEL_TYPEN. Beides sieht, wer den Beitrag lesen darf (beitragLesbar in lager/pinnwand.ts, die Routen prüfen es zuerst): Sichtbarkeit folgt dem Beitrag.
// Stimmen und Reaktionen sind Einzelzeilen je Person (umfrage_stimme, reaktion), nie ein Feld in einer gemeinsamen Zeile: Zwei Personen überschreiben einander nicht. Der Schreibvorgang ist idempotent: PUT setzt die eigene Stimme (oder Reaktion) auf den genannten Stand, derselbe Aufruf zweimal ändert nichts (keine neue Version, kein Feed-Eintrag). Jeder Schreibvorgang sperrt zuerst das Lager (wie der Sync-Kern), damit zwei Aufrufe derselben Person einander nicht überholen.
// Namen der Stimmen (offene Frage «Wer sieht die Namen?», Annahme): Wer pinnwand.bearbeiten hat (Lagerleitung, Abteilungsleitung, im Standard die Leitung), sieht sie immer; alle anderen nur, wenn die Umfrage namen_fuer_team gesetzt hat (Vorgabe: nein, nur Zahlen). Die eigene Stimme sieht jede Person.
// Datenbanklast: Eine Seite Beiträge kostet höchstens fünf Abfragen für alle Umfragen und Reaktionen der Seite zusammen (Umfragen, Optionen, Zählung mit GROUP BY, Namen nur wenn nötig, Reaktionen), nie eine je Beitrag. Stimmen und Reaktionen erscheinen nicht im Änderungsfeed (die Apps lesen sie mit der Beitragsliste beim Öffnen); das Anlegen, Ändern und Löschen einer Umfrage zählt die Version des Beitrags hoch und erscheint so im Feed.

export const REAKTIONEN = [
  "daumen",
  "herz",
  "lachen",
  "staunen",
  "danke",
] as const;
export type ReaktionsSchluessel = (typeof REAKTIONEN)[number];
// Worauf sich Reaktionen setzen lassen; ein neuer Typ braucht auch eine Prüfung der Lesbarkeit in routes/lager/reaktionen.ts und die CHECK-Bedingung der Tabelle
export const ZIEL_TYPEN = ["pinnwand_beitrag"] as const;
export type ZielTyp = (typeof ZIEL_TYPEN)[number];

// Die Zeilen der Umfrage kommen nicht in den Feed: Wer den Beitrag liest, bekommt die Umfrage mit ihm (lager/pinnwand.ts)
for (const tabelle of [umfrage, umfrageOption, umfrageStimme, reaktion]) {
  registriereLagerTabelle({
    tabelle,
    recht: null,
    sichtbar: async () => new Set(),
  });
}

const kannNamenSehen = (z: Pick<LagerZugriff, "rolle" | "rechte">) =>
  darf(z, "pinnwand.bearbeiten");

const istGeschlossen = (
  u: Pick<typeof umfrage.$inferSelect, "geschlossen" | "schliesstAm">,
  jetzt = new Date(),
) => u.geschlossen || (u.schliesstAm !== null && u.schliesstAm <= jetzt);

// Eingaben: strikt, nur die genannten Felder (SR-72)
const zeit = z.iso
  .datetime({ offset: true })
  .transform((s) => new Date(s))
  .nullable();
const optionText = z.string().trim().min(1).max(200);
export const umfrageAnlegen = z.strictObject({
  optionen: z
    .array(optionText)
    .min(2)
    .max(10)
    .refine(
      (l) => new Set(l.map((t) => t.toLowerCase())).size === l.length,
      "Die Antworten müssen sich unterscheiden.",
    ),
  mehrfach: z.boolean().default(false),
  schliesstAm: zeit.optional(),
  namenFuerTeam: z.boolean().default(false),
});
export const umfrageAendern = z
  .strictObject({
    version: z.number().int().min(1),
    schliesstAm: zeit.optional(),
    geschlossen: z.boolean().optional(),
    namenFuerTeam: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const stimmeSetzen = z.strictObject({
  optionIds: z
    .array(z.uuid())
    .min(1)
    .max(10)
    .refine((l) => new Set(l).size === l.length),
});
export const reaktionSetzen = z.strictObject({ emoji: z.enum(REAKTIONEN) });

export const umfrageAnsichtZeile = (u: typeof umfrage.$inferSelect) => ({
  id: u.id,
  version: u.version,
  mehrfach: u.mehrfach,
  schliesstAm: u.schliesstAm,
  geschlossen: u.geschlossen,
  namenFuerTeam: u.namenFuerTeam,
});
const reaktionAnsichtZeile = (r: typeof reaktion.$inferSelect) => ({
  id: r.id,
  version: r.version,
  emoji: r.emoji,
});
const stimmeAnsichtZeile = (s: typeof umfrageStimme.$inferSelect) => ({
  id: s.id,
  version: s.version,
  optionId: s.optionId,
});

// Sperrt das Lager bis zum Ende der Transaktion (wie die Folgenummer im Sync-Kern, nur früher): Danach liest der Aufrufer den Stand, den kein anderer Schreiber mehr ändert
export async function sperreLager(tx: Tx, lagerId: string) {
  await tx.execute(sql`select id from lager where id = ${lagerId} for update`);
}

const inListe = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

type Personen = { id: string; name: string; ceviName: string | null }[];

// Umfragen für eine Seite Beiträge, höchstens fünf Abfragen. Der Aufrufer hat schon geprüft, dass die Person die Beiträge lesen darf
export async function ladeUmfragen(
  db: Db | Tx,
  zugriff: LagerZugriff,
  beitragIds: string[],
) {
  const ergebnis = new Map<string, ReturnType<typeof baueUmfrage>>();
  if (beitragIds.length === 0) return ergebnis;
  const lagerId = zugriff.lager.id;
  const umfragen = await db
    .select()
    .from(umfrage)
    .where(
      and(
        eq(umfrage.lagerId, lagerId),
        inArray(umfrage.beitragId, beitragIds),
        isNull(umfrage.geloeschtAm),
      ),
    );
  if (umfragen.length === 0) return ergebnis;
  const ids = umfragen.map((u) => u.id);
  const optionen = await db
    .select()
    .from(umfrageOption)
    .where(
      and(
        eq(umfrageOption.lagerId, lagerId),
        inArray(umfrageOption.umfrageId, ids),
        isNull(umfrageOption.geloeschtAm),
      ),
    )
    .orderBy(asc(umfrageOption.reihenfolge), asc(umfrageOption.id));
  // Zählung in einer Abfrage: je Option die Personen, dazu je Umfrage (option_id leer) die Personen insgesamt. Mehrere Stimmen derselben Person zählen in der Umfrage einmal
  const zahlen = await db.execute<{
    umfrage_id: string;
    option_id: string | null;
    n: number;
    eigene: boolean;
  }>(sql`
    select umfrage_id, option_id, count(distinct person_id)::int as n,
      coalesce(bool_or(person_id = ${zugriff.personId}::uuid), false) as eigene
    from umfrage_stimme
    where lager_id = ${lagerId} and umfrage_id in (${inListe(ids)}) and geloescht_am is null
    group by grouping sets ((umfrage_id, option_id), (umfrage_id))`);

  const verwalter = kannNamenSehen(zugriff);
  const mitNamen = umfragen
    .filter((u) => verwalter || u.namenFuerTeam)
    .map((u) => u.id);
  const personenJeOption = new Map<string, Personen>();
  if (mitNamen.length > 0) {
    const zeilen = await db
      .select({
        optionId: umfrageStimme.optionId,
        id: umfrageStimme.personId,
        name: user.name,
        ceviName: user.ceviName,
      })
      .from(umfrageStimme)
      .innerJoin(user, eq(user.id, umfrageStimme.personId))
      .where(
        and(
          eq(umfrageStimme.lagerId, lagerId),
          inArray(umfrageStimme.umfrageId, mitNamen),
          isNull(umfrageStimme.geloeschtAm),
        ),
      )
      .orderBy(asc(umfrageStimme.erstelltAm), asc(umfrageStimme.id));
    for (const z of zeilen) {
      personenJeOption.set(z.optionId, [
        ...(personenJeOption.get(z.optionId) ?? []),
        { id: z.id, name: z.name, ceviName: z.ceviName },
      ]);
    }
  }

  const jetzt = new Date();
  for (const u of umfragen) {
    const meine = optionen.filter((o) => o.umfrageId === u.id);
    const zeilen = [...zahlen].filter((z) => z.umfrage_id === u.id);
    ergebnis.set(
      u.beitragId,
      baueUmfrage(u, meine, zeilen, personenJeOption, {
        namenSichtbar: verwalter || u.namenFuerTeam,
        geschlossen: istGeschlossen(u, jetzt),
      }),
    );
  }
  return ergebnis;
}

function baueUmfrage(
  u: typeof umfrage.$inferSelect,
  optionen: (typeof umfrageOption.$inferSelect)[],
  zahlen: { option_id: string | null; n: number; eigene: boolean }[],
  personen: Map<string, Personen>,
  p: { namenSichtbar: boolean; geschlossen: boolean },
) {
  const je = new Map(
    zahlen.filter((z) => z.option_id).map((z) => [z.option_id!, z]),
  );
  return {
    ...umfrageAnsichtZeile(u),
    // Wirksam geschlossen: von Hand oder die Frist ist vorbei
    geschlossen: p.geschlossen,
    namenSichtbar: p.namenSichtbar,
    teilnehmende: zahlen.find((z) => z.option_id === null)?.n ?? 0,
    optionen: optionen.map((o) => ({
      id: o.id,
      text: o.text,
      stimmen: je.get(o.id)?.n ?? 0,
      eigene: je.get(o.id)?.eigene ?? false,
      personen: p.namenSichtbar ? (personen.get(o.id) ?? []) : [],
    })),
  };
}

export type ReaktionenAnsicht = {
  // Anzahl je Schlüssel, nur Schlüssel mit mindestens einer Reaktion
  zaehler: Partial<Record<ReaktionsSchluessel, number>>;
  // Die eigene Reaktion
  eigene: ReaktionsSchluessel | null;
};

// Reaktionen für eine Seite Ziele in einer Abfrage. Es gibt nur Zähler, nie Namen
export async function ladeReaktionen(
  db: Db | Tx,
  zugriff: LagerZugriff,
  zielTyp: ZielTyp,
  zielIds: string[],
) {
  const ergebnis = new Map<string, ReaktionenAnsicht>(
    zielIds.map((id) => [id, { zaehler: {}, eigene: null }]),
  );
  if (zielIds.length === 0) return ergebnis;
  const zeilen = await db.execute<{
    ziel_id: string;
    emoji: ReaktionsSchluessel;
    n: number;
    eigene: boolean;
  }>(sql`
    select ziel_id, emoji, count(*)::int as n,
      coalesce(bool_or(person_id = ${zugriff.personId}::uuid), false) as eigene
    from reaktion
    where lager_id = ${zugriff.lager.id} and ziel_typ = ${zielTyp} and ziel_id in (${inListe(zielIds)}) and geloescht_am is null
    group by ziel_id, emoji`);
  for (const z of zeilen) {
    const a = ergebnis.get(z.ziel_id);
    if (!a) continue;
    a.zaehler[z.emoji] = z.n;
    if (z.eigene) a.eigene = z.emoji;
  }
  return ergebnis;
}

// Die aktive Umfrage des Beitrags; ohne: undefined
export async function ladeUmfrageZeile(
  db: Db | Tx,
  lagerId: string,
  beitragId: string,
) {
  const [zeile] = await db
    .select()
    .from(umfrage)
    .where(
      and(
        eq(umfrage.lagerId, lagerId),
        eq(umfrage.beitragId, beitragId),
        isNull(umfrage.geloeschtAm),
      ),
    );
  return zeile;
}

// Der Beitrag zählt eine Version hoch, damit der Feed die Apps auf die geänderte Umfrage hinweist. Unter der Sperre des Lagers gelesen, darum nie ein Versionskonflikt
async function meldeAmBeitrag(tx: Tx, k: SchreibKontext, beitragId: string) {
  const [beitrag] = await tx
    .select({ version: pinnwandBeitrag.version })
    .from(pinnwandBeitrag)
    .where(
      and(
        eq(pinnwandBeitrag.id, beitragId),
        eq(pinnwandBeitrag.lagerId, k.lagerId),
        isNull(pinnwandBeitrag.geloeschtAm),
      ),
    );
  if (!beitrag) throw new HTTPException(404);
  await aendereZeile(tx, pinnwandBeitrag, k, {
    id: beitragId,
    version: beitrag.version,
    werte: {},
    ansicht: (b) => ({ id: b.id, version: b.version }),
  });
}

const konflikt = (code: string, message: string) =>
  new LagerAntwortFehler(409, { code, message });

export async function legeUmfrageAn(
  db: Db,
  k: SchreibKontext,
  beitragId: string,
  e: z.infer<typeof umfrageAnlegen>,
) {
  await db.transaction(async (tx) => {
    await sperreLager(tx, k.lagerId);
    if (await ladeUmfrageZeile(tx, k.lagerId, beitragId)) {
      throw konflikt(
        "UMFRAGE_EXISTIERT",
        "Dieser Beitrag hat schon eine Umfrage.",
      );
    }
    const neu = await legeZeileAn(tx, umfrage, k, {
      beitragId,
      mehrfach: e.mehrfach,
      schliesstAm: e.schliesstAm ?? null,
      namenFuerTeam: e.namenFuerTeam,
    });
    await legeZeilenAn(
      tx,
      umfrageOption,
      k,
      e.optionen.map((text, reihenfolge) => ({
        umfrageId: neu.id,
        text,
        reihenfolge,
      })),
    );
    await meldeAmBeitrag(tx, k, beitragId);
  });
}

export async function aendereUmfrage(
  db: Db,
  k: SchreibKontext,
  beitragId: string,
  { version, ...werte }: z.infer<typeof umfrageAendern>,
) {
  await db.transaction(async (tx) => {
    await sperreLager(tx, k.lagerId);
    const alt = await ladeUmfrageZeile(tx, k.lagerId, beitragId);
    if (!alt) throw new HTTPException(404);
    await aendereZeile(tx, umfrage, k, {
      id: alt.id,
      version,
      werte,
      ansicht: umfrageAnsichtZeile,
    });
    await meldeAmBeitrag(tx, k, beitragId);
  });
}

// Soft-Delete der Umfrage; Optionen und Stimmen bleiben als Zeilen stehen und entfallen mit dem endgültigen Löschen (#427). Ohne aktive Umfrage sieht niemand sie mehr
export async function loescheUmfrage(
  db: Db,
  k: SchreibKontext,
  beitragId: string,
  version: number,
) {
  await db.transaction(async (tx) => {
    await sperreLager(tx, k.lagerId);
    const alt = await ladeUmfrageZeile(tx, k.lagerId, beitragId);
    if (!alt) throw new HTTPException(404);
    await loescheZeile(tx, umfrage, k, {
      id: alt.id,
      version,
      ansicht: umfrageAnsichtZeile,
    });
    await meldeAmBeitrag(tx, k, beitragId);
  });
}

// Setzt die eigenen Stimmen der Person auf genau diese Optionen (PUT): Fehlende kommen dazu, Überzählige entfallen, Gleiches bleibt. Fehler als Antwort mit Code (400 für falsche Eingaben, 409 für geschlossen); undefined bei Erfolg
export async function setzeStimmen(
  db: Db,
  k: SchreibKontext,
  beitragId: string,
  optionIds: string[],
): Promise<
  { status: 200 } | { status: 400 | 404; code: string; message: string }
> {
  return db.transaction(async (tx) => {
    await sperreLager(tx, k.lagerId);
    const u = await ladeUmfrageZeile(tx, k.lagerId, beitragId);
    if (!u) return nichtGefunden;
    if (istGeschlossen(u)) throw geschlossen();
    if (!u.mehrfach && optionIds.length > 1) {
      return {
        status: 400 as const,
        code: "NUR_EINE_STIMME",
        message: "In dieser Umfrage zählt nur eine Antwort je Person.",
      };
    }
    const optionen = await tx
      .select({ id: umfrageOption.id })
      .from(umfrageOption)
      .where(
        and(
          eq(umfrageOption.lagerId, k.lagerId),
          eq(umfrageOption.umfrageId, u.id),
          isNull(umfrageOption.geloeschtAm),
        ),
      );
    const gueltig = new Set(optionen.map((o) => o.id));
    if (!optionIds.every((id) => gueltig.has(id))) {
      return {
        status: 400 as const,
        code: "OPTION_UNBEKANNT",
        message: "Eine Antwort gibt es in dieser Umfrage nicht.",
      };
    }
    const eigene = await eigeneStimmen(tx, k, u.id);
    const gewollt = new Set(optionIds);
    for (const s of eigene) {
      if (!gewollt.has(s.optionId)) {
        await loescheZeile(tx, umfrageStimme, k, {
          id: s.id,
          version: s.version,
          ansicht: stimmeAnsichtZeile,
        });
      }
    }
    const schon = new Set(eigene.map((s) => s.optionId));
    await legeZeilenAn(
      tx,
      umfrageStimme,
      k,
      optionIds
        .filter((id) => !schon.has(id))
        .map((optionId) => ({
          umfrageId: u.id,
          optionId,
          personId: k.personId,
        })),
    );
    return { status: 200 as const };
  });
}

const nichtGefunden = {
  status: 404 as const,
  code: "UMFRAGE_UNBEKANNT",
  message: "Dieser Beitrag hat keine Umfrage.",
};
const geschlossen = () =>
  konflikt("UMFRAGE_GESCHLOSSEN", "Die Umfrage ist geschlossen.");

const eigeneStimmen = (tx: Tx, k: SchreibKontext, umfrageId: string) =>
  tx
    .select()
    .from(umfrageStimme)
    .where(
      and(
        eq(umfrageStimme.lagerId, k.lagerId),
        eq(umfrageStimme.umfrageId, umfrageId),
        eq(umfrageStimme.personId, k.personId),
        isNull(umfrageStimme.geloeschtAm),
      ),
    );

// Zieht alle eigenen Stimmen zurück; ohne Stimmen geschieht nichts (idempotent)
export async function loescheStimmen(
  db: Db,
  k: SchreibKontext,
  beitragId: string,
): Promise<{ status: 204 } | typeof nichtGefunden> {
  return db.transaction(async (tx) => {
    await sperreLager(tx, k.lagerId);
    const u = await ladeUmfrageZeile(tx, k.lagerId, beitragId);
    if (!u) return nichtGefunden;
    if (istGeschlossen(u)) throw geschlossen();
    for (const s of await eigeneStimmen(tx, k, u.id)) {
      await loescheZeile(tx, umfrageStimme, k, {
        id: s.id,
        version: s.version,
        ansicht: stimmeAnsichtZeile,
      });
    }
    return { status: 204 as const };
  });
}

const eigeneReaktion = async (
  tx: Tx,
  k: SchreibKontext,
  zielTyp: ZielTyp,
  zielId: string,
) =>
  (
    await tx
      .select()
      .from(reaktion)
      .where(
        and(
          eq(reaktion.lagerId, k.lagerId),
          eq(reaktion.zielTyp, zielTyp),
          eq(reaktion.zielId, zielId),
          eq(reaktion.personId, k.personId),
          isNull(reaktion.geloeschtAm),
        ),
      )
  )[0];

// Setzt die eigene Reaktion auf das Ziel (PUT): eine je Person und Ziel, eine neue ersetzt die alte; dieselbe zweimal ändert nichts
export async function setzeReaktion(
  db: Db,
  k: SchreibKontext,
  zielTyp: ZielTyp,
  zielId: string,
  emoji: ReaktionsSchluessel,
) {
  await db.transaction(async (tx) => {
    await sperreLager(tx, k.lagerId);
    const alt = await eigeneReaktion(tx, k, zielTyp, zielId);
    if (!alt) {
      await legeZeileAn(tx, reaktion, k, {
        zielTyp,
        zielId,
        personId: k.personId,
        emoji,
      });
    } else if (alt.emoji !== emoji) {
      await aendereZeile(tx, reaktion, k, {
        id: alt.id,
        version: alt.version,
        werte: { emoji },
        ansicht: reaktionAnsichtZeile,
      });
    }
  });
}

// Nimmt die eigene Reaktion zurück; ohne Reaktion geschieht nichts
export async function loescheReaktion(
  db: Db,
  k: SchreibKontext,
  zielTyp: ZielTyp,
  zielId: string,
) {
  await db.transaction(async (tx) => {
    await sperreLager(tx, k.lagerId);
    const alt = await eigeneReaktion(tx, k, zielTyp, zielId);
    if (alt) {
      await loescheZeile(tx, reaktion, k, {
        id: alt.id,
        version: alt.version,
        ansicht: reaktionAnsichtZeile,
      });
    }
  });
}

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { aufgabe, meilenstein } from "../db/schema.js";
import { fehlerCode } from "../kalender/fehler.js";
import { log } from "../log.js";
import type { Fcm } from "../push.js";
import {
  benachrichtige,
  type Zustellung,
  type BenachrichtigungObjekt,
} from "./benachrichtigung.js";
import type { BenachrichtigungsArt } from "./benachrichtigung-arten.js";
import { sperreLager } from "./ressorts.js";
import { aendereZeile, setzeZeilen, type Tx } from "./sync.js";
import { datum, ladeMeilenstein, meilensteinAnsicht } from "./zeitplan.js";

// Relative Fristen, Fristverschiebung und Frist-Erinnerung (#374).
//
// Relative Frist: Eine Aufgabe kann ihre Frist als «Meilenstein plus Versatz in Tagen» (oder «Lagerbeginn plus Versatz») führen (aufgabe.frist_meilenstein_id, frist_versatz_tage). Die Frist bleibt als Datum gespeichert und stimmt immer mit dem Bezug überein; die Verschiebung eines Meilensteins schreibt sie für alle Aufgaben des Meilensteins in einer Anweisung neu.
// Verschiebung mit Vorschau (trocken) und Bestätigung: Die Bestätigung nennt die Aufgaben samt Version aus der Vorschau. Hat sich seither eine Aufgabe, ein Meilenstein oder die Menge der betroffenen Aufgaben geändert, schreibt der Server nichts (409 VORSCHAU_VERALTET beziehungsweise VERSION_KONFLIKT).
// Erinnerung: ein gebündelter Lauf (sendeFristErinnerungen) mit einer Abfrage über alle Lager, kein Takt je Aufgabe.

export const MAX_VERSCHIEBUNG = 500;

const version = z.number().int().min(1);
// trocken ist Pflicht, damit nie versehentlich geschrieben wird. Die Bestätigung (trocken: false) nennt die Aufgaben der Vorschau mit ihrer Version, leer, wenn keine Aufgabe am Meilenstein hängt
export const verschiebenSchema = z
  .strictObject({
    trocken: z.boolean(),
    datum,
    version,
    aufgaben: z
      .array(z.strictObject({ id: z.uuid(), version }))
      .max(MAX_VERSCHIEBUNG)
      .refine((l) => new Set(l.map((a) => a.id)).size === l.length)
      .optional(),
  })
  .refine((b) => b.trocken || b.aufgaben !== undefined);

type Leser = Pick<Db, "select">;

// Die relative Frist in der Eingabe einer Aufgabe: fristVersatzTage (mit fristMeilensteinId oder ohne, dann zählt der Lagerbeginn) macht die Frist zu «Bezug plus Versatz» und darf nicht zusammen mit frist kommen; fristVersatzTage null löst den Bezug; fristMeilensteinId verlangt den Versatz
export const fristEingabeStimmt = (e: {
  frist?: string | null;
  fristMeilensteinId?: string | null;
  fristVersatzTage?: number | null;
}) =>
  (typeof e.fristVersatzTage !== "number" || e.frist === undefined) &&
  (e.fristMeilensteinId == null || typeof e.fristVersatzTage === "number") &&
  (e.fristMeilensteinId === undefined || e.fristVersatzTage !== undefined);

export type FristWerte = {
  frist?: string | null;
  fristMeilensteinId?: string | null;
  fristVersatzTage?: number | null;
};

// Die Spalten, die die Frist einer Aufgabe beim Schreiben bekommt. Relativ: Das Datum rechnet die Datenbank (Bezug plus Versatz, Tage ohne Uhrzeit, also ohne Sommerzeit-Fehler); der Meilenstein muss in diesem Lager liegen und darf nicht gelöscht sein. Eine feste Frist ohne Bezug löst einen bestehenden Bezug (sonst stimmte die Frist nicht mehr mit ihm überein)
export async function berechneFrist(
  tx: Leser & Pick<Db, "execute">,
  lagerId: string,
  e: FristWerte,
): Promise<{ werte: FristWerte } | { fehler: "MEILENSTEIN_UNBEKANNT" }> {
  if (typeof e.fristVersatzTage === "number") {
    const [z] = await tx.execute<{ frist: string }>(
      e.fristMeilensteinId
        ? sql`select (m.datum + ${e.fristVersatzTage}::int)::text as frist from meilenstein m
            where m.id = ${e.fristMeilensteinId} and m.lager_id = ${lagerId} and m.geloescht_am is null`
        : sql`select (l.von + ${e.fristVersatzTage}::int)::text as frist from lager l where l.id = ${lagerId}`,
    );
    if (!z) return { fehler: "MEILENSTEIN_UNBEKANNT" };
    return {
      werte: {
        frist: z.frist,
        fristMeilensteinId: e.fristMeilensteinId ?? null,
        fristVersatzTage: e.fristVersatzTage,
      },
    };
  }
  if (e.fristVersatzTage === null || e.frist !== undefined) {
    return {
      werte: {
        ...(e.frist === undefined ? {} : { frist: e.frist }),
        fristMeilensteinId: null,
        fristVersatzTage: null,
      },
    };
  }
  return { werte: {} };
}

export type Verschiebung = {
  id: string;
  version: number;
  titel: string;
  status: string;
  fristAlt: string;
  fristNeu: string;
};

// Die Aufgaben, die an diesem Meilenstein hängen, mit alter und neuer Frist, in einer Abfrage. Erledigte Aufgaben gehören dazu (die Frist stimmt mit dem Bezug überein, auch wenn die Aufgabe wieder aufgemacht wird); sie bekommen keine Benachrichtigung. Mehr als MAX_VERSCHIEBUNG: null (die Bestätigung nähme nicht mehr alle auf)
export async function ladeBetroffene(
  tx: Leser,
  lagerId: string,
  meilensteinId: string,
  neuesDatum: string,
): Promise<Verschiebung[] | undefined> {
  const zeilen = await tx
    .select({
      id: aufgabe.id,
      version: aufgabe.version,
      titel: aufgabe.titel,
      status: aufgabe.status,
      fristAlt: sql<string>`${aufgabe.frist}::text`,
      fristNeu: sql<string>`(${neuesDatum}::date + ${aufgabe.fristVersatzTage})::text`,
    })
    .from(aufgabe)
    .where(
      and(
        eq(aufgabe.lagerId, lagerId),
        eq(aufgabe.fristMeilensteinId, meilensteinId),
        isNull(aufgabe.geloeschtAm),
      ),
    )
    .orderBy(asc(aufgabe.frist), asc(aufgabe.id))
    .limit(MAX_VERSCHIEBUNG + 1);
  return zeilen.length > MAX_VERSCHIEBUNG ? undefined : zeilen;
}

type Akteur = { lagerId: string; personId: string };

export type Vorschau = {
  meilenstein: {
    id: string;
    version: number;
    datumAlt: string;
    datumNeu: string;
  };
  aufgaben: Verschiebung[];
};

// Trockenlauf: liest und ändert nichts
export async function zeigeVerschiebung(
  db: Leser,
  lagerId: string,
  meilensteinId: string,
  neuesDatum: string,
): Promise<
  Vorschau | { fehler: "KEINE_AENDERUNG" | "ZU_VIELE_AUFGABEN" } | undefined
> {
  const [m] = await db
    .select()
    .from(meilenstein)
    .where(
      and(
        eq(meilenstein.id, meilensteinId),
        eq(meilenstein.lagerId, lagerId),
        isNull(meilenstein.geloeschtAm),
      ),
    );
  if (!m) return undefined;
  if (m.datum === neuesDatum) return { fehler: "KEINE_AENDERUNG" };
  const aufgaben = await ladeBetroffene(db, lagerId, m.id, neuesDatum);
  if (!aufgaben) return { fehler: "ZU_VIELE_AUFGABEN" };
  return {
    meilenstein: {
      id: m.id,
      version: m.version,
      datumAlt: m.datum,
      datumNeu: neuesDatum,
    },
    aufgaben,
  };
}

export type VerschiebeErgebnis =
  | { fehler: "KEINE_AENDERUNG" | "ZU_VIELE_AUFGABEN" }
  | { fehler: "VORSCHAU_VERALTET"; vorschau: Vorschau }
  | {
      meilenstein: Vorschau["meilenstein"];
      aufgaben: Verschiebung[];
      zustellung: Zustellung;
    };

// Bestätigung: in der Transaktion unter der Lagersperre. Erst die Vorschau mit dem Stand vergleichen (nichts geschrieben, wenn sie nicht mehr stimmt), dann das Datum des Meilensteins mit der erwarteten Version, dann alle Aufgaben mit einer einzigen Anweisung (frist = neues Datum + Versatz); jede Aufgabe bekommt ihre Version, Folgenummer und ihren Feed-Eintrag. Die Beteiligten der offenen Aufgaben bekommen eine gebündelte Benachrichtigung (eine je Person)
export async function verschiebeMeilenstein(
  tx: Tx,
  k: Akteur,
  meilensteinId: string,
  p: {
    version: number;
    datum: string;
    aufgaben: { id: string; version: number }[];
  },
): Promise<VerschiebeErgebnis | undefined> {
  await sperreLager(tx, k.lagerId);
  // Zuerst die Version des Meilensteins: Wer eine veraltete Ansicht hat, bekommt den Konflikt mit dem aktuellen Stand, auch wenn das Datum inzwischen dasselbe ist
  const alt = await ladeMeilenstein(tx, k.lagerId, meilensteinId);
  if (alt.version !== p.version) {
    await aendereZeile(tx, meilenstein, k, {
      id: meilensteinId,
      version: p.version,
      werte: { datum: p.datum },
      ansicht: meilensteinAnsicht,
    });
  }
  const vorschau = await zeigeVerschiebung(
    tx,
    k.lagerId,
    meilensteinId,
    p.datum,
  );
  if (!vorschau) return undefined;
  if ("fehler" in vorschau) return vorschau;
  const bestaetigt = new Map(p.aufgaben.map((a) => [a.id, a.version]));
  const stimmt =
    bestaetigt.size === vorschau.aufgaben.length &&
    vorschau.aufgaben.every((a) => bestaetigt.get(a.id) === a.version);
  if (!stimmt) return { fehler: "VORSCHAU_VERALTET", vorschau };

  const neu = await aendereZeile(tx, meilenstein, k, {
    id: meilensteinId,
    version: p.version,
    werte: { datum: p.datum },
    ansicht: meilensteinAnsicht,
  });
  const ids = vorschau.aufgaben.map((a) => a.id);
  const geschrieben = await setzeZeilen(tx, aufgabe, k, {
    ids,
    // Der Ausdruck rechnet die Datenbank je Zeile; die Typen der Werte kennen nur feste Daten
    werte: {
      frist: sql`${p.datum}::date + ${aufgabe.fristVersatzTage}`,
    } as never,
  });
  const versionen = new Map(geschrieben.map((z) => [z.id, z.version]));
  const offene = vorschau.aufgaben.filter((a) => a.status !== "erledigt");
  const zustellung = await benachrichtigeGebuendelt(tx, {
    lagerId: k.lagerId,
    art: "aufgabe_geaendert",
    ausgeloestVon: k.personId,
    eintraege: await ladeBeteiligteAbfrage(
      tx,
      k.lagerId,
      offene.map((a) => a.id),
    ),
  });
  return {
    meilenstein: {
      id: neu.id,
      version: neu.version,
      datumAlt: vorschau.meilenstein.datumAlt,
      datumNeu: neu.datum,
    },
    aufgaben: vorschau.aufgaben.map((a) => ({
      ...a,
      version: versionen.get(a.id) ?? a.version,
    })),
    zustellung,
  };
}

// Aufgabe und Person: die wirksame Verantwortliche (gesetzt, sonst die Leitung des Ressorts) und die Unterstützung, für viele Aufgaben in einer Abfrage. Sortiert nach Frist, damit die gebündelte Benachrichtigung die nächste Frist der Person öffnet
type Beteiligung = { aufgabeId: string; personId: string };
async function ladeBeteiligteAbfrage(
  tx: Tx,
  lagerId: string,
  aufgabeIds: string[],
): Promise<Beteiligung[]> {
  if (aufgabeIds.length === 0) return [];
  const liste = sql.join(
    aufgabeIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const zeilen = await tx.execute<{
    aufgabe_id: string;
    person_id: string;
  }>(sql`
    select a.id as aufgabe_id, w.person_id
    from aufgabe a
    left join ressort r on r.lager_id = a.lager_id and r.id = a.ressort_id and r.geloescht_am is null
    cross join lateral (
      select coalesce(a.verantwortlich_person_id, r.leitung_person_id) as person_id
      union
      select u.person_id from aufgabe_unterstuetzung u where u.aufgabe_id = a.id
    ) w
    where a.lager_id = ${lagerId} and a.id in (${liste}) and w.person_id is not null
    order by a.frist, a.id`);
  return zeilen.map((z) => ({
    aufgabeId: z.aufgabe_id,
    personId: z.person_id,
  }));
}

// Eine Benachrichtigung je Person und Lager, auch wenn mehrere Aufgaben betroffen sind: Sie öffnet die erste Aufgabe der Person (die Liste ist nach Frist geordnet). benachrichtige läuft je Aufgabe, die so für mindestens eine Person die erste ist; die Push-Texte nennen nie eine Aufgabe
export async function benachrichtigeGebuendelt(
  tx: Tx,
  p: {
    lagerId: string;
    art: BenachrichtigungsArt;
    ausgeloestVon?: string;
    eintraege: Beteiligung[];
  },
): Promise<Zustellung> {
  const ersteJePerson = new Map<string, string>();
  for (const e of p.eintraege) {
    if (!ersteJePerson.has(e.personId))
      ersteJePerson.set(e.personId, e.aufgabeId);
  }
  const jeAufgabe = new Map<string, string[]>();
  for (const [personId, aufgabeId] of ersteJePerson) {
    jeAufgabe.set(aufgabeId, [...(jeAufgabe.get(aufgabeId) ?? []), personId]);
  }
  const zustellungen: Zustellung[] = [];
  for (const [aufgabeId, personIds] of jeAufgabe) {
    const objekt: BenachrichtigungObjekt = { typ: "aufgabe", id: aufgabeId };
    zustellungen.push(
      await benachrichtige(tx, {
        lagerId: p.lagerId,
        empfaengerIds: personIds,
        art: p.art,
        objekt,
        ausgeloestVon: p.ausgeloestVon,
      }),
    );
  }
  return {
    empfaengerIds: zustellungen.flatMap((z) => z.empfaengerIds),
    senden: async (ctx) => {
      for (const z of zustellungen) await z.senden(ctx);
    },
  };
}

// Erinnerung ------------------------------------------------------------------

// Eine Aufgabe wird erinnert, wenn ihre Frist heute oder in den nächsten ERINNERUNG_TAGE Tagen liegt (Annahme A12)
export const ERINNERUNG_TAGE = 3;
// Der Lauf läuft stündlich und tut erst ab dieser Stunde (Zürcher Zeit) etwas: So kommt die Erinnerung am Morgen, auch wenn der Server später startet
export const ERINNERUNG_AB_STUNDE = 7;

const zuerichStunde = (jetzt: Date) =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Zurich",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(jetzt),
  );

// Ein Lauf: Eine Anweisung wählt alle fälligen Aufgaben aller Lager, vermerkt sie als erinnert (frist_erinnert_am) und liefert die Beteiligten dazu. Das Vermerken und die Auswahl sind dieselbe Anweisung (ein zweiter Lauf oder eine zweite Instanz findet nichts mehr). «Heute» ist der Zürcher Kalendertag; eine Aufgabe wird höchstens einmal je Zürcher Tag erinnert, auch über die Sommerzeitumstellung. Fällig: Frist im Fenster, nicht erledigt, nicht gelöscht, nicht «später» (spaeter_ab), Lager im Entwurf oder aktiv und kein Übungslager. Danach eine Benachrichtigung je Person und Lager. frist_erinnert_am ist kein Teil der Ansicht und ändert weder Version noch Feed. Liefert die Zahl der erinnerten Aufgaben
export async function sendeFristErinnerungen(
  db: Db,
  optionen: { fcm?: Fcm; jetzt?: Date } = {},
): Promise<number> {
  const jetzt = optionen.jetzt ?? new Date();
  if (zuerichStunde(jetzt) < ERINNERUNG_AB_STUNDE) return 0;
  const { anzahl, zustellungen } = await db.transaction(async (tx) => {
    const zeilen = await tx.execute<{
      aufgabe_id: string;
      lager_id: string;
      person_id: string | null;
    }>(sql`
      with heute as (select (${jetzt.toISOString()}::timestamptz at time zone 'Europe/Zurich')::date as tag),
      faellig as (
        update aufgabe a set frist_erinnert_am = ${jetzt.toISOString()}::timestamptz
        from lager l, heute h
        where l.id = a.lager_id
          and l.status in ('entwurf', 'aktiv') and not l.uebung
          and a.geloescht_am is null and a.status <> 'erledigt'
          and a.frist is not null and a.frist between h.tag and h.tag + ${ERINNERUNG_TAGE}::int
          and (a.spaeter_ab is null or a.spaeter_ab <= h.tag)
          and (a.frist_erinnert_am is null or (a.frist_erinnert_am at time zone 'Europe/Zurich')::date < h.tag)
        returning a.id, a.lager_id, a.frist, a.verantwortlich_person_id, a.ressort_id
      )
      select f.id as aufgabe_id, f.lager_id, w.person_id
      from faellig f
      left join ressort r on r.lager_id = f.lager_id and r.id = f.ressort_id and r.geloescht_am is null
      left join lateral (
        select coalesce(f.verantwortlich_person_id, r.leitung_person_id) as person_id
        union
        select u.person_id from aufgabe_unterstuetzung u where u.aufgabe_id = f.id
      ) w on true
      order by f.lager_id, f.frist, f.id`);
    const aufgaben = new Set(zeilen.map((z) => z.aufgabe_id));
    const jeLager = new Map<string, Beteiligung[]>();
    for (const z of zeilen) {
      if (!z.person_id) continue;
      jeLager.set(z.lager_id, [
        ...(jeLager.get(z.lager_id) ?? []),
        { aufgabeId: z.aufgabe_id, personId: z.person_id },
      ]);
    }
    const zustellungen: Zustellung[] = [];
    for (const [lagerId, eintraege] of jeLager) {
      zustellungen.push(
        await benachrichtigeGebuendelt(tx, {
          lagerId,
          art: "frist",
          eintraege,
        }),
      );
    }
    return { anzahl: aufgaben.size, zustellungen };
  });
  // Nach dem Commit: Der Push wirft nie, ein Fehler lässt die vermerkte Erinnerung stehen
  for (const z of zustellungen) await z.senden({ db, fcm: optionen.fcm });
  return anzahl;
}

// Startet den Lauf sofort und dann stündlich; ins Log kommt nur die Anzahl, bei einem Fehler nur sein Code
export function starteFristErinnerung(lauf: () => Promise<number>) {
  const starte = () =>
    lauf()
      .then((anzahl) =>
        log(undefined, { ereignis: "lager_fristen", erinnert: anzahl }),
      )
      .catch((fehler) =>
        log(undefined, {
          ereignis: "lager_fristen",
          code: fehlerCode(fehler) ?? "unerwartet",
        }),
      );
  void starte();
  return setInterval(starte, 60 * 60 * 1000);
}

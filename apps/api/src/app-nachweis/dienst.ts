import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { appNachweisChallenge, appNachweisGeraet } from "../db/schema.js";
import { bindung, hashVon, neueNonce, NONCE_FORMAT } from "./bindung.js";
import type { Geraeteablage } from "./ios.js";
import type {
  AndroidEingabe,
  IosEingabe,
  NachweisPruefer,
  Plattform,
  PlattformParameter,
} from "./typen.js";

// Der Ablauf des App-Nachweises (#785): Herausforderung holen, Nachweis prüfen und ein Ticket bekommen, mit dem Ticket anmelden. Jeder Schritt ist einmalig und läuft in der Datenbank ab (eine atomare Anweisung je Schritt), nie nur im Arbeitsspeicher.

export const CHALLENGE_MINUTEN = 5;
export const TICKET_MINUTEN = 2;
// Mehr offene Herausforderungen auf einmal sind ein Angriff auf die Datenbank, kein Betrieb
const MAX_OFFEN = 5000;
// Eine Stunde nach Ablauf räumt der tägliche Lauf auf
const AUFRAEUMEN_NACH = "1 hour";

export type NachweisAnfrage = {
  plattform: Plattform;
  nonce: string;
  benutzername: string;
  android?: Pick<AndroidEingabe, "integrityToken">;
  ios?: Pick<IosEingabe, "schluesselId" | "attestation" | "assertion">;
};

export type TicketErgebnis =
  { ok: true; plattform: Plattform; schluesselId?: string } | { ok: false };

export type AppNachweisDienst = {
  modus: "pruefen" | "pflicht";
  challenge(plattform: Plattform): Promise<{
    nonce: string;
    laeuftAbAm: Date;
    parameter: PlattformParameter;
  }>;
  nachweisen(
    anfrage: NachweisAnfrage,
  ): Promise<
    | { ok: true; ticket: string; laeuftAbAm: Date }
    | { ok: false; grund: string; voruebergehend?: boolean }
  >;
  loeseTicketEin(ticket: string, benutzername: string): Promise<TicketErgebnis>;
  verknuepfeGeraet(schluesselId: string, userId: string): Promise<void>;
  raeumeAuf(): Promise<number>;
};

// Zu viele offene Herausforderungen; die Route macht daraus 429
export class ZuVieleChallenges extends Error {}

export function erstelleAppNachweisDienst({
  db,
  modus,
  android,
  ios,
  parameter,
}: {
  db: Db;
  modus: "pruefen" | "pflicht";
  android: NachweisPruefer<AndroidEingabe>;
  ios: NachweisPruefer<IosEingabe>;
  parameter: Record<Plattform, PlattformParameter>;
}): AppNachweisDienst {
  const c = appNachweisChallenge;
  return {
    modus,
    async challenge(plattform) {
      const [offen] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(c)
        .where(gt(c.laeuftAbAm, sql`now()`));
      if ((offen?.n ?? 0) >= MAX_OFFEN) throw new ZuVieleChallenges();
      const nonce = neueNonce();
      const [zeile] = await db
        .insert(c)
        .values({
          nonceHash: hashVon(nonce),
          plattform,
          laeuftAbAm: sql`now() + ${`${CHALLENGE_MINUTEN} minutes`}::interval`,
        })
        .returning({ laeuftAbAm: c.laeuftAbAm });
      return {
        nonce,
        laeuftAbAm: zeile!.laeuftAbAm,
        parameter: parameter[plattform],
      };
    },

    async nachweisen(anfrage) {
      if (!NONCE_FORMAT.test(anfrage.nonce)) {
        return { ok: false, grund: "nonce-format" };
      }
      // Die Herausforderung gilt für genau einen Versuch: Wer sie einlöst, verbraucht sie, auch wenn der Nachweis scheitert. Der Benutzername wird gleich festgehalten, damit das Ticket nur für ihn gilt
      const benutzername = anfrage.benutzername.toLowerCase();
      const [zeile] = await db
        .update(c)
        .set({ eingeloestAm: sql`now()`, benutzername })
        .where(
          and(
            eq(c.nonceHash, hashVon(anfrage.nonce)),
            eq(c.plattform, anfrage.plattform),
            isNull(c.eingeloestAm),
            gt(c.laeuftAbAm, sql`now()`),
          ),
        )
        .returning({ id: c.id });
      if (!zeile) return { ok: false, grund: "challenge" };

      const gebunden = bindung(anfrage.nonce, benutzername).toString(
        "base64url",
      );
      const ergebnis =
        anfrage.plattform === "android" && anfrage.android
          ? await android.pruefe({ nonce: gebunden, ...anfrage.android })
          : anfrage.plattform === "ios" && anfrage.ios
            ? await ios.pruefe({ nonce: gebunden, ...anfrage.ios })
            : ({ ok: false, grund: "eingabe" } as const);
      if (!ergebnis.ok) return ergebnis;
      // Ein Gerät ohne das geforderte Siegel gilt nicht als echt
      if (!ergebnis.geraetOk) return { ok: false, grund: "geraet" };

      const ticket = neueNonce();
      const [fertig] = await db
        .update(c)
        .set({
          ticketHash: hashVon(ticket),
          ticketLaeuftAbAm: sql`now() + ${`${TICKET_MINUTEN} minutes`}::interval`,
          schluesselId: ergebnis.schluesselId ?? null,
        })
        .where(eq(c.id, zeile.id))
        .returning({ laeuftAb: c.ticketLaeuftAbAm });
      return { ok: true, ticket, laeuftAbAm: fertig!.laeuftAb! };
    },

    async loeseTicketEin(ticket, benutzername) {
      // Das Format zuerst: Ein Header von beliebiger Länge erreicht die Datenbank nie
      if (!NONCE_FORMAT.test(ticket)) return { ok: false };
      const [zeile] = await db
        .update(c)
        .set({ verbrauchtAm: sql`now()` })
        .where(
          and(
            eq(c.ticketHash, hashVon(ticket)),
            eq(c.benutzername, benutzername.toLowerCase()),
            isNull(c.verbrauchtAm),
            gt(c.ticketLaeuftAbAm, sql`now()`),
          ),
        )
        .returning({ plattform: c.plattform, schluesselId: c.schluesselId });
      return zeile
        ? {
            ok: true,
            plattform: zeile.plattform,
            ...(zeile.schluesselId && { schluesselId: zeile.schluesselId }),
          }
        : { ok: false };
    },

    async verknuepfeGeraet(schluesselId, userId) {
      await db
        .update(appNachweisGeraet)
        .set({ userId })
        .where(
          and(
            eq(appNachweisGeraet.schluesselId, schluesselId),
            isNull(appNachweisGeraet.userId),
          ),
        );
    },

    async raeumeAuf() {
      const geloescht = await db
        .delete(c)
        .where(
          lt(
            sql`greatest(${c.laeuftAbAm}, ${c.ticketLaeuftAbAm})`,
            sql`now() - ${AUFRAEUMEN_NACH}::interval`,
          ),
        )
        .returning({ id: c.id });
      return geloescht.length;
    },
  };
}

// Die Schlüssel der iOS-Geräte in der Datenbank
export function erstelleGeraeteablage(db: Db): Geraeteablage {
  const g = appNachweisGeraet;
  return {
    async holen(schluesselId) {
      const [zeile] = await db
        .select({
          oeffentlicherSchluessel: g.oeffentlicherSchluessel,
          zaehler: g.zaehler,
        })
        .from(g)
        .where(eq(g.schluesselId, schluesselId));
      return zeile;
    },
    async anlegen(geraet) {
      const eingefuegt = await db
        .insert(g)
        .values(geraet)
        .onConflictDoNothing()
        .returning({ id: g.schluesselId });
      return eingefuegt.length === 1;
    },
    async zaehlerErhoehen(schluesselId, neu) {
      const gesetzt = await db
        .update(g)
        .set({ zaehler: neu })
        .where(and(eq(g.schluesselId, schluesselId), lt(g.zaehler, neu)))
        .returning({ id: g.schluesselId });
      return gesetzt.length === 1;
    },
  };
}

import { createHmac, randomBytes } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import type {
  AktivitaetEintrag,
  AktivitaetSenke,
} from "./aktivitaet-middleware.js";
import type { Db } from "./db/client.js";
import {
  aktivitaet,
  kind,
  kindEltern,
  personPlattformRolle,
  plattformEntwickler,
  plattformRolle,
  rolle,
  user,
} from "./db/schema.js";
import { fehlerCode } from "./kalender/fehler.js";
import { log } from "./log.js";

// Aktivitätsprotokoll (#637), die Seite der Ablage. Die Anfrage schreibt nie in die Datenbank: Sie legt eine Zeile in einen Puffer, ein Takt schreibt ihn gebündelt (eine Einfügung für viele Zeilen). Ein Fehler beim Schreiben, ein voller Puffer und eine Flut anonymer Anfragen kosten Zeilen, nie eine Antwort; was verloren ging, zählt eine eigene Systemzeile.
export type AktivitaetOptionen = {
  // Takt des Schreibens; null schreibt nur bei leere() (Tests)
  taktMs?: number | null;
  // Obergrenze des Puffers; darüber fallen neue Zeilen weg
  maxPuffer?: number;
  // Anonyme Anfragen (ohne Sitzung) je Minute; darüber fallen sie weg, damit eine Flut von Fehlversuchen das Protokoll nicht füllt
  maxAnonymProMinute?: number;
  // Wie lange die Rollen einer Person zwischengespeichert bleiben
  rollenCacheMs?: number;
};

const TAG_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;

export type Aktivitaetsprotokoll = AktivitaetSenke & {
  // Eine Systemzeile: ein Ereignis ohne Person (Lauf, Start, Versand), mit einer Zahl
  system(
    ereignis: string,
    angaben?: { anzahl?: number; fehlerCode?: string; bereich?: string },
  ): void;
  // Schreibt alles, was im Puffer liegt; für den Abschluss des Prozesses und für Tests
  leere(): Promise<void>;
  // Beendet den Takt
  stopp(): void;
  zaehler(): { puffer: number; geschrieben: number; verworfen: number };
};

export function erstelleAktivitaetsprotokoll(
  db: Db,
  {
    taktMs = 1000,
    maxPuffer = 5000,
    maxAnonymProMinute = 300,
    rollenCacheMs = 5 * 60 * 1000,
  }: AktivitaetOptionen = {},
): Aktivitaetsprotokoll {
  let puffer: AktivitaetEintrag[] = [];
  let geschrieben = 0;
  let verworfen = 0;
  let verlorenGemeldet = 0;
  let schreibt: Promise<void> | undefined;
  const offen = new Set<Promise<unknown>>();
  // Das Salz der IP-Hashes: nur im Speicher, täglich neu; danach lässt sich kein Hash mehr einer IP zuordnen
  let salz = randomBytes(32);
  let salzTag = Math.floor(Date.now() / TAG_MS);
  let anonymFenster = { minute: 0, anzahl: 0 };
  const cache = new Map<
    string,
    { bis: number; name: string; rollen: string[]; abteilungId: string }
  >();

  function herkunft(ip: string | undefined) {
    if (!ip) return undefined;
    const tag = Math.floor(Date.now() / TAG_MS);
    if (tag !== salzTag) {
      salz = randomBytes(32);
      salzTag = tag;
    }
    // 12 Hex-Zeichen: genug, um Häufungen zu erkennen; zu wenig, um eine IP aus einer Liste zurückzurechnen
    return createHmac("sha256", salz).update(ip).digest("hex").slice(0, 12);
  }

  function erfasse(eintrag: AktivitaetEintrag) {
    try {
      if (eintrag.akteur === "anonym" && eintrag.art !== "system") {
        const minute = Math.floor(Date.now() / 60_000);
        if (anonymFenster.minute !== minute)
          anonymFenster = { minute, anzahl: 0 };
        if (++anonymFenster.anzahl > maxAnonymProMinute) {
          verworfen++;
          return;
        }
      }
      if (puffer.length >= maxPuffer) {
        verworfen++;
        return;
      }
      puffer.push(eintrag);
      if (puffer.length === BATCH) void schreibe();
    } catch {
      verworfen++;
    }
  }

  // Name und Funktionen der Personen im Puffer, zum Zeitpunkt des Schreibens (höchstens eine Sekunde nach der Tat). Eine gebündelte Abfrage je Quelle für alle noch unbekannten Personen; bekannte kommen aus dem Zwischenspeicher
  async function reichereAn(zeilen: AktivitaetEintrag[]) {
    const jetzt = Date.now();
    const gesucht = [
      ...new Set(
        zeilen
          .filter((z) => z.userId && !z.name)
          .map((z) => z.userId as string),
      ),
    ].filter((id) => (cache.get(id)?.bis ?? 0) < jetzt);
    if (gesucht.length > 0) {
      const [personen, entwickler, rollenZeilen, stufen, eltern, kinderKonten] =
        await Promise.all([
          db
            .select({
              id: user.id,
              name: user.name,
              rolle: user.role,
              abteilungId: user.abteilungId,
            })
            .from(user)
            .where(inArray(user.id, gesucht)),
          db
            .select({ id: plattformEntwickler.userId })
            .from(plattformEntwickler)
            .where(inArray(plattformEntwickler.userId, gesucht)),
          db
            .select({
              id: personPlattformRolle.userId,
              schluessel: plattformRolle.schluessel,
            })
            .from(personPlattformRolle)
            .innerJoin(
              plattformRolle,
              eq(plattformRolle.id, personPlattformRolle.rolleId),
            )
            .where(inArray(personPlattformRolle.userId, gesucht)),
          db
            .select({ id: rolle.userId, typ: rolle.typ })
            .from(rolle)
            .where(inArray(rolle.userId, gesucht)),
          db
            .select({ id: kindEltern.userId })
            .from(kindEltern)
            .where(inArray(kindEltern.userId, gesucht)),
          db
            .select({ id: kind.userId })
            .from(kind)
            .where(inArray(kind.userId, gesucht)),
        ]);
      for (const p of personen) {
        const r = new Set<string>();
        if (p.rolle === "admin") r.add("abteilungsleitung");
        if (entwickler.some((e) => e.id === p.id)) r.add("entwickler");
        for (const z of rollenZeilen) {
          if (z.id === p.id)
            r.add(
              z.schluessel === "webmaster" ? "webmaster" : "plattformrolle",
            );
        }
        for (const s of stufen) if (s.id === p.id) r.add(s.typ);
        if (eltern.some((e) => e.id === p.id)) r.add("eltern");
        if (kinderKonten.some((k) => k.id === p.id)) r.add("teilnehmer");
        cache.set(p.id, {
          bis: jetzt + rollenCacheMs,
          name: p.name.slice(0, 120),
          abteilungId: p.abteilungId,
          rollen: [...r].sort(),
        });
      }
      // Der Zwischenspeicher wächst nicht ohne Grenze
      if (cache.size > 2000) cache.clear();
    }
    for (const z of zeilen) {
      const bekannt = z.userId ? cache.get(z.userId) : undefined;
      if (bekannt) {
        z.name ??= bekannt.name;
        z.rollen ??= bekannt.rollen;
        z.abteilungId ??= bekannt.abteilungId;
      }
    }
  }

  async function schreibeBatch(zeilen: AktivitaetEintrag[]) {
    await reichereAn(zeilen).catch(() => {
      // Ohne Namen und Funktionen: Die Zeilen sind trotzdem wertvoll
    });
    await db.insert(aktivitaet).values(
      zeilen.map((z) => ({
        zeit: z.zeit,
        art: z.art,
        abteilungId: z.abteilungId,
        userId: z.userId,
        akteur:
          z.akteur ?? (z.userId ? ("person" as const) : ("anonym" as const)),
        name: z.name,
        rollen: z.rollen ?? [],
        methode: z.methode,
        aktion: z.aktion.slice(0, 200),
        bereich: z.bereich.slice(0, 60),
        objektTyp: z.objektTyp,
        objektId: z.objektId,
        felder: z.felder,
        status: z.status,
        ergebnis: z.ergebnis,
        fehlerCode: z.fehlerCode?.slice(0, 60),
        dauerMs: z.dauerMs,
        herkunft: z.herkunft,
        geraet: z.geraet,
        anfrageId: z.anfrageId,
        anzahl: z.anzahl,
      })),
    );
    geschrieben += zeilen.length;
  }

  // Ein Schreiben zur Zeit: Läuft eines, übernimmt es auch, was inzwischen im Puffer liegt
  async function lauf() {
    while (puffer.length > 0) {
      const zeilen = puffer.slice(0, BATCH);
      puffer = puffer.slice(BATCH);
      try {
        await schreibeBatch(zeilen);
      } catch (fehler) {
        // Nur der Code: Eine Datenbankmeldung kann Werte enthalten. Die Zeilen sind verloren, damit ein Ausfall den Speicher nie füllt
        verworfen += zeilen.length;
        log(undefined, {
          ereignis: "aktivitaet",
          code: fehlerCode(fehler) ?? "unerwartet",
          verloren: zeilen.length,
        });
      }
    }
    // Was seit der letzten Meldung wegfiel, steht als eigene Zeile da, damit das Protokoll seine Lücken selbst zeigt
    if (verworfen > verlorenGemeldet) {
      const fehlt = verworfen - verlorenGemeldet;
      verlorenGemeldet = verworfen;
      await db
        .insert(aktivitaet)
        .values({
          art: "system",
          akteur: "system",
          aktion: "protokoll_luecke",
          bereich: "protokoll",
          ergebnis: "fehler",
          anzahl: Math.min(fehlt, 2_000_000_000),
        })
        .catch(() => {});
    }
  }
  function schreibe(): Promise<void> {
    if (schreibt) return schreibt;
    const p: Promise<void> = lauf().finally(() => {
      if (schreibt === p) schreibt = undefined;
    });
    schreibt = p;
    return p;
  }

  const takt =
    taktMs === null
      ? undefined
      : // unref: Der Takt hält den Prozess nicht am Leben
        setInterval(() => void schreibe(), taktMs).unref();

  return {
    erfasse,
    herkunft,
    erwarte(p) {
      offen.add(p);
      void p.finally(() => offen.delete(p));
    },
    system(ereignis, angaben = {}) {
      erfasse({
        zeit: new Date(),
        art: "system",
        akteur: "system",
        aktion: ereignis.slice(0, 200),
        bereich: angaben.bereich ?? "system",
        ergebnis: angaben.fehlerCode ? "fehler" : "erfolg",
        fehlerCode: angaben.fehlerCode,
        anzahl: angaben.anzahl,
      });
    },
    async leere() {
      // Erst die Zeilen, die noch entstehen, dann zwei Durchgänge: Läuft gerade ein Schreiben, wartet das zweite auf die Zeilen, die inzwischen dazukamen
      await Promise.allSettled([...offen]);
      await schreibe();
      await schreibe();
    },
    stopp() {
      if (takt) clearInterval(takt);
    },
    zaehler() {
      return { puffer: puffer.length, geschrieben, verworfen };
    },
  };
}

// Löscht nach der Frist und über der Obergrenze (die Funktion der Datenbank hat eigene Untergrenzen); liefert die Zahl der gelöschten Zeilen
export async function loescheAlteAktivitaet(
  db: Db,
  { tage, maxZeilen }: { tage: number; maxZeilen: number },
) {
  const [zeile] = await db.execute<{ n: string }>(
    sql`select aktivitaet_aufraeumen(${tage}, ${maxZeilen}) as n`,
  );
  return Number(zeile?.n ?? 0);
}

// Ein Ereignis aus log(undefined, …) als Systemzeile: der Name, die erste Zahl (gelöscht, gesendet, erinnert …) und ein Fehlercode; keine anderen Felder. Ein Lauf, der nichts getan hat (alle Zahlen 0, kein Code), bleibt weg: Er füllte das Protokoll mit täglichen Nullzeilen
export function systemzeileAus(
  protokoll: Pick<Aktivitaetsprotokoll, "system">,
  felder: Record<string, unknown>,
) {
  const name = felder.ereignis;
  if (typeof name !== "string" || name === "aktivitaet" || name === "health") {
    return;
  }
  const zahlen = Object.entries(felder).filter(
    ([k, v]) => k !== "zeit" && typeof v === "number" && Number.isFinite(v),
  ) as [string, number][];
  const code =
    typeof felder.code === "string" ? felder.code.slice(0, 60) : undefined;
  if (!code && zahlen.length > 0 && zahlen.every(([, v]) => v === 0)) return;
  const typ =
    typeof felder.typ === "string" ? `:${felder.typ.slice(0, 40)}` : "";
  protokoll.system(`${name}${typ}`.slice(0, 100), {
    anzahl: zahlen[0]
      ? Math.min(Math.max(Math.trunc(zahlen[0][1]), 0), 2_000_000_000)
      : undefined,
    fehlerCode: code,
    bereich: name.split("_")[0]!.slice(0, 60),
  });
}

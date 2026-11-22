import { createHash } from "node:crypto";
import { and, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../../db/client.js";
import { programm } from "../../db/schema.js";
import {
  baueIcs,
  ohneStempel,
  type IcsTermin,
} from "../../termine/ical-text.js";
import { pruefeToken } from "../../termine/ical-token.js";
import {
  ladeSichtTags,
  meineTermine,
  TERMIN_BEGINN,
} from "../../termine/sicht.js";

// ICS-Feed «Mein Kalender» (TC2 #438): GET /ical/<Token>.ics, ohne Sitzung und ausserhalb von /api/v1; app.ts hängt ihn vor der Sitzung ein. Der Token im Pfad ist das einzige Geheimnis.
// Der Token steht nie in Log, Fehlertext oder Audit: Das Anfrage-Log führt das Routenmuster «/ical/:datei», die Fehlerantworten nennen den Pfad nicht, kein Cookie wird gelesen oder gesetzt. Unbekannter, widerrufener oder formal falscher Token und gesperrte Konten sind dieselbe 404-Antwort.
// Abfragen je Abruf: Token und Konto (1, Pflicht, damit ein Widerruf sofort wirkt); dazu bei leerem Zwischenspeicher die Sicht der Person (1) und die Termine (1). Der fertige Text liegt 5 Minuten (Takt des Kalender-Abgleichs) im Prozess; ein Abruf mit passendem If-None-Match bekommt 304 ohne Termine-Abfrage.

const DATEI = /^([A-Za-z0-9_-]{43})\.ics$/;
const TTL_MS = 5 * 60_000;
const MAX_EINTRAEGE = 500;
// Wie der Abgleich: gestern bis rund 400 Tage voraus (Schweizer Kalendertage)
const TAGE_VORAUS = 400;
const MAX_TERMINE = 2000;

// shortcut: Zähler und Zwischenspeicher im Arbeitsspeicher einer Instanz, ein Neustart leert sie; bei mehreren Instanzen zählt jede für sich und ein Widerruf wirkt trotzdem sofort (er steht in der Token-Prüfung)
function erstelleZaehler(limit: number, fensterMs: number) {
  const fenster = new Map<string, { start: number; n: number }>();
  return (schluessel: string) => {
    const jetzt = Date.now();
    if (fenster.size >= 10_000) {
      for (const [k, w] of fenster) {
        if (jetzt - w.start >= fensterMs) fenster.delete(k);
      }
      // Immer noch voll: den ältesten Eintrag opfern, der Speicher bleibt beschränkt
      if (fenster.size >= 10_000) {
        fenster.delete(fenster.keys().next().value as string);
      }
    }
    const w = fenster.get(schluessel);
    if (!w || jetzt - w.start >= fensterMs) {
      fenster.set(schluessel, { start: jetzt, n: 1 });
      return false;
    }
    w.n += 1;
    return w.n > limit;
  };
}

// «ETag-Liste» aus If-None-Match; schwache Vergleiche genügen für 304
const passt = (kopf: string | undefined, etag: string) =>
  kopf !== undefined &&
  kopf
    .split(",")
    .map((e) => e.trim().replace(/^W\//, ""))
    .some((e) => e === "*" || e === etag);

type Feed = { text: string; etag: string };

export function erstelleIcalRoute({
  db,
  ipLimit = 300,
  praefixLimit = 30,
  fensterMs = 10 * 60_000,
}: {
  db: Db;
  ipLimit?: number;
  praefixLimit?: number;
  fensterMs?: number;
}) {
  const zuVieleIp = erstelleZaehler(ipLimit, fensterMs);
  const zuVielePraefix = erstelleZaehler(praefixLimit, fensterMs);
  const speicher = new Map<string, { bis: number; feed: Promise<Feed> }>();

  async function baue(person: { id: string; abteilungId: string }) {
    const sichtTags = await ladeSichtTags(db, person);
    // Schweizer Kalendertage, gleiche Bedingung wie «Mein Kalender» (mein.ts); ein Termin ohne Ende zählt mit seinem Beginn
    const heute = sql`(now() at time zone 'Europe/Zurich')::date`;
    const zeilen: IcsTermin[] = await db
      .select({
        id: programm.id,
        titel: programm.titel,
        status: programm.status,
        ganztaegig: programm.ganztaegig,
        beginn: programm.beginn,
        ende: programm.ende,
        tagVon: programm.tagVon,
        tagBis: programm.tagBis,
        ort: programm.ort,
      })
      .from(programm)
      .where(
        and(
          meineTermine(person, sichtTags),
          sql`coalesce(programm.tag_bis, (coalesce(programm.ende, programm.beginn) at time zone 'Europe/Zurich')::date) >= ${heute} - 1`,
          sql`coalesce(programm.tag_von, (programm.beginn at time zone 'Europe/Zurich')::date) <= ${heute} + ${TAGE_VORAUS}::int`,
        ),
      )
      .orderBy(TERMIN_BEGINN, programm.id)
      .limit(MAX_TERMINE);
    const text = baueIcs(zeilen, new Date());
    const etag = `"${createHash("sha256").update(ohneStempel(text)).digest("hex").slice(0, 32)}"`;
    return { text, etag };
  }

  // Gleichzeitige Abrufe einer Person teilen sich einen Bau; ein Fehler bleibt nicht im Speicher
  function feedFuer(person: { id: string; abteilungId: string }) {
    const jetzt = Date.now();
    const alt = speicher.get(person.id);
    if (alt && alt.bis > jetzt) return alt.feed;
    const feed = baue(person);
    speicher.delete(person.id);
    speicher.set(person.id, { bis: jetzt + TTL_MS, feed });
    feed.catch(() => {
      if (speicher.get(person.id)?.feed === feed) speicher.delete(person.id);
    });
    if (speicher.size > MAX_EINTRAEGE) {
      speicher.delete(speicher.keys().next().value as string);
    }
    return feed;
  }

  return new Hono().get("/ical/:datei", async (c) => {
    // Vor jeder Abfrage, auch Fehlversuche zählen. Hinter dem Edge-Caddy ist der letzte Eintrag von X-Forwarded-For die Adresse, die er gesehen hat
    const ip =
      c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim() || "unbekannt";
    const datei = DATEI.exec(c.req.param("datei"));
    if (
      zuVieleIp(`ip:${ip}`) ||
      (datei && zuVielePraefix(`p:${datei[1].slice(0, 8)}`))
    ) {
      c.header("Retry-After", String(Math.ceil(fensterMs / 1000)));
      throw new HTTPException(429);
    }
    if (!datei) throw new HTTPException(404);
    const person = await pruefeToken(db, datei[1]);
    if (!person) throw new HTTPException(404);
    const feed = await feedFuer({
      id: person.userId,
      abteilungId: person.abteilungId,
    });
    c.header("Cache-Control", "private, no-store");
    c.header("ETag", feed.etag);
    if (passt(c.req.header("if-none-match"), feed.etag)) {
      return c.body(null, 304);
    }
    c.header("Content-Type", "text/calendar; charset=utf-8");
    return c.body(feed.text);
  });
}

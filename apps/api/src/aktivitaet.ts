import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import {
  beschreibungVon,
  sicherDetails,
  type AenderungsDetails,
} from "./aktivitaet-beschreibung.js";
import type {
  AktivitaetEintrag,
  AktivitaetSenke,
  NamensAbfrage,
} from "./aktivitaet-middleware.js";
import type { Db } from "./db/client.js";
import {
  aktivitaet,
  auditLog,
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

// Änderungsprotokoll (#637, #662), die Seite der Ablage. Die Anfrage schreibt nie in die Datenbank: Sie legt eine Zeile in einen Puffer, ein Takt schreibt ihn gebündelt (eine Einfügung für viele Zeilen). Ein Fehler beim Schreiben, ein voller Puffer und eine Flut anonymer Anfragen kosten Zeilen, nie eine Antwort; was verloren ging, zählt eine eigene Systemzeile.
// Sicherheitsereignisse (fehlgeschlagene Anmeldung, falscher zweiter Faktor, Begrenzung) werden hier je Konto oder Herkunft, Ereignis und Stunde zu einer Zeile mit Zahl zusammengezogen, höchstens maxSicherheitProStunde Zeilen je Stunde.
export type AktivitaetOptionen = {
  // Takt des Schreibens; null schreibt nur bei leere() (Tests)
  taktMs?: number | null;
  // Obergrenze des Puffers; darüber fallen neue Zeilen weg
  maxPuffer?: number;
  // Anonyme Änderungen (ohne Sitzung) je Minute; darüber fallen sie weg
  maxAnonymProMinute?: number;
  // Verschiedene Sicherheitsereignisse (Konto oder Herkunft mal Ereignis) je Stunde; darüber fallen sie weg
  maxSicherheitProStunde?: number;
  // Wie lange die Rollen einer Person zwischengespeichert bleiben
  rollenCacheMs?: number;
};

const TAG_MS = 24 * 60 * 60 * 1000;
const STUNDE_MS = 60 * 60 * 1000;
// Eine Sicherheitszeile wartet höchstens so lange auf weitere Ereignisse gleicher Art
const SICHERHEIT_ALTER_MS = 15 * 60 * 1000;
const BATCH = 200;

// Tabellen ohne Personendaten, aus denen der Name eines Objekts in den Satz kommt. Schlüssel ist das Wort im Pfad vor der Kennung. Nie hier: Personen, Kinder, Konten, Teilnehmende, Inhalte (Aufgaben, Notizen, Nachrichten)
type NamensQuelle = (ids: SQL) => SQL;
const nameAus =
  (tabelle: string, spalte: string): NamensQuelle =>
  (ids) =>
    sql`select id::text as id, ${sql.raw(spalte)} as name from ${sql.raw(tabelle)} where id in (${ids})`;
const NAMENS_QUELLEN: Record<string, (elternTyp?: string) => NamensQuelle> = {
  anlaesse: () => (ids) =>
    sql`select a.id::text as id, p.titel as name from anlass a join programm p on p.id = a.programm_id where a.id in (${ids})`,
  lager: () => nameAus("lager", "titel"),
  tags: () => nameAus("tag", "name"),
  gruppen: () => nameAus("tag", "name"),
  stufen: () => nameAus("stufe", "name"),
  raeume: () => nameAus("raum", "name"),
  artikel: () => nameAus("laden_artikel", "name"),
  seiten: () => nameAus("seite", "titel"),
  orte: () => nameAus("ort", "name"),
  vorlagen: () => nameAus("vorlage", "name"),
  // Unter einer Gruppe die Rolle der Gruppe, sonst die globale Rolle
  rollen: (elternTyp) =>
    elternTyp === "gruppen"
      ? nameAus("gruppen_rolle", "name")
      : nameAus("plattform_rolle", "name"),
};

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
    maxSicherheitProStunde = 200,
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

  // Sicherheitsereignisse warten hier, bis die Stunde um ist oder der Eintrag alt genug; erst dann wird eine Zeile mit der Zahl daraus
  const sicherheit = new Map<
    string,
    { eintrag: AktivitaetEintrag; anzahl: number; stunde: number; erst: number }
  >();
  let sicherheitFenster = { stunde: 0, anzahl: 0 };
  function erfasseSicherheit(eintrag: AktivitaetEintrag) {
    const stunde = Math.floor(Date.now() / STUNDE_MS);
    const schluessel = [
      eintrag.userId ?? `h:${eintrag.herkunft ?? "-"}`,
      eintrag.aktion,
      eintrag.fehlerCode ?? "",
      stunde,
    ].join("|");
    const vorhanden = sicherheit.get(schluessel);
    if (vorhanden) {
      vorhanden.anzahl += eintrag.anzahl ?? 1;
      return;
    }
    if (sicherheitFenster.stunde !== stunde) {
      sicherheitFenster = { stunde, anzahl: 0 };
    }
    if (++sicherheitFenster.anzahl > maxSicherheitProStunde) {
      verworfen++;
      return;
    }
    sicherheit.set(schluessel, {
      eintrag,
      anzahl: eintrag.anzahl ?? 1,
      stunde,
      erst: Date.now(),
    });
  }
  // Legt die fälligen Sicherheitszeilen in den Puffer (alle, wenn das Protokoll geleert wird)
  function faelligeSicherheit(alle: boolean) {
    const stunde = Math.floor(Date.now() / STUNDE_MS);
    const jetzt = Date.now();
    for (const [schluessel, e] of sicherheit) {
      if (!alle && e.stunde >= stunde && jetzt - e.erst < SICHERHEIT_ALTER_MS) {
        continue;
      }
      sicherheit.delete(schluessel);
      puffer.push({
        ...e.eintrag,
        anzahl: Math.min(e.anzahl, 2_000_000_000),
      });
    }
  }

  function erfasse(eintrag: AktivitaetEintrag) {
    try {
      if (eintrag.art === "sicherheit") {
        erfasseSicherheit(eintrag);
        return;
      }
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

  // Namen von Objekten, gebündelt je Quelle (eine Abfrage je Tabelle); Objekte, die keine Quelle haben (Personen, Inhalte), fehlen in der Antwort
  async function holeNamen(abfrage: NamensAbfrage[]) {
    const gruppen = new Map<
      string,
      { typ: string; elternTyp?: string; ids: Set<string> }
    >();
    for (const a of abfrage) {
      if (!(a.typ in NAMENS_QUELLEN)) continue;
      const art = a.typ === "rollen" ? (a.elternTyp ?? "") : "";
      const schluessel = `${a.typ}|${art}`;
      const g = gruppen.get(schluessel) ?? {
        typ: a.typ,
        elternTyp: a.elternTyp,
        ids: new Set<string>(),
      };
      g.ids.add(a.id);
      gruppen.set(schluessel, g);
    }
    const antwort: Record<string, string> = {};
    await Promise.all(
      [...gruppen.values()].map(async (g) => {
        const ids = sql.join(
          [...g.ids].map((id) => sql`${id}::uuid`),
          sql`, `,
        );
        const zeilen = await db.execute<{ id: string; name: string | null }>(
          NAMENS_QUELLEN[g.typ]!(g.elternTyp)(ids),
        );
        for (const z of zeilen) {
          if (z.name) antwort[z.id] = z.name.slice(0, 120);
        }
      }),
    );
    return antwort;
  }

  // Zeilen des Audit-Logs, die schon einer Anfrage gehören (über Blöcke hinweg)
  const genutzteAudit = new Set<string>();
  // Zu jeder Änderung die Angaben aus dem Audit-Log derselben Anfrage (gleiche Person, gleiche Zeit): Name der Audit-Aktion und sichere Details (Namen von Rechten, einfache Werte). Eine Abfrage für den ganzen Block
  async function verknuepfeAudit(zeilen: AktivitaetEintrag[]) {
    const kandidaten = zeilen.filter(
      (z) => z.art === "aktion" && z.userId && z.gruppe !== undefined,
    );
    if (kandidaten.length === 0) return;
    // Die Zeile des Audit-Logs entsteht in der Anfrage, also zwischen Beginn und Ende; das Spiel fängt Uhren ab, die um Millisekunden abweichen
    const SPIEL = 250;
    const von = Math.min(...kandidaten.map((z) => z.zeit.getTime())) - SPIEL;
    const bis =
      Math.max(...kandidaten.map((z) => z.zeit.getTime() + (z.dauerMs ?? 0))) +
      SPIEL;
    const audit = await db
      .select({
        id: auditLog.id,
        akteurId: auditLog.akteurId,
        aktion: auditLog.aktion,
        zielId: auditLog.zielId,
        details: auditLog.details,
        zeit: auditLog.erstelltAm,
      })
      .from(auditLog)
      .where(
        and(
          inArray(auditLog.akteurId, [
            ...new Set(kandidaten.map((z) => z.userId as string)),
          ]),
          gte(auditLog.erstelltAm, new Date(von)),
          lte(auditLog.erstelltAm, new Date(bis)),
        ),
      );
    if (audit.length === 0) return;

    for (const z of kandidaten) {
      const ab = z.zeit.getTime() - SPIEL;
      const bisZ = z.zeit.getTime() + (z.dauerMs ?? 0) + SPIEL;
      const ziele = new Set(
        [z.objektId, z.aenderung?.eltern?.id].filter(Boolean),
      );
      // Alle Zeilen des Audit-Logs dieser Anfrage (eine Route schreibt manchmal zwei, z. B. Änderung und Status), das Objekt der Anfrage zuerst
      const treffer = audit
        .filter(
          (a) =>
            !genutzteAudit.has(a.id) &&
            a.akteurId === z.userId &&
            a.zeit.getTime() >= ab &&
            a.zeit.getTime() <= bisZ,
        )
        .sort(
          (x, y) =>
            Number(ziele.has(y.zielId)) - Number(ziele.has(x.zielId)) ||
            x.zeit.getTime() - y.zeit.getTime(),
        );
      if (treffer.length === 0) continue;
      const zusatz: AenderungsDetails = {
        ...z.aenderung,
        audit: treffer[0]!.aktion.slice(0, 80),
      };
      const werte: Record<string, string | number | boolean> = {};
      const hinzu = new Set<string>(z.aenderung?.hinzu ?? []);
      const weg = new Set<string>(z.aenderung?.weg ?? []);
      for (const t of treffer) {
        genutzteAudit.add(t.id);
        const sicher = sicherDetails(t.details);
        Object.assign(werte, sicher.werte);
        // Was die Route selbst meldet, geht vor
        if (!z.aenderung?.hinzu) sicher.hinzu?.forEach((r) => hinzu.add(r));
        if (!z.aenderung?.weg) sicher.weg?.forEach((r) => weg.add(r));
      }
      // Der Speicher wächst nicht ohne Grenze; eine Audit-Zeile, die so alt ist, trifft keine Anfrage mehr
      if (genutzteAudit.size > 2000) genutzteAudit.clear();
      if (Object.keys(werte).length > 0) zusatz.werte = werte;
      if (hinzu.size > 0) zusatz.hinzu = [...hinzu].sort();
      if (weg.size > 0) zusatz.weg = [...weg].sort();
      z.aenderung = zusatz;
    }
  }

  // Namen des Objekts und des Elternobjekts, soweit nicht schon vor dem Löschen gelesen
  async function ergaenzeNamen(zeilen: AktivitaetEintrag[]) {
    const abfrage: NamensAbfrage[] = [];
    for (const z of zeilen) {
      if (z.art !== "aktion") continue;
      if (z.objektTyp && z.objektId && !z.objektName) {
        abfrage.push({
          typ: z.objektTyp,
          id: z.objektId,
          elternTyp: z.aenderung?.eltern?.typ,
        });
      }
      const e = z.aenderung?.eltern;
      if (e && !e.name) abfrage.push({ typ: e.typ, id: e.id });
    }
    if (abfrage.length === 0) return;
    const namen = await holeNamen(abfrage);
    for (const z of zeilen) {
      if (z.art !== "aktion") continue;
      if (z.objektId && !z.objektName && namen[z.objektId]) {
        z.objektName = namen[z.objektId];
      }
      const e = z.aenderung?.eltern;
      if (e && !e.name && namen[e.id]) e.name = namen[e.id];
    }
  }

  async function schreibeBatch(zeilen: AktivitaetEintrag[]) {
    await reichereAn(zeilen).catch(() => {
      // Ohne Namen und Funktionen: Die Zeilen sind trotzdem wertvoll
    });
    await ergaenzeNamen(zeilen).catch(() => {
      // Ohne Namen der Objekte bleibt der Satz allgemein
    });
    await verknuepfeAudit(zeilen).catch(() => {
      // Ohne die Angaben aus dem Audit-Log bleibt die Zeile schmaler
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
        gruppe: z.gruppe,
        objektName: z.objektName?.slice(0, 120),
        felder: z.felder,
        aenderung: z.aenderung,
        beschreibung: (
          z.beschreibung ??
          beschreibungVon({
            art: z.art,
            aktion: z.aktion,
            objektTyp: z.objektTyp,
            objektName: z.objektName,
            anzahl: z.anzahl,
            aenderung: z.aenderung,
          })
        ).slice(0, 300),
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
    faelligeSicherheit(false);
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
    namen: (abfrage) => holeNamen(abfrage),
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
      faelligeSicherheit(true);
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

// Systemereignisse, die etwas bewirken und deshalb im Änderungsprotokoll stehen: Versand von Programm-Erinnerungen und Plattform-Mitteilungen per Push mit der Zahl der Geräte und die Erinnerungen zu Lager-Fristen. Läufe zum Aufräumen, Fehler (die stehen im Betriebs-Log) und Nullläufe nicht
const SYSTEM_AUFNEHMEN = new Set(["push_versand", "lager_fristen"]);

// Ein Ereignis aus log(undefined, …) als Systemzeile: der Name, die erste Zahl (gesendet, erinnert …) und der Typ; keine anderen Felder. Ein Lauf ohne Wirkung (Zahl 0), mit Fehlercode oder ausserhalb der Liste bleibt weg
export function systemzeileAus(
  protokoll: Pick<Aktivitaetsprotokoll, "system">,
  felder: Record<string, unknown>,
) {
  const name = felder.ereignis;
  if (typeof name !== "string" || !SYSTEM_AUFNEHMEN.has(name)) return;
  if (typeof felder.code === "string") return;
  // Chat, Lager und Termine sind Folgen einzelner Eingaben; Mitteilungen stehen schon als Zeile ihrer Route
  if (
    name === "push_versand" &&
    felder.typ !== "programm" &&
    felder.typ !== "plattform"
  ) {
    return;
  }
  const zahl = Object.entries(felder).find(
    ([k, v]) => k !== "zeit" && typeof v === "number" && Number.isFinite(v),
  )?.[1] as number | undefined;
  if (!zahl || zahl <= 0) return;
  const typ =
    typeof felder.typ === "string" ? `:${felder.typ.slice(0, 40)}` : "";
  protokoll.system(`${name}${typ}`.slice(0, 100), {
    anzahl: Math.min(Math.trunc(zahl), 2_000_000_000),
    bereich: name.split("_")[0]!.slice(0, 60),
  });
}

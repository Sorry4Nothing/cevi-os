import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import { raeumeAuf } from "../src/aufbewahrung.js";
import { erstelleDb, type Db } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { raeumeTextkopienAuf } from "../src/meldungen.js";
import { API_URL } from "./hilfen/datenbank.js";

const sqlClient = postgres(API_URL);
const db = erstelleDb(sqlClient);
afterAll(() => sqlClient.end());

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const ZURUECK = new Error("zurückrollen");

// Jede Prüfung in einer Transaktion, die zurückrollt: Die Jobs arbeiten auf der ganzen Datenbank, und die übrigen Testdateien laufen gleichzeitig
async function zurueckgerollt(pruefung: (tx: Tx) => Promise<void>) {
  await db
    .transaction(async (tx) => {
      await pruefung(tx);
      throw ZURUECK;
    })
    .catch((fehler) => {
      if (fehler !== ZURUECK) throw fehler;
    });
}

// Die Uhr des Jobs; Zeitpunkte der Daten liegen relativ dazu, Postgres rechnet die Monate wie im Job
const JETZT = new Date("2027-03-15T10:00:00Z");
const DAVOR = "1 minute";
type Versatz = `${number} ${"minute" | "hour"}`;
// Knapp vor (bleibt) oder knapp nach (weg) der Frist: «vor» ist ein Intervall vor JETZT, versetzt um eine Minute
function frist(
  intervall: string,
  seite: "bleibt" | "weg",
  versatz: Versatz = DAVOR,
): SQL<Date> {
  return sql`${JETZT.toISOString()}::timestamptz - ${sql.raw(`interval '${intervall}'`)} ${sql.raw(seite === "bleibt" ? "+" : "-")} ${sql.raw(`interval '${versatz}'`)}`;
}

async function neueWelt(tx: Tx) {
  const [abteilung] = await tx
    .insert(schema.abteilung)
    .values({ name: "Testabteilung" })
    .returning();
  const [stufe] = await tx
    .insert(schema.stufe)
    .values({
      abteilungId: abteilung.id,
      name: "Stufe A",
      kuerzel: "A",
      reihenfolge: 1,
    })
    .returning();
  const [chat] = await tx
    .insert(schema.chat)
    .values({ abteilungId: abteilung.id, typ: "stufe", stufeId: stufe.id })
    .returning();
  const [programm] = await tx
    .insert(schema.programm)
    .values({
      abteilungId: abteilung.id,
      googleEventId: randomUUID(),
      titel: "Programm",
      ganztaegig: true,
      tagVon: "2026-01-10",
      tagBis: "2026-01-10",
    })
    .returning();
  return { abteilung, stufe, chat, programm };
}
type Welt = Awaited<ReturnType<typeof neueWelt>>;

async function neuePerson(
  tx: Tx,
  welt: Welt,
  extra: Partial<Omit<typeof schema.user.$inferInsert, "deaktiviertAm">> & {
    deaktiviertAm?: Date | SQL;
  } = {},
) {
  const [person] = await tx
    .insert(schema.user)
    .values({
      name: "Vreni Muster",
      email: `${randomUUID()}@example.org`,
      abteilungId: welt.abteilung.id,
      ...extra,
    })
    .returning();
  return person;
}

async function neuesKind(
  tx: Tx,
  welt: Welt,
  inaktivSeit: Date | SQL | null,
  elternIds: string[] = [],
) {
  const [kind] = await tx
    .insert(schema.kind)
    .values({
      abteilungId: welt.abteilung.id,
      vorname: "Kind",
      nachname: "Muster",
      stufeId: welt.stufe.id,
      inaktivSeit: inaktivSeit as Date | null,
    })
    .returning();
  if (elternIds.length > 0) {
    await tx
      .insert(schema.kindEltern)
      .values(elternIds.map((userId) => ({ kindId: kind.id, userId })));
  }
  return kind;
}

const vorhanden = async (
  tx: Tx,
  tabelle: "nachricht" | "meldung",
  id: string,
) =>
  (
    await tx
      .select({ id: schema[tabelle].id })
      .from(schema[tabelle])
      .where(eq(schema[tabelle].id, id))
  ).length === 1;

test("abgelaufene Sitzungen gehen samt Push-Token, gültige bleiben", async () => {
  await zurueckgerollt(async (tx) => {
    const welt = await neueWelt(tx);
    const person = await neuePerson(tx, welt);
    const sitzung = async (ablauf: Date) => {
      const [s] = await tx
        .insert(schema.session)
        .values({
          userId: person.id,
          token: randomUUID(),
          expiresAt: ablauf,
          updatedAt: JETZT,
        })
        .returning({ id: schema.session.id });
      await tx.insert(schema.pushToken).values({
        sessionId: s.id,
        userId: person.id,
        token: randomUUID(),
        plattform: "android",
      });
      return s.id;
    };
    const abgelaufen = await sitzung(new Date(JETZT.getTime() - 60_000));
    const gueltig = await sitzung(new Date(JETZT.getTime() + 60_000));

    await raeumeAuf(tx, JETZT);

    const sitzungen = await tx
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.userId, person.id));
    expect(sitzungen).toEqual([{ id: gueltig }]);
    const tokens = await tx
      .select({ sessionId: schema.pushToken.sessionId })
      .from(schema.pushToken)
      .where(eq(schema.pushToken.userId, person.id));
    expect(tokens).toEqual([{ sessionId: gueltig }]);
    expect(sitzungen.map((s) => s.id)).not.toContain(abgelaufen);
  });
});

test("Nachrichten gehen nach 12 Monaten, die Meldung darüber bleibt ohne Verweis", async () => {
  await zurueckgerollt(async (tx) => {
    const welt = await neueWelt(tx);
    const autor = await neuePerson(tx, welt);
    const nachricht = async (seite: "bleibt" | "weg") => {
      const [n] = await tx
        .insert(schema.nachricht)
        .values({
          chatId: welt.chat.id,
          autorId: autor.id,
          text: "Hallo",
          erstelltAm: frist("12 months", seite),
        })
        .returning({ id: schema.nachricht.id });
      return n.id;
    };
    const bleibt = await nachricht("bleibt");
    const weg = await nachricht("weg");
    const [meldung] = await tx
      .insert(schema.meldung)
      .values({ abteilungId: welt.abteilung.id, nachrichtId: weg })
      .returning({ id: schema.meldung.id });

    await raeumeAuf(tx, JETZT);

    expect(await vorhanden(tx, "nachricht", bleibt)).toBe(true);
    expect(await vorhanden(tx, "nachricht", weg)).toBe(false);
    expect(await vorhanden(tx, "meldung", meldung.id)).toBe(true);
    const [verweis] = await tx
      .select({ nachrichtId: schema.meldung.nachrichtId })
      .from(schema.meldung)
      .where(eq(schema.meldung.id, meldung.id));
    expect(verweis.nachrichtId).toBeNull();
  });
});

test("Meldungen gehen nach 12 Monaten, offene wie erledigte", async () => {
  await zurueckgerollt(async (tx) => {
    const welt = await neueWelt(tx);
    const meldung = async (seite: "bleibt" | "weg", erledigt: boolean) => {
      const [m] = await tx
        .insert(schema.meldung)
        .values({
          abteilungId: welt.abteilung.id,
          erstelltAm: frist("12 months", seite),
          erledigtAm: erledigt ? JETZT : null,
        })
        .returning({ id: schema.meldung.id });
      return m.id;
    };
    const bleibtOffen = await meldung("bleibt", false);
    const bleibtErledigt = await meldung("bleibt", true);
    const wegOffen = await meldung("weg", false);
    const wegErledigt = await meldung("weg", true);

    await raeumeAuf(tx, JETZT);

    expect(await vorhanden(tx, "meldung", bleibtOffen)).toBe(true);
    expect(await vorhanden(tx, "meldung", bleibtErledigt)).toBe(true);
    expect(await vorhanden(tx, "meldung", wegOffen)).toBe(false);
    expect(await vorhanden(tx, "meldung", wegErledigt)).toBe(false);
  });
});

test("Textkopien in Meldungen gehen nach 30 Tagen, die Meldung bleibt", async () => {
  await zurueckgerollt(async (tx) => {
    const welt = await neueWelt(tx);
    // Die Funktion rechnet mit now() der Transaktion, nicht mit der Uhr des Tests
    const meldung = async (versatz: string) => {
      const [m] = await tx
        .insert(schema.meldung)
        .values({
          abteilungId: welt.abteilung.id,
          textKopie: "Kopie",
          erstelltAm: sql`now() - interval '30 days' ${sql.raw(versatz)} interval '1 minute'`,
        })
        .returning({ id: schema.meldung.id });
      return m.id;
    };
    const bleibt = await meldung("+");
    const weg = await meldung("-");

    expect(await raeumeTextkopienAuf(tx)).toBeGreaterThanOrEqual(1);

    const kopie = async (id: string) =>
      (
        await tx
          .select({ textKopie: schema.meldung.textKopie })
          .from(schema.meldung)
          .where(eq(schema.meldung.id, id))
      )[0];
    expect(await kopie(bleibt)).toEqual({ textKopie: "Kopie" });
    expect(await kopie(weg)).toEqual({ textKopie: null });
  });
});

test("Teilnahmen gehen 12 Monate nach der letzten Änderung", async () => {
  await zurueckgerollt(async (tx) => {
    const welt = await neueWelt(tx);
    const kindBleibt = await neuesKind(tx, welt, null);
    const kindWeg = await neuesKind(tx, welt, null);
    const teilnahme = (kindId: string, seite: "bleibt" | "weg") =>
      tx.insert(schema.teilnahme).values({
        programmId: welt.programm.id,
        kindId,
        status: "ja",
        geaendertAm: frist("12 months", seite),
      });
    await teilnahme(kindBleibt.id, "bleibt");
    await teilnahme(kindWeg.id, "weg");

    await raeumeAuf(tx, JETZT);

    const kinder = await tx
      .select({ kindId: schema.teilnahme.kindId })
      .from(schema.teilnahme)
      .where(eq(schema.teilnahme.programmId, welt.programm.id));
    expect(kinder).toEqual([{ kindId: kindBleibt.id }]);
  });
});

test("inaktive Kinder gehen samt Teilnahmen 6 Monate nach der Inaktivierung, aktive nie", async () => {
  await zurueckgerollt(async (tx) => {
    const welt = await neueWelt(tx);
    const eltern = await neuePerson(tx, welt);
    const bleibt = await neuesKind(tx, welt, frist("6 months", "bleibt"), [
      eltern.id,
    ]);
    const weg = await neuesKind(tx, welt, frist("6 months", "weg"), [
      eltern.id,
    ]);
    const aktiv = await neuesKind(tx, welt, null, [eltern.id]);
    for (const k of [bleibt, weg, aktiv]) {
      await tx.insert(schema.teilnahme).values({
        programmId: welt.programm.id,
        kindId: k.id,
        status: "nein",
      });
    }

    await raeumeAuf(tx, JETZT);

    const rest = async (
      tabelle: typeof schema.kind | typeof schema.teilnahme,
    ) =>
      (
        await tx
          .select()
          .from(tabelle)
          .where(
            inArray(
              tabelle === schema.kind
                ? schema.kind.id
                : schema.teilnahme.kindId,
              [bleibt.id, weg.id, aktiv.id],
            ),
          )
      ).length;
    expect(await rest(schema.kind)).toBe(2);
    expect(await rest(schema.teilnahme)).toBe(2);
    const verknuepft = await tx
      .select({ kindId: schema.kindEltern.kindId })
      .from(schema.kindEltern)
      .where(eq(schema.kindEltern.userId, eltern.id));
    expect(verknuepft.map((v) => v.kindId).sort()).toEqual(
      [bleibt.id, aktiv.id].sort(),
    );
  });
});

test("Eltern ohne aktives Kind und ohne Rolle werden deaktiviert, mit Sitzungen und Protokoll", async () => {
  await zurueckgerollt(async (tx) => {
    const welt = await neueWelt(tx);
    const inaktiv = await neuesKind(tx, welt, frist("1 day", "bleibt"));
    const aktiv = await neuesKind(tx, welt, null);

    const ohneAktives = await neuePerson(tx, welt);
    await tx
      .insert(schema.kindEltern)
      .values({ kindId: inaktiv.id, userId: ohneAktives.id });
    const [sitzung] = await tx
      .insert(schema.session)
      .values({
        userId: ohneAktives.id,
        token: randomUUID(),
        expiresAt: new Date(JETZT.getTime() + 86_400_000),
        updatedAt: JETZT,
      })
      .returning({ id: schema.session.id });
    await tx.insert(schema.pushToken).values({
      sessionId: sitzung.id,
      userId: ohneAktives.id,
      token: randomUUID(),
      plattform: "ios",
    });

    const gemischt = await neuePerson(tx, welt);
    await tx.insert(schema.kindEltern).values([
      { kindId: inaktiv.id, userId: gemischt.id },
      { kindId: aktiv.id, userId: gemischt.id },
    ]);
    const mitRolle = await neuePerson(tx, welt);
    await tx
      .insert(schema.kindEltern)
      .values({ kindId: inaktiv.id, userId: mitRolle.id });
    await tx.insert(schema.rolle).values({
      userId: mitRolle.id,
      stufeId: welt.stufe.id,
      typ: "leitung",
    });
    const admin = await neuePerson(tx, welt, { role: "admin" });
    await tx
      .insert(schema.kindEltern)
      .values({ kindId: inaktiv.id, userId: admin.id });
    // Frisch angelegt und noch keinem Kind zugeordnet
    const ohneKind = await neuePerson(tx, welt);
    const frueher = new Date("2026-12-01T00:00:00Z");
    const schonDeaktiviert = await neuePerson(tx, welt, {
      deaktiviertAm: frueher,
    });
    await tx
      .insert(schema.kindEltern)
      .values({ kindId: inaktiv.id, userId: schonDeaktiviert.id });

    await raeumeAuf(tx, JETZT);

    const zeile = async (id: string) =>
      (
        await tx
          .select({
            deaktiviertAm: schema.user.deaktiviertAm,
            banned: schema.user.banned,
          })
          .from(schema.user)
          .where(eq(schema.user.id, id))
      )[0];
    expect(await zeile(ohneAktives.id)).toEqual({
      deaktiviertAm: JETZT,
      banned: true,
    });
    for (const bleibt of [gemischt, mitRolle, admin, ohneKind]) {
      expect((await zeile(bleibt.id)).deaktiviertAm).toBeNull();
    }
    expect((await zeile(schonDeaktiviert.id)).deaktiviertAm).toEqual(frueher);

    expect(
      await tx
        .select({ id: schema.session.id })
        .from(schema.session)
        .where(eq(schema.session.userId, ohneAktives.id)),
    ).toEqual([]);
    expect(
      await tx
        .select({ id: schema.pushToken.sessionId })
        .from(schema.pushToken)
        .where(eq(schema.pushToken.userId, ohneAktives.id)),
    ).toEqual([]);

    const protokoll = await tx
      .select({
        akteurId: schema.auditLog.akteurId,
        aktion: schema.auditLog.aktion,
        details: schema.auditLog.details,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, ohneAktives.id));
    expect(protokoll).toEqual([
      {
        akteurId: "job",
        aktion: "person_deaktiviert",
        details: { grund: "kein_aktives_kind" },
      },
    ]);
  });
});

test("deaktivierte Konten gehen 6 Monate nach der Deaktivierung samt ihren Daten", async () => {
  await zurueckgerollt(async (tx) => {
    const welt = await neueWelt(tx);
    const bleibt = await neuePerson(tx, welt, {
      deaktiviertAm: frist("6 months", "bleibt"),
    });
    const weg = await neuePerson(tx, welt, {
      deaktiviertAm: frist("6 months", "weg"),
    });
    const aktiv = await neuePerson(tx, welt);
    await tx.insert(schema.nachricht).values({
      chatId: welt.chat.id,
      autorId: weg.id,
      text: "Hallo",
    });
    await tx.insert(schema.verification).values({
      identifier: "zweiter-faktor",
      value: weg.id,
      expiresAt: JETZT,
    });

    await raeumeAuf(tx, JETZT);

    const personen = await tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(inArray(schema.user.id, [bleibt.id, weg.id, aktiv.id]));
    expect(personen.map((p) => p.id).sort()).toEqual(
      [bleibt.id, aktiv.id].sort(),
    );
    expect(
      await tx
        .select({ id: schema.nachricht.id })
        .from(schema.nachricht)
        .where(eq(schema.nachricht.autorId, weg.id)),
    ).toEqual([]);
    expect(
      await tx
        .select({ id: schema.verification.id })
        .from(schema.verification)
        .where(eq(schema.verification.value, weg.id)),
    ).toEqual([]);
    expect(
      await tx
        .select({
          akteurId: schema.auditLog.akteurId,
          aktion: schema.auditLog.aktion,
        })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.zielId, weg.id)),
    ).toEqual([{ akteurId: "job", aktion: "person_geloescht" }]);
  });
});

test("das Audit-Log verliert nach 24 Monaten Einträge, über die Funktion des Tabellenbesitzers", async () => {
  await zurueckgerollt(async (tx) => {
    const welt = await neueWelt(tx);
    // Die Funktion rechnet mit now() der Transaktion
    const eintrag = (aktion: string, versatz: string) =>
      tx.insert(schema.auditLog).values({
        abteilungId: welt.abteilung.id,
        akteurId: "cli",
        aktion,
        zielTyp: "abteilung",
        zielId: welt.abteilung.id,
        erstelltAm: sql`now() - interval '24 months' ${sql.raw(versatz)} interval '1 minute'`,
      });
    await eintrag("bleibt", "+");
    await eintrag("weg", "-");

    const ergebnis = await raeumeAuf(tx, JETZT);

    expect(ergebnis.audit_log).toBeGreaterThanOrEqual(1);
    expect(
      await tx
        .select({ aktion: schema.auditLog.aktion })
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.abteilungId, welt.abteilung.id),
            eq(schema.auditLog.akteurId, "cli"),
          ),
        ),
    ).toEqual([{ aktion: "bleibt" }]);
  });
});

test("ein Fehler in einem Teil stoppt die anderen nicht und steht ohne Personendaten im Log", async () => {
  await zurueckgerollt(async (tx) => {
    const welt = await neueWelt(tx);
    const autor = await neuePerson(tx, welt);
    const [alteMeldung] = await tx
      .insert(schema.meldung)
      .values({
        abteilungId: welt.abteilung.id,
        erstelltAm: frist("12 months", "weg"),
      })
      .returning({ id: schema.meldung.id });
    const [alteNachricht] = await tx
      .insert(schema.nachricht)
      .values({
        chatId: welt.chat.id,
        autorId: autor.id,
        text: "Geheimer Text",
        erstelltAm: frist("12 months", "weg"),
      })
      .returning({ id: schema.nachricht.id });

    // Das Löschen der Nachrichten scheitert; Postgres sieht davon nichts
    const kaputt = new Proxy(tx, {
      get(ziel, name) {
        const wert = Reflect.get(ziel, name, ziel);
        if (name !== "delete") return wert;
        return (tabelle: unknown) => {
          if (tabelle === schema.nachricht) {
            throw Object.assign(new Error("Geheimer Text"), { code: "XX000" });
          }
          return (wert as Tx["delete"]).call(ziel, tabelle as never);
        };
      },
    });
    const ergebnis = await raeumeAuf(kaputt, JETZT);

    expect(ergebnis.nachrichten).toBeNull();
    expect(ergebnis.meldungen).toBeGreaterThanOrEqual(1);
    expect(await vorhanden(tx, "nachricht", alteNachricht.id)).toBe(true);
    expect(await vorhanden(tx, "meldung", alteMeldung.id)).toBe(false);

    const zeilen = ausgabe.mock.calls.map(([zeile]) => String(zeile));
    expect(zeilen.join("\n")).toContain('"teil":"nachrichten"');
    expect(zeilen.join("\n")).toContain('"code":"XX000"');
    expect(zeilen.join("\n")).not.toContain("Geheimer Text");
  });
});

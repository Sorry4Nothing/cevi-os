import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { SUPERUSER_URL } from "./hilfen/datenbank.js";

// 0160 und ihr Rückweg gegen eine eigene Datenbank mit Sitzungen (#721): erst bis 0158, Konten mit und ohne zweiten Faktor samt Sitzungen, dann 0160 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig721_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig721-"));
const bisVorher = join(temp, "vorher");
const komplett = join(temp, "komplett");

const superuser = postgres(SUPERUSER_URL, { max: 1, onnotice: () => {} });
let besitzer: postgres.Sql;

function ordnerBauen(ziel: string, bis: number) {
  mkdirSync(join(ziel, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(new URL("meta/_journal.json", drizzleOrdner), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  const eintraege = journal.entries.filter((e) => e.idx <= bis);
  writeFileSync(
    join(ziel, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: eintraege }),
  );
  for (const e of eintraege) {
    cpSync(new URL(`${e.tag}.sql`, drizzleOrdner), join(ziel, `${e.tag}.sql`));
  }
}

beforeAll(async () => {
  await superuser.unsafe(`create database ${dbName} owner cevi_os_besitzer`);
  besitzer = postgres(url("cevi_os_besitzer"), { max: 1, onnotice: () => {} });
  ordnerBauen(bisVorher, 158);
  ordnerBauen(komplett, 160);
}, 60_000);

afterAll(async () => {
  await besitzer?.end();
  await superuser.unsafe(`drop database if exists ${dbName} with (force)`);
  await superuser.end();
  rmSync(temp, { recursive: true, force: true });
});

const anzahlMigrationen = async () =>
  (
    await besitzer`select count(*)::int as n from drizzle.__drizzle_migrations`
  )[0].n as number;
const spalte = async () =>
  (
    await besitzer`select count(*)::int as n from information_schema.columns where table_name = 'session' and column_name = 'zweiter_faktor_geprueft'`
  )[0].n as number;

test("0160: Sitzungen von Konten mit zweitem Faktor gelten als geprüft, alle anderen nicht; der Rückweg beendet ungeprüfte Sitzungen solcher Konten und nimmt die Spalte", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  expect(await spalte()).toBe(0);
  const [{ id: abteilung }] = await besitzer`
    insert into abteilung (name) values ('Eins') returning id`;
  const konto = async (name: string, faktor: boolean | null) =>
    (
      await besitzer`
        insert into "user" (name, email, email_verified, abteilung_id, two_factor_enabled, created_at, updated_at)
        values (${name}, ${`${randomUUID()}@benutzer.invalid`}, false, ${abteilung}, ${faktor}, now(), now())
        returning id`
    )[0].id as string;
  const mit = await konto("Mit", true);
  const ohne = await konto("Ohne", false);
  const unbekannt = await konto("Leer", null);
  const sitzung = (userId: string) =>
    besitzer`insert into session (token, expires_at, updated_at, user_id) values (${randomUUID()}, now() + interval '1 day', now(), ${userId})`;
  await sitzung(mit);
  await sitzung(mit);
  await sitzung(ohne);
  await sitzung(unbekannt);

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  const stand = async () =>
    Object.fromEntries(
      (
        await besitzer`select user_id, bool_and(zweiter_faktor_geprueft) as g, count(*)::int as n from session group by user_id`
      ).map((z) => [z.user_id, [z.g, z.n]]),
    );
  expect(await stand()).toEqual({
    [mit]: [true, 2],
    [ohne]: [false, 1],
    [unbekannt]: [false, 1],
  });

  // Neue Sitzungen beginnen nicht geprüft; die Spalte lässt keinen NULL zu
  await sitzung(mit);
  expect((await stand())[mit]).toEqual([false, 3]);
  await expect(
    besitzer`update session set zweiter_faktor_geprueft = null where user_id = ${ohne}`,
  ).rejects.toThrow(/null/);

  // Rückweg: Die ungeprüfte Sitzung des Kontos mit Faktor endet, alle anderen bleiben; Spalte und Journal-Zeile sind weg
  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../drizzle/rueckweg/0160_sitzung_zweiter_faktor.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await spalte()).toBe(0);
  expect(await anzahlMigrationen()).toBe(vorher);
  const rest =
    await besitzer`select user_id, count(*)::int as n from session group by user_id`;
  expect(Object.fromEntries(rest.map((z) => [z.user_id, z.n]))).toEqual({
    [mit]: 2,
    [ohne]: 1,
    [unbekannt]: 1,
  });
}, 120_000);

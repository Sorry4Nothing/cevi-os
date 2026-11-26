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

// 0170 und ihr Rückweg gegen eine eigene Datenbank mit Konten (#849): erst bis 0169, Konten mit w, m, d und ohne Angabe, dann 0170 durch den echten Migrator, dann der Rückweg
const dbName = `cevi_os_mig849_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const url = (benutzer: string) =>
  `postgres://${benutzer}@localhost:5432/${dbName}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig849-"));
const bisVorher = join(temp, "vorher");
const komplett = join(temp, "komplett");

const superuser = postgres(SUPERUSER_URL, { max: 1, onnotice: () => {} });
let besitzer: postgres.Sql;

const journal = JSON.parse(
  readFileSync(new URL("meta/_journal.json", drizzleOrdner), "utf8"),
) as { entries: { idx: number; tag: string }[] };

function ordnerBauen(ziel: string, bis: number) {
  mkdirSync(join(ziel, "meta"), { recursive: true });
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
  ordnerBauen(bisVorher, 169);
  ordnerBauen(komplett, 170);
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

test("0170: d wird zu null, w und m bleiben, die Markierung «von Hand» bleibt; danach lässt die Datenbank nur w, m oder null zu; der Rückweg lässt d wieder zu", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  const vorher = await anzahlMigrationen();
  const [{ id: abteilung }] = await besitzer`
    insert into abteilung (name) values ('Eins') returning id`;
  const konto = async (geschlecht: string | null) =>
    (
      await besitzer`
        insert into "user" (name, email, email_verified, abteilung_id, created_at, updated_at, geschlecht, geschlecht_von_hand)
        values ('Test', ${`${randomUUID()}@benutzer.invalid`}, false, ${abteilung}, now(), now(), ${geschlecht}, ${geschlecht !== null})
        returning id`
    )[0].id as string;
  const w = await konto("w");
  const m = await konto("m");
  const d = await konto("d");
  const ohne = await konto(null);

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await anzahlMigrationen()).toBe(vorher + 1);
  const zeile = async (id: string) =>
    (
      await besitzer`select geschlecht as g, geschlecht_von_hand as v from "user" where id = ${id}`
    )[0];
  expect(await zeile(w)).toEqual({ g: "w", v: true });
  expect(await zeile(m)).toEqual({ g: "m", v: true });
  expect(await zeile(d)).toEqual({ g: null, v: true });
  expect(await zeile(ohne)).toEqual({ g: null, v: false });
  for (const wert of ["d", "x"]) {
    await expect(
      besitzer`update "user" set geschlecht = ${wert} where id = ${w}`,
    ).rejects.toThrow(/user_geschlecht_check/);
  }

  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../drizzle/rueckweg/0170_user_geschlecht_ohne_d.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await anzahlMigrationen()).toBe(vorher);
  await besitzer`update "user" set geschlecht = 'd' where id = ${w}`;
  await expect(
    besitzer`update "user" set geschlecht = 'x' where id = ${w}`,
  ).rejects.toThrow(/user_geschlecht_check/);
  // Was 0170 auf null gesetzt hat, bleibt null
  expect((await zeile(d)).g).toBeNull();
}, 120_000);

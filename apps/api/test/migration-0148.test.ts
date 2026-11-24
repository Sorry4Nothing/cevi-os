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

// 0148 und ihr Rückweg gegen eine eigene Datenbank mit Altzeilen: erst bis 0147 migrieren, das Protokoll mit Zugriffen, Fehlschlägen und Klicks füllen, dann 0148 durch den echten Migrator, dann der Rückweg (#662)
const dbName = `cevi_os_mig662_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const drizzleOrdner = new URL("../drizzle/", import.meta.url);
const temp = mkdtempSync(join(tmpdir(), "mig662-"));
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
  besitzer = postgres(`postgres://cevi_os_besitzer@localhost:5432/${dbName}`, {
    max: 1,
    onnotice: () => {},
  });
  ordnerBauen(bisVorher, 147);
  ordnerBauen(komplett, 148);
});

afterAll(async () => {
  await besitzer?.end();
  await superuser.unsafe(`drop database if exists ${dbName} with (force)`);
  await superuser.end();
  rmSync(temp, { recursive: true, force: true });
});

const spalten = async () =>
  (
    await besitzer`select column_name from information_schema.columns where table_name = 'aktivitaet' and column_name in ('gruppe', 'objekt_name', 'beschreibung', 'aenderung') order by 1`
  ).map((r) => r.column_name as string);
const zeilen = async () =>
  (await besitzer`select art, aktion from aktivitaet`)
    .map((r) => `${r.art} | ${r.aktion}`)
    .sort();

test("0148: Altzeilen werden bereinigt (Zugriffe, Fehlschläge, Klicks), Sicherheit und Audit bleiben; der Trigger spiegelt nur noch Kommandozeile und System; der Rückweg stellt den Stand her", async () => {
  await migrate(drizzle(besitzer), { migrationsFolder: bisVorher });
  expect(await spalten()).toEqual([]);
  const abteilung = (
    await besitzer`insert into abteilung (name) values ('Eins') returning id`
  )[0].id as string;
  const zeile = (
    art: string,
    aktion: string,
    ergebnis: string,
    status: number | null,
  ) =>
    besitzer`insert into aktivitaet (art, aktion, bereich, ergebnis, status, akteur) values (${art}, ${aktion}, 'test', ${ergebnis}, ${status}, 'person')`;
  // Bleibt: eine echte Änderung, eine Audit-Zeile, Systemzeilen mit Wirkung und die Lücke
  await zeile("aktion", "PATCH /api/v1/admin/tags/:id", "erfolg", 204);
  await zeile("audit", "rolle_geaendert", "erfolg", null);
  await zeile("system", "start", "erfolg", null);
  await zeile("system", "push_versand:programm", "erfolg", null);
  await zeile("system", "lager_fristen", "erfolg", null);
  await zeile("system", "protokoll_luecke", "fehler", null);
  // Wird Sicherheit: fehlgeschlagene Anmeldung, falscher zweiter Faktor, Begrenzung
  await zeile("anmeldung", "POST /api/auth/sign-in/username", "fehler", 401);
  await zeile(
    "anmeldung",
    "POST /api/auth/two-factor/verify-totp",
    "fehler",
    401,
  );
  await zeile("aktion", "PATCH /api/v1/admin/tags/:id", "fehler", 429);
  // Fällt weg: Zugriffe, Anmelde-Erfolg, andere Fehler beim Anmelden, abgelehnte Anfragen, Alltag, Vorschau, Aufräumläufe, Fehler und Chat
  await zeile("zugriff", "GET /api/v1/admin/kinder", "erfolg", 200);
  await zeile("anmeldung", "POST /api/auth/sign-in/username", "erfolg", 200);
  await zeile("anmeldung", "POST /api/auth/change-password", "fehler", 400);
  await zeile("aktion", "PATCH /api/v1/admin/tags/:id", "fehler", 404);
  await zeile("aktion", "POST /api/v1/admin/tags", "fehler", 403);
  await zeile(
    "aktion",
    "PUT /api/v1/lager/:id/reaktionen/:a/:b",
    "erfolg",
    204,
  );
  await zeile(
    "aktion",
    "POST /api/v1/admin/mitteilungen/vorschau",
    "erfolg",
    200,
  );
  await zeile("system", "sitzungen", "erfolg", null);
  await zeile("system", "kalender", "fehler", null);
  await zeile("system", "push_versand:chat", "erfolg", null);
  await besitzer`insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id) values (${abteilung}, ${randomUUID()}, 'alt', 'person', ${randomUUID()})`;
  const vorher = (await besitzer`select count(*)::int as n from aktivitaet`)[0]
    .n as number;
  expect(vorher).toBeGreaterThanOrEqual(20);

  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await spalten()).toEqual([
    "aenderung",
    "beschreibung",
    "gruppe",
    "objekt_name",
  ]);
  expect(await zeilen()).toEqual(
    [
      "aktion | PATCH /api/v1/admin/tags/:id",
      // die Begrenzung (429) ist jetzt Sicherheit
      // Audit-Zeilen bleiben, auch die gespiegelte des Audit-Logs
      "audit | alt",
      "audit | rolle_geaendert",
      "sicherheit | (begrenzt)",
      "sicherheit | POST /api/auth/sign-in/username",
      "sicherheit | POST /api/auth/two-factor/verify-totp",
      "system | lager_fristen",
      "system | protokoll_luecke",
      "system | push_versand:programm",
      "system | start",
    ].sort(),
  );

  // Neue Arten gelten, alte nicht mehr
  await expect(
    besitzer`insert into aktivitaet (art, aktion, bereich, ergebnis) values ('zugriff', 'x', 'x', 'erfolg')`,
  ).rejects.toThrow();
  await besitzer`insert into aktivitaet (art, aktion, bereich, ergebnis, gruppe, objekt_name, beschreibung, aenderung) values ('aktion', 'neu', 'x', 'erfolg', 'geaendert', 'Name', 'Satz', ${JSON.stringify({ hinzu: ["a"] })}::jsonb)`;
  await expect(
    besitzer`insert into aktivitaet (art, aktion, bereich, ergebnis, aenderung) values ('aktion', 'neu', 'x', 'erfolg', '[1]'::jsonb)`,
  ).rejects.toThrow();

  // Das Audit-Log spiegelt Personen nicht mehr (ihre Anfrage steht schon da), die Kommandozeile schon
  await besitzer`insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id) values (${abteilung}, ${randomUUID()}, 'person_neu', 'person', ${randomUUID()})`;
  await besitzer`insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id) values (${abteilung}, 'cli', 'cli_neu', 'person', ${randomUUID()})`;
  expect(
    (
      await besitzer`select aktion from aktivitaet where aktion in ('person_neu', 'cli_neu')`
    ).map((r) => r.aktion),
  ).toEqual(["cli_neu"]);

  await besitzer.unsafe(
    readFileSync(
      new URL(
        "../drizzle/rueckweg/0148_aenderungsprotokoll.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(await spalten()).toEqual([]);
  // Der alte Trigger spiegelt Personen wieder
  const person = randomUUID();
  await besitzer`insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id) values (${abteilung}, ${person}, 'person_zurueck', 'person', ${randomUUID()})`;
  expect(
    (await besitzer`select art from aktivitaet where aktion = 'person_zurueck'`)
      .length,
  ).toBe(1);
  await expect(
    besitzer`insert into aktivitaet (art, aktion, bereich, ergebnis) values ('sicherheit', 'x', 'x', 'erfolg')`,
  ).rejects.toThrow();

  // Erneut vorwärts: Der Rückweg hinterlässt einen Stand, auf dem 0148 wieder läuft
  await migrate(drizzle(besitzer), { migrationsFolder: komplett });
  expect(await spalten()).toEqual([
    "aenderung",
    "beschreibung",
    "gruppe",
    "objekt_name",
  ]);
}, 120_000);

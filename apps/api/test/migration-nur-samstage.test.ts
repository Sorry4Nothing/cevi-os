import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, expect, test } from "vitest";
import { API_URL } from "./hilfen/datenbank.js";
import { zurueckgerollt } from "./transaktion.js";

const sql = postgres(API_URL);
afterAll(() => sql.end());

const migration = readFileSync(
  new URL("../drizzle/0031_programme_nur_samstage.sql", import.meta.url),
  "utf8",
);

test("0031 löscht Programme ohne Samstag (Schweizer Zeit) und lässt alle anderen stehen", async () => {
  await zurueckgerollt(sql, async (tx) => {
    const [{ id }] =
      await tx`insert into abteilung (name) values ('Testabteilung') returning id`;
    const zeit = (ev: string, von: string, bis: string) => tx`
      insert into programm (abteilung_id, google_event_id, titel, ganztaegig, beginn, ende)
      values (${id}, ${ev}, ${ev}, false, ${von}, ${bis})`;
    const tage = (ev: string, von: string, bis: string) => tx`
      insert into programm (abteilung_id, google_event_id, titel, ganztaegig, tag_von, tag_bis)
      values (${id}, ${ev}, ${ev}, true, ${von}, ${bis})`;
    // 2027-09-04 ist ein Samstag
    await zeit("freitag", "2027-09-03T10:00:00Z", "2027-09-03T12:00:00Z");
    await zeit("samstag", "2027-09-04T10:00:00Z", "2027-09-04T12:00:00Z");
    // 22:30 UTC am Freitag ist im Sommer schon Samstag 00:30 in Zürich
    await zeit("mitternacht", "2027-09-03T22:30:00Z", "2027-09-03T23:30:00Z");
    // Endet genau um Mitternacht Zürich: Der Samstag zählt nicht mit
    await zeit(
      "ende-mitternacht",
      "2027-09-02T22:00:00Z",
      "2027-09-03T22:00:00Z",
    );
    await zeit("sonntag", "2027-09-05T10:00:00Z", "2027-09-05T12:00:00Z");
    await tage("lager", "2027-09-02", "2027-09-05");
    await tage("sonntag-tag", "2027-09-05", "2027-09-05");
    await tage("woche", "2027-09-06", "2027-09-12");
    await tage("werktage", "2027-09-06", "2027-09-10");

    await tx.unsafe(migration);

    const rest =
      await tx`select google_event_id as ev from programm where abteilung_id = ${id} order by 1`;
    expect(rest.map((r) => r.ev)).toEqual([
      "lager",
      "mitternacht",
      "samstag",
      "woche",
    ]);
  });
});

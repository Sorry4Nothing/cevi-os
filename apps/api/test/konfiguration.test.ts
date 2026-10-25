import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { ladeKonfiguration } from "../src/konfiguration.js";

// Erfundene Werte; was eine Variable enthält, darf nie in der Meldung stehen
const GUELTIG = {
  DATABASE_URL: "postgres://cevi:geheim-1@db.example.org:5432/cevi_os",
  APP_MIN_VERSION: "0.1.0",
  PORT: "3000",
};
const UNGUELTIG = {
  DATABASE_URL: ["mysql://cevi:geheim-2@db.example.org/cevi_os", "geheim-3"],
  APP_MIN_VERSION: ["1.2", "1.2.0-beta", "geheim-4"],
  PORT: ["0", "65536", "30.5", "-1.5", "geheim-5"],
};

function meldung(env: Record<string, string | undefined>) {
  try {
    ladeKonfiguration(env);
  } catch (fehler) {
    return (fehler as Error).message;
  }
  throw new Error("ladeKonfiguration hat nicht geworfen");
}

test("liest die drei Werte und übergeht andere Variablen", () => {
  expect(ladeKonfiguration({ ...GUELTIG, HOME: "/home/cevi" })).toEqual({
    DATABASE_URL: GUELTIG.DATABASE_URL,
    APP_MIN_VERSION: "0.1.0",
    PORT: 3000,
  });
});

describe.each(Object.keys(UNGUELTIG) as (keyof typeof UNGUELTIG)[])(
  "%s",
  (name) => {
    test.each<[string, string | undefined]>([
      ["fehlt", undefined],
      ["ist leer", ""],
      ...UNGUELTIG[name].map((wert): [string, string] => [
        `ist «${wert}»`,
        wert,
      ]),
    ])("%s: Die Meldung nennt nur den Namen", (_, wert) => {
      expect(meldung({ ...GUELTIG, [name]: wert })).toBe(
        `Fehlende oder ungültige Umgebungsvariablen: ${name}`,
      );
    });
  },
);

test("ohne Konfiguration nennt die Meldung alle drei Namen", () => {
  expect(meldung({})).toBe(
    "Fehlende oder ungültige Umgebungsvariablen: DATABASE_URL, APP_MIN_VERSION, PORT",
  );
});

test("der Server startet ohne Konfiguration nicht", () => {
  const ergebnis = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/server.ts"],
    {
      cwd: new URL("..", import.meta.url),
      // Die CI setzt DATABASE_URL; Schlüssel mit undefined lässt Node weg
      env: {
        ...process.env,
        DATABASE_URL: undefined,
        APP_MIN_VERSION: undefined,
        PORT: undefined,
      },
      encoding: "utf8",
      // Auf einem ausgelasteten Rechner dauert der Start mit tsx ein Vielfaches, gemessen bis 15 s
      timeout: 60_000,
    },
  );
  expect(ergebnis.status).toBe(1);
  expect(ergebnis.stderr).toContain(
    "Fehlende oder ungültige Umgebungsvariablen: DATABASE_URL, APP_MIN_VERSION, PORT",
  );
}, 70_000);

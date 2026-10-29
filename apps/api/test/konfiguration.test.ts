import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { ladeKonfiguration } from "../src/konfiguration.js";

// Erfundene Werte; was eine Variable enthält, darf nie in der Meldung stehen
const GUELTIG = {
  DATABASE_URL: "postgres://cevi:geheim-1@db.example.org:5432/cevi_os",
  APP_MIN_VERSION: "0.1.0",
  PORT: "3000",
  BETTER_AUTH_SECRET: "geheim-6-0123456789abcdef0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3000",
  EXPO_ACCESS_TOKEN: "geheim-9",
};
const UNGUELTIG = {
  DATABASE_URL: ["mysql://cevi:geheim-2@db.example.org/cevi_os", "geheim-3"],
  APP_MIN_VERSION: ["1.2", "1.2.0-beta", "geheim-4"],
  PORT: ["0", "65536", "30.5", "-1.5", "geheim-5"],
  // Unter 32 Zeichen
  BETTER_AUTH_SECRET: ["geheim-7"],
  BETTER_AUTH_URL: ["ftp://api.example.org", "geheim-8"],
  // Jeder nicht leere Text gilt; nur «fehlt» und «ist leer» laufen
  EXPO_ACCESS_TOKEN: [],
};

function meldung(env: Record<string, string | undefined>) {
  try {
    ladeKonfiguration(env);
  } catch (fehler) {
    return (fehler as Error).message;
  }
  throw new Error("ladeKonfiguration hat nicht geworfen");
}

test("liest die sechs Werte und übergeht andere Variablen", () => {
  expect(ladeKonfiguration({ ...GUELTIG, HOME: "/home/cevi" })).toEqual({
    DATABASE_URL: GUELTIG.DATABASE_URL,
    APP_MIN_VERSION: "0.1.0",
    PORT: 3000,
    BETTER_AUTH_SECRET: GUELTIG.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: "http://localhost:3000",
    EXPO_ACCESS_TOKEN: "geheim-9",
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

test("GOOGLE_APPLICATION_CREDENTIALS ist freiwillig und wird durchgereicht", () => {
  expect(
    ladeKonfiguration(GUELTIG).GOOGLE_APPLICATION_CREDENTIALS,
  ).toBeUndefined();
  expect(
    ladeKonfiguration({
      ...GUELTIG,
      GOOGLE_APPLICATION_CREDENTIALS: "/pfad/zur/schluesseldatei.json",
    }).GOOGLE_APPLICATION_CREDENTIALS,
  ).toBe("/pfad/zur/schluesseldatei.json");
});

test("GOOGLE_APPLICATION_CREDENTIALS ist leer: Die Meldung nennt nur den Namen", () => {
  expect(meldung({ ...GUELTIG, GOOGLE_APPLICATION_CREDENTIALS: "" })).toBe(
    "Fehlende oder ungültige Umgebungsvariablen: GOOGLE_APPLICATION_CREDENTIALS",
  );
});

test("ohne Konfiguration nennt die Meldung alle sechs Namen", () => {
  expect(meldung({})).toBe(
    "Fehlende oder ungültige Umgebungsvariablen: DATABASE_URL, APP_MIN_VERSION, PORT, BETTER_AUTH_SECRET, BETTER_AUTH_URL, EXPO_ACCESS_TOKEN",
  );
});

test("der Server startet ohne Konfiguration nicht", () => {
  const ergebnis = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/server.ts"],
    {
      cwd: new URL("..", import.meta.url),
      // Die Umgebung kann DATABASE_URL setzen; Schlüssel mit undefined lässt Node weg
      env: {
        ...process.env,
        DATABASE_URL: undefined,
        APP_MIN_VERSION: undefined,
        PORT: undefined,
        BETTER_AUTH_SECRET: undefined,
        BETTER_AUTH_URL: undefined,
        EXPO_ACCESS_TOKEN: undefined,
      },
      encoding: "utf8",
      // Auf einem ausgelasteten Rechner dauert der Start mit tsx ein Vielfaches
      timeout: 60_000,
    },
  );
  expect(ergebnis.status).toBe(1);
  expect(ergebnis.stderr).toContain(
    "Fehlende oder ungültige Umgebungsvariablen: DATABASE_URL, APP_MIN_VERSION, PORT, BETTER_AUTH_SECRET, BETTER_AUTH_URL, EXPO_ACCESS_TOKEN",
  );
}, 70_000);

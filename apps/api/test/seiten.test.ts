import { readFileSync } from "node:fs";
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
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

// Jede Anfrage schriebe sonst eine Log-Zeile in die Testausgabe
let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

// Ohne Cookie («ohne Login»); datei === null heisst: Der genaue Inhalt kommt erst mit #24, hier zählt nur gültiges JSON
test.each<[string, string, string | null]>([
  ["/datenschutz", "text/html; charset=UTF-8", "datenschutz.html"],
  ["/konto-loeschen", "text/html; charset=UTF-8", "konto-loeschen.html"],
  ["/support", "text/html; charset=UTF-8", "support.html"],
  ["/.well-known/apple-app-site-association", "application/json", null],
  ["/.well-known/assetlinks.json", "application/json", null],
])(
  "GET %s antwortet ohne Login mit 200 und %s, ohne Weiterleitung",
  async (pfad, typ, datei) => {
    const antwort = await app.request(pfad);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toBe(typ);
    expect(antwort.headers.get("location")).toBeNull();
    const text = await antwort.text();
    if (datei === null) {
      expect(() => JSON.parse(text)).not.toThrow();
    } else {
      // Gleich der Datei aus public/: Jeder Pfad liefert seine eigene Seite
      expect(text).toBe(
        readFileSync(new URL(`../public/${datei}`, import.meta.url), "utf8"),
      );
    }
  },
);

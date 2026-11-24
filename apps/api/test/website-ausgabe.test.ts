import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { dateisystemAusgabe, istAusgabePfad } from "../src/website/ausgabe.js";

let wurzel: string;
beforeEach(async () => {
  wurzel = await mkdtemp(join(tmpdir(), "cevi-ausgabe-"));
});
afterEach(() => rm(wurzel, { recursive: true, force: true }));

describe("Pfade", () => {
  test.each([
    "index.html",
    "a/index.html",
    "stufen/woelfe-1/index.html",
    "website/website.css",
    "404.html",
    "sitemap.xml",
    "-a/b--c/index.html",
  ])("%s ist gültig", (pfad) => {
    expect(istAusgabePfad(pfad)).toBe(true);
  });

  test.each([
    "",
    "/index.html",
    "../index.html",
    "a/../index.html",
    "a/./index.html",
    "./index.html",
    "a//index.html",
    "a/",
    ".tmp-x",
    ".htaccess",
    "a/.hidden",
    "a\\b/index.html",
    "C:/x.html",
    "a b/index.html",
    "Gross/index.html",
    "ä/index.html",
    "a/index.html\0",
    "a..b/index.html",
    "%2e%2e/index.html",
    "a/b/c/d/e/f/g/h/index.html",
    "x".repeat(401),
  ])("%j wird abgelehnt", (pfad) => {
    expect(istAusgabePfad(pfad)).toBe(false);
  });
});

describe("Dateisystem", () => {
  test("schreibt, ersetzt, liest und listet", async () => {
    const a = dateisystemAusgabe(wurzel);
    await a.schreibe("stufen/biber/index.html", "eins");
    await a.schreibe("stufen/biber/index.html", "zwei");
    await a.schreibe("sitemap.xml", "x");
    expect(
      await readFile(join(wurzel, "stufen/biber/index.html"), "utf8"),
    ).toBe("zwei");
    expect(await a.liste()).toEqual(["sitemap.xml", "stufen/biber/index.html"]);
  });

  test("lässt nach dem Schreiben keine vorläufige Datei liegen", async () => {
    const a = dateisystemAusgabe(wurzel);
    await a.schreibe("a/index.html", "x");
    expect(await readdir(join(wurzel, "a"))).toEqual(["index.html"]);
  });

  test("ein Fehler beim Schreiben hinterlässt weder halbe noch vorläufige Datei", async () => {
    const a = dateisystemAusgabe(wurzel);
    await a.schreibe("a/index.html", "alt");
    // Das Ziel ist ein Verzeichnis: rename scheitert
    await mkdir(join(wurzel, "b/index.html"), { recursive: true });
    await expect(a.schreibe("b/index.html", "neu")).rejects.toThrow();
    expect(await readdir(join(wurzel, "b"))).toEqual(["index.html"]);
    expect(await readFile(join(wurzel, "a/index.html"), "utf8")).toBe("alt");
  });

  test("löscht und räumt leere Ordner bis zur Wurzel; die Wurzel bleibt", async () => {
    const a = dateisystemAusgabe(wurzel);
    await a.schreibe("a/b/c/index.html", "x");
    await a.schreibe("a/index.html", "y");
    await a.loesche("a/b/c/index.html");
    expect(await a.liste()).toEqual(["a/index.html"]);
    await expect(stat(join(wurzel, "a/b"))).rejects.toThrow();
    await a.loesche("a/index.html");
    expect((await stat(wurzel)).isDirectory()).toBe(true);
    expect(await readdir(wurzel)).toEqual([]);
  });

  test("eine fehlende Datei zu löschen ist kein Fehler", async () => {
    const a = dateisystemAusgabe(wurzel);
    await expect(
      a.loesche("gibt/es/nicht/index.html"),
    ).resolves.toBeUndefined();
  });

  test("eine Wurzel ohne Verzeichnis listet nichts", async () => {
    expect(await dateisystemAusgabe(join(wurzel, "fehlt")).liste()).toEqual([]);
  });

  test.each([
    "../x.html",
    "/etc/passwd",
    "a/../../x.html",
    ".tmp-1",
    "a\\..\\x.html",
  ])("Pfad-Traversal: %j schreibt und löscht nichts", async (pfad) => {
    const a = dateisystemAusgabe(join(wurzel, "ziel"));
    await writeFile(join(wurzel, "x.html"), "bleibt");
    await expect(a.schreibe(pfad, "böse")).rejects.toThrow("ungueltiger Pfad");
    await expect(a.loesche(pfad)).rejects.toThrow("ungueltiger Pfad");
    expect(await readFile(join(wurzel, "x.html"), "utf8")).toBe("bleibt");
    expect(await readdir(wurzel)).toEqual(["x.html"]);
  });

  test("liste nennt keine fremden Namen und folgt keinen Verknüpfungen", async () => {
    const a = dateisystemAusgabe(wurzel);
    await a.schreibe("a/index.html", "x");
    await writeFile(join(wurzel, ".htaccess"), "x");
    await writeFile(join(wurzel, "a/.tmp-abc"), "x");
    await writeFile(join(wurzel, "GROSS.html"), "x");
    await mkdir(join(wurzel, "Fremd"));
    await writeFile(join(wurzel, "Fremd/index.html"), "x");
    const ausserhalb = await mkdtemp(join(tmpdir(), "cevi-ausserhalb-"));
    try {
      await writeFile(join(ausserhalb, "index.html"), "x");
      await symlink(ausserhalb, join(wurzel, "verknuepft"), "junction").catch(
        () => {},
      );
      expect(await a.liste()).toEqual(["a/index.html"]);
    } finally {
      await rm(ausserhalb, { recursive: true, force: true });
    }
  });
});

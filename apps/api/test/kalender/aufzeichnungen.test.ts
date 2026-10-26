import { readdir, readFile } from "node:fs/promises";
import { expect, test } from "vitest";

// Jede Domäne hinter einem @ (auch URL-kodiert als %40) muss example.org sein; sonst ist die Aufzeichnung nicht anonymisiert
const ADRESSE = /@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

test("die Aufzeichnungen enthalten E-Mail-Adressen nur mit @example.org", async () => {
  const ordner = new URL("./aufzeichnungen/", import.meta.url);
  const dateien = await readdir(ordner);
  expect(dateien.length).toBeGreaterThan(0);
  for (const datei of dateien) {
    const text = (await readFile(new URL(datei, ordner), "utf8")).replace(
      /%40/gi,
      "@",
    );
    const fremde = (text.match(ADRESSE) ?? []).filter(
      (treffer) => treffer !== "@example.org",
    );
    expect({ datei, fremde }).toEqual({ datei, fremde: [] });
  }
});

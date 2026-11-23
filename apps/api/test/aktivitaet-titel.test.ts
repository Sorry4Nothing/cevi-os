import { expect, test } from "vitest";
import { ZUGRIFF } from "../src/aktivitaet-middleware.js";
import { AKTIVITAET_TITEL } from "../src/aktivitaet-titel.js";
import { titelVon } from "../src/routes/admin/protokoll.js";
// @ts-expect-error Skript ohne Typen
import { eintraege } from "../scripts/aktivitaet-titel-erzeugen.mjs";

// Der Katalog der Klartexte ist erzeugt aus docs/api/openapi.yaml (node scripts/aktivitaet-titel-erzeugen.mjs); eine Änderung der OpenAPI-Datei ohne neuen Lauf fällt hier auf
test("aktivitaet-titel.ts passt zu docs/api/openapi.yaml", () => {
  expect(AKTIVITAET_TITEL).toEqual(eintraege());
});

test("jede Zugriffsroute und jede Auth-Aktion hat einen Klartext", () => {
  for (const aktion of ZUGRIFF) {
    expect(titelVon(aktion, "zugriff"), aktion).not.toMatch(/^Lesen:/);
  }
  expect(titelVon("POST /api/auth/sign-in/username", "anmeldung")).toBe(
    "Mit Benutzername und Passwort anmelden",
  );
});

test("ohne Eintrag: Verb aus der Methode, bei Audit-Aktionen der Name mit Leerzeichen", () => {
  expect(titelVon("PATCH /api/v1/gibtsnicht/:id", "aktion")).toBe(
    "Ändern: /api/v1/gibtsnicht/:id",
  );
  expect(titelVon("rolle_geaendert", "audit")).toBe("rolle geaendert");
  expect(titelVon("start", "system")).toBe("start");
});

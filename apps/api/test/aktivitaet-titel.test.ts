import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { expect, test } from "vitest";
import {
  GRUPPEN_TEXT,
  katalogVon,
  schluesselVon,
} from "../src/aktivitaet-beschreibung.js";
import { AKTIVITAET_KATALOG } from "../src/aktivitaet-titel.js";
import { GRUPPEN, titelVon } from "../src/routes/admin/protokoll.js";
import {
  GRUPPEN as SKRIPT_GRUPPEN,
  eintraege,
  // @ts-expect-error Skript ohne Typen
} from "../scripts/aktivitaet-titel-erzeugen.mjs";

// Der Katalog ist erzeugt aus docs/api/openapi.yaml (node scripts/aktivitaet-titel-erzeugen.mjs); eine Änderung der OpenAPI-Datei ohne neuen Lauf fällt hier auf
test("aktivitaet-titel.ts passt zu docs/api/openapi.yaml", () => {
  expect(AKTIVITAET_KATALOG).toEqual(eintraege());
});

test("jede schreibende Route der OpenAPI hat einen vollständigen Eintrag: Titel, Objekt, Aktion, Gruppe", () => {
  const openapi = parse(
    readFileSync(
      new URL("../../../docs/api/openapi.yaml", import.meta.url),
      "utf8",
    ),
  ) as { paths: Record<string, Record<string, unknown>> };
  let schreibend = 0;
  for (const [pfad, operationen] of Object.entries(openapi.paths)) {
    for (const methode of ["post", "put", "patch", "delete"]) {
      if (!(methode in operationen)) continue;
      schreibend++;
      const schluessel = schluesselVon(`${methode.toUpperCase()} ${pfad}`);
      const e = AKTIVITAET_KATALOG[schluessel];
      expect(e, schluessel).toBeDefined();
      expect(e!.titel, schluessel).toMatch(/\S/);
      expect(e!.objekt, schluessel).toMatch(/\S/);
      expect(e!.aktion, schluessel).toMatch(/^[a-zäöü]/);
      expect(Object.keys(GRUPPEN_TEXT), schluessel).toContain(e!.gruppe);
    }
  }
  expect(schreibend).toBeGreaterThan(250);
});

test("die Gruppen der Aktion sind überall dieselben (Skript, Route, Texte)", () => {
  expect([...GRUPPEN]).toEqual(SKRIPT_GRUPPEN);
  expect(Object.keys(GRUPPEN_TEXT)).toEqual(SKRIPT_GRUPPEN);
});

test("was nicht protokolliert wird, steht mit Grund im Katalog: Vorschau, Anmelden, Alltag", () => {
  const nicht = Object.entries(AKTIVITAET_KATALOG).filter(([, e]) => e.nicht);
  expect(nicht.length).toBeGreaterThan(30);
  const grund = (k: string) => AKTIVITAET_KATALOG[k]?.nicht;
  expect(grund("POST /api/v1/admin/mitteilungen/vorschau")).toBe("pruefung");
  expect(grund("POST /api/auth/sign-in/username")).toBe("sitzung");
  expect(grund("PUT /api/v1/lager/:p/reaktionen/:p/:p")).toBe("alltag");
  // Verwaltung und Rechte werden immer protokolliert
  for (const k of [
    "POST /api/v1/admin/rechte/gruppen/:p/rollen",
    "PATCH /api/v1/admin/rechte/gruppen/:p/rollen/:p",
    "DELETE /api/v1/admin/personen/:p/bild",
    "POST /api/v1/redaktion/seiten/:p/veroeffentlichen",
    "PUT /api/v1/plattform/schalter",
    "POST /api/auth/change-password",
  ]) {
    expect(grund(k), k).toBeUndefined();
  }
});

test("Katalog und Titel: Route, Audit-Name und Systemname", () => {
  expect(katalogVon("PATCH /api/v1/admin/tags/:id")).toMatchObject({
    objekt: "Tag",
    aktion: "umbenannt",
    gruppe: "geaendert",
  });
  expect(titelVon("DELETE /api/v1/admin/anlaesse/:id", "aktion")).toBe(
    "Anlass löschen",
  );
  expect(titelVon("rolle_geaendert", "audit")).toBe("rolle geaendert");
  expect(titelVon("start", "system")).toBe("start");
  expect(titelVon("PATCH /api/v1/gibtsnicht/:id", "aktion")).toBe(
    "PATCH /api/v1/gibtsnicht/:id",
  );
});

// Erzeugt src/aktivitaet-titel.ts aus docs/api/openapi.yaml (#637): zu jeder schreibenden Operation (und den lesenden mit Zugriffszeile) die Zusammenfassung als Klartext für das Aktivitätsprotokoll.
// Aufruf: node scripts/aktivitaet-titel-erzeugen.mjs  (test/aktivitaet-titel.test.ts prüft, dass die Datei dazu passt)
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";

const wurzel = new URL("../../../", import.meta.url);
const openapi = parse(
  readFileSync(new URL("docs/api/openapi.yaml", wurzel), "utf8"),
);
// Alle Parameter heissen im Schlüssel gleich: Hono nennt sie :id, :kontaktId, OpenAPI {id}, {kontaktId}; verglichen wird ohne Namen
const schluessel = (methode, pfad) =>
  `${methode.toUpperCase()} ${pfad.replace(/\{[^}]+\}|:[A-Za-z0-9_]+/g, ":p")}`;
const lesen = new Set(["get"]);
export function eintraege() {
  const eintraege = {};
  for (const [pfad, operationen] of Object.entries(openapi.paths)) {
    for (const [methode, op] of Object.entries(operationen)) {
      if (!["get", "post", "put", "patch", "delete"].includes(methode))
        continue;
      if (typeof op.summary !== "string") continue;
      // Lesende Operationen nur, wenn sie als «Zugriff» erfasst werden (aktivitaet-middleware.ts, ZUGRIFF)
      if (
        lesen.has(methode) &&
        !/kinder|personen|anmeldungen|bestellungen|teilnehmer|adressbuch|notfall|protokoll/.test(
          pfad,
        )
      )
        continue;
      eintraege[schluessel(methode, pfad)] = op.summary
        .replace(/\s+/g, " ")
        .trim();
    }
  }
  return eintraege;
}
export function erzeuge() {
  const zeilen = Object.entries(eintraege())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  return `// Erzeugt von scripts/aktivitaet-titel-erzeugen.mjs aus docs/api/openapi.yaml (#637); nicht von Hand ändern.
// Klartext zu «METHODE /pfad» mit allen Parametern als :p; die Verwaltung zeigt ihn im Protokoll
export const AKTIVITAET_TITEL: Record<string, string> = {
${zeilen.join("\n")}
};
`;
}
if (process.argv[1]?.endsWith("aktivitaet-titel-erzeugen.mjs")) {
  writeFileSync(new URL("apps/api/src/aktivitaet-titel.ts", wurzel), erzeuge());
}

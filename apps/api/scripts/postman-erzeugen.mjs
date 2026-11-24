// Erzeugt docs/api/endpunkte.md und postman/collections/Cevi OS API/ aus apps/api/.postman-lokal/matrix.json (#186), lager-matrix.json und termine-matrix.json (#407)
// Voraussetzung: POSTMAN_EXPORT=1 vitest run test/rechte-matrix.test.ts -t Postman-Export; Ablauf in docs/api/postman.md
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { parse } from "yaml";

const wurzel = new URL("../../../", import.meta.url);
const lies = (pfad) => JSON.parse(readFileSync(new URL(pfad, wurzel), "utf8"));
const matrix = lies("apps/api/.postman-lokal/matrix.json");
const lager = lies("apps/api/.postman-lokal/lager-matrix.json");
const termine = lies("apps/api/.postman-lokal/termine-matrix.json");
const openapi = parse(
  readFileSync(new URL("docs/api/openapi.yaml", wurzel), "utf8"),
);
const alle = matrix.personas;

// Die Rollen im Lager (Spalten von lager-matrix.json); Quelle M = Hauptmatrix, L = Lager, T = Termine
const lagerPersonen = [
  "abteilungsleitung",
  "lagerleitung",
  "leitung",
  "team",
  "lesen",
  "ohneMitgliedschaft",
  "fremdeAbteilung",
  "ohneLogin",
];
const zeilen = [
  ...matrix.zeilen.map((z) => ({ ...z, quelle: "M" })),
  ...lager.zeilen.map((z) => ({ ...z, quelle: "L" })),
  ...termine.zeilen.map((z) => ({ ...z, quelle: "T" })),
];
// Der Event-Stream des Lagers endet nie: Postman würde bis zum Zeitlimit warten
const OHNE_POSTMAN = new Set(["GET /api/v1/lager/:id/ereignisse"]);

const yamlText = (text) => JSON.stringify(text);
const block = (text, einzug) =>
  text
    .split("\n")
    .map((zeile) => (zeile ? " ".repeat(einzug) + zeile : zeile))
    .join("\n");
const dateiname = (schluessel) =>
  schluessel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

function bereich(z) {
  const pfad = z.schluessel.split(" ")[1];
  if (z.quelle === "L") {
    if (pfad.startsWith("/api/v1/admin/")) return "Lager: Verwaltung";
    const teil = /^\/api\/v1\/lager\/:id\/([^/?]+)/.exec(pfad)?.[1];
    return teil ? `Lager: ${teil}` : "Lager";
  }
  if (z.quelle === "T") {
    if (pfad.startsWith("/api/v1/admin/")) return "Termine: Verwaltung";
    if (pfad.startsWith("/ical/")) return "Termine: Kalenderabo";
    return "Termine";
  }
  if (pfad.startsWith("/api/auth/")) return "Anmeldung (better-auth)";
  if (pfad.startsWith("/api/v1/admin/")) return "Verwaltung";
  const teil = /^\/api\/v1\/([^/?]+)/.exec(pfad)?.[1];
  return teil ? `App: ${teil}` : "Seiten und Gesundheit";
}

// Zweck aus openapi.yaml; Pfad-Parameter heissen dort {id}, in der Matrix :id
function zweck(zeile) {
  const pfad = zeile.schluessel.split(" ")[1].replace(/:(\w+)/g, "{$1}");
  const eintrag = openapi.paths[pfad]?.[zeile.methode.toLowerCase()];
  return eintrag?.summary ?? "";
}

function zugriffVon(erwartet, personas) {
  const nachStatus = new Map();
  for (const persona of personas) {
    const status = erwartet[persona];
    nachStatus.set(status, [...(nachStatus.get(status) ?? []), persona]);
  }
  return [...nachStatus]
    .sort(([a], [b]) => a - b)
    .map(([status, personen]) => {
      const namen =
        personen.length === personas.length ? "alle" : personen.join(", ");
      return `**${status}** ${namen}`;
    })
    .join("<br>");
}

function zugriff(zeile) {
  if (zeile.quelle === "L") {
    const aktiv = zugriffVon(zeile.erwartet.aktiv, lagerPersonen);
    const zu = zugriffVon(zeile.erwartet.abgeschlossen, lagerPersonen);
    return zu === aktiv ? aktiv : `${aktiv}<br>Lager abgeschlossen: ${zu}`;
  }
  if (zeile.quelle === "T")
    return zugriffVon(zeile.erwartet, Object.keys(zeile.erwartet));
  return zugriffVon(zeile.erwartet, alle);
}

// docs/api/endpunkte.md
const nachBereich = Map.groupBy(zeilen, bereich);
let md = `# Endpunkte und Zugriff

Erzeugt aus den Rechte-Matrizen (\`apps/api/test/rechte-matrix.test.ts\`, \`apps/api/test/lager/matrix/*.ts\`, \`apps/api/test/termine/matrix/*.ts\`) und \`docs/api/openapi.yaml\`; nicht von Hand ändern. Neu erzeugen: siehe [postman.md](postman.md).

Je Route steht, welche Persona welchen Status bekommt. 2xx heisst erlaubt, 401 nicht angemeldet, 403 angemeldet ohne Recht, 404 das Objekt gehört einer anderen Stufe oder Abteilung und ist unsichtbar. Die Personas beschreibt \`apps/api/test/hilfen/personas.ts\`.

Die Abschnitte «Lager» gelten für ein aktives Lager der Testabteilung. Die Rolle im Lager steht in der Spalte (abteilungsleitung ohne Zeile in \`lager_mitglied\`, lagerleitung, leitung, team, lesen; ohneMitgliedschaft ist ein Konto der Abteilung ohne Rolle, fremdeAbteilung die Lagerleitung einer anderen Abteilung), die Zuordnung zu den Personas steht in \`apps/api/test/lager/matrix.ts\`. Antwortet ein abgeschlossenes Lager anders (Schreiben: 409), steht das in einer zweiten Zeile. Die Abschnitte «Termine» nennen die Personas der Termine (\`apps/api/test/termine/matrix.ts\`).

`;
for (const [name, gruppe] of nachBereich) {
  md += `## ${name}\n\n| Route | Zweck | Status je Persona |\n| --- | --- | --- |\n`;
  for (const z of gruppe)
    md += `| \`${z.schluessel}\` | ${zweck(z)} | ${zugriff(z)} |\n`;
  md += "\n";
}
writeFileSync(new URL("docs/api/endpunkte.md", wurzel), md);

// postman/collections/Cevi OS API/
const sammlung = new URL("postman/collections/Cevi OS API/", wurzel);
rmSync(sammlung, { recursive: true, force: true });
const schreibe = (pfad, inhalt) => {
  const url = new URL(pfad, sammlung);
  mkdirSync(new URL(".", url), { recursive: true });
  writeFileSync(url, inhalt);
};

// Eine Persona ohne Eintrag in «erwartet» hat in dieser Matrix keine Rolle (zum Beispiel ein Konto ohne Lager-Rolle): die Anfrage entfällt
const vorher = `if (JSON.parse(pm.environment.get("erwartet"))[pm.info.requestName] === undefined) pm.execution.skipRequest();`;
const pruefung = `const erwartet = JSON.parse(pm.environment.get("erwartet"))[pm.info.requestName];
if (erwartet !== undefined) {
  pm.test(pm.environment.get("persona") + ": " + pm.info.requestName + " -> " + erwartet, () => {
    pm.response.to.have.status(erwartet);
  });
}`;
schreibe(
  ".resources/definition.yaml",
  `$kind: collection
name: Cevi OS API
description: "Jede Route der Rechte-Matrizen (Hauptmatrix, Lager, Termine). Mit einer Umgebung je Persona laufen lassen; der Test erwartet den Status, den die Matrix für diese Persona festhält. Ablauf: docs/api/postman.md"
variables:
  - key: appVersion
    value: "1.2.0"
scripts:
  - type: http:beforeRequest
    language: text/javascript
    code: |-
${block(vorher, 6)}
  - type: http:afterResponse
    language: text/javascript
    code: |-
${block(pruefung, 6)}
`,
);

// Beide beenden die Sitzung der Persona, also laufen sie nach allen anderen Anfragen; sign-out gibt auch ohne Sitzung 200
const reihenfolge = (z, nr) =>
  z.schluessel === "POST /api/auth/revoke-sessions"
    ? 98000
    : z.schluessel === "POST /api/auth/sign-out"
      ? 99000
      : nr * 1000;
const ordner = new Map();
const json = new Map(); // Ordnername -> [Reihenfolge, Anfrage] für die Datei zum Importieren
let nr = 0;
let ohneAnfrage = 0;
for (const z of zeilen) {
  // Binärer Body oder Medienspeicher nötig, oder ein Event-Stream; die Zeile prüft nur die Matrix im Test
  if (z.bild || z.ohnePostman || OHNE_POSTMAN.has(z.schluessel)) {
    ohneAnfrage++;
    continue;
  }
  const name = z.sitzungEnde ? "Beendet die Sitzung (zuletzt)" : bereich(z);
  if (!ordner.has(name)) {
    ordner.set(name, ordner.size + 1);
    schreibe(
      `${dateiname(name)}/.resources/definition.yaml`,
      `$kind: collection\nname: ${yamlText(name)}\norder: ${z.sitzungEnde ? 900000 : ordner.size * 1000}\n`,
    );
  }
  // Lager und Termine: das Ziel steht je Persona in der Umgebung (pfad_L<n>, pfad_T<n>), weil ein Lauf es verbrauchen kann
  const pfad =
    z.zielJeAnfrage && z.quelle !== "M" ? `{{pfad_${z.quelle}${z.n}}}` : z.pfad;
  // Die API lehnt POST, PUT und PATCH ohne JSON-Body mit 415 ab
  const hatBody = z.body || (z.methode !== "GET" && z.methode !== "DELETE");
  const text = z.body ?? "{}";
  const kopf = [
    ["Cookie", "{{cookie}}"],
    ["expo-origin", "{{expoOrigin}}"],
    ["X-Forwarded-For", "{{ip}}"],
    // Die Ansicht «Alle Termine» ist nur für das Web: Mit dem Header der App antwortet sie 404
    ...(z.schluessel === "GET /api/v1/termine/alle"
      ? []
      : [["X-App-Version", "{{appVersion}}"]]),
    ...(hatBody ? [["Content-Type", "application/json"]] : []),
  ];
  const inhalt = z.bodyJePersona
    ? `{{body_${z.n}}}`
    : JSON.stringify(
        JSON.parse(text.replace(/\{\{(\w+)\}\}/g, "<<$1>>")),
        null,
        2,
      ).replace(/<<(\w+)>>/g, "{{$1}}");
  const koerper = hatBody
    ? `body:\n  type: json\n  content: |-\n${block(inhalt, 4)}\n`
    : "";
  const reihe = reihenfolge(z, nr + 1);
  json.set(name, [
    ...(json.get(name) ?? []),
    [
      reihe,
      {
        name: z.schluessel,
        request: {
          method: z.methode,
          header: kopf.map(([key, value]) => ({ key, value })),
          url: "{{baseUrl}}" + pfad,
          ...(hatBody && {
            body: {
              mode: "raw",
              raw: inhalt,
              options: { raw: { language: "json" } },
            },
          }),
        },
      },
    ],
  ]);
  schreibe(
    `${dateiname(name)}/${dateiname(z.schluessel)}.request.yaml`,
    `$kind: http-request
name: ${yamlText(z.schluessel)}
order: ${reihenfolge(z, ++nr)}
method: ${z.methode}
url: ${yamlText("{{baseUrl}}" + pfad)}
headers:
${kopf.map(([k, v]) => `  - key: ${yamlText(k)}\n    value: ${yamlText(v)}`).join("\n")}
${koerper}`,
  );
}
// Einzelne Datei im Format v2.1 für den Import in die Postman-App; die App liest den Ordner oben nicht
writeFileSync(
  new URL(
    "apps/api/.postman-lokal/Cevi-OS-API.postman_collection.json",
    wurzel,
  ),
  JSON.stringify(
    {
      info: {
        name: "Cevi OS API",
        schema:
          "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      variable: [{ key: "appVersion", value: "1.2.0" }],
      event: [
        {
          listen: "prerequest",
          script: { type: "text/javascript", exec: [vorher] },
        },
        {
          listen: "test",
          script: { type: "text/javascript", exec: pruefung.split("\n") },
        },
      ],
      item: [...json]
        .sort(([a], [b]) =>
          a.startsWith("Beendet") ? 1 : b.startsWith("Beendet") ? -1 : 0,
        )
        .map(([name, anfragen]) => ({
          name,
          item: anfragen
            .sort(([a], [b]) => a - b)
            .map(([, anfrage]) => anfrage),
        })),
    },
    null,
    2,
  ),
);
console.log(
  `${nr} Anfragen, ${ohneAnfrage} Routen ohne Anfrage (Bild-Upload, Medienspeicher, Event-Stream)`,
);

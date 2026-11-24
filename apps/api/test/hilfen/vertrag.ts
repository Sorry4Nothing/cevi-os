import { readFileSync } from "node:fs";
import { parse } from "yaml";

type Knoten = Record<string, unknown>;

const doc = parse(
  readFileSync(
    new URL("../../../../docs/api/openapi.yaml", import.meta.url),
    "utf8",
  ),
) as Knoten;

function loese(ref: string): Knoten {
  let knoten: unknown = doc;
  for (const teil of ref.replace(/^#\//, "").split("/")) {
    knoten = (knoten as Knoten | undefined)?.[teil];
  }
  if (!knoten) throw new Error(`Unbekannter Verweis ${ref}`);
  return knoten as Knoten;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function artVon(wert: unknown): string {
  if (wert === null) return "null";
  if (Array.isArray(wert)) return "array";
  return typeof wert;
}

// Prüft einen Wert gegen ein OpenAPI-3.1-Schema und liefert die Abweichungen als Text. Kennt, was openapi.yaml nutzt: $ref, allOf, oneOf, type (auch als Liste), enum, const, properties, required, additionalProperties: false, items, Grenzen und Muster
export function verletzungen(
  schema: Knoten,
  wert: unknown,
  pfad = "$",
): string[] {
  if (typeof schema.$ref === "string") {
    return verletzungen(loese(schema.$ref), wert, pfad);
  }
  const fehler: string[] = [];
  for (const teil of (schema.allOf as Knoten[] | undefined) ?? []) {
    fehler.push(...verletzungen(teil, wert, pfad));
  }
  if (Array.isArray(schema.oneOf)) {
    const passend = (schema.oneOf as Knoten[]).filter(
      (teil) => verletzungen(teil, wert, pfad).length === 0,
    );
    if (passend.length !== 1) {
      fehler.push(`${pfad}: passt auf ${passend.length} statt 1 von oneOf`);
    }
  }
  const arten = ([] as string[]).concat((schema.type as string[]) ?? []);
  const art = artVon(wert);
  if (
    arten.length > 0 &&
    !arten.some((a) => a === art || (a === "integer" && Number.isInteger(wert)))
  ) {
    return [...fehler, `${pfad}: Typ ${art}, erwartet ${arten.join("|")}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(wert)) {
    fehler.push(`${pfad}: ${JSON.stringify(wert)} nicht in enum`);
  }
  if ("const" in schema && schema.const !== wert) {
    fehler.push(`${pfad}: erwartet ${JSON.stringify(schema.const)}`);
  }
  if (typeof wert === "string") {
    if (schema.format === "uuid" && !UUID.test(wert)) {
      fehler.push(`${pfad}: keine UUID`);
    }
    if (typeof schema.maxLength === "number" && wert.length > schema.maxLength)
      fehler.push(`${pfad}: zu lang`);
    if (typeof schema.minLength === "number" && wert.length < schema.minLength)
      fehler.push(`${pfad}: zu kurz`);
    if (
      typeof schema.pattern === "string" &&
      !RegExp(schema.pattern).test(wert)
    )
      fehler.push(`${pfad}: Muster verletzt`);
  }
  if (typeof wert === "number") {
    if (typeof schema.minimum === "number" && wert < schema.minimum)
      fehler.push(`${pfad}: unter dem Minimum`);
    if (typeof schema.maximum === "number" && wert > schema.maximum)
      fehler.push(`${pfad}: über dem Maximum`);
  }
  if (Array.isArray(wert)) {
    if (typeof schema.minItems === "number" && wert.length < schema.minItems)
      fehler.push(`${pfad}: zu wenige Einträge`);
    if (typeof schema.maxItems === "number" && wert.length > schema.maxItems)
      fehler.push(`${pfad}: zu viele Einträge`);
    if (schema.items) {
      wert.forEach((eintrag, i) =>
        fehler.push(
          ...verletzungen(schema.items as Knoten, eintrag, `${pfad}[${i}]`),
        ),
      );
    }
  }
  if (art === "object") {
    const objekt = wert as Knoten;
    const eigenschaften = (schema.properties as Record<string, Knoten>) ?? {};
    for (const name of (schema.required as string[] | undefined) ?? []) {
      if (!(name in objekt)) fehler.push(`${pfad}.${name}: fehlt`);
    }
    for (const [name, teil] of Object.entries(objekt)) {
      if (name in eigenschaften) {
        fehler.push(
          ...verletzungen(eigenschaften[name], teil, `${pfad}.${name}`),
        );
      } else if (schema.additionalProperties === false) {
        fehler.push(`${pfad}.${name}: unbekanntes Feld`);
      }
    }
  }
  return fehler;
}

// Antwort einer Operation (Pfad wie in openapi.yaml, etwa «/api/v1/stufen/{id}/kontakte») gegen das Schema ihres Statuscodes
export function antwortVerletzungen(
  pfad: string,
  methode: "get" | "post" | "put" | "patch" | "delete",
  status: number,
  body: unknown,
): string[] {
  const paths = doc.paths as Record<string, Record<string, Knoten>>;
  const antwort = (
    paths[pfad]?.[methode]?.responses as Record<string, Knoten> | undefined
  )?.[String(status)];
  if (!antwort)
    return [`${methode} ${pfad}: Status ${status} nicht beschrieben`];
  const aufgeloest =
    typeof antwort.$ref === "string" ? loese(antwort.$ref) : antwort;
  const schema = (
    (aufgeloest.content as Record<string, Knoten> | undefined)?.[
      "application/json"
    ] as Knoten | undefined
  )?.schema as Knoten | undefined;
  if (!schema) return [`${methode} ${pfad}: ${status} hat kein JSON-Schema`];
  return verletzungen(schema, body);
}

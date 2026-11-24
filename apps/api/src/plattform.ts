import { and, eq, inArray, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Db } from "./db/client.js";
import {
  personPlattformRolle,
  plattformEntwickler,
  plattformRolle,
  plattformRolleRecht,
} from "./db/schema.js";
import { zweiterFaktorFehlt, type Person } from "./rechte.js";

// Plattformrollen (#423). Zwei Rollen sind fest im Code und nicht einstellbar:
//   Entwickler: jedes Recht des Katalogs; nur die Kommandozeile vergibt und entzieht (cli/entwickler.ts), Tabelle plattform_entwickler
//   Abteilungsleitung (person.admin): jedes Recht des Katalogs in der eigenen Abteilung
// Alle anderen Rollen (zuerst «Webmaster», eine Vorgabe je Abteilung) legt die Abteilungsleitung an und stellt ihre Rechte aus diesem Katalog ein (/api/v1/admin/plattform/rollen).
// Weiter als die Rechte des Katalogs reicht keine Rolle; was nicht im Katalog steht, steht in rechte.ts und bearbeiten.ts (Stufenleitung, Zeilen in bearbeiter).

type Eintrag = {
  bedeutung: string;
  // Jedes Recht des Katalogs trägt das Merkmal «erweitert»: Wer es hat, braucht den zweiten Faktor (403 ZWEITER_FAKTOR_FEHLT). «Einfach» ist nur die Arbeit der Stufenleitung an der eigenen Stufenseite, sie steht nicht im Katalog (Entscheid vom 22.11.2026)
  erweitert: boolean;
  // Hat die Vorgabe «Webmaster» das Recht? Alles ausser dem Wartungsmodus
  webmaster: boolean;
  // Öffnet das Recht den Bereich «Website» der Verwaltung (/api/v1/redaktion)? Der Wartungsmodus nicht
  bereich: boolean;
};
const e = (bedeutung: string, webmaster = true, bereich = true): Eintrag => ({
  bedeutung,
  erweitert: true,
  webmaster,
  bereich,
});
const katalog = <K extends string>(eintraege: Record<K, Eintrag>) => eintraege;

export const PLATTFORM_RECHTE = katalog({
  "seiten.bearbeiten": e("Seiten bearbeiten"),
  "seiten.veroeffentlichen": e("Seiten veröffentlichen"),
  "seiten.anlegen_loeschen": e("Seiten anlegen und löschen"),
  "medien.verwalten": e("Medien verwalten"),
  "weiterleitungen.verwalten": e("Weiterleitungen verwalten"),
  "vorlagen.nutzen": e("Vorlagen nutzen"),
  "wartungsmodus.website": e(
    "Wartungsmodus der Website schalten",
    false,
    false,
  ),
});
export type PlattformRecht = keyof typeof PLATTFORM_RECHTE;
export const PLATTFORM_RECHT_NAMEN = Object.keys(
  PLATTFORM_RECHTE,
) as PlattformRecht[];
export const WEBMASTER_VORGABE = PLATTFORM_RECHT_NAMEN.filter(
  (r) => PLATTFORM_RECHTE[r].webmaster,
);

export const BEREICH_RECHTE = PLATTFORM_RECHT_NAMEN.filter(
  (r) => PLATTFORM_RECHTE[r].bereich,
);

// Ein Name aus der Datenbank oder einer Anfrage, den der Katalog kennt (Object.hasOwn: «toString» und Verwandte sind keine Rechte)
export const istPlattformRecht = (name: string): name is PlattformRecht =>
  Object.hasOwn(PLATTFORM_RECHTE, name);

const ALLE: ReadonlySet<PlattformRecht> = new Set(PLATTFORM_RECHT_NAMEN);

// Die Rechte einer Person, einmal je Person-Objekt und damit einmal je Anfrage geladen: Vergabe und Entzug wirken bei der nächsten Anfrage, und es kostet nie mehr als eine Abfrage. Wer nie danach fragt, löst keine aus.
// Ein neues Person-Objekt (jede Anfrage baut eines in personAusSitzung) lädt neu; wer in einem Test dieselbe Person nach einer Änderung noch einmal fragt, übergibt eine Kopie
type Geladen = { entwickler: boolean; namen: Set<string> };
const geladen = new WeakMap<object, Promise<Geladen>>();

// Eine gebündelte Abfrage: die Zeile des Entwicklers (falls es sie gibt) und die Rechte aller Rollen der Person in ihrer Abteilung. Eine Rolle einer anderen Abteilung gibt nichts
function lade(
  db: Pick<Db, "select">,
  person: Pick<Person, "id" | "abteilungId">,
) {
  let gespeichert = geladen.get(person);
  if (!gespeichert) {
    // Die Union nimmt Spaltennamen aus dem ersten Zweig, darum in beiden derselbe Alias
    const entwickler = db
      .select({
        quelle: sql<string>`'e'`.as("quelle"),
        recht: sql<string>`''`.as("recht"),
      })
      .from(plattformEntwickler)
      .where(eq(plattformEntwickler.userId, person.id));
    const rollen = db
      .select({
        quelle: sql<string>`'r'`.as("quelle"),
        recht: sql<string>`${plattformRolleRecht.recht}`.as("recht"),
      })
      .from(personPlattformRolle)
      .innerJoin(
        plattformRolle,
        and(
          eq(plattformRolle.id, personPlattformRolle.rolleId),
          eq(plattformRolle.abteilungId, person.abteilungId),
        ),
      )
      .innerJoin(
        plattformRolleRecht,
        eq(plattformRolleRecht.rolleId, plattformRolle.id),
      )
      .where(eq(personPlattformRolle.userId, person.id));
    gespeichert = unionAll(entwickler, rollen).then((zeilen) => ({
      entwickler: zeilen.some((z) => z.quelle === "e"),
      namen: new Set(
        zeilen.filter((z) => z.quelle === "r").map((z) => z.recht),
      ),
    }));
    geladen.set(person, gespeichert);
  }
  return gespeichert;
}

// Dieselbe Frage als SQL-Bedingung, für Abfragen, die sie ohnehin stellen (Tür der Verwaltung, Seitenlisten, Recht am Objekt): der Entwickler oder eine Rolle der Person in ihrer Abteilung, die mindestens eines der Rechte trägt. Die Abteilungsleitung entscheidet der Aufrufer vorher (person.admin).
// Als eigener Ausdruck: Drizzle liesse in einer Auswahl mit nur einer Tabelle den Tabellennamen vor Spalten weg, die direkt im Text stehen
export const plattformRechtSql = (
  person: Pick<Person, "id" | "abteilungId">,
  rechte: readonly PlattformRecht[],
) =>
  sql`(exists (select 1 from ${personPlattformRolle} inner join ${plattformRolle} on ${plattformRolle.id} = ${personPlattformRolle.rolleId} and ${plattformRolle.abteilungId} = ${person.abteilungId} inner join ${plattformRolleRecht} on ${plattformRolleRecht.rolleId} = ${plattformRolle.id} where ${personPlattformRolle.userId} = ${person.id} and ${inArray(plattformRolleRecht.recht, [...rechte])}) or exists (select 1 from ${plattformEntwickler} where ${plattformEntwickler.userId} = ${person.id}))`;

export async function istEntwickler(
  db: Pick<Db, "select">,
  person: Pick<Person, "id" | "abteilungId">,
) {
  return (await lade(db, person)).entwickler;
}

// Alle Rechte der Person: jedes für Entwickler und Abteilungsleitung, sonst die ihrer Rollen (ein Name, den der Katalog nicht kennt, zählt nicht)
export async function plattformRechteVon(
  db: Pick<Db, "select">,
  person: Pick<Person, "id" | "abteilungId" | "admin">,
): Promise<ReadonlySet<PlattformRecht>> {
  if (person.admin) return ALLE;
  const { entwickler, namen } = await lade(db, person);
  if (entwickler) return ALLE;
  return new Set([...namen].filter(istPlattformRecht));
}

// Die Prüffunktion: Hier hängen die Routen an (die Routen der Website seit #426, Wartungsmodus #424, Informationssperre #425). Die Reihenfolge bleibt wie überall: erst das Objekt laden (404), dann dieses Recht (403); der zweite Faktor kommt aus verlangePlattformRecht oder aus person.zweiterFaktor
export async function hatPlattformRecht(
  db: Pick<Db, "select">,
  person: Pick<Person, "id" | "abteilungId" | "admin">,
  recht: PlattformRecht,
) {
  return (await plattformRechteVon(db, person)).has(recht);
}

// Hono-Middleware für eine Route, die ein Recht des Katalogs braucht: fehlt es, 403; hat die Person es, aber keinen zweiten Faktor und ist es «erweitert», 403 mit dem Code ZWEITER_FAKTOR_FEHLT (wie bei der Abteilungsleitung). Gilt für Entwickler und Abteilungsleitung genauso
export function verlangePlattformRecht(db: Db, recht: PlattformRecht) {
  return createMiddleware<{ Variables: { person: Person } }>(
    async (c, next) => {
      const person = c.get("person");
      if (!(await hatPlattformRecht(db, person, recht))) {
        throw new HTTPException(403);
      }
      if (PLATTFORM_RECHTE[recht].erweitert && !person.zweiterFaktor) {
        return c.json(
          zweiterFaktorFehlt(
            "Für dieses Recht braucht es zuerst einen zweiten Faktor.",
          ),
          403,
        );
      }
      await next();
    },
  );
}

// Nur der Entwickler (Kommandozeile), auch keine Abteilungsleitung: für Dinge, die die Abteilungsleitung nicht sehen oder schalten darf (#425). Ohne zweiten Faktor 403 ZWEITER_FAKTOR_FEHLT
export function verlangeEntwickler(db: Db) {
  return createMiddleware<{ Variables: { person: Person } }>(
    async (c, next) => {
      const person = c.get("person");
      if (!(await istEntwickler(db, person))) throw new HTTPException(403);
      if (!person.zweiterFaktor) {
        return c.json(
          zweiterFaktorFehlt(
            "Für den Entwickler braucht es zuerst einen zweiten Faktor.",
          ),
          403,
        );
      }
      await next();
    },
  );
}

// Legt die Vorgabe «Webmaster» einer Abteilung an (Name und Rechte wie in Migration 0100); für eine neu angelegte Abteilung
export async function legeWebmasterAn(
  tx: Pick<Db, "insert">,
  abteilungId: string,
) {
  const [rolle] = await tx
    .insert(plattformRolle)
    .values({ abteilungId, name: "Webmaster", schluessel: "webmaster" })
    .returning({ id: plattformRolle.id });
  await tx.insert(plattformRolleRecht).values(
    // Dazu «fotos.verwalten» aus dem Rechtekatalog (#690): die Vorgabe «Webmaster» pflegt auch die Fotoalben
    [...WEBMASTER_VORGABE, "fotos.verwalten"].map((recht) => ({
      rolleId: rolle.id,
      recht,
    })),
  );
}

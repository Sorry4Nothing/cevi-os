import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { formularAntwort, seite, seiteVersion } from "../db/schema.js";
import type { Person } from "../rechte.js";
import {
  sichtbarFuer,
  sichtbarkeitAusSpalten,
  type Sichtbarkeit,
  type SichtRollen,
} from "../sichtbarkeit.js";
import {
  formularBausteine,
  type FormularBaustein,
} from "../website/bausteine-formular.js";

// Server-Seite des Bausteins «formular» (#819): die veröffentlichte Definition aus der Datenbank, die Frist und die Liste der Formulare der Verwaltung.
// Die Definition steht im Dokument der Seite (seite_version.inhalt). Eine Antwort wird nie gegen etwas aus der Anfrage geprüft, nur gegen den Stand, den die Seite jetzt veröffentlicht hat.

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const istFormularId = (s: string) => UUID.test(s);

// «JJJJ-MM-TT» in Zürcher Zeit (sv-SE schreibt es so): Ein Formular schliesst um Mitternacht dort
export const heuteZuerich = (jetzt: Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(jetzt);
export const istGeschlossen = (b: FormularBaustein, jetzt: Date) =>
  b.daten.schliesstAm !== undefined &&
  heuteZuerich(jetzt) > b.daten.schliesstAm;

export type Veroeffentlicht = {
  seiteId: string;
  abteilungId: string;
  versionId: string;
  seiteSichtbarkeit: Sichtbarkeit;
  baustein: FormularBaustein;
};

// Der Baustein mit der ID im Dokument (roh aus der Datenbank), geprüft gegen das Schema; sonst null
export function findeBaustein(
  inhalt: unknown,
  formularId: string,
): FormularBaustein | null {
  const liste = (inhalt as { bausteine?: unknown } | null)?.bausteine;
  if (!Array.isArray(liste)) return null;
  const roh = liste.find(
    (b) =>
      b &&
      typeof b === "object" &&
      (b as { typ?: unknown }).typ === "formular" &&
      String((b as { id?: unknown }).id).toLowerCase() === formularId,
  );
  const ergebnis = formularBausteine[0].safeParse(roh);
  return ergebnis.success ? ergebnis.data : null;
}

// Das Formular mit dieser Baustein-ID in der veröffentlichten Version einer Seite, sonst null (unbekannt, nicht veröffentlicht oder nicht mehr gültig). Ein Entwurf zählt nie
export async function ladeVeroeffentlichtes(
  db: Pick<Db, "select">,
  formularId: string,
): Promise<Veroeffentlicht | null> {
  const [z] = await db
    .select({
      seiteId: seite.id,
      abteilungId: seite.abteilungId,
      sichtbarkeit: seite.sichtbarkeit,
      sichtbarkeitTags: seite.sichtbarkeitTags,
      sichtbarkeitRollen: seite.sichtbarkeitRollen,
      versionId: seiteVersion.id,
      inhalt: seiteVersion.inhalt,
    })
    .from(seite)
    .innerJoin(
      seiteVersion,
      eq(seiteVersion.id, seite.veroeffentlichteVersionId),
    )
    .where(
      sql`${seiteVersion.inhalt} @> ${JSON.stringify({ bausteine: [{ id: formularId, typ: "formular" }] })}::jsonb`,
    )
    .limit(1);
  if (!z) return null;
  const baustein = findeBaustein(z.inhalt, formularId);
  if (!baustein) return null;
  return {
    seiteId: z.seiteId,
    abteilungId: z.abteilungId,
    versionId: z.versionId,
    seiteSichtbarkeit: sichtbarkeitAusSpalten(z),
    baustein,
  };
}

type Sicht = Parameters<typeof sichtbarFuer>[0];

// Die Seite und der Baustein müssen beide für diese Person sichtbar sein; null ist die Person ohne Anmeldung
export function darfFormularSehen(
  sicht: Sicht,
  abteilungId: string,
  seiteSichtbarkeit: Sichtbarkeit,
  b: FormularBaustein,
) {
  return (
    sichtbarFuer(sicht, { abteilungId, sichtbarkeit: seiteSichtbarkeit }) &&
    (b.sichtbarkeit === "erbt" ||
      sichtbarFuer(sicht, { abteilungId, sichtbarkeit: b.sichtbarkeit }))
  );
}

// Die Formulare, die die Person beantwortet hat (solange die Antwort noch nicht gelöscht ist)
export async function beantworteteFormulare(
  db: Pick<Db, "selectDistinct">,
  person: Pick<Person, "id" | "abteilungId">,
  formularIds?: readonly string[],
): Promise<Set<string>> {
  if (formularIds?.length === 0) return new Set();
  const zeilen = await db
    .selectDistinct({ formularId: formularAntwort.formularId })
    .from(formularAntwort)
    .where(
      and(
        eq(formularAntwort.abteilungId, person.abteilungId),
        eq(formularAntwort.userId, person.id),
        formularIds
          ? inArray(formularAntwort.formularId, [...formularIds])
          : undefined,
      ),
    );
  return new Set(zeilen.map((z) => z.formularId));
}

export type SichtbaresFormular = {
  id: string;
  titel: string | null;
  seitenTitel: string;
  schliesstAm: string | null;
  beantwortet: boolean;
};

// Die offenen Formulare der veröffentlichten Seiten der Abteilung, die die angemeldete Person sieht (Seite und Baustein). Zwei Abfragen
export async function listeSichtbareFormulare(
  db: Db,
  sicht: NonNullable<Sicht> & Pick<Person, "id">,
  jetzt: Date,
): Promise<SichtbaresFormular[]> {
  const seiten = await db.execute<{
    titel: string;
    sichtbarkeit: Sichtbarkeit["art"];
    sichtbarkeit_tags: string[];
    sichtbarkeit_rollen: SichtRollen;
    baustein: unknown;
  }>(sql`
    select s.titel, s.sichtbarkeit, s.sichtbarkeit_tags::text[] as sichtbarkeit_tags, s.sichtbarkeit_rollen, b as baustein
    from seite s
    join seite_version v on v.id = s.veroeffentlichte_version_id
    cross join lateral jsonb_array_elements(v.inhalt -> 'bausteine') b
    where s.abteilung_id = ${sicht.abteilungId} and b ->> 'typ' = 'formular'
  `);
  const offen = seiten.flatMap((z) => {
    const b = formularBausteine[0].safeParse(z.baustein);
    if (!b.success || istGeschlossen(b.data, jetzt)) return [];
    const seiteSicht = sichtbarkeitAusSpalten({
      sichtbarkeit: z.sichtbarkeit,
      sichtbarkeitTags: z.sichtbarkeit_tags,
      sichtbarkeitRollen: z.sichtbarkeit_rollen,
    });
    if (!darfFormularSehen(sicht, sicht.abteilungId, seiteSicht, b.data))
      return [];
    return [{ seitenTitel: z.titel, baustein: b.data }];
  });
  const beantwortet = await beantworteteFormulare(
    db,
    sicht,
    offen.map((f) => f.baustein.id.toLowerCase()),
  );
  return offen
    .map(({ seitenTitel, baustein: b }) => ({
      id: b.id.toLowerCase(),
      titel: b.daten.titel ?? null,
      seitenTitel,
      schliesstAm: b.daten.schliesstAm ?? null,
      beantwortet: beantwortet.has(b.id.toLowerCase()),
    }))
    .sort(
      (a, b) =>
        a.seitenTitel.localeCompare(b.seitenTitel, "de") ||
        (a.titel ?? "").localeCompare(b.titel ?? "", "de"),
    );
}

export type FormularZeile = {
  formularId: string;
  seiteId: string;
  seitenTitel: string;
  titel: string | null;
  // Steht der Baustein in der veröffentlichten Version der Seite? Sonst nimmt das Formular nichts mehr an, die Antworten bleiben bis zur Frist
  veroeffentlicht: boolean;
  schliesstAm: string | null;
  aufbewahrenTage: number;
  anzahl: number;
  // Antworten mit dem Stand «neu» (#881): noch niemand hat sie angeschaut
  neu: number;
  letzteAm: Date | null;
};

// Alle Formulare der Abteilung: die der veröffentlichten Seiten und die mit Antworten (auch wenn der Baustein inzwischen fehlt). Drei Abfragen
export async function listeFormulare(
  db: Db,
  abteilungId: string,
): Promise<FormularZeile[]> {
  const veroeffentlicht = await db.execute<{
    seite_id: string;
    titel: string;
    baustein: unknown;
  }>(sql`
    select s.id as seite_id, s.titel as titel, b as baustein
    from seite s
    join seite_version v on v.id = s.veroeffentlichte_version_id
    cross join lateral jsonb_array_elements(v.inhalt -> 'bausteine') b
    where s.abteilung_id = ${abteilungId} and b ->> 'typ' = 'formular'
  `);
  const zahlen = await db
    .select({
      formularId: formularAntwort.formularId,
      seiteId: sql<string>`(array_agg(${formularAntwort.seiteId} order by ${formularAntwort.id} desc))[1]`,
      versionId: sql<string>`(array_agg(${formularAntwort.versionId} order by ${formularAntwort.id} desc))[1]`,
      anzahl: sql<number>`count(*)::int`,
      neu: sql<number>`(count(*) filter (where ${formularAntwort.stand} = 'neu'))::int`,
      letzteAm: sql<string>`max(${formularAntwort.erstelltAm})`,
    })
    .from(formularAntwort)
    .where(eq(formularAntwort.abteilungId, abteilungId))
    .groupBy(formularAntwort.formularId);
  const nachId = new Map(zahlen.map((z) => [z.formularId, z]));
  const zeilen = new Map<string, FormularZeile>();
  for (const v of veroeffentlicht) {
    const b = formularBausteine[0].safeParse(v.baustein);
    if (!b.success) continue;
    const id = b.data.id.toLowerCase();
    const z = nachId.get(id);
    zeilen.set(id, {
      formularId: id,
      seiteId: v.seite_id,
      seitenTitel: v.titel,
      titel: b.data.daten.titel ?? null,
      veroeffentlicht: true,
      schliesstAm: b.data.daten.schliesstAm ?? null,
      aufbewahrenTage: b.data.daten.aufbewahrenTage,
      anzahl: z?.anzahl ?? 0,
      neu: z?.neu ?? 0,
      letzteAm: z?.letzteAm ? new Date(z.letzteAm) : null,
    });
  }
  // Formulare mit Antworten, deren Baustein nicht mehr veröffentlicht ist: Titel und Frist aus der Version, mit der die letzte Antwort entstand
  const fehlen = zahlen.filter((z) => !zeilen.has(z.formularId));
  if (fehlen.length > 0) {
    const versionen = await db
      .select({
        id: seiteVersion.id,
        inhalt: seiteVersion.inhalt,
        seitenTitel: seite.titel,
      })
      .from(seiteVersion)
      .innerJoin(seite, eq(seite.id, seiteVersion.seiteId))
      .where(
        inArray(
          seiteVersion.id,
          fehlen.map((z) => z.versionId),
        ),
      );
    for (const z of fehlen) {
      const v = versionen.find((x) => x.id === z.versionId);
      const b = v ? findeBaustein(v.inhalt, z.formularId) : null;
      zeilen.set(z.formularId, {
        formularId: z.formularId,
        seiteId: z.seiteId,
        seitenTitel: v?.seitenTitel ?? "",
        titel: b?.daten.titel ?? null,
        veroeffentlicht: false,
        schliesstAm: b?.daten.schliesstAm ?? null,
        aufbewahrenTage: b?.daten.aufbewahrenTage ?? 180,
        anzahl: z.anzahl,
        neu: z.neu,
        letzteAm: new Date(z.letzteAm),
      });
    }
  }
  return [...zeilen.values()].sort(
    (a, b) =>
      a.seitenTitel.localeCompare(b.seitenTitel, "de") ||
      (a.titel ?? "").localeCompare(b.titel ?? "", "de"),
  );
}

// Die Definitionen der Versionen, mit denen Antworten entstanden: Version → Baustein. Eine Version, die den Baustein nicht (mehr) hat, fehlt in der Liste
export async function ladeVersionen(
  db: Pick<Db, "select">,
  formularId: string,
  versionIds: readonly string[],
): Promise<Map<string, FormularBaustein>> {
  const aus = new Map<string, FormularBaustein>();
  if (versionIds.length === 0) return aus;
  const zeilen = await db
    .select({ id: seiteVersion.id, inhalt: seiteVersion.inhalt })
    .from(seiteVersion)
    .where(inArray(seiteVersion.id, [...versionIds]));
  for (const z of zeilen) {
    const b = findeBaustein(z.inhalt, formularId);
    if (b) aus.set(z.id, b);
  }
  return aus;
}

// Löscht Antworten nach ihrer Frist (loeschen_am, beim Absenden aus der Definition gesetzt); gibt die Zahl zurück
export async function loescheAlteFormularAntworten(
  db: Db,
  jetzt = new Date(),
): Promise<number> {
  const weg = await db
    .delete(formularAntwort)
    .where(lt(formularAntwort.loeschenAm, jetzt))
    .returning({ id: formularAntwort.id });
  return weg.length;
}

export const antwortenVon = (abteilungId: string, formularId: string) =>
  and(
    eq(formularAntwort.abteilungId, abteilungId),
    eq(formularAntwort.formularId, formularId),
  );

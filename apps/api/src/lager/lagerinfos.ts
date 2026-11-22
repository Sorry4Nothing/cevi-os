import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  infoAbschnitt,
  infoAbschnittDatei,
  lagerMitglied,
  notfallKontakt,
  packlisteEigen,
  packlistePunkt,
  ressort,
  user,
} from "../db/schema.js";
import { telefonSchema } from "../telefon.js";
import { ladeDateien, LINK_MAX, pruefeLink } from "./datei.js";
import { registriereDateiVerweis } from "./datei-verweise.js";
import { darf, type LagerZugriff } from "./policy.js";
import type { Tx } from "./sync.js";
import { registriereSuchquelle } from "./suche.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Packliste, Notfall und Infos im Lager (#393): Ansichten, Eingabeschemas und die Abfragen, die mehrere Routen teilen. Die Tabellen sind beim ersten Import dieser Datei im Register des Sync-Kerns angemeldet.
//
// Zeilen mit nur_lagerleitung liest nur, wer vertrauliches.lesen hat (Standard: nur die Lagerleitung). Das gilt in den Routen und im Änderungsfeed: Ohne das Recht kommen diese Zeilen nie, auch nicht ihre IDs. Eine solche Zeile ist für die Rolle unbekannt (404), nicht verboten.
// Die eigene Kopie der Packliste ist nicht kopiert: Die Vorlage (packliste_punkt) gehört dem Lager, die Person hat nur ihre Abweichungen (packliste_abhaken: abgehakt oder entfernt) und ihre eigenen Punkte (packliste_eigen). Das hält die Tabelle klein (rund 100 Personen mal ein Dutzend Abweichungen statt 100 Kopien der Liste), und eine Änderung der Vorlage erreicht alle sofort. Beide Tabellen sind persönlich und ohne Feed: Der Zeilenfilter des Feeds kennt die Person nicht, ein Eintrag im Feed wäre darum für alle sichtbar. Die App liest die Liste der Person mit einer Abfrage.

// Wer einen Zeilenfilter braucht, der nur nach nur_lagerleitung unterscheidet (Packliste, Infos): Ohne vertrauliches.lesen sind die Zeilen unsichtbar
function ohneVertrauliches(
  tabelle: typeof packlistePunkt | typeof infoAbschnitt,
) {
  return async (db: Db, zugriff: LagerZugriff, ids: string[]) => {
    if (darf(zugriff, "vertrauliches.lesen")) return new Set(ids);
    const zeilen = await db
      .select({ id: tabelle.id })
      .from(tabelle)
      .where(
        and(
          inArray(tabelle.id, ids),
          eq(tabelle.lagerId, zugriff.lager.id),
          eq(tabelle.nurLagerleitung, false),
        ),
      );
    return new Set(zeilen.map((z) => z.id));
  };
}

// Die Datei-Verknüpfungen eines Info-Abschnitts: lesbar, wenn der Abschnitt lesbar ist
async function sichtbareAbschnittDateien(
  db: Db,
  zugriff: LagerZugriff,
  ids: string[],
  spalte: typeof infoAbschnittDatei.id | typeof infoAbschnittDatei.dateiId,
) {
  const zeilen = await db
    .select({ id: spalte })
    .from(infoAbschnittDatei)
    .innerJoin(
      infoAbschnitt,
      and(
        eq(infoAbschnitt.lagerId, infoAbschnittDatei.lagerId),
        eq(infoAbschnitt.id, infoAbschnittDatei.abschnittId),
      ),
    )
    .where(
      and(
        inArray(spalte, ids),
        eq(infoAbschnittDatei.lagerId, zugriff.lager.id),
        spalte === infoAbschnittDatei.dateiId ? and() : undefined,
        darf(zugriff, "vertrauliches.lesen")
          ? undefined
          : eq(infoAbschnitt.nurLagerleitung, false),
      ),
    );
  return new Set(zeilen.map((z) => String(z.id)));
}

registriereLagerTabelle({
  tabelle: packlistePunkt,
  recht: "packliste.lesen",
  sichtbar: ohneVertrauliches(packlistePunkt),
});
registriereLagerTabelle({ tabelle: notfallKontakt, recht: "notfall.lesen" });

// Suche (#399): Punkte der Packliste, Funktion und Name im Notfall und Texte der Infos; Zeilen «nur Lagerleitung» nur mit vertrauliches.lesen (wie die Listen). Telefonnummern sind nicht durchsuchbar
const ohneVertraulichesSql =
  (tabelle: typeof packlistePunkt | typeof infoAbschnitt) =>
  (zugriff: LagerZugriff) =>
    darf(zugriff, "vertrauliches.lesen")
      ? undefined
      : eq(tabelle.nurLagerleitung, false);
registriereSuchquelle({
  typ: "packliste",
  recht: "packliste.lesen",
  tabelle: packlistePunkt,
  spalten: [packlistePunkt.text],
  titel: sql`${packlistePunkt.text}`,
  filter: ohneVertraulichesSql(packlistePunkt),
});
registriereSuchquelle({
  typ: "notfall",
  recht: "notfall.lesen",
  tabelle: notfallKontakt,
  spalten: [notfallKontakt.funktion, notfallKontakt.name],
  titel: sql`${notfallKontakt.funktion}`,
});
registriereSuchquelle({
  typ: "info",
  recht: "infos.lesen",
  tabelle: infoAbschnitt,
  spalten: [infoAbschnitt.titel, infoAbschnitt.text],
  titel: sql`${infoAbschnitt.titel}`,
  filter: ohneVertraulichesSql(infoAbschnitt),
});
registriereLagerTabelle({
  tabelle: infoAbschnitt,
  recht: "infos.lesen",
  sichtbar: ohneVertrauliches(infoAbschnitt),
});
registriereLagerTabelle({
  tabelle: infoAbschnittDatei,
  recht: "infos.lesen",
  sichtbar: (db, zugriff, ids) =>
    sichtbareAbschnittDateien(db, zugriff, ids, infoAbschnittDatei.id),
});
// Eine Datei am Info-Abschnitt sieht, wer den Abschnitt lesen darf (lager/datei-verweise.ts)
registriereDateiVerweis({
  tabelle: infoAbschnittDatei,
  spalte: infoAbschnittDatei.dateiId,
  recht: "infos.lesen",
  sichtbar: (db, zugriff, ids) =>
    sichtbareAbschnittDateien(db, zugriff, ids, infoAbschnittDatei.dateiId),
});

// Obergrenzen: halten die Liste einer Person in einer Abfrage ohne Seitenwechsel
export const PUNKTE_MAX = 500;
export const EIGENE_MAX = 100;
export const INFO_DATEIEN_MAX = 20;

// Ansichten für die Antwort und die Konfliktantwort des Sync-Kerns: nur die Spalten der Route, nie die ganze Zeile
export const punktAnsicht = (r: typeof packlistePunkt.$inferSelect) => ({
  id: r.id,
  version: r.version,
  abschnitt: r.abschnitt,
  text: r.text,
  nurLagerleitung: r.nurLagerleitung,
  reihenfolge: r.reihenfolge,
});
export const eigenAnsicht = (r: typeof packlisteEigen.$inferSelect) => ({
  id: r.id,
  abschnitt: r.abschnitt,
  text: r.text,
  abgehakt: r.abgehakt,
  reihenfolge: r.reihenfolge,
});
export const kontaktAnsicht = (r: typeof notfallKontakt.$inferSelect) => ({
  id: r.id,
  version: r.version,
  funktion: r.funktion,
  personId: r.personId,
  name: r.name,
  telefon: r.telefon,
  reihenfolge: r.reihenfolge,
});
export const infoAnsicht = (r: typeof infoAbschnitt.$inferSelect) => ({
  id: r.id,
  version: r.version,
  titel: r.titel,
  text: r.text,
  links: r.links,
  nurLagerleitung: r.nurLagerleitung,
  notfall: r.notfall,
  reihenfolge: r.reihenfolge,
});
export const infoDateiAnsicht = (
  r: typeof infoAbschnittDatei.$inferSelect,
) => ({
  id: r.id,
  version: r.version,
  abschnittId: r.abschnittId,
  dateiId: r.dateiId,
});

// Eingaben: strikt, nur die genannten Felder (SR-72)
const version = z.number().int().min(1);
const abschnitt = z.string().trim().min(1).max(100);
const reihenfolge = z.number().int().min(0).max(100000);
const mindestensEins = (b: object) => Object.keys(b).length > 1;

export const punktAnlegen = z.strictObject({
  abschnitt,
  text: z.string().trim().min(1).max(300),
  nurLagerleitung: z.boolean().optional(),
  reihenfolge: reihenfolge.optional(),
});
export const punktAendern = z
  .strictObject({
    version,
    abschnitt: abschnitt.optional(),
    text: z.string().trim().min(1).max(300).optional(),
    nurLagerleitung: z.boolean().optional(),
    reihenfolge: reihenfolge.optional(),
  })
  .refine(mindestensEins);
export const eigenAnlegen = z.strictObject({
  abschnitt,
  text: z.string().trim().min(1).max(300),
  reihenfolge: reihenfolge.optional(),
});
export const eigenAendern = z
  .strictObject({
    abschnitt: abschnitt.optional(),
    text: z.string().trim().min(1).max(300).optional(),
    reihenfolge: reihenfolge.optional(),
    abgehakt: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0);
export const zustandSetzen = z.strictObject({
  zustand: z.enum(["offen", "abgehakt", "entfernt"]),
});
export const versionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});

// Nur https, ohne Zugangsdaten; der Server ruft die Adresse nie ab (SR-26). Gespeichert wird die normalisierte Form
const httpsLink = z
  .string()
  .max(LINK_MAX)
  .refine((w) => pruefeLink(w).ok)
  .transform((w) => {
    const e = pruefeLink(w);
    return e.ok ? e.link : w;
  });
const link = z.strictObject({
  titel: z.string().trim().min(1).max(200),
  url: httpsLink,
});
export const kartenSetzen = z.strictObject({
  kartenLink: httpsLink.nullable(),
});

const kontaktName = z.string().trim().min(1).max(100);
const funktion = z.string().trim().min(1).max(100);
export const kontaktAnlegen = z
  .strictObject({
    funktion,
    personId: z.uuid().optional(),
    name: kontaktName.optional(),
    telefon: telefonSchema.optional(),
    reihenfolge: reihenfolge.optional(),
  })
  // Ein Konto des Lagers oder ein Name, nie beides; ein Name braucht die Nummer
  .refine((b) => (b.personId === undefined) !== (b.name === undefined))
  .refine((b) => b.name === undefined || typeof b.telefon === "string");
export const kontaktAendern = z
  .strictObject({
    version,
    funktion: funktion.optional(),
    name: kontaktName.optional(),
    telefon: telefonSchema.optional(),
    reihenfolge: reihenfolge.optional(),
  })
  .refine(mindestensEins);

const dateiIds = z
  .array(z.uuid())
  .max(INFO_DATEIEN_MAX)
  .refine((l) => new Set(l).size === l.length);
const infoLinks = z.array(link).max(20);
export const infoAnlegen = z.strictObject({
  titel: z.string().trim().min(1).max(200),
  text: z.string().trim().max(20000).nullable().optional(),
  links: infoLinks.optional(),
  nurLagerleitung: z.boolean().optional(),
  notfall: z.boolean().optional(),
  reihenfolge: reihenfolge.optional(),
  dateiIds: dateiIds.optional(),
});
export const infoAendern = z
  .strictObject({
    version,
    titel: z.string().trim().min(1).max(200).optional(),
    text: z.string().trim().max(20000).nullable().optional(),
    links: infoLinks.optional(),
    nurLagerleitung: z.boolean().optional(),
    notfall: z.boolean().optional(),
    reihenfolge: reihenfolge.optional(),
    dateiIds: dateiIds.optional(),
  })
  .refine(mindestensEins);

// Die Schreib-Transaktion sperrt das Lager (dieselbe Zeile wie die Folgenummer des Sync-Kerns): Obergrenzen und Reihenfolge sehen den Stand der Schreiber vor ihnen
export const sperreLagerZeile = (tx: Tx, lagerId: string) =>
  tx.execute(sql`select id from lager where id = ${lagerId} for update`);

// Alle Datei-Einträge müssen zu diesem Lager gehören und dürfen nicht gelöscht sein (eine Abfrage für alle)
export async function pruefeDateien(db: Db, lagerId: string, ids: string[]) {
  if (ids.length === 0) return;
  const gefunden = await ladeDateien(db, lagerId, ids);
  if (gefunden.size !== ids.length) throw new HTTPException(400);
}

// Die Person ist Mitglied des Lagers (eine Abfrage)
export async function istMitglied(
  tx: Pick<Db, "select">,
  lagerId: string,
  personId: string,
) {
  const [z] = await tx
    .select({ id: lagerMitglied.personId })
    .from(lagerMitglied)
    .where(
      and(
        eq(lagerMitglied.lagerId, lagerId),
        eq(lagerMitglied.personId, personId),
      ),
    );
  return Boolean(z);
}

// Info-Abschnitte mit Links und Dateien, in drei Abfragen für die ganze Seite (Abschnitte, Verknüpfungen, Einträge), nie je Abschnitt. «vertraulich»: Die Rolle hat vertrauliches.lesen. Sortiert nach Reihenfolge und ID; «nach» ist die ID des letzten Abschnitts der vorigen Seite (ist sie unbekannt, bleibt die Seite leer)
export async function ladeInfos(
  db: Db,
  lagerId: string,
  vertraulich: boolean,
  p: { id?: string; nach?: string; limit?: number; nurNotfall?: true } = {},
) {
  const limit = p.limit ?? 100;
  const zeilen = await db
    .select()
    .from(infoAbschnitt)
    .where(
      and(
        eq(infoAbschnitt.lagerId, lagerId),
        vertraulich ? undefined : eq(infoAbschnitt.nurLagerleitung, false),
        p.id ? eq(infoAbschnitt.id, p.id) : undefined,
        p.nurNotfall ? eq(infoAbschnitt.notfall, true) : undefined,
        p.nach
          ? sql`(${infoAbschnitt.reihenfolge}, ${infoAbschnitt.id}) > (select a.reihenfolge, a.id from info_abschnitt a where a.id = ${p.nach} and a.lager_id = ${lagerId})`
          : undefined,
      ),
    )
    .orderBy(asc(infoAbschnitt.reihenfolge), asc(infoAbschnitt.id))
    .limit(limit + 1);
  const seite = zeilen.slice(0, limit);
  const verknuepft =
    seite.length === 0
      ? []
      : await db
          .select({
            abschnittId: infoAbschnittDatei.abschnittId,
            dateiId: infoAbschnittDatei.dateiId,
          })
          .from(infoAbschnittDatei)
          .where(
            and(
              eq(infoAbschnittDatei.lagerId, lagerId),
              inArray(
                infoAbschnittDatei.abschnittId,
                seite.map((z) => z.id),
              ),
            ),
          )
          .orderBy(asc(infoAbschnittDatei.id));
  const dateien = await ladeDateien(
    db,
    lagerId,
    verknuepft.map((v) => v.dateiId),
  );
  const abschnitte = seite.map((z) => ({
    ...infoAnsicht(z),
    dateien: verknuepft
      .filter((v) => v.abschnittId === z.id)
      .flatMap((v) => dateien.get(v.dateiId) ?? []),
  }));
  return {
    abschnitte,
    naechster: zeilen.length > limit ? seite[limit - 1]!.id : null,
  };
}

export type NotfallKontakt = {
  // «eintrag»: von der Lagerleitung erfasst; «ressort»: Leitung oder Stellvertretung des Ressorts «si» und seiner Teilbereiche
  quelle: "eintrag" | "ressort";
  id: string | null;
  version: number | null;
  funktion: string;
  personId: string | null;
  name: string;
  ceviName: string | null;
  telefon: string | null;
  reihenfolge: number | null;
};

// Die erfassten Notfall-Kontakte mit Namen und Nummer (eine Abfrage). Eine eigene Nummer des Eintrags geht vor der Nummer des Kontos
export async function ladeKontakte(
  db: Pick<Db, "select">,
  lagerId: string,
  id?: string,
): Promise<NotfallKontakt[]> {
  const zeilen = await db
    .select({
      zeile: notfallKontakt,
      name: user.name,
      ceviName: user.ceviName,
      kontoTelefon: user.telefon,
    })
    .from(notfallKontakt)
    .leftJoin(user, eq(user.id, notfallKontakt.personId))
    .where(
      and(
        eq(notfallKontakt.lagerId, lagerId),
        id ? eq(notfallKontakt.id, id) : undefined,
      ),
    )
    .orderBy(asc(notfallKontakt.reihenfolge), asc(notfallKontakt.id));
  return zeilen.map((z) => ({
    quelle: "eintrag" as const,
    id: z.zeile.id,
    version: z.zeile.version,
    funktion: z.zeile.funktion,
    personId: z.zeile.personId,
    name: z.zeile.name ?? z.name ?? "",
    ceviName: z.ceviName,
    telefon: z.zeile.telefon ?? z.kontoTelefon,
    reihenfolge: z.zeile.reihenfolge,
  }));
}

// Das Kürzel des Ressorts der Sicherheit
export const SICHERHEIT_KUERZEL = "si";

// Die Sicherheitsverantwortlichen aus den Ressorts (eine Abfrage): Leitung und Stellvertretung des Ressorts «si» und aller seiner Unterressorts (Teilbereiche). Die Nummer kommt aus dem Konto
export async function ladeSicherheit(
  db: Pick<Db, "select">,
  lagerId: string,
): Promise<NotfallKontakt[]> {
  const leitung = alias(user, "leitung");
  const stv = alias(user, "stv");
  const zeilen = await db
    .select({
      zeile: ressort,
      leitungName: leitung.name,
      leitungCevi: leitung.ceviName,
      leitungTelefon: leitung.telefon,
      stvName: stv.name,
      stvCevi: stv.ceviName,
      stvTelefon: stv.telefon,
    })
    .from(ressort)
    .leftJoin(leitung, eq(leitung.id, ressort.leitungPersonId))
    .leftJoin(stv, eq(stv.id, ressort.stvPersonId))
    .where(and(eq(ressort.lagerId, lagerId)))
    .orderBy(asc(ressort.reihenfolge), asc(ressort.id));
  // Der Baum ist klein (ein Lager hat einige Ressorts): Die Unterressorts bestimmt der Code, nicht eine rekursive Abfrage
  const drin = new Set(
    zeilen
      .filter((z) => z.zeile.kuerzel.toLowerCase() === SICHERHEIT_KUERZEL)
      .map((z) => z.zeile.id),
  );
  for (let wachsen = true; wachsen;) {
    wachsen = false;
    for (const z of zeilen) {
      if (
        z.zeile.parentId &&
        drin.has(z.zeile.parentId) &&
        !drin.has(z.zeile.id)
      ) {
        drin.add(z.zeile.id);
        wachsen = true;
      }
    }
  }
  const kontakte: NotfallKontakt[] = [];
  const fuegeHinzu = (
    funktion: string,
    personId: string | null,
    name: string | null,
    ceviName: string | null,
    telefon: string | null,
  ) => {
    if (!personId) return;
    kontakte.push({
      quelle: "ressort",
      id: null,
      version: null,
      funktion,
      personId,
      name: name ?? "",
      ceviName,
      telefon,
      reihenfolge: null,
    });
  };
  for (const z of zeilen.filter((z) => drin.has(z.zeile.id))) {
    fuegeHinzu(
      `${z.zeile.name}: Leitung`,
      z.zeile.leitungPersonId,
      z.leitungName,
      z.leitungCevi,
      z.leitungTelefon,
    );
    fuegeHinzu(
      `${z.zeile.name}: Stellvertretung`,
      z.zeile.stvPersonId,
      z.stvName,
      z.stvCevi,
      z.stvTelefon,
    );
  }
  return kontakte;
}

// Die erfassten Kontakte, danach die Sicherheitsverantwortlichen aus den Ressorts; wer schon erfasst ist, kommt nicht noch einmal aus dem Ressort
export async function ladeAlleKontakte(
  db: Pick<Db, "select">,
  lagerId: string,
) {
  const [eintraege, sicherheit] = await Promise.all([
    ladeKontakte(db, lagerId),
    ladeSicherheit(db, lagerId),
  ]);
  const erfasst = new Set(eintraege.map((k) => k.personId));
  return [...eintraege, ...sicherheit.filter((k) => !erfasst.has(k.personId))];
}

// Prüfer für den Lager-Check (#377): Sie melden nur, ob die Quelle ihren Teil erfüllt; das Register des Checks fragt sie ab, sobald es besteht. Packliste: mindestens ein Punkt der Vorlage. Notfall: mindestens ein Kontakt mit Nummer
export type Pruefergebnis = { erfuellt: boolean; anzahl: number };

export async function pruefePackliste(
  db: Pick<Db, "select">,
  lagerId: string,
): Promise<Pruefergebnis> {
  const [z] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(packlistePunkt)
    .where(and(eq(packlistePunkt.lagerId, lagerId)));
  return { erfuellt: (z?.n ?? 0) > 0, anzahl: z?.n ?? 0 };
}

export async function pruefeNotfall(
  db: Pick<Db, "select">,
  lagerId: string,
): Promise<Pruefergebnis> {
  const mitNummer = (await ladeAlleKontakte(db, lagerId)).filter(
    (k) => k.telefon,
  ).length;
  return { erfuellt: mitNummer > 0, anzahl: mitNummer };
}

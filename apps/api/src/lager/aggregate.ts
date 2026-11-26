import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  aufgabe,
  dienst as dienstTabelle,
  lagerBenachrichtigung,
  lagertag,
  ressort,
  schicht,
  tagesabschnitt,
  tagesseite,
  tagesseiteBlock,
} from "../db/schema.js";
import { ladeZusammenfassung } from "./anwesenheit.js";
import {
  beteiligt,
  ladeAufgaben,
  leseUmfang,
  ressortJoin,
} from "./aufgaben.js";
import { hoeckUmfang, ladeHoecks } from "./hoecks.js";
import { darf, type LagerZugriff } from "./policy.js";
import { ladeSchichtplan } from "./schichtplan.js";
import { ladeTagesseite } from "./tagesseiten.js";
import { ladeWetter } from "./wetter.js";
import type { Wetterdienst } from "./wetter-openmeteo.js";
import { ladeZeitplan } from "./zeitplan.js";

// Aggregate für die Apps (#395): «Heute», «Meine Woche» und der Start der Lagerleitung. Reine Ansichten über die Lesefunktionen der Module, ohne eigene Tabelle und ohne Schreibzugriff. Notfall-Kontakte gehören nur zu #393 und stehen hier nicht.
// Rechte: Jeder Teil gilt nur mit dem Leserecht seiner Quelle (dieselben Rechte wie die Route des Moduls); fehlt es, ist der Teil null. Fehlt der Rolle jeder Teil von «Heute» oder «Meine Woche», antworten die Routen 403. Der Start ist der Lagerleitung und der Leitung vorbehalten.
// Datenbanklast: Die Teile laufen mit Promise.all; je Teil ist die Zahl der Abfragen fest, nie von der Zahl der Zeilen abhängig (die Zahlen stehen an den Funktionen). Die Zeit kommt von aussen, damit Tests deterministisch sind.

// Begrenzungen: halten jede Antwort in einer Abfrage ohne Seitenwechsel
const MAX_AUFGABEN = 100;
const MAX_HOECKS = 50;
// Widget-Stand (#871): so viele Zeilen zeigen W3 («Wichtig heute») und W4 (nächste Aufgaben) in der grössten Grösse; Titel mit höchstens so vielen Zeichen
const WIDGET_WICHTIG = 2;
const WIDGET_AUFGABEN = 3;
const WIDGET_TITEL = 60;

const zuerich = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
// «JJJJ-MM-TT» in Zürcher Zeit
export const datumInZuerich = (jetzt: Date) => zuerich.format(jetzt);

const TAG = 86_400_000;
const tageSeit1970 = (d: string) =>
  Math.round(Date.parse(`${d}T00:00:00Z`) / TAG);
export const addiereTage = (d: string, n: number) =>
  new Date((tageSeit1970(d) + n) * TAG).toISOString().slice(0, 10);
// Tage von a bis b (negativ, wenn b vor a liegt)
export const tageBis = (a: string, b: string) =>
  tageSeit1970(b) - tageSeit1970(a);

type Leser = Db;

// «Heute»: Abfragen: der Lagertag (1), dann parallel die Tagesseite mit Wetter (höchstens 5: Tag mit Seite, Blöcke, Dateien, Aufgaben mit Frist heute und deren Unterstützung; das Wetter 1, ein Abruf nur bei altem Stand), das Wetter allein (1, nur ohne Tagesseite), die Anwesenheit (1), der Schichtplan (1), die Höcks (1). undefined: der Rolle fehlt jeder Teil
export async function ladeHeute(
  db: Leser,
  zugriff: LagerZugriff,
  jetzt: Date,
  dienst: Wetterdienst,
) {
  const lagerId = zugriff.lager.id;
  const heute = datumInZuerich(jetzt);
  const mitSeite = darf(zugriff, "tagesseiten.lesen");
  const mitWetter = darf(zugriff, "wetter.lesen");
  const mitAnwesenheit = darf(zugriff, "anwesenheit.lesen_alle");
  const mitSchichten = darf(zugriff, "einteilung.lesen");
  const hoeckArt = hoeckUmfang(zugriff);
  if (
    !mitSeite &&
    !mitWetter &&
    !mitAnwesenheit &&
    !mitSchichten &&
    !hoeckArt
  ) {
    return undefined;
  }

  const [tag] = await db
    .select({ id: lagertag.id, datum: lagertag.datum, label: lagertag.label })
    .from(lagertag)
    .where(and(eq(lagertag.lagerId, lagerId), eq(lagertag.datum, heute)));

  const [seite, wetter, anwesenheit, plan, hoecks] = await Promise.all([
    mitSeite && tag ? ladeTagesseite(db, zugriff, tag.id, dienst) : undefined,
    // Mit Tagesseite steckt das Wetter des Tages schon darin
    mitWetter && !(mitSeite && tag)
      ? ladeWetter(db, zugriff.lager, dienst)
      : undefined,
    mitAnwesenheit && tag
      ? ladeZusammenfassung(db, lagerId, tag.id)
      : undefined,
    mitSchichten && tag ? ladeSchichtplan(db, lagerId) : undefined,
    hoeckArt
      ? ladeHoecks(db, lagerId, hoeckArt, {
          von: heute,
          bis: heute,
          limit: MAX_HOECKS,
        })
      : undefined,
  ]);

  return {
    datum: heute,
    lagertag: tag ?? null,
    tagesseite: seite
      ? { seite: seite.seite, bloecke: seite.bloecke, aufgaben: seite.aufgaben }
      : null,
    wetter: !mitWetter
      ? null
      : seite
        ? { tag: seite.wetter, stand: seite.wetterStand }
        : {
            tag: wetter?.tage.find((t) => t.datum === heute) ?? null,
            stand: wetter?.stand ?? null,
          },
    anwesenheit: mitAnwesenheit ? { zeilen: anwesenheit ?? [] } : null,
    schichten: mitSchichten
      ? {
          dienste: plan?.dienste ?? [],
          schichten:
            plan?.schichten.filter((s) => s.lagertagId === tag?.id) ?? [],
        }
      : null,
    hoecks: hoeckArt ? (hoecks?.hoecks ?? []) : null,
  };
}

// «Meine Woche»: die sieben Tage ab heute. Abfragen: die eigenen offenen Aufgaben (höchstens 2), der Schichtplan (1), die Höcks (1), alles parallel. undefined: der Rolle fehlt jeder Teil
export async function ladeMeineWoche(
  db: Leser,
  zugriff: LagerZugriff,
  jetzt: Date,
) {
  const lagerId = zugriff.lager.id;
  const von = datumInZuerich(jetzt);
  const bis = addiereTage(von, 6);
  const umfang = leseUmfang(zugriff);
  const mitSchichten = darf(zugriff, "einteilung.lesen");
  const hoeckArt = hoeckUmfang(zugriff);
  if (!umfang && !mitSchichten && !hoeckArt) return undefined;

  const [aufgaben, plan, hoecks] = await Promise.all([
    // Mit allem, was überfällig ist: Es gibt keine untere Grenze der Frist
    umfang
      ? ladeAufgaben(db, lagerId, {
          fristBis: bis,
          offen: true,
          eigeneVon: zugriff.personId,
          limit: MAX_AUFGABEN,
        })
      : undefined,
    mitSchichten ? ladeSchichtplan(db, lagerId) : undefined,
    hoeckArt
      ? ladeHoecks(db, lagerId, hoeckArt, { von, bis, limit: MAX_HOECKS })
      : undefined,
  ]);

  const dienste = new Map(plan?.dienste.map((d) => [d.id, d]));
  return {
    von,
    bis,
    aufgaben: aufgaben ? aufgaben.aufgaben : null,
    schichten: plan
      ? plan.schichten
          .filter(
            (s) =>
              s.personId === zugriff.personId &&
              s.datum >= von &&
              s.datum <= bis,
          )
          .map((s) => ({
            ...s,
            dienst: dienste.has(s.dienstId)
              ? {
                  id: s.dienstId,
                  name: dienste.get(s.dienstId)!.name,
                  nacht: dienste.get(s.dienstId)!.nacht,
                }
              : null,
          }))
      : null,
    hoecks: hoeckArt ? (hoecks?.hoecks ?? []) : null,
  };
}

// Wer den Start sieht: die Lagerleitung (auch die Abteilungsleitung) und die Leitung
export const darfStart = (zugriff: Pick<LagerZugriff, "rolle">) =>
  zugriff.rolle === "lagerleitung" || zugriff.rolle === "leitung";

// Start der Lagerleitung: Abfragen: Zahlen der Aufgaben (1), überfällige (höchstens 2) und eigene Aufgaben (höchstens 2), der Zeitplan (1), alles parallel. Ohne Recht auf alle Aufgaben zählen und zeigen die Teile nur die eigenen
export async function ladeStart(db: Leser, zugriff: LagerZugriff, jetzt: Date) {
  const lagerId = zugriff.lager.id;
  const heute = datumInZuerich(jetzt);
  const umfang = leseUmfang(zugriff);
  const nurEigene = umfang === "eigene" ? zugriff.personId : undefined;

  const [zahlen, ueberfaellig, eigene, zeitplan] = await Promise.all([
    umfang
      ? db
          .select({
            gesamt: sql<number>`count(*)`.mapWith(Number),
            erledigt:
              sql<number>`count(*) filter (where ${aufgabe.status} = 'erledigt')`.mapWith(
                Number,
              ),
            ueberfaellig:
              sql<number>`count(*) filter (where ${aufgabe.status} <> 'erledigt' and ${aufgabe.frist} < ${heute})`.mapWith(
                Number,
              ),
          })
          .from(aufgabe)
          .leftJoin(ressort, ressortJoin)
          .where(
            and(
              eq(aufgabe.lagerId, lagerId),
              nurEigene ? beteiligt(nurEigene) : undefined,
            ),
          )
          .then((z) => z[0]!)
      : undefined,
    umfang
      ? ladeAufgaben(db, lagerId, {
          fristBis: addiereTage(heute, -1),
          offen: true,
          eigeneVon: nurEigene,
          limit: MAX_AUFGABEN,
        })
      : undefined,
    umfang
      ? ladeAufgaben(db, lagerId, {
          offen: true,
          eigeneVon: zugriff.personId,
          limit: MAX_AUFGABEN,
        })
      : undefined,
    darf(zugriff, "zeitplan.lesen") ? ladeZeitplan(db, lagerId) : undefined,
  ]);

  const { von, bis } = zugriff.lager;
  return {
    heute,
    countdown: {
      von,
      bis,
      tageBisBeginn: tageBis(heute, von),
      tageBisEnde: tageBis(heute, bis),
    },
    fortschritt: {
      aufgaben: zahlen ?? null,
      meilensteine: zeitplan
        ? {
            gesamt: zeitplan.meilensteine.length,
            vergangen: zeitplan.meilensteine.filter((m) => m.datum < heute)
              .length,
            naechster:
              zeitplan.meilensteine.find((m) => m.datum >= heute) ?? null,
          }
        : null,
    },
    ueberfaellig: ueberfaellig ? ueberfaellig.aufgaben : null,
    eigene: eigene ? eigene.aufgaben : null,
  };
}

// Titel eines freien Textes fürs Widget: die erste nicht leere Zeile, gekürzt mit «…»; null, wenn der Text leer ist
export function widgetTitel(text: string) {
  const zeile = text
    .split("\n")
    .map((z) => z.trim())
    .find((z) => z);
  if (!zeile) return null;
  const zeichen = Array.from(zeile);
  return zeichen.length <= WIDGET_TITEL
    ? zeile
    : `${zeichen
        .slice(0, WIDGET_TITEL - 1)
        .join("")
        .trimEnd()}…`;
}

// Kompakter Stand für die Widgets der Apps (#848, #871): ein Aufruf mit Zahlen und Daten, dazu genau die Texte, die W3 und W4 zeigen: die eigenen Dienste heute (Dienst, Tagesabschnitt, Zeit), höchstens zwei Titel «Wichtig heute» und die nächsten drei eigenen offenen Aufgaben (ID, Titel, Frist). Nie Namen von Personen. Jeder Teil folgt dem Leserecht seiner Quelle wie «Heute» und «Meine Woche»; fehlt es, ist der Teil null. Die Tage bis Beginn und Ende und die ungelesenen Benachrichtigungen sieht jedes Mitglied, darum nie 403. Abfragen: fünf, parallel und unabhängig von der Zahl der Zeilen
export async function ladeWidget(
  db: Leser,
  zugriff: LagerZugriff,
  jetzt: Date,
) {
  const lagerId = zugriff.lager.id;
  const heute = datumInZuerich(jetzt);
  const ich = zugriff.personId;
  // Nur die eigenen Aufgaben, auch wenn die Rolle alle liest (wie «Meine Woche»)
  const eigeneOffen = and(
    eq(aufgabe.lagerId, lagerId),
    sql`${aufgabe.status} <> 'erledigt'`,
    beteiligt(ich),
  );
  const mitAufgaben = leseUmfang(zugriff);

  const [dienste, wichtig, aufgaben, naechste, ungelesen] = await Promise.all([
    // Je Lagertag und Abschnitt hat eine Person höchstens einen Dienst: die Liste ist so lang wie die Zahl der Abschnitte
    darf(zugriff, "einteilung.lesen")
      ? db
          .select({
            dienst: dienstTabelle.name,
            abschnitt: tagesabschnitt.name,
            zeit: tagesabschnitt.zeit,
          })
          .from(schicht)
          .innerJoin(
            lagertag,
            and(
              eq(lagertag.lagerId, schicht.lagerId),
              eq(lagertag.id, schicht.lagertagId),
            ),
          )
          .innerJoin(
            dienstTabelle,
            and(
              eq(dienstTabelle.lagerId, schicht.lagerId),
              eq(dienstTabelle.id, schicht.dienstId),
            ),
          )
          .innerJoin(
            tagesabschnitt,
            and(
              eq(tagesabschnitt.lagerId, schicht.lagerId),
              eq(tagesabschnitt.id, schicht.tagesabschnittId),
            ),
          )
          .where(
            and(
              eq(schicht.lagerId, lagerId),
              eq(schicht.personId, ich),
              eq(lagertag.datum, heute),
            ),
          )
          .orderBy(
            asc(tagesabschnitt.reihenfolge),
            asc(tagesabschnitt.id),
            asc(dienstTabelle.reihenfolge),
          )
      : undefined,
    // Die ersten Blöcke in der Reihenfolge der Tagesseite, die Zahl aller Blöcke steht in jeder Zeile
    darf(zugriff, "tagesseiten.lesen")
      ? db
          .select({
            text: tagesseiteBlock.text,
            anzahl: sql<number>`count(*) over ()`.mapWith(Number),
          })
          .from(tagesseiteBlock)
          .innerJoin(
            tagesseite,
            and(
              eq(tagesseite.lagerId, tagesseiteBlock.lagerId),
              eq(tagesseite.id, tagesseiteBlock.seiteId),
            ),
          )
          .innerJoin(
            lagertag,
            and(
              eq(lagertag.lagerId, tagesseite.lagerId),
              eq(lagertag.id, tagesseite.lagertagId),
            ),
          )
          .where(
            and(
              eq(tagesseiteBlock.lagerId, lagerId),
              eq(tagesseiteBlock.art, "wichtig"),
              eq(lagertag.datum, heute),
            ),
          )
          .orderBy(asc(tagesseiteBlock.reihenfolge), asc(tagesseiteBlock.id))
          .limit(WIDGET_WICHTIG)
      : undefined,
    mitAufgaben
      ? db
          .select({
            offen: sql<number>`count(*)`.mapWith(Number),
            ueberfaellig:
              sql<number>`count(*) filter (where ${aufgabe.frist} < ${heute})`.mapWith(
                Number,
              ),
            heute:
              sql<number>`count(*) filter (where ${aufgabe.frist} = ${heute})`.mapWith(
                Number,
              ),
            naechsteFrist: sql<
              string | null
            >`min(${aufgabe.frist}) filter (where ${aufgabe.frist} >= ${heute})`,
          })
          .from(aufgabe)
          .leftJoin(ressort, ressortJoin)
          .where(eigeneOffen)
          .then((z) => z[0]!)
      : undefined,
    // Sortiert wie «Meine Aufgaben» nach Frist in den Apps: Frist (ohne zuletzt), Reihenfolge, Titel
    mitAufgaben
      ? db
          .select({
            id: aufgabe.id,
            titel: aufgabe.titel,
            frist: aufgabe.frist,
          })
          .from(aufgabe)
          .leftJoin(ressort, ressortJoin)
          .where(eigeneOffen)
          .orderBy(
            sql`${aufgabe.frist} asc nulls last`,
            asc(aufgabe.reihenfolge),
            sql`lower(${aufgabe.titel})`,
            asc(aufgabe.id),
          )
          .limit(WIDGET_AUFGABEN)
      : undefined,
    db
      .select({ anzahl: count() })
      .from(lagerBenachrichtigung)
      .where(
        and(
          eq(lagerBenachrichtigung.lagerId, lagerId),
          eq(lagerBenachrichtigung.personId, ich),
          isNull(lagerBenachrichtigung.gelesenAm),
        ),
      )
      .then((z) => z[0]!.anzahl),
  ]);

  return {
    heute,
    tageBisBeginn: tageBis(heute, zugriff.lager.von),
    tageBisEnde: tageBis(heute, zugriff.lager.bis),
    eigeneDiensteHeute: dienste ? dienste.length : null,
    eigeneDienste: dienste ?? null,
    wichtigHeute: wichtig ? (wichtig[0]?.anzahl ?? 0) : null,
    wichtigTitel: wichtig
      ? wichtig.flatMap((b) => widgetTitel(b.text) ?? [])
      : null,
    eigeneAufgaben: aufgaben ?? null,
    naechsteAufgaben: naechste ?? null,
    ungelesen,
  };
}

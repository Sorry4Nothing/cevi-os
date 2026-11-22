import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { aufgabe, lagertag, ressort } from "../db/schema.js";
import { ladeZusammenfassung } from "./anwesenheit.js";
import {
  aufgabeAktiv,
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
import type { WetterHolen } from "./wetter-openmeteo.js";
import { ladeZeitplan } from "./zeitplan.js";

// Aggregate für die Apps (#395): «Heute», «Meine Woche» und der Start der Lagerleitung. Reine Ansichten über die Lesefunktionen der Module, ohne eigene Tabelle und ohne Schreibzugriff. Notfall-Kontakte gehören nur zu #393 und stehen hier nicht.
// Rechte: Jeder Teil gilt nur mit dem Leserecht seiner Quelle (dieselben Rechte wie die Route des Moduls); fehlt es, ist der Teil null. Fehlt der Rolle jeder Teil von «Heute» oder «Meine Woche», antworten die Routen 403. Der Start ist der Lagerleitung und der Leitung vorbehalten.
// Datenbanklast: Die Teile laufen mit Promise.all; je Teil ist die Zahl der Abfragen fest, nie von der Zahl der Zeilen abhängig (die Zahlen stehen an den Funktionen). Die Zeit kommt von aussen, damit Tests deterministisch sind.

// Begrenzungen: halten jede Antwort in einer Abfrage ohne Seitenwechsel
const MAX_AUFGABEN = 100;
const MAX_HOECKS = 50;

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
  holen: WetterHolen,
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
    .where(
      and(
        eq(lagertag.lagerId, lagerId),
        eq(lagertag.datum, heute),
        isNull(lagertag.geloeschtAm),
      ),
    );

  const [seite, wetter, anwesenheit, plan, hoecks] = await Promise.all([
    mitSeite && tag ? ladeTagesseite(db, zugriff, tag.id, holen) : undefined,
    // Mit Tagesseite steckt das Wetter des Tages schon darin
    mitWetter && !(mitSeite && tag)
      ? ladeWetter(db, zugriff.lager, holen)
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
              aufgabeAktiv,
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

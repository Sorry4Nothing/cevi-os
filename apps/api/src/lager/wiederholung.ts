import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  aufgabe,
  aufgabeCheckpunkt,
  aufgabeLink,
  aufgabeStichwort,
  aufgabeUnterstuetzung,
} from "../db/schema.js";
import { legeZeileAn, legeZeilenAn, type Tx } from "./sync.js";
// Meldet die Tabellen der Details im Sync-Kern an, bevor die Folgeaufgabe sie beschreibt (Zyklus mit aufgaben.ts, harmlos: beide nutzen die andere Seite nur in Funktionen)
import "./aufgaben-details.js";

// Wiederholung einer Aufgabe (#373): Wird eine Aufgabe mit `wiederholung` erledigt, legt der Server die nächste an. Sie bekommt dieselben Angaben, die Frist verschoben, einen Status «offen» und eine Checkliste mit allen Punkten offen. Genau einmal je Aufgabe: Die Folgeaufgabe trägt die ID der Vorgängerin in `quelle`, und wer die Aufgabe wieder öffnet und erneut erledigt (oder wessen Anfrage doppelt eintrifft), bekommt keine zweite. Die Prüfung gilt auch für eine gelöschte Folgeaufgabe: Wer sie löscht, will sie nicht noch einmal.

export type Wiederholung = "w1" | "w2" | "m1";

export const folgeQuelle = (aufgabeId: string) => `wiederholung:${aufgabeId}`;

const tageImMonat = (jahr: number, monat: number) =>
  new Date(Date.UTC(jahr, monat + 1, 0)).getUTCDate();

// Das Datum «JJJJ-MM-TT» eine Wiederholung weiter. Wöchentlich und alle zwei Wochen sind 7 und 14 Tage; monatlich bleibt beim Tag des Monats und fällt auf das Monatsende, wenn der nächste Monat kürzer ist (31. Januar, dann 28. oder 29. Februar). shortcut: Der verkürzte Tag bleibt für die folgenden Monate (28. Februar, dann 28. März); wer den ursprünglichen Tag halten will, braucht ihn als eigene Spalte
export function naechsteFrist(datum: string, wiederholung: Wiederholung) {
  const [j, m, t] = datum.split("-").map(Number) as [number, number, number];
  if (wiederholung === "m1") {
    const jahr = m === 12 ? j + 1 : j;
    const monat = m === 12 ? 0 : m;
    const tag = Math.min(t, tageImMonat(jahr, monat));
    return new Date(Date.UTC(jahr, monat, tag)).toISOString().slice(0, 10);
  }
  const tage = wiederholung === "w1" ? 7 : 14;
  return new Date(Date.UTC(j, m - 1, t + tage)).toISOString().slice(0, 10);
}

type AufgabeZeile = typeof aufgabe.$inferSelect;

// Legt die Folgeaufgabe an und liefert ihre ID; undefined, wenn die Aufgabe keine Wiederholung hat oder die nächste schon existiert. In der Schreib-Transaktion, nach der Sperre des Lagers (der Aufrufer hält sie)
export async function legeFolgeAufgabeAn(
  tx: Tx,
  k: { lagerId: string; personId: string },
  alt: AufgabeZeile,
): Promise<string | undefined> {
  if (!alt.wiederholung) return undefined;
  const [vorhanden] = await tx
    .select({ id: aufgabe.id })
    .from(aufgabe)
    .where(
      and(
        eq(aufgabe.lagerId, k.lagerId),
        eq(aufgabe.quelle, folgeQuelle(alt.id)),
      ),
    );
  if (vorhanden) return undefined;

  const [ende] = await tx
    .select({ n: sql<number>`coalesce(max(${aufgabe.reihenfolge}) + 1, 0)` })
    .from(aufgabe)
    .where(and(eq(aufgabe.lagerId, k.lagerId), isNull(aufgabe.geloeschtAm)));
  const folge = await legeZeileAn(tx, aufgabe, k, {
    titel: alt.titel,
    ressortId: alt.ressortId,
    teil: alt.teil,
    verantwortlichPersonId: alt.verantwortlichPersonId,
    notiz: alt.notiz,
    frist: alt.frist ? naechsteFrist(alt.frist, alt.wiederholung) : null,
    stern: alt.stern,
    laufend: alt.laufend,
    spaeterAb: alt.spaeterAb
      ? naechsteFrist(alt.spaeterAb, alt.wiederholung)
      : null,
    wiederholung: alt.wiederholung,
    reihenfolge: ende!.n,
    quelle: folgeQuelle(alt.id),
  });

  const [unterstuetzung, checkpunkte, links, stichworte] = await Promise.all([
    tx
      .select({ personId: aufgabeUnterstuetzung.personId })
      .from(aufgabeUnterstuetzung)
      .where(eq(aufgabeUnterstuetzung.aufgabeId, alt.id)),
    tx
      .select({
        text: aufgabeCheckpunkt.text,
        reihenfolge: aufgabeCheckpunkt.reihenfolge,
      })
      .from(aufgabeCheckpunkt)
      .where(
        and(
          eq(aufgabeCheckpunkt.aufgabeId, alt.id),
          isNull(aufgabeCheckpunkt.geloeschtAm),
        ),
      )
      .orderBy(asc(aufgabeCheckpunkt.reihenfolge), asc(aufgabeCheckpunkt.id)),
    tx
      .select({ titel: aufgabeLink.titel, url: aufgabeLink.url })
      .from(aufgabeLink)
      .where(
        and(eq(aufgabeLink.aufgabeId, alt.id), isNull(aufgabeLink.geloeschtAm)),
      )
      .orderBy(asc(aufgabeLink.id)),
    tx
      .select({ stichwort: aufgabeStichwort.stichwort })
      .from(aufgabeStichwort)
      .where(eq(aufgabeStichwort.aufgabeId, alt.id)),
  ]);
  if (unterstuetzung.length > 0) {
    await tx.insert(aufgabeUnterstuetzung).values(
      unterstuetzung.map((u) => ({
        lagerId: k.lagerId,
        aufgabeId: folge.id,
        personId: u.personId,
      })),
    );
  }
  if (stichworte.length > 0) {
    await tx.insert(aufgabeStichwort).values(
      stichworte.map((s) => ({
        lagerId: k.lagerId,
        aufgabeId: folge.id,
        stichwort: s.stichwort,
      })),
    );
  }
  // Die Checkliste beginnt von vorn: alle Punkte offen, ohne Person
  await legeZeilenAn(
    tx,
    aufgabeCheckpunkt,
    k,
    checkpunkte.map((c) => ({
      aufgabeId: folge.id,
      text: c.text,
      reihenfolge: c.reihenfolge,
    })),
  );
  await legeZeilenAn(
    tx,
    aufgabeLink,
    k,
    links.map((l) => ({ aufgabeId: folge.id, titel: l.titel, url: l.url })),
  );
  return folge.id;
}

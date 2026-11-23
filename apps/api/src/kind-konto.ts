import { type AnyColumn, eq, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { KIND_CHAT_ARTEN, kindKontoEinstellung } from "./db/schema.js";

// Konten für Kinder (#644). Die Einstellungen je Abteilung stehen in kind_konto_einstellung und sind in der Verwaltung einstellbar; diese Vorgaben gelten ohne Zeile. Sie sind die vorsichtigste Wahl: keine Konten, kein Chat, die Eltern behalten die Einsicht
export type KindChat = (typeof KIND_CHAT_ARTEN)[number];
export type KindKontoEinstellung = {
  erlaubt: boolean;
  chat: KindChat;
  // Nur ein Hinweis beim Erstellen: Cevi OS kennt das Alter der Kinder nicht
  mindestalter: number | null;
  elternEinsichtVorgabe: boolean;
};

export const KIND_KONTO_VORGABE: KindKontoEinstellung = {
  erlaubt: false,
  chat: "aus",
  mindestalter: null,
  elternEinsichtVorgabe: true,
};

export async function ladeKindKontoEinstellung(
  db: Pick<Db, "select">,
  abteilungId: string,
): Promise<KindKontoEinstellung> {
  const [zeile] = await db
    .select({
      erlaubt: kindKontoEinstellung.erlaubt,
      chat: kindKontoEinstellung.chat,
      mindestalter: kindKontoEinstellung.mindestalter,
      elternEinsichtVorgabe: kindKontoEinstellung.elternEinsichtVorgabe,
    })
    .from(kindKontoEinstellung)
    .where(eq(kindKontoEinstellung.abteilungId, abteilungId));
  return zeile ?? KIND_KONTO_VORGABE;
}

// Wie das Kind sein Konto erreicht, für die Liste «Kinder»: kein Zugang, nur Eltern, nur eigenes Konto oder beides. Wer die Einsicht der Eltern ausgeschaltet hat, zählt als «nur eigenes Konto», auch wenn Eltern verknüpft bleiben
export type Zugang = "keiner" | "eltern" | "konto" | "beides";
export function zugangVon(
  eltern: number,
  hatKonto: boolean,
  elternEinsicht: boolean,
): Zugang {
  const elternSehen = eltern > 0 && (!hatKonto || elternEinsicht);
  if (hatKonto) return elternSehen ? "beides" : "konto";
  return elternSehen ? "eltern" : "keiner";
}

// Bedingung für Abfragen auf user: Das Konto gehört keinem Kind. Das eigene Konto eines Kindes bekommt nie Rollen, Tags, Bearbeitungsrechte, Lagermitgliedschaft oder Plattformrechte; es ist ein Teilnehmer und bleibt es
export const keinKindKonto = (userId: AnyColumn) =>
  sql`not exists (select 1 from kind where kind.user_id = ${userId})`;

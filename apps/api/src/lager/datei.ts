import { and, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { abteilung, lagerDatei } from "../db/schema.js";
import { sichtbareDateien } from "./datei-verweise.js";
import type { LagerZugriff } from "./policy.js";
import type { LagerRecht } from "./rechte-katalog.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Dateien im Lager als Verknüpfung (#370). Die Dateien liegen im SharePoint (Microsoft 365) der Abteilung; Cevi OS speichert nur den Link. Der Server ruft die Adresse nie ab, löst sie nie auf und liefert nie Inhalt (SR-26): Öffnen und Herunterladen gehen direkt zum Ablageort, der selbst regelt, wer die Datei öffnen darf. Die Offline-Kopie legt die App an, nur wenn die Person die Option in den Einstellungen der App einschaltet (Vorgabe aus); die API liefert dafür Link, Typ und Grösse. Im Web gibt es keine Offline-Kopie

export const LINK_MAX = 2048;

// Wer einen Eintrag anlegen und löschen darf: wer eines der Module bearbeiten darf, die Dateien einbinden. Der Katalog hat kein eigenes Recht dafür; ein Eintrag allein zeigt nichts, gelesen wird er über den Datensatz, der ihn einbindet
export const DATEI_RECHTE: readonly LagerRecht[] = [
  "pinnwand.bearbeiten",
  "dokumente.bearbeiten",
  "protokolle.bearbeiten",
  "infos.bearbeiten",
];

export type LinkErgebnis =
  { ok: true; link: string } | { ok: false; grund: "ungueltig" | "host" };

// Ohne Steuer-, Format- und Trennzeichen (Leerzeichen, Zeilenumbruch, Bidi-Zeichen) und ohne Backslash: Eine Adresse, die Browser anders lesen als der Server, gibt es hier nicht. Gross- und Kleinschreibung des Schemas egal
const ADRESSE = /^https:\/\/[^\p{C}\p{Z}\\]+$/iu;

// Strenge Prüfung eines Links: nur https, kein javascript:, data: oder protokoll-relative Adresse, keine Zugangsdaten und kein Port in der Adresse, ein Host mit Punkt und kein IP-Literal, höchstens LINK_MAX Zeichen. «hosts» sind die erlaubten Hosts der Abteilung (der Host selbst oder eine Subdomain davon); null oder leer = keine Einschränkung (Vorgabe). Liefert die Adresse in der Schreibweise der URL-Norm (Host klein, Punycode)
export function pruefeLink(
  roh: string,
  hosts?: readonly string[] | null,
): LinkErgebnis {
  const ungueltig = { ok: false, grund: "ungueltig" } as const;
  if (roh.length > LINK_MAX || !ADRESSE.test(roh)) return ungueltig;
  let url: URL;
  try {
    url = new URL(roh);
  } catch {
    return ungueltig;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return ungueltig;
  }
  const host = url.hostname;
  if (
    !/^[a-z0-9.-]+$/.test(host) ||
    !host.includes(".") ||
    // Nur Ziffern und Punkte (auch die Kurzformen, die URL zu 127.0.0.1 umschreibt)
    /^[0-9.]+$/.test(host) ||
    host.startsWith(".") ||
    host.endsWith(".") ||
    host.includes("..")
  ) {
    return ungueltig;
  }
  if (url.href.length > LINK_MAX) return ungueltig;
  if (
    hosts &&
    hosts.length > 0 &&
    !hosts.some((h) => host === h || host.endsWith(`.${h}`))
  ) {
    return { ok: false, grund: "host" };
  }
  return { ok: true, link: url.href };
}

export const hostSchema = z
  .string()
  .max(253)
  .regex(
    /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/,
  )
  .transform((h) => h.toLowerCase());

// Eingabe beim Anlegen. «link» wird hier nur als Text angenommen und danach mit pruefeLink geprüft (die Hosts kommen aus der Datenbank)
export const dateiSchema = z.strictObject({
  anzeigename: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^\p{C}]+$/u),
  link: z.string().max(LINK_MAX),
  typ: z
    .string()
    .max(100)
    .regex(/^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/)
    .transform((t) => t.toLowerCase())
    .optional(),
  groesse: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});

// Die Hosts der Abteilung (eine Abfrage); null = keine Einschränkung
export async function ladeDateiHosts(db: Db, abteilungId: string) {
  const [zeile] = await db
    .select({ hosts: abteilung.dateiHosts })
    .from(abteilung)
    .where(eq(abteilung.id, abteilungId));
  return zeile?.hosts ?? null;
}

// Was eine Route vom Eintrag zeigt: nie die ganze Zeile. Gilt auch für die Konfliktantwort des Sync-Kerns
export function dateiAnsicht(zeile: typeof lagerDatei.$inferSelect) {
  return {
    id: zeile.id,
    version: zeile.version,
    anzeigename: zeile.anzeigename,
    link: zeile.link,
    typ: zeile.typ,
    groesse: zeile.groesse,
    hinzugefuegtVon: zeile.erstelltVon,
    hinzugefuegtAm: zeile.erstelltAm,
  };
}

// Für Module, die Dateien einbinden: die Ansichten mehrerer Einträge in einer Abfrage (nie eine je Zeile). Das Modul hat die Sichtbarkeit des Datensatzes schon geprüft; gelöschte und fremde Einträge fehlen in der Antwort
export async function ladeDateien(db: Db, lagerId: string, ids: string[]) {
  if (ids.length === 0)
    return new Map<string, ReturnType<typeof dateiAnsicht>>();
  const zeilen = await db
    .select()
    .from(lagerDatei)
    .where(
      and(
        inArray(lagerDatei.id, ids),
        eq(lagerDatei.lagerId, lagerId),
        isNull(lagerDatei.geloeschtAm),
      ),
    );
  return new Map(zeilen.map((z) => [z.id, dateiAnsicht(z)]));
}

// Für Module beim Einbinden: Der Eintrag muss zu diesem Lager gehören und darf nicht gelöscht sein, sonst 400 (nicht 404: Die Route des Moduls hat ihr Ziel schon gefunden)
export async function pruefeDateiImLager(
  db: Db,
  lagerId: string,
  dateiId: string,
) {
  const [zeile] = await db
    .select({ id: lagerDatei.id })
    .from(lagerDatei)
    .where(
      and(
        eq(lagerDatei.id, dateiId),
        eq(lagerDatei.lagerId, lagerId),
        isNull(lagerDatei.geloeschtAm),
      ),
    );
  if (!zeile) throw new HTTPException(400);
}

// Eintrag lesen: lesbar für die Person, die ihn in den letzten 24 Stunden hinzugefügt hat (so kann sie ihn einbinden), und für jeden, der einen Datensatz lesen darf, der ihn einbindet. Sonst gibt es ihn für die Person nicht (undefined, die Route antwortet 404)
export async function ladeSichtbareDatei(
  db: Db,
  zugriff: LagerZugriff,
  personId: string,
  id: string,
) {
  const [zeile] = await db
    .select()
    .from(lagerDatei)
    .where(
      and(
        eq(lagerDatei.id, id),
        eq(lagerDatei.lagerId, zugriff.lager.id),
        isNull(lagerDatei.geloeschtAm),
      ),
    );
  if (!zeile) return undefined;
  if (
    zeile.erstelltVon === personId &&
    Date.now() - zeile.erstelltAm.getTime() < 24 * 60 * 60 * 1000
  ) {
    return zeile;
  }
  return (await sichtbareDateien(db, zugriff, [id])).has(id)
    ? zeile
    : undefined;
}

// Der Feed meldet einen Eintrag nur, wenn ein lesbarer Datensatz ihn einbindet; die Person, die ihn eben angelegt hat, bekommt ihn mit der Antwort auf POST
registriereLagerTabelle({
  tabelle: lagerDatei,
  recht: null,
  sichtbar: (db, zugriff, ids) => sichtbareDateien(db, zugriff, ids),
});

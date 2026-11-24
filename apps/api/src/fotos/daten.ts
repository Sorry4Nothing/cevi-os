import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { fotoAlbum, fotoEinstellung } from "../db/schema.js";
import { istKennung } from "./quelle.js";

// Was die Abteilung über Fotos entschieden hat (#690): das Flickr-Konto, der Schalter für den Link zu Flickr und je Album Sichtbarkeit, Reihenfolge und eigener Titel. Alles andere liegt bei Flickr.

export const MAX_TITEL = 120;
export const MAX_ALBEN = 500;

export type FotoEinstellung = {
  flickrKonto: string | null;
  flickrLinkZeigen: boolean;
  // 0, solange es noch keine Zeile gibt
  version: number;
};

export async function ladeEinstellung(
  db: Pick<Db, "select">,
  abteilungId: string,
): Promise<FotoEinstellung> {
  const [z] = await db
    .select({
      flickrKonto: fotoEinstellung.flickrKonto,
      flickrLinkZeigen: fotoEinstellung.flickrLinkZeigen,
      version: fotoEinstellung.version,
    })
    .from(fotoEinstellung)
    .where(eq(fotoEinstellung.abteilungId, abteilungId));
  return z ?? { flickrKonto: null, flickrLinkZeigen: false, version: 0 };
}

export type AlbumZeile = {
  flickrAlbumId: string;
  sichtbar: boolean;
  reihenfolge: number;
  titel: string | null;
  version: number;
};

// Alle Zeilen der Abteilung in ihrer Reihenfolge
export async function ladeAlbumZeilen(
  db: Pick<Db, "select">,
  abteilungId: string,
): Promise<AlbumZeile[]> {
  return db
    .select({
      flickrAlbumId: fotoAlbum.flickrAlbumId,
      sichtbar: fotoAlbum.sichtbar,
      reihenfolge: fotoAlbum.reihenfolge,
      titel: fotoAlbum.titel,
      version: fotoAlbum.version,
    })
    .from(fotoAlbum)
    .where(eq(fotoAlbum.abteilungId, abteilungId))
    .orderBy(asc(fotoAlbum.reihenfolge), asc(fotoAlbum.flickrAlbumId));
}

export async function ladeSichtbaresAlbum(
  db: Pick<Db, "select">,
  abteilungId: string,
  flickrAlbumId: string,
): Promise<AlbumZeile | undefined> {
  const [z] = await db
    .select({
      flickrAlbumId: fotoAlbum.flickrAlbumId,
      sichtbar: fotoAlbum.sichtbar,
      reihenfolge: fotoAlbum.reihenfolge,
      titel: fotoAlbum.titel,
      version: fotoAlbum.version,
    })
    .from(fotoAlbum)
    .where(
      and(
        eq(fotoAlbum.abteilungId, abteilungId),
        eq(fotoAlbum.flickrAlbumId, flickrAlbumId),
        eq(fotoAlbum.sichtbar, true),
      ),
    );
  return z;
}

// Eine Kennung bei Flickr: Ziffern, nie etwas anderes
export const kennung = z.string().refine(istKennung);
export const kennungParam = z.strictObject({ id: kennung });
export const bildParam = z.strictObject({ id: kennung, bildId: kennung });

const titel = z
  .string()
  .trim()
  .min(1)
  .max(MAX_TITEL)
  .refine((s) => !/\p{Cc}/u.test(s));

export const einstellungSchema = z.strictObject({
  // Die Kennung des Kontos (NSID): Ziffern, «@N» und zwei Ziffern; null entfernt das Konto
  flickrKonto: z
    .string()
    .trim()
    .regex(/^[0-9]{1,20}@N[0-9]{2}$/)
    .nullable(),
  flickrLinkZeigen: z.boolean(),
  version: z.number().int().min(0).max(1_000_000),
});

export const albumSchema = z
  .strictObject({
    sichtbar: z.boolean().optional(),
    // null: wieder der Titel von Flickr
    titel: titel.nullable().optional(),
    version: z.number().int().min(0).max(1_000_000),
  })
  .refine((a) => a.sichtbar !== undefined || a.titel !== undefined);

export const reihenfolgeSchema = z.strictObject({
  ids: z
    .array(kennung)
    .min(1)
    .max(MAX_ALBEN)
    .refine((ids) => new Set(ids).size === ids.length),
});

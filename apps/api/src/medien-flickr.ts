import { and, eq, gt, like, sql } from "drizzle-orm";
import sharp from "sharp";
import {
  kodiereMedienbild,
  kodiereVarianten,
  MEDIEN_BREITEN,
  MEDIEN_MAX_PIXEL,
} from "./bild-sharp.js";
import type { Db } from "./db/client.js";
import { auditLog, medium } from "./db/schema.js";
import type { FlickrOriginal } from "./fotos/flickr-original.js";
import type { FotoQuelle, QuellBild } from "./fotos/quelle.js";
import {
  abstand,
  ausschnitte,
  dHash,
  graubild,
  type Graubild,
  urteile,
  vergleiche,
  type Urteil,
} from "./medien-abgleich.js";
import { entferneBild, legeBildAb, variantenSchluessel } from "./medien.js";
import type { Medienspeicher } from "./medien-speicher.js";

// Medienbilder in Originalqualität nachziehen (#868): Varianten für den Bestand und Ersatz eines Bildes durch das Original auf Flickr. Die Befehle in cli/ verdrahten nur; hier steht, was die Tests prüfen.
// Nur Medien der genannten Abteilung, nur Fotos ihres Flickr-Kontos. Ausgaben und Audit-Log tragen Zahlen und IDs, nie Alt-Texte oder Namen.

const KANTE = 256;

// Grauwerte für den Abgleich, längste Seite 256 px; Transparenz wird weiss
async function grau(daten: Uint8Array) {
  const { data, info } = await sharp(daten, {
    limitInputPixels: MEDIEN_MAX_PIXEL,
    failOn: "error",
  })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(KANTE, KANTE, { fit: "inside" })
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return graubild(data, info.width, info.height);
}

type Zeile = typeof medium.$inferSelect;

async function ladeMedium(db: Db, abteilungId: string, mediumId: string) {
  const [m] = await db
    .select()
    .from(medium)
    .where(and(eq(medium.id, mediumId), eq(medium.abteilungId, abteilungId)));
  if (!m || !m.mimeTyp.startsWith("image/") || !m.breite || !m.hoehe) {
    throw new Error("Kein Medienbild mit dieser ID in der Abteilung");
  }
  return m;
}

export type Ersatz =
  | {
      ersetzt: true;
      abstand: number;
      vorher: { breite: number; hoehe: number };
      nachher: { breite: number; hoehe: number };
      waisen: number;
    }
  | { ersetzt: false; abstand: number; grund: "nicht_groesser" };

// Ersetzt die Datei eines Mediums durch das grösste Bild des Flickr-Fotos. Die ID bleibt, Verweise in Seiten bleiben gültig. Ist das Medium ein Ausschnitt (anderes Seitenverhältnis), schneidet es das Original gleich zu: Der Ausschnitt ergibt sich aus dem Abgleich.
// Erst die neuen Dateien, dann die Zeile (nur, wenn sie seither unverändert ist), dann die alten Dateien weg. Ist das Original nicht grösser als das Medium, bleibt alles, wie es ist
export async function ersetzeAusFlickr({
  db,
  speicher,
  flickr,
  abteilungId,
  konto,
  mediumId,
  fotoId,
}: {
  db: Db;
  speicher: Medienspeicher;
  flickr: FlickrOriginal;
  abteilungId: string;
  konto: string;
  mediumId: string;
  fotoId: string;
}): Promise<Ersatz> {
  const m = await ladeMedium(db, abteilungId, mediumId);
  const original = await flickr.groesste(konto, fotoId);
  const treffer = vergleiche(
    dHash(await grau(await speicher.holen(m.speicherSchluessel))),
    m.breite! / m.hoehe!,
    await grau(original.daten),
  );
  const bild = await kodiereMedienbild(original.daten, treffer.ausschnitt);
  if (bild.breite * bild.hoehe <= m.breite! * m.hoehe!) {
    return {
      ersetzt: false,
      abstand: treffer.abstand,
      grund: "nicht_groesser",
    };
  }
  const varianten = bild.varianten.map((v) => v.breite);
  const schluessel = await legeBildAb(speicher, bild);
  try {
    await db.transaction(async (tx) => {
      const [neu] = await tx
        .update(medium)
        .set({
          mimeTyp: bild.typ,
          groesse: bild.inhalt.length,
          breite: bild.breite,
          hoehe: bild.hoehe,
          speicherSchluessel: schluessel,
          varianten,
        })
        .where(
          and(
            eq(medium.id, m.id),
            eq(medium.abteilungId, abteilungId),
            eq(medium.speicherSchluessel, m.speicherSchluessel),
          ),
        )
        .returning({ id: medium.id });
      if (!neu) throw new Error("Das Medium hat sich inzwischen geändert");
      await tx.insert(auditLog).values({
        abteilungId,
        akteurId: "cli",
        aktion: "medium_ersetzt",
        zielTyp: "medium",
        zielId: m.id,
        details: {
          quelle: "flickr",
          vorher: { breite: m.breite, hoehe: m.hoehe },
          nachher: { breite: bild.breite, hoehe: bild.hoehe },
        },
      });
    });
  } catch (fehler) {
    await entferneBild(speicher, schluessel, varianten);
    throw fehler;
  }
  const waisen = await entferneBild(
    speicher,
    m.speicherSchluessel,
    m.varianten,
  );
  return {
    ersetzt: true,
    abstand: treffer.abstand,
    vorher: { breite: m.breite!, hoehe: m.hoehe! },
    nachher: { breite: bild.breite, hoehe: bild.hoehe },
    waisen: waisen.length,
  };
}

export type Vorschlag = {
  mediumId: string;
  altText: string | null;
  fotoId: string | null;
  abstand: number | null;
  urteil: Urteil;
};

// Vergleicht jedes Medienbild der Abteilung mit allen Fotos der Alben des Kontos (kleine Stufe von Flickr). Je Seitenverhältnis der Medien werden die Ausschnitte eines Fotos einmal gerechnet.
// melde: Fortschritt als Zahl der geprüften Fotos
export async function vorschlaege({
  db,
  speicher,
  quelle,
  abteilungId,
  konto,
  melde = () => {},
  parallel = 6,
}: {
  db: Db;
  speicher: Medienspeicher;
  quelle: FotoQuelle;
  abteilungId: string;
  konto: string;
  melde?: (fotos: number) => void;
  parallel?: number;
}): Promise<Vorschlag[]> {
  const zeilen = await db
    .select()
    .from(medium)
    .where(
      and(eq(medium.abteilungId, abteilungId), like(medium.mimeTyp, "image/%")),
    );
  type Stand = {
    m: Zeile;
    hash: Uint32Array;
    bester: number;
    zweiter: number;
    fotoId: string | null;
    // Grauwerte des besten Fotos: Am Ende sucht der Abgleich dort den Ausschnitt fein
    foto: Graubild | null;
    verh: number;
  };
  // Je Seitenverhältnis (auf 1 % gerundet) die Medien dazu
  const gruppen = new Map<number, Stand[]>();
  for (const m of zeilen) {
    if (!m.breite || !m.hoehe) continue;
    // Fehlt die Datei oder ist sie nicht lesbar, fehlt das Medium in der Liste; der Rest läuft weiter
    const g = await speicher
      .holen(m.speicherSchluessel)
      .then(grau)
      .catch(() => null);
    if (!g) continue;
    const verh = Math.round((g.breite / g.hoehe) * 100) / 100;
    const stand: Stand = {
      m,
      hash: dHash(g),
      bester: Infinity,
      zweiter: Infinity,
      fotoId: null,
      foto: null,
      verh: m.breite / m.hoehe,
    };
    gruppen.set(verh, [...(gruppen.get(verh) ?? []), stand]);
  }

  const fotos = new Map<string, QuellBild>();
  for (const album of await quelle.alben(konto)) {
    const { bilder } = await quelle.album(konto, album.id);
    for (const b of bilder) fotos.set(b.id, b);
  }

  const pruefe = async (b: QuellBild) => {
    const datei = await quelle.datei(b, "320");
    const g = await grau(
      new Uint8Array(await new Response(datei.body).arrayBuffer()),
    );
    for (const [verh, liste] of gruppen) {
      const hashes = ausschnitte(g, verh, 32).map((a) => dHash(g, a));
      for (const s of liste) {
        const d = Math.min(...hashes.map((h) => abstand(s.hash, h)));
        if (d < s.bester) {
          s.zweiter = s.bester;
          s.bester = d;
          s.fotoId = b.id;
          s.foto = g;
        } else if (d < s.zweiter) s.zweiter = d;
      }
    }
  };
  const warteschlange = [...fotos.values()];
  let fertig = 0;
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      for (let b = warteschlange.shift(); b; b = warteschlange.shift()) {
        // Ein Foto, das nicht lädt, fehlt im Vergleich; der Rest läuft weiter
        await pruefe(b).catch(() => {});
        melde(++fertig);
      }
    }),
  );

  return [...gruppen.values()].flat().map((s) => {
    if (s.foto) {
      s.bester = Math.min(s.bester, vergleiche(s.hash, s.verh, s.foto).abstand);
    }
    const urteil = urteile(s.bester, s.zweiter);
    return {
      mediumId: s.m.id,
      altText: s.m.altText,
      fotoId: urteil === "kein Treffer" ? null : s.fotoId,
      abstand: Number.isFinite(s.bester) ? s.bester : null,
      urteil,
    };
  });
}

// Varianten für Medienbilder ohne Varianten (Bestand vor #868), in allen Abteilungen: aus dem gespeicherten Bild, das selbst bleibt, wie es ist. Bilder bis 640 px brauchen keine. Wiederholbar: Was Varianten hat, bleibt liegen
export async function ergaenzeVarianten({
  db,
  speicher,
}: {
  db: Db;
  speicher: Medienspeicher;
}) {
  const zeilen = await db
    .select()
    .from(medium)
    .where(
      and(
        // Varianten sind WebP; ein Bild in einem anderen Format (vor #335) bleibt, wie es ist
        eq(medium.mimeTyp, "image/webp"),
        gt(medium.breite, MEDIEN_BREITEN[0]),
        sql`cardinality(${medium.varianten}) = 0`,
      ),
    );
  const e = { ergaenzt: 0, fehler: 0 };
  for (const m of zeilen) {
    let abgelegt: number[] = [];
    try {
      const varianten = await kodiereVarianten(
        await speicher.holen(m.speicherSchluessel),
      );
      for (const v of varianten) {
        await speicher.ablegen(
          v.inhalt,
          m.mimeTyp,
          variantenSchluessel(m.speicherSchluessel, v.breite),
        );
        abgelegt.push(v.breite);
      }
      const [z] = await db
        .update(medium)
        .set({ varianten: abgelegt })
        .where(
          and(
            eq(medium.id, m.id),
            eq(medium.speicherSchluessel, m.speicherSchluessel),
            sql`cardinality(${medium.varianten}) = 0`,
          ),
        )
        .returning({ id: medium.id });
      if (!z) throw new Error("geaendert");
      abgelegt = [];
      e.ergaenzt++;
    } catch {
      // Nur die Varianten weg, nie das Bild selbst
      await Promise.allSettled(
        abgelegt.map((b) =>
          speicher.loeschen(variantenSchluessel(m.speicherSchluessel, b)),
        ),
      );
      e.fehler++;
    }
  }
  return e;
}

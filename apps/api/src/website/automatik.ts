import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { auditLog, seite, tag } from "../db/schema.js";
import { sichtbarkeitSpalten, type Sichtbarkeit } from "../sichtbarkeit.js";
import {
  adresseSchema,
  pruefeLage,
  RESERVIERTE_ADRESSEN,
  type Knoten,
} from "./seiten.js";
import {
  dokumentAusVorlage,
  vorlageBrauchtTag,
  type Vorlage,
} from "./vorlagen.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Eine Vorbedingung fehlt; die Route macht daraus eine Antwort, die Automatik lässt die Transaktion scheitern
export class VorlagenFehler extends Error {
  constructor(
    readonly code:
      | "TAG_ERFORDERLICH"
      | "TAG_UNBEKANNT"
      | "ELTERN_UNBEKANNT"
      | "SEITE_ZU_TIEF",
  ) {
    super(code);
  }
}

// Adresse aus einem Namen: Kleinbuchstaben, Umlaute ausgeschrieben, alles übrige zu «-». Nie leer, höchstens 60 Zeichen
export function adresseAusName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "seite" : slug;
}

// Erste freie Adresse unter der Elternseite: Kollision (oder reservierte Adresse auf der obersten Ebene) hängt «-2», «-3» … an, nie ein Fehler
function freieAdresse(
  knoten: Knoten,
  elternId: string | null,
  name: string,
): string {
  const belegt = new Set(
    [...knoten.values()]
      .filter((k) => k.elternId === elternId)
      .map((k) => k.adresse),
  );
  const gesperrt = (a: string) =>
    belegt.has(a) || (elternId === null && RESERVIERTE_ADRESSEN.includes(a));
  const basis = adresseAusName(name);
  for (let n = 1; ; n++) {
    const zusatz = n === 1 ? "" : `-${n}`;
    const kandidat = `${basis.slice(0, 60 - zusatz.length).replace(/-+$/, "")}${zusatz}`;
    if (!gesperrt(kandidat) && adresseSchema.safeParse(kandidat).success) {
      return kandidat;
    }
  }
}

// Strukturänderungen laufen je Abteilung nacheinander (wie in routes/redaktion/seiten.ts); innerhalb einer Transaktion darf die Sperre mehrfach genommen werden
const sperre = (tx: Tx, abteilungId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`seite:${abteilungId}`}, 0))`,
  );

const ladeKnoten = async (tx: Tx, abteilungId: string) => {
  const zeilen = await tx
    .select({
      id: seite.id,
      elternId: seite.elternId,
      adresse: seite.adresse,
      reihenfolge: seite.reihenfolge,
      tagId: seite.tagId,
    })
    .from(seite)
    .where(eq(seite.abteilungId, abteilungId));
  return new Map(zeilen.map((z) => [z.id, z])) as Knoten;
};

export type SeiteAusVorlage = {
  abteilungId: string;
  vorlage: Vorlage;
  // Titel der Seite und des Dokuments; die Adresse wird daraus abgeleitet
  titel: string;
  // Ohne Angabe oder null: oberste Ebene
  elternId?: string | null;
  // Gruppe der Seite (Stufe, Team); bei «stufenseite» Pflicht. Je Tag höchstens eine Seite
  tagId?: string | null;
  sichtbarkeit: Sichtbarkeit;
  // Wer die Seite anlegt, für das Audit-Log
  autorId: string;
};

// Legt eine Seite aus einer Vorlage an, in der Transaktion des Aufrufers (#352; auch für den Auftrag Termine, Anlassseite).
// Die Seite startet als Entwurf (nie veröffentlicht), Adresse aus dem Titel mit Zusatz bei Kollision, ans Ende der Geschwister.
// Gibt {neu: false} mit der bestehenden Seite zurück, wenn es zum Tag schon eine gibt (idempotent).
// Wirft VorlagenFehler bei fehlendem Tag, fremdem oder unbekanntem Tag und Elternseite, zu tiefem Baum.
// Der Aufrufer prüft das Recht (Abteilungsleitung oder Plattformrechte «Seiten anlegen und löschen», «Vorlagen nutzen») und meldet nach dem Commit «seite_geaendert» (meldeWebsiteEreignis) für neu: true.
export async function erzeugeSeiteAusVorlage(
  tx: Tx,
  o: SeiteAusVorlage,
): Promise<{ id: string; adresse: string; neu: boolean }> {
  const elternId = o.elternId ?? null;
  const tagId = o.tagId ?? null;
  if (vorlageBrauchtTag(o.vorlage) && tagId === null) {
    throw new VorlagenFehler("TAG_ERFORDERLICH");
  }
  await sperre(tx, o.abteilungId);
  if (tagId !== null) {
    const [gruppe] = await tx
      .select({ id: tag.id })
      .from(tag)
      .where(and(eq(tag.id, tagId), eq(tag.abteilungId, o.abteilungId)));
    if (!gruppe) throw new VorlagenFehler("TAG_UNBEKANNT");
    const [vorhanden] = await tx
      .select({ id: seite.id, adresse: seite.adresse })
      .from(seite)
      .where(eq(seite.tagId, tagId));
    if (vorhanden) return { ...vorhanden, neu: false };
  }
  const knoten = await ladeKnoten(tx, o.abteilungId);
  if (elternId !== null && !knoten.has(elternId)) {
    throw new VorlagenFehler("ELTERN_UNBEKANNT");
  }
  if (pruefeLage(knoten, undefined, elternId) !== "ok") {
    throw new VorlagenFehler("SEITE_ZU_TIEF");
  }
  const adresse = freieAdresse(knoten, elternId, o.titel);
  const letzte = Math.max(
    -1,
    ...[...knoten.values()]
      .filter((k) => k.elternId === elternId)
      .map((k) => k.reihenfolge),
  );
  const [zeile] = await tx
    .insert(seite)
    .values({
      abteilungId: o.abteilungId,
      elternId,
      adresse,
      titel: o.titel.trim(),
      reihenfolge: letzte + 1,
      tagId,
      ...sichtbarkeitSpalten(o.sichtbarkeit),
      // Der Entwurf zählt als einmal gespeichert; veröffentlicht ist noch nichts
      entwurf: dokumentAusVorlage(o.vorlage, o.titel, tagId ?? undefined),
      entwurfZaehler: 1,
    })
    .returning({ id: seite.id });
  // Nur Kennungen und die Art, nie Titel oder Inhalt
  await tx.insert(auditLog).values({
    abteilungId: o.abteilungId,
    akteurId: o.autorId,
    aktion: "seite_angelegt",
    zielTyp: "seite",
    zielId: zeile.id,
    details: {
      elternId,
      tagId,
      sichtbarkeit: o.sichtbarkeit.art,
      vorlage: o.vorlage,
    },
  });
  return { id: zeile.id, adresse, neu: true };
}

// Welche Vorlage und welche Elternseite eine neue Gruppe bekommt (A4). Ein Team hat keine Stufenfakten: Textseite
const GRUPPEN = {
  stufe: { vorlage: "stufenseite", eltern: "stufen", elternTitel: "Stufen" },
  team: { vorlage: "textseite", eltern: "teams", elternTitel: "Teams" },
} as const;

// Automatik (#352): Zu einem neuen Tag vom Typ «stufe» oder «team» entsteht in derselben Transaktion eine Seite als ENTWURF
// (Gruppe = tagId, Titel = Name) unter der Seite «Stufen» bzw. «Teams», die bei Bedarf selbst als Entwurf entsteht.
// «angemeldet» statt «öffentlich»: Eine Seite soll nie sichtbar werden, ohne dass jemand es entschieden hat (fail-closed).
// Gibt die IDs der neuen Seiten zurück, damit der Aufrufer nach dem Commit «seite_geaendert» melden kann; für andere Typen leer.
export async function legeSeiteFuerTagAn(
  tx: Tx,
  o: {
    abteilungId: string;
    autorId: string;
    tagId: string;
    typ: string;
    name: string;
  },
): Promise<string[]> {
  if (o.typ !== "stufe" && o.typ !== "team") return [];
  const gruppe = GRUPPEN[o.typ];
  const sichtbarkeit = { art: "angemeldet" } as const;
  await sperre(tx, o.abteilungId);
  const neue: string[] = [];
  let [eltern] = await tx
    .select({ id: seite.id })
    .from(seite)
    .where(
      and(
        eq(seite.abteilungId, o.abteilungId),
        isNull(seite.elternId),
        eq(seite.adresse, gruppe.eltern),
      ),
    );
  if (!eltern) {
    const angelegt = await erzeugeSeiteAusVorlage(tx, {
      abteilungId: o.abteilungId,
      vorlage: "textseite",
      titel: gruppe.elternTitel,
      sichtbarkeit,
      autorId: o.autorId,
    });
    eltern = angelegt;
    neue.push(angelegt.id);
  }
  const kind = await erzeugeSeiteAusVorlage(tx, {
    abteilungId: o.abteilungId,
    vorlage: gruppe.vorlage,
    titel: o.name,
    elternId: eltern.id,
    tagId: o.tagId,
    sichtbarkeit,
    autorId: o.autorId,
  });
  if (kind.neu) neue.push(kind.id);
  return neue;
}

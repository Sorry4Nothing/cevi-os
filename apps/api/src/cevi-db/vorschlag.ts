import { and, asc, eq, isNull, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  anlass,
  anlassAnmeldung,
  anlassFeld,
  kind,
  kindZugang,
  user,
} from "../db/schema.js";
import type { Person } from "../rechte.js";
import { anlassSichtbar } from "../termine/anlass-sicht.js";
import type { CeviDbDienst } from "./dienst.js";
import { wertFuer, type CeviQuelle } from "./felder.js";
import { ordneZu, type Anfrage } from "./zuordnung.js";

// Der Vorschlag aus der Cevi-Datenbank für die Anmeldung zu einem Anlass (#691). Er gibt nur Werte für Felder zurück, die der Anlass selbst als «aus der Cevi-Datenbank füllen» eingestellt hat, und nie für ein Feld, das die Person schon beantwortet hat (der eigene Wert gewinnt). Es wird nichts gespeichert: Die Person sendet die Anmeldung ab, oder nicht.

export type Status =
  // Funktion aus (nicht verbunden) oder der Anlass fragt nichts aus der Cevi-Datenbank
  | "aus"
  // Eindeutig zugeordnet; «felder» kann trotzdem leer sein (die Cevi-Datenbank hat nichts)
  | "ok"
  // Keine oder mehrere mögliche Personen: kein Vorschlag, und die Antwort sagt nicht, welches von beiden
  | "kein_treffer"
  | "nicht_erreichbar";

export type Vorschlag = {
  status: Status;
  felder: Record<string, { wert: string; quelle: "cevi-db" }>;
};

const KEIN_ZUGRIFF = null;

// Der Anlass mit den Feldern, die aus der Cevi-Datenbank kommen, nur wenn die Person ihn sehen darf
async function ladeAnlassFelder(db: Db, person: Person, anlassId: string) {
  const zeilen = await db
    .select({
      anmeldungFuer: anlass.anmeldungFuer,
      schluessel: anlassFeld.schluessel,
      quelle: anlassFeld.ceviQuelle,
    })
    .from(anlass)
    .leftJoin(
      anlassFeld,
      and(eq(anlassFeld.anlassId, anlass.id), isNotNull(anlassFeld.ceviQuelle)),
    )
    .where(
      and(
        eq(anlass.id, anlassId),
        eq(anlass.abteilungId, person.abteilungId),
        anlassSichtbar(person),
      ),
    )
    .orderBy(asc(anlassFeld.reihenfolge));
  const kopf = zeilen[0];
  if (!kopf) return KEIN_ZUGRIFF;
  return {
    anmeldungFuer: kopf.anmeldungFuer,
    felder: zeilen.flatMap((z) =>
      z.schluessel && z.quelle
        ? [{ schluessel: z.schluessel, quelle: z.quelle as CeviQuelle }]
        : [],
    ),
  };
}

// Die Angaben, mit denen die Zuordnung sucht: beim Kind die Eltern (E-Mail), bei einer Person sie selbst. Das Kind muss ein aktives Kind der Person sein, sonst null (die Route antwortet 404)
export async function ladeAnfrage(
  db: Db,
  person: Person,
  kindId: string | undefined,
): Promise<(Anfrage & { ziel: "kind" | "user"; zielId: string }) | null> {
  if (kindId !== undefined) {
    const [eigenes] = await db
      .select({
        id: kind.id,
        vorname: kind.vorname,
        nachname: kind.nachname,
        ceviDbId: kind.ceviDbId,
      })
      .from(kind)
      .innerJoin(
        kindZugang,
        and(eq(kindZugang.kindId, kind.id), eq(kindZugang.userId, person.id)),
      )
      .where(
        and(
          eq(kind.id, kindId),
          eq(kind.abteilungId, person.abteilungId),
          isNull(kind.inaktivSeit),
        ),
      );
    if (!eigenes) return null;
    // Alle Eltern des Kindes: In der Cevi-Datenbank steht beim Kind oft die Adresse eines Elternteils
    const eltern = await db
      .select({ email: user.email })
      .from(kindZugang)
      .innerJoin(user, eq(user.id, kindZugang.userId))
      .where(eq(kindZugang.kindId, kindId));
    return {
      ziel: "kind",
      zielId: eigenes.id,
      ceviDbId: eigenes.ceviDbId,
      emails: eltern.map((e) => e.email),
      vorname: eigenes.vorname,
      nachname: eigenes.nachname,
      geburtsdatum: null,
    };
  }
  const [selbst] = await db
    .select({ name: user.name, email: user.email, ceviDbId: user.ceviDbId })
    .from(user)
    .where(eq(user.id, person.id));
  if (!selbst) return null;
  // Der Name im Konto ist ein Feld: der letzte Teil ist der Nachname, der Rest der Vorname
  const teile = selbst.name.trim().split(/\s+/);
  const nachname = teile.length > 1 ? teile.pop()! : null;
  return {
    ziel: "user",
    zielId: person.id,
    ceviDbId: selbst.ceviDbId,
    emails: [selbst.email],
    vorname: teile.join(" "),
    nachname,
    geburtsdatum: null,
  };
}

export type Ziel = Awaited<ReturnType<typeof ladeAnfrage>>;

// Zuordnung und Werte; die Person der Cevi-Datenbank bleibt hier, nur die gewünschten Werte gehen weiter
export async function ermittle({
  db,
  dienst,
  person,
  anlassId,
  kindId,
}: {
  db: Db;
  dienst: CeviDbDienst | undefined;
  person: Person;
  anlassId: string;
  kindId: string | undefined;
}): Promise<
  | { fehler: "anlass" | "kind" | "kind_pflicht" | "kind_verboten" }
  | { vorschlag: Vorschlag; gefunden: string | null }
> {
  const a = await ladeAnlassFelder(db, person, anlassId);
  if (!a) return { fehler: "anlass" };
  if (a.anmeldungFuer === "kind" && kindId === undefined)
    return { fehler: "kind_pflicht" };
  if (a.anmeldungFuer === "person" && kindId !== undefined)
    return { fehler: "kind_verboten" };
  const anfrage = await ladeAnfrage(db, person, kindId);
  if (!anfrage) return { fehler: "kind" };
  if (!dienst || a.felder.length === 0)
    return { vorschlag: { status: "aus", felder: {} }, gefunden: null };

  // Schon beantwortete Felder bleiben unberührt: Wer eine Anmeldung gespeichert hat, behält seine Werte
  const [bestehend] = await db
    .select({ antworten: anlassAnmeldung.antworten })
    .from(anlassAnmeldung)
    .where(
      and(
        eq(anlassAnmeldung.anlassId, anlassId),
        kindId
          ? eq(anlassAnmeldung.kindId, kindId)
          : and(
              eq(anlassAnmeldung.userId, person.id),
              isNull(anlassAnmeldung.kindId),
            ),
        eq(anlassAnmeldung.status, "angemeldet"),
      ),
    );
  const beantwortet = (s: string) => {
    const w = bestehend?.antworten[s];
    return typeof w === "string" ? w.trim() !== "" : w !== undefined;
  };

  const personen = await dienst.personen(person.abteilungId);
  if (!personen.ok)
    return {
      vorschlag: { status: "nicht_erreichbar", felder: {} },
      gefunden: null,
    };
  const z = ordneZu(personen.personen, anfrage);
  if (z.art !== "treffer")
    return {
      vorschlag: { status: "kein_treffer", felder: {} },
      gefunden: null,
    };
  const felder: Vorschlag["felder"] = {};
  for (const f of a.felder) {
    if (beantwortet(f.schluessel)) continue;
    const wert = wertFuer(z.person, f.quelle);
    if (wert) felder[f.schluessel] = { wert, quelle: "cevi-db" };
  }
  return { vorschlag: { status: "ok", felder }, gefunden: z.person.id };
}

// Nach dem Absenden einer Anmeldung, die ein Feld aus der Cevi-Datenbank beantwortet hat (das prüft der Aufrufer): Die Nummer der eindeutig zugeordneten Person wird gemerkt, damit die nächste Zuordnung nicht mehr über E-Mail und Name läuft. Nie eine Nummer, die der Client nennt (der Server ordnet selbst zu); überschreibt nie eine gemerkte Nummer
export async function merkeNummer({
  db,
  dienst,
  person,
  kindId,
}: {
  db: Db;
  dienst: CeviDbDienst | undefined;
  person: Person;
  kindId: string | undefined;
}) {
  if (!dienst) return;
  const anfrage = await ladeAnfrage(db, person, kindId);
  if (!anfrage || anfrage.ceviDbId) return;
  const personen = await dienst.personen(person.abteilungId);
  if (!personen.ok) return;
  const z = ordneZu(personen.personen, anfrage);
  if (z.art !== "treffer") return;
  if (anfrage.ziel === "kind") {
    await db
      .update(kind)
      .set({ ceviDbId: z.person.id })
      .where(and(eq(kind.id, anfrage.zielId), isNull(kind.ceviDbId)));
  } else {
    await db
      .update(user)
      .set({ ceviDbId: z.person.id })
      .where(and(eq(user.id, anfrage.zielId), isNull(user.ceviDbId)));
  }
}

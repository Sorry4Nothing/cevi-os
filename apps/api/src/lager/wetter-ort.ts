import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { lager } from "../db/schema.js";
import { rundeOrt, waehleTreffer, type OrtSuchen } from "./wetter-geocoding.js";

// Der Ort für das Wetter kommt aus dem Lagerort (#694), nie aus einer Eingabe von Koordinaten. Der Server löst «ort» des Lagers beim Ortsdienst auf (wetter-geocoding.ts) und hält das Ergebnis am Lager: Koordinaten (auf zwei Stellen gerundet), den gefundenen Namen und den Schlüssel des Textes, für den es gilt. Ändert sich Ort oder Adresse, passt der Schlüssel nicht mehr und der Server sucht neu. Misslingt die Suche, weil der Dienst nicht antwortet, gibt es frühestens nach NEUER_ORTSVERSUCH_MINUTEN den nächsten Versuch; «nicht gefunden» und «nicht eindeutig» bleiben, bis sich der Text ändert.
export const NEUER_ORTSVERSUCH_MINUTEN = 15;

export type WetterOrtStatus =
  | "kein_ort"
  | "offen"
  | "gefunden"
  | "nicht_gefunden"
  | "mehrdeutig"
  | "nicht_erreichbar";

export type WetterOrt = { status: WetterOrtStatus; name: string | null };

export type LagerOrt = Pick<
  typeof lager.$inferSelect,
  | "id"
  | "ort"
  | "adresse"
  | "breite"
  | "laenge"
  | "wetterOrtSchluessel"
  | "wetterOrtName"
  | "wetterOrtErgebnis"
  | "wetterOrtVersuchAm"
>;

const PLZ = /(?<!\d)[1-9]\d{3}(?!\d)/;

// Was zum Ortsdienst geht: höchstens zwei Namen aus dem Feld «Ort», ohne Wörter mit Ziffern (Hausnummern, Postleitzahlen). Steht im Ort eine Postleitzahl («9999 Musterstadt, Waldweg 3»), gilt nur der Teil mit ihr; sonst der erste und der letzte Teil, getrennt durch Komma. Das Feld «Adresse» geht nie hinaus: Aus ihr liest der Server nur die Postleitzahl, die mehrere Treffer unterscheidet. Steht im Ort nur eine Postleitzahl, sucht der Dienst nach ihr
export function ortAnfrage(ort: string | null, adresse: string | null) {
  const text = ort?.trim() ?? "";
  if (text === "") return null;
  const plz = PLZ.exec(text)?.[0] ?? PLZ.exec(adresse ?? "")?.[0] ?? null;
  const teile = text.split(",");
  const mitPlz = teile.filter((t) => PLZ.test(t));
  const wahl =
    mitPlz.length > 0 ? mitPlz : [teile[0]!, teile[teile.length - 1]!];
  const namen = [
    ...new Set(
      wahl.map((teil) =>
        teil
          .split(/\s+/)
          .filter((w) => w !== "" && !/\d/.test(w))
          .join(" ")
          .slice(0, 100),
      ),
    ),
  ]
    .filter((n) => n.length >= 2)
    .slice(0, 2);
  if (namen.length === 0 && PLZ.test(text)) namen.push(PLZ.exec(text)![0]);
  return {
    namen,
    plz,
    schluessel: `${namen.join("|")}#${plz ?? ""}`.toLowerCase(),
  };
}

// Der Stand der Ortssuche, ohne Netz: nur aus den Spalten des Lagers
export function wetterOrt(z: LagerOrt): WetterOrt {
  const anfrage = ortAnfrage(z.ort, z.adresse);
  if (!anfrage) return { status: "kein_ort", name: null };
  if (z.wetterOrtSchluessel !== anfrage.schluessel) {
    return { status: "offen", name: null };
  }
  switch (z.wetterOrtErgebnis) {
    case "gefunden":
      return z.breite !== null && z.laenge !== null
        ? { status: "gefunden", name: z.wetterOrtName }
        : { status: "offen", name: null };
    case "nicht_gefunden":
    case "mehrdeutig":
      return { status: z.wetterOrtErgebnis, name: null };
    default:
      return { status: "nicht_erreichbar", name: null };
  }
}

// Muss der Server suchen? Noch nie gesucht oder der Text hat sich geändert, oder der Dienst war nicht erreichbar und der Versuch ist lange genug her
export function mussSuchen(z: LagerOrt, jetzt: Date): boolean {
  const { status } = wetterOrt(z);
  if (status === "offen") return true;
  return (
    status === "nicht_erreichbar" &&
    (z.wetterOrtVersuchAm === null ||
      jetzt.getTime() - z.wetterOrtVersuchAm.getTime() >=
        NEUER_ORTSVERSUCH_MINUTEN * 60_000)
  );
}

// Gleichzeitige Aufrufe für dasselbe Lager teilen sich eine Suche. shortcut: gilt je Prozess; bei mehreren Instanzen sucht jede einmal
const laufend = new Map<string, Promise<LagerOrt>>();

// Sucht den Ort und schreibt das Ergebnis ans Lager; gibt die neuen Werte zurück. Schreibt nur, wenn Ort und Adresse in der Datenbank noch die sind, für die gesucht wurde. Der Fehlertext bleibt aus Antwort und Protokoll (er könnte den Ort enthalten)
export function sucheWetterOrt(
  db: Pick<Db, "select" | "update">,
  z: LagerOrt,
  suchen: OrtSuchen,
  jetzt = new Date(),
): Promise<LagerOrt> {
  let lauf = laufend.get(z.id);
  if (!lauf) {
    lauf = suche(db, z, suchen, jetzt).finally(() => laufend.delete(z.id));
    laufend.set(z.id, lauf);
  }
  return lauf;
}

async function suche(
  db: Pick<Db, "select" | "update">,
  z: LagerOrt,
  suchen: OrtSuchen,
  jetzt: Date,
): Promise<LagerOrt> {
  // Ein Aufruf, der vor der Suche eines anderen las und erst danach hierher kommt, sucht nicht ein zweites Mal
  const [frisch] = await db.select().from(lager).where(eq(lager.id, z.id));
  if (frisch) {
    if (!mussSuchen(frisch, jetzt)) return frisch;
    z = frisch;
  }
  const anfrage = ortAnfrage(z.ort, z.adresse);
  const leer = {
    breite: null,
    laenge: null,
    wetterOrtSchluessel: null,
    wetterOrtName: null,
    wetterOrtErgebnis: null,
    wetterOrtVersuchAm: null,
  };
  let neu: Partial<typeof lager.$inferInsert> = leer;
  if (anfrage) {
    let ergebnis: "nicht_gefunden" | "mehrdeutig" | "fehler" = "nicht_gefunden";
    let treffer = null;
    try {
      for (const name of anfrage.namen) {
        const wahl = waehleTreffer(await suchen(name), name, anfrage.plz);
        if (wahl.art === "gefunden") {
          treffer = wahl.treffer;
          break;
        }
        if (wahl.art === "mehrdeutig") ergebnis = "mehrdeutig";
      }
    } catch {
      ergebnis = "fehler";
    }
    const gemeinsam = {
      wetterOrtSchluessel: anfrage.schluessel,
      wetterOrtVersuchAm: jetzt,
    };
    if (treffer) {
      neu = {
        ...gemeinsam,
        breite: rundeOrt(treffer.breite),
        laenge: rundeOrt(treffer.laenge),
        wetterOrtName: [treffer.name, treffer.kanton]
          .filter(Boolean)
          .join(", "),
        wetterOrtErgebnis: "gefunden",
      };
    } else {
      neu = {
        ...gemeinsam,
        breite: null,
        laenge: null,
        wetterOrtName: null,
        wetterOrtErgebnis: ergebnis,
      };
    }
  }
  await db
    .update(lager)
    .set(neu)
    .where(
      and(
        eq(lager.id, z.id),
        sql`${lager.ort} is not distinct from ${z.ort}`,
        sql`${lager.adresse} is not distinct from ${z.adresse}`,
      ),
    );
  return { ...z, ...neu } as LagerOrt;
}

import { HTTPException } from "hono/http-exception";
import type { Db } from "../db/client.js";
import { log } from "../log.js";
import type { Person } from "../rechte.js";
import { altweg } from "./alt.js";
import { istRecht } from "./katalog.js";
import { rechteModus } from "./modus.js";
import { ladeRechteSatz, type Objekt } from "./satz.js";

// Die zentrale Prüfung (#643): darf(db, person, recht, objekt?) und verlange(...). Die Auswertung steht in satz.ts (RechteSatz, eine Abfrage je Anfrage), für Listen in sql.ts (rechtSql), die alten Wege in alt.ts. Der Modus (modus.ts) bestimmt, welcher durchsetzt.
// Reihenfolge je Route bleibt: Sitzung, Pflichtwechsel, Sperre, Objekt in SQL auf die eigene Abteilung laden (fremd = 404), dann verlange() (403, danach 403 ZWEITER_FAKTOR_FEHLT), dann der Zustand (409). Fällt eine Abfrage aus, wirft die Funktion: Die Route antwortet 500, nie «erlaubt».

type Lesbar = Pick<Db, "select" | "execute">;

// 403 mit dem Code ZWEITER_FAKTOR_FEHLT; app.ts übersetzt sie in den Body der App (#423)
export class ZweiterFaktorFehlt extends HTTPException {
  constructor() {
    super(403);
  }
}

// Abweichungen zwischen altem und neuem Weg seit dem Start des Prozesses, je Recht und Richtung; für die Seite «System» und die Tests. Keine Personendaten
const abweichungen = new Map<string, number>();
export const schattenAbweichungen = () => Object.fromEntries(abweichungen);
export const schattenZuruecksetzen = () => abweichungen.clear();

function melde(
  recht: string,
  durchgesetzt: boolean,
  neu: boolean,
  objekt: Objekt | undefined,
) {
  const richtung = durchgesetzt ? "alt_ja_neu_nein" : "alt_nein_neu_ja";
  const schluessel = `${recht}:${richtung}`;
  abweichungen.set(schluessel, (abweichungen.get(schluessel) ?? 0) + 1);
  // Nur Recht, Richtung und die Art des Objekts, nie eine Person oder ein Name (SR-50)
  log(undefined, {
    ereignis: "rechte_schatten",
    recht,
    richtung,
    neu,
    objekt: objekt
      ? Object.keys(objekt).filter((k) => objekt[k as keyof Objekt] != null)
      : [],
  });
}

// Darf die Person das Recht, am Objekt (ohne Objekt: irgendwo, zum Beispiel für die Tür der Verwaltung)? Ein Recht, das der Katalog nicht kennt, gibt nie etwas.
export async function darf(
  db: Lesbar,
  person: Person,
  recht: string,
  objekt?: Objekt,
): Promise<boolean> {
  if (!istRecht(recht)) return false;
  // Zweite Sicherung nach dem 404: Ein Objekt einer fremden Abteilung gibt nie ein Recht
  if (
    objekt?.abteilungId !== undefined &&
    objekt.abteilungId !== person.abteilungId
  ) {
    return false;
  }
  const modus = rechteModus();
  if (modus === "neu") {
    return (await ladeRechteSatz(db, person)).hat(recht, objekt);
  }
  const alt = await altweg(db, person, recht, objekt ?? {});
  if (modus === "alt") return alt;
  // Schatten: Der alte Weg und, was die Rollen zusätzlich geben, setzen durch; verglichen wird mit dem neuen Weg
  const satz = await ladeRechteSatz(db, person);
  const neu = satz.hat(recht, objekt);
  // Nimmt der Entwickler der Abteilungsleitung das Recht weg (#663), gibt der alte Weg («die Abteilungsleitung darf alles») nichts mehr: Dann zählen nur die übrigen Quellen der Person, also der neue Weg
  const durchgesetzt = satz.alVerzichtet(recht)
    ? neu
    : alt || satz.ausRollen(recht, objekt);
  if (neu !== durchgesetzt) melde(recht, durchgesetzt, neu, objekt);
  return durchgesetzt;
}

// Wirft 403, wenn das Recht fehlt; danach 403 ZWEITER_FAKTOR_FEHLT, wenn es «erweitert» oder «fest» ist und die Person keinen zweiten Faktor hat (ausser der Arbeit der Stufenleitung an der eigenen Stufenseite). Die Route lädt ihr Objekt vorher (404)
export async function verlange(
  db: Lesbar,
  person: Person,
  recht: string,
  objekt?: Objekt,
): Promise<void> {
  if (!(await darf(db, person, recht, objekt))) throw new HTTPException(403);
  if (person.zweiterFaktor) return;
  const satz = await ladeRechteSatz(db, person);
  if (satz.braucht2Faktor(recht, objekt)) throw new ZweiterFaktorFehlt();
}

// Mindestens eines der Rechte, irgendwo: für die Tür einer Seite der Verwaltung, die mehrere Rechte öffnen. Löst höchstens eine Abfrage für die Rechte aus (der Satz), dazu die der alten Wege
export async function darfEines(
  db: Lesbar,
  person: Person,
  rechte: readonly string[],
  objekt?: Objekt,
): Promise<boolean> {
  for (const r of rechte) if (await darf(db, person, r, objekt)) return true;
  return false;
}

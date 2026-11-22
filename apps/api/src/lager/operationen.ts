import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { Db } from "../db/client.js";
import { lagerClientOp } from "../db/schema.js";
import type { Person } from "../rechte.js";
import { darf, type LagerZugriff } from "./policy.js";
import type { LagerRecht } from "./rechte-katalog.js";
import { LagerAntwortFehler, type Tx } from "./sync.js";

// Warteschlange für Offline-Änderungen (#367): Die App sammelt Änderungen, solange sie offline ist, und schickt sie gebündelt (POST /api/v1/lager/{id}/aenderungen). Jedes Modul meldet hier seine Operationen an, die die App so schicken darf; die Warteschlange prüft Recht und Schema und führt sie in einer eigenen Transaktion aus.
//
// Muster für ein Modul:
//   registriereOperation({
//     typ: "aufgabe.aendern",
//     recht: "aufgaben.bearbeiten",
//     schema: z.strictObject({ id: z.uuid(), version: z.number().int(), titel: z.string().max(200).optional() }),
//     fuehreAus: ({ tx, zugriff, person }, n) => aendereZeile(tx, aufgabe, { lagerId: zugriff.lager.id, personId: person.id }, { id: n.id, version: n.version, werte: { titel: n.titel }, ansicht: aufgabeAnsicht(zugriff.rolle) }).then((z) => ({ id: z.id, version: z.version })),
//   })
// Dieselbe Funktion wie die Route des Moduls: fuehreAus ruft die Logik, die auch die Route aufruft, und prüft wie sie, was nicht im Recht der Rolle steckt (Zeilenfilter, Besitzer). Es gilt die Rolle der Person im Lager, nie eine Angabe aus der Nutzlast.
// fuehreAus gibt nur IDs und Versionen zurück, keine Inhalte: Das Ergebnis liegt 30 Tage in lager_client_op, damit eine Wiederholung dasselbe Ergebnis bekommt. Wirft fuehreAus den Versionskonflikt des Sync-Kerns (409 VERSION_KONFLIKT), ist das Ergebnis «konflikt» mit dem Stand der Zeile; eine HTTPException (400, 403, 404, 409) wird zu «abgelehnt». Beides nimmt die Schreibvorgänge dieser Operation zurück und bricht die übrigen nicht ab.

export type OperationsKontext = {
  tx: Tx;
  zugriff: LagerZugriff;
  person: Person;
};

export type LagerOperation<S extends z.ZodType = z.ZodType> = {
  // Name der Operation, zum Beispiel «aufgabe.aendern»
  typ: string;
  // Das Recht, das die Rolle für diese Operation braucht (wie lagerZugriff({ recht }) an der Route)
  recht: LagerRecht;
  // Strikt: unbekannte Felder lehnt die Operation ab
  schema: S;
  // Die Ablehnungscodes dieser Operation ausser den allgemeinen (KEINE_BERECHTIGUNG, UNGUELTIGE_EINGABE, NICHT_GEFUNDEN, KONFLIKT, VERSION_KONFLIKT); die OpenAPI-Beschreibung nennt sie
  fehler?: readonly string[];
  fuehreAus: (
    kontext: OperationsKontext,
    nutzlast: z.output<S>,
  ) => Promise<Record<string, unknown>>;
};

const TYP_MUSTER = /^[a-z][a-z0-9_.]{0,63}$/;
const register = new Map<string, LagerOperation>();

export function registriereOperation<S extends z.ZodType>(
  operation: LagerOperation<S>,
) {
  if (!TYP_MUSTER.test(operation.typ)) {
    throw new Error(`Ungültiger Operationstyp ${operation.typ}`);
  }
  if (register.has(operation.typ)) {
    throw new Error(`Operation ${operation.typ} ist schon angemeldet`);
  }
  register.set(operation.typ, operation as unknown as LagerOperation);
}

export const holeOperation = (typ: string) => register.get(typ);
export const listeOperationen = () =>
  [...register.values()].sort((a, b) => a.typ.localeCompare(b.typ));

// Eine Prüfung, die die Route mit 400 und einem Code beantwortet, lehnt die Operation mit demselben Code ab
export const lehneAb = (code: string, message: string) =>
  new LagerAntwortFehler(400, { code, message });
// Nur für Tests, die ihre eigenen Operationen anmelden
export const entferneOperation = (typ: string) => register.delete(typ);

export type OperationsErgebnis =
  | { status: "ok"; ergebnis: Record<string, unknown> }
  | {
      status: "konflikt";
      code: string;
      message: string;
      aktuell?: unknown;
      abweichend?: unknown;
    }
  | { status: "abgelehnt"; code: string; message: string };

export type Operation = { clientOpId: string; typ: string; nutzlast: unknown };

const ABLEHNUNG: Record<number, { code: string; message: string }> = {
  400: { code: "UNGUELTIGE_EINGABE", message: "Ungültige Eingabe" },
  403: { code: "KEINE_BERECHTIGUNG", message: "Keine Berechtigung" },
  404: { code: "NICHT_GEFUNDEN", message: "Nicht gefunden" },
  409: { code: "KONFLIKT", message: "Die Änderung passt nicht zum Stand" },
};

const abgelehnt = (code: string, message: string): OperationsErgebnis => ({
  status: "abgelehnt",
  code,
  message,
});

type Schluessel = { lagerId: string; personId: string; clientOpId: string };
const wo = (k: Schluessel) =>
  and(
    eq(lagerClientOp.lagerId, k.lagerId),
    eq(lagerClientOp.personId, k.personId),
    eq(lagerClientOp.clientOpId, k.clientOpId),
  );

// Führt eine Operation aus. Nur ein Erfolg wird gespeichert: Eine Operation, die nichts geschrieben hat, wiederholt sich von selbst mit demselben Ergebnis (die Version steigt nur, ein Konflikt bleibt einer). Der Anspruch auf die clientOpId und die Schreibvorgänge liegen in einer Transaktion: Zwei gleichzeitige Wiederholungen schreiben nicht doppelt (die zweite wartet auf die erste und liest deren Ergebnis)
async function fuehreAus(
  db: Db,
  zugriff: LagerZugriff,
  person: Person,
  op: Operation,
  definition: LagerOperation,
  nutzlast: unknown,
): Promise<OperationsErgebnis> {
  const k = {
    lagerId: zugriff.lager.id,
    personId: person.id,
    clientOpId: op.clientOpId,
  };
  try {
    return await db.transaction(async (tx) => {
      const [anspruch] = await tx
        .insert(lagerClientOp)
        .values(k)
        .onConflictDoNothing()
        .returning({ clientOpId: lagerClientOp.clientOpId });
      if (!anspruch) {
        const [bekannt] = await tx
          .select({ ergebnis: lagerClientOp.ergebnis })
          .from(lagerClientOp)
          .where(wo(k));
        if (!bekannt?.ergebnis) throw new HTTPException(409);
        return bekannt.ergebnis as OperationsErgebnis;
      }
      const ergebnis: OperationsErgebnis = {
        status: "ok",
        ergebnis: await definition.fuehreAus({ tx, zugriff, person }, nutzlast),
      };
      await tx.update(lagerClientOp).set({ ergebnis }).where(wo(k));
      return ergebnis;
    });
  } catch (fehler) {
    if (fehler instanceof LagerAntwortFehler) {
      const { code, message, aktuell, abweichend } = fehler.body;
      return fehler.body.code === "VERSION_KONFLIKT"
        ? {
            status: "konflikt",
            code: String(code),
            message: String(message),
            aktuell,
            abweichend,
          }
        : abgelehnt(String(code), String(message));
    }
    const ablehnung =
      fehler instanceof HTTPException ? ABLEHNUNG[fehler.status] : undefined;
    // Alles andere ist ein Fehler des Servers: Die Anfrage scheitert, die App schickt sie wieder (die erledigten Operationen sind gespeichert)
    if (!ablehnung) throw fehler;
    return abgelehnt(ablehnung.code, ablehnung.message);
  }
}

// Verarbeitet die Operationen einer Anfrage nacheinander und gibt je Operation ein Ergebnis in derselben Reihenfolge zurück. Eine Abfrage für alle schon bekannten clientOpIds, danach je neue Operation eine Transaktion
export async function verarbeiteOperationen(
  db: Db,
  zugriff: LagerZugriff,
  person: Person,
  operationen: Operation[],
): Promise<(OperationsErgebnis & { clientOpId: string })[]> {
  const bekannte = await db
    .select({
      clientOpId: lagerClientOp.clientOpId,
      ergebnis: lagerClientOp.ergebnis,
    })
    .from(lagerClientOp)
    .where(
      and(
        eq(lagerClientOp.lagerId, zugriff.lager.id),
        eq(lagerClientOp.personId, person.id),
        inArray(
          lagerClientOp.clientOpId,
          operationen.map((o) => o.clientOpId),
        ),
      ),
    );
  const gespeichert = new Map(
    bekannte.map((b) => [b.clientOpId, b.ergebnis as OperationsErgebnis]),
  );

  const ergebnisse: (OperationsErgebnis & { clientOpId: string })[] = [];
  for (const op of operationen) {
    ergebnisse.push({
      clientOpId: op.clientOpId,
      ...(await verarbeite(db, zugriff, person, op, gespeichert)),
    });
  }
  return ergebnisse;
}

async function verarbeite(
  db: Db,
  zugriff: LagerZugriff,
  person: Person,
  op: Operation,
  gespeichert: Map<string, OperationsErgebnis>,
): Promise<OperationsErgebnis> {
  // Das gespeicherte Ergebnis gilt vor allem anderen, auch wenn sich Rechte seither geändert haben
  const bekannt = gespeichert.get(op.clientOpId);
  if (bekannt) return bekannt;
  const definition = holeOperation(op.typ);
  if (!definition) {
    return abgelehnt("OPERATION_UNBEKANNT", "Diese Operation gibt es nicht");
  }
  if (!darf(zugriff, definition.recht)) {
    return abgelehnt("KEINE_BERECHTIGUNG", ABLEHNUNG[403].message);
  }
  const nutzlast = definition.schema.safeParse(op.nutzlast);
  if (!nutzlast.success) {
    return abgelehnt("UNGUELTIGE_EINGABE", ABLEHNUNG[400].message);
  }
  const ergebnis = await fuehreAus(
    db,
    zugriff,
    person,
    op,
    definition,
    nutzlast.data,
  );
  // Ein Erfolg ist jetzt gespeichert; eine zweite Operation mit derselben clientOpId in dieser Anfrage bekommt ihn
  if (ergebnis.status === "ok") gespeichert.set(op.clientOpId, ergebnis);
  return ergebnis;
}

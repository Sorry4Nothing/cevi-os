import { parseArgs } from "node:util";
import { and, eq, isNull, sql } from "drizzle-orm";
import { verbindeDatenbank } from "../datenbank.js";
import { erstelleDb, type Db } from "../db/client.js";
import {
  abteilung,
  abteilungsleitungPerson,
  auditLog,
  plattformEntwickler,
  session,
  user,
} from "../db/schema.js";

// Abteilungsleitung vergeben und entziehen, der Weg für den Notfall (#730), wenn die Verwaltung nicht erreichbar ist. Im Alltag vergibt man die Abteilungsleitung über «Person ändern».
//   npm run abteilungsleitung:vergeben -w apps/api -- --benutzername <benutzername>
//   npm run abteilungsleitung:entziehen -w apps/api -- --benutzername <benutzername>
const VERWENDUNG = `Verwendung: npm run abteilungsleitung:vergeben -w apps/api -- --benutzername <benutzername>
            npm run abteilungsleitung:entziehen -w apps/api -- --benutzername <benutzername>`;

// Eigene Abbrüche mit gefahrlos druckbarer Meldung
class AbbruchFehler extends Error {}

// Die Meldung eines parseArgs-Fehlers nie ausgeben: Sie wiederholt ein positionales Argument
function leseArgumente() {
  try {
    const { values, positionals } = parseArgs({
      options: { benutzername: { type: "string" } },
      strict: true,
      allowPositionals: true,
    });
    const [aktion, ...rest] = positionals;
    // Das username-Plugin speichert kleingeschrieben
    const benutzername = values.benutzername?.trim().toLowerCase();
    if (
      rest.length > 0 ||
      !benutzername ||
      (aktion !== "vergeben" && aktion !== "entziehen")
    ) {
      return null;
    }
    return { aktion, benutzername };
  } catch {
    return null;
  }
}

// shortcut: Zählt selbst, ob die Abteilung ausser dem Ziel noch eine aktive Abteilungsleitung oder einen aktiven Entwickler hat. Teil 4 des Epics #714 (#731) baut dieselbe Regel für die Verwaltung; dann diese Funktion durch deren Hilfe ersetzen.
async function hatAndereVerwalter(
  tx: Pick<Db, "select">,
  abteilungId: string,
  zielId: string,
) {
  // Erst die Abteilungszeile sperren, dann zählen: Zwei gleichzeitige Entziehen sähen sonst beide die andere Person
  await tx
    .select({ id: abteilung.id })
    .from(abteilung)
    .where(eq(abteilung.id, abteilungId))
    .for("no key update");
  const zeilen = await tx
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.abteilungId, abteilungId),
        // banned ist nullable, «is not true» zählt auch null als aktiv
        sql`${user.banned} is not true`,
        isNull(user.deaktiviertAm),
        sql`${user.id} <> ${zielId}`,
        sql`(exists (select 1 from ${abteilungsleitungPerson} where ${abteilungsleitungPerson.userId} = ${user.id}) or exists (select 1 from ${plattformEntwickler} where ${plattformEntwickler.userId} = ${user.id}))`,
      ),
    );
  return zeilen.length > 0;
}

const argumente = leseArgumente();
if (!argumente) {
  console.error(VERWENDUNG);
  process.exitCode = 1;
} else {
  const url = process.env.DATABASE_URL;
  // Nur der Name: Die URL kann ein Passwort enthalten
  if (!url) throw new Error("Fehlende Umgebungsvariable: DATABASE_URL");
  const verbindung = verbindeDatenbank(url);
  try {
    const db = erstelleDb(verbindung);
    const { aktion, benutzername } = argumente;
    const [ziel] = await db
      .select({
        id: user.id,
        abteilungId: user.abteilungId,
        zweiterFaktor: user.twoFactorEnabled,
      })
      .from(user)
      .where(eq(user.username, benutzername));
    if (!ziel) {
      console.error(`Keine Person mit dem Benutzernamen «${benutzername}».`);
      process.exitCode = 1;
    } else {
      try {
        const geaendert = await db.transaction(async (tx) => {
          if (aktion === "entziehen" && ziel.abteilungId) {
            const [ist] = await tx
              .select({ id: abteilungsleitungPerson.userId })
              .from(abteilungsleitungPerson)
              .where(eq(abteilungsleitungPerson.userId, ziel.id));
            if (
              ist &&
              !(await hatAndereVerwalter(tx, ziel.abteilungId, ziel.id))
            ) {
              throw new AbbruchFehler(
                "Die Abteilung hätte danach weder Abteilungsleitung noch Entwickler. Vergib zuerst die Abteilungsleitung oder die Entwickler-Rolle an eine andere Person.",
              );
            }
          }
          const zeilen =
            aktion === "vergeben"
              ? await tx
                  .insert(abteilungsleitungPerson)
                  .values({ userId: ziel.id })
                  .onConflictDoNothing()
                  .returning({ id: abteilungsleitungPerson.userId })
              : await tx
                  .delete(abteilungsleitungPerson)
                  .where(eq(abteilungsleitungPerson.userId, ziel.id))
                  .returning({ id: abteilungsleitungPerson.userId });
          if (zeilen.length === 0) return false;
          // Spiegel (#720): Die Tabelle ist die Quelle, role schreibt der Übergang weiter, bis der Contract-Teil des Epics es entfernt
          await tx
            .update(user)
            .set({ role: aktion === "vergeben" ? "admin" : "user" })
            .where(eq(user.id, ziel.id));
          await tx.insert(auditLog).values({
            abteilungId: ziel.abteilungId,
            akteurId: "cli",
            aktion: `abteilungsleitung_${aktion === "vergeben" ? "vergeben" : "entzogen"}`,
            zielTyp: "person",
            zielId: ziel.id,
          });
          return true;
        });
        if (!geaendert) {
          console.error(
            aktion === "vergeben"
              ? `«${benutzername}» gehört schon zur Abteilungsleitung.`
              : `«${benutzername}» gehört nicht zur Abteilungsleitung.`,
          );
          process.exitCode = 1;
        } else if (aktion === "vergeben") {
          console.log(`«${benutzername}» gehört jetzt zur Abteilungsleitung.`);
          if (ziel.zweiterFaktor !== true) {
            // Die Abteilungsleitung braucht den zweiten Faktor in der Verwaltung: Die Person meldet sich neu an und richtet ihn dort ein (#715)
            await db.delete(session).where(eq(session.userId, ziel.id));
            console.log(
              "Hinweis: Ohne zweiten Faktor antwortet die API mit 403 ZWEITER_FAKTOR_FEHLT. Die Sitzungen der Person sind beendet; beim nächsten Login richtet sie ihn in der Verwaltung ein.",
            );
          }
        } else {
          console.log(
            `«${benutzername}» gehört nicht mehr zur Abteilungsleitung.`,
          );
        }
      } catch (fehler) {
        if (!(fehler instanceof AbbruchFehler)) throw fehler;
        console.error(fehler.message);
        process.exitCode = 1;
      }
    }
  } finally {
    await verbindung.end();
  }
}

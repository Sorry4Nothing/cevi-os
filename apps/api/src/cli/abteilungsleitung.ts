import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { verbindeDatenbank } from "../datenbank.js";
import { erstelleDb } from "../db/client.js";
import {
  abteilungsleitungPerson,
  auditLog,
  session,
  user,
} from "../db/schema.js";
import { aktiveVerwalter, istLetzterVerwalter } from "../verwalter.js";

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
            // Dieselbe Regel wie die Verwaltung (#731): Ein Entwickler dieser Person zählt weiter
            const verwalter = await aktiveVerwalter(tx, ziel.abteilungId);
            if (ist && istLetzterVerwalter(verwalter, ziel.id, true)) {
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

import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { verbindeDatenbank } from "../datenbank.js";
import { erstelleDb } from "../db/client.js";
import { auditLog, plattformEntwickler, session, user } from "../db/schema.js";

// Entwickler vergeben und entziehen (#423): nur hier, nie über eine Route oder die Oberfläche. Der Entwickler hat jedes Recht des Katalogs (plattform.ts) und braucht den zweiten Faktor; wer ihn noch nicht hat, wird bei «vergeben» abgemeldet.
//   npm run entwickler:vergeben -w apps/api -- --benutzername <benutzername>
//   npm run entwickler:entziehen -w apps/api -- --benutzername <benutzername>
const VERWENDUNG = `Verwendung: npm run entwickler:vergeben -w apps/api -- --benutzername <benutzername>
            npm run entwickler:entziehen -w apps/api -- --benutzername <benutzername>`;

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

// Wie zweiter-faktor-zuruecksetzen.ts ohne better-auth, nur mit der Datenbank
const argumente = leseArgumente();
if (!argumente) {
  console.error(VERWENDUNG);
  process.exitCode = 1;
} else {
  const url = process.env.DATABASE_URL;
  // Nur der Name: Die URL kann ein Passwort enthalten
  if (!url) throw new Error("Fehlende Umgebungsvariable: DATABASE_URL");
  const sql = verbindeDatenbank(url);
  try {
    const db = erstelleDb(sql);
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
      const geaendert = await db.transaction(async (tx) => {
        const zeilen =
          aktion === "vergeben"
            ? await tx
                .insert(plattformEntwickler)
                .values({ userId: ziel.id })
                .onConflictDoNothing()
                .returning({ id: plattformEntwickler.userId })
            : await tx
                .delete(plattformEntwickler)
                .where(eq(plattformEntwickler.userId, ziel.id))
                .returning({ id: plattformEntwickler.userId });
        if (zeilen.length === 0) return false;
        await tx.insert(auditLog).values({
          abteilungId: ziel.abteilungId,
          akteurId: "cli",
          aktion: `entwickler_${aktion === "vergeben" ? "vergeben" : "entzogen"}`,
          zielTyp: "person",
          zielId: ziel.id,
        });
        return true;
      });
      if (!geaendert) {
        console.error(
          aktion === "vergeben"
            ? `«${benutzername}» ist schon Entwickler.`
            : `«${benutzername}» ist nicht Entwickler.`,
        );
        process.exitCode = 1;
      } else if (aktion === "vergeben") {
        console.log(`«${benutzername}» ist jetzt Entwickler.`);
        if (ziel.zweiterFaktor !== true) {
          // Der Entwickler hat Rechte mit Pflicht zum zweiten Faktor: Die Person meldet sich neu an und sieht die Einrichtung in der Verwaltung (#715)
          await db.delete(session).where(eq(session.userId, ziel.id));
          console.log(
            "Hinweis: Ohne zweiten Faktor antwortet die API mit 403 ZWEITER_FAKTOR_FEHLT. Die Sitzungen der Person sind beendet; beim nächsten Login richtet sie ihn in der Verwaltung ein.",
          );
        }
      } else {
        console.log(`«${benutzername}» ist kein Entwickler mehr.`);
      }
    }
  } finally {
    await sql.end();
  }
}

import { parseArgs } from "node:util";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { erstelleAuth, platzhalterEmail } from "../auth.js";
import { verbindeDatenbank } from "../datenbank.js";
import { erstelleDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { ladeKonfiguration } from "../konfiguration.js";
import { legeWebmasterAn } from "../plattform.js";
import {
  erzeugeStartpasswort,
  normalisiereStartpasswort,
  startpasswortFelder,
} from "../startpasswort.js";

// Konto anlegen (#730): Die Rolle ist Pflicht und steht nie als Vorgabe da, damit ein Tippfehler kein Recht vergibt. «admin:anlegen» ruft diese Datei mit --rolle abteilungsleitung auf.
const ROLLEN = ["abteilungsleitung", "entwickler", "keine"] as const;
type Rolle = (typeof ROLLEN)[number];
const ROLLENNAME: Record<Rolle, string> = {
  abteilungsleitung: "Abteilungsleitung",
  entwickler: "Entwickler",
  keine: "Konto",
};

const VERWENDUNG = `Verwendung: npm run konto:anlegen -w apps/api -- --benutzername <benutzername> --name "<Vorname Nachname>" [--cevi-name <Name>] (--abteilung <Name> | --neue-abteilung <Name>) --rolle <abteilungsleitung|entwickler|keine>
--abteilung nimmt eine bestehende Abteilung, --neue-abteilung legt eine an; genau eine der beiden Angaben.
--rolle ist Pflicht; «keine» legt ein Konto ohne besondere Rolle an.
Das Startpasswort erzeugt die CLI selbst und nimmt keines entgegen.`;

// Eigene Abbrüche mit gefahrlos druckbarer Meldung; fremde Meldungen könnten Eingaben oder Hosts wiederholen
class AbbruchFehler extends Error {}

// Die Meldung eines parseArgs-Fehlers nie ausgeben: Sie wiederholt ein positionales Argument, womöglich ein getipptes Passwort
function leseArgumente() {
  try {
    const { values } = parseArgs({
      options: {
        benutzername: { type: "string" },
        name: { type: "string" },
        "cevi-name": { type: "string" },
        abteilung: { type: "string" },
        "neue-abteilung": { type: "string" },
        rolle: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    });
    const benutzername = values.benutzername?.trim();
    const name = values.name?.trim();
    const ceviName = values["cevi-name"]?.trim() || undefined;
    if (ceviName && ceviName.length > 50) return null;
    const neu = values["neue-abteilung"] !== undefined;
    if (neu === (values.abteilung !== undefined)) return null;
    const abteilungsname = (
      values.abteilung ?? values["neue-abteilung"]
    )?.trim();
    const rolle = ROLLEN.find((r) => r === values.rolle);
    if (!benutzername || !name || !abteilungsname || !rolle) return null;
    return { benutzername, name, ceviName, neu, abteilungsname, rolle };
  } catch {
    return null;
  }
}

function beschreibe(fehler: unknown) {
  if (fehler instanceof AbbruchFehler) return fehler.message;
  if (fehler instanceof APIError) {
    return [fehler.body?.code ?? fehler.status, fehler.body?.message]
      .filter(Boolean)
      .join(" ");
  }
  // Nur Code oder Name: postgres-js nennt Host, Port und Werte in der Meldung
  const { code, name } = fehler as { code?: unknown; name?: unknown };
  return String(code ?? name);
}

const argumente = leseArgumente();
if (!argumente) {
  console.error(VERWENDUNG);
  process.exitCode = 1;
} else {
  // Wie server.ts: ohne gültige Konfiguration endet der Prozess hier mit Status 1
  const konfiguration = ladeKonfiguration(process.env);
  const sql = verbindeDatenbank(konfiguration.DATABASE_URL);
  try {
    const db = erstelleDb(sql);
    const { benutzername, name, ceviName, neu, abteilungsname, rolle } =
      argumente;
    // Eine Transaktion für alle Schreibzugriffe: createUser legt den User vor der HIBP-Prüfung an, ein Fehlschlag dort liesse sonst ein Konto ohne Passwort zurück
    const ergebnis = await db.transaction(async (tx) => {
      // Das username-Plugin speichert kleingeschrieben; ohne diese Prüfung bliebe von einem doppelten Namen nur ein Datenbankcode
      const [vergeben] = await tx
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.username, benutzername.toLowerCase()));
      if (vergeben) {
        throw new AbbruchFehler(
          `Benutzername «${benutzername}» ist schon vergeben.`,
        );
      }
      let abteilungId: string;
      if (neu) {
        const vorhandene = await tx
          .select({ id: schema.abteilung.id })
          .from(schema.abteilung)
          .where(eq(schema.abteilung.name, abteilungsname));
        if (vorhandene.length > 0) {
          throw new AbbruchFehler(
            `Abteilung «${abteilungsname}» gibt es schon.`,
          );
        }
        const [angelegt] = await tx
          .insert(schema.abteilung)
          .values({ name: abteilungsname })
          .returning({ id: schema.abteilung.id });
        abteilungId = angelegt.id;
        // Die Vorgabe jeder Abteilung (#423); bestehende Abteilungen bekamen sie mit Migration 0100
        await legeWebmasterAn(tx, abteilungId);
      } else {
        const zeilen = await tx
          .select({ id: schema.abteilung.id })
          .from(schema.abteilung)
          .where(eq(schema.abteilung.name, abteilungsname));
        if (zeilen.length !== 1) {
          throw new AbbruchFehler(
            `Keine eindeutige Abteilung «${abteilungsname}».`,
          );
        }
        abteilungId = zeilen[0].id;
      }
      const auth = erstelleAuth(
        drizzleAdapter(tx, { provider: "pg", schema, transaction: true }),
      );
      const startpasswort = erzeugeStartpasswort();
      // Ohne Header prüft createUser keine Rechte; genau das braucht die CLI, die kein Konto hat
      const { user } = await auth.api.createUser({
        body: {
          email: platzhalterEmail(),
          password: normalisiereStartpasswort(startpasswort),
          name,
          // Spiegel (#720): Die Zuordnung steht in abteilungsleitung_person, role schreibt weiter als Spiegel bis Teil 10 (Epic #714)
          role: rolle === "abteilungsleitung" ? "admin" : "user",
          data: {
            username: benutzername,
            ceviName,
            abteilungId,
            ...startpasswortFelder(new Date(), startpasswort),
          },
        },
      });
      if (rolle === "abteilungsleitung") {
        await tx
          .insert(schema.abteilungsleitungPerson)
          .values({ userId: user.id });
      } else if (rolle === "entwickler") {
        await tx.insert(schema.plattformEntwickler).values({ userId: user.id });
      }
      await tx.insert(schema.auditLog).values({
        abteilungId,
        akteurId: "cli",
        aktion: "person_angelegt",
        zielTyp: "person",
        zielId: user.id,
        details: { rolle },
      });
      if (rolle === "entwickler") {
        // Wie entwickler.ts: Das Vergeben steht für sich im Protokoll
        await tx.insert(schema.auditLog).values({
          abteilungId,
          akteurId: "cli",
          aktion: "entwickler_vergeben",
          zielTyp: "person",
          zielId: user.id,
        });
      }
      // Zur Laufzeit vorhanden; der Typ UserWithRole kennt das Feld des username-Plugins nicht
      return {
        gespeichert: (user as { username?: string }).username,
        startpasswort,
      };
    });
    // stdout erst nach dem Commit: Ein zurückgenommenes Startpasswort darf nie gedruckt sein
    if (neu) console.log(`Abteilung «${abteilungsname}» angelegt.`);
    console.log(`${ROLLENNAME[rolle]} «${ergebnis.gespeichert}» angelegt.`);
    console.log(`Startpasswort: ${ergebnis.startpasswort}`);
    console.log(
      "Nicht weiterleiten. Gilt 7 Tage und nur für die erste Anmeldung.",
    );
    if (rolle !== "keine") {
      console.log(
        "Die Rolle braucht in der Verwaltung den zweiten Faktor; die Person richtet ihn nach der ersten Anmeldung ein.",
      );
    }
  } catch (fehler) {
    console.error(`Konto nicht angelegt: ${beschreibe(fehler)}`);
    process.exitCode = 1;
  } finally {
    // Kein process.exit(): offene Verbindungen zeigten sich in Tests nur als Timeout
    await sql.end();
  }
}

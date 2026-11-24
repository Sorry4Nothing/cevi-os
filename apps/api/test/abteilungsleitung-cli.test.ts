import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, test, vi } from "vitest";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";

bereiteAuthTestsVor();
// Mehrere CLI-Starts je Test (je bis 60 s unter Last)
vi.setConfig({ testTimeout: 180_000 });

const db = erstelleDb(postgres(API_URL));
const auth = erstelleTestAuth(db);
afterAll(() => db.$client.end());

const starte = (...argumente: string[]) =>
  spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli/abteilungsleitung.ts", ...argumente],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DATABASE_URL: API_URL },
      encoding: "utf8",
      timeout: 60_000,
    },
  );

// Jeder Test hat eine eigene Abteilung: Die Regel «mindestens eine bleibt» zählt je Abteilung
async function neueAbteilung() {
  const [zeile] = await db
    .insert(schema.abteilung)
    .values({ name: `Testabteilung ALCLI ${randomUUID()}` })
    .returning();
  return zeile.id;
}

// Rolle «user» ohne Zeile in der Tabelle; die Tests setzen die Rolle selbst
async function neuesKonto(abteilungId: string) {
  const benutzername = `alcli.${randomUUID().slice(0, 8)}`;
  const { user } = await auth.api.createUser({
    body: {
      email: `${randomUUID()}@example.org`,
      password: "Ein-sehr-langes-Testpasswort-1",
      name: "Testperson ALCLI",
      role: "user",
      data: { username: benutzername, abteilungId, mussPasswortAendern: false },
    },
  });
  return { id: user.id, benutzername };
}

const alZeile = async (userId: string) =>
  db
    .select()
    .from(schema.abteilungsleitungPerson)
    .where(eq(schema.abteilungsleitungPerson.userId, userId));
const rolleVon = async (userId: string) =>
  (
    await db
      .select({ role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
  )[0].role;
const auditVon = (userId: string, aktion: string) =>
  db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.zielId, userId),
        eq(schema.auditLog.aktion, aktion),
      ),
    );
// Die Kommandozeile hat dasselbe Ergebnis wie die Verwaltung: Tabelle und Spiegel
const macheAl = async (konto: { id: string }) => {
  await db.insert(schema.abteilungsleitungPerson).values({ userId: konto.id });
  await db
    .update(schema.user)
    .set({ role: "admin" })
    .where(eq(schema.user.id, konto.id));
};

describe("Kommandozeile: Abteilungsleitung vergeben und entziehen", () => {
  test("vergeben schreibt Tabelle, Spiegel und Audit, beendet Sitzungen ohne zweiten Faktor, doppelt scheitert", async () => {
    const konto = await neuesKonto(await neueAbteilung());
    await db.insert(schema.session).values({
      id: randomUUID(),
      userId: konto.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
      updatedAt: new Date(),
    });

    const ergebnis = starte(
      "vergeben",
      "--benutzername",
      konto.benutzername.toUpperCase(),
    );
    expect(ergebnis.status, ergebnis.stderr).toBe(0);
    expect(ergebnis.stdout).toContain("gehört jetzt zur Abteilungsleitung");
    expect(ergebnis.stdout).toContain("ZWEITER_FAKTOR_FEHLT");
    expect(await alZeile(konto.id)).toHaveLength(1);
    expect(await rolleVon(konto.id)).toBe("admin");
    const audit = await auditVon(konto.id, "abteilungsleitung_vergeben");
    expect(audit).toHaveLength(1);
    expect(audit[0].akteurId).toBe("cli");
    const sitzungen = await db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, konto.id));
    expect(sitzungen).toHaveLength(0);

    const nochmal = starte("vergeben", "--benutzername", konto.benutzername);
    expect(nochmal.status).toBe(1);
    expect(nochmal.stderr).toContain("gehört schon zur Abteilungsleitung");
    expect(await auditVon(konto.id, "abteilungsleitung_vergeben")).toHaveLength(
      1,
    );
  });

  test("entziehen mit einer zweiten Abteilungsleitung klappt; ohne Zeile scheitert es", async () => {
    const abteilungId = await neueAbteilung();
    const eins = await neuesKonto(abteilungId);
    const zwei = await neuesKonto(abteilungId);
    await macheAl(eins);
    await macheAl(zwei);

    const ergebnis = starte("entziehen", "--benutzername", eins.benutzername);
    expect(ergebnis.status, ergebnis.stderr).toBe(0);
    expect(await alZeile(eins.id)).toHaveLength(0);
    expect(await rolleVon(eins.id)).toBe("user");
    const audit = await auditVon(eins.id, "abteilungsleitung_entzogen");
    expect(audit).toHaveLength(1);
    expect(audit[0].akteurId).toBe("cli");
    expect(await alZeile(zwei.id)).toHaveLength(1);

    const nochmal = starte("entziehen", "--benutzername", eins.benutzername);
    expect(nochmal.status).toBe(1);
    expect(nochmal.stderr).toContain("gehört nicht zur Abteilungsleitung");
  });

  test("die letzte Abteilungsleitung lässt sich nicht entziehen", async () => {
    const abteilungId = await neueAbteilung();
    const konto = await neuesKonto(abteilungId);
    await macheAl(konto);

    const ergebnis = starte("entziehen", "--benutzername", konto.benutzername);
    expect(ergebnis.status).toBe(1);
    expect(ergebnis.stderr).toContain(
      "weder Abteilungsleitung noch Entwickler",
    );
    expect(await alZeile(konto.id)).toHaveLength(1);
    expect(await rolleVon(konto.id)).toBe("admin");
    expect(await auditVon(konto.id, "abteilungsleitung_entzogen")).toHaveLength(
      0,
    );
  });

  test("Abteilungsleitung einer anderen Abteilung, gesperrte und deaktivierte Konten zählen nicht", async () => {
    const abteilungId = await neueAbteilung();
    const ziel = await neuesKonto(abteilungId);
    const fremd = await neuesKonto(await neueAbteilung());
    const gesperrt = await neuesKonto(abteilungId);
    const deaktiviert = await neuesKonto(abteilungId);
    for (const k of [ziel, fremd, gesperrt, deaktiviert]) await macheAl(k);
    await db
      .update(schema.user)
      .set({ banned: true })
      .where(eq(schema.user.id, gesperrt.id));
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date() })
      .where(eq(schema.user.id, deaktiviert.id));

    const ergebnis = starte("entziehen", "--benutzername", ziel.benutzername);
    expect(ergebnis.status).toBe(1);
    expect(await alZeile(ziel.id)).toHaveLength(1);
  });

  test("mit einem aktiven Entwickler in der Abteilung ist das Entziehen der letzten Abteilungsleitung erlaubt", async () => {
    const abteilungId = await neueAbteilung();
    const al = await neuesKonto(abteilungId);
    const entwickler = await neuesKonto(abteilungId);
    await macheAl(al);
    await db
      .insert(schema.plattformEntwickler)
      .values({ userId: entwickler.id });

    const ergebnis = starte("entziehen", "--benutzername", al.benutzername);
    expect(ergebnis.status, ergebnis.stderr).toBe(0);
    expect(await alZeile(al.id)).toHaveLength(0);
    expect(await rolleVon(al.id)).toBe("user");
  });

  test("unbekannte Person, fehlende und falsche Argumente", async () => {
    const konto = await neuesKonto(await neueAbteilung());
    const unbekannt = starte("vergeben", "--benutzername", "gibt.es.nicht");
    expect(unbekannt.status).toBe(1);
    expect(unbekannt.stderr).toContain("Keine Person");
    for (const argumente of [
      ["vergeben"],
      ["loeschen", "--benutzername", konto.benutzername],
      ["vergeben", "--benutzername", konto.benutzername, "--abteilung", "x"],
      ["vergeben", "geheim", "--benutzername", konto.benutzername],
    ]) {
      const ergebnis = starte(...argumente);
      expect(ergebnis.status, argumente.join(" ")).toBe(1);
      expect(ergebnis.stderr).toContain("Verwendung:");
      expect(ergebnis.stdout + ergebnis.stderr).not.toContain("geheim");
    }
    expect(await alZeile(konto.id)).toHaveLength(0);
  });
});

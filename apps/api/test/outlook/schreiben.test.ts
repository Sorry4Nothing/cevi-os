import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { ordneTagsZu } from "../../src/kalender/tags-zuordnen.js";
import { speichereVerbindung, type OutlookDienst } from "../../src/outlook/dienst.js";
import { FEHLER } from "../../src/outlook/fehler.js";
import { gleicheKategorienAb } from "../../src/outlook/kategorien-abgleich.js";
import { verarbeiteOutlook } from "../../src/outlook/lauf.js";
import {
  setzeTerminTags,
  TerminFehlt,
} from "../../src/outlook/termin-tags.js";
import { API_URL } from "../hilfen/datenbank.js";
import { Attrappe, ausfall } from "./attrappe.js";

// Kategorienliste und Termin-Kategorien gegen die Attrappe von Outlook (kein Netz) und die echte Testdatenbank (#835)
process.env.BETTER_AUTH_SECRET = "t".repeat(40);
const sql = postgres(API_URL, { connection: { TimeZone: "UTC" } });
const db = erstelleDb(sql);
afterAll(() => sql.end());

let abteilungId: string;
let outlook: Attrappe;
const dienst = (): OutlookDienst => ({ fuer: async () => outlook });

const tagAnlegen = async (name: string, typ = "stufe") =>
  (
    await db
      .insert(schema.tag)
      .values({ abteilungId, typ: typ as "stufe", name, kuerzel: "K" })
      .returning({ id: schema.tag.id })
  )[0].id;
const terminAnlegen = async (uid: string, serie: string | null = null) =>
  (
    await db
      .insert(schema.programm)
      .values({
        abteilungId,
        googleEventId: uid,
        googleSerie: serie,
        titel: "Programm",
        ganztaegig: false,
        beginn: new Date("2027-09-04T12:00:00Z"),
        ende: new Date("2027-09-04T14:00:00Z"),
      })
      .returning({ id: schema.programm.id })
  )[0].id;
const tagsVon = async (programmId: string) =>
  (
    await db
      .select({ name: schema.tag.name })
      .from(schema.programmTag)
      .innerJoin(schema.tag, eq(schema.tag.id, schema.programmTag.tagId))
      .where(eq(schema.programmTag.programmId, programmId))
  )
    .map((z) => z.name)
    .sort();
const zeile = async (programmId: string) =>
  (
    await db
      .select()
      .from(schema.outlookAenderung)
      .where(eq(schema.outlookAenderung.programmId, programmId))
  )[0];

beforeAll(async () => {
  // Gleicher Abteilungsname je Lauf egal: Jeder Test legt seine eigene an
});
beforeEach(async () => {
  abteilungId = (
    await db
      .insert(schema.abteilung)
      .values({ name: `Outlook-Test ${randomUUID().slice(0, 8)}` })
      .returning({ id: schema.abteilung.id })
  )[0].id;
  outlook = new Attrappe();
});

describe("Kategorienliste des Postfachs", () => {
  test("legt fehlende Kategorien an, ist idempotent und lässt fremde Kategorien in Ruhe", async () => {
    await tagAnlegen("Biber");
    await tagAnlegen("Küche", "team");
    await tagAnlegen("Mit,Komma", "funktion");
    outlook.kategorien.push(
      { id: "f1", name: "Fremd", farbe: "preset0" },
      { id: "f2", name: "küche", farbe: "preset0" },
    );
    const e = await gleicheKategorienAb(db, outlook, abteilungId, "cli");
    expect(e).toEqual({ angelegt: 1, entfernt: 0, uebersprungen: 1 });
    expect(outlook.kategorien.map((k) => k.name).sort()).toEqual([
      "Biber",
      "Fremd",
      "küche",
    ]);
    expect(outlook.kategorien.find((k) => k.name === "Biber")!.farbe).toBe(
      "preset4",
    );
    // Zweiter Lauf: nichts mehr zu tun, kein Schreibzugriff
    outlook.aufrufe = [];
    expect(await gleicheKategorienAb(db, outlook, abteilungId, "cli")).toEqual({
      angelegt: 0,
      entfernt: 0,
      uebersprungen: 1,
    });
    expect(outlook.aufrufe).toEqual(["liste"]);
  });

  test("Umbenennen: der neue Name entsteht, der alte, selbst angelegte verschwindet; Löschen räumt nur Eigenes weg", async () => {
    const biber = await tagAnlegen("Biber");
    const kueche = await tagAnlegen("Küche", "team");
    outlook.kategorien.push({ id: "f1", name: "Küche", farbe: "preset0" });
    await gleicheKategorienAb(db, outlook, abteilungId, "cli");
    await db.update(schema.tag).set({ name: "Wiesel" }).where(eq(schema.tag.id, biber));
    await db.delete(schema.tag).where(eq(schema.tag.id, kueche));
    const e = await gleicheKategorienAb(db, outlook, abteilungId, "cli");
    expect(e).toMatchObject({ angelegt: 1, entfernt: 1 });
    // «Küche» gehört nicht Cevi OS: bleibt, auch ohne Tag
    expect(outlook.kategorien.map((k) => k.name).sort()).toEqual([
      "Küche",
      "Wiesel",
    ]);
  });

  test("eine inzwischen anders angelegte Kategorie gleichen Namens wird nicht gelöscht", async () => {
    const tag = await tagAnlegen("Biber");
    await gleicheKategorienAb(db, outlook, abteilungId, "cli");
    outlook.kategorien = [{ id: "andere-id", name: "Biber", farbe: "preset0" }];
    await db.delete(schema.tag).where(eq(schema.tag.id, tag));
    const e = await gleicheKategorienAb(db, outlook, abteilungId, "cli");
    expect(e.entfernt).toBe(0);
    expect(outlook.kategorien).toHaveLength(1);
  });

  test("Teilausfall: Was gelang, bleibt; der nächste Lauf macht nur den Rest; der Audit-Eintrag zählt nur Zahlen", async () => {
    await tagAnlegen("Eins");
    await tagAnlegen("Zwei");
    const original = outlook.legeKategorieAn.bind(outlook);
    let n = 0;
    outlook.legeKategorieAn = async (name, farbe) => {
      if (++n === 2) throw ausfall("SERVER");
      return original(name, farbe);
    };
    await expect(
      gleicheKategorienAb(db, outlook, abteilungId, "cli"),
    ).rejects.toMatchObject({ code: FEHLER.SERVER });
    expect(outlook.kategorien).toHaveLength(1);
    const e = await gleicheKategorienAb(db, outlook, abteilungId, "cli");
    expect(e.angelegt).toBe(1);
    expect(outlook.kategorien).toHaveLength(2);
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.abteilungId, abteilungId),
          eq(schema.auditLog.aktion, "outlook_kategorien_geschrieben"),
        ),
      );
    expect(audit.map((a) => a.details)).toEqual([
      { angelegt: 1, entfernt: 0 },
      { angelegt: 1, entfernt: 0 },
    ]);
    expect(JSON.stringify(audit)).not.toContain("Eins");
  });
});

describe("Tags eines Termins", () => {
  test("Schalter aus (kein Dienst): lokal gespeichert, Stand «aus», keine Markierung", async () => {
    const biber = await tagAnlegen("Biber");
    const p = await terminAnlegen("uid-1");
    const stand = await setzeTerminTags(db, undefined, {
      abteilungId,
      akteurId: "system",
      terminIds: [p],
      tagIds: [biber],
    });
    expect(stand.get(p)).toBe("aus");
    expect(await tagsVon(p)).toEqual(["Biber"]);
    expect(await zeile(p)).toBeUndefined();
  });

  test("verbunden: schreibt nur die Differenz in die Kategorien des einen Termins und lässt fremde stehen", async () => {
    const biber = await tagAnlegen("Biber");
    const wolf = await tagAnlegen("Wölfe");
    const p = await terminAnlegen("uid-1");
    outlook.termine.set("uid-1", { id: "ev1", kategorien: ["Fremd", "Biber"] });
    const stand = await setzeTerminTags(db, dienst(), {
      abteilungId,
      akteurId: "system",
      terminIds: [p],
      tagIds: [wolf],
    });
    expect(stand.get(p)).toBe("geschrieben");
    expect(outlook.termine.get("uid-1")!.kategorien).toEqual(["Fremd", "Wölfe"]);
    expect(await tagsVon(p)).toEqual(["Wölfe"]);
    expect((await zeile(p))!.geschriebenAm).not.toBeNull();
    // Nochmals dasselbe: Es gibt nichts zu schreiben
    outlook.aufrufe = [];
    await setzeTerminTags(db, dienst(), {
      abteilungId,
      akteurId: "system",
      terminIds: [p],
      tagIds: [wolf],
    });
    expect(outlook.aufrufe).toEqual(["finde"]);
    void biber;
  });

  test("Ausfall: Cevi OS speichert trotzdem, der Termin gilt als ausstehend, der Lauf holt es nach (mit Backoff)", async () => {
    const wolf = await tagAnlegen("Wölfe");
    const p = await terminAnlegen("uid-1");
    outlook.termine.set("uid-1", { id: "ev1", kategorien: ["Fremd"] });
    outlook.schreibAusfall = ausfall("SERVER");
    const stand = await setzeTerminTags(db, dienst(), {
      abteilungId,
      akteurId: "system",
      terminIds: [p],
      tagIds: [wolf],
    });
    expect(stand.get(p)).toBe("ausstehend");
    expect(await tagsVon(p)).toEqual(["Wölfe"]);
    const z = await zeile(p);
    expect(z).toMatchObject({
      geschriebenAm: null,
      versuche: 1,
      letzterFehler: "SERVER",
    });
    expect(z!.naechsterVersuch.getTime()).toBeGreaterThan(Date.now());

    await speichereVerbindung(db, abteilungId, "refresh");
    await db
      .update(schema.outlookVerbindung)
      .set({ kategorienOffen: false })
      .where(eq(schema.outlookVerbindung.abteilungId, abteilungId));
    // Zu früh: nichts geschieht
    outlook.schreibAusfall = null;
    await verarbeiteOutlook(db, dienst(), new Date());
    expect(outlook.termine.get("uid-1")!.kategorien).toEqual(["Fremd"]);
    // Nach der Wartezeit
    await verarbeiteOutlook(db, dienst(), new Date(Date.now() + 5 * 60_000));
    expect(outlook.termine.get("uid-1")!.kategorien).toEqual(["Fremd", "Wölfe"]);
    expect((await zeile(p))!.geschriebenAm).not.toBeNull();
  });

  test("Drosselung mit langem Retry-After: der nächste Versuch kommt nicht früher", async () => {
    const wolf = await tagAnlegen("Wölfe");
    const p = await terminAnlegen("uid-1");
    outlook.termine.set("uid-1", { id: "ev1", kategorien: [] });
    const f = ausfall("ZU_VIELE_ANFRAGEN");
    f.wartenSek = 3600;
    outlook.schreibAusfall = f;
    await setzeTerminTags(db, dienst(), {
      abteilungId,
      akteurId: "system",
      terminIds: [p],
      tagIds: [wolf],
    });
    expect((await zeile(p))!.naechsterVersuch.getTime()).toBeGreaterThan(
      Date.now() + 3_500_000,
    );
  });

  test("ein Termin, den es in Outlook nicht gibt: dauerhaft, die Markierung fällt weg, die lokale Änderung bleibt", async () => {
    const wolf = await tagAnlegen("Wölfe");
    const p = await terminAnlegen("uid-fehlt");
    const stand = await setzeTerminTags(db, dienst(), {
      abteilungId,
      akteurId: "system",
      terminIds: [p],
      tagIds: [wolf],
    });
    expect(stand.get(p)).toBe("ausstehend");
    expect(await zeile(p)).toBeUndefined();
    expect(await tagsVon(p)).toEqual(["Wölfe"]);
  });

  test("Termin einer Serie: die Instanz wird über Serie und Beginn gefunden", async () => {
    const wolf = await tagAnlegen("Wölfe");
    const p = await terminAnlegen("serie_20270904T120000Z", "serie");
    const beginn = new Date("2027-09-04T12:00:00Z").getTime();
    outlook.termine.set(`serie|${beginn}`, { id: "inst1", kategorien: [] });
    await setzeTerminTags(db, dienst(), {
      abteilungId,
      akteurId: "system",
      terminIds: [p],
      tagIds: [wolf],
    });
    expect(outlook.termine.get(`serie|${beginn}`)!.kategorien).toEqual(["Wölfe"]);
  });

  test("Sammelaktion: lokal für alle, Outlook beim Lauf; ein fremder Termin lässt alles unberührt", async () => {
    const wolf = await tagAnlegen("Wölfe");
    const ids = [
      await terminAnlegen("u1"),
      await terminAnlegen("u2"),
      await terminAnlegen("u3"),
    ];
    for (const u of ["u1", "u2", "u3"]) {
      outlook.termine.set(u, { id: `ev-${u}`, kategorien: [] });
    }
    const stand = await setzeTerminTags(db, dienst(), {
      abteilungId,
      akteurId: "system",
      terminIds: ids,
      tagIds: [wolf],
    });
    expect([...stand.values()]).toEqual(["ausstehend", "ausstehend", "ausstehend"]);
    await speichereVerbindung(db, abteilungId, "refresh");
    await db
      .update(schema.outlookVerbindung)
      .set({ kategorienOffen: false })
      .where(eq(schema.outlookVerbindung.abteilungId, abteilungId));
    await verarbeiteOutlook(db, dienst(), new Date(Date.now() + 1000));
    for (const u of ["u1", "u2", "u3"]) {
      expect(outlook.termine.get(u)!.kategorien).toEqual(["Wölfe"]);
    }

    const fremdeAbteilung = (
      await db
        .insert(schema.abteilung)
        .values({ name: "Fremd" })
        .returning({ id: schema.abteilung.id })
    )[0].id;
    await expect(
      setzeTerminTags(db, dienst(), {
        abteilungId: fremdeAbteilung,
        akteurId: "system",
        terminIds: [ids[0]],
        tagIds: [],
      }),
    ).rejects.toBeInstanceOf(TerminFehlt);
    expect(await tagsVon(ids[0])).toEqual(["Wölfe"]);
  });

  test("Audit: wer und wie viele Tags, nie Titel oder Namen", async () => {
    const wolf = await tagAnlegen("Wölfe");
    const p = await terminAnlegen("uid-1");
    await setzeTerminTags(db, undefined, {
      abteilungId,
      akteurId: "person-1",
      terminIds: [p],
      tagIds: [wolf],
    });
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, p));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      akteurId: "person-1",
      aktion: "termin_tags_geaendert",
      details: { tags: 1, outlook: false },
    });
  });
});

describe("Wettlauf mit dem Lese-Abgleich", () => {
  // Der Abgleich liest den Feed (hier: die Kategorien) und rechnet die Tags neu
  const abgleich = (p: string, kategorien: string[]) =>
    db.transaction((tx) =>
      ordneTagsZu(tx, abteilungId, [{ id: p, kategorien }]),
    );

  test("geändert in Cevi OS, dann Abgleich mit den noch alten Kategorien vor dem Nachschreiben: die Änderung bleibt; mit dem bestätigten Stand endet der Schutz", async () => {
    await tagAnlegen("Biber");
    const wolf = await tagAnlegen("Wölfe");
    const p = await terminAnlegen("uid-1");
    // Ausgangslage: Termin trägt Biber, so wie der Feed es zeigt
    await abgleich(p, ["Biber"]);
    expect(await tagsVon(p)).toEqual(["Biber"]);
    // Änderung in Cevi OS, Outlook ist gerade nicht erreichbar
    outlook.termine.set("uid-1", { id: "ev1", kategorien: ["Biber"] });
    outlook.ausfall = ausfall("NICHT_ERREICHBAR");
    await setzeTerminTags(db, dienst(), {
      abteilungId,
      akteurId: "system",
      terminIds: [p],
      tagIds: [wolf],
    });
    expect(await tagsVon(p)).toEqual(["Wölfe"]);
    // Abgleich VOR dem Nachschreiben: Der Feed zeigt noch «Biber»; Cevi OS' Änderung darf nicht überschrieben werden
    await abgleich(p, ["Biber"]);
    expect(await tagsVon(p)).toEqual(["Wölfe"]);
    expect(await zeile(p)).toBeDefined();
    // Nachgeschrieben, der Feed hinkt noch: Der Schutz bleibt
    outlook.ausfall = null;
    await db
      .update(schema.outlookAenderung)
      .set({ naechsterVersuch: new Date(0) })
      .where(eq(schema.outlookAenderung.programmId, p));
    await speichereVerbindung(db, abteilungId, "refresh");
    await db
      .update(schema.outlookVerbindung)
      .set({ kategorienOffen: false })
      .where(eq(schema.outlookVerbindung.abteilungId, abteilungId));
    await verarbeiteOutlook(db, dienst());
    expect(outlook.termine.get("uid-1")!.kategorien).toEqual(["Wölfe"]);
    await abgleich(p, ["Biber"]);
    expect(await tagsVon(p)).toEqual(["Wölfe"]);
    // Der Feed zeigt die Änderung: bestätigt, der Schutz endet
    await abgleich(p, ["Wölfe"]);
    expect(await tagsVon(p)).toEqual(["Wölfe"]);
    expect(await zeile(p)).toBeUndefined();
    // Danach gewinnt wieder Outlook
    await abgleich(p, ["Biber"]);
    expect(await tagsVon(p)).toEqual(["Biber"]);
  });

  test("nach 24 Stunden ohne Bestätigung endet der Schutz: Outlook gewinnt", async () => {
    await tagAnlegen("Biber");
    const wolf = await tagAnlegen("Wölfe");
    const p = await terminAnlegen("uid-1");
    await setzeTerminTags(db, dienst(), {
      abteilungId,
      akteurId: "system",
      terminIds: [p],
      tagIds: [wolf],
    });
    await db
      .update(schema.outlookAenderung)
      .set({ geaendertAm: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(schema.outlookAenderung.programmId, p));
    await abgleich(p, ["Biber"]);
    expect(await tagsVon(p)).toEqual(["Biber"]);
    expect(await zeile(p)).toBeUndefined();
  });

  test("alle Tags entfernt: Der Abgleich mit der alten Kategorie stellt sie nicht wieder her", async () => {
    await tagAnlegen("Biber");
    const p = await terminAnlegen("uid-1");
    await abgleich(p, ["Biber"]);
    outlook.termine.set("uid-1", { id: "ev1", kategorien: ["Biber"] });
    outlook.ausfall = ausfall("NICHT_ERREICHBAR");
    await setzeTerminTags(db, dienst(), {
      abteilungId,
      akteurId: "system",
      terminIds: [p],
      tagIds: [],
    });
    await abgleich(p, ["Biber"]);
    expect(await tagsVon(p)).toEqual([]);
  });
});

import { and, asc, count, desc, eq, like } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { keinKindKonto } from "../../kind-konto.js";
import {
  auditLog,
  lager,
  lagerMitglied,
  medium,
  profilbild,
  user,
} from "../../db/schema.js";
import { bildUrl } from "../../bild.js";
import { eingabe } from "../../eingabe.js";
import { lagerAnsicht } from "../../lager/ansicht.js";
import { ereignisverteiler } from "../../lager/ereignisse.js";
import { openMeteo, type Wetterdienst } from "../../lager/wetter-openmeteo.js";
import { mussSuchen, sucheWetterOrt } from "../../lager/wetter-ort.js";
import { loeschbar, loescheLager } from "../../lager/loeschen.js";
import { istGeschlossen } from "../../lager/policy.js";
import { schreibeStandardrechte } from "../../lager/rechte.js";
import {
  ladeVorlage,
  planeVorlage,
  schreibePlan,
} from "../../lager/vorlagen.js";
import { LAGER_ROLLEN, LAGER_STATUS } from "../../lager/rechte-katalog.js";
import { aktivesKonto, type Person } from "../../rechte.js";
import { verlange } from "../../rechtemodell/darf.js";
import { erzeugeSeiteAusVorlage, sperre } from "../../website/automatik.js";
import { meldeWebsiteEreignis } from "../../website/ereignisse.js";

// Verwaltungsrouten des Lagers (#364). Nur die Abteilungsleitung legt Lager an, ändert sie und setzt die Mitglieder; die Lager-Rollen verleihen hier nichts. Reihenfolge wie bei den Tags: Pfad (400), Lager der eigenen Abteilung (404), Abteilungsleitung (403), dann der Zustand (409)
const datum = z.iso.date();
const titel = z.string().trim().min(1).max(200);
const ort = z.string().trim().min(1).max(200);
const adresse = z.string().trim().min(1).max(500);
// Kleingeschrieben gespeichert, wie der CHECK der Tabelle es verlangt
const farbe = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((wert) => wert.toLowerCase());

const anlegenSchema = z.strictObject({
  titel,
  von: datum,
  bis: datum,
  vorbereitungAb: datum.optional(),
  ort: ort.optional(),
  adresse: adresse.optional(),
  farbe: farbe.optional(),
  logoMediumId: z.uuid().optional(),
  // Eine Vorlage der eigenen Abteilung (#376): Ihre Aufgaben oder Packlisten-Punkte entstehen mit dem Lager
  vorlageId: z.uuid().optional(),
});
// null leert ein optionales Feld; ohne Schlüssel bleibt der Wert. Anlass und Übung sind bewusst nicht änderbar (eigene Issues)
const aendernSchema = z.strictObject({
  titel: titel.optional(),
  von: datum.optional(),
  bis: datum.optional(),
  vorbereitungAb: datum.nullable().optional(),
  ort: ort.nullable().optional(),
  adresse: adresse.nullable().optional(),
  farbe: farbe.nullable().optional(),
  logoMediumId: z.uuid().nullable().optional(),
  status: z.enum(LAGER_STATUS).optional(),
});
// Die Bestätigung: der Titel des Lagers, wie er gespeichert ist
const loeschenSchema = z.strictObject({ titel });
const mitgliedSchema = z.strictObject({ rolle: z.enum(LAGER_ROLLEN) });
const pfad = () => z.strictObject({ id: z.uuid() });
const pfadPerson = () => z.strictObject({ id: z.uuid(), personId: z.uuid() });

class Konflikt extends Error {
  constructor(
    readonly code:
      "LAGER_GESCHLOSSEN" | "LAGERLEITUNG_FEHLT" | "LAGER_NICHT_LOESCHBAR",
    message: string,
  ) {
    super(message);
  }
}
const geschlossen = () =>
  new Konflikt(
    "LAGER_GESCHLOSSEN",
    "Das Lager ist abgeschlossen und lässt sich nicht ändern.",
  );
const leitungFehlt = () =>
  new Konflikt(
    "LAGERLEITUNG_FEHLT",
    "Ein aktives Lager braucht mindestens eine Lagerleitung.",
  );
const antwortKonflikt = (fehler: Konflikt) => ({
  code: fehler.code,
  message: fehler.message,
});

// Zeitraum nach dem Zusammenführen: Der CHECK der Tabelle fängt es auch, die Route antwortet aber mit 400 statt mit 500
const zeitraumGueltig = (zeit: {
  von: string;
  bis: string;
  vorbereitungAb?: string | null;
}) =>
  zeit.bis >= zeit.von &&
  (!zeit.vorbereitungAb || zeit.vorbereitungAb <= zeit.von);

export function erstelleAdminLagerRouten({
  db,
  wetter = openMeteo,
}: {
  db: Db;
  wetter?: Wetterdienst;
}) {
  type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

  // Nach dem Speichern von Ort oder Adresse bestimmt der Server den Wetterort (#694), damit die Verwaltung den Stand gleich zeigt. Ausserhalb der Transaktion: Ein langsamer Dienst hält keine Sperre. Misslingt es, holt das Wetter es beim Lesen nach
  async function bestimmeWetterOrt(id: string) {
    try {
      const [z] = await db.select().from(lager).where(eq(lager.id, id));
      if (z && mussSuchen(z, new Date())) {
        await sucheWetterOrt(db, z, wetter.suchen);
      }
    } catch {
      // Fehlertext bleibt aus dem Protokoll: Er könnte den Ort enthalten
    }
  }

  // In SQL auf die Abteilung der Sitzung gefiltert: fremde wie unbekannte IDs sind 404, erst danach zählt das Recht der Abteilungsleitung. Mit sperren (nur in einer Transaktion) halten Schreibzugriffe auf ein Lager die Reihenfolge ein, auch die Zählung der Lagerleitung
  async function ladeLager(
    d: Db | Tx,
    person: Person,
    id: string,
    sperren = false,
    recht: "lager.verwalten" | "rechte.verwalten" = "lager.verwalten",
  ) {
    const abfrage = d
      .select()
      .from(lager)
      .where(and(eq(lager.id, id), eq(lager.abteilungId, person.abteilungId)));
    const [ziel] = await (sperren ? abfrage.for("update") : abfrage);
    if (!ziel) throw new HTTPException(404);
    await verlange(d, person, recht);
    return ziel;
  }

  // Ein Bild der eigenen Abteilung; alles andere ist für diese Route unbekannt
  async function pruefeLogo(d: Db | Tx, abteilungId: string, id: string) {
    const [ziel] = await d
      .select({ id: medium.id })
      .from(medium)
      .where(
        and(
          eq(medium.id, id),
          eq(medium.abteilungId, abteilungId),
          like(medium.mimeTyp, "image/%"),
        ),
      );
    if (!ziel) throw new HTTPException(400);
  }

  const anzahlLagerleitung = async (d: Db | Tx, lagerId: string) =>
    (
      await d
        .select({ n: count() })
        .from(lagerMitglied)
        .where(
          and(
            eq(lagerMitglied.lagerId, lagerId),
            eq(lagerMitglied.rolle, "lagerleitung"),
          ),
        )
    )[0].n;

  const mitgliedZeile = async (d: Db | Tx, lagerId: string, personId: string) =>
    (
      await d
        .select({ rolle: lagerMitglied.rolle })
        .from(lagerMitglied)
        .where(
          and(
            eq(lagerMitglied.lagerId, lagerId),
            eq(lagerMitglied.personId, personId),
          ),
        )
    )[0];

  return new Hono<{ Variables: { person: Person } }>()
    .get("/", async (c) => {
      const person = c.get("person");
      await verlange(db, person, "lager.verwalten");
      const zeilen = await db
        .select()
        .from(lager)
        .where(eq(lager.abteilungId, person.abteilungId))
        .orderBy(desc(lager.von), asc(lager.id));
      return c.json({ lager: zeilen.map(lagerAnsicht) });
    })
    .post("/", eingabe("json", anlegenSchema), async (c) => {
      const person = c.get("person");
      await verlange(db, person, "lager.verwalten");
      const { vorlageId, ...felder } = c.req.valid("json");
      if (!zeitraumGueltig(felder)) throw new HTTPException(400);
      if (felder.logoMediumId) {
        await pruefeLogo(db, person.abteilungId, felder.logoMediumId);
      }
      const neu = await db.transaction(async (tx) => {
        const [zeile] = await tx
          .insert(lager)
          .values({ ...felder, abteilungId: person.abteilungId })
          .returning({ id: lager.id });
        // Die Rechte der Rollen mit den Standardwerten (#365)
        await schreibeStandardrechte(tx, zeile.id);
        // Die Vorlage wirkt in derselben Transaktion: Scheitert sie, entsteht kein Lager. Eine fremde oder unbekannte Vorlage ist für diese Route ein 400
        if (vorlageId) {
          const v = await ladeVorlage(tx, person.abteilungId, vorlageId);
          const plan = v && planeVorlage(v, felder.von);
          if (!plan) throw new HTTPException(400);
          await schreibePlan(
            tx,
            { lagerId: zeile.id, personId: person.id },
            plan,
          );
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "vorlage_angewendet",
            zielTyp: "lager",
            zielId: zeile.id,
            details: { vorlageId, art: v.art },
          });
        }
        // Kein Inhalt: weder Titel noch Ort
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "lager_angelegt",
          zielTyp: "lager",
          zielId: zeile.id,
        });
        return zeile;
      });
      if (felder.ort || felder.adresse) await bestimmeWetterOrt(neu.id);
      return c.json({ id: neu.id }, 201);
    })
    .get("/:id", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const ziel = await ladeLager(db, person, c.req.valid("param").id);
      // Die Seite des Lagers (#838) nur hier: Die Apps lesen lagerAnsicht und brauchen sie nicht
      return c.json({ ...lagerAnsicht(ziel), seiteId: ziel.seiteId });
    })
    .post("/:id/seite", eingabe("param", pfad()), async (c) => {
      // Seite des Lagers auf der Website anlegen (#838): nie automatisch, nur über diesen Knopf. Wer das Lager verwaltet und Seiten anlegen darf; die Vorlage wählt der Server (wie bei der Anlassseite, darum ohne «vorlagen.nutzen»).
      // Idempotent: Hat das Lager schon eine Seite, antwortet die Route mit ihr (200) und legt keine zweite an. Die Seite startet als Entwurf und nur für Angemeldete sichtbar (fail-closed, wie website/automatik.ts)
      const person = c.get("person");
      const { id } = c.req.valid("param");
      const ergebnis = await db.transaction(async (tx) => {
        // Erst die Sperre der Seiten, dann die Zeile des Lagers: dieselbe Reihenfolge wie beim Löschen einer Seite (das die Verknüpfung leert), sonst droht ein Deadlock. Zwei Klicks zugleich laufen so nacheinander
        await sperre(tx, person.abteilungId);
        const ziel = await ladeLager(tx, person, id, true);
        await verlange(tx, person, "seiten.anlegen_loeschen");
        if (ziel.seiteId) return { seiteId: ziel.seiteId, neu: false };
        const seite = await erzeugeSeiteAusVorlage(tx, {
          abteilungId: person.abteilungId,
          // Ein Lager ist ein mehrtägiger Anlass: «Worum geht es?», «Wann und wo?» und die Termine passen; alles bleibt frei änderbar
          vorlage: "anlass",
          titel: ziel.titel.slice(0, 150),
          sichtbarkeit: { art: "angemeldet" },
          autorId: person.id,
        });
        await tx
          .update(lager)
          .set({ seiteId: seite.id })
          .where(eq(lager.id, id));
        // Nur Kennungen, nie der Titel
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "lager_seite_angelegt",
          zielTyp: "lager",
          zielId: id,
          details: { seiteId: seite.id },
        });
        return { seiteId: seite.id, neu: true };
      });
      if (ergebnis.neu) {
        meldeWebsiteEreignis({
          art: "seite_geaendert",
          abteilungId: person.abteilungId,
          seiteId: ergebnis.seiteId,
        });
      }
      return c.json({ seiteId: ergebnis.seiteId }, ergebnis.neu ? 201 : 200);
    })
    .patch(
      "/:id",
      eingabe("param", pfad()),
      eingabe("json", aendernSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const { status, ...stammdaten } = c.req.valid("json");
        try {
          await db.transaction(async (tx) => {
            const alt = await ladeLager(tx, person, id, true);
            const felder = Object.keys(stammdaten);
            // Nur der Status darf ein geschlossenes Lager wieder öffnen; jede andere Änderung ist gesperrt
            if (felder.length > 0 && istGeschlossen(alt.status)) {
              throw geschlossen();
            }
            if (!zeitraumGueltig({ ...alt, ...stammdaten })) {
              throw new HTTPException(400);
            }
            if (stammdaten.logoMediumId) {
              await pruefeLogo(tx, person.abteilungId, stammdaten.logoMediumId);
            }
            if (
              status === "aktiv" &&
              alt.status !== "aktiv" &&
              (await anzahlLagerleitung(tx, id)) === 0
            ) {
              throw leitungFehlt();
            }
            // Ohne Schlüssel wirft Drizzle bei set({}): kein Schreibzugriff
            if (felder.length > 0 || status !== undefined) {
              await tx
                .update(lager)
                .set({ ...stammdaten, ...(status && { status }) })
                .where(eq(lager.id, id));
            }
            const audit = (aktion: string, details: object) =>
              tx.insert(auditLog).values({
                abteilungId: person.abteilungId,
                akteurId: person.id,
                aktion,
                zielTyp: "lager",
                zielId: id,
                details,
              });
            // Welche Felder, nie die Werte
            if (felder.length > 0) {
              await audit("lager_geaendert", { felder });
            }
            if (status !== undefined && status !== alt.status) {
              await audit("lager_status", { von: alt.status, nach: status });
            }
          });
        } catch (fehler) {
          if (fehler instanceof Konflikt) {
            return c.json(antwortKonflikt(fehler), 409);
          }
          throw fehler;
        }
        if ("ort" in stammdaten || "adresse" in stammdaten) {
          await bestimmeWetterOrt(id);
        }
        return c.body(null, 204);
      },
    )
    .delete(
      "/:id",
      eingabe("param", pfad()),
      eingabe("json", loeschenSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const { titel: bestaetigt } = c.req.valid("json");
        try {
          await db.transaction(async (tx) => {
            const ziel = await ladeLager(tx, person, id, true);
            if (!loeschbar(ziel)) {
              throw new Konflikt(
                "LAGER_NICHT_LOESCHBAR",
                "Nur ein Entwurf, ein archiviertes Lager oder ein Übungslager lässt sich löschen.",
              );
            }
            if (bestaetigt !== ziel.titel) throw new HTTPException(400);
            const dateien = await loescheLager(tx, id);
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "lager_geloescht",
              zielTyp: "lager",
              zielId: id,
              details: { dateien },
            });
          });
        } catch (fehler) {
          if (fehler instanceof Konflikt) {
            return c.json(antwortKonflikt(fehler), 409);
          }
          throw fehler;
        }
        ereignisverteiler.beendeLager(id);
        return c.body(null, 204);
      },
    )
    .get("/:id/mitglieder", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const ziel = await ladeLager(
        db,
        person,
        c.req.valid("param").id,
        false,
        "rechte.verwalten",
      );
      const mitglieder = await db
        .select({
          personId: lagerMitglied.personId,
          name: user.name,
          ceviName: user.ceviName,
          bildUrl,
          rolle: lagerMitglied.rolle,
        })
        .from(lagerMitglied)
        .innerJoin(user, eq(user.id, lagerMitglied.personId))
        .leftJoin(profilbild, eq(profilbild.userId, user.id))
        .where(eq(lagerMitglied.lagerId, ziel.id))
        .orderBy(asc(user.name), asc(user.id));
      return c.json({ mitglieder });
    })
    .put(
      "/:id/mitglieder/:personId",
      eingabe("param", pfadPerson()),
      eingabe("json", mitgliedSchema),
      async (c) => {
        const person = c.get("person");
        const { id, personId } = c.req.valid("param");
        const { rolle } = c.req.valid("json");
        try {
          await db.transaction(async (tx) => {
            const ziel = await ladeLager(
              tx,
              person,
              id,
              true,
              "rechte.verwalten",
            );
            if (istGeschlossen(ziel.status)) throw geschlossen();
            // Nur ein aktives Konto der Abteilung; unbekannt, deaktiviert und fremd sind für diese Route dasselbe (404)
            const [konto] = await tx
              .select({ id: user.id })
              .from(user)
              .where(
                and(
                  eq(user.id, personId),
                  aktivesKonto(person.abteilungId),
                  keinKindKonto(user.id),
                ),
              );
            if (!konto) throw new HTTPException(404);
            const vorher = await mitgliedZeile(tx, id, personId);
            // Ein aktives Lager behält seine Lagerleitung; die Sperre auf dem Lager macht die Zählung zuverlässig
            if (
              ziel.status === "aktiv" &&
              vorher?.rolle === "lagerleitung" &&
              rolle !== "lagerleitung" &&
              (await anzahlLagerleitung(tx, id)) <= 1
            ) {
              throw leitungFehlt();
            }
            await tx
              .insert(lagerMitglied)
              .values({ lagerId: id, personId, rolle })
              .onConflictDoUpdate({
                target: [lagerMitglied.lagerId, lagerMitglied.personId],
                set: { rolle },
              });
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "mitglied_gesetzt",
              zielTyp: "lager",
              zielId: id,
              details: { personId, rolle, vorher: vorher?.rolle ?? null },
            });
          });
        } catch (fehler) {
          if (fehler instanceof Konflikt) {
            return c.json(antwortKonflikt(fehler), 409);
          }
          throw fehler;
        }
        // Offene Ansichten der Person verbinden mit der neuen Rolle neu (#367)
        ereignisverteiler.beendePerson(id, personId);
        return c.body(null, 204);
      },
    )
    .delete(
      "/:id/mitglieder/:personId",
      eingabe("param", pfadPerson()),
      async (c) => {
        const person = c.get("person");
        const { id, personId } = c.req.valid("param");
        try {
          await db.transaction(async (tx) => {
            const ziel = await ladeLager(
              tx,
              person,
              id,
              true,
              "rechte.verwalten",
            );
            if (istGeschlossen(ziel.status)) throw geschlossen();
            const vorher = await mitgliedZeile(tx, id, personId);
            if (!vorher) throw new HTTPException(404);
            if (
              ziel.status === "aktiv" &&
              vorher.rolle === "lagerleitung" &&
              (await anzahlLagerleitung(tx, id)) <= 1
            ) {
              throw leitungFehlt();
            }
            await tx
              .delete(lagerMitglied)
              .where(
                and(
                  eq(lagerMitglied.lagerId, id),
                  eq(lagerMitglied.personId, personId),
                ),
              );
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "mitglied_entfernt",
              zielTyp: "lager",
              zielId: id,
              details: { personId, rolle: vorher.rolle },
            });
          });
        } catch (fehler) {
          if (fehler instanceof Konflikt) {
            return c.json(antwortKonflikt(fehler), 409);
          }
          throw fehler;
        }
        ereignisverteiler.beendePerson(id, personId);
        return c.body(null, 204);
      },
    );
}

import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { istErlaubtesBild } from "../bild.js";
import type { Db } from "../db/client.js";
import { auditLog, medium } from "../db/schema.js";
import { eingabe } from "../eingabe.js";
import { log } from "../log.js";
import {
  istPdf,
  MEDIEN_BILD_MAX_BYTES,
  MEDIEN_PDF_MAX_BYTES,
  type MedienKodierer,
} from "../medien.js";
import type { Medienspeicher } from "../medien-speicher.js";
import type { Person } from "../rechte.js";
import { seitenMitMedium } from "../website/verweise.js";

const pfadSchema = z.strictObject({ id: z.uuid() });
// Metadaten in der Query: Der Body ist die Datei selbst. Ohne Vorgabe für die Sichtbarkeit: Wer hochlädt, entscheidet
const hochladenSchema = z.strictObject({
  sichtbarkeit: z.enum(["oeffentlich", "angemeldet"]),
  altText: z.string().trim().min(1).max(500).optional(),
  dekorativ: z.literal("true").optional(),
});
const FORMAT = {
  code: "MEDIEN_FORMAT",
  message: "Bitte ein Bild als JPEG, PNG oder WebP oder ein PDF senden.",
};
const ALT_TEXT = {
  code: "ALT_TEXT",
  message:
    "Ein Bild braucht einen Alt-Text oder die ausdrückliche Markierung «dekorativ», nie beides. Ein PDF kann nicht dekorativ sein.",
};
// Das Dekodieren kostet Rechenzeit; Uploads sind selten
const UPLOADS = 10;
const FENSTER_MS = 10 * 60_000;

type Zeile = typeof medium.$inferSelect;

const antwort = (m: Zeile) => ({
  id: m.id,
  mimeTyp: m.mimeTyp,
  groesse: m.groesse,
  breite: m.breite,
  hoehe: m.hoehe,
  altText: m.altText,
  dekorativ: m.dekorativ,
  sichtbarkeit: m.sichtbarkeit,
  url: `/api/v1/medien/${m.id}`,
  erstelltAm: m.erstelltAm,
});

// Die Bytes mit den Kopfzeilen, die ein aktives Format entschärfen: nosniff, kein Skript, kein Rahmen; ein PDF öffnet sich nie in der Seite, sondern lädt herunter. Ein Dateiname der Nutzer existiert nicht
async function liefere(c: Context, speicher: Medienspeicher, m: Zeile) {
  const inhalt = await speicher.holen(m.speicherSchluessel);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", "sandbox; frame-ancestors 'none'");
  // Öffentliche Medien darf ein Cache kurz halten, die übrigen nie, wie das Profilbild
  c.header(
    "Cache-Control",
    m.sichtbarkeit === "oeffentlich"
      ? "public, max-age=300"
      : "private, no-store",
  );
  c.header(
    "Content-Disposition",
    m.mimeTyp === "application/pdf"
      ? 'attachment; filename="dokument.pdf"'
      : "inline",
  );
  return c.body(inhalt as Uint8Array<ArrayBuffer>, 200, {
    "Content-Type": m.mimeTyp,
  });
}

// Vor der Sitzung eingehängt: Ein öffentliches Medium braucht keine. Jedes andere gibt diese Route mit next() weiter an erstelleMedienRouten, die Sitzung und Abteilung prüft
export function erstelleOeffentlicheMedienRoute({
  db,
  speicher,
}: {
  db: Db;
  speicher?: Medienspeicher;
}) {
  return new Hono().get(
    "/api/v1/medien/:id",
    eingabe("param", pfadSchema),
    async (c, next) => {
      if (!speicher) throw new HTTPException(501);
      const { id } = c.req.valid("param");
      const [m] = await db
        .select()
        .from(medium)
        .where(and(eq(medium.id, id), eq(medium.sichtbarkeit, "oeffentlich")));
      if (!m) return next();
      return liefere(c, speicher, m);
    },
  );
}

// Auch in den Importen ohne node:* und process: Die App prüft diese Datei über AppType; sharp und das SDK kommen darum als Parameter
export function erstelleMedienRouten({
  db,
  speicher,
  kodiereMedienbild,
}: {
  db: Db;
  speicher?: Medienspeicher;
  kodiereMedienbild?: MedienKodierer;
}) {
  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const versuche = new Map<string, number[]>();
  const zuViele = (id: string) => {
    const jetzt = Date.now();
    const liste = (versuche.get(id) ?? []).filter(
      (t) => jetzt - t < FENSTER_MS,
    );
    const voll = liste.length >= UPLOADS;
    if (!voll) liste.push(jetzt);
    versuche.set(id, liste);
    return voll;
  };
  // Vor jeder Prüfung des Inhalts: Wer kein Recht hat, erfährt nichts über Eingabe oder Speicher
  const nurAdmin = createMiddleware<{ Variables: { person: Person } }>(
    async (c, next) => {
      if (!c.get("person").admin) throw new HTTPException(403);
      await next();
    },
  );

  return (
    new Hono<{ Variables: { person: Person } }>()
      // Der Body ist die Datei selbst; der Typ ergibt sich aus den Bytes, nie aus Header, Endung oder Query. bodyLimit hält das PDF-Maximum, das kleinere Bild-Maximum prüft die Route nach dem Typ
      .post(
        "/admin/medien",
        nurAdmin,
        eingabe("query", hochladenSchema),
        bodyLimit({ maxSize: MEDIEN_PDF_MAX_BYTES }),
        async (c) => {
          const person = c.get("person");
          const meta = c.req.valid("query");
          if (!speicher || !kodiereMedienbild) throw new HTTPException(501);
          if (zuViele(person.id)) throw new HTTPException(429);
          const daten = new Uint8Array(await c.req.arrayBuffer());
          const dekorativ = meta.dekorativ === "true";

          let mimeTyp: string;
          let inhalt: Uint8Array;
          let breite: number | null = null;
          let hoehe: number | null = null;
          if (istPdf(daten)) {
            if (dekorativ) return c.json(ALT_TEXT, 400);
            mimeTyp = "application/pdf";
            inhalt = daten;
          } else if (istErlaubtesBild(daten)) {
            if (daten.length > MEDIEN_BILD_MAX_BYTES) {
              return c.json(
                {
                  code: "ZU_GROSS",
                  message: "Ein Bild darf höchstens 10 MB gross sein.",
                },
                413,
              );
            }
            // Genau eines von beiden
            if ((meta.altText !== undefined) === dekorativ) {
              return c.json(ALT_TEXT, 400);
            }
            try {
              ({
                inhalt,
                typ: mimeTyp,
                breite,
                hoehe,
              } = await kodiereMedienbild(daten));
            } catch {
              // Kein lesbares Bild oder zu viele Pixel
              return c.json(FORMAT, 415);
            }
          } else {
            // Alles andere, auch SVG, GIF und HEIC
            return c.json(FORMAT, 415);
          }

          // Erst in den Speicher, dann in die Datenbank: Scheitert der Speicher, gibt es keine Zeile, die auf nichts zeigt. Scheitert die Datenbank, räumt die Route das Objekt weg; scheitert auch das, bleibt eine Waise ohne Zeile, die keine Route ausliefert (im Log: WAISE)
          const schluessel = await speicher.ablegen(inhalt, mimeTyp);
          try {
            const neu = await db.transaction(async (tx) => {
              const [zeile] = await tx
                .insert(medium)
                .values({
                  abteilungId: person.abteilungId,
                  mimeTyp,
                  groesse: inhalt.length,
                  breite,
                  hoehe,
                  altText: meta.altText ?? null,
                  dekorativ,
                  sichtbarkeit: meta.sichtbarkeit,
                  speicherSchluessel: schluessel,
                  hochgeladenVon: person.id,
                })
                .returning();
              // Ohne Inhalt und ohne Alt-Text
              await tx.insert(auditLog).values({
                abteilungId: person.abteilungId,
                akteurId: person.id,
                aktion: "medium_hochgeladen",
                zielTyp: "medium",
                zielId: zeile.id,
                details: { mimeTyp, sichtbarkeit: meta.sichtbarkeit },
              });
              return zeile;
            });
            return c.json(antwort(neu), 201);
          } catch (fehler) {
            await speicher
              .loeschen(schluessel)
              .catch(() =>
                log(c, { ereignis: "medien", code: "WAISE", schluessel }),
              );
            throw fehler;
          }
        },
      )
      .get("/admin/medien", nurAdmin, async (c) => {
        const person = c.get("person");
        // shortcut: die jüngsten 200 ohne Seitenwechsel; Seiten, sobald die Redaktion (#334) mehr braucht
        const zeilen = await db
          .select()
          .from(medium)
          .where(eq(medium.abteilungId, person.abteilungId))
          .orderBy(desc(medium.erstelltAm))
          .limit(200);
        return c.json({ medien: zeilen.map(antwort) });
      })
      // Erst die Zeile, dann das Objekt: Scheitert der Speicher danach, bleibt eine Waise ohne Zeile, die keine Route ausliefert; umgekehrt zeigte eine Zeile auf nichts
      .delete("/admin/medien/:id", eingabe("param", pfadSchema), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        if (!speicher) throw new HTTPException(501);
        // Erst die Abteilung (404 für fremde und unbekannte IDs, wie bei den übrigen Objekt-Routen), dann das Recht
        const [vorhanden] = await db
          .select({ id: medium.id })
          .from(medium)
          .where(
            and(eq(medium.id, id), eq(medium.abteilungId, person.abteilungId)),
          );
        if (!vorhanden) throw new HTTPException(404);
        if (!person.admin) throw new HTTPException(403);
        const ergebnis = await db.transaction(async (tx) => {
          // Sperren, dann zählen: Ein Entwurf, der das Medium gerade speichert (FOR SHARE), kommt vorher oder die Zählung sieht ihn; so bleibt kein totes Bild
          const gesperrt = await tx
            .select({ id: medium.id })
            .from(medium)
            .where(
              and(
                eq(medium.id, id),
                eq(medium.abteilungId, person.abteilungId),
              ),
            )
            .for("update");
          if (gesperrt.length === 0) throw new HTTPException(404);
          const seiten = await seitenMitMedium(tx, person.abteilungId, id);
          if (seiten > 0) return { seiten };
          const [m] = await tx
            .delete(medium)
            .where(
              and(
                eq(medium.id, id),
                eq(medium.abteilungId, person.abteilungId),
              ),
            )
            .returning({ schluessel: medium.speicherSchluessel });
          if (!m) throw new HTTPException(404);
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "medium_geloescht",
            zielTyp: "medium",
            zielId: id,
          });
          return { schluessel: m.schluessel };
        });
        if ("seiten" in ergebnis) {
          return c.json(
            {
              code: "MEDIUM_VERWENDET",
              message:
                "Das Medium steht noch in Seiten (Entwurf oder Version). Entferne es dort zuerst.",
              seiten: ergebnis.seiten,
            },
            409,
          );
        }
        const { schluessel } = ergebnis;
        await speicher
          .loeschen(schluessel)
          .catch(() =>
            log(c, { ereignis: "medien", code: "WAISE", schluessel }),
          );
        return c.body(null, 204);
      })
      // Nicht öffentliche Medien: Sitzung (die Middleware davor) und gleiche Abteilung; fremde und unbekannte IDs sind gleich 404. Öffentliche liefert schon erstelleOeffentlicheMedienRoute
      .get("/medien/:id", eingabe("param", pfadSchema), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        if (!speicher) throw new HTTPException(501);
        const [m] = await db
          .select()
          .from(medium)
          .where(
            and(eq(medium.id, id), eq(medium.abteilungId, person.abteilungId)),
          );
        if (!m) throw new HTTPException(404);
        return liefere(c, speicher, m);
      })
  );
}

import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { fotoAlbum, fotoEinstellung } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  albumSchema,
  einstellungSchema,
  kennungParam,
  ladeAlbumZeilen,
  ladeEinstellung,
  reihenfolgeSchema,
} from "../../fotos/daten.js";
import { QuellFehler, istKonto } from "../../fotos/quelle.js";
import type { Zwischenspeicher } from "../../fotos/zwischenspeicher.js";
import { log } from "../../log.js";
import type { Person } from "../../rechte.js";
import { verlange } from "../../rechtemodell/darf.js";

// Fotos verwalten (#690): das Flickr-Konto, der Schalter für den Link zu Flickr, welche Alben auf der Website erscheinen, ihre Reihenfolge und ein eigener Titel. Das Recht «fotos.verwalten» (Abteilungsleitung, oder eine Rolle wie «Webmaster» mit dem Recht), mit zweitem Faktor; die Pfade tragen /api/v1/admin und erben ihn von app.ts.
// Die Zugangsdaten zu Flickr (Schlüssel, Secret, Token) stehen nie hier: Die Antwort sagt nur, ob der Server sie hat («eingerichtet»). Neue Alben bei Flickr erscheinen nie von selbst auf der Website: Es gibt erst eine Zeile, wenn jemand sie hier bearbeitet.
export type FotoVerwaltungEnv = { Variables: { person: Person } };

const RECHT = "fotos.verwalten";

const VERSION_KONFLIKT = {
  code: "VERSION_KONFLIKT",
  message: "Jemand anders hat das gerade geändert. Lade die Seite neu.",
} as const;

// Was die Verbindung zu Flickr gerade tut, als Wort für die Verwaltung
type Verbindung =
  | "ok"
  | "nicht_eingerichtet"
  | "kein_konto"
  | "zugang"
  | "nicht_erreichbar"
  | "nicht_gefunden";

const verbindungVon = (f: unknown): Verbindung => {
  if (!(f instanceof QuellFehler)) throw f;
  return f.art;
};

export function erstelleAdminFotoRouten({
  db,
  speicher,
}: {
  db: Db;
  speicher?: Zwischenspeicher;
}) {
  return (
    new Hono<FotoVerwaltungEnv>()
      // Stand: Einstellung, Verbindung und die Alben des Kontos mit dem, was die Abteilung dazu entschieden hat
      .get("/", async (c) => {
        const person = c.get("person");
        await verlange(db, person, RECHT);
        const e = await ladeEinstellung(db, person.abteilungId);
        const kopf = {
          eingerichtet: speicher !== undefined,
          flickrKonto: e.flickrKonto,
          flickrLinkZeigen: e.flickrLinkZeigen,
          version: e.version,
        };
        if (!speicher) {
          return c.json({
            ...kopf,
            verbindung: "nicht_eingerichtet" satisfies Verbindung,
            alben: [],
          });
        }
        if (!e.flickrKonto) {
          return c.json({
            ...kopf,
            verbindung: "kein_konto" satisfies Verbindung,
            alben: [],
          });
        }
        try {
          const bei = await speicher.alben(e.flickrKonto);
          const zeilen = await ladeAlbumZeilen(db, person.abteilungId);
          const zeile = new Map(zeilen.map((z) => [z.flickrAlbumId, z]));
          // Albums mit Zeile zuerst in ihrer Reihenfolge, danach die neuen bei Flickr in der Reihenfolge von Flickr
          const mit = zeilen.flatMap((z) => {
            const a = bei.find((x) => x.id === z.flickrAlbumId);
            return a ? [a] : [];
          });
          const ohne = bei.filter((a) => !zeile.has(a.id));
          return c.json({
            ...kopf,
            verbindung: "ok" satisfies Verbindung,
            alben: [...mit, ...ohne].map((a) => {
              const z = zeile.get(a.id);
              return {
                id: a.id,
                titel: a.titel,
                eigenerTitel: z?.titel ?? null,
                anzahl: a.anzahl,
                datum: a.datum,
                titelbild: a.titelbild !== null,
                sichtbar: z?.sichtbar ?? false,
                version: z?.version ?? 0,
              };
            }),
          });
        } catch (f) {
          const art = verbindungVon(f);
          log(c, {
            ereignis: "fotos_quelle",
            art,
            code: (f as QuellFehler).code,
          });
          return c.json({ ...kopf, verbindung: art, alben: [] });
        }
      })
      // «Verbindung testen»: ein frischer Abruf der Albumliste (der Zwischenspeicher wird übergangen). Antwortet immer 200; das Ergebnis steht im Body und nennt nie ein Geheimnis. Mit «flickrKonto» wird ein Konto geprüft, das noch nicht gespeichert ist
      .post(
        "/verbindung",
        eingabe(
          "json",
          z.strictObject({
            flickrKonto: z.string().trim().refine(istKonto).optional(),
          }),
        ),
        async (c) => {
          const person = c.get("person");
          await verlange(db, person, RECHT);
          if (!speicher) {
            return c.json({ ok: false, art: "nicht_eingerichtet" as const });
          }
          const konto =
            c.req.valid("json").flickrKonto ??
            (await ladeEinstellung(db, person.abteilungId)).flickrKonto;
          if (!konto) return c.json({ ok: false, art: "kein_konto" as const });
          speicher.leere();
          try {
            const alben = await speicher.alben(konto);
            return c.json({ ok: true, alben: alben.length });
          } catch (f) {
            const art = verbindungVon(f);
            log(c, {
              ereignis: "fotos_quelle",
              art,
              code: (f as QuellFehler).code,
            });
            return c.json({ ok: false, art });
          }
        },
      )
      // Konto und Link ersetzen; «version» ist die aus dem Stand (0 ohne Zeile). Ein anderes Konto macht die bisherigen Entscheide zu Alben wirkungslos (sie gelten nur für ihre Kennungen), löscht sie aber nicht
      .put("/einstellung", eingabe("json", einstellungSchema), async (c) => {
        const person = c.get("person");
        await verlange(db, person, RECHT);
        const neu = c.req.valid("json");
        const version = await db.transaction(async (tx) => {
          const jetzt = await ladeEinstellung(tx, person.abteilungId);
          if (jetzt.version !== neu.version) return null;
          const werte = {
            flickrKonto: neu.flickrKonto,
            flickrLinkZeigen: neu.flickrLinkZeigen,
            version: jetzt.version + 1,
            geaendertAm: new Date(),
          };
          await tx
            .insert(fotoEinstellung)
            .values({ abteilungId: person.abteilungId, ...werte })
            .onConflictDoUpdate({
              target: fotoEinstellung.abteilungId,
              set: werte,
            });
          return werte.version;
        });
        if (version === null) return c.json(VERSION_KONFLIKT, 409);
        // Ein anderes Konto: Der Zwischenspeicher gehört dem alten
        speicher?.leere();
        return c.json({ version });
      })
      // Die Reihenfolge aller genannten Alben; vor «:id», damit «reihenfolge» keine Kennung ist
      .put(
        "/alben/reihenfolge",
        eingabe("json", reihenfolgeSchema),
        async (c) => {
          const person = c.get("person");
          await verlange(db, person, RECHT);
          const { ids } = c.req.valid("json");
          // Ein Album ohne Zeile bekommt eine unsichtbare: Die Reihenfolge ist für sich eine Angabe
          await db
            .insert(fotoAlbum)
            .values(
              ids.map((flickrAlbumId, reihenfolge) => ({
                abteilungId: person.abteilungId,
                flickrAlbumId,
                reihenfolge,
                // Stand «noch nie bearbeitet», wie ihn die Verwaltung ohne Zeile kennt (0)
                version: 0,
              })),
            )
            .onConflictDoUpdate({
              target: [fotoAlbum.abteilungId, fotoAlbum.flickrAlbumId],
              set: {
                reihenfolge: sql`excluded.reihenfolge`,
                geaendertAm: new Date(),
              },
            });
          return c.body(null, 204);
        },
      )
      // Ein Album zeigen oder ausblenden und ihm einen eigenen Titel geben. «version» ist die des Albums im Stand (0 ohne Zeile)
      .put(
        "/alben/:id",
        eingabe("param", kennungParam),
        eingabe("json", albumSchema),
        async (c) => {
          const person = c.get("person");
          await verlange(db, person, RECHT);
          const { id } = c.req.valid("param");
          const a = c.req.valid("json");
          // Zeigen darf man nur, was das Konto bei Flickr hat: Eine erfundene Kennung gibt keine Zeile mit Wirkung
          if (a.sichtbar === true) {
            const e = await ladeEinstellung(db, person.abteilungId);
            if (!speicher || !e.flickrKonto) throw new HTTPException(409);
            try {
              if (
                !(await speicher.alben(e.flickrKonto)).some((x) => x.id === id)
              ) {
                throw new HTTPException(404);
              }
            } catch (f) {
              if (f instanceof HTTPException) throw f;
              throw new HTTPException(502);
            }
          }
          const ergebnis = await db.transaction(async (tx) => {
            const [zeile] = await tx
              .select({
                version: fotoAlbum.version,
                reihenfolge: fotoAlbum.reihenfolge,
              })
              .from(fotoAlbum)
              .where(
                and(
                  eq(fotoAlbum.abteilungId, person.abteilungId),
                  eq(fotoAlbum.flickrAlbumId, id),
                ),
              )
              .for("update");
            if ((zeile?.version ?? 0) !== a.version) return null;
            const aenderung = {
              ...(a.sichtbar !== undefined && { sichtbar: a.sichtbar }),
              ...(a.titel !== undefined && { titel: a.titel }),
              geaendertAm: new Date(),
            };
            if (zeile) {
              await tx
                .update(fotoAlbum)
                .set({ ...aenderung, version: zeile.version + 1 })
                .where(
                  and(
                    eq(fotoAlbum.abteilungId, person.abteilungId),
                    eq(fotoAlbum.flickrAlbumId, id),
                  ),
                );
              return { version: zeile.version + 1 };
            }
            // Neue Zeile ans Ende
            const [ende] = await tx
              .select({
                n: sql<number>`coalesce(max(${fotoAlbum.reihenfolge}) + 1, 0)::int`,
              })
              .from(fotoAlbum)
              .where(eq(fotoAlbum.abteilungId, person.abteilungId));
            await tx.insert(fotoAlbum).values({
              abteilungId: person.abteilungId,
              flickrAlbumId: id,
              reihenfolge: Math.min(ende?.n ?? 0, 9999),
              version: 1,
              ...aenderung,
            });
            return { version: 1 };
          });
          if (ergebnis === null) return c.json(VERSION_KONFLIKT, 409);
          return c.json(ergebnis);
        },
      )
  );
}

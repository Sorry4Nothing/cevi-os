import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { darfBearbeiten } from "../../bearbeiten.js";
import type { Db } from "../../db/client.js";
import { abteilung, auditLog, seite, seiteVersion } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";
import { ladeDaten, ladeLogo } from "../../website/abgleich.js";
import { pruefeDokument } from "../../website/dokument.js";
import { meldeWebsiteEreignis } from "../../website/ereignisse.js";
import {
  CSP,
  rendereSeite,
  STARTSEITE,
  STYLESHEET_PFAD,
  type Kontakt,
} from "../../website/rendern.js";
import { ladeLadenDaten } from "../../laden/laden.js";
import { ladeStufenfaktenGemerkt } from "../../website/stufenfakten.js";
import {
  ladeAnlassSeiten,
  ladeTerminlisten,
} from "../../website/termine-liste.js";
import { pruefeVerweise } from "../../website/verweise.js";

const pfad = () => z.strictObject({ id: z.uuid() });
const versionPfad = () =>
  z.strictObject({
    id: z.uuid(),
    nr: z
      .string()
      .regex(/^[1-9][0-9]{0,8}$/)
      .transform(Number),
  });
// Der Zähler gehört dem Server (Postgres integer); das Dokument prüft pruefeDokument, nicht dieses Schema
const speichernSchema = z.strictObject({
  zaehler: z.number().int().min(0).max(2_147_483_647),
  dokument: z.unknown(),
});

const vorschauSchema = z.strictObject({
  version: z
    .string()
    .regex(/^[1-9][0-9]{0,8}$/)
    .transform(Number)
    .optional(),
});
// Speichern des Entwurfs: je Person höchstens SPEICHERN im Fenster. Autospeichern alle paar Sekunden bleibt weit darunter
const SPEICHERN = 120;
const FENSTER_MS = 60_000;
// Die Liste der Versionen: die jüngsten, ohne Inhalt
const MAX_VERSIONEN = 100;

const DOKUMENT_UNGUELTIG = {
  code: "DOKUMENT_UNGUELTIG",
  message: "Das Dokument der Seite ist ungültig.",
} as const;
const NICHTS_ZU_VEROEFFENTLICHEN = {
  code: "NICHTS_ZU_VEROEFFENTLICHEN",
  message: "Der Entwurf ist leer oder gleich der veröffentlichten Version.",
} as const;
const NICHT_VEROEFFENTLICHT = {
  code: "NICHT_VEROEFFENTLICHT",
  message: "Die Seite ist nicht veröffentlicht.",
} as const;

// Bricht die Transaktion ab und wird zur Antwort
class Abbruch extends Error {
  constructor(
    readonly antwort: object,
    readonly status: 400 | 409 | 422,
  ) {
    super();
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function erstelleSeitenInhaltRouten({
  db,
  kontakt,
}: {
  db: Db;
  // Telefon, E-Mail und Adresse der Abteilung aus der Konfiguration: Die Vorschau zeigt Kontaktkarte und Fuss wie die Website
  kontakt?: Kontakt;
}) {
  // shortcut: Zähler im Arbeitsspeicher wie beim Upload der Medien, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const versuche = new Map<string, number[]>();
  const zuViele = (id: string) => {
    const jetzt = Date.now();
    const liste = (versuche.get(id) ?? []).filter(
      (t) => jetzt - t < FENSTER_MS,
    );
    const voll = liste.length >= SPEICHERN;
    if (!voll) liste.push(jetzt);
    versuche.set(id, liste);
    return voll;
  };

  // Auf die Abteilung der Sitzung gefiltert: fremde wie unbekannte IDs sind 404, erst danach zählt das Recht.
  // gleich: Entwurf = veröffentlichte Version (null ohne eines von beiden); jsonb vergleicht den Inhalt, nicht die Schreibweise
  async function ladeSeite(d: Pick<Db, "select">, person: Person, id: string) {
    const [z] = await d
      .select({
        seite,
        nr: seiteVersion.nr,
        gleich: sql<boolean | null>`${seite.entwurf} = ${seiteVersion.inhalt}`,
      })
      .from(seite)
      .leftJoin(
        seiteVersion,
        eq(seiteVersion.id, seite.veroeffentlichteVersionId),
      )
      .where(and(eq(seite.id, id), eq(seite.abteilungId, person.abteilungId)));
    if (!z) throw new HTTPException(404);
    return z;
  }

  // Wie bei der Struktur: Eine Seite einer Stufe (tagId = Stufe) bearbeitet auch deren Stufenleitung
  // veroeffentlichen: Die Frage gilt dem Veröffentlichen und Zurückziehen (Plattformrecht «Seiten veröffentlichen» statt «Seiten bearbeiten»)
  async function ladeMitRecht(
    d: Pick<Db, "select">,
    person: Person,
    id: string,
    veroeffentlichen = false,
  ) {
    const z = await ladeSeite(d, person, id);
    const darf = await darfBearbeiten(d, person, "seite", id, {
      stufeId: z.seite.tagId ?? undefined,
      tagId: z.seite.tagId ?? undefined,
      veroeffentlichen,
    });
    if (!darf) throw new HTTPException(403);
    return z;
  }

  // Schreibende Routen: erst 404 und 403, dann die Zeile sperren und frisch lesen (READ COMMITTED sieht, was der Wartende davor schrieb).
  // Zwei gleichzeitige Veröffentlichungen laufen so nacheinander: Die zweite findet «gleich» und bekommt 409
  async function ladeGesperrt(
    tx: Tx,
    person: Person,
    id: string,
    veroeffentlichen = false,
  ) {
    await ladeMitRecht(tx, person, id, veroeffentlichen);
    const gesperrt = await tx
      .select({ id: seite.id })
      .from(seite)
      .where(eq(seite.id, id))
      .for("update");
    if (gesperrt.length === 0) throw new HTTPException(404);
    return ladeSeite(tx, person, id);
  }

  const audit = (
    tx: Tx,
    person: Person,
    aktion: string,
    seiteId: string,
    details: Record<string, unknown>,
  ) =>
    tx.insert(auditLog).values({
      abteilungId: person.abteilungId,
      akteurId: person.id,
      aktion,
      zielTyp: "seite",
      zielId: seiteId,
      details,
    });

  // Mit der Abbruch-Antwort statt eines Fehlers beantworten
  const antworte =
    (c: { json: (b: object, s: 400 | 409 | 422) => Response }) =>
    (fehler: unknown) => {
      if (fehler instanceof Abbruch)
        return c.json(fehler.antwort, fehler.status);
      throw fehler;
    };

  return (
    new Hono<{ Variables: { person: Person } }>()
      .get("/:id/entwurf", eingabe("param", pfad()), async (c) => {
        const z = await ladeMitRecht(
          db,
          c.get("person"),
          c.req.valid("param").id,
        );
        return c.json({
          zaehler: z.seite.entwurfZaehler,
          dokument: z.seite.entwurf ?? null,
          veroeffentlichteNr: z.nr,
          // Gibt es etwas, das «Veröffentlichen» neu veröffentlichte?
          unveroeffentlicht: z.seite.entwurf !== null && z.gleich !== true,
        });
      })
      // Vorschau des gespeicherten Entwurfs als Seite im Rahmen der Verwaltung (#358): derselbe Renderer wie bei der Auslieferung.
      // Alle Bausteine erscheinen offen, auch die mit engerer Sichtbarkeit: Wer die Seite bearbeitet, darf sie sehen. Kein Skript, keine Navigation.
      .get(
        "/:id/vorschau",
        eingabe("param", pfad()),
        eingabe("query", vorschauSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const { version } = c.req.valid("query");
          const z = await ladeMitRecht(db, person, id);
          let quelle: unknown = z.seite.entwurf ?? {
            v: 1,
            titel: z.seite.titel,
            bausteine: [],
          };
          // Eine frühere Version statt des Entwurfs (aus der Versionsliste)
          if (version !== undefined) {
            const [v] = await db
              .select({ inhalt: seiteVersion.inhalt })
              .from(seiteVersion)
              .where(
                and(eq(seiteVersion.seiteId, id), eq(seiteVersion.nr, version)),
              );
            if (!v) throw new HTTPException(404);
            quelle = v.inhalt;
          }
          const p = pruefeDokument(quelle);
          if (!p.ok) {
            return c.json({ ...DOKUMENT_UNGUELTIG, fehler: p.fehler }, 422);
          }
          const dokument = {
            ...p.dokument,
            bausteine: p.dokument.bausteine.map((b) => ({
              ...b,
              sichtbarkeit: "erbt" as const,
            })),
          };
          // Termin-Liste und «Zur Anmeldung» (#570) aus denselben Quellen wie der Abgleich; die Termine nur, wenn die Seite eine Liste hat (dann drei Abfragen mehr, sonst eine)
          const [daten, laden, fakten, termine, anlaesse, [abt], logo] =
            await Promise.all([
              ladeDaten(db, person.abteilungId, [dokument], false),
              // Lädeli (#566): Die Vorschau zeigt die Artikel wie die Website; die Abfragen laufen nur, wenn die Seite den Baustein hat
              ladeLadenDaten(
                db,
                person.abteilungId,
                [id],
                new Map([[id, dokument]]),
              ),
              ladeStufenfaktenGemerkt(db, person.abteilungId, id),
              dokument.bausteine.some((b) => b.typ === "terminliste")
                ? ladeTerminlisten(
                    db,
                    person.abteilungId,
                    [id],
                    new Map([[id, dokument]]),
                  )
                : {},
              ladeAnlassSeiten(db, person.abteilungId, [id]),
              db
                .select({ name: abteilung.name })
                .from(abteilung)
                .where(eq(abteilung.id, person.abteilungId)),
              ladeLogo(db, person.abteilungId),
            ]);
          if (fakten) daten.stufenfakten = new Map([[id, fakten]]);
          if (laden.laden) {
            daten.laden = laden.laden;
            if (laden.ladenUebergabe) {
              daten.ladenUebergabe = laden.ladenUebergabe;
            }
            daten.medien = new Map([...daten.medien, ...(laden.medien ?? [])]);
          }
          Object.assign(daten, termine, anlaesse, kontakt && { kontakt });
          // Die Startseite hat einen eigenen Einstieg (Titelkarte im Bild): Die Vorschau zeigt ihn nur unter ihrer Adresse
          const start =
            z.seite.elternId === null && z.seite.adresse === STARTSEITE;
          const seitenHtml = rendereSeite(
            { id, pfad: start ? "/" : "/vorschau", dokument },
            {
              abteilung: abt?.name ?? "",
              ...(logo && { logo }),
              basisUrl: "",
              navigation: [],
              daten,
            },
          );
          // Der Stil kommt aus der Verwaltung (seiten.ts), nicht von der Website
          // Und ohne Skripte (Thema, Karussell): Die Vorschau läuft unter der CSP der Verwaltung, der Umschalter bleibt verborgen und das Karussell ein Bildstreifen ohne Knöpfe
          // Immer hell (#570): So sehen die meisten Besucher die Seite, auch wenn das Gerät der Redaktion dunkel ist
          const html = seitenHtml
            .replace(
              '<html lang="de-CH">',
              '<html lang="de-CH" data-theme="light">',
            )
            .replace(
              `href="${STYLESHEET_PFAD}"`,
              'href="/admin/website-vorschau.css"',
            )
            // Weitere Stile der Website (Karussell, Inhaltsbausteine) stecken schon in der Vorschau-Stilvorlage
            .replace(/\n<link rel="stylesheet" href="\/website\/[^"]*">/g, "")
            .replace(/\n?<script [^>]*><\/script>/g, "");
          // Nur die eigene Verwaltung darf die Vorschau einrahmen
          return c.html(html, 200, {
            "Content-Security-Policy": `${CSP}; frame-ancestors 'self'`,
            "Cache-Control": "private, no-store",
          });
        },
      )
      .put(
        "/:id/entwurf",
        eingabe("param", pfad()),
        eingabe("json", speichernSchema),
        async (c) => {
          const person = c.get("person");
          const { id } = c.req.valid("param");
          const felder = c.req.valid("json");
          try {
            const zaehler = await db.transaction(async (tx) => {
              const { seite: alt } = await ladeMitRecht(tx, person, id);
              if (zuViele(person.id)) throw new HTTPException(429);
              const p = pruefeDokument(felder.dokument);
              if (!p.ok) {
                throw new Abbruch(
                  { ...DOKUMENT_UNGUELTIG, fehler: p.fehler },
                  400,
                );
              }
              const verweise = await pruefeVerweise(
                tx,
                person.abteilungId,
                alt.sichtbarkeit,
                p.dokument,
              );
              if (verweise.length > 0) {
                throw new Abbruch(
                  {
                    code: verweise[0]!.code,
                    message: "Das Dokument verweist auf etwas Unzulässiges.",
                    fehler: verweise,
                  },
                  422,
                );
              }
              // Ein Schritt: nur wer den aktuellen Zähler kennt, schreibt (sonst 0 Zeilen)
              const [neu] = await tx
                .update(seite)
                .set({
                  entwurf: p.dokument,
                  entwurfZaehler: sql`${seite.entwurfZaehler} + 1`,
                  geaendertAm: new Date(),
                })
                .where(
                  and(
                    eq(seite.id, id),
                    eq(seite.entwurfZaehler, felder.zaehler),
                  ),
                )
                .returning({ zaehler: seite.entwurfZaehler });
              if (!neu) {
                const { seite: jetzt } = await ladeSeite(tx, person, id);
                throw new Abbruch(
                  {
                    code: "KONFLIKT",
                    message:
                      "Die Seite wurde inzwischen geändert. Hier ist der aktuelle Stand.",
                    zaehler: jetzt.entwurfZaehler,
                    dokument: jetzt.entwurf ?? null,
                  },
                  409,
                );
              }
              // Das Speichern steht nicht im Audit-Log: Autospeichern soll es nicht fluten
              return neu.zaehler;
            });
            return c.json({ zaehler }, 200);
          } catch (fehler) {
            return antworte(c)(fehler);
          }
        },
      )
      .post("/:id/veroeffentlichen", eingabe("param", pfad()), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        try {
          const nr = await db.transaction(async (tx) => {
            const { seite: z, gleich } = await ladeGesperrt(
              tx,
              person,
              id,
              true,
            );
            if (z.entwurf === null || gleich === true) {
              throw new Abbruch(NICHTS_ZU_VEROEFFENTLICHEN, 409);
            }
            // Das ganze Dokument, auch wenn der Entwurf es beim Speichern schon bestand: Schema und Seite können sich seither geändert haben
            const p = pruefeDokument(z.entwurf);
            if (!p.ok) {
              throw new Abbruch(
                { ...DOKUMENT_UNGUELTIG, fehler: p.fehler },
                422,
              );
            }
            const verweise = await pruefeVerweise(
              tx,
              person.abteilungId,
              z.sichtbarkeit,
              p.dokument,
            );
            if (verweise.length > 0) {
              throw new Abbruch(
                {
                  code: verweise[0]!.code,
                  message: "Das Dokument verweist auf etwas Unzulässiges.",
                  fehler: verweise,
                },
                422,
              );
            }
            // Unter der Sperre der Zeile: Zwei Veröffentlichungen ziehen nie dieselbe Nummer
            const [letzte] = await tx
              .select({ nr: seiteVersion.nr })
              .from(seiteVersion)
              .where(eq(seiteVersion.seiteId, id))
              .orderBy(desc(seiteVersion.nr))
              .limit(1);
            const neueNr = (letzte?.nr ?? 0) + 1;
            const [version] = await tx
              .insert(seiteVersion)
              .values({
                seiteId: id,
                nr: neueNr,
                inhalt: p.dokument,
                autorId: person.id,
              })
              .returning({ id: seiteVersion.id });
            await tx
              .update(seite)
              .set({ veroeffentlichteVersionId: version.id })
              .where(eq(seite.id, id));
            await audit(tx, person, "seite_veroeffentlicht", id, {
              nr: neueNr,
            });
            return neueNr;
          });
          meldeWebsiteEreignis({
            art: "version_veroeffentlicht",
            abteilungId: person.abteilungId,
            seiteId: id,
          });
          return c.json({ nr }, 201);
        } catch (fehler) {
          return antworte(c)(fehler);
        }
      })
      .post("/:id/zurueckziehen", eingabe("param", pfad()), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        try {
          await db.transaction(async (tx) => {
            const { seite: z } = await ladeGesperrt(tx, person, id, true);
            if (z.veroeffentlichteVersionId === null) {
              throw new Abbruch(NICHT_VEROEFFENTLICHT, 409);
            }
            // Nur der Zeiger: Die Versionen bleiben
            await tx
              .update(seite)
              .set({ veroeffentlichteVersionId: null })
              .where(eq(seite.id, id));
            await audit(tx, person, "seite_zurueckgezogen", id, {});
          });
          meldeWebsiteEreignis({
            art: "version_zurueckgezogen",
            abteilungId: person.abteilungId,
            seiteId: id,
          });
          return c.body(null, 204);
        } catch (fehler) {
          return antworte(c)(fehler);
        }
      })
      .get("/:id/versionen", eingabe("param", pfad()), async (c) => {
        const { id } = c.req.valid("param");
        const z = await ladeMitRecht(db, c.get("person"), id);
        // shortcut: die jüngsten MAX_VERSIONEN ohne Seitenwechsel; ältere über versionen/{nr} erreichbar, Seiten, sobald Seiten so viele Versionen haben
        const zeilen = await db
          .select({
            id: seiteVersion.id,
            nr: seiteVersion.nr,
            autorId: seiteVersion.autorId,
            erstelltAm: seiteVersion.erstelltAm,
          })
          .from(seiteVersion)
          .where(eq(seiteVersion.seiteId, id))
          .orderBy(desc(seiteVersion.nr))
          .limit(MAX_VERSIONEN);
        return c.json({
          versionen: zeilen.map((v) => ({
            nr: v.nr,
            autorId: v.autorId,
            erstelltAm: v.erstelltAm,
            veroeffentlicht: v.id === z.seite.veroeffentlichteVersionId,
          })),
        });
      })
      .get("/:id/versionen/:nr", eingabe("param", versionPfad()), async (c) => {
        const { id, nr } = c.req.valid("param");
        const z = await ladeMitRecht(db, c.get("person"), id);
        const [v] = await db
          .select()
          .from(seiteVersion)
          .where(and(eq(seiteVersion.seiteId, id), eq(seiteVersion.nr, nr)));
        if (!v) throw new HTTPException(404);
        return c.json({
          nr: v.nr,
          autorId: v.autorId,
          erstelltAm: v.erstelltAm,
          veroeffentlicht: v.id === z.seite.veroeffentlichteVersionId,
          dokument: v.inhalt,
        });
      })
      .post(
        "/:id/versionen/:nr/zurueckholen",
        eingabe("param", versionPfad()),
        async (c) => {
          const person = c.get("person");
          const { id, nr } = c.req.valid("param");
          const zaehler = await db.transaction(async (tx) => {
            await ladeGesperrt(tx, person, id);
            const [v] = await tx
              .select({ inhalt: seiteVersion.inhalt })
              .from(seiteVersion)
              .where(
                and(eq(seiteVersion.seiteId, id), eq(seiteVersion.nr, nr)),
              );
            if (!v) throw new HTTPException(404);
            // Eine Kopie in den Entwurf; die veröffentlichte Seite bleibt. Der Zähler zählt weiter: Wer gerade mit altem Stand speichert, bekommt 409
            const [neu] = await tx
              .update(seite)
              .set({
                entwurf: v.inhalt,
                entwurfZaehler: sql`${seite.entwurfZaehler} + 1`,
                geaendertAm: new Date(),
              })
              .where(eq(seite.id, id))
              .returning({ zaehler: seite.entwurfZaehler });
            await audit(tx, person, "seite_zurueckgeholt", id, { nr });
            return neu.zaehler;
          });
          return c.json({ zaehler }, 200);
        },
      )
  );
}

import { and, eq, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  GESPERRT,
  IN_WARTUNG,
  type SchalterZustand,
} from "../../bereichsschalter.js";
import { clientIp } from "../../client-ip.js";
import type { Db } from "../../db/client.js";
import { formularAntwort } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { erstelleBegrenzung } from "../../fotos/begrenzung.js";
import {
  beantworteteFormulare,
  darfFormularSehen,
  istFormularId,
  istGeschlossen,
  ladeVeroeffentlichtes,
  listeSichtbareFormulare,
} from "../../formular/formular.js";
import { log } from "../../log.js";
import type { Person } from "../../rechte.js";
import { ladeGruppen } from "../../sichtbarkeit.js";
import {
  MAX_FELDER,
  pruefeAntworten,
} from "../../website/bausteine-formular.js";

// Lesen für die Apps (#847): GET / listet die offenen Formulare, die die angemeldete Person sieht; GET /:id liefert die veröffentlichte Definition zum Ausfüllen, mit derselben Sichtbarkeit wie das Senden (ohne Anmeldung nur auf öffentlichen Seiten).
// Antworten auf ein Formular der Website (#819): die einzige Route unter /api/v1, die ohne Anmeldung schreibt. Sie hängt vor der Sitzung (app.ts), liest eine vorhandene Sitzung aber mit (optionalePersonAusSitzung): Eine angemeldete Person sendet mit ihrem Konto, alle anderen anonym.
// Nur POST mit JSON. Der Server prüft alles gegen die veröffentlichte Definition aus der Datenbank (nie gegen etwas aus der Anfrage), und die Sichtbarkeit der Seite und des Bausteins entscheidet, wer ausfüllen darf.
// Antwortcodes ohne Informationsleck: Ein Formular, das es nicht gibt, das nicht veröffentlicht ist oder das die Person nicht sehen darf, antwortet gleich mit 404. Fehler in Antworten nennen die Feld-ID und einen Code, nie den Wert.
// Schutz vor Missbrauch ohne Dienst von Dritten: eine Falle (Feld «homepage», bleibt leer), eine Mindestzeit seit dem Laden der Seite, Zähler im Arbeitsspeicher je Adresse, je Formular und je Person, und je Formular eine Obergrenze der Antworten.
// shortcut: Die Zähler liegen im Arbeitsspeicher; ein Neustart setzt sie zurück und mehrere Instanzen zählen getrennt. Die Mindestzeit misst das Skript der Seite, ein Angreifer kann sie fälschen: Sie hält nur einfache Skripte auf. Die Obergrenze der Antworten je Formular ist die harte Grenze.

const MIN_DAUER_MS = 2000;
const FENSTER_MS = 10 * 60_000;
// Je Adresse alle Formulare zusammen, je Adresse und Formular, je Person und Formular, und je Formular von allen anonymen Absendern. Ein Elternabend im selben WLAN soll nicht blockieren
const LIMIT_ADRESSE = 30;
const LIMIT_ADRESSE_FORMULAR = 10;
const LIMIT_PERSON_FORMULAR = 10;
const LIMIT_FORMULAR_ANONYM = 300;

const pfadSchema = z.strictObject({ id: z.string().refine(istFormularId) });
const koerperSchema = z.strictObject({
  antworten: z
    .record(z.string().max(40), z.unknown())
    .refine((a) => Object.keys(a).length <= MAX_FELDER),
  // Die Falle: Menschen sehen das Feld nie
  homepage: z.string().max(200),
  // Millisekunden seit dem Laden der Seite, vom Skript gemessen
  dauerMs: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 3600 * 1000),
});

const NICHT_GEFUNDEN = {
  code: "NICHT_GEFUNDEN",
  message: "Dieses Formular gibt es nicht.",
} as const;
const GESCHLOSSEN = {
  code: "FORMULAR_GESCHLOSSEN",
  message: "Dieses Formular nimmt keine Antworten mehr an.",
} as const;
const ZU_OFT = {
  code: "ZU_OFT",
  message: "Zu viele Versuche. Warte kurz und sende nochmals.",
} as const;
const ZU_SCHNELL = {
  code: "ZU_SCHNELL",
  message: "Das ging sehr schnell. Prüfe deine Angaben und sende nochmals.",
} as const;
const VOLL = {
  code: "FORMULAR_VOLL",
  message: "Dieses Formular nimmt keine weiteren Antworten an.",
} as const;
const SCHON_BEANTWORTET = {
  code: "BEREITS_BEANTWORTET",
  message: "Du hast dieses Formular schon beantwortet.",
} as const;

type Env = { Variables: { person?: Person } };

export function erstelleFormularOeffentlichRoute({
  db,
  schalter,
  optionalePerson,
  jetzt = () => new Date(),
}: {
  db: Db;
  schalter: SchalterZustand;
  // Liest eine vorhandene Sitzung (optionalePersonAusSitzung); als Handler der Route, nicht als use(): Ein use() stünde in der Liste der Routen
  optionalePerson: MiddlewareHandler<Env>;
  jetzt?: () => Date;
}) {
  const adresse = erstelleBegrenzung({
    max: LIMIT_ADRESSE,
    fensterMs: FENSTER_MS,
  });
  const adresseFormular = erstelleBegrenzung({
    max: LIMIT_ADRESSE_FORMULAR,
    fensterMs: FENSTER_MS,
  });
  const personFormular = erstelleBegrenzung({
    max: LIMIT_PERSON_FORMULAR,
    fensterMs: FENSTER_MS,
  });
  const formularAnonym = erstelleBegrenzung({
    max: LIMIT_FORMULAR_ANONYM,
    fensterMs: FENSTER_MS,
  });

  // Gilt irgendwo eine Sperre der Website, sperrt schon diese Prüfung vor jeder anderen (wie die öffentlichen Medien); die Abteilung des Formulars prüft die Route danach genauer
  const sperreIrgendwo: MiddlewareHandler<Env> = async (c, next) => {
    if (schalter.gesperrtIrgendwo(["website", "alles"])) {
      return c.json(GESPERRT, 423);
    }
    await next();
  };

  // Wer ein Konto einer anderen Abteilung hat, gilt wie jede Person ohne Anmeldung
  const sichtFuer = async (person: Person | undefined, abteilungId: string) =>
    person?.abteilungId === abteilungId
      ? { ...person, gruppen: await ladeGruppen(db, person) }
      : null;

  return new Hono<Env>()
    .get("/", optionalePerson, sperreIrgendwo, async (c) => {
      const person = c.get("person");
      if (!person) throw new HTTPException(401);
      if (schalter.trifft(person.abteilungId, "website", "sperre")) {
        return c.json(GESPERRT, 423);
      }
      const sicht = (await sichtFuer(person, person.abteilungId))!;
      return c.json({
        formulare: await listeSichtbareFormulare(db, sicht, jetzt()),
      });
    })
    .get(
      "/:id",
      optionalePerson,
      sperreIrgendwo,
      eingabe("param", pfadSchema),
      async (c) => {
        const formularId = c.req.valid("param").id.toLowerCase();
        const v = await ladeVeroeffentlichtes(db, formularId);
        if (!v) return c.json(NICHT_GEFUNDEN, 404);
        // Lesen: Eine Wartung (nur Ändern gesperrt) berührt die Definition nicht
        if (schalter.trifft(v.abteilungId, "website", "sperre")) {
          return c.json(GESPERRT, 423);
        }
        const sicht = await sichtFuer(c.get("person"), v.abteilungId);
        if (
          !darfFormularSehen(
            sicht,
            v.abteilungId,
            v.seiteSichtbarkeit,
            v.baustein,
          )
        ) {
          return c.json(NICHT_GEFUNDEN, 404);
        }
        const d = v.baustein.daten;
        const beantwortet = sicht
          ? (await beantworteteFormulare(db, sicht, [formularId])).size > 0
          : false;
        // Nur, was das Ausfüllen braucht: nicht die Aufbewahrung, nicht die Obergrenze der Antworten, nie Antworten anderer
        return c.json({
          id: formularId,
          titel: d.titel ?? null,
          einleitung: d.einleitung ?? null,
          felder: d.felder,
          datenschutz: d.datenschutz,
          absenden: d.absenden,
          danke: d.danke,
          schliesstAm: d.schliesstAm ?? null,
          geschlossen: istGeschlossen(v.baustein, jetzt()),
          eineProPerson: d.eineProPerson,
          beantwortet,
        });
      },
    )
    .post(
      "/:id/antworten",
      optionalePerson,
      sperreIrgendwo,
      eingabe("param", pfadSchema),
      eingabe("json", koerperSchema),
      async (c) => {
        const formularId = c.req.valid("param").id.toLowerCase();
        const body = c.req.valid("json");
        const ip = clientIp(c.req.header("x-forwarded-for")) ?? "unbekannt";
        // Erst die billige Grenze je Adresse, bevor die Datenbank gefragt wird
        if (!adresse(ip)) return c.json(ZU_OFT, 429);

        const v = await ladeVeroeffentlichtes(db, formularId);
        if (!v) return c.json(NICHT_GEFUNDEN, 404);
        const b = v.baustein;

        // Sperre und Wartung der Website gelten wie für jede Route der Website (die Anfrage hat hier noch keine Person)
        if (schalter.trifft(v.abteilungId, "website", "sperre")) {
          return c.json(GESPERRT, 423);
        }
        const wartung = schalter.trifft(v.abteilungId, "website", "wartung");
        if (wartung) {
          return c.json(
            {
              ...IN_WARTUNG,
              hinweis: wartung.hinweis,
              ende: wartung.ende?.toISOString() ?? null,
            },
            503,
          );
        }

        // Wer ein Konto einer anderen Abteilung hat, sendet wie jede Person ohne Anmeldung (anonym)
        const person =
          c.get("person")?.abteilungId === v.abteilungId
            ? c.get("person")!
            : null;
        const sicht = await sichtFuer(person ?? undefined, v.abteilungId);
        if (!darfFormularSehen(sicht, v.abteilungId, v.seiteSichtbarkeit, b)) {
          return c.json(NICHT_GEFUNDEN, 404);
        }

        if (istGeschlossen(b, jetzt())) return c.json(GESCHLOSSEN, 410);

        // Die Falle ist gefüllt: Der Absender hört «gesendet», gespeichert wird nichts
        if (body.homepage !== "") {
          log(c, {
            ereignis: "formular_abgewiesen",
            grund: "falle",
            formularId,
          });
          return c.json({ ok: true }, 201);
        }
        if (body.dauerMs < MIN_DAUER_MS) {
          log(c, { ereignis: "formular_abgewiesen", grund: "zu_schnell" });
          return c.json(ZU_SCHNELL, 422);
        }
        if (
          !adresseFormular(`${ip} ${formularId}`) ||
          (person
            ? !personFormular(`${person.id} ${formularId}`)
            : !formularAnonym(formularId))
        ) {
          log(c, {
            ereignis: "formular_abgewiesen",
            grund: "zu_oft",
            formularId,
          });
          return c.json(ZU_OFT, 429);
        }

        const geprueft = pruefeAntworten(b.daten.felder, body.antworten);
        if (!geprueft.ok) {
          return c.json(
            {
              code: "ANTWORTEN_UNGUELTIG",
              message: "Mindestens eine Antwort passt nicht.",
              fehler: geprueft.fehler,
            },
            422,
          );
        }

        const ergebnis = await db.transaction(async (tx) => {
          // Je Formular nacheinander, damit gleichzeitige Antworten die Obergrenze und «eine je Person» nicht überspringen
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${"formular " + formularId}, 0))`,
          );
          const [zahl] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(formularAntwort)
            .where(eq(formularAntwort.formularId, formularId));
          if ((zahl?.n ?? 0) >= b.daten.maxAntworten) return "voll" as const;
          if (person && b.daten.eineProPerson) {
            const [schon] = await tx
              .select({ id: formularAntwort.id })
              .from(formularAntwort)
              .where(
                and(
                  eq(formularAntwort.formularId, formularId),
                  eq(formularAntwort.userId, person.id),
                ),
              )
              .limit(1);
            if (schon) return "schon" as const;
          }
          await tx.insert(formularAntwort).values({
            abteilungId: v.abteilungId,
            seiteId: v.seiteId,
            formularId,
            versionId: v.versionId,
            userId: person?.id ?? null,
            antworten: geprueft.antworten,
            loeschenAm: new Date(
              jetzt().getTime() + b.daten.aufbewahrenTage * 24 * 3600 * 1000,
            ),
          });
          return "ok" as const;
        });
        if (ergebnis === "voll") return c.json(VOLL, 409);
        if (ergebnis === "schon") return c.json(SCHON_BEANTWORTET, 409);
        // Nur die Kennung des Formulars im Log, nie der Inhalt
        log(c, { ereignis: "formular_antwort", formularId });
        return c.json({ ok: true }, 201);
      },
    );
}

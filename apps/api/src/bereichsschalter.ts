import { createMiddleware } from "hono/factory";
import type { Db } from "./db/client.js";
import {
  bereichsschalter,
  SCHALTER_ARTEN,
  SCHALTER_BEREICHE,
} from "./db/schema.js";
import { istEntwickler } from "./plattform.js";
import type { Person } from "./rechte.js";

// Bereichsschalter (#424 Wartungsmodus, #425 Informationssperre).
// Der Zustand wird beim Start aus der Tabelle bereichsschalter geladen und im Speicher gehalten; jede Schaltung aktualisiert ihn. Eine Anfrage fragt die Datenbank nie danach, nur nach dem Entwickler, und nur, wenn ein Schalter den Bereich trifft und die Anfrage sonst blockiert würde (einmal je Anfrage, rechte.ts lädt es je Person-Objekt).
// shortcut: der Speicher gilt nur für diese Instanz; bei mehr als einer Instanz brauchte es LISTEN/NOTIFY oder eine kurze Neuladefrist, sonst wirkt eine Schaltung nur auf der Instanz, die sie bekam.

export const BEREICHE = SCHALTER_BEREICHE;
export const ARTEN = SCHALTER_ARTEN;
export type SchalterBereich = (typeof SCHALTER_BEREICHE)[number];
export type SchalterArt = (typeof SCHALTER_ARTEN)[number];

export type Schalter = {
  id: string;
  abteilungId: string;
  bereich: SchalterBereich;
  art: SchalterArt;
  hinweis: string | null;
  ende: Date | null;
  websiteOffline: boolean;
  ausgeloestVon: string;
  ausgeloestAm: Date;
};

export function erstelleSchalterZustand() {
  // Wenige Einträge (höchstens 12 je Abteilung), eine Liste genügt
  let eintraege: Schalter[] = [];
  return {
    async lade(db: Pick<Db, "select">) {
      eintraege = (await db.select().from(bereichsschalter)) as Schalter[];
    },
    setze(neu: Schalter) {
      eintraege = [
        ...eintraege.filter(
          (e) =>
            !(
              e.abteilungId === neu.abteilungId &&
              e.bereich === neu.bereich &&
              e.art === neu.art
            ),
        ),
        neu,
      ];
    },
    hebeAuf(abteilungId: string, bereich: SchalterBereich, art: SchalterArt) {
      eintraege = eintraege.filter(
        (e) =>
          !(
            e.abteilungId === abteilungId &&
            e.bereich === bereich &&
            e.art === art
          ),
      );
    },
    leer: () => eintraege.length === 0,
    // Für Anfragen ohne Sitzung (öffentliche Medien): Gilt irgendwo eine Sperre dieser Bereiche? Ohne Person ist die Abteilung unbekannt, im Zweifel sperren
    gesperrtIrgendwo: (bereiche: readonly SchalterBereich[]) =>
      eintraege.some((e) => e.art === "sperre" && bereiche.includes(e.bereich)),
    // Hält die Sperre die öffentliche Website vom Netz (der Abgleich erzeugt dann nichts neu)?
    websiteOffline: (abteilungId: string) =>
      eintraege.some(
        (e) =>
          e.abteilungId === abteilungId &&
          e.art === "sperre" &&
          e.websiteOffline &&
          (e.bereich === "website" || e.bereich === "alles"),
      ),
    // Alle Schalter einer Abteilung
    vonAbteilung: (abteilungId: string) =>
      eintraege.filter((e) => e.abteilungId === abteilungId),
    // Der Schalter, der diesen Bereich trifft: der des Bereichs selbst, sonst «alles». Ohne Bereich (zum Beispiel /api/v1/ich) trifft nur «alles»
    trifft(
      abteilungId: string,
      bereich: SchalterBereich | null,
      art: SchalterArt,
    ) {
      const ihre = eintraege.filter(
        (e) => e.abteilungId === abteilungId && e.art === art,
      );
      return (
        ihre.find((e) => e.bereich === bereich) ??
        ihre.find((e) => e.bereich === "alles")
      );
    },
  };
}
export type SchalterZustand = ReturnType<typeof erstelleSchalterZustand>;

// Welcher Bereich eine Route ist; die Routen der Plattform selbst (und alles, was kein Bereich ist) gehören keinem. Nur «alles» trifft einen Pfad ohne Bereich.
// Das Lädeli (Laden, Bestellungen und seine Verwaltung, #566) und die Fotos (#690) gehören zur Website. Kalender, Termine, Anlässe, Terminvorschläge, Räume und Anwesenheit der Stufen sind «programme»; die Lager-Einstellungen der Person (ich/lager-…) sind «lager». Der ICS-Feed (/ical/…) liegt ausserhalb von /api/v1 und prüft den Schalter selbst (routes/termine/ical.ts).
// Der Test «bereichsschalter-routen» geht alle Routen der App durch: Eine neue Route ohne Bereich fällt dort auf, bis sie hier steht oder in seiner Ausnahmeliste.
const BEREICH_NACH_PFAD: [RegExp, SchalterBereich][] = [
  [
    /^\/api\/v1\/(redaktion|website|medien|admin\/medien|laden|admin\/laden|fotos|admin\/fotos)(\/|$)/,
    "website",
  ],
  [
    /^\/api\/v1\/(admin\/lager-dateien|admin\/lager|lager|ich\/lager-[^/]+)(\/|$)/,
    "lager",
  ],
  [/^\/api\/v1\/chats(\/|$)/, "chat"],
  [
    /^\/api\/v1\/(admin\/)?(programme|termine|anlaesse|termin-vorschlaege|kategorie-zuordnungen|raeume)(\/|$)/,
    "programme",
  ],
  [
    /^\/api\/v1\/(ich\/kalender-link|stufen\/[^/]+\/anwesenheit|cevi-db)(\/|$)/,
    "programme",
  ],
  [/^\/api\/v1\/admin(\/|$)/, "verwaltung"],
];
export const bereichVon = (pfad: string) =>
  BEREICH_NACH_PFAD.find(([muster]) => muster.test(pfad))?.[1] ?? null;

// Hierüber schalten und lesen die Berechtigten: nie gesperrt, nie in Wartung
const PLATTFORM = /^\/api\/v1\/plattform(\/|$)/;
const LESEND = new Set(["GET", "HEAD", "OPTIONS"]);
// Die Bearbeitungsansichten der Website sind lesende Anfragen und gehören trotzdem zur Bearbeitung; nur das Panel selbst («ich») bleibt lesbar
const BEARBEITUNG = /^\/api\/v1\/redaktion(\/|$)(?!ich$)/;

// Neutral: Der Text verrät weder den Anlass noch den Hinweis des Schalters
export const GESPERRT = {
  code: "GESPERRT",
  message: "Dieser Bereich ist vorübergehend nicht verfügbar.",
} as const;

export const IN_WARTUNG = {
  code: "IN_WARTUNG",
  message:
    "Dieser Bereich ist in Wartung. Ansehen geht, Ändern ist vorübergehend nicht möglich.",
} as const;

// Hinter personAusSitzung. Ohne aktiven Schalter kostet sie nichts
export function erstelleSchalterPruefung({
  db,
  zustand,
}: {
  db: Db;
  zustand: SchalterZustand;
}) {
  return createMiddleware<{ Variables: { person: Person } }>(
    async (c, next) => {
      if (zustand.leer() || PLATTFORM.test(c.req.path)) return next();
      const person = c.get("person");
      const bereich = bereichVon(c.req.path);
      // Die Sperre gilt für jede Anfrage des Bereichs, auch für die Abteilungsleitung und für lesende; nur /api/v1/plattform (oben) bleibt offen
      if (zustand.trifft(person.abteilungId, bereich, "sperre")) {
        return c.json(GESPERRT, 423);
      }
      const wartung = zustand.trifft(person.abteilungId, bereich, "wartung");
      if (
        wartung &&
        (!LESEND.has(c.req.method) || BEARBEITUNG.test(c.req.path)) &&
        // Abteilungsleitung und Entwickler arbeiten weiter (die Verwaltung bleibt erreichbar)
        !(person.admin || (await istEntwickler(db, person)))
      ) {
        return c.json(
          {
            ...IN_WARTUNG,
            hinweis: wartung.hinweis,
            ende: wartung.ende?.toISOString() ?? null,
          },
          503,
        );
      }
      await next();
    },
  );
}

// Vor der Sitzung, für die öffentlichen Medien (`/api/v1/medien/:id`): Sie gehören zur Website und haben keine Person, darum gilt die Sperre der Website oder von «alles» in irgendeiner Abteilung
export function erstelleSperrePruefungOhnePerson(zustand: SchalterZustand) {
  return createMiddleware(async (c, next) => {
    if (zustand.gesperrtIrgendwo(["website", "alles"])) {
      return c.json(GESPERRT, 423);
    }
    await next();
  });
}

// Für die Anmeldung unter «alles» (auth.ts): Gesperrt ist sie für jede Person ausser der Abteilungsleitung und dem Entwickler, die die Sperre aufheben müssen
export function erstelleAnmeldungGesperrt({
  db,
  zustand,
}: {
  db: Db;
  zustand: SchalterZustand;
}) {
  return async (nutzer: {
    id: string;
    abteilungId: string;
    role?: string | null;
  }) =>
    zustand.trifft(nutzer.abteilungId, null, "sperre") !== undefined &&
    nutzer.role !== "admin" &&
    !(await istEntwickler(db, nutzer));
}

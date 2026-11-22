/// <reference types="vite/client" />
import { randomUUID } from "node:crypto";
import * as schema from "../../src/db/schema.js";
import type { Persona, PersonaKonto, Welt } from "../hilfen/personas.js";

// Gerüst der Lager-Rechte-Matrix (#364). Jedes Modul des Lager-Backends legt seine Zeilen in test/lager/matrix/<modul>.ts ab (Export ZEILEN) und fasst weder diese Datei noch die MATRIX in rechte-matrix.test.ts an. Die Dateien werden per import.meta.glob gefunden; rechte-matrix.test.ts liest sie für die Vollständigkeitsprüfung (jede Lager-Route hat eine Zeile), führt sie aus und schreibt sie in den Postman-Export.
// Eine Zeile gilt für eine Route (Schlüssel «METHODE /pfad» wie bei Hono, Parameter als «:name») und nennt den erwarteten Status je Lager-Persona und je Lager-Zustand.

// Die Personas gegenüber einem Lager der Testabteilung. Konten statt eigener Fabrik: Jede Lager-Persona ist ein Konto der 14 Personas der Rechte-Matrix (KONTO_FUER), die Lager-Rolle kommt aus lager_mitglied
export const LAGER_PERSONAS = [
  // Admin der Abteilung ohne Zeile in lager_mitglied: gilt als Lagerleitung
  "abteilungsleitung",
  "lagerleitung",
  "leitung",
  "team",
  "lesen",
  // Konto der Abteilung ohne Mitgliedschaft
  "ohneMitgliedschaft",
  // Konto einer anderen Abteilung, dort Lagerleitung, dazu eine bewusst falsche Mitgliedszeile im Lager der Testabteilung (was nach einem Fehler beim Setzen der Mitglieder geschehen könnte): Sie gibt nichts frei
  "fremdeAbteilung",
  "ohneLogin",
] as const;
export type LagerPersona = (typeof LAGER_PERSONAS)[number];

export const KONTO_FUER: Record<LagerPersona, Persona> = {
  abteilungsleitung: "admin",
  // Mit zweitem Faktor: Die Lagerleitung braucht ihn nur für die Rechte der Rollen (#523); dieses Konto hat sonst nichts mit dem Lager zu tun
  lagerleitung: "elternB",
  leitung: "slB",
  team: "leitendeA",
  lesen: "leitendeB",
  ohneMitgliedschaft: "elternA",
  fremdeAbteilung: "demoEltern",
  ohneLogin: "ohneLogin",
};

// Zustand des Lagers, gegen das die Anfrage geht: «abgeschlossen» steht für jedes schreibgeschützte Lager (auch archiviert)
export const LAGER_ZUSTAENDE = ["aktiv", "abgeschlossen"] as const;
export type LagerZustand = (typeof LAGER_ZUSTAENDE)[number];

export interface LagerWelt {
  // Für Ziele, die eine Zeile brauchen (zum Beispiel ein Ressort); Zeilen direkt anlegen, nicht über die API
  db: Welt["db"];
  aktivId: string;
  abgeschlossenId: string;
  // Ein Lager der fremden Abteilung (für Routen, die ein fremdes Lager brauchen)
  fremdId: string;
  lagerId(zustand: LagerZustand): string;
  // Aktives Konto der Testabteilung ohne Mitgliedschaft; jede Anfrage mit einem Ziel nimmt ein frisches
  wegwerfPersonId(): Promise<string>;
  // Wie wegwerfPersonId, aber schon Mitglied (Rolle team) des Lagers
  wegwerfMitgliedId(lagerId: string): Promise<string>;
}

export interface LagerZeile {
  erwartet: Record<LagerZustand, Record<LagerPersona, number>>;
  // Bekommt auch die Welt: Ein Body, der Zeilen des Lagers braucht (zum Beispiel einen Lagertag), legt sie direkt in der Datenbank an
  body?: (
    zustand: LagerZustand,
    welt: LagerWelt,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  // Pflicht für jede Route mit Pfad-Parameter; ohne Angabe gilt der Pfad des Schlüssels. Wird pro Anfrage aufgerufen, ein Ziel darf sich also verbrauchen (DELETE)
  url?: (welt: LagerWelt, zustand: LagerZustand) => string | Promise<string>;
  // Die Route darf auch ein geschlossenes Lager ändern (wie lagerZugriff({ auchGeschlossen }))
  auchGeschlossen?: true;
}

export type LagerMatrix = Record<string, LagerZeile>;

// Fasst die ZEILEN der Dateien zusammen; zwei Dateien mit demselben Schlüssel sind ein Fehler, damit eine Zeile nie still eine andere ersetzt
export function fuehreZusammen(
  dateien: Record<string, { ZEILEN: LagerMatrix }>,
): LagerMatrix {
  const matrix: LagerMatrix = {};
  for (const [datei, { ZEILEN }] of Object.entries(dateien)) {
    for (const [schluessel, zeile] of Object.entries(ZEILEN)) {
      if (schluessel in matrix) {
        throw new Error(`Doppelte Matrix-Zeile «${schluessel}» in ${datei}`);
      }
      matrix[schluessel] = zeile;
    }
  }
  return matrix;
}

export const LAGER_MATRIX = fuehreZusammen(
  import.meta.glob<{ ZEILEN: LagerMatrix }>("./matrix/*.ts", { eager: true }),
);

// Rollen der Personas im Lager; die Abteilungsleitung braucht keine Zeile (die Policy macht sie zur Lagerleitung)
const ROLLEN = {
  lagerleitung: "lagerleitung",
  leitung: "leitung",
  team: "team",
  lesen: "lesen",
} as const;

// Legt je Welt einmal an: ein aktives und ein abgeschlossenes Lager der Testabteilung mit allen Mitgliedern, dazu ein Lager der Demo-Abteilung. Die 14 Personas müssen schon bestehen (personasAnlegen in rechte-matrix.test.ts)
export async function legeLagerWeltAn(
  welt: Welt,
  konten: Record<Persona, PersonaKonto>,
): Promise<LagerWelt> {
  const { db } = welt;
  const lager = async (
    abteilungId: string,
    status: "aktiv" | "abgeschlossen",
  ) =>
    (
      await db
        .insert(schema.lager)
        .values({
          abteilungId,
          titel: `Matrix-Lager ${status}`,
          von: "2027-07-10",
          bis: "2027-07-24",
          status,
        })
        .returning({ id: schema.lager.id })
    )[0].id;
  const [aktivId, abgeschlossenId, fremdId] = [
    await lager(welt.testabteilungId, "aktiv"),
    await lager(welt.testabteilungId, "abgeschlossen"),
    await lager(welt.demoAbteilungId, "aktiv"),
  ];
  for (const lagerId of [aktivId, abgeschlossenId]) {
    for (const [persona, rolle] of Object.entries(ROLLEN)) {
      await db.insert(schema.lagerMitglied).values({
        lagerId,
        personId: konten[KONTO_FUER[persona as LagerPersona]].id!,
        rolle,
      });
    }
    // Die falsche Zeile der fremden Abteilung
    await db.insert(schema.lagerMitglied).values({
      lagerId,
      personId: konten[KONTO_FUER.fremdeAbteilung].id!,
      rolle: "lagerleitung",
    });
  }
  await db.insert(schema.lagerMitglied).values({
    lagerId: fremdId,
    personId: konten[KONTO_FUER.fremdeAbteilung].id!,
    rolle: "lagerleitung",
  });

  const wegwerfPersonId = async () =>
    (
      await db
        .insert(schema.user)
        .values({
          name: "Wegwerf Person",
          email: `${randomUUID()}@example.org`,
          username: `wegwerf.${randomUUID().slice(0, 8)}`,
          abteilungId: welt.testabteilungId,
          mussPasswortAendern: false,
        })
        .returning({ id: schema.user.id })
    )[0].id;
  return {
    db,
    aktivId,
    abgeschlossenId,
    fremdId,
    lagerId: (zustand) => (zustand === "aktiv" ? aktivId : abgeschlossenId),
    wegwerfPersonId,
    async wegwerfMitgliedId(lagerId) {
      const personId = await wegwerfPersonId();
      await db
        .insert(schema.lagerMitglied)
        .values({ lagerId, personId, rolle: "team" });
      return personId;
    },
  };
}

// Führt eine Zeile für jede Lager-Persona aus und gibt den beobachteten Status zurück
export async function antwortenJePersona(
  app: {
    request: (url: string, init: RequestInit) => Response | Promise<Response>;
  },
  schluessel: string,
  zeile: LagerZeile,
  lagerWelt: LagerWelt,
  konten: Record<Persona, PersonaKonto>,
  zustand: LagerZustand,
) {
  const [methode, pfad] = schluessel.split(" ");
  const ergebnis = {} as Record<LagerPersona, number>;
  for (const persona of LAGER_PERSONAS) {
    const konto = konten[KONTO_FUER[persona]];
    const body = await zeile.body?.(zustand, lagerWelt);
    const antwort = await app.request(
      (await zeile.url?.(lagerWelt, zustand)) ?? pfad,
      {
        method: methode,
        headers: body
          ? { ...konto.headers, "content-type": "application/json" }
          : konto.headers,
        body: body && JSON.stringify(body),
      },
    );
    ergebnis[persona] = antwort.status;
    // Ein Event-Stream endet nie von selbst: Die Verbindung schliessen, sonst bleibt sie offen (#367)
    if (antwort.headers.get("content-type")?.startsWith("text/event-stream")) {
      await antwort.body?.cancel();
    }
  }
  return ergebnis;
}

// Regeln, die für jede Zeile aller Module gelten (geprüft in matrix-regeln.test.ts): Sie halten die Lager-Rollen aus der Verwaltung heraus und das fremde Lager unsichtbar
export function regelverstoesse(matrix: LagerMatrix): string[] {
  const fehler: string[] = [];
  const pruefe = (
    bedingung: boolean,
    schluessel: string,
    zustand: LagerZustand,
    text: string,
  ) => {
    if (!bedingung) fehler.push(`${schluessel} (${zustand}): ${text}`);
  };
  for (const [schluessel, zeile] of Object.entries(matrix)) {
    const [methode, pfad] = schluessel.split(" ");
    const verwaltung = pfad.startsWith("/api/v1/admin/");
    const lager = pfad.startsWith("/api/v1/lager/");
    if (pfad.includes(":")) {
      if (!zeile.url) fehler.push(`${schluessel}: Pfad-Parameter ohne url`);
    }
    for (const zustand of LAGER_ZUSTAENDE) {
      const e = zeile.erwartet[zustand];
      pruefe(
        e.ohneLogin === 401,
        schluessel,
        zustand,
        "ohneLogin muss 401 sein",
      );
      // Fremde Abteilung: jedes Objekt ist unbekannt, auch für die Lagerleitung dort
      if (pfad.includes(":id")) {
        pruefe(
          e.fremdeAbteilung === 404,
          schluessel,
          zustand,
          "fremdeAbteilung muss 404 sein",
        );
      }
      if (lager) {
        pruefe(
          e.ohneMitgliedschaft === 404,
          schluessel,
          zustand,
          "ohneMitgliedschaft muss 404 sein",
        );
      }
      // Die Lager-Rollen verleihen keine Verwaltungsrechte (Rechteausweitung): nur die Abteilungsleitung kommt durch
      if (verwaltung) {
        for (const p of [
          "lagerleitung",
          "leitung",
          "team",
          "lesen",
          "ohneMitgliedschaft",
        ] as const) {
          pruefe(e[p] === 403, schluessel, zustand, `${p} muss 403 sein`);
        }
      }
      // Ein geschlossenes Lager ist schreibgeschützt: Keine schreibende Lager-Route antwortet mit 2xx
      if (
        lager &&
        zustand === "abgeschlossen" &&
        methode !== "GET" &&
        !zeile.auchGeschlossen
      ) {
        for (const p of LAGER_PERSONAS) {
          pruefe(
            e[p] < 200 || e[p] >= 300,
            schluessel,
            zustand,
            `${p} darf nicht schreiben`,
          );
        }
      }
    }
  }
  return fehler;
}

/// <reference types="vite/client" />
import type { Persona, PersonaKonto, Welt } from "../hilfen/personas.js";

// Gerüst der Rechte-Matrix der Termine (Epic #430, Gerüst #431), nach dem Muster von test/lager/matrix.ts. Jedes Folge-Issue legt seine Zeilen in test/termine/matrix/<modul>.ts ab (Export ZEILEN) und fasst weder diese Datei noch die MATRIX in rechte-matrix.test.ts an. Die Dateien werden per import.meta.glob gefunden; rechte-matrix.test.ts prüft für sie die Vollständigkeit (jede Route der Termine hat eine Zeile, jede Zeile eine Route) und führt sie aus.
// Eine Zeile gilt für eine Route (Schlüssel «METHODE /pfad» wie bei Hono, Parameter als «:name») und nennt den erwarteten Status je Persona.
//
// So hängt sich ein Folge-Issue ein:
//   1. Der Modulname steht in TERMINE_MODULE (so heisst die Datei und der OpenAPI-Marker «termine-pfade: <modul>»). Ein neues Modul trägt es dort ein.
//   2. test/termine/matrix/<modul>.ts exportiert ZEILEN: TermineMatrix mit literalen Werten, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
//   3. Braucht eine Zeile Objekte (ein Termin, ein Vorschlag), exportiert die Datei zusätzlich VORBEREITUNG(welt, konten): Sie legt sie einmal je Welt an und gibt ihre IDs unter frei gewählten Namen zurück; die Zeilen lesen sie in url() und body() aus kontext.ids[<modul>].
//   4. Routen ohne Sitzung (der ICS-Feed) tragen oeffentlich: true; für sie gelten die Regeln zu Anmeldung und Rollen nicht.

// Die Module der Termine, je Datei unter matrix/ und je Marker im OpenAPI. Die Reihenfolge entspricht dem Plan (Welle 1 bis 4)
export const TERMINE_MODULE = [
  // TA2 #433, TA3 #434
  "warnungen",
  "kategorie-zuordnungen",
  // TB1 #435 (Liste und Detail), TB2 #436
  "mein",
  "alle",
  // TC1 #437, TC2 #438
  "kalender-link",
  "ical",
  // TD1 #439, TD2 #440
  "vorschlaege",
  "admin-vorschlaege",
  // TE1 #442, TE2 #443, TE3 #444
  "admin-anlaesse",
  "anlaesse",
  "admin-anmeldungen",
  // TG1 #446, TG2 #447 (Anfragen, Entscheid)
  "raeume",
  "admin-raeume",
  "raum-anfragen",
  // #691
  "cevi-db",
] as const;
export type TermineModul = (typeof TERMINE_MODULE)[number];

// Die Personas der Rechte-Matrix unter Namen, die zur Fachsprache der Termine passen; jede ist ein Konto der 14 Personas (KONTO_FUER)
export const TERMINE_PERSONAS = [
  // Abteilungsleitung mit zweitem Faktor: die Abteilungsleitung
  "abteilungsleitung",
  "adminOhneFaktor",
  "stufenleitungA",
  "stufenleitungB",
  "leitungA",
  "leitungB",
  // Leitung der Stufe A und Elternteil eines Kindes der Stufe B
  "leitungAElternB",
  "elternA",
  "elternB",
  // Startpasswort noch nicht geändert: gesperrt auf allen Routen ausser GET /api/v1/ich
  "passwortPflicht",
  "deaktiviert",
  "ohneLogin",
  // Konten der Demo-Abteilung: gegenüber der Testabteilung die fremde Abteilung
  "fremdeAbteilungsleitung",
  "fremdeEltern",
] as const;
export type TerminePersona = (typeof TERMINE_PERSONAS)[number];

export const KONTO_FUER: Record<TerminePersona, Persona> = {
  abteilungsleitung: "admin",
  adminOhneFaktor: "adminOhneZweitenFaktor",
  stufenleitungA: "slA",
  stufenleitungB: "slB",
  leitungA: "leitendeA",
  leitungB: "leitendeB",
  leitungAElternB: "leitendeAElternB",
  elternA: "elternA",
  elternB: "elternB",
  passwortPflicht: "mussPasswortAendern",
  deaktiviert: "deaktiviert",
  ohneLogin: "ohneLogin",
  fremdeAbteilungsleitung: "demoAdmin",
  fremdeEltern: "demoEltern",
};

// Alles, was eine Zeile zum Aufbauen ihrer Anfrage braucht
export interface TermineKontext {
  welt: Welt;
  konten: Record<Persona, PersonaKonto>;
  // IDs der Objekte, die VORBEREITUNG der Module angelegt hat, je Modul
  ids: Record<string, Record<string, string>>;
}

export interface TermineZeile {
  erwartet: Record<TerminePersona, number>;
  body?: (kontext: TermineKontext) => Record<string, unknown>;
  // Pflicht für jede Route mit Pfad-Parameter; ohne Angabe gilt der Pfad des Schlüssels. Wird pro Anfrage aufgerufen, ein Ziel darf sich also verbrauchen (DELETE)
  url?: (kontext: TermineKontext) => string | Promise<string>;
  // Die Route braucht keine Sitzung (ICS-Feed): Die Regeln zu Anmeldung und Rollen gelten nicht
  oeffentlich?: true;
}

export type TermineMatrix = Record<string, TermineZeile>;

export interface TermineModulDatei {
  ZEILEN: TermineMatrix;
  VORBEREITUNG?: (
    welt: Welt,
    konten: Record<Persona, PersonaKonto>,
  ) => Promise<Record<string, string>>;
}

// Fasst die ZEILEN der Dateien zusammen; zwei Dateien mit demselben Schlüssel sind ein Fehler, damit eine Zeile nie still eine andere ersetzt
export function fuehreZusammen(
  dateien: Record<string, { ZEILEN: TermineMatrix }>,
): TermineMatrix {
  const matrix: TermineMatrix = {};
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

const DATEIEN = import.meta.glob<TermineModulDatei>("./matrix/*.ts", {
  eager: true,
});

// Die Modulnamen der gefundenen Dateien, zum Vergleich mit TERMINE_MODULE
const modulName = (pfad: string) =>
  pfad.replace(/^\.\/matrix\//, "").replace(/\.ts$/, "");
export const MATRIX_MODULE = Object.keys(DATEIEN).map(modulName);

export const TERMINE_MATRIX = fuehreZusammen(DATEIEN);

// Führt die VORBEREITUNG jedes Moduls einmal je Welt aus; die 14 Personas müssen schon bestehen (personasAnlegen in rechte-matrix.test.ts)
export async function legeTermineKontextAn(
  welt: Welt,
  konten: Record<Persona, PersonaKonto>,
): Promise<TermineKontext> {
  const ids: TermineKontext["ids"] = {};
  for (const [pfad, datei] of Object.entries(DATEIEN)) {
    if (!datei.VORBEREITUNG) continue;
    ids[modulName(pfad)] = await datei.VORBEREITUNG(welt, konten);
  }
  return { welt, konten, ids };
}

// Führt eine Zeile für jede Persona aus und gibt den beobachteten Status zurück
export async function antwortenJePersona(
  app: {
    request: (url: string, init: RequestInit) => Response | Promise<Response>;
  },
  schluessel: string,
  zeile: TermineZeile,
  kontext: TermineKontext,
) {
  const [methode, pfad] = schluessel.split(" ");
  const ergebnis = {} as Record<TerminePersona, number>;
  for (const persona of TERMINE_PERSONAS) {
    const konto = kontext.konten[KONTO_FUER[persona]];
    const body = zeile.body?.(kontext);
    const antwort = await app.request((await zeile.url?.(kontext)) ?? pfad, {
      method: methode,
      headers: body
        ? { ...konto.headers, "content-type": "application/json" }
        : konto.headers,
      body: body && JSON.stringify(body),
    });
    ergebnis[persona] = antwort.status;
  }
  return ergebnis;
}

// Regeln, die für jede Zeile aller Module gelten (geprüft in matrix-regeln.test.ts): Sie halten die Verwaltung der Abteilungsleitung vor und das fremde Objekt unsichtbar
export function regelverstoesse(matrix: TermineMatrix): string[] {
  const fehler: string[] = [];
  for (const [schluessel, zeile] of Object.entries(matrix)) {
    const pfad = schluessel.split(" ")[1];
    const e = zeile.erwartet;
    const pruefe = (bedingung: boolean, text: string) => {
      if (!bedingung) fehler.push(`${schluessel}: ${text}`);
    };
    if (pfad.includes(":")) {
      pruefe(zeile.url !== undefined, "Pfad-Parameter ohne url");
    }
    if (zeile.oeffentlich) continue;
    // Gesperrte oder fehlende Konten kommen nirgends durch (#15, Sitzung)
    pruefe(e.ohneLogin === 401, "ohneLogin muss 401 sein");
    pruefe(e.deaktiviert === 401, "deaktiviert muss 401 sein");
    pruefe(e.passwortPflicht === 403, "passwortPflicht muss 403 sein");
    // Fremdabteilung: Jedes Objekt ist unbekannt, auch für deren Abteilungsleitung (erst Objekt laden, dann Recht)
    if (pfad.includes(":")) {
      for (const p of ["fremdeAbteilungsleitung", "fremdeEltern"] as const) {
        pruefe(e[p] === 404, `${p} muss 404 sein`);
      }
    }
    // Verwaltung: nur die Abteilungsleitung mit zweitem Faktor (und die der fremden Abteilung für deren Daten); jede Rolle ohne Verwaltungsrecht bekommt 403, auch Stufenleitung und Leitung
    if (pfad.startsWith("/api/v1/admin/")) {
      for (const p of [
        "adminOhneFaktor",
        "stufenleitungA",
        "stufenleitungB",
        "leitungA",
        "leitungB",
        "leitungAElternB",
        "elternA",
        "elternB",
      ] as const) {
        pruefe(e[p] === 403, `${p} muss 403 sein`);
      }
      if (!pfad.includes(":")) {
        pruefe(e.fremdeEltern === 403, "fremdeEltern muss 403 sein");
      }
    }
  }
  return fehler;
}

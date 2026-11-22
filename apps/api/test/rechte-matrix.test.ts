import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import sharp from "sharp";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import { erstelleApp } from "../src/app.js";
import {
  kodiereMedienbild,
  kodiereProfilbild,
  kodiereStufenlogo,
} from "../src/bild-sharp.js";
import type { Medienspeicher } from "../src/medien-speicher.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import {
  bereiteAuthTestsVor,
  erstelleTestAuth,
  geschlossenePfade,
  PASSWORT,
} from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  PERSONAS,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { legeProgrammAn } from "./hilfen/programme.js";
import {
  antwortenJePersona,
  LAGER_MATRIX,
  LAGER_ZUSTAENDE,
  legeLagerWeltAn,
  type LagerWelt,
} from "./lager/matrix.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
// Eine Attrappe statt S3: Kein Test der Matrix soll ins Netz gehen
const medienObjekte = new Map<string, Uint8Array>();
const medienspeicher: Medienspeicher = {
  ablegen: async (inhalt) => {
    const schluessel = randomUUID();
    medienObjekte.set(schluessel, inhalt);
    return schluessel;
  },
  holen: async (schluessel) =>
    medienObjekte.get(schluessel) ?? new Uint8Array(),
  loeschen: async (schluessel) => {
    medienObjekte.delete(schluessel);
  },
};
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  kodiereBild: kodiereProfilbild,
  kodiereLogo: kodiereStufenlogo,
  kodiereMedienbild,
  medienspeicher,
  // Eine Attrappe statt firebase-admin: Ohne Push-Dienst antwortet die Mitteilung mit 503, und kein Test der Matrix soll ins Netz gehen
  fcm: {
    sendEach: async (nachrichten) => ({
      responses: nachrichten.map(() => ({ success: true })),
    }),
  },
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

const FALSCH = "nur-fuer-tests-falsch";

interface Zeile {
  // Literale Werte: beobachtet und gegen better-auth gegengelesen, nie aus rechte.ts berechnet
  erwartet: Record<Persona, number>;
  body?: (konto: PersonaKonto) => Record<string, unknown>;
  // Statt body: Der Body ist das Bild selbst (Profilbild-Upload)
  bild?: true;
  // Die Collection lässt die Zeile aus: Sie braucht den Medienspeicher, den die lokale API der Collection nicht hat
  ohnePostman?: true;
  // Für Zeilen, die die Sitzungen der geteilten Personas beenden würden
  frischePersonas?: true;
  // Pflicht für jede Route mit Pfad-Parameter: ein Objekt der Testabteilung
  url?: (welt: Welt) => string;
  // Statt url, wenn jede Anfrage ihr Ziel verbraucht (DELETE): eine frische URL pro Persona
  urlJeAnfrage?: () => Promise<string>;
}

const alle = (status: number) =>
  Object.fromEntries(PERSONAS.map((p) => [p, status])) as Record<
    Persona,
    number
  >;

const MATRIX: Record<string, Zeile> = {
  "GET /health": { erwartet: alle(200) },
  // Statische Seiten und .well-known: offen für alle, auch deaktiviert und ohne Login
  "GET /datenschutz": { erwartet: alle(200) },
  "GET /konto-loeschen": { erwartet: alle(200) },
  "GET /support": { erwartet: alle(200) },
  // Verwaltung im Browser (#141): statische Dateien, die Daten kommen erst über die abgesicherten Admin-Routen
  "GET /admin": { erwartet: alle(200) },
  "GET /admin/admin.css": { erwartet: alle(200) },
  "GET /admin/admin.js": { erwartet: alle(200) },
  "GET /admin/api.js": { erwartet: alle(200) },
  "GET /admin/dom.js": { erwartet: alle(200) },
  "GET /admin/favicon.svg": { erwartet: alle(200) },
  "GET /admin/hintergrund.svg": { erwartet: alle(200) },
  "GET /admin/kalender.js": { erwartet: alle(200) },
  "GET /admin/kinder.js": { erwartet: alle(200) },
  "GET /admin/mitteilungen.js": { erwartet: alle(200) },
  "GET /admin/personen.js": { erwartet: alle(200) },
  "GET /admin/stufen.js": { erwartet: alle(200) },
  "GET /admin/system.js": { erwartet: alle(200) },
  "GET /admin/tags.js": { erwartet: alle(200) },
  "GET /admin/uebersicht.js": { erwartet: alle(200) },
  "GET /admin/zeitregeln.js": { erwartet: alle(200) },
  "GET /admin/csv.js": { erwartet: alle(200) },
  "GET /admin/import.js": { erwartet: alle(200) },
  "GET /admin/website.js": { erwartet: alle(200) },
  "GET /admin/website.css": { erwartet: alle(200) },
  "GET /admin/website-seiten.js": { erwartet: alle(200) },
  "GET /admin/website-seiten.css": { erwartet: alle(200) },
  "GET /admin/website-editor.js": { erwartet: alle(200) },
  "GET /admin/website-editor.css": { erwartet: alle(200) },
  "GET /admin/website-medien.js": { erwartet: alle(200) },
  "GET /admin/website-medien.css": { erwartet: alle(200) },
  "GET /admin/website-stufenfakten.js": { erwartet: alle(200) },
  "GET /admin/website-stufenfakten.css": { erwartet: alle(200) },
  "GET /.well-known/apple-app-site-association": { erwartet: alle(200) },
  "GET /.well-known/assetlinks.json": { erwartet: alle(200) },
  "POST /api/auth/sign-in/username": {
    // Eigene Zugangsdaten; ohneLogin mit erfundenem Namen. Deaktiviert und unbekannt bekommen dieselbe 401-Meldung (#15)
    body: (konto) => ({
      username: konto.benutzername ?? "gibt.es.nicht",
      password: konto.passwort ?? PASSWORT,
    }),
    erwartet: { ...alle(200), deaktiviert: 401, ohneLogin: 401 },
  },
  "POST /api/auth/sign-out": {
    // Auch ohne oder mit abgelaufener Sitzung 200: better-auth räumt nur das Cookie weg
    frischePersonas: true,
    erwartet: alle(200),
  },
  "GET /api/auth/get-session": { erwartet: alle(200) },
  "POST /api/auth/change-password": {
    // Falsches Passwort: better-auth prüft es, bevor es etwas schreibt
    body: () => ({
      currentPassword: FALSCH,
      newPassword: "nur-fuer-tests-neu-1",
    }),
    erwartet: { ...alle(400), deaktiviert: 401, ohneLogin: 401 },
  },
  "POST /api/auth/revoke-sessions": {
    frischePersonas: true,
    erwartet: { ...alle(200), deaktiviert: 401, ohneLogin: 401 },
  },
  "POST /api/auth/two-factor/verify-totp": {
    // Falscher Code; mit Sitzung zählt better-auth keinen Fehlversuch, Sperre und Versuchsbudget gelten nur der Anmeldung
    body: () => ({ code: "000000" }),
    erwartet: {
      ...alle(400),
      admin: 401,
      demoAdmin: 401,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/auth/two-factor/verify-backup-code": {
    body: () => ({ code: "falsch-falsch" }),
    erwartet: {
      ...alle(400),
      admin: 401,
      demoAdmin: 401,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/auth/two-factor/enable": {
    body: () => ({ password: FALSCH }),
    erwartet: {
      ...alle(404),
      admin: 400,
      adminOhneZweitenFaktor: 400,
      demoAdmin: 400,
    },
  },
  // Die Felder je Rolle prüft test/ich.test.ts; GET /ich bleibt als einzige /api/v1-Route auch unter dem Pflichtwechsel offen (#15)
  "GET /api/v1/ich": {
    erwartet: { ...alle(200), deaktiviert: 401, ohneLogin: 401 },
  },
  "POST /api/v1/ich/datenschutz": {
    // Schreibt datenschutz_gelesen_am, darum eigene Personas
    frischePersonas: true,
    erwartet: {
      ...alle(204),
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "PATCH /api/v1/ich": {
    // Schreibt push_chat, darum eigene Personas; die Felder prüft test/ich.test.ts
    frischePersonas: true,
    body: () => ({ pushChat: false }),
    erwartet: {
      ...alle(204),
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  // Die Felder je Rolle prüft test/programme.test.ts, die Zuordnungsregeln test/zuordnung.test.ts; hier zählt der Status.
  // adminOhneZweitenFaktor wie admin: #23 sperrt nur /api/v1/admin/*. mussPasswortAendern: #15 sperrt das Konto auf allen Routen ausser GET /api/v1/ich
  "GET /api/v1/programme": {
    // Ohne Fenster antwortet die Route 400, darum eine URL trotz fehlendem Pfad-Parameter
    url: () => "/api/v1/programme?von=2027-01-01&bis=2027-12-31",
    erwartet: {
      ...alle(200),
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "GET /api/v1/programme/:id": {
    url: () => `/api/v1/programme/${programmId}`,
    erwartet: {
      ...alle(200),
      mussPasswortAendern: 403,
      leitendeB: 404,
      elternB: 404,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Kontakte (#39): Namen der SL für alle, die das Programm sehen; die Nummer gibt es nur Eltern mit aktivem Kind in der Stufe der SL (test/kontakte.test.ts). Antworten tragen Cache-Control: no-store
  "GET /api/v1/programme/:id/kontakte": {
    url: () => `/api/v1/programme/${programmId}/kontakte`,
    erwartet: {
      ...alle(200),
      mussPasswortAendern: 403,
      leitendeB: 404,
      elternB: 404,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "PUT /api/v1/programme/:id/zuordnung": {
    url: () => `/api/v1/programme/${programmId}/zuordnung`,
    // Der aktuelle Stand als No-op: Der Matrix-Lauf verändert nichts
    body: () => ({ stufen: [welt.stufeAId], sichtbarkeit: "eltern" }),
    erwartet: {
      ...alle(204),
      leitendeA: 403,
      leitendeAElternB: 403,
      elternA: 403,
      mussPasswortAendern: 403,
      leitendeB: 404,
      elternB: 404,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "PUT /api/v1/programme/:id/teilnahmen/:kindId": {
    url: () => `/api/v1/programme/${programmId}/teilnahmen/${welt.kindAId}`,
    // Immer dieselbe Antwort: Der Matrix-Lauf überschreibt sie nur mit sich selbst
    body: () => ({ status: "ja" }),
    // Zuständig sind Admins, die Leitung der Stufe des Kindes (SL eingeschlossen) und die Eltern des Kindes; slB sieht das Programm, ist aber für Stufe A nicht zuständig
    erwartet: {
      ...alle(204),
      slB: 403,
      mussPasswortAendern: 403,
      leitendeB: 404,
      elternB: 404,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Übersicht (#38): Admin sowie Leitung und SL der Stufe sehen die Liste, Eltern ihr Kind; slB sieht das Programm, hat aber kein Recht darauf. Die Inhalte je Rolle prüft test/teilnahmen-uebersicht.test.ts
  "GET /api/v1/programme/:id/teilnahmen": {
    url: () => `/api/v1/programme/${programmId}/teilnahmen`,
    erwartet: {
      ...alle(200),
      slB: 403,
      mussPasswortAendern: 403,
      leitendeB: 404,
      elternB: 404,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Eigenes Programm mit Beginn in einem Jahr: Das von programmId hat am 6. März 2027 begonnen, ab dann wäre jedes 204 ein 409. Admin und SL anderer Stufen sehen es, haben aber kein Recht
  "PUT /api/v1/programme/:id/leitung": {
    url: () => `/api/v1/programme/${leitungProgrammId}/leitung`,
    body: () => ({ status: "ja" }),
    erwartet: {
      ...alle(204),
      admin: 403,
      adminOhneZweitenFaktor: 403,
      slB: 403,
      elternA: 403,
      mussPasswortAendern: 403,
      leitendeB: 404,
      elternB: 404,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Verwaltung (#18): nur Admins, und ohne zweiten Faktor sperrt die Middleware (#23) jede Admin-Route mit 403. Status in test/admin-personen.test.ts begründet
  // Betriebszahlen (#143): nur Admins, wie die übrigen Admin-Routen; Inhalt in test/admin-system.test.ts
  "GET /api/v1/admin/system": {
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "GET /api/v1/admin/system/requests": {
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  // Ausgaben der Hintergrund-Abrufe (#267): nur Admins; Inhalt in test/admin-system.test.ts. Die Matrix-App hat keine Abrufe, darum antwortet der Knopf 501
  "GET /api/v1/admin/system/syncs": {
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/v1/admin/system/syncs/eckdaten": {
    erwartet: {
      ...alle(403),
      admin: 501,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 501,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/v1/admin/system/syncs/kalender": {
    erwartet: {
      ...alle(403),
      admin: 501,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 501,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "GET /api/v1/admin/personen": {
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/v1/admin/personen": {
    // Eigener Benutzername pro Persona; leere Listen, weil Testabteilungs-IDs dem demoAdmin 400 gäben
    body: () => ({
      vorname: "Matrix",
      nachname: "Person",
      benutzername: `matrix.${randomUUID().slice(0, 8)}`,
      admin: false,
      rollen: [],
      elternteilVon: [],
    }),
    erwartet: {
      ...alle(403),
      admin: 201,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 201,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "PATCH /api/v1/admin/personen/:id": {
    url: () => `/api/v1/admin/personen/${patchZielId}`,
    body: () => ({ name: "Matrix Person" }),
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "POST /api/v1/admin/personen/:id/startpasswort": {
    url: () => `/api/v1/admin/personen/${startpasswortZielId}/startpasswort`,
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "POST /api/v1/admin/personen/:id/deaktivieren": {
    url: () => `/api/v1/admin/personen/${deaktivierenZielId}/deaktivieren`,
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "POST /api/v1/admin/personen/:id/aktivieren": {
    url: () => `/api/v1/admin/personen/${aktivierenZielId}/aktivieren`,
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "POST /api/v1/admin/personen/:id/zweiter-faktor-zuruecksetzen": {
    // Jede Anfrage setzt den Faktor ihres Ziels zurück; ein Ziel mit Faktor je Anfrage
    urlJeAnfrage: async () =>
      `/api/v1/admin/personen/${await wegwerfPersonId(true)}/zweiter-faktor-zuruecksetzen`,
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "DELETE /api/v1/admin/personen/:id": {
    // Jede Anfrage löscht ihr Ziel; eine feste URL nähme es allen nach dem ersten Admin weg
    urlJeAnfrage: async () =>
      `/api/v1/admin/personen/${await wegwerfPersonId()}`,
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Stufen und Kinder (#19): GET /stufen liest jede Person mit Sitzung, die übrigen Routen nur Admins. PATCH-Bodies mit den aktuellen Werten, damit der Lauf nichts verändert; Status in test/admin-stufen.test.ts und test/admin-kinder.test.ts begründet
  "GET /api/v1/stufen": {
    erwartet: {
      ...alle(200),
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  // Medienspeicher (#335): Hochladen, Liste und Löschen nur Admins; ein Medium mit Sichtbarkeit «angemeldet» liest jede Person der Abteilung mit Sitzung, fremde Abteilungen sehen es nicht. Öffentliche Medien (ohne Sitzung, auch für gesperrte Konten) und Typ, Grösse, Alt-Text und Ausfall des Speichers prüft test/medien.test.ts. Der Upload ist binär und fehlt darum in der Postman-Collection
  "POST /api/v1/admin/medien": {
    url: () => "/api/v1/admin/medien?sichtbarkeit=angemeldet&altText=Matrix",
    bild: true,
    erwartet: {
      ...alle(403),
      admin: 201,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 201,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "GET /api/v1/admin/medien": {
    ohnePostman: true,
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "DELETE /api/v1/admin/medien/:id": {
    ohnePostman: true,
    urlJeAnfrage: async () => `/api/v1/admin/medien/${await wegwerfMediumId()}`,
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "GET /api/v1/medien/:id": {
    ohnePostman: true,
    url: () => `/api/v1/medien/${mediumId}`,
    erwartet: {
      ...alle(200),
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Stufenlogo (#212): Hochladen und Löschen nur Admins; ansehen darf jede Person der Abteilung. Typ und Grösse prüft test/stufenlogo.test.ts
  "PUT /api/v1/admin/stufen/:id/logo": {
    url: () => `/api/v1/admin/stufen/${patchStufeId}/logo`,
    bild: true,
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "DELETE /api/v1/admin/stufen/:id/logo": {
    url: () => `/api/v1/admin/stufen/${patchStufeId}/logo`,
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "GET /api/v1/stufen/:id/logo": {
    url: () => `/api/v1/stufen/${welt.stufeAId}/logo`,
    erwartet: {
      ...alle(200),
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Kontakte der Stufe (#39): Admin, Leitende und SL der Stufe sowie Eltern mit aktivem Kind darin; alle anderen und fremde Abteilungen sehen die Stufe nicht
  "GET /api/v1/stufen/:id/kontakte": {
    url: () => `/api/v1/stufen/${welt.stufeAId}/kontakte`,
    erwartet: {
      ...alle(200),
      slB: 404,
      leitendeB: 404,
      elternB: 404,
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Anwesenheit (#192): Admin sowie Leitende und SL der Stufe lesen und erfassen; Eltern und fremde Stufen haben kein Recht. Die Inhalte, die Frist und die Ziele prüft test/anwesenheit.test.ts
  "GET /api/v1/stufen/:id/anwesenheit": {
    url: () => `/api/v1/stufen/${welt.stufeAId}/anwesenheit`,
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 200,
      slA: 200,
      leitendeA: 200,
      leitendeAElternB: 200,
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "PUT /api/v1/stufen/:id/anwesenheit/:programmId/kinder/:kindId": {
    url: () =>
      `/api/v1/stufen/${welt.stufeAId}/anwesenheit/${anwesenheitProgrammId}/kinder/${welt.kindAId}`,
    // Immer derselbe Stand: Der Matrix-Lauf überschreibt ihn nur mit sich selbst
    body: () => ({ da: true }),
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 204,
      slA: 204,
      leitendeA: 204,
      leitendeAElternB: 204,
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "PUT /api/v1/stufen/:id/anwesenheit/:programmId/leitende/:userId": {
    url: () =>
      `/api/v1/stufen/${welt.stufeAId}/anwesenheit/${anwesenheitProgrammId}/leitende/${anwesenheitLeitungId}`,
    body: () => ({ da: true }),
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 204,
      slA: 204,
      leitendeA: 204,
      leitendeAElternB: 204,
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Profilbild (#173): Jede Person mit Sitzung lädt ihr eigenes hoch und löscht es; nur die Person selbst, nie eine andere. Typ, Grösse und Rate-Limit prüft test/profilbild.test.ts. Das Bild einer Person sieht, wer ihren Namen ohnehin sieht; die Wege dahin ebenfalls dort
  "PUT /api/v1/ich/bild": {
    bild: true,
    erwartet: {
      ...alle(204),
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "DELETE /api/v1/ich/bild": {
    // Löscht das Bild der Persona; slA und Co. behalten ihres für die Zeile darunter
    frischePersonas: true,
    erwartet: {
      ...alle(204),
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  // Ziel ist eine SL der Stufe A ohne Chat und ohne Abmeldung: Es bleiben die Kontakte der Stufe (Admin, Leitende und SL der Stufe, Eltern mit aktivem Kind darin) und die Kontakte der Programme der Stufe A (slB: Eine SL sieht jedes Programm, und «offen» bleibt Kontakt)
  "GET /api/v1/personen/:id/bild": {
    url: () => `/api/v1/personen/${bildZielId}/bild`,
    erwartet: {
      ...alle(200),
      leitendeB: 404,
      elternB: 404,
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "POST /api/v1/admin/stufen": {
    // Jeder Aufruf braucht einen eigenen Namen: In einer Abteilung ist er eindeutig
    body: () => ({ name: `Matrix Stufe ${++stufenZaehler}`, kuerzel: "M" }),
    erwartet: {
      ...alle(403),
      admin: 201,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 201,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "PATCH /api/v1/admin/stufen/:id": {
    url: () => `/api/v1/admin/stufen/${patchStufeId}`,
    body: () => ({ name: `Matrix Stufe ${++stufenZaehler}`, kuerzel: "M" }),
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Reihenfolge der SL einer Stufe (#287): nur Admins; Wirkung und Fehler in test/admin-stufen.test.ts
  "PUT /api/v1/admin/stufen/:id/stufenleitung": {
    url: () => `/api/v1/admin/stufen/${patchStufeId}/stufenleitung`,
    body: () => ({ ids: [] }),
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "DELETE /api/v1/admin/stufen/:id": {
    // Jede Anfrage löscht ihr Ziel; die Antworten für Eltern und SL (403) lassen es stehen
    urlJeAnfrage: async () => `/api/v1/admin/stufen/${await wegwerfStufeId()}`,
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Mitteilung per Push (#240): nur Admins; Inhalt, Empfänger, Audit-Log und Limit in test/admin-mitteilungen.test.ts
  "POST /api/v1/admin/mitteilungen": {
    body: () => ({ titel: "Matrix-Mitteilung", empfaenger: "alle" }),
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "GET /api/v1/admin/kinder": {
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/v1/admin/kinder": {
    // Die Stufe der eigenen Abteilung: Mit einer fremden gäbe der Demo-Admin 400
    body: (konto) => ({
      vorname: "Matrix",
      nachname: "Kind",
      stufeId:
        konto.abteilungId === welt.demoAbteilungId
          ? welt.demoStufeId
          : welt.stufeAId,
    }),
    erwartet: {
      ...alle(403),
      admin: 201,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 201,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  // Je Persona eine eigene Zeile mit zufälligem Namen; nur Kinder, damit kein Konto (scrypt) entsteht
  "POST /api/v1/admin/import/vorschau": {
    body: (konto) => ({
      stufeId:
        konto.abteilungId === welt.demoAbteilungId
          ? welt.demoStufeId
          : welt.stufeAId,
      zeilen: [{ vorname: "Matrix", nachname: randomUUID(), art: "kind" }],
    }),
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/v1/admin/import": {
    body: (konto) => ({
      stufeId:
        konto.abteilungId === welt.demoAbteilungId
          ? welt.demoStufeId
          : welt.stufeAId,
      zeilen: [{ vorname: "Matrix", nachname: randomUUID(), art: "kind" }],
    }),
    erwartet: {
      ...alle(403),
      admin: 201,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 201,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "PATCH /api/v1/admin/kinder/:id": {
    url: () => `/api/v1/admin/kinder/${patchKindId}`,
    // Ohne eltern: Die Liste von Kind A hinge von den angelegten Personas ab
    body: () => ({
      vorname: "Matrix",
      nachname: "Kind",
      stufeId: welt.stufeAId,
      aktiv: true,
    }),
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "DELETE /api/v1/admin/kinder/:id": {
    // Jede Anfrage löscht ihr Ziel
    urlJeAnfrage: async () => `/api/v1/admin/kinder/${await wegwerfKindId()}`,
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "GET /api/v1/admin/zeitregeln": {
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/v1/admin/zeitregeln": {
    body: () => ({
      stufeId: null,
      wochentag: 3,
      uhrzeit: "08:00",
      text: "{Programm} am {Datum}",
      aktiv: true,
    }),
    erwartet: {
      ...alle(403),
      admin: 201,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 201,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "PATCH /api/v1/admin/zeitregeln/:id": {
    url: () => `/api/v1/admin/zeitregeln/${patchRegelId}`,
    body: () => ({ uhrzeit: "09:30" }),
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "DELETE /api/v1/admin/zeitregeln/:id": {
    // Jede Anfrage löscht ihr Ziel
    urlJeAnfrage: async () =>
      `/api/v1/admin/zeitregeln/${await wegwerfRegelId()}`,
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Tags (#331): nur Admins; Wirkung, Fehler und Audit-Log in test/admin-tags.test.ts
  "GET /api/v1/admin/tags": {
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/v1/admin/tags": {
    // Jeder Aufruf braucht einen eigenen Namen: In einer Abteilung ist er eindeutig
    body: () => ({ typ: "team", name: `Matrix Tag ${++tagZaehler}` }),
    erwartet: {
      ...alle(403),
      admin: 201,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 201,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "GET /api/v1/admin/tags/:id": {
    url: () => `/api/v1/admin/tags/${patchTagId}`,
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "PATCH /api/v1/admin/tags/:id": {
    url: () => `/api/v1/admin/tags/${patchTagId}`,
    body: () => ({ name: `Matrix Tag ${++tagZaehler}` }),
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "DELETE /api/v1/admin/tags/:id": {
    // Jede Anfrage löscht ihr Ziel
    urlJeAnfrage: async () => `/api/v1/admin/tags/${await wegwerfTagId()}`,
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "PUT /api/v1/admin/tags/:id/personen/:userId": {
    url: () => `/api/v1/admin/tags/${patchTagId}/personen/${tagPersonId}`,
    body: () => ({ rolle: "Matrix", prioritaet: 1 }),
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "DELETE /api/v1/admin/tags/:id/personen/:userId": {
    // Jede Anfrage entzieht ihre Zuordnung
    urlJeAnfrage: async () =>
      `/api/v1/admin/tags/${await wegwerfTagId(tagPersonId)}/personen/${tagPersonId}`,
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Bearbeitungsrechte (#334): nur Admins; Wirkung der Rechte in test/bearbeiten.test.ts
  "GET /api/v1/admin/bearbeiter": {
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/v1/admin/bearbeiter": {
    // Redaktion f�r eine Person der Testabteilung; die Demo-Abteilung kennt sie nicht
    body: () => ({ objektTyp: "seite", userId: tagPersonId }),
    erwartet: {
      ...alle(403),
      admin: 201,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
    },
  },
  "DELETE /api/v1/admin/bearbeiter/:id": {
    // Jede Anfrage entzieht ihr Recht
    urlJeAnfrage: async () =>
      `/api/v1/admin/bearbeiter/${await wegwerfBearbeiterId()}`,
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Seiten der Website (#348): Zugang für Admin, Stufenleitung und Redaktion, Recht je Seite über bearbeiten.ts; die Wirkung steht in test/redaktion-seiten.test.ts. Die Seite der Matrix gehört zur Stufe A: Stufenleitung A bearbeitet sie, Stufenleitung B nicht
  "GET /api/v1/redaktion/seiten": {
    erwartet: {
      ...alle(403),
      admin: 200,
      slA: 200,
      slB: 200,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/v1/redaktion/seiten": {
    // Nur Abteilungsleitung (und Redaktion): Stufenleitung hat Zugang, darf aber nicht anlegen. Die Demo-Abteilung legt in ihrer eigenen an
    body: () => ({
      titel: "Matrix",
      adresse: "matrix-neu",
      sichtbarkeit: { art: "angemeldet" },
    }),
    erwartet: {
      ...alle(403),
      admin: 201,
      demoAdmin: 201,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "GET /api/v1/redaktion/seiten/:id": {
    url: () => `/api/v1/redaktion/seiten/${seiteId}`,
    erwartet: {
      ...alle(403),
      admin: 200,
      slA: 200,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "PATCH /api/v1/redaktion/seiten/:id": {
    url: () => `/api/v1/redaktion/seiten/${seiteId}`,
    body: () => ({ titel: "Matrix" }),
    erwartet: {
      ...alle(403),
      admin: 204,
      slA: 204,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "DELETE /api/v1/redaktion/seiten/:id": {
    // Jede Anfrage löscht ihre Seite; löschen darf nur die Abteilungsleitung (oder Redaktion), nicht die Stufenleitung der Seite
    urlJeAnfrage: async () =>
      `/api/v1/redaktion/seiten/${await wegwerfSeiteId()}`,
    erwartet: {
      ...alle(403),
      admin: 204,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Weiterleitungen alter Adressen (#356): nur Abteilungsleitung (und Redaktion); Stufenleitung hat Zugang zum Namensraum, darf aber nicht. Die Wirkung steht in test/redaktion-weiterleitungen.test.ts
  "GET /api/v1/redaktion/weiterleitungen": {
    erwartet: {
      ...alle(403),
      admin: 200,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/v1/redaktion/weiterleitungen": {
    // Jede Abteilung legt ihre eigene Zeile an (die alte Adresse ist je Abteilung eindeutig)
    body: () => ({ alterPfad: "/matrix-alt", zielPfad: "/matrix-neu" }),
    erwartet: {
      ...alle(403),
      admin: 201,
      demoAdmin: 201,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "PATCH /api/v1/redaktion/weiterleitungen/:id": {
    url: () => `/api/v1/redaktion/weiterleitungen/${weiterleitungId}`,
    body: () => ({ status: 302 }),
    erwartet: {
      ...alle(403),
      admin: 204,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "DELETE /api/v1/redaktion/weiterleitungen/:id": {
    urlJeAnfrage: async () =>
      `/api/v1/redaktion/weiterleitungen/${await wegwerfWeiterleitungId()}`,
    erwartet: {
      ...alle(403),
      admin: 204,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Entwurf, Versionen und Veröffentlichen (#350), alle an der Seite der Stufe A: Abteilungsleitung und Stufenleitung A haben das Recht, alle anderen 403, fremde Abteilung 404. Die Zeilen laufen in dieser Reihenfolge und teilen die Seite: Der Admin schreibt zuerst (Zähler 0, dann Version 1, dann Zurückziehen), die Stufenleitung A kommt danach, ihr Recht zeigt sich im Zustand (409) statt im 403. Die Wirkung steht in test/redaktion-seiten-inhalt.test.ts
  "GET /api/v1/redaktion/seiten/:id/entwurf": {
    url: () => `/api/v1/redaktion/seiten/${seiteId}/entwurf`,
    erwartet: {
      ...alle(403),
      admin: 200,
      slA: 200,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "PUT /api/v1/redaktion/seiten/:id/entwurf": {
    url: () => `/api/v1/redaktion/seiten/${seiteId}/entwurf`,
    // Der Zähler 0 gilt nur für den ersten Schreiber: Die Stufenleitung A hat das Recht, aber einen veralteten Stand (409)
    body: () => ({
      zaehler: 0,
      dokument: {
        v: 1,
        titel: "Matrix",
        bausteine: [
          {
            id: randomUUID(),
            typ: "ueberschrift",
            daten: { ebene: 2, text: "Matrix" },
          },
        ],
      },
    }),
    erwartet: {
      ...alle(403),
      admin: 200,
      slA: 409,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "POST /api/v1/redaktion/seiten/:id/veroeffentlichen": {
    url: () => `/api/v1/redaktion/seiten/${seiteId}/veroeffentlichen`,
    // Der Admin veröffentlicht Version 1; für die Stufenleitung A ist nichts mehr zu veröffentlichen (409)
    erwartet: {
      ...alle(403),
      admin: 201,
      slA: 409,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "GET /api/v1/redaktion/seiten/:id/versionen": {
    url: () => `/api/v1/redaktion/seiten/${seiteId}/versionen`,
    erwartet: {
      ...alle(403),
      admin: 200,
      slA: 200,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "GET /api/v1/redaktion/seiten/:id/versionen/:nr": {
    url: () => `/api/v1/redaktion/seiten/${seiteId}/versionen/1`,
    erwartet: {
      ...alle(403),
      admin: 200,
      slA: 200,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "POST /api/v1/redaktion/seiten/:id/versionen/:nr/zurueckholen": {
    url: () => `/api/v1/redaktion/seiten/${seiteId}/versionen/1/zurueckholen`,
    erwartet: {
      ...alle(403),
      admin: 200,
      slA: 200,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "POST /api/v1/redaktion/seiten/:id/zurueckziehen": {
    url: () => `/api/v1/redaktion/seiten/${seiteId}/zurueckziehen`,
    // Der Admin zieht die Version zurück; danach ist für die Stufenleitung A nichts mehr veröffentlicht (409)
    erwartet: {
      ...alle(403),
      admin: 204,
      slA: 409,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Vorlagen der Website (#352): Zugang wie bei den Seiten, Anlegen nur Abteilungsleitung und Redaktion; die Wirkung steht in test/redaktion-vorlagen.test.ts
  "GET /api/v1/redaktion/vorlagen": {
    erwartet: {
      ...alle(403),
      admin: 200,
      slA: 200,
      slB: 200,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/v1/redaktion/seiten/aus-vorlage": {
    body: () => ({
      vorlage: "textseite",
      titel: "Matrix Vorlage",
      sichtbarkeit: { art: "angemeldet" },
    }),
    erwartet: {
      ...alle(403),
      admin: 201,
      demoAdmin: 201,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  // Redaktionszugang (#353): Panel-Abfrage, Medien und Auswahllisten für Admin, Stufenleitung und Redaktion; die Wirkung steht in test/redaktion-zugang.test.ts. Stufenleitung hat Zugang, darf aber weder löschen noch fremde Medien beschreiben. Das Medium der Matrix hat keinen Uploader
  "GET /api/v1/redaktion/ich": {
    // Jede Person mit Sitzung bekommt eine Antwort (ohne Zugang «redigieren: false»)
    erwartet: {
      ...alle(200),
      adminOhneZweitenFaktor: 403,
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "GET /api/v1/redaktion/medien": {
    ohnePostman: true,
    erwartet: {
      ...alle(403),
      admin: 200,
      slA: 200,
      slB: 200,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/v1/redaktion/medien": {
    url: () =>
      "/api/v1/redaktion/medien?sichtbarkeit=angemeldet&altText=Matrix",
    bild: true,
    erwartet: {
      ...alle(403),
      admin: 201,
      slA: 201,
      slB: 201,
      demoAdmin: 201,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "PATCH /api/v1/redaktion/medien/:id": {
    ohnePostman: true,
    url: () => `/api/v1/redaktion/medien/${mediumId}`,
    body: () => ({ altText: "Matrix neu" }),
    erwartet: {
      ...alle(403),
      admin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "DELETE /api/v1/redaktion/medien/:id": {
    ohnePostman: true,
    urlJeAnfrage: async () =>
      `/api/v1/redaktion/medien/${await wegwerfMediumId()}`,
    erwartet: {
      ...alle(403),
      admin: 204,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  "GET /api/v1/redaktion/tags": {
    erwartet: {
      ...alle(403),
      admin: 200,
      slA: 200,
      slB: 200,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "GET /api/v1/redaktion/personen": {
    // Der Tag gehört zur Testabteilung: Die Demo-Abteilung kennt ihn nicht
    url: (w) => `/api/v1/redaktion/personen?tag=${w.stufeAId}`,
    erwartet: {
      ...alle(403),
      admin: 200,
      slA: 200,
      slB: 200,
      demoAdmin: 404,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  // Geschützte Bausteine der Website (#354): ohne Sitzung 401, mit Sitzung nichts ohne Seite (404, auch in der Demo-Abteilung); die Wirkung je Persona steht in test/website-inhalt.test.ts
  "GET /api/v1/website/inhalt": {
    url: () => "/api/v1/website/inhalt?pfad=/matrix-unbekannt",
    erwartet: {
      ...alle(404),
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "PUT /api/v1/push-token": {
    // Eigenes Token pro Persona: Die Zeile schreibt nur auf die eigene Sitzung, darum keine frischen Personas
    body: (konto) => ({
      token: `fcm-test-token-${konto.benutzername ?? "ohne-login"}`,
      plattform: "ios",
    }),
    erwartet: {
      ...alle(204),
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  // Chats (#49): Die Mitgliedschaft leitet rechte.ts aus Rollen und Kindern ab, Details in test/chats.test.ts. Admins und Leitende ohne SL-Rolle sind keine Mitglieder: Für sie existiert der Chat nicht (404). mussPasswortAendern: #15 sperrt das Konto vor der Route
  "GET /api/v1/chats": {
    erwartet: {
      ...alle(200),
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  // Einzelchat (#50): Ein Elternteil nennt nur die Stufe, die SL zusätzlich das Elternteil. Wer in der Stufe weder SL noch Elternteil mit aktivem Kind ist, bekommt 404, auch andere Eltern, Leitende, Admins und andere Abteilungen
  "POST /api/v1/chats/direkt": {
    body: (konto) => ({
      stufeId: welt.stufeAId,
      // Nur die SL der Stufe A muss das Elternteil nennen; für alle anderen wäre der Name ein fremder
      ...(konto === standard.slA && { elternUserId: standard.elternA.id }),
    }),
    erwartet: {
      ...alle(404),
      slA: 200,
      elternA: 200,
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "GET /api/v1/chats/:id/nachrichten": {
    url: () => `/api/v1/chats/${welt.gruppenchatAId}/nachrichten`,
    erwartet: {
      ...alle(404),
      slA: 200,
      elternA: 200,
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/v1/chats/:id/nachrichten": {
    url: () => `/api/v1/chats/${welt.gruppenchatAId}/nachrichten`,
    body: () => ({ text: "Hallo aus der Matrix" }),
    erwartet: {
      ...alle(404),
      slA: 201,
      elternA: 201,
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  // Gelesen-Stand (#51): Wie das Lesen des Chats, nur Mitglieder (SL der Stufe A und Eltern der Stufe A); für alle anderen existiert der Chat nicht (404). Schreibt nur die eigene Zeile in chat_status
  "PUT /api/v1/chats/:id/gelesen": {
    url: () => `/api/v1/chats/${welt.gruppenchatAId}/gelesen`,
    erwartet: {
      ...alle(404),
      slA: 204,
      elternA: 204,
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
};

let welt: Welt;
let standard: Record<Persona, PersonaKonto>;
let lagerWelt: LagerWelt;
let programmId: string;
let anwesenheitProgrammId: string;
let anwesenheitLeitungId: string;
let leitungProgrammId: string;
let patchZielId: string;
let startpasswortZielId: string;
let deaktivierenZielId: string;
let aktivierenZielId: string;
let patchStufeId: string;
let stufenZaehler = 0;
let patchKindId: string;
let patchRegelId: string;
let patchTagId: string;
let tagPersonId: string;
let tagZaehler = 0;
let bildZielId: string;
let mediumId: string;
let seiteId: string;
let weiterleitungId: string;
let testBild: Buffer;

// Wegwerf-Person der Testabteilung, direkt eingefügt (ohne Passwort): Die :id-Zeilen brauchen nur die Zeile; wer einen zweiten Faktor braucht, bekommt das Flag und eine Zeile in two_factor
async function wegwerfPersonId(zweiterFaktor = false) {
  const [zeile] = await welt.db
    .insert(schema.user)
    .values({
      name: "Wegwerf Person",
      email: `${randomUUID()}@example.org`,
      username: `wegwerf.${randomUUID().slice(0, 8)}`,
      abteilungId: welt.testabteilungId,
      mussPasswortAendern: false,
      twoFactorEnabled: zweiterFaktor,
    })
    .returning({ id: schema.user.id });
  if (zweiterFaktor) {
    await welt.db
      .insert(schema.twoFactor)
      .values({ userId: zeile.id, secret: "x", backupCodes: "x" });
  }
  return zeile.id;
}

// Wegwerf-Stufe der Testabteilung ohne Kinder und Leitung: Die Löschroute darf sie wegnehmen
async function wegwerfMediumId() {
  const schluessel = randomUUID();
  medienObjekte.set(schluessel, testBild);
  const [zeile] = await welt.db
    .insert(schema.medium)
    .values({
      abteilungId: welt.testabteilungId,
      mimeTyp: "image/jpeg",
      groesse: testBild.length,
      breite: 64,
      hoehe: 64,
      altText: "Matrix",
      sichtbarkeit: "angemeldet",
      speicherSchluessel: schluessel,
    })
    .returning({ id: schema.medium.id });
  return zeile.id;
}

async function wegwerfStufeId() {
  const [zeile] = await welt.db
    .insert(schema.stufe)
    .values({
      abteilungId: welt.testabteilungId,
      name: `Wegwerf Stufe ${randomUUID()}`,
      kuerzel: "W",
    })
    .returning({ id: schema.stufe.id });
  return zeile.id;
}

// Wegwerf-Kind der Testabteilung, direkt eingefügt; die Matrix-Zeilen fassen nie Kind A und B der Welt an
async function wegwerfKindId() {
  const [zeile] = await welt.db
    .insert(schema.kind)
    .values({
      abteilungId: welt.testabteilungId,
      vorname: "Wegwerf",
      nachname: "Kind",
      stufeId: welt.stufeAId,
    })
    .returning({ id: schema.kind.id });
  return zeile.id;
}

async function wegwerfRegelId() {
  const [zeile] = await welt.db
    .insert(schema.zeitregel)
    .values({
      abteilungId: welt.testabteilungId,
      wochentag: 3,
      uhrzeit: "08:00",
      text: "Wegwerf",
      aktiv: false,
    })
    .returning({ id: schema.zeitregel.id });
  return zeile.id;
}

// Wegwerf-Tag der Testabteilung, auf Wunsch einer Person zugewiesen
async function wegwerfTagId(userId?: string) {
  const [zeile] = await welt.db
    .insert(schema.tag)
    .values({
      abteilungId: welt.testabteilungId,
      typ: "team",
      name: `Wegwerf Tag ${randomUUID()}`,
      kuerzel: "W",
    })
    .returning({ id: schema.tag.id });
  if (userId) {
    await welt.db.insert(schema.personTag).values({ userId, tagId: zeile.id });
  }
  return zeile.id;
}

// Wegwerf-Recht der Testabteilung: Redaktion f�r den Tag-Empf�nger
async function wegwerfBearbeiterId() {
  const [zeile] = await welt.db
    .insert(schema.bearbeiter)
    .values({
      abteilungId: welt.testabteilungId,
      objektTyp: "seite",
      objektId: randomUUID(),
      userId: tagPersonId,
    })
    .returning({ id: schema.bearbeiter.id });
  return zeile.id;
}

// Wegwerf-Seite der Testabteilung, oberste Ebene
async function wegwerfSeiteId() {
  const [zeile] = await welt.db
    .insert(schema.seite)
    .values({
      abteilungId: welt.testabteilungId,
      adresse: `w-${randomUUID()}`,
      titel: "Wegwerf",
      sichtbarkeit: "angemeldet",
    })
    .returning({ id: schema.seite.id });
  return zeile.id;
}

// Wegwerf-Weiterleitung der Testabteilung (#356)
async function wegwerfWeiterleitungId() {
  const [zeile] = await welt.db
    .insert(schema.weiterleitung)
    .values({
      abteilungId: welt.testabteilungId,
      alterPfad: `/w-${randomUUID()}`,
      zielPfad: "/matrix-ziel",
    })
    .returning({ id: schema.weiterleitung.id });
  return zeile.id;
}

// Promise.all geht: Die Fabrik teilt keinen veränderlichen Zustand (zufällige Namen, eigene Inserts)
async function personasAnlegen() {
  return Object.fromEntries(
    await Promise.all(
      PERSONAS.map(async (p) => [p, await legePersonaAn(welt, p)]),
    ),
  ) as Record<Persona, PersonaKonto>;
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  standard = await personasAnlegen();
  // Lager der Lager-Matrix (test/lager/matrix/*.ts), einmal je Welt
  lagerWelt = await legeLagerWeltAn(welt, standard);
  anwesenheitLeitungId = standard.slA.id as string;
  // Ein Programm der Testabteilung für die Objekt-Routen, sichtbar bis zu den Eltern der Stufe A
  const programm = await legeProgrammAn(db, {
    abteilungId: welt.testabteilungId,
    sichtbarkeit: "eltern",
    stufen: [welt.stufeAId],
  });
  programmId = programm.id;
  // Vor einem Tag begonnen: innerhalb der Frist, in der die Anwesenheit sich erfassen lässt
  anwesenheitProgrammId = (
    await legeProgrammAn(db, {
      abteilungId: welt.testabteilungId,
      sichtbarkeit: "eltern",
      stufen: [welt.stufeAId],
      beginn: new Date(Date.now() - 86_400_000),
    })
  ).id;
  leitungProgrammId = (
    await legeProgrammAn(db, {
      abteilungId: welt.testabteilungId,
      sichtbarkeit: "eltern",
      stufen: [welt.stufeAId],
      beginn: new Date(Date.now() + 365 * 86_400_000),
    })
  ).id;
  [patchZielId, startpasswortZielId, deaktivierenZielId, aktivierenZielId] =
    await Promise.all([
      wegwerfPersonId(),
      wegwerfPersonId(),
      wegwerfPersonId(),
      wegwerfPersonId(),
    ]);
  patchKindId = await wegwerfKindId();
  patchRegelId = await wegwerfRegelId();
  patchTagId = await wegwerfTagId();
  tagPersonId = await wegwerfPersonId();
  testBild = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#3366cc" },
  })
    .jpeg()
    .toBuffer();
  bildZielId = await wegwerfPersonId();
  await db.insert(schema.rolle).values({
    userId: bildZielId,
    stufeId: welt.stufeAId,
    typ: "stufenleitung",
  });
  await db
    .insert(schema.profilbild)
    .values({ userId: bildZielId, inhalt: testBild });
  await db
    .insert(schema.stufenlogo)
    .values({ stufeId: welt.stufeAId, inhalt: testBild });
  const [patchStufe] = await db
    .insert(schema.stufe)
    .values({
      abteilungId: welt.testabteilungId,
      name: "Matrix Stufe",
      kuerzel: "M",
    })
    .returning({ id: schema.stufe.id });
  patchStufeId = patchStufe.id;
  mediumId = await wegwerfMediumId();
  // Die Seite der Stufe A, an der die Zeilen `:id` der Matrix arbeiten
  [{ id: seiteId }] = await db
    .insert(schema.seite)
    .values({
      abteilungId: welt.testabteilungId,
      adresse: "matrix-seite",
      titel: "Matrix",
      sichtbarkeit: "angemeldet",
      tagId: welt.stufeAId,
    })
    .returning({ id: schema.seite.id });
  weiterleitungId = await wegwerfWeiterleitungId();
});

// Rund 1 500 Anfragen schrieben sonst je eine Log-Zeile und begrüben jeden Fehler
let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

// Unter MIDDLEWARE nur Middleware; Routen registrieren Issues nie mit all() oder use()
const MIDDLEWARE = new Set([
  "ALL /*",
  "ALL /api/*",
  "ALL /api/v1/*",
  "ALL /api/v1/admin/*",
  "ALL /api/v1/redaktion/*",
]);

type Instanz = { routes: { method: string; path: string }[] };
const schluesselVon = (instanz: Instanz) =>
  new Set(instanz.routes.map((r) => `${r.method} ${r.path}`));
const ohneZeile = (instanz: Instanz) =>
  [...schluesselVon(instanz)]
    .filter((s) => !(s in MATRIX) && !(s in LAGER_MATRIX) && !MIDDLEWARE.has(s))
    .sort();

describe("Vollständigkeit", () => {
  test("jede Route hat eine Zeile und jede Zeile eine Route", () => {
    const routen = schluesselVon(app);
    expect(ohneZeile(app)).toEqual([]);
    expect(Object.keys(MATRIX).filter((s) => !routen.has(s))).toEqual([]);
    expect(Object.keys(LAGER_MATRIX).filter((s) => !routen.has(s))).toEqual([]);
    // Eine Route steht in genau einer der beiden Matrizen
    expect(Object.keys(LAGER_MATRIX).filter((s) => s in MATRIX)).toEqual([]);
    expect([...MIDDLEWARE].filter((s) => !routen.has(s))).toEqual([]);
  });

  test("Selbsttest: Eine Route ohne Zeile fällt mit genau ihrem Schlüssel auf", () => {
    const mitExtra = erstelleApp({
      appMinVersion: "1.2.0",
      sql,
      db,
      auth,
      seiten: ladeSeiten(),
    }).get("/api/v1/ohne-eintrag", (c) => c.text("nie"));
    expect(ohneZeile(mitExtra)).toEqual(["GET /api/v1/ohne-eintrag"]);
  });

  // Bedrohung 9: Demo-Personas sehen kein Objekt der echten Abteilung; bindet jede künftige Objekt-Route. Bewusst eine Schleife: Ein leeres test.each ergäbe gar keinen Test
  test("jede Zeile mit Pfad-Parameter nennt eine URL und erwartet 404 für die Demo-Personas", () => {
    for (const [schluessel, zeile] of Object.entries(MATRIX)) {
      if (!schluessel.includes(":")) continue;
      expect(zeile.url ?? zeile.urlJeAnfrage, schluessel).toBeDefined();
      expect(zeile.erwartet.demoAdmin, schluessel).toBe(404);
      expect(zeile.erwartet.demoEltern, schluessel).toBe(404);
    }
  });
});

describe("Sperre ohne zweiten Faktor (#23)", () => {
  // Bewusst eine Schleife: Jede künftige Admin-Route erbt die Regel; ein leeres test.each ergäbe gar keinen Test
  test("jede Admin-Route erwartet für «Admin ohne zweiten Faktor» 403", () => {
    let n = 0;
    for (const [schluessel, zeile] of Object.entries(MATRIX)) {
      if (!schluessel.split(" ")[1].startsWith("/api/v1/admin/")) continue;
      n++;
      expect(zeile.erwartet.adminOhneZweitenFaktor, schluessel).toBe(403);
    }
    expect(n).toBeGreaterThan(0);
  });

  test("der Admin ohne Faktor bekommt ZWEITER_FAKTOR_FEHLT, alle anderen den Status der Route", async () => {
    const anfrageAn = (persona: Persona) =>
      app.request("/api/v1/admin/personen", {
        headers: standard[persona].headers,
      });
    const ohne = await anfrageAn("adminOhneZweitenFaktor");
    expect(ohne.status).toBe(403);
    expect(await ohne.json()).toEqual({
      code: "ZWEITER_FAKTOR_FEHLT",
      message: "Für die Verwaltung braucht es zuerst einen zweiten Faktor.",
    });
    const eltern = await anfrageAn("elternA");
    expect(eltern.status).toBe(403);
    expect(await eltern.json()).toMatchObject({ code: "KEINE_BERECHTIGUNG" });
    expect((await anfrageAn("admin")).status).toBe(200);
  });
});

describe("Matrix: jede Route mal jede Persona", () => {
  test.each(Object.entries(MATRIX))("%s", async (schluessel, zeile) => {
    const [methode, pfad] = schluessel.split(" ");
    const eigene = zeile.frischePersonas ? await personasAnlegen() : standard;
    const festeUrl = zeile.url?.(welt) ?? pfad;
    const ergebnis: Partial<Record<Persona, number>> = {};
    for (const persona of PERSONAS) {
      const konto = eigene[persona];
      const url = zeile.urlJeAnfrage ? await zeile.urlJeAnfrage() : festeUrl;
      const antwort = await app.request(url, {
        method: methode,
        headers: zeile.body
          ? { ...konto.headers, "content-type": "application/json" }
          : konto.headers,
        body: zeile.bild
          ? new Uint8Array(testBild)
          : zeile.body && JSON.stringify(zeile.body(konto)),
      });
      ergebnis[persona] = antwort.status;
    }
    expect(ergebnis).toEqual(zeile.erwartet);
  });
});

// Rolle mal Lager-Zustand mal Anmeldung für jede Route der Lager-Module (test/lager/matrix/*.ts); die Regeln über alle Zeilen prüft test/lager/matrix-regeln.test.ts
describe("Lager-Matrix: jede Route mal jede Lager-Persona mal jeder Zustand", () => {
  const zeilen = Object.entries(LAGER_MATRIX).flatMap(([s, zeile]) =>
    LAGER_ZUSTAENDE.map((zustand) => [s, zustand, zeile] as const),
  );
  test.each(zeilen)("%s (%s)", async (schluessel, zustand, zeile) => {
    expect(
      await antwortenJePersona(
        app,
        schluessel,
        zeile,
        lagerWelt,
        standard,
        zustand,
      ),
    ).toEqual(zeile.erwartet[zustand]);
  });
});

describe("jeder übrige better-auth-Pfad liefert 404 aus der App", () => {
  const geschlossen = geschlossenePfade(
    Object.keys(MATRIX).filter((s) => s.includes(" /api/auth/")),
  );

  test("die Liste enthält die kritischen Pfade", () => {
    expect(geschlossen).toEqual(
      expect.arrayContaining([
        "POST /api/auth/update-user",
        "POST /api/auth/sign-in/email",
        "POST /api/auth/sign-up/email",
        "POST /api/auth/is-username-available",
        "POST /api/auth/admin/create-user",
        "POST /api/auth/admin/ban-user",
      ]),
    );
  });

  test.each(geschlossen)("%s", async (eintrag) => {
    const [methode, pfad] = eintrag.split(" ");
    for (const persona of PERSONAS) {
      const antwort = await app.request(pfad, {
        method: methode,
        headers: standard[persona].headers,
      });
      expect(antwort.status, persona).toBe(404);
      // Der Body der App, nicht der von better-auth: Die Anfrage hat auth.handler nie erreicht
      expect(await antwort.json(), persona).toEqual({
        code: "NICHT_GEFUNDEN",
        message: "Nicht gefunden",
      });
    }
  });
});

// Export für docs/api/endpunkte.md und die Postman-Collection (#186): läuft nur mit POSTMAN_EXPORT=1, schreibt die Zeilen der Matrix mit ID-Platzhaltern und je Persona eine Umgebung mit Sitzung. Die Datenbank bleibt danach stehen, die API kann auf ihr laufen (docs/api/postman.md)
describe.runIf(process.env.POSTMAN_EXPORT)("Postman-Export", () => {
  test("schreibt apps/api/.postman-lokal/", async () => {
    const ordner = new URL("../.postman-lokal/", import.meta.url);
    await mkdir(ordner, { recursive: true });
    const ids: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(welt).filter(([, v]) => typeof v === "string"),
      ),
      programmId,
      anwesenheitProgrammId,
      anwesenheitLeitungId,
      leitungProgrammId,
      patchZielId,
      startpasswortZielId,
      deaktivierenZielId,
      aktivierenZielId,
      patchStufeId,
      patchKindId,
      patchRegelId,
      patchTagId,
      tagPersonId,
      bildZielId,
      seiteId,
      weiterleitungId,
      mediumId,
      elternAUserId: standard.elternA.id!,
    };
    const ersetze = (text: string) =>
      Object.entries(ids).reduce(
        (t, [name, id]) => t.replaceAll(id, `{{${name}}}`),
        text,
      );
    const platzhalter = {
      benutzername: "{{benutzername}}",
      passwort: "{{passwort}}",
    } as PersonaKonto;
    const uuid = /[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/;

    const zeilen = Object.entries(MATRIX).map(([schluessel, zeile], n) => ({
      schluessel,
      methode: schluessel.split(" ")[0],
      pfad: ersetze(zeile.url?.(welt) ?? schluessel.split(" ")[1]),
      body: zeile.body && ersetze(JSON.stringify(zeile.body(platzhalter))),
      bild: zeile.bild === true,
      ohnePostman: zeile.ohnePostman === true,
      zielJeAnfrage: zeile.urlJeAnfrage !== undefined,
      sitzungEnde: zeile.frischePersonas === true,
      bodyJePersona: false,
      erwartet: zeile.erwartet,
      n,
    }));
    for (const z of zeilen.filter((z) => z.zielJeAnfrage)) {
      // Die erste UUID ist das Ziel; weitere (die Person der Tag-Zuordnung) stehen als feste ID in der Umgebung
      z.pfad = ersetze(
        (await MATRIX[z.schluessel].urlJeAnfrage!()).replace(
          uuid,
          `{{ziel_${z.n}}}`,
        ),
      );
    }

    // Bodies, die von der Persona abhängen (eigene Stufe, Elternname), stehen als Variable body_<n> in deren Umgebung
    const bodyJePersona = (z: (typeof zeilen)[number], persona: Persona) => {
      const konto = standard[persona];
      const text = ersetze(JSON.stringify(MATRIX[z.schluessel].body!(konto)));
      return text
        .replaceAll(konto.benutzername ?? " ", "{{benutzername}}")
        .replaceAll(konto.passwort ?? " ", "{{passwort}}");
    };
    for (const z of zeilen.filter((z) => z.body)) {
      const texte = PERSONAS.map((p) => bodyJePersona(z, p));
      if (texte.some((t) => t !== z.body)) z.bodyJePersona = true;
    }
    await writeFile(
      new URL("matrix.json", ordner),
      JSON.stringify({ personas: PERSONAS, zeilen }, null, 1),
    );

    // Die Lager-Zeilen mit Platzhaltern für die zwei Lager der Testabteilung; die Umgebungen je Lager-Persona (KONTO_FUER) sind die der Personas. Die Collection erzeugt L7h (#407) neu
    const lagerIds = {
      lagerAktivId: lagerWelt.aktivId,
      lagerAbgeschlossenId: lagerWelt.abgeschlossenId,
    };
    const ersetzeLager = (text: string) =>
      Object.entries(lagerIds).reduce(
        (t, [name, id]) => t.replaceAll(id, `{{${name}}}`),
        text,
      );
    await writeFile(
      new URL("lager-matrix.json", ordner),
      JSON.stringify(
        {
          ids: lagerIds,
          zeilen: await Promise.all(
            Object.entries(LAGER_MATRIX).map(async ([schluessel, zeile]) => ({
              schluessel,
              methode: schluessel.split(" ")[0],
              pfad: ersetzeLager(
                (await zeile.url?.(lagerWelt, "aktiv")) ??
                  schluessel.split(" ")[1],
              ),
              body:
                zeile.body && ersetzeLager(JSON.stringify(zeile.body("aktiv"))),
              erwartet: zeile.erwartet,
            })),
          ),
        },
        null,
        1,
      ),
    );

    for (const persona of PERSONAS) {
      const konto = standard[persona];
      const werte: Record<string, string> = {
        baseUrl: "http://localhost:3000",
        persona,
        expoOrigin: konto.headers["expo-origin"],
        ip: konto.headers["x-forwarded-for"],
        cookie: konto.headers.cookie ?? "",
        benutzername: konto.benutzername ?? "gibt.es.nicht",
        passwort: konto.passwort ?? PASSWORT,
        ...ids,
        erwartet: JSON.stringify(
          Object.fromEntries(
            zeilen.map((z) => [z.schluessel, z.erwartet[persona]]),
          ),
        ),
      };
      for (const z of zeilen.filter((z) => z.bodyJePersona))
        werte[`body_${z.n}`] = bodyJePersona(z, persona);
      for (const z of zeilen.filter((z) => z.zielJeAnfrage)) {
        const url = await MATRIX[z.schluessel].urlJeAnfrage!();
        werte[`ziel_${z.n}`] = uuid.exec(url)![0];
      }
      const geheim = new Set(["cookie", "passwort"]);
      await writeFile(
        new URL(`${persona}.environment.yaml`, ordner),
        // JSON ist gültiges YAML; so bleibt jeder Wert eine Zeichenkette
        JSON.stringify({
          name: `Cevi OS lokal: ${persona}`,
          values: Object.entries(werte).map(([key, value]) => ({
            key,
            value,
            enabled: true,
            type: geheim.has(key) ? "secret" : "default",
          })),
        }),
      );
    }
  });
});

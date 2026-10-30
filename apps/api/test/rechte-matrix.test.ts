import { Expo } from "expo-server-sdk";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
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

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  expo: new Expo({ accessToken: "test-zugang" }),
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

const FALSCH = "nur-fuer-tests-falsch";

interface Zeile {
  // Literale Werte: beobachtet und gegen better-auth gegengelesen, nie aus rechte.ts berechnet
  erwartet: Record<Persona, number>;
  body?: (konto: PersonaKonto) => Record<string, unknown>;
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
  "GET /admin/abteilung.js": { erwartet: alle(200) },
  "GET /admin/admin.css": { erwartet: alle(200) },
  "GET /admin/admin.js": { erwartet: alle(200) },
  "GET /admin/api.js": { erwartet: alle(200) },
  "GET /admin/dom.js": { erwartet: alle(200) },
  "GET /admin/kinder.js": { erwartet: alle(200) },
  "GET /admin/meldungen.js": { erwartet: alle(200) },
  "GET /admin/personen.js": { erwartet: alle(200) },
  "GET /admin/stufen.js": { erwartet: alle(200) },
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
  "DELETE /api/v1/ich": {
    // Löscht das Konto, darum eigene Personas; mit den geteilten hat die Testabteilung vier Admins und die Demo-Abteilung zwei, also darf jeder Admin (Status 409 für den letzten: test/konto-loeschen.test.ts). Nicht beim Pflichtwechsel: #15 sperrt das Konto auf allen Routen ausser GET /api/v1/ich
    frischePersonas: true,
    body: (konto) => ({ passwort: konto.passwort ?? PASSWORT }),
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
  // Ergänzungen (#32): Admin sowie SL und Leitende einer zugeordneten Stufe; mussPasswortAendern wie überall 403. Ein null auf «mitnehmen» ändert nichts Sichtbares
  "PATCH /api/v1/programme/:id": {
    url: () => `/api/v1/programme/${programmId}`,
    body: () => ({ mitnehmen: null }),
    erwartet: {
      ...alle(204),
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
  // Hilfe (#54): Alle angemeldeten Personen lesen den Text ihrer Abteilung; Details in test/hilfe.test.ts
  "GET /api/v1/hilfe": {
    erwartet: {
      ...alle(200),
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  // Nur Admins; der Text ist stets derselbe, darum schreibt nur die erste Anfrage je Abteilung und die übrigen sind No-ops
  "PATCH /api/v1/admin/abteilung": {
    body: () => ({ vertrauenspersonen: "Platzhalter für die Matrix" }),
    erwartet: {
      ...alle(403),
      admin: 204,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 204,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  // Verwaltung (#18): nur Admins, und ohne zweiten Faktor sperrt die Middleware (#23) jede Admin-Route mit 403. Status in test/admin-personen.test.ts begründet
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
  "POST /api/v1/admin/stufen": {
    body: () => ({ name: "Matrix Stufe", kuerzel: "M", reihenfolge: 50 }),
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
    body: () => ({ name: "Matrix Stufe", kuerzel: "M", reihenfolge: 50 }),
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
  "PUT /api/v1/push-token": {
    // Eigenes Token pro Persona: Die Zeile schreibt nur auf die eigene Sitzung, darum keine frischen Personas
    body: (konto) => ({
      token: `ExpoPushToken[${konto.benutzername ?? "ohne-login"}]`,
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
  // Moderation (#52): Melden darf, wer die Nachricht im Chat sieht (SL der Stufe und Eltern der Stufe A); Ausblenden die SL im Gruppenchat der eigenen Stufe, Admins nur über eine offene Meldung. Eltern sehen die Nachricht, dürfen sie aber nicht ausblenden (403). Details in test/moderation.test.ts
  "POST /api/v1/nachrichten/:id/ausblenden": {
    // Jede Anfrage blendet ihre Nachricht aus; eine feste URL nähme sie den Personen danach weg
    urlJeAnfrage: async () =>
      `/api/v1/nachrichten/${await gemeldeteNachrichtId()}/ausblenden`,
    erwartet: {
      ...alle(404),
      admin: 204,
      adminOhneZweitenFaktor: 204,
      slA: 204,
      elternA: 403,
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "POST /api/v1/nachrichten/:id/melden": {
    url: () => `/api/v1/nachrichten/${meldeNachrichtId}/melden`,
    erwartet: {
      ...alle(404),
      slA: 204,
      elternA: 204,
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  // Blockieren (#53): Nur Eltern blockieren, und nur Eltern, mit denen sie einen Gruppenchat teilen. Wer keinen Gruppenchat mit dem Ziel hat, bekommt 404 (Admins, Leitende, andere Stufen, Demo); die SL der Stufe A ist selbst Mitglied und bekommt 403. Aufheben und Liste stehen allen offen, das Aufheben prüft nur die Abteilung des Ziels. Details in test/blockieren.test.ts
  "GET /api/v1/blockierungen": {
    erwartet: {
      ...alle(200),
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "PUT /api/v1/blockierungen/:userId": {
    url: () => `/api/v1/blockierungen/${blockierZielId}`,
    erwartet: {
      ...alle(404),
      slA: 403,
      elternA: 204,
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "DELETE /api/v1/blockierungen/:userId": {
    url: () => `/api/v1/blockierungen/${patchZielId}`,
    erwartet: {
      ...alle(204),
      mussPasswortAendern: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      demoAdmin: 404,
      demoEltern: 404,
    },
  },
  // Eingang der Meldungen (#52): nur Admins. Die gemeldete Person bekommt 404, weil die Meldung für sie nicht existiert (test/moderation.test.ts)
  "GET /api/v1/admin/meldungen": {
    erwartet: {
      ...alle(403),
      admin: 200,
      adminOhneZweitenFaktor: 403,
      demoAdmin: 200,
      deaktiviert: 401,
      ohneLogin: 401,
    },
  },
  "PATCH /api/v1/admin/meldungen/:id": {
    url: () => `/api/v1/admin/meldungen/${erledigenZielId}`,
    body: () => ({ erledigt: true }),
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
};

let welt: Welt;
let standard: Record<Persona, PersonaKonto>;
let programmId: string;
let leitungProgrammId: string;
let patchZielId: string;
let startpasswortZielId: string;
let deaktivierenZielId: string;
let aktivierenZielId: string;
let meldeNachrichtId: string;
let blockierZielId: string;
let erledigenZielId: string;
let patchStufeId: string;
let patchKindId: string;

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

// Wegwerf-Elternteil des Kindes A: Mitglied im Gruppenchat der Stufe A, ohne Anmeldung
async function wegwerfElternId() {
  const id = await wegwerfPersonId();
  await welt.db
    .insert(schema.kindEltern)
    .values({ kindId: welt.kindAId, userId: id });
  return id;
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

// Eine Nachricht einer Wegwerf-Person im Gruppenchat der Stufe A
async function wegwerfNachrichtId() {
  const [zeile] = await welt.db
    .insert(schema.nachricht)
    .values({
      chatId: welt.gruppenchatAId,
      autorId: await wegwerfPersonId(),
      text: "Nachricht aus der Matrix",
    })
    .returning({ id: schema.nachricht.id });
  return zeile.id;
}

// Mit offener Meldung einer anderen Wegwerf-Person: So sehen sie auch Admins, die nicht im Chat sind
async function gemeldeteNachrichtId() {
  const id = await wegwerfNachrichtId();
  await welt.db.insert(schema.meldung).values({
    abteilungId: welt.testabteilungId,
    nachrichtId: id,
    textKopie: "Nachricht aus der Matrix",
    gemeldetVon: await wegwerfPersonId(),
  });
  return id;
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
  // Ein Programm der Testabteilung für die Objekt-Routen, sichtbar bis zu den Eltern der Stufe A
  const programm = await legeProgrammAn(db, {
    abteilungId: welt.testabteilungId,
    sichtbarkeit: "eltern",
    stufen: [welt.stufeAId],
  });
  programmId = programm.id;
  meldeNachrichtId = await wegwerfNachrichtId();
  blockierZielId = await wegwerfElternId();
  const [meldung] = await db
    .insert(schema.meldung)
    .values({
      abteilungId: welt.testabteilungId,
      nachrichtId: await wegwerfNachrichtId(),
      textKopie: "Nachricht aus der Matrix",
    })
    .returning({ id: schema.meldung.id });
  erledigenZielId = meldung.id;
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
  const [patchStufe] = await db
    .insert(schema.stufe)
    .values({
      abteilungId: welt.testabteilungId,
      name: "Matrix Stufe",
      kuerzel: "M",
      reihenfolge: 50,
    })
    .returning({ id: schema.stufe.id });
  patchStufeId = patchStufe.id;
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
]);

type Instanz = { routes: { method: string; path: string }[] };
const schluesselVon = (instanz: Instanz) =>
  new Set(instanz.routes.map((r) => `${r.method} ${r.path}`));
const ohneZeile = (instanz: Instanz) =>
  [...schluesselVon(instanz)]
    .filter((s) => !(s in MATRIX) && !MIDDLEWARE.has(s))
    .sort();

describe("Vollständigkeit", () => {
  test("jede Route hat eine Zeile und jede Zeile eine Route", () => {
    const routen = schluesselVon(app);
    expect(ohneZeile(app)).toEqual([]);
    expect(Object.keys(MATRIX).filter((s) => !routen.has(s))).toEqual([]);
    expect([...MIDDLEWARE].filter((s) => !routen.has(s))).toEqual([]);
  });

  test("Selbsttest: Eine Route ohne Zeile fällt mit genau ihrem Schlüssel auf", () => {
    const mitExtra = erstelleApp({
      appMinVersion: "1.2.0",
      sql,
      db,
      auth,
      expo: new Expo({ accessToken: "test-zugang" }),
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
        body: zeile.body && JSON.stringify(zeile.body(konto)),
      });
      ergebnis[persona] = antwort.status;
    }
    expect(ergebnis).toEqual(zeile.erwartet);
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

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
  // Die Felder je Rolle prüft test/programme.test.ts, die Zuordnungsregeln test/zuordnung.test.ts; hier zählt der Status.
  // adminOhneZweitenFaktor wie admin: #23 sperrt nur /api/v1/admin/*. mussPasswortAendern wie elternA: #15 sperrt das Konto erst später auf allen Routen
  "GET /api/v1/programme": {
    // Ohne Fenster antwortet die Route 400, darum eine URL trotz fehlendem Pfad-Parameter
    url: () => "/api/v1/programme?von=2027-01-01&bis=2027-12-31",
    erwartet: { ...alle(200), deaktiviert: 401, ohneLogin: 401 },
  },
  "GET /api/v1/programme/:id": {
    url: () => `/api/v1/programme/${programmId}`,
    erwartet: {
      ...alle(200),
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
};

let welt: Welt;
let standard: Record<Persona, PersonaKonto>;
let programmId: string;

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
});

// Rund 1 500 Anfragen schrieben sonst je eine Log-Zeile und begrüben jeden Fehler
let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

// Unter MIDDLEWARE nur Middleware; Routen registrieren Issues nie mit all() oder use()
const MIDDLEWARE = new Set(["ALL /*", "ALL /api/*", "ALL /api/v1/*"]);

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
      seiten: ladeSeiten(),
    }).get("/api/v1/ohne-eintrag", (c) => c.text("nie"));
    expect(ohneZeile(mitExtra)).toEqual(["GET /api/v1/ohne-eintrag"]);
  });

  // Bedrohung 9: Demo-Personas sehen kein Objekt der echten Abteilung; bindet jede künftige Objekt-Route. Bewusst eine Schleife: Ein leeres test.each ergäbe gar keinen Test
  test("jede Zeile mit Pfad-Parameter nennt eine URL und erwartet 404 für die Demo-Personas", () => {
    for (const [schluessel, zeile] of Object.entries(MATRIX)) {
      if (!schluessel.includes(":")) continue;
      expect(zeile.url, schluessel).toBeDefined();
      expect(zeile.erwartet.demoAdmin, schluessel).toBe(404);
      expect(zeile.erwartet.demoEltern, schluessel).toBe(404);
    }
  });
});

describe("Matrix: jede Route mal jede Persona", () => {
  test.each(Object.entries(MATRIX))("%s", async (schluessel, zeile) => {
    const [methode, pfad] = schluessel.split(" ");
    const eigene = zeile.frischePersonas ? await personasAnlegen() : standard;
    const url = zeile.url?.(welt) ?? pfad;
    const ergebnis: Partial<Record<Persona, number>> = {};
    for (const persona of PERSONAS) {
      const konto = eigene[persona];
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

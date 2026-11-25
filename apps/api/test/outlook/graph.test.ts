import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { starteGeraetecode } from "../../src/outlook/anmeldung.js";
import { FEHLER, OutlookFehler } from "../../src/outlook/fehler.js";
import {
  erstelleGraphClient,
  erstelleGraphClients,
  type TokenSpeicher,
} from "../../src/outlook/graph.js";

// Der echte Graph-Client gegen einen HTTP-Server auf localhost, der Microsoft nachstellt (kein Netzverkehr nach aussen). Nichts davon beweist, dass der echte Dienst genauso antwortet (docs/betrieb.md, Checkliste).
type Anfrage = {
  methode: string;
  pfad: string;
  kopf: IncomingMessage["headers"];
  body: string;
};
type Antwort = {
  status: number;
  body?: unknown;
  kopf?: Record<string, string>;
};

let server: Server;
let basis: string;
let anfragen: Anfrage[];
let skript: ((a: Anfrage) => Antwort | undefined)[];
let tokenAntworten: Antwort[];

beforeAll(async () => {
  server = createServer((req, res) => {
    const stuecke: Buffer[] = [];
    req.on("data", (s: Buffer) => stuecke.push(s));
    req.on("end", () => {
      const a: Anfrage = {
        methode: req.method ?? "",
        pfad: req.url ?? "",
        kopf: req.headers,
        body: Buffer.concat(stuecke).toString("utf8"),
      };
      anfragen.push(a);
      let antwort: Antwort;
      if (a.pfad.includes("/oauth2/v2.0/token")) {
        antwort = tokenAntworten.shift() ?? {
          status: 200,
          body: {
            access_token: "zugriff-1",
            expires_in: 3600,
            refresh_token: "refresh-2",
            scope: "Calendars.ReadWrite MailboxSettings.ReadWrite",
          },
        };
      } else if (a.pfad.includes("/oauth2/v2.0/devicecode")) {
        antwort = {
          status: 200,
          body: {
            device_code: "geraet",
            user_code: "ABC-123",
            verification_uri: "https://example.invalid/geraet",
            expires_in: 900,
            interval: 1,
          },
        };
      } else {
        antwort = skript.shift()?.(a) ?? { status: 200, body: { value: [] } };
      }
      res.writeHead(antwort.status, {
        "content-type": "application/json",
        ...antwort.kopf,
      });
      res.end(antwort.body === undefined ? "" : JSON.stringify(antwort.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let gespeichert: string | null;
let abgelaufenGemeldet: boolean;
let pausen: number[];
const speicher: TokenSpeicher = {
  lade: async () => "refresh-1",
  speichere: async (t) => {
    gespeichert = t;
  },
  abgelaufen: async () => {
    abgelaufenGemeldet = true;
  },
};
const client = (versuche = 4) =>
  erstelleGraphClient(
    {
      tenant: "mandant-test",
      clientId: "client-test",
      graphBasis: `${basis}/v1.0`,
      loginBasis: basis,
      schlaf: async (ms) => {
        pausen.push(ms);
      },
      versuche,
    },
    speicher,
  );
const graphAnfragen = () => anfragen.filter((a) => a.pfad.startsWith("/v1.0"));

beforeEach(() => {
  anfragen = [];
  skript = [];
  tokenAntworten = [];
  gespeichert = null;
  abgelaufenGemeldet = false;
  pausen = [];
});

describe("Kategorienliste", () => {
  test("liest die Liste, mit Bearer-Token und ohne Weiterleitung", async () => {
    skript.push(() => ({
      status: 200,
      body: { value: [{ id: "a", displayName: "Biber", color: "preset4" }] },
    }));
    expect(await client().listeKategorien()).toEqual([
      { id: "a", name: "Biber", farbe: "preset4" },
    ]);
    expect(graphAnfragen()[0].kopf.authorization).toBe("Bearer zugriff-1");
    expect(graphAnfragen()[0].pfad).toBe("/v1.0/me/outlook/masterCategories");
  });

  test("Anlegen: legt an; doppelt (409) ist kein Fehler, sondern null", async () => {
    skript.push(() => ({ status: 201, body: { id: "neu", displayName: "X" } }));
    skript.push(() => ({ status: 409, body: { error: { code: "Exists" } } }));
    const c = client();
    expect(await c.legeKategorieAn("Wölfe", "preset4")).toEqual({
      id: "neu",
    });
    expect(await c.legeKategorieAn("Wölfe", "preset4")).toBeNull();
    expect(JSON.parse(graphAnfragen()[0].body)).toEqual({
      displayName: "Wölfe",
      color: "preset4",
    });
  });

  test("ungültiger Name oder Farbe geht gar nicht erst hinaus", async () => {
    const c = client();
    for (const name of ["A,B", "", " ", "x".repeat(256), "Zeile\nzwei"]) {
      await expect(c.legeKategorieAn(name, "preset4")).rejects.toMatchObject({
        code: FEHLER.ABGELEHNT,
      });
    }
    await expect(c.legeKategorieAn("Biber", "preset99")).rejects.toMatchObject({
      code: FEHLER.ABGELEHNT,
    });
    expect(anfragen).toHaveLength(0);
  });

  test("Löschen: 404 gilt als erledigt", async () => {
    skript.push(() => ({ status: 404 }));
    await expect(client().loescheKategorie("a/b")).resolves.toBeUndefined();
    expect(graphAnfragen()[0].pfad).toBe(
      "/v1.0/me/outlook/masterCategories/a%2Fb",
    );
  });
});

describe("Anmeldung und Fehlerverhalten", () => {
  test("401: das Token wird erneuert und die Anfrage einmal wiederholt; das neue Refresh-Token wird gespeichert", async () => {
    skript.push(() => ({ status: 401 }));
    skript.push(() => ({ status: 200, body: { value: [] } }));
    tokenAntworten.push(
      { status: 200, body: { access_token: "alt", expires_in: 3600 } },
      {
        status: 200,
        body: {
          access_token: "frisch",
          expires_in: 3600,
          refresh_token: "refresh-neu",
        },
      },
    );
    await client().listeKategorien();
    const g = graphAnfragen();
    expect(g[0].kopf.authorization).toBe("Bearer alt");
    expect(g[1].kopf.authorization).toBe("Bearer frisch");
    expect(gespeichert).toBe("refresh-neu");
  });

  test("zwei Aufrufe zugleich teilen sich eine Erneuerung des Tokens", async () => {
    const c = client();
    await Promise.all([c.listeKategorien(), c.listeKategorien()]);
    expect(anfragen.filter((a) => a.pfad.includes("/token"))).toHaveLength(1);
  });

  test("invalid_grant: Verbindung gilt als abgelaufen, ohne Wiederholung", async () => {
    tokenAntworten.push({ status: 400, body: { error: "invalid_grant" } });
    await expect(client().listeKategorien()).rejects.toMatchObject({
      code: FEHLER.ANMELDUNG_ABGELAUFEN,
    });
    expect(abgelaufenGemeldet).toBe(true);
    expect(graphAnfragen()).toHaveLength(0);
  });

  test("429 mit Retry-After: wartet die genannte Zeit und versucht es noch einmal", async () => {
    skript.push(() => ({ status: 429, kopf: { "retry-after": "3" } }));
    skript.push(() => ({ status: 200, body: { value: [] } }));
    await client().listeKategorien();
    expect(pausen).toEqual([3000]);
    expect(graphAnfragen()).toHaveLength(2);
  });

  test("429 mit langem Retry-After: gibt sofort auf und nennt die Wartezeit", async () => {
    skript.push(() => ({ status: 429, kopf: { "retry-after": "600" } }));
    const fehler = await client()
      .listeKategorien()
      .catch((f: unknown) => f);
    expect(fehler).toBeInstanceOf(OutlookFehler);
    expect(fehler).toMatchObject({
      code: FEHLER.ZU_VIELE_ANFRAGEN,
      wartenSek: 600,
    });
    expect(pausen).toEqual([]);
    expect(graphAnfragen()).toHaveLength(1);
  });

  test("5xx: Backoff 0,5 s, 1 s, dann Erfolg; bei Dauerausfall nach den Versuchen SERVER", async () => {
    skript.push(() => ({ status: 502 }));
    skript.push(() => ({ status: 500 }));
    skript.push(() => ({ status: 200, body: { value: [] } }));
    await client().listeKategorien();
    expect(pausen).toEqual([500, 1000]);

    anfragen = [];
    pausen = [];
    for (let i = 0; i < 4; i++) skript.push(() => ({ status: 500 }));
    await expect(client().listeKategorien()).rejects.toMatchObject({
      code: FEHLER.SERVER,
    });
    expect(graphAnfragen()).toHaveLength(4);
  });

  test("schnell: ein Versuch, keine Pause", async () => {
    skript.push(() => ({ status: 500 }));
    const { schnell } = erstelleGraphClients(
      {
        tenant: "mandant-test",
        clientId: "client-test",
        graphBasis: `${basis}/v1.0`,
        loginBasis: basis,
        schlaf: async (ms) => {
          pausen.push(ms);
        },
      },
      speicher,
    );
    await expect(schnell.listeKategorien()).rejects.toMatchObject({
      code: FEHLER.SERVER,
    });
    expect(pausen).toEqual([]);
    expect(graphAnfragen()).toHaveLength(1);
  });

  test("4xx wird nie wiederholt und trägt keinen Text der Antwort", async () => {
    skript.push(() => ({
      status: 403,
      body: { error: { message: "geheimer Text" } },
    }));
    const fehler = (await client()
      .listeKategorien()
      .catch((f: unknown) => f)) as OutlookFehler;
    expect(fehler.code).toBe(FEHLER.ABGELEHNT);
    expect(fehler.message).toBe(FEHLER.ABGELEHNT);
    expect(graphAnfragen()).toHaveLength(1);
  });

  test("keine Weiterleitung, Netzfehler: erst Wiederholung, dann NICHT_ERREICHBAR", async () => {
    for (let i = 0; i < 2; i++) {
      skript.push(() => ({
        status: 302,
        kopf: { location: "http://intern/" },
      }));
    }
    await expect(client(2).listeKategorien()).rejects.toMatchObject({
      code: FEHLER.NICHT_ERREICHBAR,
    });
    expect(pausen).toEqual([500]);
  });

  test("ungültige Antwort wird als solche gemeldet, nie geraten", async () => {
    skript.push(() => ({ status: 200, body: { value: "kein Array" } }));
    await expect(client().listeKategorien()).rejects.toMatchObject({
      code: FEHLER.ANTWORT_UNGUELTIG,
    });
  });
});

describe("Termine", () => {
  test("findet einen Termin über die iCalUId, entschärft Anführungszeichen und schreibt nur categories", async () => {
    skript.push(() => ({
      status: 200,
      body: { value: [{ id: "ev1", categories: ["A"] }] },
    }));
    skript.push(() => ({ status: 200, body: { id: "ev1" } }));
    const c = client();
    const t = await c.findeTermin({
      iCalUId: "uid\x27 or \x271\x27=\x271",
      serie: false,
      beginn: null,
      tagVon: null,
    });
    expect(t).toEqual({ id: "ev1", kategorien: ["A"] });
    expect(decodeURIComponent(graphAnfragen()[0].pfad)).toContain(
      "iCalUId eq 'uid'' or ''1''=''1'",
    );
    await c.setzeTerminKategorien("ev1", ["A", "B"]);
    const patch = graphAnfragen()[1];
    expect(patch.methode).toBe("PATCH");
    expect(JSON.parse(patch.body)).toEqual({ categories: ["A", "B"] });
  });

  test("zwei Treffer sind mehrdeutig, kein Treffer ist null", async () => {
    skript.push(() => ({
      status: 200,
      body: { value: [{ id: "1" }, { id: "2" }] },
    }));
    const ref = { iCalUId: "u", serie: false, beginn: null, tagVon: null };
    await expect(client().findeTermin(ref)).rejects.toMatchObject({
      code: FEHLER.TERMIN_MEHRDEUTIG,
    });
    expect(await client().findeTermin(ref)).toBeNull();
  });

  test("Termin einer Serie: erst die Serie, dann die Instanz am selben Beginn", async () => {
    skript.push(() => ({
      status: 200,
      body: { value: [{ id: "serie1", type: "seriesMaster" }] },
    }));
    skript.push(() => ({
      status: 200,
      body: {
        value: [
          {
            id: "i1",
            categories: ["X"],
            start: { dateTime: "2027-09-04T12:00:00.0000000" },
          },
          {
            id: "i2",
            categories: [],
            start: { dateTime: "2027-09-11T12:00:00.0000000" },
          },
        ],
      },
    }));
    const t = await client().findeTermin({
      iCalUId: "serie-uid",
      serie: true,
      beginn: new Date("2027-09-11T12:00:00Z"),
      tagVon: null,
    });
    expect(t).toEqual({ id: "i2", kategorien: [] });
    expect(graphAnfragen()[1].pfad).toContain("/me/events/serie1/instances?");
    expect(graphAnfragen()[1].kopf.prefer).toBe('outlook.timezone="UTC"');
  });

  test("anlegen: mit transactionId gegen doppeltes Anlegen und geprüften Kategorien", async () => {
    skript.push(() => ({ status: 201, body: { id: "neu" } }));
    const c = client();
    await c.legeTerminAn({
      titel: "Waldtag",
      kategorien: ["Biber"],
      transaktionsId: "t-1",
      zeit: {
        ganztaegig: false,
        beginn: new Date("2027-09-04T12:00:00Z"),
        ende: new Date("2027-09-04T14:00:00Z"),
      },
    });
    expect(JSON.parse(graphAnfragen()[0].body)).toMatchObject({
      subject: "Waldtag",
      isAllDay: false,
      transactionId: "t-1",
      categories: ["Biber"],
      start: { dateTime: "2027-09-04T12:00:00", timeZone: "UTC" },
    });
    await expect(
      c.legeTerminAn({
        titel: "x",
        kategorien: ["A,B"],
        transaktionsId: "t-2",
        zeit: {
          ganztaegig: true,
          vonTag: "2027-09-04",
          bisTagExklusiv: "2027-09-05",
        },
      }),
    ).rejects.toMatchObject({ code: FEHLER.ABGELEHNT });
  });
});

describe("Kategorien der Termine lesen (calendarView)", () => {
  test("holt alle Seiten, löst Serien über den Stamm auf und folgt nur Adressen von Graph", async () => {
    skript.push(() => ({
      status: 200,
      body: {
        value: [
          {
            iCalUId: "einzel",
            type: "singleInstance",
            categories: ["Biber"],
            isAllDay: false,
            start: { dateTime: "2027-09-04T12:00:00.0000000" },
          },
        ],
        "@odata.nextLink": `${basis}/v1.0/me/calendarView?seite=2`,
      },
    }));
    skript.push(() => ({
      status: 200,
      body: {
        value: [
          {
            iCalUId: "instanz-uid",
            type: "occurrence",
            seriesMasterId: "stamm1",
            categories: ["Wölfe"],
            start: { dateTime: "2027-09-11T12:00:00.0000000" },
          },
        ],
      },
    }));
    skript.push(() => ({
      status: 200,
      body: { value: [{ id: "stamm1", iCalUId: "serie-uid" }] },
    }));
    const liste = await client().leseTerminKategorien(
      new Date("2027-09-01T00:00:00Z"),
      new Date("2027-12-01T00:00:00Z"),
    );
    expect(liste).toEqual([
      {
        iCalUId: "einzel",
        serie: false,
        ganztaegig: false,
        start: "2027-09-04T12:00:00.0000000",
        kategorien: ["Biber"],
      },
      {
        iCalUId: "serie-uid",
        serie: true,
        ganztaegig: false,
        start: "2027-09-11T12:00:00.0000000",
        kategorien: ["Wölfe"],
      },
    ]);
    expect(graphAnfragen()[0].pfad).toContain("startDateTime=");
  });

  test("eine nextLink-Adresse ausserhalb von Graph bricht ab (kein Teilergebnis)", async () => {
    skript.push(() => ({
      status: 200,
      body: {
        value: [],
        "@odata.nextLink": "http://169.254.169.254/latest/meta-data",
      },
    }));
    await expect(
      client().leseTerminKategorien(new Date(), new Date()),
    ).rejects.toMatchObject({ code: FEHLER.ANTWORT_UNGUELTIG });
    expect(anfragen).toHaveLength(2);
  });
});

describe("Gerätecode", () => {
  test("wartet, bis die Person freigibt, und liefert nur das Refresh-Token", async () => {
    tokenAntworten.push(
      { status: 400, body: { error: "authorization_pending" } },
      { status: 400, body: { error: "slow_down" } },
      {
        status: 200,
        body: {
          access_token: "z",
          refresh_token: "refresh-geraet",
          scope: "Calendars.ReadWrite MailboxSettings.ReadWrite offline_access",
          expires_in: 3600,
        },
      },
    );
    const g = await starteGeraetecode({
      tenant: "mandant-test",
      clientId: "client-test",
      loginBasis: basis,
      schlaf: async (ms) => {
        pausen.push(ms);
      },
    });
    expect(g.code).toBe("ABC-123");
    expect(await g.warteAufFreigabe()).toBe("refresh-geraet");
    expect(pausen).toEqual([1000, 1000, 6000]);
  });

  test("abgelehnt oder fehlende Berechtigung: Fehler ohne Token", async () => {
    tokenAntworten.push({
      status: 400,
      body: { error: "authorization_declined" },
    });
    const g = await starteGeraetecode({
      tenant: "mandant-test",
      clientId: "client-test",
      loginBasis: basis,
      schlaf: async () => {},
    });
    await expect(g.warteAufFreigabe()).rejects.toMatchObject({
      code: FEHLER.ABGELEHNT,
    });
    tokenAntworten.push({
      status: 200,
      body: {
        access_token: "z",
        refresh_token: "r",
        scope: "Calendars.ReadWrite",
        expires_in: 3600,
      },
    });
    await expect(g.warteAufFreigabe()).rejects.toMatchObject({
      code: FEHLER.ABGELEHNT,
    });
  });
});

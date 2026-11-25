import { z } from "zod";
import { FEHLER, OutlookFehler } from "./fehler.js";
import { kategorieName, PALETTE } from "./kategorien-regeln.js";

// Microsoft-Graph-Client für die Schreibanbindung an den Outlook-Kalender (#835). Nur der Server ruft Graph auf. Der Rest des Codes kennt nur die Schnittstelle OutlookKalender; Tests tauschen sie gegen eine Attrappe oder lassen den echten Client gegen einen HTTP-Server auf localhost laufen.
// Delegierte Anmeldung (Refresh-Token), minimale Scopes: Kalender lesen und schreiben, die Kategorienliste des Postfachs, offline_access für das Refresh-Token.
export const SCOPES =
  "Calendars.ReadWrite MailboxSettings.ReadWrite offline_access";
export const GRAPH_BASIS = "https://graph.microsoft.com/v1.0";
export const LOGIN_BASIS = "https://login.microsoftonline.com";

const ZEITLIMIT_MS = 15_000;
const MAX_BYTES = 1024 * 1024;
const MAX_WARTEN_MS = 30_000;
const BASIS_MS = 500;

export type Kategorie = { id: string; name: string; farbe: string };
export type TerminRef = {
  // iCalUId des Termins; bei einem Termin einer Serie die der Serie (UID im iCal-Feed)
  iCalUId: string;
  serie: boolean;
  beginn: Date | null;
  tagVon: string | null;
};
export type NeuerTermin = {
  titel: string;
  ort?: string;
  kategorien: string[];
  // Gleiche Kennung bei jedem Wiederholen derselben Anlage: Outlook legt den Termin dann nicht doppelt an (transactionId)
  transaktionsId: string;
  zeit:
    | { ganztaegig: true; vonTag: string; bisTagExklusiv: string }
    | { ganztaegig: false; beginn: Date; ende: Date };
};

// Kategorien eines Termins im Kalender, wie Outlook sie führt. iCalUId: bei einem Termin einer Serie die der Serie (UID im iCal-Feed); start: Beginn laut Graph in UTC (bei ganztägigen zählt nur das Datum)
export type TerminKategorien = {
  iCalUId: string;
  serie: boolean;
  ganztaegig: boolean;
  start: string;
  kategorien: string[];
};

export interface OutlookKalender {
  // Alle Termine im Zeitfenster mit ihren Kategorien (calendarView, Serien als einzelne Termine); wirft bei jedem Fehler, nie eine Teilliste
  leseTerminKategorien(von: Date, bis: Date): Promise<TerminKategorien[]>;
  listeKategorien(): Promise<Kategorie[]>;
  // null: Die Kategorie gab es schon (idempotent)
  legeKategorieAn(name: string, farbe: string): Promise<{ id: string } | null>;
  loescheKategorie(id: string): Promise<void>;
  findeTermin(
    ref: TerminRef,
  ): Promise<{ id: string; kategorien: string[] } | null>;
  // Schreibt nur das Feld categories, nie ein anderes
  setzeTerminKategorien(id: string, kategorien: string[]): Promise<void>;
  legeTerminAn(termin: NeuerTermin): Promise<{ id: string }>;
}

export type TokenSpeicher = {
  lade(): Promise<string | null>;
  speichere(refreshToken: string): Promise<void>;
  // Microsoft hat das Token widerrufen: Die Verbindung gilt als abgelaufen, bis sie neu hergestellt ist
  abgelaufen(): Promise<void>;
};

export type GraphOptionen = {
  tenant: string;
  clientId: string;
  graphBasis?: string;
  loginBasis?: string;
  fetch?: typeof fetch;
  schlaf?: (ms: number) => Promise<void>;
  jetzt?: () => number;
  // Anfragen je Aufruf einschliesslich Wiederholungen; 1 = nie wiederholen
  versuche?: number;
};

export type Http = ReturnType<typeof erstelleHttp>;

const warte = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryAfterMs(wert: string | null, jetzt: number): number | null {
  if (!wert) return null;
  if (/^\d+$/.test(wert)) return Number(wert) * 1000;
  const datum = Date.parse(wert);
  return Number.isNaN(datum) ? null : Math.max(0, datum - jetzt);
}

async function lies(antwort: Response): Promise<string> {
  if (Number(antwort.headers.get("content-length")) > MAX_BYTES) {
    await antwort.body?.cancel();
    throw new OutlookFehler(FEHLER.ANTWORT_UNGUELTIG);
  }
  const text = await antwort.text();
  if (text.length > MAX_BYTES)
    throw new OutlookFehler(FEHLER.ANTWORT_UNGUELTIG);
  return text;
}

// Eine Anfrage mit Zeitlimit, ohne Weiterleitung, mit Wiederholung: Netzfehler und 5xx mit Backoff, 429 und 503 nach Retry-After (bis 30 s; länger gilt als «zu viele Anfragen» und der Auftrag wartet). 4xx ausser `durchlassen` wirft ABGELEHNT; die Antwort selbst steht nie im Fehler.
export function erstelleHttp(o: GraphOptionen) {
  const f = o.fetch ?? fetch;
  const schlaf = o.schlaf ?? warte;
  const jetzt = o.jetzt ?? Date.now;
  const versuche = o.versuche ?? 4;
  const graph = o.graphBasis ?? GRAPH_BASIS;
  const login = o.loginBasis ?? LOGIN_BASIS;

  async function sende(
    url: string,
    init: RequestInit,
    {
      auth,
      durchlassen = [],
    }: {
      auth?: { token(): Promise<string>; verwerfe(): void };
      durchlassen?: number[];
    } = {},
  ): Promise<{ status: number; body: unknown }> {
    let erneuert = false;
    for (let n = 0; ; n++) {
      const letzter = n + 1 >= versuche;
      const kopf = new Headers(init.headers);
      if (auth) kopf.set("Authorization", `Bearer ${await auth.token()}`);
      let antwort: Response;
      try {
        antwort = await f(url, {
          ...init,
          headers: kopf,
          redirect: "error",
          signal: AbortSignal.timeout(ZEITLIMIT_MS),
        });
      } catch (fehler) {
        if (letzter) {
          throw new OutlookFehler(FEHLER.NICHT_ERREICHBAR, { cause: fehler });
        }
        await schlaf(BASIS_MS * 2 ** n);
        continue;
      }
      const text = await lies(antwort);
      const status = antwort.status;
      if (status === 401 && auth && !erneuert) {
        erneuert = true;
        auth.verwerfe();
        n--;
        continue;
      }
      if (status === 429 || status === 503) {
        const warten = retryAfterMs(
          antwort.headers.get("retry-after"),
          jetzt(),
        );
        if (warten !== null && warten > MAX_WARTEN_MS) {
          const fehler = new OutlookFehler(FEHLER.ZU_VIELE_ANFRAGEN);
          fehler.wartenSek = Math.ceil(warten / 1000);
          throw fehler;
        }
        if (letzter) {
          const fehler = new OutlookFehler(
            status === 429 ? FEHLER.ZU_VIELE_ANFRAGEN : FEHLER.SERVER,
          );
          if (warten !== null) fehler.wartenSek = Math.ceil(warten / 1000);
          throw fehler;
        }
        await schlaf(warten ?? BASIS_MS * 2 ** n);
        continue;
      }
      if (status >= 500) {
        if (letzter) throw new OutlookFehler(FEHLER.SERVER);
        await schlaf(BASIS_MS * 2 ** n);
        continue;
      }
      if (status >= 200 && status < 300) {
        if (text === "") return { status, body: undefined };
        try {
          return { status, body: JSON.parse(text) as unknown };
        } catch (fehler) {
          throw new OutlookFehler(FEHLER.ANTWORT_UNGUELTIG, { cause: fehler });
        }
      }
      if (durchlassen.includes(status)) {
        let body: unknown;
        try {
          body = text === "" ? undefined : (JSON.parse(text) as unknown);
        } catch {
          body = undefined;
        }
        return { status, body };
      }
      throw new OutlookFehler(FEHLER.ABGELEHNT);
    }
  }
  return { sende, graph, login, tenant: o.tenant, clientId: o.clientId, jetzt };
}

const antwortToken = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});
const fehlerToken = z.object({ error: z.string() });

export const formular = (felder: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(felder).toString(),
});

// Zugriffstoken aus dem Refresh-Token; ein neues Refresh-Token (Microsoft dreht es bei jeder Erneuerung) wird sofort gespeichert. Gleichzeitige Aufrufe teilen sich eine Erneuerung.
function erstelleTokenQuelle(http: Http, speicher: TokenSpeicher) {
  let zugriff: { token: string; bis: number } | null = null;
  let laufend: Promise<string> | null = null;

  async function erneuere(): Promise<string> {
    const refresh = await speicher.lade();
    if (!refresh) throw new OutlookFehler(FEHLER.NICHT_VERBUNDEN);
    const antwort = await http.sende(
      `${http.login}/${encodeURIComponent(http.tenant)}/oauth2/v2.0/token`,
      formular({
        client_id: http.clientId,
        grant_type: "refresh_token",
        refresh_token: refresh,
        scope: SCOPES,
      }),
      { durchlassen: [400, 401] },
    );
    if (antwort.status !== 200) {
      const f = fehlerToken.safeParse(antwort.body);
      if (f.success && f.data.error === "invalid_grant") {
        await speicher.abgelaufen();
        throw new OutlookFehler(FEHLER.ANMELDUNG_ABGELAUFEN);
      }
      throw new OutlookFehler(FEHLER.ABGELEHNT);
    }
    const t = antwortToken.safeParse(antwort.body);
    if (!t.success) throw new OutlookFehler(FEHLER.ANTWORT_UNGUELTIG);
    if (t.data.refresh_token && t.data.refresh_token !== refresh) {
      await speicher.speichere(t.data.refresh_token);
    }
    // Eine Minute Reserve, damit das Token nicht mitten in einer Anfrage verfällt
    zugriff = {
      token: t.data.access_token,
      bis: http.jetzt() + Math.max(60, t.data.expires_in - 60) * 1000,
    };
    return zugriff.token;
  }

  return {
    async token() {
      if (zugriff && zugriff.bis > http.jetzt()) return zugriff.token;
      laufend ??= erneuere().finally(() => {
        laufend = null;
      });
      return laufend;
    },
    verwerfe() {
      zugriff = null;
    },
  };
}

const kategorienAntwort = z.object({
  value: z.array(
    z.object({
      id: z.string().min(1),
      displayName: z.string(),
      color: z.string().optional(),
    }),
  ),
});
const kategorieAntwort = z.object({ id: z.string().min(1) });
const termineAntwort = z.object({
  value: z.array(
    z.object({
      id: z.string().min(1),
      type: z.string().optional(),
      categories: z.array(z.string()).optional(),
      isAllDay: z.boolean().optional(),
      start: z.object({ dateTime: z.string() }).optional(),
    }),
  ),
});
const terminAntwort = z.object({ id: z.string().min(1) });
const MAX_SEITEN = 50;
const seiteSchema = z.object({
  value: z.array(
    z.object({
      id: z.string().optional(),
      iCalUId: z.string().optional(),
      type: z.string().optional(),
      seriesMasterId: z.string().nullish(),
      categories: z.array(z.string()).optional(),
      isAllDay: z.boolean().optional(),
      start: z.object({ dateTime: z.string() }).optional(),
    }),
  ),
  "@odata.nextLink": z.string().optional(),
});

const odataText = (t: string) => `'${t.replaceAll("'", "''")}'`;
const pfadTeil = encodeURIComponent;
const TAG_MS = 86_400_000;

// «schnell» versucht jede Anfrage nur einmal und wartet nie: für Aufrufe aus einer Anfrage der Verwaltung, die nicht hängen soll. Beide teilen sich das Zugriffstoken (Microsoft dreht das Refresh-Token bei jeder Erneuerung, zwei Erneuerungen nebeneinander wären ein Wettlauf).
export function erstelleGraphClients(
  o: GraphOptionen,
  speicher: TokenSpeicher,
): { normal: OutlookKalender; schnell: OutlookKalender } {
  const http = erstelleHttp(o);
  const auth = erstelleTokenQuelle(http, speicher);
  return {
    normal: baueClient(http, auth),
    schnell: baueClient(erstelleHttp({ ...o, versuche: 1 }), auth),
  };
}

export const erstelleGraphClient = (
  o: GraphOptionen,
  speicher: TokenSpeicher,
) => erstelleGraphClients(o, speicher).normal;

function baueClient(
  http: Http,
  auth: ReturnType<typeof erstelleTokenQuelle>,
): OutlookKalender {
  const g = (
    methode: string,
    pfad: string,
    body?: unknown,
    optionen: { durchlassen?: number[]; kopf?: Record<string, string> } = {},
  ) =>
    http.sende(
      `${http.graph}${pfad}`,
      {
        method: methode,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...optionen.kopf,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      { auth, durchlassen: optionen.durchlassen },
    );
  const pruefe = <T>(schema: z.ZodType<T>, wert: unknown): T => {
    const r = schema.safeParse(wert);
    if (!r.success) throw new OutlookFehler(FEHLER.ANTWORT_UNGUELTIG);
    return r.data;
  };
  // Die Eingabe an einer Vertrauensgrenze: Was Outlook nicht annähme, geht gar nicht erst hinaus
  const pruefeNamen = (namen: string[]) => {
    for (const n of namen) {
      if (kategorieName(n) !== n) throw new OutlookFehler(FEHLER.ABGELEHNT);
    }
  };

  // Holt alle Seiten einer Liste; die nächste Adresse muss zu Graph gehören (SR-26: nie einer Adresse aus einer Antwort folgen, die woanders hinführt) und die Zahl der Seiten ist begrenzt
  async function alleSeiten(pfad: string, kopf?: Record<string, string>) {
    const eintraege: z.infer<typeof seiteSchema>["value"] = [];
    let url: string | undefined = `${http.graph}${pfad}`;
    for (let n = 0; url; n++) {
      if (n >= MAX_SEITEN || !url.startsWith(`${http.graph}/`)) {
        throw new OutlookFehler(FEHLER.ANTWORT_UNGUELTIG);
      }
      const { body } = await http.sende(url, { headers: kopf }, { auth });
      const seite = pruefe(seiteSchema, body);
      eintraege.push(...seite.value);
      url = seite["@odata.nextLink"];
    }
    return eintraege;
  }

  return {
    async leseTerminKategorien(von, bis) {
      const UTC = { Prefer: 'outlook.timezone="UTC"' };
      const ansicht = await alleSeiten(
        `/me/calendarView?startDateTime=${encodeURIComponent(von.toISOString())}&endDateTime=${encodeURIComponent(bis.toISOString())}&$select=iCalUId,type,seriesMasterId,categories,start,isAllDay&$top=100`,
        UTC,
      );
      // Instanzen einer Serie tragen die Kennung der Serie erst über ihren Stamm: iCalUId des Stamms nachschlagen
      let staemme: Map<string, string> | undefined;
      const ergebnis: TerminKategorien[] = [];
      for (const e of ansicht) {
        const start = e.start?.dateTime;
        if (!start) continue;
        const serie = e.type === "occurrence" || e.type === "exception";
        let uid = e.iCalUId;
        if (serie) {
          staemme ??= new Map(
            (
              await alleSeiten(
                "/me/events?$filter=" +
                  encodeURIComponent("type eq 'seriesMaster'") +
                  "&$select=id,iCalUId&$top=100",
              )
            ).flatMap((m) => (m.id && m.iCalUId ? [[m.id, m.iCalUId]] : [])),
          );
          uid = e.seriesMasterId ? staemme.get(e.seriesMasterId) : undefined;
        }
        if (!uid) continue;
        ergebnis.push({
          iCalUId: uid,
          serie,
          ganztaegig: e.isAllDay === true,
          start,
          kategorien: e.categories ?? [],
        });
      }
      return ergebnis;
    },

    async listeKategorien() {
      const { body } = await g("GET", "/me/outlook/masterCategories");
      return pruefe(kategorienAntwort, body).value.map((k) => ({
        id: k.id,
        name: k.displayName,
        farbe: k.color ?? "none",
      }));
    },

    async legeKategorieAn(name, farbe) {
      pruefeNamen([name]);
      if (!PALETTE.includes(farbe)) throw new OutlookFehler(FEHLER.ABGELEHNT);
      const { status, body } = await g(
        "POST",
        "/me/outlook/masterCategories",
        { displayName: name, color: farbe },
        { durchlassen: [409] },
      );
      return status === 409 ? null : pruefe(kategorieAntwort, body);
    },

    async loescheKategorie(id) {
      // 404: war schon weg
      await g(
        "DELETE",
        `/me/outlook/masterCategories/${pfadTeil(id)}`,
        undefined,
        {
          durchlassen: [404],
        },
      );
    },

    async findeTermin(ref) {
      const filter = encodeURIComponent(`iCalUId eq ${odataText(ref.iCalUId)}`);
      const { body } = await g(
        "GET",
        `/me/events?$filter=${filter}&$select=id,type,categories&$top=5`,
      );
      const treffer = pruefe(termineAntwort, body).value;
      if (!ref.serie) {
        if (treffer.length === 0) return null;
        if (treffer.length > 1)
          throw new OutlookFehler(FEHLER.TERMIN_MEHRDEUTIG);
        return { id: treffer[0].id, kategorien: treffer[0].categories ?? [] };
      }
      // Termin einer Serie: erst die Serie, dann die Instanz am selben Beginn
      const serie = treffer.find((t) => t.type === "seriesMaster");
      if (!serie) return null;
      const ganztaegig = ref.beginn === null;
      const mitte = ganztaegig
        ? Date.parse(`${ref.tagVon}T00:00:00Z`)
        : ref.beginn!.getTime();
      if (Number.isNaN(mitte)) throw new OutlookFehler(FEHLER.ABGELEHNT);
      const von = new Date(mitte - TAG_MS).toISOString();
      const bis = new Date(mitte + 2 * TAG_MS).toISOString();
      const { body: instanzen } = await g(
        "GET",
        `/me/events/${pfadTeil(serie.id)}/instances?startDateTime=${encodeURIComponent(von)}&endDateTime=${encodeURIComponent(bis)}&$select=id,categories,start,isAllDay&$top=50`,
        undefined,
        // Zeiten in UTC, damit sie sich mit dem Beginn vergleichen lassen (ganztägige Termine vergleicht der Code nur nach dem Datum)
        { kopf: { Prefer: 'outlook.timezone="UTC"' } },
      );
      const passend = pruefe(termineAntwort, instanzen).value.filter((i) => {
        const start = i.start?.dateTime;
        if (!start) return false;
        return ganztaegig
          ? start.slice(0, 10) === ref.tagVon
          : Date.parse(`${start.slice(0, 19)}Z`) === mitte;
      });
      if (passend.length === 0) return null;
      if (passend.length > 1) throw new OutlookFehler(FEHLER.TERMIN_MEHRDEUTIG);
      return { id: passend[0].id, kategorien: passend[0].categories ?? [] };
    },

    async setzeTerminKategorien(id, kategorien) {
      pruefeNamen(kategorien);
      // Nur categories: Titel, Zeit, Ort, Beschreibung und Teilnehmende bleiben, wie sie sind
      await g("PATCH", `/me/events/${pfadTeil(id)}`, {
        categories: kategorien,
      });
    },

    async legeTerminAn(t) {
      pruefeNamen(t.kategorien);
      const zeit = t.zeit.ganztaegig
        ? {
            isAllDay: true,
            start: { dateTime: `${t.zeit.vonTag}T00:00:00`, timeZone: "UTC" },
            end: {
              dateTime: `${t.zeit.bisTagExklusiv}T00:00:00`,
              timeZone: "UTC",
            },
          }
        : {
            isAllDay: false,
            start: {
              dateTime: t.zeit.beginn.toISOString().slice(0, 19),
              timeZone: "UTC",
            },
            end: {
              dateTime: t.zeit.ende.toISOString().slice(0, 19),
              timeZone: "UTC",
            },
          };
      const { body } = await g("POST", "/me/events", {
        subject: t.titel,
        ...zeit,
        ...(t.ort ? { location: { displayName: t.ort } } : {}),
        categories: t.kategorien,
        transactionId: t.transaktionsId,
      });
      return pruefe(terminAntwort, body);
    },
  };
}

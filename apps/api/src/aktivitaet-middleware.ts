import type { Context, Next } from "hono";
import { routePath } from "hono/route";

// Aktivitätsprotokoll (#637), die Seite der Anfrage: Eine Middleware an einer Stelle (app.ts) erfasst jede schreibende Anfrage gegen die API, dazu die wenigen lesenden Zugriffe auf Kinder- und Exportdaten. Ohne node:* und process, wie app.ts: Die App prüft deren Importe über AppType. Die Ablage (Puffer, Datenbank, Hash) steht in aktivitaet.ts.
// Hierher gehört nie: der Pfad (er kann Tokens tragen), Query, Header, Cookies, Body oder Antwort. Es bleiben das Routenmuster, UUIDs aus dem Pfad, die Namen der Felder des JSON-Bodys, Status, Fehlercode, Dauer, ein Hash der IP und die Familie des Browsers.

export type AktivitaetEintrag = {
  zeit: Date;
  art: "aktion" | "anmeldung" | "audit" | "zugriff" | "system";
  abteilungId?: string;
  userId?: string;
  akteur?: "person" | "anonym" | "cli" | "system";
  name?: string;
  rollen?: string[];
  methode?: string;
  aktion: string;
  bereich: string;
  objektTyp?: string;
  objektId?: string;
  felder?: string[];
  status?: number;
  ergebnis: "erfolg" | "fehler";
  fehlerCode?: string;
  dauerMs?: number;
  herkunft?: string;
  geraet?: string;
  anfrageId?: string;
  anzahl?: number;
};

export type AktivitaetSenke = {
  erfasse(eintrag: AktivitaetEintrag): void;
  // Gekürzter Hash der IP mit Tagessalz; ohne IP undefined
  herkunft(ip: string | undefined): string | undefined;
  // Meldet, dass eine Zeile noch entsteht (Body und Antwort werden gelesen); leere() wartet darauf
  erwarte(offen: Promise<unknown>): void;
};

export type AktivitaetVariablen = {
  nutzerId?: string;
  requestId?: string;
  // Gesetzt von der Anmeldung (auth.ts): der Grund, den der Client nie sieht (Wartezeit, falsches Passwort), ersetzt den Code der Antwort
  aktivitaetCode?: string;
};

// Lesend und nie erfasst, ausser der Pfad steht in ZUGRIFF
const LESEND = new Set(["GET", "HEAD", "OPTIONS"]);

// Lesende Routen mit Kinder-, Export- oder Kontaktdaten und das Protokoll selbst: Sie erscheinen als Zeile der Art «zugriff», nur bei Erfolg (ein Fehler ist eine Verweigerung und steht ohnehin im Log der API). Alle anderen lesenden Anfragen bleiben ausser Betracht: zu viele, kein Gewinn
export const ZUGRIFF: ReadonlySet<string> = new Set([
  "GET /api/v1/admin/kinder",
  "GET /api/v1/admin/personen",
  "GET /api/v1/admin/anlaesse/:id/anmeldungen",
  "GET /api/v1/admin/anlaesse/:id/anmeldungen.csv",
  "GET /api/v1/admin/laden/bestellungen",
  "GET /api/v1/lager/:id/teilnehmer",
  "GET /api/v1/lager/:id/adressbuch",
  "GET /api/v1/lager/:id/notfall",
  "GET /api/v1/admin/protokoll",
  "GET /api/v1/admin/protokoll/:id",
  "GET /api/v1/admin/protokoll/export.csv",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Nur schlichte Feldnamen: Ein Schlüssel mit anderem Inhalt wird nicht gespeichert
const FELDNAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
// Grösser ist kein Formular, sondern ein Dokument oder Upload: Die Namen der Felder interessieren dort nicht
const BODY_MAX = 16 * 1024;
const FELDER_MAX = 30;

// Bereich für Filter und Anzeige: «admin/<x>» heisst <x>, die Website-Verwaltung «website», die Anmeldung «anmeldung»
export function bereichVon(route: string) {
  const teile = route.split("/").filter(Boolean);
  if (teile[0] !== "api") return "sonstiges";
  if (teile[1] === "auth") return "anmeldung";
  const [erster, zweiter] = teile.slice(2);
  if (erster === undefined) return "sonstiges";
  if (erster === "admin") {
    return zweiter === undefined || zweiter.startsWith(":") ? "admin" : zweiter;
  }
  return erster === "redaktion" ? "website" : erster;
}

// Objekt aus dem Muster und dem echten Pfad: die letzte Pfadstelle «:name», deren Wert eine UUID ist, mit dem Wort davor als Typ. Andere Werte (ein Token, ein Name) werden nie übernommen
export function objektVon(route: string, pfad: string) {
  const muster = route.split("/");
  const echt = pfad.split("/");
  let ergebnis: { objektTyp: string; objektId: string } | undefined;
  for (const [i, teil] of muster.entries()) {
    if (!teil.startsWith(":") || i === 0) continue;
    const wert = echt[i];
    const typ = muster[i - 1];
    if (wert && UUID.test(wert) && !typ.startsWith(":")) {
      ergebnis = { objektTyp: typ.slice(0, 60), objektId: wert.toLowerCase() };
    }
  }
  return ergebnis;
}

// Browser-Familie aus dem User-Agent; der volle Text bleibt nie stehen
export function geraetVon(ua: string | undefined) {
  if (!ua) return undefined;
  if (/cevi|expo|okhttp|CFNetwork|Dalvik/i.test(ua)) return "App";
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  if (/curl|node|undici|python|Postman/i.test(ua)) return "Werkzeug";
  return "Andere";
}

// Die Namen der obersten Ebene eines JSON-Objekts; ein anderer Aufbau oder ein Fehler ergibt nichts
async function feldNamen(kopie: Request) {
  try {
    const wert: unknown = await kopie.json();
    if (typeof wert !== "object" || wert === null || Array.isArray(wert)) {
      return undefined;
    }
    const namen = Object.keys(wert)
      .filter((n) => FELDNAME.test(n))
      .slice(0, FELDER_MAX);
    return namen.length > 0 ? namen.sort() : undefined;
  } catch {
    return undefined;
  }
}

// Der Code im Body einer Fehlerantwort ({ code, message }); sonst nichts
async function fehlerCodeVon(antwort: Response) {
  try {
    const wert = (await antwort.json()) as { code?: unknown };
    return typeof wert.code === "string" ? wert.code.slice(0, 60) : undefined;
  } catch {
    return undefined;
  }
}

// Die Zeile entsteht nach der Antwort; was an Body und Antwort zu lesen ist, läuft ohne die Anfrage aufzuhalten. Ein Fehler hier darf die Anfrage nie berühren: Alles steht in einem try, und erfasse() wirft nie
export function aktivitaetMiddleware(senke: AktivitaetSenke) {
  return async (c: Context<{ Variables: AktivitaetVariablen }>, next: Next) => {
    const methode = c.req.method;
    const pfad = c.req.path;
    // Nur die API: statische Dateien der Verwaltung, Health, Seiten und iCal-Abrufe bleiben aussen vor
    if (!pfad.startsWith("/api/v1/") && !pfad.startsWith("/api/auth/")) {
      return next();
    }
    const lesend = LESEND.has(methode);
    if (lesend && methode !== "GET") return next();
    const zeit = new Date();
    const start = performance.now();
    let feldPromise: Promise<string[] | undefined> | undefined;
    try {
      const laenge = Number(c.req.header("content-length") ?? "0");
      if (
        !lesend &&
        !pfad.startsWith("/api/auth/") &&
        (c.req.header("content-type") ?? "").startsWith("application/json") &&
        laenge > 0 &&
        laenge <= BODY_MAX
      ) {
        // Die Kopie hält den Body bereit, auch wenn die Route ihn liest; gelesen wird erst, wenn die Antwort fertig ist
        feldPromise = feldNamen(c.req.raw.clone());
      }
    } catch {
      feldPromise = undefined;
    }
    await next();
    try {
      const route = routePath(c);
      const unbekannt = route.includes("*");
      const aktion = `${methode} ${unbekannt ? "(unbekannte Route)" : route}`;
      if (lesend && !ZUGRIFF.has(aktion)) return;
      const status = c.res.status;
      if (lesend && status >= 400) return;
      const dauerMs = Math.round(performance.now() - start);
      const ip = (c.req.header("x-forwarded-for") ?? "")
        .split(",")
        .at(-1)
        ?.trim();
      const nutzerId = c.get("nutzerId");
      const eintrag: AktivitaetEintrag = {
        zeit,
        art: pfad.startsWith("/api/auth/")
          ? "anmeldung"
          : lesend
            ? "zugriff"
            : "aktion",
        userId: nutzerId,
        akteur: nutzerId ? "person" : "anonym",
        methode,
        aktion,
        bereich: unbekannt ? "sonstiges" : bereichVon(route),
        ...(unbekannt ? {} : objektVon(route, pfad)),
        status,
        ergebnis: status < 400 ? "erfolg" : "fehler",
        dauerMs,
        herkunft: senke.herkunft(ip),
        geraet: geraetVon(c.req.header("user-agent")),
        anfrageId: c.get("requestId"),
      };
      const vorgegeben = c.get("aktivitaetCode");
      // Nur Fehlerantworten tragen einen Code, und nur ihr kleiner JSON-Body wird gelesen
      const codePromise =
        status >= 400 && vorgegeben === undefined
          ? (c.res.headers.get("content-type") ?? "").startsWith(
              "application/json",
            )
            ? fehlerCodeVon(c.res.clone())
            : Promise.resolve(undefined)
          : Promise.resolve(vorgegeben);
      senke.erwarte(
        Promise.all([feldPromise, codePromise]).then(([felder, code]) =>
          senke.erfasse({ ...eintrag, felder, fehlerCode: code }),
        ),
      );
    } catch {
      // Das Protokoll darf nie eine Anfrage scheitern lassen
    }
  };
}

import type { Context, Next } from "hono";
import { routePath } from "hono/route";
import {
  OBJEKT_ARTEN,
  katalogVon,
  sicherAngaben,
  type AenderungsDetails,
} from "./aktivitaet-beschreibung.js";
import { clientIp } from "./client-ip.js";

// Änderungsprotokoll (#637, #662), die Seite der Anfrage: Eine Middleware an einer Stelle (app.ts) erfasst, was eine Anfrage wirklich geändert hat: jede erfolgreiche schreibende Anfrage (2xx bei POST, PUT, PATCH, DELETE), ausser Vorschau, Anmelden und Alltagseingaben (Katalog in aktivitaet-titel.ts, Feld «nicht»). Abgelehnte und fehlgeschlagene Anfragen, lesende Zugriffe und der Erfolg beim Anmelden stehen nicht darin. Fehlgeschlagene Anmeldungen, Fehler beim zweiten Faktor und die Begrenzung (429) sind keine Änderungen, sondern Sicherheitsereignisse: eigene Art, in der Ablage je Konto und Stunde zusammengezogen.
// Ohne node:* und process, wie app.ts: Die App prüft deren Importe über AppType. Die Ablage (Puffer, Datenbank, Hash) steht in aktivitaet.ts.
// Hierher gehört nie: der Pfad (er kann Tokens tragen), Query, Header, Cookies, Body oder Antwort. Es bleiben das Routenmuster, UUIDs aus dem Pfad, die Namen der Felder des JSON-Bodys, Status, Fehlercode, Dauer, ein Hash der IP und die Familie des Browsers.

export type AktivitaetEintrag = {
  zeit: Date;
  art: "aktion" | "audit" | "system" | "sicherheit";
  abteilungId?: string;
  userId?: string;
  akteur?: "person" | "anonym" | "cli" | "system";
  name?: string;
  rollen?: string[];
  methode?: string;
  aktion: string;
  bereich: string;
  gruppe?: string;
  objektTyp?: string;
  objektId?: string;
  // Name des Objekts, nur aus Tabellen ohne Personendaten (aktivitaet.ts, NAMENS_QUELLEN)
  objektName?: string;
  felder?: string[];
  aenderung?: AenderungsDetails;
  beschreibung?: string;
  status?: number;
  ergebnis: "erfolg" | "fehler";
  fehlerCode?: string;
  dauerMs?: number;
  herkunft?: string;
  geraet?: string;
  anfrageId?: string;
  anzahl?: number;
};

export type NamensAbfrage = { typ: string; id: string; elternTyp?: string };

export type AktivitaetSenke = {
  erfasse(eintrag: AktivitaetEintrag): void;
  // Gekürzter Hash der IP mit Tagessalz; ohne IP undefined
  herkunft(ip: string | undefined): string | undefined;
  // Meldet, dass eine Zeile noch entsteht (Body und Antwort werden gelesen); leere() wartet darauf
  erwarte(offen: Promise<unknown>): void;
  // Namen von Objekten (Kennung → Name), nur wo die Tabelle keine Personendaten trägt. Die Middleware fragt vor dem Löschen, solange das Objekt noch da ist
  namen?(abfrage: NamensAbfrage[]): Promise<Record<string, string>>;
};

export type AktivitaetVariablen = {
  nutzerId?: string;
  requestId?: string;
  // Gesetzt von der Anmeldung (auth.ts): der Grund, den der Client nie sieht (Wartezeit, falsches Passwort), ersetzt den Code der Antwort
  aktivitaetCode?: string;
};

// Was eine Route über ihre Änderung melden kann, ohne Inhalte: Namen von Rechten, die dazukamen oder wegfielen, einfache Statuswerte vorher und nachher, ein eigener Satz. keine: true heisst, dass nichts geändert wurde (Vorschau, gleicher Wert): Die Zeile entfällt
export type AenderungsHinweis = {
  keine?: boolean;
  text?: string;
  hinzu?: string[];
  weg?: string[];
  vorher?: Record<string, unknown>;
  nachher?: Record<string, unknown>;
  objektName?: string;
};
const HINWEISE = new WeakMap<Request, AenderungsHinweis>();
// Die Route ruft das nach ihrem Schreiben; der Schlüssel ist die Anfrage, nicht der Context, damit jede Hono-Instanz es kann
export function meldeAenderung(
  c: { req: { raw: Request } },
  hinweis: AenderungsHinweis,
) {
  HINWEISE.set(c.req.raw, { ...HINWEISE.get(c.req.raw), ...hinweis });
}

const SCHREIBEND = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Nur schlichte Feldnamen: Ein Schlüssel mit anderem Inhalt wird nicht gespeichert
const FELDNAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
// Grösser ist kein Formular, sondern ein Dokument oder Upload: Die Namen der Felder interessieren dort nicht
const BODY_MAX = 16 * 1024;
const ANTWORT_MAX = 32 * 1024;
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

// Alle Objekte aus dem Muster und dem echten Pfad: jede Stelle «:name», deren Wert eine UUID ist, mit dem Wort davor als Typ. Andere Werte (ein Token, ein Name) werden nie übernommen
function objekteVon(route: string, pfad: string) {
  const muster = route.split("/");
  const echt = pfad.split("/");
  const liste: { objektTyp: string; objektId: string }[] = [];
  for (const [i, teil] of muster.entries()) {
    if (!teil.startsWith(":") || i === 0) continue;
    const wert = echt[i];
    const typ = muster[i - 1];
    if (wert && UUID.test(wert) && !typ.startsWith(":")) {
      liste.push({ objektTyp: typ.slice(0, 60), objektId: wert.toLowerCase() });
    }
  }
  return liste;
}
// Das Objekt der Anfrage: die letzte Kennung im Pfad
export function objektVon(route: string, pfad: string) {
  return objekteVon(route, pfad).at(-1);
}

// Vor der Route, wenn das Muster noch nicht feststeht: die UUIDs des Pfades mit dem Wort davor
function pfadObjekte(pfad: string) {
  const teile = pfad.split("/");
  const liste: { typ: string; id: string }[] = [];
  for (const [i, teil] of teile.entries()) {
    const typ = teile[i - 1];
    if (i > 0 && UUID.test(teil) && typ && !UUID.test(typ)) {
      liste.push({ typ: typ.slice(0, 60), id: teil.toLowerCase() });
    }
  }
  return liste;
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

// Die Kennung eines neu angelegten Objekts aus der Antwort ({ id }); sonst nichts, und nur aus einem kleinen JSON-Body
async function angelegteIdVon(antwort: Response) {
  try {
    const text = await antwort.text();
    if (text.length > ANTWORT_MAX) return undefined;
    const wert = JSON.parse(text) as { id?: unknown };
    return typeof wert.id === "string" && UUID.test(wert.id)
      ? wert.id.toLowerCase()
      : undefined;
  } catch {
    return undefined;
  }
}

// Das letzte feste Wort der Route («/api/v1/admin/anlaesse» → anlaesse): der Typ eines neu angelegten Objekts, wenn er bekannt ist
function sammelwortVon(route: string) {
  const wort = route
    .split("/")
    .filter((t) => t && !t.startsWith(":"))
    .at(-1);
  return wort && wort in OBJEKT_ARTEN ? wort : undefined;
}

// Sicherheitsereignisse: keine Änderungen, aber das, woran man Angriffe erkennt. Fehlgeschlagene Anmeldung, falscher zweiter Faktor, Begrenzung der Anfragen (429)
function istSicherheit(methode: string, route: string, status: number) {
  if (status === 429) return true;
  if (status < 400 || methode !== "POST") return false;
  return (
    route === "/api/auth/sign-in/username" ||
    // Der Nachweis der App (#785): ein abgelehnter Nachweis ist ein Sicherheitsereignis, nie mit dem Inhalt des Tokens
    route === "/api/v1/app/nachweis" ||
    route === "/api/auth/two-factor/verify-totp" ||
    route === "/api/auth/two-factor/verify-backup-code"
  );
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
    const schreibend = SCHREIBEND.has(methode);
    const zeit = new Date();
    const start = performance.now();
    let feldPromise: Promise<string[] | undefined> | undefined;
    let namePromise: Promise<Record<string, string>> | undefined;
    try {
      const laenge = Number(c.req.header("content-length") ?? "0");
      if (
        schreibend &&
        !pfad.startsWith("/api/auth/") &&
        (c.req.header("content-type") ?? "").startsWith("application/json") &&
        laenge > 0 &&
        laenge <= BODY_MAX
      ) {
        // Die Kopie hält den Body bereit, auch wenn die Route ihn liest; gelesen wird erst, wenn die Antwort fertig ist
        feldPromise = feldNamen(c.req.raw.clone());
      }
      // Wer etwas löscht, nimmt den Namen mit: Die Abfrage startet vor der Route und wartet nicht auf sie, nach dem Löschen gäbe es nichts mehr zu lesen
      if (methode === "DELETE" && senke.namen) {
        const objekte = pfadObjekte(pfad).slice(-2);
        if (objekte.length > 0) {
          namePromise = senke
            .namen(
              objekte.map((o, i) => ({
                typ: o.typ,
                id: o.id,
                elternTyp: i > 0 ? objekte[i - 1]?.typ : undefined,
              })),
            )
            .catch(() => ({}));
        }
      }
    } catch {
      feldPromise = undefined;
    }
    await next();
    try {
      const status = c.res.status;
      const route = routePath(c);
      const unbekannt = route.includes("*");
      const aktion = `${methode} ${unbekannt ? "(unbekannte Route)" : route}`;
      const dauerMs = Math.round(performance.now() - start);
      const ip = clientIp(c.req.header("x-forwarded-for"));
      const nutzerId = c.get("nutzerId");
      const gemeinsam = {
        zeit,
        userId: nutzerId,
        akteur: nutzerId ? ("person" as const) : ("anonym" as const),
        methode,
        aktion,
        bereich: unbekannt ? "sonstiges" : bereichVon(route),
        status,
        dauerMs,
        herkunft: senke.herkunft(ip),
        geraet: geraetVon(c.req.header("user-agent")),
        anfrageId: c.get("requestId"),
      };
      if (istSicherheit(methode, route, status)) {
        // Der Grund, den der Client nie sieht, ersetzt den Code der Antwort; sonst der Code im Body
        const vorgegeben = c.get("aktivitaetCode");
        const codePromise =
          vorgegeben !== undefined
            ? Promise.resolve(vorgegeben)
            : (c.res.headers.get("content-type") ?? "").startsWith(
                  "application/json",
                )
              ? fehlerCodeVon(c.res.clone())
              : Promise.resolve(undefined);
        senke.erwarte(
          codePromise.then((code) =>
            senke.erfasse({
              ...gemeinsam,
              art: "sicherheit",
              // Die Begrenzung trifft jede Route: Sie steht unter einem Namen, damit die Zeilen sich zusammenziehen lassen
              aktion:
                status === 429 && !route.startsWith("/api/auth/")
                  ? "(begrenzt)"
                  : aktion,
              ergebnis: "fehler",
              fehlerCode: code,
              anzahl: 1,
            }),
          ),
        );
        return;
      }
      // Nur, was etwas geändert hat: schreibend und erfolgreich
      if (!schreibend || status < 200 || status >= 300 || unbekannt) return;
      const eintrag = katalogVon(aktion);
      if (eintrag?.nicht) return;
      const hinweis = HINWEISE.get(c.req.raw);
      if (hinweis?.keine) return;
      const objekte = objekteVon(route, pfad);
      const sammelwort = sammelwortVon(route);
      const legtAn = eintrag?.gruppe === "angelegt" && sammelwort !== undefined;
      const idPromise: Promise<string | undefined> =
        legtAn &&
        (c.res.headers.get("content-type") ?? "").startsWith("application/json")
          ? angelegteIdVon(c.res.clone())
          : Promise.resolve(undefined);
      // Trifft die Route das Objekt selbst (PATCH /x/:id) und nicht eine Unteraktion (/x/:id/aktivieren)?
      const endetAufKennung = route.split("/").at(-1)?.startsWith(":") === true;
      senke.erwarte(
        Promise.all([feldPromise, idPromise, namePromise]).then(
          async ([felder, neueId, vorab]) => {
            // Ein PATCH mit leerem Body ändert nichts (die Routen antworten trotzdem 204): keine Zeile
            if (methode === "PATCH" && feldPromise && !felder?.length) return;
            // Angelegt: das neue Objekt aus der Antwort, das letzte des Pfades wird zum Elternobjekt. Sonst das letzte des Pfades
            const neu = neueId && sammelwort;
            const ziel = neu
              ? { objektTyp: sammelwort, objektId: neueId }
              : objekte.at(-1);
            const eltern = neu ? objekte.at(-1) : objekte.at(-2);
            // Die Namen jetzt, nicht erst beim Schreiben: Eine Sekunde später kann das Objekt weg sein. Beim Löschen kamen sie schon vor der Route
            let namen = vorab;
            if (!namen && senke.namen) {
              const abfrage: NamensAbfrage[] = [];
              if (ziel) {
                abfrage.push({
                  typ: ziel.objektTyp,
                  id: ziel.objektId,
                  elternTyp: eltern?.objektTyp,
                });
              }
              if (eltern)
                abfrage.push({ typ: eltern.objektTyp, id: eltern.objektId });
              namen = await senke.namen(abfrage).catch(() => ({}));
            }
            const details: AenderungsDetails = {};
            if (eltern) {
              details.eltern = {
                typ: eltern.objektTyp,
                id: eltern.objektId,
                ...(namen?.[eltern.objektId]
                  ? { name: namen[eltern.objektId] }
                  : {}),
              };
            }
            if (neu || (endetAufKennung && ziel)) details.direkt = true;
            if (hinweis) {
              if (hinweis.text) details.text = hinweis.text.slice(0, 300);
              if (hinweis.hinzu) details.hinzu = hinweis.hinzu.slice(0, 60);
              if (hinweis.weg) details.weg = hinweis.weg.slice(0, 60);
              const vorher = sicherAngaben(hinweis.vorher);
              const nachher = sicherAngaben(hinweis.nachher);
              if (vorher) details.vorher = vorher;
              if (nachher) details.nachher = nachher;
            }
            senke.erfasse({
              ...gemeinsam,
              art: "aktion",
              gruppe: eintrag?.gruppe,
              ...(ziel ?? {}),
              objektName:
                hinweis?.objektName ??
                (ziel ? namen?.[ziel.objektId] : undefined),
              felder,
              aenderung: Object.keys(details).length > 0 ? details : undefined,
              ergebnis: "erfolg",
            });
          },
        ),
      );
    } catch {
      // Das Protokoll darf nie eine Anfrage scheitern lassen
    }
  };
}

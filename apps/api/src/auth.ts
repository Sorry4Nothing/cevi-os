import {
  betterAuth,
  type BetterAuthOptions,
  type DBAdapter,
} from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import {
  admin,
  haveIBeenPwned,
  twoFactor,
  username,
} from "better-auth/plugins";
import { Hono } from "hono";
import {
  BENUTZERNAME_MAX,
  BENUTZERNAME_MIN,
  BENUTZERNAME_MUSTER,
} from "./benutzername.js";
import type { AktivitaetVariablen } from "./aktivitaet-middleware.js";
import type { AppNachweisDienst } from "./app-nachweis/dienst.js";
import { clientIp } from "./client-ip.js";
import { log } from "./log.js";
import { normalisiereStartpasswort } from "./startpasswort.js";

// Das admin-Plugin bleibt für das Sperren von Konten bei der Anmeldung und für createUser (die Kommandozeile und die Personenverwaltung rufen es ohne Header, es prüft dann nichts). Seine Rollen und Rechte gelten nirgends: Wer was darf, prüft jede Route selbst, die Aktionen am Konto stehen in konto-verwaltung.ts. Sein Schema nennt die Spalte user.role; sie ist immer «user» und kommt in keiner Antwort vor (#784)
function adminPlugin() {
  const plugin = admin();
  const rolle = plugin.schema?.user?.fields?.role as
    { returned?: boolean } | undefined;
  if (!rolle)
    throw new Error("admin: Aufbau des Schemas hat sich geändert (#784)");
  rolle.returned = false;
  return plugin;
}

// Das Schema der App (Android, später iOS) in der Kopfzeile Origin; das Muster ohne Authority deckt auch cevi-os://<host:port> eines Dev-Builds
const APP_ORIGIN = "cevi-os://";

// Die Anmeldung der App erkennt der Server an Origin (der Expo-Client meldet es in expo-origin, mitExpoOrigin setzt es um). Das ist keine Sicherheitsgrenze: Ein Skript kann Origin setzen, ein Browser nicht. Wer es setzt, bekommt eine Sitzung ohne Code, und genau die ist markiert (session.zweiter_faktor_geprueft = falsch): Sie öffnet weder die Verwaltung noch ein Recht mit «erweitert» (#721)
function istAppAnmeldung(kontext: { request?: Request; headers?: Headers }) {
  const herkunft = (kontext.request?.headers ?? kontext.headers)?.get("origin");
  return herkunft?.startsWith(APP_ORIGIN) === true;
}

// Die Antworten, wenn die Anmeldung der App im Modus «pflicht» keinen gültigen Nachweis trägt (#785). Sie nennen keinen Grund über «fehlt» und «ungültig» hinaus; der Server prüft den Nachweis vor dem Passwort, darum verrät auch ein unbekannter Benutzername nichts
export const APP_NACHWEIS_FEHLER = {
  APP_NACHWEIS_FEHLT: "Die Anmeldung der App braucht den Nachweis des Geräts.",
  APP_NACHWEIS_UNGUELTIG: "Der Nachweis der App ist ungültig oder abgelaufen.",
} as const;

// Was die Prüfung des Nachweises zur Anmeldung ergab; der Schlüssel ist die Anfrage, nichts bleibt nach ihr stehen. Ohne Eintrag (APP_NACHWEIS=aus) entscheidet allein der Origin
type NachweisInfo = {
  art: "app_nachgewiesen" | "app_ungeprueft";
  schluesselId?: string;
};
const nachweisInfo = new WeakMap<Request, NachweisInfo>();

// Prüft das Ticket der Anmeldung der App (Header X-Cevi-Nachweis, #785), bevor das Passwort geprüft wird. Gültig ist es nur für diesen Benutzernamen und einmal. «pflicht» lehnt ab, «pruefen» lässt die Sitzung als «app_ungeprueft» zu; beides steht im Log, ohne Ticket und Benutzername
async function pruefeAppNachweis(
  dienst: AppNachweisDienst,
  kontext: { request?: Request; headers?: Headers },
  benutzername: unknown,
) {
  const ticket = (kontext.request?.headers ?? kontext.headers)?.get(
    "x-cevi-nachweis",
  );
  const ergebnis =
    ticket && typeof benutzername === "string"
      ? await dienst.loeseTicketEin(ticket, benutzername)
      : ({ ok: false } as const);
  const ausgang = ergebnis.ok ? "ok" : ticket ? "ungueltig" : "fehlt";
  log(undefined, {
    ereignis: "app_nachweis",
    schritt: "anmeldung",
    modus: dienst.modus,
    ergebnis: ausgang,
    ...(ergebnis.ok && { plattform: ergebnis.plattform }),
  });
  if (ergebnis.ok) {
    if (kontext.request) {
      nachweisInfo.set(kontext.request, {
        art: "app_nachgewiesen",
        schluesselId: ergebnis.schluesselId,
      });
    }
    return;
  }
  if (dienst.modus === "pflicht") {
    const code =
      ausgang === "fehlt" ? "APP_NACHWEIS_FEHLT" : "APP_NACHWEIS_UNGUELTIG";
    throw new APIError("UNAUTHORIZED", {
      code,
      message: APP_NACHWEIS_FEHLER[code],
    });
  }
  if (kontext.request) {
    nachweisInfo.set(kontext.request, { art: "app_ungeprueft" });
  }
}

// Das Plugin legt für Konten mit zweitem Faktor bei jeder Anmeldung eine Umleitung auf den Code statt einer Sitzung. Für die App nicht (der zweite Faktor gilt nur in der Verwaltung): Der Haken nach der Anmeldung greift bei ihr nicht, die Sitzung bleibt. Kein Patch an better-auth, nur der matcher des öffentlichen Hooks ist enger; ändert sich dessen Form, scheitert der Start laut statt still offen
function zweiterFaktorPlugin() {
  const plugin = twoFactor({ issuer: "Cevi OS" });
  const haken = plugin.hooks.after[0];
  if (plugin.hooks.after.length !== 1 || !haken) {
    throw new Error("twoFactor: Aufbau der Hooks hat sich geändert (#721)");
  }
  const matcher = haken.matcher;
  haken.matcher = (kontext) =>
    matcher(kontext) && !istAppAnmeldung(kontext as never);
  return plugin;
}

// Startpasswort nur bei einer neuen Anmeldung prüfen: change-password und verify-totp in der eigenen laufenden Sitzung legen auch eine Sitzung an und müssen nach dem Ablauf gehen
const anmeldepfade = new Set([
  "/sign-in/username",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

// Wer sich mit dieser Anfrage angemeldet hat (oder wessen Konto ein Fehlversuch traf), für das Aktivitätsprotokoll (#637): Die Hooks wissen es, die Route nach dem Handler nicht. Der Schlüssel ist die Anfrage selbst, nichts bleibt nach ihr stehen
export const aktivitaetNutzer = new WeakMap<Request, string>();

// Pfade, bei denen die Sitzung vor dem Handler gilt (nachher ist sie weg oder ersetzt)
const MIT_SITZUNG = new Set([
  "/api/auth/sign-out",
  "/api/auth/change-password",
  "/api/auth/revoke-sessions",
  "/api/auth/two-factor/enable",
]);

// Felder der Bremse und des Pflichtwechsels am User, wo better-auth nur seinen Grundtyp kennt
type Bremsfelder = {
  mussPasswortAendern?: boolean;
  fehlversuche?: number;
  naechsterVersuchAb?: Date | string | null;
};

// Ab dem 5. Fehlversuch in Folge: 1, dann 5, dann 15 Minuten
export function wartezeitMinuten(fehlversuche: number) {
  if (fehlversuche < 5) return 0;
  return fehlversuche === 5 ? 1 : fehlversuche === 6 ? 5 : 15;
}

// So lang wie die längste Wartezeit: Nach ihr beginnt der Zähler bei 0, darum sperrt ein fremder Fehlversuch alle 15 Minuten das Konto nie
const VERFALL_MINUTEN = 15;

// naechsterVersuchAb ist der letzte Fehlversuch plus seine Wartezeit; ohne Datum gilt 1970, ein ungültiges Datum verfällt nie
export function fehlversucheVerfallen(
  fehlversuche: number,
  naechsterVersuchAb: Date | string | null | undefined,
  jetzt = Date.now(),
) {
  const letzter =
    new Date(naechsterVersuchAb ?? 0).getTime() -
    wartezeitMinuten(fehlversuche) * 60_000;
  return jetzt - letzter >= VERFALL_MINUTEN * 60_000;
}

// Eine Stelle für den Text, den die App kennt: Die Anmeldung und das Löschen des Kontos antworten damit
export const ZU_VIELE_ANFRAGEN = {
  code: "ZU_VIELE_ANFRAGEN",
  message: "Zu viele Anfragen. Bitte später nochmals versuchen.",
} as const;

// shortcut: better-auth verlangt eine eindeutige E-Mail-Adresse; .invalid ist nie zustellbar (RFC 2606). Ersetzen, sobald better-auth Konten ohne E-Mail-Adresse erlaubt
export function platzhalterEmail() {
  return `${crypto.randomUUID()}@benutzer.invalid`;
}

// Ein Fehlversuch beim Passwort zählt am Konto: ab dem 5. folgt die Wartezeit (wartezeitMinuten). Bei der Anmeldung wie bei enable und change-password in einer laufenden Sitzung (#777)
async function zaehleFehlversuch(
  adapter: DBAdapter,
  person: Bremsfelder & { id: string },
) {
  const wo = [{ field: "id", value: person.id }];
  if (
    person.fehlversuche &&
    fehlversucheVerfallen(person.fehlversuche, person.naechsterVersuchAb)
  ) {
    // Nur auf den gelesenen Stand: Von gleichzeitigen Fehlversuchen setzt einer zurück, die übrigen zählen weiter
    await adapter.update({
      model: "user",
      where: [...wo, { field: "fehlversuche", value: person.fehlversuche }],
      update: { fehlversuche: 0 },
    });
  }
  const erhoeht = await adapter.incrementOne<{ fehlversuche: number }>({
    model: "user",
    where: wo,
    increment: { fehlversuche: 1 },
  });
  const minuten = wartezeitMinuten(erhoeht?.fehlversuche ?? 0);
  // Auch ohne Wartezeit: Daraus liest fehlversucheVerfallen den letzten Fehlversuch
  await adapter.update({
    model: "user",
    where: wo,
    update: { naechsterVersuchAb: new Date(Date.now() + minuten * 60_000) },
  });
}

// Läuft die Wartezeit des Kontos, antwortet enable und change-password ohne Passwortprüfung (#777)
function pruefeWartezeit(person: Bremsfelder | undefined) {
  if (
    person?.naechsterVersuchAb &&
    new Date(person.naechsterVersuchAb) > new Date()
  ) {
    throw new APIError("TOO_MANY_REQUESTS", {
      code: "WARTEZEIT",
      message: "Bitte warten und später nochmals versuchen.",
    });
  }
}

// anmeldungGesperrt (#425): Gilt unter einer Sperre von «alles» für die Person der Abteilung; nur der Server (server.ts) übergibt sie, Kommandozeilen und Tests brauchen sie nicht
// appNachweis (#785): Ohne ihn (APP_NACHWEIS=aus) erkennt die Anmeldung die App wie bisher am Origin und markiert die Sitzung «app_ungeprueft»
export function erstelleAuth(
  database: BetterAuthOptions["database"],
  {
    anmeldungGesperrt,
    appNachweis,
  }: {
    anmeldungGesperrt?: (nutzer: {
      id: string;
      abteilungId: string;
    }) => Promise<boolean>;
    appNachweis?: AppNachweisDienst;
  } = {},
) {
  return betterAuth({
    database,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      requireEmailVerification: false,
    },
    user: {
      deleteUser: { enabled: true },
      // Wie die Spalten in src/db/schema.ts; better-auth schreibt beim Anlegen seinen defaultValue, darum gleich dem der Datenbank
      additionalFields: {
        abteilungId: { type: "string", input: false, required: true },
        ceviName: { type: "string", input: false, required: false },
        mussPasswortAendern: {
          type: "boolean",
          input: false,
          defaultValue: true,
        },
        startpasswortGueltigBis: {
          type: "date",
          input: false,
          required: false,
        },
        // Nie in Antworten von better-auth
        startpasswortVerschluesselt: {
          type: "string",
          input: false,
          required: false,
          returned: false,
        },
        fehlversuche: { type: "number", input: false, defaultValue: 0 },
        naechsterVersuchAb: { type: "date", input: false, required: false },
        deaktiviertAm: { type: "date", input: false, required: false },
        telefon: { type: "string", input: false, required: false },
        pushChat: { type: "boolean", input: false, defaultValue: true },
        pushProgramme: { type: "boolean", input: false, defaultValue: true },
        pushAnmeldungen: { type: "boolean", input: false, defaultValue: true },
        pushTerminEntscheid: {
          type: "boolean",
          input: false,
          defaultValue: true,
        },
        pushRaumEntscheid: {
          type: "boolean",
          input: false,
          defaultValue: true,
        },
        datenschutzGelesenAm: { type: "date", input: false, required: false },
      },
    },
    session: {
      // 90 Tage, verlängert bei Nutzung (updateAge bleibt beim Standard von 1 Tag); kein cookieCache, damit beendete Sitzungen sofort enden
      expiresIn: 60 * 60 * 24 * 90,
      // Wie die Spalte in src/db/schema.ts (#721); get-session liefert sie mit, die Verwaltung liest sie dort. Gesetzt wird sie nur im Hook unten, nie aus einer Anfrage
      additionalFields: {
        zweiterFaktorGeprueft: {
          type: "boolean",
          input: false,
          defaultValue: false,
        },
        // Wie die Spalte in src/db/schema.ts (#785): web, app_nachgewiesen oder app_ungeprueft
        clientArt: { type: "string", input: false, defaultValue: "web" },
      },
    },
    // Das App-Schema ist eine Baukonstante, darum im Code statt in der Umgebung: Fehlte die Variable, bekäme jeder Cookie-POST der App 403. Das Muster ohne Authority deckt auch cevi-os://<host:port> eines Dev-Builds; better-auth ergänzt BETTER_AUTH_TRUSTED_ORIGINS obendrauf (Tests)
    trustedOrigins: [APP_ORIGIN],
    rateLimit: {
      // enabled auch ausserhalb der Produktion; database zählt in rate_limit und übersteht Neustarts
      enabled: true,
      storage: "database",
      // Pfade relativ zu /api/auth, exakter Vergleich; der Zähler beginnt erst neu, wenn das Fenster ohne zugelassene Anfrage verstreicht
      customRules: {
        // 30, damit ein Elternabend im selben WLAN nicht blockiert
        "/sign-in/username": { window: 900, max: 30 },
        "/change-password": { window: 900, max: 5 },
        "/two-factor/verify-totp": { window: 900, max: 5 },
        "/two-factor/verify-backup-code": { window: 900, max: 5 },
      },
    },
    logger: {
      // Eine JSON-Zeile wie src/log.ts, ohne Request-ID (better-auth kennt den Hono-Kontext nicht); args nie: Sie tragen Datenbankfehler mit Zeilen, und logger.error übergibt auch Error-Objekte als Meldung
      log(stufe, meldung) {
        console.log(
          JSON.stringify({
            zeit: new Date().toISOString(),
            quelle: "better-auth",
            stufe,
            meldung:
              typeof meldung === "string"
                ? meldung
                : (meldung as unknown as { name?: string })?.name,
          }),
        );
      },
    },
    advanced: {
      database: { generateId: "uuid" },
      // Sonst prüft better-auth die Herkunft unter NODE_ENV=test nicht
      disableOriginCheck: false,
      // Heute der Standard, aber tragend: Das Rate-Limit zählt nur über den Header, den Caddy kontrolliert (#68)
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    databaseHooks: {
      session: {
        create: {
          async before(sitzung, ctx) {
            if (
              ctx &&
              anmeldepfade.has(ctx.path) &&
              ctx.context.session?.user.id !== sitzung.userId
            ) {
              const person = await ctx.context.adapter.findOne<{
                mussPasswortAendern?: boolean;
                startpasswortGueltigBis?: Date | string | null;
                abteilungId: string;
              }>({
                model: "user",
                where: [{ field: "id", value: sitzung.userId }],
              });
              // Nach dem Passwort: Unter einer Sperre von «alles» meldet sich nur die Abteilungsleitung oder der Entwickler an. Die Route der Anmeldung macht aus jedem Fehler das einheitliche 401, der Status 423 verrät also nichts
              if (
                person &&
                (await anmeldungGesperrt?.({
                  id: sitzung.userId,
                  abteilungId: person.abteilungId,
                }))
              ) {
                throw new APIError("LOCKED", {
                  code: "GESPERRT",
                  message: "Die Anmeldung ist vorübergehend nicht möglich.",
                });
              }
              // Im Zweifel sperren: Ohne Datum gilt 1970, und anders als <= sperrt !(… > jetzt) auch ein ungültiges Datum
              if (
                person?.mussPasswortAendern &&
                !(new Date(person.startpasswortGueltigBis ?? 0) > new Date())
              ) {
                throw new APIError("FORBIDDEN", {
                  code: "STARTPASSWORT_ABGELAUFEN",
                  message:
                    "Das Startpasswort ist abgelaufen. Eine Person der Abteilungsleitung kann ein neues setzen.",
                });
              }
            }
            // Geprüft ist nur, was mit dem Code begann: Eine Sitzung, die verify-totp oder verify-backup-code anlegt (nach dem Code in der Anmeldung, oder beim Einschalten des Faktors). Die Anmeldung mit Passwort allein nie, auch nicht mit Header der App. Eine Sitzung, die eine laufende ersetzt (change-password), erbt den Stand der laufenden, sonst verlöre die Verwaltung nach einem Passwortwechsel ihren Code
            const geprueft =
              ctx?.path === "/two-factor/verify-totp" ||
              ctx?.path === "/two-factor/verify-backup-code" ||
              (!!ctx &&
                !anmeldepfade.has(ctx.path) &&
                ctx.context.session?.user.id === sitzung.userId &&
                (
                  ctx.context.session.session as {
                    zweiterFaktorGeprueft?: boolean;
                  }
                ).zweiterFaktorGeprueft === true);
            // Woher die Sitzung kommt (#785): Die Anmeldung entscheidet nach dem Nachweis (oder, ohne ihn, nach dem Origin), jede andere Sitzung erbt es von der laufenden, die sie ersetzt, sonst gilt «web»
            const laufendeArt =
              ctx?.context.session?.user.id === sitzung.userId
                ? (
                    ctx.context.session.session as {
                      clientArt?: string;
                    }
                  ).clientArt
                : undefined;
            const clientArt =
              ctx?.path === "/sign-in/username"
                ? (ctx.request && nachweisInfo.get(ctx.request)?.art) ||
                  (istAppAnmeldung(ctx) ? "app_ungeprueft" : "web")
                : laufendeArt === "app_nachgewiesen" ||
                    laufendeArt === "app_ungeprueft"
                  ? laufendeArt
                  : "web";
            return {
              data: {
                ipAddress: null,
                userAgent: null,
                zweiterFaktorGeprueft: geprueft,
                clientArt,
              },
            };
          },
        },
      },
    },
    hooks: {
      // Vor der Validierung: body kann alles sein, darum die typeof-Prüfungen
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/username") {
          // Vor allem anderen, auch vor dem Passwort: Der Nachweis gehört zur App, nicht zum Konto (#785)
          if (appNachweis && istAppAnmeldung(ctx)) {
            await pruefeAppNachweis(appNachweis, ctx, ctx.body?.username);
          }
          if (typeof ctx.body?.username !== "string") return;
          const person = await ctx.context.adapter.findOne<Bremsfelder>({
            model: "user",
            // Das username-Plugin speichert und sucht in Kleinbuchstaben
            where: [
              { field: "username", value: ctx.body.username.toLowerCase() },
            ],
          });
          // Wartezeit ohne Passwortprüfung, ohne Zählen und ohne Verlängern: Sonst könnte jede Person ein fremdes Konto dauerhaft sperren
          if (
            person?.naechsterVersuchAb &&
            new Date(person.naechsterVersuchAb) > new Date()
          ) {
            throw new APIError("UNAUTHORIZED", {
              code: "WARTEZEIT",
              message: "Bitte warten und später nochmals versuchen.",
            });
          }
          if (
            person?.mussPasswortAendern &&
            typeof ctx.body.password === "string"
          ) {
            return {
              context: {
                body: {
                  ...ctx.body,
                  password: normalisiereStartpasswort(ctx.body.password),
                },
              },
            };
          }
          return;
        }
        if (ctx.path === "/two-factor/enable") {
          // Eine Person der Abteilungsleitung mit offenem Startpasswort erreicht enable vor dem Wechsel; der Vergleich bleibt normalisiert
          const sitzung = await getSessionFromCtx(ctx);
          pruefeWartezeit(sitzung?.user as Bremsfelder | undefined);
          if (
            (sitzung?.user as Bremsfelder | undefined)?.mussPasswortAendern &&
            typeof ctx.body?.password === "string"
          ) {
            return {
              context: {
                body: {
                  ...ctx.body,
                  password: normalisiereStartpasswort(ctx.body.password),
                },
              },
            };
          }
          return;
        }
        if (
          ctx.path === "/two-factor/verify-totp" ||
          ctx.path === "/two-factor/verify-backup-code"
        ) {
          // Eine Sitzung ohne Code (die der App) holt den Code nicht nach (#721): In einer laufenden Sitzung zählt better-auth keine Fehlversuche und sperrt das Konto nicht, ein Angreifer mit Passwort und App-Sitzung dürfte Codes raten. Der Weg zur geprüften Sitzung ist die neue Anmeldung im Browser, dort gilt die Grenze der Anmeldung. Das Einschalten des Faktors (Konto ohne Faktor) bleibt offen
          const laufende = await getSessionFromCtx(ctx);
          if (
            laufende?.user.twoFactorEnabled === true &&
            (laufende.session as { zweiterFaktorGeprueft?: boolean })
              .zweiterFaktorGeprueft !== true
          ) {
            throw new APIError("FORBIDDEN", {
              code: "ZWEITER_FAKTOR_SITZUNG",
              message:
                "Diese Sitzung hat den zweiten Faktor nicht geprüft. Melde dich in der Verwaltung neu an.",
            });
          }
          // Kein «Gerät vertrauen»: Auf jedem neuen Gerät fragt der Login nach dem Code, was der Client auch schickt
          return { context: { body: { ...ctx.body, trustDevice: false } } };
        }
        if (ctx.path !== "/change-password") return;
        const sitzung = await getSessionFromCtx(ctx);
        pruefeWartezeit(sitzung?.user as Bremsfelder | undefined);
        const offen =
          (sitzung?.user as Bremsfelder | undefined)?.mussPasswortAendern ===
          true;
        const body = { ...ctx.body, revokeOtherSessions: true };
        if (offen && typeof body.currentPassword === "string") {
          body.currentPassword = normalisiereStartpasswort(
            body.currentPassword,
          );
        }
        if (
          typeof body.newPassword === "string" &&
          (offen
            ? normalisiereStartpasswort(body.newPassword)
            : body.newPassword) === body.currentPassword
        ) {
          throw new APIError("BAD_REQUEST", {
            code: "PASSWORT_UNVERAENDERT",
            message:
              "Das neue Passwort muss sich vom bisherigen unterscheiden.",
          });
        }
        return { context: { body } };
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/username") {
          const { adapter, newSession, returned } = ctx.context;
          if (newSession) {
            // Dieser Hook läuft vor dem des twoFactor-Plugins, die neue Sitzung ist also auch bei dessen Umleitung noch da
            const person = newSession.user as Bremsfelder & { id: string };
            if (ctx.request) aktivitaetNutzer.set(ctx.request, person.id);
            if (person.fehlversuche || person.naechsterVersuchAb) {
              await adapter.update({
                model: "user",
                where: [{ field: "id", value: person.id }],
                update: { fehlversuche: 0, naechsterVersuchAb: null },
              });
            }
            // Der Schlüssel des iOS-Geräts merkt sich das Konto der ersten Anmeldung
            const schluesselId =
              ctx.request && nachweisInfo.get(ctx.request)?.schluesselId;
            if (appNachweis && schluesselId) {
              await appNachweis
                .verknuepfeGeraet(schluesselId, person.id)
                .catch(() => undefined);
            }
            return;
          }
          // Nur echte Fehlversuche zählen: Ablauf (403), Sperre (403) und Formatfehler (422) nicht
          if (
            !isAPIError(returned) ||
            returned.body?.code !== "INVALID_USERNAME_OR_PASSWORD" ||
            typeof ctx.body?.username !== "string"
          ) {
            return;
          }
          const person = await adapter.findOne<Bremsfelder & { id: string }>({
            model: "user",
            where: [
              { field: "username", value: ctx.body.username.toLowerCase() },
            ],
          });
          // Unbekannte Namen hinterlassen nichts
          if (!person) return;
          if (ctx.request) aktivitaetNutzer.set(ctx.request, person.id);
          await zaehleFehlversuch(adapter, person);
          return;
        }
        // Ein falsches Passwort bei enable und change-password zählt auf dasselbe Konto wie bei der Anmeldung (#777): Wer eine Sitzung hat, rät das Passwort nicht unbegrenzt
        if (
          (ctx.path === "/two-factor/enable" ||
            ctx.path === "/change-password") &&
          isAPIError(ctx.context.returned) &&
          ctx.context.returned.body?.code === "INVALID_PASSWORD" &&
          ctx.context.session
        ) {
          const person = await ctx.context.adapter.findOne<
            Bremsfelder & { id: string }
          >({
            model: "user",
            where: [{ field: "id", value: ctx.context.session.user.id }],
          });
          if (person) await zaehleFehlversuch(ctx.context.adapter, person);
        }
        if (ctx.path === "/two-factor/enable") {
          const { returned, session } = ctx.context;
          const link = (returned as { totpURI?: unknown } | undefined)?.totpURI;
          const benutzername = (session?.user as { username?: string })
            ?.username;
          if (isAPIError(returned) || typeof link !== "string") return;
          const schluessel = new URL(link).searchParams.get("secret");
          if (!schluessel || !benutzername) return;
          // better-auth schriebe die Platzhalter-E-Mail-Adresse in den Link; Apps zeigen daran den Eintrag. Format wie dort: Leerzeichen als %20, 6 Stellen, 30 s
          const name = encodeURIComponent("Cevi OS");
          return ctx.json({
            ...(returned as object),
            totpURI: `otpauth://totp/${name}:${encodeURIComponent(benutzername)}?secret=${schluessel}&issuer=${name}&digits=6&period=30`,
          });
        }
        if (ctx.path === "/two-factor/verify-totp") {
          const { newSession, session } = ctx.context;
          if (newSession && ctx.request) {
            aktivitaetNutzer.set(ctx.request, newSession.user.id);
          }
          const vorher = session?.user as { twoFactorEnabled?: boolean };
          // Nur der Schritt, der den Faktor einschaltet (in der Anmeldung gibt es noch keine Sitzung): Andere Sitzungen kamen ohne Code zustande und enden hier
          if (
            session &&
            newSession &&
            vorher.twoFactorEnabled !== true &&
            (newSession.user as { twoFactorEnabled?: boolean })
              .twoFactorEnabled === true
          ) {
            await ctx.context.adapter.deleteMany({
              model: "session",
              where: [
                { field: "userId", value: newSession.user.id },
                {
                  field: "token",
                  operator: "ne",
                  value: newSession.session.token,
                },
              ],
            });
          }
          return;
        }
        if (
          ctx.path !== "/change-password" ||
          isAPIError(ctx.context.returned) ||
          !ctx.context.session
        ) {
          return;
        }
        await ctx.context.internalAdapter.updateUser(
          ctx.context.session.user.id,
          { mussPasswortAendern: false, startpasswortVerschluesselt: null },
        );
      }),
    },
    plugins: [
      // Der Standard verböte den Bindestrich und mehr als 30 Zeichen; geprüft wird die rohe Eingabe, gespeichert kleingeschrieben
      username({
        usernameValidator: (benutzername) =>
          BENUTZERNAME_MUSTER.test(benutzername),
        minUsernameLength: BENUTZERNAME_MIN,
        maxUsernameLength: BENUTZERNAME_MAX,
      }),
      adminPlugin(),
      // Name wie in app.json; sonst die Standards: 6 Stellen, 30 s, zehn Ersatzcodes
      zweiterFaktorPlugin(),
      haveIBeenPwned(),
    ],
  });
}

// Alles andere unter /api/auth liefert 404, auch update-user, sign-in/email, sign-up/email, is-username-available und admin/*
export const offenePfade = [
  "POST /api/auth/sign-in/username",
  "POST /api/auth/sign-out",
  "GET /api/auth/get-session",
  "POST /api/auth/change-password",
  "POST /api/auth/revoke-sessions",
  "POST /api/auth/two-factor/verify-totp",
  "POST /api/auth/two-factor/verify-backup-code",
  "POST /api/auth/two-factor/enable",
] as const;

// Ersetzt das Server-Plugin von @better-auth/expo: Der Expo-Client meldet seine Herkunft in expo-origin
function mitExpoOrigin(anfrage: Request) {
  const expoOrigin = anfrage.headers.get("expo-origin");
  if (!expoOrigin || anfrage.headers.has("origin")) return anfrage;
  const kopfzeilen = new Headers(anfrage.headers);
  kopfzeilen.set("origin", expoOrigin);
  return new Request(anfrage, { headers: kopfzeilen });
}

// better-auth nimmt aus X-Forwarded-For den ersten Eintrag, den der Client selbst mitschickt; das Rate-Limit je IP liesse sich so umgehen. Hier bleibt nur die Adresse, die der Edge-Caddy gesetzt hat (#775)
function mitClientIp(anfrage: Request) {
  const ip = clientIp(anfrage.headers.get("x-forwarded-for"));
  if (!ip) return anfrage;
  const kopfzeilen = new Headers(anfrage.headers);
  kopfzeilen.set("x-forwarded-for", ip);
  return new Request(anfrage, { headers: kopfzeilen });
}

// istKinderkonto: ob die Kennung das eigene Konto eines Kindes ist (kind.user_id, #644); ohne Angabe gibt es keine Kinderkonten
export function erstelleAuthRouten(
  auth: ReturnType<typeof erstelleAuth>,
  istKinderkonto: (userId: string) => Promise<boolean> = async () => false,
) {
  const routen = new Hono<{ Variables: AktivitaetVariablen }>();
  // Den zweiten Faktor richtet jedes Konto ein, ausser dem eigenen Konto eines Kindes (#715); ohne Sitzung und für Kinderkonten ist der Pfad zu. Zwei Schritte: enable gibt Link und Ersatzcodes, erst verify-totp mit einem gültigen Code schaltet ihn ein (twoFactorEnabled)
  routen.post("/api/auth/two-factor/enable", async (c, next) => {
    const sitzung = await auth.api.getSession({
      headers: c.req.raw.headers,
      query: { disableRefresh: true },
    });
    if (!sitzung || (await istKinderkonto(sitzung.user.id))) {
      return c.notFound();
    }
    await next();
  });
  for (const eintrag of offenePfade) {
    const [methode, pfad] = eintrag.split(" ");
    const anmeldung = eintrag === "POST /api/auth/sign-in/username";
    // Beide Umbauten hier statt in einem after-Hook: dispatchAuthEndpoint behielte dessen Status und verriete den Fall
    routen.on(methode, pfad, async (c) => {
      // Aktivitätsprotokoll (#637): Wer handelt, steht in nutzerId, bevor die Sitzung endet
      if (MIT_SITZUNG.has(pfad)) {
        const sitzung = await auth.api
          .getSession({
            headers: c.req.raw.headers,
            query: { disableRefresh: true },
          })
          .catch(() => null);
        if (sitzung) c.set("nutzerId", sitzung.user.id);
      }
      const anfrage = mitClientIp(mitExpoOrigin(c.req.raw));
      const antwort = await auth.handler(anfrage);
      const wer = aktivitaetNutzer.get(anfrage);
      if (wer) c.set("nutzerId", wer);
      // Der Grund eines Fehlschlags (Wartezeit, falsches Passwort, Sperre) bleibt im Protokoll, auch wenn der Client nur das einheitliche 401 sieht
      let grund: string | undefined;
      if (anmeldung && antwort.status >= 400 && antwort.status !== 429) {
        grund = await antwort
          .clone()
          .json()
          .then((b: { code?: unknown }) =>
            typeof b.code === "string" ? b.code : undefined,
          )
          .catch(() => undefined);
        if (grund) c.set("aktivitaetCode", grund);
      }
      // better-auth antwortet auf 429 nur mit einer englischen message; X-Retry-After bleibt
      if (antwort.status === 429) {
        return c.json(ZU_VIELE_ANFRAGEN, 429, {
          "X-Retry-After": antwort.headers.get("X-Retry-After") ?? "",
        });
      }
      // Die einzige Ausnahme: der fehlende oder ungültige Nachweis der App (#785) hat einen eigenen Code, damit die App neu nachweist, statt das Passwort zu beklagen
      if (anmeldung && grund && Object.hasOwn(APP_NACHWEIS_FEHLER, grund)) {
        return c.json(
          {
            code: grund,
            message:
              APP_NACHWEIS_FEHLER[grund as keyof typeof APP_NACHWEIS_FEHLER],
          },
          401,
        );
      }
      // Jeder Fehler bei der Anmeldung zeigt dieselbe Meldung: falsches Passwort, Wartezeit, abgelaufenes Startpasswort, deaktiviert, ungültiger Name
      if (anmeldung && antwort.status >= 400 && antwort.status < 500) {
        return c.json(
          {
            code: "ANMELDUNG_FEHLGESCHLAGEN",
            message:
              "Anmeldung nicht möglich. Bitte Benutzername und Passwort prüfen oder später nochmals versuchen. Sonst hilft eine Person der Abteilungsleitung.",
          },
          401,
        );
      }
      return antwort;
    });
  }
  return routen;
}

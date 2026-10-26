import { betterAuth, type BetterAuthOptions } from "better-auth";
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
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";
import { Hono } from "hono";
import { normalisiereStartpasswort } from "./startpasswort.js";

const ac = createAccessControl(defaultStatements);

// Genau die Rechte, die createUser, setUserPassword, revokeUserSessions, banUser, unbanUser und removeUser prüfen; kein impersonate
const rollen = {
  admin: ac.newRole({
    user: ["create", "set-role", "set-password", "ban", "delete"],
    session: ["revoke"],
  }),
  user: ac.newRole({ user: [], session: [] }),
};

// Startpasswort nur bei einer neuen Anmeldung prüfen: change-password und verify-totp in der eigenen laufenden Sitzung legen auch eine Sitzung an und müssen nach dem Ablauf gehen
const anmeldepfade = new Set([
  "/sign-in/username",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

// Felder der Bremse und des Pflichtwechsels am User, wo better-auth nur seinen Grundtyp kennt
type Bremsfelder = {
  mussPasswortAendern?: boolean;
  fehlversuche?: number;
  naechsterVersuchAb?: Date | string | null;
};

// shortcut: better-auth verlangt eine eindeutige E-Mail-Adresse; .invalid ist nie zustellbar (RFC 2606). Ersetzen, sobald better-auth Konten ohne E-Mail-Adresse erlaubt
export function platzhalterEmail() {
  return `${crypto.randomUUID()}@benutzer.invalid`;
}

export function erstelleAuth(database: BetterAuthOptions["database"]) {
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
        fehlversuche: { type: "number", input: false, defaultValue: 0 },
        naechsterVersuchAb: { type: "date", input: false, required: false },
        deaktiviertAm: { type: "date", input: false, required: false },
        telefon: { type: "string", input: false, required: false },
        pushChat: { type: "boolean", input: false, defaultValue: true },
        pushProgramme: { type: "boolean", input: false, defaultValue: true },
        datenschutzGelesenAm: { type: "date", input: false, required: false },
      },
    },
    session: {
      // 90 Tage, verlängert bei Nutzung (updateAge bleibt beim Standard von 1 Tag); kein cookieCache, damit beendete Sitzungen sofort enden
      expiresIn: 60 * 60 * 24 * 90,
    },
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
              }>({
                model: "user",
                where: [{ field: "id", value: sitzung.userId }],
              });
              // Im Zweifel sperren: Ohne Datum gilt 1970, und anders als <= sperrt !(… > jetzt) auch ein ungültiges Datum
              if (
                person?.mussPasswortAendern &&
                !(new Date(person.startpasswortGueltigBis ?? 0) > new Date())
              ) {
                throw new APIError("FORBIDDEN", {
                  code: "STARTPASSWORT_ABGELAUFEN",
                  message:
                    "Das Startpasswort ist abgelaufen. Ein Admin kann ein neues setzen.",
                });
              }
            }
            return { data: { ipAddress: null, userAgent: null } };
          },
        },
      },
    },
    hooks: {
      // Vor der Validierung: body kann alles sein, darum die typeof-Prüfungen
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/username") {
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
          // Ein Admin mit offenem Startpasswort erreicht enable vor dem Wechsel; der Vergleich bleibt normalisiert
          const sitzung = await getSessionFromCtx(ctx);
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
        if (ctx.path !== "/change-password") return;
        const sitzung = await getSessionFromCtx(ctx);
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
            if (person.fehlversuche || person.naechsterVersuchAb) {
              await adapter.update({
                model: "user",
                where: [{ field: "id", value: person.id }],
                update: { fehlversuche: 0, naechsterVersuchAb: null },
              });
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
          const person = await adapter.findOne<{ id: string }>({
            model: "user",
            where: [
              { field: "username", value: ctx.body.username.toLowerCase() },
            ],
          });
          // Unbekannte Namen hinterlassen nichts
          if (!person) return;
          const erhoeht = await adapter.incrementOne<{ fehlversuche: number }>({
            model: "user",
            where: [{ field: "id", value: person.id }],
            increment: { fehlversuche: 1 },
          });
          const n = erhoeht?.fehlversuche ?? 0;
          // Ab dem 5. Fehlversuch in Folge: 1, dann 5, dann 15 Minuten, ohne Dauersperre
          if (n >= 5) {
            const minuten = n === 5 ? 1 : n === 6 ? 5 : 15;
            await adapter.update({
              model: "user",
              where: [{ field: "id", value: person.id }],
              update: {
                naechsterVersuchAb: new Date(Date.now() + minuten * 60_000),
              },
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
          { mussPasswortAendern: false },
        );
      }),
    },
    plugins: [
      username(),
      admin({ ac, roles: rollen }),
      twoFactor(),
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

export function erstelleAuthRouten(auth: ReturnType<typeof erstelleAuth>) {
  const routen = new Hono();
  // Den zweiten Faktor richten nur Admins ein; für alle anderen ist der Pfad zu
  routen.post("/api/auth/two-factor/enable", async (c, next) => {
    const sitzung = await auth.api.getSession({
      headers: c.req.raw.headers,
      query: { disableRefresh: true },
    });
    if (sitzung?.user.role !== "admin") return c.notFound();
    await next();
  });
  for (const eintrag of offenePfade) {
    const [methode, pfad] = eintrag.split(" ");
    const anmeldung = eintrag === "POST /api/auth/sign-in/username";
    // Beide Umbauten hier statt in einem after-Hook: dispatchAuthEndpoint behielte dessen Status und verriete den Fall
    routen.on(methode, pfad, async (c) => {
      const antwort = await auth.handler(mitExpoOrigin(c.req.raw));
      // better-auth antwortet auf 429 nur mit einer englischen message; X-Retry-After bleibt
      if (antwort.status === 429) {
        return c.json(
          {
            code: "ZU_VIELE_ANFRAGEN",
            message: "Zu viele Anfragen. Bitte später nochmals versuchen.",
          },
          429,
          { "X-Retry-After": antwort.headers.get("X-Retry-After") ?? "" },
        );
      }
      // Jeder Fehler bei der Anmeldung zeigt dieselbe Meldung: falsches Passwort, Wartezeit, abgelaufenes Startpasswort, deaktiviert, ungültiger Name
      if (anmeldung && antwort.status >= 400 && antwort.status < 500) {
        return c.json(
          {
            code: "ANMELDUNG_FEHLGESCHLAGEN",
            message:
              "Anmeldung nicht möglich. Bitte Benutzername und Passwort prüfen oder später nochmals versuchen. Sonst hilft ein Admin.",
          },
          401,
        );
      }
      return antwort;
    });
  }
  return routen;
}

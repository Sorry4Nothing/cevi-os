import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import {
  admin,
  haveIBeenPwned,
  twoFactor,
  username,
} from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";
import { Hono } from "hono";

const ac = createAccessControl(defaultStatements);

// Genau die Rechte, die createUser, setUserPassword, revokeUserSessions, banUser, unbanUser und removeUser prüfen; kein impersonate
const rollen = {
  admin: ac.newRole({
    user: ["create", "set-role", "set-password", "ban", "delete"],
    session: ["revoke"],
  }),
  user: ac.newRole({ user: [], session: [] }),
};

// Startpasswort nur hier prüfen: change-password legt auch eine Sitzung an und muss nach dem Ablauf gehen
const anmeldepfade = new Set([
  "/sign-in/username",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

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
      additionalFields: {
        abteilungId: { type: "string", input: false },
        mussPasswortAendern: { type: "boolean", input: false },
        startpasswortGueltigBis: {
          type: "date",
          input: false,
          required: false,
        },
      },
    },
    advanced: {
      database: { generateId: "uuid" },
      // Sonst prüft better-auth die Herkunft unter NODE_ENV=test nicht
      disableOriginCheck: false,
    },
    databaseHooks: {
      session: {
        create: {
          async before(sitzung, ctx) {
            if (ctx && anmeldepfade.has(ctx.path)) {
              const person = await ctx.context.adapter.findOne<{
                mussPasswortAendern?: boolean;
                startpasswortGueltigBis?: Date | null;
              }>({
                model: "user",
                where: [{ field: "id", value: sitzung.userId }],
              });
              const ablauf = person?.mussPasswortAendern
                ? person.startpasswortGueltigBis
                : null;
              if (ablauf && ablauf < new Date()) {
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
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/change-password") return;
        if (
          typeof ctx.body?.newPassword === "string" &&
          ctx.body.newPassword === ctx.body.currentPassword
        ) {
          throw new APIError("BAD_REQUEST", {
            code: "PASSWORT_UNVERAENDERT",
            message:
              "Das neue Passwort muss sich vom bisherigen unterscheiden.",
          });
        }
        return {
          context: { body: { ...ctx.body, revokeOtherSessions: true } },
        };
      }),
      after: createAuthMiddleware(async (ctx) => {
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
    routen.on(methode, pfad, (c) => auth.handler(mitExpoOrigin(c.req.raw)));
  }
  return routen;
}

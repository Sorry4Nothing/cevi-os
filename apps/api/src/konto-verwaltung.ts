import { hashPassword } from "better-auth/crypto";
import { isPasswordCompromised } from "better-auth/plugins";
import type { erstelleAuth } from "./auth.js";

// Die Schritte der Admin-Endpunkte von better-auth (set-user-password, revoke-user-sessions, ban-user, unban-user, remove-user) ohne deren Rollenprüfung (#650). Die Endpunkte verlangen eine Sitzung mit der Rolle «admin» und lesen deren ID; wer nur «Personen verwalten» hat, hat sie nicht. Die Route prüft das Recht selbst (verlange, Schutz der Konten mit Rechten) und ruft erst dann diese Schritte, sie ändern nichts anderes als die Endpunkte.
type Auth = ReturnType<typeof erstelleAuth>;

export async function setzePasswort(
  auth: Auth,
  userId: string,
  passwort: string,
) {
  // Wie der Endpunkt: ein geleaktes Passwort oder ein Ausfall des Dienstes bricht ab, bevor etwas geändert ist
  if (await isPasswordCompromised(passwort)) {
    throw new Error("Das Startpasswort ist geleakt");
  }
  const ctx = await auth.$context;
  // Das Verfahren von better-auth (scrypt), das auch die Anmeldung prüft. ctx.password.hash liefe über die Prüfung auf geleakte Passwörter, die einen Endpunkt voraussetzt; das Startpasswort ist zufällig erzeugt
  const hash = await hashPassword(passwort);
  if (await ctx.internalAdapter.findCredentialAccount(userId)) {
    await ctx.internalAdapter.updatePassword(userId, hash);
  } else {
    await ctx.internalAdapter.createAccount({
      userId,
      providerId: "credential",
      accountId: userId,
      password: hash,
    });
  }
}

export async function beendeSitzungen(auth: Auth, userId: string) {
  await (await auth.$context).internalAdapter.deleteUserSessions(userId);
}

// Sperrt das Konto und beendet seine Sitzungen
export async function sperreKonto(auth: Auth, userId: string) {
  const ctx = await auth.$context;
  await ctx.internalAdapter.updateUser(userId, {
    banned: true,
    banReason: "No reason",
    banExpires: null,
    updatedAt: new Date(),
  });
  await ctx.internalAdapter.deleteUserSessions(userId);
}

export async function entsperreKonto(auth: Auth, userId: string) {
  await (
    await auth.$context
  ).internalAdapter.updateUser(userId, {
    banned: false,
    banExpires: null,
    banReason: null,
    updatedAt: new Date(),
  });
}

// Löscht das Konto samt Sitzungen; Rollen, Verknüpfungen zu Kindern und Push-Tokens fallen per CASCADE mit
export async function entferneKonto(auth: Auth, userId: string) {
  const ctx = await auth.$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
  await ctx.internalAdapter.deleteUser(userId);
}

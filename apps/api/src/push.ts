import { inArray } from "drizzle-orm";
import type { Expo, ExpoPushMessage } from "expo-server-sdk";
import type { Context } from "hono";
import type { Db } from "./db/client.js";
import { pushToken } from "./db/schema.js";
import { log } from "./log.js";

// Bewusst ohne Textfeld: Ein Push trägt nie Nachrichtentext oder Namen, nur den Titel und Typ und ID für den Deep Link
export type Push = {
  typ: "chat" | "programm" | "person";
  id: string;
  titel: string;
};

// Kein Kanal für «person»: #42 legt nur chat und programme an, ein Kanal, den das Gerät nicht kennt, zeigt den Push nicht, und ein fremder schaltete ihn mit Chat oder Programm stumm
const KANAL = { chat: "chat", programm: "programme", person: undefined };

type Fehler = {
  code?: unknown;
  cause?: { code?: unknown };
  details?: { error?: unknown };
  statusCode?: unknown;
};

const alsText = (wert: unknown) =>
  typeof wert === "string" ? wert : undefined;

// Nur Codes und Status: message, details und errorText enthalten das Token, Drizzles message die SQL-Parameter
function meldeFehler(c: Context | undefined, fehler: unknown) {
  const f = (fehler ?? {}) as Fehler;
  log(c, {
    ereignis: "push",
    code: alsText(f.details?.error ?? f.code ?? f.cause?.code),
    status: typeof f.statusCode === "number" ? f.statusCode : undefined,
  });
}

// Wirft nie: Aufrufer pushen nach dem Speichern ihrer Änderung, ein Fehler hier darf sie nicht wiederholen lassen
export async function sendePush(
  { db, expo, c }: { db: Db; expo: Expo; c?: Context },
  empfaenger: string[],
  { typ, id, titel }: Push,
): Promise<void> {
  let chunks: ExpoPushMessage[][];
  try {
    const zeilen = await db
      .select({ token: pushToken.token })
      .from(pushToken)
      .where(inArray(pushToken.userId, empfaenger));
    chunks = expo.chunkPushNotifications(
      zeilen.map(({ token }) => ({
        to: token,
        title: titel,
        data: { typ, id },
        channelId: KANAL[typ],
        sound: "default",
      })),
    );
  } catch (fehler) {
    meldeFehler(c, fehler);
    return;
  }

  const abgemeldet: string[] = [];
  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket, i) => {
        if (ticket.status !== "error") return;
        meldeFehler(c, ticket);
        // `to` ist hier immer ein String, also gehört Ticket i zu Nachricht i
        if (ticket.details?.error === "DeviceNotRegistered")
          abgemeldet.push(chunk[i]!.to as string);
      });
    } catch (fehler) {
      meldeFehler(c, fehler);
    }
  }

  if (abgemeldet.length === 0) return;
  try {
    await db.delete(pushToken).where(inArray(pushToken.token, abgemeldet));
  } catch (fehler) {
    meldeFehler(c, fehler);
  }
}

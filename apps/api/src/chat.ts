import { and, eq, ne } from "drizzle-orm";
import type { Expo } from "expo-server-sdk";
import type { Context } from "hono";
import type { Db } from "./db/client.js";
import { chat, stufe, user } from "./db/schema.js";
import { log } from "./log.js";
import { sendePush } from "./push.js";
import { chatMitglieder } from "./rechte.js";

// Der Gruppenchat einer Stufe; idempotent über den Teilindex chat_gruppe_pro_stufe. Akzeptiert auch eine Transaktion (db.transaction(tx => …))
export async function legeGruppenchatAn(
  db: Pick<Db, "insert">,
  { abteilungId, stufeId }: { abteilungId: string; stufeId: string },
) {
  await db
    .insert(chat)
    .values({ abteilungId, typ: "stufe", stufeId })
    .onConflictDoNothing();
}

// Nach dem Speichern der Nachricht aufrufen; wirft nie: Ein Fehler hier darf das Senden nicht wiederholen lassen
// Der Titel nennt nur die Stufe, nie Text, Absender oder Kind: Der Push steht je nach Handy auf dem gesperrten Bildschirm
export async function pushNeueNachricht(
  { db, expo, c }: { db: Db; expo: Expo; c?: Context },
  {
    chatId,
    abteilungId,
    autorId,
  }: { chatId: string; abteilungId: string; autorId: string },
): Promise<void> {
  let empfaenger: string[];
  let titel: string;
  try {
    const mitglieder = chatMitglieder(db, abteilungId);
    const [zeilen, [kopf]] = await Promise.all([
      db
        .select({ id: user.id })
        .from(mitglieder)
        .innerJoin(user, eq(user.id, mitglieder.userId))
        .where(
          and(
            eq(mitglieder.chatId, chatId),
            ne(mitglieder.userId, autorId),
            eq(user.pushChat, true),
          ),
        ),
      db
        .select({ typ: chat.typ, name: stufe.name })
        .from(chat)
        .innerJoin(stufe, eq(stufe.id, chat.stufeId))
        .where(eq(chat.id, chatId)),
    ]);
    if (!kopf || zeilen.length === 0) return;
    empfaenger = zeilen.map(({ id }) => id);
    titel = `Neue Nachricht im ${kopf.typ === "direkt" ? "Einzelchat" : "Chat"} ${kopf.name}`;
  } catch (fehler) {
    log(c, { ereignis: "push", code: (fehler as { code?: unknown }).code });
    return;
  }
  await sendePush({ db, expo, c }, empfaenger, {
    typ: "chat",
    id: chatId,
    titel,
  });
}

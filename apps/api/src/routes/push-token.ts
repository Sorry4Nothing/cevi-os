import { and, eq, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { pushToken } from "../db/schema.js";
import { eingabe } from "../eingabe.js";
import type { Person } from "../rechte.js";

// Genau die Formen, die Expo.isExpoPushToken (expo-server-sdk 8.0.0) annimmt: Präfix-Form mit festem Gross-Klein oder UUID in beliebigem
const TOKEN_MUSTER =
  /^(?:(?:Expo|Exponent)PushToken\[[\s\S]*\]|[a-zA-Z\d]{8}-[a-zA-Z\d]{4}-[a-zA-Z\d]{4}-[a-zA-Z\d]{4}-[a-zA-Z\d]{12})$/;

// Auch in den Importen ohne node:* und process: Die App prüft diese Datei über AppType
export function erstellePushTokenRouten({ db }: { db: Db }) {
  return new Hono<{
    Variables: { person: Person; sitzungId: string };
  }>().put(
    "/",
    eingabe(
      "json",
      z.strictObject({
        token: z.string().max(200).regex(TOKEN_MUSTER),
        plattform: z.enum(["ios", "android"]),
      }),
    ),
    async (c) => {
      const person = c.get("person");
      const sitzungId = c.get("sitzungId");
      const { token, plattform } = c.req.valid("json");
      await db.transaction(async (tx) => {
        // Geteiltes Handy: Dasselbe Token einer anderen Sitzung zieht zur aktuellen um
        await tx
          .delete(pushToken)
          .where(
            and(eq(pushToken.token, token), ne(pushToken.sessionId, sitzungId)),
          );
        await tx
          .insert(pushToken)
          .values({ sessionId: sitzungId, token, userId: person.id, plattform })
          .onConflictDoUpdate({
            target: pushToken.sessionId,
            set: { token, plattform, zuletztGesehen: sql`now()` },
          });
      });
      return c.body(null, 204);
    },
  );
}

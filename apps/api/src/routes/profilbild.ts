import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  BILD_MAX_BYTES,
  istErlaubtesBild,
  type BildKodierer,
} from "../bild.js";
import type { Db } from "../db/client.js";
import {
  chat,
  leitungAnmeldung,
  programm,
  programmStufe,
  profilbild,
  rolle,
  user,
} from "../db/schema.js";
import { eingabe } from "../eingabe.js";
import { stufenMitKind } from "../kontakte.js";
import {
  aktivesKonto,
  chatMitglieder,
  hatRolle,
  programmSichtbar,
  sichtbareNachrichten,
  type Person,
} from "../rechte.js";

const pfadSchema = z.strictObject({ id: z.uuid() });
const BILD_FORMAT = {
  code: "BILD_FORMAT",
  message: "Bitte ein Foto als JPEG, PNG oder WebP senden.",
};
// Das Dekodieren kostet Rechenzeit; Uploads sind selten (ein Bild, selten ein zweites)
const UPLOADS = 10;
const FENSTER_MS = 10 * 60_000;

// Wer die Person mit Namen sieht, sieht auch ihr Bild: dieselben Wege wie bei den Namen, keine neue Preisgabe. Die Wege sind der Chat (Autorin einer sichtbaren Nachricht, Gegenüber im Einzelchat), die Kontakte der Stufe und die Kontakte eines Programms
async function darfBildSehen(db: Db, person: Person, zielId: string) {
  if (zielId === person.id) return true;
  // Kontakte der Stufe: SL für Admins, Leitende, SL und Eltern mit aktivem Kind in der Stufe
  const slStufen = (
    await db
      .select({ stufeId: rolle.stufeId })
      .from(rolle)
      .innerJoin(
        user,
        and(eq(user.id, rolle.userId), aktivesKonto(person.abteilungId)),
      )
      .where(and(eq(rolle.userId, zielId), eq(rolle.typ, "stufenleitung")))
  ).map((r) => r.stufeId);
  if (
    slStufen.length > 0 &&
    (person.admin ||
      slStufen.some((s) => hatRolle(person, s, "leitung")) ||
      (await stufenMitKind(db, person, slStufen)).size > 0)
  ) {
    return true;
  }
  const n = sichtbareNachrichten(db, person);
  const [nachricht] = await db
    .select({ id: n.id })
    .from(n)
    .where(eq(n.autorId, zielId))
    .limit(1);
  if (nachricht) return true;
  // Einzelchat: Die SL sieht das Elternteil, auch wenn es den Zugang verloren hat
  const mitglieder = chatMitglieder(db, person.abteilungId);
  const [einzel] = await db
    .select({ id: chat.id })
    .from(chat)
    .innerJoin(mitglieder, eq(mitglieder.chatId, chat.id))
    .where(
      and(
        eq(mitglieder.userId, person.id),
        eq(chat.typ, "direkt"),
        eq(chat.elternUserId, zielId),
      ),
    )
    .limit(1);
  if (einzel) return true;
  // Kontakte eines Programms: die SL mit Status Ja bei einem Programm, das die Person sieht
  const [kontakt] = await db
    .select({ id: programm.id })
    .from(programm)
    .innerJoin(programmStufe, eq(programmStufe.programmId, programm.id))
    .innerJoin(
      rolle,
      and(
        eq(rolle.stufeId, programmStufe.stufeId),
        eq(rolle.userId, zielId),
        eq(rolle.typ, "stufenleitung"),
      ),
    )
    .innerJoin(
      leitungAnmeldung,
      and(
        eq(leitungAnmeldung.programmId, programm.id),
        eq(leitungAnmeldung.userId, zielId),
        eq(leitungAnmeldung.status, "ja"),
      ),
    )
    .innerJoin(
      user,
      and(eq(user.id, rolle.userId), aktivesKonto(person.abteilungId)),
    )
    .where(programmSichtbar(person))
    .limit(1);
  return kontakt !== undefined;
}

// Auch in den Importen ohne node:* und process: Die App prüft diese Datei über AppType; sharp kommt darum als Parameter
export function erstelleProfilbildRouten({
  db,
  kodiereBild,
}: {
  db: Db;
  kodiereBild?: BildKodierer;
}) {
  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const versuche = new Map<string, number[]>();
  const zuViele = (id: string) => {
    const jetzt = Date.now();
    const liste = (versuche.get(id) ?? []).filter(
      (t) => jetzt - t < FENSTER_MS,
    );
    const voll = liste.length >= UPLOADS;
    if (!voll) liste.push(jetzt);
    versuche.set(id, liste);
    return voll;
  };
  return (
    new Hono<{ Variables: { person: Person } }>()
      // Der Body ist das Bild selbst (JPEG, PNG oder WebP); die Grösse begrenzt bodyLimit, bevor die Route einliest, der Typ ergibt sich aus den Bytes und nie aus Header oder Endung. Das Ergebnis ersetzt ein vorhandenes Bild
      .put("/ich/bild", bodyLimit({ maxSize: BILD_MAX_BYTES }), async (c) => {
        const person = c.get("person");
        if (!kodiereBild) throw new HTTPException(501);
        if (zuViele(person.id)) throw new HTTPException(429);
        const daten = new Uint8Array(await c.req.arrayBuffer());
        if (!istErlaubtesBild(daten)) return c.json(BILD_FORMAT, 415);
        let inhalt: Uint8Array;
        try {
          inhalt = await kodiereBild(daten);
        } catch {
          // Kein lesbares Bild oder zu viele Pixel
          return c.json(BILD_FORMAT, 415);
        }
        await db
          .insert(profilbild)
          .values({ userId: person.id, inhalt })
          .onConflictDoUpdate({
            target: profilbild.userId,
            set: { inhalt, geaendertAm: sql`now()` },
          });
        return c.body(null, 204);
      })
      // Ohne Bild ebenfalls 204: Das Ziel ist erreicht
      .delete("/ich/bild", async (c) => {
        await db
          .delete(profilbild)
          .where(eq(profilbild.userId, c.get("person").id));
        return c.body(null, 204);
      })
      .get("/personen/:id/bild", eingabe("param", pfadSchema), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        // Ein Bild gehört nie in einen Cache, auch nicht in den der App; nosniff, damit kein Client die Bytes als etwas anderes liest
        c.header("Cache-Control", "private, no-store");
        c.header("X-Content-Type-Options", "nosniff");
        const [zeile] = await db
          .select({ inhalt: profilbild.inhalt })
          .from(profilbild)
          .where(eq(profilbild.userId, id));
        // Gleiche Antwort für «kein Bild» und «darf es nicht sehen»: Wer kein Recht hat, erfährt nicht, ob es die Person gibt
        if (!zeile || !(await darfBildSehen(db, person, id))) {
          throw new HTTPException(404);
        }
        return c.body(zeile.inhalt as Uint8Array<ArrayBuffer>, 200, {
          "Content-Type": "image/jpeg",
        });
      })
  );
}

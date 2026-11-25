import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { clientIp } from "../client-ip.js";
import { eingabe } from "../eingabe.js";
import { log } from "../log.js";
import {
  ZuVieleChallenges,
  type AppNachweisDienst,
} from "../app-nachweis/dienst.js";

// App-Nachweis (#785), ohne Sitzung: Die Routen liegen vor der Anmeldung, denn mit ihnen holt die App den Beleg für die Anmeldung. Ohne eingeschalteten Nachweis (APP_NACHWEIS=aus) gibt es sie nicht (404).
// Ratenbegrenzung je Adresse wie bei der Anmeldung: 30 je 15 Minuten, getrennt für Herausforderung und Nachweis (der Nachweis ruft Google an)
const ZUGRIFFE = 30;
const FENSTER_MS = 15 * 60_000;

// Mehr als ein Integrity-Token (16 KB) und eine Attestation (rund 6 KB) tragen kann kein Feld
const nachweisSchema = z
  .strictObject({
    plattform: z.enum(["android", "ios"]),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    benutzername: z.string().min(1).max(100),
    // Android
    integrityToken: z
      .string()
      .min(1)
      .max(16 * 1024)
      .optional(),
    // iOS: die Kennung des Schlüssels (base64) und genau eines von attestation oder assertion
    schluesselId: z
      .string()
      .regex(/^[A-Za-z0-9+/_-]{43,44}={0,1}$/)
      .optional(),
    attestation: z
      .string()
      .min(1)
      .max(24 * 1024)
      .optional(),
    assertion: z
      .string()
      .min(1)
      .max(4 * 1024)
      .optional(),
  })
  .refine((b) =>
    b.plattform === "android"
      ? b.integrityToken !== undefined &&
        b.schluesselId === undefined &&
        b.attestation === undefined &&
        b.assertion === undefined
      : b.schluesselId !== undefined &&
        b.integrityToken === undefined &&
        (b.attestation === undefined) !== (b.assertion === undefined),
  );

// Auch in den Importen ohne node:* und process: Die App prüft diese Datei über AppType
export function erstelleAppNachweisRouten({
  dienst,
}: {
  dienst?: AppNachweisDienst;
}) {
  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft (wie beim Kalenderlink)
  const versuche = new Map<string, number[]>();
  const zuViele = (art: string, ip: string | undefined) => {
    const schluessel = `${art}:${ip ?? "unbekannt"}`;
    const jetzt = Date.now();
    const liste = (versuche.get(schluessel) ?? []).filter(
      (t) => jetzt - t < FENSTER_MS,
    );
    const voll = liste.length >= ZUGRIFFE;
    if (!voll) liste.push(jetzt);
    if (liste.length === 0) versuche.delete(schluessel);
    else versuche.set(schluessel, liste);
    return voll;
  };

  return (
    new Hono()
      // Vor der Prüfung der Eingabe: Ohne Nachweis gibt es die Routen nicht, auch nicht für einen kaputten Body
      .use((c, next) => {
        if (!dienst) throw new HTTPException(404);
        return next();
      })
      .post(
        "/challenge",
        eingabe(
          "json",
          z.strictObject({ plattform: z.enum(["android", "ios"]) }),
        ),
        async (c) => {
          if (zuViele("challenge", clientIp(c.req.header("x-forwarded-for")))) {
            throw new HTTPException(429);
          }
          try {
            const { nonce, laeuftAbAm, parameter } = await dienst!.challenge(
              c.req.valid("json").plattform,
            );
            return c.json({
              nonce,
              laeuftAb: laeuftAbAm.toISOString(),
              ...parameter,
            });
          } catch (fehler) {
            if (fehler instanceof ZuVieleChallenges) {
              throw new HTTPException(429);
            }
            throw fehler;
          }
        },
      )
      .post("/", eingabe("json", nachweisSchema), async (c) => {
        if (zuViele("nachweis", clientIp(c.req.header("x-forwarded-for")))) {
          throw new HTTPException(429);
        }
        const b = c.req.valid("json");
        const ergebnis = await dienst!.nachweisen({
          plattform: b.plattform,
          nonce: b.nonce,
          benutzername: b.benutzername,
          android: b.integrityToken
            ? { integrityToken: b.integrityToken }
            : undefined,
          ios: b.schluesselId
            ? {
                schluesselId: b.schluesselId,
                attestation: b.attestation,
                assertion: b.assertion,
              }
            : undefined,
        });
        // Nur Plattform, Ergebnis und der Grund als Wort: nie Token, Attestation, Nonce oder Benutzername
        log(c, {
          ereignis: "app_nachweis",
          schritt: "nachweis",
          plattform: b.plattform,
          ergebnis: ergebnis.ok ? "ok" : "abgelehnt",
          ...(!ergebnis.ok && { grund: ergebnis.grund }),
        });
        if (ergebnis.ok) {
          return c.json({
            ticket: ergebnis.ticket,
            laeuftAb: ergebnis.laeuftAbAm.toISOString(),
          });
        }
        // Ohne Grund: Die App erfährt nicht, was an ihrem Nachweis fehlt
        return ergebnis.voruebergehend
          ? c.json(
              {
                code: "APP_NACHWEIS_NICHT_ERREICHBAR",
                message:
                  "Der Nachweis ist gerade nicht möglich. Bitte später nochmals versuchen.",
              },
              503,
            )
          : c.json(
              {
                code: "APP_NACHWEIS_UNGUELTIG",
                message: "Der Nachweis der App ist ungültig.",
              },
              401,
            );
      })
  );
}

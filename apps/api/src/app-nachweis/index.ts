import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { session } from "../db/schema.js";
import type { ladeKonfiguration } from "../konfiguration.js";
import {
  erstelleAndroidPruefer,
  erstelleGoogleDekodierer,
  leseDienstkonto,
} from "./android.js";
import { erstelleAppNachweisDienst, erstelleGeraeteablage } from "./dienst.js";
import { erstelleIosPruefer } from "./ios.js";

// Baut den Dienst aus der Konfiguration; ohne Modus (aus) gibt es keinen. Die Konfiguration hat schon geprüft, dass beide Plattformen vollständig sind. Eine unlesbare Schlüsseldatei beendet den Start, ohne ihren Inhalt zu nennen
export function baueAppNachweis(
  db: Db,
  k: ReturnType<typeof ladeKonfiguration>,
) {
  if (k.APP_NACHWEIS === "aus") return undefined;
  const {
    ANDROID_PAKETNAME: paketname,
    ANDROID_ZERTIFIKAT_SHA256: zertifikate,
    ANDROID_NACHWEIS_DIENSTKONTO_DATEI: datei,
    IOS_TEAM_ID: teamId,
    IOS_BUNDLE_ID: bundleId,
    IOS_NACHWEIS_UMGEBUNG: umgebung,
  } = k;
  if (
    !paketname ||
    !zertifikate ||
    !datei ||
    !teamId ||
    !bundleId ||
    !umgebung
  ) {
    throw new Error("App-Nachweis: Angaben fehlen");
  }
  let dienstkonto;
  try {
    dienstkonto = leseDienstkonto(readFileSync(datei, "utf8"));
  } catch {
    throw new Error(
      "App-Nachweis: Schlüsseldatei des Dienstkontos nicht lesbar",
    );
  }
  return erstelleAppNachweisDienst({
    db,
    modus: k.APP_NACHWEIS,
    android: erstelleAndroidPruefer({
      paketname,
      zertifikate,
      mindestGeraete: k.ANDROID_NACHWEIS_MIN_GERAETE,
      dekodiere: erstelleGoogleDekodierer({ dienstkonto, paketname }),
    }),
    ios: erstelleIosPruefer({
      teamId,
      bundleId,
      umgebung,
      geraete: erstelleGeraeteablage(db),
    }),
    parameter: {
      android: { plattform: "android", paketname },
      ios: { plattform: "ios", appId: `${teamId}.${bundleId}`, umgebung },
    },
  });
}

// Im Modus «pflicht» gilt keine Sitzung ohne Nachweis weiter: Beim Start enden alle Sitzungen der App, die ohne Nachweis entstanden (client_art «app_ungeprueft»). Wer sie hatte, meldet sich mit der App neu an. Liefert die Zahl der beendeten Sitzungen
export async function beendeUngepruefteAppSitzungen(db: Db) {
  const weg = await db
    .delete(session)
    .where(eq(session.clientArt, "app_ungeprueft"))
    .returning({ id: session.id });
  return weg.length;
}

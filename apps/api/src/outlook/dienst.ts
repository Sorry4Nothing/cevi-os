import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { outlookVerbindung } from "../db/schema.js";
import { entschluesseleToken, verschluesseleToken } from "./geheimnis.js";
import {
  erstelleGraphClients,
  type GraphOptionen,
  type OutlookKalender,
  type TokenSpeicher,
} from "./graph.js";

// Der Zugang zu Outlook, den Routen und der Lauf bekommen (#835). Fehlt er (Schalter aus), bleibt alles beim Lesen. Der Dienst hält je Abteilung einen Client mit Zugriffstoken im Speicher; das Refresh-Token liegt verschlüsselt in der Datenbank.
export type OutlookDienst = {
  // Ohne aktive Verbindung der Abteilung null (nicht verbunden oder abgelaufen)
  fuer(
    abteilungId: string,
    art?: "normal" | "schnell",
  ): Promise<OutlookKalender | null>;
};

export type DienstOptionen = Omit<GraphOptionen, "versuche">;

export function tokenSpeicher(db: Db, abteilungId: string): TokenSpeicher {
  return {
    async lade() {
      const [zeile] = await db
        .select({
          token: outlookVerbindung.refreshToken,
          status: outlookVerbindung.status,
        })
        .from(outlookVerbindung)
        .where(eq(outlookVerbindung.abteilungId, abteilungId));
      if (!zeile || zeile.status !== "aktiv") return null;
      return entschluesseleToken(zeile.token, abteilungId);
    },
    async speichere(refreshToken) {
      await db
        .update(outlookVerbindung)
        .set({
          refreshToken: verschluesseleToken(refreshToken, abteilungId),
          erneuertAm: new Date(),
        })
        .where(eq(outlookVerbindung.abteilungId, abteilungId));
    },
    async abgelaufen() {
      await db
        .update(outlookVerbindung)
        .set({ status: "abgelaufen", letzterFehler: "ANMELDUNG_ABGELAUFEN" })
        .where(eq(outlookVerbindung.abteilungId, abteilungId));
    },
  };
}

export function erstelleOutlookDienst(
  db: Db,
  optionen: DienstOptionen,
): OutlookDienst {
  const clients = new Map<
    string,
    { normal: OutlookKalender; schnell: OutlookKalender }
  >();
  return {
    async fuer(abteilungId, art = "normal") {
      const [zeile] = await db
        .select({ status: outlookVerbindung.status })
        .from(outlookVerbindung)
        .where(eq(outlookVerbindung.abteilungId, abteilungId));
      if (zeile?.status !== "aktiv") {
        // Nach «abgelaufen» und neuer Verbindung beginnt ein frischer Client
        clients.delete(abteilungId);
        return null;
      }
      let paar = clients.get(abteilungId);
      if (!paar) {
        paar = erstelleGraphClients(optionen, tokenSpeicher(db, abteilungId));
        clients.set(abteilungId, paar);
      }
      return paar[art];
    },
  };
}

// Speichert (oder ersetzt) die Verbindung einer Abteilung nach der Autorisierung; die Kategorienliste ist danach nachzuführen
export async function speichereVerbindung(
  db: Db,
  abteilungId: string,
  refreshToken: string,
) {
  const verschluesselt = verschluesseleToken(refreshToken, abteilungId);
  await db
    .insert(outlookVerbindung)
    .values({
      abteilungId,
      refreshToken: verschluesselt,
      kategorienOffen: true,
    })
    .onConflictDoUpdate({
      target: outlookVerbindung.abteilungId,
      set: {
        refreshToken: verschluesselt,
        status: "aktiv",
        verbundenAm: new Date(),
        erneuertAm: null,
        kategorienOffen: true,
        versuche: 0,
        naechsterVersuch: new Date(),
        letzterFehler: null,
      },
    });
}

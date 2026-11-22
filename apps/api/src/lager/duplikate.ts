import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  aufgabe,
  aufgabeCheckpunkt,
  aufgabeLink,
  aufgabeStichwort,
} from "../db/schema.js";
import { aufgabeAnsicht, ladeAufgabeZeile } from "./aufgaben.js";
import {
  MAX_CHECKPUNKTE,
  MAX_LINKS,
  MAX_STICHWORTE,
  type Pruefung,
} from "./aufgaben-details.js";
import { sperreLager } from "./ressorts.js";
import { aendereZeile, legeZeilenAn, loescheZeile, type Tx } from "./sync.js";

// Duplikate von Aufgaben erkennen und zusammenführen (#373).
//
// Zwei Aufgaben sind Duplikate, wenn ihr normalisierter Titel im selben Ressort gleich ist (ohne Ressort gelten alle Aufgaben ohne Ressort als ein Ressort). Erledigte Aufgaben zählen nicht: Eine wiederkehrende Aufgabe bekommt beim Erledigen eine gleichnamige Folgeaufgabe (lager/wiederholung.ts).

// Gross- und Kleinschreibung, Akzente, Satzzeichen und mehrfacher Leerraum zählen nicht: «Zelte  prüfen!» und «zelte pruefen» sind verschieden (ü bleibt u), «Zelte prüfen» und «zelte Prüfen.» gleich
export function normalisiereTitel(titel: string) {
  return titel
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type DuplikatGruppe = {
  ressortId: string | null;
  titel: string;
  aufgaben: { id: string; version: number; titel: string; status: string }[];
};

// Eine Abfrage: die offenen Aufgaben des Lagers (nur ID, Version, Titel, Ressort, Status), gruppiert im Speicher. Mit «titel» die Aufgaben desselben Ressorts mit gleichem Titel (für den Hinweis beim Anlegen; ressortId leer heisst «ohne Ressort»); ohne «titel» alle Gruppen mit mindestens zwei Aufgaben, mit ressortId nur die dieses Ressorts. shortcut: Die Normalisierung läuft im Speicher über alle offenen Aufgaben des Lagers (einige Hundert); bei vielen Tausend einen gespeicherten Suchschlüssel auf der Aufgabe führen
export async function findeDuplikate(
  db: Pick<Db, "select">,
  lagerId: string,
  p: { titel?: string; ressortId?: string },
): Promise<{ gruppen: DuplikatGruppe[] }> {
  const gesucht =
    p.titel === undefined ? undefined : normalisiereTitel(p.titel);
  if (gesucht === "") return { gruppen: [] };
  const zeilen = await db
    .select({
      id: aufgabe.id,
      version: aufgabe.version,
      titel: aufgabe.titel,
      ressortId: aufgabe.ressortId,
      status: aufgabe.status,
    })
    .from(aufgabe)
    .where(
      and(
        eq(aufgabe.lagerId, lagerId),
        isNull(aufgabe.geloeschtAm),
        sql`${aufgabe.status} <> 'erledigt'`,
        p.titel !== undefined
          ? sql`${aufgabe.ressortId} is not distinct from ${p.ressortId ?? null}`
          : p.ressortId
            ? eq(aufgabe.ressortId, p.ressortId)
            : undefined,
      ),
    )
    .orderBy(asc(aufgabe.reihenfolge), asc(aufgabe.id));
  const gruppen = new Map<string, DuplikatGruppe>();
  for (const z of zeilen) {
    const schluessel = normalisiereTitel(z.titel);
    if (
      schluessel === "" ||
      (gesucht !== undefined && schluessel !== gesucht)
    ) {
      continue;
    }
    const key = `${z.ressortId ?? ""}|${schluessel}`;
    const gruppe = gruppen.get(key) ?? {
      ressortId: z.ressortId,
      titel: z.titel,
      aufgaben: [],
    };
    gruppe.aufgaben.push({
      id: z.id,
      version: z.version,
      titel: z.titel,
      status: z.status,
    });
    gruppen.set(key, gruppe);
  }
  return {
    gruppen: [...gruppen.values()].filter(
      (g) => gesucht !== undefined || g.aufgaben.length > 1,
    ),
  };
}

export const duplikateAbfrage = z.strictObject({
  titel: z.string().trim().min(1).max(200).optional(),
  ressortId: z.uuid().optional(),
});

// Führt «mitId» in die Aufgabe «id» zusammen: Checkliste, Links, Stichworte, Notiz und Frist werden vereint, die zweite Aufgabe wird gelöscht (über loescheZeile des Sync-Kerns; bis dahin Soft-Delete, sie behält ihre Details). Alles in der Transaktion des Aufrufers, unter der Lagersperre; beide Versionen werden geprüft (409 VERSION_KONFLIKT).
// - Checkpunkte und Links der zweiten Aufgabe kommen als Kopien ans Ende (ein Punkt mit gleichem Text und ein Link mit gleicher Adresse nicht doppelt), Stand und Person des Abhakens bleiben; Stichworte als Vereinigung.
// - Notiz: Hat nur eine eine Notiz, gilt sie; sonst stehen beide untereinander (zuerst die der Zielaufgabe).
// - Frist: die frühere der beiden.
// Was die Obergrenzen oder die Länge der Notiz sprengt, bricht mit einem Fehlercode ab, bevor etwas geschrieben ist
export async function fuehreAufgabenZusammen(
  tx: Tx,
  k: { lagerId: string; personId: string },
  p: { id: string; version: number; mitId: string; mitVersion: number },
): Promise<Pruefung> {
  if (p.id === p.mitId) return { fehler: "GLEICHE_AUFGABE" };
  await sperreLager(tx, k.lagerId);
  const [ziel, zweite] = await Promise.all([
    ladeAufgabeZeile(tx, k.lagerId, p.id),
    ladeAufgabeZeile(tx, k.lagerId, p.mitId),
  ]);
  if (!ziel || !zweite) throw new HTTPException(404);

  const ids = [ziel.id, zweite.id];
  const [checkpunkte, links, stichworte] = await Promise.all([
    tx
      .select()
      .from(aufgabeCheckpunkt)
      .where(
        and(
          inArray(aufgabeCheckpunkt.aufgabeId, ids),
          isNull(aufgabeCheckpunkt.geloeschtAm),
        ),
      )
      .orderBy(asc(aufgabeCheckpunkt.reihenfolge), asc(aufgabeCheckpunkt.id)),
    tx
      .select()
      .from(aufgabeLink)
      .where(
        and(
          inArray(aufgabeLink.aufgabeId, ids),
          isNull(aufgabeLink.geloeschtAm),
        ),
      )
      .orderBy(asc(aufgabeLink.id)),
    tx
      .select()
      .from(aufgabeStichwort)
      .where(inArray(aufgabeStichwort.aufgabeId, ids)),
  ]);

  const zielPunkte = checkpunkte.filter((c) => c.aufgabeId === ziel.id);
  const bekannteTexte = new Set(
    zielPunkte.map((c) => normalisiereTitel(c.text)),
  );
  const neuePunkte = checkpunkte
    .filter((c) => c.aufgabeId === zweite.id)
    .filter((c) => {
      const t = normalisiereTitel(c.text);
      if (bekannteTexte.has(t)) return false;
      bekannteTexte.add(t);
      return true;
    });
  const zielLinks = links.filter((l) => l.aufgabeId === ziel.id);
  const bekannteUrls = new Set(zielLinks.map((l) => l.url));
  const neueLinks = links
    .filter((l) => l.aufgabeId === zweite.id)
    .filter((l) => {
      if (bekannteUrls.has(l.url)) return false;
      bekannteUrls.add(l.url);
      return true;
    });
  const zielStichworte = stichworte.filter((s) => s.aufgabeId === ziel.id);
  const bekannteWorte = new Set(
    zielStichworte.map((s) => s.stichwort.toLowerCase()),
  );
  const neueStichworte = stichworte
    .filter((s) => s.aufgabeId === zweite.id)
    .filter((s) => {
      const w = s.stichwort.toLowerCase();
      if (bekannteWorte.has(w)) return false;
      bekannteWorte.add(w);
      return true;
    });

  if (zielPunkte.length + neuePunkte.length > MAX_CHECKPUNKTE) {
    return { fehler: "ZU_VIELE_CHECKPUNKTE" };
  }
  if (zielLinks.length + neueLinks.length > MAX_LINKS) {
    return { fehler: "ZU_VIELE_LINKS" };
  }
  if (zielStichworte.length + neueStichworte.length > MAX_STICHWORTE) {
    return { fehler: "ZU_VIELE_STICHWORTE" };
  }
  const notizen = [ziel.notiz, zweite.notiz].filter(
    (n): n is string => typeof n === "string" && n.trim() !== "",
  );
  const notiz = notizen.length === 0 ? null : notizen.join("\n\n");
  if (notiz !== null && notiz.length > 5000) return { fehler: "NOTIZ_ZU_LANG" };
  const fristen = [ziel.frist, zweite.frist].filter((f): f is string => !!f);
  const frist = fristen.length === 0 ? null : fristen.sort()[0]!;

  // Erst die Zeilen mit Versionsprüfung (ein Konflikt nimmt alles zurück), dann die Kopien
  await aendereZeile(tx, aufgabe, k, {
    id: ziel.id,
    version: p.version,
    werte: { notiz, frist },
    ansicht: aufgabeAnsicht,
  });
  await loescheZeile(tx, aufgabe, k, {
    id: zweite.id,
    version: p.mitVersion,
    ansicht: aufgabeAnsicht,
  });
  const ende = zielPunkte.reduce((m, c) => Math.max(m, c.reihenfolge + 1), 0);
  await legeZeilenAn(
    tx,
    aufgabeCheckpunkt,
    k,
    neuePunkte.map((c, i) => ({
      aufgabeId: ziel.id,
      text: c.text,
      erledigt: c.erledigt,
      personId: c.personId,
      reihenfolge: ende + i,
    })),
  );
  await legeZeilenAn(
    tx,
    aufgabeLink,
    k,
    neueLinks.map((l) => ({ aufgabeId: ziel.id, titel: l.titel, url: l.url })),
  );
  if (neueStichworte.length > 0) {
    await tx.insert(aufgabeStichwort).values(
      neueStichworte.map((s) => ({
        lagerId: k.lagerId,
        aufgabeId: ziel.id,
        stichwort: s.stichwort,
      })),
    );
  }
  return undefined;
}

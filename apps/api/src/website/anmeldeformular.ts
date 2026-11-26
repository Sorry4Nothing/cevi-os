import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { auditLog, seite, seiteVersion } from "../db/schema.js";
import type { Baustein } from "./bausteine.js";
import { pruefeDokument, type Seitendokument } from "./dokument.js";
import { adresseSchema } from "./seiten.js";
import { pruefeVerweise } from "./verweise.js";
import { ANMELDUNG_ABSCHNITT, anmeldeFormular } from "./vorlagen.js";

// Stellt eine bestehende Seite auf das Anmeldeformular um (#881), ohne Handarbeit in der Verwaltung: Der Befehl src/cli/anmeldeformular.ts ruft das auf.
// Gesucht wird der eine Baustein, dessen Text den Abschnitt nennt («So meldest du dich an»). Ist er eine Überschrift, ersetzt das Formular die Text- und Knopf-Bausteine bis zur nächsten Überschrift gleicher oder höherer Ebene; sonst ersetzt es den Baustein selbst und einen direkt folgenden Knopf mit E-Mail-Adresse. Alle anderen Bausteine bleiben unverändert.
// Nichts geändert wird, wenn der Abschnitt fehlt oder mehrfach vorkommt, wenn im Abschnitt etwas anderes als Text und Knöpfe steht oder wenn die Seite schon ein Formular hat (zweiter Lauf).

// Bausteine, die nur Text, Listen und Knöpfe tragen: Nur diese ersetzt das Formular
const ERSETZBAR = new Set<Baustein["typ"]>([
  "text",
  "schaltflaeche",
  "aufruf",
  "hinweis",
  "hinweisbox",
  "schritte",
  "checkliste",
]);

export class AnmeldeFehler extends Error {}

// Alle Texte eines Bausteins, ohne Abstände: Ein Absatz im Rich Text ist in Stücke geteilt
const normal = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
function texte(wert: unknown): string {
  if (typeof wert === "string") return wert;
  if (Array.isArray(wert)) return wert.map(texte).join("");
  if (wert && typeof wert === "object") {
    return Object.values(wert).map(texte).join("");
  }
  return "";
}
const nennt = (b: Baustein, abschnitt: string) =>
  normal(texte(b.daten)).includes(normal(abschnitt));

const istMailKnopf = (b: Baustein | undefined) =>
  b?.typ === "schaltflaeche" && b.daten.ziel.startsWith("mailto:");

export type Ersetzung = { bausteine: Baustein[]; entfernt: Baustein["typ"][] };

// Reine Funktion: das neue Dokument oder ein Fehler mit Meldung; das alte Dokument bleibt unberührt
export function ersetzeAbschnitt(
  bausteine: readonly Baustein[],
  abschnitt: string,
  formular: (titel?: string) => Baustein,
  anhaengen = false,
): Ersetzung {
  const treffer = bausteine.flatMap((b, i) => (nennt(b, abschnitt) ? [i] : []));
  if (treffer.length === 0) {
    if (anhaengen)
      return { bausteine: [...bausteine, formular()], entfernt: [] };
    throw new AnmeldeFehler(
      `Kein Baustein nennt «${abschnitt}». Nichts geändert. Mit --anhaengen kommt das Formular ans Ende der Seite.`,
    );
  }
  if (treffer.length > 1) {
    throw new AnmeldeFehler(
      `${treffer.length} Bausteine nennen «${abschnitt}». Nichts geändert: Der Abschnitt ist nicht eindeutig.`,
    );
  }
  const i = treffer[0]!;
  const b = bausteine[i]!;
  if (b.typ === "ueberschrift") {
    let ende = i + 1;
    while (
      ende < bausteine.length &&
      !(
        bausteine[ende]!.typ === "ueberschrift" &&
        (bausteine[ende] as Extract<Baustein, { typ: "ueberschrift" }>).daten
          .ebene <= b.daten.ebene
      )
    ) {
      ende++;
    }
    const abschnittTeile = bausteine.slice(i + 1, ende);
    const fremd = abschnittTeile.filter((x) => !ERSETZBAR.has(x.typ));
    if (fremd.length > 0) {
      throw new AnmeldeFehler(
        `Im Abschnitt «${abschnitt}» stehen auch andere Bausteine (${[...new Set(fremd.map((x) => x.typ))].join(", ")}). Nichts geändert.`,
      );
    }
    return {
      bausteine: [
        ...bausteine.slice(0, i + 1),
        formular(),
        ...bausteine.slice(ende),
      ],
      entfernt: abschnittTeile.map((x) => x.typ),
    };
  }
  if (!ERSETZBAR.has(b.typ)) {
    throw new AnmeldeFehler(
      `«${abschnitt}» steht in einem Baustein der Art «${b.typ}». Nichts geändert: Ersetzt werden nur Text und Knöpfe.`,
    );
  }
  // Der Baustein selbst und ein Knopf «per E-Mail» direkt danach; die Überschrift trägt dann das Formular
  const ende = istMailKnopf(bausteine[i + 1]) ? i + 2 : i + 1;
  return {
    bausteine: [
      ...bausteine.slice(0, i),
      formular(ANMELDUNG_ABSCHNITT),
      ...bausteine.slice(ende),
    ],
    entfernt: bausteine.slice(i, ende).map((x) => x.typ),
  };
}

export type Ergebnis = {
  seiteId: string;
  // ersetzt: das Formular ist neu im Entwurf; vorhanden: die Seite hatte schon eines (nichts geändert)
  art: "ersetzt" | "vorhanden";
  entfernt: Baustein["typ"][];
  // Nummer der neuen Version, wenn veröffentlicht wurde
  veroeffentlicht: number | null;
};

const hatFormular = (inhalt: unknown) =>
  Array.isArray((inhalt as { bausteine?: unknown } | null)?.bausteine) &&
  (inhalt as { bausteine: { typ?: unknown }[] }).bausteine.some(
    (b) => b?.typ === "formular",
  );

// Die Seite zum Pfad «/a/b» in einer Abteilung, über die Kette der Adressen ab der Wurzel; sonst null
async function findeSeite(
  db: Pick<Db, "select">,
  abteilungId: string,
  teile: string[],
) {
  let elternId: string | null = null;
  for (const adresse of teile) {
    const [z]: { id: string }[] = await db
      .select({ id: seite.id })
      .from(seite)
      .where(
        and(
          eq(seite.abteilungId, abteilungId),
          elternId === null
            ? isNull(seite.elternId)
            : eq(seite.elternId, elternId),
          eq(seite.adresse, adresse),
        ),
      );
    if (!z) return null;
    elternId = z.id;
  }
  return elternId;
}

export function zerlegePfad(pfad: string): string[] {
  const teile = pfad.split("/").filter(Boolean);
  if (
    teile.length === 0 ||
    !teile.every((t) => adresseSchema.safeParse(t).success)
  ) {
    throw new AnmeldeFehler(
      `Der Pfad «${pfad}» ist keine Adresse einer Seite (zum Beispiel /mitmachen/anmeldung).`,
    );
  }
  return teile;
}

// Die Abteilung: die angegebene, sonst die einzige, die eine Seite unter dem Pfad hat
export async function waehleAbteilungMitSeite(
  db: Db,
  teile: string[],
  abteilungId?: string,
): Promise<string> {
  if (abteilungId) return abteilungId;
  const kandidaten = await db
    .selectDistinct({ id: seite.abteilungId })
    .from(seite)
    .where(eq(seite.adresse, teile.at(-1)!));
  const mit: string[] = [];
  for (const k of kandidaten) {
    if (await findeSeite(db, k.id, teile)) mit.push(k.id);
  }
  if (mit.length !== 1) {
    throw new AnmeldeFehler(
      mit.length === 0
        ? `Keine Seite mit dem Pfad /${teile.join("/")}.`
        : `Mehrere Abteilungen haben die Seite /${teile.join("/")}: --abteilung <id> angeben.`,
    );
  }
  return mit[0]!;
}

export async function setzeAnmeldeformular(
  db: Db,
  {
    abteilungId,
    teile,
    veroeffentlichen,
    anhaengen = false,
    abschnitt = ANMELDUNG_ABSCHNITT,
  }: {
    abteilungId: string;
    teile: string[];
    veroeffentlichen: boolean;
    anhaengen?: boolean;
    abschnitt?: string;
  },
): Promise<Ergebnis> {
  return db.transaction(async (tx) => {
    const seiteId = await findeSeite(tx, abteilungId, teile);
    if (!seiteId) {
      throw new AnmeldeFehler(`Keine Seite mit dem Pfad /${teile.join("/")}.`);
    }
    // Wie die Routen der Verwaltung: die Zeile sperren, dann frisch lesen
    const [z] = await tx
      .select({
        entwurf: seite.entwurf,
        sichtbarkeit: seite.sichtbarkeit,
        inhalt: seiteVersion.inhalt,
        gleich: sql<boolean | null>`${seite.entwurf} = ${seiteVersion.inhalt}`,
      })
      .from(seite)
      .leftJoin(
        seiteVersion,
        eq(seiteVersion.id, seite.veroeffentlichteVersionId),
      )
      .where(eq(seite.id, seiteId))
      .for("update", { of: seite });
    if (!z) throw new AnmeldeFehler("Die Seite gibt es nicht mehr.");
    const quelle = z.entwurf ?? z.inhalt;
    if (quelle === null) {
      throw new AnmeldeFehler(
        "Die Seite hat noch keinen Inhalt. Nichts geändert.",
      );
    }
    // Unveröffentlichte Änderungen anderer würden mit veröffentlicht
    const offen = z.entwurf !== null && z.inhalt !== null && z.gleich !== true;
    const audit = (aktion: string, details: Record<string, unknown>) =>
      tx.insert(auditLog).values({
        abteilungId,
        akteurId: "cli",
        aktion,
        zielTyp: "seite",
        zielId: seiteId,
        details,
      });

    let dokument: Seitendokument;
    let art: Ergebnis["art"];
    let entfernt: Baustein["typ"][] = [];
    if (hatFormular(quelle)) {
      // Zweiter Lauf: nichts neu anlegen. Veröffentlicht wird nur, wenn der Entwurf das Formular hat und die Website noch nicht
      art = "vorhanden";
      if (!veroeffentlichen || hatFormular(z.inhalt) || z.entwurf === null) {
        return { seiteId, art, entfernt, veroeffentlicht: null };
      }
      const p = pruefeDokument(z.entwurf);
      if (!p.ok) {
        throw new AnmeldeFehler(
          `Der Entwurf ist ungültig (${p.fehler[0]?.pfad ?? ""}). Nichts geändert.`,
        );
      }
      dokument = p.dokument;
    } else {
      if (veroeffentlichen && offen) {
        throw new AnmeldeFehler(
          "Die Seite hat unveröffentlichte Änderungen. Nichts geändert: Veröffentliche oder verwirf sie zuerst in der Verwaltung, oder lass --veroeffentlichen weg.",
        );
      }
      const alt = pruefeDokument(quelle);
      if (!alt.ok) {
        throw new AnmeldeFehler(
          `Der Inhalt der Seite ist ungültig (${alt.fehler[0]?.pfad ?? ""}). Nichts geändert.`,
        );
      }
      const e = ersetzeAbschnitt(
        alt.dokument.bausteine,
        abschnitt,
        anmeldeFormular,
        anhaengen,
      );
      const neu = pruefeDokument({ ...alt.dokument, bausteine: e.bausteine });
      if (!neu.ok) {
        throw new AnmeldeFehler(
          `Das neue Dokument ist ungültig (${neu.fehler[0]?.pfad ?? ""}). Nichts geändert.`,
        );
      }
      dokument = neu.dokument;
      art = "ersetzt";
      entfernt = e.entfernt;
      await tx
        .update(seite)
        .set({
          entwurf: dokument,
          entwurfZaehler: sql`${seite.entwurfZaehler} + 1`,
        })
        .where(eq(seite.id, seiteId));
      // Nur Arten und Zahlen, nie Texte der Seite
      await audit("seite_anmeldeformular", { entfernt, anhaengen });
    }
    if (!veroeffentlichen) {
      return { seiteId, art, entfernt, veroeffentlicht: null };
    }
    const verweise = await pruefeVerweise(
      tx,
      abteilungId,
      z.sichtbarkeit,
      dokument,
    );
    if (verweise.length > 0) {
      throw new AnmeldeFehler(
        `Die Seite verweist auf etwas Unzulässiges (${verweise[0]!.code}). Nichts geändert.`,
      );
    }
    const [letzte] = await tx
      .select({ nr: seiteVersion.nr })
      .from(seiteVersion)
      .where(eq(seiteVersion.seiteId, seiteId))
      .orderBy(desc(seiteVersion.nr))
      .limit(1);
    const nr = (letzte?.nr ?? 0) + 1;
    const [version] = await tx
      .insert(seiteVersion)
      .values({ seiteId, nr, inhalt: dokument, autorId: null })
      .returning({ id: seiteVersion.id });
    await tx
      .update(seite)
      .set({ veroeffentlichteVersionId: version!.id })
      .where(eq(seite.id, seiteId));
    await audit("seite_veroeffentlicht", { nr });
    return { seiteId, art, entfernt, veroeffentlicht: nr };
  });
}

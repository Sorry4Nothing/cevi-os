import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  bearbeiter,
  gruppenRolle,
  gruppenRolleRecht,
  personPlattformRolle,
  personTag,
  plattformEntwickler,
  plattformRolle,
  plattformRolleRecht,
  raum,
  tag,
} from "../db/schema.js";
import type { Person } from "../rechte.js";
import {
  eintragVon,
  istRecht,
  type Bezug,
  type Geltung,
  type RechtId,
} from "./katalog.js";
import {
  MITGLIED_STANDARD,
  OHNE_ZWEITEN_FAKTOR,
  OHNE_ZWEITEN_FAKTOR_STUFENARBEIT,
  RAUM_TEAM_STANDARD,
  STUFENROLLEN_STANDARD,
} from "./standard.js";

// Was ein Recht trifft (#643). Die Route lädt ihr Objekt in SQL auf die Abteilung der Sitzung gefiltert (fremd = 404) und baut dann diesen kleinen Verweis aus der Zeile; sie nennt nur, was sie weiss. Ohne den Bezug, an dem «eigene» hängt, trifft «eigene» nichts (fail-closed).
export interface Objekt {
  // Zweite Sicherung nach dem 404: ein Objekt einer fremden Abteilung gibt nie ein Recht, auch der Abteilungsleitung nicht
  abteilungId?: string;
  seiteId?: string;
  // Die Gruppe, zu der das Objekt gehört (Seite eines Teams) oder das Ziel (Gruppe einer Mitteilung, Gruppe, deren Mitglieder verwaltet werden)
  tagId?: string | null;
  // Die Stufe, zu der das Objekt gehört (Stufenseite); gilt nur für die Stufenrollen
  stufeId?: string | null;
  anlassId?: string | null;
  // Das Team des Raums (raum.team_tag_id); null = der Raum hat keines
  raumTeamTagId?: string | null;
  // Die Frage gilt der ganzen Abteilung (Mitteilung an alle): Nur eine Quelle mit der Geltung «alle» zählt, «eigene» nie
  abteilungsweit?: true;
}

// Woher ein Recht kommt: für «Was darf wer?» und für die Frage, ob der zweite Faktor entfällt
export interface Herkunft {
  art:
    | "abteilungsleitung"
    | "entwickler"
    | "struktur"
    | "plattformrolle"
    | "stufenrolle"
    | "mitgliedschaft"
    | "gruppenrolle"
    | "sonderrecht";
  geltung: Geltung;
  // Name der Plattformrolle, der Gruppe oder der Gruppenrolle; nie ein Personenname
  rolle?: string;
  gruppe?: string;
  gruppeId?: string;
}

interface Zeile {
  quelle: "e" | "p" | "g" | "t" | "s";
  recht: string | null;
  geltung: string | null;
  tag_id: string | null;
  anlass_id: string | null;
  tag_typ: string | null;
  tag_name: string | null;
  rolle_name: string | null;
  raum_team: boolean;
  objekt_id: string | null;
}

// Die Rechte einer Person, einmal je Person-Objekt und damit einmal je Anfrage geladen (wie plattform.ts): Vergabe und Entzug wirken bei der nächsten Anfrage, es kostet nie mehr als eine Abfrage, und wer nie fragt, löst keine aus. Ein neues Person-Objekt lädt neu; wer in einem Test dieselbe Person nach einer Änderung noch einmal fragt, übergibt eine Kopie
const geladen = new WeakMap<object, Promise<RechteSatz>>();

type Lesbar = Pick<Db, "execute">;

export function ladeRechteSatz(
  db: Lesbar,
  person: Person,
): Promise<RechteSatz> {
  let gespeichert = geladen.get(person);
  if (!gespeichert) {
    // Eine gebündelte Abfrage mit fünf Zweigen. Jeder Zweig schränkt auf die Abteilung der Person ein: Eine Rolle, Gruppe oder Zeile einer anderen Abteilung gibt nie ein Recht
    const abteilung = person.abteilungId;
    const abfrage = sql`
      select 'e' as quelle, null::text as recht, null::text as geltung, null::uuid as tag_id, null::uuid as anlass_id, null::text as tag_typ, null::text as tag_name, null::text as rolle_name, false as raum_team, null::uuid as objekt_id
        from ${plattformEntwickler} where ${plattformEntwickler.userId} = ${person.id}
      union all
      select 'p', ${plattformRolleRecht.recht}, 'alle', null, null, null, null, ${plattformRolle.name}, false, null
        from ${personPlattformRolle}
        inner join ${plattformRolle} on ${plattformRolle.id} = ${personPlattformRolle.rolleId} and ${plattformRolle.abteilungId} = ${abteilung}
        inner join ${plattformRolleRecht} on ${plattformRolleRecht.rolleId} = ${plattformRolle.id}
        where ${personPlattformRolle.userId} = ${person.id}
      union all
      select 'g', ${gruppenRolleRecht.recht}, ${gruppenRolleRecht.geltung}, ${tag.id}, ${tag.anlassId}, ${tag.typ}, ${tag.name}, ${gruppenRolle.name}, false, null
        from ${personTag}
        inner join ${tag} on ${tag.id} = ${personTag.tagId} and ${tag.abteilungId} = ${abteilung}
        inner join ${gruppenRolle} on ${gruppenRolle.id} = ${personTag.rolleId} and ${gruppenRolle.tagId} = ${personTag.tagId} and ${gruppenRolle.abteilungId} = ${abteilung}
        inner join ${gruppenRolleRecht} on ${gruppenRolleRecht.rolleId} = ${gruppenRolle.id}
        where ${personTag.userId} = ${person.id}
      union all
      select 't', null, null, ${tag.id}, ${tag.anlassId}, ${tag.typ}, ${tag.name}, null, exists (select 1 from ${raum} where ${raum.teamTagId} = ${tag.id} and ${raum.abteilungId} = ${abteilung}), null
        from ${personTag}
        inner join ${tag} on ${tag.id} = ${personTag.tagId} and ${tag.abteilungId} = ${abteilung}
        where ${personTag.userId} = ${person.id}
      union all
      select 's', null, null, null, null, ${bearbeiter.objektTyp}, null, null, false, ${bearbeiter.objektId}
        from ${bearbeiter}
        where ${bearbeiter.abteilungId} = ${abteilung}
          and (${bearbeiter.userId} = ${person.id} or ${bearbeiter.tagId} in (select ${personTag.tagId} from ${personTag} inner join ${tag} on ${tag.id} = ${personTag.tagId} and ${tag.abteilungId} = ${abteilung} where ${personTag.userId} = ${person.id}))`;
    // postgres-js gibt die Zeilen als Liste zurück (Drizzle reicht sie durch)
    gespeichert = (db.execute(abfrage) as unknown as Promise<Zeile[]>).then(
      (zeilen) => new RechteSatz(person, [...zeilen]),
    );
    geladen.set(person, gespeichert);
  }
  return gespeichert;
}

// Ein Treffer in der Rangfolge der Rechte; die Auswertung ist reine Rechnung im Speicher
export class RechteSatz {
  readonly entwickler: boolean;
  private readonly plattform: { recht: string; rolle: string }[];
  private readonly gruppen: {
    recht: string;
    geltung: string;
    tagId: string;
    anlassId: string | null;
    tagName: string;
    rolle: string;
  }[];
  private readonly mitgliedschaften: {
    tagId: string;
    typ: string;
    name: string;
    raumTeam: boolean;
  }[];
  private readonly sonder: { objektTyp: string; objektId: string }[];

  constructor(
    readonly person: Person,
    zeilen: readonly Zeile[],
  ) {
    this.entwickler = zeilen.some((z) => z.quelle === "e");
    this.plattform = zeilen
      .filter((z) => z.quelle === "p")
      .map((z) => ({ recht: z.recht!, rolle: z.rolle_name! }));
    this.gruppen = zeilen
      .filter((z) => z.quelle === "g")
      .map((z) => ({
        recht: z.recht!,
        geltung: z.geltung!,
        tagId: z.tag_id!,
        anlassId: z.anlass_id,
        tagName: z.tag_name!,
        rolle: z.rolle_name!,
      }));
    this.mitgliedschaften = zeilen
      .filter((z) => z.quelle === "t")
      .map((z) => ({
        tagId: z.tag_id!,
        typ: z.tag_typ!,
        name: z.tag_name!,
        raumTeam: z.raum_team,
      }));
    this.sonder = zeilen
      .filter((z) => z.quelle === "s")
      .map((z) => ({ objektTyp: z.tag_typ!, objektId: z.objekt_id! }));
  }

  // Alle Quellen, die dieses Recht für dieses Objekt geben. Ohne objekt: Gibt es das Recht irgendwo («eigene» zählt dann überall), zum Beispiel für die Tür der Verwaltung. Ein unbekanntes Recht gibt nichts
  herkuenfte(recht: string, objekt?: Objekt): Herkunft[] {
    if (!istRecht(recht)) return [];
    const e = eintragVon(recht);
    const p = this.person;
    // Ein Objekt einer anderen Abteilung gibt nie etwas
    if (
      objekt?.abteilungId !== undefined &&
      objekt.abteilungId !== p.abteilungId
    ) {
      return [];
    }
    const abteilungsweit = objekt?.abteilungsweit === true;
    // Abteilungsweit ohne Bezug zu einem Objekt: wie «irgendwo», aber nur mit der Geltung «alle»
    const irgendwo = objekt === undefined || abteilungsweit;
    const treffer: Herkunft[] = [];

    if (p.admin && !e.nurEntwickler) {
      treffer.push({ art: "abteilungsleitung", geltung: "alle" });
    }
    if (this.entwickler && e.entwickler) {
      treffer.push({ art: "entwickler", geltung: "alle" });
    }
    if (e.art === "struktur") {
      treffer.push({ art: "struktur", geltung: "alle" });
    }
    // Fest oder strukturell: nichts weiter einstellbar
    if (e.art !== "vergebbar") return treffer;

    for (const r of this.plattform) {
      if (r.recht === recht) {
        treffer.push({
          art: "plattformrolle",
          geltung: "alle",
          rolle: r.rolle,
        });
      }
    }

    for (const r of p.rollen) {
      for (const z of STUFENROLLEN_STANDARD[r.typ]) {
        if (z.recht !== recht) continue;
        if (z.geltung === "alle" || irgendwo || objekt?.stufeId === r.stufeId) {
          treffer.push({
            art: "stufenrolle",
            geltung: z.geltung,
            gruppeId: r.stufeId,
          });
        }
      }
    }

    for (const m of this.mitgliedschaften) {
      const standard = [
        ...(MITGLIED_STANDARD[m.typ as keyof typeof MITGLIED_STANDARD] ?? []),
        ...(m.raumTeam ? RAUM_TEAM_STANDARD : []),
      ];
      for (const z of standard) {
        if (z.recht !== recht) continue;
        // «eigene» der Mitgliedschaft: die Gruppe ist das Team des Raums
        if (
          z.geltung === "alle" ||
          irgendwo ||
          objekt?.raumTeamTagId === m.tagId
        ) {
          treffer.push({
            art: "mitgliedschaft",
            geltung: z.geltung,
            gruppe: m.name,
            gruppeId: m.tagId,
          });
        }
      }
    }

    for (const g of this.gruppen) {
      if (g.recht !== recht) continue;
      // Eine Geltung, die der Katalog für dieses Recht nicht kennt, gibt nichts
      if (g.geltung !== "alle" && g.geltung !== "eigene") continue;
      if (!(e.geltungen as readonly string[]).includes(g.geltung)) continue;
      if (g.geltung === "alle" || irgendwo || gehoertZu(e.bezug, g, objekt)) {
        treffer.push({
          art: "gruppenrolle",
          geltung: g.geltung,
          rolle: g.rolle,
          gruppe: g.tagName,
          gruppeId: g.tagId,
        });
      }
    }

    if (recht === "seiten.bearbeiten" || recht === "seiten.veroeffentlichen") {
      const sonder = this.sonder.some(
        (s) =>
          s.objektTyp === "seite" &&
          (irgendwo || s.objektId === objekt?.seiteId),
      );
      if (sonder) treffer.push({ art: "sonderrecht", geltung: "eigene" });
    }
    return abteilungsweit
      ? treffer.filter((h) => h.geltung === "alle")
      : treffer;
  }

  hat(recht: string, objekt?: Objekt) {
    return this.herkuenfte(recht, objekt).length > 0;
  }

  // Nur das, was die Rollen geben (Plattformrollen und Gruppenrollen): die Quellen, die es vor dem Rechtemodell nicht gab. Der Schattenbetrieb setzt sie neben dem alten Weg durch (darf.ts)
  ausRollen(recht: string, objekt?: Objekt) {
    return this.herkuenfte(recht, objekt).some(
      (h) => h.art === "plattformrolle" || h.art === "gruppenrolle",
    );
  }

  // Braucht die Person für dieses Recht den zweiten Faktor? Jedes «erweiterte» und «feste» Recht, ausser die Arbeit der Stufenleitung an der eigenen Stufenseite (Entscheid vom 22.11.2026): Das gilt nur, wenn die Stufenrolle das Recht allein gibt
  braucht2Faktor(recht: string, objekt?: Objekt) {
    if (!istRecht(recht)) return true;
    if (eintragVon(recht).risiko === "normal") return false;
    // Stufenarbeit (#650): ohne zweiten Faktor, wenn eine Stufenrolle oder die Abteilungsleitung das Recht gibt; eine Gruppenrolle oder Plattformrolle allein braucht ihn
    if (OHNE_ZWEITEN_FAKTOR_STUFENARBEIT.has(recht as RechtId)) {
      const h = this.herkuenfte(recht, objekt);
      return !h.some(
        (x) => x.art === "stufenrolle" || x.art === "abteilungsleitung",
      );
    }
    if (!OHNE_ZWEITEN_FAKTOR.has(recht)) return true;
    const h = this.herkuenfte(recht, objekt);
    return !(h.length > 0 && h.every((x) => x.art === "stufenrolle"));
  }
}

// Passt die Gruppenrolle zum Objekt? Je Bezug des Rechts
function gehoertZu(
  bezug: Bezug | undefined,
  g: { tagId: string; anlassId: string | null },
  objekt: Objekt | undefined,
) {
  if (!bezug || !objekt) return false;
  switch (bezug) {
    case "seite":
      return (
        (objekt.tagId != null && objekt.tagId === g.tagId) ||
        (g.anlassId !== null && objekt.anlassId === g.anlassId)
      );
    case "anlass":
      return g.anlassId !== null && objekt.anlassId === g.anlassId;
    case "raum":
      return objekt.raumTeamTagId != null && objekt.raumTeamTagId === g.tagId;
    case "gruppe":
      return objekt.tagId != null && objekt.tagId === g.tagId;
  }
}

export type { RechtId };

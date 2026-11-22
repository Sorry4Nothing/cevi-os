import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { ladeFahrten } from "./fahrten.js";
import { ladeGruppen } from "./gruppen.js";
import { AushangZuGross, MAX_ABSCHNITTE, type Aushang } from "./pdf.js";
import { darf, type LagerZugriff } from "./policy.js";
import type { LagerRecht } from "./rechte-katalog.js";
import { ladeSchichtplan } from "./schichtplan.js";
import { anzeigeNamenLager, ladeZimmer, nurEigenes } from "./zimmer.js";

// Aushänge des Lagers als PDF (#405): Die Daten kommen aus den Lade-Funktionen der Ansichten (Schichtplan, Zimmer, Gruppen, Fahrten) und aus einer Abfrage für das Organigramm; nichts wird gespeichert. Abgewählte Teilnehmende stehen auf keinem Aushang. Hier ist nur der Inhalt, die Seite zeichnet pdf.ts.

export const ARTEN = [
  "schichtplan",
  "zimmerliste",
  "tuerschilder",
  "gruppenlisten",
  "fahrtenliste",
  "organigramm",
] as const;
export type Art = (typeof ARTEN)[number];

// Berechtigung wie die Ansicht, aus der gedruckt wird. Namen von Teilnehmenden druckt nur, wer sie auch als Liste lesen darf (teilnehmer.lesen); das Team sieht wie in der Ansicht nur das eigene Zimmer und die eigene Fahrt
const KINDER: LagerRecht[] = ["einteilung.lesen", "teilnehmer.lesen"];
export const RECHTE: Record<Art, LagerRecht[]> = {
  schichtplan: ["einteilung.lesen"],
  zimmerliste: KINDER,
  tuerschilder: KINDER,
  gruppenlisten: KINDER,
  fahrtenliste: KINDER,
  organigramm: ["ressorts.lesen"],
};
export const darfDrucken = (zugriff: LagerZugriff, art: Art) =>
  RECHTE[art].every((r) => darf(zugriff, r));

const sortiere = (a: string, b: string) => a.localeCompare(b, "de");
const datum = (tag: string) =>
  new Date(`${tag}T12:00:00Z`).toLocaleDateString("de-CH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

// Die abgewählten Teilnehmenden des Lagers (eine Abfrage): Sie fehlen auf jedem Aushang
async function abgewaehlte(db: Pick<Db, "execute">, lagerId: string) {
  const zeilen = await db.execute<{ id: string }>(
    sql`select id from teilnehmer where lager_id = ${lagerId} and abgewaehlt`,
  );
  return new Set(zeilen.map((z) => z.id));
}

async function schichtplan(db: Db, z: LagerZugriff): Promise<Aushang> {
  const [plan, abschnitte] = await Promise.all([
    ladeSchichtplan(db, z.lager.id),
    db.execute<{ id: string; name: string }>(
      sql`select id, name from tagesabschnitt where lager_id = ${z.lager.id}`,
    ),
  ]);
  const abschnittName = new Map(abschnitte.map((a) => [a.id, a.name]));
  const tage = [...new Set(plan.schichten.map((s) => s.datum))].sort();
  return {
    titel: `Schichtplan ${z.lager.titel}`,
    abschnitte: tage.map((tag) => ({
      titel: datum(tag),
      tabelle: {
        spalten: ["Abschnitt", "Dienst", "Personen"],
        zeilen: plan.dienste.map((d) => [
          abschnittName.get(d.tagesabschnittId) ?? "",
          d.name,
          plan.schichten
            .filter((s) => s.dienstId === d.id && s.datum === tag)
            .map((s) => s.name)
            .sort(sortiere)
            .join(", ") || "offen",
        ]),
      },
    })),
  };
}

// Zimmer mit Namen: je Zimmer die Teilnehmenden und das Team, ohne Abgewählte
async function zimmer(db: Db, z: LagerZugriff, art: Art): Promise<Aushang> {
  const [zeilen, namen, weg] = await Promise.all([
    ladeZimmer(
      db,
      z.lager.id,
      z.lager.abteilungId,
      nurEigenes(z) ? { nurPerson: z.personId } : {},
    ),
    anzeigeNamenLager(db, z.lager.id),
    abgewaehlte(db, z.lager.id),
  ]);
  const belegung = zeilen.map((r) => ({
    r,
    leute: r.mitglieder
      .filter((m) => !weg.has(m.id) && namen.has(m.id))
      .map((m) => ({ typ: m.typ, name: namen.get(m.id)! }))
      .sort((a, b) => sortiere(a.name, b.name)),
  }));
  if (art === "tuerschilder") {
    return {
      titel: "Türschilder",
      schilder: true,
      abschnitte: belegung
        .filter((b) => b.leute.some((l) => l.typ === "teilnehmer"))
        .map(({ r, leute }) => ({
          titel: r.name,
          tabelle: {
            spalten: ["Name"],
            zeilen: leute
              .filter((l) => l.typ === "teilnehmer")
              .map((l) => [l.name]),
          },
        })),
    };
  }
  return {
    titel: `Zimmerliste ${z.lager.titel}`,
    abschnitte: belegung.map(({ r, leute }) => ({
      titel: `${r.name} (${r.art === "zelt" ? "Zelt" : "Zimmer"})`,
      hinweis: `${leute.length} von ${r.plaetze} Plätzen`,
      tabelle: {
        spalten: ["Name", "Wer"],
        zeilen: leute.map((l) => [
          l.name,
          l.typ === "teilnehmer" ? "Teilnehmende" : "Team",
        ]),
      },
    })),
  };
}

async function gruppen(db: Db, z: LagerZugriff): Promise<Aushang> {
  const { gruppen } = await ladeGruppen(
    db,
    z.lager.id,
    z.lager.abteilungId,
    false,
  );
  return {
    titel: `Gruppenlisten ${z.lager.titel}`,
    abschnitte: gruppen.map((g) => ({
      titel: g.name,
      tabelle: {
        spalten: ["Name", "Angabe"],
        zeilen: [
          ...g.personen.map((p) => [
            p.name,
            p.rolle === "leitung" ? "Gruppenleitung" : "Team",
          ]),
          ...g.teilnehmer.map((t) => [
            `${t.vorname} ${t.nachname}`,
            t.stufe ?? "",
          ]),
        ],
      },
    })),
  };
}

async function fahrten(db: Db, z: LagerZugriff): Promise<Aushang> {
  const [{ fahrten: liste, naechster }, weg] = await Promise.all([
    ladeFahrten(db, z, { limit: MAX_ABSCHNITTE }),
    abgewaehlte(db, z.lager.id),
  ]);
  if (naechster) throw new AushangZuGross();
  return {
    titel: `Fahrtenliste ${z.lager.titel}`,
    querformat: true,
    abschnitte: liste
      .sort(
        (a, b) =>
          sortiere(a.richtung, b.richtung) ||
          sortiere(
            `${a.datum ?? ""}${a.zeit ?? ""}`,
            `${b.datum ?? ""}${b.zeit ?? ""}`,
          ),
      )
      .map((f) => {
        const mit = f.mitfahrer
          .filter((m) => !m.teilnehmerId || !weg.has(m.teilnehmerId))
          .map((m) => m.name)
          .sort(sortiere);
        const angaben = [
          [f.datum && datum(f.datum), f.zeit].filter(Boolean).join(" "),
          f.von && f.nach ? `${f.von} nach ${f.nach}` : (f.von ?? f.nach),
          f.treffpunkt && `Treffpunkt: ${f.treffpunkt}`,
          f.fahrer?.name && `Fahrer: ${f.fahrer.name}`,
          f.plaetze !== null && `${mit.length} von ${f.plaetze} Plätzen`,
        ].filter(Boolean);
        return {
          titel: `${f.richtung === "hin" ? "Hinfahrt" : "Rückfahrt"}: ${f.name ?? (f.art === "auto" ? "Auto" : "ÖV")}`,
          hinweis: angaben.join(" | "),
          tabelle: { spalten: ["Mitfahrende"], zeilen: mit.map((n) => [n]) },
        };
      }),
  };
}

// Die Ressorts als Baum (Tiefensuche nach Reihenfolge), eingerückt; Leitung und Stellvertretung mit Name und, wenn es ihn gibt, Cevi-Namen
async function organigramm(db: Db, z: LagerZugriff): Promise<Aushang> {
  const zeilen = await db.execute<{
    id: string;
    parentId: string | null;
    kuerzel: string;
    name: string;
    leitung: string | null;
    stv: string | null;
  }>(sql`
    select r.id, r.parent_id as "parentId", r.kuerzel, r.name,
      case when l.id is null then null else l.name || coalesce(' («' || l.cevi_name || '»)', '') end as leitung,
      case when s.id is null then null else s.name || coalesce(' («' || s.cevi_name || '»)', '') end as stv
    from ressort r
    left join "user" l on l.id = r.leitung_person_id
    left join "user" s on s.id = r.stv_person_id
    where r.lager_id = ${z.lager.id}
    order by r.reihenfolge, r.id
    limit ${MAX_ABSCHNITTE + 1}`);
  if (zeilen.length > MAX_ABSCHNITTE) throw new AushangZuGross();
  const kinder = Map.groupBy(zeilen, (r) => r.parentId);
  const reihe: string[][] = [];
  const geh = (parent: string | null, tiefe: number) => {
    for (const r of kinder.get(parent) ?? []) {
      reihe.push([
        `${"- ".repeat(tiefe)}${r.name} (${r.kuerzel})`,
        r.leitung ?? "",
        r.stv ?? "",
      ]);
      geh(r.id, tiefe + 1);
    }
  };
  geh(null, 0);
  return {
    titel: `Organigramm ${z.lager.titel}`,
    abschnitte: [
      {
        titel: "Ressorts",
        tabelle: {
          spalten: ["Ressort", "Leitung", "Stellvertretung"],
          zeilen: reihe,
        },
      },
    ],
  };
}

export async function ladeAushang(
  db: Db,
  zugriff: LagerZugriff,
  art: Art,
): Promise<Aushang> {
  const aushang = await {
    schichtplan: () => schichtplan(db, zugriff),
    zimmerliste: () => zimmer(db, zugriff, art),
    tuerschilder: () => zimmer(db, zugriff, art),
    gruppenlisten: () => gruppen(db, zugriff),
    fahrtenliste: () => fahrten(db, zugriff),
    organigramm: () => organigramm(db, zugriff),
  }[art]();
  // Ohne Inhalt bleibt eine Seite mit dem Hinweis, nie ein leeres PDF
  if (aushang.abschnitte.length === 0) {
    aushang.schilder = false;
    aushang.abschnitte.push({ titel: "Keine Einträge" });
  }
  return aushang;
}

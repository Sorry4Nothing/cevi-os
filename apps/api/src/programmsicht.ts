import { inArray, sql, type SQL } from "drizzle-orm";
import { siehtAlles, type Person } from "./rechte.js";
import { listenBedingung } from "./rechtemodell/personenrechte.js";
import { PROGRAMM_STUFEN_ROH } from "./termine/stufen-sicht.js";

// Wer welches Programm sieht (SQL für die Listen). Steht nicht in rechte.ts: Das Recht «programm.alle_sehen» kommt aus dem Rechtemodell (#650), und rechte.ts darf es nicht importieren (Kreis über plattform.ts)

// Die Abteilungsleitung, der Entwickler (siehtAlles) und SL sehen jedes Programm der Abteilung, auch eines ohne Stufen-Tag: SL brauchen fremde Stufen für Abteilungsanlässe
const alleOderSl = (person: Person) =>
  siehtAlles(person) || person.rollen.some((r) => r.typ === "stufenleitung");

// Spalten bewusst als Text «programm.…»: In der Feldliste eines Selects liesse Drizzle den Tabellennamen weg
export function programmLeitungssicht(person: Person): SQL {
  const eigeneAbteilung = sql`programm.abteilung_id = ${person.abteilungId}`;
  if (alleOderSl(person)) return eigeneAbteilung;
  // Das Recht «Alle Programme sehen» hat, wer es als Rolle trägt (die Abteilungsleitung, den Entwickler und die Stufenleitung kennt alleOderSl schon); sonst die Programme der eigenen Stufen. inArray mit leerer Liste wird zu «false»: Ohne Rolle bleibt alles verborgen
  const alle = listenBedingung(person, "programm.alle_sehen", false);
  return sql`(${eigeneAbteilung} and (${alle} or (exists (select 1 from ${PROGRAMM_STUFEN_ROH} where programm_tag.programm_id = programm.id and ${inArray(
    sql`programm_tag.tag_id`,
    person.rollen.map((r) => r.stufeId),
  )}))))`;
}

// Fail-closed über das Kind: Es zählt nur aktiv und in der eigenen Abteilung
function programmElternsicht(person: Person): SQL {
  return sql`(programm.abteilung_id = ${person.abteilungId} and exists (select 1 from ${PROGRAMM_STUFEN_ROH} inner join kind on kind.stufe_id = programm_tag.tag_id and kind.abteilung_id = ${person.abteilungId} and kind.inaktiv_seit is null inner join kind_zugang on kind_zugang.kind_id = kind.id and kind_zugang.user_id = ${person.id} where programm_tag.programm_id = programm.id))`;
}

// Sichtbar ist ein Programm mit Leitungs- oder Elternsicht; beide schränken auf die Abteilung aus der Sitzung ein
export function programmSichtbar(person: Person): SQL {
  const leitungssicht = programmLeitungssicht(person);
  if (alleOderSl(person)) return leitungssicht;
  return sql`(${leitungssicht} or ${programmElternsicht(person)})`;
}

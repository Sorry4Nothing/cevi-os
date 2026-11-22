import { and, eq, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { programmTag, tag } from "../db/schema.js";

// Stufen eines Programms (#449): die Tags vom Typ «stufe» in programm_tag, die der Kalender-Abgleich aus den Outlook-Kategorien setzt.
// Ersetzt die Sicht programm_stufe_wirksam. Anders als dort heisst «kein Stufen-Tag» nicht «alle Stufen», sondern «keine Stufe»:
// Ein Termin ohne Kategorie ist für Leitende und Eltern unsichtbar und steht auf der Warnliste (#433)
export const programmStufen = new QueryBuilder()
  .select({
    programmId: programmTag.programmId,
    stufeId: programmTag.tagId,
  })
  .from(programmTag)
  .innerJoin(tag, and(eq(tag.id, programmTag.tagId), eq(tag.typ, "stufe")))
  .as("programm_stufen");

// Dasselbe als Text für die rohen Fragmente in rechte.ts: «from» für ein EXISTS, das auf «programm.id» der äusseren Abfrage zeigt
export const PROGRAMM_STUFEN_ROH = sql.raw(
  "programm_tag inner join tag stufen_tag on stufen_tag.id = programm_tag.tag_id and stufen_tag.typ = 'stufe'",
);

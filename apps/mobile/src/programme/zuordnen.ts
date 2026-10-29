import type { Programm } from "../api/programme";

export type Sichtbarkeit = Programm["sichtbarkeit"];

type Person = {
  admin: boolean;
  rollen: readonly { stufeId: string; typ: string }[];
};

// Nur für die Anzeige; über jede Anfrage entscheidet die API
export const siehtEingaenge = (ich: Person) =>
  ich.admin || ich.rollen.some((rolle) => rolle.typ === "stufenleitung");

export const istNichtZugeordnet = (
  programm: Pick<Programm, "sichtbarkeit" | "stufen">,
) => programm.sichtbarkeit === "intern" && programm.stufen.length === 0;

export const istZuPruefen = (programm: Pick<Programm, "status">) =>
  programm.status === "pruefen";

export function anzahlText(anzahl: number) {
  if (anzahl === 0) return "keine Programme";
  return anzahl === 1 ? "1 Programm" : `${anzahl} Programme`;
}

// Eine eigene Kopie der Regeln der API zur Anzeige; die API bleibt massgebend
export function zuordnungsRechte(
  ich: Person,
  programm: Pick<Programm, "stufen">,
) {
  if (ich.admin) {
    return { darf: true, stufe: () => true, sichtbarkeit: true };
  }
  const eigene = new Set(
    ich.rollen.filter((r) => r.typ === "stufenleitung").map((r) => r.stufeId),
  );
  return {
    darf: eigene.size > 0,
    stufe: (stufeId: string) => eigene.has(stufeId),
    // Ändert die Sichtbarkeit, zählt jede zugeordnete Stufe; ohne Stufe sind es keine
    sichtbarkeit:
      eigene.size > 0 && programm.stufen.every((s) => eigene.has(s.id)),
  };
}

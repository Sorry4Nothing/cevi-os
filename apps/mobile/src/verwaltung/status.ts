import type { PersonenAntwort } from "../api/personen";

// T.M.JJJJ in Ortszeit, von Hand: toLocaleDateString hinge an der Gerätesprache
function datum(iso: string) {
  const tag = new Date(iso);
  return `${tag.getDate()}.${tag.getMonth() + 1}.${tag.getFullYear()}`;
}

export function statusText(
  person: Pick<
    PersonenAntwort["personen"][number],
    "deaktiviert" | "mussPasswortAendern" | "startpasswortGueltigBis"
  >,
) {
  const status = person.mussPasswortAendern
    ? person.startpasswortGueltigBis === null
      ? "Startpasswort offen"
      : `Startpasswort offen bis ${datum(person.startpasswortGueltigBis)}`
    : "angemeldet";
  return person.deaktiviert ? `deaktiviert, ${status}` : status;
}

// Warnungen für den Startbildschirm der Verwaltung; aktiv heisst nicht deaktiviert
export function warnungen(daten: Pick<PersonenAntwort, "personen" | "stufen">) {
  const aktive = daten.personen.filter((person) => !person.deaktiviert);
  const liste: string[] = [];
  if (aktive.filter((person) => person.admin).length < 2) {
    liste.push("Weniger als zwei Admins: Bitte einen zweiten Admin bestimmen.");
  }
  for (const stufe of daten.stufen) {
    const sl = aktive.filter((person) =>
      person.rollen.some(
        (rolle) => rolle.stufeId === stufe.id && rolle.typ === "stufenleitung",
      ),
    );
    if (sl.length < 2) {
      liste.push(
        `${stufe.name}: weniger als zwei Personen in der Stufenleitung.`,
      );
    }
  }
  return liste;
}

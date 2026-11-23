import { darfBearbeiten } from "../bearbeiten.js";
import type { Db } from "../db/client.js";
import { hatPlattformRecht, istEntwickler } from "../plattform.js";
import { hatRolle, type Person } from "../rechte.js";
import { darfBelegungSehen } from "../termine/raum.js";
import { darfEntscheiden } from "../termine/raum-buchung.js";
import { darfVorschlagen } from "../termine/vorschlag.js";
import { istAltesPlattformRecht, istRecht, type RechtId } from "./katalog.js";
import { eintragVon } from "./katalog.js";
import type { Objekt } from "./satz.js";

// Die Hülle um die alten Funktionen (#643): Für jedes Recht des Katalogs die Frage, wie der Code sie vor dem Rechtemodell beantwortete. Im Schattenbetrieb setzt dieser Weg durch (darf.ts), bis die Route umgestellt und die alte Funktion entfernt ist (docs/rechte-umstellung.md).
// Die Antwort gilt dem Recht, nicht dem zweiten Faktor: Den prüft verlange() für sich. Darum fragt die Hülle die alten Funktionen so, als hätte die Person ihn.

export type Altweg = (
  db: Pick<Db, "select">,
  person: Person,
  objekt: Objekt,
) => Promise<boolean>;

const nurAbteilungsleitung: Altweg = async (_db, person) => person.admin;

// Anwesenheit, Teilnahmen und Kontakte einer Stufe (#650): die Abteilungsleitung und die Leitung der Stufe (die Stufenleitung erfüllt jede Prüfung auf Leitung, hatRolle). Ohne Stufe: irgendeine Stufenrolle
const abteilungsleitungOderLeitung: Altweg = async (_db, person, objekt) => {
  if (person.admin) return true;
  // Die Frage gilt der ganzen Abteilung: Eine Stufenrolle gibt das nie
  if (objekt.abteilungsweit) return false;
  const stufeId = objekt.stufeId ?? objekt.tagId;
  return stufeId
    ? hatRolle(person, stufeId, "leitung")
    : person.rollen.length > 0;
};

// Das Plattformrecht gleichen Namens: Entwickler, Abteilungsleitung und Plattformrollen, wie hatPlattformRecht sie kennt
const plattform =
  (recht: Parameters<typeof hatPlattformRecht>[2]): Altweg =>
  (db, person) =>
    hatPlattformRecht(db, person, recht);

export const ALTWEG: Partial<Record<RechtId, Altweg>> = {
  "seiten.bearbeiten": (db, person, objekt) =>
    objekt.seiteId
      ? darfBearbeiten(db, person, "seite", objekt.seiteId, {
          stufeId: objekt.stufeId ?? undefined,
          tagId: objekt.tagId ?? undefined,
        })
      : hatPlattformRecht(db, person, "seiten.bearbeiten"),
  "seiten.veroeffentlichen": (db, person, objekt) =>
    objekt.seiteId
      ? darfBearbeiten(db, person, "seite", objekt.seiteId, {
          stufeId: objekt.stufeId ?? undefined,
          tagId: objekt.tagId ?? undefined,
          veroeffentlichen: true,
        })
      : hatPlattformRecht(db, person, "seiten.veroeffentlichen"),
  "seiten.anlegen_loeschen": plattform("seiten.anlegen_loeschen"),
  "medien.verwalten": plattform("medien.verwalten"),
  "weiterleitungen.verwalten": plattform("weiterleitungen.verwalten"),
  "vorlagen.nutzen": plattform("vorlagen.nutzen"),
  "wartungsmodus.website": plattform("wartungsmodus.website"),
  // darfVorschlagen und darfBelegungSehen verlangen ein Db mit mehr als select (sie sind so typisiert); die Abfragen dort sind select
  "vorschlag.einreichen": (db, person) => darfVorschlagen(db as Db, person),
  "raum.belegung": (db, person) => darfBelegungSehen(db as Db, person),
  "raum.anfrage_entscheiden": (db, person, objekt) =>
    darfEntscheiden(
      db as Db,
      { id: person.id, admin: person.admin, zweiterFaktor: true },
      objekt.raumTeamTagId ?? null,
    ),
  // Jedes Programm der Abteilung sieht die Abteilungsleitung und, wer irgendwo Stufenleitung ist (rechte.ts, adminOderSl)
  "programm.alle_sehen": async (_db, person) =>
    person.admin || person.rollen.some((r) => r.typ === "stufenleitung"),
  "anwesenheit.fuehren": abteilungsleitungOderLeitung,
  "stufe.einblick": abteilungsleitungOderLeitung,
  "plattform.sperren": async (db, person) =>
    person.admin || (await istEntwickler(db, person)),
  "protokoll.lesen": (db, person) => istEntwickler(db, person),
  "entwickler.vergeben": async () => false,
};

// Alles ohne eigene Hülle hing bisher an «person.admin» (die rund 100 Stellen aus docs/rechte-umstellung.md); strukturelle Rechte hängen an der Beziehung, die die Route prüft
export async function altweg(
  db: Pick<Db, "select">,
  person: Person,
  recht: string,
  objekt: Objekt,
): Promise<boolean> {
  if (!istRecht(recht)) return false;
  if (eintragVon(recht).art === "struktur") return true;
  return (ALTWEG[recht] ?? nurAbteilungsleitung)(db, person, objekt);
}

// Für den Test: Die Plattformrechte des älteren Katalogs haben alle eine Hülle
export const HAT_HUELLE = (recht: string) =>
  istAltesPlattformRecht(recht) || recht in ALTWEG;

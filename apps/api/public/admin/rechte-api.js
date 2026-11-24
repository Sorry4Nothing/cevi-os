import { anfrage } from "./api.js";
import {
  abteilungsleitungRolle,
  globaleRolle,
  gruppenRolle,
} from "./rechte-modell.js";

// Aufrufe der Matrix-API (#643) und der Hilfsrouten für «Rollen und Rechte» (#651). Der Server prüft jede Anfrage: nur Abteilungsleitung mit zweitem Faktor, fremde Abteilung ist 404, Versionen gegen gleichzeitiges Ändern, Eskalation (wer vergibt, hat).

export const BASIS = "/api/v1/admin/rechte";

// Die Daten, die jede Ansicht braucht: Katalog, Gruppen (mit Zahlen), globale Rollen (die Abteilungsleitung zuerst), Personen. Wer «rechte.verwalten» nicht hat (nicht der Entwickler, er hat jedes Recht), sieht keine Personen und ändert nur die Rechte der Abteilungsleitung: Er bekommt die übrigen Rollen schreibgeschützt und keine Personenliste (#663)
export async function ladeGrund() {
  const katalog = await anfrage("GET", `${BASIS}/katalog`);
  const verwaltet = katalog.ich?.rechteVerwalten === true;
  const [gruppen, globale, personen, stufen] = await Promise.all([
    anfrage("GET", `${BASIS}/gruppen`),
    anfrage("GET", `${BASIS}/rollen`),
    verwaltet ? anfrage("GET", "/api/v1/admin/personen") : { personen: [] },
    // Die Stufen geben der Personenliste die Rolle im Klartext; ohne sie steht die Rolle ohne Stufe da
    anfrage("GET", "/api/v1/stufen").catch(() => ({ stufen: [] })),
  ]);
  return {
    stufen: stufen.stufen,
    katalog,
    gruppen: gruppen.gruppen,
    globale: [
      abteilungsleitungRolle(globale.abteilungsleitung),
      ...globale.rollen.map((r) => globaleRolle(r, !verwaltet)),
    ],
    personen: personen.personen,
  };
}

// Eine Gruppe mit ihren Rollen (samt Rechten und Mitgliedern) und den Mitgliedern der Gruppe (Rolle als Freitext), dazu bei Anlass-Gruppen der Anlass
export async function ladeGruppe(tagId) {
  const [rollen, tag] = await Promise.all([
    anfrage("GET", `${BASIS}/gruppen/${tagId}/rollen`),
    anfrage("GET", `/api/v1/admin/tags/${tagId}`),
  ]);
  return {
    gruppe: rollen.gruppe,
    rollen: rollen.rollen.map((r) => gruppenRolle(r, rollen.gruppe)),
    mitglieder: tag.personen,
    anlass: tag.anlass ?? null,
  };
}

export const legeRolleAn = (tagId, felder) =>
  anfrage("POST", `${BASIS}/gruppen/${tagId}/rollen`, felder);
export const aendereRolle = (rolle, felder) =>
  rolle.abteilungsleitung
    ? anfrage("PATCH", `${BASIS}/abteilungsleitung`, felder)
    : rolle.art === "global"
      ? anfrage("PATCH", `${BASIS}/rollen/${rolle.id}`, felder)
      : anfrage(
          "PATCH",
          `${BASIS}/gruppen/${rolle.tagId}/rollen/${rolle.id}`,
          felder,
        );
export const loescheRolle = (rolle) =>
  rolle.art === "global"
    ? anfrage("DELETE", `${BASIS}/rollen/${rolle.id}?version=${rolle.version}`)
    : anfrage(
        "DELETE",
        `${BASIS}/gruppen/${rolle.tagId}/rollen/${rolle.id}?version=${rolle.version}`,
      );
export const legeGlobaleRolleAn = (felder) =>
  anfrage("POST", `${BASIS}/rollen`, felder);

// Vorschau «wer ist betroffen»: nur Zahlen, nichts wird geschrieben
export const vorschau = (rolle, rechte) =>
  anfrage("POST", `${BASIS}/gruppen/${rolle.tagId}/rollen/vorschau`, {
    rolleId: rolle.id,
    rechte,
  });

// Eine Person in einer Gruppe einer Rolle zuordnen (null entzieht die Rolle). Ist sie noch nicht Mitglied der Gruppe, nimmt die Gruppen-Route sie zuerst auf
export async function ordneZu(tagId, userId, rolleId, { mitglied }) {
  if (!mitglied && rolleId) {
    await anfrage("PUT", `/api/v1/admin/tags/${tagId}/personen/${userId}`, {});
  }
  return anfrage("PUT", `${BASIS}/gruppen/${tagId}/personen/${userId}/rolle`, {
    rolleId,
  });
}

// Plattformrollen: Personen
export const vergebeGlobaleRolle = (rolleId, userId) =>
  anfrage(
    "PUT",
    `/api/v1/admin/plattform/rollen/${rolleId}/personen/${userId}`,
  );
export const entzieheGlobaleRolle = (rolleId, userId) =>
  anfrage(
    "DELETE",
    `/api/v1/admin/plattform/rollen/${rolleId}/personen/${userId}`,
  );

export const ladePerson = (userId) =>
  anfrage("GET", `${BASIS}/personen/${userId}`);
export const ladeVerlauf = (nach) =>
  anfrage("GET", `${BASIS}/aenderungen?limit=30${nach ? `&nach=${nach}` : ""}`);

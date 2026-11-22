import { HTTPException } from "hono/http-exception";
import type { Person } from "../rechte.js";

// Wer Anlässe anlegt und pflegt (Recht «anlass.verwalten», Annahme A10, vom Nutzer noch zu bestätigen): nur die Abteilungsleitung, also ein Admin mit zweitem Faktor
// (den zweiten Faktor verlangt schon der Pfad /api/v1/admin/*). Alle Routen der Anlass-Verwaltung prüfen hier und nirgends sonst; kommen Rollen dazu (#423), ändert sich nur diese Funktion.
export const darfAnlaesseVerwalten = (person: Pick<Person, "admin">) =>
  person.admin;

// Erst das Objekt laden (fremd = 404), dann diese Prüfung (403)
export function pruefeAnlassRecht(person: Pick<Person, "admin">) {
  if (!darfAnlaesseVerwalten(person)) throw new HTTPException(403);
}

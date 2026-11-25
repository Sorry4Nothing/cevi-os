import type { TermineMatrix, TermineModulDatei } from "../matrix.js";
import { legeProgrammAn } from "../../hilfen/programme.js";

// Matrix-Zeilen von TA2 (#433): Warnliste «Termine ohne Kategorie». Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Nur die Abteilungsleitung mit zweitem Faktor (und die der fremden Abteilung für die eigenen Daten) bekommt 200; die Route hat kein Objekt im Pfad, darum ist jede andere Rolle 403, auch fremde Eltern.
export const VORBEREITUNG: NonNullable<
  TermineModulDatei["VORBEREITUNG"]
> = async (welt) => {
  // Ein kommender Termin ohne Tag: steht auf der Warnliste.
  const termin = await legeProgrammAn(welt.db, {
    abteilungId: welt.testabteilungId,
    titel: "Matrix-Termin ohne Kategorie",
    beginn: new Date("2099-03-06T13:00:00Z"),
  });
  return { terminId: termin.id };
};

export const ZEILEN: TermineMatrix = {
  "GET /api/v1/admin/termine/warnungen": {
    erwartet: {
      abteilungsleitung: 200,
      adminOhneFaktor: 403,
      stufenleitungA: 403,
      stufenleitungB: 403,
      leitungA: 403,
      leitungB: 403,
      leitungAElternB: 403,
      elternA: 403,
      elternB: 403,
      passwortPflicht: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      fremdeAbteilungsleitung: 200,
      fremdeEltern: 403,
    },
  },
};

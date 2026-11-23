// Welcher Weg Rechte durchsetzt (#643). Per Umgebung RECHTE_MODELL (konfiguration.ts), gesetzt von server.ts:
//   alt       nur die alten Funktionen. Die Rollen der Gruppen wirken nicht. Der Notschalter
//   schatten  der alte Weg und, zusätzlich, was Plattform- und Gruppenrollen geben; verglichen wird mit dem neuen Weg, jede Abweichung steht im Protokoll (Vorgabe)
//   neu       nur der neue Weg (RechteSatz); die alten Funktionen entscheiden nichts mehr
export const MODI = ["alt", "schatten", "neu"] as const;
export type Modus = (typeof MODI)[number];

let aktuell: Modus = "schatten";

export const rechteModus = () => aktuell;

export function setzeRechteModus(modus: Modus) {
  aktuell = modus;
}

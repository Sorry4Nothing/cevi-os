import type { TerminePushTyp } from "../push.js";

// Register der Pushes der Termine (Epic #430, Gerüst #431). Jedes Folge-Issue nutzt hier nur seinen Eintrag und ergänzt nichts in push.ts:
// - termin_vorschlag: neuer Vorschlag an die Abteilungsleitung (TD1, #439)
// - termin_entscheid: Entscheid an die vorschlagende Person (TD2, #440)
// - raum_anfrage: neue Raumanfrage an das Team des Raums (TG2, #447)
// - raum_entscheid: Entscheid an die anfragende Person (TG2)
// Der Titel ist fest und nennt nie eine Person. Der Text darunter ist höchstens der Vorschlagstitel (bei Raumanfragen der Raumname), data.id die ID des Vorschlags oder der Anfrage. Kanal je Typ: PUSH_KANAL in push.ts («termine», «raeume»)
export const TERMINE_PUSH_ARTEN = {
  termin_vorschlag: { titel: "Neuer Terminvorschlag" },
  termin_entscheid: { titel: "Entscheid zu deinem Terminvorschlag" },
  raum_anfrage: { titel: "Neue Raumanfrage" },
  raum_entscheid: { titel: "Entscheid zu deiner Raumanfrage" },
} as const satisfies Record<TerminePushTyp, { titel: string }>;

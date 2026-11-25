import { z } from "zod";

// Freiwillige Angabe zum Geschlecht einer Person mit Konto (#817): w, m oder d (andere); null heisst keine Angabe.
// Sie bestimmt nur die Form des Rollennamens in der Verwaltung («Stufenleiterin», «Stufenleiter», sonst «Stufenleitung»)
export const GESCHLECHTER = ["w", "m", "d"] as const;
export const geschlechtFeld = z.enum(GESCHLECHTER);
export type Geschlecht = (typeof GESCHLECHTER)[number];

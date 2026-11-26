import { z } from "zod";

// Freiwillige Angabe zum Geschlecht einer Person mit Konto (#817): w oder m (seit #849 ohne d); null heisst keine Angabe.
// Sie bestimmt nur die Form des Rollennamens in der Verwaltung («Stufenleiterin», «Stufenleiter», sonst «Stufenleitung»)
export const GESCHLECHTER = ["w", "m"] as const;
export const geschlechtFeld = z.enum(GESCHLECHTER);
export type Geschlecht = (typeof GESCHLECHTER)[number];

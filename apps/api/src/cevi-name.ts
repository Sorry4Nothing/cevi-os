import { z } from "zod";

// Freiwilliger Cevi-Name (Spitzname) von Person und Kind; leer oder nur Leerraum heisst nicht gesetzt
export const ceviNameFeld = z
  .string()
  .trim()
  .max(50)
  .transform((wert) => wert || null);

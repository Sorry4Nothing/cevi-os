import { HTTPException } from "hono/http-exception";
import type { Db } from "../db/client.js";
import type { Person } from "../rechte.js";
import { ladeRechteSatz } from "./satz.js";
import type { Zuteilung } from "./standard.js";

// Eskalationsschutz (#643, wie pruefeEigeneRechte in routes/admin/plattform-rollen.ts): Wer Rechte vergibt, hat sie selbst, und zwar mindestens in der Geltung, die er vergibt: Wer nur «eigene» hat, vergibt nie «alle». Die Abteilungsleitung hat jedes Recht abteilungsweit; die Prüfung steht trotzdem hier, damit eine spätere Rolle mit dem Recht «Rechte vergeben» nie mehr vergeben kann, als sie hat. Fehlt eines: 403
export async function pruefeEigeneRechte(
  db: Pick<Db, "execute">,
  person: Person,
  verlangt: readonly Zuteilung[],
) {
  const satz = await ladeRechteSatz(db, person);
  for (const z of verlangt) {
    const hat = satz.herkuenfte(z.recht);
    const reicht =
      z.geltung === "alle"
        ? hat.some((h) => h.geltung === "alle")
        : hat.length > 0;
    if (!reicht) throw new HTTPException(403);
  }
}

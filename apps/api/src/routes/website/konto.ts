import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bildUrl } from "../../bild.js";
import type { Db } from "../../db/client.js";
import { profilbild, user } from "../../db/schema.js";
import type { Person } from "../../rechte.js";
import { anzeigename } from "../../website/personen.js";
import { ladeVerwaltungZugang } from "../redaktion/ich.js";

// Der Kopf der Website (#669) fragt nach dem Laden, wer angemeldet ist: Die Seiten sind für alle gleich und tragen nichts über eine Person.
// Die Antwort hat nur, was das Konto-Menü zeigt: den Anzeigenamen (Cevi-Name, sonst Vorname, wie sonst auf der Website; nie Benutzername, Telefon oder E-Mail), den Pfad des eigenen Profilbilds und ob die Person die Verwaltung öffnen darf.
// «verwaltung» folgt derselben Regel wie die Verwaltung beim Start (admin.js): die Abteilungsleitung oder ein Bereich, die Belegung der Räume oder ein Recht bei Terminen, Räumen und Anlässen. Nur Anzeige; jede Route der Verwaltung prüft selbst.
export function erstelleKontoRoute({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>().get(
    "/konto",
    async (c) => {
      const person = c.get("person");
      const [profil] = await db
        .select({ name: user.name, ceviName: user.ceviName, bildUrl })
        .from(user)
        .leftJoin(profilbild, eq(profilbild.userId, user.id))
        .where(
          and(eq(user.id, person.id), eq(user.abteilungId, person.abteilungId)),
        );
      // Die Sitzung löscht die Datenbank mit der Person (CASCADE); ohne Zeile ist sie nicht mehr gültig
      if (!profil) throw new HTTPException(401);
      const verwaltung = person.admin || (await hatVerwaltung(db, person));
      c.header("Cache-Control", "private, no-store");
      c.header("Vary", "Cookie");
      return c.json({
        name: anzeigename(profil.ceviName, profil.name),
        bildUrl: profil.bildUrl,
        verwaltung,
      });
    },
  );
}

async function hatVerwaltung(db: Db, person: Person) {
  const z = await ladeVerwaltungZugang(db, person);
  return (
    z.bereiche.length > 0 ||
    z.belegung === true ||
    Object.values(z.termine).some((v) => v === true)
  );
}

import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { anzeigeNamenLager, nurEigenes } from "../../lager/zimmer.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const MAX = 500;

// Mitglieder des Lagers ohne Adminrecht (#520), für Namen und Auswahllisten der Apps (Schichtplan, Diensttausch, Gruppen, Einkäufer, Tageschef). Pro Person nur: ID, Anzeigename, Rolle und die Kürzel ihrer Ressorts (zugeordnet, Leitung oder Stellvertretung); nie Cevi-Name ohne Recht (Regel von anzeigeNamenLager), keine Telefonnummer, keine E-Mail.
// Wer sieht wen: Recht einteilung.lesen wie bei Zimmern, Gruppen und Schichtplan. Rollen, die dort alles sehen (Lagerleitung, Leitung, Lesen), sehen alle aktiven Mitglieder. Das Team ohne einteilung.bearbeiten sieht dort nur das Eigene (nurEigenes); hier sieht es darum nur sich selbst und die Mitglieder, die es heute schon in den Listen sieht: im selben Zimmer, in einer Gruppe oder im Schichtplan. Zwei Abfragen, unabhängig von der Zahl der Mitglieder
export function erstelleMitgliederRouten({ db }: { db: Db }) {
  return new Hono<LagerEnv>().get(
    "/:id/mitglieder",
    lagerZugriff(db, { recht: "einteilung.lesen" }),
    eingabe("param", lagerPfad),
    async (c) => {
      const zugriff = c.get("lager");
      const lagerId = zugriff.lager.id;
      const eng = nurEigenes(zugriff);
      const [zeilen, namen] = await Promise.all([
        db.execute<{ id: string; rolle: string; ressorts: string[] }>(sql`
          select m.person_id as id, m.rolle,
            coalesce((
              select array_agg(distinct r.kuerzel order by r.kuerzel) from ressort r
              where r.lager_id = m.lager_id
                and (r.id = m.ressort_id or r.leitung_person_id = m.person_id or r.stv_person_id = m.person_id)
            ), '{}') as ressorts
          from lager_mitglied m
          join "user" u on u.id = m.person_id and u.abteilung_id = ${zugriff.lager.abteilungId}
            and u.deaktiviert_am is null and coalesce(u.banned, false) = false
          where m.lager_id = ${lagerId}
          ${
            eng
              ? sql`and (m.person_id = ${zugriff.personId}
                  or exists (select 1 from schicht s where s.lager_id = m.lager_id and s.person_id = m.person_id)
                  or exists (select 1 from gruppe_zuordnung g where g.lager_id = m.lager_id and g.person_id = m.person_id)
                  or exists (select 1 from zimmer_zuordnung z where z.lager_id = m.lager_id and z.person_id = m.person_id
                    and z.zimmer_id in (select e.zimmer_id from zimmer_zuordnung e where e.lager_id = m.lager_id and e.person_id = ${zugriff.personId})))`
              : sql``
          }
          limit ${MAX}`),
        anzeigeNamenLager(db, lagerId, darf(zugriff, "teilnehmer.bearbeiten")),
      ]);
      return c.json({
        mitglieder: zeilen
          .flatMap((z) => {
            const name = namen.get(z.id);
            return name
              ? [{ personId: z.id, name, rolle: z.rolle, ressorts: z.ressorts }]
              : [];
          })
          .sort((a, b) => a.name.localeCompare(b.name, "de")),
      });
    },
  );
}

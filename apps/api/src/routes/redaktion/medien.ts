import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";
import {
  darfSeitenVerwalten,
  hatRedaktionszugang,
} from "../../website/seiten.js";
import {
  aendernSchema,
  hochladenSchema,
  listeSchema,
  medienUploadLimit,
  pfadSchema,
  type MedienHandler,
} from "../medien.js";

// Medien für Redaktion und Stufenleitung (#353): dieselben Handler wie unter /api/v1/admin/medien, nur der Zugang ist ein anderer.
// Die Medien einer Abteilung sind eine gemeinsame Bibliothek: Wer Zugang hat, lädt hoch und sieht die Liste.
// Beschreiben darf, wer das Medium hochgeladen hat, und wer Seiten verwaltet; löschen nur, wer Seiten verwaltet (wie bei den Seiten)
export function erstelleRedaktionMedienRouten({
  db,
  handler,
}: {
  db: Db;
  handler: MedienHandler;
}) {
  // Für Hochladen und Liste, vor jeder Prüfung von Eingabe und Speicher. Die Routen mit ID laden erst das Medium (404 für fremde Abteilungen) und fragen dann das Recht
  const zugang = createMiddleware<{ Variables: { person: Person } }>(
    async (c, next) => {
      if (!(await hatRedaktionszugang(db, c.get("person")))) {
        throw new HTTPException(403);
      }
      await next();
    },
  );

  return new Hono<{ Variables: { person: Person } }>()
    .post(
      "/",
      zugang,
      eingabe("query", hochladenSchema),
      medienUploadLimit,
      (c) => handler.hochladen(c, c.req.valid("query")),
    )
    .get("/", zugang, eingabe("query", listeSchema), (c) =>
      handler.liste(c, c.req.valid("query")),
    )
    .patch(
      "/:id",
      eingabe("param", pfadSchema),
      eingabe("json", aendernSchema),
      (c) =>
        handler.aendern(
          c,
          c.req.valid("param").id,
          c.req.valid("json"),
          async (person, m) =>
            (await hatRedaktionszugang(db, person)) &&
            (m.hochgeladenVon === person.id ||
              (await darfSeitenVerwalten(db, person))),
        ),
    )
    .delete("/:id", eingabe("param", pfadSchema), (c) =>
      handler.loeschen(c, c.req.valid("param").id, (person) =>
        darfSeitenVerwalten(db, person),
      ),
    );
}

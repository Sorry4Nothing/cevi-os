import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../../db/client.js";
import { seite, seiteVersion } from "../../db/schema.js";
import type { Person } from "../../rechte.js";
import {
  ladeGruppen,
  sichtbarFuer,
  sichtbarkeitAusSpalten,
} from "../../sichtbarkeit.js";
import { ladeDaten } from "../../website/abgleich.js";
import { ladeDynamischeBausteine } from "../../website/dynamisch-daten.js";
import { ladeStufenfaktenGemerkt } from "../../website/stufenfakten.js";
import type { Baustein } from "../../website/bausteine.js";
import { pruefeDokument } from "../../website/dokument.js";
import {
  istOeffentlich,
  rendereGeschuetzte,
  STARTSEITE,
} from "../../website/rendern.js";
import {
  adresseSchema,
  adressenVon,
  MAX_TIEFE,
  RESERVIERTE_ADRESSEN,
  type Knoten,
} from "../../website/seiten.js";

// «/» oder «/a/b»: nur Adressstücke wie die Seiten (a-z, 0-9, «-»), kein Schrägstrich am Ende, keine Anfrage, kein Anker
function adressenAusPfad(pfad: string | undefined): string[] | null {
  if (pfad === undefined || pfad.length > 400 || !pfad.startsWith("/")) {
    return null;
  }
  if (pfad === "/") return [STARTSEITE];
  const stuecke = pfad.slice(1).split("/");
  if (
    stuecke.length > MAX_TIEFE ||
    !stuecke.every((s) => adresseSchema.safeParse(s).success) ||
    RESERVIERTE_ADRESSEN.includes(stuecke[0]!)
  ) {
    return null;
  }
  return stuecke;
}

// Geschützte Bausteine einer veröffentlichten Seite für die angemeldete Person (#354). Die Sitzung ist Pflicht (401 aus personAusSitzung, neutraler Body).
// Alles, was nicht passt, antwortet gleich: 404 ohne Hinweis. Das gilt für eine unbekannte oder nicht veröffentlichte Seite, eine Seite einer anderen Abteilung und eine Seite, die die Person nicht sehen darf.
// Die Antwort enthält nur Knoten (Elemente und Texte), nie HTML: Das Skript baut daraus DOM-Knoten.
export function erstelleInhaltRoute({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>().get(
    "/inhalt",
    async (c) => {
      const person = c.get("person");
      const adressen = adressenAusPfad(c.req.query("pfad"));
      if (adressen === null) throw new HTTPException(404);

      // Nur Seiten der eigenen Abteilung
      const zeilen = await db
        .select({
          id: seite.id,
          elternId: seite.elternId,
          adresse: seite.adresse,
          reihenfolge: seite.reihenfolge,
          tagId: seite.tagId,
          sichtbarkeit: seite.sichtbarkeit,
          sichtbarkeitTags: seite.sichtbarkeitTags,
          sichtbarkeitRollen: seite.sichtbarkeitRollen,
          veroeffentlichteVersionId: seite.veroeffentlichteVersionId,
        })
        .from(seite)
        .where(eq(seite.abteilungId, person.abteilungId));
      const knoten: Knoten = new Map(zeilen.map((z) => [z.id, z]));
      const gesucht = adressen.join("/");
      const zeile = zeilen.find(
        (z) => adressenVon(knoten, z.id).join("/") === gesucht,
      );
      if (!zeile?.veroeffentlichteVersionId) throw new HTTPException(404);

      const sicht = {
        ...person,
        gruppen: await ladeGruppen(db, person),
      };
      const abteilungId = person.abteilungId;
      if (
        !sichtbarFuer(sicht, {
          abteilungId,
          sichtbarkeit: sichtbarkeitAusSpalten(zeile),
        })
      ) {
        throw new HTTPException(404);
      }

      const [version] = await db
        .select({ inhalt: seiteVersion.inhalt })
        .from(seiteVersion)
        .where(eq(seiteVersion.id, zeile.veroeffentlichteVersionId));
      const pruefung = version ? pruefeDokument(version.inhalt) : null;
      if (!pruefung?.ok) throw new HTTPException(404);
      const dokument = pruefung.dokument;

      // Eine öffentliche Seite liefert nur ihre geschützten Bausteine; eine geschützte Seite (die Person darf sie sehen) alle, die nicht eine engere eigene Sichtbarkeit haben, die die Person nicht erfüllt
      const seiteOeffentlich = zeile.sichtbarkeit === "oeffentlich";
      const erlaubt = (b: Baustein) =>
        (seiteOeffentlich ? !istOeffentlich(b) : true) &&
        (b.sichtbarkeit === "erbt" ||
          sichtbarFuer(sicht, { abteilungId, sichtbarkeit: b.sichtbarkeit }));
      const sichtbare = dokument.bausteine.filter(erlaubt);

      // Daten nur für die Bausteine, die geliefert werden
      const geladen = await ladeDaten(
        db,
        abteilungId,
        [{ ...dokument, bausteine: sichtbare }],
        false,
      );
      // Samstagsangaben der Stufen (#355): nur wenn ein solcher Baustein dabei ist, und aus dem Zwischenspeicher (ein Abruf je Seite und fünf Minuten)
      const fakten = sichtbare.some((b) => b.typ === "stufenfakten")
        ? await ladeStufenfaktenGemerkt(db, abteilungId, zeile.id)
        : undefined;
      // Bausteine mit Daten aus Cevi OS (#740): öffentliche Daten, nur für die gelieferten Bausteine
      const { dynamisch } = await ladeDynamischeBausteine(
        db,
        abteilungId,
        [zeile.id],
        new Map([[zeile.id, { ...dokument, bausteine: sichtbare }]]),
      );
      const daten = {
        ...geladen,
        ...(fakten && { stufenfakten: new Map([[zeile.id, fakten]]) }),
        ...(dynamisch && { dynamisch }),
      };
      const bausteine = rendereGeschuetzte(dokument, zeile.id, daten, (b) =>
        sichtbare.includes(b),
      );

      // Personenbezogen und nur für diese Sitzung: nie in einem gemeinsamen Zwischenspeicher
      c.header("Cache-Control", "private, no-store");
      c.header("Vary", "Cookie");
      return c.json({ titel: dokument.titel, bausteine });
    },
  );
}

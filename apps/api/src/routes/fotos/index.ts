import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import {
  bildParam,
  kennungParam,
  ladeAlbumZeilen,
  ladeEinstellung,
  ladeSichtbaresAlbum,
} from "../../fotos/daten.js";
import { erstelleBegrenzung } from "../../fotos/begrenzung.js";
import {
  GROESSEN,
  QuellFehler,
  istGrosseStufe,
  type FotoQuelle,
  type Groesse,
  type QuellBild,
} from "../../fotos/quelle.js";
import {
  erstelleZwischenspeicher,
  type Zwischenspeicher,
} from "../../fotos/zwischenspeicher.js";
import { log } from "../../log.js";
import type { Person } from "../../rechte.js";
import { erstelleAdminFotoRouten } from "./admin.js";

// Fotos aus Flickr (#690). app.ts hängt die öffentlichen Routen bei /api/v1/fotos und die der Verwaltung bei /api/v1/admin/fotos ein, beide hinter der Sitzung.
// Zugang: jede angemeldete Person der Abteilung ausser dem Konto eines Kindes (es sieht nur sein eigenes Kind, Bedrohungsmodell 56 und 64). Ohne Sitzung 401 (app.ts). Der Browser lädt Bilder nur von hier, nie von Flickr: Der Server holt sie und reicht sie durch.
// Was die Person sieht, bestimmt die Abteilung (Verwaltung «Fotos»): nur Alben, die sie sichtbar gestellt hat. Eine Kennung, die nicht zu einem sichtbaren Album gehört, ist 404; eine Adresse oder ein Host kommt von nirgends als aus dem Code.
export type FotoEnv = { Variables: { person: Person } };

// Listen sind selten, Bilder kommen zu Dutzenden mit einer Seite: Die Grenzen je Konto und Minute gehen darauf ein. Grosse Dateien (ab 3072 und das Original, mehrere MB) haben eine eigene, tiefere Grenze (#867): Wer in der Grossansicht blättert, holt eine je Bild und eine im Voraus
const LISTEN_PRO_MINUTE = 120;
const BILDER_PRO_MINUTE = 1500;
const GROSSE_PRO_MINUTE = 120;

// Die Namen von vor #867; eine Seite, die noch im Browser offen ist, fragt so
const ALT: Record<string, Groesse> = {
  klein: "320",
  mittel: "640",
  gross: "1024",
};
const groesse = z
  .enum([...GROESSEN, "klein", "mittel", "gross"])
  .default("640")
  .transform((g): Groesse => ALT[g] ?? (g as Groesse));
const groesseQuery = z.strictObject({ groesse });
// «herunterladen=1»: dieselbe Datei als Anhang mit einem Dateinamen aus Album, Nummer und Stufe
const bildQuery = z.strictObject({
  groesse,
  herunterladen: z.literal("1").optional(),
});

// «Sommerlager 2026» wird «Sommerlager-2026»: nur Buchstaben und Ziffern ohne Akzent, damit der Name in jedem System gilt
export const dateiName = (
  titel: string,
  nr: number,
  g: Groesse,
  endung: string,
) =>
  `${
    titel
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ß/g, "ss")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "Foto"
  }-${String(nr).padStart(3, "0")}-${g}.${endung}`;
const ENDUNG: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

const FEHLER = {
  zugang: {
    code: "FOTOS_NICHT_EINGERICHTET",
    message: "Die Fotos sind im Moment nicht verfügbar.",
  },
  nicht_erreichbar: {
    code: "FOTOS_NICHT_ERREICHBAR",
    message:
      "Die Fotos sind im Moment nicht erreichbar. Versuche es später nochmals.",
  },
} as const;

// Übersetzt einen Fehler der Quelle in eine Antwort. Nur die Art und der Code von Flickr gelangen ins Log, nie ein Text des Dienstes
export function antwortAufQuellFehler(c: Context, f: unknown) {
  if (!(f instanceof QuellFehler)) throw f;
  log(c, { ereignis: "fotos_quelle", art: f.art, code: f.code });
  if (f.art === "nicht_gefunden") {
    return c.json({ code: "NICHT_GEFUNDEN", message: "Nicht gefunden" }, 404);
  }
  return f.art === "zugang"
    ? c.json(FEHLER.zugang, 503)
    : c.json(FEHLER.nicht_erreichbar, 502);
}

export type FotoRoutenOptionen = {
  db: Db;
  // Ohne Quelle (keine Flickr-Zugangsdaten in der Umgebung) antworten die Routen mit «nicht eingerichtet»
  quelle?: FotoQuelle;
  // Für Tests: eigener Zwischenspeicher, Uhr und Grenzen
  zwischenspeicher?: Zwischenspeicher;
  jetzt?: () => number;
  grenzen?: { listen?: number; bilder?: number; grosse?: number };
};

export function erstelleFotoRouten({
  db,
  quelle,
  zwischenspeicher,
  jetzt = Date.now,
  grenzen,
}: FotoRoutenOptionen) {
  const speicher =
    zwischenspeicher ?? (quelle ? erstelleZwischenspeicher(quelle) : undefined);
  const listenLimit = erstelleBegrenzung({
    max: grenzen?.listen ?? LISTEN_PRO_MINUTE,
    fensterMs: 60_000,
    jetzt,
  });
  const bilderLimit = erstelleBegrenzung({
    max: grenzen?.bilder ?? BILDER_PRO_MINUTE,
    fensterMs: 60_000,
    jetzt,
  });
  const grosseLimit = erstelleBegrenzung({
    max: grenzen?.grosse ?? GROSSE_PRO_MINUTE,
    fensterMs: 60_000,
    jetzt,
  });
  // Eine grosse Datei zählt bei beiden Grenzen
  const bildLimit = (g: Groesse) => (k: string) =>
    bilderLimit(k) && (!istGrosseStufe(g) || grosseLimit(k));

  // Gemeinsame Tür: Konto eines Kindes 403, danach die Grenze je Konto (429)
  function tuer(person: Person, limit: (k: string) => boolean) {
    if (person.kindId) throw new HTTPException(403);
    if (!limit(person.id)) throw new HTTPException(429);
  }

  // Das Konto und der Zwischenspeicher, wenn die Fotos eingerichtet sind
  async function einrichtung(abteilungId: string) {
    const e = await ladeEinstellung(db, abteilungId);
    return speicher && e.flickrKonto
      ? { konto: e.flickrKonto, speicher, linkZeigen: e.flickrLinkZeigen }
      : null;
  }

  async function dateiAntwort(
    c: Context,
    bild: QuellBild,
    groesse: Groesse,
    sp: Zwischenspeicher,
    // Ohne Namen «inline»; mit Namen ein Anhang (Name ohne Endung, die kommt aus dem Typ der Datei)
    herunterladen?: (endung: string) => string,
  ) {
    // Das Secret ändert sich, wenn Flickr das Bild ersetzt: Es ist der Stand des Bildes (ab 1600 hat jede Grösse ihr eigenes). Der Browser fragt jedes Mal mit dem Tag nach, und die Antwort kommt erst nach der Sitzungsprüfung
    const etag = `"${bild.id}-${bild.groessen[groesse]?.secret ?? bild.secret}-${groesse}${herunterladen ? "-d" : ""}"`;
    const kopf = {
      ETag: etag,
      "Cache-Control": "private, no-cache",
      Vary: "Cookie",
      // Wie die Medien: Nichts in der Datei läuft je als Seite
      "Content-Security-Policy": "sandbox; frame-ancestors 'none'",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    };
    if (c.req.header("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers: kopf });
    }
    try {
      const a = await sp.datei(bild, groesse);
      return new Response(a.body, {
        status: 200,
        headers: {
          ...kopf,
          // Der Name besteht nur aus Buchstaben, Ziffern und «-» (dateiName): Er braucht keine Kodierung
          ...(herunterladen && {
            "Content-Disposition": `attachment; filename="${herunterladen(ENDUNG[a.typ] ?? "jpg")}"`,
          }),
          "Content-Type": a.typ,
          ...(a.laenge !== null && { "Content-Length": String(a.laenge) }),
        },
      });
    } catch (f) {
      return antwortAufQuellFehler(c, f);
    }
  }

  const oeffentlich = new Hono<FotoEnv>()
    // Die Alben der Abteilung, die sichtbar sind, in ihrer Reihenfolge
    .get("/alben", async (c) => {
      const person = c.get("person");
      tuer(person, listenLimit);
      const r = await einrichtung(person.abteilungId);
      if (!r) {
        return c.json({ konfiguriert: false, flickrLink: false, alben: [] });
      }
      const zeilen = (await ladeAlbumZeilen(db, person.abteilungId)).filter(
        (z) => z.sichtbar,
      );
      if (zeilen.length === 0) {
        return c.json({
          konfiguriert: true,
          flickrLink: r.linkZeigen,
          alben: [],
        });
      }
      try {
        const bei = new Map(
          (await r.speicher.alben(r.konto)).map((a) => [a.id, a]),
        );
        return c.json({
          konfiguriert: true,
          flickrLink: r.linkZeigen,
          alben: zeilen.flatMap((z) => {
            const a = bei.get(z.flickrAlbumId);
            // Ein Album, das es bei Flickr nicht mehr gibt, fehlt einfach
            return a
              ? [
                  {
                    id: a.id,
                    titel: z.titel ?? a.titel,
                    anzahl: a.anzahl,
                    datum: a.datum,
                    titelbild: a.titelbild !== null,
                  },
                ]
              : [];
          }),
        });
      } catch (f) {
        return antwortAufQuellFehler(c, f);
      }
    })
    .get("/alben/:id", eingabe("param", kennungParam), async (c) => {
      const person = c.get("person");
      tuer(person, listenLimit);
      const { id } = c.req.valid("param");
      const r = await einrichtung(person.abteilungId);
      const zeile =
        r && (await ladeSichtbaresAlbum(db, person.abteilungId, id));
      if (!r || !zeile) throw new HTTPException(404);
      try {
        const { album, bilder } = await r.speicher.album(r.konto, id);
        return c.json({
          id: album.id,
          titel: zeile.titel ?? album.titel,
          anzahl: bilder.length,
          datum: album.datum,
          // Nur wenn die Abteilung den Link will; er führt aus der Website hinaus zu Flickr
          ...(r.linkZeigen && {
            flickrUrl: `https://www.flickr.com/photos/${r.konto}/albums/${album.id}`,
          }),
          // Secret und Server bleiben beim Server: Die Seite kennt nur die Kennung des Bildes und je Stufe, die Flickr liefert, die Masse (#867)
          bilder: bilder.map((b) => ({
            id: b.id,
            titel: b.titel,
            breite: b.breite,
            hoehe: b.hoehe,
            groessen: Object.fromEntries(
              GROESSEN.flatMap((g) => {
                const d = b.groessen[g];
                return d ? [[g, [d.breite, d.hoehe]]] : [];
              }),
            ),
          })),
        });
      } catch (f) {
        return antwortAufQuellFehler(c, f);
      }
    })
    .get(
      "/alben/:id/titel",
      eingabe("param", kennungParam),
      eingabe("query", groesseQuery),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const { groesse } = c.req.valid("query");
        tuer(person, bildLimit(groesse));
        const r = await einrichtung(person.abteilungId);
        if (!r || !(await ladeSichtbaresAlbum(db, person.abteilungId, id))) {
          throw new HTTPException(404);
        }
        let titelbild: QuellBild | null | undefined;
        try {
          titelbild = (await r.speicher.alben(r.konto)).find(
            (a) => a.id === id,
          )?.titelbild;
        } catch (f) {
          return antwortAufQuellFehler(c, f);
        }
        if (!titelbild) throw new HTTPException(404);
        return dateiAntwort(c, titelbild, groesse, r.speicher);
      },
    )
    .get(
      "/alben/:id/bilder/:bildId",
      eingabe("param", bildParam),
      eingabe("query", bildQuery),
      async (c) => {
        const person = c.get("person");
        const { id, bildId } = c.req.valid("param");
        const { groesse, herunterladen } = c.req.valid("query");
        tuer(person, bildLimit(groesse));
        const r = await einrichtung(person.abteilungId);
        const zeile =
          r && (await ladeSichtbaresAlbum(db, person.abteilungId, id));
        if (!r || !zeile) throw new HTTPException(404);
        let album: Awaited<ReturnType<Zwischenspeicher["album"]>>;
        try {
          album = await r.speicher.album(r.konto, id);
        } catch (f) {
          return antwortAufQuellFehler(c, f);
        }
        // Das Bild muss im Album stehen: Eine beliebige Kennung öffnet nichts
        const nr = album.bilder.findIndex((b) => b.id === bildId);
        const bild = album.bilder[nr];
        if (!bild) throw new HTTPException(404);
        return dateiAntwort(
          c,
          bild,
          groesse,
          r.speicher,
          herunterladen &&
            ((endung) =>
              dateiName(
                zeile.titel ?? album.album.titel,
                nr + 1,
                groesse,
                endung,
              )),
        );
      },
    );

  return {
    oeffentlich,
    verwaltung: erstelleAdminFotoRouten({ db, speicher }),
  };
}

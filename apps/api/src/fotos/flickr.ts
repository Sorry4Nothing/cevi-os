import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  GROESSEN,
  MAX_BILDER,
  QuellFehler,
  istKennung,
  istKonto,
  type FotoQuelle,
  type Groesse,
  type QuellAlbum,
  type QuellAntwort,
  type QuellBild,
} from "./quelle.js";

// Flickr als Quelle der Fotos (#690). Nur der Server spricht mit Flickr: Der Browser lädt nie etwas von dort, die CSP bleibt bei img-src 'self'.
// Hosts: Die Adressen sind fest (REST-API und Bild-Host von Flickr); eine Eingabe einer Person fliesst nie hinein, nur geprüfte Kennungen (Ziffern, Buchstaben). In Produktion gibt es keine andere Basis; für Tests und lokale Läufe lässt die Konfiguration eine eigene Basis zu (FLICKR_API_BASIS, FLICKR_BILD_BASIS).
// Geheimnisse: Schlüssel, Secret und Token kommen nur als Parameter der Fabrik und stehen nie in einer Fehlermeldung, einem Log oder einer Antwort. Fehler tragen eine Art und höchstens den Fehlercode von Flickr (eine Zahl).
// Begrenzungen: ein Zeitlimit je Abruf, keine Weiterleitung, gedeckelte Antworten (JSON 2 MiB, Bild 20 MiB), höchstens MAX_BILDER Bilder je Album.

export const FLICKR_API = "https://api.flickr.com/services/rest/";
export const FLICKR_BILDER = "https://live.staticflickr.com";
const ZEITLIMIT_MS = 8_000;
const BILD_ZEITLIMIT_MS = 15_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_BILD_BYTES = 20 * 1024 * 1024;
const SEITE = 500;
const BILD_TYPEN = /^image\/(jpeg|png|gif|webp)$/;
const GEHEIM = /^[0-9a-zA-Z]{4,40}$/;
const SERVER = /^[0-9]{1,10}$/;

// Dateiendung der Grösse bei Flickr: «_n» 320, «_z» 640, «_b» 1024; ohne Endung 500 (die gibt es für jedes Bild). Eine Stufe gilt als vorhanden, wenn Flickr die Datei meldet (url_n, url_z, url_b); sonst nimmt sie die nächstkleinere
const SUFFIX: Record<Groesse, string> = {
  klein: "_n",
  mittel: "_z",
  gross: "_b",
};

const zahl = z.coerce.number().int().min(0).catch(0);
const text = z.union([z.string(), z.number()]).transform(String);
const inhalt = z.union([
  z.string(),
  z.object({ _content: z.string().catch("") }).transform((o) => o._content),
]);
const fehlerAntwort = z.object({
  stat: z.literal("fail"),
  code: z.coerce.number().optional(),
});
const albumZeile = z.object({
  id: text.pipe(z.string().regex(/^[0-9]{1,20}$/)),
  primary: text.optional(),
  secret: z.string().optional(),
  server: text.optional(),
  photos: zahl.optional(),
  title: inhalt.catch(""),
  date_create: z.coerce.number().optional(),
});
const bildZeile = z.object({
  id: text.pipe(z.string().regex(/^[0-9]{1,20}$/)),
  secret: z.string().regex(GEHEIM),
  server: text.pipe(z.string().regex(SERVER)),
  title: z.string().catch(""),
  width_n: z.coerce.number().optional(),
  height_n: z.coerce.number().optional(),
  width_z: z.coerce.number().optional(),
  height_z: z.coerce.number().optional(),
  url_n: z.string().optional(),
  url_z: z.string().optional(),
  url_b: z.string().optional(),
});
const listeAntwort = z.object({
  stat: z.literal("ok"),
  photosets: z.object({
    pages: zahl,
    photoset: z.array(albumZeile).max(1000),
  }),
});
const infoAntwort = z.object({
  stat: z.literal("ok"),
  photoset: albumZeile,
});
const bilderAntwort = z.object({
  stat: z.literal("ok"),
  photoset: z.object({
    pages: zahl,
    photo: z.array(bildZeile).max(SEITE),
  }),
});

// RFC 3986: Ausser A-Z a-z 0-9 - . _ ~ wird alles prozentkodiert (encodeURIComponent lässt ! * ' ( ) stehen)
const kodiere = (s: string) =>
  encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

// OAuth 1.0a, HMAC-SHA1 (Flickr verlangt ihn): Basis-String aus Methode, Adresse und den sortierten, kodierten Parametern
export function signiere(
  methode: string,
  adresse: string,
  parameter: Record<string, string>,
  secret: string,
  tokenSecret: string,
): string {
  const paare = Object.entries(parameter)
    .map(([k, v]) => [kodiere(k), kodiere(v)] as const)
    .sort((a, b) =>
      a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1,
    )
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const basis = `${methode.toUpperCase()}&${kodiere(adresse)}&${kodiere(paare)}`;
  return createHmac("sha1", `${kodiere(secret)}&${kodiere(tokenSecret)}`)
    .update(basis)
    .digest("base64");
}

export type FlickrOptionen = {
  apiKey: string;
  // Mit allen dreien signiert der Client jeden Abruf (dann sieht er auch die nicht öffentlichen Fotos des Kontos); ohne sie sieht er nur Öffentliches
  apiSecret?: string;
  token?: string;
  tokenSecret?: string;
  // Kennung des Kontos, dem das Token gehört: Nur Abrufe für dieses Konto sind signiert, alle anderen sehen nur Öffentliches
  tokenKonto?: string;
  // Nur für Tests und lokale Läufe (die Konfiguration erlaubt sie nicht in Produktion)
  apiBasis?: string;
  bildBasis?: string;
  // Austauschbar für Tests
  fetch?: typeof fetch;
  jetzt?: () => number;
};

// Liest den Körper höchstens bis max Bytes; mehr ist ein Fehler
async function leseGedeckelt(res: Response, max: number): Promise<string> {
  if (!res.body) throw new QuellFehler("nicht_erreichbar", "leer");
  const leser = res.body.getReader();
  const teile: Uint8Array[] = [];
  let summe = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    summe += value.byteLength;
    if (summe > max) {
      await leser.cancel();
      throw new QuellFehler("nicht_erreichbar", "zu_gross");
    }
    teile.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(teile));
}

// Flickr meldet Fehler mit HTTP 200 und stat «fail»; die Zahl sagt, was los ist
function fehlerVonCode(code: number | undefined): QuellFehler {
  if (code === 1 || code === 2) {
    return new QuellFehler("nicht_gefunden", String(code));
  }
  // 95 bis 102 und 111 bis 116: Signatur, Token, Rechte oder Schlüssel stimmen nicht
  if (
    code !== undefined &&
    ((code >= 95 && code <= 102) || (code >= 111 && code <= 116))
  ) {
    return new QuellFehler("zugang", String(code));
  }
  return new QuellFehler(
    "nicht_erreichbar",
    code === undefined ? undefined : String(code),
  );
}

// Die Teile der Dateiadresse eines Bildes oder Titelbildes, nur wenn sie die Form haben, die Flickr vergibt
const dateiTeileOk = (id: string, server: string, secret: string) =>
  istKennung(id) && SERVER.test(server) && GEHEIM.test(secret);

export function erstelleFlickr(o: FlickrOptionen): FotoQuelle {
  const abruf = o.fetch ?? fetch;
  const jetzt = o.jetzt ?? Date.now;
  const apiBasis = o.apiBasis ?? FLICKR_API;
  const bildBasis = (o.bildBasis ?? FLICKR_BILDER).replace(/\/+$/, "");
  const bildHost = new URL(bildBasis).host;
  const signiert = Boolean(o.apiSecret && o.token && o.tokenSecret);

  async function rest(
    methode: string,
    parameter: Record<string, string>,
  ): Promise<unknown> {
    const p: Record<string, string> = {
      ...parameter,
      method: methode,
      api_key: o.apiKey,
      format: "json",
      nojsoncallback: "1",
    };
    // Nur für das Konto des Tokens: Eine andere Abteilung sähe sonst über den Server dessen nicht öffentliche Fotos (#777)
    if (signiert && o.tokenKonto === parameter.user_id) {
      p.oauth_consumer_key = o.apiKey;
      p.oauth_token = o.token!;
      p.oauth_nonce = randomBytes(16).toString("hex");
      p.oauth_timestamp = String(Math.floor(jetzt() / 1000));
      p.oauth_signature_method = "HMAC-SHA1";
      p.oauth_version = "1.0";
      p.oauth_signature = signiere(
        "GET",
        apiBasis,
        p,
        o.apiSecret!,
        o.tokenSecret!,
      );
    }
    const url = new URL(apiBasis);
    url.search = new URLSearchParams(p).toString();
    let res: Response;
    try {
      res = await abruf(url, {
        signal: AbortSignal.timeout(ZEITLIMIT_MS),
        redirect: "error",
        headers: { accept: "application/json" },
      });
    } catch {
      throw new QuellFehler("nicht_erreichbar", "netz");
    }
    if (!res.ok) {
      // Auch 429: Flickr bremst; die Antwort bleibt ungelesen
      void res.body?.cancel();
      throw new QuellFehler("nicht_erreichbar", `http_${res.status}`);
    }
    let daten: unknown;
    try {
      daten = JSON.parse(await leseGedeckelt(res, MAX_JSON_BYTES));
    } catch (f) {
      if (f instanceof QuellFehler) throw f;
      throw new QuellFehler("nicht_erreichbar", "json");
    }
    const fehler = fehlerAntwort.safeParse(daten);
    if (fehler.success) throw fehlerVonCode(fehler.data.code);
    return daten;
  }

  const lies = <T>(schema: z.ZodType<T>, daten: unknown): T => {
    const e = schema.safeParse(daten);
    if (!e.success) throw new QuellFehler("nicht_erreichbar", "form");
    return e.data;
  };

  function bildAus(zeile: z.infer<typeof bildZeile>): QuellBild {
    const breite = zeile.width_n ?? zeile.width_z ?? 0;
    const hoehe = zeile.height_n ?? zeile.height_z ?? 0;
    const masse = breite > 0 && hoehe > 0;
    return {
      id: zeile.id,
      server: zeile.server,
      secret: zeile.secret,
      titel: zeile.title.trim().slice(0, 200),
      // Ohne Masse ein Querformat als Platzhalter; das Bild passt sich ein
      breite: masse ? Math.round(breite) : 4,
      hoehe: masse ? Math.round(hoehe) : 3,
      groessen: [
        ...(zeile.url_n ? (["klein"] as const) : []),
        ...(zeile.url_z ? (["mittel"] as const) : []),
        ...(zeile.url_b ? (["gross"] as const) : []),
      ],
    };
  }

  const datum = (sekunden: number | undefined) =>
    sekunden && sekunden > 0
      ? new Date(sekunden * 1000).toISOString().slice(0, 10)
      : null;

  function albumAus(a: z.infer<typeof albumZeile>): QuellAlbum {
    const titelbild =
      a.primary &&
      a.secret &&
      a.server &&
      dateiTeileOk(a.primary, a.server, a.secret)
        ? ({
            id: a.primary,
            server: a.server,
            secret: a.secret,
            titel: "",
            breite: 4,
            hoehe: 3,
            groessen: [],
          } satisfies QuellBild)
        : null;
    return {
      id: a.id,
      titel: a.title.trim().slice(0, 200),
      anzahl: a.photos ?? 0,
      datum: datum(a.date_create),
      titelbild,
    };
  }

  return {
    async alben(konto) {
      if (!istKonto(konto)) throw new QuellFehler("nicht_gefunden", "konto");
      const alle: QuellAlbum[] = [];
      // Höchstens vier Seiten zu 500 Alben
      for (let seite = 1; seite <= 4; seite++) {
        const d = lies(
          listeAntwort,
          await rest("flickr.photosets.getList", {
            user_id: konto,
            per_page: String(SEITE),
            page: String(seite),
          }),
        );
        alle.push(...d.photosets.photoset.map(albumAus));
        if (seite >= d.photosets.pages) break;
      }
      return alle;
    },

    async album(konto, albumId) {
      if (!istKonto(konto) || !istKennung(albumId)) {
        throw new QuellFehler("nicht_gefunden", "kennung");
      }
      const info = lies(
        infoAntwort,
        await rest("flickr.photosets.getInfo", {
          user_id: konto,
          photoset_id: albumId,
        }),
      );
      const bilder: QuellBild[] = [];
      for (let seite = 1; bilder.length < MAX_BILDER; seite++) {
        const d = lies(
          bilderAntwort,
          await rest("flickr.photosets.getPhotos", {
            user_id: konto,
            photoset_id: albumId,
            extras: "url_n,url_z,url_b",
            media: "photos",
            per_page: String(SEITE),
            page: String(seite),
          }),
        );
        bilder.push(...d.photoset.photo.map(bildAus));
        if (seite >= d.photoset.pages) break;
      }
      return {
        album: albumAus(info.photoset),
        bilder: bilder.slice(0, MAX_BILDER),
      };
    },

    async datei(bild, groesse): Promise<QuellAntwort> {
      if (!GROESSEN.includes(groesse)) {
        throw new QuellFehler("nicht_gefunden", "groesse");
      }
      // Nur Ziffern und Buchstaben gehen in die Adresse
      if (!dateiTeileOk(bild.id, bild.server, bild.secret)) {
        throw new QuellFehler("nicht_gefunden", "bild");
      }
      // Fehlt «gross», gilt «mittel»; fehlt auch das, die 500er-Datei ohne Endung
      const suffix = bild.groessen.includes(groesse)
        ? SUFFIX[groesse]
        : groesse === "gross" && bild.groessen.includes("mittel")
          ? SUFFIX.mittel
          : "";
      const url = new URL(
        `${bildBasis}/${bild.server}/${bild.id}_${bild.secret}${suffix}.jpg`,
      );
      // Allowlist: nur der feste Bild-Host
      if (url.host !== bildHost) {
        throw new QuellFehler("nicht_gefunden", "host");
      }
      let res: Response;
      try {
        res = await abruf(url, {
          signal: AbortSignal.timeout(BILD_ZEITLIMIT_MS),
          redirect: "error",
          headers: { accept: "image/jpeg,image/png,image/webp,image/gif" },
        });
      } catch {
        throw new QuellFehler("nicht_erreichbar", "netz");
      }
      if (!res.ok || !res.body) {
        void res.body?.cancel();
        throw new QuellFehler(
          res.status === 404 || res.status === 403
            ? "nicht_gefunden"
            : "nicht_erreichbar",
          `http_${res.status}`,
        );
      }
      const typ = (res.headers.get("content-type") ?? "")
        .split(";")[0]!
        .trim()
        .toLowerCase();
      if (!BILD_TYPEN.test(typ)) {
        void res.body.cancel();
        throw new QuellFehler("nicht_erreichbar", "typ");
      }
      const laenge = Number(res.headers.get("content-length"));
      if (Number.isFinite(laenge) && laenge > MAX_BILD_BYTES) {
        void res.body.cancel();
        throw new QuellFehler("nicht_erreichbar", "zu_gross");
      }
      return {
        body: begrenze(res.body, MAX_BILD_BYTES),
        typ,
        laenge: Number.isFinite(laenge) && laenge > 0 ? laenge : null,
      };
    },
  };
}

// Reicht den Strom durch und bricht ab, sobald er mehr als max Bytes liefert (Content-Length kann fehlen oder lügen)
export function begrenze(
  quelle: ReadableStream<Uint8Array>,
  max: number,
): ReadableStream<Uint8Array> {
  let summe = 0;
  return quelle.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(stueck, ctl) {
        summe += stueck.byteLength;
        if (summe > max) {
          ctl.error(new QuellFehler("nicht_erreichbar", "zu_gross"));
        } else {
          ctl.enqueue(stueck);
        }
      },
    }),
  );
}

import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  begrenze,
  FLICKR_API,
  FLICKR_BILDER,
  signiere,
  type FlickrOptionen,
} from "./flickr.js";
import { istKennung, istKonto, QuellFehler } from "./quelle.js";

// Das grösste Bild eines Flickr-Fotos für den Befehl «medium-aus-flickr» (#868): das Original, sonst die grösste Stufe, die Flickr meldet. Getrennt vom Client der Website (flickr.ts), der nur feste kleine Stufen kennt und im Betrieb läuft.
// Dieselben Regeln: feste Hosts (die Adresse von Flickr wird gegen den Bild-Host geprüft), kein Redirect, Zeitlimit, gedeckelte Antworten, Geheimnisse nie in Fehlern. Signiert nur für das Konto des Tokens (#777).

const ZEITLIMIT_MS = 10_000;
const BILD_ZEITLIMIT_MS = 120_000;
const MAX_JSON_BYTES = 256 * 1024;
// Ein Original mit 30 MP ist als JPEG selten über 30 MB
export const MAX_ORIGINAL_BYTES = 50 * 1024 * 1024;
const BILD_TYPEN = /^image\/(jpeg|png|webp)$/;

const fehler = z.object({
  stat: z.literal("fail"),
  code: z.coerce.number().optional(),
});
const info = z.object({
  stat: z.literal("ok"),
  photo: z.object({ owner: z.object({ nsid: z.string() }) }),
});
const groessen = z.object({
  stat: z.literal("ok"),
  sizes: z.object({
    size: z
      .array(
        z.object({
          width: z.coerce.number().int().min(0).catch(0),
          height: z.coerce.number().int().min(0).catch(0),
          source: z.string(),
          media: z.string().optional(),
        }),
      )
      .max(50),
  }),
});

export type FlickrOriginal = {
  // Bytes, Breite und Höhe der grössten Fassung; wirft QuellFehler, auch wenn das Foto nicht zum Konto gehört
  groesste(
    konto: string,
    fotoId: string,
  ): Promise<{ daten: Uint8Array; breite: number; hoehe: number }>;
};

export function erstelleFlickrOriginal(o: FlickrOptionen): FlickrOriginal {
  const abruf = o.fetch ?? fetch;
  const jetzt = o.jetzt ?? Date.now;
  const apiBasis = o.apiBasis ?? FLICKR_API;
  const bild = new URL(o.bildBasis ?? FLICKR_BILDER);

  async function rest(
    methode: string,
    parameter: Record<string, string>,
    konto: string,
  ): Promise<unknown> {
    const p: Record<string, string> = {
      ...parameter,
      method: methode,
      api_key: o.apiKey,
      format: "json",
      nojsoncallback: "1",
    };
    if (o.apiSecret && o.token && o.tokenSecret && o.tokenKonto === konto) {
      p.oauth_consumer_key = o.apiKey;
      p.oauth_token = o.token;
      p.oauth_nonce = randomBytes(16).toString("hex");
      p.oauth_timestamp = String(Math.floor(jetzt() / 1000));
      p.oauth_signature_method = "HMAC-SHA1";
      p.oauth_version = "1.0";
      p.oauth_signature = signiere(
        "GET",
        apiBasis,
        p,
        o.apiSecret,
        o.tokenSecret,
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
    if (!res.ok || !res.body) {
      void res.body?.cancel();
      throw new QuellFehler("nicht_erreichbar", `http_${res.status}`);
    }
    let daten: unknown;
    try {
      daten = await new Response(begrenze(res.body, MAX_JSON_BYTES)).json();
    } catch {
      throw new QuellFehler("nicht_erreichbar", "json");
    }
    const f = fehler.safeParse(daten);
    if (f.success) {
      throw new QuellFehler(
        f.data.code === 1 ? "nicht_gefunden" : "nicht_erreichbar",
        f.data.code === undefined ? undefined : String(f.data.code),
      );
    }
    return daten;
  }

  const lies = <T>(schema: z.ZodType<T>, daten: unknown): T => {
    const e = schema.safeParse(daten);
    if (!e.success) throw new QuellFehler("nicht_erreichbar", "form");
    return e.data;
  };

  return {
    async groesste(konto, fotoId) {
      if (!istKonto(konto) || !istKennung(fotoId)) {
        throw new QuellFehler("nicht_gefunden", "kennung");
      }
      // Nur Fotos des Kontos der Abteilung
      const besitz = lies(
        info,
        await rest("flickr.photos.getInfo", { photo_id: fotoId }, konto),
      );
      if (besitz.photo.owner.nsid !== konto) {
        throw new QuellFehler("nicht_gefunden", "konto");
      }
      const liste = lies(
        groessen,
        await rest("flickr.photos.getSizes", { photo_id: fotoId }, konto),
      ).sizes.size.filter(
        (s) => s.media !== "video" && s.width > 0 && s.height > 0,
      );
      const beste = liste.reduce<(typeof liste)[number] | undefined>(
        (a, s) => (!a || s.width * s.height > a.width * a.height ? s : a),
        undefined,
      );
      if (!beste) throw new QuellFehler("nicht_gefunden", "groesse");
      let url: URL;
      try {
        url = new URL(beste.source);
      } catch {
        throw new QuellFehler("nicht_erreichbar", "adresse");
      }
      // Allowlist: nur der feste Bild-Host, im Protokoll der Basis
      if (url.host !== bild.host || url.protocol !== bild.protocol) {
        throw new QuellFehler("nicht_gefunden", "host");
      }
      let res: Response;
      try {
        res = await abruf(url, {
          signal: AbortSignal.timeout(BILD_ZEITLIMIT_MS),
          redirect: "error",
          headers: { accept: "image/jpeg,image/png,image/webp" },
        });
      } catch {
        throw new QuellFehler("nicht_erreichbar", "netz");
      }
      const typ = (res.headers.get("content-type") ?? "")
        .split(";")[0]!
        .trim()
        .toLowerCase();
      if (!res.ok || !res.body || !BILD_TYPEN.test(typ)) {
        void res.body?.cancel();
        throw new QuellFehler("nicht_erreichbar", `http_${res.status}`);
      }
      const daten = new Uint8Array(
        await new Response(
          begrenze(res.body, MAX_ORIGINAL_BYTES),
        ).arrayBuffer(),
      );
      return { daten, breite: beste.width, hoehe: beste.height };
    },
  };
}

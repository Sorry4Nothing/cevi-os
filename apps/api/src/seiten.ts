import { readFileSync } from "node:fs";

// Nur server.ts und Tests importieren diese Datei: node:fs bleibt aus dem Graph von app.ts, den die App über AppType prüft
export function ladeSeiten() {
  const lade = (datei: string) =>
    readFileSync(new URL(`../public/${datei}`, import.meta.url), "utf8");
  return {
    datenschutz: lade("datenschutz.html"),
    kontoLoeschen: lade("konto-loeschen.html"),
    support: lade("support.html"),
  };
}

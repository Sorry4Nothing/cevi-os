import { readdirSync, readFileSync } from "node:fs";

// Nur server.ts und Tests importieren diese Datei: node:fs bleibt aus dem Graph von app.ts, den die App über AppType prüft
export function ladeSeiten() {
  const lade = (datei: string) =>
    readFileSync(new URL(`../public/${datei}`, import.meta.url), "utf8");
  // Alle Dateien aus public/admin; neue Module brauchen keine Änderung hier
  const admin = Object.fromEntries(
    readdirSync(new URL("../public/admin/", import.meta.url))
      .sort()
      .map((datei) => [datei, lade(`admin/${datei}`)]),
  );
  return {
    admin,
    datenschutz: lade("datenschutz.html"),
    kontoLoeschen: lade("konto-loeschen.html"),
    support: lade("support.html"),
  };
}

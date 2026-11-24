import { readdirSync, readFileSync } from "node:fs";
import { kodiereZeichen } from "./bild-sharp.js";
import type { ZeichenDateien } from "./website/zeichen.js";

// Wer die Seiten verantwortet und wie man sie erreicht; kommt aus der Umgebung des Servers, nie aus dem Repo
export type Kontakt = { stelle?: string; adresse?: string; email?: string };

const MASKE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const maskiere = (text: string) => text.replace(/[&<>"']/g, (z) => MASKE[z]!);

const SCHRIFT = "archivo-latin.woff2";

// Ohne Angabe bleibt die Seite lesbar, nennt aber keine erfundene Stelle oder Adresse
export function setzeKontakt(
  html: string,
  { stelle, adresse, email }: Kontakt,
) {
  return html
    .replaceAll("{{STELLE}}", stelle ? maskiere(stelle) : "die Abteilung")
    .replaceAll(
      "{{ADRESSE}}",
      adresse
        ? maskiere(adresse)
        : "die Anschrift der Abteilung (noch nicht eingetragen)",
    )
    .replaceAll(
      "{{KONTAKT}}",
      email
        ? `<a href="mailto:${maskiere(email)}">${maskiere(email)}</a>`
        : "die Adresse der Abteilung (noch nicht eingetragen)",
    );
}

// Nur server.ts und Tests importieren diese Datei: node:fs bleibt aus dem Graph von app.ts, den die App über AppType prüft
export function ladeSeiten(kontakt: Kontakt = {}) {
  const lade = (datei: string) =>
    readFileSync(new URL(`../public/${datei}`, import.meta.url), "utf8");
  // Alle Dateien aus public/admin; neue Module brauchen keine Änderung hier
  const admin: Record<string, string | Uint8Array<ArrayBuffer>> =
    Object.fromEntries(
      readdirSync(new URL("../public/admin/", import.meta.url))
        .sort()
        .map((datei) => [datei, lade(`admin/${datei}`)]),
    );
  // Die Vorschau im Editor (#358) lädt den Stil der Website von hier: Die Website selbst liefert die API nicht aus
  // Mit dem Stil des Kopfs (#558), der Grossansicht und des Karussells (#559) und der Inhaltsbausteine (#560), den die Website nur auf Seiten mit einem solchen Baustein lädt
  // Die Schrift der Website (#570) liefert die Verwaltung selbst aus: Die Vorschau zeigt Archivo auch, wenn Website und Verwaltung nicht auf demselben Host liegen
  admin[SCHRIFT] = new Uint8Array(
    readFileSync(new URL(`../public/website/${SCHRIFT}`, import.meta.url)),
  );
  // Tokens und Schrift (#578): eine Datei für Website und Verwaltung; die Schrift steht in der Datei relativ, gilt also auch unter /admin/
  const tokens = lade("website/tokens.css");
  admin["tokens.css"] = tokens;
  // Umschalter Hell und Dunkel der Verwaltung (#578): dieselbe Datei wie die Website, dieselbe Wahl im Browser
  admin["theme.js"] = lade("website/theme.js");
  // Eigenes Auswahlfeld (#564, #578): dieselben Dateien wie die Website; es wertet jedes select der Verwaltung auf
  admin["auswahl.js"] = lade("website/auswahl.js");
  admin["auswahl.css"] = lade("website/auswahl.css");
  admin["website-vorschau.css"] =
    tokens +
    lade("website/website.css") +
    lade("website/kopf.css") +
    lade("website/fuss.css") +
    lade("website/lichtkasten.css") +
    lade("website/karussell.css") +
    lade("website/inhalt.css");
  // Der Stil liegt einmal in seite.css; die CSP-freien Seiten setzen ihn ein, statt ihn zu laden
  const stil = lade("seite.css");
  const seite = (datei: string) =>
    setzeKontakt(
      lade(datei).replace("/* STIL */", () => stil),
      kontakt,
    );
  // Favicon der Verwaltung und der Plattformseiten (#581): ohne Zeichen der Abteilung das Cevi-Zeichen. server.ts tauscht es aus, sobald das Zeichen der Abteilung bekannt ist; Besuche fragen die Datenbank nie
  let zeichen: Promise<ZeichenDateien> | undefined;
  return {
    admin,
    zeichen: {
      holen: () =>
        (zeichen ??= kodiereZeichen(
          readFileSync(new URL("../public/admin/favicon.svg", import.meta.url)),
        )),
      setze: (dateien: ZeichenDateien) => {
        zeichen = Promise.resolve(dateien);
      },
    },
    datenschutz: seite("datenschutz.html"),
    kontoLoeschen: seite("konto-loeschen.html"),
    support: seite("support.html"),
  };
}

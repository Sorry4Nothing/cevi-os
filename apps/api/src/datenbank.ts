import postgres from "postgres";

// Ohne NOTICEs: postgres-js schriebe sie selbst mit console.log, am Log vorbei, ohne Request-ID (der Rückruf kennt keine Anfrage) und mit Text aus der Datenbank
export function verbindeDatenbank(url: string) {
  return postgres(url, { onnotice: () => {} });
}

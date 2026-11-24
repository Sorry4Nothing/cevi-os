import { anfrage } from "./api.js";
import { el } from "./dom.js";
import { heuteZuerich, terminAnzeige, zeitraumText } from "./kalenderhilfen.js";

// Gruppen vom Typ «anlass» (#626): Hilfen für die Liste, das Detail und das Anlegen. Eine solche Gruppe gehört zu einem Anlass (zum Beispiel das OK); der Typ vergibt keine Rechte.

// Tag des Termins in Zürcher Zeit als «JJJJ-MM-TT», zum Ordnen und Vergleichen
const tagVon = (a) =>
  a.ganztaegig
    ? a.tagVon
    : new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(
        new Date(a.beginn),
      );

// «Titel · Sa 06.02.2027»
export const anlassText = (a) => `${a.titel} · ${terminAnzeige(a).tag}`;

// Alle Anlässe ohne Gruppe, kommende zuerst (aufsteigend), danach vergangene (die jüngsten zuerst). Höchstens 5 Seiten zu 100 Anlässen, also 5 Abfragen; Lager sind kein Anlass
export async function ladeFreieAnlaesse() {
  const alle = [];
  let nach = "";
  for (let i = 0; i < 5; i += 1) {
    const seite = await anfrage(
      "GET",
      `/api/v1/admin/anlaesse?limit=100${nach}`,
    );
    alle.push(...seite.anlaesse);
    if (!seite.weitere) break;
    nach = `&nach=${encodeURIComponent(seite.naechste)}`;
  }
  const heute = heuteZuerich();
  const frei = alle.filter((a) => a.art === "anlass" && !a.gruppe);
  const kommend = frei
    .filter((a) => tagVon(a) >= heute)
    .sort((a, b) => tagVon(a).localeCompare(tagVon(b)));
  const vorbei = frei
    .filter((a) => tagVon(a) < heute)
    .sort((a, b) => tagVon(b).localeCompare(tagVon(a)));
  return [...kommend, ...vorbei];
}

// Zeile unter dem Namen in der Gruppenliste: Link zum Anlass mit Datum; ohne Anlass der Hinweis, dass er gelöscht wurde
export function anlassZeile(tag) {
  if (tag.typ !== "anlass") return null;
  if (!tag.anlass) {
    return el("span", { class: "klein leise" }, "Der Anlass ist gelöscht");
  }
  return el(
    "a",
    { class: "klein tm-tabellenlink", href: `#anlaesse/${tag.anlass.id}` },
    anlassText(tag.anlass),
  );
}

// Karte im Detail der Gruppe: zu welchem Anlass sie gehört, mit Link zum Anlass
export function anlassKarte(tag) {
  if (tag.typ !== "anlass") return null;
  return el(
    "section",
    { class: "pe-karte", "aria-labelledby": "gruppe-anlass" },
    el("h2", { id: "gruppe-anlass" }, "Anlass"),
    tag.anlass
      ? el(
          "dl",
          { class: "werte" },
          el(
            "div",
            {},
            el("dt", {}, "Titel"),
            el(
              "dd",
              {},
              el(
                "a",
                {
                  class: "tm-tabellenlink",
                  href: `#anlaesse/${tag.anlass.id}`,
                },
                `${tag.anlass.titel}, öffnen`,
              ),
            ),
          ),
          el(
            "div",
            {},
            el("dt", {}, "Termin"),
            el("dd", {}, zeitraumText(tag.anlass)),
          ),
        )
      : el(
          "p",
          { class: "leise" },
          "Der Anlass dieser Gruppe ist gelöscht. Die Gruppe und ihre Mitglieder bleiben bestehen.",
        ),
    el(
      "p",
      { class: "klein leise" },
      "Die Gruppe gibt keine zusätzlichen Rechte und erscheint nie auf der Website.",
    ),
  );
}

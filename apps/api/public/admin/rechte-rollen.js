import { el, knopf } from "./dom.js";
import { leerKarte } from "./zustaende.js";
import { aendereRolle } from "./rechte-api.js";
import {
  adresse,
  haenge,
  personen as personenText,
  zurueckLink,
} from "./rechte-gemeinsam.js";
import { festePunkte } from "./rechte-gruppen.js";
import { rechteRaster } from "./rechte-matrix.js";
import {
  neueRolleSeite,
  personenBlock,
  rolleBearbeitenSeite,
  rolleKopf,
  rolleLoeschenFrage,
} from "./rechte-rolle.js";

// Reiter «Rollen» (#651): globale Rollen der Abteilung (Plattformrollen wie «Webmaster»). Sie gelten für die ganze Abteilung, nicht für eine Gruppe, und können alles tragen, was der Katalog vergebbar nennt: Website, Termine, Anlässe, Räume, Lädeli, Mitteilungen, Personen. Die Abteilungsleitung braucht keine Rolle: Sie hat immer alles.
// Rechte je Gruppe stellst du im Reiter «Gruppen» ein.

export function zeigeRollen(inhalt, z, pfad) {
  const [id] = pfad;
  if (id && id !== "neu") return zeigeRolle(inhalt, z, id);
  return zeigeUebersicht(inhalt, z);
}

const neueRolle = (z) =>
  neueRolleSeite(z, {
    art: "global",
    rollen: z.globale,
    danach: () => z.neu(),
  });

function zeigeUebersicht(inhalt, z) {
  const { ctx, globale } = z;
  ctx.kopfAktion(
    knopf("Neue Rolle", {
      art: "haupt",
      symbol: "plus",
      onclick: () => neueRolle(z),
    }),
  );
  haenge(
    inhalt,
    el(
      "p",
      { class: "leise rr-erklaerung" },
      "Eine globale Rolle bündelt Rechte für die ganze Abteilung, zum Beispiel «Webmaster». Du weist sie einzelnen Personen zu. Die Abteilungsleitung braucht keine Rolle: Sie hat immer alles.",
    ),
  );
  if (globale.length === 0) {
    haenge(
      inhalt,
      leerKarte("Es gibt noch keine Rolle. Lege die erste an.", [
        knopf("Neue Rolle", {
          art: "haupt",
          symbol: "plus",
          onclick: () => neueRolle(z),
        }),
      ]),
    );
    return;
  }
  haenge(
    inhalt,
    el(
      "ul",
      { class: "rr-rollenliste", "aria-label": "Globale Rollen" },
      globale.map((r) =>
        el(
          "li",
          { class: "rr-rollenzeile rr-rollenzeile--karte" },
          el(
            "a",
            { class: "rr-rollenlink", href: adresse("rollen", r.id) },
            r.name,
          ),
          r.system &&
            el("span", { class: "rr-marke rr-marke--system" }, "Eingebaut"),
          el(
            "span",
            { class: "klein leise" },
            `${personenText(r.personen.length)} · ${r.rechte.length === 1 ? "1 Recht" : `${r.rechte.length} Rechte`}`,
          ),
        ),
      ),
    ),
    el(
      "section",
      { class: "flaeche rr-flaeche", "aria-labelledby": "rr-global-titel" },
      el("h3", { id: "rr-global-titel" }, "Rechte der Rollen"),
      el(
        "p",
        { class: "klein leise" },
        "Der ganze Katalog, nach Bereich. Änderungen bleiben im Entwurf, bis du unten speicherst.",
      ),
      rechteRaster({ z, rollen: globale, art: "global" }).wurzel,
    ),
    festePunkte(z),
  );
}

function zeigeRolle(inhalt, z, id) {
  const rolle = z.globale.find((r) => r.id === id);
  if (!rolle) {
    haenge(
      inhalt,
      zurueckLink("Alle Rollen", adresse("rollen")),
      leerKarte("Diese Rolle gibt es nicht mehr."),
    );
    return;
  }
  z.ctx.titel(rolle.name, "Globale Rolle");
  z.ctx.kopfAktion();
  const fragenOrt = el("div", { class: "rr-fragen" });
  const bearbeiten = knopf("Umbenennen", {
    symbol: "bearbeiten",
    klein: true,
    onclick: () =>
      rolleBearbeitenSeite(z, rolle, {
        aendere: (felder) => aendereRolle(rolle, felder),
        danach: () => z.neu(),
      }),
  });
  const loeschen = rolle.system
    ? null
    : knopf("Rolle löschen", {
        art: "gefahr",
        klein: true,
        symbol: "papierkorb",
        onclick: (e) =>
          rolleLoeschenFrage(z, rolle, {
            ort: fragenOrt,
            ausloeser: e.currentTarget,
            danach: () => (location.hash = adresse("rollen")),
          }),
      });
  haenge(
    inhalt,
    zurueckLink("Alle Rollen", adresse("rollen")),
    rolleKopf(rolle, el("div", { class: "reihe" }, bearbeiten, loeschen)),
    fragenOrt,
    el(
      "section",
      { class: "flaeche rr-flaeche", "aria-labelledby": "rr-rechte-titel" },
      el("h3", { id: "rr-rechte-titel" }, "Rechte"),
      el(
        "p",
        { class: "klein leise" },
        "Eine globale Rolle gilt für die ganze Abteilung: «An» heisst für alle Objekte. Änderungen bleiben im Entwurf, bis du unten speicherst.",
      ),
      rechteRaster({ z, rollen: [rolle], art: "global", einzel: true }).wurzel,
    ),
    personenBlock(z, rolle, {}),
    festePunkte(z),
  );
}

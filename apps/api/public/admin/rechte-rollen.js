import { el, icon, knopf } from "./dom.js";
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

// Reiter «Rollen» (#651): globale Rollen der Abteilung (Plattformrollen wie «Webmaster»). Sie gelten für die ganze Abteilung, nicht für eine Gruppe, und können alles tragen, was der Katalog vergebbar nennt: Website, Termine, Anlässe, Räume, Lädeli, Mitteilungen, Personen. Die Abteilungsleitung steht als eingebaute Rolle in der Liste: Ihre Rechte stellt nur der Entwickler ein, sie selbst nie.
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
  const verwaltet = z.ich.rechteVerwalten;
  if (verwaltet) {
    ctx.kopfAktion(
      knopf("Neue Rolle", {
        art: "haupt",
        symbol: "plus",
        onclick: () => neueRolle(z),
      }),
    );
  } else {
    ctx.kopfAktion();
  }
  const al = globale.find((r) => r.abteilungsleitung);
  haenge(
    inhalt,
    el(
      "p",
      { class: "leise rr-erklaerung" },
      verwaltet
        ? `Eine globale Rolle bündelt Rechte für die ganze Abteilung, zum Beispiel «Webmaster». Du weist sie einzelnen Personen zu. ${
            z.ich.abteilungsleitungAendern
              ? "Auch die Rechte der Abteilungsleitung stellst du ein."
              : "Die Rechte der Abteilungsleitung stellt der Entwickler ein: Du siehst sie in der Liste, kannst sie aber nicht ändern."
          }`
        : "Hier stellst du die Rechte der Abteilungsleitung ein. Die übrigen Rollen siehst du nur zum Lesen, ohne Namen von Personen.",
    ),
    al?.gesperrt &&
      el(
        "p",
        { class: "hinweis", role: "note" },
        icon("sperre"),
        " Diese Rechte setzt der Entwickler. Du kannst sie nicht ändern.",
      ),
  );
  if (globale.length === 0) {
    haenge(inhalt, leerKarte("Es gibt noch keine Rolle. Lege die erste an."));
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
            `${r.abteilungsleitung ? "Jedes Konto der Abteilungsleitung" : personenText(r.personen.length)} · ${r.rechte.length === 1 ? "1 Recht" : `${r.rechte.length} Rechte`}`,
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
  z.ctx.titel(
    rolle.name,
    rolle.abteilungsleitung ? "Eingebaute Rolle" : "Globale Rolle",
  );
  z.ctx.kopfAktion();
  const verwaltet = z.ich.rechteVerwalten;
  const fragenOrt = el("div", { class: "rr-fragen" });
  // Die Abteilungsleitung lässt sich weder umbenennen noch löschen
  const bearbeiten =
    verwaltet && !rolle.abteilungsleitung
      ? knopf("Umbenennen", {
          symbol: "bearbeiten",
          klein: true,
          onclick: () =>
            rolleBearbeitenSeite(z, rolle, {
              aendere: (felder) => aendereRolle(rolle, felder),
              danach: () => z.neu(),
            }),
        })
      : null;
  const loeschen =
    rolle.system || !verwaltet
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
        rolle.abteilungsleitung
          ? rolle.gesperrt
            ? "Diese Rechte setzt der Entwickler. Du kannst sie lesen, aber nicht ändern. Feste Rechte, zum Beispiel Rechte vergeben, hat die Abteilungsleitung immer."
            : "Du stellst die Rechte der Abteilungsleitung ein. Was du wegnimmst, fehlt jedem Konto der Abteilungsleitung ab der nächsten Anfrage. Feste Rechte, zum Beispiel Rechte vergeben, bleiben ihr immer. Änderungen bleiben im Entwurf, bis du unten speicherst."
          : "Eine globale Rolle gilt für die ganze Abteilung: «An» heisst für alle Objekte. Änderungen bleiben im Entwurf, bis du unten speicherst.",
      ),
      rechteRaster({ z, rollen: [rolle], art: "global", einzel: true }).wurzel,
    ),
    !rolle.abteilungsleitung && verwaltet && personenBlock(z, rolle, {}),
    festePunkte(z),
  );
}

import { fehlertext } from "./api.js";
import { el, knopf } from "./dom.js";
import { skeletonFlaeche } from "./lader.js";
import { zweiStufig } from "./rueckgaengig.js";
import { schuetze } from "./ungespeichert.js";
import {
  aendereRolle,
  ladeGrund,
  vorschau as ladeVorschau,
} from "./rechte-api.js";
import { ADRESSE, adresse } from "./rechte-gemeinsam.js";
import { siehtAlles } from "./sicht.js";
import {
  adresseGueltig,
  aenderungenJeRolle,
  anzahlAenderungen,
  anzahlRollen,
  basisWert,
  betroffene,
  grosseWirkungen,
  neuerEntwurf,
  personenText,
  rechteFehlerText,
  uebernehmeStand,
  vorschauText,
  zuteilungText,
  zuteilungenMitEntwurf,
} from "./rechte-modell.js";
import { zeigeGruppen } from "./rechte-gruppen.js";
import { zeigeRollen } from "./rechte-rollen.js";
import { zeigeUebersicht } from "./rechte-uebersicht.js";

// Rollen und Rechte (#623, #651): eine Seite für alles, was in der Abteilung vergeben wird. Drei Reiter mit eigener Adresse:
//   #personen/rechte/gruppen[/<id>[/rolle/<id>]]   Rechte je einzelne Gruppe: Gruppenrollen, Matrix, Mitglieder
//   #personen/rechte/rollen[/<id>]                 globale Rollen wie «Webmaster» mit dem ganzen Katalog
//   #personen/rechte/uebersicht[/person|recht|verlauf/…]   «Was darf wer?», «Wer darf das?» und der Verlauf
// Die Matrix-API (#643) liefert den Katalog und nimmt die Änderungen an; der Server prüft alles (nur Abteilungsleitung mit zweitem Faktor, Abteilung, Version, Eskalation).
// Änderungen an Rechten sammeln sich in einem Entwurf, bis jemand speichert; er bleibt beim Wechsel der Reiter und der Gruppen erhalten. Rollen anlegen, umbenennen, löschen und Personen zuordnen wirken sofort (mit «Rückgängig» oder zweiter Stufe).

// Entwurf (nur geänderte Zellen) und die Rollen, auf denen er beruht; beide überleben den Wechsel der Reiter
const entwurf = neuerEntwurf();
const speicher = new Map();
let drin = false;
window.addEventListener("hashchange", () => {
  if (!location.hash.startsWith(ADRESSE)) drin = false;
});

const REITER = [
  ["gruppen", "Gruppen"],
  ["rollen", "Rollen"],
  ["uebersicht", "Was darf wer?"],
];
// Wer «rechte.verwalten» nicht hat, aber «rechte.abteilungsleitung», sieht nur «Rollen» (#663). Seit #722 hat der Entwickler jedes Recht und sieht alle Reiter; dieser Fall tritt heute nicht mehr ein
const REITER_ENTWICKLER = [["rollen", "Rollen"]];

export function zeige(bereich, ctx) {
  // Hat der Bereich nur eine Unterseite (so sieht es der Entwickler), steht «rechte» noch vorn im Pfad
  const pfad = ctx.pfad[0] === "rechte" ? ctx.pfad.slice(1) : ctx.pfad;
  const [reiter = "gruppen", ...rest] = pfad;
  // Unbekannter Reiter oder Kennung, die keine UUID ist: «Diese Seite gibt es nicht», ohne eine Anfrage an den Server
  if (!adresseGueltig(reiter, rest)) return ctx.nichtGefunden();
  ctx.lade(
    ladeGrund,
    (daten, neu) => zeichne(bereich, ctx, daten, neu, reiter, rest),
    {
      skeleton: () =>
        el(
          "div",
          { class: "rr-skelett" },
          [0, 1].map(() => skeletonFlaeche({ zeilen: 5 })),
        ),
    },
  );
}

// Eine Rolle, die die Ansicht geladen hat, wird gemerkt; Zellen im Entwurf, die der Server inzwischen schon so hat, fallen weg
function merke(rolle, gruppeName) {
  rolle.gruppeName = gruppeName ?? null;
  speicher.set(rolle.id, rolle);
  const zellen = entwurf.get(rolle.id);
  if (!zellen) return;
  for (const [recht, wert] of [...zellen]) {
    if (wert === basisWert(rolle, recht)) zellen.delete(recht);
  }
  if (zellen.size === 0) entwurf.delete(rolle.id);
}

function zeichne(bereich, ctx, daten, neu, reiterWunsch, restWunsch) {
  const katalog = daten.katalog;
  const verwaltet = katalog.ich?.rechteVerwalten === true;
  const reiter = verwaltet ? reiterWunsch : "rollen";
  const rest = verwaltet || reiterWunsch === "rollen" ? restWunsch : [];
  const klartextVon = new Map(katalog.rechte.map((r) => [r.id, r.klartext]));
  const z = {
    ctx,
    katalog,
    ich: katalog.ich ?? {
      rechteVerwalten: true,
      abteilungsleitungAendern: false,
    },
    gruppen: daten.gruppen,
    globale: daten.globale,
    personen: daten.personen,
    stufen: daten.stufen,
    entwurf,
    neu,
    // Wer ohnehin alles darf und darum bei einer Rollenänderung nicht zählt: Abteilungsleitung und Entwickler
    ohnehinAlle: new Set(
      daten.personen.filter((p) => siehtAlles(p)).map((p) => p.id),
    ),
    klartext: (recht) => klartextVon.get(recht) ?? recht,
    reihenfolge: katalog.rechte.map((r) => r.id),
    merke,
    aenderung: () => {},
    // Eine gelöschte Rolle hat keinen Entwurf mehr
    vergissRolle: (rolle) => {
      entwurf.delete(rolle.id);
      speicher.delete(rolle.id);
      z.aenderung();
    },
  };
  for (const r of daten.globale) merke(r, null);

  const tabs = el(
    "nav",
    { class: "tabs", "aria-label": "Rollen und Rechte" },
    (verwaltet ? REITER : REITER_ENTWICKLER).map(([schluessel, name]) =>
      el(
        "a",
        {
          class: "tab",
          href: adresse(schluessel),
          ...(schluessel === reiter && { "aria-current": "page" }),
        },
        name,
      ),
    ),
  );
  const inhalt = el("div", { class: "rr-inhalt" });
  const leiste = baueLeiste(z);
  z.aenderung = leiste.aktualisiere;
  bereich.append(
    ...[hinweisband(katalog.modus), tabs, inhalt, leiste.wurzel].filter(
      Boolean,
    ),
  );
  if (entwurf.size > 0 && !drin) {
    ctx.melde("Deine ungespeicherten Änderungen sind wieder da.", "warn");
  }
  drin = true;
  const ansicht =
    reiter === "rollen"
      ? zeigeRollen
      : reiter === "uebersicht"
        ? zeigeUebersicht
        : zeigeGruppen;
  ansicht(inhalt, z, rest);
  leiste.aktualisiere();
  // Adressen innerhalb von «Rollen und Rechte» (Reiter, Gruppen) behalten den Entwurf; alles andere fragt zuerst (#699)
  schuetze({
    schluessel: "rechte",
    wurzel: bereich,
    geaendert: () => anzahlAenderungen(entwurf) > 0,
    innerhalb: (hash) => hash.startsWith(ADRESSE),
    text: "Rechte",
    verwerfen: () => entwurf.clear(),
  });
}

// Wie der Server gerade entscheidet: alt (Rollen wirken nicht), schatten (Rollen wirken zusätzlich), neu (nur Rollen und feste Regeln)
function hinweisband(modus) {
  if (modus === "neu") return null;
  const text =
    modus === "alt"
      ? "Das neue Rechtemodell ist abgeschaltet. Was du hier einstellst, wird gespeichert, wirkt aber nicht, bis der Betreiber es einschaltet."
      : "Das neue Rechtemodell läuft im Übergang. Rechte aus Rollen wirken zusätzlich zu den bisherigen Regeln. Ein Recht wegnehmen wirkt bei Rollen und Gruppen erst, wenn der Betreiber auf «neu» umgestellt hat; bei der Abteilungsleitung wirkt es sofort.";
  return el(
    "div",
    { class: "hinweis hinweis--warn", role: "note" },
    el("span", {}, text),
  );
}

// Die Leiste mit den ungespeicherten Änderungen haftet unten: Zahl, Vorschau «wer ist betroffen», Verwerfen, Speichern (bei grosser Wirkung zweistufig)
function baueLeiste(z) {
  const wurzel = el("section", {
    class: "rr-speicherleiste",
    "aria-label": "Ungespeicherte Änderungen",
    hidden: true,
  });
  const zahl = el("p", { class: "rr-speicherzahl", role: "status" });
  const vorschauBlock = el("details", { class: "rr-vorschau" });
  const verwerfen = knopf("Verwerfen", { art: "still" });
  const speichern = knopf("Speichern", { art: "haupt", symbol: "haken" });
  const zweistufig = zweiStufig(speichern, {});
  wurzel.append(
    zahl,
    vorschauBlock,
    el("div", { class: "rr-speicherknoepfe" }, verwerfen, speichern),
  );

  const rollenListe = () =>
    [...entwurf.keys()].map((id) => speicher.get(id)).filter(Boolean);
  let frage = null;
  let vorschauLauf = 0;

  const rolleName = (r) =>
    r.gruppeName ? `«${r.name}» in «${r.gruppeName}»` : `«${r.name}»`;

  function aktualisiere() {
    const n = anzahlAenderungen(entwurf);
    wurzel.hidden = n === 0;
    zahl.textContent =
      n === 0
        ? ""
        : `${n === 1 ? "1 Änderung" : `${n} Änderungen`} in ${anzahlRollen(entwurf) === 1 ? "1 Rolle" : `${anzahlRollen(entwurf)} Rollen`}, noch nicht gespeichert`;
    if (n === 0) return;
    const rollen = rollenListe();
    const gross = grosseWirkungen(rollen, entwurf);
    frage =
      gross.length > 0
        ? `Wirklich speichern? Grosse Wirkung: ${[...new Set(gross.map((g) => `«${z.klartext(g.recht)}» für ${rolleName(g.rolle)}`))].join(", ")}.`
        : null;
    // Die Rechte der Abteilungsleitung ändern immer, was die Abteilung kann: Das fragt noch einmal
    if (rollen.some((r) => r.abteilungsleitung)) {
      frage = `Wirklich speichern? Das ändert, was die Abteilungsleitung darf.${frage ? frage.replace("Wirklich speichern?", "") : ""}`;
    }
    const b = betroffene(rollen, entwurf, z.ohnehinAlle);
    const offen = vorschauBlock.open;
    vorschauBlock.replaceChildren(
      el(
        "summary",
        {},
        rollen.every((r) => r.abteilungsleitung)
          ? "Vorschau: die Abteilungsleitung ist betroffen"
          : b.personen === 0
            ? "Vorschau: niemand betroffen"
            : `Vorschau: ${personenText(b.personen)} betroffen`,
      ),
      el(
        "p",
        { class: "klein" },
        rollen.every((r) => r.abteilungsleitung)
          ? "Die Änderung gilt für jedes Konto der Abteilungsleitung ab der nächsten Anfrage."
          : vorschauText(b),
      ),
      el(
        "ul",
        { class: "rr-vorschau-liste" },
        b.jeRolle.map((a) =>
          el(
            "li",
            {},
            el("strong", {}, rolleName(a.rolle)),
            a.rolle.abteilungsleitung
              ? " Gilt für jedes Konto der Abteilungsleitung. "
              : ` ${personenText(a.personen)}. `,
            a.hinzu.length > 0 &&
              `Dazu: ${a.hinzu.map((x) => zuteilungText({ recht: x.recht, geltung: x.nach }, z.klartext)).join(", ")}. `,
            a.weg.length > 0 &&
              `Weg: ${a.weg.map((x) => z.klartext(x.recht)).join(", ")}.`,
          ),
        ),
      ),
      el(
        "p",
        { class: "klein leise", "data-server": "" },
        "Die Abteilungsleitung zählt hier nicht mit, solange sie das Recht ohnehin hat.",
      ),
    );
    vorschauBlock.open = offen;
    if (offen) holeVorschau();
  }

  // Beim Öffnen: die Zahlen noch einmal vom Server (es wird nichts geschrieben)
  async function holeVorschau() {
    const lauf = ++vorschauLauf;
    const hinweis = vorschauBlock.querySelector("[data-server]");
    const gruppenRollen = aenderungenJeRolle(rollenListe(), entwurf).filter(
      (a) => a.rolle.art === "gruppe",
    );
    if (gruppenRollen.length === 0 || !hinweis) return;
    try {
      const antworten = await Promise.all(
        gruppenRollen.map((a) =>
          ladeVorschau(
            a.rolle,
            zuteilungenMitEntwurf(a.rolle, entwurf, z.reihenfolge),
          ),
        ),
      );
      if (lauf !== vorschauLauf || !hinweis.isConnected) return;
      const summe = antworten.reduce((s, x) => s + x.personen, 0);
      hinweis.textContent = `Der Server zählt ${personenText(summe)} in den geänderten Gruppenrollen. Die Abteilungsleitung zählt nicht mit, solange sie das Recht ohnehin hat.`;
    } catch {
      // Die lokale Zahl bleibt stehen
    }
  }
  vorschauBlock.addEventListener("toggle", () => {
    if (vorschauBlock.open) holeVorschau();
  });

  verwerfen.addEventListener("click", () => {
    entwurf.clear();
    z.neu();
  });
  speichern.addEventListener("click", () => {
    if (frage) zweistufig.verlange(frage, () => sichere(z));
    else sichere(z);
  });
  return { wurzel, aktualisiere };
}

// Schreibt jede geänderte Rolle einzeln, mit der Version, auf der der Entwurf beruht. Hat jemand die Rolle inzwischen geändert (409), bleibt sie mit den eigenen Zellen im Entwurf stehen, auf dem neuen Stand, und nichts wird überschrieben
async function sichere(z) {
  const fehler = [];
  let gespeichert = 0;
  for (const id of [...entwurf.keys()]) {
    const rolle = speicher.get(id);
    if (!rolle) {
      entwurf.delete(id);
      continue;
    }
    const zuteilungen = zuteilungenMitEntwurf(rolle, entwurf, z.reihenfolge);
    const name = rolle.gruppeName
      ? `«${rolle.name}» in «${rolle.gruppeName}»`
      : `«${rolle.name}»`;
    try {
      const antwort = await aendereRolle(rolle, {
        version: rolle.version,
        rechte:
          rolle.art === "global"
            ? zuteilungen.map((x) => x.recht)
            : zuteilungen,
      });
      rolle.rechte = zuteilungen;
      rolle.version = antwort?.version ?? rolle.version + 1;
      entwurf.delete(id);
      gespeichert++;
    } catch (f) {
      if (f.code === "VERSION_KONFLIKT" && f.daten?.aktuell) {
        uebernehmeStand(entwurf, rolle, f.daten.aktuell);
        fehler.push(`${name}: ${rechteFehlerText(f)}`);
      } else {
        fehler.push(`${name}: ${rechteFehlerText(f, fehlertext(f))}`);
      }
    }
  }
  if (fehler.length > 0) {
    z.ctx.melde(
      `${gespeichert > 0 ? `${gespeichert === 1 ? "1 Rolle" : `${gespeichert} Rollen`} gespeichert. ` : ""}Nicht gespeichert: ${fehler.join(" ")}`,
      "fehler",
    );
  } else {
    z.ctx.melde(
      `Gespeichert. ${gespeichert === 1 ? "Die Rolle gilt" : "Die Rollen gelten"} ab der nächsten Anfrage der Personen.`,
    );
  }
  z.neu();
}

import { anfrage, fehlertext } from "./api.js";
import { el, knopf } from "./dom.js";
import { skeletonFlaeche } from "./lader.js";
import { zweiStufig } from "./rueckgaengig.js";
import {
  aenderungen,
  anzahlAenderungen,
  betroffene,
  infoVon,
  vorschauText,
} from "./rechte-logik.js";
import { ADRESSE, adresse, zeigeWartende } from "./rechte-gemeinsam.js";
import { zeigeGruppen } from "./rechte-gruppen.js";
import { zeigeRollen } from "./rechte-rollen.js";
import { zeigeUebersicht } from "./rechte-uebersicht.js";

// Rollen und Rechte (#623): eine Seite für alles, was in der Abteilung vergeben wird. Drei Reiter mit eigener Adresse:
//   #personen/rechte                  Rollen: Plattformrollen wie «Webmaster», Rechte als Matrix, Personen der Rolle
//   #personen/rechte/rolle/<id>       eine Rolle im Einzelnen (der Hauptweg ohne Tabelle, auch mobil)
//   #personen/rechte/gruppen[/<id>]   was Gruppen und Teams heute an Rechten tragen
//   #personen/rechte/uebersicht[/<id>] «Was darf wer?», nur lesen
// Nichts davon erweitert das Rechtemodell: Die Seite zeigt und ändert, was die API schon kennt (/admin/plattform/rollen, /admin/tags, /admin/bearbeiter, /admin/rechte/zuordnungen). Der Server prüft jede Änderung selbst; wer ein Recht vergibt, hat es selbst.
// Die Rechte der Rollen sammeln sich in einem Entwurf, bis jemand speichert; er bleibt beim Wechsel der Reiter erhalten.

// Entwurf der Rechte je Rolle: Rolle-Kennung -> Set der Rechte, und der Stand des Servers, auf dem er beruht
const entwurf = new Map();
const basis = new Map();
// Ist die Person gerade auf dieser Seite (und nicht erst zurückgekehrt)?
let drin = false;
window.addEventListener("hashchange", () => {
  if (!location.hash.startsWith(ADRESSE)) {
    drin = false;
    window.onbeforeunload = null;
  }
});

const REITER = [
  ["rollen", "Rollen"],
  ["gruppen", "Gruppen"],
  ["uebersicht", "Was darf wer?"],
];

const schluesselVon = (rolle) => [...rolle.rechte].sort().join(",");

export function zeige(bereich, ctx) {
  const [reiter = "rollen", ...rest] = ctx.pfad;
  ctx.lade(
    ladeAlles,
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

// Eine Runde Abfragen: Rollen mit Rechtekatalog, Personen mit Stufenrollen, Zuordnungen von Gruppen, Lagern, Räumen und Sonderrechten
async function ladeAlles() {
  const [rollen, personen, zuordnungen] = await Promise.all([
    anfrage("GET", "/api/v1/admin/plattform/rollen"),
    anfrage("GET", "/api/v1/admin/personen"),
    anfrage("GET", "/api/v1/admin/rechte/zuordnungen"),
  ]);
  return {
    katalog: rollen.katalog,
    rollen: rollen.rollen,
    personen: personen.personen,
    stufen: personen.stufen,
    ...zuordnungen,
  };
}

// Ein Entwurf, dessen Rolle sich inzwischen geändert hat oder weg ist, gilt nicht mehr
function pruefeEntwurf(rollen, ctx) {
  for (const id of [...entwurf.keys()]) {
    const rolle = rollen.find((r) => r.id === id);
    if (!rolle || basis.get(id) !== schluesselVon(rolle)) {
      entwurf.delete(id);
      basis.delete(id);
      ctx.melde(
        `Die Rolle «${rolle?.name ?? "?"}» hat sich inzwischen geändert. Deine Änderungen daran sind verworfen.`,
        "warn",
      );
    }
  }
}

function zeichne(bereich, ctx, daten, neu, reiter, rest) {
  zeigeWartende(ctx);
  pruefeEntwurf(daten.rollen, ctx);
  const adminIds = new Set(
    daten.personen.filter((p) => p.admin).map((p) => p.id),
  );
  const zustand = {
    ctx,
    daten,
    neu,
    entwurf,
    // Merkt den Stand des Servers, bevor die erste Änderung an dieser Rolle gilt
    merke: (rolle) => {
      if (!basis.has(rolle.id)) basis.set(rolle.id, schluesselVon(rolle));
    },
    vergessen: (rolle) => {
      if (!entwurf.has(rolle.id)) basis.delete(rolle.id);
    },
    aktualisiereLeiste: () => {},
    adminIds,
    titelVon: (recht) =>
      infoVon(recht, daten.katalog.find((k) => k.recht === recht)?.bedeutung)
        .titel,
    wirkungVon: (recht) =>
      infoVon(
        recht,
        daten.katalog.find((k) => k.recht === recht)?.bedeutung,
      ).wirkung.text.toLowerCase(),
    heikelVon: (recht) =>
      infoVon(recht, daten.katalog.find((k) => k.recht === recht)?.bedeutung)
        .wirkung.heikel,
  };

  const tabs = el(
    "nav",
    { class: "tabs", "aria-label": "Rollen und Rechte" },
    REITER.map(([schluessel, name]) =>
      el(
        "a",
        {
          class: "tab",
          href: schluessel === "rollen" ? ADRESSE : adresse(schluessel),
          ...(schluessel === (reiter === "rolle" ? "rollen" : reiter) && {
            "aria-current": "page",
          }),
        },
        name,
      ),
    ),
  );
  const inhalt = el("div", { class: "rr-inhalt" });
  const leiste = baueLeiste(zustand);
  zustand.aktualisiereLeiste = leiste.aktualisiere;
  bereich.append(
    el(
      "div",
      { class: "hinweis hinweis--info", role: "note" },
      el(
        "span",
        {},
        "Nur die Abteilungsleitung stellt das ein, mit zweitem Faktor. Der Server prüft jede Änderung noch einmal und vergibt nie mehr, als du selbst hast. Rechte gelten ab der nächsten Anfrage der Person.",
      ),
    ),
    tabs,
    inhalt,
    leiste.wurzel,
  );
  // Nur beim Zurückkehren auf die Seite, nicht bei jedem Neuladen darin
  if (entwurf.size > 0 && !drin) {
    ctx.melde("Deine ungespeicherten Änderungen sind wieder da.", "warn");
  }
  drin = true;
  const ansicht =
    reiter === "gruppen"
      ? zeigeGruppen
      : reiter === "uebersicht"
        ? zeigeUebersicht
        : zeigeRollen;
  ansicht(inhalt, zustand, reiter === "rolle" ? ["rolle", ...rest] : rest);
  leiste.aktualisiere();
  schuetzeVorVerlassen(bereich, leiste);
}

// Die Leiste mit den ungespeicherten Änderungen haftet unten: Zahl, Vorschau «wer ist betroffen», Verwerfen, Speichern (bei heiklen Rechten zweistufig)
function baueLeiste(z) {
  const wurzel = el("section", {
    class: "rr-speicherleiste",
    "aria-label": "Ungespeicherte Änderungen",
    hidden: true,
  });
  const zahl = el("p", { class: "rr-speicherzahl", role: "status" });
  const vorschau = el("details", { class: "rr-vorschau" });
  const verwerfen = knopf("Verwerfen", { art: "still" });
  const speichern = knopf("Speichern", { art: "haupt", symbol: "haken" });
  const zweistufig = zweiStufig(speichern, {});
  wurzel.append(
    zahl,
    vorschau,
    el("div", { class: "rr-speicherknoepfe" }, verwerfen, speichern),
  );

  let heikelFrage = null;
  function aktualisiere() {
    const rollen = z.daten.rollen;
    const n = anzahlAenderungen(rollen, z.entwurf);
    wurzel.hidden = n === 0;
    window.onbeforeunload = n > 0 ? (e) => e.preventDefault() : null;
    zahl.textContent =
      n === 1
        ? "1 Änderung, noch nicht gespeichert"
        : `${n} Änderungen, noch nicht gespeichert`;
    if (n === 0) return;
    const b = betroffene(rollen, z.entwurf, z.adminIds, z.heikelVon);
    const zusammen = [...b.heikel.values()].reduce((s, x) => s + x, 0);
    heikelFrage =
      zusammen > 0
        ? `Wirklich speichern? ${[...b.heikel.keys()].map((r) => `«${z.titelVon(r)}» (${z.wirkungVon(r)})`).join(", ")}.`
        : null;
    const offen = vorschau.open;
    vorschau.replaceChildren(
      el(
        "summary",
        {},
        b.personen.size === 0
          ? "Vorschau: niemand betroffen"
          : `Vorschau: ${b.personen.size === 1 ? "1 Person" : `${b.personen.size} Personen`} betroffen`,
      ),
      el("p", { class: "klein" }, vorschauText(b, z.titelVon)),
      el(
        "p",
        { class: "klein leise" },
        "Die Abteilungsleitung hat ohnehin jedes Recht und zählt nicht mit. Die Vorschau rechnet nur mit Rollen; Gruppen und Stufenrollen bleiben, wie sie sind.",
      ),
    );
    vorschau.open = offen;
  }

  verwerfen.addEventListener("click", () => {
    z.entwurf.clear();
    basis.clear();
    z.neu();
  });
  speichern.addEventListener("click", () => {
    if (heikelFrage) zweistufig.verlange(heikelFrage, () => sichere(z));
    else sichere(z);
  });
  return { wurzel, aktualisiere };
}

// Schreibt jede geänderte Rolle einzeln. Vorher fragt es den Stand noch einmal ab: Hat jemand eine Rolle inzwischen geändert, bleibt sie im Entwurf stehen und nichts wird überschrieben.
async function sichere(z) {
  const { ctx } = z;
  const fehler = [];
  let gespeichert = 0;
  try {
    const frisch = (await anfrage("GET", "/api/v1/admin/plattform/rollen"))
      .rollen;
    for (const a of aenderungen(z.daten.rollen, z.entwurf)) {
      const jetzt = frisch.find((r) => r.id === a.rolle.id);
      if (!jetzt || schluesselVon(jetzt) !== basis.get(a.rolle.id)) {
        fehler.push(`«${a.rolle.name}» hat sich inzwischen geändert.`);
        continue;
      }
      const rechte = z.daten.katalog
        .map((k) => k.recht)
        .filter((r) => z.entwurf.get(a.rolle.id).has(r));
      try {
        await anfrage("PATCH", `/api/v1/admin/plattform/rollen/${a.rolle.id}`, {
          rechte,
        });
        z.entwurf.delete(a.rolle.id);
        basis.delete(a.rolle.id);
        gespeichert++;
      } catch (f) {
        fehler.push(`«${a.rolle.name}»: ${fehlertext(f)}`);
      }
    }
  } catch (f) {
    fehler.push(fehlertext(f));
  }
  if (fehler.length > 0) {
    ctx.melde(
      `${gespeichert > 0 ? `${gespeichert} Rolle(n) gespeichert. ` : ""}Nicht gespeichert: ${fehler.join(" ")}`,
      "fehler",
    );
  } else {
    ctx.melde(
      `Gespeichert. ${gespeichert === 1 ? "Die Rolle gilt" : "Die Rollen gelten"} ab der nächsten Anfrage der Personen.`,
    );
  }
  z.neu();
}

// Ein Link aus der Seite heraus, während etwas ungespeichert ist: erst fragen. Browser-Zurück und Tab schliessen deckt beforeunload ab.
function schuetzeVorVerlassen(bereich, leiste) {
  const beiKlick = (e) => {
    if (!bereich.isConnected) {
      document.removeEventListener("click", beiKlick, true);
      return;
    }
    if (entwurf.size === 0) return;
    const a = e.target.closest?.("a[href^='#']");
    const ziel = a?.getAttribute("href");
    if (!a || ziel === "#inhalt" || ziel === "#" || ziel.startsWith(ADRESSE)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (bereich.querySelector(".rr-verlassen")) return;
    const bleiben = knopf("Bleiben", { klein: true });
    const gehen = knopf("Verwerfen und gehen", { klein: true });
    const frage = el(
      "div",
      { class: "hinweis hinweis--warn rr-verlassen", role: "alert" },
      el(
        "span",
        {},
        "Du hast nicht gespeicherte Änderungen an Rollen. Wenn du gehst, sind sie weg.",
      ),
      bleiben,
      gehen,
    );
    bleiben.addEventListener("click", () => {
      frage.remove();
      leiste.wurzel.querySelector("button")?.focus();
    });
    gehen.addEventListener("click", () => {
      entwurf.clear();
      basis.clear();
      window.onbeforeunload = null;
      location.hash = ziel;
    });
    bereich.prepend(frage);
    bleiben.focus();
  };
  document.addEventListener("click", beiKlick, true);
}

import { anfrage } from "./api.js";
import { filterleiste } from "./filterleiste.js";
import { el, knopf } from "./dom.js";
import { skeletonFlaeche } from "./lader.js";
import { zweistufig } from "./rueckgaengig.js";
import { leerKarte } from "./zustaende.js";
import {
  ADRESSE,
  haenge,
  BASIS,
  meldung,
  symbol,
  zurueckLink,
} from "./lager-gemeinsam.js";

// Rechte der Rollen eines Lagers (#527, Board A23; #592): in Klartext, nach Bereichen gruppiert, mit Filter nach Lesen und Ändern. Nur die Darstellung ist neu: Die Rechte (Schlüssel, Standard, Speichern) stammen unverändert von GET und PUT /api/v1/admin/lager/{id}/rechte, der Server prüft jedes Recht weiter selbst. Zwei Abfragen (Lager, Rechte), kein Polling.

export function zeige(bereich, ctx, id) {
  ctx.lade(
    () =>
      Promise.all([
        anfrage("GET", `${BASIS}/${id}`),
        anfrage("GET", `${BASIS}/${id}/rechte`),
      ]),
    ([l, r], neu) => zeichneRechte(bereich, ctx, l, r.rechte, neu),
    {
      skeleton: () =>
        el(
          "div",
          { class: "lg-rechtegruppen" },
          [0, 1, 2].map(() => skeletonFlaeche({ zeilen: 3 })),
        ),
    },
  );
}

const geschlossen = (l) =>
  l.status === "abgeschlossen" || l.status === "archiviert";
const EINSTELLBAR = [
  ["leitung", "Leitung"],
  ["team", "Team"],
  ["lesen", "Lesen"],
];

// Die Bereiche, in die der Schlüssel vor dem Punkt gehört, mit Namen für Menschen. Unbekannte Bereiche (neue Rechte im Server) erscheinen mit grossem Anfangsbuchstaben
const BEREICHE = {
  ressorts: "Ressorts",
  aufgaben: "Aufgaben",
  zeitplan: "Zeitplan",
  vorlagen: "Vorlagen",
  check: "Lager-Check",
  hoecks: "Höcks",
  protokolle: "Protokolle",
  pinnwand: "Pinnwand",
  interaktion: "Stimmen und Reaktionen",
  eingang: "Eingang",
  teilnehmer: "Teilnehmende",
  einteilung: "Einteilung",
  abzaehlen: "Abzählen",
  diensttausch: "Diensttausch",
  anwesenheit: "Anwesenheit",
  tagesseiten: "Tagesseiten",
  einkauf: "Einkauf",
  packliste: "Packliste",
  notfall: "Notfall-Kontakte",
  infos: "Infos",
  vertrauliches: "Vertrauliches",
  wetter: "Wetter",
  dokumente: "Dokumente",
  adressbuch: "Adressbuch",
  verlauf: "Verlauf",
};
// Wenige Beschreibungen des Servers nennen interne Wörter; hier stehen sie in Klartext
const KLARTEXT = {
  "hoecks.team_lesen": "Höcks lesen, die für das Team gedacht sind",
  "dokumente.team_lesen": "Dokumente lesen, die für das Team freigegeben sind",
  "vertrauliches.lesen":
    "Vertrauliche Einträge lesen, die nur für die Lagerleitung gedacht sind",
};
const bereichName = (recht) => {
  const k = recht.split(".")[0];
  return BEREICHE[k] ?? k.charAt(0).toUpperCase() + k.slice(1);
};
// Lesen oder Ändern: «eigene» Rechte und alle mit lesen im Namen gelten als Lesen bzw. Ändern nach dem Wortlaut des Schlüssels
const art = (recht) =>
  recht.split(".")[1]?.startsWith("lesen") || recht.endsWith("_lesen")
    ? "lesen"
    : "aendern";

function zeichneRechte(bereich, ctx, lager, rechte, neu) {
  ctx.titel("Rechte der Rollen", lager.titel);
  const zu = geschlossen(lager);
  // Geändert gegenüber dem geladenen Stand: "rolle|recht" -> erlaubt
  const geaendert = new Map();
  const kisten = new Map(); // "rolle|recht" -> { box, zeile }
  const leiste = el("div", {
    class: "lg-speicherleiste",
    role: "region",
    "aria-label": "Ungespeicherte Änderungen",
    hidden: true,
  });
  const anzahl = el("span", { class: "lg-speicherzahl", role: "status" });
  const speichern = knopf("Speichern", { art: "haupt", symbol: "haken" });
  const verwerfen = knopf("Verwerfen", { art: "still" });
  leiste.append(anzahl, verwerfen, speichern);

  const zeigeStand = () => {
    const n = geaendert.size;
    leiste.hidden = n === 0;
    anzahl.textContent =
      n === 1
        ? "1 Änderung, noch nicht gespeichert"
        : `${n} Änderungen, noch nicht gespeichert`;
    // Beim Verlassen ohne Speichern gehen die Änderungen verloren (Neuladen, Tab schliessen)
    window.onbeforeunload = n > 0 ? (e) => e.preventDefault() : null;
  };
  // Wer die Seite wechselt, nimmt die Warnung mit
  window.addEventListener("hashchange", () => (window.onbeforeunload = null), {
    once: true,
  });
  verwerfen.addEventListener("click", () => {
    for (const [k, { box, zeile }] of kisten) {
      const [rolle, recht] = k.split("|");
      box.checked = rechte.find((r) => r.recht === recht).aktuell[rolle];
      zeile.classList.remove("ist-geaendert");
    }
    geaendert.clear();
    zeigeStand();
  });
  speichern.addEventListener("click", async () => {
    speichern.disabled = verwerfen.disabled = true;
    speichern.setAttribute("aria-busy", "true");
    try {
      await anfrage("PUT", `${BASIS}/${lager.id}/rechte`, {
        rechte: [...geaendert].map(([k, erlaubt]) => {
          const [rolle, recht] = k.split("|");
          return { rolle, recht, erlaubt };
        }),
      });
      geaendert.clear();
      zeigeStand();
      await neu();
      ctx.melde(
        "Die Rechte sind gespeichert. Sie gelten ab der nächsten Anfrage.",
      );
    } catch (f) {
      speichern.removeAttribute("aria-busy");
      speichern.disabled = verwerfen.disabled = false;
      ctx.melde(meldung(f), "fehler");
    }
  });

  // Rechte gelten ab der nächsten Anfrage für andere: keine Frist, sondern zwei Stufen im Knopf statt eines Popups (#578). Nicht gespeicherte Änderungen hier gehen verloren
  const zuruecksetzen = zweistufig(
    knopf("Auf Standard zurücksetzen", { symbol: "aktualisieren" }),
    "Wirklich zurücksetzen?",
    async () => {
      try {
        await anfrage("POST", `${BASIS}/${lager.id}/rechte/zuruecksetzen`);
        geaendert.clear();
        zeigeStand();
        await neu();
        ctx.melde(
          "Die Rechte sind auf den Standard zurückgesetzt. Leitung, Team und Lesen haben wieder die Rechte des Katalogs.",
        );
      } catch (f) {
        ctx.melde(meldung(f), "fehler");
      }
    },
  );
  ctx.kopfAktion(...(zu ? [] : [zuruecksetzen]));

  const gruppen = new Map();
  for (const r of rechte) {
    const name = bereichName(r.recht);
    if (!gruppen.has(name)) gruppen.set(name, []);
    gruppen.get(name).push(r);
  }

  const zeilen = rechte.map((r) => {
    const text = KLARTEXT[r.recht] ?? r.bedeutung;
    const abweichung = EINSTELLBAR.some(
      ([rolle]) => r.aktuell[rolle] !== r.standard[rolle],
    );
    const zeile = el("li", { class: "lg-recht" });
    const kopf = el(
      "p",
      { class: "lg-rechttext", id: `lg-r-${r.recht}` },
      text,
    );
    const schalter = EINSTELLBAR.map(([rolle, name]) => {
      const box = el("input", {
        type: "checkbox",
        disabled: zu,
        onchange: () => {
          const k = `${rolle}|${r.recht}`;
          if (box.checked === r.aktuell[rolle]) geaendert.delete(k);
          else geaendert.set(k, box.checked);
          zeile.classList.toggle(
            "ist-geaendert",
            [...geaendert.keys()].some((x) => x.endsWith(`|${r.recht}`)),
          );
          zeigeStand();
        },
      });
      box.checked = r.aktuell[rolle];
      kisten.set(`${rolle}|${r.recht}`, { box, zeile });
      return el(
        "label",
        { class: "lg-schalter" },
        box,
        el("span", {}, name),
        el("span", { class: "nur-leser" }, `: ${text}`),
      );
    });
    zeile.append(
      el(
        "div",
        { class: "lg-rechtinfo" },
        kopf,
        abweichung &&
          el(
            "span",
            { class: "chip chip--warn" },
            symbol("info"),
            "Weicht vom Standard ab",
          ),
        el(
          "span",
          { class: "nur-leser lg-geaendert" },
          "Geändert, noch nicht gespeichert",
        ),
      ),
      el(
        "div",
        {
          class: "lg-schalterzeile",
          role: "group",
          "aria-labelledby": `lg-r-${r.recht}`,
        },
        schalter,
      ),
    );
    zeile.dataset.art = art(r.recht);
    zeile.dataset.abweichend = abweichung ? "ja" : "nein";
    zeile.dataset.suche = `${text} ${bereichName(r.recht)}`.toLowerCase();
    return zeile;
  });
  const zeileVon = new Map(rechte.map((r, i) => [r.recht, zeilen[i]]));

  const karten = [...gruppen].map(([name, liste]) => {
    const ul = el(
      "ul",
      { class: "lg-rechteliste" },
      liste.map((r) => zeileVon.get(r.recht)),
    );
    return {
      ul,
      wurzel: el(
        "section",
        { class: "flaeche lg-rechtegruppe", "aria-label": name },
        el("h2", {}, name),
        ul,
      ),
    };
  });
  const leer = el("div");
  const filter = filterleiste({
    suche: { label: "Recht suchen" },
    filter: [
      {
        schluessel: "art",
        label: "Art",
        grundwert: "alle",
        optionen: [
          ["alle", "Alle"],
          ["lesen", "Lesen"],
          ["aendern", "Ändern"],
        ],
      },
      {
        schluessel: "abweichung",
        label: "Standard",
        grundwert: "alle",
        optionen: [
          ["alle", "Alle"],
          ["ja", "Weicht ab"],
        ],
      },
    ],
    namen: { einzahl: "Recht", mehrzahl: "Rechte" },
    beiAenderung: ({ suche, filter: f }) => {
      const q = suche.trim().toLowerCase();
      let n = 0;
      for (const z of zeilen) {
        z.hidden = !(
          (q === "" || z.dataset.suche.includes(q)) &&
          (f.art === "alle" || z.dataset.art === f.art) &&
          (f.abweichung === "alle" || z.dataset.abweichend === "ja")
        );
        if (!z.hidden) n++;
      }
      for (const k of karten)
        k.wurzel.hidden = [...k.ul.children].every((z) => z.hidden);
      leer.replaceChildren();
      if (n === 0)
        leer.append(
          leerKarte("Kein Recht passt zu deiner Suche.", [
            knopf("Filter zurücksetzen", {
              onclick: () => filter.setzeAlles(),
            }),
          ]),
        );
      filter.setzeTreffer(n, zeilen.length);
    },
  });
  filter.setzeTreffer(zeilen.length, zeilen.length);

  haenge(
    bereich,
    !ctx.imRahmen &&
      zurueckLink(`Zum Lager «${lager.titel}»`, `${ADRESSE}/${lager.id}`),
    zu &&
      el(
        "div",
        { class: "hinweis hinweis--info", role: "status" },
        el(
          "span",
          {},
          "Das Lager ist schreibgeschützt. Öffne es wieder, wenn du etwas ändern willst.",
        ),
      ),
    el(
      "div",
      { class: "hinweis hinweis--info", role: "status" },
      el(
        "span",
        {},
        "Die Lagerleitung darf immer alles und lässt sich nicht einstellen. Die Rechte gelten nur in diesem Lager und ab der nächsten Anfrage der Person.",
      ),
    ),
    filter.wurzel,
    el(
      "div",
      { class: "lg-rechtegruppen" },
      karten.map((k) => k.wurzel),
    ),
    leer,
    leiste,
  );
}

import { anfrage, fehlertext } from "./api.js";
import { auswahl, chip, el, icon, knopf } from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import { personZeile } from "./personen-wahl.js";
import { zweistufig } from "./rueckgaengig.js";
import { gruppeTraegt, istVerantwortlich } from "./rechte-logik.js";
import {
  adresse,
  bestaetigeAmOrt,
  kandidatVon,
  zurueckLink,
  haenge,
} from "./rechte-gemeinsam.js";
import { TYPEN, typName } from "./tags-detail.js";
import { leerKarte } from "./zustaende.js";

// Reiter «Gruppen» (#623): was Gruppen und Teams heute an Rechten tragen und was sich daran einstellen lässt. Es gibt dafür keine eigene Tabelle und kein neues Recht: Die Wirkungen hängen an vorhandenen Zeilen:
//   Rolle «verantwortlich» in einem Team (person_tag)  Seite des Teams bearbeiten und veröffentlichen
//   Team eines Raums (raum.team_tag_id)                Raumanfragen entscheiden (alle Mitglieder)
//   Zeilen in bearbeiter mit einer Gruppe              genau eine Seite bearbeiten und veröffentlichen
//   Typ «team» oder «funktion»                         Termine vorschlagen
// Änderungen laufen über /admin/tags und /admin/bearbeiter; der Server prüft sie selbst. Was darüber hinausgeht, steht ehrlich als «noch nicht möglich» da.

export function zeigeGruppen(inhalt, z, pfad) {
  if (pfad[0]) return zeigeGruppe(inhalt, z, pfad[0]);
  zeigeListe(inhalt, z);
}

const mitglieder = (n) => (n === 1 ? "1 Mitglied" : `${n} Mitglieder`);

// ---------- Liste ----------

function zeigeListe(inhalt, z) {
  const { daten } = z;
  if (daten.gruppen.length === 0) {
    haenge(inhalt, leerKarte("Es gibt noch keine Gruppe.", []));
    return;
  }
  const REIHE = { team: 0, funktion: 1, stufe: 2, lager: 3 };
  const sortiert = [...daten.gruppen].sort(
    (a, b) =>
      REIHE[a.typ] - REIHE[b.typ] || a.name.localeCompare(b.name, "de-CH"),
  );
  const karten = sortiert.map((g) => ({
    g,
    wurzel: karte(g, z),
    suche: `${g.name} ${typName(g.typ)}`.toLowerCase(),
  }));
  const liste = el(
    "ul",
    { class: "rr-gruppenliste" },
    karten.map((k) => k.wurzel),
  );
  const leer = el("div");
  const leiste = filterleiste({
    suche: { label: "Gruppe suchen" },
    filter: [
      {
        schluessel: "typ",
        label: "Typ",
        grundwert: "alle",
        optionen: [["alle", "Alle Typen"], ...TYPEN],
      },
    ],
    namen: { einzahl: "Gruppe", mehrzahl: "Gruppen" },
    beiAenderung: ({ suche, filter: f }) => {
      const q = suche.trim().toLowerCase();
      let n = 0;
      for (const k of karten) {
        k.wurzel.hidden = !(
          (q === "" || k.suche.includes(q)) &&
          (f.typ === "alle" || k.g.typ === f.typ)
        );
        if (!k.wurzel.hidden) n++;
      }
      leer.replaceChildren(
        ...(n === 0
          ? [
              leerKarte("Keine Gruppe passt zu deiner Suche.", [
                knopf("Filter zurücksetzen", {
                  onclick: () => leiste.setzeAlles(),
                }),
              ]),
            ]
          : []),
      );
      leiste.setzeTreffer(n, karten.length);
    },
  });
  leiste.setzeTreffer(karten.length, karten.length);
  haenge(
    inhalt,
    el(
      "p",
      { class: "leise rr-erklaerung" },
      "Eine Gruppe trägt keine Rechte aus dem Katalog wie eine Rolle. Was an ihr hängt, zeigt jede Karte: wer verantwortlich ist, welche Räume sie entscheidet und welche Seiten sie bearbeiten darf.",
    ),
    leiste.wurzel,
    liste,
    leer,
    nochNichtMoeglich(),
  );
}

function karte(g, z) {
  const traegt = gruppeTraegt(g, z.daten);
  const verantwortliche = g.mitglieder.filter((m) =>
    istVerantwortlich(m.rolle),
  ).length;
  const sonder = z.daten.sonderrechte.filter((s) => s.tagId === g.id).length;
  return el(
    "li",
    { class: "flaeche rr-karte" },
    el(
      "div",
      { class: "rr-kartenkopf" },
      el("h2", {}, el("a", { href: adresse("gruppen", g.id) }, g.name)),
      el(
        "ul",
        { class: "chips" },
        chip(typName(g.typ), g.typ === "stufe" ? "stufe" : undefined, "tag"),
      ),
    ),
    el(
      "p",
      { class: "leise" },
      [
        mitglieder(g.mitglieder.length),
        g.typ === "team" &&
          `${verantwortliche === 0 ? "niemand" : verantwortliche} verantwortlich`,
        sonder > 0 &&
          `${sonder} ${sonder === 1 ? "Sonderrecht" : "Sonderrechte"} an Seiten`,
      ]
        .filter(Boolean)
        .join(" · "),
    ),
    el(
      "ul",
      { class: "rr-traegt-kurz" },
      traegt
        .filter((t) => t.schluessel !== "lager" && t.schluessel !== "stufe")
        .map((t) => el("li", {}, icon("haken"), t.titel)),
    ),
    el(
      "a",
      {
        class: "knopf knopf--klein",
        href: adresse("gruppen", g.id),
        "aria-label": `Öffnen: ${g.name}`,
      },
      icon("weiter"),
      "Öffnen",
    ),
  );
}

// Die ehrliche Karte: was es heute nicht gibt
function nochNichtMoeglich() {
  return el(
    "section",
    {
      class: "flaeche rr-flaeche rr-offen",
      "aria-labelledby": "rr-offen-titel",
    },
    el("h2", { id: "rr-offen-titel" }, "Noch nicht möglich"),
    el(
      "p",
      {},
      "Eine Gruppe wie «Mat» kann heute keine Rechte aus dem Katalog tragen, zum Beispiel «Medien verwalten». Rollen gelten für einzelne Personen, nicht für eine Gruppe.",
    ),
    el(
      "ul",
      { class: "rr-liste" },
      [
        "Rechte an einer Gruppe einstellen, die alle Mitglieder erben",
        "Mehr Rollen in einer Gruppe als «verantwortlich», zum Beispiel Kasse oder Kommunikation",
        "Rechte, die nur für die eigenen Objekte der Gruppe gelten",
        "Gruppen für einen einzelnen Anlass (OK)",
      ].map((t) => el("li", {}, t)),
    ),
    el(
      "p",
      { class: "leise" },
      "Das ist ein Umbau des Rechtemodells. Der Entwurf liegt vor (Issue #585) und wartet auf deinen Entscheid. Bis dahin gibst du eine Rolle den einzelnen Personen (Reiter «Rollen»). Für die Seite eines Teams stellst du die Verantwortlichen ein.",
    ),
  );
}

// ---------- Eine Gruppe ----------

function zeigeGruppe(inhalt, z, id) {
  const { ctx, daten } = z;
  const g = daten.gruppen.find((x) => x.id === id);
  if (!g) {
    haenge(
      inhalt,
      zurueckLink("Alle Gruppen", adresse("gruppen")),
      leerKarte("Diese Gruppe gibt es nicht (mehr).", []),
    );
    return;
  }
  ctx.titel(g.name, `${typName(g.typ)} · ${mitglieder(g.mitglieder.length)}`);
  const bekannt = new Map(daten.personen.map((p) => [p.id, p]));
  const traegt = gruppeTraegt(g, daten);

  haenge(
    inhalt,
    zurueckLink("Alle Gruppen", adresse("gruppen")),
    el(
      "section",
      { class: "flaeche rr-flaeche", "aria-labelledby": "rr-traegt-titel" },
      el("h2", { id: "rr-traegt-titel" }, "Das trägt diese Gruppe heute"),
      traegt.length === 0
        ? el(
            "p",
            { class: "leise" },
            "Diese Gruppe trägt für sich keine Rechte. Mitglieder sehen, was für ihre Gruppe sichtbar ist.",
          )
        : el(
            "ul",
            { class: "rr-traegt" },
            traegt.map((t) =>
              el(
                "li",
                { class: "rr-traegt-zeile" },
                el("p", { class: "rr-titel" }, t.titel),
                el(
                  "p",
                  { class: "klein" },
                  el("span", { class: "leise" }, "Wer: "),
                  t.wer,
                ),
                el(
                  "p",
                  { class: "klein" },
                  el("span", { class: "leise" }, "Wo: "),
                  t.wo,
                ),
                t.einstellbar &&
                  el("p", { class: "klein leise" }, t.einstellbar),
              ),
            ),
          ),
    ),
    mitgliederBlock(z, g, bekannt),
    sonderrechteBlock(z, g),
    nochNichtMoeglich(),
  );
}

// Mitglieder: bei einem Team mit «Verantwortlich» einstellbar (setzt die Rolle am Mitglied, wie im Bereich Gruppen), sonst nur die Liste
function mitgliederBlock(z, g, bekannt) {
  const { ctx } = z;
  const team = g.typ === "team";
  const ort = el("div", { class: "rr-block" });
  const setze = async (m, rolle, text) => {
    try {
      await anfrage("PUT", `/api/v1/admin/tags/${g.id}/personen/${m.userId}`, {
        rolle,
      });
      ctx.melde(text);
      z.neu();
    } catch (f) {
      ctx.melde(fehlertext(f), "fehler");
    }
  };
  const zeilen = g.mitglieder.length
    ? g.mitglieder.map((m) => {
        const p = bekannt.get(m.userId) ?? { id: m.userId, name: "Unbekannt" };
        const k = kandidatVon(p);
        const verantwortlich = istVerantwortlich(m.rolle);
        const bezeichnung = m.rolle && !verantwortlich ? m.rolle : null;
        k.zusatz = [k.zusatz, bezeichnung && `Bezeichnung «${bezeichnung}»`]
          .filter(Boolean)
          .join(" · ");
        if (!team) return personZeile(k);
        if (verantwortlich) {
          const weg = knopf("Verantwortung entziehen", {
            klein: true,
            art: "still",
            kontext: p.name,
          });
          zweistufig(
            weg,
            `Wirklich entziehen? ${p.name} bearbeitet die Seite des Teams dann nicht mehr.`,
            () =>
              setze(
                m,
                null,
                `«${p.name}» ist nicht mehr verantwortlich im Team «${g.name}».`,
              ),
          );
          return personZeile(
            k,
            el("ul", { class: "chips" }, chip("Verantwortlich", "ok")),
            weg,
          );
        }
        const hin = knopf("Verantwortlich machen", {
          klein: true,
          symbol: "plus",
          kontext: p.name,
        });
        hin.addEventListener("click", () =>
          bestaetigeAmOrt(ort, {
            text: `«${p.name}» darf dann die Seite des Teams bearbeiten und veröffentlichen, mit zweitem Faktor.${bezeichnung ? ` Die Bezeichnung «${bezeichnung}» wird dabei ersetzt.` : ""} Wirklich?`,
            ok: "Verantwortlich machen",
            aktion: () =>
              setze(
                m,
                "verantwortlich",
                `«${p.name}» ist jetzt verantwortlich im Team «${g.name}».`,
              ),
            zurueckFokus: hin,
          }),
        );
        return personZeile(k, hin);
      })
    : [
        el(
          "li",
          { class: "pe-keiner leise" },
          "Noch niemand in dieser Gruppe.",
        ),
      ];
  haenge(
    ort,
    el(
      "div",
      { class: "rr-kopfzeile" },
      el(
        "h2",
        { id: "rr-mitglieder-titel" },
        team ? "Mitglieder und Verantwortliche" : "Mitglieder",
      ),
      el("p", { class: "klein leise" }, mitglieder(g.mitglieder.length)),
    ),
    el(
      "ul",
      {
        class: "pe-treffer rr-personen",
        "aria-label": `Mitglieder von ${g.name}`,
      },
      zeilen,
    ),
    el(
      "p",
      { class: "klein leise" },
      team
        ? "Die Verantwortlichen sind die Rolle «verantwortlich» in diesem Team. Wer sonst dazugehört, ändert sich im Bereich Gruppen. "
        : "Mitglieder fügst du im Bereich Gruppen hinzu oder entfernst sie dort. ",
      el(
        "a",
        { href: `#personen/gruppen/${g.id}` },
        "Zu den Mitgliedern der Gruppe",
      ),
    ),
  );
  return el(
    "section",
    { class: "flaeche rr-flaeche", "aria-labelledby": "rr-mitglieder-titel" },
    ort,
  );
}

// Sonderrechte: eine Gruppe darf genau eine Seite bearbeiten und veröffentlichen (bearbeiter mit tagId)
function sonderrechteBlock(z, g) {
  const { ctx, daten } = z;
  const ort = el("div", { class: "rr-block" });
  const meine = daten.sonderrechte.filter((s) => s.tagId === g.id);
  const titelVon = (id) =>
    daten.seiten.find((s) => s.id === id)?.titel ?? "Unbekannte Seite";
  const entziehen = async (s) => {
    try {
      await anfrage("DELETE", `/api/v1/admin/bearbeiter/${s.id}`);
      ctx.melde(
        `«${g.name}» darf die Seite «${titelVon(s.seiteId)}» nicht mehr bearbeiten.`,
      );
      z.neu();
    } catch (f) {
      ctx.melde(fehlertext(f), "fehler");
    }
  };
  const zeilen = meine.length
    ? meine.map((s) => {
        const weg = knopf("Entziehen", {
          klein: true,
          art: "still",
          symbol: "schliessen",
          kontext: titelVon(s.seiteId),
        });
        zweistufig(
          weg,
          `Wirklich entziehen? «${g.name}» bearbeitet diese Seite dann nicht mehr.`,
          () => entziehen(s),
        );
        return el(
          "li",
          { class: "pe-wahlzeile" },
          el(
            "div",
            { class: "wer" },
            el("span", { class: "name" }, titelVon(s.seiteId)),
            el(
              "span",
              { class: "klein leise" },
              "bearbeiten und veröffentlichen",
            ),
          ),
          weg,
        );
      })
    : [
        el(
          "li",
          { class: "pe-keiner leise" },
          "Diese Gruppe hat kein Sonderrecht an einer Seite.",
        ),
      ];

  const frei = daten.seiten.filter(
    (s) => !meine.some((m) => m.seiteId === s.id),
  );
  const wahl = auswahl({
    label: "Seite",
    optionen: [["", "Seite wählen …"], ...frei.map((s) => [s.id, s.titel])],
    wert: "",
  });
  const geben = knopf("Sonderrecht geben", { symbol: "plus" });
  geben.addEventListener("click", () => {
    const seiteId = wahl.eingabe.value;
    if (!seiteId) {
      ctx.melde("Wähle zuerst eine Seite.", "warn");
      return;
    }
    bestaetigeAmOrt(ort, {
      text: `${mitglieder(g.mitglieder.length)} von «${g.name}» dürfen dann die Seite «${titelVon(seiteId)}» bearbeiten und veröffentlichen, mit zweitem Faktor. Wirklich?`,
      ok: "Sonderrecht geben",
      aktion: async () => {
        try {
          await anfrage("POST", "/api/v1/admin/bearbeiter", {
            objektTyp: "seite",
            objektId: seiteId,
            tagId: g.id,
          });
          ctx.melde(
            `«${g.name}» darf jetzt die Seite «${titelVon(seiteId)}» bearbeiten.`,
          );
          z.neu();
        } catch (f) {
          ctx.melde(fehlertext(f), "fehler");
        }
      },
      zurueckFokus: geben,
    });
  });
  haenge(
    ort,
    el(
      "div",
      { class: "rr-kopfzeile" },
      el("h2", { id: "rr-sonder-titel" }, "Sonderrechte an Seiten"),
      el(
        "p",
        { class: "klein leise" },
        meine.length === 1 ? "1 Seite" : `${meine.length} Seiten`,
      ),
    ),
    el(
      "p",
      { class: "leise" },
      "Ein Sonderrecht gilt für genau eine Seite und für alle Mitglieder der Gruppe. Es öffnet nichts sonst.",
    ),
    el(
      "ul",
      {
        class: "pe-treffer rr-personen",
        "aria-label": `Sonderrechte von ${g.name}`,
      },
      zeilen,
    ),
    frei.length > 0
      ? el("div", { class: "rr-zeile-wahl" }, wahl.wurzel, geben)
      : el(
          "p",
          { class: "klein leise" },
          "Es gibt keine Seite mehr, für die du ein Sonderrecht geben könntest.",
        ),
  );
  return el(
    "section",
    { class: "flaeche rr-flaeche", "aria-labelledby": "rr-sonder-titel" },
    ort,
  );
}

import { anfrage } from "./api.js";
import { el, filterGruppe, knopf } from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import { skeletonListe } from "./lader.js";
import { leerKarte } from "./zustaende.js";
import { haenge } from "./lager-gemeinsam.js";
import { mehrzahl } from "./lager-menschen-logik.js";
import {
  keinLeserecht,
  kopfeMitHinweis,
  LB,
  ladeKontext,
  meldung,
  zweistufigerKnopf,
} from "./lager-menschen.js";

// Abzählen (#675; Server #384): eine Liste für alle, die abzählen («12 von 40 da»). Grosse Zeilen zum Antippen, Filter nach Gruppe und Stufe, alle sichtbaren auf einmal abhaken. Der Haken ändert nur den Haken, nie die Person. Zurücksetzen fragt am Ort nach. Mehrere zählen gleichzeitig: «Aktualisieren» holt den Stand der anderen. Adresse: #lager/lager/<id>/abzaehlen

// Alle Seiten der Abzählliste (Cursor); gruppe filtert auf dem Server
async function holeListe(lagerId, art, gruppe) {
  const alle = [];
  let nach = null;
  for (let i = 0; i < 50; i++) {
    const q = new URLSearchParams({ art, limit: "200" });
    if (gruppe) q.set("gruppe", gruppe);
    if (nach) q.set("nach", nach);
    const a = await anfrage("GET", `${LB(lagerId)}/abzaehlen?${q}`);
    alle.push(...a.eintraege);
    nach = a.naechster;
    if (!nach) break;
  }
  return alle;
}

export function zeige(bereich, ctx, lagerId, lager) {
  ctx.lade(
    async () => {
      const k = await ladeKontext(lagerId, lager);
      if (!k.darf("teilnehmer.lesen")) return { k };
      const [eintraege, gruppen] = await Promise.all([
        holeListe(lagerId, "teilnehmer", ""),
        k.darf("einteilung.lesen")
          ? anfrage("GET", `${LB(lagerId)}/gruppen`)
              .then((a) => a.gruppen)
              .catch(() => [])
          : [],
      ]);
      return { k, eintraege, gruppen };
    },
    ({ k, eintraege, gruppen }) => {
      kopfeMitHinweis(bereich, ctx, k, "Abzählen");
      if (!eintraege) return keinLeserecht(bereich, "die Abzählliste");
      zeichne(bereich, ctx, k, eintraege, gruppen);
    },
    { skeleton: () => skeletonListe({ zeilen: 8 }) },
  );
}

function zeichne(bereich, ctx, k, ersteListe, gruppen) {
  const schreiben = k.kann("abzaehlen.schreiben");
  ctx.kopfAktion();
  const stufen = [
    ...new Set(ersteListe.map((e) => e.stufe).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "de"));
  const stand = { art: "teilnehmer", gruppe: "", stufe: "", suche: "" };
  let eintraege = ersteListe;
  const summe = el("p", {
    class: "mn-summe",
    role: "status",
    "aria-live": "polite",
  });
  const liste = el("ul", { class: "mn-abzaehl" });
  const leer = el("div");
  const leisteOrt = el("div");
  let leiste = null;

  const umschalter = filterGruppe({
    beschriftung: "Wer wird abgezählt",
    eintraege: [
      { text: "Teilnehmende", wert: "teilnehmer" },
      { text: "Team", wert: "team" },
    ],
    beiAenderung: (a) => {
      stand.art = a;
      stand.stufe = "";
      baueLeiste();
      lade();
    },
  });

  function baueLeiste() {
    const filter = [];
    if (stand.art === "teilnehmer" && gruppen.length > 0)
      filter.push({
        schluessel: "gruppe",
        label: "Gruppe",
        grundwert: "",
        optionen: [["", "Alle Gruppen"], ...gruppen.map((g) => [g.id, g.name])],
        wert: stand.gruppe,
      });
    if (stand.art === "teilnehmer" && stufen.length > 0)
      filter.push({
        schluessel: "stufe",
        label: "Stufe",
        grundwert: "",
        optionen: [["", "Alle Stufen"], ...stufen.map((s) => [s, s])],
        wert: stand.stufe,
      });
    if (stand.art === "team" && gruppen.length > 0)
      filter.push({
        schluessel: "gruppe",
        label: "Gruppe",
        grundwert: "",
        optionen: [["", "Alle Gruppen"], ...gruppen.map((g) => [g.id, g.name])],
        wert: stand.gruppe,
      });
    leiste = filterleiste({
      suche: { label: "Person suchen", wert: stand.suche },
      filter,
      namen: { einzahl: "Person", mehrzahl: "Personen" },
      beiAenderung: (s) => {
        const gruppeNeu = s.filter.gruppe ?? "";
        stand.suche = s.suche.trim().toLowerCase();
        stand.stufe = s.filter.stufe ?? "";
        if (gruppeNeu !== stand.gruppe) {
          stand.gruppe = gruppeNeu;
          lade();
        } else zeichneZeilen();
      },
    });
    leisteOrt.replaceChildren(leiste.wurzel);
  }

  async function lade() {
    liste.setAttribute("aria-busy", "true");
    try {
      eintraege = await holeListe(k.lagerId, stand.art, stand.gruppe);
      zeichneZeilen();
    } catch (f) {
      ctx.melde(meldung(f), "fehler");
    } finally {
      liste.removeAttribute("aria-busy");
    }
  }

  const nameVon = (e) => (e.vorname ? `${e.nachname} ${e.vorname}` : e.name);

  // Haken setzen; die Zeilen ändern sich sofort, bei einem Fehler kehren sie zurück und der Stand wird neu geholt
  async function haken(zeilen, geprueft) {
    const betroffen = zeilen.filter((z) => z.geprueft !== geprueft);
    if (betroffen.length === 0) return;
    for (const z of betroffen) z.geprueft = geprueft;
    zeichneZeilen();
    try {
      await anfrage("PUT", `${LB(k.lagerId)}/abzaehlen`, {
        geprueft,
        teilnehmerIds: betroffen
          .filter((z) => z.teilnehmerId)
          .map((z) => z.teilnehmerId),
        personIds: betroffen.filter((z) => z.personId).map((z) => z.personId),
      });
    } catch (f) {
      ctx.melde(meldung(f), "fehler");
      lade();
    }
  }

  function sichtbare() {
    return eintraege.filter(
      (e) =>
        (stand.stufe === "" || e.stufe === stand.stufe) &&
        (stand.suche === "" || nameVon(e).toLowerCase().includes(stand.suche)),
    );
  }

  function zeichneZeilen() {
    const sicht = sichtbare();
    const da = sicht.filter((e) => e.geprueft).length;
    summe.textContent = `${da} von ${sicht.length} da`;
    liste.replaceChildren(
      ...sicht.map((e) =>
        el(
          "li",
          {},
          el(
            "button",
            {
              type: "button",
              class: `mn-abzaehl-zeile${e.geprueft ? " ist-da" : ""}`,
              "aria-pressed": String(e.geprueft),
              disabled: !schreiben,
              onclick: () => haken([e], !e.geprueft),
            },
            el("span", { class: "mn-haken", "aria-hidden": "true" }),
            el(
              "span",
              { class: "mn-abzaehl-name" },
              el("span", { class: "name" }, nameVon(e)),
              e.stufe && el("span", { class: "klein leise" }, e.stufe),
            ),
            el(
              "span",
              { class: "mn-abzaehl-wort" },
              e.geprueft ? "Da" : "Nicht gezählt",
            ),
          ),
        ),
      ),
    );
    leer.replaceChildren();
    if (sicht.length === 0)
      leer.append(
        leerKarte(
          eintraege.length === 0 &&
            stand.suche === "" &&
            !stand.gruppe &&
            !stand.stufe
            ? stand.art === "team"
              ? "Das Lager hat noch keine Mitglieder."
              : "Noch keine Personen zum Abzählen. Erfasse zuerst die Teilnehmenden."
            : stand.suche
              ? `Keine Treffer für «${stand.suche}».`
              : "Niemand passt zu diesem Filter.",
          [
            knopf("Filter zurücksetzen", {
              onclick: () => leiste.setzeAlles(),
            }),
          ],
        ),
      );
    leiste?.setzeTreffer(sicht.length, eintraege.length);
    const offen = sicht.filter((e) => !e.geprueft);
    alleKnopf.hidden = !schreiben || offen.length === 0;
    alleKnopf.lastChild.textContent = `Alle ${offen.length} abhaken`;
    alleKnopf.onclick = () => haken(offen, true);
  }

  const alleKnopf = knopf("Alle abhaken", { symbol: "haken" });
  const zurueck = zweistufigerKnopf(
    "Zurücksetzen",
    "Alle Haken für alle entfernen?",
    async () => {
      try {
        const e = await anfrage(
          "POST",
          `${LB(k.lagerId)}/abzaehlen/zuruecksetzen`,
          {
            bestaetigt: true,
          },
        );
        ctx.melde(
          `Liste zurückgesetzt. ${mehrzahl(e.zurueckgesetzt, "Haken", "Haken")} entfernt, niemand gelöscht.`,
        );
        lade();
      } catch (f) {
        ctx.melde(meldung(f), "fehler");
      }
    },
    { art: "still", symbol: "aktualisieren" },
  );
  baueLeiste();
  haenge(
    bereich,
    el("div", { class: "mn-werkzeuge" }, umschalter.wurzel, summe),
    leisteOrt,
    schreiben && el("div", { class: "mn-werkzeuge" }, alleKnopf, zurueck),
    liste,
    leer,
  );
  zeichneZeilen();
}

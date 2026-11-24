import { anfrage } from "./api.js";
import { avatar, el, filterGruppe, knopf } from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import {
  blendeEin,
  ersetzeMitBewegung,
  puls,
  skeletonAbzaehlen,
  teilLader,
  zaehlZahl,
} from "./lager-anim.js";
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
    { skeleton: () => skeletonAbzaehlen() },
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
  // Die Summe zählt hoch und runter (sichtbar), Screenreader bekommen den Satz «12 von 40 da» (aria-live)
  const zahlDa = zaehlZahl(0);
  const zahlAlle = zaehlZahl(0);
  const summe = el(
    "p",
    { class: "mn-summe", role: "status", "aria-live": "polite" },
    zahlDa,
    " von ",
    zahlAlle,
    " da",
  );
  const fortschritt = el("progress", {
    class: "mn-fuell",
    max: "1",
    value: "0",
    "aria-hidden": "true",
  });
  const liste = el("ul", { class: "mn-abzaehl" });
  const leer = el("div");
  // Liste und Leerzustand: ein Teil, der als Ganzes neu lädt (anderer Filter vom Server, Zurücksetzen)
  const listeOrt = el("div", {}, liste, leer);
  const ladeTeil = teilLader(listeOrt);
  const zeilen = new Map(); // id -> { knopf, kasten, wort }
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

  // leere: false (Zurücksetzen, Fehler beim Haken) lässt die Liste stehen und tauscht sie danach; sonst ersetzt ein Skeleton sie
  function lade({ leere = true } = {}) {
    // Ein anderer Stand wird geholt: Die Summe zählt auf null, bis die neue Liste da ist
    if (leere) {
      zahlDa.setze(0);
      zahlAlle.setze(0);
      fortschritt.value = 0;
      alleKnopf.hidden = true;
    }
    return ladeTeil(
      () => holeListe(k.lagerId, stand.art, stand.gruppe),
      (daten) => {
        eintraege = daten;
        listeOrt.replaceChildren(liste, leer);
        zeichneZeilen();
      },
      { skeleton: () => skeletonAbzaehlen({ kopf: false }), leere },
    );
  }

  const nameVon = (e) => (e.vorname ? `${e.nachname} ${e.vorname}` : e.name);

  const idVon = (e) => e.teilnehmerId ?? e.personId ?? nameVon(e);
  // Eine Zeile bekommt ihren Zustand; sie wird nicht neu gebaut, der Fokus bleibt auf dem Knopf
  function stelleZeile(e) {
    const z = zeilen.get(idVon(e));
    if (!z) return;
    z.knopf.classList.toggle("ist-da", e.geprueft);
    z.knopf.setAttribute("aria-pressed", String(e.geprueft));
    z.wort.textContent = e.geprueft ? "Da" : "Nicht gezählt";
  }

  // Haken setzen; die Zeilen ändern sich sofort mit einem Puls am Haken, die Summe zählt mit; bei einem Fehler kehren sie zurück und der Stand wird neu geholt
  async function haken(zeilenListe, geprueft) {
    const betroffen = zeilenListe.filter((z) => z.geprueft !== geprueft);
    if (betroffen.length === 0) return;
    betroffen.forEach((z, i) => {
      z.geprueft = geprueft;
      stelleZeile(z);
      const kasten = zeilen.get(idVon(z))?.kasten;
      if (kasten) puls(kasten, Math.min(i, 12) * 25);
    });
    aktualisiereSumme();
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
      lade({ leere: false });
    }
  }

  function aktualisiereSumme() {
    const sicht = sichtbare();
    const da = sicht.filter((e) => e.geprueft).length;
    zahlDa.setze(da);
    zahlAlle.setze(sicht.length);
    fortschritt.max = Math.max(1, sicht.length);
    fortschritt.value = da;
    const offen = sicht.filter((e) => !e.geprueft);
    alleKnopf.hidden = !schreiben || offen.length === 0;
    alleKnopf.lastChild.textContent = `Alle ${offen.length} abhaken`;
    alleKnopf.onclick = () => haken(offen, true);
  }

  function sichtbare() {
    return eintraege.filter(
      (e) =>
        (stand.stufe === "" || e.stufe === stand.stufe) &&
        (stand.suche === "" || nameVon(e).toLowerCase().includes(stand.suche)),
    );
  }

  function zeileVon(e) {
    const anzeigename = nameVon(e);
    const knopf = el(
      "button",
      {
        type: "button",
        class: `mn-abzaehl-zeile${e.geprueft ? " ist-da" : ""}`,
        "aria-pressed": String(e.geprueft),
        disabled: !schreiben,
        onclick: () => haken([e], !e.geprueft),
      },
      el("span", { class: "mn-haken", "aria-hidden": "true" }),
      avatar(anzeigename, { hell: true, bildUrl: e.bildUrl }),
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
    );
    zeilen.set(idVon(e), {
      knopf,
      kasten: knopf.firstChild,
      wort: knopf.lastChild,
    });
    return el("li", { "data-id": idVon(e) }, knopf);
  }

  function zeichneZeilen() {
    const sicht = sichtbare();
    zeilen.clear();
    ersetzeMitBewegung(liste, ...sicht.map(zeileVon));
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
    if (sicht.length === 0) blendeEin(leer.firstChild);
    leiste?.setzeTreffer(sicht.length, eintraege.length);
    aktualisiereSumme();
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
        lade({ leere: false });
      } catch (f) {
        ctx.melde(meldung(f), "fehler");
      }
    },
    { art: "still", symbol: "aktualisieren" },
  );
  baueLeiste();
  haenge(
    bereich,
    el(
      "div",
      { class: "mn-werkzeuge" },
      umschalter.wurzel,
      el("div", { class: "mn-summebox" }, summe, fortschritt),
    ),
    leisteOrt,
    schreiben && el("div", { class: "mn-werkzeuge" }, alleKnopf, zurueck),
    listeOrt,
  );
  zeichneZeilen();
}

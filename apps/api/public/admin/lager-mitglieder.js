import { anfrage } from "./api.js";
import { filterleiste } from "./filterleiste.js";
import { aktionenZelle, auswahl, avatar, el, knopf, tabelle } from "./dom.js";
import { skeletonTabelle } from "./lader.js";
import { macheSortierbar, seitenleiste, sortiere } from "./liste-hilfen.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";
import { leerKarte } from "./zustaende.js";
import {
  ADRESSE,
  haenge,
  BASIS,
  beschrifteZellen,
  kartenTabelle,
  ROLLEN,
  ROLLENNAME,
  meldung,
  zurueckLink,
} from "./lager-gemeinsam.js";
import { personenWahl } from "./lager-personenwahl.js";

// Mitglieder und Rollen eines Lagers (#527, Board A23; #592): Personen hinzufügen (Suche mit Gesichtern, Rolle wählen, mehrere auf einmal), Mitgliederliste mit Rolle am Ort ändern und Entfernen, beides mit «Rückgängig». Zwei Abfragen (Lager, Mitglieder), die Personen erst beim Hinzufügen. Kein Polling. Die Rechte der Rollen stehen in lager-rechte.js.

export function zeige(bereich, ctx, id) {
  ctx.lade(
    () =>
      Promise.all([
        anfrage("GET", `${BASIS}/${id}`),
        anfrage("GET", `${BASIS}/${id}/mitglieder`),
      ]),
    ([l, m], neu) => zeichneMitglieder(bereich, ctx, l, m.mitglieder, neu),
    {
      skeleton: () => skeletonTabelle({ spalten: 3, zeilen: 5, avatar: true }),
    },
  );
}

const geschlossen = (l) =>
  l.status === "abgeschlossen" || l.status === "archiviert";
const STATUS_FOLGE = ROLLEN.map(([r]) => r);

function zeichneMitglieder(bereich, ctx, lager, alle, neu) {
  ctx.titel("Mitglieder und Rollen", lager.titel);
  const zu = geschlossen(lager);
  const wahlOrt = el("div", { class: "lg-wahlort" });
  let personen = null;
  let wahl = null;

  // Die Personenwahl entsteht beim ersten Öffnen; die Personen werden dann einmal geladen
  async function oeffneWahl(oeffner) {
    if (wahl) {
      wahlOrt.hidden = !wahlOrt.hidden;
      oeffner?.setAttribute("aria-expanded", String(!wahlOrt.hidden));
      if (!wahlOrt.hidden) wahl.fokus();
      return;
    }
    try {
      personen ??= (
        await anfrage("GET", "/api/v1/admin/personen")
      ).personen.filter((p) => p.benutzername && !p.deaktiviert);
    } catch (f) {
      ctx.melde(meldung(f), "fehler");
      return;
    }
    wahl = personenWahl({
      personen,
      ausgeschlossen: new Set(alle.map((m) => m.personId)),
      rolle: alle.some((m) => m.rolle === "lagerleitung")
        ? "team"
        : "lagerleitung",
      beiHinzufuegen: async (gewaehlt, rolle) => {
        const ergebnis = await Promise.allSettled(
          gewaehlt.map((p) =>
            anfrage("PUT", `${BASIS}/${lager.id}/mitglieder/${p.id}`, {
              rolle,
            }),
          ),
        );
        const fehler = ergebnis
          .map((r, i) =>
            r.status === "rejected" ? [gewaehlt[i], r.reason] : null,
          )
          .filter(Boolean);
        if (fehler.length === gewaehlt.length) throw fehler[0][1];
        await neu();
        if (fehler.length > 0)
          ctx.melde(
            `Nicht hinzugefügt: ${fehler.map(([p]) => p.name).join(", ")}. ${meldung(fehler[0][1])}`,
            "warn",
          );
        else
          ctx.melde(
            gewaehlt.length === 1
              ? `${gewaehlt[0].name} ist jetzt ${ROLLENNAME[rolle]}.`
              : `${gewaehlt.length} Personen sind jetzt ${ROLLENNAME[rolle]}.`,
          );
      },
      fehlertext: meldung,
    });
    wahlOrt.hidden = false;
    wahlOrt.replaceChildren(wahl.wurzel);
    oeffner?.setAttribute("aria-expanded", "true");
    wahl.fokus();
  }

  if (zu) ctx.kopfAktion();
  else {
    const oeffner = knopf("Personen hinzufügen", {
      art: "haupt",
      symbol: "plus",
      "aria-expanded": "false",
      "aria-controls": "lg-wahlort",
    });
    oeffner.addEventListener("click", () => oeffneWahl(oeffner));
    ctx.kopfAktion(oeffner);
  }
  wahlOrt.id = "lg-wahlort";
  wahlOrt.hidden = true;

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
    wahlOrt,
  );
  if (alle.length === 0) {
    bereich.append(
      leerKarte(
        zu
          ? "Das Lager hat keine Mitglieder."
          : "Das Lager hat noch keine Mitglieder. Füge oben die Lagerleitung hinzu.",
      ),
    );
    if (!zu) oeffneWahl(null);
    return;
  }
  bereich.append(
    el(
      "p",
      { class: "leise lg-rechtehinweis" },
      "Die Lagerleitung darf alles. Was Leitung, Team und Lesen dürfen, stellst du unter ",
      el(
        "a",
        { class: "lg-verweis", href: `${ADRESSE}/${lager.id}/rechte` },
        "Rechte der Rollen",
      ),
      " ein.",
    ),
  );

  const zustand = { schluessel: "name", richtung: "auf" };
  const stand = { suche: "", filter: { rolle: "alle" } };
  const leiste = filterleiste({
    suche: { label: "Mitglied suchen" },
    filter: [
      {
        schluessel: "rolle",
        label: "Rolle",
        grundwert: "alle",
        optionen: [["alle", "Alle"], ...ROLLEN],
      },
    ],
    namen: { einzahl: "Mitglied", mehrzahl: "Mitglieder" },
    beiAenderung: (neuerStand) => {
      stand.suche = neuerStand.suche.trim().toLowerCase();
      stand.filter = neuerStand.filter;
      seiten.anfang();
      zeichne();
    },
  });
  const seiten = seitenleiste({ beiWechsel: () => zeichne() });
  const { wurzel: rahmen, koerper } = tabelle({
    beschriftung: "Mitglieder",
    spalten: zu ? ["Name", "Rolle"] : ["Name", "Rolle", "Aktionen"],
    zeilen: [],
  });
  kartenTabelle(rahmen);
  macheSortierbar(
    rahmen,
    [
      { index: 0, schluessel: "name", name: "Name" },
      { index: 1, schluessel: "rolle", name: "Rolle" },
    ],
    zustand,
    () => zeichne(),
  );
  const leer = el("div");

  // Die Rolle ändert sich am Ort: Das Feld zeigt sofort die neue Rolle, der Server bekommt sie nach der Frist; «Rückgängig» stellt die alte wieder her
  function rollenFeld(m) {
    const feld = auswahl({
      label: `Rolle von ${m.name}`,
      optionen: ROLLEN,
      wert: m.rolle,
    });
    feld.wurzel.classList.add("lg-rollenfeld");
    feld.wurzel.querySelector("label")?.classList.add("nur-leser");
    feld.eingabe.addEventListener("change", () => {
      const neuR = feld.eingabe.value;
      const altR = m.rolle;
      if (neuR === altR) return;
      ctx.mitRueckgaengig({
        text: `${m.name} ist jetzt ${ROLLENNAME[neuR]}`,
        ansicht: {
          weg: () => (m.rolle = neuR),
          zurueck: () => {
            m.rolle = altR;
            feld.eingabe.value = altR;
            feld.eingabe.dispatchEvent(new Event("change"));
          },
        },
        ausfuehren: () =>
          anfrage("PUT", `${BASIS}/${lager.id}/mitglieder/${m.personId}`, {
            rolle: neuR,
          }),
        fehlertext: meldung,
      });
    });
    return feld.wurzel;
  }

  // Mit «Rückgängig» (#578): Die Person verliert den Zugriff erst nach der Frist, ihr Konto bleibt bestehen
  const entfernen = (m, ereignis) =>
    ctx.mitRueckgaengig({
      text: `${m.name} ist nicht mehr Mitglied`,
      ansicht: ansichtVonKnopf(ereignis),
      ausfuehren: () =>
        anfrage("DELETE", `${BASIS}/${lager.id}/mitglieder/${m.personId}`),
      fehlertext: meldung,
      danach: neu,
    });

  function zeichne() {
    const treffer = sortiere(
      alle
        .filter(
          (m) =>
            stand.filter.rolle === "alle" || m.rolle === stand.filter.rolle,
        )
        .filter(
          (m) =>
            stand.suche === "" ||
            m.name.toLowerCase().includes(stand.suche) ||
            (m.ceviName ?? "").toLowerCase().includes(stand.suche),
        ),
      zustand,
      (m, k) => (k === "rolle" ? STATUS_FOLGE.indexOf(m.rolle) : m.name),
    );
    const [von, bis] = seiten.fenster(treffer.length);
    koerper.replaceChildren(
      ...treffer.slice(von, bis).map((m) =>
        el(
          "tr",
          {},
          el(
            "th",
            { scope: "row" },
            el(
              "div",
              { class: "wer" },
              avatar(m.name, { hell: true, bildUrl: m.bildUrl }),
              el(
                "div",
                {},
                el("span", { class: "name" }, m.name),
                m.ceviName && el("span", { class: "klein leise" }, m.ceviName),
              ),
            ),
          ),
          el(
            "td",
            {},
            zu
              ? el("span", { class: "chip" }, ROLLENNAME[m.rolle])
              : rollenFeld(m),
          ),
          !zu &&
            aktionenZelle(
              knopf("Entfernen", {
                klein: true,
                art: "still",
                symbol: "minus",
                kontext: m.name,
                onclick: (e) => entfernen(m, e),
              }),
            ),
        ),
      ),
    );
    beschrifteZellen(koerper, ["", "Rolle", ""]);
    rahmen.hidden = treffer.length === 0;
    leer.replaceChildren();
    if (treffer.length === 0)
      leer.append(
        leerKarte(
          stand.suche
            ? `Keine Treffer für «${stand.suche}».`
            : "Niemand in dieser Rolle.",
          [
            knopf("Filter zurücksetzen", {
              onclick: () => leiste.setzeAlles(),
            }),
          ],
        ),
      );
    leiste.setzeTreffer(treffer.length, alle.length);
  }
  bereich.append(leiste.wurzel, rahmen, leer, seiten.wurzel);
  zeichne();
}

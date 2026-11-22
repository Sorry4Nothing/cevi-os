import { anfrage } from "./api.js";
import {
  aktionenZelle,
  auswahl,
  avatar,
  dialogFormular,
  el,
  filterGruppe,
  knopf,
  neueId,
  seitenwahl,
  tabelle,
} from "./dom.js";
import { skeletonTabelle } from "./lader.js";
import { leerKarte } from "./zustaende.js";
import {
  ADRESSE,
  haenge,
  BASIS,
  ROLLEN,
  ROLLENNAME,
  meldung,
  symbol,
  zurueckLink,
} from "./lager-gemeinsam.js";

// Unterseiten eines Lagers (#527, Board A23): «Mitglieder und Rollen» und «Rechte der Rollen». Mitglieder: zwei Abfragen (Lager, Mitglieder), Personen erst beim Hinzufügen. Rechte: zwei Abfragen (Lager, Rechte). Kein Polling.

export function zeige(bereich, ctx, id, ansicht) {
  const lager = () => anfrage("GET", `${BASIS}/${id}`);
  if (ansicht === "rechte") {
    ctx.lade(
      () => Promise.all([lager(), anfrage("GET", `${BASIS}/${id}/rechte`)]),
      ([l, r], neu) => zeichneRechte(bereich, ctx, l, r.rechte, neu),
      {
        skeleton: () =>
          skeletonTabelle({ spalten: 4, zeilen: 8, avatar: false }),
      },
    );
    return;
  }
  ctx.lade(
    () => Promise.all([lager(), anfrage("GET", `${BASIS}/${id}/mitglieder`)]),
    ([l, m], neu) => zeichneMitglieder(bereich, ctx, l, m.mitglieder, neu),
  );
}

const geschlossen = (l) =>
  l.status === "abgeschlossen" || l.status === "archiviert";
const zurueck = (l) =>
  zurueckLink(`Zum Lager «${l.titel}»`, `${ADRESSE}/${l.id}`);
const schreibschutz = () =>
  el(
    "div",
    { class: "hinweis hinweis--info", role: "status" },
    el(
      "span",
      {},
      "Das Lager ist schreibgeschützt. Öffne es wieder, wenn du etwas ändern willst.",
    ),
  );

// Mitglieder und Rollen (A23) -------------------------------------------------

function zeichneMitglieder(bereich, ctx, lager, alle, neu) {
  ctx.titel("Mitglieder und Rollen", lager.titel);
  const zu = geschlossen(lager);
  if (!zu)
    ctx.kopfAktion(
      knopf("Person hinzufügen", {
        art: "haupt",
        symbol: "plus",
        onclick: () => hinzufuegen(lager, alle, ctx, neu),
      }),
    );
  else ctx.kopfAktion();
  haenge(
    bereich,
    zurueck(lager),
    zu && schreibschutz(),
    el(
      "div",
      { class: "hinweis hinweis--info", role: "status" },
      el(
        "span",
        {},
        "Die Lagerleitung darf alles. Was Leitung, Team und Lesen dürfen, stellst du unter «Rechte der Rollen» ein.",
      ),
      el(
        "a",
        { class: "knopf knopf--klein", href: `${ADRESSE}/${lager.id}/rechte` },
        "Rechte der Rollen",
      ),
    ),
  );
  if (alle.length === 0) {
    bereich.append(
      leerKarte(
        "Das Lager hat noch keine Mitglieder. Füge die Lagerleitung hinzu.",
        [
          !zu &&
            knopf("Person hinzufügen", {
              symbol: "plus",
              onclick: () => hinzufuegen(lager, alle, ctx, neu),
            }),
        ].filter(Boolean),
      ),
    );
    return;
  }
  const zustand = { frage: "", rolle: "alle", aufsteigend: true };
  const zaehle = (r) =>
    r === "alle" ? alle.length : alle.filter((m) => m.rolle === r).length;
  const filter = filterGruppe({
    beschriftung: "Rolle",
    eintraege: [
      { text: "Alle", wert: "alle", n: zaehle("alle") },
      ...ROLLEN.map(([wert, text]) => ({ text, wert, n: zaehle(wert) })),
    ],
    wert: "alle",
    beiAenderung: (r) => {
      zustand.rolle = r;
      seiten.anfang();
      zeichne();
    },
  });
  const suchId = neueId("lg-suche");
  const suche = el("input", {
    class: "eingabe",
    id: suchId,
    type: "search",
    placeholder: "Name",
    autocomplete: "off",
    oninput: () => {
      zustand.frage = suche.value.trim().toLowerCase();
      seiten.anfang();
      zeichne();
    },
  });
  const seiten = seitenwahl({ beiWechsel: () => zeichne() });
  const { wurzel: rahmen, koerper } = tabelle({
    beschriftung: "Mitglieder",
    spalten: zu ? ["Name", "Rolle"] : ["Name", "Rolle", "Aktionen"],
    zeilen: [],
  });
  const kopfName = rahmen.querySelector("th");
  const sortKnopf = el("button", {
    type: "button",
    class: "lg-sort",
    onclick: () => {
      zustand.aufsteigend = !zustand.aufsteigend;
      zeichne();
      sortKnopf.focus();
    },
  });
  kopfName.replaceChildren(sortKnopf);
  const leer = el("div");
  const status = el("p", { class: "nur-leser", role: "status" });
  const vergleich = (a, b) => a.name.localeCompare(b.name, "de-CH");

  function zeichne() {
    sortKnopf.replaceChildren(
      "Name",
      el(
        "span",
        { class: "lg-sortwort" },
        symbol(zustand.aufsteigend ? "hoch" : "runter"),
        zustand.aufsteigend ? "aufsteigend" : "absteigend",
      ),
    );
    kopfName.setAttribute(
      "aria-sort",
      zustand.aufsteigend ? "ascending" : "descending",
    );
    const treffer = alle
      .filter((m) => zustand.rolle === "alle" || m.rolle === zustand.rolle)
      .filter(
        (m) =>
          zustand.frage === "" ||
          m.name.toLowerCase().includes(zustand.frage) ||
          (m.ceviName ?? "").toLowerCase().includes(zustand.frage),
      )
      .sort((a, b) =>
        zustand.aufsteigend ? vergleich(a, b) : vergleich(b, a),
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
              avatar(m.name),
              el(
                "div",
                {},
                el("span", { class: "name" }, m.name),
                m.ceviName && el("span", { class: "klein leise" }, m.ceviName),
              ),
            ),
          ),
          el("td", {}, el("span", { class: "chip" }, ROLLENNAME[m.rolle])),
          !zu &&
            aktionenZelle(
              knopf("Rolle ändern", {
                klein: true,
                symbol: "bearbeiten",
                kontext: m.name,
                onclick: () => rolleAendern(lager, m, ctx, neu),
              }),
              knopf("Entfernen", {
                klein: true,
                art: "gefahr",
                symbol: "papierkorb",
                kontext: m.name,
                onclick: () => entfernen(lager, m, ctx, neu),
              }),
            ),
        ),
      ),
    );
    rahmen.hidden = treffer.length === 0;
    leer.replaceChildren();
    if (treffer.length === 0) {
      leer.append(
        leerKarte(
          zustand.frage
            ? `Keine Treffer für «${suche.value.trim()}».`
            : "Niemand in dieser Rolle.",
          [
            knopf("Filter zurücksetzen", {
              onclick: () => {
                suche.value = "";
                zustand.frage = "";
                zustand.rolle = "alle";
                filter.setze("alle");
                seiten.anfang();
                zeichne();
                suche.focus();
              },
            }),
          ],
        ),
      );
    }
    status.textContent =
      treffer.length === 1 ? "1 Mitglied." : `${treffer.length} Mitglieder.`;
  }
  bereich.append(
    el(
      "div",
      { class: "werkzeuge" },
      el(
        "div",
        { class: "suche" },
        el("label", { class: "nur-leser", for: suchId }, "Name"),
        symbol("lupe"),
        suche,
      ),
      filter.wurzel,
    ),
    rahmen,
    leer,
    seiten.wurzel,
    status,
  );
  zeichne();
}

const rollenAuswahl = (wert) =>
  auswahl({ label: "Rolle", optionen: ROLLEN, wert });

function rolleAendern(lager, m, ctx, neu) {
  const rolle = rollenAuswahl(m.rolle);
  dialogFormular({
    titel: `Rolle ändern: ${m.name}`,
    felder: [rolle.wurzel],
    ok: "Speichern",
    senden: () =>
      anfrage("PUT", `${BASIS}/${lager.id}/mitglieder/${m.personId}`, {
        rolle: rolle.eingabe.value,
      }),
    fehlertext: meldung,
    danach: () => {
      neu();
      ctx.melde(`${m.name} ist jetzt ${ROLLENNAME[rolle.eingabe.value]}.`);
    },
  });
}

function entfernen(lager, m, ctx, neu) {
  dialogFormular({
    titel: `${m.name} entfernen?`,
    beschreibung:
      "Die Person verliert den Zugriff auf dieses Lager bei der nächsten Anfrage. Ihr Konto bleibt bestehen.",
    ok: "Entfernen",
    gefaehrlich: true,
    senden: () =>
      anfrage("DELETE", `${BASIS}/${lager.id}/mitglieder/${m.personId}`),
    fehlertext: meldung,
    danach: () => {
      neu();
      ctx.melde(`${m.name} ist nicht mehr Mitglied.`);
    },
  });
}

// Die Personen mit Konto laden, erst wenn der Dialog sie braucht
async function hinzufuegen(lager, mitglieder, ctx, neu) {
  let personen;
  try {
    personen = (await anfrage("GET", "/api/v1/admin/personen")).personen;
  } catch (f) {
    ctx.melde(meldung(f), "fehler");
    return;
  }
  const schon = new Set(mitglieder.map((m) => m.personId));
  const frei = personen.filter(
    (p) => p.benutzername && !p.deaktiviert && !schon.has(p.id),
  );
  if (frei.length === 0) {
    ctx.melde(
      "Alle Personen mit Konto sind schon Mitglied dieses Lagers.",
      "info",
    );
    return;
  }
  const person = auswahl({
    label: "Person",
    optionen: frei.map((p) => [
      p.id,
      p.ceviName ? `${p.name} (${p.ceviName})` : p.name,
    ]),
    wert: frei[0].id,
  });
  const rolle = rollenAuswahl("team");
  dialogFormular({
    titel: "Person hinzufügen",
    beschreibung:
      "Nur Personen mit Konto lassen sich hinzufügen. Die Änderung gilt ab der nächsten Anfrage der Person.",
    felder: [person.wurzel, rolle.wurzel],
    ok: "Hinzufügen",
    senden: () =>
      anfrage(
        "PUT",
        `${BASIS}/${lager.id}/mitglieder/${person.eingabe.value}`,
        {
          rolle: rolle.eingabe.value,
        },
      ),
    fehlertext: meldung,
    danach: () => {
      neu();
      ctx.melde("Die Person ist Mitglied des Lagers.");
    },
  });
}

// Rechte der Rollen -----------------------------------------------------------

const EINSTELLBAR = [
  ["leitung", "Leitung"],
  ["team", "Team"],
  ["lesen", "Lesen"],
];

function zeichneRechte(bereich, ctx, lager, rechte, neu) {
  ctx.titel("Rechte der Rollen", lager.titel);
  const zu = geschlossen(lager);
  // Geändert gegenüber dem geladenen Stand: "rolle|recht" -> erlaubt
  const geaendert = new Map();
  const speichern = knopf("Speichern", {
    art: "haupt",
    symbol: "haken",
    disabled: true,
    onclick: async () => {
      speichern.disabled = true;
      speichern.setAttribute("aria-busy", "true");
      try {
        await anfrage("PUT", `${BASIS}/${lager.id}/rechte`, {
          rechte: [...geaendert].map(([k, erlaubt]) => {
            const [rolle, recht] = k.split("|");
            return { rolle, recht, erlaubt };
          }),
        });
        neu();
        ctx.melde(
          "Die Rechte sind gespeichert. Sie gelten ab der nächsten Anfrage.",
        );
      } catch (f) {
        speichern.removeAttribute("aria-busy");
        speichern.disabled = false;
        ctx.melde(meldung(f), "fehler");
      }
    },
  });
  const zuruecksetzen = knopf("Auf Standard zurücksetzen", {
    symbol: "aktualisieren",
    onclick: () =>
      dialogFormular({
        titel: "Rechte auf den Standard zurücksetzen?",
        beschreibung:
          "Leitung, Team und Lesen bekommen in diesem Lager wieder die Rechte, die der Katalog vorgibt. Nicht gespeicherte Änderungen hier gehen verloren.",
        ok: "Zurücksetzen",
        senden: () =>
          anfrage("POST", `${BASIS}/${lager.id}/rechte/zuruecksetzen`),
        fehlertext: meldung,
        danach: () => {
          neu();
          ctx.melde("Die Rechte sind auf den Standard zurückgesetzt.");
        },
      }),
  });
  if (zu) ctx.kopfAktion();
  else ctx.kopfAktion(zuruecksetzen, speichern);
  const suchId = neueId("lg-suche");
  const suche = el("input", {
    class: "eingabe",
    id: suchId,
    type: "search",
    placeholder: "Recht suchen",
    autocomplete: "off",
  });
  const status = el("p", { class: "nur-leser", role: "status" });
  const zeilen = rechte.map((r) => {
    const abweichung = EINSTELLBAR.some(
      ([rolle]) => r.aktuell[rolle] !== r.standard[rolle],
    );
    const zelle = ([rolle, name]) => {
      const box = el("input", {
        type: "checkbox",
        "aria-label": `${r.bedeutung}: ${name}`,
        disabled: zu,
      });
      box.checked = r.aktuell[rolle];
      box.addEventListener("change", () => {
        const k = `${rolle}|${r.recht}`;
        if (box.checked === r.aktuell[rolle]) geaendert.delete(k);
        else geaendert.set(k, box.checked);
        speichern.disabled = geaendert.size === 0;
      });
      return el("td", { class: "lg-haken" }, el("label", {}, box));
    };
    const zeile = el(
      "tr",
      {},
      el(
        "th",
        { scope: "row" },
        el("span", { class: "name" }, r.bedeutung),
        el("span", { class: "klein leise mono" }, r.recht),
        abweichung &&
          el(
            "span",
            { class: "klein lg-abweichung" },
            "Weicht vom Standard ab",
          ),
      ),
      EINSTELLBAR.map(zelle),
    );
    zeile.dataset.suche = `${r.bedeutung} ${r.recht}`.toLowerCase();
    return zeile;
  });
  suche.addEventListener("input", () => {
    const q = suche.value.trim().toLowerCase();
    let n = 0;
    for (const z of zeilen) {
      z.hidden = !z.dataset.suche.includes(q);
      if (!z.hidden) n++;
    }
    status.textContent = n === 1 ? "1 Recht." : `${n} Rechte.`;
  });
  const { wurzel: rahmen } = tabelle({
    beschriftung: "Rechte der Rollen",
    spalten: [
      "Recht",
      ["Leitung", "lg-haken"],
      ["Team", "lg-haken"],
      ["Lesen", "lg-haken"],
    ],
    zeilen,
  });
  haenge(
    bereich,
    zurueck(lager),
    zu && schreibschutz(),
    el(
      "div",
      { class: "hinweis hinweis--info", role: "status" },
      el(
        "span",
        {},
        "Die Lagerleitung darf immer alles und lässt sich nicht einstellen. Die Rechte gelten nur in diesem Lager.",
      ),
    ),
    el(
      "div",
      { class: "werkzeuge" },
      el(
        "div",
        { class: "suche" },
        el("label", { class: "nur-leser", for: suchId }, "Recht suchen"),
        symbol("lupe"),
        suche,
      ),
    ),
    rahmen,
    status,
  );
}

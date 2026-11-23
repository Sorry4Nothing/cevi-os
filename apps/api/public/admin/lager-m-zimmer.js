import { anfrage } from "./api.js";
import {
  auswahl,
  dialogFormular,
  el,
  feld,
  filterGruppe,
  knopf,
  menue,
} from "./dom.js";
import { zahlfeld } from "./datumsfeld.js";
import { blendeAus, skeletonBrett } from "./lager-einteilung-laden.js";
import { blitze, staffle, wachseBis } from "./lager-anim.js";
import { leerKarte } from "./zustaende.js";
import { haenge } from "./lager-gemeinsam.js";
import {
  belegung,
  eingeteilteSchluessel,
  mehrzahl,
  nachArt,
  nameVergleich,
  personSchluessel,
} from "./lager-menschen-logik.js";
import {
  kopfAktion,
  auswahlLeiste,
  erstelleAuswahl,
  keinLeserecht,
  kopfeMitHinweis,
  LB,
  ladeAlle,
  ladeKontext,
  meldung,
  personZeile,
  sendeMitKonflikt,
  zustandsChip,
  fuelle,
} from "./lager-menschen.js";
import { zielFlaeche } from "./lager-ziehen.js";

// Zimmer und Zelte (#675; Server #385): Karten mit Belegung, daneben die Liste «Nicht eingeteilt». Personen ziehen (Griff), im Menü «Verschieben» wählen oder mehrere ankreuzen und mit der Leiste unten einteilen. Mehr Personen als Plätze ist erlaubt und wird gemeldet. Das Team sieht nur das eigene Zimmer mit den Namen der anderen. Adresse: #lager/lager/<id>/zimmer

export function zeige(bereich, ctx, lagerId, lager) {
  ctx.lade(
    async () => {
      const k = await ladeKontext(lagerId, lager);
      if (!k.darf("einteilung.lesen")) return { k };
      const a = await anfrage("GET", `${LB(lagerId)}/zimmer`);
      // Wer einteilen darf, bekommt die Listen der Nicht-Eingeteilten (zwei Arten, mit Cursor)
      const bearbeiten = k.darf("einteilung.bearbeiten");
      const [offenT, offenP] =
        bearbeiten && a.offen
          ? await Promise.all([
              ladeAlle(
                `${LB(lagerId)}/zimmer/offen?art=teilnehmer`,
                "eintraege",
              ),
              ladeAlle(`${LB(lagerId)}/zimmer/offen?art=team`, "eintraege"),
            ])
          : [[], []];
      return { k, a, offenT, offenP };
    },
    (d, neu) => {
      kopfeMitHinweis(bereich, ctx, d.k, "Zimmer und Zelte");
      if (!d.a) return keinLeserecht(bereich, "Zimmer und Zelte");
      zeichne(bereich, ctx, d, neu);
    },
    { skeleton: () => skeletonBrett({ mitBalken: true }) },
  );
}

const ARTEN = [
  ["zimmer", "Zimmer"],
  ["zelt", "Zelt"],
];
const ARTNAME = Object.fromEntries(ARTEN);
const FELDER = [
  ["name", "Name"],
  ["art", "Art", (w) => ARTNAME[w] ?? w],
  ["plaetze", "Plätze"],
  ["notiz", "Notiz"],
];

function zeichne(bereich, ctx, { k, a, offenT, offenP }, neu) {
  const bearbeiten = k.kann("einteilung.bearbeiten");
  // Das Team sieht nur das eigene Zimmer: keine Plätze, keine Belegung, keine Liste der Offenen
  const nurEigene = a.offen === undefined;
  kopfAktion(
    ctx,
    bearbeiten
      ? knopf("Zimmer anlegen", {
          art: "haupt",
          symbol: "plus",
          onclick: () => formular(ctx, k, null, neu),
        })
      : false,
  );

  if (nurEigene) {
    haenge(
      bereich,
      a.zimmer.length === 0
        ? leerKarte("Du bist noch keinem Zimmer zugeteilt.")
        : el(
            "div",
            { class: "mn-karten" },
            a.zimmer.map((z) =>
              el(
                "section",
                { class: "flaeche mn-zimmer", "aria-label": z.name },
                el(
                  "div",
                  { class: "mn-flaechenkopf" },
                  el("h2", {}, z.name),
                  zustandsChip(ARTNAME[z.art] ?? z.art),
                ),
                el(
                  "ul",
                  { class: "mn-liste" },
                  z.mitglieder.map((m) =>
                    el(
                      "li",
                      { class: "mn-person" },
                      el("span", { class: "name" }, m.name),
                    ),
                  ),
                ),
              ),
            ),
          ),
    );
    return;
  }

  // Lokaler Stand: Zimmer mit Mitgliedern [{ typ, id, name }], dazu die Offenen
  let zimmer = a.zimmer.map((z) => ({
    ...z,
    mitglieder: z.mitglieder.map((m) => ({ ...m })),
  }));
  const offen = {
    teilnehmer: offenT.map((t) => ({
      typ: "teilnehmer",
      id: t.id,
      name: `${t.vorname} ${t.nachname}`,
      neben: t.stufe ?? undefined,
    })),
    person: offenP.map((p) => ({ typ: "person", id: p.id, name: p.name })),
  };
  const mitSchluessel = (p, quelle) => ({
    ...p,
    schluessel: personSchluessel(p.typ, p.id),
    quelle,
  });
  const wahl = erstelleAuswahl(() => {
    leiste.aktualisiere();
  });
  const zustand = { tab: "teilnehmer", suche: "" };
  // Belegung beim letzten Zeichnen: Der Balken wächst vom alten zum neuen Wert
  const fuellStand = new Map();
  let letztesZiel = null;
  const brett = el("div", { class: "mn-brett" });
  const leiste = auswahlLeiste({
    auswahl: wahl,
    text: "Einteilen",
    ziele: () => [
      ...zimmer.map((z) => [z.id, z.name]),
      ["__offen", "Nicht eingeteilt"],
    ],
    beiAusfuehren: (ziel, personen) =>
      verschiebe(personen, ziel === "__offen" ? null : ziel),
  });

  // --- Schreiben: erst entfernen, dann einteilen; schlägt das Einteilen fehl, kommen die Personen zurück ---
  async function entferne(zimmerId, personen) {
    await anfrage(
      "POST",
      `${LB(k.lagerId)}/zimmer/${zimmerId}/zuordnung/entfernen`,
      nachArt(personen),
    );
  }
  async function verschiebe(personen, zielId) {
    // Wer schon im Ziel ist, bleibt
    const wandern = personen.filter((p) => p.quelle !== zielId);
    if (wandern.length === 0) return;
    const jeQuelle = new Map();
    for (const p of wandern)
      if (p.quelle)
        jeQuelle.set(p.quelle, [...(jeQuelle.get(p.quelle) ?? []), p]);
    const entfernt = [];
    try {
      for (const [q, liste] of jeQuelle) {
        await entferne(q, liste);
        entfernt.push([q, liste]);
      }
      if (zielId)
        await anfrage(
          "POST",
          `${LB(k.lagerId)}/zimmer/${zielId}/zuordnung`,
          nachArt(wandern),
        );
    } catch (f) {
      // Zurück an den alten Platz, damit niemand verloren geht
      for (const [q, liste] of entfernt)
        await anfrage(
          "POST",
          `${LB(k.lagerId)}/zimmer/${q}/zuordnung`,
          nachArt(liste),
        ).catch(() => {});
      ctx.melde(meldung(f), "fehler");
      neu();
      return;
    }
    wahl.leeren();
    letztesZiel = zielId;
    lokalVerschieben(wandern, zielId);
    const ziel = zimmer.find((z) => z.id === zielId);
    const text =
      wandern.length === 1
        ? wandern[0].name
        : mehrzahl(wandern.length, "Person", "Personen");
    if (!ziel)
      ctx.melde(
        `${text} ${wandern.length === 1 ? "ist" : "sind"} nicht mehr eingeteilt.`,
      );
    else {
      const b = belegung({
        belegt: ziel.mitglieder.length,
        plaetze: ziel.plaetze,
      });
      ctx.melde(
        b.ueberbelegt
          ? `${text} in «${ziel.name}» eingeteilt. Achtung: Es sind mehr Personen als Plätze.`
          : `${text} in «${ziel.name}» eingeteilt.`,
        b.ueberbelegt ? "warn" : "ok",
      );
    }
  }
  function lokalVerschieben(personen, zielId) {
    const keys = new Set(personen.map((p) => p.schluessel));
    for (const z of zimmer)
      z.mitglieder = z.mitglieder.filter(
        (m) => !keys.has(personSchluessel(m.typ, m.id)),
      );
    for (const art of ["teilnehmer", "person"])
      offen[art] = offen[art].filter(
        (p) => !keys.has(personSchluessel(p.typ, p.id)),
      );
    const ziel = zimmer.find((z) => z.id === zielId);
    for (const p of personen) {
      const roh = { typ: p.typ, id: p.id, name: p.name, neben: p.neben };
      if (ziel) ziel.mitglieder.push(roh);
      else offen[p.typ].push(roh);
    }
    zeichneBrett();
  }

  // --- Anzeige ---
  const menueFuer = (p) => {
    if (!bearbeiten) return [];
    const ziele = zimmer
      .filter((z) => z.id !== p.quelle)
      .map((z) => ({
        text: `${p.quelle ? "Verschieben" : "Einteilen"} nach «${z.name}»`,
        onclick: () => verschiebe([p], z.id),
      }));
    return p.quelle
      ? [
          ...ziele,
          {
            text: "Aus dem Zimmer nehmen",
            onclick: () => verschiebe([p], null),
          },
        ]
      : ziele;
  };
  const zeile = (m, quelle) => {
    const p = mitSchluessel(m, quelle);
    return personZeile(p, {
      auswahl: bearbeiten ? wahl : undefined,
      ziehen: bearbeiten,
      eintraege: menueFuer(p),
    });
  };

  function karte(z) {
    const b = belegung({ belegt: z.mitglieder.length, plaetze: z.plaetze });
    const mitglieder = [...z.mitglieder].sort((x, y) =>
      nameVergleich(x.name, y.name),
    );
    const liste = el(
      "ul",
      { class: "mn-liste", "aria-label": `Eingeteilt in ${z.name}` },
      mitglieder.map((m) => zeile(m, z.id)),
    );
    const fuell = el("progress", {
      class: `mn-fuell${b.ueberbelegt ? " ist-voll" : ""}`,
      max: String(z.plaetze),
      value: String(Math.min(z.mitglieder.length, z.plaetze)),
      "aria-label": `Belegung ${z.name}`,
    });
    const wert = Math.min(z.mitglieder.length, z.plaetze);
    wachseBis(fuell, fuellStand.get(z.id) ?? 0, wert);
    fuellStand.set(z.id, wert);
    const karteEl = el(
      "section",
      {
        class: "flaeche mn-zimmer",
        "aria-labelledby": `zimmer-${z.id}`,
        "data-karte": z.id,
      },
      el(
        "div",
        { class: "mn-flaechenkopf" },
        el("h2", { id: `zimmer-${z.id}` }, z.name),
        el(
          "div",
          { class: "mn-aktionen" },
          zustandsChip(ARTNAME[z.art] ?? z.art),
          bearbeiten &&
            menue(z.name, [
              { text: "Ändern", onclick: () => formular(ctx, k, z, neu) },
              { text: "Löschen", gefaehrlich: true, onclick: () => loesche(z) },
            ]),
        ),
      ),
      el("p", { class: "mn-fuelltext" }, b.text),
      fuell,
      b.ueberbelegt &&
        el(
          "p",
          { class: "mn-warn" },
          zustandsChip(
            `Überbelegt: ${z.mitglieder.length - z.plaetze} zu viel`,
            "warn",
            "warnung",
          ),
        ),
      z.notiz && el("p", { class: "klein leise" }, z.notiz),
      mitglieder.length === 0
        ? el(
            "p",
            { class: "mn-leerzeile leise" },
            bearbeiten
              ? "Noch niemand eingeteilt. Ziehe Personen hierher."
              : "Noch niemand eingeteilt.",
          )
        : liste,
    );
    if (bearbeiten)
      zielFlaeche(karteEl, {
        akzeptiert: () => true,
        beiAblegen: (last) => verschiebe(last, z.id),
      });
    return karteEl;
  }

  function offenFlaeche() {
    const art = zustand.tab;
    const roh = offen[art].filter(
      (p) =>
        zustand.suche === "" || p.name.toLowerCase().includes(zustand.suche),
    );
    const sortiert = [...roh].sort((x, y) => nameVergleich(x.name, y.name));
    const liste = el(
      "ul",
      { class: "mn-liste", "aria-label": "Nicht eingeteilt" },
      sortiert.map((p) => zeile(p, null)),
    );
    const f = el(
      "section",
      { class: "flaeche mn-offen", "aria-labelledby": "zimmer-offen" },
      el("h2", { id: "zimmer-offen" }, "Nicht eingeteilt"),
      el(
        "p",
        { class: "klein leise" },
        `${mehrzahl(offen.teilnehmer.length, "Teilnehmende", "Teilnehmende")}, ${offen.person.length} im Team`,
      ),
      tabs.wurzel,
      suche.wurzel,
      sortiert.length === 0
        ? el(
            "p",
            { class: "mn-leerzeile leise" },
            zustand.suche
              ? `Keine Treffer für «${zustand.suche}».`
              : "Alle sind eingeteilt.",
          )
        : liste,
    );
    // Zurück auf die Liste ziehen nimmt die Person aus dem Zimmer
    zielFlaeche(f, {
      akzeptiert: (last) => last.some((p) => p.quelle),
      beiAblegen: (last) =>
        verschiebe(
          last.filter((p) => p.quelle),
          null,
        ),
    });
    return f;
  }

  const tabs = filterGruppe({
    beschriftung: "Wer ist nicht eingeteilt",
    eintraege: [
      { text: "Teilnehmende", wert: "teilnehmer" },
      { text: "Team", wert: "person" },
    ],
    beiAenderung: (t) => {
      zustand.tab = t;
      zeichneBrett();
    },
  });
  const suche = feld({
    label: "Person suchen",
    typ: "search",
    autocomplete: "off",
    spellcheck: "false",
  });
  suche.wurzel.querySelector("label").classList.add("nur-leser");
  suche.eingabe.setAttribute("placeholder", "Person suchen");
  suche.eingabe.addEventListener("input", () => {
    zustand.suche = suche.eingabe.value.trim().toLowerCase();
    zeichneBrett();
    suche.eingabe.focus();
  });

  function zeichneBrett() {
    const alleKeys = new Set([
      ...offen.teilnehmer.map((p) => personSchluessel(p.typ, p.id)),
      ...offen.person.map((p) => personSchluessel(p.typ, p.id)),
      ...eingeteilteSchluessel(zimmer),
    ]);
    wahl.bereinige(alleKeys);
    const fokus = document.activeElement;
    const fokusSuche = fokus === suche.eingabe;
    const erster = !brett.firstChild;
    const karten = el("div", { class: "mn-karten" }, zimmer.map(karte));
    fuelle(brett, bearbeiten ? offenFlaeche() : false, karten);
    if (erster) staffle(karten.children);
    // Das Ziel meldet den Eingang kurz zurück
    if (letztesZiel) {
      blitze(brett.querySelector(`[data-karte="${CSS.escape(letztesZiel)}"]`));
      letztesZiel = null;
    }
    if (fokusSuche) suche.eingabe.focus();
    leiste.aktualisiere();
  }

  function loesche(z) {
    const rest = { ...z };
    const index = zimmer.findIndex((x) => x.id === z.id);
    ctx.mitRueckgaengig({
      text: `«${z.name}» ist gelöscht`,
      ansicht: {
        weg: () => {
          zimmer = zimmer.filter((x) => x.id !== z.id);
          blendeAus(
            brett.querySelector(`[data-karte="${CSS.escape(z.id)}"]`),
          ).then(zeichneBrett);
        },
        zurueck: () => {
          zimmer.splice(index, 0, rest);
          zeichneBrett();
        },
      },
      ausfuehren: () =>
        anfrage(
          "DELETE",
          `${LB(k.lagerId)}/zimmer/${z.id}?version=${z.version}`,
        ),
      fehlertext: meldung,
      danach: neu,
    });
  }

  if (zimmer.length === 0 && !bearbeiten) {
    haenge(bereich, leerKarte("Es gibt noch keine Zimmer oder Zelte."));
    return;
  }
  if (zimmer.length === 0)
    haenge(
      bereich,
      leerKarte(
        "Noch keine Zimmer oder Zelte. Lege das erste an und teile dann die Personen ein.",
        [
          knopf("Zimmer anlegen", {
            art: "haupt",
            symbol: "plus",
            onclick: () => formular(ctx, k, null, neu),
          }),
        ],
      ),
    );
  haenge(
    bereich,
    bearbeiten &&
      el(
        "p",
        { class: "klein leise" },
        "Ziehe Personen mit dem Griff in ein Zimmer. Ohne Maus: Menü «Mehr» der Person oder mehrere ankreuzen und unten einteilen.",
      ),
    brett,
    leiste.wurzel,
  );
  zeichneBrett();
}

// Zimmer oder Zelt anlegen und ändern
function formular(ctx, k, z, neu) {
  const name = feld({
    label: "Name",
    wert: z?.name ?? "",
    maxlength: 100,
    autocomplete: "off",
    required: true,
  });
  const art = auswahl({
    label: "Art",
    optionen: ARTEN,
    wert: z?.art ?? "zimmer",
  });
  const plaetze = zahlfeld({
    label: "Plätze",
    wert: z?.plaetze ?? "",
    min: 1,
    max: 1000,
    required: true,
  });
  const notiz = feld({
    label: "Notiz",
    hilfe: "Freiwillig. Nur für die Leitung.",
    wert: z?.notiz ?? "",
    mehrzeilig: true,
    maxlength: 500,
  });
  const werte = () => ({
    name: name.eingabe.value.trim(),
    art: art.eingabe.value,
    plaetze: Number(plaetze.eingabe.value),
    notiz: notiz.eingabe.value.trim() || null,
  });
  let seite;
  const sende = async (version) => {
    const w = werte();
    if (!z) return anfrage("POST", `${LB(k.lagerId)}/zimmer`, w);
    const geaendert = Object.fromEntries(
      Object.entries(w).filter(([key, wert]) => (z[key] ?? null) !== wert),
    );
    if (Object.keys(geaendert).length === 0) return z;
    return anfrage("PATCH", `${LB(k.lagerId)}/zimmer/${z.id}`, {
      version: version ?? z.version,
      ...geaendert,
    });
  };
  seite = dialogFormular({
    titel: z ? "Zimmer ändern" : "Zimmer anlegen",
    beschreibung: z ? z.name : "Ein Zimmer oder ein Zelt mit seinen Plätzen.",
    felder: [name.wurzel, art.wurzel, plaetze.wurzel, notiz.wurzel],
    ok: z ? "Speichern" : "Anlegen",
    fehlertext: meldung,
    pruefe: () => {
      const n = Number(plaetze.eingabe.value);
      if (Number.isInteger(n) && n >= 1 && n <= 1000) return false;
      const alt = plaetze.wurzel.querySelector(".feld-fehler");
      alt?.remove();
      plaetze.wurzel.append(
        el(
          "p",
          { class: "feld-fehler", role: "alert" },
          "Gib eine Zahl von 1 bis 1000 ein.",
        ),
      );
      plaetze.eingabe.focus();
      return true;
    },
    senden: sendeMitKonflikt({
      getSeite: () => seite,
      sende,
      felder: FELDER,
      meine: werte,
      beiServer: neu,
    }),
    danach: () => {
      ctx.melde(z ? "Gespeichert." : `«${werte().name}» ist angelegt.`);
      neu();
    },
  });
}

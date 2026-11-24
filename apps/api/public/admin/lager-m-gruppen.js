import { anfrage } from "./api.js";
import {
  dialogFormular,
  el,
  feld,
  filterGruppe,
  knopf,
  menue,
  seitenblatt,
} from "./dom.js";
import { zahlfeld } from "./datumsfeld.js";
import {
  blendeAus,
  skeletonBrett,
  skeletonVorschauKarten,
} from "./lager-einteilung-laden.js";
import { blitze, blendeEin, skeletonSpaeter, staffle } from "./lager-anim.js";
import { leerKarte } from "./zustaende.js";
import { ADRESSE, haenge } from "./lager-gemeinsam.js";
import {
  mehrzahl,
  nachArt,
  nameVergleich,
  personSchluessel,
  teilnehmerName,
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

// Gruppen und Mischen (#675; Server #387): Programmgruppen als Spalten, Kinder und Leitende per Ziehen, Menü oder Auswahlleiste zuteilen, automatisch mischen mit Vorschau. Wer «nicht dabei» ist, steht in keiner Gruppe (das ändert sich unter «Teilnehmende»). Adresse: #lager/lager/<id>/gruppen

export function zeige(bereich, ctx, lagerId, lager) {
  ctx.lade(
    async () => {
      const k = await ladeKontext(lagerId, lager);
      if (!k.darf("einteilung.lesen")) return { k };
      const [a, kinder, mitglieder] = await Promise.all([
        anfrage("GET", `${LB(lagerId)}/gruppen`),
        k.darf("teilnehmer.lesen")
          ? ladeAlle(`${LB(lagerId)}/teilnehmer`, "teilnehmer")
          : null,
        anfrage("GET", `${LB(lagerId)}/mitglieder`)
          .then((m) => m.mitglieder)
          .catch(() => []),
      ]);
      return { k, a, kinder, mitglieder };
    },
    (d, neu) => {
      kopfeMitHinweis(bereich, ctx, d.k, "Gruppen");
      if (!d.a) return keinLeserecht(bereich, "die Gruppen");
      zeichne(bereich, ctx, d, neu);
    },
    { skeleton: () => skeletonBrett({ werkzeuge: true }) },
  );
}

function zeichne(bereich, ctx, { k, a, kinder, mitglieder }, neu) {
  const bearbeiten = k.kann("einteilung.bearbeiten");
  kopfAktion(
    ctx,
    bearbeiten
      ? knopf("Gruppe anlegen", {
          art: "haupt",
          symbol: "plus",
          onclick: () => nameFormular(ctx, k, null, neu),
        })
      : false,
  );
  let gruppen = a.gruppen.map((g) => ({
    ...g,
    teilnehmer: g.teilnehmer.map((t) => ({ ...t })),
    personen: g.personen.map((p) => ({ ...p })),
  }));
  const zustand = { tab: "kinder", suche: "" };
  let letztesZiel = null;
  const wahl = erstelleAuswahl(() => leiste.aktualisiere());
  const brett = el("div", { class: "mn-brett" });

  // Wer ohne Gruppe ist: Kinder aus der Liste der Teilnehmenden, Leitende aus den Mitgliedern
  const offeneKinder = () => {
    if (!kinder) return [];
    const drin = new Set(gruppen.flatMap((g) => g.teilnehmer.map((t) => t.id)));
    return kinder.filter((t) => !t.abgewaehlt && !drin.has(t.id));
  };
  const offeneLeitende = () => {
    const drin = new Set(
      gruppen.flatMap((g) => g.personen.map((p) => p.personId)),
    );
    return mitglieder.filter((m) => !drin.has(m.personId));
  };
  const alsKind = (t) => ({
    typ: "teilnehmer",
    id: t.id,
    name: teilnehmerName(t),
    neben: t.stufe ?? undefined,
  });
  const alsLeitung = (p) => ({
    typ: "person",
    id: p.personId,
    name: p.name,
    bildUrl: p.bildUrl ?? null,
    neben:
      p.rolle === "leitung"
        ? "Leitung"
        : p.rolle === "mitglied"
          ? "Mitglied"
          : undefined,
    rolle: p.rolle,
  });
  const mit = (p, quelle) => ({
    ...p,
    schluessel: personSchluessel(p.typ, p.id),
    quelle,
  });

  const leiste = auswahlLeiste({
    auswahl: wahl,
    text: "Zuteilen",
    ziele: () => [
      ...gruppen.map((g) => [g.id, g.name]),
      ["__keine", "In keiner Gruppe"],
    ],
    beiAusfuehren: (ziel, personen) =>
      teile(personen, ziel === "__keine" ? null : ziel),
  });

  // Zuteilen: eine Anfrage je Rolle; die Antwort des Servers zählt, der Stand wird danach lokal nachgeführt
  async function teile(personen, gruppeId, rolle) {
    const wandern = personen.filter(
      (p) => p.quelle !== gruppeId || (rolle && p.rolle !== rolle),
    );
    if (wandern.length === 0) return;
    try {
      const kinderTeil = wandern.filter((p) => p.typ === "teilnehmer");
      const leitung = wandern.filter((p) => p.typ === "person");
      if (kinderTeil.length > 0)
        await anfrage("PUT", `${LB(k.lagerId)}/gruppen/zuordnung`, {
          gruppeId,
          ...nachArt(kinderTeil),
          rolle: "mitglied",
        });
      // Leitende behalten ihre Rolle; neu im Lager einer Gruppe gelten sie als Leitung
      for (const r of ["leitung", "mitglied"]) {
        const teil = leitung.filter(
          (p) => (rolle ?? p.rolle ?? "leitung") === r,
        );
        if (teil.length > 0)
          await anfrage("PUT", `${LB(k.lagerId)}/gruppen/zuordnung`, {
            gruppeId,
            ...nachArt(teil),
            rolle: r,
          });
      }
    } catch (f) {
      ctx.melde(meldung(f), "fehler");
      neu();
      return;
    }
    const keys = new Set(wandern.map((p) => p.schluessel));
    for (const g of gruppen) {
      g.teilnehmer = g.teilnehmer.filter(
        (t) => !keys.has(personSchluessel("teilnehmer", t.id)),
      );
      g.personen = g.personen.filter(
        (p) => !keys.has(personSchluessel("person", p.personId)),
      );
    }
    const ziel = gruppen.find((g) => g.id === gruppeId);
    if (ziel)
      for (const p of wandern) {
        if (p.typ === "teilnehmer") {
          const t =
            kinder?.find((x) => x.id === p.id) ??
            ziel.teilnehmer.find((x) => x.id === p.id);
          ziel.teilnehmer.push(
            t ?? {
              id: p.id,
              vorname: p.name,
              nachname: "",
              stufe: p.neben ?? null,
            },
          );
        } else {
          ziel.personen.push({
            personId: p.id,
            name: p.name,
            ceviName: null,
            bildUrl: p.bildUrl ?? null,
            rolle: rolle ?? p.rolle ?? "leitung",
          });
        }
      }
    wahl.leeren();
    letztesZiel = gruppeId;
    zeichneBrett();
    const text =
      wandern.length === 1
        ? wandern[0].name
        : mehrzahl(wandern.length, "Person", "Personen");
    ctx.melde(
      ziel
        ? `${text} ${wandern.length === 1 ? "ist" : "sind"} jetzt in «${ziel.name}».`
        : `${text} ${wandern.length === 1 ? "ist" : "sind"} in keiner Gruppe mehr.`,
    );
  }

  const menueFuer = (p, g) => {
    if (!bearbeiten) return [];
    const ziele = gruppen
      .filter((x) => x.id !== p.quelle)
      .map((x) => ({
        text: `${p.quelle ? "Verschieben" : "Zuteilen"} nach «${x.name}»`,
        onclick: () => teile([p], x.id),
      }));
    const rolle =
      p.typ === "person" && g
        ? [
            {
              text:
                p.rolle === "leitung"
                  ? "Als Mitglied führen"
                  : "Als Leitung führen",
              onclick: () =>
                teile(
                  [p],
                  g.id,
                  p.rolle === "leitung" ? "mitglied" : "leitung",
                ),
            },
          ]
        : [];
    return [
      ...ziele,
      ...rolle,
      ...(p.quelle
        ? [{ text: "Aus der Gruppe nehmen", onclick: () => teile([p], null) }]
        : []),
    ];
  };
  const zeile = (p, g) => {
    const q = mit(p, g?.id ?? null);
    return personZeile(q, {
      auswahl: bearbeiten ? wahl : undefined,
      ziehen: bearbeiten,
      eintraege: menueFuer(q, g),
    });
  };

  function karte(g) {
    const ks = [...g.teilnehmer].sort((x, y) =>
      nameVergleich(teilnehmerName(x), teilnehmerName(y)),
    );
    const ps = [...g.personen].sort((x, y) =>
      x.rolle === y.rolle
        ? nameVergleich(x.name, y.name)
        : x.rolle === "leitung"
          ? -1
          : 1,
    );
    const f = el(
      "section",
      {
        class: "flaeche mn-zimmer",
        "aria-labelledby": `gruppe-${g.id}`,
        "data-karte": g.id,
      },
      el(
        "div",
        { class: "mn-flaechenkopf" },
        el("h2", { id: `gruppe-${g.id}` }, g.name),
        el(
          "div",
          { class: "mn-aktionen" },
          zustandsChip(mehrzahl(g.teilnehmer.length, "Kind", "Kinder")),
          bearbeiten &&
            menue(g.name, [
              {
                text: "Umbenennen",
                onclick: () => nameFormular(ctx, k, g, neu),
              },
              { text: "Löschen", gefaehrlich: true, onclick: () => loesche(g) },
            ]),
        ),
      ),
      ps.length > 0 &&
        el(
          "ul",
          { class: "mn-liste", "aria-label": `Leitende in ${g.name}` },
          ps.map((p) => zeile(alsLeitung(p), g)),
        ),
      ks.length === 0 && ps.length === 0
        ? el(
            "p",
            { class: "mn-leerzeile leise" },
            bearbeiten
              ? "Noch niemand in der Gruppe. Ziehe Personen hierher."
              : "Noch niemand in der Gruppe.",
          )
        : ks.length > 0 &&
            el(
              "ul",
              { class: "mn-liste", "aria-label": `Kinder in ${g.name}` },
              ks.map((t) => zeile(alsKind(t), g)),
            ),
    );
    if (bearbeiten)
      zielFlaeche(f, {
        akzeptiert: () => true,
        beiAblegen: (last) => teile(last, g.id),
      });
    return f;
  }

  const tabs = filterGruppe({
    beschriftung: "Wer ist ohne Gruppe",
    eintraege: [
      { text: "Kinder", wert: "kinder" },
      { text: "Leitende", wert: "leitende" },
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

  function offenFlaeche() {
    const kinderOffen = offeneKinder();
    const leitendeOffen = offeneLeitende();
    const art = zustand.tab;
    const roh = (
      art === "kinder"
        ? kinderOffen.map(alsKind)
        : leitendeOffen.map((m) => ({
            typ: "person",
            id: m.personId,
            name: m.name,
          }))
    )
      .filter(
        (p) =>
          zustand.suche === "" || p.name.toLowerCase().includes(zustand.suche),
      )
      .sort((x, y) => nameVergleich(x.name, y.name));
    const f = el(
      "section",
      { class: "flaeche mn-offen", "aria-labelledby": "gruppen-offen" },
      el("h2", { id: "gruppen-offen" }, "Ohne Gruppe"),
      el(
        "p",
        { class: "klein leise" },
        kinder
          ? `${mehrzahl(kinderOffen.length, "Kind", "Kinder")}, ${mehrzahl(leitendeOffen.length, "Leitende", "Leitende")}`
          : `${mehrzahl(a.ohneGruppe, "Kind", "Kinder")} ohne Gruppe. Für die Namen fehlt dir das Recht, Teilnehmende zu lesen.`,
      ),
      tabs.wurzel,
      suche.wurzel,
      roh.length === 0
        ? el(
            "p",
            { class: "mn-leerzeile leise" },
            zustand.suche
              ? `Keine Treffer für «${zustand.suche}».`
              : art === "kinder"
                ? "Alle Kinder sind in einer Gruppe."
                : "Alle Leitenden sind in einer Gruppe.",
          )
        : el(
            "ul",
            { class: "mn-liste", "aria-label": "Ohne Gruppe" },
            roh.map((p) => zeile(p, null)),
          ),
    );
    zielFlaeche(f, {
      akzeptiert: (last) => last.some((p) => p.quelle),
      beiAblegen: (last) =>
        teile(
          last.filter((p) => p.quelle),
          null,
        ),
    });
    return f;
  }

  function zeichneBrett() {
    const fokusSuche = document.activeElement === suche.eingabe;
    wahl.bereinige(
      new Set([
        ...offeneKinder().map((t) => personSchluessel("teilnehmer", t.id)),
        ...offeneLeitende().map((m) => personSchluessel("person", m.personId)),
        ...gruppen.flatMap((g) => [
          ...g.teilnehmer.map((t) => personSchluessel("teilnehmer", t.id)),
          ...g.personen.map((p) => personSchluessel("person", p.personId)),
        ]),
      ]),
    );
    const erster = !brett.firstChild;
    const karten = el("div", { class: "mn-karten" }, gruppen.map(karte));
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

  function loesche(g) {
    const index = gruppen.findIndex((x) => x.id === g.id);
    ctx.mitRueckgaengig({
      text: `«${g.name}» ist gelöscht`,
      ansicht: {
        weg: () => {
          gruppen = gruppen.filter((x) => x.id !== g.id);
          blendeAus(
            brett.querySelector(`[data-karte="${CSS.escape(g.id)}"]`),
          ).then(zeichneBrett);
        },
        zurueck: () => {
          gruppen.splice(index, 0, g);
          zeichneBrett();
        },
      },
      ausfuehren: () =>
        anfrage(
          "DELETE",
          `${LB(k.lagerId)}/gruppen/${g.id}?version=${g.version}`,
        ),
      fehlertext: meldung,
      danach: neu,
    });
  }

  if (gruppen.length === 0)
    haenge(
      bereich,
      leerKarte(
        bearbeiten
          ? "Noch keine Gruppen. Lege Programmgruppen an oder lass die Kinder mischen."
          : "Die Lagerleitung hat noch keine Gruppen angelegt.",
        bearbeiten
          ? [
              knopf("Gruppe anlegen", {
                art: "haupt",
                symbol: "plus",
                onclick: () => nameFormular(ctx, k, null, neu),
              }),
              knopf("Automatisch mischen", {
                onclick: () => mischenSeite(ctx, k, gruppen, neu),
              }),
            ]
          : [],
      ),
    );
  haenge(
    bereich,
    el(
      "div",
      { class: "mn-werkzeuge" },
      bearbeiten &&
        knopf("Automatisch mischen", {
          symbol: "sortieren",
          onclick: () => mischenSeite(ctx, k, gruppen, neu),
        }),
      false,
      a.abgewaehlt > 0 &&
        el(
          "p",
          { class: "klein leise" },
          `Nicht dabei: ${mehrzahl(a.abgewaehlt, "Kind", "Kinder")}. `,
          el(
            "a",
            { href: `${ADRESSE}/${k.lagerId}/teilnehmer`, class: "lg-verweis" },
            "Zu den Teilnehmenden",
          ),
        ),
    ),
    bearbeiten &&
      gruppen.length > 0 &&
      el(
        "p",
        { class: "klein leise" },
        "Ziehe Personen mit dem Griff in eine Gruppe. Ohne Maus: Menü «Mehr» der Person oder mehrere ankreuzen und unten zuteilen.",
      ),
    brett,
    leiste.wurzel,
  );
  if (gruppen.length > 0 || bearbeiten) zeichneBrett();
}

// Gruppe anlegen oder umbenennen
function nameFormular(ctx, k, g, neu) {
  const name = feld({
    label: "Name",
    wert: g?.name ?? "",
    maxlength: 100,
    autocomplete: "off",
    required: true,
  });
  const werte = () => ({ name: name.eingabe.value.trim() });
  let seite;
  const sende = async (version) => {
    const w = werte();
    if (!g) return anfrage("POST", `${LB(k.lagerId)}/gruppen`, w);
    if (w.name === g.name) return g;
    return anfrage("PATCH", `${LB(k.lagerId)}/gruppen/${g.id}`, {
      version: version ?? g.version,
      ...w,
    });
  };
  seite = dialogFormular({
    titel: g ? "Gruppe umbenennen" : "Gruppe anlegen",
    beschreibung: g ? g.name : "Eine Programmgruppe für das Lager.",
    felder: [name.wurzel],
    ok: g ? "Speichern" : "Anlegen",
    fehlertext: meldung,
    senden: sendeMitKonflikt({
      getSeite: () => seite,
      sende,
      felder: [["name", "Name"]],
      meine: werte,
      beiServer: neu,
    }),
    danach: () => {
      ctx.melde(g ? "Gespeichert." : `«${werte().name}» ist angelegt.`);
      neu();
    },
  });
}

// Mischen: Vorschau, anderer Vorschlag, übernehmen. Übernehmen ersetzt die Einteilung der Kinder, Leitende bleiben.
function mischenSeite(ctx, k, gruppen, neu) {
  const anzahl = zahlfeld({
    label: "Zahl der Gruppen",
    hilfe: "Von 2 bis 20. Die Kinder werden nach Stufe gleichmässig verteilt.",
    wert: Math.min(20, Math.max(2, gruppen.length)),
    min: 2,
    max: 20,
  });
  const ausgabe = el("div", { class: "mn-mischen", "aria-live": "polite" });
  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
    tabindex: "-1",
  });
  let seed = null;
  const vorschau = knopf("Vorschau ansehen", { art: "haupt", symbol: "lupe" });
  const anders = knopf("Anderer Vorschlag", {
    symbol: "aktualisieren",
    hidden: true,
  });
  const uebernehmen = knopf("Übernehmen", { art: "haupt", hidden: true });
  const n = () => Number(anzahl.eingabe.value);
  const gueltig = () => Number.isInteger(n()) && n() >= 2 && n() <= 20;

  async function schicke(uebernehmenJetzt, neuerSeed) {
    if (!gueltig()) {
      fehler.textContent = "Gib eine Zahl von 2 bis 20 ein.";
      fehler.hidden = false;
      fehler.focus();
      return null;
    }
    fehler.hidden = true;
    return anfrage("POST", `${LB(k.lagerId)}/gruppen/mischen`, {
      anzahl: n(),
      uebernehmen: uebernehmenJetzt,
      ...(seed !== null && !neuerSeed ? { seed } : {}),
    });
  }
  async function zeigeVorschau(neuerSeed) {
    for (const b of [vorschau, anders]) b.disabled = true;
    const stopp = skeletonSpaeter(ausgabe, () =>
      skeletonVorschauKarten(Math.min(Math.max(n(), 2), 6)),
    );
    try {
      const e = await schicke(false, neuerSeed);
      stopp();
      if (!e) return;
      seed = e.seed;
      ausgabe.replaceChildren(
        el(
          "p",
          { class: "leise" },
          "So würden die Kinder verteilt. «Übernehmen» ersetzt die bisherige Einteilung der Kinder. Leitende bleiben.",
        ),
        el(
          "div",
          { class: "mn-karten mn-karten--eng" },
          e.gruppen.map((g) =>
            el(
              "section",
              { class: "flaeche" },
              el("h3", {}, `${g.name} (${g.anzahl})`),
              el(
                "ul",
                { class: "mn-namen" },
                [...g.teilnehmer]
                  .sort((x, y) =>
                    nameVergleich(
                      `${x.nachname} ${x.vorname}`,
                      `${y.nachname} ${y.vorname}`,
                    ),
                  )
                  .map((t) =>
                    el(
                      "li",
                      {},
                      `${t.vorname} ${t.nachname}`,
                      t.stufe
                        ? el("span", { class: "leise klein" }, ` ${t.stufe}`)
                        : false,
                    ),
                  ),
              ),
            ),
          ),
        ),
      );
      anders.hidden = uebernehmen.hidden = false;
      vorschau.classList.remove("knopf--haupt");
      staffle(ausgabe.querySelector(".mn-karten").children);
      blendeEin(ausgabe.firstElementChild);
    } catch (f) {
      stopp();
      ausgabe.replaceChildren();
      fehler.textContent = meldung(f);
      fehler.hidden = false;
      fehler.focus();
    } finally {
      for (const b of [vorschau, anders]) b.disabled = false;
    }
  }
  vorschau.addEventListener("click", () => zeigeVorschau(true));
  anders.addEventListener("click", () => zeigeVorschau(true));
  anzahl.eingabe.addEventListener("input", () => {
    anders.hidden = uebernehmen.hidden = true;
    ausgabe.replaceChildren();
    seed = null;
  });
  uebernehmen.addEventListener("click", async () => {
    uebernehmen.disabled = true;
    uebernehmen.setAttribute("aria-busy", "true");
    try {
      const e = await schicke(true, false);
      if (!e) return;
      blatt.close();
      ctx.melde("Gruppen gemischt und übernommen.");
      neu();
    } catch (f) {
      fehler.textContent = meldung(f);
      fehler.hidden = false;
      fehler.focus();
    } finally {
      uebernehmen.disabled = false;
      uebernehmen.removeAttribute("aria-busy");
    }
  });
  const blatt = seitenblatt({
    titel: "Automatisch mischen",
    untertitel:
      "Zuerst siehst du eine Vorschau. Erst «Übernehmen» ändert die Einteilung.",
    inhalt: [anzahl.wurzel, fehler, ausgabe],
    fusszeile: [
      knopf("Abbrechen", { onclick: () => blatt.versuchSchliessen() }),
      vorschau,
      anders,
      uebernehmen,
    ],
  });
}

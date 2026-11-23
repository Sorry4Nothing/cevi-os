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
import { datumsfeld, zahlfeld, zeitfeld } from "./datumsfeld.js";
import { skeletonFlaeche } from "./lader.js";
import { leerKarte } from "./zustaende.js";
import { haenge } from "./lager-gemeinsam.js";
import {
  belegung,
  fahrtTitel,
  fahrtZeit,
  istHttps,
  mehrzahl,
  nameVergleich,
  personSchluessel,
  RICHTUNGEN,
  sortiereFahrten,
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

// Fahrten (#675; Server #386): Hin- und Rückfahrt getrennt, Autos mit Plätzen und ÖV-Gruppen. Links die Personen ohne Fahrt in dieser Richtung; ziehen, im Menü wählen oder mehrere ankreuzen. Eine Person sitzt je Richtung in höchstens einer Fahrt. Mehr Mitfahrende als Plätze ist erlaubt und wird gemeldet. Das Team sieht nur die eigene Fahrt. Der Server ruft weder Fahrplan noch Karte ab: Link und Kartenpunkt sind gespeicherte Angaben. Adresse: #lager/lager/<id>/fahrten

export function zeige(bereich, ctx, lagerId, lager) {
  ctx.lade(
    async () => {
      const k = await ladeKontext(lagerId, lager);
      if (!k.darf("einteilung.lesen")) return { k };
      const fahrten = await ladeAlle(`${LB(lagerId)}/fahrten`, "fahrten");
      // Das Team ohne Bearbeitungsrecht liest weder die Liste «ohne Fahrt» noch alle Mitglieder
      const bearbeiten = k.darf("einteilung.bearbeiten");
      const [hin, rueck, mitglieder] = bearbeiten
        ? await Promise.all([
            ladeAlle(`${LB(lagerId)}/fahrten/ohne?richtung=hin`, "personen"),
            ladeAlle(`${LB(lagerId)}/fahrten/ohne?richtung=rueck`, "personen"),
            anfrage("GET", `${LB(lagerId)}/mitglieder`).then(
              (m) => m.mitglieder,
            ),
          ])
        : [[], [], []];
      return { k, fahrten, ohne: { hin, rueck }, mitglieder };
    },
    (d, neu) => {
      kopfeMitHinweis(bereich, ctx, d.k, "Fahrten");
      if (!d.fahrten) return keinLeserecht(bereich, "die Fahrten");
      zeichne(bereich, ctx, d, neu);
    },
    { skeleton: () => skeletonFlaeche({ zeilen: 5, mitKnopf: true }) },
  );
}

const ARTEN = [
  ["auto", "Auto"],
  ["oev", "ÖV-Gruppe"],
];
const FELDER = [
  ["name", "Name"],
  ["fahrerPersonId", "Fahrer"],
  ["plaetze", "Plätze"],
  ["datum", "Datum"],
  ["zeit", "Abfahrt"],
  ["von", "Von"],
  ["nach", "Nach"],
  ["treffpunkt", "Treffpunkt"],
  ["link", "Link zum Fahrplan"],
  ["zielBezeichnung", "Ziel, Bezeichnung"],
  ["zielAdresse", "Ziel, Adresse"],
  ["zielLink", "Ziel, Link"],
];

const alsPerson = (p) => ({
  typ: p.teilnehmerId ? "teilnehmer" : "person",
  id: p.teilnehmerId ?? p.personId,
  name: p.name,
  neben: p.stufe ?? undefined,
});

function zeichne(bereich, ctx, { k, fahrten, ohne, mitglieder }, neu) {
  const bearbeiten = k.kann("einteilung.bearbeiten");
  kopfAktion(
    ctx,
    bearbeiten
      ? knopf("Fahrt anlegen", {
          art: "haupt",
          symbol: "plus",
          onclick: () =>
            formular(ctx, k, null, stand.richtung, mitglieder, neu),
        })
      : false,
  );
  // Lokaler Stand: Fahrten mit Mitfahrenden und die Listen ohne Fahrt
  let liste = fahrten.map((f) => ({
    ...f,
    mitfahrer: f.mitfahrer.map((m) => ({ ...m })),
  }));
  const offen = {
    hin: ohne.hin.map(alsPerson),
    rueck: ohne.rueck.map(alsPerson),
  };
  const stand = { richtung: "hin", suche: "" };
  const wahl = erstelleAuswahl(() => leiste.aktualisiere());
  const brett = el("div", { class: "mn-brett" });
  const leiste = auswahlLeiste({
    auswahl: wahl,
    text: "Einteilen",
    ziele: () => [
      ...sichtbare().map((f) => [f.id, fahrtTitel(f)]),
      ["__ohne", "Ohne Fahrt"],
    ],
    beiAusfuehren: (ziel, personen) =>
      verschiebe(personen, ziel === "__ohne" ? null : ziel),
  });
  const sichtbare = () =>
    sortiereFahrten(liste.filter((f) => f.richtung === stand.richtung));
  const mit = (p, quelle, mitfahrer) => ({
    ...p,
    schluessel: personSchluessel(p.typ, p.id),
    quelle,
    mitfahrer,
  });

  // Eine Person aus ihrer Fahrt nehmen und/oder in eine andere setzen; der Server prüft die Regel «eine Fahrt je Richtung»
  async function verschiebe(personen, zielId) {
    const wandern = personen.filter((p) => p.quelle !== zielId);
    if (wandern.length === 0) return;
    let ausgetragen = null;
    try {
      for (const p of wandern) {
        let nachher = p;
        if (p.quelle) {
          await anfrage(
            "DELETE",
            `${LB(k.lagerId)}/fahrten/${p.quelle}/mitfahrer/${p.mitfahrer.id}?version=${p.mitfahrer.version}`,
          );
          ausgetragen = p;
        }
        if (zielId) {
          const neuM = await anfrage(
            "POST",
            `${LB(k.lagerId)}/fahrten/${zielId}/mitfahrer`,
            {
              [p.typ === "teilnehmer" ? "teilnehmerId" : "personId"]: p.id,
            },
          );
          nachher = { ...p, neuM };
          ausgetragen = null;
        }
        lokal(p, zielId, nachher.neuM);
      }
    } catch (f) {
      // Wer schon aus seiner Fahrt genommen war, kommt zurück
      if (ausgetragen)
        await anfrage(
          "POST",
          `${LB(k.lagerId)}/fahrten/${ausgetragen.quelle}/mitfahrer`,
          {
            [ausgetragen.typ === "teilnehmer" ? "teilnehmerId" : "personId"]:
              ausgetragen.id,
          },
        ).catch(() => {});
      ctx.melde(meldung(f), "fehler");
      neu();
      return;
    }
    wahl.leeren();
    zeichneBrett();
    const ziel = liste.find((f) => f.id === zielId);
    const text =
      wandern.length === 1
        ? wandern[0].name
        : mehrzahl(wandern.length, "Person", "Personen");
    if (!ziel)
      ctx.melde(
        `${text} ${wandern.length === 1 ? "hat" : "haben"} keine Fahrt mehr in dieser Richtung.`,
      );
    else {
      const b = belegung({
        belegt: ziel.mitfahrer.length,
        plaetze: ziel.plaetze,
      });
      ctx.melde(
        b.ueberbelegt
          ? `${text} in «${fahrtTitel(ziel)}» eingeteilt. Achtung: Es sind mehr Mitfahrende als Plätze.`
          : `${text} in «${fahrtTitel(ziel)}» eingeteilt.`,
        b.ueberbelegt ? "warn" : "ok",
      );
    }
  }
  function lokal(p, zielId, neuM) {
    const rich = stand.richtung;
    if (p.quelle) {
      const q = liste.find((f) => f.id === p.quelle);
      if (q) q.mitfahrer = q.mitfahrer.filter((m) => m.id !== p.mitfahrer.id);
    }
    offen[rich] = offen[rich].filter(
      (x) => personSchluessel(x.typ, x.id) !== p.schluessel,
    );
    const ziel = liste.find((f) => f.id === zielId);
    if (ziel)
      ziel.mitfahrer.push({
        id: neuM.id,
        version: neuM.version,
        personId: p.typ === "person" ? p.id : null,
        teilnehmerId: p.typ === "teilnehmer" ? p.id : null,
        name: p.name,
        stufe: p.neben ?? null,
      });
    else
      offen[rich].push({ typ: p.typ, id: p.id, name: p.name, neben: p.neben });
  }

  const menueFuer = (p) => {
    if (!bearbeiten) return [];
    const ziele = sichtbare()
      .filter((f) => f.id !== p.quelle)
      .map((f) => ({
        text: `${p.quelle ? "Verschieben" : "Einteilen"} nach «${fahrtTitel(f)}»`,
        onclick: () => verschiebe([p], f.id),
      }));
    return p.quelle
      ? [
          ...ziele,
          {
            text: "Aus der Fahrt nehmen",
            onclick: () => verschiebe([p], null),
          },
        ]
      : ziele;
  };
  const zeile = (m, quelle, mitfahrer) => {
    const p = mit(m, quelle, mitfahrer);
    return personZeile(p, {
      auswahl: bearbeiten ? wahl : undefined,
      ziehen: bearbeiten,
      eintraege: menueFuer(p),
    });
  };

  function karte(f) {
    const b = belegung({ belegt: f.mitfahrer.length, plaetze: f.plaetze });
    const fahrer = f.fahrer?.name;
    const mitfahrer = [...f.mitfahrer].sort((x, y) =>
      nameVergleich(x.name, y.name),
    );
    const kopfZeilen = [
      fahrtZeit(f) && el("span", {}, fahrtZeit(f)),
      (f.von || f.nach) &&
        el(
          "span",
          {},
          [f.von && `ab ${f.von}`, f.nach && `nach ${f.nach}`]
            .filter(Boolean)
            .join(" "),
        ),
      f.treffpunkt && el("span", {}, `Treffpunkt ${f.treffpunkt}`),
    ].filter(Boolean);
    const ziel = f.zielBezeichnung
      ? el(
          "p",
          { class: "klein" },
          `Ziel: ${f.zielBezeichnung}${f.zielAdresse ? `, ${f.zielAdresse}` : ""}`,
          f.zielLink && istHttps(f.zielLink)
            ? [
                " ",
                el(
                  "a",
                  {
                    href: f.zielLink,
                    target: "_blank",
                    rel: "noopener noreferrer",
                  },
                  "Karte öffnen",
                ),
              ]
            : false,
        )
      : false;
    const karteEl = el(
      "section",
      { class: "flaeche mn-zimmer", "aria-labelledby": `fahrt-${f.id}` },
      el(
        "div",
        { class: "mn-flaechenkopf" },
        el("h2", { id: `fahrt-${f.id}` }, fahrtTitel(f)),
        el(
          "div",
          { class: "mn-aktionen" },
          zustandsChip(f.art === "auto" ? "Auto" : "ÖV-Gruppe"),
          bearbeiten &&
            menue(fahrtTitel(f), [
              {
                text: "Ändern",
                onclick: () => formular(ctx, k, f, f.richtung, mitglieder, neu),
              },
              { text: "Löschen", gefaehrlich: true, onclick: () => loesche(f) },
            ]),
        ),
      ),
      kopfZeilen.length > 0 && el("p", { class: "mn-fahrtinfo" }, kopfZeilen),
      f.link &&
        istHttps(f.link) &&
        el(
          "p",
          {},
          el(
            "a",
            { href: f.link, target: "_blank", rel: "noopener noreferrer" },
            "Fahrplan öffnen",
          ),
        ),
      ziel,
      el("p", { class: "mn-fuelltext" }, b.text),
      f.plaetze !== null &&
        el("progress", {
          class: `mn-fuell${b.ueberbelegt ? " ist-voll" : ""}`,
          max: String(f.plaetze),
          value: String(Math.min(f.mitfahrer.length, f.plaetze)),
          "aria-label": `Belegung ${fahrtTitel(f)}`,
        }),
      b.ueberbelegt &&
        el(
          "p",
          { class: "mn-warn" },
          zustandsChip(
            `Überbelegt: ${f.mitfahrer.length - f.plaetze} zu viel`,
            "warn",
            "warnung",
          ),
        ),
      fahrer &&
        el("p", { class: "klein" }, el("strong", {}, "Fahrer: "), fahrer),
      mitfahrer.length === 0
        ? el(
            "p",
            { class: "mn-leerzeile leise" },
            bearbeiten
              ? "Noch niemand drin. Ziehe Personen hierher."
              : "Noch niemand drin.",
          )
        : el(
            "ul",
            {
              class: "mn-liste",
              "aria-label": `Mitfahrende in ${fahrtTitel(f)}`,
            },
            mitfahrer.map((m) => zeile(alsPerson(m), f.id, m)),
          ),
    );
    if (bearbeiten)
      zielFlaeche(karteEl, {
        akzeptiert: () => true,
        beiAblegen: (last) => verschiebe(last, f.id),
      });
    return karteEl;
  }

  const tabs = filterGruppe({
    beschriftung: "Richtung",
    eintraege: RICHTUNGEN.map(([wert, text]) => ({ text, wert })),
    beiAenderung: (r) => {
      stand.richtung = r;
      wahl.leeren();
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
    stand.suche = suche.eingabe.value.trim().toLowerCase();
    zeichneBrett();
    suche.eingabe.focus();
  });

  function ohneFlaeche() {
    const roh = offen[stand.richtung]
      .filter(
        (p) => stand.suche === "" || p.name.toLowerCase().includes(stand.suche),
      )
      .sort((x, y) => nameVergleich(x.name, y.name));
    const f = el(
      "section",
      { class: "flaeche mn-offen", "aria-labelledby": "fahrten-ohne" },
      el("h2", { id: "fahrten-ohne" }, "Ohne Fahrt"),
      el(
        "p",
        { class: "klein leise" },
        `${mehrzahl(offen[stand.richtung].length, "Person", "Personen")} in dieser Richtung ohne Fahrt`,
      ),
      suche.wurzel,
      roh.length === 0
        ? el(
            "p",
            { class: "mn-leerzeile leise" },
            stand.suche
              ? `Keine Treffer für «${stand.suche}».`
              : "Alle haben eine Fahrt.",
          )
        : el(
            "ul",
            { class: "mn-liste", "aria-label": "Personen ohne Fahrt" },
            roh.map((p) => zeile(p, null, null)),
          ),
    );
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

  function zeichneBrett() {
    const fokusSuche = document.activeElement === suche.eingabe;
    const alleKeys = new Set([
      ...offen[stand.richtung].map((p) => personSchluessel(p.typ, p.id)),
      ...sichtbare().flatMap((f) =>
        f.mitfahrer.map((m) =>
          personSchluessel(
            m.teilnehmerId ? "teilnehmer" : "person",
            m.teilnehmerId ?? m.personId,
          ),
        ),
      ),
    ]);
    wahl.bereinige(alleKeys);
    const fahrten = sichtbare();
    fuelle(
      brett,
      bearbeiten ? ohneFlaeche() : false,
      fahrten.length === 0
        ? leerKarte(
            bearbeiten
              ? `Noch keine ${stand.richtung === "hin" ? "Hinfahrt" : "Rückfahrt"}. Lege eine Fahrt an.`
              : "Du sitzt in dieser Richtung in keiner Fahrt.",
          )
        : el("div", { class: "mn-karten" }, fahrten.map(karte)),
    );
    if (fokusSuche) suche.eingabe.focus();
    leiste.aktualisiere();
  }

  function loesche(f) {
    const index = liste.findIndex((x) => x.id === f.id);
    const rest = f;
    ctx.mitRueckgaengig({
      text: `«${fahrtTitel(f)}» ist gelöscht`,
      ansicht: {
        weg: () => {
          liste = liste.filter((x) => x.id !== f.id);
          zeichneBrett();
        },
        zurueck: () => {
          liste.splice(index, 0, rest);
          zeichneBrett();
        },
      },
      ausfuehren: () =>
        anfrage(
          "DELETE",
          `${LB(k.lagerId)}/fahrten/${f.id}?version=${f.version}`,
        ),
      fehlertext: meldung,
      // Die Mitfahrenden sind danach ohne Fahrt: neu laden
      danach: neu,
    });
  }

  haenge(
    bereich,
    el("div", { class: "mn-werkzeuge" }, tabs.wurzel, false),
    bearbeiten &&
      el(
        "p",
        { class: "klein leise" },
        "Ziehe Personen mit dem Griff in eine Fahrt. Ohne Maus: Menü «Mehr» der Person oder mehrere ankreuzen und unten einteilen.",
      ),
    brett,
    leiste.wurzel,
  );
  zeichneBrett();
}

// Fahrt anlegen oder ändern. Art und Richtung lassen sich später nicht mehr ändern (die Mitfahrenden führen die Richtung mit).
function formular(ctx, k, f, richtung, mitglieder, neu) {
  const art = auswahl({
    label: "Art",
    optionen: ARTEN,
    wert: f?.art ?? "auto",
  });
  if (f) art.eingabe.disabled = true;
  const richtungFeld = auswahl({
    label: "Richtung",
    optionen: RICHTUNGEN,
    wert: f?.richtung ?? richtung,
  });
  if (f) richtungFeld.eingabe.disabled = true;
  const name = feld({
    label: "Name",
    hilfe: "Freiwillig.",
    wert: f?.name ?? "",
    maxlength: 100,
    autocomplete: "off",
  });
  const fahrer = auswahl({
    label: "Fahrer",
    optionen: [
      ["", "Kein Fahrer"],
      ...mitglieder.map((m) => [m.personId, m.name]),
    ],
    wert: f?.fahrerPersonId ?? "",
  });
  const plaetze = zahlfeld({
    label: "Plätze für Mitfahrende",
    hilfe: "Ohne den Fahrer.",
    wert: f?.plaetze ?? "",
    min: 1,
    max: 99,
  });
  const datum = datumsfeld({ label: "Datum", wert: f?.datum ?? "" });
  const zeit = zeitfeld({ label: "Abfahrt", wert: f?.zeit ?? "" });
  const von = feld({
    label: "Von",
    wert: f?.von ?? "",
    maxlength: 200,
    autocomplete: "off",
  });
  const nach = feld({
    label: "Nach",
    wert: f?.nach ?? "",
    maxlength: 200,
    autocomplete: "off",
  });
  const treffpunkt = feld({
    label: "Treffpunkt",
    wert: f?.treffpunkt ?? "",
    maxlength: 200,
    autocomplete: "off",
  });
  const link = feld({
    label: "Link zum Fahrplan",
    hilfe: "Nur https. Der Server ruft ihn nie selbst ab.",
    typ: "url",
    wert: f?.link ?? "",
    maxlength: 500,
    autocomplete: "off",
    spellcheck: "false",
  });
  const zielB = feld({
    label: "Ziel, Bezeichnung",
    hilfe: "Freiwillig. Zum Beispiel «Lagerhaus».",
    wert: f?.zielBezeichnung ?? "",
    maxlength: 100,
    autocomplete: "off",
  });
  const zielA = feld({
    label: "Ziel, Adresse",
    hilfe: "Eine Adresse oder ein Link zur Karte gehört zur Bezeichnung.",
    wert: f?.zielAdresse ?? "",
    maxlength: 200,
    autocomplete: "off",
  });
  const zielL = feld({
    label: "Ziel, Link zur Karte",
    typ: "url",
    wert: f?.zielLink ?? "",
    maxlength: 500,
    autocomplete: "off",
    spellcheck: "false",
  });
  const nurAuto = [fahrer.wurzel, plaetze.wurzel];
  const nurOev = [link.wurzel];
  const zeigeArt = () => {
    const auto = art.eingabe.value === "auto";
    for (const w of nurAuto) w.hidden = !auto;
    for (const w of nurOev) w.hidden = auto;
  };
  art.eingabe.addEventListener("change", zeigeArt);
  zeigeArt();

  const text = (feldEl) => feldEl.eingabe.value.trim() || null;
  const werte = () => {
    const auto = art.eingabe.value === "auto";
    return {
      name: text(name),
      fahrerPersonId: auto ? fahrer.eingabe.value || null : null,
      plaetze:
        auto && plaetze.eingabe.value !== ""
          ? Number(plaetze.eingabe.value)
          : null,
      datum: datum.eingabe.value || null,
      zeit: zeit.eingabe.value || null,
      von: text(von),
      nach: text(nach),
      treffpunkt: text(treffpunkt),
      link: auto ? null : text(link),
      zielBezeichnung: text(zielB),
      zielAdresse: text(zielA),
      zielLink: text(zielL),
    };
  };
  let seite;
  const sende = async (version) => {
    const w = werte();
    if (!f)
      return anfrage("POST", `${LB(k.lagerId)}/fahrten`, {
        richtung: richtungFeld.eingabe.value,
        art: art.eingabe.value,
        ...w,
      });
    const geaendert = Object.fromEntries(
      Object.entries(w).filter(([key, wert]) => (f[key] ?? null) !== wert),
    );
    if (Object.keys(geaendert).length === 0) return f;
    return anfrage("PATCH", `${LB(k.lagerId)}/fahrten/${f.id}`, {
      version: version ?? f.version,
      ...geaendert,
    });
  };
  seite = dialogFormular({
    titel: f ? "Fahrt ändern" : "Fahrt anlegen",
    beschreibung: f
      ? fahrtTitel(f)
      : "Ein Auto mit Plätzen oder eine Gruppe, die mit dem ÖV fährt.",
    felder: [
      art.wurzel,
      richtungFeld.wurzel,
      name.wurzel,
      fahrer.wurzel,
      plaetze.wurzel,
      datum.wurzel,
      zeit.wurzel,
      von.wurzel,
      nach.wurzel,
      treffpunkt.wurzel,
      link.wurzel,
      zielB.wurzel,
      zielA.wurzel,
      zielL.wurzel,
    ],
    ok: f ? "Speichern" : "Anlegen",
    fehlertext: meldung,
    pruefe: () => {
      plaetze.wurzel.querySelector(".feld-fehler")?.remove();
      if (
        art.eingabe.value !== "auto" ||
        (plaetze.eingabe.value !== "" && Number(plaetze.eingabe.value) >= 1)
      )
        return false;
      plaetze.wurzel.append(
        el(
          "p",
          { class: "feld-fehler", role: "alert" },
          "Gib die Plätze für Mitfahrende ein, von 1 bis 99.",
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
      ctx.melde(f ? "Gespeichert." : "Die Fahrt ist angelegt.");
      neu();
    },
  });
}

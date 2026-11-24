import { anfrage } from "./api.js";
import {
  ankreuzen,
  avatar,
  dialogFormular,
  el,
  feld,
  icon,
  knopf,
  menue,
  auswahl,
  seitenblatt,
  tabelle,
} from "./dom.js";
import { zahlfeld } from "./datumsfeld.js";
import {
  beschaeftigt,
  skeletonPlan,
  skeletonVorschlag,
  skeletonWahlliste,
} from "./lager-einteilung-laden.js";
import { blendeEin, blitze, skeletonSpaeter } from "./lager-anim.js";
import { leerKarte } from "./zustaende.js";
import { ADRESSE, haenge } from "./lager-gemeinsam.js";
import {
  besetzung,
  besetzungText,
  gruppiereDienste,
  mehrzahl,
  nameVergleich,
  schichtZellen,
  tagText,
  teilnehmerName,
} from "./lager-menschen-logik.js";
import {
  kopfAktion,
  keinLeserecht,
  kopfeMitHinweis,
  LB,
  ladeAlle,
  ladeKontext,
  meldung,
  sendeMitKonflikt,
  zustandsChip,
  fuelle,
} from "./lager-menschen.js";
import { zielFlaeche, ziehGriff } from "./lager-ziehen.js";

// Schichtplan (#675; Server #388): Dienste in Zeilen, Lagertage in Spalten. Personen ziehen (Griff), mit «Besetzen» ankreuzen oder den Vorschlag des Servers übernehmen. Jede Zelle zeigt «1 von 2» und das Wort dazu, nie nur Farbe. Der Server lehnt Abgewählte, als abwesend Eingetragene und Doppelbelegungen im selben Abschnitt ab; seine Meldung steht dann in der Rückmeldung. Adresse: #lager/lager/<id>/schichtplan

export function zeige(bereich, ctx, lagerId, lager) {
  ctx.lade(
    async () => {
      const k = await ladeKontext(lagerId, lager);
      if (!k.darf("einteilung.lesen")) return { k };
      const [plan, zeitplan, mitglieder] = await Promise.all([
        anfrage("GET", `${LB(lagerId)}/schichtplan`),
        k.darf("zeitplan.lesen")
          ? anfrage("GET", `${LB(lagerId)}/zeitplan`)
          : null,
        anfrage("GET", `${LB(lagerId)}/mitglieder`)
          .then((m) => m.mitglieder)
          .catch(() => []),
      ]);
      return { k, plan, zeitplan, mitglieder };
    },
    (d, neu) => {
      kopfeMitHinweis(bereich, ctx, d.k, "Schichtplan");
      if (!d.plan) return keinLeserecht(bereich, "den Schichtplan");
      zeichne(bereich, ctx, d, neu);
    },
    { skeleton: skeletonPlan },
  );
}

const DIENST_FELDER = [
  ["name", "Name"],
  ["mindestbesetzung", "Mindestbesetzung"],
  ["nacht", "Nachtwache", (w) => (w ? "Ja" : "Nein")],
  ["beschreibung", "Beschreibung"],
];

const alsPerson = (s) => ({
  typ: s.teilnehmerId ? "teilnehmer" : "person",
  id: s.teilnehmerId ?? s.personId,
  name: s.name,
  bildUrl: s.bildUrl ?? null,
});

function zeichne(
  bereich,
  ctx,
  { k, plan: ersterPlan, zeitplan, mitglieder },
  neuLaden,
) {
  const bearbeiten = k.kann("einteilung.bearbeiten");
  const tage = zeitplan?.lagertage ?? [];
  const abschnitte = zeitplan?.tagesabschnitte ?? [];
  let plan = ersterPlan;
  const ort = el("div", { class: "mn-schichtort" });

  kopfAktion(
    ctx,
    bearbeiten && abschnitte.length > 0
      ? knopf("Dienst anlegen", {
          art: "haupt",
          symbol: "plus",
          onclick: () => dienstFormular(ctx, k, null, abschnitte, neuLaden),
        })
      : false,
  );

  // Nach einer Änderung nur den Plan holen, nicht die ganze Seite (Scrollposition bleibt)
  // Der Plan bleibt dabei stehen (ruhiger, ohne Sprung) und die Einträge gleiten an ihren neuen Platz
  async function ladePlan() {
    plan = await beschaeftigt(
      ort,
      anfrage("GET", `${LB(k.lagerId)}/schichtplan`),
    );
    zeichnePlan();
    if (letzteZelle) {
      blitze(ort.querySelector(`[data-zelle="${letzteZelle}"]`));
      letzteZelle = null;
    }
  }
  let letzteZelle = null;

  // Besetzung eines Dienstes an einem Tag setzen (der Server setzt genau diese Leute)
  async function setze(dienstId, tagId, personen) {
    await anfrage("PUT", `${LB(k.lagerId)}/schichtplan/schichten`, {
      dienstId,
      lagertagId: tagId,
      ...besetzung(personen, {}),
    });
  }
  const zelleLeute = (dienstId, tagId) =>
    (schichtZellen(plan.schichten).get(`${dienstId}|${tagId}`) ?? []).map(
      alsPerson,
    );

  async function legeAb(personen, dienstId, tagId) {
    const aktuell = zelleLeute(dienstId, tagId);
    const schluessel = (p) => `${p.typ}:${p.id}`;
    const da = new Set(aktuell.map(schluessel));
    const neue = personen.filter((p) => !da.has(schluessel(p)));
    if (neue.length === 0) return;
    letzteZelle = `${dienstId}|${tagId}`;
    // Aus einer anderen Zelle zuerst entfernen: Der Server verbietet zwei Dienste im selben Abschnitt des Tages
    const quellen = neue.filter(
      (p) =>
        p.quelle &&
        !(p.quelle.dienstId === dienstId && p.quelle.tagId === tagId),
    );
    const jeQuelle = new Map();
    for (const p of quellen) {
      const key = `${p.quelle.dienstId}|${p.quelle.tagId}`;
      jeQuelle.set(key, [...(jeQuelle.get(key) ?? []), p]);
    }
    const entfernt = [];
    try {
      for (const [key, liste] of jeQuelle) {
        const [dId, tId] = key.split("|");
        const rest = besetzung(zelleLeute(dId, tId), { weg: liste });
        await setzeRoh(dId, tId, rest);
        entfernt.push([dId, tId]);
      }
      await setze(dienstId, tagId, [...aktuell, ...neue]);
    } catch (f) {
      // Zurück an den alten Platz
      for (const [dId, tId] of entfernt)
        await setzeRoh(dId, tId, besetzung(zelleLeute(dId, tId), {})).catch(
          () => {},
        );
      ctx.melde(meldung(f), "warn");
      await ladePlan().catch(() => neuLaden());
      return;
    }
    await ladePlan().catch(() => neuLaden());
    ctx.melde(
      neue.length === 1
        ? `${neue[0].name} ist eingeteilt.`
        : `${mehrzahl(neue.length, "Person", "Personen")} sind eingeteilt.`,
    );
  }
  const setzeRoh = (dienstId, tagId, { teilnehmerIds, personIds }) =>
    anfrage("PUT", `${LB(k.lagerId)}/schichtplan/schichten`, {
      dienstId,
      lagertagId: tagId,
      personIds,
      teilnehmerIds,
    });

  async function entferne(p, dienstId, tagId) {
    const rest = besetzung(zelleLeute(dienstId, tagId), { weg: [p] });
    try {
      await setzeRoh(dienstId, tagId, rest);
      await ladePlan();
      ctx.melde(`${p.name} ist nicht mehr eingeteilt.`);
    } catch (f) {
      ctx.melde(meldung(f), "fehler");
      await ladePlan().catch(() => neuLaden());
    }
  }

  // --- Anzeige ---
  function zelle(dienst, tag) {
    const leute = zelleLeute(dienst.id, tag.id);
    const text = besetzungText(leute.length, dienst.mindestbesetzung);
    const voll = leute.length >= dienst.mindestbesetzung;
    const td = el(
      "td",
      {
        class: `mn-zelle${voll ? "" : leute.length === 0 ? " ist-leer" : " ist-luecke"}`,
        "data-zelle": `${dienst.id}|${tag.id}`,
      },
      el(
        "ul",
        {
          class: "mn-chips",
          "aria-label": `${dienst.name}, ${tagText(tag.datum)}`,
        },
        leute.map((p) =>
          el(
            "li",
            {
              class: "mn-chip",
              // Eine Person hat je Tag und Abschnitt höchstens einen Dienst: So gleitet sie von Zelle zu Zelle
              "data-schluessel": `s:${p.typ}:${p.id}:${tag.id}:${dienst.tagesabschnittId}`,
            },
            bearbeiten
              ? ziehGriff({
                  name: p.name,
                  nutzlast: () => [
                    { ...p, quelle: { dienstId: dienst.id, tagId: tag.id } },
                  ],
                  text: (l) => l[0].name,
                })
              : false,
            avatar(p.name, { hell: true, bildUrl: p.bildUrl }),
            el("span", { class: "mn-chip-name" }, p.name),
            bearbeiten
              ? el(
                  "button",
                  {
                    type: "button",
                    class: "mn-chip-weg",
                    "aria-label": `${p.name} aus ${dienst.name} am ${tagText(tag.datum)} nehmen`,
                    onclick: () => entferne(p, dienst.id, tag.id),
                  },
                  icon("schliessen"),
                )
              : false,
          ),
        ),
      ),
      el(
        "p",
        { class: "mn-zelltext" },
        icon(voll ? "haken" : "warnung"),
        el(
          "span",
          {},
          `${leute.length} von ${dienst.mindestbesetzung}, ${text}`,
        ),
      ),
      bearbeiten &&
        knopf("Besetzen", {
          klein: true,
          art: "still",
          symbol: "personen",
          kontext: `${dienst.name}, ${tagText(tag.datum)}`,
          onclick: () =>
            besetzenSeite(ctx, k, dienst, tag, leute, mitglieder, async () =>
              ladePlan(),
            ),
        }),
    );
    if (bearbeiten)
      zielFlaeche(td, {
        akzeptiert: () => true,
        beiAblegen: (last) => legeAb(last, dienst.id, tag.id),
      });
    return td;
  }

  function zeichnePlan() {
    const gruppen = gruppiereDienste(plan.dienste, abschnitte);
    if (plan.dienste.length === 0) {
      ort.replaceChildren(
        leerKarte(
          bearbeiten
            ? "Noch keine Dienste. Lege Dienste an und teile Personen ein."
            : "Die Lagerleitung hat noch keine Dienste angelegt.",
          bearbeiten && abschnitte.length > 0
            ? [
                knopf("Dienst anlegen", {
                  art: "haupt",
                  symbol: "plus",
                  onclick: () =>
                    dienstFormular(ctx, k, null, abschnitte, neuLaden),
                }),
              ]
            : [],
        ),
      );
      return;
    }
    const zeilen = [];
    for (const g of gruppen) {
      zeilen.push(
        el(
          "tr",
          { class: "mn-abschnitt" },
          el(
            "th",
            { scope: "colgroup", colspan: String(tage.length + 1) },
            `${g.abschnitt.name}${g.abschnitt.zeit ? ` (${g.abschnitt.zeit})` : ""}`,
          ),
        ),
      );
      for (const d of g.dienste)
        zeilen.push(
          el(
            "tr",
            {},
            el(
              "th",
              { scope: "row", class: "mn-dienstkopf" },
              el("span", { class: "name" }, d.name),
              d.nacht && zustandsChip("Nachtwache", undefined, "mond"),
              el(
                "span",
                { class: "klein leise" },
                `Mindestens ${d.mindestbesetzung}`,
              ),
              bearbeiten &&
                menue(d.name, [
                  {
                    text: "Ändern",
                    onclick: () =>
                      dienstFormular(ctx, k, d, abschnitte, neuLaden),
                  },
                  {
                    text: "Löschen",
                    gefaehrlich: true,
                    onclick: () => loescheDienst(d),
                  },
                ]),
            ),
            tage.map((t) => zelle(d, t)),
          ),
        );
    }
    const { wurzel } = tabelle({
      beschriftung: "Schichtplan",
      spalten: ["Dienst", ...tage.map((t) => tagText(t.datum))],
      zeilen,
    });
    wurzel.classList.add("mn-plan");
    const stat = statistik();
    const erster = !ort.firstChild;
    fuelle(ort, wurzel, stat);
    if (erster) blendeEin(ort);
  }

  function statistik() {
    const nacht = new Set(plan.dienste.filter((d) => d.nacht).map((d) => d.id));
    const je = new Map();
    for (const s of plan.schichten) {
      const key = s.personId ?? s.teilnehmerId;
      const z = je.get(key) ?? {
        name: s.name,
        bildUrl: s.bildUrl,
        anzahl: 0,
        nachtwachen: 0,
      };
      z.anzahl++;
      if (nacht.has(s.dienstId)) z.nachtwachen++;
      je.set(key, z);
    }
    const liste = [...je.values()].sort((a, b) =>
      nameVergleich(a.name, b.name),
    );
    const luecken = plan.dienste.flatMap((d) =>
      tage.filter((t) => zelleLeute(d.id, t.id).length < d.mindestbesetzung),
    );
    return el(
      "section",
      { class: "flaeche", "aria-labelledby": "plan-verteilung" },
      el("h2", { id: "plan-verteilung" }, "Verteilung"),
      el(
        "p",
        { class: "klein leise" },
        luecken.length === 0
          ? "Alle Dienste sind voll besetzt."
          : `${luecken.length} ${luecken.length === 1 ? "Feld ist" : "Felder sind"} nicht voll besetzt.`,
      ),
      liste.length === 0
        ? el("p", { class: "mn-leerzeile leise" }, "Noch niemand eingeteilt.")
        : tabelle({
            beschriftung: "Dienste je Person",
            spalten: ["Person", ["Dienste", "zahl"], ["Nachtwachen", "zahl"]],
            zeilen: liste.map((z) =>
              el(
                "tr",
                {},
                el(
                  "th",
                  { scope: "row" },
                  el(
                    "div",
                    { class: "wer" },
                    avatar(z.name, { hell: true, bildUrl: z.bildUrl }),
                    z.name,
                  ),
                ),
                el("td", { class: "lg-zahlen rechts" }, String(z.anzahl)),
                el("td", { class: "lg-zahlen rechts" }, String(z.nachtwachen)),
              ),
            ),
          }).wurzel,
    );
  }

  function loescheDienst(d) {
    const vorher = plan;
    ctx.mitRueckgaengig({
      text: `«${d.name}» ist gelöscht`,
      ansicht: {
        weg: () => {
          plan = {
            ...plan,
            dienste: plan.dienste.filter((x) => x.id !== d.id),
            schichten: plan.schichten.filter((s) => s.dienstId !== d.id),
          };
          zeichnePlan();
        },
        zurueck: () => {
          plan = vorher;
          zeichnePlan();
        },
      },
      ausfuehren: () =>
        anfrage(
          "DELETE",
          `${LB(k.lagerId)}/schichtplan/dienste/${d.id}?version=${d.version}`,
        ),
      fehlertext: meldung,
      danach: neuLaden,
    });
  }

  if (tage.length === 0 || abschnitte.length === 0) {
    haenge(
      bereich,
      leerKarte(
        tage.length === 0
          ? "Noch keine Lagertage. Ohne Tage gibt es keinen Schichtplan."
          : "Der Zeitplan hat noch keine Abschnitte des Tages. Ohne Abschnitt gibt es keine Dienste.",
        [
          el(
            "a",
            { class: "knopf", href: `${ADRESSE}/${k.lagerId}/zeitplan` },
            "Zum Zeitplan",
          ),
        ],
      ),
    );
    return;
  }
  haenge(
    bereich,
    el(
      "div",
      { class: "mn-werkzeuge" },
      bearbeiten &&
        knopf("Leere Dienste füllen", {
          symbol: "sortieren",
          onclick: () => vorschlagSeite(ctx, k, plan, tage, neuLaden),
        }),
      false,
    ),
    bearbeiten &&
      el(
        "p",
        { class: "klein leise" },
        "Ziehe Personen aus einer Zelle in eine andere, oder wähle mit «Besetzen», wer den Dienst macht. «Leere Dienste füllen» schlägt Personen nach Anwesenheit vor.",
      ),
    bearbeiten && poolFlaeche(mitglieder, plan),
    ort,
  );
  zeichnePlan();
}

// Die Personen zum Ziehen in die Zellen; die Zahl der Dienste daneben hilft beim gerechten Verteilen
function poolFlaeche(mitglieder, plan) {
  const anzahl = new Map();
  for (const s of plan.schichten)
    if (s.personId) anzahl.set(s.personId, (anzahl.get(s.personId) ?? 0) + 1);
  const suche = feld({
    label: "Person suchen",
    typ: "search",
    autocomplete: "off",
    spellcheck: "false",
  });
  suche.wurzel.querySelector("label").classList.add("nur-leser");
  suche.eingabe.setAttribute("placeholder", "Person suchen");
  const liste = el("ul", { class: "mn-pool" });
  const zeichneListe = () => {
    const q = suche.eingabe.value.trim().toLowerCase();
    liste.replaceChildren(
      ...mitglieder
        .filter((m) => q === "" || m.name.toLowerCase().includes(q))
        .map((m) =>
          el(
            "li",
            { class: "mn-chip" },
            ziehGriff({
              name: m.name,
              nutzlast: () => [
                {
                  typ: "person",
                  id: m.personId,
                  name: m.name,
                  bildUrl: m.bildUrl,
                },
              ],
              text: (l) => l[0].name,
            }),
            avatar(m.name, { hell: true, bildUrl: m.bildUrl }),
            el("span", { class: "mn-chip-name" }, m.name),
            el(
              "span",
              { class: "klein leise" },
              mehrzahl(anzahl.get(m.personId) ?? 0, "Dienst", "Dienste"),
            ),
          ),
        ),
    );
  };
  suche.eingabe.addEventListener("input", zeichneListe);
  zeichneListe();
  return el(
    "details",
    { class: "flaeche mn-poolflaeche", open: true },
    el("summary", {}, "Personen zum Einteilen"),
    suche.wurzel,
    liste,
  );
}

// Wer macht den Dienst an diesem Tag? Ankreuzen, Speichern. Der Server setzt genau diese Leute.
function besetzenSeite(ctx, k, dienst, tag, aktuell, mitglieder, danach) {
  const gewaehlt = new Map(aktuell.map((p) => [`${p.typ}:${p.id}`, p]));
  const mitKinder = { an: false, liste: [] };
  const suche = feld({
    label: "Person suchen",
    typ: "search",
    autocomplete: "off",
    spellcheck: "false",
  });
  const liste = el("ul", { class: "mn-wahlliste" });
  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
    tabindex: "-1",
  });
  const kinderWahl = ankreuzen({ label: "Auch Teilnehmende einteilen" });
  const zeichneListe = () => {
    const q = suche.eingabe.value.trim().toLowerCase();
    const alle = [
      ...mitglieder.map((m) => ({
        typ: "person",
        id: m.personId,
        name: m.name,
      })),
      ...(mitKinder.an ? mitKinder.liste : []),
    ].filter((p) => q === "" || p.name.toLowerCase().includes(q));
    liste.replaceChildren(
      ...alle.map((p) => {
        const key = `${p.typ}:${p.id}`;
        const kasten = ankreuzen({
          label: p.typ === "teilnehmer" ? `${p.name} (Teilnehmende)` : p.name,
          gewaehlt: gewaehlt.has(key),
        });
        kasten.eingabe.addEventListener("change", () => {
          if (kasten.eingabe.checked) gewaehlt.set(key, p);
          else gewaehlt.delete(key);
          zaehler.textContent = `${gewaehlt.size} von ${dienst.mindestbesetzung} gewählt`;
        });
        return el("li", {}, kasten.wurzel);
      }),
    );
  };
  suche.eingabe.addEventListener("input", zeichneListe);
  kinderWahl.eingabe.addEventListener("change", async () => {
    mitKinder.an = kinderWahl.eingabe.checked;
    if (mitKinder.an && mitKinder.liste.length === 0) {
      const stopp = skeletonSpaeter(liste, skeletonWahlliste, 150);
      try {
        const t = await ladeAlle(`${LB(k.lagerId)}/teilnehmer`, "teilnehmer");
        stopp();
        mitKinder.liste = t
          .filter((x) => !x.abgewaehlt)
          .map((x) => ({
            typ: "teilnehmer",
            id: x.id,
            name: teilnehmerName(x),
          }));
      } catch (f) {
        stopp();
        mitKinder.an = false;
        kinderWahl.eingabe.checked = false;
        ctx.melde(meldung(f), "fehler");
      }
    }
    zeichneListe();
  });
  const zaehler = el(
    "p",
    { class: "klein leise", role: "status" },
    `${gewaehlt.size} von ${dienst.mindestbesetzung} gewählt`,
  );
  const speichern = knopf("Speichern", { art: "haupt" });
  speichern.addEventListener("click", async () => {
    speichern.disabled = true;
    speichern.setAttribute("aria-busy", "true");
    try {
      await anfrage("PUT", `${LB(k.lagerId)}/schichtplan/schichten`, {
        dienstId: dienst.id,
        lagertagId: tag.id,
        ...besetzung([...gewaehlt.values()], {}),
      });
      blatt.close();
      ctx.melde(`${dienst.name} am ${tagText(tag.datum)} ist besetzt.`);
      await danach();
    } catch (f) {
      fehler.textContent = meldung(f);
      fehler.hidden = false;
      fehler.focus();
    } finally {
      speichern.disabled = false;
      speichern.removeAttribute("aria-busy");
    }
  });
  const blatt = seitenblatt({
    titel: `${dienst.name}, ${tagText(tag.datum)}`,
    untertitel: `Mindestbesetzung ${dienst.mindestbesetzung}. Wähle, wer den Dienst macht.`,
    inhalt: [suche.wurzel, kinderWahl.wurzel, zaehler, fehler, liste],
    fusszeile: [
      knopf("Abbrechen", { onclick: () => blatt.versuchSchliessen() }),
      speichern,
    ],
  });
  zeichneListe();
}

// Dienst anlegen oder ändern; der Abschnitt lässt sich nicht mehr ändern (die Schichten führen ihn mit)
function dienstFormular(ctx, k, d, abschnitte, neu) {
  const name = feld({
    label: "Name",
    wert: d?.name ?? "",
    maxlength: 100,
    autocomplete: "off",
    required: true,
  });
  const abschnitt = auswahl({
    label: "Abschnitt des Tages",
    optionen: abschnitte.map((a) => [
      a.id,
      a.zeit ? `${a.name} (${a.zeit})` : a.name,
    ]),
    wert: d?.tagesabschnittId ?? abschnitte[0]?.id,
  });
  if (d) abschnitt.eingabe.disabled = true;
  const mind = zahlfeld({
    label: "Mindestbesetzung",
    hilfe: "Personen je Tag, von 1 bis 20.",
    wert: d?.mindestbesetzung ?? 1,
    min: 1,
    max: 20,
    required: true,
  });
  const nacht = ankreuzen({ label: "Nachtwache", gewaehlt: d?.nacht ?? false });
  const text = feld({
    label: "Beschreibung",
    hilfe: "Freiwillig.",
    wert: d?.beschreibung ?? "",
    mehrzeilig: true,
    maxlength: 500,
  });
  const werte = () => ({
    name: name.eingabe.value.trim(),
    mindestbesetzung: Number(mind.eingabe.value),
    nacht: nacht.eingabe.checked,
    beschreibung: text.eingabe.value.trim() || null,
  });
  let seite;
  const sende = async (version) => {
    const w = werte();
    if (!d)
      return anfrage("POST", `${LB(k.lagerId)}/schichtplan/dienste`, {
        ...w,
        beschreibung: w.beschreibung ?? undefined,
        tagesabschnittId: abschnitt.eingabe.value,
      });
    const geaendert = Object.fromEntries(
      Object.entries(w).filter(([key, wert]) => (d[key] ?? null) !== wert),
    );
    if (Object.keys(geaendert).length === 0) return d;
    return anfrage("PATCH", `${LB(k.lagerId)}/schichtplan/dienste/${d.id}`, {
      version: version ?? d.version,
      ...geaendert,
    });
  };
  seite = dialogFormular({
    titel: d ? "Dienst ändern" : "Dienst anlegen",
    beschreibung: d
      ? d.name
      : "Ein Dienst gilt an jedem Lagertag in seinem Abschnitt.",
    felder: [
      name.wurzel,
      abschnitt.wurzel,
      mind.wurzel,
      nacht.wurzel,
      text.wurzel,
    ],
    ok: d ? "Speichern" : "Anlegen",
    fehlertext: meldung,
    pruefe: () => {
      mind.wurzel.querySelector(".feld-fehler")?.remove();
      const n = Number(mind.eingabe.value);
      if (Number.isInteger(n) && n >= 1 && n <= 20) return false;
      mind.wurzel.append(
        el(
          "p",
          { class: "feld-fehler", role: "alert" },
          "Gib eine Zahl von 1 bis 20 ein.",
        ),
      );
      mind.eingabe.focus();
      return true;
    },
    senden: sendeMitKonflikt({
      getSeite: () => seite,
      sende,
      felder: DIENST_FELDER,
      meine: werte,
      beiServer: neu,
    }),
    danach: () => {
      ctx.melde(d ? "Gespeichert." : `«${werte().name}» ist angelegt.`);
      neu();
    },
  });
}

// Vorschlag für die leeren Plätze: Vorschau, anderer Vorschlag, übernehmen. Die Verteilung folgt der Anwesenheit und vermeidet Doppeldienste und zwei Nachtwachen hintereinander.
function vorschlagSeite(ctx, k, plan, tage, neu) {
  const nurAnwesende = ankreuzen({
    label: "Nur wer als anwesend eingetragen ist",
    gewaehlt: true,
  });
  const kinder = ankreuzen({ label: "Auch Teilnehmende einteilen" });
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
  const dienstName = new Map(plan.dienste.map((d) => [d.id, d.name]));
  const tagDatum = new Map(tage.map((t) => [t.id, t.datum]));
  const optionen = () => ({
    nurAnwesende: nurAnwesende.eingabe.checked,
    mitTeilnehmenden: kinder.eingabe.checked,
  });
  const schicke = (uebernehmenJetzt, neuerSeed) =>
    anfrage("POST", `${LB(k.lagerId)}/schichtplan/vorschlag`, {
      uebernehmen: uebernehmenJetzt,
      ...optionen(),
      ...(seed !== null && !neuerSeed ? { seed } : {}),
    });
  async function zeige(neuerSeed) {
    for (const b of [vorschau, anders]) b.disabled = true;
    fehler.hidden = true;
    const stopp = skeletonSpaeter(ausgabe, skeletonVorschlag);
    try {
      const e = await schicke(false, neuerSeed);
      stopp();
      seed = e.seed;
      const je = new Map();
      for (const s of e.schichten) {
        const key = `${s.lagertagId}|${s.dienstId}`;
        je.set(key, [...(je.get(key) ?? []), s]);
      }
      const unbesetzt = e.unbesetzt.reduce((n, u) => n + u.fehlend, 0);
      fuelle(
        ausgabe,
        el("h3", {}, "Vorschlag für die leeren Dienste"),
        el(
          "p",
          { class: "fett" },
          mehrzahl(e.schichten.length, "neue Schicht", "neue Schichten"),
        ),
        unbesetzt > 0 &&
          el(
            "p",
            { class: "hinweis hinweis--warn" },
            el(
              "span",
              {},
              `${unbesetzt === 1 ? "Ein Platz bleibt" : `${unbesetzt} Plätze bleiben`} unbesetzt, weil sich niemand findet.`,
            ),
          ),
        e.gekuerzt &&
          el(
            "p",
            { class: "hinweis hinweis--info" },
            el(
              "span",
              {},
              "Der Vorschlag ist gekürzt. Nach dem Übernehmen kannst du einen zweiten Lauf machen.",
            ),
          ),
        e.schichten.length > 0 &&
          tabelle({
            beschriftung: "Neue Schichten",
            spalten: ["Tag", "Dienst", "Wer"],
            zeilen: [...je.values()].map((liste) =>
              el(
                "tr",
                {},
                el(
                  "td",
                  {},
                  tagText(tagDatum.get(liste[0].lagertagId) ?? liste[0].datum),
                ),
                el("td", {}, dienstName.get(liste[0].dienstId) ?? "Dienst"),
                el("td", {}, liste.map((s) => s.name).join(", ")),
              ),
            ),
          }).wurzel,
        e.statistik.length > 0 &&
          tabelle({
            beschriftung: "Verteilung nach dem Vorschlag",
            spalten: [
              "Person",
              ["Neu", "zahl"],
              ["Insgesamt", "zahl"],
              ["Nachtwachen", "zahl"],
            ],
            zeilen: e.statistik.map((s) =>
              el(
                "tr",
                {},
                el("th", { scope: "row" }, s.name),
                el("td", { class: "lg-zahlen rechts" }, String(s.neu)),
                el("td", { class: "lg-zahlen rechts" }, String(s.gesamt)),
                el("td", { class: "lg-zahlen rechts" }, String(s.nachtwachen)),
              ),
            ),
          }).wurzel,
      );
      anders.hidden = false;
      vorschau.classList.remove("knopf--haupt");
      uebernehmen.hidden = e.schichten.length === 0;
      blendeEin(ausgabe);
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
  vorschau.addEventListener("click", () => zeige(true));
  anders.addEventListener("click", () => zeige(true));
  for (const w of [nurAnwesende, kinder])
    w.eingabe.addEventListener("change", () => {
      anders.hidden = uebernehmen.hidden = true;
      ausgabe.replaceChildren();
      seed = null;
    });
  uebernehmen.addEventListener("click", async () => {
    uebernehmen.disabled = true;
    uebernehmen.setAttribute("aria-busy", "true");
    try {
      const e = await schicke(true, false);
      blatt.close();
      ctx.melde(
        `Vorschlag übernommen. ${mehrzahl(e.geaendert ?? e.schichten.length, "Schicht", "Schichten")} eingetragen.`,
      );
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
    titel: "Leere Dienste füllen",
    untertitel:
      "Schlägt Personen nach Anwesenheit vor, ohne Doppeldienste und ohne zwei Nachtwachen hintereinander. Zuerst siehst du eine Vorschau.",
    inhalt: [nurAnwesende.wurzel, kinder.wurzel, fehler, ausgabe],
    fusszeile: [
      knopf("Abbrechen", { onclick: () => blatt.versuchSchliessen() }),
      vorschau,
      anders,
      uebernehmen,
    ],
  });
}

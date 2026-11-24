import { anfrage } from "./api.js";
import { datumZeitFeld } from "./datumsfeld.js";
import {
  avatar,
  dialogFormular,
  el,
  feld,
  filterGruppe,
  icon,
  knopf,
  tabelle,
} from "./dom.js";
import {
  blendeEin,
  ersetzeMitBewegung,
  puls,
  skeletonMatrix,
  zaehlZahl,
} from "./lager-anim.js";
import { leerKarte } from "./zustaende.js";
import { ADRESSE, haenge } from "./lager-gemeinsam.js";
import {
  ANWESENHEIT,
  mehrzahl,
  nameVergleich,
  naechsterWert,
  tagText,
  teilnehmerName,
} from "./lager-menschen-logik.js";
import {
  keinLeserecht,
  kopfeMitHinweis,
  LB,
  ladeAlle,
  ladeKontext,
  meldung,
  zustandsChip,
  fuelle,
} from "./lager-menschen.js";

// Anwesenheit (#675; Server #390): Wer ist an welchem Tag in welchem Abschnitt da (Da), frei (Frei) oder offen (Offen). Die Lagerleitung sieht die Matrix, schreibt für alle, entscheidet Anfragen und setzt die Frist; das Team trägt nur die eigene Zeile ein und stellt nach der Frist oder bei schon Eingetragenem eine Anfrage. Änderungen sammeln sich unten und gehen mit «Speichern» hinaus; bei einem Konflikt stehen beide Stände nebeneinander. Adresse: #lager/lager/<id>/anwesenheit

export function zeige(bereich, ctx, lagerId, lager) {
  ctx.lade(
    async () => {
      const k = await ladeKontext(lagerId, lager);
      const alle = k.darf("anwesenheit.lesen_alle");
      const eigene = !alle && k.darf("anwesenheit.eigene");
      if ((!alle && !eigene) || !k.darf("zeitplan.lesen"))
        return { k, ohne: true };
      const zeitplan = await anfrage("GET", `${LB(lagerId)}/zeitplan`);
      if (alle) {
        const [matrix, mitglieder, kinder, anfragen] = await Promise.all([
          ladeMatrix(lagerId),
          k.darf("einteilung.lesen")
            ? anfrage("GET", `${LB(lagerId)}/mitglieder`)
                .then((m) => m.mitglieder)
                .catch(() => [])
            : [],
          k.darf("teilnehmer.lesen")
            ? ladeAlle(`${LB(lagerId)}/teilnehmer`, "teilnehmer").catch(
                () => [],
              )
            : [],
          k.darf("anwesenheit.bearbeiten")
            ? ladeAlle(
                `${LB(lagerId)}/anwesenheit/anfragen?status=offen`,
                "anfragen",
              ).catch(() => [])
            : [],
        ]);
        return {
          k,
          zeitplan,
          matrix,
          mitglieder,
          kinder,
          anfragen,
          modus: "alle",
        };
      }
      const eig = await anfrage("GET", `${LB(lagerId)}/anwesenheit/eigene`);
      return { k, zeitplan, eig, modus: "eigene" };
    },
    (d) => {
      kopfeMitHinweis(bereich, ctx, d.k, "Anwesenheit");
      if (d.ohne) return keinLeserecht(bereich, "die Anwesenheit");
      if (
        d.zeitplan.lagertage.length === 0 ||
        d.zeitplan.tagesabschnitte.length === 0
      )
        return haenge(
          bereich,
          leerKarte(
            d.zeitplan.lagertage.length === 0
              ? "Noch keine Lagertage. Die Lagerleitung legt Lagertage und Abschnitte im Zeitplan an."
              : "Der Zeitplan hat noch keine Abschnitte des Tages.",
            [
              el(
                "a",
                { class: "knopf", href: `${ADRESSE}/${d.k.lagerId}/zeitplan` },
                "Zum Zeitplan",
              ),
            ],
          ),
        );
      zeichne(bereich, ctx, d);
    },
    {
      skeleton: () => skeletonMatrix({ spalten: 4, zeilen: 8 }),
    },
  );
}

// Alle Seiten der Matrix; Namen, Profilbilder (bilder: ID -> Pfad, nur Konten mit Bild) und Frist stehen in jeder Antwort
async function ladeMatrix(lagerId) {
  const eintraege = [];
  let namen = {};
  let bilder = {};
  let frist = null;
  let nach = null;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ limit: "5000" });
    if (nach) q.set("nach", nach);
    const a = await anfrage("GET", `${LB(lagerId)}/anwesenheit?${q}`);
    eintraege.push(...a.eintraege);
    namen = { ...namen, ...a.namen };
    bilder = { ...bilder, ...a.bilder };
    frist = a.frist;
    nach = a.naechster;
    if (!nach) break;
  }
  return { eintraege, namen, bilder, frist };
}

const feldSchluessel = (person, tagId, abschnittId) =>
  `${person}|${tagId}|${abschnittId}`;
const FRIST_FORMAT = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "short",
});

function zeichne(bereich, ctx, d) {
  const { k, zeitplan } = d;
  const alleModus = d.modus === "alle";
  const bearbeiten = alleModus && k.kann("anwesenheit.bearbeiten");
  // Das Team trägt nur ein, wenn es auch Mitglied ist; der Server sagt es sonst (403 KEIN_MITGLIED)
  const eigeneSchreiben = !alleModus && k.kann("anwesenheit.eigene");
  const tage = zeitplan.lagertage;
  const abschnitte = zeitplan.tagesabschnitte;
  const stand = { tag: tage[0].id, gruppe: "alle", suche: "" };
  let frist = (alleModus ? d.matrix.frist : d.eig.frist) ?? null;

  // Personen der Matrix: Mitglieder und Teilnehmende, mit den Namen, die die Matrix kennt
  const personen = alleModus
    ? [
        ...d.mitglieder.map((m) => ({
          typ: "person",
          id: m.personId,
          name: m.name,
          bildUrl: m.bildUrl,
          gruppe: "leitende",
        })),
        ...d.kinder
          .filter((t) => !t.abgewaehlt)
          .map((t) => ({
            typ: "teilnehmer",
            id: t.id,
            name: teilnehmerName(t),
            gruppe: "teilnehmende",
            neben: t.stufe,
          })),
      ]
    : [{ typ: "person", id: "ich", name: "Du", gruppe: "leitende" }];
  if (alleModus) {
    const bekannt = new Set(personen.map((p) => `${p.typ}:${p.id}`));
    for (const e of d.matrix.eintraege) {
      const typ = e.teilnehmerId ? "teilnehmer" : "person";
      const id = e.teilnehmerId ?? e.personId;
      if (!bekannt.has(`${typ}:${id}`) && d.matrix.namen[id]) {
        bekannt.add(`${typ}:${id}`);
        personen.push({
          typ,
          id,
          name: d.matrix.namen[id],
          bildUrl: d.matrix.bilder?.[id],
          gruppe: typ === "person" ? "leitende" : "teilnehmende",
        });
      }
    }
  }
  personen.sort((a, b) => nameVergleich(a.name, b.name));

  // Stand des Servers je Feld und Änderungen, die noch nicht gesendet sind
  const server = new Map();
  const eintraege = alleModus ? d.matrix.eintraege : d.eig.eintraege;
  // Im eigenen Modus steht jede Zeile für dich
  const idVon = (e) => (alleModus ? (e.teilnehmerId ?? e.personId) : "ich");
  for (const e of eintraege)
    server.set(feldSchluessel(idVon(e), e.lagertagId, e.tagesabschnittId), e);
  const offen = new Map(); // Schluessel -> { person, tagId, abschnittId, wert }
  let konflikt = null;
  const wertVon = (person, tagId, aId) => {
    const key = feldSchluessel(person.id, tagId, aId);
    return offen.get(key)?.wert ?? server.get(key)?.wert ?? "O";
  };
  const serverWert = (person, tagId, aId) =>
    server.get(feldSchluessel(person.id, tagId, aId))?.wert ?? "O";

  function setzeWert(person, tagId, aId, wert) {
    const key = feldSchluessel(person.id, tagId, aId);
    if (wert === serverWert(person, tagId, aId)) offen.delete(key);
    else offen.set(key, { person, tagId, abschnittId: aId, wert });
    konflikt = konflikt && konflikt.key === key ? null : konflikt;
  }

  const kopfFrist = el("p", { class: "mn-fristzeile", role: "status" });
  const tageOrt = el("div");
  const tabelleOrt = el("div");
  const konfliktOrt = el("div");
  const leiste = el("div", {
    class: "mn-leiste",
    role: "region",
    "aria-label": "Änderungen",
    hidden: true,
  });
  const anfragenOrt = el("div");

  function zeichneFrist() {
    const text = frist
      ? `Frist für das Team: ${FRIST_FORMAT.format(new Date(frist))}`
      : "Keine Frist für das Team";
    fuelle(
      kopfFrist,
      el("span", {}, icon("uhr"), ` ${text}`),
      bearbeiten
        ? knopf("Frist ändern", {
            klein: true,
            art: "still",
            onclick: fristFormular,
          })
        : false,
    );
  }
  function fristFormular() {
    const z = frist ? new Date(frist) : null;
    const lokal = z
      ? `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, "0")}-${String(z.getDate()).padStart(2, "0")}T${String(z.getHours()).padStart(2, "0")}:${String(z.getMinutes()).padStart(2, "0")}`
      : "";
    const f = datumZeitFeld({
      label: "Frist für das Team",
      wert: lokal,
      hilfe:
        "Bis dahin trägt sich das Team direkt ein. Danach geht es nur mit einer Anfrage. Leer lassen hebt die Frist auf.",
    });
    dialogFormular({
      titel: "Frist ändern",
      beschreibung: "Die Frist gilt für das ganze Lager.",
      felder: [f.wurzel],
      ok: "Speichern",
      fehlertext: meldung,
      senden: async () => {
        const v = f.eingabe.value;
        const neu = v ? new Date(v).toISOString() : null;
        return anfrage("PUT", `${LB(k.lagerId)}/anwesenheit/frist`, {
          frist: neu,
        });
      },
      danach: (a) => {
        frist = a.frist;
        zeichneFrist();
        puls(kopfFrist);
        ctx.melde(
          frist ? "Die Frist ist gesetzt." : "Die Frist ist aufgehoben.",
        );
      },
    });
  }

  const tagButtons = filterGruppe({
    beschriftung: "Lagertag",
    eintraege: tage.map((t) => ({ text: tagText(t.datum), wert: t.id })),
    wert: stand.tag,
    beiAenderung: (t) => {
      stand.tag = t;
      zeichneTabelle();
      blendeEin(tabelleOrt);
    },
  });
  tageOrt.append(tagButtons.wurzel);

  const gruppenSchalter = alleModus
    ? filterGruppe({
        beschriftung: "Wer",
        eintraege: [
          { text: "Alle", wert: "alle" },
          { text: "Leitende", wert: "leitende" },
          { text: "Teilnehmende", wert: "teilnehmende" },
        ],
        beiAenderung: (g) => {
          stand.gruppe = g;
          zeichneTabelle();
        },
      })
    : null;
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
    zeichneTabelle();
    suche.eingabe.focus();
  });

  // Das Team ändert direkt, was offen und nicht abgelaufen ist; bei allem anderen antwortet der Server mit «Anfrage nötig»
  const schreibbar = () => bearbeiten || eigeneSchreiben;

  // Rückmeldung am Antippen: Das Feld pulst, die Tabelle baut sich neu auf, der Fokus bleibt auf dem Feld
  const rueckmeldung = (schluessel) =>
    schluessel.forEach((key, i) => {
      const knopf = tabelleOrt.querySelector(
        `[data-fokus="${CSS.escape(key)}"]`,
      );
      if (knopf) puls(knopf, Math.min(i, 10) * 25);
    });

  function wechsle(person, tagId, aId, wert) {
    setzeWert(
      person,
      tagId,
      aId,
      wert ?? naechsterWert(wertVon(person, tagId, aId)),
    );
    zeichneTabelle();
    rueckmeldung([feldSchluessel(person.id, tagId, aId)]);
  }

  function zelle(person, tag, a) {
    const wert = wertVon(person, tag.id, a.id);
    const geaendert = offen.has(feldSchluessel(person.id, tag.id, a.id));
    const { wort, symbol } = ANWESENHEIT[wert];
    const kann = schreibbar();
    const name = alleModus ? person.name : "Du";
    return el(
      "td",
      { class: "mn-anwzelle" },
      el(
        "button",
        {
          type: "button",
          class: `mn-anw mn-anw--${wert}${geaendert ? " ist-geaendert" : ""}`,
          disabled: !kann,
          "data-fokus": feldSchluessel(person.id, tag.id, a.id),
          "aria-label": `${name}, ${a.name}, ${tagText(tag.datum)}: ${wort}${geaendert ? ", noch nicht gespeichert" : ""}. Antippen wechselt den Wert.`,
          onclick: () => wechsle(person, tag.id, a.id),
        },
        icon(symbol),
        el("span", {}, wort),
        geaendert && el("span", { class: "mn-punkt", "aria-hidden": "true" }),
      ),
    );
  }

  // Die Summen zählen vom alten zum neuen Wert (Schlüssel: Tag, Abschnitt, Art)
  const summenStand = new Map();
  function summenZelle(tagId, aId, z) {
    const kinder = [];
    [
      ["A", "da"],
      ["F", "frei"],
      ["O", "offen"],
    ].forEach(([w, name], i) => {
      const key = `${tagId}|${aId}|${w}`;
      kinder.push(
        zaehlZahl(z[w], String, summenStand.get(key)),
        ` ${name}${i < 2 ? ", " : ""}`,
      );
      summenStand.set(key, z[w]);
    });
    return el("td", { class: "klein" }, ...kinder);
  }

  function zeichneTabelle() {
    const fokus = tabelleOrt.contains(document.activeElement)
      ? document.activeElement.dataset.fokus
      : undefined;
    const tag = tages();
    const sichtbar = personen.filter(
      (p) =>
        (stand.gruppe === "alle" || p.gruppe === stand.gruppe) &&
        (stand.suche === "" || p.name.toLowerCase().includes(stand.suche)),
    );
    const zeilen = sichtbar.map((p) =>
      el(
        "tr",
        { "data-id": `${p.typ}:${p.id}` },
        el(
          "th",
          { scope: "row" },
          el(
            "div",
            { class: "wer" },
            avatar(p.name, { hell: true, bildUrl: p.bildUrl }),
            el(
              "div",
              {},
              el("span", { class: "name" }, p.name),
              p.neben && el("span", { class: "klein leise" }, ` ${p.neben}`),
            ),
          ),
        ),
        abschnitte.map((a) => zelle(p, tag, a)),
        bearbeiten || eigeneSchreiben
          ? el(
              "td",
              {},
              knopf("Ganzer Tag", {
                klein: true,
                art: "still",
                kontext: alleModus ? p.name : undefined,
                "data-fokus": `tag|${p.typ}:${p.id}`,
                onclick: () => {
                  const neu = naechsterWert(
                    wertVon(p, tag.id, abschnitte[0].id),
                  );
                  for (const a of abschnitte) setzeWert(p, tag.id, a.id, neu);
                  zeichneTabelle();
                  rueckmeldung(
                    abschnitte.map((a) => feldSchluessel(p.id, tag.id, a.id)),
                  );
                },
              }),
            )
          : false,
      ),
    );
    // Summenzeile: wie viele sind da, frei, offen (nur in der Matrix)
    const fuss = alleModus
      ? el(
          "tr",
          { class: "mn-summe-zeile" },
          el("th", { scope: "row" }, "Summe"),
          abschnitte.map((a) => {
            const z = { A: 0, F: 0, O: 0 };
            for (const p of sichtbar) z[wertVon(p, tag.id, a.id)]++;
            return summenZelle(tag.id, a.id, z);
          }),
          bearbeiten ? el("td") : false,
        )
      : false;
    const kopfSpalten = [
      alleModus ? "Person" : "Du",
      ...abschnitte.map((a) => (a.zeit ? `${a.name} (${a.zeit})` : a.name)),
      ...(bearbeiten || eigeneSchreiben ? [""] : []),
    ];
    const { wurzel } = tabelle({
      beschriftung: `Anwesenheit am ${tagText(tag.datum)}`,
      spalten: kopfSpalten.map((s) => (s === "" ? ["Aktionen", "rechts"] : s)),
      zeilen: [...zeilen, fuss].filter(Boolean),
    });
    wurzel.classList.add("mn-anwesenheit");
    // Pro Abschnitt alle sichtbaren auf «Da»
    const kopfZeile = wurzel.querySelector("thead tr");
    if (bearbeiten)
      [...kopfZeile.querySelectorAll("th")]
        .slice(1, 1 + abschnitte.length)
        .forEach((th, i) => {
          th.append(
            el(
              "button",
              {
                type: "button",
                class: "knopf knopf--klein knopf--still",
                "data-fokus": `alle|${abschnitte[i].id}`,
                "aria-label": `Alle sichtbaren auf Da setzen: ${abschnitte[i].name}`,
                onclick: () => {
                  for (const p of sichtbar)
                    setzeWert(p, tag.id, abschnitte[i].id, "A");
                  zeichneTabelle();
                  rueckmeldung(
                    sichtbar.map((p) =>
                      feldSchluessel(p.id, tag.id, abschnitte[i].id),
                    ),
                  );
                },
              },
              "Alle Da",
            ),
          );
        });
    fuelle(
      tabelleOrt,
      wurzel,
      sichtbar.length === 0
        ? leerKarte(
            stand.suche
              ? `Keine Treffer für «${stand.suche}».`
              : "Niemand in dieser Auswahl.",
          )
        : false,
    );
    if (fokus)
      tabelleOrt.querySelector(`[data-fokus="${CSS.escape(fokus)}"]`)?.focus();
    zeichneLeiste();
  }
  const tages = () => tage.find((t) => t.id === stand.tag);

  // Die Zahl in der Leiste zählt; die Leiste selbst steigt auf, wenn die erste Änderung entsteht
  let letzteN = 0;
  function zeichneLeiste() {
    const n = offen.size;
    leiste.hidden = n === 0;
    if (n === 0) {
      letzteN = 0;
      return;
    }
    leiste.replaceChildren(
      el(
        "p",
        { class: "mn-leiste-zahl", role: "status" },
        zaehlZahl(n, String, letzteN),
        n === 1 ? " Änderung" : " Änderungen",
        " noch nicht gespeichert",
      ),
      knopf("Speichern", { art: "haupt", onclick: speichern }),
      knopf("Änderungen verwerfen", {
        onclick: () => {
          offen.clear();
          konflikt = null;
          zeichneTabelle();
          zeichneKonflikt();
        },
      }),
    );
    letzteN = n;
  }

  async function speichern(ereignis) {
    const b = ereignis.currentTarget;
    b.disabled = true;
    b.setAttribute("aria-busy", "true");
    let gespeichert = [];
    try {
      const liste = [...offen.values()];
      const schluesselListe = liste.map((c) =>
        feldSchluessel(c.person.id, c.tagId, c.abschnittId),
      );
      if (alleModus) {
        for (let i = 0; i < liste.length; i += 100) {
          const teil = liste.slice(i, i + 100);
          const a = await anfrage("PUT", `${LB(k.lagerId)}/anwesenheit`, {
            eintraege: teil.map((c) => ({
              ...(c.person.typ === "teilnehmer"
                ? { teilnehmerId: c.person.id }
                : { personId: c.person.id }),
              lagertagId: c.tagId,
              tagesabschnittId: c.abschnittId,
              wert: c.wert,
              version: server.get(
                feldSchluessel(c.person.id, c.tagId, c.abschnittId),
              )?.version,
            })),
          });
          uebernimm(a.eintraege);
          for (const c of teil)
            offen.delete(feldSchluessel(c.person.id, c.tagId, c.abschnittId));
        }
        gespeichert = schluesselListe;
        ctx.melde(
          `${mehrzahl(liste.length, "Änderung", "Änderungen")} gespeichert.`,
        );
      } else {
        const a = await anfrage("PUT", `${LB(k.lagerId)}/anwesenheit/eigene`, {
          eintraege: liste.map((c) => ({
            lagertagId: c.tagId,
            tagesabschnittId: c.abschnittId,
            wert: c.wert,
          })),
        });
        uebernimm(a.eintraege);
        gespeichert = schluesselListe;
        offen.clear();
        ctx.melde("Deine Anwesenheit ist gespeichert.");
      }
      konflikt = null;
    } catch (f) {
      if (
        f?.status === 409 &&
        f.code === "VERSION_KONFLIKT" &&
        f.daten?.aktuell
      ) {
        const e = f.daten.aktuell;
        const key = feldSchluessel(idVon(e), e.lagertagId, e.tagesabschnittId);
        server.set(key, e);
        konflikt = { key, aktuell: e };
      } else if (f?.status === 409 && f.code === "ANFRAGE_NOETIG") {
        anfrageSeite(f.daten.gesperrt ?? []);
      } else ctx.melde(meldung(f), "fehler");
    } finally {
      b.disabled = false;
      b.removeAttribute("aria-busy");
      zeichneTabelle();
      zeichneKonflikt();
      rueckmeldung(gespeichert);
    }
  }
  function uebernimm(liste) {
    for (const e of liste)
      server.set(feldSchluessel(idVon(e), e.lagertagId, e.tagesabschnittId), e);
  }

  // Zwei Stände nebeneinander: Jemand hat das Feld inzwischen anders gesetzt
  function zeichneKonflikt() {
    if (!konflikt) return konfliktOrt.replaceChildren();
    const [pid, tagId, aId] = konflikt.key.split("|");
    const person = personen.find((p) => p.id === pid) ?? {
      name: "Eine Person",
    };
    const dein = offen.get(konflikt.key)?.wert ?? "O";
    konfliktOrt.replaceChildren(
      el(
        "section",
        {
          class: "mn-konflikt",
          role: "alert",
          "aria-labelledby": "anw-konflikt",
        },
        el("h3", { id: "anw-konflikt" }, "Jemand war schneller"),
        el(
          "p",
          {},
          `${person.name}, ${abschnitte.find((a) => a.id === aId)?.name ?? ""} am ${tagText(tage.find((t) => t.id === tagId)?.datum)}: Jetzt steht «${ANWESENHEIT[konflikt.aktuell.wert].wort}», du wolltest «${ANWESENHEIT[dein].wort}». Nichts wurde gespeichert.`,
        ),
        el(
          "div",
          { class: "mn-konflikt-knoepfe" },
          knopf("Meine Änderung übernehmen", {
            art: "blau",
            onclick: (e) => speichern(e),
          }),
          knopf("Stand des Servers übernehmen", {
            onclick: () => {
              offen.delete(konflikt.key);
              konflikt = null;
              zeichneTabelle();
              zeichneKonflikt();
            },
          }),
        ),
      ),
    );
  }

  // Anfrage an die Lagerleitung für Felder, die das Team nicht mehr direkt ändert
  function anfrageSeite(gesperrt) {
    const schluessel = new Set(
      gesperrt.map((g) => `${g.lagertagId}|${g.tagesabschnittId}`),
    );
    const betroffen = [...offen.values()].filter((c) =>
      schluessel.has(`${c.tagId}|${c.abschnittId}`),
    );
    const notiz = feld({
      label: "Bemerkung",
      hilfe: "Freiwillig. Warum ändert sich dein Eintrag?",
      mehrzeilig: true,
      maxlength: 500,
    });
    dialogFormular({
      titel: "Anfrage an die Lagerleitung",
      beschreibung:
        "Du änderst einen Eintrag, der schon bestätigt ist oder dessen Frist abgelaufen ist. Die Lagerleitung muss zustimmen.",
      felder: [
        el(
          "ul",
          { class: "mn-fehlerliste" },
          betroffen.map((c) =>
            el(
              "li",
              {},
              `${tagText(tage.find((t) => t.id === c.tagId)?.datum)}, ${abschnitte.find((a) => a.id === c.abschnittId)?.name}: ${ANWESENHEIT[c.wert].wort}`,
            ),
          ),
        ),
        notiz.wurzel,
      ],
      ok: "Anfrage senden",
      fehlertext: meldung,
      senden: () =>
        anfrage("POST", `${LB(k.lagerId)}/anwesenheit/anfragen`, {
          eintraege: betroffen.map((c) => ({
            lagertagId: c.tagId,
            tagesabschnittId: c.abschnittId,
            wert: c.wert,
          })),
          ...(notiz.eingabe.value.trim()
            ? { notiz: notiz.eingabe.value.trim() }
            : {}),
        }),
      danach: () => {
        for (const c of betroffen)
          offen.delete(feldSchluessel(c.person.id, c.tagId, c.abschnittId));
        zeichneTabelle();
        ctx.melde("Die Anfrage ist bei der Lagerleitung.");
      },
    });
  }

  // Anfragen des Teams: einzeln oder alle auf einmal annehmen oder ablehnen
  let anfragen = d.anfragen ?? [];
  const namenVon = new Map(personen.map((p) => [p.id, p.name]));
  async function entscheide(liste, entscheid) {
    try {
      await anfrage("POST", `${LB(k.lagerId)}/anwesenheit/anfragen/entscheid`, {
        entscheid,
        anfragen: liste
          .slice(0, 50)
          .map((a) => ({ id: a.id, version: a.version })),
      });
      const ids = new Set(liste.slice(0, 50).map((a) => a.id));
      anfragen = anfragen.filter((a) => !ids.has(a.id));
      ctx.melde(
        entscheid === "angenommen"
          ? "Die Anfragen sind angenommen."
          : "Die Anfragen sind abgelehnt.",
      );
      zeichneAnfragen();
      // Angenommene Werte stehen jetzt in der Matrix: neu holen, ohne die Seite zu leeren
      await nachladen();
    } catch (f) {
      ctx.melde(meldung(f), f?.status === 409 ? "warn" : "fehler");
      if (f?.status === 409) await nachladen();
    }
  }
  // Matrix und Anfragen neu holen: die Tabelle bleibt stehen, wird ruhiger und tauscht dann ihre Felder
  async function nachladen() {
    tabelleOrt.classList.add("lg-teil");
    tabelleOrt.setAttribute("aria-busy", "true");
    try {
      const [matrix, neueAnfragen] = await Promise.all([
        ladeMatrix(k.lagerId),
        bearbeiten
          ? ladeAlle(
              `${LB(k.lagerId)}/anwesenheit/anfragen?status=offen`,
              "anfragen",
            )
          : [],
      ]);
      server.clear();
      for (const e of matrix.eintraege)
        server.set(
          feldSchluessel(idVon(e), e.lagertagId, e.tagesabschnittId),
          e,
        );
      frist = matrix.frist;
      anfragen = neueAnfragen;
      zeichneFrist();
      zeichneTabelle();
      zeichneAnfragen();
    } catch (f) {
      ctx.melde(meldung(f), "fehler");
    } finally {
      tabelleOrt.classList.remove("lg-teil");
      tabelleOrt.removeAttribute("aria-busy");
    }
  }
  function zeichneAnfragen() {
    if (!bearbeiten) return;
    if (anfragen.length === 0) return ersetzeMitBewegung(anfragenOrt);
    ersetzeMitBewegung(
      anfragenOrt,
      el(
        "section",
        { class: "flaeche", "aria-labelledby": "anw-anfragen" },
        el("h2", { id: "anw-anfragen" }, "Anfragen des Teams"),
        el(
          "div",
          { class: "mn-aktionen" },
          knopf(`Alle ${anfragen.length} annehmen`, {
            art: "haupt",
            onclick: () => entscheide(anfragen, "angenommen"),
          }),
          knopf(`Alle ${anfragen.length} ablehnen`, {
            onclick: () => entscheide(anfragen, "abgelehnt"),
          }),
        ),
        el(
          "ul",
          { class: "liste-zeilen" },
          anfragen.map((a) =>
            el(
              "li",
              { "data-id": a.id },
              el(
                "span",
                {},
                `${namenVon.get(a.personId) ?? "Eine Person"} möchte «${ANWESENHEIT[a.wert].wort}», ${tagText(tage.find((t) => t.id === a.lagertagId)?.datum)}, ${abschnitte.find((x) => x.id === a.tagesabschnittId)?.name ?? ""}`,
                a.notiz && el("span", { class: "klein leise" }, ` ${a.notiz}`),
              ),
              el(
                "div",
                { class: "mn-aktionen" },
                knopf("Annehmen", {
                  klein: true,
                  kontext: namenVon.get(a.personId),
                  onclick: () => entscheide([a], "angenommen"),
                }),
                knopf("Ablehnen", {
                  klein: true,
                  art: "still",
                  kontext: namenVon.get(a.personId),
                  onclick: () => entscheide([a], "abgelehnt"),
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // Eigene Anfragen des Teams
  const eigeneAnfragen =
    !alleModus && d.eig.anfragen.length > 0
      ? el(
          "section",
          { class: "flaeche", "aria-labelledby": "anw-eigene" },
          el("h2", { id: "anw-eigene" }, "Deine Anfragen"),
          el(
            "ul",
            { class: "liste-zeilen" },
            d.eig.anfragen.map((a) =>
              el(
                "li",
                {},
                el(
                  "span",
                  {},
                  `Änderung auf «${ANWESENHEIT[a.wert].wort}», ${tagText(tage.find((t) => t.id === a.lagertagId)?.datum)}, ${abschnitte.find((x) => x.id === a.tagesabschnittId)?.name ?? ""}`,
                ),
                a.status === "offen"
                  ? zustandsChip("Wartet", "warn", "uhr")
                  : a.status === "angenommen"
                    ? zustandsChip("Angenommen", "ok", "haken")
                    : zustandsChip("Abgelehnt", "fehler", "sperre"),
              ),
            ),
          ),
        )
      : false;

  ctx.kopfAktion();
  haenge(
    bereich,
    el("div", { class: "mn-werkzeuge" }, kopfFrist),
    tageOrt,
    alleModus &&
      el(
        "div",
        { class: "mn-werkzeuge" },
        gruppenSchalter.wurzel,
        suche.wurzel,
      ),
    !alleModus &&
      eigeneSchreiben &&
      el(
        "p",
        { class: "klein leise" },
        "Tippe ein Feld, um zwischen Da, Frei und Offen zu wechseln. Danach «Speichern».",
      ),
    konfliktOrt,
    tabelleOrt,
    anfragenOrt,
    eigeneAnfragen,
    leiste,
  );
  zeichneFrist();
  zeichneTabelle();
  zeichneAnfragen();
}

import { anfrage } from "./api.js";
import { auswahl, dialogFormular, el, feld, knopf } from "./dom.js";
import { skeletonListe } from "./lader.js";
import { ADRESSE, haenge, meldung } from "./lager-gemeinsam.js";
import {
  aussenLink,
  istKonflikt,
  kannLesen,
  kannSchreiben,
  konfliktBox,
  KONFLIKT_TEXT,
  ladeMitglieder,
  lagerPfad,
  listenFehler,
  mitFehlertext,
  neueReihenfolge,
  personName,
  druckKnopf,
} from "./lager-m-hilfen.js";
import { tagText, warnChips, wetterSatz } from "./lager-m-wetter.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";
import { sortierListe } from "./sortieren.js";
import { leerKarte } from "./zustaende.js";

// Tagesseiten im Lager-Arbeitsbereich (#674): je Lagertag Tageschef, Notiz und Blöcke «Wichtig», «Ideen» und «Programmbilder», dazu das Wetter des Tages und die Aufgaben mit Frist an diesem Tag. Adressen: …/tagesseiten und …/tagesseiten/<lagertagId>. Lesen: tagesseiten.lesen, Ändern: tagesseiten.bearbeiten. Die Seite eines Tages entsteht beim ersten Schreiben. Ein Programmbild ist eine Verknüpfung auf eine Datei; es lässt sich hier ansehen, die Auswahl der Datei gehört zum Modul «Dateien».
// Routen: GET /tagesseiten, GET/POST/PATCH /tagesseiten/{tag}, POST/PATCH/DELETE /tagesseiten/{tag}/bloecke.

const ARTEN = [
  ["wichtig", "Wichtig heute", "Was alle heute wissen müssen."],
  ["idee", "Ideen", "Einfälle und Vorschläge für den Tag."],
  ["programmbild", "Programmbilder", "Fotos und Pläne als Verknüpfung."],
];

const STATUS = {
  offen: "Offen",
  laeuft: "Läuft",
  wartet: "Wartet",
  erledigt: "Erledigt",
  naechster_hoeck: "Nächster Höck",
};

// Reine Funktion (testbar): welcher Tag zuerst offen ist: der gewählte, sonst heute, sonst der erste, der noch kommt, sonst der erste
export function waehleTag(tage, gewaehlt, heute) {
  if (gewaehlt && tage.some((t) => t.lagertagId === gewaehlt)) return gewaehlt;
  const t =
    tage.find((x) => x.datum === heute) ??
    tage.find((x) => x.datum > heute) ??
    tage[0];
  return t?.lagertagId ?? null;
}

// Heute als «JJJJ-MM-TT» in der Zeitzone der Schweiz
export const heuteIso = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(
    new Date(),
  );

export function zeige(bereich, ctx, lagerId, lager) {
  ctx.titel("Tagesseiten", "Ein Blatt für jeden Lagertag.");
  ctx.lade(
    async () => {
      const liste = await anfrage("GET", lagerPfad(lagerId, "/tagesseiten"));
      const tag = waehleTag(liste.tage, ctx.weiter?.[0], heuteIso());
      const [detail, mitglieder] = tag
        ? await Promise.all([
            anfrage("GET", lagerPfad(lagerId, `/tagesseiten/${tag}`)),
            ladeMitglieder(lagerId),
          ])
        : [null, null];
      return { tage: liste.tage, tag, detail, mitglieder };
    },
    (daten, neu) => haenge(bereich, zeichne(ctx, lagerId, lager, daten, neu)),
    { skeleton: () => skeletonListe({ zeilen: 6 }) },
  );
}

function tagesliste(lagerId, daten) {
  return el(
    "nav",
    { class: "lm-tage lm-nicht-drucken", "aria-label": "Lagertage" },
    el(
      "ul",
      {},
      daten.tage.map((t) =>
        el(
          "li",
          {},
          el(
            "a",
            {
              href: `${ADRESSE}/${lagerId}/tagesseiten/${t.lagertagId}`,
              "aria-current": t.lagertagId === daten.tag ? "page" : undefined,
            },
            el("strong", {}, tagText(t.datum)),
            t.label && el("span", { class: "klein" }, t.label),
            t.seite
              ? el(
                  "span",
                  { class: "klein leise" },
                  t.seite.tageschef
                    ? `Tageschef: ${personName(t.seite.tageschef)}`
                    : "Seite angelegt",
                )
              : el("span", { class: "klein leise" }, "Noch leer"),
          ),
        ),
      ),
    ),
  );
}

function zeichne(ctx, lagerId, lager, daten, neu) {
  if (daten.tage.length === 0) {
    return el(
      "div",
      { class: "lm-seite" },
      leerKarte(
        "Das Lager hat noch keine Lagertage. Lege sie im Zeitplan an, dann bekommt jeder Tag hier ein Blatt.",
      ),
    );
  }
  const d = daten.detail;
  return el(
    "div",
    { class: "lm-seite" },
    el(
      "div",
      { class: "lm-tagesraster" },
      tagesliste(lagerId, daten),
      tagesblatt(ctx, lagerId, lager, daten, d, neu),
    ),
  );
}

function nachbarn(daten) {
  const i = daten.tage.findIndex((t) => t.lagertagId === daten.tag);
  return { voriger: daten.tage[i - 1], naechster: daten.tage[i + 1] };
}

function tagesblatt(ctx, lagerId, lager, daten, d, neu) {
  const darf = kannSchreiben(lager, "tagesseiten.bearbeiten");
  const { voriger, naechster } = nachbarn(daten);
  const adresse = (t) => `${ADRESSE}/${lagerId}/tagesseiten/${t.lagertagId}`;
  const kopf = el(
    "header",
    { class: "lm-tageskopf" },
    el(
      "div",
      {},
      el("h2", {}, tagText(d.lagertag.datum)),
      d.lagertag.label && el("p", { class: "leise" }, d.lagertag.label),
    ),
    el(
      "div",
      { class: "reihe lm-nicht-drucken" },
      voriger &&
        el(
          "a",
          { class: "knopf knopf--klein", href: adresse(voriger) },
          "Voriger Tag",
          el("span", { class: "nur-leser" }, `: ${tagText(voriger.datum)}`),
        ),
      naechster &&
        el(
          "a",
          { class: "knopf knopf--klein", href: adresse(naechster) },
          "Nächster Tag",
          el("span", { class: "nur-leser" }, `: ${tagText(naechster.datum)}`),
        ),
      druckKnopf("Drucken", "Tagesseite"),
    ),
  );
  return el(
    "div",
    { class: "lm-tagesblatt" },
    kopf,
    wetterKarte(lagerId, lager, d),
    tagKarte(ctx, lagerId, d, daten.mitglieder, darf, neu),
    ARTEN.map(([art, titel, hilfe]) =>
      blockKarte(ctx, lagerId, d, art, titel, hilfe, darf, neu),
    ),
    aufgabenKarte(lagerId, lager, d),
  );
}

function wetterKarte(lagerId, lager, d) {
  if (!kannLesen(lager, "wetter.lesen")) return null;
  return el(
    "section",
    { class: "flaeche" },
    el("h3", {}, "Wetter"),
    d.wetter
      ? [
          el("p", {}, wetterSatz(d.wetter) || "Keine Angaben."),
          warnChips(d.wetter),
        ]
      : el(
          "p",
          { class: "leise" },
          "Für diesen Tag gibt es kein Wetter. Die Vorhersage reicht nur ein paar Tage voraus und braucht einen Ort. ",
          el(
            "a",
            {
              class: "lg-verweis lm-nicht-drucken",
              href: `${ADRESSE}/${lagerId}/wetter`,
            },
            "Zum Wetter",
          ),
        ),
  );
}

// Tageschef und Notiz: ein Formular, speichert mit der Version der Seite (POST, solange es noch keine Seite gibt)
function tagKarte(ctx, lagerId, d, mitglieder, darf, neu) {
  const seite = d.seite;
  if (!darf) {
    return el(
      "section",
      { class: "flaeche" },
      el("h3", {}, "Tageschef und Notiz"),
      el(
        "p",
        {},
        el("strong", {}, "Tageschef: "),
        seite?.tageschef ? personName(seite.tageschef) : "noch niemand",
      ),
      seite?.notiz
        ? el("p", { class: "lm-text" }, seite.notiz)
        : el("p", { class: "leise" }, "Keine Notiz."),
    );
  }
  const chef = mitglieder
    ? auswahl({
        label: "Tageschef",
        optionen: [["", "Noch niemand"], ...mitglieder],
        wert: seite?.tageschefPersonId ?? "",
      })
    : null;
  const notiz = feld({
    label: "Notiz",
    wert: seite?.notiz ?? "",
    mehrzeilig: true,
    rows: 5,
    maxlength: 5000,
    hilfe: "Freiwillig. Alles, was für den Tag zählt und nirgends sonst steht.",
  });
  let version = seite?.version;
  const werte = () => ({
    ...(chef ? { tageschefPersonId: chef.eingabe.value || null } : {}),
    notiz: notiz.eingabe.value.trim() || null,
  });
  const fehler = el("p", { class: "feld-fehler", role: "alert", hidden: true });
  const speichern = knopf("Speichern", { art: "haupt", symbol: "haken" });
  const konflikt = konfliktBox({
    felder: { tageschefPersonId: "Tageschef", notiz: "Notiz" },
    meine: werte,
    beiEigene: (aktuell) => {
      version = aktuell.version;
      senden();
    },
    beiServer: () => neu(),
  });
  async function senden() {
    fehler.hidden = true;
    speichern.disabled = true;
    speichern.setAttribute("aria-busy", "true");
    try {
      if (seite || version)
        await anfrage(
          "PATCH",
          lagerPfad(lagerId, `/tagesseiten/${d.lagertag.id}`),
          {
            version,
            ...werte(),
          },
        );
      else
        await anfrage(
          "POST",
          lagerPfad(lagerId, `/tagesseiten/${d.lagertag.id}`),
          werte(),
        );
      ctx.melde("Die Tagesseite ist gespeichert.");
      neu();
    } catch (f) {
      if (istKonflikt(f)) konflikt.zeige(f.daten);
      else {
        fehler.textContent = meldung(f);
        fehler.hidden = false;
      }
      speichern.disabled = false;
      speichern.removeAttribute("aria-busy");
    }
  }
  speichern.addEventListener("click", senden);
  return el(
    "section",
    { class: "flaeche" },
    el("h3", {}, "Tageschef und Notiz"),
    konflikt.wurzel,
    chef?.wurzel,
    notiz.wurzel,
    fehler,
    el("div", { class: "reihe lm-nicht-drucken" }, speichern),
  );
}

function blockKarte(ctx, lagerId, d, art, titel, hilfe, darf, neu) {
  const bloecke = d.bloecke.filter((b) => b.art === art).map((b) => ({ ...b }));
  const nurAnsehen = art === "programmbild";
  const bearbeiten = (b) => {
    const neuAnlegen = !b;
    const text = feld({
      label: art === "programmbild" ? "Beschriftung" : "Text",
      wert: b?.text ?? "",
      mehrzeilig: true,
      rows: 4,
      maxlength: 1000,
      required: true,
    });
    let version = b?.version;
    let seite;
    const konflikt = konfliktBox({
      felder: { text: "Text" },
      meine: () => ({ text: text.eingabe.value.trim() }),
      beiEigene: (aktuell) => {
        version = aktuell.version;
        seite.querySelector("form").requestSubmit();
      },
      beiServer: () => {
        seite.close();
        neu();
      },
    });
    seite = dialogFormular({
      titel: neuAnlegen
        ? `${titel}: Eintrag hinzufügen`
        : `${titel}: Eintrag bearbeiten`,
      felder: [konflikt.wurzel, text.wurzel],
      ok: neuAnlegen ? "Hinzufügen" : "Speichern",
      senden: async () => {
        const wert = text.eingabe.value.trim();
        try {
          if (neuAnlegen)
            await anfrage(
              "POST",
              lagerPfad(lagerId, `/tagesseiten/${d.lagertag.id}/bloecke`),
              { art, text: wert },
            );
          else
            await anfrage(
              "PATCH",
              lagerPfad(
                lagerId,
                `/tagesseiten/${d.lagertag.id}/bloecke/${b.id}`,
              ),
              { version, text: wert },
            );
        } catch (f) {
          if (istKonflikt(f)) konflikt.zeige(f.daten);
          throw f;
        }
      },
      fehlertext: (f) => (istKonflikt(f) ? KONFLIKT_TEXT : meldung(f)),
      danach: () => {
        ctx.melde(
          neuAnlegen
            ? "Der Eintrag ist angelegt."
            : "Der Eintrag ist gespeichert.",
        );
        neu();
      },
    });
  };
  const loesche = (b, ereignis) =>
    ctx.mitRueckgaengig({
      text: "Eintrag gelöscht",
      ansicht: ansichtVonKnopf(ereignis),
      ausfuehren: () =>
        anfrage(
          "DELETE",
          lagerPfad(
            lagerId,
            `/tagesseiten/${d.lagertag.id}/bloecke/${b.id}?version=${b.version}`,
          ),
        ),
      fehlertext: (f) => `Der Eintrag wurde nicht gelöscht. ${listenFehler(f)}`,
      danach: neu,
      beiFehler: (f) => istKonflikt(f) && neu(),
    });
  const zeile = (b) =>
    el(
      "div",
      { class: "lm-blockzeile" },
      el(
        "div",
        { class: "lm-blocktext" },
        el("p", { class: "lm-text" }, b.text),
        b.datei && aussenLink(b.datei.anzeigename, b.datei.link),
      ),
      darf &&
        el(
          "span",
          { class: "lm-zeilenknoepfe lm-nicht-drucken" },
          !nurAnsehen &&
            knopf("Bearbeiten", {
              klein: true,
              symbol: "bearbeiten",
              kontext: b.text.slice(0, 40),
              onclick: () => bearbeiten(b),
            }),
          knopf("Löschen", {
            klein: true,
            art: "still",
            symbol: "papierkorb",
            kontext: b.text.slice(0, 40),
            onclick: (e) => loesche(b, e),
          }),
        ),
    );
  const ordne = async (ids) => {
    for (const a of neueReihenfolge(bloecke, ids)) {
      const antwort = await anfrage(
        "PATCH",
        lagerPfad(lagerId, `/tagesseiten/${d.lagertag.id}/bloecke/${a.id}`),
        { version: a.version, reihenfolge: a.reihenfolge },
      );
      Object.assign(
        bloecke.find((b) => b.id === a.id),
        antwort,
      );
    }
  };
  const inhalt =
    bloecke.length === 0
      ? el(
          "p",
          { class: "leise" },
          nurAnsehen
            ? "Keine Programmbilder. Sie kommen aus der App oder aus dem Modul «Dateien»."
            : "Noch nichts eingetragen.",
        )
      : darf
        ? sortierListe({
            beschriftung: titel,
            eintraege: bloecke.map((b) => ({
              id: b.id,
              text: b.text.slice(0, 60),
              inhalt: zeile(b),
            })),
            beiNeu: ordne,
            mitRueckgaengig: mitFehlertext(ctx, neu),
            aktionstext: `Reihenfolge von «${titel}» geändert`,
          }).wurzel
        : el(
            "ul",
            { class: "lm-infoliste" },
            bloecke.map((b) => el("li", {}, zeile(b))),
          );
  return el(
    "section",
    { class: "flaeche" },
    el(
      "div",
      { class: "lm-kartenkopf" },
      el("h3", {}, titel),
      darf &&
        !nurAnsehen &&
        el(
          "span",
          { class: "lm-nicht-drucken" },
          knopf("Hinzufügen", {
            klein: true,
            symbol: "plus",
            kontext: titel,
            onclick: () => bearbeiten(null),
          }),
        ),
    ),
    el("p", { class: "hilfe lm-nicht-drucken" }, hilfe),
    inhalt,
  );
}

function aufgabenKarte(lagerId, lager, d) {
  if (
    !kannLesen(lager, "aufgaben.lesen_alle") &&
    !kannLesen(lager, "aufgaben.eigene")
  )
    return null;
  return el(
    "section",
    { class: "flaeche" },
    el(
      "div",
      { class: "lm-kartenkopf" },
      el("h3", {}, "Aufgaben mit Frist an diesem Tag"),
      el(
        "a",
        {
          class: "lg-verweis lm-nicht-drucken",
          href: `${ADRESSE}/${lagerId}/aufgaben`,
        },
        "Zu den Aufgaben",
      ),
    ),
    d.aufgaben.length === 0
      ? el("p", { class: "leise" }, "Keine Aufgabe mit Frist an diesem Tag.")
      : el(
          "ul",
          { class: "lm-infoliste" },
          d.aufgaben.map((a) =>
            el(
              "li",
              { class: "lm-aufgabe" },
              el("span", {}, a.titel),
              el(
                "span",
                { class: a.status === "erledigt" ? "chip chip--ok" : "chip" },
                STATUS[a.status] ?? a.status,
              ),
            ),
          ),
        ),
  );
}

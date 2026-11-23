import { anfrage } from "./api.js";
import {
  aktionenZelle,
  ankreuzen,
  dialogFormular,
  el,
  feld,
  knopf,
  tabelle,
} from "./dom.js";
import { filterleiste } from "./filterleiste.js";
import { skeletonTabelle } from "./lader.js";
import { macheSortierbar, seitenleiste, sortiere } from "./liste-hilfen.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";
import { normalisiereTelefon } from "./telefon.js";
import { leerKarte } from "./zustaende.js";
import { beschrifteZellen, kartenTabelle } from "./lager-gemeinsam.js";
import { aufraeumenText, leerZuNull } from "./lager-menschen-logik.js";
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
} from "./lager-menschen.js";

// Adressbuch (#675; Server #397): Kontakte Dritter für das Lager (Hausvermieter, Küche, Notfall), standardmässig nur für die Lagerleitung. Personendaten Dritter: Jeder Abruf steht im Protokoll (nur Anzahl und Ziel, nie der Inhalt), die Liste wird darum einmal geladen und lokal durchsucht. Kontakte ohne «Behalten» löscht der Server 180 Tage nach dem Lagerende endgültig. Adresse: #lager/lager/<id>/adressbuch

export function zeige(bereich, ctx, lagerId, lager) {
  ctx.lade(
    async () => {
      const k = await ladeKontext(lagerId, lager);
      if (!k.darf("adressbuch.lesen")) return { k };
      return {
        k,
        liste: await ladeAlle(`${LB(lagerId)}/adressbuch`, "kontakte"),
      };
    },
    ({ k, liste }, neu) => {
      kopfeMitHinweis(bereich, ctx, k, "Adressbuch");
      if (!liste) return keinLeserecht(bereich, "das Adressbuch");
      zeichne(bereich, ctx, k, liste, neu);
    },
    {
      skeleton: () => skeletonTabelle({ spalten: 5, zeilen: 5, avatar: false }),
    },
  );
}

const FELDER = [
  ["name", "Name"],
  ["funktion", "Funktion"],
  ["gruppe", "Gruppe"],
  ["telefon", "Telefon"],
  ["email", "E-Mail"],
  ["notiz", "Notiz"],
  ["behalten", "Behalten", (w) => (w ? "Ja" : "Nein")],
];

function zeichne(bereich, ctx, k, alle, neu) {
  const bearbeiten = k.kann("adressbuch.bearbeiten");
  kopfAktion(
    ctx,
    bearbeiten
      ? knopf("Kontakt hinzufügen", {
          art: "haupt",
          symbol: "plus",
          onclick: () => formular(ctx, k, null, neu),
        })
      : false,
  );
  bereich.append(
    el(
      "div",
      { class: "hinweis hinweis--info", role: "note" },
      el(
        "span",
        {},
        "Das Adressbuch enthält Personendaten Dritter. Jeder Abruf wird protokolliert. Kontakte ohne «Behalten» werden 180 Tage nach dem Lagerende endgültig gelöscht.",
      ),
    ),
  );
  if (alle.length === 0) {
    bereich.append(
      leerKarte(
        bearbeiten
          ? "Noch keine Kontakte. Füge den ersten hinzu."
          : "Noch keine Kontakte.",
        bearbeiten
          ? [
              knopf("Kontakt hinzufügen", {
                art: "haupt",
                symbol: "plus",
                onclick: () => formular(ctx, k, null, neu),
              }),
            ]
          : [],
      ),
    );
    return;
  }
  const stand = { suche: "" };
  const zustand = { schluessel: "name", richtung: "auf" };
  const leiste = filterleiste({
    suche: { label: "Name, Funktion oder Gruppe suchen" },
    namen: { einzahl: "Kontakt", mehrzahl: "Kontakte" },
    beiAenderung: (s) => {
      stand.suche = s.suche.trim().toLowerCase();
      seiten.anfang();
      zeichneZeilen();
    },
  });
  const seiten = seitenleiste({ beiWechsel: () => zeichneZeilen() });
  const spalten = [
    "Name",
    "Funktion",
    "Gruppe",
    "Telefon",
    "E-Mail",
    "Aufräumen",
    ...(bearbeiten ? ["Aktionen"] : []),
  ];
  const { wurzel: rahmen, koerper } = tabelle({
    beschriftung: "Kontakte",
    spalten,
    zeilen: [],
  });
  kartenTabelle(rahmen);
  macheSortierbar(
    rahmen,
    [
      { index: 0, schluessel: "name", name: "Name" },
      { index: 1, schluessel: "funktion", name: "Funktion" },
      { index: 2, schluessel: "gruppe", name: "Gruppe" },
    ],
    zustand,
    () => zeichneZeilen(),
  );
  const leer = el("div");

  const loesche = (c, ereignis) =>
    ctx.mitRueckgaengig({
      text: `${c.name} ist gelöscht`,
      ansicht: ansichtVonKnopf(ereignis),
      ausfuehren: () =>
        anfrage(
          "DELETE",
          `${LB(k.lagerId)}/adressbuch/${c.id}?version=${c.version}`,
        ),
      fehlertext: meldung,
      danach: neu,
    });

  function zeichneZeilen() {
    const treffer = sortiere(
      alle.filter(
        (c) =>
          stand.suche === "" ||
          [c.name, c.funktion, c.gruppe].some((w) =>
            (w ?? "").toLowerCase().includes(stand.suche),
          ),
      ),
      zustand,
      (c, s) => (c[s] ?? "").toLowerCase(),
    );
    const [von, bis] = seiten.fenster(treffer.length);
    koerper.replaceChildren(
      ...treffer.slice(von, bis).map((c) =>
        el(
          "tr",
          {},
          el(
            "th",
            { scope: "row" },
            el("span", { class: "name" }, c.name),
            c.notiz && el("span", { class: "klein leise mn-notiz" }, c.notiz),
          ),
          el("td", {}, c.funktion ?? "–"),
          el("td", {}, c.gruppe ?? "–"),
          el(
            "td",
            { class: "lg-zahlen" },
            c.telefon
              ? el(
                  "a",
                  { href: `tel:${c.telefon.replace(/[^\d+]/g, "")}` },
                  c.telefon,
                )
              : "–",
          ),
          el(
            "td",
            {},
            c.email ? el("a", { href: `mailto:${c.email}` }, c.email) : "–",
          ),
          el(
            "td",
            {},
            c.behalten
              ? zustandsChip("Behalten", "ok", "haken")
              : el("span", { class: "klein" }, aufraeumenText(c)),
          ),
          bearbeiten &&
            aktionenZelle(
              knopf("Ändern", {
                klein: true,
                art: "still",
                symbol: "bearbeiten",
                kontext: c.name,
                onclick: () => formular(ctx, k, c, neu),
              }),
              knopf("Löschen", {
                klein: true,
                art: "still",
                symbol: "papierkorb",
                kontext: c.name,
                onclick: (e) => loesche(c, e),
              }),
            ),
        ),
      ),
    );
    beschrifteZellen(koerper, [
      "",
      "Funktion",
      "Gruppe",
      "Telefon",
      "E-Mail",
      "Aufräumen",
      "",
    ]);
    rahmen.hidden = treffer.length === 0;
    leer.replaceChildren();
    if (treffer.length === 0)
      leer.append(
        leerKarte(`Keine Treffer für «${stand.suche}».`, [
          knopf("Suche zurücksetzen", { onclick: () => leiste.setzeAlles() }),
        ]),
      );
    leiste.setzeTreffer(treffer.length, alle.length);
  }
  bereich.append(leiste.wurzel, rahmen, leer, seiten.wurzel);
  zeichneZeilen();
}

function formular(ctx, k, c, neu) {
  const name = feld({
    label: "Name",
    wert: c?.name ?? "",
    maxlength: 100,
    autocomplete: "off",
    required: true,
  });
  const funktion = feld({
    label: "Funktion",
    hilfe: "Freiwillig. Zum Beispiel «Hausverwaltung».",
    wert: c?.funktion ?? "",
    maxlength: 100,
    autocomplete: "off",
  });
  const gruppe = feld({
    label: "Gruppe",
    hilfe: "Freiwillig. Zum Beispiel «Lagerhaus».",
    wert: c?.gruppe ?? "",
    maxlength: 100,
    autocomplete: "off",
  });
  const telefon = feld({
    label: "Telefon",
    hilfe: "Freiwillig. Zum Beispiel 079 123 45 67.",
    typ: "tel",
    wert: c?.telefon ?? "",
    maxlength: 30,
    autocomplete: "off",
    inputmode: "tel",
  });
  const email = feld({
    label: "E-Mail",
    hilfe: "Freiwillig.",
    typ: "email",
    wert: c?.email ?? "",
    maxlength: 254,
    autocomplete: "off",
    spellcheck: "false",
  });
  const notiz = feld({
    label: "Notiz",
    hilfe: "Freiwillig. Keine Gesundheitsdaten.",
    wert: c?.notiz ?? "",
    mehrzeilig: true,
    maxlength: 2000,
  });
  const behalten = ankreuzen({
    label: "Behalten (nicht automatisch löschen)",
    gewaehlt: c?.behalten ?? false,
  });
  const werte = () => ({
    name: name.eingabe.value.trim(),
    funktion: leerZuNull(funktion.eingabe.value),
    gruppe: leerZuNull(gruppe.eingabe.value),
    telefon: telefonWert(),
    email: leerZuNull(email.eingabe.value),
    notiz: leerZuNull(notiz.eingabe.value),
    behalten: behalten.eingabe.checked,
  });
  const telefonWert = () => {
    const t = normalisiereTelefon(telefon.eingabe.value);
    return t.wert === "" ? null : t.wert;
  };
  let seite;
  const sende = async (version) => {
    const w = werte();
    if (!c) {
      // Beim Anlegen fallen leere Angaben weg
      const roh = Object.fromEntries(
        Object.entries(w).filter(([, wert]) => wert !== null),
      );
      return anfrage("POST", `${LB(k.lagerId)}/adressbuch`, roh);
    }
    const geaendert = Object.fromEntries(
      Object.entries(w).filter(([key, wert]) => (c[key] ?? null) !== wert),
    );
    if (Object.keys(geaendert).length === 0) return c;
    return anfrage("PATCH", `${LB(k.lagerId)}/adressbuch/${c.id}`, {
      version: version ?? c.version,
      ...geaendert,
    });
  };
  seite = dialogFormular({
    titel: c ? "Kontakt ändern" : "Kontakt hinzufügen",
    beschreibung: c ? c.name : "Eine Person oder Stelle ausserhalb des Lagers.",
    felder: [
      name.wurzel,
      funktion.wurzel,
      gruppe.wurzel,
      telefon.wurzel,
      email.wurzel,
      notiz.wurzel,
      behalten.wurzel,
    ],
    ok: c ? "Speichern" : "Hinzufügen",
    fehlertext: meldung,
    pruefe: () => {
      telefon.wurzel.querySelector(".feld-fehler")?.remove();
      const t = normalisiereTelefon(telefon.eingabe.value);
      if (t.gueltig) return false;
      telefon.wurzel.append(
        el(
          "p",
          { class: "feld-fehler", role: "alert" },
          "Die Nummer ist nicht gültig. Schreibe sie zum Beispiel so: 079 123 45 67.",
        ),
      );
      telefon.eingabe.focus();
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
      ctx.melde(c ? "Gespeichert." : `${werte().name} ist im Adressbuch.`);
      neu();
    },
  });
}

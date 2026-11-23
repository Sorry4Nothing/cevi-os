import { anfrage } from "./api.js";
import { auswahl, dialogFormular, el, feld, knopf } from "./dom.js";
import { skeletonVon } from "./lager-skeleton.js";
import { ADRESSE, feldFehler, haenge, meldung } from "./lager-gemeinsam.js";
import {
  aussenLink,
  druckKnopf,
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
  sichererLink,
  werkzeugzeile,
} from "./lager-m-hilfen.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";
import { sortierListe } from "./sortieren.js";
import { normalisiereTelefon } from "./telefon.js";
import { leerKarte } from "./zustaende.js";

// Notfall im Lager-Arbeitsbereich (#674): Notrufnummern, Adresse mit Kartenlink, Notfall-Kontakte (erfasste und die Sicherheitsverantwortlichen aus dem Ressort «si»), Notfall-Infos. Adresse: …/notfall. Lesen: notfall.lesen, Ändern: notfall.bearbeiten. Telefonnummern stehen nur hier und nie in Titel, Adresse oder Meldungen. Der Server liefert alles in einer Antwort: GET /notfall.
// Routen: GET /notfall, PUT /notfall/karte, POST/PATCH/DELETE /notfall/kontakte.

// Die festen Nummern der Schweiz (wie in der App, nicht aus der API)
const NOTRUF = [
  ["144", "Sanität"],
  ["1414", "Rega"],
];

// Reine Funktion (testbar): die Nummer für einen tel:-Link, nur Ziffern und ein führendes Plus
export const telefonLink = (nummer) =>
  `tel:${String(nummer ?? "").replace(/[^\d+]/g, "")}`;

export function zeige(bereich, ctx, lagerId, lager) {
  ctx.titel(
    "Notfall",
    "Nummern, Adresse und Anweisungen für den Ernstfall im Lager.",
  );
  ctx.lade(
    async () => {
      const [daten, mitglieder] = await Promise.all([
        anfrage("GET", lagerPfad(lagerId, "/notfall")),
        ladeMitglieder(lagerId),
      ]);
      return { ...daten, mitglieder };
    },
    (daten, neu) => haenge(bereich, zeichne(ctx, lagerId, lager, daten, neu)),
    { skeleton: skeletonVon({ inhalt: "flaechen", zeilen: 2 }) },
  );
}

function nummernKarte() {
  return el(
    "section",
    { class: "flaeche" },
    el("h2", {}, "Notruf"),
    el(
      "ul",
      { class: "lm-notruf" },
      NOTRUF.map(([nummer, name]) =>
        el(
          "li",
          {},
          el(
            "a",
            {
              class: "lm-notruf-nummer",
              href: telefonLink(nummer),
            },
            el("strong", {}, nummer),
            el("span", {}, name),
          ),
        ),
      ),
    ),
  );
}

function adressKarte(ctx, lagerId, lager, daten, neu, darf) {
  const a = daten.adresse;
  const zeilen = [a.adresse, a.ort].filter(Boolean);
  const link = sichererLink(a.kartenLink);
  const bearbeiten = () => {
    const f = feld({
      label: "Kartenlink",
      wert: a.kartenLink ?? "",
      maxlength: 2000,
      autocomplete: "off",
      hilfe:
        "Der Link zur Route, nur Adressen mit https. Leer lassen, um ihn zu entfernen. Der Server ruft den Link nie ab.",
    });
    dialogFormular({
      titel: "Kartenlink ändern",
      beschreibung: "Der Link steht im Notfall-Fenster der App und hier.",
      felder: [f.wurzel],
      ok: "Speichern",
      pruefe: () => {
        const wert = f.eingabe.value.trim();
        if (wert === "" || sichererLink(wert)) return false;
        feldFehler(
          f,
          "Das ist keine gültige Adresse. Sie muss mit https beginnen.",
        );
        return true;
      },
      senden: () =>
        anfrage("PUT", lagerPfad(lagerId, "/notfall/karte"), {
          kartenLink: f.eingabe.value.trim() || null,
        }),
      fehlertext: meldung,
      danach: () => {
        ctx.melde("Der Kartenlink ist gespeichert.");
        neu();
      },
    });
  };
  return el(
    "section",
    { class: "flaeche" },
    el(
      "div",
      { class: "lm-kartenkopf" },
      el("h2", {}, "Adresse und Route"),
      darf &&
        el(
          "span",
          { class: "lm-nicht-drucken" },
          knopf("Kartenlink ändern", {
            klein: true,
            symbol: "bearbeiten",
            onclick: bearbeiten,
          }),
        ),
    ),
    zeilen.length > 0
      ? el(
          "p",
          { class: "lm-adresse" },
          zeilen.flatMap((z, i) => (i === 0 ? [z] : [el("br"), z])),
        )
      : el("p", { class: "leise" }, "Für das Lager ist keine Adresse erfasst."),
    link
      ? el("p", {}, aussenLink("Route öffnen", link))
      : el(
          "p",
          { class: "leise" },
          "Es ist kein Kartenlink gespeichert.",
          darf
            ? " Hinterlege einen, damit die Route mit einem Klick offen ist."
            : "",
        ),
  );
}

function kontaktZeile(k, darf, handler) {
  const nummer = k.telefon
    ? el(
        "a",
        { class: "lm-nummer", href: telefonLink(k.telefon) },
        el("span", { class: "nur-leser" }, "Anrufen: "),
        k.telefon,
      )
    : el("span", { class: "leise" }, "Keine Nummer");
  return el(
    "div",
    { class: "lm-kontakt" },
    el("strong", { class: "lm-kontakt-funktion" }, k.funktion),
    el("span", { class: "lm-kontakt-name" }, k.name || "Ohne Namen"),
    nummer,
    k.quelle === "ressort" &&
      el("span", { class: "chip" }, "Aus dem Ressort Sicherheit"),
    darf &&
      k.quelle === "eintrag" &&
      el(
        "span",
        { class: "lm-zeilenknoepfe lm-nicht-drucken" },
        knopf("Bearbeiten", {
          klein: true,
          symbol: "bearbeiten",
          kontext: k.funktion,
          onclick: () => handler.bearbeiten(k),
        }),
        knopf("Löschen", {
          klein: true,
          art: "still",
          symbol: "papierkorb",
          kontext: k.funktion,
          onclick: (e) => handler.loesche(k, e),
        }),
      ),
  );
}

function kontakteKarte(ctx, lagerId, lager, daten, neu, darf) {
  const erfasst = daten.kontakte.filter((k) => k.quelle === "eintrag");
  const ressort = daten.kontakte.filter((k) => k.quelle === "ressort");
  const handler = {
    bearbeiten: (k) => bearbeiteKontakt(ctx, lagerId, daten, neu, k),
    loesche: (k, e) =>
      ctx.mitRueckgaengig({
        text: `Kontakt «${k.funktion}» gelöscht`,
        ansicht: ansichtVonKnopf(e),
        ausfuehren: () =>
          anfrage(
            "DELETE",
            lagerPfad(
              lagerId,
              `/notfall/kontakte/${k.id}?version=${k.version}`,
            ),
          ),
        fehlertext: (f) =>
          `Der Kontakt wurde nicht gelöscht. ${listenFehler(f)}`,
        danach: neu,
        beiFehler: (f) => istKonflikt(f) && neu(),
      }),
  };
  const ordne = async (ids) => {
    for (const a of neueReihenfolge(erfasst, ids)) {
      const k = erfasst.find((x) => x.id === a.id);
      const antwort = await anfrage(
        "PATCH",
        lagerPfad(lagerId, `/notfall/kontakte/${a.id}`),
        { version: a.version, reihenfolge: a.reihenfolge },
      );
      Object.assign(k, antwort);
    }
  };
  const liste =
    erfasst.length === 0
      ? null
      : darf
        ? sortierListe({
            beschriftung: "Notfall-Kontakte",
            eintraege: erfasst.map((k) => ({
              id: k.id,
              text: k.funktion,
              inhalt: kontaktZeile(k, darf, handler),
            })),
            beiNeu: (ids) => ordne(ids),
            mitRueckgaengig: mitFehlertext(ctx, neu),
            aktionstext: "Reihenfolge der Kontakte geändert",
          }).wurzel
        : el(
            "ul",
            { class: "lm-kontaktliste" },
            erfasst.map((k) => el("li", {}, kontaktZeile(k, false, handler))),
          );
  return el(
    "section",
    { class: "flaeche" },
    el(
      "div",
      { class: "lm-kartenkopf" },
      el("h2", {}, "Notfall-Kontakte"),
      darf &&
        el(
          "span",
          { class: "lm-nicht-drucken" },
          knopf("Kontakt hinzufügen", {
            klein: true,
            symbol: "plus",
            onclick: () => bearbeiteKontakt(ctx, lagerId, daten, neu, null),
          }),
        ),
    ),
    liste ??
      leerKarte(
        darf
          ? "Es gibt noch keinen erfassten Kontakt. Füge die Lagerleitung und die Sanität hinzu."
          : "Es gibt noch keinen erfassten Kontakt.",
      ),
    ressort.length > 0 &&
      el(
        "div",
        { class: "lm-ressortkontakte" },
        el("h3", {}, "Sicherheit im Lager"),
        el(
          "ul",
          { class: "lm-kontaktliste" },
          ressort.map((k) => el("li", {}, kontaktZeile(k, false, handler))),
        ),
        el(
          "p",
          { class: "hilfe lm-nicht-drucken" },
          "Diese Personen kommen aus dem Ressort «Sicherheit». Ändere sie dort.",
        ),
      ),
  );
}

function bearbeiteKontakt(ctx, lagerId, daten, neuLaden, k) {
  const neu = !k;
  const hatKonto = Boolean(k?.personId);
  const mitglieder = daten.mitglieder ?? [];
  const person = neu
    ? auswahl({
        label: "Person",
        optionen: [
          ["", "Andere Person (Name und Nummer eintragen)"],
          ...mitglieder,
        ],
        wert: "",
      })
    : null;
  const funktion = feld({
    label: "Funktion",
    wert: k?.funktion ?? "",
    maxlength: 100,
    required: true,
    autocomplete: "off",
    hilfe: "Zum Beispiel «Lagerleitung», «Sanität» oder «Arzt».",
  });
  const name = feld({
    label: "Name",
    wert: !neu && !hatKonto ? k.name : "",
    maxlength: 100,
    autocomplete: "off",
  });
  const telefon = feld({
    label: "Telefon",
    wert: k?.telefon ?? "",
    inputmode: "tel",
    autocomplete: "off",
    hilfe: "Mit Vorwahl, zum Beispiel 079 123 45 67.",
  });
  const zeigeName = () => {
    const andere = neu ? person.eingabe.value === "" : !hatKonto;
    name.wurzel.hidden = !andere;
    telefon.eingabe.required = andere;
    telefon.wurzel.querySelector(".hilfe").textContent = andere
      ? "Pflicht. Mit Vorwahl, zum Beispiel 079 123 45 67."
      : "Freiwillig. Ohne Eintrag gilt die Nummer aus dem Konto der Person.";
  };
  person?.eingabe.addEventListener("change", zeigeName);
  zeigeName();
  let version = k?.version;
  const meine = () => {
    const t = normalisiereTelefon(telefon.eingabe.value);
    return {
      funktion: funktion.eingabe.value.trim(),
      ...(!name.wurzel.hidden ? { name: name.eingabe.value.trim() } : {}),
      ...(t.wert ? { telefon: t.wert } : {}),
    };
  };
  let seite;
  const konflikt = konfliktBox({
    felder: { funktion: "Funktion", name: "Name", telefon: "Telefon" },
    meine,
    beiEigene: (aktuell) => {
      version = aktuell.version;
      seite.querySelector("form").requestSubmit();
    },
    beiServer: () => {
      seite.close();
      neuLaden();
    },
  });
  seite = dialogFormular({
    titel: neu ? "Kontakt hinzufügen" : "Kontakt bearbeiten",
    felder: [
      konflikt.wurzel,
      person?.wurzel,
      funktion.wurzel,
      name.wurzel,
      telefon.wurzel,
    ].filter(Boolean),
    ok: neu ? "Hinzufügen" : "Speichern",
    pruefe: () => {
      let fehlt = false;
      if (!name.wurzel.hidden && name.eingabe.value.trim() === "") {
        feldFehler(name, "Gib den Namen ein.", { fokus: !fehlt });
        fehlt = true;
      }
      const t = normalisiereTelefon(telefon.eingabe.value);
      if (telefon.eingabe.value.trim() !== "" && !t.gueltig) {
        feldFehler(
          telefon,
          "Die Nummer passt nicht. Schreibe sie mit Vorwahl.",
          {
            fokus: !fehlt,
          },
        );
        fehlt = true;
      } else if (!name.wurzel.hidden && t.wert === "") {
        feldFehler(telefon, "Eine Person ohne Konto braucht eine Nummer.", {
          fokus: !fehlt,
        });
        fehlt = true;
      }
      return fehlt;
    },
    senden: async () => {
      try {
        if (neu)
          await anfrage("POST", lagerPfad(lagerId, "/notfall/kontakte"), {
            ...meine(),
            ...(person.eingabe.value ? { personId: person.eingabe.value } : {}),
          });
        else
          await anfrage(
            "PATCH",
            lagerPfad(lagerId, `/notfall/kontakte/${k.id}`),
            { version, ...meine() },
          );
      } catch (f) {
        if (istKonflikt(f)) konflikt.zeige(f.daten);
        throw f;
      }
    },
    fehlertext: (f) => (istKonflikt(f) ? KONFLIKT_TEXT : meldung(f)),
    danach: () => {
      ctx.melde(
        neu ? "Der Kontakt ist angelegt." : "Der Kontakt ist gespeichert.",
      );
      neuLaden();
    },
  });
}

function infosKarte(lagerId, daten, darfInfos) {
  return el(
    "section",
    { class: "flaeche" },
    el(
      "div",
      { class: "lm-kartenkopf" },
      el("h2", {}, "Anweisungen für den Notfall"),
      darfInfos &&
        el(
          "a",
          {
            class: "lg-verweis lm-nicht-drucken",
            href: `${ADRESSE}/${lagerId}/infos`,
          },
          "Unter «Infos» bearbeiten",
        ),
    ),
    daten.infos.length === 0
      ? el(
          "p",
          { class: "leise" },
          "Es gibt noch keine Anweisung. Eine Info mit dem Merkmal «Im Notfall zeigen» erscheint hier.",
        )
      : daten.infos.map((i) =>
          el(
            "article",
            { class: "lm-notfallinfo" },
            el("h3", {}, i.titel),
            i.text && el("p", { class: "lm-text" }, i.text),
            i.links.length > 0 &&
              el(
                "ul",
                { class: "lm-linkliste" },
                i.links.map((l) => el("li", {}, aussenLink(l.titel, l.url))),
              ),
          ),
        ),
  );
}

function zeichne(ctx, lagerId, lager, daten, neu) {
  const darf = kannSchreiben(lager, "notfall.bearbeiten");
  return el(
    "div",
    { class: "lm-seite lm-notfall" },
    werkzeugzeile(druckKnopf("Notfallblatt drucken")),
    el(
      "p",
      { class: "hilfe lm-nicht-drucken" },
      "Hier stehen Telefonnummern. Gib das Blatt nur im Lager weiter und wirf es nach dem Lager weg.",
    ),
    nummernKarte(),
    adressKarte(ctx, lagerId, lager, daten, neu, darf),
    kontakteKarte(ctx, lagerId, lager, daten, neu, darf),
    infosKarte(lagerId, daten, kannLesen(lager, "infos.lesen")),
  );
}

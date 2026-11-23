import { anfrage } from "./api.js";
import { ankreuzen, dialogFormular, el, feld, knopf } from "./dom.js";
import { skeletonListe } from "./lader.js";
import { feldFehler, haenge, knopfMit, meldung } from "./lager-gemeinsam.js";
import {
  angabe,
  aussenLink,
  istKonflikt,
  kannLesen,
  kannSchreiben,
  konfliktBox,
  KONFLIKT_TEXT,
  lagerPfad,
  listenFehler,
  mitFehlertext,
  sichererLink,
  werkzeugzeile,
} from "./lager-m-hilfen.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";
import { sortierListe } from "./sortieren.js";
import { leerKarte } from "./zustaende.js";

// Infos im Lager-Arbeitsbereich (#674): Abschnitte mit Text, Links und verknüpften Dateien in einer Reihenfolge (Ziehen, Pfeilknöpfe). Adresse: …/infos. Lesen: infos.lesen, Ändern: infos.bearbeiten; das Merkmal «Im Notfall zeigen» setzt und ändert nur, wer auch notfall.bearbeiten hat (sonst 403). Abschnitte «Nur Lagerleitung» sieht nur, wer vertrauliches.lesen hat.
// Dateien sind Verknüpfungen auf das Dokumentenlager (nie ein Upload); ihre Auswahl gehört zum Modul «Dateien». Beim Ändern bleiben sie, wie sie sind.
// Routen: GET /infos, POST /infos, PUT /infos/reihenfolge, PATCH und DELETE /infos/{id}.

const LINKS_MAX = 20;

// Reine Funktion (testbar): die Links aus den Zeilen des Formulars; leere Zeilen fallen weg, eine Zeile mit nur einem Teil oder ohne https-Adresse ist ein Fehler [{ index, feld, text }]
export function pruefeLinks(zeilen) {
  const links = [];
  const fehler = [];
  zeilen.forEach((z, index) => {
    const titel = z.titel.trim();
    const url = z.url.trim();
    if (titel === "" && url === "") return;
    if (titel === "")
      return fehler.push({
        index,
        feld: "titel",
        text: "Gib dem Link einen Titel.",
      });
    if (url === "")
      return fehler.push({
        index,
        feld: "url",
        text: "Gib die Adresse des Links ein.",
      });
    if (!sichererLink(url))
      return fehler.push({
        index,
        feld: "url",
        text: "Die Adresse ist ungültig. Sie muss mit https beginnen.",
      });
    links.push({ titel, url });
  });
  return { links, fehler };
}

// Reine Funktion (testbar): die ersten Zeichen des Textes für die Zeile, ohne Zeilenumbrüche
export function auszug(text, laenge = 110) {
  const flach = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return flach.length <= laenge ? flach : `${flach.slice(0, laenge - 1)}…`;
}

export function zeige(bereich, ctx, lagerId, lager) {
  ctx.titel(
    "Infos",
    "Alles, was im Lager gewusst werden muss: Regeln, Abläufe, Adressen, Links.",
  );
  ctx.lade(
    () => anfrage("GET", lagerPfad(lagerId, "/infos?limit=200")),
    (daten, neu) => haenge(bereich, zeichne(ctx, lagerId, lager, daten, neu)),
    { skeleton: () => skeletonListe({ zeilen: 5 }) },
  );
}

function zeichne(ctx, lagerId, lager, daten, neu) {
  const darf = kannSchreiben(lager, "infos.bearbeiten");
  const darfNotfall = kannSchreiben(lager, "notfall.bearbeiten");
  const abschnitte = daten.abschnitte.map((a) => ({ ...a }));
  // Ein Abschnitt mit dem Merkmal «Notfall» ändert nur, wer auch notfall.bearbeiten hat
  const aenderbar = (a) => darf && (!a.notfall || darfNotfall);

  const eintrag = (a) => {
    const chips = el(
      "span",
      { class: "lm-chips" },
      a.nurLagerleitung && el("span", { class: "chip" }, "Nur Lagerleitung"),
      a.notfall &&
        el("span", { class: "chip chip--warn" }, "Im Notfall zeigen"),
      a.links.length > 0 &&
        el(
          "span",
          { class: "chip" },
          `${a.links.length} ${a.links.length === 1 ? "Link" : "Links"}`,
        ),
      a.dateien.length > 0 &&
        el(
          "span",
          { class: "chip" },
          `${a.dateien.length} ${a.dateien.length === 1 ? "Datei" : "Dateien"}`,
        ),
    );
    const detail = el(
      "details",
      { class: "lm-info" },
      el(
        "summary",
        {},
        el("strong", { class: "lm-info-titel" }, a.titel),
        a.text && el("span", { class: "lm-info-auszug leise" }, auszug(a.text)),
      ),
      el(
        "div",
        { class: "lm-info-inhalt" },
        a.text
          ? el("p", { class: "lm-text" }, a.text)
          : el("p", { class: "leise" }, "Dieser Abschnitt hat keinen Text."),
        a.links.length > 0 &&
          el(
            "div",
            {},
            el("h3", {}, "Links"),
            el(
              "ul",
              { class: "lm-linkliste" },
              a.links.map((l) => el("li", {}, aussenLink(l.titel, l.url))),
            ),
          ),
        a.dateien.length > 0 &&
          el(
            "div",
            {},
            el("h3", {}, "Dateien"),
            el(
              "ul",
              { class: "lm-linkliste" },
              a.dateien.map((d) =>
                el("li", {}, aussenLink(d.anzeigename, d.link)),
              ),
            ),
          ),
      ),
    );
    return el(
      "div",
      { class: "lm-inforeihe" },
      el("div", { class: "lm-infokern" }, detail, chips),
      darf &&
        el(
          "span",
          { class: "lm-zeilenknoepfe lm-nicht-drucken" },
          aenderbar(a)
            ? [
                knopf("Bearbeiten", {
                  klein: true,
                  symbol: "bearbeiten",
                  kontext: a.titel,
                  onclick: () => bearbeiten(a),
                }),
                knopf("Löschen", {
                  klein: true,
                  art: "still",
                  symbol: "papierkorb",
                  kontext: a.titel,
                  onclick: (e) => loesche(a, e),
                }),
              ]
            : el(
                "span",
                { class: "klein leise" },
                "Ändern nur mit dem Recht auf den Notfall",
              ),
        ),
    );
  };

  function loesche(a, ereignis) {
    ctx.mitRueckgaengig({
      text: `«${a.titel}» gelöscht`,
      ansicht: ansichtVonKnopf(ereignis),
      ausfuehren: () =>
        anfrage(
          "DELETE",
          lagerPfad(lagerId, `/infos/${a.id}?version=${a.version}`),
        ),
      fehlertext: (f) => `Die Info wurde nicht gelöscht. ${listenFehler(f)}`,
      danach: neu,
      beiFehler: (f) => istKonflikt(f) && neu(),
    });
  }

  function bearbeiten(a) {
    const neuAnlegen = !a;
    const titel = feld({
      label: "Titel",
      wert: a?.titel ?? "",
      maxlength: 200,
      required: true,
      autocomplete: "off",
    });
    const text = feld({
      label: "Text",
      wert: a?.text ?? "",
      mehrzeilig: true,
      rows: 10,
      maxlength: 20000,
      hilfe: "Freiwillig. Zeilenumbrüche bleiben erhalten.",
    });
    const nur = ankreuzen({
      label: "Nur für die Lagerleitung sichtbar",
      gewaehlt: a?.nurLagerleitung ?? false,
      wert: "nur",
    });
    const notfall = darfNotfall
      ? ankreuzen({
          label: "Im Notfall-Fenster zeigen",
          gewaehlt: a?.notfall ?? false,
          wert: "notfall",
        })
      : null;

    // Links: je Zeile Titel und Adresse
    const zeilen = [];
    const linkListe = el("div", { class: "lm-linkzeilen" });
    const baueZeile = (l = { titel: "", url: "" }) => {
      const t = feld({
        label: "Titel des Links",
        wert: l.titel,
        maxlength: 200,
        autocomplete: "off",
      });
      const u = feld({
        label: "Adresse",
        wert: l.url,
        maxlength: 2000,
        autocomplete: "off",
        inputmode: "url",
      });
      const z = { t, u };
      const weg = knopf("Entfernen", {
        klein: true,
        art: "still",
        symbol: "papierkorb",
        onclick: () => {
          zeilen.splice(zeilen.indexOf(z), 1);
          z.wurzel.remove();
          zaehle();
        },
      });
      z.wurzel = el("div", { class: "lm-linkzeile" }, t.wurzel, u.wurzel, weg);
      zeilen.push(z);
      linkListe.append(z.wurzel);
      zaehle();
      return z;
    };
    const mehr = knopf("Link hinzufügen", {
      klein: true,
      symbol: "plus",
      onclick: () => baueZeile().t.eingabe.focus(),
    });
    const zaehle = () => {
      mehr.disabled = zeilen.length >= LINKS_MAX;
    };
    (a?.links ?? []).forEach((l) => baueZeile(l));

    const werte = () => {
      const { links } = pruefeLinks(
        zeilen.map((z) => ({
          titel: z.t.eingabe.value,
          url: z.u.eingabe.value,
        })),
      );
      return {
        titel: titel.eingabe.value.trim(),
        text: text.eingabe.value.trim() || null,
        links,
        nurLagerleitung: nur.eingabe.checked,
        ...(notfall ? { notfall: notfall.eingabe.checked } : {}),
      };
    };
    let version = a?.version;
    let seite;
    const konflikt = konfliktBox({
      felder: {
        titel: "Titel",
        text: "Text",
        links: "Links",
        nurLagerleitung: "Nur Lagerleitung",
        notfall: "Im Notfall zeigen",
      },
      meine: werte,
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
      titel: neuAnlegen ? "Info hinzufügen" : "Info bearbeiten",
      felder: [
        konflikt.wurzel,
        titel.wurzel,
        text.wurzel,
        el(
          "fieldset",
          {},
          el("legend", {}, "Links"),
          linkListe,
          mehr,
          el(
            "p",
            { class: "hilfe" },
            "Nur Adressen mit https. Der Server ruft sie nie ab.",
          ),
        ),
        a?.dateien.length > 0 &&
          el(
            "dl",
            { class: "lm-angaben" },
            angabe(
              "Verknüpfte Dateien",
              `${a.dateien.map((d) => d.anzeigename).join(", ")}. Sie bleiben, wie sie sind.`,
            ),
          ),
        nur.wurzel,
        notfall?.wurzel,
      ].filter(Boolean),
      ok: neuAnlegen ? "Hinzufügen" : "Speichern",
      pruefe: () => {
        const { fehler } = pruefeLinks(
          zeilen.map((z) => ({
            titel: z.t.eingabe.value,
            url: z.u.eingabe.value,
          })),
        );
        fehler.forEach((f, i) =>
          feldFehler(zeilen[f.index][f.feld === "titel" ? "t" : "u"], f.text, {
            fokus: i === 0,
          }),
        );
        return fehler.length > 0;
      },
      senden: async () => {
        try {
          if (neuAnlegen)
            await anfrage("POST", lagerPfad(lagerId, "/infos"), werte());
          else
            await anfrage("PATCH", lagerPfad(lagerId, `/infos/${a.id}`), {
              version,
              ...werte(),
            });
        } catch (f) {
          if (istKonflikt(f)) konflikt.zeige(f.daten);
          throw f;
        }
      },
      fehlertext: (f) => (istKonflikt(f) ? KONFLIKT_TEXT : meldung(f)),
      danach: () => {
        ctx.melde(
          neuAnlegen ? "Die Info ist angelegt." : "Die Info ist gespeichert.",
        );
        neu();
      },
    });
  }

  // Die neue Reihenfolge geht in einem Aufruf hinaus; danach holt die Seite die neuen Versionen, ohne die Liste neu zu zeichnen (der Fokus am Griff bleibt)
  const ordne = async (ids) => {
    const nachId = new Map(abschnitte.map((a) => [a.id, a]));
    await anfrage("PUT", lagerPfad(lagerId, "/infos/reihenfolge"), {
      eintraege: ids.map((id) => ({ id, version: nachId.get(id).version })),
    });
    const frisch = await anfrage("GET", lagerPfad(lagerId, "/infos?limit=200"));
    for (const f of frisch.abschnitte)
      Object.assign(nachId.get(f.id) ?? {}, {
        version: f.version,
        reihenfolge: f.reihenfolge,
      });
  };

  const liste =
    abschnitte.length === 0
      ? null
      : darf
        ? sortierListe({
            beschriftung: "Infos",
            eintraege: abschnitte.map((a) => ({
              id: a.id,
              text: a.titel,
              inhalt: eintrag(a),
            })),
            beiNeu: ordne,
            mitRueckgaengig: mitFehlertext(ctx, neu),
            aktionstext: "Reihenfolge der Infos geändert",
          }).wurzel
        : el(
            "ul",
            { class: "lm-infoliste" },
            abschnitte.map((a) => el("li", {}, eintrag(a))),
          );

  const alleOeffnen = (offen) =>
    liste?.querySelectorAll("details").forEach((d) => (d.open = offen));

  return el(
    "div",
    { class: "lm-seite" },
    werkzeugzeile(
      darf &&
        knopf("Info hinzufügen", {
          art: "haupt",
          symbol: "plus",
          onclick: () => bearbeiten(null),
        }),
      abschnitte.length > 0 &&
        knopf("Alle öffnen", {
          symbol: "runter",
          onclick: () => alleOeffnen(true),
        }),
      abschnitte.length > 0 &&
        knopf("Alle schliessen", {
          symbol: "hoch",
          onclick: () => alleOeffnen(false),
        }),
      abschnitte.length > 0 &&
        knopfMit("Drucken", {
          symbol: "drucker",
          // Zugeklappte Abschnitte kämen nicht aufs Blatt
          onclick: () => {
            alleOeffnen(true);
            window.print();
          },
        }),
    ),
    liste
      ? el("section", { class: "flaeche" }, liste)
      : leerKarte(
          darf
            ? "Es gibt noch keine Infos. Lege die erste an, zum Beispiel die Hausordnung."
            : kannLesen(lager, "infos.lesen")
              ? "Es gibt noch keine Infos."
              : "Du darfst die Infos nicht lesen.",
        ),
  );
}

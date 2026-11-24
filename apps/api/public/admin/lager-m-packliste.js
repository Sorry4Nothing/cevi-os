import { anfrage } from "./api.js";
import { ankreuzen, auswahl, dialogFormular, el, feld, knopf } from "./dom.js";
import { fuelle } from "./lager-bewegung.js";
import { skeletonVon } from "./lager-skeleton.js";
import { ADRESSE, haenge, meldung } from "./lager-gemeinsam.js";
import {
  anteilText,
  druckKnopf,
  istKonflikt,
  kannLesen,
  kannSchreiben,
  konfliktBox,
  KONFLIKT_TEXT,
  kopiere,
  lagerPfad,
  listenFehler,
  mitFehlertext,
  neueReihenfolge,
  werkzeugzeile,
} from "./lager-m-hilfen.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";
import { zeileZuEintrag } from "./lager-vorlagen.js";
import { sortierListe } from "./sortieren.js";
import { leerKarte } from "./zustaende.js";

// Packliste im Lager-Arbeitsbereich (#674). Zwei Ansichten unter einer Adresse: «Meine Packliste» (die eigene Kopie: abhaken, Punkte der Vorlage entfernen und zurückholen, eigene Punkte, packliste.abhaken) und «Vorlage» (die Punkte des Lagers anlegen, ändern, ordnen und löschen, packliste.bearbeiten). Adressen: …/packliste und …/packliste/vorlage. Die Kopie ist persönlich: Der Server liefert jeder Person nur ihre eigene Liste.
// Routen: GET /packliste, POST/PATCH/DELETE /packliste/punkte, PUT /packliste/punkte/{id}/zustand, POST/PATCH/DELETE /packliste/eigene. Die Reihenfolge der Vorlage geht über «reihenfolge» je Punkt (es gibt keine Sammel-Route).

const EIGENE = "Eigene Punkte";

// Reine Funktion (testbar): Abschnitte in der Reihenfolge, in der sie zuerst vorkommen; eigene Punkte gehören zum Abschnitt gleichen Namens oder stehen in einem neuen am Ende
export function gruppiere(punkte, eigene = []) {
  const abschnitte = new Map();
  const hole = (name) => {
    if (!abschnitte.has(name)) abschnitte.set(name, []);
    return abschnitte.get(name);
  };
  for (const p of [...punkte].sort(nachReihenfolge)) {
    hole(p.abschnitt).push({ ...p, art: "punkt" });
  }
  for (const e of [...eigene].sort(nachReihenfolge)) {
    hole(e.abschnitt).push({ ...e, art: "eigen" });
  }
  return [...abschnitte].map(([name, zeilen]) => ({ name, zeilen }));
}
const nachReihenfolge = (a, b) =>
  a.reihenfolge - b.reihenfolge || String(a.id).localeCompare(String(b.id));

// Reine Funktion (testbar): «5 von 9 gepackt» ohne entfernte Punkte
export function zaehle(punkte, eigene = []) {
  const aktiv = punkte.filter((p) => p.zustand !== "entfernt");
  const gepackt =
    aktiv.filter((p) => p.zustand === "abgehakt").length +
    eigene.filter((e) => e.abgehakt).length;
  return { gepackt, gesamt: aktiv.length + eigene.length };
}

// Reine Funktion (testbar): Text zum Kopieren, offene Punkte je Abschnitt
export function alsText(punkte, eigene = []) {
  const offen = (z) =>
    z.art === "punkt" ? z.zustand === "offen" : !z.abgehakt;
  return gruppiere(
    punkte.filter((p) => p.zustand !== "entfernt"),
    eigene,
  )
    .map((a) => ({ name: a.name, zeilen: a.zeilen.filter(offen) }))
    .filter((a) => a.zeilen.length > 0)
    .map((a) => [a.name, ...a.zeilen.map((z) => `- ${z.text}`)].join("\n"))
    .join("\n\n");
}

export function zeige(bereich, ctx, lagerId, lager) {
  const ansicht = ctx.weiter?.[0] === "vorlage" ? "vorlage" : "meine";
  const darfVorlage = kannLesen(lager, "packliste.bearbeiten");
  ctx.titel(
    "Packliste",
    "Was ins Lager mitkommt: die Vorlage des Lagers und deine eigene Liste.",
  );
  if (ansicht === "vorlage" && !darfVorlage) {
    location.replace(`${ADRESSE}/${lagerId}/packliste`);
    return;
  }
  ctx.lade(
    () => anfrage("GET", lagerPfad(lagerId, "/packliste")),
    (daten, neu) => {
      haenge(
        bereich,
        umschalter(lagerId, ansicht, darfVorlage),
        ansicht === "vorlage"
          ? vorlage(ctx, lagerId, lager, daten, neu)
          : meine(ctx, lagerId, lager, daten),
      );
    },
    { skeleton: skeletonVon({ reiter: 2, inhalt: "flaechen", zeilen: 3 }) },
  );
}

// «Meine Packliste» und «Vorlage» als Links mit der aktuellen Seite markiert (ein Wechsel ist ein Verlaufseintrag)
function umschalter(lagerId, ansicht, darfVorlage) {
  if (!darfVorlage) return null;
  const eintrag = (art, text, href) =>
    el(
      "a",
      {
        class: "lm-reiter",
        href,
        "aria-current": ansicht === art ? "page" : undefined,
      },
      text,
    );
  return el(
    "nav",
    { class: "lm-reiter-leiste lm-nicht-drucken", "aria-label": "Packliste" },
    eintrag("meine", "Meine Packliste", `${ADRESSE}/${lagerId}/packliste`),
    eintrag("vorlage", "Vorlage", `${ADRESSE}/${lagerId}/packliste/vorlage`),
  );
}

// ---- Meine Packliste ------------------------------------------------------

function meine(ctx, lagerId, lager, daten) {
  const punkte = daten.punkte.map((p) => ({ ...p }));
  const eigene = daten.eigene.map((e) => ({ ...e }));
  const darfAbhaken = kannSchreiben(lager, "packliste.abhaken");
  const wurzel = el("div", { class: "lm-seite" });
  const stand = el("p", { class: "lm-fortschritt-text", role: "status" });
  const balken = el("progress", {
    class: "lm-fortschritt",
    max: 100,
    "aria-hidden": "true",
  });
  const sektionen = el("div", { class: "lm-sektionen" });
  const entfernte = el("div", { class: "lm-nicht-drucken" });
  const zaehler = () => {
    const { gepackt, gesamt } = zaehle(punkte, eigene);
    stand.textContent =
      gesamt === 0
        ? "Die Packliste ist leer."
        : `${gepackt} von ${gesamt} gepackt`;
    balken.hidden = gesamt === 0;
    fuelle(balken, gesamt === 0 ? 0 : Math.round((gepackt / gesamt) * 100));
  };

  const sende = async (aufruf, zurueck) => {
    try {
      await aufruf();
    } catch (f) {
      zurueck();
      ctx.melde(listenFehler(f), "fehler");
    }
  };

  function zeile(z) {
    const abgehakt = z.art === "punkt" ? z.zustand === "abgehakt" : z.abgehakt;
    const k = ankreuzen({ label: z.text, gewaehlt: abgehakt, wert: z.id });
    k.eingabe.disabled = !darfAbhaken;
    k.eingabe.addEventListener("change", () => {
      const jetzt = k.eingabe.checked;
      const setze = (w) => {
        if (z.art === "punkt") z.zustand = w ? "abgehakt" : "offen";
        else z.abgehakt = w;
        k.eingabe.checked = w;
        li.classList.toggle("lm-erledigt", w);
        zaehler();
        zeichneAbschnittsZahlen();
      };
      const vorher = !jetzt;
      setze(jetzt);
      sende(
        () =>
          z.art === "punkt"
            ? anfrage(
                "PUT",
                lagerPfad(lagerId, `/packliste/punkte/${z.id}/zustand`),
                { zustand: jetzt ? "abgehakt" : "offen" },
              )
            : anfrage(
                "PATCH",
                lagerPfad(lagerId, `/packliste/eigene/${z.id}`),
                {
                  abgehakt: jetzt,
                },
              ),
        () => setze(vorher),
      );
    });
    const weg = darfAbhaken
      ? el(
          "span",
          { class: "lm-nicht-drucken" },
          knopf("Entfernen", {
            klein: true,
            art: "still",
            symbol: "papierkorb",
            kontext: z.text,
            onclick: () => entferne(z),
          }),
        )
      : null;
    const li = el(
      "li",
      { class: `lm-zeile${abgehakt ? " lm-erledigt" : ""}` },
      k.wurzel,
      el(
        "span",
        { class: "lm-chips" },
        z.nurLagerleitung && el("span", { class: "chip" }, "Nur Lagerleitung"),
        z.art === "eigen" && el("span", { class: "chip" }, "Eigener Punkt"),
      ),
      weg,
    );
    return li;
  }

  function entferne(z) {
    if (z.art === "punkt") {
      const vorher = z.zustand;
      ctx.mitRueckgaengig({
        text: `«${z.text}» aus deiner Liste genommen`,
        ansicht: {
          weg: () => {
            z.zustand = "entfernt";
            zeichne();
          },
          zurueck: () => {
            z.zustand = vorher;
            zeichne();
          },
        },
        ausfuehren: () =>
          anfrage(
            "PUT",
            lagerPfad(lagerId, `/packliste/punkte/${z.id}/zustand`),
            { zustand: "entfernt" },
          ),
        fehlertext: (f) => `Der Punkt blieb in deiner Liste. ${meldung(f)}`,
      });
    } else {
      const index = eigene.findIndex((e) => e.id === z.id);
      ctx.mitRueckgaengig({
        text: `«${z.text}» gelöscht`,
        ansicht: {
          weg: () => {
            eigene.splice(
              eigene.findIndex((e) => e.id === z.id),
              1,
            );
            zeichne();
          },
          zurueck: () => {
            eigene.splice(index, 0, { ...z });
            zeichne();
          },
        },
        ausfuehren: () =>
          anfrage("DELETE", lagerPfad(lagerId, `/packliste/eigene/${z.id}`)),
        fehlertext: (f) => `Der Punkt wurde nicht gelöscht. ${meldung(f)}`,
      });
    }
  }

  const abschnittsZahlen = new Map();
  function zeichneAbschnittsZahlen() {
    for (const [name, { zahl, a }] of abschnittsZahlen) {
      const g = a.zeilen.filter((z) =>
        z.art === "punkt"
          ? punkte.find((p) => p.id === z.id)?.zustand === "abgehakt"
          : eigene.find((e) => e.id === z.id)?.abgehakt,
      ).length;
      zahl.textContent = anteilText(g, a.zeilen.length);
      abschnittsZahlen.get(name).zahl = zahl;
    }
  }

  function zeichne() {
    abschnittsZahlen.clear();
    const aktiv = gruppiere(
      punkte.filter((p) => p.zustand !== "entfernt"),
      eigene,
    );
    sektionen.replaceChildren(
      ...aktiv.map((a) => {
        const zahl = el("span", { class: "klein leise lm-zahlen" });
        abschnittsZahlen.set(a.name, { zahl, a });
        return el(
          "section",
          { class: "flaeche lm-abschnitt", "aria-label": a.name },
          el("div", { class: "lm-kartenkopf" }, el("h2", {}, a.name), zahl),
          el("ul", { class: "lm-liste" }, a.zeilen.map(zeile)),
        );
      }),
    );
    if (aktiv.length === 0) {
      sektionen.append(
        leerKarte(
          kannLesen(lager, "packliste.bearbeiten")
            ? "Die Packliste ist noch leer. Lege in der Vorlage die Punkte an, die alle mitnehmen."
            : "Die Packliste ist noch leer.",
        ),
      );
    }
    zeichneAbschnittsZahlen();
    zeichneEntfernte();
    zaehler();
  }

  function zeichneEntfernte() {
    const liste = punkte.filter((p) => p.zustand === "entfernt");
    entfernte.replaceChildren();
    if (liste.length === 0) return;
    entfernte.append(
      el(
        "details",
        { class: "flaeche lm-entfernte" },
        el("summary", {}, `Aus deiner Liste genommen (${liste.length})`),
        el(
          "ul",
          { class: "lm-liste" },
          liste.map((p) =>
            el(
              "li",
              { class: "lm-zeile" },
              el("span", {}, `${p.abschnitt}: ${p.text}`),
              darfAbhaken &&
                knopf("Zurückholen", {
                  klein: true,
                  symbol: "aktualisieren",
                  kontext: p.text,
                  onclick: () => {
                    p.zustand = "offen";
                    zeichne();
                    sende(
                      () =>
                        anfrage(
                          "PUT",
                          lagerPfad(
                            lagerId,
                            `/packliste/punkte/${p.id}/zustand`,
                          ),
                          { zustand: "offen" },
                        ),
                      () => {
                        p.zustand = "entfernt";
                        zeichne();
                      },
                    );
                  },
                }),
            ),
          ),
        ),
      ),
    );
  }

  // Eigener Punkt hinzufügen
  const abschnittNamen = () => {
    const namen = gruppiere(punkte, eigene).map((a) => a.name);
    return namen.includes(EIGENE) ? namen : [...namen, EIGENE];
  };
  const textEingabe = feld({
    label: "Neuer eigener Punkt",
    maxlength: 300,
    autocomplete: "off",
  });
  const wahlAbschnitt = auswahl({
    label: "Abschnitt",
    optionen: abschnittNamen().map((n) => [n, n]),
    wert: EIGENE,
  });
  const fehler = el("p", {
    class: "feld-fehler",
    role: "alert",
    hidden: true,
  });
  const hinzufuegen = async () => {
    const text = textEingabe.eingabe.value.trim();
    fehler.hidden = true;
    if (text === "") {
      fehler.textContent = "Schreibe, was du einpacken willst.";
      fehler.hidden = false;
      textEingabe.eingabe.focus();
      return;
    }
    try {
      const neu = await anfrage(
        "POST",
        lagerPfad(lagerId, "/packliste/eigene"),
        {
          abschnitt: wahlAbschnitt.eingabe.value || EIGENE,
          text,
        },
      );
      eigene.push({ ...neu });
      textEingabe.eingabe.value = "";
      zeichne();
      ctx.melde(`«${text}» ist in deiner Liste.`);
      textEingabe.eingabe.focus();
    } catch (f) {
      ctx.melde(meldung(f), "fehler");
    }
  };
  textEingabe.eingabe.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      hinzufuegen();
    }
  });

  zeichne();
  haenge(
    wurzel,
    el(
      "section",
      { class: "flaeche lm-kopfkarte" },
      stand,
      balken,
      !darfAbhaken &&
        el(
          "p",
          { class: "hilfe" },
          lager.schreibgeschuetzt
            ? "Das Lager ist schreibgeschützt."
            : "Mit deiner Rolle kannst du die Liste lesen, aber nicht abhaken.",
        ),
    ),
    werkzeugzeile(
      druckKnopf("Drucken", "Packliste"),
      knopf("Als Text kopieren", {
        symbol: "kopieren",
        onclick: () =>
          kopiere(alsText(punkte, eigene), ctx, "Die Liste der offenen Punkte"),
      }),
    ),
    sektionen,
    entfernte,
    darfAbhaken &&
      el(
        "section",
        { class: "flaeche lm-nicht-drucken" },
        el("h2", {}, "Eigenen Punkt hinzufügen"),
        el(
          "div",
          { class: "lm-neuzeile" },
          textEingabe.wurzel,
          wahlAbschnitt.wurzel,
          knopf("Hinzufügen", {
            art: "haupt",
            symbol: "plus",
            onclick: hinzufuegen,
          }),
        ),
        fehler,
        el(
          "p",
          { class: "hilfe" },
          "Nur du siehst deine eigenen Punkte, auch die Lagerleitung nicht.",
        ),
      ),
  );
  return wurzel;
}

// ---- Vorlage --------------------------------------------------------------

function vorlage(ctx, lagerId, lager, daten, neuLaden) {
  const darf = kannSchreiben(lager, "packliste.bearbeiten");
  const punkte = daten.punkte.map((p) => ({ ...p }));
  const wurzel = el("div", { class: "lm-seite" });
  const abschnitte = gruppiere(punkte);

  const bearbeiten = (p, abschnittVorgabe) => {
    const neu = !p;
    const abschnitt = feld({
      label: "Abschnitt",
      wert: p?.abschnitt ?? abschnittVorgabe ?? "",
      maxlength: 100,
      required: true,
      autocomplete: "off",
      hilfe: "Zum Beispiel «Schlafen» oder «Kleidung».",
    });
    const text = feld({
      label: "Punkt",
      wert: p?.text ?? "",
      maxlength: 300,
      required: true,
      autocomplete: "off",
    });
    const vertraulich = ankreuzen({
      label: "Nur für die Lagerleitung sichtbar",
      gewaehlt: p?.nurLagerleitung ?? false,
      wert: "nur",
    });
    let version = p?.version;
    const meine = () => ({
      abschnitt: abschnitt.eingabe.value.trim(),
      text: text.eingabe.value.trim(),
      nurLagerleitung: vertraulich.eingabe.checked,
    });
    let seite;
    const konflikt = konfliktBox({
      felder: {
        abschnitt: "Abschnitt",
        text: "Punkt",
        nurLagerleitung: "Nur Lagerleitung",
      },
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
      titel: neu ? "Punkt hinzufügen" : "Punkt bearbeiten",
      beschreibung: neu
        ? "Der Punkt erscheint in der Packliste jeder Person."
        : undefined,
      felder: [
        konflikt.wurzel,
        abschnitt.wurzel,
        text.wurzel,
        vertraulich.wurzel,
      ],
      ok: neu ? "Hinzufügen" : "Speichern",
      senden: async () => {
        try {
          if (neu)
            await anfrage(
              "POST",
              lagerPfad(lagerId, "/packliste/punkte"),
              meine(),
            );
          else
            await anfrage(
              "PATCH",
              lagerPfad(lagerId, `/packliste/punkte/${p.id}`),
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
          neu ? "Der Punkt ist angelegt." : "Der Punkt ist gespeichert.",
        );
        neuLaden();
      },
    });
  };

  const loesche = (p, ereignis) => {
    ctx.mitRueckgaengig({
      text: `«${p.text}» gelöscht`,
      ansicht: ansichtVonKnopf(ereignis),
      ausfuehren: () =>
        anfrage(
          "DELETE",
          lagerPfad(lagerId, `/packliste/punkte/${p.id}?version=${p.version}`),
        ),
      fehlertext: (f) => `Der Punkt wurde nicht gelöscht. ${listenFehler(f)}`,
      danach: neuLaden,
      beiFehler: (f) => istKonflikt(f) && neuLaden(),
    });
  };

  const ordne = async (abschnitt, ids) => {
    const aenderungen = neueReihenfolge(abschnitt.zeilen, ids);
    for (const a of aenderungen) {
      const neu = await anfrage(
        "PATCH",
        lagerPfad(lagerId, `/packliste/punkte/${a.id}`),
        { version: a.version, reihenfolge: a.reihenfolge },
      );
      // Die neue Version bleibt im Speicher: Die nächste Änderung braucht sie, und die Liste muss nicht neu laden
      Object.assign(
        abschnitt.zeilen.find((p) => p.id === a.id),
        neu,
      );
    }
  };

  const sektionen = abschnitte.map((a) => {
    const zeile = (p) =>
      el(
        "div",
        { class: "lm-vorlagenzeile", "data-id": p.id },
        el("span", { class: "lm-vorlagentext" }, p.text),
        p.nurLagerleitung && el("span", { class: "chip" }, "Nur Lagerleitung"),
        darf &&
          el(
            "span",
            { class: "lm-zeilenknoepfe" },
            knopf("Bearbeiten", {
              klein: true,
              symbol: "bearbeiten",
              kontext: p.text,
              onclick: () => bearbeiten(p),
            }),
            knopf("Löschen", {
              klein: true,
              art: "still",
              symbol: "papierkorb",
              kontext: p.text,
              onclick: (e) => loesche(p, e),
            }),
          ),
      );
    const liste = !darf
      ? {
          wurzel: el(
            "ul",
            { class: "lm-infoliste" },
            a.zeilen.map((p) => el("li", {}, zeile(p))),
          ),
        }
      : sortierListe({
          beschriftung: `Punkte im Abschnitt ${a.name}`,
          eintraege: a.zeilen.map((p) => ({
            id: p.id,
            text: p.text,
            inhalt: zeile(p),
          })),
          beiNeu: (ids) => ordne(a, ids),
          mitRueckgaengig: darf ? mitFehlertext(ctx, neuLaden) : undefined,
          aktionstext: `Reihenfolge im Abschnitt ${a.name} geändert`,
        });
    return el(
      "section",
      { class: "flaeche lm-abschnitt", "aria-label": a.name },
      el(
        "div",
        { class: "lm-kartenkopf" },
        el("h2", {}, a.name),
        darf &&
          knopf("Punkt hinzufügen", {
            klein: true,
            symbol: "plus",
            kontext: a.name,
            onclick: () => bearbeiten(null, a.name),
          }),
      ),
      liste.wurzel,
    );
  });

  const einfuegen = () => {
    const f = feld({
      label: "Liste",
      mehrzeilig: true,
      rows: 10,
      hilfe:
        "Eine Zeile je Punkt. Mit Doppelpunkt legst du den Abschnitt fest, zum Beispiel «Schlafen: Schlafsack». Ohne Doppelpunkt kommt der Punkt in «Allgemein».",
    });
    dialogFormular({
      titel: "Liste einfügen",
      beschreibung: "Füge mehrere Punkte auf einmal ein.",
      felder: [f.wurzel],
      ok: "Einfügen",
      senden: async () => {
        const eintraege = f.eingabe.value
          .split(/\r?\n/)
          .map((z) => zeileZuEintrag("packliste", z))
          .filter(Boolean);
        if (eintraege.length === 0) {
          const fehler = new Error("Schreibe mindestens einen Punkt.");
          throw fehler;
        }
        let n = 0;
        try {
          for (const e of eintraege) {
            await anfrage("POST", lagerPfad(lagerId, "/packliste/punkte"), e);
            n++;
          }
        } catch (fehler) {
          if (n > 0) neuLaden();
          fehler.teil = n;
          throw fehler;
        }
        return n;
      },
      fehlertext: (fehler) =>
        fehler?.teil
          ? `${fehler.teil} Punkte sind angelegt, dann ging es nicht weiter. ${meldung(fehler)}`
          : fehler instanceof Error && !fehler.status && fehler.message
            ? fehler.message
            : meldung(fehler),
      danach: (n) => {
        ctx.melde(
          n === 1 ? "Ein Punkt ist angelegt." : `${n} Punkte sind angelegt.`,
        );
        neuLaden();
      },
    });
  };

  haenge(
    wurzel,
    el(
      "section",
      { class: "flaeche lm-kopfkarte" },
      el("h2", {}, "Vorlage der Packliste"),
      el(
        "p",
        { class: "leise" },
        `${punkte.length} ${punkte.length === 1 ? "Punkt" : "Punkte"} in ${abschnitte.length} ${abschnitte.length === 1 ? "Abschnitt" : "Abschnitten"}. Jede Person bekommt daraus ihre eigene Liste zum Abhaken.`,
      ),
      !darf &&
        el(
          "p",
          { class: "hilfe" },
          "Das Lager ist schreibgeschützt. Die Vorlage lässt sich nicht ändern.",
        ),
    ),
    darf &&
      werkzeugzeile(
        knopf("Punkt hinzufügen", {
          art: "haupt",
          symbol: "plus",
          onclick: () => bearbeiten(null),
        }),
        knopf("Liste einfügen", { symbol: "plus", onclick: einfuegen }),
        druckKnopf("Drucken", "Vorlage"),
      ),
    sektionen.length === 0
      ? leerKarte(
          "Die Vorlage ist noch leer. Lege den ersten Punkt an oder füge eine ganze Liste ein.",
        )
      : el("div", { class: "lm-sektionen" }, sektionen),
  );
  return wurzel;
}

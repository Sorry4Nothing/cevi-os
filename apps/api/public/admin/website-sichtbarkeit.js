import { anfrage, fehlertext } from "./api.js";
import { el, knopf, neueId, seitenblatt } from "./dom.js";
import { band, beschaeftigt, bei } from "./website-dialoge.js";
import { sk } from "./lader.js";
import { schliesseOffenePanels, unteransicht } from "./website-unteransicht.js";
import { nochmals, zustandsDaten, zustandsKarte } from "./zustaende.js";
import { hatRollen, rollenWahl, rollenWert } from "./sicht-rollen.js";

// Sichtbarkeit einer Seite oder eines Bausteins (Boards E5): Seitenblatt mit den Wahlkarten «Öffentlich», «Nur angemeldet» und
// «Bestimmte Gruppen», den Gruppen als Pillen und (nur bei einer Seite) der Liste «Wer darf bearbeiten».
// Die Gruppen kommen aus ladeTags() (einmal je Editor geladen); bis sie da sind, stehen Skeleton-Pillen.

const ARTEN = [
  ["oeffentlich", "Öffentlich", "Alle sehen es, auch ohne Konto."],
  ["angemeldet", "Nur angemeldet", "Alle mit einem Konto der Abteilung."],
  ["tags", "Bestimmte Gruppen", "Nur Personen in den gewählten Gruppen."],
];

// opt: { typ: "seite" | "baustein", titel, untertitel, start, erbtText?, ladeTags, tagNamen, speichere(wert) → Promise, rechte? }
// start: { art, tagIds?, rollen? } oder «erbt» (nur bei einem Baustein); wert() in speichere hat dieselbe Form. rollen: je gewählter Stufe die Rollen (#844)
export function sichtbarkeitBlatt(opt) {
  if (!opt.in && !schliesseOffenePanels()) return null;
  const { start, erbtText, ladeTags, tagNamen } = opt;
  let art = start === "erbt" ? "erbt" : start.art;
  const gewaehlt = new Set(
    start !== "erbt" && start.art === "tags" ? start.tagIds : [],
  );
  const startRollen =
    start !== "erbt" && start.art === "tags" ? (start.rollen ?? {}) : {};
  // Je Stufe eine Rollenwahl; sie bleibt erhalten, wenn die Stufe ab- und wieder angewählt wird
  const rollen = new Map();
  const rollenFuer = (t) => {
    if (!rollen.has(t.id)) {
      rollen.set(
        t.id,
        rollenWahl(
          t.name,
          startRollen[t.id],
          "Teilnehmende sind alle in der Stufe ohne Leitungsrolle.",
        ),
      );
    }
    return rollen.get(t.id);
  };
  const rollenPlatz = el("div", { class: "ws-rollen" });
  const zeichneRollen = () =>
    rollenPlatz.replaceChildren(
      ...(tags ?? [])
        .filter((t) => hatRollen(t) && gewaehlt.has(t.id))
        .map((t) => rollenFuer(t).wurzel),
    );
  const gruppeId = neueId("gruppen");
  const artName = neueId("art");

  const karte = (wert, name, text) => {
    const eingabe = el("input", {
      type: "radio",
      name: artName,
      value: wert,
      onchange: () => {
        art = wert;
        zeichneGruppen();
      },
    });
    eingabe.checked = art === wert;
    return el(
      "label",
      { class: "wahlkarte" },
      eingabe,
      el("div", {}, el("strong", {}, name), el("span", {}, text)),
    );
  };
  const arten = el(
    "fieldset",
    { class: "ws-wahl" },
    el("legend", { class: "legende" }, opt.frage),
    erbtText !== undefined && karte("erbt", "Wie die Seite", erbtText),
    ARTEN.map(([w, n, t]) => karte(w, n, t)),
  );

  // Wo die Seite erscheint (#795): Nur bei einer Seite; sie steht im Menü der Website, aber nur für berechtigte angemeldete Personen
  const menueId = neueId("menue");
  const menueHinweis = el("p", { class: "hilfe", id: menueId });
  if (opt.typ === "seite") arten.setAttribute("aria-describedby", menueId);

  const gruppen = el("div", { class: "feld", hidden: true });
  const warnung = el("div", { class: "ws-warnplatz" });
  let tags = null;
  let ladefehler = null;
  let laedt = true;

  function zeichneGruppen() {
    menueHinweis.textContent =
      art === "oeffentlich"
        ? "Steht im Menü der Website für alle, sobald die Seite veröffentlicht ist."
        : "Erscheint im Menü nur für angemeldete Personen, die die Seite sehen dürfen.";
    gruppen.hidden = art !== "tags";
    warnung.replaceChildren();
    if (art !== "tags") return;
    const legende = el("span", { class: "legende", id: gruppeId }, "Gruppen");
    if (laedt) {
      gruppen.replaceChildren(
        legende,
        el(
          "div",
          { "aria-busy": "true" },
          el(
            "div",
            { class: "pillen" },
            [96, 64, 80, 136, 112].map((b) => sk("r", b)),
          ),
          el("p", { class: "nur-leser", role: "status" }, "Lädt …"),
        ),
      );
      return;
    }
    if (ladefehler) {
      const d = zustandsDaten(ladefehler);
      const k = zustandsKarte(
        {
          titel: "Die Gruppen konnten nicht geladen werden.",
          text: "Prüfe die Verbindung und versuche es nochmals.",
          ueber: d.ueber,
        },
        [nochmals(laden, "")],
        "h3",
      );
      gruppen.replaceChildren(legende, k.wurzel);
      return;
    }
    const pillen = tags.map((t) => {
      const an = gewaehlt.has(t.id);
      return el(
        "button",
        {
          type: "button",
          class: "pille",
          "aria-pressed": String(an),
          onclick: (e) => {
            if (gewaehlt.has(t.id)) gewaehlt.delete(t.id);
            else gewaehlt.add(t.id);
            e.currentTarget.setAttribute(
              "aria-pressed",
              String(gewaehlt.has(t.id)),
            );
            zeichneRollen();
            pruefeWarnung();
          },
        },
        t.name,
      );
    });
    gruppen.replaceChildren(
      legende,
      pillen.length > 0
        ? el(
            "div",
            { class: "pillen", role: "group", "aria-labelledby": gruppeId },
            pillen,
          )
        : el("p", { class: "hilfe" }, "Es gibt noch keine Gruppen."),
      el(
        "p",
        { class: "hilfe" },
        "Sichtbar, wenn die Person mindestens eine der gewählten Gruppen hat.",
      ),
      rollenPlatz,
    );
    zeichneRollen();
    pruefeWarnung();
  }

  function pruefeWarnung() {
    warnung.replaceChildren();
    if (art === "tags" && gewaehlt.size === 0) {
      warnung.append(
        band(
          "warn",
          `Ohne Gruppe sieht niemand ${opt.typ === "seite" ? "diese Seite" : "diesen Baustein"}. Wähle mindestens eine Gruppe.`,
        ),
      );
    }
  }

  function laden() {
    laedt = true;
    ladefehler = null;
    zeichneGruppen();
    ladeTags().then(
      (t) => {
        tags = t;
        laedt = false;
        // Gruppen, die es nicht mehr gibt, fallen weg
        for (const id of [...gewaehlt]) {
          if (!t.some((x) => x.id === id)) gewaehlt.delete(id);
        }
        zeichneGruppen();
      },
      (f) => {
        laedt = false;
        ladefehler = f;
        zeichneGruppen();
      },
    );
  }

  const fehlerPlatz = el("div", { class: "ws-fehlerplatz" });
  const speichern = knopf("Speichern", { art: "haupt" });
  const abbrechen = knopf("Abbrechen", { onclick: () => blatt.close() });
  bei(speichern, async () => {
    fehlerPlatz.replaceChildren();
    if (art === "tags" && gewaehlt.size === 0) {
      pruefeWarnung();
      gruppen.querySelector(".pille")?.focus();
      return;
    }
    const wert =
      art === "erbt"
        ? "erbt"
        : art === "tags"
          ? (() => {
              const an = tags.filter((t) => gewaehlt.has(t.id));
              const r = rollenWert(
                an.filter(hatRollen).map((t) => [t.id, rollenFuer(t)]),
              );
              return {
                art,
                tagIds: an.map((t) => t.id),
                ...(r && { rollen: r }),
              };
            })()
          : { art };
    beschaeftigt(speichern, true);
    abbrechen.disabled = true;
    try {
      await opt.speichere(wert);
      blatt.close();
    } catch (f) {
      const b = band("fehler", fehlertext(f));
      b.tabIndex = -1;
      fehlerPlatz.replaceChildren(b);
      b.focus();
      beschaeftigt(speichern, false);
      abbrechen.disabled = false;
    }
  });

  const rechteBox = opt.rechte ? rechteBereich(opt.rechte, tagNamen) : null;
  const inhalt = [
    el(
      "div",
      { class: "ws-blattinhalt" },
      arten,
      opt.typ === "seite" && menueHinweis,
      gruppen,
      warnung,
      rechteBox,
      fehlerPlatz,
    ),
  ];
  // Im Panel eines Bausteins ersetzt die Auswahl dessen Inhalt (nie ein zweites Panel über dem ersten)
  const blatt = opt.in
    ? unteransicht(opt.in, {
        titel: opt.titel,
        untertitel: opt.untertitel,
        inhalt,
        fusszeile: [abbrechen, speichern],
        zurueckText: "Zurück zum Baustein",
      })
    : seitenblatt({
        panel: true,
        titel: opt.titel,
        untertitel: opt.untertitel,
        inhalt,
        fusszeile: [abbrechen, speichern],
        schliessen: opt.beimSchliessen,
      });
  zeichneGruppen();
  laden();
  return blatt;
}

// «Wer darf bearbeiten»: Die Standardrechte stehen fest (Regeln des Servers), Sonderrechte vergeben die Abteilungsleitung und der Entwickler
// r: { seite, siehtAlles, melde }
function rechteBereich(r, tagNamen) {
  const { seite, siehtAlles, melde } = r;
  const standard = [
    "Abteilungsleitung und Entwickler",
    "Webmaster mit dem Recht «Seiten bearbeiten»",
    seite.tagId
      ? `Stufenleitung von ${tagNamen.get(seite.tagId) ?? "der zugehörigen Gruppe"}`
      : null,
  ].filter(Boolean);
  const liste = el(
    "ul",
    { class: "liste-zeilen", "aria-label": "Wer die Seite bearbeiten darf" },
    standard.map((s) =>
      el(
        "li",
        {},
        el("span", { class: "ws-wer" }, s),
        el("span", { class: "chip" }, "Standard"),
      ),
    ),
  );
  const wurzel = el(
    "section",
    { class: "ws-teil" },
    el("h3", {}, "Wer darf bearbeiten"),
    liste,
  );
  if (!siehtAlles) {
    wurzel.append(
      band(
        "info",
        "Sonderrechte vergibt nur die Abteilungsleitung. Frag sie, wenn jemand dazukommen soll.",
      ),
    );
    return wurzel;
  }
  const platz = el("div", {});
  wurzel.append(platz);
  let personen = new Map();
  const bezeichnung = (b) =>
    b.tagId
      ? `Gruppe «${tagNamen.get(b.tagId) ?? "unbekannt"}»`
      : `${personen.get(b.userId) ?? "Person"}`;

  function zeichneSonder(daten) {
    for (const alt of liste.querySelectorAll("li[data-sonder]")) alt.remove();
    for (const b of daten.bearbeiter.filter(
      (e) => e.objektTyp === "seite" && e.objektId === seite.id,
    )) {
      const name = bezeichnung(b);
      const li = el(
        "li",
        { "data-sonder": "" },
        el("span", { class: "ws-wer" }, name),
        el("span", { class: "chip" }, "Sonderrecht"),
        knopf("Entfernen", {
          klein: true,
          kontext: name,
          onclick: async () => {
            try {
              await anfrage("DELETE", `/api/v1/admin/bearbeiter/${b.id}`);
              li.remove();
              platz.querySelector("button")?.focus();
              melde(`Das Recht von ${name} ist entzogen.`);
            } catch (f) {
              melde(fehlertext(f), "fehler");
            }
          },
        }),
      );
      liste.append(li);
    }
  }

  async function ladeSonder() {
    platz.replaceChildren(
      el(
        "div",
        { "aria-busy": "true" },
        sk("t", 260),
        el("p", { class: "nur-leser", role: "status" }, "Lädt …"),
      ),
    );
    try {
      const [b, p] = await Promise.all([
        anfrage("GET", "/api/v1/admin/bearbeiter"),
        anfrage("GET", "/api/v1/admin/personen"),
      ]);
      personen = new Map(p.personen.map((x) => [x.id, x.name]));
      zeichneSonder(b);
      platz.replaceChildren(
        knopf("Hinzufügen", {
          klein: true,
          onclick: (e) => hinzufuegen(p.personen, ladeSonder, e.currentTarget),
        }),
      );
    } catch (f) {
      platz.replaceChildren(
        band("fehler", fehlertext(f)),
        knopf("Nochmals versuchen", {
          klein: true,
          symbol: "aktualisieren",
          onclick: ladeSonder,
        }),
      );
    }
  }

  // Gruppe oder Person wählen und das Recht erteilen
  function hinzufuegen(personenListe, nachher, ausloeser) {
    const tagListe = [...tagNamen];
    let art = tagListe.length > 0 ? "tagId" : "userId";
    const name = neueId("recht");
    const optionen = (werte, leer) => [
      el("option", { value: "" }, leer),
      ...werte.map(([id, text]) => el("option", { value: id }, text)),
    ];
    const gruppeSel = el(
      "select",
      { class: "ws-select", id: neueId("sel") },
      optionen(tagListe, "Gruppe wählen"),
    );
    const personSel = el(
      "select",
      { class: "ws-select", id: neueId("sel") },
      optionen(
        personenListe.filter((p) => !p.deaktiviert).map((p) => [p.id, p.name]),
        "Person wählen",
      ),
    );
    const feldGruppe = el(
      "div",
      { class: "feld" },
      el("label", { for: gruppeSel.id }, "Gruppe"),
      gruppeSel,
    );
    const feldPerson = el(
      "div",
      { class: "feld" },
      el("label", { for: personSel.id }, "Person"),
      personSel,
    );
    const umschalten = () => {
      feldGruppe.hidden = art !== "tagId";
      feldPerson.hidden = art !== "userId";
    };
    umschalten();
    const radio = (w, text) => {
      const id = neueId("art");
      const e = el("input", {
        type: "radio",
        id,
        name,
        value: w,
        onchange: () => {
          art = w;
          umschalten();
        },
      });
      e.checked = art === w;
      return [e, el("label", { for: id }, text)];
    };
    const ok = knopf("Recht erteilen", { art: "haupt" });
    const abbr = knopf("Abbrechen", { onclick: () => f.schliesse() });
    bei(ok, async () => {
      const wert = (art === "tagId" ? gruppeSel : personSel).value;
      if (!wert) {
        f.fehler("Wähle eine Gruppe oder eine Person.");
        return;
      }
      f.fehler(null);
      beschaeftigt(ok, true);
      try {
        await anfrage("POST", "/api/v1/admin/bearbeiter", {
          objektTyp: "seite",
          objektId: seite.id,
          [art]: wert,
        });
        f.schliesse();
        await nachher();
        platz.querySelector("button")?.focus();
        melde("Das Recht ist erteilt.");
      } catch (fehler) {
        f.fehler(fehlertext(fehler));
        beschaeftigt(ok, false);
      }
    });
    // Im Panel selbst, nie als Seite über dem Panel
    const fehlerZeile = el("div", { class: "ws-fehlerplatz" });
    const f = {
      schliesse: () => {
        karte.remove();
        ausloeser.hidden = false;
        ausloeser.focus();
      },
      fehler: (text) =>
        fehlerZeile.replaceChildren(...(text ? [band("fehler", text)] : [])),
    };
    const karte = el(
      "div",
      { class: "ws-recht-neu", role: "group", "aria-label": "Recht erteilen" },
      el(
        "p",
        { class: "hilfe" },
        `Eine Gruppe gibt das Recht allen Personen, die sie tragen.`,
      ),
      el(
        "fieldset",
        {},
        el("legend", { class: "legende" }, "Recht erteilen an"),
        el("div", { class: "seg" }, [
          ...radio("tagId", "Gruppe"),
          ...radio("userId", "Person"),
        ]),
      ),
      feldGruppe,
      feldPerson,
      fehlerZeile,
      el("div", { class: "ws-reihe" }, abbr, ok),
    );
    ausloeser.hidden = true;
    ausloeser.after(karte);
    (art === "tagId" ? gruppeSel : personSel).focus();
  }

  ladeSonder();
  return wurzel;
}

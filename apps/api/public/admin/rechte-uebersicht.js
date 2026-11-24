import { fehlertext } from "./api.js";
import { auswahl, avatar, el, icon, knopf, neueId, zeit } from "./dom.js";
import { skeletonFlaeche } from "./lader.js";
import { leerKarte } from "./zustaende.js";
import { ladePerson, ladeVerlauf, ladeGruppe } from "./rechte-api.js";
import {
  adresse,
  haenge,
  personen as personenText,
  typText,
} from "./rechte-gemeinsam.js";
import {
  anzahlText,
  gruppiereNachBereich,
  herkunftGeltung,
  herkunftText,
  listenZeilen,
  markenVon,
  passtZurSuche,
  rechteFehlerText,
  rolleText,
  verlaufText,
  werDarf,
} from "./rechte-modell.js";

// Reiter «Was darf wer?» (#651): drei Blickwinkel auf dieselben Rechte, nur lesen.
//   #personen/rechte/uebersicht/person[/<id>]   was darf diese Person, und woher hat sie es?
//   #personen/rechte/uebersicht/recht[/<recht>] wer darf dieses Recht?
//   #personen/rechte/uebersicht/verlauf         was wurde an Rollen und Zuordnungen geändert?
// Vorlagen: Kokonut «team-members» (Rolle, was sie darf), «version-history» (Verlauf mit Klartext) und «security-bento» (Audit-Verlauf).

const ANSICHTEN = [
  ["person", "Person"],
  ["recht", "Recht"],
  ["verlauf", "Verlauf"],
];
const text = (f) => rechteFehlerText(f, fehlertext(f));

export function zeigeUebersicht(inhalt, z, pfad) {
  const [was = "person", wert] = pfad;
  haenge(
    inhalt,
    el(
      "nav",
      { class: "rr-unterreiter", "aria-label": "Blickwinkel" },
      ANSICHTEN.map(([schluessel, name]) =>
        el(
          "a",
          {
            class: "rr-unterreiter-link",
            href: adresse("uebersicht", schluessel),
            ...(schluessel === was && { "aria-current": "page" }),
          },
          name,
        ),
      ),
    ),
  );
  const ort = el("div", { class: "rr-uebersicht" });
  inhalt.append(ort);
  if (was === "recht") zeigeRecht(ort, z, wert);
  else if (was === "verlauf") zeigeVerlauf(ort, z);
  else zeigePerson(ort, z, wert);
}

const skelett = () =>
  el("div", { class: "rr-skelett" }, skeletonFlaeche({ zeilen: 4 }));

// ---------- Person ----------

function zeigePerson(ort, z, id) {
  const stufenName = new Map((z.stufen ?? []).map((s) => [s.id, s.name]));
  const zeilen = listenZeilen(
    [...z.personen]
      .filter((p) => !p.deaktiviert)
      .sort((a, b) => a.name.localeCompare(b.name, "de-CH")),
    stufenName,
  );
  const sucheId = neueId("rr-personensuche");
  const liste = el("ul", { class: "rr-wahlliste", "aria-label": "Personen" });
  const zahl = el("p", {
    class: "klein leise rr-wahlzahl",
    role: "status",
  });
  const suche = el("input", {
    id: sucheId,
    class: "eingabe",
    type: "search",
    placeholder: "Person suchen",
    autocomplete: "off",
    spellcheck: "false",
    oninput: () => zeichneListe(),
  });
  const detail = el("div", { class: "rr-detail", "aria-live": "polite" });

  function zeichneListe() {
    const treffer = zeilen.filter((x) => passtZurSuche(x, suche.value));
    zahl.textContent = anzahlText(treffer.length);
    liste.replaceChildren(
      ...treffer.map(({ person: p, rolle, zusatz }) =>
        el(
          "li",
          {},
          el(
            "a",
            {
              class: "rr-wahlzeile",
              href: adresse("uebersicht", "person", p.id),
              ...(p.id === id && { "aria-current": "true" }),
            },
            avatar(p.name, { hell: true, bildUrl: p.bildUrl }),
            el(
              "span",
              { class: "rr-wahlname" },
              el("span", { class: "rr-wahlname-text" }, p.name),
              rolle && el("span", { class: "klein leise" }, rolle),
              zusatz && el("span", { class: "klein leise rr-zusatz" }, zusatz),
            ),
          ),
        ),
      ),
    );
  }
  zeichneListe();
  ort.append(
    el(
      "div",
      { class: "rr-zweispalt" },
      el(
        "section",
        {
          class: "flaeche rr-flaeche rr-wahl-block",
          "aria-label": "Person wählen",
        },
        el(
          "div",
          { class: "rr-wahlkopf" },
          el(
            "div",
            { class: "suche" },
            el("label", { class: "nur-leser", for: sucheId }, "Person suchen"),
            icon("lupe"),
            suche,
          ),
          zahl,
        ),
        liste,
      ),
      detail,
    ),
  );
  // Liegt die gewählte Zeile ausserhalb der Liste, rückt sie in die Mitte (nur die Liste scrollt, nicht die Seite)
  const hier = liste.querySelector("[aria-current]");
  if (
    hier &&
    (hier.offsetTop < liste.scrollTop ||
      hier.offsetTop + hier.offsetHeight > liste.scrollTop + liste.clientHeight)
  ) {
    liste.scrollTop = Math.max(
      0,
      hier.offsetTop - (liste.clientHeight - hier.offsetHeight) / 2,
    );
  }
  if (!id) {
    detail.append(
      el(
        "div",
        { class: "flaeche rr-flaeche rr-leer-karte" },
        el("h3", {}, "Person wählen"),
        el(
          "p",
          { class: "leise rr-leer-hinweis" },
          "Wähle links eine Person. Du siehst dann, was sie darf und woher sie es hat.",
        ),
      ),
    );
    return;
  }
  const person = z.personen.find((p) => p.id === id);
  if (!person) {
    detail.append(leerKarte("Diese Person gibt es nicht mehr."));
    return;
  }
  detail.append(skelett());
  // Untereinander (schmal) steht die Person unter der Liste: Sie rückt nach der Wahl ins Bild
  if (!window.matchMedia("(min-width: 60rem)").matches) {
    detail.scrollIntoView({ block: "start" });
  }
  ladePerson(id).then(
    (daten) => detail.replaceChildren(personDetail(z, daten, person)),
    (f) =>
      detail.replaceChildren(
        el("p", { class: "hinweis hinweis--fehler", role: "alert" }, text(f)),
        knopf("Nochmals versuchen", {
          symbol: "aktualisieren",
          onclick: () => z.neu(),
        }),
      ),
  );
}

function personDetail(z, daten, person) {
  // Was jede angemeldete Person darf (Kalender, Anmelden, Räume ansehen), steht nur als ein Satz da
  const alleDarf = daten.rechte.filter((r) =>
    r.herkunft.every((h) => h.art === "struktur"),
  );
  const rechte = daten.rechte.filter((r) => !alleDarf.includes(r));
  const braucht = rechte.some((r) => r.zweiterFaktor);
  const katalogInfo = new Map(z.katalog.rechte.map((r) => [r.id, r]));
  const bereiche = gruppiereNachBereich(z.katalog, (r) =>
    rechte.some((x) => x.recht === r.id),
  );
  const rolle = rolleText(
    person,
    new Map((z.stufen ?? []).map((s) => [s.id, s.name])),
  );
  return el(
    "section",
    { class: "flaeche rr-flaeche", "aria-labelledby": "rr-person-titel" },
    el(
      "div",
      { class: "rr-kopfzeile rr-personkopf" },
      avatar(person.name, { hell: true, bildUrl: person.bildUrl }),
      el(
        "div",
        { class: "rr-personname" },
        el("h3", { id: "rr-person-titel" }, daten.person.name),
        el(
          "span",
          { class: "klein leise" },
          [rolle, person.ceviName, person.benutzername]
            .filter(Boolean)
            .join(" · "),
        ),
      ),
      el(
        "span",
        { class: "klein leise" },
        rechte.length === 0
          ? "Hat keine besonderen Rechte"
          : `${rechte.length === 1 ? "1 Recht" : `${rechte.length} Rechte`}`,
      ),
    ),
    daten.abteilungsleitung &&
      el(
        "p",
        { class: "hinweis" },
        "Abteilungsleitung: hat immer alles. Das lässt sich nicht einschränken.",
      ),
    daten.entwickler &&
      el(
        "p",
        { class: "hinweis" },
        "Entwickler: hat jedes Recht. Das lässt sich nicht einschränken.",
      ),
    braucht &&
      !person.zweiterFaktor &&
      el(
        "p",
        { class: "hinweis hinweis--warn", role: "note" },
        "Diese Person hat noch keinen zweiten Faktor. Rechte mit dem Zeichen «2. Faktor» kann sie erst nutzen, wenn sie ihn in «Mein Konto» eingerichtet hat.",
      ),
    daten.gruppen.length > 0 &&
      el(
        "div",
        { class: "rr-person-gruppen" },
        el("h4", {}, "In diesen Gruppen"),
        el(
          "ul",
          { class: "rr-gruppenchips" },
          daten.gruppen.map((g) =>
            el(
              "li",
              {},
              el(
                "a",
                { class: "chip", href: adresse("gruppen", g.id) },
                `${g.name}${g.rolle ? `, ${g.rolle}` : ""} (${typText(g.typ)})`,
              ),
            ),
          ),
        ),
      ),
    rechte.length === 0
      ? leerKarte("Diese Person hat nur, was jede angemeldete Person hat.")
      : bereiche.map((b) =>
          el(
            "div",
            { class: "rr-darf-bereich" },
            el("h4", {}, b.name),
            el(
              "ul",
              { class: "rr-darfliste" },
              b.rechte.map((r) => {
                const x = rechte.find((y) => y.recht === r.id);
                return el(
                  "li",
                  { class: "rr-darfzeile" },
                  el(
                    "div",
                    { class: "rr-darfkopf" },
                    el("strong", {}, x.klartext),
                    markenListe(x, katalogInfo.get(x.recht)),
                  ),
                  el(
                    "ul",
                    { class: "rr-quellen" },
                    x.herkunft.map((h) =>
                      el(
                        "li",
                        { class: "rr-quelle" },
                        herkunftText(h),
                        el(
                          "span",
                          { class: "klein leise" },
                          ` · ${herkunftGeltung(h)}`,
                        ),
                        h.gruppeId &&
                          el(
                            "a",
                            {
                              class: "klein tm-tabellenlink rr-quelle-link",
                              href: adresse("gruppen", h.gruppeId),
                            },
                            "Gruppe öffnen",
                          ),
                      ),
                    ),
                  ),
                );
              }),
            ),
          ),
        ),
    alleDarf.length > 0 &&
      el(
        "div",
        { class: "rr-person-gruppen" },
        el("h4", {}, "Dazu kommt, was jede angemeldete Person darf"),
        el(
          "ul",
          { class: "rr-gruppenchips" },
          alleDarf.map((r) => el("li", { class: "chip" }, r.klartext)),
        ),
      ),
  );
}

function markenListe(x, eintrag) {
  return el(
    "span",
    { class: "rr-marken" },
    x.zweiterFaktor &&
      el(
        "span",
        { class: "rr-marke rr-marke--faktor" },
        icon("schluessel"),
        "2. Faktor",
      ),
    ...markenVon(x.recht).map((m) =>
      el(
        "span",
        {
          class: m.gross ? "rr-marke rr-marke--gross" : "rr-marke",
          "data-tipp": m.hilfe,
        },
        m.text,
      ),
    ),
    eintrag?.art === "fest" &&
      el("span", { class: "rr-marke rr-marke--system" }, "Fest"),
  );
}

// ---------- Recht ----------

// Alle Rollen aller Gruppen, einmal je Ansicht geladen (die Gruppen mit Rollen, parallel)
async function ladeAlleGruppenrollen(z) {
  const mitRollen = z.gruppen.filter((g) => g.rollen > 0);
  const ergebnisse = await Promise.all(
    mitRollen.map((g) => ladeGruppe(g.id).catch(() => null)),
  );
  return ergebnisse
    .filter(Boolean)
    .map((d) => ({ gruppe: d.gruppe, rollen: d.rollen }));
}

function zeigeRecht(ort, z, rechtId) {
  const optionen = z.katalog.bereiche.flatMap((b) =>
    z.katalog.rechte
      .filter((r) => r.bereich === b.id)
      .map((r) => [r.id, `${b.name}: ${r.klartext}`]),
  );
  const wahl = auswahl({
    label: "Recht",
    optionen: [["", "Recht wählen"], ...optionen],
    wert: rechtId ?? "",
  });
  wahl.eingabe.addEventListener("change", () => {
    location.hash = adresse("uebersicht", "recht", wahl.eingabe.value);
  });
  const ergebnis = el("div", { class: "rr-detail", "aria-live": "polite" });
  ort.append(
    el(
      "p",
      { class: "leise rr-erklaerung" },
      "Wähle ein Recht und sieh, wer es hat: die Abteilungsleitung, Plattformrollen und Gruppenrollen mit ihren Personen. Standardrechte aus der Mitgliedschaft in einem Team oder einer Funktion stehen hier nicht; sie siehst du bei der Person.",
    ),
    el("div", { class: "rr-rechtwahl" }, wahl.wurzel),
    ergebnis,
  );
  const eintrag = z.katalog.rechte.find((r) => r.id === rechtId);
  if (!eintrag) {
    ergebnis.append(leerKarte("Wähle ein Recht."));
    return;
  }
  ergebnis.append(skelett());
  const abteilungsleitung = z.personen
    .filter((p) => p.abteilungsleitung && !p.deaktiviert)
    .map((p) => ({ id: p.id, name: p.name }));
  ladeAlleGruppenrollen(z).then(
    (gruppen) => {
      const zeilen = werDarf({
        eintrag,
        abteilungsleitung,
        globale: z.globale,
        gruppen,
      });
      ergebnis.replaceChildren(rechtErgebnis(z, eintrag, zeilen));
    },
    (f) =>
      ergebnis.replaceChildren(
        el("p", { class: "hinweis hinweis--fehler", role: "alert" }, text(f)),
      ),
  );
}

function rechtErgebnis(z, eintrag, zeilen) {
  return el(
    "section",
    { class: "flaeche rr-flaeche", "aria-labelledby": "rr-recht-titel" },
    el(
      "div",
      { class: "rr-kopfzeile" },
      el("h3", { id: "rr-recht-titel" }, eintrag.klartext),
      markenListe(
        { recht: eintrag.id, zweiterFaktor: eintrag.zweiterFaktor },
        eintrag,
      ),
    ),
    el("p", { class: "leise" }, eintrag.erklaerung),
    el(
      "ul",
      { class: "rr-quellenliste" },
      zeilen.map((zeile) =>
        el(
          "li",
          { class: "rr-quellblock" },
          el(
            "div",
            { class: "rr-kopfzeile" },
            el(
              "strong",
              {},
              zeile.titel,
              zeile.fest &&
                el(
                  "span",
                  { class: "rr-marke rr-marke--system" },
                  icon("sperre"),
                  "Fest",
                ),
            ),
            el(
              "span",
              { class: "klein leise" },
              zeile.personen === null
                ? ""
                : `${personenText(zeile.personen.length)} · ${herkunftGeltung({ geltung: zeile.geltung })}`,
            ),
          ),
          zeile.hinweis && el("p", { class: "klein leise" }, zeile.hinweis),
          zeile.personen &&
            zeile.personen.length > 0 &&
            el(
              "ul",
              { class: "rr-namenliste" },
              zeile.personen.map((p) => el("li", {}, p.name)),
            ),
          zeile.tagId &&
            el(
              "a",
              {
                class: "klein tm-tabellenlink",
                href: adresse("gruppen", zeile.tagId, "rolle", zeile.rolleId),
              },
              "Rolle öffnen und Rechte ändern",
            ),
          zeile.art === "plattformrolle" &&
            el(
              "a",
              {
                class: "klein tm-tabellenlink",
                href: adresse("rollen", zeile.rolleId),
              },
              "Rolle öffnen und Rechte ändern",
            ),
        ),
      ),
    ),
    zeilen.length === 0 &&
      leerKarte(
        "Keine Rolle trägt dieses Recht. Nur die Abteilungsleitung hat es.",
      ),
  );
}

// ---------- Verlauf ----------

function zeigeVerlauf(ort, z) {
  const liste = el("ol", {
    class: "rr-verlauf",
    "aria-label": "Änderungen, neueste zuerst",
  });
  const mehr = knopf("Ältere laden", { symbol: "runter" });
  const status = el("p", { class: "klein leise", role: "status" });
  const rollenNamen = new Map(z.globale.map((r) => [r.id, r.name]));
  const gruppenNamen = new Map(z.gruppen.map((g) => [g.id, g.name]));
  const personenNamen = new Map(z.personen.map((p) => [p.id, p.name]));
  const nachschlagen = {
    gruppe: (id) => gruppenNamen.get(id),
    rolle: (id) => rollenNamen.get(id),
    person: (id) => personenNamen.get(id),
    recht: (id) => z.klartext(id),
  };
  let naechste = null;
  let laedt = false;
  ort.append(
    el(
      "p",
      { class: "leise rr-erklaerung" },
      "Wer hat wann welche Rolle angelegt, geändert, gelöscht oder zugeordnet? Die Einträge enthalten nur Namen von Rollen und Gruppen, keine Kontaktdaten. Der Verlauf lässt sich nicht ändern.",
    ),
    el(
      "section",
      { class: "flaeche rr-flaeche rr-verlaufkarte", "aria-label": "Verlauf" },
      liste,
      status,
      el("div", { class: "reihe" }, mehr),
    ),
  );

  // Rollennamen der Gruppen, die im Verlauf vorkommen, einmal nachladen (eine Abfrage je Gruppe)
  async function ergaenzeRollen(zeilen) {
    const tagIds = [
      ...new Set(
        zeilen
          .map((x) => x.details?.tagId)
          .filter((t) => t && gruppenNamen.has(t)),
      ),
    ];
    await Promise.all(
      tagIds.map(async (id) => {
        try {
          const d = await ladeGruppe(id);
          for (const r of d.rollen) rollenNamen.set(r.id, r.name);
        } catch {
          // Ohne Namen steht «eine Rolle»
        }
      }),
    );
  }

  async function lade() {
    if (laedt) return;
    laedt = true;
    mehr.disabled = true;
    status.textContent =
      liste.children.length === 0 ? "Der Verlauf wird geladen." : "";
    try {
      const antwort = await ladeVerlauf(naechste);
      await ergaenzeRollen(antwort.aenderungen);
      for (const x of antwort.aenderungen) liste.append(eintrag(x));
      naechste = antwort.weitere ? antwort.naechste : null;
      mehr.hidden = naechste === null;
      status.textContent =
        liste.children.length === 0 ? "Es wurde noch nichts geändert." : "";
    } catch (f) {
      // Ältere Einträge nachladen gescheitert: Toast; ohne Einträge steht der Fehler als Zustand der Ansicht da
      if (liste.children.length === 0) status.textContent = text(f);
      else z.ctx.melde(text(f), "fehler");
    } finally {
      laedt = false;
      mehr.disabled = false;
    }
  }
  function eintrag(x) {
    const t = verlaufText(x, nachschlagen);
    return el(
      "li",
      { class: "rr-verlaufzeile" },
      el("span", { class: "rr-verlaufpunkt", "aria-hidden": "true" }),
      el(
        "div",
        {},
        el("strong", {}, t.titel),
        t.detail && el("span", { class: "klein" }, t.detail),
        el(
          "span",
          { class: "klein leise" },
          `${zeit(x.zeit)} · ${x.akteur?.name ?? "Unbekannt"}`,
        ),
      ),
    );
  }
  mehr.addEventListener("click", lade);
  mehr.hidden = true;
  lade();
}

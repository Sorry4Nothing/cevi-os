import { anfrage, fehlertext } from "./api.js";
import { auswahl, chip, dialogFormular, el, feld, knopf } from "./dom.js";
import {
  sortKopf,
  speicherLeiste,
  zaehlwort,
  ersetze,
  termineTabelle,
} from "./kalenderhilfen.js";
import { leerKarte } from "./zustaende.js";

// Unterseite «Kategorien» (A12, #434, Epic #430): Welche Outlook-Kategorie zu welcher Gruppe gehört. Alle Zuordnungen stehen in einer Tabelle, «Speichern» schreibt die geänderten Zeilen.
// Adresse: #termine/kategorien · #termine/kategorien/<Kategorie> (URL-kodiert) führt in die Zeile dieser Kategorie; die Seite «Ohne Kategorie» verlinkt darauf.
// Datenbanklast: drei Abfragen beim Öffnen (Zuordnungen, Gruppen, Kategorien der Warnliste), unabhängig von der Zahl der Zeilen; je geänderter Zeile eine beim Speichern. Kein Polling.
// Lücke gegenüber dem Design: Die API liefert nur die zugeordneten und die unbekannten Kategorien. Eine Kategorie, die genau so heisst wie eine Gruppe, braucht keine Zuordnung und steht deshalb nicht in der Tabelle.

const TYPEN = {
  stufe: "Stufe",
  funktion: "Funktion",
  team: "Team",
  lager: "Lager",
};
const BASIS = "/api/v1/admin/kategorie-zuordnungen";
const WIRKT =
  "Sie wirken beim nächsten Abgleich mit Outlook, in höchstens 5 Minuten.";

const TEXTE = {
  TAG_UNBEKANNT: "Diese Gruppe gibt es nicht mehr. Lade die Seite neu.",
};
const meldungVon = (f) => TEXTE[f?.code] ?? fehlertext(f);

export function zeige(bereich, ctx) {
  const [roh] = ctx.pfad;
  let vorgabe = "";
  try {
    vorgabe = roh ? decodeURIComponent(roh).slice(0, 100) : "";
  } catch {
    // Kaputte Kodierung in der Adresse: ohne Vorgabe öffnen
  }
  ctx.lade(
    async () => {
      // Drei Abfragen, unabhängig von der Zahl der Zeilen. Die unbekannten Kategorien kommen aus der Warnliste (limit=1 spart die Termine); scheitert sie, bleibt es bei den Zuordnungen.
      const [liste, tags, warnung] = await Promise.all([
        anfrage("GET", BASIS),
        anfrage("GET", "/api/v1/admin/tags"),
        anfrage("GET", "/api/v1/admin/termine/warnungen?limit=1").catch(
          () => null,
        ),
      ]);
      return {
        zuordnungen: liste.zuordnungen,
        tags: tags.tags,
        unbekannt: warnung?.unbekannteKategorien ?? [],
      };
    },
    (daten, neu) => zeichne(bereich, ctx, daten, neu, vorgabe),
    { fehlerTitel: "Die Kategorien konnten nicht geladen werden." },
  );
}

const optionenVon = (tags) => [
  ["", "Keine Gruppe"],
  ...tags.map((t) => [t.id, `${t.name} (${TYPEN[t.typ] ?? t.typ})`]),
];

// Dialog «Kategorie ergänzen»: für eine Kategorie, die noch in keinem kommenden Termin vorkommt
function ergaenzen({ tags, ctx, neu }) {
  const name = feld({
    label: "Kategorie",
    hilfe: "So, wie sie in Outlook heisst. Höchstens 100 Zeichen.",
    maxlength: 100,
    required: true,
  });
  const gruppe = auswahl({
    label: "Gruppe",
    optionen: [["", "Gruppe wählen"], ...optionenVon(tags).slice(1)],
    wert: "",
  });
  dialogFormular({
    titel: "Kategorie ergänzen",
    beschreibung: `Nur nötig, wenn du die Kategorie in Outlook schon angelegt hast, sie aber an keinem kommenden Termin hängt. Die Zuordnung wirkt beim nächsten Abgleich mit Outlook, in höchstens 5 Minuten.`,
    felder: [name.wurzel, gruppe.wurzel],
    ok: "Speichern",
    senden: () => {
      if (!gruppe.eingabe.value) {
        throw Object.assign(new Error("TAG_FEHLT"), { code: "TAG_FEHLT" });
      }
      return anfrage("PUT", BASIS, {
        kategorie: name.eingabe.value.trim(),
        tagId: gruppe.eingabe.value,
      });
    },
    fehlertext: (f) =>
      f.code === "TAG_FEHLT" ? "Wähle eine Gruppe." : meldungVon(f),
    danach: () => {
      neu();
      ctx.melde("Zuordnung ist gespeichert.");
    },
  });
}

function zeichne(bereich, ctx, { zuordnungen, tags, unbekannt }, neu, vorgabe) {
  if (tags.length === 0) {
    bereich.append(
      leerKarte("Es gibt noch keine Gruppen. Lege zuerst eine Gruppe an.", [
        el(
          "a",
          { class: "knopf", href: "#personen/gruppen" },
          "Zu den Gruppen",
        ),
      ]),
    );
    return;
  }
  // Zeilen: erst die zugeordneten, dann die unbekannten; eine Kategorie aus der Adresse, die noch fehlt, kommt dazu
  const zeilen = [
    ...zuordnungen.map((z) => ({
      name: z.kategorie,
      id: z.id,
      start: z.tagId,
    })),
    ...unbekannt.map((u) => ({
      name: u.name,
      id: null,
      start: "",
      anzahl: u.anzahl,
    })),
  ];
  if (vorgabe && !zeilen.some((z) => z.name === vorgabe)) {
    zeilen.push({ name: vorgabe, id: null, start: "" });
  }
  let richtung = "ascending";

  // Kein Speichern-Knopf im Kopf (auch nicht bei leerer Seite): Die Leiste unten erscheint, sobald eine Zuordnung geändert ist
  const leiste = speicherLeiste({
    beiSpeichern: (k) => speichern(k),
    beiVerwerfen: () => {
      for (const z of zeilen) z.aktuell = undefined;
      zeichneListe();
      leiste.verstecke();
    },
  });
  const aktualisiereLeiste = () => {
    const n = zeilen.filter((z) => z.wert?.() !== z.start).length;
    if (n === 0) leiste.verstecke();
    else
      leiste.zeige(
        `${zaehlwort(n, "Zuordnung", "Zuordnungen")} geändert, noch nicht gespeichert.`,
      );
  };

  const hinweis = el(
    "div",
    { class: "hinweis", role: "status" },
    `Kategorien legst du in Outlook an, nicht hier. Cevi OS liest sie beim Abgleich mit Outlook und schreibt nie etwas zurück. Hier legst du nur fest, zu welcher Gruppe eine Kategorie gehört, wenn sie nicht genau so heisst wie die Gruppe. Änderungen wirken beim nächsten Abgleich, in höchstens 5 Minuten.`,
  );
  const ergaenzenKnopf = knopf("Kategorie ergänzen", {
    symbol: "plus",
    onclick: () => ergaenzen({ tags, ctx, neu }),
  });
  const liste = el("div", {});

  function zeile(z) {
    z.auswahl = auswahl({
      label: `Gruppe für ${z.name}`,
      optionen: optionenVon(tags),
      wert: tags.some((t) => t.id === (z.aktuell ?? z.start))
        ? (z.aktuell ?? z.start)
        : "",
    });
    z.auswahl.wurzel.querySelector("label").classList.add("nur-leser");
    z.wert = () => z.auswahl.eingabe.value;
    z.zustand = el("ul", { class: "chips" });
    const zeichneZustand = () => {
      ersetze(
        z.zustand,
        z.wert() ? chip("Zugeordnet", "ok") : chip("Nicht zugeordnet", "warn"),
        z.wert() !== z.start && chip("Nicht gespeichert", undefined, false),
      );
    };
    z.auswahl.eingabe.addEventListener("change", () => {
      z.aktuell = z.wert();
      zeichneZustand();
      aktualisiereLeiste();
    });
    zeichneZustand();
    z.zeichneZustand = zeichneZustand;
    return el(
      "tr",
      {},
      el(
        "th",
        { scope: "row" },
        el("span", { class: "mono tm-roh" }, z.name),
        z.anzahl &&
          el(
            "span",
            { class: "tm-zeit klein leise" },
            `in ${zaehlwort(z.anzahl, "Termin", "Terminen")}`,
          ),
      ),
      el("td", { class: "tm-gruppenzelle" }, z.auswahl.wurzel),
      el("td", {}, z.zustand),
    );
  }

  function zeichneListe() {
    if (zeilen.length === 0) {
      ersetze(
        liste,
        leerKarte(
          "In Outlook gibt es noch keine Kategorien. Lege dort die ersten an, sie erscheinen hier nach dem nächsten Abgleich.",
        ),
      );
      return;
    }
    const sortiert = [...zeilen].sort((a, b) =>
      a.name.localeCompare(b.name, "de-CH"),
    );
    if (richtung === "descending") sortiert.reverse();
    const t = termineTabelle({
      beschriftung: "Zuordnung der Outlook-Kategorien zu Gruppen",
      spalten: ["Outlook-Kategorie", "Gruppe", "Zustand"],
      zeilen: sortiert.map(zeile),
    });
    sortKopf(t.wurzel.querySelector("th"), {
      richtung,
      beiWechsel: (r) => {
        richtung = r;
        zeichneListe();
        liste.querySelector(".tm-sortknopf")?.focus();
      },
    });
    ersetze(liste, t.wurzel);
  }

  async function speichern(knopfNode) {
    const geaendert = zeilen.filter((z) => z.wert() !== z.start);
    if (geaendert.length === 0) {
      ctx.melde("Es gibt keine Änderungen zu speichern.", "info");
      return;
    }
    knopfNode.disabled = true;
    knopfNode.setAttribute("aria-busy", "true");
    const fertig = [];
    let fehler = null;
    for (const z of geaendert) {
      try {
        if (z.wert()) {
          await anfrage("PUT", BASIS, { kategorie: z.name, tagId: z.wert() });
        } else {
          await anfrage("DELETE", `${BASIS}/${z.id}`);
        }
        fertig.push(z);
      } catch (f) {
        fehler = f;
        break;
      }
    }
    knopfNode.disabled = false;
    knopfNode.removeAttribute("aria-busy");
    if (!fehler) {
      ctx.melde(
        `${zaehlwort(fertig.length, "Zuordnung", "Zuordnungen")} gespeichert. ${WIRKT}`,
      );
      neu();
      return;
    }
    // Gespeicherte Zeilen gelten als gespeichert; die übrigen behalten ihre Wahl
    for (const z of fertig) z.start = z.wert();
    try {
      const frisch = await anfrage("GET", BASIS);
      for (const z of zeilen) {
        z.id =
          frisch.zuordnungen.find((x) => x.kategorie === z.name)?.id ?? null;
      }
    } catch {
      // Die Kennung fehlt dann bis zum nächsten Laden; die Seite lässt sich neu laden
    }
    for (const z of zeilen) z.zeichneZustand?.();
    aktualisiereLeiste();
    ctx.melde(
      `Nicht gespeichert. ${meldungVon(fehler)} Deine Zuordnungen sind noch da, speichere nochmals.`,
      "fehler",
    );
  }

  bereich.append(
    hinweis,
    el("div", { class: "werkzeuge" }, ergaenzenKnopf),
    liste,
    leiste.wurzel,
  );
  zeichneListe();
  // Aus der Warnliste: Die Zeile dieser Kategorie ist gemeint
  if (vorgabe) {
    const ziel = [...liste.querySelectorAll("tbody tr")].find((tr) =>
      tr.querySelector("th")?.textContent.startsWith(vorgabe),
    );
    ziel?.scrollIntoView({ block: "center" });
    ziel?.querySelector(".auswahl-knopf")?.focus();
  }
}

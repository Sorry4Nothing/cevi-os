import { anfrage, fehlertext } from "./api.js";
import {
  ankreuzen,
  chip,
  el,
  feld,
  filterGruppe,
  icon,
  knopf,
  neueId,
} from "./dom.js";
import { formularRaster } from "./formularraster.js";
import { zweiStufig } from "./rueckgaengig.js";

// Mitteilungen (#625): Die Empfänger sind eine Liste von Zielen. Ein Ziel ist eine Gruppe (Stufe, Funktion, Team, Lager, Anlass) mit den Rollen, die zu ihr passen. Links stehen Text, Ziele und die Suche nach Gruppen (Muster «action-search-bar»: Suche, Reiter je Typ mit Zahl, Liste mit Pfeiltasten), rechts die Vorschau mit dem Push und der Zahl der Konten je Ziel und gesamt.
// Gezählt und aufgelöst wird nur auf dem Server (POST …/vorschau und POST …); die Seite kennt weder Namen noch Konten. Eine Anfrage je Änderung der Wahl, kein Polling.

const API = "/api/v1/admin/mitteilungen";

// [Wert, Mehrzahl für den Reiter, Einzahl]; unbekannte Typen (später dazukommende) zeigt die Seite mit ihrem Wert
export const TYPEN = [
  ["stufe", "Stufen", "Stufe"],
  ["team", "Teams", "Team"],
  ["funktion", "Funktionen", "Funktion"],
  ["lager", "Lager", "Lager"],
  ["anlass", "Anlässe", "Anlass"],
];
export const typName = (typ) => TYPEN.find(([w]) => w === typ)?.[2] ?? typ;

// Rollen je Art der Gruppe: [Wert der API, Beschriftung, Satzteil]. Eltern sind die Teilnehmenden: Kinder haben kein Konto, sie erreichst du über ihre Eltern
const ROLLEN_STUFE = [
  ["eltern", "Kinder (über die Eltern)", "die Eltern der Kinder"],
  ["leitung", "Leitende", "die Leitenden"],
  ["stufenleitung", "Stufenleitung", "die Stufenleitung"],
];
const ROLLEN_GRUPPE = [
  ["alle", "Alle Mitglieder", "alle Mitglieder"],
  ["verantwortliche", "Verantwortliche", "die Verantwortlichen"],
];
export const rollenFuer = (typ) =>
  typ === "stufe" ? ROLLEN_STUFE : ROLLEN_GRUPPE;

export const kontenText = (n) => (n === 1 ? "1 Konto" : `${n} Konten`);
const mitglieder = (n) => (n === 1 ? "1 Mitglied" : `${n} Mitglieder`);

// Der Satzteil eines Ziels für die Frage vor dem Senden: «die Leitenden und die Stufenleitung von «Artemis»»
export function zielText(ziel) {
  // «Alle Mitglieder» schliesst die Verantwortlichen ein
  const teile = rollenFuer(ziel.gruppe.typ)
    .filter(
      ([wert]) =>
        ziel.rollen.includes(wert) &&
        !(wert === "verantwortliche" && ziel.rollen.includes("alle")),
    )
    .map(([, , satz]) => satz);
  const rollen =
    teile.length > 1
      ? `${teile.slice(0, -1).join(", ")} und ${teile.at(-1)}`
      : (teile[0] ?? "niemand");
  return `${rollen} von «${ziel.gruppe.name}»`;
}

// Der Teil des Bodys, der die Empfänger nennt; null, solange nichts gewählt ist oder ein Ziel keine Rolle hat
export function wahlAnfrage({ alle, ziele }) {
  if (alle) return { empfaenger: "alle" };
  if (ziele.length === 0 || ziele.some((z) => z.rollen.length === 0)) {
    return null;
  }
  return {
    ziele: ziele.map((z) => ({
      gruppeId: z.gruppe.id,
      // In der Reihenfolge der Rollen, nicht des Klickens
      rollen: rollenFuer(z.gruppe.typ)
        .map(([wert]) => wert)
        .filter((wert) => z.rollen.includes(wert)),
    })),
  };
}

// Die Gruppen, die die Suche anbietet: ohne bereits gewählte, nach Typ und Suchbegriff (Name oder Kürzel); Stufen vor den übrigen, danach nach Name
export function filtereGruppen(
  gruppen,
  { typ = "alle", frage = "", gewaehlt },
) {
  const begriff = frage.trim().toLocaleLowerCase("de-CH");
  const rang = (g) => {
    const i = TYPEN.findIndex(([w]) => w === g.typ);
    return i < 0 ? TYPEN.length : i;
  };
  return gruppen
    .filter(
      (g) =>
        !gewaehlt.has(g.id) &&
        (typ === "alle" || g.typ === typ) &&
        (!begriff ||
          `${g.name} ${g.kuerzel ?? ""}`
            .toLocaleLowerCase("de-CH")
            .includes(begriff)),
    )
    .sort((a, b) => rang(a) - rang(b) || a.name.localeCompare(b.name, "de-CH"));
}

// Zählen die Ziele einzeln mehr als die Wahl gesamt, kommen Personen mehrfach vor
export const doppelte = (vorschau) =>
  vorschau.ziele.reduce((summe, z) => summe + z.anzahl, 0) >
  vorschau.empfaenger;

export function zeige(bereich, ctx) {
  // Eine Abfrage für alle Gruppen; die Zahl der Konten kommt erst mit der Vorschau
  ctx.lade(
    async () => (await anfrage("GET", "/api/v1/admin/tags")).tags,
    (gruppen) => zeichne(bereich, ctx, gruppen),
  );
}

function zeichne(bereich, ctx, gruppen) {
  const titel = feld({
    label: "Titel",
    hilfe:
      "Die fette Zeile der Mitteilung. Schreibe keine Namen hinein: Der Text läuft über Apple und Google.",
    maxlength: 100,
    required: true,
    autocomplete: "off",
  });
  const beschreibung = feld({
    label: "Beschreibung (optional)",
    hilfe: "Steht unter dem Titel. Auch hier keine Namen schreiben.",
    mehrzeilig: true,
    rows: 3,
    maxlength: 300,
  });

  // Stand: alle Konten oder eine Liste von Zielen { gruppe, rollen, zeile, zahl }
  const stand = { alle: false, ziele: [] };
  const gewaehlt = () => new Set(stand.ziele.map((z) => z.gruppe.id));
  const ansage = el("p", { class: "nur-leser", role: "status" });

  const fehler = el("p", {
    class: "hinweis hinweis--fehler",
    role: "alert",
    hidden: true,
    tabindex: "-1",
  });
  const zeigeFehler = (text) => {
    fehler.textContent = text;
    fehler.hidden = false;
    fehler.focus();
  };

  // ===== Vorschau rechts: Push und Empfänger =====
  const pushTitel = el("p", { class: "mt-push-titel" });
  const pushText = el("p", { class: "mt-push-text" });
  const zeichnePush = () => {
    const t = titel.eingabe.value.trim();
    const b = beschreibung.eingabe.value.trim();
    pushTitel.textContent = t || "Titel der Mitteilung";
    pushTitel.classList.toggle("mt-push-leer", !t);
    pushText.textContent = b;
    pushText.hidden = !b;
  };
  titel.eingabe.addEventListener("input", zeichnePush);
  beschreibung.eingabe.addEventListener("input", zeichnePush);
  zeichnePush();

  const gesamt = el("p", { class: "mt-gesamt", role: "status" });
  const gesamtListe = el("ul", { class: "mt-empfaenger" });
  const hinweisDoppelt = el(
    "p",
    { class: "hilfe", hidden: true },
    "Wer in mehreren Zielen steht, zählt im Gesamttotal einmal.",
  );
  // Der Stand der Zählung: null = noch nichts zu zählen, sonst { laedt, vorschau, fehler }
  let zaehlung = null;
  const zeichneEmpfaenger = () => {
    gesamtListe.replaceChildren();
    hinweisDoppelt.hidden = true;
    if (stand.alle) {
      const n = zaehlung?.vorschau?.empfaenger;
      if (n === undefined) {
        gesamt.textContent = "Alle aktiven Konten der Abteilung";
      } else {
        gesamt.replaceChildren(
          el("strong", { class: "mt-zahl" }, String(n)),
          ` ${n === 1 ? "Konto" : "Konten"}`,
        );
      }
      gesamtListe.append(
        el("li", {}, el("span", {}, "Alle aktiven Konten der Abteilung")),
      );
      return;
    }
    if (!zaehlung) {
      gesamt.textContent = "Noch niemand gewählt";
      return;
    }
    if (zaehlung.fehler) {
      gesamt.textContent = "Die Zahl liess sich nicht ermitteln.";
    } else if (zaehlung.laedt) {
      gesamt.textContent = "Wird gezählt …";
    } else if (!zaehlung.vorschau) {
      gesamt.textContent = "Wähle bei jedem Ziel mindestens eine Rolle.";
    } else {
      const n = zaehlung.vorschau.empfaenger;
      gesamt.replaceChildren(
        el("strong", { class: "mt-zahl" }, String(n)),
        ` ${n === 1 ? "Konto" : "Konten"}`,
      );
      hinweisDoppelt.hidden = !doppelte(zaehlung.vorschau);
    }
    gesamt.toggleAttribute("aria-busy", zaehlung.laedt);
    for (const ziel of stand.ziele) {
      const n = zaehlung.vorschau?.ziele.find(
        (z) => z.gruppeId === ziel.gruppe.id,
      )?.anzahl;
      gesamtListe.append(
        el(
          "li",
          {},
          el("span", {}, zielTextGross(ziel)),
          el(
            "span",
            { class: "mt-n" },
            ziel.rollen.length === 0
              ? "Keine Rolle"
              : n === undefined
                ? "…"
                : String(n),
          ),
        ),
      );
    }
  };
  const zielTextGross = (ziel) => {
    const text = zielText(ziel);
    return text.charAt(0).toLocaleUpperCase("de-CH") + text.slice(1);
  };

  // Eine Anfrage je Änderung der Wahl, nach kurzer Pause; wer schneller klickt als der Server antwortet, sieht nur die letzte Antwort. Gleiche Wahl, gleiche Zahl: aus dem Speicher dieser Seite
  const bekannt = new Map();
  let nummer = 0;
  let timer = null;
  // Die Zahl je Ziel steht auch in der Zeile des Ziels
  const uebernehme = (vorschau) => {
    for (const ziel of stand.ziele) {
      const n = vorschau?.ziele.find((z) => z.gruppeId === ziel.gruppe.id);
      ziel.zahl.textContent =
        ziel.rollen.length === 0
          ? "Keine Rolle"
          : n
            ? kontenText(n.anzahl)
            : "…";
    }
  };
  const zaehle = () => {
    clearTimeout(timer);
    const mein = ++nummer;
    const wahl = wahlAnfrage(stand);
    if (!wahl) {
      zaehlung =
        stand.ziele.length > 0 ? { laedt: false, vorschau: null } : null;
      uebernehme(null);
      zeichneEmpfaenger();
      return;
    }
    const schluessel = JSON.stringify(wahl);
    if (bekannt.has(schluessel)) {
      zaehlung = { laedt: false, vorschau: bekannt.get(schluessel) };
      uebernehme(zaehlung.vorschau);
      zeichneEmpfaenger();
      return;
    }
    zaehlung = { laedt: true, vorschau: null };
    uebernehme(null);
    zeichneEmpfaenger();
    timer = setTimeout(async () => {
      try {
        const vorschau = await anfrage("POST", `${API}/vorschau`, wahl);
        bekannt.set(schluessel, vorschau);
        if (mein !== nummer) return;
        zaehlung = { laedt: false, vorschau };
        uebernehme(vorschau);
      } catch (f) {
        if (mein !== nummer) return;
        zaehlung = { laedt: false, vorschau: null, fehler: fehlertext(f) };
      }
      zeichneEmpfaenger();
    }, 250);
  };

  // ===== Ziele =====
  const zielListe = el("ul", {
    class: "mt-ziele",
    "aria-label": "Gewählte Ziele",
  });
  const leer = el(
    "p",
    { class: "hilfe mt-leer" },
    "Noch kein Ziel. Suche unten eine Stufe, ein Team, eine Funktion, ein Lager oder einen Anlass.",
  );

  function setzeRollen(ziel) {
    for (const k of ziel.knoepfe) {
      k.knopf.setAttribute(
        "aria-pressed",
        String(ziel.rollen.includes(k.wert)),
      );
    }
    ziel.warnung.hidden = ziel.rollen.length > 0;
    ziel.zeile.classList.toggle("mt-ziel--leer", ziel.rollen.length === 0);
  }

  function fuegeZielHinzu(gruppe) {
    const rollen = rollenFuer(gruppe.typ);
    const ziel = {
      gruppe,
      // Eine Stufe beginnt mit allen Rollen, wie bisher; wer enger will, nimmt ab. Eine andere Gruppe beginnt mit allen Mitgliedern
      rollen: gruppe.typ === "stufe" ? rollen.map(([wert]) => wert) : ["alle"],
      knoepfe: [],
    };
    const gruppeId = neueId("mt-rollen");
    ziel.zahl = el("span", { class: "mt-ziel-zahl" }, "…");
    ziel.warnung = el(
      "p",
      { class: "feld-fehler", hidden: true },
      icon("warnung"),
      "Wähle mindestens eine Rolle, sonst zählt das Ziel nicht.",
    );
    for (const [wert, label] of rollen) {
      const k = el(
        "button",
        {
          type: "button",
          class: "mt-rolle",
          "aria-pressed": "false",
          onclick: () => {
            ziel.rollen = ziel.rollen.includes(wert)
              ? ziel.rollen.filter((r) => r !== wert)
              : [...ziel.rollen, wert];
            setzeRollen(ziel);
            fehler.hidden = true;
            zaehle();
          },
        },
        icon("haken"),
        label,
      );
      ziel.knoepfe.push({ wert, knopf: k });
    }
    const entfernen = knopf("Entfernen", {
      art: "still",
      klein: true,
      kontext: gruppe.name,
      symbol: "schliessen",
      onclick: () => {
        stand.ziele = stand.ziele.filter((z) => z !== ziel);
        ziel.zeile.remove();
        leer.hidden = stand.ziele.length > 0;
        ansage.textContent = `${gruppe.name} entfernt.`;
        zeigeTreffer();
        suche.focus();
        zaehle();
      },
    });
    ziel.zeile = el(
      "li",
      { class: "mt-ziel" },
      el(
        "div",
        { class: "mt-ziel-kopf" },
        el(
          "div",
          { class: "mt-ziel-name-zeile" },
          el("strong", { class: "mt-ziel-name" }, gruppe.name),
          el(
            "ul",
            { class: "chips" },
            chip(typName(gruppe.typ), "stufe", false),
          ),
        ),
        entfernen,
        ziel.zahl,
      ),
      el(
        "div",
        {
          class: "mt-rollen",
          role: "group",
          "aria-label": `Rollen für ${gruppe.name}`,
          id: gruppeId,
        },
        ziel.knoepfe.map((k) => k.knopf),
      ),
      ziel.warnung,
    );
    stand.ziele.push(ziel);
    zielListe.append(ziel.zeile);
    leer.hidden = true;
    setzeRollen(ziel);
    ansage.textContent = `${gruppe.name} hinzugefügt.`;
    zaehle();
  }

  // ===== Suche nach Gruppen (Muster «action-search-bar») =====
  const sucheId = neueId("mt-suche");
  const listeId = `${sucheId}-liste`;
  const suche = el("input", {
    class: "eingabe",
    id: sucheId,
    type: "search",
    role: "combobox",
    autocomplete: "off",
    spellcheck: "false",
    "aria-autocomplete": "list",
    "aria-expanded": "true",
    "aria-controls": listeId,
    placeholder: "Gruppe suchen, zum Beispiel Mat",
  });
  const treffer = el("ul", {
    class: "mt-treffer",
    id: listeId,
    role: "listbox",
    "aria-label": "Gruppen",
  });
  let typFilter = "alle";
  let aktiv = 0;
  let angezeigt = [];
  const zaehleTyp = (typ) =>
    gruppen.filter(
      (g) => !gewaehlt().has(g.id) && (typ === "alle" || g.typ === typ),
    ).length;
  const reiterEintraege = () => [
    { text: "Alle", n: zaehleTyp("alle"), wert: "alle" },
    ...TYPEN.filter(([w]) => gruppen.some((g) => g.typ === w)).map(
      ([wert, mehrzahl]) => ({ text: mehrzahl, n: zaehleTyp(wert), wert }),
    ),
  ];
  const reiter = filterGruppe({
    beschriftung: "Art der Gruppe",
    eintraege: reiterEintraege(),
    wert: "alle",
    beiAenderung: (wert) => {
      typFilter = wert;
      aktiv = 0;
      zeigeTreffer();
    },
  });
  const reiterKnoepfe = () => [...reiter.wurzel.querySelectorAll("button")];
  const aktualisiereReiter = () => {
    const eintraege = reiterEintraege();
    reiterKnoepfe().forEach((k, i) => {
      const n = k.querySelector(".n");
      if (n && eintraege[i]) n.textContent = String(eintraege[i].n);
    });
  };

  function zeigeTreffer() {
    angezeigt = filtereGruppen(gruppen, {
      typ: typFilter,
      frage: suche.value,
      gewaehlt: gewaehlt(),
    });
    aktiv = Math.min(aktiv, Math.max(angezeigt.length - 1, 0));
    treffer.replaceChildren();
    if (angezeigt.length === 0) {
      treffer.append(
        el(
          "li",
          { class: "mt-treffer-leer", role: "presentation" },
          gruppen.length === 0
            ? "Es gibt noch keine Gruppen. Lege sie unter «Personen» an."
            : suche.value.trim()
              ? `Keine Gruppe passt zu «${suche.value.trim()}».`
              : "Alle Gruppen dieser Art sind schon gewählt.",
        ),
      );
    }
    angezeigt.forEach((g, i) => {
      const id = `${listeId}-${i}`;
      treffer.append(
        el(
          "li",
          {
            id,
            role: "option",
            class: "mt-treffer-zeile",
            "aria-selected": String(i === aktiv),
            onmousedown: (e) => e.preventDefault(),
            onclick: () => waehle(g),
          },
          el(
            "span",
            { class: "mt-treffer-text" },
            el("strong", {}, g.name),
            el(
              "span",
              { class: "leise" },
              g.typ === "stufe"
                ? typName(g.typ)
                : `${typName(g.typ)} · ${mitglieder(g.anzahlPersonen)}`,
            ),
          ),
          icon("plus"),
        ),
      );
    });
    if (angezeigt[aktiv]) {
      suche.setAttribute("aria-activedescendant", `${listeId}-${aktiv}`);
    } else suche.removeAttribute("aria-activedescendant");
    aktualisiereReiter();
  }
  function waehle(g) {
    if (!g) return;
    fuegeZielHinzu(g);
    zeigeTreffer();
    suche.focus();
  }
  const markiere = (neu) => {
    aktiv = neu;
    treffer.querySelectorAll("[role=option]").forEach((o, i) => {
      o.setAttribute("aria-selected", String(i === aktiv));
    });
    suche.setAttribute("aria-activedescendant", `${listeId}-${aktiv}`);
    treffer.children[aktiv]?.scrollIntoView?.({ block: "nearest" });
  };
  suche.addEventListener("input", () => {
    aktiv = 0;
    zeigeTreffer();
  });
  suche.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && angezeigt.length > 0) {
      e.preventDefault();
      markiere((aktiv + 1) % angezeigt.length);
    } else if (e.key === "ArrowUp" && angezeigt.length > 0) {
      e.preventDefault();
      markiere((aktiv - 1 + angezeigt.length) % angezeigt.length);
    } else if (e.key === "Enter") {
      // Enter in der Suche wählt die markierte Gruppe, es sendet nicht
      e.preventDefault();
      waehle(angezeigt[aktiv]);
    } else if (e.key === "Escape" && suche.value) {
      suche.value = "";
      aktiv = 0;
      zeigeTreffer();
    }
  });
  zeigeTreffer();

  // «Alle» schliesst die Ziele aus: Die Auswahl ist dann ausgeblendet, die Ziele bleiben aber erhalten, bis die Person sie entfernt
  const alle = ankreuzen({
    label: "Alle aktiven Konten der Abteilung",
    wert: "alle",
  });
  const zielBlock = el(
    "div",
    { class: "mt-block" },
    zielListe,
    leer,
    el(
      "div",
      { class: "mt-suche" },
      el("label", { class: "legende", for: sucheId }, "Gruppe hinzufügen"),
      el("div", { class: "suche" }, icon("lupe"), suche),
      reiter.wurzel,
      treffer,
    ),
  );
  alle.eingabe.addEventListener("change", () => {
    stand.alle = alle.eingabe.checked;
    zielBlock.hidden = stand.alle;
    fehler.hidden = true;
    zaehle();
  });

  const senden = el(
    "button",
    { type: "submit", class: "knopf knopf--haupt" },
    icon("glocke"),
    "Senden",
  );
  const empfaengerKarte = el(
    "fieldset",
    { class: "mt-empfaenger-wahl" },
    el("legend", {}, "Empfänger"),
    el(
      "p",
      { class: "hilfe" },
      "Wähle eine oder mehrere Gruppen und lege je Gruppe fest, wen du erreichen willst: bei einer Stufe die Kinder (über ihre Eltern), die Leitenden und die Stufenleitung, bei allen anderen Gruppen alle Mitglieder oder die Verantwortlichen.",
    ),
    alle.wurzel,
    zielBlock,
  );

  const formular = el(
    "form",
    { class: "formular karte mitteilung", novalidate: true },
    titel.wurzel,
    beschreibung.wurzel,
    empfaengerKarte,
    fehler,
    el("div", { class: "dialog-knoepfe" }, senden),
    ansage,
  );

  const vorschau = [
    el(
      "div",
      { class: "mt-push", "aria-hidden": "true" },
      el("p", { class: "mt-push-app" }, "Cevi OS"),
      pushTitel,
      pushText,
    ),
    el(
      "div",
      { class: "mt-empf" },
      el("h3", { class: "mt-empf-titel" }, "Das erreichst du"),
      gesamt,
      gesamtListe,
      hinweisDoppelt,
    ),
    el(
      "p",
      { class: "hilfe" },
      "Der Push geht an aktive Konten. Wer «Mitteilungen» in der App ausgeschaltet hat, bekommt ihn nicht. Namen von Kindern siehst du hier nie: Kinder erreichst du nur über ihre Eltern.",
    ),
  ];
  zeichneEmpfaenger();

  // Eine gesendete Mitteilung lässt sich nicht zurückholen und trifft sofort andere: kein Rückgängig mit Frist, sondern zwei Stufen im Knopf statt eines Popups (#578)
  const zweiter = zweiStufig(senden);

  formular.addEventListener("submit", (ereignis) => {
    ereignis.preventDefault();
    fehler.hidden = true;
    for (const alt of titel.wurzel.querySelectorAll(".feld-fehler"))
      alt.remove();
    titel.eingabe.removeAttribute("aria-invalid");
    const text = titel.eingabe.value.trim();
    if (!text) {
      const meldung = el(
        "p",
        {
          class: "feld-fehler",
          id: `${titel.eingabe.id}-fehler`,
          role: "alert",
        },
        "Bitte ausfüllen.",
      );
      titel.wurzel.append(meldung);
      titel.eingabe.setAttribute("aria-invalid", "true");
      titel.eingabe.focus();
      return;
    }
    const wahl = wahlAnfrage(stand);
    if (!wahl) {
      zeigeFehler(
        stand.ziele.length === 0
          ? "Wähle «Alle aktiven Konten» oder mindestens eine Gruppe."
          : "Jedes Ziel braucht mindestens eine Rolle.",
      );
      return;
    }
    if (zaehlung?.laedt) {
      zeigeFehler("Einen Moment: Die Zahl der Konten wird noch ermittelt.");
      return;
    }
    const konten = zaehlung?.vorschau?.empfaenger;
    if (konten === 0) {
      zeigeFehler(
        "Diese Wahl erreicht niemanden: Es gibt dort keine aktiven Konten mit eingeschalteten Mitteilungen.",
      );
      return;
    }
    const beschreibungText = beschreibung.eingabe.value.trim();
    const body = {
      titel: text,
      ...(beschreibungText && { beschreibung: beschreibungText }),
      ...wahl,
    };
    const wohin = stand.alle
      ? "alle aktiven Konten"
      : stand.ziele.length === 1
        ? zielText(stand.ziele[0])
        : `${stand.ziele.length} Ziele`;
    // Ändert sich der Text der Frage (andere Empfänger oder Zahl), gilt der nächste Klick wieder als erster
    zweiter.verlange(
      `Wirklich an ${konten === undefined ? wohin : `${kontenText(konten)} (${wohin})`} senden?`,
      async () => {
        senden.disabled = true;
        senden.setAttribute("aria-busy", "true");
        try {
          const ergebnis = await anfrage("POST", API, body);
          titel.eingabe.value = "";
          beschreibung.eingabe.value = "";
          zeichnePush();
          ctx.melde(
            `Mitteilung gesendet an ${kontenText(ergebnis.empfaenger)}.`,
          );
        } catch (f) {
          zeigeFehler(fehlertext(f));
        } finally {
          senden.disabled = false;
          senden.removeAttribute("aria-busy");
        }
      },
      JSON.stringify(body),
    );
  });

  // Zwei Spalten ohne eigene Scrollbereiche (Vorgabe des Formularrasters): Die Vorschau bleibt beim Scrollen stehen
  bereich.append(
    formularRaster({
      felder: formular,
      seite: vorschau,
      seiteTitel: "Vorschau",
    }),
  );
}

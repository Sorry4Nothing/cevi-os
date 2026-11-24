import { anfrage, fehlertext } from "./api.js";
import { datumZeitFeld } from "./datumsfeld.js";
import {
  ankreuzen,
  chip,
  dialogFormular,
  el,
  feld,
  knopf,
  neueId,
  zeit,
} from "./dom.js";
import { BEREICHE, GEAENDERT } from "./hinweisband.js";
import { zweistufig } from "./rueckgaengig.js";

// Bereich «Plattform» (#424 Wartungsmodus, #425 Informationssperre): Schalter je Bereich setzen und aufheben. Wer hier schalten darf, sagt der Server (GET /api/v1/plattform/schalter: «bereiche», «darfSperre»); jede Schaltung prüft er selbst.
// Was gerade gilt, zeigt auf jeder Seite der Verwaltung das Hinweisband (hinweisband.js); nach einer Schaltung fragt es den neuen Stand.
export function zeige(bereich, ctx) {
  ctx.lade(
    () => anfrage("GET", "/api/v1/plattform/schalter"),
    (daten, neu) =>
      zeichne(bereich, ctx, daten, () => {
        neu();
        document.dispatchEvent(new window.Event(GEAENDERT));
      }),
  );
}

// «2026-11-23T21:00» (lokale Zeit) -> ISO mit Zeitzone; leer -> null
const alsIso = (wert) => (wert ? new Date(wert).toISOString() : null);
// ISO -> «2026-11-23T21:00» in lokaler Zeit, der Wert des Datum-Zeit-Feldes
function alsLokal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const zweistellig = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}T${zweistellig(d.getHours())}:${zweistellig(d.getMinutes())}`;
}

function wartungDialog({ eintrag, schalter, ctx, neu }) {
  const [schluessel, name] = eintrag;
  const hinweis = feld({
    label: "Hinweistext",
    wert: schalter?.hinweis ?? "",
    mehrzeilig: true,
    rows: 3,
    maxlength: 500,
    hilfe:
      "Diesen Text sehen Personen, die in dieser Zeit etwas ändern wollen. Zum Beispiel «Wir spielen ein Update ein.» Keine Namen schreiben.",
  });
  const ende = datumZeitFeld({
    label: "Geplantes Ende (optional)",
    wert: alsLokal(schalter?.ende),
    hilfe:
      "Nur eine Angabe für die Anzeige. Die Wartung endet erst, wenn du sie aufhebst.",
  });
  // Ein Datum ohne Uhrzeit (oder umgekehrt) wäre sonst stillschweigend leer: Das Feld sagt es
  const endeFehler = el("p", {
    class: "feld-fehler",
    role: "alert",
    hidden: true,
  });
  ende.wurzel.append(endeFehler);
  const pruefeEnde = () => {
    const teile = [...ende.wurzel.querySelectorAll("input.eingabe")];
    const unklar =
      (teile.some((t) => t.value) && !teile.every((t) => t.value)) ||
      teile.some((t) => t.getAttribute("aria-invalid") === "true");
    endeFehler.hidden = !unklar;
    if (unklar) {
      endeFehler.textContent =
        "Gib Datum und Uhrzeit an, zum Beispiel 05.12.2026 und 18:00, oder lass beides leer.";
      teile.find((t) => !t.value || t.getAttribute("aria-invalid"))?.focus();
    }
    return unklar;
  };
  dialogFormular({
    titel: schalter
      ? `Wartung ändern: ${name}`
      : `Wartung einschalten: ${name}`,
    beschreibung:
      "Der Bereich ist dann nur lesbar: Ansehen geht, jede Änderung und jede Bearbeitungsansicht ist gesperrt. Abteilungsleitung und Entwickler arbeiten weiter.",
    felder: [hinweis.wurzel, ende.wurzel],
    ok: schalter ? "Speichern" : "Wartung einschalten",
    pruefe: pruefeEnde,
    senden: () =>
      anfrage("PUT", "/api/v1/plattform/schalter", {
        art: "wartung",
        bereich: schluessel,
        hinweis: hinweis.eingabe.value.trim() || null,
        ende: alsIso(ende.eingabe.value),
      }),
    danach: () => {
      neu();
      ctx.melde(
        schalter
          ? "Gespeichert."
          : `${name} ist in Wartung und nur noch lesbar.`,
      );
    },
  });
}

// Aufheben wirkt sofort auf alle (Bereich wieder benutzbar) und lässt sich nicht verzögern: zwei Stufen im Knopf statt eines Popups (#578)
async function wartungAufheben(eintrag, ctx, neu) {
  const [schluessel, name] = eintrag;
  try {
    await anfrage(
      "DELETE",
      `/api/v1/plattform/schalter?art=wartung&bereich=${schluessel}`,
    );
    neu();
    ctx.melde(`${name} ist wieder frei und ganz benutzbar.`);
  } catch (f) {
    ctx.melde(fehlertext(f), "fehler");
  }
}

function sperreDialog({ eintrag, daten, ctx, neu }) {
  const [schluessel, name] = eintrag;
  const hinweis = feld({
    label: "Notiz (optional)",
    mehrzeilig: true,
    rows: 3,
    maxlength: 500,
    hilfe:
      "Nur für Entwickler und Abteilungsleitung sichtbar, zum Beispiel der Anlass. Alle anderen sehen nur «vorübergehend nicht verfügbar». Keine Namen schreiben.",
  });
  const sitzungen = ankreuzen({
    label: "Alle Sitzungen der Abteilung beenden (deine bleibt)",
  });
  // Nur, wo es eine Website gibt, die sich vom Netz nehmen lässt
  const website = ankreuzen({
    label: "Öffentliche Website vom Netz nehmen",
  });
  const mitWebsite =
    daten.websiteVorhanden &&
    (schluessel === "website" || schluessel === "alles");
  dialogFormular({
    titel: `Informationssperre auslösen: ${name}`,
    beschreibung:
      "Die API liefert dann keine Inhalte dieses Bereichs mehr (423), auch nicht der Abteilungsleitung. Nur Entwickler und Abteilungsleitung heben die Sperre wieder auf.",
    felder: [
      hinweis.wurzel,
      sitzungen.wurzel,
      ...(mitWebsite ? [website.wurzel] : []),
    ],
    ok: "Informationssperre auslösen",
    gefaehrlich: true,
    senden: () =>
      anfrage("PUT", "/api/v1/plattform/schalter", {
        art: "sperre",
        bereich: schluessel,
        hinweis: hinweis.eingabe.value.trim() || null,
        sitzungenBeenden: sitzungen.eingabe.checked,
        websiteOffline: mitWebsite && website.eingabe.checked,
      }),
    danach: (antwort) => {
      neu();
      const teile = [`${name} ist gesperrt.`];
      if (antwort?.sitzungenBeendet != null) {
        teile.push(`${antwort.sitzungenBeendet} Sitzungen beendet.`);
      }
      if (antwort?.websiteOffline) {
        teile.push(
          antwort.websiteVomNetz
            ? "Die öffentliche Website ist vom Netz."
            : "Die öffentliche Website liess sich nicht vom Netz nehmen. Prüfe sie von Hand.",
        );
      }
      ctx.melde(
        teile.join(" "),
        antwort?.websiteOffline && !antwort.websiteVomNetz ? "fehler" : "ok",
      );
    },
  });
}

async function sperreAufheben(eintrag, ctx, neu) {
  const [schluessel, name] = eintrag;
  try {
    await anfrage(
      "DELETE",
      `/api/v1/plattform/schalter?art=sperre&bereich=${schluessel}`,
    );
    neu();
    ctx.melde(
      `${name} ist wieder freigegeben. Der Bereich liefert sofort wieder Inhalte, beendete Sitzungen kommen nicht zurück.`,
    );
  } catch (f) {
    ctx.melde(fehlertext(f), "fehler");
  }
}

// Eine Zeile je Bereich: Name, Zustand (Wort und Symbol, nie nur Farbe), Einzelheiten und die Aktionen. Auf schmalen Bildschirmen stehen die Aktionen unter dem Text, es gibt keine Tabelle zum Seitwärtsscrollen.
// art: «wartung» oder «sperre»
function schalterListe({ art, eintraege, schalter, ctx, daten, neu }) {
  const istSperre = art === "sperre";
  const nachBereich = new Map(
    schalter.filter((s) => s.art === art).map((s) => [s.bereich, s]),
  );
  return el(
    "ul",
    {
      class: "sch-liste",
      "aria-label": istSperre
        ? "Informationssperre je Bereich"
        : "Wartungsmodus je Bereich",
    },
    eintraege.map((eintrag) => {
      const [schluessel, name, beschreibung] = eintrag;
      const aktiv = nachBereich.get(schluessel);
      const aktionen = aktiv
        ? [
            !istSperre &&
              knopf("Ändern", {
                klein: true,
                symbol: "bearbeiten",
                kontext: name,
                onclick: () =>
                  wartungDialog({ eintrag, schalter: aktiv, ctx, neu }),
              }),
            zweistufig(
              knopf("Aufheben", {
                klein: true,
                symbol: "haken",
                kontext: name,
              }),
              istSperre ? "Sperre wirklich aufheben?" : "Wirklich aufheben?",
              () =>
                (istSperre ? sperreAufheben : wartungAufheben)(
                  eintrag,
                  ctx,
                  neu,
                ),
            ),
          ]
        : [
            istSperre
              ? knopf("Sperren", {
                  klein: true,
                  symbol: "sperre",
                  kontext: name,
                  onclick: () => sperreDialog({ eintrag, daten, ctx, neu }),
                })
              : knopf("Einschalten", {
                  klein: true,
                  symbol: "uhr",
                  kontext: name,
                  onclick: () =>
                    wartungDialog({ eintrag, schalter: aktiv, ctx, neu }),
                }),
          ];
      return el(
        "li",
        { class: `sch-zeile${aktiv ? ` sch-zeile--${art}` : ""}` },
        el(
          "div",
          { class: "sch-text" },
          el("p", { class: "name" }, name),
          el("p", { class: "meta klein" }, beschreibung),
          aktiv && [
            aktiv.hinweis && el("p", { class: "klein" }, aktiv.hinweis),
            el(
              "p",
              { class: "meta klein" },
              [
                `Seit ${zeit(aktiv.ausgeloestAm)}`,
                istSperre
                  ? aktiv.websiteOffline && "Öffentliche Website vom Netz"
                  : aktiv.ende
                    ? `Geplantes Ende ${zeit(aktiv.ende)}`
                    : "Kein Ende angegeben",
              ]
                .filter(Boolean)
                .join(" · "),
            ),
          ],
        ),
        el(
          "ul",
          { class: "chips sch-zustand" },
          aktiv
            ? istSperre
              ? chip("Gesperrt", "fehler", "sperre")
              : chip("In Wartung", "warn", "uhr")
            : chip(istSperre ? "Offen" : "Frei", "ok"),
        ),
        el("div", { class: "aktionen sch-aktionen" }, aktionen),
      );
    }),
  );
}

function abschnitt(titel, text, ...inhalt) {
  const id = neueId("plattform");
  return el(
    "section",
    { class: "spalte", "aria-labelledby": id },
    el("h2", { id }, titel),
    el("p", { class: "meta" }, text),
    ...inhalt,
  );
}

function zeichne(bereich, ctx, daten, neu) {
  const alleBereiche = BEREICHE.filter(([s]) => daten.bereiche.includes(s));
  const teile = (art) => ({
    art,
    eintraege: alleBereiche,
    schalter: daten.schalter,
    ctx,
    daten,
    neu,
  });
  const nichts = daten.schalter.length === 0;
  bereich.append(
    el(
      "div",
      { class: `hinweis hinweis--${nichts ? "ok" : "warn"}`, role: "status" },
      nichts
        ? "Alles läuft normal: Kein Bereich ist in Wartung oder gesperrt."
        : `Es gilt gerade ${daten.schalter.length === 1 ? "eine Schaltung" : `${daten.schalter.length} Schaltungen`}. Sie stehen oben auf jeder Seite der Verwaltung.`,
    ),
    abschnitt(
      "Wartungsmodus",
      "Im Wartungsmodus ist ein Bereich nur lesbar. Schreibende Anfragen und Bearbeitungsansichten antworten mit dem Hinweistext; Abteilungsleitung und Entwickler arbeiten weiter.",
      schalterListe(teile("wartung")),
    ),
  );
  if (!daten.darfSperre) return;
  bereich.append(
    abschnitt(
      "Informationssperre",
      "Bei einem Vorfall, zum Beispiel einer Datenpanne, liefert ein gesperrter Bereich keine Inhalte mehr, auch nicht der Abteilungsleitung. Nur diese Seite bleibt offen: Hier hebst du die Sperre wieder auf. Wer die Verwaltung nicht mehr erreicht, meldet sich an und öffnet diese Seite.",
      schalterListe(teile("sperre")),
    ),
  );
}

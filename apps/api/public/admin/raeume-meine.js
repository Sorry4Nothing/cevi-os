import { anfrage, fehlertext } from "./api.js";
import { auswahl, chip, el, feld, knopf, seitenblatt } from "./dom.js";
import { datumZeitFeld } from "./datumsfeld.js";
import { zweistufig } from "./rueckgaengig.js";
import {
  ZONE,
  entferneFeldFehler,
  feldFehler,
  pruefHinweis,
  terminAnzeige,
  ersetze,
  termineTabelle,
} from "./kalenderhilfen.js";
import { leerKarte } from "./zustaende.js";

// Unterseite «Meine Anfragen» (#671): einen Raum anfragen und die eigenen Anfragen ansehen und zurückziehen. Dasselbe wie «Raum anfragen» und «Meine Raumanfragen» in der App, über dieselben Routen: GET /api/v1/raeume, POST /api/v1/raeume/{id}/anfragen, GET /api/v1/raeume/anfragen/meine, DELETE /api/v1/raeume/anfragen/{id}.
// Jede Person mit Zugang zur Verwaltung darf anfragen; über die Anfrage entscheidet das Team des Raums oder die Abteilungsleitung (Unterseite «Anfragen»). Cevi OS schreibt nie nach Outlook.
// Datenbanklast: beim Öffnen zwei Abfragen (Räume, eigene Anfragen, je bis 100 und 50), je Anfrage eine, je Zurückziehen eine; danach lädt die Liste neu. Kein Polling.
// Die Zeiten gelten in Zürcher Zeit, unabhängig vom Gerät.

const RAEUME = "/api/v1/raeume";
const ANFRAGEN = "/api/v1/raeume/anfragen";
export const MAX_TAGE = 14;
export const MAX_ZWECK = 200;

const TEXTE = {
  RAUM_BELEGT:
    "Der Raum ist in dieser Zeit schon gebucht. Wähle eine andere Zeit oder einen anderen Raum.",
  ANFRAGE_LIMIT:
    "Du hast schon zu viele offene Anfragen. Warte auf den Entscheid oder ziehe eine zurück.",
  ZEIT_VERGANGEN: "Die Zeit muss in der Zukunft beginnen.",
  ZEIT_ZU_LANG: `Eine Anfrage darf höchstens ${MAX_TAGE} Tage dauern.`,
  STATUS_UNGUELTIG:
    "Über diese Anfrage ist schon entschieden. Die Liste ist neu geladen.",
};
const meldungVon = (f) =>
  f?.status === 429
    ? "Zu viele Anfragen in kurzer Zeit. Warte ein paar Minuten und versuche es nochmals."
    : (TEXTE[f?.code] ?? fehlertext(f));

// Zürcher Wandzeit («2027-02-06», «14:00») als UTC-Zeitpunkt (ISO), mit Sommer- und Winterzeit
export function zuerichZuIso(tag, zeit) {
  const [y, mo, d] = tag.split("-").map(Number);
  const [h, mi] = zeit.split(":").map(Number);
  const naiv = Date.UTC(y, mo - 1, d, h, mi);
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const versatz = (ms) => {
    const p = Object.fromEntries(
      format.formatToParts(ms).map((t) => [t.type, t.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms;
  };
  let t = naiv - versatz(naiv);
  t = naiv - versatz(t);
  return new Date(t).toISOString();
}

// Prüfung der Eingaben vor dem Senden: Liste von { feld, text } oder der Körper für die API. jetzt: Zeitpunkt in ms
export function pruefeAnfrage({ raumId, beginn, ende, zweck }, jetzt) {
  const fehler = [];
  if (!raumId) fehler.push({ feld: "raum", text: "Wähle einen Raum." });
  const zweckText = zweck.trim();
  if (!zweckText) {
    fehler.push({
      feld: "zweck",
      text: "Schreibe, wofür du den Raum brauchst.",
    });
  } else if (zweckText.length > MAX_ZWECK) {
    fehler.push({
      feld: "zweck",
      text: `Höchstens ${MAX_ZWECK} Zeichen. Du hast ${zweckText.length - MAX_ZWECK} zu viel.`,
    });
  }
  if (!beginn)
    fehler.push({
      feld: "beginn",
      text: "Gib Datum und Uhrzeit des Beginns ein.",
    });
  if (!ende)
    fehler.push({ feld: "ende", text: "Gib Datum und Uhrzeit des Endes ein." });
  if (beginn && ende) {
    const von = Date.parse(zuerichZuIso(...beginn.split("T")));
    const bis = Date.parse(zuerichZuIso(...ende.split("T")));
    if (von <= jetzt) {
      fehler.push({ feld: "beginn", text: TEXTE.ZEIT_VERGANGEN });
    } else if (bis <= von) {
      fehler.push({
        feld: "ende",
        text: "Das Ende muss nach dem Beginn liegen.",
      });
    } else if (bis - von > MAX_TAGE * 864e5) {
      fehler.push({ feld: "ende", text: TEXTE.ZEIT_ZU_LANG });
    }
  }
  if (fehler.length > 0) return { fehler };
  return {
    body: {
      beginn: zuerichZuIso(...beginn.split("T")),
      ende: zuerichZuIso(...ende.split("T")),
      zweck: zweckText,
    },
  };
}

const STATUS = {
  angefragt: ["Angefragt", "warn", "uhr"],
  bestaetigt: ["Bestätigt", "ok", "haken"],
  abgelehnt: ["Abgelehnt", "fehler", "schliessen"],
  storniert: ["Zurückgezogen", undefined, "schliessen"],
};

export function zeige(bereich, ctx) {
  const lade = () =>
    ctx.lade(
      async () => {
        const [raeume, meine] = await Promise.all([
          anfrage("GET", `${RAEUME}?limit=100`),
          anfrage("GET", `${ANFRAGEN}/meine?limit=50`),
        ]);
        return { raeume: raeume.raeume, meine };
      },
      (daten) => zeichne(bereich, ctx, daten, lade),
      { fehlerTitel: "Deine Raumanfragen konnten nicht geladen werden." },
    );
  return lade();
}

function zeichne(bereich, ctx, { raeume, meine }, neu) {
  const anfragen = meine.anfragen;
  if (raeume.length > 0) {
    ctx.kopfAktion(
      knopf("Raum anfragen", {
        art: "haupt",
        symbol: "plus",
        onclick: () => blatt({ ctx, raeume, neu }),
      }),
    );
  }
  const liste = el("div", {});
  const mehr = el(
    "p",
    { class: "klein leise" },
    meine.weitere
      ? "Es gibt ältere Anfragen. Gezeigt werden die neusten 50."
      : "",
  );

  if (raeume.length === 0) {
    ersetze(
      liste,
      leerKarte("Die Abteilung hat noch keinen Raum, den du anfragen kannst."),
    );
  } else if (anfragen.length === 0) {
    ersetze(
      liste,
      leerKarte(
        "Du hast noch keinen Raum angefragt. Mit «Raum anfragen» legst du los.",
      ),
    );
  } else {
    const t = termineTabelle({
      beschriftung: "Meine Raumanfragen",
      spalten: ["Wofür", "Raum", "Zeitraum", "Status", "Aktion"],
      zeilen: anfragen.map((a) => zeile(a)),
    });
    ersetze(liste, t.wurzel);
  }

  function zeile(a) {
    const [text, art, symbol] = STATUS[a.status] ?? [a.status];
    const zeit = terminAnzeige({
      ganztaegig: false,
      beginn: a.beginn,
      ende: a.ende,
    });
    // Zurückziehen geht, solange die Zeit nicht vorbei ist und die Anfrage nicht abgelehnt oder schon zurückgezogen ist
    const offen =
      (a.status === "angefragt" || a.status === "bestaetigt") &&
      Date.parse(a.ende) > Date.now();
    const ziehen = offen
      ? zweistufig(
          knopf("Zurückziehen", { symbol: "papierkorb" }),
          a.status === "bestaetigt"
            ? "Buchung wirklich zurückziehen?"
            : "Wirklich zurückziehen?",
          async () => {
            try {
              await anfrage("DELETE", `${ANFRAGEN}/${a.id}`);
            } catch (f) {
              ctx.melde(`Nicht zurückgezogen. ${meldungVon(f)}`, "fehler");
              if (f?.code === "STATUS_UNGUELTIG") await neu();
              return;
            }
            ctx.melde(`Anfrage «${a.zweck}» zurückgezogen.`, "ok");
            await neu();
            document.querySelector("h1")?.focus();
          },
        )
      : null;
    return el(
      "tr",
      {},
      el(
        "th",
        { scope: "row" },
        el("span", { class: "name" }, a.zweck),
        a.status === "abgelehnt" &&
          a.begruendung &&
          el(
            "span",
            { class: "klein leise tm-zeit" },
            `Grund: ${a.begruendung}`,
          ),
      ),
      el("td", {}, a.raumName),
      el("td", { class: "tm-ziffern" }, `${zeit.tag}, ${zeit.zeit}`),
      el("td", {}, el("ul", { class: "chips" }, chip(text, art, symbol))),
      el("td", {}, ziehen),
    );
  }

  bereich.append(el("div", {}, liste, mehr));
}

// Das Blatt «Raum anfragen»; neu lädt die Liste nach dem Senden
function blatt({ ctx, raeume, neu }) {
  const raum = auswahl({
    label: "Raum",
    optionen: [["", "Wähle einen Raum"], ...raeume.map((r) => [r.id, r.name])],
    wert: "",
  });
  const beginn = datumZeitFeld({ label: "Beginn" });
  const ende = datumZeitFeld({
    label: "Ende",
    hilfe: `Höchstens ${MAX_TAGE} Tage nach dem Beginn.`,
  });
  const zweck = feld({
    label: "Wofür brauchst du den Raum?",
    hilfe:
      "Zum Beispiel «Sitzung Leitungsteam». Das Team sieht das bei der Anfrage.",
    maxlength: MAX_ZWECK + 50,
    autocomplete: "off",
  });
  const meldungsfeld = el("div", {});
  const formular = el(
    "form",
    { class: "formular", novalidate: true, id: "rm-formular" },
    meldungsfeld,
    raum.wurzel,
    beginn.wurzel,
    ende.wurzel,
    zweck.wurzel,
  );
  const senden = knopf("Anfragen", { art: "haupt", type: "submit" });
  senden.setAttribute("form", "rm-formular");
  const abbrechen = knopf("Abbrechen", {
    onclick: () => dialog.versuchSchliessen(),
  });
  const dialog = seitenblatt({
    titel: "Raum anfragen",
    untertitel: "Das Team des Raums bestätigt oder lehnt ab.",
    inhalt: formular,
    fusszeile: [abbrechen, senden],
  });
  const felder = { raum, beginn, ende, zweck };
  const sperre = (an) => {
    zweck.eingabe.readOnly = an;
    senden.disabled = abbrechen.disabled = an;
    if (an) senden.setAttribute("aria-busy", "true");
    else senden.removeAttribute("aria-busy");
  };

  formular.addEventListener("submit", async (e) => {
    e.preventDefault();
    entferneFeldFehler(formular);
    ersetze(meldungsfeld);
    const r = pruefeAnfrage(
      {
        raumId: raum.eingabe.value,
        beginn: beginn.eingabe.value,
        ende: ende.eingabe.value,
        zweck: zweck.eingabe.value,
      },
      Date.now(),
    );
    if (r.fehler) {
      const namen = {
        raum: "Raum",
        beginn: "Beginn",
        ende: "Ende",
        zweck: "Wofür",
      };
      for (const f of r.fehler) feldFehler(felder[f.feld], f.text);
      const hinweis = pruefHinweis(
        r.fehler.map((f) => ({
          name: namen[f.feld],
          eingabe: felder[f.feld].eingabe,
        })),
      );
      ersetze(meldungsfeld, hinweis);
      hinweis.focus();
      return;
    }
    sperre(true);
    try {
      await anfrage("POST", `${RAEUME}/${raum.eingabe.value}/anfragen`, r.body);
    } catch (f) {
      sperre(false);
      const hinweis = el(
        "div",
        { class: "hinweis hinweis--fehler", role: "alert", tabindex: "-1" },
        `Nicht gesendet. ${meldungVon(f)} Deine Eingaben sind noch da.`,
      );
      ersetze(meldungsfeld, hinweis);
      hinweis.focus();
      return;
    }
    dialog.close();
    ctx.melde("Deine Anfrage ist gesendet. Das Team entscheidet.", "ok");
    await neu();
    document.querySelector("h1")?.focus();
  });
}

import { anfrage, fehlertext } from "./api.js";
import { zeitfeld } from "./datumsfeld.js";
import {
  ankreuzen,
  auswahl,
  chip,
  dialogFormular,
  el,
  feld,
  knopf,
  neueId,
} from "./dom.js";
import { ansichtVonKnopf } from "./rueckgaengig.js";

// Erinnerungen (Zeitregeln): Pushes an Eltern, die für ein Programm noch nicht zu- oder abgesagt haben. Wochentag und Uhrzeit wählt die Person im Zeitplan-Baukasten; darunter steht, wann die Regel die nächsten Male läuft (Muster: «schedule-builder» aus Kokonut UI Pro, selbst gebaut).
// ISO: 1 Montag bis 7 Sonntag, wie in der API
const WOCHENTAGE = [
  [1, "Montag", "Mo"],
  [2, "Dienstag", "Di"],
  [3, "Mittwoch", "Mi"],
  [4, "Donnerstag", "Do"],
  [5, "Freitag", "Fr"],
  [6, "Samstag", "Sa"],
  [7, "Sonntag", "So"],
];
const TAGNAME = new Map(WOCHENTAGE.map(([w, name]) => [w, name]));

// Die Regeln laufen in Schweizer Zeit, unabhängig von der Zeitzone des Geräts
const ZUERICH = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const TAG_KURZ = new Intl.DateTimeFormat("de-CH", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "numeric",
});
const TAG_LANG = new Intl.DateTimeFormat("de-CH", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Die nächsten Termine einer wöchentlichen Regel ab «jetzt» (Schweizer Zeit): [{ tag: Date um Mitternacht UTC, uhrzeit }]. Ein Termin von heute zählt nur, wenn die Uhrzeit noch nicht vorbei ist. Ungültige Uhrzeit oder Wochentag: leer.
export function naechsteTermine(
  wochentag,
  uhrzeit,
  jetzt = new Date(),
  anzahl = 6,
) {
  const zeit = /^(\d{2}):(\d{2})$/.exec(uhrzeit ?? "");
  if (!zeit || !(wochentag >= 1 && wochentag <= 7)) return [];
  const teile = Object.fromEntries(
    ZUERICH.formatToParts(jetzt).map((t) => [t.type, Number(t.value)]),
  );
  const heute = Date.UTC(teile.year, teile.month - 1, teile.day);
  const jetztMin = teile.hour * 60 + teile.minute;
  const zielMin = Number(zeit[1]) * 60 + Number(zeit[2]);
  const ergebnis = [];
  for (let i = 0; ergebnis.length < anzahl && i < 7 * anzahl + 8; i++) {
    const tag = new Date(heute + i * 86_400_000);
    const iso = ((tag.getUTCDay() + 6) % 7) + 1;
    if (iso === wochentag && (i > 0 || zielMin > jetztMin)) {
      ergebnis.push({ tag, uhrzeit });
    }
  }
  return ergebnis;
}

export function zeige(bereich, ctx) {
  ctx.lade(
    async () => {
      const [regeln, stufen] = await Promise.all([
        anfrage("GET", "/api/v1/admin/zeitregeln"),
        anfrage("GET", "/api/v1/stufen"),
      ]);
      return { regeln: regeln.regeln, stufen: stufen.stufen };
    },
    (daten, neu) => zeichne(bereich, ctx, daten, neu),
  );
}

// Wochentag als Segment mit Radioknöpfen: sichtbar «Mo», vorgelesen «Montag»
function wochentagWahl(wert) {
  const name = neueId("wochentag");
  const eingaben = [];
  const eintraege = WOCHENTAGE.flatMap(([w, lang, kurz]) => {
    const id = neueId("wochentag-option");
    const eingabe = el("input", { type: "radio", id, name, value: String(w) });
    eingabe.checked = w === wert;
    eingaben.push(eingabe);
    return [
      eingabe,
      el(
        "label",
        { for: id },
        kurz,
        el("span", { class: "nur-leser" }, lang.slice(kurz.length)),
      ),
    ];
  });
  const wurzel = el(
    "fieldset",
    { class: "feld" },
    el("legend", { class: "legende" }, "Wochentag"),
    el("div", { class: "seg zr-tage" }, eintraege),
  );
  return {
    wurzel,
    eingaben,
    wert: () => Number(eingaben.find((e) => e.checked)?.value ?? 0),
  };
}

function dialog({ regel, daten, ctx, neu }) {
  const stufe = auswahl({
    label: "Stufe",
    optionen: [["", "Alle Stufen"], ...daten.stufen.map((s) => [s.id, s.name])],
    wert: regel?.stufeId ?? "",
  });
  const tag = wochentagWahl(regel?.wochentag ?? 3);
  const uhrzeit = zeitfeld({
    label: "Uhrzeit (Schweizer Zeit)",
    wert: regel?.uhrzeit ?? "08:00",
    required: true,
    hilfe:
      "Die Erinnerung geht zum letzten passenden Zeitpunkt vor Programmbeginn.",
  });
  const vorschauId = neueId("vorschau");
  const vorschauListe = el("ol", { class: "zr-vorschau" });
  const vorschau = el(
    "div",
    {
      class: "feld zr-vorschau-feld",
      role: "group",
      "aria-labelledby": vorschauId,
    },
    el(
      "p",
      { id: vorschauId, class: "legende" },
      "Vorschau: die nächsten Termine",
    ),
    vorschauListe,
  );
  const zeichneVorschau = () => {
    const termine = naechsteTermine(tag.wert(), uhrzeit.eingabe.value);
    vorschauListe.replaceChildren(
      ...(termine.length === 0
        ? [
            el(
              "li",
              { class: "zr-leer klein leise" },
              "Wähle einen Wochentag und gib die Uhrzeit ein, dann siehst du hier die nächsten Termine.",
            ),
          ]
        : termine.map((t, i) =>
            el(
              "li",
              {
                class: i === 0 ? "zr-termin zr-termin--naechster" : "zr-termin",
              },
              el("span", { class: "zr-termin-tag" }, TAG_KURZ.format(t.tag)),
              el("span", { class: "zr-termin-zeit" }, `${t.uhrzeit} Uhr`),
            ),
          )),
    );
  };
  for (const e of tag.eingaben) e.addEventListener("change", zeichneVorschau);
  uhrzeit.eingabe.addEventListener("input", zeichneVorschau);
  zeichneVorschau();
  const text = feld({
    label: "Titel der Erinnerung",
    wert: regel?.text ?? "",
    maxlength: 150,
    required: true,
    hilfe:
      "Die fette Zeile des Pushs. {Programm} und {Datum} setzt der Server ein, zum Beispiel «Waldtag am Sa 31.10.: Bitte melde dein Kind an oder ab». Keine Namen schreiben: Der Text läuft über Apple und Google.",
  });
  const beschreibung = feld({
    label: "Beschreibung (optional)",
    wert: regel?.beschreibung ?? "",
    mehrzeilig: true,
    rows: 3,
    maxlength: 300,
    hilfe:
      "Steht unter dem Titel. {Programm} und {Datum} setzt der Server auch hier ein. Keine Namen schreiben.",
  });
  const aktiv = ankreuzen({
    label: "Regel ist eingeschaltet",
    gewaehlt: regel?.aktiv ?? true,
  });
  dialogFormular({
    titel: regel ? "Erinnerung bearbeiten" : "Erinnerung anlegen",
    beschreibung:
      "Erinnert Eltern, die für ein Programm noch nicht zu- oder abgesagt haben. Die Regel läuft jede Woche.",
    felder: [
      stufe.wurzel,
      tag.wurzel,
      uhrzeit.wurzel,
      vorschau,
      text.wurzel,
      beschreibung.wurzel,
      aktiv.wurzel,
    ],
    ok: regel ? "Speichern" : "Anlegen",
    senden: () => {
      const body = {
        stufeId: stufe.eingabe.value || null,
        wochentag: tag.wert(),
        uhrzeit: uhrzeit.eingabe.value,
        text: text.eingabe.value.trim(),
        beschreibung: beschreibung.eingabe.value.trim() || null,
        aktiv: aktiv.eingabe.checked,
      };
      return regel
        ? anfrage("PATCH", `/api/v1/admin/zeitregeln/${regel.id}`, body)
        : anfrage("POST", "/api/v1/admin/zeitregeln", body);
    },
    danach: () => {
      neu();
      ctx.melde(regel ? "Gespeichert." : "Erinnerung ist angelegt.");
    },
  });
}

// Mit «Rückgängig» (#578); schon gesendete Erinnerungen bleiben gesendet
function loeschen(regel, ctx, neu, ereignis) {
  ctx.mitRueckgaengig({
    text: `Erinnerung «${regel.text}» gelöscht`,
    ansicht: ansichtVonKnopf(ereignis),
    ausfuehren: () => anfrage("DELETE", `/api/v1/admin/zeitregeln/${regel.id}`),
    fehlertext,
    danach: neu,
  });
}

function zeichne(bereich, ctx, daten, neu) {
  ctx.kopfAktion(
    knopf("Erinnerung anlegen", {
      art: "haupt",
      symbol: "plus",
      onclick: () => dialog({ daten, ctx, neu }),
    }),
  );
  if (daten.regeln.length === 0) {
    bereich.append(
      el(
        "p",
        { class: "leer" },
        "Es gibt noch keine Erinnerungen. Lege mit «Erinnerung anlegen» die erste an.",
      ),
    );
    return;
  }
  const stufenname = new Map(daten.stufen.map((s) => [s.id, s.name]));
  bereich.append(
    el(
      "p",
      { class: "meta klein", role: "status" },
      daten.regeln.length === 1
        ? "1 Erinnerung"
        : `${daten.regeln.length} Erinnerungen`,
    ),
    el(
      "ul",
      { class: "zr-liste", "aria-label": "Erinnerungen" },
      daten.regeln.map((regel) => {
        const [naechster] = regel.aktiv
          ? naechsteTermine(regel.wochentag, regel.uhrzeit, new Date(), 1)
          : [];
        return el(
          "li",
          { class: regel.aktiv ? "zr-zeile" : "zr-zeile zr-zeile--aus" },
          el(
            "div",
            { class: "zr-text" },
            el("p", { class: "name" }, regel.text),
            el(
              "p",
              { class: "meta klein" },
              `Jeden ${TAGNAME.get(regel.wochentag)}, ${regel.uhrzeit} Uhr`,
              " · ",
              regel.aktiv
                ? naechster
                  ? `nächstes Mal ${TAG_LANG.format(naechster.tag)}`
                  : "kein Termin berechnet"
                : "pausiert",
            ),
          ),
          el(
            "ul",
            { class: "chips zr-chips" },
            chip(
              regel.stufeId
                ? (stufenname.get(regel.stufeId) ?? "Unbekannte Stufe")
                : "Alle Stufen",
              "stufe",
            ),
            regel.aktiv
              ? chip("Ein", "ok")
              : chip("Aus", undefined, "schliessen"),
          ),
          el(
            "div",
            { class: "aktionen" },
            knopf("Bearbeiten", {
              klein: true,
              symbol: "bearbeiten",
              kontext: regel.text,
              onclick: () => dialog({ regel, daten, ctx, neu }),
            }),
            knopf("Löschen", {
              klein: true,
              symbol: "papierkorb",
              kontext: regel.text,
              onclick: (e) => loeschen(regel, ctx, neu, e),
            }),
          ),
        );
      }),
    ),
  );
}

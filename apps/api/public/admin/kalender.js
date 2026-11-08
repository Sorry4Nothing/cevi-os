import { anfrage } from "./api.js";
import {
  aktionenZelle,
  ankreuzen,
  auswahl,
  chip,
  dialogFormular,
  el,
  filterGruppe,
  gruppe,
  knopf,
  tabelle,
} from "./dom.js";

const ZONE = "Europe/Zurich";
// Wie lange die Liste vorausschaut; ältere Programme sind vorbei, spätere stehen meist noch nicht im Kalender
const TAGE_VORAUS = 365;

const SICHTBARKEIT = [
  ["intern", "Für niemanden"],
  ["leitende", "Leitende"],
  ["eltern", "Eltern"],
];
const SICHTBARKEIT_HILFE =
  "«Für niemanden» blendet das Programm in der App aus; hier in der Verwaltung bleibt es sichtbar. «Leitende» sehen auch die Leitenden, «Eltern» zusätzlich die Eltern. Ohne Stufe gilt das Programm für alle Stufen.";

const tagFormat = new Intl.DateTimeFormat("de-CH", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: ZONE,
});
const tagUtc = new Intl.DateTimeFormat("de-CH", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});
const uhrFormat = new Intl.DateTimeFormat("de-CH", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ZONE,
});

// Schweizer Kalendertag als YYYY-MM-DD («sv-SE» liefert das ISO-Format)
const heute = () => new Date().toLocaleDateString("sv-SE", { timeZone: ZONE });
const plusTage = (tag, n) => {
  const wert = new Date(`${tag}T12:00:00Z`);
  wert.setUTCDate(wert.getUTCDate() + n);
  return wert.toISOString().slice(0, 10);
};

// Ganztägige Programme haben nur Tage (tagVon bis tagBis), alle anderen Beginn und Ende als Zeitpunkt
function zeitraum(p) {
  if (p.ganztaegig) {
    const von = tagUtc.format(new Date(`${p.tagVon}T12:00:00Z`));
    if (p.tagVon === p.tagBis) return von;
    return `${von} – ${tagUtc.format(new Date(`${p.tagBis}T12:00:00Z`))}`;
  }
  const beginn = new Date(p.beginn);
  const ende = new Date(p.ende);
  const tag = tagFormat.format(beginn);
  const bis =
    tagFormat.format(ende) === tag
      ? uhrFormat.format(ende)
      : `${tagFormat.format(ende)} ${uhrFormat.format(ende)}`;
  return `${tag}, ${uhrFormat.format(beginn)} – ${bis} Uhr`;
}

export function zeige(bereich, ctx) {
  ctx.lade(
    async () => {
      const von = heute();
      const [programme, stufen] = await Promise.all([
        anfrage(
          "GET",
          `/api/v1/programme?von=${von}&bis=${plusTage(von, TAGE_VORAUS)}&alle=1`,
        ),
        anfrage("GET", "/api/v1/stufen"),
      ]);
      return { programme: programme.programme, stufen: stufen.stufen };
    },
    (daten, neu) => zeichne(bereich, ctx, daten, neu),
  );
}

function dialog({ programm, daten, ctx, neu }) {
  const gewaehlt = new Set(programm.stufen.map((s) => s.id));
  const stufen = daten.stufen.map((s) => ({
    stufe: s,
    ...ankreuzen({ label: s.name, gewaehlt: gewaehlt.has(s.id), wert: s.id }),
  }));
  const sichtbarkeit = auswahl({
    label: "Sichtbar für",
    optionen: SICHTBARKEIT,
    wert: programm.sichtbarkeit,
  });
  dialogFormular({
    titel: "Stufen zuordnen",
    beschreibung: `${programm.titel} · ${zeitraum(programm)}`,
    felder: [
      gruppe(
        "Stufen",
        stufen.map((s) => s.wurzel),
        {
          scrollen: stufen.length > 8,
        },
      ),
      sichtbarkeit.wurzel,
      el("p", { class: "hilfe" }, SICHTBARKEIT_HILFE),
    ],
    ok: "Speichern",
    senden: () => {
      const ids = stufen
        .filter((s) => s.eingabe.checked)
        .map((s) => s.stufe.id);
      return anfrage("PUT", `/api/v1/programme/${programm.id}/zuordnung`, {
        stufen: ids,
        sichtbarkeit: sichtbarkeit.eingabe.value,
      });
    },
    danach: () => {
      neu();
      ctx.melde("Zuordnung ist gespeichert.");
    },
  });
}

function zeile(programm, daten, ctx, neu) {
  const abgesagt = programm.status === "abgesagt";
  return el(
    "tr",
    { class: abgesagt ? "inaktiv" : undefined },
    el(
      "th",
      { scope: "row" },
      el("span", { class: "name" }, programm.titel),
      programm.googleOrt &&
        el("span", { class: "meta klein" }, programm.googleOrt),
    ),
    el("td", {}, zeitraum(programm)),
    el(
      "td",
      {},
      el(
        "ul",
        { class: "chips" },
        programm.stufen.length === 0
          ? chip("Alle Stufen", "stufe")
          : programm.stufen.map((s) => chip(s.name, "stufe")),
      ),
    ),
    el(
      "td",
      {},
      el(
        "ul",
        { class: "chips" },
        chip(
          SICHTBARKEIT.find(([w]) => w === programm.sichtbarkeit)?.[1] ?? "",
          undefined,
          false,
        ),
        programm.status === "abgesagt" && chip("Abgesagt", "fehler"),
        programm.status === "pruefen" && chip("Prüfen", "warn"),
      ),
    ),
    aktionenZelle(
      knopf("Stufen zuordnen", {
        klein: true,
        symbol: "stufen",
        kontext: programm.titel,
        onclick: () => dialog({ programm, daten, ctx, neu }),
      }),
    ),
  );
}

function zeichne(bereich, ctx, daten, neu) {
  if (daten.programme.length === 0) {
    bereich.append(
      el(
        "p",
        { class: "leer" },
        "Im Kalender stehen keine anstehenden Programme.",
      ),
    );
    return;
  }
  const ohneStufe = daten.programme.filter((p) => p.stufen.length === 0);
  const { wurzel, koerper } = tabelle({
    beschriftung: "Anstehende Programme",
    spalten: ["Programm", "Wann", "Stufen", "Status", "Aktionen"],
    zeilen: [],
  });
  const anzahl = el("p", { class: "meta klein", role: "status" });
  function aktualisiere() {
    const liste = filter.wert() === "ohne" ? ohneStufe : daten.programme;
    koerper.replaceChildren(...liste.map((p) => zeile(p, daten, ctx, neu)));
    anzahl.textContent =
      liste.length === 1 ? "1 Programm" : `${liste.length} Programme`;
  }
  const filter = filterGruppe({
    beschriftung: "Zuordnung",
    eintraege: [
      { text: "Alle", n: daten.programme.length, wert: "alle" },
      { text: "Alle Stufen", n: ohneStufe.length, wert: "ohne" },
    ],
    beiAenderung: aktualisiere,
  });
  aktualisiere();
  bereich.append(filter.wurzel, anzahl, wurzel);
}

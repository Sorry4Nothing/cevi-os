// Zeiten eines Programms als Text, immer in Europe/Zurich, egal in welcher Zone das Gerät steht

const datumFormat = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const zeitFormat = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  hour: "2-digit",
  minute: "2-digit",
});
// Ganztägige sind reine Daten: in UTC formatiert, damit kein Zonenversatz den Tag verschiebt
const tagFormat = new Intl.DateTimeFormat("de-CH", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

type Zeitfelder = {
  ganztaegig: boolean;
  beginn: string | null;
  ende: string | null;
  tagVon: string | null;
  tagBis: string | null;
};

function tagAlsDatum(tag: string) {
  const [jahr, monat, tagImMonat] = tag.split("-").map(Number);
  return new Date(Date.UTC(jahr, monat - 1, tagImMonat));
}

export function zeitText(programm: Zeitfelder): string {
  if (programm.ganztaegig) {
    if (!programm.tagVon) return "";
    const von = tagFormat.format(tagAlsDatum(programm.tagVon));
    if (programm.tagBis && programm.tagBis !== programm.tagVon) {
      return `${von} bis ${tagFormat.format(tagAlsDatum(programm.tagBis))}`;
    }
    return von;
  }
  if (!programm.beginn) return "";
  const beginn = new Date(programm.beginn);
  const von = `${datumFormat.format(beginn)}, ${zeitFormat.format(beginn)}`;
  if (!programm.ende) return `${von} Uhr`;
  const ende = new Date(programm.ende);
  if (datumFormat.format(ende) === datumFormat.format(beginn)) {
    return `${von} bis ${zeitFormat.format(ende)} Uhr`;
  }
  return `${von} Uhr bis ${datumFormat.format(ende)}, ${zeitFormat.format(ende)} Uhr`;
}

// schluss_zeit ist eine Wanduhrzeit: HH:MM ohne Umrechnung
export function schlussZeitText(wert: string): string {
  return wert.slice(0, 5);
}

// Der Schweizer Kalendertag als YYYY-MM-DD, z. B. für das Fenster der Programmliste
export function tagInZuerich(datum: Date): string {
  const teile = new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(datum);
  const teil = (typ: Intl.DateTimeFormatPartTypes) =>
    teile.find((t) => t.type === typ)?.value ?? "";
  return `${teil("year")}-${teil("month")}-${teil("day")}`;
}

// Zeitpunkt einer Chat-Nachricht, in Schweizer Zeit und ausgeschrieben, damit der Screenreader sie klar vorliest
const nachrichtDatumFormat = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  day: "numeric",
  month: "long",
});
export function nachrichtZeitText(zeitpunkt: string): string {
  const datum = new Date(zeitpunkt);
  return `${nachrichtDatumFormat.format(datum)}, ${zeitFormat.format(datum)} Uhr`;
}

// Eingabe «H:MM», «HH:MM», «H.MM» oder «HH.MM» als «HH:MM»; leer bleibt leer, alles andere ist null
export function schlussZeitEingabe(text: string): string | null {
  const t = text.trim();
  if (!t) return "";
  const treffer = /^(\d{1,2})[:.](\d{2})$/.exec(t);
  if (!treffer || Number(treffer[1]) > 23 || Number(treffer[2]) > 59) {
    return null;
  }
  return `${treffer[1].padStart(2, "0")}:${treffer[2]}`;
}

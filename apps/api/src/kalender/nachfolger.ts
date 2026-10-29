type Zeit = { tagVon: string | null; beginn: Date | null };
type Fehlend = Zeit & {
  id: string;
  googleSerie: string | null;
  titel: string;
};
type Termin = Zeit & {
  googleEventId: string;
  googleSerie: string | null;
  titel: string;
};

// Googles IDs sind base32hex (0-9a-v), «_R» kann also nur vom Suffix einer abgespaltenen Serie stammen
export const serienstamm = (serie: string | null) =>
  serie?.replace(/_R.*$/, "") || null;

const TAG = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Programmtag als yyyy-mm-dd: ganztägig tag_von, sonst das Schweizer Datum des Beginns
export const programmTag = (zeit: Zeit) =>
  zeit.beginn ? TAG.format(zeit.beginn) : (zeit.tagVon ?? "");

// Sucht für jedes fehlende Programm den neuen Termin derselben Serie oder desselben Titels am selben Tag.
// Übernommen wird nur bei genau einem Treffer, den kein anderes fehlendes Programm auch trifft; sonst geht es zu «Prüfen»
export function findeNachfolger(
  fehlende: Fehlend[],
  abruf: Termin[],
  bekannt: Set<string>,
) {
  const neue = abruf.filter((t) => !bekannt.has(t.googleEventId));
  const gruppen = fehlende.map((fehlt) => {
    const tag = programmTag(fehlt);
    const amTag = neue.filter((t) => programmTag(t) === tag);
    const stamm = serienstamm(fehlt.googleSerie);
    const ausSerie = amTag.filter(
      (t) => stamm !== null && serienstamm(t.googleSerie) === stamm,
    );
    return ausSerie.length > 0
      ? ausSerie
      : amTag.filter((t) => t.titel === fehlt.titel);
  });

  const uebernahmen: { programmId: string; googleEventId: string }[] = [];
  const pruefen: string[] = [];
  fehlende.forEach((fehlt, i) => {
    const [treffer] = gruppen[i];
    const eindeutig =
      gruppen[i].length === 1 &&
      gruppen.filter((g) => g.includes(treffer)).length === 1;
    if (eindeutig) {
      uebernahmen.push({
        programmId: fehlt.id,
        googleEventId: treffer.googleEventId,
      });
    } else {
      pruefen.push(fehlt.id);
    }
  });
  return { uebernahmen, pruefen };
}

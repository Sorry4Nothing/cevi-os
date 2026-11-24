// Adresssuche für Orte (#695): wiederverwendbar für alles, was einen Standort braucht (Orte der Abteilung, später Lagerort, Treffpunkte).
// Der Aufrufer bekommt höchstens MAX_VORSCHLAEGE Vorschläge zu einem Suchtext. Nach aussen geht nur dieser Text, ohne Konto, Abteilung oder Kennung. Der Dienst dahinter ist austauschbar (OrtssucheHolen); heute die Suche von geo.admin.ch (geoadmin.ts).

export const MIN_SUCHTEXT = 3;
export const MAX_SUCHTEXT = 100;
export const MAX_VORSCHLAEGE = 8;

export type Ortsvorschlag = {
  // Wie die Zeile in der Liste steht und wie sie als Adresse gespeichert wird, zum Beispiel «Beispielweg 4, 8000 Beispielstadt»
  bezeichnung: string;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  breite: number;
  laenge: number;
};

// Wirft bei jedem Fehler (nicht erreichbar, Zeitlimit, unerwartete Antwort); die Route macht daraus «gerade nicht erreichbar»
export type OrtssucheHolen = (suchtext: string) => Promise<Ortsvorschlag[]>;

export class OrtssucheBegrenzt extends Error {}

type Optionen = {
  // So lange bleibt eine Antwort im Speicher (Millisekunden)
  haltbar?: number;
  maxEintraege?: number;
  // Höchstens so viele Abrufe beim Dienst je Minute: Die Fair-Use-Grenze des Bundes liegt bei 40 je Minute für die REST-Dienste
  proMinute?: number;
  jetzt?: () => number;
};

// Legt einen kurzen Zwischenspeicher im Arbeitsspeicher und eine Obergrenze für Abrufe vor den Dienst. Gleiche Suchen (auch gleichzeitige) gehen nur einmal hinaus; Fehler werden nicht gemerkt
export function erstelleOrtssuche(
  holen: OrtssucheHolen,
  {
    haltbar = 10 * 60_000,
    maxEintraege = 200,
    proMinute = 30,
    jetzt = Date.now,
  }: Optionen = {},
): OrtssucheHolen {
  const speicher = new Map<
    string,
    { bis: number; antwort: Promise<Ortsvorschlag[]> }
  >();
  let abrufe: number[] = [];
  return async (suchtext) => {
    const schluessel = suchtext.trim().replace(/\s+/g, " ").toLowerCase();
    const t = jetzt();
    const treffer = speicher.get(schluessel);
    if (treffer && treffer.bis > t) return treffer.antwort;
    speicher.delete(schluessel);
    abrufe = abrufe.filter((a) => a > t - 60_000);
    if (abrufe.length >= proMinute) throw new OrtssucheBegrenzt();
    abrufe.push(t);
    if (speicher.size >= maxEintraege) {
      // Map behält die Einfüge-Reihenfolge: der älteste Eintrag zuerst
      const aeltester = speicher.keys().next();
      if (!aeltester.done) speicher.delete(aeltester.value);
    }
    const antwort = holen(schluessel);
    speicher.set(schluessel, { bis: t + haltbar, antwort });
    antwort.catch(() => {
      if (speicher.get(schluessel)?.antwort === antwort) {
        speicher.delete(schluessel);
      }
    });
    return antwort;
  };
}

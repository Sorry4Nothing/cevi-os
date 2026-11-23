import { PLATTFORM_RECHT_NAMEN, PLATTFORM_RECHTE } from "../plattform.js";
import { TERMINE_RECHTE } from "../termine/rechte-katalog.js";

// Der eine Rechtekatalog (#643): jedes Recht, das die Verwaltung einstellen oder anzeigen kann, mit Bereich, Klartext, Risiko und Geltung. Er fasst PLATTFORM_RECHTE (plattform.ts) und TERMINE_RECHTE (termine/rechte-katalog.ts) zusammen und ergänzt, was bisher fest an «Abteilungsleitung» hing.
// Der Katalog ist die einzige Liste: Plattformrollen, Gruppenrollen, die Matrix-API, darf() und die Dokumentation lesen ihn. Ein Name, den er nicht kennt, gibt nie ein Recht (fail-closed).
//
// Risiko:
//   normal    Alltag, kein Personendatenrisiko, kein zweiter Faktor
//   erweitert ändert Inhalte, sieht oder exportiert Personendaten oder entscheidet über andere: zweiter Faktor (403 ZWEITER_FAKTOR_FEHLT)
//   fest      nur die Abteilungsleitung (und je nach Eintrag der Entwickler), nicht an Rollen vergebbar. Das ist, was Aussperren oder Eskalation verhindert
// Art:
//   vergebbar  an Plattformrollen (abteilungsweit) und Gruppenrollen (je Gruppe) einstellbar
//   struktur   folgt aus Beziehungen (jede angemeldete Person, Eltern des Kindes); steht im Katalog, ist aber nicht einstellbar
//   fest       siehe Risiko «fest»
// Geltung (nur bei «vergebbar»):
//   alle      jedes Objekt der Abteilung
//   eigene    nur Objekte, die zur Gruppe der Rolle gehören; was das heisst, sagt der Bezug

export const BEREICHE = [
  "website",
  "termine",
  "anlaesse",
  "raeume",
  "laedeli",
  "lager",
  "mitteilungen",
  "personen",
  "plattform",
] as const;
export type Bereich = (typeof BEREICHE)[number];

export const BEREICH_NAMEN: Record<Bereich, string> = {
  website: "Website",
  termine: "Termine",
  anlaesse: "Anlässe",
  raeume: "Räume",
  laedeli: "Lädeli",
  lager: "Lager",
  mitteilungen: "Mitteilungen",
  personen: "Personen und Gruppen",
  plattform: "Plattform und Rechte",
};

export type Risiko = "normal" | "erweitert" | "fest";
export type Art = "vergebbar" | "struktur" | "fest";
export type Geltung = "alle" | "eigene";

// Woran «eigene» hängt. Eine Route baut das Objekt nach dem Laden (objekt.ts) und nennt dort, was sie weiss
//   seite   Seite der Gruppe (seite.tag_id) oder Seite des Anlasses der Gruppe (anlass.seite_id)
//   anlass  der Anlass der Gruppe (tag.anlass_id)
//   raum    Räume, deren Team die Gruppe ist (raum.team_tag_id)
//   gruppe  die Gruppe selbst (Ziel einer Mitteilung, Mitglieder verwalten)
export type Bezug = "seite" | "anlass" | "raum" | "gruppe";

export interface RechtEintrag {
  bereich: Bereich;
  // Eine Zeile für die Spalte der Matrix, ohne Fachwort
  klartext: string;
  // Zwei Sätze für die Erklärung in der Oberfläche
  erklaerung: string;
  risiko: Risiko;
  art: Art;
  geltungen: readonly Geltung[];
  bezug?: Bezug;
  // Hat der Entwickler (Zeile in plattform_entwickler) das Recht? Nur Plattform und Website, wie bisher
  entwickler: boolean;
  // Hat die Abteilungsleitung es nicht (nur der Entwickler)?
  nurEntwickler?: true;
  // Der Name im älteren Katalog (TERMINE_RECHTE), falls er abweicht
  frueher?: string;
}

const v = (
  bereich: Bereich,
  klartext: string,
  erklaerung: string,
  risiko: Risiko,
  geltungen: readonly Geltung[],
  zusatz: Partial<Pick<RechtEintrag, "bezug" | "entwickler" | "frueher">> = {},
): RechtEintrag => ({
  bereich,
  klartext,
  erklaerung,
  risiko,
  art: "vergebbar",
  geltungen,
  entwickler: false,
  ...zusatz,
});
const s = (
  bereich: Bereich,
  klartext: string,
  erklaerung: string,
): RechtEintrag => ({
  bereich,
  klartext,
  erklaerung,
  risiko: "normal",
  art: "struktur",
  geltungen: [],
  entwickler: false,
});
const f = (
  bereich: Bereich,
  klartext: string,
  erklaerung: string,
  zusatz: Partial<Pick<RechtEintrag, "entwickler" | "nurEntwickler">> = {},
): RechtEintrag => ({
  bereich,
  klartext,
  erklaerung,
  risiko: "fest",
  art: "fest",
  geltungen: [],
  entwickler: false,
  ...zusatz,
});

const ALLE: readonly Geltung[] = ["alle"];
const ALLE_EIGENE: readonly Geltung[] = ["alle", "eigene"];

export const RECHTE_KATALOG = {
  // Website: Quelle PLATTFORM_RECHTE; alle «erweitert», der Entwickler hat sie alle
  "seiten.bearbeiten": v(
    "website",
    "Seiten bearbeiten",
    "Seiten ändern, Entwürfe anlegen, Versionen zurückholen. «Eigene» sind die Seiten der Gruppe und die Seite ihres Anlasses.",
    "erweitert",
    ALLE_EIGENE,
    { bezug: "seite", entwickler: true },
  ),
  "seiten.veroeffentlichen": v(
    "website",
    "Seiten veröffentlichen",
    "Seiten auf der öffentlichen Website zeigen oder zurückziehen. «Eigene» sind die Seiten der Gruppe und die Seite ihres Anlasses.",
    "erweitert",
    ALLE_EIGENE,
    { bezug: "seite", entwickler: true },
  ),
  "seiten.anlegen_loeschen": v(
    "website",
    "Seiten anlegen und löschen",
    "Neue Seiten anlegen, Seiten löschen und in eine andere Gruppe verschieben.",
    "erweitert",
    ALLE,
    { entwickler: true },
  ),
  "medien.verwalten": v(
    "website",
    "Medien verwalten",
    "Bilder und PDFs beschreiben und löschen, auch fremde.",
    "erweitert",
    ALLE,
    { entwickler: true },
  ),
  "weiterleitungen.verwalten": v(
    "website",
    "Weiterleitungen verwalten",
    "Alte Adressen auf neue Seiten umleiten.",
    "erweitert",
    ALLE,
    { entwickler: true },
  ),
  "vorlagen.nutzen": v(
    "website",
    "Vorlagen nutzen",
    "Neue Seiten aus Vorlagen anlegen.",
    "erweitert",
    ALLE,
    { entwickler: true },
  ),
  "wartungsmodus.website": v(
    "website",
    "Wartungsmodus der Website schalten",
    "Die öffentliche Website in den Wartungsmodus setzen und wieder öffnen.",
    "erweitert",
    ALLE,
    { entwickler: true },
  ),

  // Termine: Quelle TERMINE_RECHTE
  "termine.mein_kalender": s(
    "termine",
    "Eigenen Kalender sehen",
    "Jede angemeldete Person sieht ihre Termine nach Sichtbarkeit.",
  ),
  "termine.alle": s(
    "termine",
    "Alle Termine sehen",
    "Jede angemeldete Person sieht alle Termine, die für sie sichtbar sind.",
  ),
  "termine.warnliste": v(
    "termine",
    "Warnliste der Termine sehen",
    "Die Liste der Termine mit Problemen aus dem Kalender sehen.",
    "erweitert",
    ALLE,
  ),
  "termine.kategorien_zuordnen": v(
    "termine",
    "Kalender-Kategorien zuordnen",
    "Kategorien aus dem Kalender Gruppen und Sichtbarkeiten zuordnen.",
    "erweitert",
    ALLE,
  ),
  "vorschlag.einreichen": v(
    "termine",
    "Termine vorschlagen",
    "Einen Termin vorschlagen. Die Abteilungsleitung oder wer das Recht «Vorschläge entscheiden» hat, nimmt ihn an.",
    "normal",
    ALLE,
  ),
  "vorschlag.entscheiden": v(
    "termine",
    "Terminvorschläge entscheiden",
    "Terminvorschläge annehmen oder ablehnen.",
    "erweitert",
    ALLE,
  ),

  // Anlässe
  "anlass.anlegen": v(
    "anlaesse",
    "Anlässe anlegen und löschen",
    "Neue Anlässe anlegen und bestehende löschen, auch mit ihrer Gruppe.",
    "erweitert",
    ALLE,
  ),
  "anlass.verwalten": v(
    "anlaesse",
    "Anlässe verwalten",
    "Titel, Frist, Felder und Sichtbarkeit eines Anlasses ändern. «Eigene» ist der Anlass der Gruppe, zum Beispiel des OK.",
    "erweitert",
    ALLE_EIGENE,
    { bezug: "anlass" },
  ),
  "anlass.anmelden": s(
    "anlaesse",
    "Sich oder das eigene Kind anmelden",
    "Jede Person meldet sich selbst oder ihr Kind an, soweit der Anlass es zulässt.",
  ),
  "anlass.anmeldungen_sehen": v(
    "anlaesse",
    "Anmeldungen sehen",
    "Die Liste der Anmeldungen mit Namen von Kindern und Eltern sehen. Das sind Personendaten von Kindern. «Eigene» ist der Anlass der Gruppe.",
    "erweitert",
    ALLE_EIGENE,
    { bezug: "anlass", frueher: "anmeldung.ansehen" },
  ),
  "anlass.anmeldungen_exportieren": v(
    "anlaesse",
    "Anmeldungen exportieren",
    "Die Anmeldungen als Datei herunterladen. Die Daten verlassen damit das System. «Eigene» ist der Anlass der Gruppe.",
    "erweitert",
    ALLE_EIGENE,
    { bezug: "anlass" },
  ),

  // Räume
  "raum.ansehen": s(
    "raeume",
    "Räume ansehen",
    "Jede angemeldete Person sieht die Räume und kann eine Anfrage stellen.",
  ),
  "raum.belegung": v(
    "raeume",
    "Belegung der Räume sehen",
    "Sehen, wer welchen Raum wann belegt, mit Zweck. «Eigene» sind die Räume, die dem Team der Gruppe zugeordnet sind.",
    "normal",
    ALLE_EIGENE,
    { bezug: "raum" },
  ),
  "raum.verwalten": v(
    "raeume",
    "Räume verwalten",
    "Räume anlegen, ändern und löschen. «Eigene» sind die Räume, die dem Team der Gruppe zugeordnet sind.",
    "erweitert",
    ALLE_EIGENE,
    { bezug: "raum" },
  ),
  "raum.team_zuweisen": v(
    "raeume",
    "Räume einem Team zuweisen",
    "Einem Raum ein Team geben oder ihm das Team entziehen. Das Team sieht dann die Belegung und die Anfragen des Raums und entscheidet sie. Standardmässig nur die Abteilungsleitung.",
    "erweitert",
    ALLE,
  ),
  "raum.anfrage_entscheiden": v(
    "raeume",
    "Raumanfragen entscheiden",
    "Raumanfragen annehmen oder ablehnen. «Eigene» sind die Anfragen für Räume, die dem Team der Gruppe zugeordnet sind. Die eigene Anfrage entscheidet nie dieselbe Person.",
    "erweitert",
    ALLE_EIGENE,
    { bezug: "raum" },
  ),

  // Lädeli
  "laden.bestellen": s(
    "laedeli",
    "Im Lädeli bestellen",
    "Jede angemeldete Person bestellt im Lädeli und sieht ihre eigenen Bestellungen.",
  ),
  "laden.ansehen": v(
    "laedeli",
    "Lädeli-Verwaltung ansehen",
    "Die Verwaltung des Lädelis öffnen und Artikel und Bestellungen lesen. Bestellungen zeigen Namen.",
    "erweitert",
    ALLE,
  ),
  "laden.artikel_pflegen": v(
    "laedeli",
    "Lädeli-Artikel pflegen",
    "Artikel anlegen, ändern, ordnen und löschen.",
    "erweitert",
    ALLE,
  ),
  "laden.bestellungen_bearbeiten": v(
    "laedeli",
    "Lädeli-Bestellungen bearbeiten",
    "Bestellungen auf «bereit», «übergeben» oder «storniert» setzen.",
    "erweitert",
    ALLE,
  ),
  "laden.einstellungen": v(
    "laedeli",
    "Lädeli einstellen",
    "Übergabearten, Texte und Preisangaben des Lädelis ändern.",
    "erweitert",
    ALLE,
  ),

  // Lager: Die Rechte im Lager selbst (49) bleiben je Lager (lager/rechte-katalog.ts)
  "lager.verwalten": f(
    "lager",
    "Lager verwalten",
    "Lager anlegen, Stammdaten, Mitglieder und Dateien verwalten. Die Rechte der Rollen im Lager stellt die Lagerleitung je Lager ein.",
  ),

  // Mitteilungen
  "mitteilung.senden": v(
    "mitteilungen",
    "Mitteilungen senden",
    "Eine Mitteilung als Push an Gruppen und Rollen senden. «Alle» erreicht jede Gruppe der Abteilung, «eigene» nur die Gruppe der Rolle.",
    "erweitert",
    ALLE_EIGENE,
    { bezug: "gruppe" },
  ),

  // Personen und Gruppen
  "personen.verwalten": v(
    "personen",
    "Personen und Kinder verwalten",
    "Personen und Kinder anlegen, ändern, importieren und deaktivieren. Das sind Personendaten von Kindern.",
    "erweitert",
    ALLE,
  ),
  "gruppen.verwalten": v(
    "personen",
    "Gruppen und ihre Mitglieder verwalten",
    "Gruppen anlegen und ändern und Personen in Gruppen aufnehmen oder entfernen. Rollen und ihre Rechte zuordnen darf nur die Abteilungsleitung.",
    "erweitert",
    ALLE_EIGENE,
    { bezug: "gruppe" },
  ),
  "profilbild.entfernen": v(
    "personen",
    "Profilbilder entfernen",
    "Das Profilbild einer anderen Person entfernen, mit Eintrag im Protokoll.",
    "erweitert",
    ALLE,
    { entwickler: true },
  ),
  "konto.loeschen": f(
    "personen",
    "Konten löschen",
    "Konten löschen und Daten einer Person vergessen. Das lässt sich nicht rückgängig machen.",
  ),
  // Konten von Kindern (#644): Erstellen, Übergeben, Sperren, Entfernen und die Einstellungen der Abteilung. Fest, weil es Kinderdaten und die Aufsicht der Eltern betrifft
  "kinder.konto_verwalten": f(
    "personen",
    "Konten von Kindern verwalten",
    "Einem Kind ein eigenes Konto erstellen, übergeben, sperren oder entfernen und einstellen, ob Kinder Konten haben und im Chat schreiben dürfen. Das betrifft Kinder und die Aufsicht der Eltern: Das bleibt bei der Abteilungsleitung.",
  ),
  // Was das Konto eines Kindes sieht, folgt aus dem Kind (Sicht kind_zugang), nicht aus einer Rolle
  "kinder.konto_sehen": s(
    "personen",
    "Eigenes Kind sehen (Konto eines Kindes)",
    "Das Konto eines Kindes sieht die Programme und die Leitung der eigenen Stufe, die eigene Anmeldung und je nach Einstellung den Gruppenchat. Nie andere Kinder, Eltern, Telefonnummern oder die Verwaltung. Das folgt aus dem Kind und lässt sich nicht einstellen.",
  ),
  "protokoll.lesen": f(
    "plattform",
    "Protokoll lesen",
    "Das Aktivitätsprotokoll lesen und exportieren. Das darf nur der Entwickler, nicht die Abteilungsleitung (Entscheid E5).",
    { nurEntwickler: true, entwickler: true },
  ),

  // Plattform und Rechte
  "rechte.verwalten": f(
    "plattform",
    "Rechte und Rollen vergeben",
    "Rollen anlegen, ihre Rechte einstellen und Personen zuordnen. Wer Rechte vergibt, hat sie selbst: Das bleibt bei der Abteilungsleitung, damit sich niemand selbst mehr Rechte gibt.",
  ),
  "entwickler.vergeben": f(
    "plattform",
    "Entwickler vergeben",
    "Die Rolle «Entwickler» vergibt und entzieht nur die Kommandozeile des Servers, nie die Verwaltung.",
  ),
  "plattform.sperren": f(
    "plattform",
    "Wartung und Informationssperre schalten",
    "Einzelne Bereiche oder alles in Wartung setzen und die Informationssperre auslösen.",
    { entwickler: true },
  ),
  "system.lesen": f(
    "plattform",
    "Betriebszahlen lesen",
    "Die Seite «System» mit Betriebszahlen und Sicherungen lesen.",
  ),
} as const satisfies Record<string, RechtEintrag>;

export type RechtId = keyof typeof RECHTE_KATALOG;
export const RECHT_IDS = Object.keys(RECHTE_KATALOG) as RechtId[];

// Ein Name aus der Datenbank oder einer Anfrage (Object.hasOwn: «toString» und Verwandte sind keine Rechte)
export const istRecht = (name: string): name is RechtId =>
  Object.hasOwn(RECHTE_KATALOG, name);

const eintrag = (recht: RechtId): RechtEintrag => RECHTE_KATALOG[recht];
export const eintragVon = eintrag;

// Rechte, die sich einstellen lassen (an Plattform- und Gruppenrollen)
export const VERGEBBARE_RECHTE = RECHT_IDS.filter(
  (r) => eintrag(r).art === "vergebbar",
);
// Rechte, die Gruppenrollen tragen dürfen: alles Vergebbare ausser dem Wartungsmodus der ganzen Website
export const GRUPPENROLLEN_RECHTE = VERGEBBARE_RECHTE.filter(
  (r) => r !== "wartungsmodus.website",
);

// Ist diese Geltung für das Recht im Katalog vorgesehen?
export const kenntGeltung = (recht: RechtId, geltung: Geltung) =>
  eintrag(recht).geltungen.includes(geltung);

// Verlangt das Recht den zweiten Faktor? Jedes «erweiterte» und «feste»
export const brauchtZweitenFaktor = (recht: RechtId) =>
  eintrag(recht).risiko !== "normal";

// Die Namen der bisherigen Kataloge müssen im neuen stehen (Test in rechtemodell-katalog.test.ts)
export const FRUEHER: readonly string[] = [
  ...PLATTFORM_RECHT_NAMEN,
  ...Object.keys(TERMINE_RECHTE),
];

// Die Plattformrechte, die der ältere Katalog kennt: dieselben Namen, dieselbe Bedeutung
export const istAltesPlattformRecht = (recht: string) =>
  Object.hasOwn(PLATTFORM_RECHTE, recht);

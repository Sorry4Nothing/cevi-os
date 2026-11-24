import { AKTIVITAET_KATALOG } from "./aktivitaet-titel.js";

// Änderungsprotokoll (#662): Klartext zu jeder Zeile. Rein, ohne Datenbank und ohne node:*: Die Middleware, die Ablage und die Route benutzen dieselben Funktionen, und der Test prüft sie ohne Server.
// Hierher gehört nie ein Inhalt: Der Satz entsteht aus dem Katalog der Routen (aktivitaet-titel.ts), dem Namen des Objekts (nur Tabellen ohne Personendaten, siehe aktivitaet.ts, NAMENS_QUELLEN) und den Angaben der Route (Namen von Rechten, einfache Statuswerte).

// «PATCH /api/v1/admin/personen/:id» oder «…/{id}» → «PATCH /api/v1/admin/personen/:p», der Schlüssel des Katalogs
export function schluesselVon(aktion: string) {
  const [methode = "", ...rest] = aktion.split(" ");
  return `${methode} ${rest.join(" ").replace(/{[^}]+}|:[A-Za-z0-9_]+/g, ":p")}`;
}
export const katalogVon = (aktion: string) =>
  AKTIVITAET_KATALOG[schluesselVon(aktion)];

// Gruppen der Aktion für den Filter, in der Reihenfolge der Auswahl
export const GRUPPEN_TEXT: Record<string, string> = {
  angelegt: "Angelegt",
  geaendert: "Geändert",
  geloescht: "Gelöscht",
  zugeordnet: "Zugeordnet",
  entzogen: "Entzogen",
  veroeffentlicht: "Veröffentlicht",
  zurueckgezogen: "Zurückgezogen",
  status: "Status oder Sperre",
  gesendet: "Gesendet",
  entschieden: "Entschieden",
};

// Das Wort im Pfad vor der Kennung → [Nennform, Genitiv]; nur diese Objekte tragen ihren Namen in den Satz
export const OBJEKT_ARTEN: Record<string, [string, string]> = {
  anlaesse: ["Anlass", "des Anlasses"],
  lager: ["Lager", "des Lagers"],
  tags: ["Tag", "des Tags"],
  gruppen: ["Gruppe", "der Gruppe"],
  stufen: ["Stufe", "der Stufe"],
  raeume: ["Raum", "des Raums"],
  artikel: ["Artikel", "des Artikels"],
  seiten: ["Seite", "der Seite"],
  orte: ["Ort", "des Orts"],
  vorlagen: ["Vorlage", "der Vorlage"],
  rollen: ["Rolle", "der Rolle"],
  medien: ["Bild", "des Bildes"],
  zeitregeln: ["Erinnerungsregel", "der Erinnerungsregel"],
  weiterleitungen: ["Weiterleitung", "der Weiterleitung"],
  personen: ["Person", "der Person"],
  kinder: ["Kind", "des Kindes"],
};

// Was die Route zusätzlich meldet oder was aus dem Audit-Log kommt: nur Namen von Rechten, einfache Werte und Zahlen
export type AenderungsDetails = {
  eltern?: { typ: string; id: string; name?: string };
  // Die Route trifft das Objekt selbst (PATCH /x/:id, Anlegen), nicht eine Unteraktion wie /x/:id/aktivieren: nur dann steht sein Name als Hauptwort im Satz
  direkt?: boolean;
  // Name der Audit-Aktion, z. B. gruppen_rolle_geaendert
  audit?: string;
  // Einfache Angaben (Status, Art, Zahl, Ja/Nein); nie Texte mit Leerzeichen
  werte?: Record<string, string | number | boolean>;
  // Namen der Rechte, die dazukamen oder wegfielen
  hinzu?: string[];
  weg?: string[];
  // Vorher und Nachher bei einfachen Statuswerten
  vorher?: Record<string, string | number | boolean | null>;
  nachher?: Record<string, string | number | boolean | null>;
  // Klartext, den die Route selbst liefert; ersetzt den Satz
  text?: string;
};

// Kurze Wörter ohne Leerzeichen; das Komma erlaubt Listen wie Grössen («S,M»)
const KENNUNG = /^[A-Za-z0-9_.:,\-äöüÄÖÜ]{1,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Namen oder freie Texte, auch wenn sie wie eine Kennung aussähen
const GESPERRTE_SCHLUESSEL =
  /name|titel|text|beschreibung|email|mail|telefon|passwort|token|adresse|notiz|kommentar/i;
const SCHLUESSEL = /^[A-Za-z][A-Za-z0-9_]{0,29}$/;

// Ein einzelner Wert, der sicher ist: Zahl, Ja/Nein oder ein kurzes Wort ohne Leerzeichen, das keine Kennung eines Datensatzes ist
export function sicherWert(
  wert: unknown,
): string | number | boolean | undefined {
  if (typeof wert === "boolean") return wert;
  if (typeof wert === "number" && Number.isFinite(wert)) return wert;
  if (typeof wert === "string" && KENNUNG.test(wert) && !UUID.test(wert)) {
    return wert;
  }
  return undefined;
}

// Liste von Namen (Rechte): Wörter oder Objekte mit «recht»; höchstens 60
function sichereListe(wert: unknown): string[] | undefined {
  if (!Array.isArray(wert)) return undefined;
  const namen = wert
    .map((e) =>
      typeof e === "object" && e !== null
        ? sicherWert((e as { recht?: unknown }).recht)
        : sicherWert(e),
    )
    .filter((e): e is string => typeof e === "string")
    .slice(0, 60);
  return namen.length > 0 ? [...new Set(namen)].sort() : undefined;
}

// Das details-Feld einer Zeile von audit_log: «hinzu» und «weg» (Rechte), «rechte» (Rechte einer neuen Rolle) und einfache Werte; alles andere fällt weg
export function sicherDetails(details: unknown): AenderungsDetails {
  if (
    typeof details !== "object" ||
    details === null ||
    Array.isArray(details)
  ) {
    return {};
  }
  const aus: AenderungsDetails = {};
  const werte: Record<string, string | number | boolean> = {};
  for (const [schluessel, wert] of Object.entries(details).slice(0, 30)) {
    if (!SCHLUESSEL.test(schluessel)) continue;
    if (schluessel === "hinzu" || schluessel === "weg") {
      const liste = sichereListe(wert);
      if (liste) aus[schluessel] = liste;
      continue;
    }
    if (schluessel === "rechte") {
      const liste = sichereListe(wert);
      if (liste) aus.hinzu = [...new Set([...(aus.hinzu ?? []), ...liste])];
      continue;
    }
    if (GESPERRTE_SCHLUESSEL.test(schluessel)) continue;
    const sicher = sicherWert(wert);
    if (sicher !== undefined) werte[schluessel] = sicher;
  }
  if (Object.keys(werte).length > 0) aus.werte = werte;
  return aus;
}

// Eine Angabe der Route (vorher, nachher): nur schlichte Schlüssel und sichere Werte
export function sicherAngaben(
  angaben: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!angaben) return undefined;
  const aus: Record<string, string | number | boolean | null> = {};
  for (const [schluessel, wert] of Object.entries(angaben).slice(0, 20)) {
    if (!SCHLUESSEL.test(schluessel) || GESPERRTE_SCHLUESSEL.test(schluessel)) {
      continue;
    }
    if (wert === null) {
      aus[schluessel] = null;
      continue;
    }
    const sicher = sicherWert(wert);
    if (sicher !== undefined) aus[schluessel] = sicher;
  }
  return Object.keys(aus).length > 0 ? aus : undefined;
}

// Für die Audit-Aktionen ohne Anfrage (Kommandozeile, Systemzuordnung); alle anderen Namen werden lesbar gemacht
const AUDIT_KLARTEXT: Record<string, string> = {
  person_angelegt: "Person angelegt",
  entwickler_vergeben: "Entwickler-Recht vergeben",
  entwickler_entzogen: "Entwickler-Recht entzogen",
  abteilungsleitung_vergeben: "Abteilungsleitung vergeben",
  abteilungsleitung_entzogen: "Abteilungsleitung entzogen",
  zweiter_faktor_zurueckgesetzt: "Zweiter Faktor zurückgesetzt",
  tag_zugewiesen: "Tag zugewiesen",
  tag_entzogen: "Tag entzogen",
};

// Systemereignisse mit Wirkung: Name → Satz; die Zahl hängt hinten an
const SYSTEM_KLARTEXT: Record<string, string> = {
  start: "Server gestartet",
  migration: "Datenbank aktualisiert",
  protokoll_luecke:
    "Protokoll unvollständig: Einträge konnten nicht gespeichert werden",
  push_versand: "Push-Mitteilungen versendet",
  lager_fristen: "Erinnerungen zu Lager-Fristen versendet",
};
const SYSTEM_EINHEIT: Record<string, string> = {
  migration: "Migrationen",
  protokoll_luecke: "Einträge",
  push_versand: "Geräte",
  lager_fristen: "Erinnerungen",
};

const SICHERHEIT_KLARTEXT: Record<string, string> = {
  "POST /api/auth/sign-in/username": "Anmeldung fehlgeschlagen",
  "POST /api/auth/two-factor/verify-totp": "Zweiter Faktor falsch",
  "POST /api/auth/two-factor/verify-backup-code": "Ersatzcode falsch",
};

const klein = (text: string, max = 60) =>
  // Zeilenumbrüche und Steuerzeichen werden Leerzeichen
  text
    .split("")
    .map((z) => (z.charCodeAt(0) < 32 || z.charCodeAt(0) === 127 ? " " : z))
    .join("")
    .replace(/ +/g, " ")
    .trim()
    .slice(0, max);

export type BeschreibungsZeile = {
  art: string;
  aktion: string;
  objektTyp?: string | null;
  objektName?: string | null;
  anzahl?: number | null;
  aenderung?: AenderungsDetails | null;
};

// Der Satz zur Zeile, in der Nennform: «Rolle «Kasse» der Gruppe «OK Kirmes» geändert». Wer es war, steht daneben (Benutzerstempel)
export function beschreibungVon(z: BeschreibungsZeile): string {
  const a = z.aenderung ?? undefined;
  if (a?.text) return klein(a.text, 300);
  if (z.art === "system") {
    const [name = "", typ] = z.aktion.split(":");
    const satz =
      name === "push_versand"
        ? `${typ === "plattform" ? "Plattform-Mitteilungen" : "Programm-Erinnerungen"} per Push versendet`
        : (SYSTEM_KLARTEXT[name] ?? name.replace(/_/g, " "));
    const zahl =
      z.anzahl !== null && z.anzahl !== undefined
        ? ` (${z.anzahl}${SYSTEM_EINHEIT[name] ? ` ${SYSTEM_EINHEIT[name]}` : ""})`
        : "";
    return `${satz}${zahl}`;
  }
  if (z.art === "sicherheit") {
    const satz =
      SICHERHEIT_KLARTEXT[z.aktion] ??
      (z.aktion === "(begrenzt)" || z.aktion.endsWith(" (begrenzt)")
        ? "Zu viele Anfragen, Begrenzung ausgelöst"
        : "Sicherheitsereignis");
    return z.anzahl && z.anzahl > 1 ? `${satz}, ${z.anzahl}-mal` : satz;
  }
  if (z.art === "audit") {
    return AUDIT_KLARTEXT[z.aktion] ?? z.aktion.replace(/_/g, " ");
  }
  const eintrag = katalogVon(z.aktion);
  if (!eintrag) {
    const [methode = "", ...rest] = z.aktion.split(" ");
    const verb: Record<string, string> = {
      POST: "Angelegt oder ausgelöst",
      PUT: "Ersetzt",
      PATCH: "Geändert",
      DELETE: "Gelöscht",
    };
    return `${verb[methode] ?? methode}: ${rest.join(" ")}`;
  }
  const typ = z.objektTyp ? OBJEKT_ARTEN[z.objektTyp] : undefined;
  const name = z.objektName ? klein(z.objektName) : undefined;
  const eltern = a?.eltern;
  const elternTyp = eltern?.typ ? OBJEKT_ARTEN[eltern.typ] : undefined;
  const elternName = eltern?.name ? klein(eltern.name) : undefined;
  // Das Objekt selbst mit Namen: «Rolle «Kasse» der Gruppe «OK Kirmes» geändert»
  if (a?.direkt && name && typ) {
    const teil =
      elternName && elternTyp ? ` ${elternTyp[1]} «${elternName}»` : "";
    return `${typ[0]} «${name}»${teil} ${eintrag.aktion}`;
  }
  // Sonst der Katalog mit dem Ort der Änderung: «Rechte der Lagerrollen geändert (Lager «Sola»)»
  const ort =
    name && typ
      ? ` (${typ[0]} «${name}»)`
      : elternName && elternTyp
        ? ` (${elternTyp[0]} «${elternName}»)`
        : "";
  return `${eintrag.objekt} ${eintrag.aktion}${ort}`;
}

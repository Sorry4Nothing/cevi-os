import { z } from "zod";
import { baustein, kurztext, sauber } from "./bausteine-basis.js";
import { enthaeltGesundheitswort } from "../gesundheit-sperrliste.js";

// Baustein «formular» (#819): Angaben auf einer Seite einholen (Umfrage, Rückmeldung, Bedarfsabfrage). Die Definition steht im Dokument der Seite, die Antworten in der Tabelle formular_antwort.
// Jedes Feld hat eine feste ID: Wer Felder ändert, macht alte Antworten nicht kaputt, denn eine Antwort nennt die Feld-IDs und die Version der Seite, mit der sie entstand.
// Der Server prüft jede Antwort gegen die veröffentlichte Definition aus der Datenbank, nie gegen etwas aus der Anfrage (formular.ts im Ordner formular).
// Keine Dateien als Antwort, und keine Gesundheitsdaten: Beschriftung, Hilfetext und Auswahl dürfen kein Wort der Sperrliste der Anlass-Anmeldung tragen.

export const FELD_TYPEN = [
  "text",
  "textbereich",
  "zahl",
  "datum",
  "email",
  "telefon",
  "auswahl",
  "optionsfelder",
  "mehrfachwahl",
  "janein",
  "zustimmung",
] as const;
export type FeldTyp = (typeof FELD_TYPEN)[number];

// Obergrenzen (shortcut: geschätzt, bei Bedarf anheben; sie schützen Speicher, Renderer, Editor und die Datenbank)
export const MAX_FELDER = 30;
export const MAX_FELD_BESCHRIFTUNG = 300;
export const MAX_FELD_HILFE = 300;
export const MAX_OPTIONEN = 30;
export const MAX_OPTION = 100;
export const MAX_TEXT_LAENGE = 500;
export const MAX_BEREICH_LAENGE = 2000;
export const STANDARD_TEXT_LAENGE = 200;
export const STANDARD_BEREICH_LAENGE = 1000;
export const MAX_FORMULAR_TITEL = 120;
export const MAX_EINLEITUNG = 500;
export const MAX_DATENSCHUTZ = 600;
export const MAX_KNOPF = 40;
export const MAX_DANKE = 300;
export const MIN_AUFBEWAHREN_TAGE = 7;
export const MAX_AUFBEWAHREN_TAGE = 730;
export const STANDARD_AUFBEWAHREN_TAGE = 180;
export const MAX_ANTWORTEN_PRO_FORMULAR = 10000;
export const STANDARD_MAX_ANTWORTEN = 2000;
// Grösse einer Antwort als JSON, in Zeichen
export const MAX_ANTWORT_ZEICHEN = 16000;
const MAX_ZAHL = 1_000_000_000;

const datumText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T12:00:00Z`)))
  .refine((s) => new Date(`${s}T12:00:00Z`).toISOString().startsWith(s));
const optionen = z
  .array(kurztext(MAX_OPTION))
  .min(2)
  .max(MAX_OPTIONEN)
  .refine((o) => new Set(o).size === o.length);
const zahl = z.number().min(-MAX_ZAHL).max(MAX_ZAHL);

const kopf = {
  id: z.uuid(),
  beschriftung: kurztext(MAX_FELD_BESCHRIFTUNG),
  hilfe: kurztext(MAX_FELD_HILFE).optional(),
};
const pflicht = { pflicht: z.boolean() };

export const feldSchema = z.discriminatedUnion("typ", [
  z.strictObject({
    typ: z.literal("text"),
    ...kopf,
    ...pflicht,
    minLaenge: z.number().int().min(1).max(MAX_TEXT_LAENGE).optional(),
    maxLaenge: z.number().int().min(1).max(MAX_TEXT_LAENGE).optional(),
  }),
  z.strictObject({
    typ: z.literal("textbereich"),
    ...kopf,
    ...pflicht,
    minLaenge: z.number().int().min(1).max(MAX_BEREICH_LAENGE).optional(),
    maxLaenge: z.number().int().min(1).max(MAX_BEREICH_LAENGE).optional(),
  }),
  z.strictObject({
    typ: z.literal("zahl"),
    ...kopf,
    ...pflicht,
    ganzzahl: z.boolean().optional(),
    min: zahl.optional(),
    max: zahl.optional(),
  }),
  z.strictObject({
    typ: z.literal("datum"),
    ...kopf,
    ...pflicht,
    von: datumText.optional(),
    bis: datumText.optional(),
  }),
  z.strictObject({ typ: z.literal("email"), ...kopf, ...pflicht }),
  z.strictObject({ typ: z.literal("telefon"), ...kopf, ...pflicht }),
  z.strictObject({
    typ: z.literal("auswahl"),
    ...kopf,
    ...pflicht,
    optionen,
  }),
  z.strictObject({
    typ: z.literal("optionsfelder"),
    ...kopf,
    ...pflicht,
    optionen,
  }),
  z.strictObject({
    typ: z.literal("mehrfachwahl"),
    ...kopf,
    ...pflicht,
    optionen,
    minAuswahl: z.number().int().min(1).max(MAX_OPTIONEN).optional(),
    maxAuswahl: z.number().int().min(1).max(MAX_OPTIONEN).optional(),
  }),
  z.strictObject({ typ: z.literal("janein"), ...kopf, ...pflicht }),
  // Das Kästchen mit dem Text als Beschriftung; ohne Häkchen lässt sich das Formular nicht senden
  z.strictObject({
    typ: z.literal("zustimmung"),
    ...kopf,
    pflicht: z.literal(true),
  }),
]);
export type Feld = z.infer<typeof feldSchema>;

// Alle Texte eines Feldes, die nach etwas fragen können: Beschriftung, Hilfe und Auswahl
const texteDes = (f: Feld): string[] => [
  f.beschriftung,
  ...(f.hilfe ? [f.hilfe] : []),
  ...("optionen" in f ? f.optionen : []),
];

function pruefeGrenzen(f: Feld): boolean {
  switch (f.typ) {
    case "text":
    case "textbereich":
      return (f.minLaenge ?? 1) <= (f.maxLaenge ?? MAX_BEREICH_LAENGE);
    case "zahl":
      return (
        f.min === undefined || f.max === undefined ? true : f.min <= f.max
      );
    case "datum":
      return f.von === undefined || f.bis === undefined ? true : f.von <= f.bis;
    case "mehrfachwahl":
      return (
        (f.minAuswahl ?? 1) <= (f.maxAuswahl ?? f.optionen.length) &&
        (f.minAuswahl ?? 1) <= f.optionen.length
      );
    default:
      return true;
  }
}

export const formularDaten = z
  .strictObject({
    titel: kurztext(MAX_FORMULAR_TITEL).optional(),
    einleitung: kurztext(MAX_EINLEITUNG).optional(),
    felder: z.array(feldSchema).min(1).max(MAX_FELDER),
    // Pflicht: wozu die Angaben dienen und wer die Antworten sieht (revDSG Art. 19)
    datenschutz: kurztext(MAX_DATENSCHUTZ),
    absenden: kurztext(MAX_KNOPF).default("Antwort senden"),
    danke: kurztext(MAX_DANKE).default("Danke. Deine Antwort ist angekommen."),
    // Letzter Tag, an dem das Formular Antworten annimmt (bis Mitternacht Zürcher Zeit); ohne Angabe ist es offen
    schliesstAm: datumText.optional(),
    // Je angemeldete Person eine Antwort; anonyme Antworten lassen sich nie zuordnen und darum nie begrenzen
    eineProPerson: z.boolean().default(false),
    aufbewahrenTage: z
      .number()
      .int()
      .min(MIN_AUFBEWAHREN_TAGE)
      .max(MAX_AUFBEWAHREN_TAGE)
      .default(STANDARD_AUFBEWAHREN_TAGE),
    maxAntworten: z
      .number()
      .int()
      .min(1)
      .max(MAX_ANTWORTEN_PRO_FORMULAR)
      .default(STANDARD_MAX_ANTWORTEN),
  })
  .superRefine((d, ctx) => {
    const ids = new Set<string>();
    d.felder.forEach((f, i) => {
      if (ids.has(f.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["felder", i, "id"],
          message: "doppelte ID",
        });
      }
      ids.add(f.id);
      if (!pruefeGrenzen(f)) {
        ctx.addIssue({
          code: "custom",
          path: ["felder", i, "grenzen"],
          message: "Grenzen",
        });
      }
      if (texteDes(f).some(enthaeltGesundheitswort)) {
        ctx.addIssue({
          code: "custom",
          path: ["felder", i, "beschriftung"],
          message: "Gesundheitsdaten",
        });
      }
    });
  });
export type FormularDaten = z.infer<typeof formularDaten>;

export const formularBausteine = [
  baustein("formular", formularDaten),
] as const;

// Der Baustein als Typ, ohne bausteine.ts zu importieren (das hängt diese Datei an)
export type FormularBaustein = z.infer<(typeof formularBausteine)[0]>;

// Steuerzeichen (auch Tabulator) und Formatzeichen wie Zeilentrenner sind nie erlaubt; ein einzeiliges Feld ist eine Zeile, das Textfeld mit Zeilen lässt nur den Zeilenumbruch zu
const STEUERZEICHEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const TELEFON = /^\+?[0-9 ()./-]{6,30}$/;

export type AntwortWert = string | number | boolean | string[];
export type Antworten = Record<string, AntwortWert>;
export type AntwortFehlerCode =
  | "UNBEKANNT"
  | "PFLICHT"
  | "TYP"
  | "FORMAT"
  | "ZU_LANG"
  | "ZU_KURZ"
  | "BEREICH"
  | "OPTION"
  | "ANZAHL"
  | "STEUERZEICHEN";
// Der Fehler trägt nur die Feld-ID und den Code, nie den Wert: Antworten sind Personendaten und gehören nicht in Antwort, Log oder Audit
export type AntwortFehler = { feld: string; code: AntwortFehlerCode };

const istLeer = (wert: unknown) =>
  wert === undefined ||
  wert === null ||
  (typeof wert === "string" && wert.trim() === "") ||
  (Array.isArray(wert) && wert.length === 0);

// Prüft jede Antwort gegen ihr Feld. Gültige Antworten kommen bereinigt zurück (Text getrimmt, leere freiwillige Antworten fehlen); bei Fehlern gibt es keine Antworten
export function pruefeAntworten(
  felder: readonly Feld[],
  roh: Record<string, unknown>,
): { ok: true; antworten: Antworten } | { ok: false; fehler: AntwortFehler[] } {
  const fehler: AntwortFehler[] = [];
  const bekannt = new Set(felder.map((f) => f.id));
  for (const id of Object.keys(roh)) {
    if (!bekannt.has(id)) fehler.push({ feld: id, code: "UNBEKANNT" });
  }
  // Als Paare: Eine ID ist immer eine UUID, doch auch dann bleibt es ein gewöhnlicher Eintrag
  const ok: [string, AntwortWert][] = [];
  for (const f of felder) {
    const wert = Object.hasOwn(roh, f.id) ? roh[f.id] : undefined;
    const melde = (code: AntwortFehlerCode) =>
      fehler.push({ feld: f.id, code });
    if (f.typ === "janein") {
      if (wert === undefined || wert === null) {
        if (f.pflicht) melde("PFLICHT");
      } else if (typeof wert === "boolean") ok.push([f.id, wert]);
      else melde("TYP");
      continue;
    }
    if (f.typ === "zustimmung") {
      if (wert === true) ok.push([f.id, true]);
      else if (wert === undefined || wert === null || wert === false) {
        melde("PFLICHT");
      } else melde("TYP");
      continue;
    }
    if (istLeer(wert)) {
      if (f.pflicht) melde("PFLICHT");
      continue;
    }
    switch (f.typ) {
      case "text":
      case "textbereich": {
        if (typeof wert !== "string") {
          melde("TYP");
          break;
        }
        const text = (
          f.typ === "textbereich" ? wert.replace(/\r\n?/g, "\n") : wert
        ).trim();
        if (
          STEUERZEICHEN.test(
            f.typ === "textbereich" ? text.replace(/\n/g, "") : text,
          )
        ) {
          melde("STEUERZEICHEN");
          break;
        }
        const max =
          f.maxLaenge ??
          (f.typ === "text" ? STANDARD_TEXT_LAENGE : STANDARD_BEREICH_LAENGE);
        if (text.length > max) melde("ZU_LANG");
        else if (text.length < (f.minLaenge ?? 1)) melde("ZU_KURZ");
        else ok.push([f.id, text]);
        break;
      }
      case "zahl": {
        if (typeof wert !== "number" || !Number.isFinite(wert)) {
          melde("TYP");
        } else if (f.ganzzahl && !Number.isInteger(wert)) melde("FORMAT");
        else if (
          (f.min !== undefined && wert < f.min) ||
          (f.max !== undefined && wert > f.max) ||
          Math.abs(wert) > MAX_ZAHL
        ) {
          melde("BEREICH");
        } else ok.push([f.id, wert]);
        break;
      }
      case "datum": {
        if (typeof wert !== "string") melde("TYP");
        else if (!datumText.safeParse(wert).success) melde("FORMAT");
        else if ((f.von && wert < f.von) || (f.bis && wert > f.bis)) {
          melde("BEREICH");
        } else ok.push([f.id, wert]);
        break;
      }
      case "email": {
        const text = typeof wert === "string" ? wert.trim() : null;
        if (text === null) melde("TYP");
        else if (text.length > 254 || !z.email().safeParse(text).success) {
          melde("FORMAT");
        } else ok.push([f.id, text]);
        break;
      }
      case "telefon": {
        const text = typeof wert === "string" ? wert.trim() : null;
        if (text === null) melde("TYP");
        else if (
          !TELEFON.test(text) ||
          text.replace(/\D/g, "").length < 6 ||
          !sauber(text)
        ) {
          melde("FORMAT");
        } else ok.push([f.id, text]);
        break;
      }
      case "auswahl":
      case "optionsfelder": {
        if (typeof wert !== "string") melde("TYP");
        else if (!f.optionen.includes(wert)) melde("OPTION");
        else ok.push([f.id, wert]);
        break;
      }
      case "mehrfachwahl": {
        if (!Array.isArray(wert) || wert.some((w) => typeof w !== "string")) {
          melde("TYP");
        } else if (
          new Set(wert).size !== wert.length ||
          wert.some((w) => !f.optionen.includes(w))
        ) {
          melde("OPTION");
        } else if (
          wert.length < (f.minAuswahl ?? 1) ||
          wert.length > (f.maxAuswahl ?? f.optionen.length)
        ) {
          melde("ANZAHL");
        } else {
          // Die Reihenfolge der Optionen, nicht die der Anfrage
          ok.push([
            f.id,
            f.optionen.filter((o) => (wert as string[]).includes(o)),
          ]);
        }
        break;
      }
    }
  }
  if (fehler.length > 0) return { ok: false, fehler };
  const antworten: Antworten = Object.fromEntries(ok);
  if (JSON.stringify(antworten).length > MAX_ANTWORT_ZEICHEN) {
    return { ok: false, fehler: [{ feld: "", code: "ZU_LANG" }] };
  }
  return { ok: true, antworten };
}

// Die Anzeige einer Antwort als Text (Liste und CSV); die Feld-ID kommt aus der Version, mit der die Antwort entstand
export function antwortText(f: Feld | undefined, wert: AntwortWert | undefined) {
  if (wert === undefined) return "";
  if (typeof wert === "boolean") {
    return f?.typ === "zustimmung" ? "Ja, zugestimmt" : wert ? "Ja" : "Nein";
  }
  if (Array.isArray(wert)) return wert.join(", ");
  return String(wert);
}

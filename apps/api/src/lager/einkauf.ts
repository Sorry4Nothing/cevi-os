import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  EINKAUF_WARENGRUPPEN,
  einkaufArtikel,
  einkaufArtikelstamm,
  einkaufVorschlag,
} from "../db/schema.js";
import type { Tx } from "./sync.js";
import { registriereSuchquelle } from "./suche.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Einkaufsliste des Lagers (#392): Normalisierung der Namen, Ableitung der Warengruppe, Ansicht und Eingabeschemas. Die Tabelle ist beim ersten Import dieser Datei im Register des Sync-Kerns angemeldet (Feed: nur mit einkauf.lesen); einen Zeilenfilter gibt es nicht, jede Rolle mit dem Recht liest die ganze Liste.
registriereLagerTabelle({ tabelle: einkaufArtikel, recht: "einkauf.lesen" });
// Suche (#399): der Name des Artikels, wie ihn die ganze Liste zeigt
registriereSuchquelle({
  typ: "einkauf",
  recht: "einkauf.lesen",
  tabelle: einkaufArtikel,
  spalten: [einkaufArtikel.name],
  titel: sql`${einkaufArtikel.name}`,
});

export type Warengruppe = (typeof EINKAUF_WARENGRUPPEN)[number];

// Schlüssel für «gleicher Artikel»: Kleinbuchstaben, Umlaute als ae, oe, ue, Akzente weg, Leerraum zusammengezogen. «Käse», «KÄSE» und «Kaese» sind derselbe Artikel. Läuft in der Anwendung, nicht in SQL: lower() in der Datenbank hängt von deren Zeichensatz ab
export function normalisiereName(name: string) {
  return name
    .normalize("NFC")
    .toLocaleLowerCase("de-CH")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Die Stichwortliste ersetzt die Muster im Client (alte Fassung des Tools). Die Reihenfolge der Gruppen entscheidet nur bei gleich langem Treffer. Nur der Server leitet ab; die Lagerleitung korrigiert über die Warengruppe am Artikel, der Server merkt sich die Korrektur im Artikelstamm
// shortcut: Stichwörter im Code statt in einer Tabelle; bei Bedarf einer Abteilung pro Abteilung ergänzbar machen
export const STICHWORTE: Record<Exclude<Warengruppe, "diverses">, string[]> = {
  fleisch_fisch: [
    "fleisch",
    "wurst",
    "würste",
    "würstli",
    "schinken",
    "speck",
    "poulet",
    "huhn",
    "hühn",
    "hähnchen",
    "pute",
    "truthahn",
    "rind",
    "schwein",
    "kalb",
    "lamm",
    "salami",
    "schnitzel",
    "cervelat",
    "leber",
    "leberkäse",
    "fleischkäse",
    "aufschnitt",
    "geschnetzeltes",
    "gehacktes",
    "mortadella",
    "bündnerfleisch",
    "fisch",
    "lachs",
    "thon",
    "forelle",
    "crevetten",
    "garnelen",
  ],
  getraenke: [
    "wasser",
    "mineral",
    "sprudel",
    "saft",
    "sirup",
    "limonade",
    "limo",
    "cola",
    "eistee",
    "tee",
    "kaffee",
    "bier",
    "wein",
    "schorle",
    "getränk",
    "rivella",
    "ovomaltine",
    "prosecco",
    "sekt",
    "süssmost",
    "kaffeebohne",
  ],
  milch_kaese: [
    "milch",
    "käse",
    "jogurt",
    "joghurt",
    "quark",
    "rahm",
    "butter",
    "mozzarella",
    "ei",
    "eier",
    "parmesan",
    "sbrinz",
    "gruyère",
    "emmentaler",
    "raclette",
    "fondue",
    "feta",
    "mascarpone",
    "ziger",
  ],
  brot: [
    "brot",
    "brötchen",
    "zopf",
    "semmeli",
    "gipfeli",
    "croissant",
    "weggli",
    "bürli",
    "toast",
    "baguette",
    "laugen",
    "sandwich",
    "zwieback",
    "tortilla",
  ],
  obst_gemuese: [
    "apfel",
    "äpfel",
    "birne",
    "banane",
    "orange",
    "mandarine",
    "zitrone",
    "limette",
    "beere",
    "trauben",
    "melone",
    "ananas",
    "kiwi",
    "pfirsich",
    "aprikose",
    "kirsche",
    "zwetschge",
    "pflaume",
    "mango",
    "avocado",
    "früchte",
    "obst",
    "gemüse",
    "tomate",
    "gurke",
    "salat",
    "karotte",
    "rüebli",
    "zwiebel",
    "knoblauch",
    "lauch",
    "kartoffel",
    "peperoni",
    "zucchetti",
    "zucchini",
    "aubergine",
    "broccoli",
    "brokkoli",
    "blumenkohl",
    "kohl",
    "spinat",
    "pilz",
    "champignon",
    "sellerie",
    "fenchel",
    "kürbis",
    "mais",
    "erbse",
    "bohne",
    "kräuter",
    "petersilie",
    "basilikum",
  ],
  vorrat: [
    "reis",
    "pasta",
    "teigwaren",
    "spaghetti",
    "penne",
    "nudeln",
    "mehl",
    "zucker",
    "salz",
    "pfeffer",
    "gewürz",
    "öl",
    "essig",
    "senf",
    "ketchup",
    "mayonnaise",
    "mayo",
    "sauce",
    "suppe",
    "konfi",
    "konfitüre",
    "honig",
    "nutella",
    "müesli",
    "muesli",
    "haferflocken",
    "cornflakes",
    "linsen",
    "kichererbsen",
    "bouillon",
    "mark",
    "konserve",
    "dose",
    "passata",
    "polenta",
    "couscous",
    "hirse",
    "griess",
    "backpulver",
    "hefe",
    "kakao",
    "pudding",
    "schokolade",
    "guetzli",
    "biscuits",
    "chips",
    "nuss",
    "nüsse",
    "mandeln",
    "erdnussbutter",
  ],
  haushalt: [
    "papier",
    "servietten",
    "serviette",
    "kehrichtsack",
    "abfallsack",
    "seife",
    "spülmittel",
    "waschmittel",
    "reiniger",
    "putzmittel",
    "schwamm",
    "lappen",
    "alufolie",
    "folie",
    "zahnpasta",
    "shampoo",
    "batterie",
    "kerze",
    "streichhölzer",
    "feuerzeug",
    "taschentücher",
    "sonnencreme",
    "pflaster",
    "mückenschutz",
    "teller",
    "becher",
    "besteck",
    "handtuch",
  ],
};

// Die Stichwörter laufen durch dieselbe Normalisierung wie die Namen
const FLACHE_LISTE = Object.entries(STICHWORTE).flatMap(([gruppe, liste]) =>
  liste.map((wort) => [normalisiereName(wort), gruppe as Warengruppe] as const),
);
const WORT_ENDUNGEN = ["en", "n", "e", "s", "er"];

// Das Kernwort eines zusammengesetzten deutschen Wortes steht hinten: «Apfelsaft» ist ein Getränk, «Tomatenmark» Vorrat. Darum zählt zuerst die Endung des Wortes (mit und ohne Mehrzahlendung), das längste Stichwort gewinnt; trifft keines, der Anfang («Reiswaffeln»). Stichwörter mit höchstens zwei Buchstaben gelten nur als ganzes Wort («Ei»), solche unter vier Buchstaben nie als Anfang
function gruppeFuerWort(wort: string): Warengruppe | undefined {
  const formen = [
    wort,
    ...WORT_ENDUNGEN.filter(
      (e) => wort.endsWith(e) && wort.length - e.length >= 3,
    ).map((e) => wort.slice(0, -e.length)),
  ];
  const treffer: { laenge: number; gruppe?: Warengruppe } = { laenge: 0 };
  const nimm = (laenge: number, gruppe: Warengruppe) => {
    if (laenge > treffer.laenge) {
      treffer.laenge = laenge;
      treffer.gruppe = gruppe;
    }
  };
  for (const [stichwort, gruppe] of FLACHE_LISTE) {
    if (stichwort.length <= 2) {
      if (wort === stichwort) nimm(stichwort.length, gruppe);
    } else if (formen.some((f) => f.endsWith(stichwort))) {
      nimm(stichwort.length, gruppe);
    }
  }
  if (treffer.gruppe) return treffer.gruppe;
  for (const [stichwort, gruppe] of FLACHE_LISTE) {
    if (stichwort.length >= 4 && wort.startsWith(stichwort)) {
      nimm(stichwort.length, gruppe);
    }
  }
  return treffer.gruppe;
}

// Das letzte Wort entscheidet; trifft es nichts, das Wort davor («Wein rot»)
export function leiteWarengruppeAb(name: string): Warengruppe {
  const woerter = normalisiereName(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  for (const wort of woerter.reverse()) {
    const gruppe = gruppeFuerWort(wort);
    if (gruppe) return gruppe;
  }
  return "diverses";
}

// Vorgabe der Warengruppe: erst der Artikelstamm des Lagers (eine Korrektur der Lagerleitung), sonst die Stichwortliste. Eine Abfrage über den Primärschlüssel
export async function bestimmeWarengruppe(
  tx: Pick<Tx, "select">,
  lagerId: string,
  name: string,
): Promise<Warengruppe> {
  const [stamm] = await tx
    .select({ warengruppe: einkaufArtikelstamm.warengruppe })
    .from(einkaufArtikelstamm)
    .where(
      and(
        eq(einkaufArtikelstamm.lagerId, lagerId),
        eq(einkaufArtikelstamm.nameNorm, normalisiereName(name)),
      ),
    );
  return stamm?.warengruppe ?? leiteWarengruppeAb(name);
}

// Die Lagerleitung hat die Warengruppe eines Artikels von Hand gesetzt: Der Stamm merkt sie sich, damit neue Artikel mit diesem Namen gleich dort landen. Entspricht sie der Stichwortliste, braucht es keine Zeile (und eine alte entfällt)
export async function merkeWarengruppe(
  tx: Tx,
  lagerId: string,
  name: string,
  warengruppe: Warengruppe,
) {
  const nameNorm = normalisiereName(name);
  if (leiteWarengruppeAb(name) === warengruppe) {
    await tx
      .delete(einkaufArtikelstamm)
      .where(
        and(
          eq(einkaufArtikelstamm.lagerId, lagerId),
          eq(einkaufArtikelstamm.nameNorm, nameNorm),
        ),
      );
    return;
  }
  await tx
    .insert(einkaufArtikelstamm)
    .values({ lagerId, nameNorm, warengruppe })
    .onConflictDoUpdate({
      target: [einkaufArtikelstamm.lagerId, einkaufArtikelstamm.nameNorm],
      set: { warengruppe },
    });
}

// Vorschlagsliste: ein Artikel mehr in diesem Lager, mit der zuletzt getippten Schreibweise
export async function zaehleVorschlag(tx: Tx, lagerId: string, name: string) {
  await tx
    .insert(einkaufVorschlag)
    .values({ lagerId, nameNorm: normalisiereName(name), name })
    .onConflictDoUpdate({
      target: [einkaufVorschlag.lagerId, einkaufVorschlag.nameNorm],
      set: { name, haeufigkeit: sql`${einkaufVorschlag.haeufigkeit} + 1` },
    });
}

// Ansicht für die Antwort und die Konfliktantwort des Sync-Kerns: nur die Spalten der Route. Wer einkauft, kommt als ID; die Namen löst die Route beim Lesen auf
export const artikelAnsicht = (r: typeof einkaufArtikel.$inferSelect) => ({
  id: r.id,
  version: r.version,
  name: r.name,
  menge: r.menge === null ? null : Number(r.menge),
  einheit: r.einheit,
  warengruppe: r.warengruppe,
  einkaeuferPersonId: r.einkaeuferPersonId,
  erledigt: r.erledigt,
});

// Eingaben: strikt, nur die genannten Felder (SR-72). Der Name ist getrimmt und im Leerraum zusammengezogen; die Einheit klein geschrieben (so zählt «kg» wie «KG» zusammen), leer heisst keine Einheit
const name = z
  .string()
  .transform((w) => w.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1).max(100));
const menge = z.number().positive().max(1_000_000).multipleOf(0.001);
const einheit = z
  .string()
  .transform((w) => w.trim().toLocaleLowerCase("de-CH"))
  .pipe(z.string().max(20))
  .transform((w) => (w === "" ? null : w));
const person = z.uuid();
const version = z.number().int().min(1);
const warengruppe = z.enum(EINKAUF_WARENGRUPPEN);

export const artikelAnlegen = z.strictObject({
  name,
  menge: menge.nullable().optional(),
  einheit: einheit.nullable().optional(),
  warengruppe: warengruppe.optional(),
  einkaeuferPersonId: person.nullable().optional(),
});
export const artikelAendern = z
  .strictObject({
    version,
    name: name.optional(),
    menge: menge.nullable().optional(),
    einheit: einheit.nullable().optional(),
    warengruppe: warengruppe.optional(),
    einkaeuferPersonId: person.nullable().optional(),
    erledigt: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const versionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});

const wahrheit = z.enum(["true", "false"]).transform((w) => w === "true");
export const listeAbfrage = z.strictObject({
  // Cursor: die ID des letzten Eintrags der vorigen Seite
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  // «ich» ist die Person der Sitzung: «nur was ich einkaufe»
  einkaeufer: z.union([z.literal("ich"), z.uuid()]).optional(),
  erledigt: wahrheit.optional(),
});
export const vorschlagAbfrage = z.strictObject({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// Zeilen für die DB: Menge als Dezimalzeichenfolge (numeric), Namen mit Schlüssel
export const speicherWerte = (w: {
  name?: string;
  menge?: number | null;
  einheit?: string | null;
}) => ({
  ...(w.name !== undefined && {
    name: w.name,
    nameNorm: normalisiereName(w.name),
  }),
  ...(w.menge !== undefined && {
    menge: w.menge === null ? null : String(w.menge),
  }),
  ...(w.einheit !== undefined && { einheit: w.einheit }),
});

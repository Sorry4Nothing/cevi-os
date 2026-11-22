import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, sql as roh } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { verbindeDatenbank } from "../datenbank.js";
import { erstelleDb, type Db } from "../db/client.js";
import {
  abteilung,
  medium,
  personTag,
  seite,
  seiteVersion,
  tag,
  user,
} from "../db/schema.js";
import { fehlerCode } from "../kalender/fehler.js";
import { log } from "../log.js";
import { istAusgabePfad, type Ausgabe } from "./ausgabe.js";
import {
  pruefeDokument,
  sammleVerweise,
  type Seitendokument,
} from "./dokument.js";
import { aufWebsiteEreignis } from "./ereignisse.js";
import {
  keineDaten,
  rendereAnmeldung,
  rendereFehlerseite,
  rendereHuelle,
  rendereServerfehler,
  rendereWartung,
  rendereRobots,
  rendereSeite,
  rendereSitemap,
  STARTSEITE,
  type Daten,
  type Kontakt,
  type Kontext,
  type Logo,
  type MedienDaten,
  type Mitglied,
  type NavPunkt,
} from "./rendern.js";
import { baueWeiterleitungen, CADDY_DATEI } from "./weiterleitungen.js";
import { rendereTermineSeiten, TERMINE_DATEIEN } from "./termine-seiten.js";
import {
  adresseSchema,
  adressenVon,
  RESERVIERTE_ADRESSEN,
  type Knoten,
} from "./seiten.js";

// Erzeugt aus den veröffentlichten, öffentlichen Seiten die statischen Dateien (#351) und räumt weg, was nicht mehr gebraucht wird.
// Der Abruf einer Seite berührt die Datenbank nie: Besucher bekommen nur diese Dateien.

// Eigener Schlüssel neben denen des Kalender-Syncs (740027), des Eckdaten-Syncs (740028) und der Zeitregeln (740029)
const SPERRE_WEBSITE = 740_030;
export const ABGLEICH_INTERVALL_MS = 10 * 60 * 1000;
const MAX_FUNKTIONEN = 3;

const SITEMAP = "sitemap.xml";
const ROBOTS = "robots.txt";
const FEHLERSEITE = "404.html";
// Der Host liefert sie bei einem Fehler der Website (500) und in der Wartung (503), siehe docs/website-auslieferung.md
const SERVERFEHLER = "500.html";
const WARTUNG = "wartung.html";
const STYLESHEET = "website/website.css";
// Seiten des Baums, auf die der Fuss verweist (Adresse auf der obersten Ebene); «datenschutz» selbst gehört der Plattform
const IMPRESSUM_ADRESSE = "impressum";
const DATENSCHUTZ_ADRESSE = "datenschutz-website";
// Die Anmeldeseite (#354) liegt unter der reservierten Adresse «anmelden»
const ANMELDUNG = "anmelden/index.html";
// Nur diese Dateien löscht der Abgleich selbst, wenn sie nicht mehr gebraucht werden: die Seiten (und die Rückfallseiten der Weiterleitungen, die ebenso heissen) und weiterleitungen.caddy. Alles andere im Verzeichnis bleibt unangetastet
const SEITENDATEI = /(^|\/)index\.html$/;

// Weitere Quellen für Bausteine mit Daten (#355: Stufenfakten, #549: Termine); ihre Einträge ergänzen die eingebauten.
// dokumente: die öffentlichen Seiten dieses Laufs (Seiten-ID zu Dokument), für Quellen, die wissen müssen, welche Bausteine es gibt
export type Datenquelle = (
  db: Db,
  abteilungId: string,
  seitenIds: string[],
  dokumente?: ReadonlyMap<string, Seitendokument>,
) => Promise<Partial<Daten>>;

export type AbgleichOptionen = {
  ausgabe: Ausgabe;
  abteilungId: string;
  // Ohne Schrägstrich am Ende, etwa «https://www.example.org»
  basisUrl: string;
  // Inhalt von public/website/website.css
  stylesheet: string;
  // Skripte der Website (#354): Dateiname in public/website/ zu Inhalt; sie liegen unter website/<Name>
  // Binärdateien (die Schrift) kommen als Bytes
  skripte?: Record<string, string | Uint8Array>;
  datenquellen?: Datenquelle[];
  // Adresse, Telefon und E-Mail der Abteilung für Fuss und Kontaktkarte (aus der Konfiguration des Servers); Impressum und Datenschutz suchen die Seiten im Baum
  kontakt?: Pick<Kontakt, "adresse" | "telefon" | "email">;
  // Hash der zuletzt geschriebenen Gesamtdateien (Sitemap, robots.txt, ...); in Tests und beim Start leer
  merker?: Map<string, string>;
};

export type AbgleichErgebnis = {
  geschrieben: number;
  geloescht: number;
  fehler: number;
};

const sha256 = (text: string | Uint8Array) =>
  createHash("sha256").update(text).digest("hex");

type Zeile = {
  id: string;
  elternId: string | null;
  adresse: string;
  titel: string;
  reihenfolge: number;
  tagId: string | null;
  sichtbarkeit: "oeffentlich" | "angemeldet" | "tags";
  veroeffentlichteVersionId: string | null;
  ausgabeHash: string | null;
};

// Cevi-Name und Funktion, nie der Name im Konto: Wer keinen Cevi-Namen hat, erscheint nicht
const sichtbarePerson = and(
  isNull(user.deaktiviertAm),
  roh`${user.banned} is not true`,
  isNotNull(user.ceviName),
);

// Das Logo der Abteilung (#550): nur ein öffentliches Bild; ein fehlendes, fremdes oder nicht öffentliches Medium ergibt kein Logo (der Kopf zeigt dann die Wortmarke).
// Die Fassung für den dunklen Modus (#558) kommt in derselben Abfrage mit; für sie gelten dieselben Bedingungen, sonst fehlt sie
const logoDunkel = alias(medium, "logo_dunkel");
export async function ladeLogo(
  db: Pick<Db, "select">,
  abteilungId: string,
): Promise<Logo | undefined> {
  const [z] = await db
    .select({
      id: medium.id,
      altText: medium.altText,
      breite: medium.breite,
      hoehe: medium.hoehe,
      dunkelId: logoDunkel.id,
      dunkelBreite: logoDunkel.breite,
      dunkelHoehe: logoDunkel.hoehe,
    })
    .from(abteilung)
    .innerJoin(medium, eq(medium.id, abteilung.websiteLogoMediumId))
    .leftJoin(
      logoDunkel,
      and(
        eq(logoDunkel.id, abteilung.websiteLogoDunkelMediumId),
        eq(logoDunkel.abteilungId, abteilungId),
        eq(logoDunkel.sichtbarkeit, "oeffentlich"),
        roh`${logoDunkel.mimeTyp} like 'image/%'`,
      ),
    )
    .where(
      and(
        eq(abteilung.id, abteilungId),
        eq(medium.abteilungId, abteilungId),
        eq(medium.sichtbarkeit, "oeffentlich"),
        roh`${medium.mimeTyp} like 'image/%'`,
      ),
    );
  if (!z) return undefined;
  const { dunkelId, dunkelBreite, dunkelHoehe, ...logo } = z;
  return {
    ...logo,
    ...(dunkelId && {
      dunkel: { id: dunkelId, breite: dunkelBreite, hoehe: dunkelHoehe },
    }),
  };
}

// nurOeffentlich: false beim Nachladen für eine angemeldete Person (#354): Dann gehören auch Medien dazu, die nur für Angemeldete sichtbar sind (Entscheid A8)
export async function ladeDaten(
  db: Db,
  abteilungId: string,
  dokumente: Seitendokument[],
  nurOeffentlich = true,
): Promise<Daten> {
  const medienIds = new Set<string>();
  const personenIds = new Set<string>();
  const tagIds = new Set<string>();
  for (const dok of dokumente) {
    const v = sammleVerweise(dok);
    v.medien.forEach((i) => medienIds.add(i));
    v.personen.forEach((i) => personenIds.add(i));
    v.tags.forEach((i) => tagIds.add(i));
  }
  const medien: Map<string, MedienDaten> = new Map();
  const personen: Map<string, Mitglied> = new Map();
  const teams: Map<string, { name: string; mitglieder: Mitglied[] }> =
    new Map();

  // Nur öffentliche Medien der Abteilung: Ein anderes Medium in einem öffentlichen Baustein erscheint nicht
  if (medienIds.size > 0) {
    const zeilen = await db
      .select()
      .from(medium)
      .where(
        and(
          eq(medium.abteilungId, abteilungId),
          nurOeffentlich ? eq(medium.sichtbarkeit, "oeffentlich") : undefined,
          inArray(medium.id, [...medienIds]),
        ),
      );
    for (const m of zeilen) {
      medien.set(m.id, {
        mimeTyp: m.mimeTyp,
        groesse: m.groesse,
        breite: m.breite,
        hoehe: m.hoehe,
        altText: m.altText,
      });
    }
  }

  if (personenIds.size > 0) {
    const zeilen = await db
      .select({ id: user.id, name: user.ceviName })
      .from(user)
      .where(
        and(
          eq(user.abteilungId, abteilungId),
          inArray(user.id, [...personenIds]),
          sichtbarePerson,
        ),
      );
    const rollen = await db
      .select({ userId: personTag.userId, rolle: personTag.rolle })
      .from(personTag)
      .innerJoin(tag, eq(tag.id, personTag.tagId))
      .where(
        and(
          eq(tag.abteilungId, abteilungId),
          inArray(
            personTag.userId,
            zeilen.map((z) => z.id),
          ),
          isNotNull(personTag.rolle),
        ),
      );
    for (const z of zeilen) {
      const funktionen = [
        ...new Set(
          rollen.filter((r) => r.userId === z.id).map((r) => r.rolle!),
        ),
      ]
        .sort()
        .slice(0, MAX_FUNKTIONEN);
      personen.set(z.id, {
        name: z.name!,
        funktion: funktionen.length > 0 ? funktionen.join(", ") : null,
      });
    }
  }

  if (tagIds.size > 0) {
    const tags = await db
      .select({ id: tag.id, name: tag.name })
      .from(tag)
      .where(
        and(eq(tag.abteilungId, abteilungId), inArray(tag.id, [...tagIds])),
      );
    const mitglieder = await db
      .select({
        tagId: personTag.tagId,
        name: user.ceviName,
        funktion: personTag.rolle,
      })
      .from(personTag)
      .innerJoin(user, eq(user.id, personTag.userId))
      .where(
        and(
          inArray(
            personTag.tagId,
            tags.map((t) => t.id),
          ),
          eq(user.abteilungId, abteilungId),
          sichtbarePerson,
        ),
      )
      .orderBy(roh`${personTag.prioritaet} asc nulls last`, user.ceviName);
    for (const t of tags) {
      teams.set(t.id, {
        name: t.name,
        mitglieder: mitglieder
          .filter((m) => m.tagId === t.id)
          .map((m) => ({ name: m.name!, funktion: m.funktion })),
      });
    }
  }
  return { ...keineDaten(), medien, personen, teams };
}

// Pfad im Netz und Datei: die Seite «start» der obersten Ebene ist «/»; null, wenn die Adresse nie ausgeliefert wird
function ziel(knoten: Knoten, id: string) {
  const adressen = adressenVon(knoten, id);
  if (
    adressen.length === 0 ||
    !adressen.every((a) => adresseSchema.safeParse(a).success)
  ) {
    return null;
  }
  // Die obersten Adressen gehören der API und den Dateien der Website
  if (RESERVIERTE_ADRESSEN.includes(adressen[0]!)) return null;
  const start = adressen.length === 1 && adressen[0] === STARTSEITE;
  const datei = start ? "index.html" : `${adressen.join("/")}/index.html`;
  if (!istAusgabePfad(datei)) return null;
  return { pfad: start ? "/" : `/${adressen.join("/")}`, datei };
}

function baueNavigation(
  zeilen: Zeile[],
  oeffentlich: Map<string, { pfad: string }>,
): NavPunkt[] {
  const nachId = new Map(zeilen.map((z) => [z.id, z]));
  // Nächste öffentliche Vorfahrin; ohne sie hängt die Seite an der Wurzel
  const vorfahrin = (z: Zeile) => {
    for (
      let e = z.elternId ? nachId.get(z.elternId) : undefined, n = 0;
      e && n < 100;
      e = e.elternId ? nachId.get(e.elternId) : undefined, n++
    ) {
      if (oeffentlich.has(e.id)) return e.id;
    }
    return null;
  };
  const kinderVon = new Map<string | null, Zeile[]>();
  for (const z of zeilen) {
    if (!oeffentlich.has(z.id)) continue;
    const eltern = vorfahrin(z);
    kinderVon.set(eltern, [...(kinderVon.get(eltern) ?? []), z]);
  }
  const bau = (eltern: string | null, tiefe: number): NavPunkt[] =>
    tiefe > 10
      ? []
      : (kinderVon.get(eltern) ?? [])
          .sort(
            (a, b) =>
              a.reihenfolge - b.reihenfolge ||
              a.adresse.localeCompare(b.adresse),
          )
          .map((z) => ({
            pfad: oeffentlich.get(z.id)!.pfad,
            titel: z.titel,
            kinder: bau(z.id, tiefe + 1),
          }));
  return bau(null, 0);
}

// Nur Art, Seiten-ID und ein Code wie EACCES; nie Pfad, Text der Meldung oder Inhalt der Seite
const meldeFehler = (art: string, fehler?: unknown, seiteId?: string) => {
  const code = fehlerCode(fehler);
  log(undefined, {
    ereignis: "website_ausgabe",
    art,
    seiteId,
    code:
      typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(code)
        ? code
        : fehler === undefined
          ? undefined
          : "fehler",
  });
};

export async function erzeugeWebsite(
  db: Db,
  opt: AbgleichOptionen,
): Promise<AbgleichErgebnis> {
  const { ausgabe, abteilungId, basisUrl } = opt;
  const merker = opt.merker ?? new Map<string, string>();
  const ergebnis: AbgleichErgebnis = {
    geschrieben: 0,
    geloescht: 0,
    fehler: 0,
  };

  const [abt] = await db
    .select({ name: abteilung.name })
    .from(abteilung)
    .where(eq(abteilung.id, abteilungId));
  // Eine falsche ID in der Konfiguration darf nie die ganze Website löschen
  if (!abt) {
    log(undefined, { ereignis: "website_ausgabe", art: "abteilung_fehlt" });
    ergebnis.fehler++;
    return ergebnis;
  }

  const zeilen: Zeile[] = await db
    .select({
      id: seite.id,
      elternId: seite.elternId,
      adresse: seite.adresse,
      titel: seite.titel,
      reihenfolge: seite.reihenfolge,
      tagId: seite.tagId,
      sichtbarkeit: seite.sichtbarkeit,
      veroeffentlichteVersionId: seite.veroeffentlichteVersionId,
      ausgabeHash: seite.ausgabeHash,
    })
    .from(seite)
    .where(eq(seite.abteilungId, abteilungId));
  const knoten: Knoten = new Map(zeilen.map((z) => [z.id, z]));

  // Nur Seiten, die öffentlich sind und eine veröffentlichte Version haben; alle anderen erzeugen keine Datei
  const kandidaten = zeilen.filter(
    (z) => z.sichtbarkeit === "oeffentlich" && z.veroeffentlichteVersionId,
  );
  const versionen = new Map<string, { inhalt: unknown; erstelltAm: Date }>();
  if (kandidaten.length > 0) {
    const vz = await db
      .select({
        id: seiteVersion.id,
        inhalt: seiteVersion.inhalt,
        erstelltAm: seiteVersion.erstelltAm,
      })
      .from(seiteVersion)
      .where(
        inArray(
          seiteVersion.id,
          kandidaten.map((z) => z.veroeffentlichteVersionId!),
        ),
      );
    for (const v of vz) versionen.set(v.id, v);
  }

  // Pfad, Datei und Dokument je Seite; was nicht geprüft werden kann, bleibt beim alten Stand liegen (kein Löschen), mit Eintrag im Log
  const oeffentlich = new Map<string, { pfad: string; datei: string }>();
  const dokumente = new Map<string, { dok: Seitendokument; geaendert: Date }>();
  const behalten = new Set<string>();
  for (const z of kandidaten) {
    const z2 = ziel(knoten, z.id);
    if (!z2) {
      meldeFehler("adresse", undefined, z.id);
      ergebnis.fehler++;
      continue;
    }
    oeffentlich.set(z.id, z2);
    const v = versionen.get(z.veroeffentlichteVersionId!);
    const pruefung = v ? pruefeDokument(v.inhalt) : null;
    if (!v || !pruefung?.ok) {
      meldeFehler("dokument", undefined, z.id);
      ergebnis.fehler++;
      behalten.add(z2.datei);
      continue;
    }
    dokumente.set(z.id, { dok: pruefung.dokument, geaendert: v.erstelltAm });
  }

  // Ganz geschützte Seiten mit veröffentlichter Version bekommen nur eine Hülle (#354): ohne Titel, ohne Inhalt, nicht in Navigation und Sitemap
  const huellen = new Map<string, { pfad: string; datei: string }>();
  for (const z of zeilen) {
    if (z.sichtbarkeit === "oeffentlich" || !z.veroeffentlichteVersionId) {
      continue;
    }
    const z2 = ziel(knoten, z.id);
    if (z2) huellen.set(z.id, z2);
  }

  const ids = [...dokumente.keys()];
  const daten = await ladeDaten(
    db,
    abteilungId,
    [...dokumente.values()].map((d) => d.dok),
  );
  for (const quelle of opt.datenquellen ?? []) {
    const mehr = await quelle(
      db,
      abteilungId,
      ids,
      new Map([...dokumente].map(([id, d]) => [id, d.dok])),
    );
    for (const schluessel of Object.keys(mehr) as (keyof Daten)[]) {
      (daten as Record<string, unknown>)[schluessel] = new Map([
        ...(daten[schluessel] as ReadonlyMap<string, unknown>),
        ...(mehr[schluessel] as ReadonlyMap<string, unknown>),
      ]);
    }
  }

  // Die Navigation kennt nur Seiten, die auch eine Datei bekommen
  const sichtbar = new Map(
    [...oeffentlich].filter(
      ([id]) => dokumente.has(id) || behalten.has(oeffentlich.get(id)!.datei),
    ),
  );
  // Impressum und Datenschutz stehen im Fuss, nicht in der Leiste; ohne Seite «Datenschutz» führt der Fuss auf die Erklärung der Plattform, ein Impressum nennt er nur, wenn es die Seite gibt
  const fusspfad = (adresse: string) =>
    [...sichtbar.values()].find((z) => z.pfad === `/${adresse}`)?.pfad;
  const impressum = fusspfad(IMPRESSUM_ADRESSE);
  const datenschutz = fusspfad(DATENSCHUTZ_ADRESSE);
  daten.kontakt = {
    ...opt.kontakt,
    ...(impressum && { impressum }),
    ...(datenschutz && { datenschutz }),
  };
  const kontext: Kontext = {
    abteilung: abt.name,
    logo: await ladeLogo(db, abteilungId),
    basisUrl,
    navigation: baueNavigation(
      zeilen,
      new Map(
        [...sichtbar].filter(
          ([, z]) => z.pfad !== impressum && z.pfad !== datenschutz,
        ),
      ),
    ),
    daten,
  };

  // Weiterleitungen alter Adressen (#356): weiterleitungen.caddy und eine Rückfallseite je alter Adresse, wie die übrigen Gesamtdateien
  const weiterleitungen = await baueWeiterleitungen(db, {
    abteilungId,
    abteilung: abt.name,
    basisUrl,
    seiten: [...sichtbar.keys()].map((id) => ({
      pfad: oeffentlich.get(id)!.pfad,
      tagId: zeilen.find((z) => z.id === id)!.tagId,
    })),
  });

  const vorhanden = new Set(await ausgabe.liste());
  const soll = new Set<string>([
    ...behalten,
    SITEMAP,
    ROBOTS,
    FEHLERSEITE,
    STYLESHEET,
    ANMELDUNG,
    ...TERMINE_DATEIEN,
    ...Object.keys(opt.skripte ?? {}).map((n) => `website/${n}`),
    ...[...huellen.values()].map((h) => h.datei),
    ...weiterleitungen.map(([datei]) => datei),
  ]);

  // Seiten: schreiben, wenn sich die Datei geändert hat oder fehlt
  const schreibeSeite = async (id: string, datei: string, html: string) => {
    soll.add(datei);
    const hash = sha256(html);
    if (
      zeilen.find((z) => z.id === id)!.ausgabeHash === hash &&
      vorhanden.has(datei)
    ) {
      return;
    }
    try {
      await ausgabe.schreibe(datei, html);
      await db
        .update(seite)
        .set({ ausgabeHash: hash, ausgabeAm: roh`now()` })
        .where(eq(seite.id, id));
      ergebnis.geschrieben++;
    } catch (fehler) {
      meldeFehler("schreiben", fehler, id);
      ergebnis.fehler++;
    }
  };
  for (const [id, { dok }] of dokumente) {
    const { pfad, datei } = oeffentlich.get(id)!;
    await schreibeSeite(
      id,
      datei,
      rendereSeite({ id, pfad, dokument: dok }, kontext),
    );
  }
  for (const [id, { pfad, datei }] of huellen) {
    await schreibeSeite(id, datei, rendereHuelle(pfad, kontext));
  }

  // Gesamtdateien: Sitemap und robots.txt nennen nur öffentliche Seiten mit Datei
  const gesamt: [string, string | Uint8Array][] = [
    [
      SITEMAP,
      rendereSitemap(
        basisUrl,
        [...dokumente]
          .map(([id, d]) => ({
            pfad: oeffentlich.get(id)!.pfad,
            geaendert: d.geaendert,
          }))
          .sort((a, b) => a.pfad.localeCompare(b.pfad)),
      ),
    ],
    [ROBOTS, rendereRobots(basisUrl)],
    [FEHLERSEITE, rendereFehlerseite(kontext)],
    [SERVERFEHLER, rendereServerfehler(kontext)],
    [WARTUNG, rendereWartung(kontext)],
    [STYLESHEET, opt.stylesheet],
    [ANMELDUNG, rendereAnmeldung(kontext)],
    ...rendereTermineSeiten(kontext),
    ...Object.entries(opt.skripte ?? {}).map(
      ([name, inhalt]): [string, string | Uint8Array] => [
        `website/${name}`,
        inhalt,
      ],
    ),
    ...weiterleitungen,
  ];
  for (const [datei, inhalt] of gesamt) {
    const hash = sha256(inhalt);
    if (merker.get(datei) === hash && vorhanden.has(datei)) continue;
    try {
      await ausgabe.schreibe(datei, inhalt);
      merker.set(datei, hash);
      ergebnis.geschrieben++;
    } catch (fehler) {
      meldeFehler("schreiben", fehler);
      ergebnis.fehler++;
    }
  }

  // Aufräumen: Seitendateien, die zu keiner öffentlichen Seite mehr gehören (zurückgezogen, gelöscht, nicht mehr öffentlich, Adresse geändert)
  for (const datei of vorhanden) {
    if (
      soll.has(datei) ||
      !(SEITENDATEI.test(datei) || datei === CADDY_DATEI)
    ) {
      continue;
    }
    try {
      await ausgabe.loesche(datei);
      ergebnis.geloescht++;
    } catch (fehler) {
      meldeFehler("loeschen", fehler);
      ergebnis.fehler++;
    }
  }
  // Seiten ohne Datei tragen keinen Hash mehr
  const ohneDatei = zeilen
    .filter(
      (z) =>
        z.ausgabeHash !== null &&
        !dokumente.has(z.id) &&
        !huellen.has(z.id) &&
        !behalten.has(oeffentlich.get(z.id)?.datei ?? ""),
    )
    .map((z) => z.id);
  if (ohneDatei.length > 0) {
    await db
      .update(seite)
      .set({ ausgabeHash: null, ausgabeAm: null })
      .where(inArray(seite.id, ohneDatei));
  }
  return ergebnis;
}

// Ein Lauf unter der Datenbanksperre; «gesperrt» heisst: ein anderer Lauf arbeitet gerade (zum Beispiel eine zweite Instanz)
export async function synchronisiereWebsite({
  datenbankUrl,
  ...opt
}: AbgleichOptionen & { datenbankUrl: string }): Promise<
  AbgleichErgebnis | "gesperrt"
> {
  // Eigene Verbindung mit max 1: Sperre und Freigabe müssen auf derselben Sitzung laufen
  const sql = verbindeDatenbank(datenbankUrl, { max: 1 });
  try {
    const [sperre] =
      await sql`select pg_try_advisory_lock(${SPERRE_WEBSITE}) as erhalten`;
    if (!sperre.erhalten) return "gesperrt";
    try {
      return await erzeugeWebsite(erstelleDb(sql), opt);
    } finally {
      await sql`select pg_advisory_unlock(${SPERRE_WEBSITE})`.catch(() => {});
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Startet den Lauf sofort, dann bei jedem Website-Ereignis dieser Abteilung und alle 10 Minuten als Abgleich (mehrere Instanzen hören nur ihre eigenen Ereignisse).
// Ein Lauf, der bei einem Ereignis schon läuft, wird danach genau einmal wiederholt. Gibt eine Funktion zurück, die alles wieder abmeldet.
export function starteWebsiteAbgleich(
  lauf: () => Promise<unknown>,
  abteilungId: string,
) {
  let laeuft = false;
  let nochmal = false;
  const starte = async () => {
    if (laeuft) {
      nochmal = true;
      return;
    }
    laeuft = true;
    try {
      do {
        nochmal = false;
        await lauf().catch((fehler) => meldeFehler("lauf", fehler));
      } while (nochmal);
    } finally {
      laeuft = false;
    }
  };
  const abmelden = aufWebsiteEreignis((e) => {
    if (e.abteilungId === abteilungId) void starte();
  });
  void starte();
  const takt = setInterval(starte, ABGLEICH_INTERVALL_MS);
  return () => {
    clearInterval(takt);
    abmelden();
  };
}

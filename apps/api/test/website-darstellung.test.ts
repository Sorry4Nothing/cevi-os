import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { erzeugeWebsite } from "../src/website/abgleich.js";
import { dateisystemAusgabe, type Ausgabe } from "../src/website/ausgabe.js";
import { bausteinSchema } from "../src/website/bausteine.js";
import { pruefeDokument } from "../src/website/dokument.js";
import {
  keineDaten,
  rendereFehlerseite,
  rendereSeite,
  type Daten,
  type Kontext,
  type NavPunkt,
  type TerminEintrag,
} from "../src/website/rendern.js";
import { ladeTerminlisten } from "../src/website/termine-liste.js";
import { API_URL } from "./hilfen/datenbank.js";

// Darstellung nach dem Design «Cevi Web» (#549): Stufenkarten, Termin-Liste, Hinweisband, Kontaktkarte, Titelbild, Navigation in einer Zeile, Fuss

const id = () => randomUUID();
const b = (typ: string, daten: unknown) => ({
  id: id(),
  typ,
  daten,
  sichtbarkeit: "erbt",
});
const dok = (titel: string, ...bausteine: unknown[]) => {
  const p = pruefeDokument({ v: 1, titel, bausteine });
  if (!p.ok) throw new Error(JSON.stringify(p.fehler));
  return p.dokument;
};
const nav = (titel: string, kinder: NavPunkt[] = []): NavPunkt => ({
  pfad: `/${titel.toLowerCase().replaceAll(" ", "-")}`,
  titel,
  kinder,
});
const kontext = (daten: Daten = keineDaten(), navigation = [nav("Stufen")]) =>
  ({
    abteilung: "Cevi Beispielstadt",
    basisUrl: "https://www.example.org",
    navigation,
    daten,
  }) satisfies Kontext;
const seite = (d: ReturnType<typeof dok>, daten?: Daten, pfad = "/stufen") =>
  rendereSeite({ id: id(), pfad, dokument: d }, kontext(daten));
const zaehle = (t: string, teil: string) => t.split(teil).length - 1;

describe("Stufenkarten und Liste (Baustein «Karten»)", () => {
  const eintraege = [
    {
      titel: "Bienli",
      text: "Kindergarten bis 2. Klasse",
      link: "/stufen/bienli",
    },
    { titel: "Ohne Link" },
  ];

  test("«karten»: Name als Überschrift, Text, «Mehr zu …» nur mit Link; die Ebene folgt auf die letzte", () => {
    const html = seite(
      dok(
        "Stufen",
        b("ueberschrift", { ebene: 2, text: "Unsere Stufen" }),
        b("karten", { darstellung: "karten", eintraege }),
      ),
    );
    expect(html).toContain(
      '<ul class="karten"><li><h3 class="titel">Bienli</h3><p>Kindergarten bis 2. Klasse</p><p><a href="/stufen/bienli" class="mehr">Mehr zu Bienli</a></p></li>',
    );
    // Ohne Link kein «Mehr zu»; ein Titel ist nie ein Link
    expect(html).toContain('<li><h3 class="titel">Ohne Link</h3></li>');
    expect(html).not.toContain('<a href="/stufen/bienli">Bienli</a>');
  });

  test("«karten» ohne Überschrift davor springt nicht über eine Ebene (h2 nach dem h1)", () => {
    const html = seite(
      dok("Stufen", b("karten", { darstellung: "karten", eintraege })),
    );
    expect(html).toContain('<h2 class="titel">Bienli</h2>');
  });

  test("«liste»: eine Zeile je Eintrag mit Link am Titel", () => {
    const html = seite(
      dok("Stufen", b("karten", { darstellung: "liste", eintraege })),
    );
    expect(html).toContain(
      '<ul class="liste"><li><p class="titel"><a href="/stufen/bienli">Bienli</a></p>',
    );
  });
});

describe("Hinweisband", () => {
  test("Symbol, Satz und Link; der Link muss eine erlaubte Adresse sein", () => {
    const html = seite(
      dok(
        "T",
        b("hinweis", {
          text: "Anmeldung offen bis 15. März",
          link: { beschriftung: "Zum Lager", ziel: "/anlaesse/lager" },
        }),
      ),
    );
    expect(html).toContain('<div class="band" role="status"><svg');
    expect(html).toContain(
      '<div class="text"><strong>Anmeldung offen bis 15. März</strong><a href="/anlaesse/lager">Zum Lager</a></div>',
    );
  });

  test("Schema: Text Pflicht, Link nur mit Beschriftung und erlaubtem Ziel", () => {
    const ok = (daten: unknown) =>
      bausteinSchema.safeParse(b("hinweis", daten)).success;
    expect(ok({ text: "Satz" })).toBe(true);
    expect(ok({})).toBe(false);
    expect(
      ok({
        text: "Satz",
        link: { beschriftung: "x", ziel: "javascript:alert(1)" },
      }),
    ).toBe(false);
    expect(ok({ text: "Satz", link: { ziel: "/start" } })).toBe(false);
    expect(ok({ text: "Satz", zusatz: 1 })).toBe(false);
  });
});

describe("Kontaktkarte", () => {
  const daten = (): Daten => {
    const personId = id();
    return {
      ...keineDaten(),
      personen: new Map([
        [personId, { name: "Mara Muster", funktion: "Abteilungsleitung" }],
      ]),
      kontakt: { telefon: "043 543 96 82", email: "info@example.org" },
    };
  };

  test("Frage, Ansprechperson links, Telefon und E-Mail als Links rechts", () => {
    const d = daten();
    const personId = [...d.personen.keys()][0]!;
    const html = seite(dok("T", b("kontaktkarte", { personId })), d);
    expect(html).toContain("<h2>Fragen? Melde dich bei uns.</h2>");
    expect(html).toContain(
      '<p class="leise">Mara Muster, Abteilungsleitung</p>',
    );
    expect(html).toContain('<a href="tel:+41435439682">043 543 96 82</a>');
    expect(html).toContain(
      '<a href="mailto:info@example.org">info@example.org</a>',
    );
  });

  test("ohne Person und ohne Kontaktdaten entfällt die Karte", () => {
    expect(seite(dok("T", b("kontaktkarte", {})))).not.toContain("kontaktband");
  });

  test("Telefon: Landesvorwahl bleibt, +41 steht für eine Nummer mit 0", () => {
    const mit = (telefon: string) =>
      seite(dok("T", b("kontaktkarte", {})), {
        ...keineDaten(),
        kontakt: { telefon },
      });
    expect(mit("+49 30 123456")).toContain('href="tel:+4930123456"');
    expect(mit("0041 43 000 00 00")).toContain('href="tel:+41430000000"');
  });
});

describe("Termin-Liste", () => {
  const termin = (extra: Partial<TerminEintrag> = {}): TerminEintrag => ({
    id: id(),
    titel: "Waldspiel",
    von: "2027-02-06",
    bis: "2027-02-06",
    zeitVon: "14:00",
    zeitBis: "17:00",
    ort: "Pfadiheim Beispielwald",
    stufen: ["Wölfe", "Adler"],
    anlassId: null,
    ...extra,
  });
  const mitTermine = (liste: TerminEintrag[], anzahl = 5) => {
    const baustein = b("terminliste", { anzahl });
    return seite(dok("T", baustein), {
      ...keineDaten(),
      termine: new Map([[baustein.id, liste]]),
    });
  };

  test("Datumsfeld, Titel, Zeit und Ort, Chips der Stufen, Link «Alle Termine»", () => {
    const html = mitTermine([termin()]);
    expect(html).toContain(
      '<div class="abschnitt-kopf"><h2>Nächste Termine</h2><a class="mehr" href="/termine">Alle Termine</a></div>',
    );
    expect(html).toContain(
      '<span class="datum" aria-hidden="true"><span class="tag">Sa</span><span class="nr">6</span><span class="mo">Feb.</span></span>',
    );
    expect(html).toContain('<span class="titel">Waldspiel</span>');
    expect(html).toContain(
      '<span class="meta">14:00–17:00 · Pfadiheim Beispielwald</span>',
    );
    expect(html).toContain(
      '<span class="chips"><span class="chip st">Wölfe</span><span class="chip st">Adler</span></span>',
    );
  });

  test("ohne Anlass keine Verknüpfung; mit Anlass ein Link auf die Anlassseite mit vollem Namen für Screenreader", () => {
    const anlassId = id();
    expect(mitTermine([termin()])).toContain('<div class="termin">');
    const html = mitTermine([termin({ anlassId })]);
    expect(html).toContain(`<a class="termin" href="/anlass?id=${anlassId}"`);
    expect(html).toContain(
      'aria-label="Samstag, 6. Februar, Waldspiel, 14:00–17:00 · Pfadiheim Beispielwald, für Wölfe, Adler"',
    );
  });

  test("ganztägig, mehrtägig, Mai ohne Punkt, ohne Ort und ohne Stufen", () => {
    const html = mitTermine([
      termin({
        von: "2027-05-01",
        bis: "2027-05-01",
        zeitVon: null,
        zeitBis: null,
        ort: null,
        stufen: [],
      }),
      termin({
        von: "2027-07-24",
        bis: "2027-08-02",
        zeitVon: null,
        zeitBis: null,
      }),
    ]);
    expect(html).toContain('<span class="mo">Mai</span>');
    expect(html).toContain('<span class="meta">ganztägig</span>');
    expect(html).toContain("bis 2. August 2027 · Pfadiheim Beispielwald");
    expect(zaehle(html, 'class="chips"')).toBe(1);
  });

  test("zeigt höchstens «anzahl» Termine; leer: Hinweis statt Liste", () => {
    const viele = Array.from({ length: 6 }, (_, i) =>
      termin({ titel: `T${i}` }),
    );
    expect(zaehle(mitTermine(viele, 3), '<li><div class="termin">')).toBe(3);
    expect(mitTermine([])).toContain(
      "Im Moment sind keine Termine eingetragen.",
    );
  });

  test("Termine als Text: nichts wird ungeprüft ins Markup übernommen", () => {
    const html = mitTermine([
      termin({ titel: '<img src=x onerror="a">', ort: "<b>", stufen: ["<i>"] }),
    ]);
    expect(html).not.toMatch(/<img src=x|· <b>|<i>/);
    expect(html).toContain("&lt;img src=x onerror=&quot;a&quot;&gt;");
  });

  test("ohne geladene Daten (zum Beispiel in der Vorschau) entfällt der Baustein", () => {
    expect(seite(dok("T", b("terminliste", { anzahl: 5 })))).not.toContain(
      "Nächste Termine",
    );
  });
});

describe("Titelbild und Foto auf der Startseite", () => {
  const medium = () => ({
    mimeTyp: "image/webp",
    groesse: 1,
    breite: 1264,
    hoehe: 379,
    altText: "Wald",
  });
  const mit = (...ids: string[]) => ({
    ...keineDaten(),
    medien: new Map(ids.map((m) => [m, medium()])),
  });

  test("zwei Bilder am Anfang: das erste ist das Titelbild ausserhalb der Spalte, das zweite das Foto im Teaser", () => {
    const [a, f] = [id(), id()];
    const html = seite(
      dok(
        "Start",
        b("bild", { mediumId: a }),
        b("bild", { mediumId: f }),
        b("text", { inhalt: [{ typ: "absatz", inhalt: [{ text: "Hallo" }] }] }),
      ),
      mit(a, f),
      "/",
    );
    expect(html).toMatch(
      new RegExp(
        `<main[^>]*>\\n<figure class="titelbild"><img src="/api/v1/medien/${a}"[^>]*fetchpriority="high"[^>]*></figure>\\n<div class="wrap">`,
      ),
    );
    expect(html).toMatch(
      new RegExp(
        `<section class="teaser"[^>]*>\\n<figure><img src="/api/v1/medien/${f}"`,
      ),
    );
    // Bilder im sichtbaren Bereich laden sofort
    expect(html).not.toContain('loading="lazy"');
  });

  test("ein Bild: nur das Foto im Teaser, kein Titelbild", () => {
    const a = id();
    const html = seite(dok("Start", b("bild", { mediumId: a })), mit(a), "/");
    expect(html).not.toContain("titelbild");
  });

  test("nur die Startseite hat ein Titelbild", () => {
    const [a, f] = [id(), id()];
    const html = seite(
      dok("Seite", b("bild", { mediumId: a }), b("bild", { mediumId: f })),
      mit(a, f),
      "/seite",
    );
    expect(html).not.toContain("titelbild");
    expect(zaehle(html, 'loading="lazy"')).toBe(2);
  });
});

describe("Navigation in einer Zeile", () => {
  const acht = [
    nav("Start"),
    nav("Über den Cevi", [nav("Was ist Cevi")]),
    nav("Über den Cevi Stäfa-Hombi"),
    nav("Mitmachen"),
    nav("Unsere Gruppen", [nav("Bienli"), nav("Wölfe")]),
    nav("Cevi-Anlässe"),
    nav("Fotos"),
    nav("Dokumente", [nav("Statuten")]),
  ];
  const html = rendereFehlerseite(kontext(keineDaten(), acht));
  const leiste = html.slice(
    html.indexOf('<nav class="hauptnav"'),
    html.indexOf("</nav>"),
  );

  test("höchstens sechs Punkte und nicht mehr als 80 Zeichen, der Rest steht unter «Mehr»", () => {
    expect(
      zaehle(leiste, '<li class="mit-unter">') + zaehle(leiste, "<li><a"),
    ).toBeGreaterThan(0);
    expect(leiste).toContain(
      '<li class="mit-unter weitere"><details><summary>Mehr</summary>',
    );
    const mehr = leiste.slice(leiste.indexOf("<details>"));
    expect(mehr).toContain(">Fotos</a>");
    expect(mehr).toContain(">Dokumente</a>");
    // Die Unterseiten eines Punktes unter «Mehr» bleiben erreichbar
    expect(mehr).toContain(">Statuten</a>");
    expect(leiste.slice(0, leiste.indexOf("<details>"))).not.toContain(
      ">Fotos</a>",
    );
  });

  test("ein Punkt mit Unterseiten hat ein Untermenü, auch ohne Skript; die Punkte bleiben Links", () => {
    expect(leiste).toContain(
      '<li class="mit-unter"><a href="/unsere-gruppen">Unsere Gruppen</a><ul class="unter"><li><a href="/bienli">Bienli</a></li><li><a href="/wölfe">Wölfe</a></li></ul></li>',
    );
  });

  test("wenige Punkte: kein «Mehr»", () => {
    const kurz = rendereFehlerseite(
      kontext(keineDaten(), [nav("Start"), nav("Stufen")]),
    );
    expect(kurz).not.toContain("<summary>Mehr</summary>");
  });

  test("auch bei einem einzigen, sehr langen Titel steht mindestens ein Punkt in der Leiste", () => {
    const lang = rendereFehlerseite(
      kontext(keineDaten(), [nav("x".repeat(120)), nav("Zwei")]),
    );
    expect(lang).toContain(`<li><a href="/${"x".repeat(120)}">`);
  });

  test("Skript nur als Verbesserung: eigene Datei, Meta-CSP mit script-src und font-src, nie inline", () => {
    expect(html).toContain(
      '<script type="module" src="/website/menue.js"></script>',
    );
    expect(html).toMatch(
      /script-src &#39;self&#39;; style-src &#39;self&#39;; font-src &#39;self&#39;/,
    );
    expect(html).not.toContain("connect-src");
    expect(html).not.toMatch(/<script(?![^>]* src=)/);
  });
});

describe("Fuss", () => {
  const fuss = (daten: Daten) =>
    rendereFehlerseite({ ...kontext(daten) }).split(
      '<footer class="fuss">',
    )[1]!;

  test("drei Spalten: Name und Anschrift, Telefon und E-Mail, Impressum und Datenschutz, dazu ©", () => {
    const html = fuss({
      ...keineDaten(),
      kontakt: {
        adresse: "Beispielweg 1, 8000 Beispielstadt",
        telefon: "+41 00 000 00 00",
        email: "info@example.org",
        impressum: "/impressum",
        datenschutz: "/datenschutz-website",
      },
    });
    expect(html).toContain(
      "<strong>Cevi Beispielstadt</strong><p>Beispielweg 1, 8000 Beispielstadt</p>",
    );
    expect(html).toContain('href="tel:+41000000000"');
    expect(html).toContain(
      '<a href="mailto:info@example.org">info@example.org</a>',
    );
    expect(html).toContain('<a href="/impressum">Impressum</a>');
    expect(html).toContain('<a href="/datenschutz-website">Datenschutz</a>');
    expect(html).toMatch(/© \d{4} Cevi Beispielstadt/);
  });

  test("ohne Angaben: kein erfundenes Impressum, Datenschutz führt auf die Erklärung der Plattform, keine leeren Spalten", () => {
    const html = fuss(keineDaten());
    expect(html).not.toContain("Impressum");
    expect(html).toContain('<a href="/datenschutz">Datenschutz</a>');
    expect(zaehle(html, "<div>")).toBe(2);
  });
});

// Abgleich mit Datenbank: Termine, Schrift als Datei, Seiten des Fusses
const sql = postgres(API_URL);
const db = erstelleDb(sql);
afterAll(() => sql.end());

describe("Abgleich", () => {
  let abteilungId: string;
  let wurzel: string;
  let ausgabe: Ausgabe;

  beforeEach(async () => {
    const [a] = await db
      .insert(schema.abteilung)
      .values({ name: "Cevi Testabteilung" })
      .returning();
    abteilungId = a!.id;
    wurzel = await mkdtemp(join(tmpdir(), "cevi-darstellung-"));
    ausgabe = dateisystemAusgabe(wurzel);
  });
  afterEach(() => rm(wurzel, { recursive: true, force: true }));

  async function neueSeite(adresse: string, inhalt: unknown, titel = adresse) {
    const [s] = await db
      .insert(schema.seite)
      .values({
        abteilungId,
        adresse,
        titel,
        reihenfolge: 0,
        sichtbarkeit: "oeffentlich",
      })
      .returning();
    const [v] = await db
      .insert(schema.seiteVersion)
      .values({ seiteId: s!.id, nr: 1, inhalt })
      .returning();
    await db
      .update(schema.seite)
      .set({ veroeffentlichteVersionId: v!.id })
      .where(eq(schema.seite.id, s!.id));
    return s!.id;
  }
  const tage = (n: number) => new Date(Date.now() + n * 86_400_000);
  async function termin(
    titel: string,
    n: number,
    opt: {
      sichtbarkeit?: "intern" | "leitende" | "eltern";
      status?: "aktiv" | "abgesagt" | "pruefen";
      tags?: string[];
      anlass?: "oeffentlich" | "angemeldet";
    } = {},
  ) {
    const beginn = tage(n);
    const [p] = await db
      .insert(schema.programm)
      .values({
        abteilungId,
        googleEventId: id(),
        titel,
        ganztaegig: false,
        beginn,
        ende: new Date(beginn.getTime() + 3 * 3_600_000),
        sichtbarkeit: opt.sichtbarkeit ?? "eltern",
        status: opt.status ?? "aktiv",
        ort: "Treffpunkt",
      })
      .returning();
    for (const tagId of opt.tags ?? []) {
      await db.insert(schema.programmTag).values({ programmId: p!.id, tagId });
    }
    if (opt.anlass) {
      await db.insert(schema.anlass).values({
        abteilungId,
        programmId: p!.id,
        anmeldungFuer: "kind",
        sichtbarkeit: opt.anlass,
      });
    }
    return p!.id;
  }
  async function stufe(name: string) {
    const [t] = await db
      .insert(schema.tag)
      .values({ abteilungId, typ: "stufe", name, kuerzel: name.slice(0, 2) })
      .returning();
    return t!.id;
  }

  test("ohne Gruppe: nur Termine öffentlicher Anlässe; mit Gruppe: die Termine der Gruppe; nie intern, leitende, abgesagt oder vergangen", async () => {
    const woelfe = await stufe("Wölfe");
    const adler = await stufe("Adler");
    await termin("Öffentlicher Anlass", 5, {
      anlass: "oeffentlich",
      tags: [woelfe, adler],
    });
    await termin("Anlass nur für Angemeldete", 4, {
      anlass: "angemeldet",
      tags: [woelfe],
    });
    await termin("Programm Wölfe", 3, { tags: [woelfe] });
    await termin("Programm Wölfe später", 9, { tags: [woelfe] });
    await termin("Programm Adler", 2, { tags: [adler] });
    await termin("Intern", 1, {
      sichtbarkeit: "intern",
      tags: [woelfe],
      anlass: "oeffentlich",
    });
    await termin("Leitende", 1, { sichtbarkeit: "leitende", tags: [woelfe] });
    await termin("Abgesagt", 1, {
      status: "abgesagt",
      tags: [woelfe],
      anlass: "oeffentlich",
    });
    await termin("Vergangen", -3, { tags: [woelfe], anlass: "oeffentlich" });
    // Anderer Abteilung
    const [fremd] = await db
      .insert(schema.abteilung)
      .values({ name: "Fremd" })
      .returning();
    await db.insert(schema.programm).values({
      abteilungId: fremd!.id,
      googleEventId: id(),
      titel: "Fremder Anlass",
      ganztaegig: true,
      tagVon: "2099-01-01",
      tagBis: "2099-01-01",
    });

    const alle = b("terminliste", { anzahl: 5 });
    const nurWoelfe = b("terminliste", { tagId: woelfe, anzahl: 3 });
    const d = dok("T", alle, nurWoelfe);
    const { termine } = await ladeTerminlisten(
      db,
      abteilungId,
      [],
      new Map([["s", d]]),
    );
    expect(termine!.get(alle.id)!.map((t) => t.titel)).toEqual([
      "Öffentlicher Anlass",
    ]);
    const w = termine!.get(nurWoelfe.id)!;
    expect(w.map((t) => t.titel)).toEqual([
      "Programm Wölfe",
      "Anlass nur für Angemeldete",
      "Öffentlicher Anlass",
    ]);
    expect(w[0]).toMatchObject({
      titel: "Programm Wölfe",
      ort: "Treffpunkt",
      stufen: ["Wölfe"],
      anlassId: null,
    });
    // Chips: nur Stufen, auch die zweite des Anlasses
    expect(termine!.get(alle.id)![0]!.stufen).toEqual(["Adler", "Wölfe"]);
    expect(termine!.get(alle.id)![0]!.anlassId).toMatch(/^[0-9a-f-]{36}$/);
    // Zeiten sind Zürcher Zeit als «HH:MM», Tage als «JJJJ-MM-TT»
    expect(w[0]!.zeitVon).toMatch(/^\d\d:\d\d$/);
    expect(w[0]!.von).toMatch(/^\d{4}-\d\d-\d\d$/);
  });

  test("ganztägige Termine: Tage statt Zeiten; ohne Bausteine keine Abfrage", async () => {
    const [p] = await db
      .insert(schema.programm)
      .values({
        abteilungId,
        googleEventId: id(),
        titel: "Lager",
        ganztaegig: true,
        tagVon: tage(30).toISOString().slice(0, 10),
        tagBis: tage(38).toISOString().slice(0, 10),
      })
      .returning();
    await db.insert(schema.anlass).values({
      abteilungId,
      programmId: p!.id,
      anmeldungFuer: "kind",
      sichtbarkeit: "oeffentlich",
    });
    const lager = b("terminliste", { anzahl: 3 });
    const { termine } = await ladeTerminlisten(
      db,
      abteilungId,
      [],
      new Map([["s", dok("T", lager)]]),
    );
    const t = termine!.get(lager.id)![0]!;
    expect(t.zeitVon).toBeNull();
    expect(t.von < t.bis).toBe(true);
    expect(
      (await ladeTerminlisten(db, abteilungId, [], new Map([["s", dok("T")]])))
        .termine!.size,
    ).toBe(0);
  });

  test("die erzeugte Startseite zeigt die Termine, der Fuss die Seiten des Baums; die Schrift kommt unverändert als Datei", async () => {
    await termin("Weihnachtsfest", 10, { anlass: "oeffentlich" });
    await neueSeite("start", {
      v: 1,
      titel: "Start",
      bausteine: [b("terminliste", { anzahl: 3 })],
    });
    await neueSeite(
      "impressum",
      { v: 1, titel: "Impressum", bausteine: [b("trenner", { art: "linie" })] },
      "Impressum",
    );
    await neueSeite(
      "datenschutz-website",
      {
        v: 1,
        titel: "Datenschutz",
        bausteine: [b("trenner", { art: "linie" })],
      },
      "Datenschutz",
    );
    const bytes = Uint8Array.from([
      0x77, 0x4f, 0x46, 0x32, 0, 255, 128, 10, 13,
    ]);
    await erzeugeWebsite(db, {
      ausgabe,
      abteilungId,
      basisUrl: "https://www.example.org",
      stylesheet: "body{}",
      skripte: { "archivo-latin.woff2": bytes, "menue.js": "// m" },
      datenquellen: [ladeTerminlisten],
      kontakt: {
        adresse: "Beispielweg 1",
        telefon: "+41 00 000 00 00",
        email: "info@example.org",
      },
    });
    const start = await readFile(join(wurzel, "index.html"), "utf8");
    expect(start).toContain('<span class="titel">Weihnachtsfest</span>');
    // Fuss: Seiten des Baums; sie stehen nicht zusätzlich in der Leiste
    const fuss = start.split('<footer class="fuss">')[1]!;
    expect(fuss).toContain('<a href="/impressum">Impressum</a>');
    expect(fuss).toContain('<a href="/datenschutz-website">Datenschutz</a>');
    expect(fuss).toContain("<p>Beispielweg 1</p>");
    const leiste = start.slice(
      start.indexOf('<nav class="hauptnav"'),
      start.indexOf("</nav>"),
    );
    expect(leiste).not.toContain("Impressum");
    expect(leiste).not.toContain("Datenschutz");
    // Binärdatei: dieselben Bytes, nicht als Text umgeschrieben
    expect(
      new Uint8Array(
        await readFile(join(wurzel, "website", "archivo-latin.woff2")),
      ),
    ).toEqual(bytes);
  });
});

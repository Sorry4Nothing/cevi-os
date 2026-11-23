import { describe, expect, test } from "vitest";
// Reine Browser-Module ohne Typen: Die Ansichten sind Funktionen von Daten zu Beschreibungen (h) und laufen ohne DOM
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as tm from "../public/website/tm.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as termine from "../public/website/termine.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as link from "../public/website/termine-link.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as vorschlag from "../public/website/vorschlag.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as anlass from "../public/website/anlass.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as anmeldung from "../public/website/anmeldung.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { sucheTreffer } from "../public/website/auswahl.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { sicheresZiel } from "../public/website/weiter.js";

const html = tm.html as (d: unknown) => string;
const text = tm.text as (d: unknown) => string;

const ID = "11111111-1111-4111-8111-111111111111";

const termin = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  titel: "Waldspiel",
  status: "aktiv",
  ganztaegig: false,
  beginn: "2027-02-06T13:00:00.000Z",
  ende: "2027-02-06T16:00:00.000Z",
  tagVon: null,
  tagBis: null,
  ort: "Pfadiheim Beispielwald",
  tags: [{ id: "t1", name: "Wölfe", typ: "stufe" }],
  anlass: null,
  kinder: [],
  meine: true,
  ...extra,
});

describe("tm: Beschreibung statt HTML", () => {
  test("Text bleibt Text, Attribute werden maskiert", () => {
    const d = tm.h("p", { title: 'a"b' }, '<img src=x onerror="alert(1)">');
    expect(html(d)).toBe(
      '<p title="a&quot;b">&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>',
    );
  });
  test("Ereignisse und style sind nie erlaubt", () => {
    const doc = {
      createElement: () => ({ setAttribute() {}, append() {} }),
      createTextNode: () => ({}),
    };
    expect(() => tm.baue(doc, tm.h("a", { onclick: "x" }))).toThrow();
    expect(() => tm.baue(doc, tm.h("a", { style: "x" }))).toThrow();
  });
  test("null und false fallen weg, Listen werden flach", () => {
    expect(html(tm.h("ul", {}, [tm.h("li", {}, "a"), null, false], "b"))).toBe(
      "<ul><li>a</li>b</ul>",
    );
  });
});

describe("tm: Zeit in Zürich", () => {
  test("Sommer- und Winterzeit", () => {
    expect(tm.zuerichZuIso(2027, 7, 17, 14, 0)).toBe(
      "2027-07-17T12:00:00.000Z",
    );
    expect(tm.zuerichZuIso(2027, 1, 12, 18, 40)).toBe(
      "2027-01-12T17:40:00.000Z",
    );
    // Umstellung am 28. März 2027 um 02:00 → 03:00
    expect(tm.zuerichZuIso(2027, 3, 28, 9, 0)).toBe("2027-03-28T07:00:00.000Z");
    expect(tm.zuerichZuIso(2027, 3, 27, 9, 0)).toBe("2027-03-27T08:00:00.000Z");
  });
  test("Zeitpunkt und Tag gleich, unabhängig vom Gerät", () => {
    expect(tm.uhrzeit("2027-02-06T13:00:00.000Z")).toBe("14:00");
    expect(tm.zeitpunktText("2027-01-12T17:40:00.000Z")).toBe(
      "12.01.2027, 18:40",
    );
    // 23:30 UTC ist in Zürich schon der nächste Tag
    expect(tm.ersterTag(termin({ beginn: "2027-02-06T23:30:00.000Z" }))).toBe(
      "2027-02-07",
    );
  });
  test("Meta: Zeit, ganztägig, mehrtägig", () => {
    expect(tm.terminMeta(termin())).toBe(
      "14:00–17:00 · Pfadiheim Beispielwald",
    );
    expect(
      tm.terminMeta(
        termin({
          ganztaegig: true,
          tagVon: "2027-07-17",
          tagBis: "2027-07-17",
          beginn: null,
          ende: null,
          ort: null,
        }),
      ),
    ).toBe("Ganztägig");
    expect(
      tm.terminMeta(
        termin({
          ganztaegig: true,
          tagVon: "2027-07-17",
          tagBis: "2027-07-24",
          beginn: null,
          ende: null,
          ort: null,
        }),
      ),
    ).toBe("Ganztägig bis 24. Juli");
  });
});

describe("Termine: Bereiche und Filter", () => {
  test("Zeiträume bleiben unter den 400 Tagen der Abfrage", () => {
    expect(termine.bereichVon("3m", "2027-02-01")).toEqual({
      von: "2027-02-01",
      bis: "2027-04-30",
    });
    expect(termine.bereichVon("3m", "2027-11-30")).toEqual({
      von: "2027-11-30",
      bis: "2028-02-29",
    });
    expect(termine.bereichVon("monat", "2027-02-10")).toEqual({
      von: "2027-02-10",
      bis: "2027-02-28",
    });
    expect(termine.bereichVon("jahr", "2027-02-10")).toEqual({
      von: "2027-02-10",
      bis: "2028-02-09",
    });
    expect(termine.monatsBereich("2028-02")).toEqual({
      von: "2028-02-01",
      bis: "2028-02-29",
    });
    expect(termine.monatPlus("2027-12", 1)).toBe("2028-01");
    expect(termine.monatPlus("2027-01", -1)).toBe("2026-12");
  });
  test("Gruppen aus den geladenen Terminen, Filter im Browser", () => {
    const a = termin();
    const b = termin({
      id: "b",
      tags: [{ id: "t2", name: "Adler", typ: "stufe" }],
    });
    const c = termin({ id: "c", tags: [] });
    expect(
      termine.gruppenVon([a, b, c]).map((g: { name: string }) => g.name),
    ).toEqual(["Adler", "Wölfe"]);
    expect(termine.filtere([a, b, c], "t2")).toEqual([b]);
    expect(termine.filtere([a, b, c], null)).toHaveLength(3);
  });
});

describe("Termine: Ansichten (W5, W6)", () => {
  const s = {
    tab: "alle",
    ansicht: "liste",
    gruppe: null,
    zeitraum: "3m",
    monat: "2027-02",
    angemeldet: true,
  };
  const daten = (extra = {}) => ({
    status: "ok",
    termine: [termin()],
    weitere: false,
    naechste: null,
    ...extra,
  });

  test("Liste: Monatsüberschrift, Datum, Gruppen, sprechender Name", () => {
    const h = html(termine.feldView(s, daten(), "2027-02-01"));
    expect(h).toContain("Februar 2027");
    expect(h).toContain('<span class="nr">6</span>');
    expect(h).toContain("Sa");
    expect(h).toContain("14:00–17:00 · Pfadiheim Beispielwald");
    expect(h).toContain(
      'aria-label="Samstag 6. Februar, Waldspiel, 14:00–17:00 · Pfadiheim Beispielwald, für Wölfe"',
    );
    // Ohne Gruppe steht «Alle», nie ein leeres Etikett
    expect(html(termine.terminKarte(termin({ tags: [] })))).toContain("Alle");
  });
  test("Status steht als Text, nicht nur als Farbe", () => {
    expect(html(termine.terminKarte(termin({ status: "abgesagt" })))).toContain(
      "Abgesagt",
    );
    expect(html(termine.terminKarte(termin({ status: "pruefen" })))).toContain(
      "Noch unklar",
    );
  });
  test("Termin mit Anlass ist ein Link auf die Anlassseite, sonst kein Link", () => {
    const mit = html(
      termine.terminKarte(
        termin({
          anlass: {
            id: ID,
            anmeldeschluss: null,
            anmeldungOffen: true,
            angemeldet: true,
          },
        }),
      ),
    );
    expect(mit).toContain(`href="/anlass/?id=${ID}"`);
    expect(mit).toContain("Angemeldet");
    expect(html(termine.terminKarte(termin()))).not.toContain("<a ");
  });
  test("Laden (#574): Skelett in der Form der Zeilen, aria-busy, verborgen; die Ansage steht in der Statusregion, nicht im Skelett", () => {
    const h = html(termine.feldView(s, { status: "laedt" }, "2027-02-01"));
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('<div class="skelett" aria-hidden="true">');
    expect(h).toContain('aria-hidden="true"');
    expect(h).not.toContain("Lädt …");
    // vier Terminzeilen mit Datumsfeld, Titel, Meta und zwei Chips
    expect(h.match(/class="termin"/g)).toHaveLength(4);
    expect(h.match(/sk datum-skelett/g)).toHaveLength(4);
  });
  test("Laden im Monat (#574): Skelett in der Form des Kalenders mit 42 Zellen und dem Tagesfeld", () => {
    const m = html(
      termine.feldView(
        { ...s, ansicht: "monat", monat: "2027-02" },
        { status: "laedt" },
        "2027-02-01",
      ),
    );
    expect(m).toContain('aria-busy="true"');
    expect(m).toContain("Februar 2027");
    expect(m.match(/sk kal-zelle/g)).toHaveLength(42);
    expect(m).toContain('class="kal-tagfeld" aria-hidden="true"');
    // Das Skelett ist kein Bedienelement
    expect(m).not.toContain("<button");
  });
  test("Leer: Alle und Mein Kalender haben ihren Text", () => {
    const leer = daten({ termine: [] });
    expect(text(termine.feldView(s, leer, "2027-02-01"))).toContain(
      "Gerade stehen keine Termine an.",
    );
    expect(
      text(termine.feldView({ ...s, tab: "mein" }, leer, "2027-02-01")),
    ).toContain("In deinen Gruppen stehen gerade keine Termine an.");
  });
  test("Kein Treffer im Filter bietet das Zurücksetzen an", () => {
    const h = html(
      termine.feldView({ ...s, gruppe: "t9" }, daten(), "2027-02-01"),
    );
    expect(h).toContain("Keine Termine für diesen Filter.");
    expect(h).toContain('data-aktion="zuruecksetzen"');
  });
  test("Fehler ist ein Alarm mit «Nochmals versuchen»", () => {
    const h = html(termine.feldView(s, { status: "fehler" }, "2027-02-01"));
    expect(h).toContain('role="alert"');
    expect(h).toContain("Nochmals versuchen");
  });
  test("Nicht angemeldet und kein Zugriff", () => {
    expect(
      html(termine.feldView(s, { status: "abgemeldet" }, "2027-02-01")),
    ).toContain("/anmelden?weiter=%2Ftermine");
    expect(
      text(termine.feldView(s, { status: "keinZugriff" }, "2027-02-01")),
    ).toContain("nicht verfügbar");
  });
  test("«Weitere Termine laden» nur mit weiteren Seiten", () => {
    expect(
      html(
        termine.feldView(
          s,
          daten({ weitere: true, naechste: "x" }),
          "2027-02-01",
        ),
      ),
    ).toContain("Weitere Termine laden");
    expect(html(termine.feldView(s, daten(), "2027-02-01"))).not.toContain(
      "Weitere Termine laden",
    );
  });
  test("Monat: Raster mit Montag zuerst, jeder Tag eine Schaltfläche mit Namen, heute markiert, Termine als Titel und Punkt", () => {
    const m = html(termine.monatView("2027-02", [termin()], "2027-02-01"));
    // 1. Februar 2027 ist ein Montag: Die erste Zelle ist der Erste
    expect(m).toContain(
      'role="group" aria-label="Tage im Februar 2027"><button type="button" class="kal-tag heute"',
    );
    expect(m).toContain(
      'aria-current="date" aria-label="Montag, 1. Februar, heute"',
    );
    expect(m).toContain('aria-label="Samstag, 6. Februar, 1 Termin"');
    expect(m).toContain('<span class="eintrag">Waldspiel</span>');
    expect(m).toContain('<span class="punkt"></span>');
    expect(m).toContain('aria-label="Vorheriger Monat"');
    // Genau ein Tag ist gewählt und steht in der Tab-Reihenfolge: heute hat keinen Termin, also der nächste Tag mit einem
    expect(m.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(m.match(/class="kal-tag[^>]*tabindex="0"/g)).toHaveLength(1);
    expect(m).toContain(
      'aria-pressed="true" aria-label="Samstag, 6. Februar, 1 Termin" tabindex="0"',
    );
    // Sechs Wochen: April 2027 hat 30 Tage, zwölf Zellen bleiben leer
    const april = html(termine.monatView("2027-04", [], "2027-02-01"));
    expect(april.match(/class="kal-leer"/g)).toHaveLength(12);
    expect(april.match(/class="kal-tag[ "]/g)).toHaveLength(30);
    expect(april).toContain("Keine Termine an diesem Tag.");
    // Der gewünschte Tag gewinnt
    expect(
      html(
        termine.monatView("2027-02", [termin()], "2027-02-01", {
          tag: "2027-02-10",
        }),
      ),
    ).toContain('<h3 id="tm-tag-titel">Mittwoch, 10. Februar</h3>');
  });
  test("Monat: Tasten im Raster", () => {
    const z = termine.fokusZiel;
    // 10. Februar 2027 ist ein Mittwoch
    expect(z("2027-02-10", "ArrowLeft")).toBe("2027-02-09");
    expect(z("2027-02-10", "ArrowDown")).toBe("2027-02-17");
    expect(z("2027-02-10", "Home")).toBe("2027-02-08");
    expect(z("2027-02-10", "End")).toBe("2027-02-14");
    expect(z("2027-02-28", "ArrowRight")).toBe("2027-03-01");
    // Bild ab: gleicher Tag im nächsten Monat, höchstens dessen letzter
    expect(z("2027-01-31", "PageDown")).toBe("2027-02-28");
    expect(z("2027-02-10", "PageUp", true)).toBe("2026-02-10");
    expect(z("2027-02-10", "a")).toBeNull();
    expect(termine.abstandText("2027-02-01", "2027-02-01")).toBe("Heute");
    expect(termine.abstandText("2027-02-01", "2027-02-02")).toBe("Morgen");
    expect(termine.abstandText("2027-02-10", "2027-02-07")).toBe("Vor 3 Tagen");
  });
  test("Mehrtägiger Termin erscheint an jedem Tag", () => {
    const t = termin({
      ganztaegig: true,
      tagVon: "2027-02-03",
      tagBis: "2027-02-05",
      beginn: null,
      ende: null,
    });
    expect(
      html(termine.monatView("2027-02", [t], "2027-02-01")).match(
        /<span class="eintrag">Waldspiel/g,
      ),
    ).toHaveLength(3);
  });
  test("Reiter: ohne Sitzung ist «Mein Kalender» gesperrt und der Hinweis steht da", () => {
    const aus = html(termine.reiterView({ tab: "alle", angemeldet: false }));
    expect(aus).toContain('aria-disabled="true"');
    expect(aus).toContain("Nur die Termine deiner Gruppen sehen?");
    expect(aus).toContain(
      '<a class="verweis" href="/anmelden?weiter=%2Ftermine">Anmelden</a>',
    );
    const an = html(termine.reiterView({ tab: "mein", angemeldet: true }));
    expect(an).toContain('id="tm-reiter-mein" aria-selected="true"');
    expect(an).not.toContain("Melde dich an");
  });
  test("Filterblatt: aktive Filter werden gezählt und benannt", () => {
    const g = [{ id: "t1", name: "Wölfe" }];
    const w = html(
      termine.werkzeugView({ ...s, gruppe: "t1", zeitraum: "monat" }, g),
    );
    expect(w).toContain("Filter (2 aktiv)");
    expect(w).toContain("Dieser Monat");
    const blatt = html(termine.filterBlattView({ ...s, gruppe: "t1" }, g, 8));
    expect(blatt).toContain("8 Termine anzeigen");
    expect(blatt).toContain('aria-pressed="true"');
    expect(html(termine.filterBlattView(s, g, 1))).toContain(
      "1 Termin anzeigen",
    );
  });
});

describe("Kalender-Link (W6)", () => {
  const z = {
    status: "ok",
    aktiv: false,
    endung: null,
    neu: null,
    meldung: null,
    fehler: null,
    arbeitet: false,
  };
  const host = "www.beispiel.invalid";
  test("Ohne Link: «Link erzeugen»", () => {
    const h = html(link.linkKastenView(z, host));
    expect(h).toContain("Link erzeugen");
    expect(h).not.toContain("tm-link-feld");
  });
  test("Bestehender Link wird nur verkürzt gezeigt und nicht kopiert", () => {
    const h = html(
      link.linkKastenView({ ...z, aktiv: true, endung: "e21x" }, host),
    );
    expect(h).toContain("webcal://www.beispiel.invalid/ical/…e21x");
    expect(h).toContain("Link neu erzeugen");
    expect(h).toContain("Der alte Link funktioniert danach nicht mehr.");
    expect(h).not.toContain("Link kopieren");
  });
  test("Frisch erzeugt: ganzer Link, Kopieren, Meldung", () => {
    const adresse = link.linkAdresse(host, "/ical/abc.ics");
    expect(adresse).toBe("webcal://www.beispiel.invalid/ical/abc.ics");
    const h = html(
      link.linkKastenView(
        {
          ...z,
          aktiv: true,
          endung: "x",
          neu: { adresse },
          meldung: "ersetzt",
        },
        host,
      ),
    );
    expect(h).toContain(`value="${adresse}"`);
    expect(h).toContain("Link kopieren");
    expect(h).toContain("Neuer Link erzeugt.");
  });
  test("Laden und Fehler", () => {
    expect(
      html(link.linkKastenView({ ...z, status: "laedt" }, host)),
    ).toContain("aria-busy");
    const f = html(
      link.linkKastenView(
        { ...z, fehler: { titel: "Zu viele Versuche.", text: "Warte." } },
        host,
      ),
    );
    expect(f).toContain('role="alert"');
    expect(f).toContain("Zu viele Versuche.");
  });
});

describe("Termin vorschlagen (W7)", () => {
  const ok = {
    titel: " Materialtag ",
    datum: "13.02.2027",
    von: "09:00",
    bis: "12:00",
    ort: "Heim",
    beschreibung: "",
    tagIds: ["a"],
  };
  test("Datum und Zeit lesen", () => {
    expect(vorschlag.datumLesen("6.2.2027")).toBe("2027-02-06");
    expect(vorschlag.datumLesen("29.02.2027")).toBeNull();
    expect(vorschlag.datumLesen("2027-02-06")).toBeNull();
    expect(vorschlag.zeitLesen("9.00")).toEqual({ h: 9, min: 0 });
    expect(vorschlag.zeitLesen("24:00")).toBeNull();
  });
  test("Gültig: Körper für die API in Zürcher Zeit", () => {
    const p = vorschlag.pruefeVorschlag(ok, "2027-01-01");
    expect(p.body).toEqual({
      titel: "Materialtag",
      ganztaegig: false,
      beginn: "2027-02-13T08:00:00.000Z",
      ende: "2027-02-13T11:00:00.000Z",
      ort: "Heim",
      beschreibung: null,
      tagIds: ["a"],
    });
  });
  test("Ohne Zeiten ist der Termin ganztägig", () => {
    const p = vorschlag.pruefeVorschlag(
      { ...ok, von: "", bis: "" },
      "2027-01-01",
    );
    expect(p.body).toMatchObject({
      ganztaegig: true,
      tagVon: "2027-02-13",
      tagBis: "2027-02-13",
    });
    expect(p.body.beginn).toBeUndefined();
  });
  test("Die Texte der Fehler stehen im Design", () => {
    const p = vorschlag.pruefeVorschlag(
      {
        titel: "",
        datum: "12.01.2027",
        von: "14:00",
        bis: "12:00",
        ort: "",
        beschreibung: "",
        tagIds: [],
      },
      "2027-02-01",
    );
    expect(p.fehler.map((f: { text: string }) => f.text)).toEqual([
      "Gib einen Titel ein.",
      "Das Datum liegt in der Vergangenheit.",
      "Das Ende liegt vor dem Beginn.",
      "Wähle mindestens eine Gruppe.",
    ]);
    expect(p.fehler.map((f: { feld: string }) => f.feld)).toEqual([
      "t-titel",
      "t-datum",
      "t-bis",
      "t-gr-l",
    ]);
  });
  test("Nur ein Ende oder zu lange Texte", () => {
    expect(
      vorschlag.pruefeVorschlag({ ...ok, von: "", bis: "12:00" }, "2027-01-01")
        .fehler[0].text,
    ).toBe("Gib auch den Beginn ein.");
    expect(
      vorschlag.pruefeVorschlag(
        { ...ok, beschreibung: "x".repeat(538) },
        "2027-01-01",
      ).fehler[0].text,
    ).toBe("Höchstens 500 Zeichen. Du hast 38 zu viel.");
  });
  test("Antworten des Servers", () => {
    expect(vorschlag.sendeFehler({ status: 0, offline: true }).art).toBe(
      "offline",
    );
    expect(vorschlag.sendeFehler({ status: 0, offline: false }).art).toBe(
      "server",
    );
    expect(vorschlag.sendeFehler({ status: 401 }).art).toBe("abgemeldet");
    expect(vorschlag.sendeFehler({ status: 403 }).art).toBe("keinZugriff");
    expect(
      vorschlag.sendeFehler({
        status: 400,
        daten: { code: "TERMIN_VERGANGEN" },
      }),
    ).toMatchObject({ art: "feld", feld: "t-datum" });
    expect(
      vorschlag.sendeFehler({
        status: 409,
        daten: { message: "Du hast schon 5 offene Vorschläge." },
      }),
    ).toMatchObject({ art: "band" });
    expect(vorschlag.sendeFehler({ status: 500 }).art).toBe("server");
  });
  const optionen = [
    { id: "a", name: "Wölfe" },
    { id: "b", name: "Team Mat" },
  ];
  const s = (extra = {}) => ({
    werte: { ...ok, tagIds: [] },
    fehler: {},
    optionen,
    zusammenfassung: [],
    senden: false,
    offline: false,
    band: null,
    ...extra,
  });
  test("Formular: Laden zeigt Skeleton bei den Gruppen und sperrt das Senden", () => {
    const h = html(vorschlag.formularView(s({ optionen: null })));
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('aria-disabled="true"');
  });
  test("Formular: Gruppen als Schalter, Fehler verknüpft mit dem Feld", () => {
    const h = html(
      vorschlag.formularView(
        s({
          fehler: { "t-titel": "Gib einen Titel ein." },
          zusammenfassung: [{ feld: "t-titel", text: "Gib einen Titel ein." }],
        }),
      ),
    );
    expect(h).toContain('aria-pressed="false"');
    expect(h).toContain('aria-invalid="true"');
    expect(h).toContain('aria-describedby="t-titel-f"');
    expect(h).toContain('role="alert"');
    expect(h).toContain("1 Angabe prüfen");
    expect(h).toContain('href="#t-titel"');
  });
  test("Formular: Absenden läuft sperrt die Eingaben", () => {
    const h = html(vorschlag.formularView(s({ senden: true })));
    expect(h).toContain("Sende …");
    expect(h).toContain("readonly");
    expect(h).toContain('aria-busy="true"');
  });
  test("Formular: offline sperrt das Senden mit Erklärung, der Entwurf bleibt", () => {
    const h = html(vorschlag.formularView(s({ offline: true })));
    expect(h).toContain("Senden geht wieder, sobald du online bist.");
    expect(h).toContain(
      'value="Materialtag"'.replace("Materialtag", " Materialtag "),
    );
  });
  test("Erfolg und kein Zugriff", () => {
    expect(text(vorschlag.erfolgView())).toContain("Gesendet.");
    expect(text(vorschlag.keinZugriffView())).toContain(
      "Dieser Bereich ist für andere Gruppen.",
    );
  });
});

describe("Anlass (W3)", () => {
  const a = (extra = {}) => ({
    id: ID,
    terminId: "t",
    titel: "Sommerlager Beispiel 2027",
    ganztaegig: true,
    beginn: null,
    ende: null,
    tagVon: "2027-07-17",
    tagBis: "2027-07-24",
    anmeldungOffen: true,
    frist: "2027-03-15T22:59:00.000Z",
    anmeldungFuer: "kind",
    felder: [],
    teilnehmende: [
      {
        kindId: "k",
        name: "Nils Muster",
        konto: [
          { schluessel: "vorname", beschriftung: "Vorname", wert: "Nils" },
        ],
        anmeldung: null,
      },
    ],
    ...extra,
  });
  test("ID aus der Adresse", () => {
    expect(anlass.anlassId(`?id=${ID}`)).toBe(ID);
    expect(anlass.anlassId("?id=x")).toBeNull();
    expect(anlass.anlassId("")).toBeNull();
  });
  test("Datum des Anlasses", () => {
    expect(anlass.anlassDatum(a())).toBe("17. bis 24. Juli 2027");
    expect(anlass.anlassDatum(a({ tagBis: "2027-08-02" }))).toBe(
      "17. Juli bis 2. August 2027",
    );
    expect(
      anlass.anlassDatum(
        a({
          ganztaegig: false,
          beginn: "2027-02-06T13:00:00.000Z",
          ende: "2027-02-06T16:00:00.000Z",
        }),
      ),
    ).toBe("6. Februar 2027, 14:00–17:00");
  });
  test("Normal: Fakten und Knopf «Anmelden»", () => {
    const h = html(anlass.anlassView(a(), "2027-02-01"));
    expect(h).toContain("Anmeldeschluss");
    expect(h).toContain("15. März 2027");
    expect(h).toContain(`href="/anlass/anmeldung/?id=${ID}"`);
    expect(text(anlass.anlassView(a(), "2027-02-01"))).toContain("Anmelden");
  });
  test("Anmeldeschluss vorbei, geschlossen, schon angemeldet", () => {
    expect(
      text(anlass.anmeldungInhalt(a({ anmeldungOffen: false }), "2027-03-20")),
    ).toContain("Die Anmeldung ist seit dem 15. März geschlossen.");
    expect(
      text(
        anlass.anmeldungInhalt(
          a({ anmeldungOffen: false, frist: null }),
          "2027-03-20",
        ),
      ),
    ).toContain("Die Anmeldung ist geschlossen.");
    const da = a({
      teilnehmende: [
        {
          kindId: "k",
          name: "Nils Muster",
          konto: [
            { schluessel: "vorname", beschriftung: "Vorname", wert: "Nils" },
          ],
          anmeldung: {
            id: "x",
            status: "angemeldet",
            antworten: {},
            geaendertAm: "2027-01-12T17:40:00.000Z",
          },
        },
      ],
    });
    const h = html(anlass.anmeldungInhalt(da, "2027-02-01"));
    expect(h).toContain("Nils ist angemeldet.");
    expect(h).toContain("Anmeldung ansehen");
  });
  test("Laden, nicht angemeldet, nicht gefunden, Fehler", () => {
    expect(html(anlass.ladeKasten())).toContain('aria-busy="true"');
    expect(html(anlass.zustandAnsicht("abgemeldet", ID))).toContain(
      `weiter=${encodeURIComponent(`/anlass?id=${ID}`)}`,
    );
    expect(text(anlass.zustandAnsicht("nichtGefunden"))).toContain(
      "Diesen Anlass gibt es nicht.",
    );
    expect(html(anlass.zustandAnsicht("fehler"))).toContain(
      "Nochmals versuchen",
    );
  });
});

describe("Anlass-Anmeldung (W8)", () => {
  const felder = [
    {
      schluessel: "schwimmt",
      beschriftung: "Mein Kind schwimmt sicher",
      typ: "ja_nein",
      optionen: [],
      pflicht: true,
    },
    {
      schluessel: "shirt",
      beschriftung: "T-Shirt-Grösse",
      typ: "auswahl",
      optionen: ["128", "140"],
      pflicht: true,
    },
    {
      schluessel: "bemerkung",
      beschriftung: "Bemerkungen für die Leitung",
      typ: "text",
      optionen: [],
      pflicht: false,
    },
  ];
  test("Prüfung: Pflichtfelder, Auswahl, Länge", () => {
    const p = anmeldung.pruefeAntworten(felder, { bemerkung: "x".repeat(538) });
    expect(p.fehler.map((f: { inline: string }) => f.inline)).toEqual([
      "Beantworte diese Frage.",
      "Wähle eine Option.",
      "Höchstens 500 Zeichen. Du hast 38 zu viel.",
    ]);
    expect(p.fehler[0].summe).toBe(
      "Beantworte die Frage «Mein Kind schwimmt sicher».",
    );
  });
  test("Prüfung: gültige Antworten, leerer optionaler Text entfällt, falsche Option zählt nicht", () => {
    expect(
      anmeldung.pruefeAntworten(felder, {
        schwimmt: false,
        shirt: "140",
        bemerkung: "  ",
      }).antworten,
    ).toEqual({ schwimmt: false, shirt: "140" });
    expect(
      anmeldung.pruefeAntworten(felder, { schwimmt: true, shirt: "999" })
        .fehler,
    ).toHaveLength(1);
  });
  test("Antworten des Servers", () => {
    expect(anmeldung.sendeFehler({ status: 409 }).art).toBe("geschlossen");
    expect(anmeldung.sendeFehler({ status: 404 }).art).toBe("nichtGefunden");
    expect(anmeldung.sendeFehler({ status: 0, offline: true }).art).toBe(
      "offline",
    );
    expect(
      anmeldung.sendeFehler({
        status: 400,
        daten: {
          code: "ANTWORTEN_UNGUELTIG",
          fehler: [{ schluessel: "bemerkung", code: "ZU_LANG" }],
        },
      }),
    ).toEqual({
      art: "felder",
      felder: [{ schluessel: "bemerkung", text: "Höchstens 500 Zeichen." }],
    });
    expect(anmeldung.sendeFehler({ status: 500 }).art).toBe("server");
  });
  const teilnehmer = (anmeldungsdaten: unknown = null) => ({
    kindId: "k1",
    name: "Nils Muster",
    konto: [
      { schluessel: "vorname", beschriftung: "Vorname", wert: "Nils" },
      { schluessel: "stufe", beschriftung: "Stufe", wert: "Wölfe" },
    ],
    anmeldung: anmeldungsdaten,
  });
  const z = (extra = {}, tn = [teilnehmer()]) => ({
    a: {
      id: ID,
      titel: "Sommerlager 2027",
      anmeldungFuer: "kind",
      anmeldungOffen: true,
      frist: null,
      felder,
      teilnehmende: tn,
    },
    wahl: 0,
    werte: {},
    fehler: {},
    zusammenfassung: [],
    senden: false,
    offline: false,
    band: null,
    bearbeiten: false,
    ...extra,
  });
  test("Formular: Konto, Felder als Radiogruppe, Hinweis zu Gesundheitsdaten", () => {
    const h = html(anmeldung.formularView(z()));
    expect(h).toContain("Aus deinem Konto");
    expect(h).toContain("Wölfe");
    expect(h).toContain('role="radiogroup"');
    expect(h).toContain('role="radio"');
    expect(h).toContain("0 von 500 Zeichen");
    expect(h).toContain("Bitte keine Gesundheitsdaten eintragen.");
    expect(h).toContain(">Anmelden<");
  });
  test("Formular: Validierung mit Zusammenfassung und verknüpften Fehlern", () => {
    const p = anmeldung.pruefeAntworten(felder, {});
    const h = html(
      anmeldung.formularView(
        z({
          fehler: Object.fromEntries(
            p.fehler.map((f: { feld: string; inline: string }) => [
              f.feld,
              f.inline,
            ]),
          ),
          zusammenfassung: p.fehler,
        }),
      ),
    );
    expect(h).toContain("2 Angaben prüfen");
    expect(h).toContain('role="alert"');
    expect(h).toContain('aria-describedby="a-schwimmt-f"');
    expect(h).toContain("Beantworte diese Frage.");
  });
  test("Formular: Absenden läuft", () => {
    const h = html(anmeldung.formularView(z({ senden: true })));
    expect(h).toContain("Sende …");
    expect(h).toContain("readonly");
  });
  test("Mehrere Kinder: Auswahl «Für wen»", () => {
    const h = html(
      anmeldung.wahlView(
        z({}, [
          teilnehmer(),
          {
            ...teilnehmer(),
            kindId: "k2",
            konto: [
              { schluessel: "vorname", beschriftung: "Vorname", wert: "Lea" },
            ],
          },
        ]),
      ),
    );
    expect(h).toContain("Für wen meldest du an?");
    expect(h).toContain("Lea");
    expect(anmeldung.wahlView(z())).toBeNull();
  });
  test("Sperren: Kein Kind, schon angemeldet, geschlossen, sonst Formular", () => {
    expect(text(anmeldung.sperreView(z({}, []), "2027-02-01"))).toContain(
      "Zu deinem Konto gehört noch kein Kind.",
    );
    const da = teilnehmer({
      id: "x",
      status: "angemeldet",
      antworten: {},
      geaendertAm: "2027-01-12T17:40:00.000Z",
    });
    const s = text(anmeldung.sperreView(z({}, [da]), "2027-02-01"));
    expect(s).toContain("Nils ist schon angemeldet.");
    expect(s).toContain("Angemeldet am 12.01.2027, 18:40.");
    expect(
      anmeldung.sperreView(z({ bearbeiten: true }, [da]), "2027-02-01"),
    ).toBeNull();
    const zu = z({}, [teilnehmer()]);
    zu.a.anmeldungOffen = false;
    expect(text(anmeldung.sperreView(zu, "2027-02-01"))).toContain(
      "Die Anmeldung ist geschlossen.",
    );
    expect(anmeldung.sperreView(z(), "2027-02-01")).toBeNull();
  });
  test("Bestehende Anmeldung: Änderungen speichern und Abmelden", () => {
    const da = teilnehmer({
      id: "x",
      status: "angemeldet",
      antworten: {},
      geaendertAm: "2027-01-12T17:40:00.000Z",
    });
    const h = html(anmeldung.formularView(z({ bearbeiten: true }, [da])));
    expect(h).toContain("Änderungen speichern");
    expect(h).toContain('data-aktion="abmelden"');
  });
  test("Erfolg und Laden", () => {
    expect(
      text(
        anmeldung.erfolgView(
          { id: ID, titel: "Sommerlager 2027" },
          "Nils",
          false,
        ),
      ),
    ).toContain("Nils ist für «Sommerlager 2027» angemeldet.");
    expect(html(anmeldung.kontoLadeKarte())).toContain('aria-busy="true"');
  });
});

describe("weiter: Ziele der Seiten eines Anlasses", () => {
  test.each([
    `/anlass?id=${ID}`,
    `/anlass/anmeldung?id=${ID}`,
    "/termine",
    "/termine/vorschlagen",
  ])("%s bleibt erhalten", (z) => {
    expect(sicheresZiel(z)).toBe(z);
  });
  test.each([
    "/anlass?id=x",
    `/anlass?id=${ID}&x=1`,
    `/anlass?x=${ID}`,
    `/anmelden?id=${ID}`,
    `/api?id=${ID}`,
    `//evil.example?id=${ID}`,
  ])("%s wird zu «/»", (z) => {
    expect(sicheresZiel(z)).toBe("/");
  });
});

describe("auswahl: Tippen springt zur Option (#564)", () => {
  const namen = ["Alle Gruppen", "Artemis", "Exodus", "Fröschli", "Äste"];
  test("Anfang des Namens, ohne Gross- und Kleinschreibung, ab der aktuellen Option", () => {
    expect(sucheTreffer(namen, "ex", 0)).toBe(2);
    expect(sucheTreffer(namen, "FR", 4)).toBe(3);
    expect(sucheTreffer(namen, "ä", 0)).toBe(4);
    expect(sucheTreffer(namen, "x", 0)).toBe(-1);
  });
  test("derselbe Buchstabe mehrmals blättert durch die Treffer", () => {
    expect(sucheTreffer(namen, "a", 0)).toBe(1);
    expect(sucheTreffer(namen, "aa", 1)).toBe(0);
  });
  test("gesperrte Optionen werden übersprungen", () => {
    expect(sucheTreffer(namen, "a", 0, [false, true])).toBe(0);
  });
});

describe("Termine: öffentlicher Datenplan aus der Datei (#564)", () => {
  const eintrag = (extra: Record<string, unknown> = {}) => ({
    titel: "Waldspiel",
    von: "2027-02-06",
    bis: "2027-02-06",
    zeitVon: "14:00",
    zeitBis: "17:00",
    ort: "Treffpunkt",
    stufen: ["Wölfe"],
    ...extra,
  });
  test("ein Eintrag wird zur Form der API: Zürcher Zeit, Gruppen als Namen, kein Anlass", () => {
    const t = termine.ausPlan(eintrag());
    expect(t).toMatchObject({
      ganztaegig: false,
      beginn: "2027-02-06T13:00:00.000Z",
      ende: "2027-02-06T16:00:00.000Z",
      tags: [{ id: "Wölfe", name: "Wölfe" }],
      anlass: null,
      seite: null,
    });
    const zeile = html(termine.terminKarte(t));
    expect(zeile).toContain('<div class="termin" role="group"');
    expect(zeile).toContain("14:00–17:00 · Treffpunkt");
    const sommer = termine.ausPlan(
      eintrag({ von: "2027-07-03", bis: "2027-07-03" }),
    );
    expect(sommer.beginn).toBe("2027-07-03T12:00:00.000Z");
  });
  test("ganztägig über mehrere Tage; Link nur auf einen Pfad der eigenen Website", () => {
    const lager = termine.ausPlan(
      eintrag({
        von: "2027-07-24",
        bis: "2027-08-02",
        zeitVon: null,
        zeitBis: null,
        seite: "/anlaesse/lager",
      }),
    );
    expect(lager).toMatchObject({
      ganztaegig: true,
      tagVon: "2027-07-24",
      tagBis: "2027-08-02",
      seite: "/anlaesse/lager",
    });
    expect(html(termine.terminKarte(lager))).toContain(
      '<a class="termin" href="/anlaesse/lager"',
    );
    for (const seite of [
      "https://evil.example",
      "//evil.example",
      "javascript:alert(1)",
    ]) {
      expect(termine.ausPlan(eintrag({ seite })).seite).toBeNull();
    }
    // Der Zeitraum zählt jeden berührten Tag
    expect(termine.imBereich([lager], "2027-08-01", "2027-08-31")).toHaveLength(
      1,
    );
    expect(termine.imBereich([lager], "2027-08-03", "2027-08-31")).toHaveLength(
      0,
    );
  });
  test("Monat: an den Rändern des Plans sind die Schaltflächen gesperrt, die Liste steht unter dem Raster", () => {
    const fenster = { von: "2027-02-01", bis: "2028-02-29" };
    const t = termine.ausPlan(eintrag());
    const anfang = html(
      termine.monatView("2027-02", [t], "2027-02-01", { fenster }),
    );
    expect(anfang).toContain(
      'aria-label="Vorheriger Monat" aria-disabled="true"',
    );
    expect(anfang).not.toContain('aria-label="Nächster Monat" aria-disabled');
    expect(anfang).toContain("1 Termin in diesem Monat");
    const ende = html(
      termine.monatView("2028-02", [], "2027-02-01", { fenster }),
    );
    expect(ende).toContain('aria-label="Nächster Monat" aria-disabled="true"');
    expect(ende).toContain("Keine Termine in diesem Monat");
  });
  test("Monat: ein Titel je Tag, der Rest als Zahl; das Tagesfeld nennt alle mit Zeit und Ort", () => {
    const viele = [1, 2, 3, 4, 5].map((n) =>
      termine.ausPlan(eintrag({ titel: `Programm ${n}` })),
    );
    const aus = html(termine.monatView("2027-02", viele, "2027-02-01"));
    expect(aus).toContain("+ 4 weitere");
    expect(aus).toContain('aria-label="Samstag, 6. Februar, 5 Termine"');
    // Ohne Wunsch ist der nächste Tag mit Terminen gewählt
    expect(aus).toContain('<h3 id="tm-tag-titel">Samstag, 6. Februar</h3>');
    expect(aus).toContain("In 5 Tagen");
    expect(aus.match(/class="kal-termin"/g)).toHaveLength(5);
    expect(aus).toContain("14:00–17:00");
    expect(aus).toContain("Treffpunkt");
  });
});

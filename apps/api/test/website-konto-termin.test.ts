import { describe, expect, test } from "vitest";
// Reine Browser-Module ohne Typen: Die Ansichten sind Funktionen von Daten zu Beschreibungen (h) und laufen ohne DOM
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as tm from "../public/website/tm.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as termin from "../public/website/termin.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as konto from "../public/website/konto.js";

const html = tm.html as (d: unknown) => string;
const text = tm.text as (d: unknown) => string;

const ID = "11111111-1111-4111-8111-111111111111";

const t = (extra: Record<string, unknown> = {}) => ({
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
  kinder: [{ id: "k1", vorname: "Nils", status: null }],
  teilnahmeOffen: true,
  treffpunkt: "Bahnhof",
  schlussOrt: null,
  schlussZeit: "17:00",
  mitnehmen: "Zvieri, Trinkflasche",
  ...extra,
});

describe("Termin (#671)", () => {
  test("Adresse trägt die ID", () => {
    expect(termin.terminAdresse(ID)).toBe(`/termin/?id=${ID}`);
  });

  test("Fakten: nur, was eingetragen ist", () => {
    const voll = text(termin.faktenView(t()));
    expect(voll).toContain("Treffpunkt");
    expect(voll).toContain("Bahnhof");
    expect(voll).toContain("Schluss");
    expect(voll).toContain("Mitnehmen");
    const leer = text(
      termin.faktenView(
        t({ treffpunkt: null, schlussZeit: null, mitnehmen: null, ort: null }),
      ),
    );
    expect(leer).not.toContain("Treffpunkt");
    expect(leer).not.toContain("Schluss");
    expect(leer).not.toContain("Mitnehmen");
    expect(leer).not.toContain("Ort");
  });

  test("Abgesagt und unklar stehen als Text im Band", () => {
    expect(text(termin.statusBand(t({ status: "abgesagt" })))).toContain(
      "abgesagt",
    );
    expect(text(termin.statusBand(t({ status: "pruefen" })))).toContain(
      "Noch unklar",
    );
    expect(termin.statusBand(t())).toBeNull();
  });

  test("Wer antworten kann: eigene Kinder und, nur mit dem Schlüssel der API, die Leitung", () => {
    expect(termin.personen(t()).map((p: { wer: string }) => p.wer)).toEqual([
      "kind:k1",
    ]);
    const mit = termin.personen(t({ eigeneAnmeldung: "offen" }));
    expect(mit.map((p: { wer: string }) => p.wer)).toEqual(["kind:k1", "ich"]);
    expect(mit[1].status).toBeNull();
    expect(termin.personen(t({ kinder: [] }))).toEqual([]);
    expect(termin.teilnahmeView(t({ kinder: [] }))).toBeNull();
  });

  test("Teilnahme: Schalter mit Zustand, Hinweis bei noch keiner Antwort", () => {
    const offen = html(termin.teilnahmeView(t()));
    expect(offen).toContain('role="group"');
    expect(offen).toContain('data-wer="kind:k1"');
    expect(offen).toContain('aria-pressed="false"');
    expect(offen).toContain("Noch keine Antwort");
    const ja = html(
      termin.teilnahmeView(
        t({ kinder: [{ id: "k1", vorname: "Nils", status: "ja" }] }),
      ),
    );
    expect(ja).toMatch(/aria-pressed="true"[^>]*data-status="ja"/);
  });

  test("Teilnahme: abgesagt oder begonnen zeigt die Antwort nur als Text, ohne Schalter", () => {
    const zu = termin.teilnahmeView(
      t({
        teilnahmeOffen: false,
        kinder: [{ id: "k1", vorname: "Nils", status: "nein" }],
      }),
    );
    expect(html(zu)).not.toContain("<button");
    expect(text(zu)).toContain("Antworten ist nicht mehr möglich");
    expect(text(zu)).toContain("Nein");
    expect(html(termin.teilnahmeView(t({ status: "abgesagt" })))).not.toContain(
      "<button",
    );
  });

  test("Während des Speicherns sind die Schalter gesperrt und der Zustand ist ansagbar", () => {
    const h = html(termin.teilnahmeView(t(), { beschaeftigt: "kind:k1" }));
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('aria-disabled="true"');
  });

  test("Anlass: Verweis auf die Anmeldung", () => {
    expect(termin.anlassKasten(t())).toBeNull();
    const a = html(
      termin.anlassKasten(
        t({
          anlass: { id: ID, anmeldungOffen: true, angemeldet: false },
        }),
      ),
    );
    expect(a).toContain(`href="/anlass/?id=${ID}"`);
    expect(a).toContain("Zur Anmeldung");
    expect(
      text(
        termin.anlassKasten(
          t({ anlass: { id: ID, anmeldungOffen: false, angemeldet: true } }),
        ),
      ),
    ).toContain("Du bist angemeldet");
  });

  test("Kontakt: Nummer als Telefonlink, ohne Nummer nur der Name, ohne Kontakte kein Abschnitt", () => {
    expect(termin.kontaktView([])).toBeNull();
    expect(termin.kontaktView(null)).toBeNull();
    const k = html(
      termin.kontaktView([
        {
          id: "a",
          name: "Lua Demo",
          ceviName: "Lua",
          telefon: "079 123 45 67",
        },
        { id: "b", name: "Max Muster", ceviName: null, telefon: null },
      ]),
    );
    expect(k).toContain('href="tel:0791234567"');
    expect(k).toContain("Lua Demo (Lua)");
    expect(k).toContain("Max Muster");
    expect(k.match(/href="tel:/g)).toHaveLength(1);
  });

  test("Antworten der Leitenden: Zahlen und Namen als Text", () => {
    expect(termin.zusagenView(null)).toBeNull();
    const z = text(
      termin.zusagenView({
        zahlen: {
          kinder: { ja: 1, nein: 0, offen: 1 },
          leitende: { ja: 0, nein: 1, offen: 0 },
        },
        kinder: [
          { id: "k1", vorname: "Nils", nachname: "Muster", status: "ja" },
          { id: "k2", vorname: "Eva", nachname: "Beispiel", status: "offen" },
        ],
        leitende: [
          { id: "l1", name: "Lua Demo", ceviName: "Lua", status: "nein" },
        ],
      }),
    );
    expect(z).toContain("Kinder: 1 Ja · 0 Nein · 1 offen");
    expect(z).toContain("Leitende: 0 Ja · 1 Nein · 0 offen");
    expect(z).toContain("Nils Muster");
    expect(z).toContain("Noch keine Antwort");
    expect(z).toContain("Lua Demo (Lua)");
  });

  test("Antworten des Servers auf das Speichern", () => {
    expect(termin.speicherFehler({ status: 204 })).toBeNull();
    expect(termin.speicherFehler({ status: 0, offline: true })).toContain(
      "offline",
    );
    expect(termin.speicherFehler({ status: 0, offline: false })).toContain(
      "Server",
    );
    expect(termin.speicherFehler({ status: 401 })).toContain("abgemeldet");
    expect(termin.speicherFehler({ status: 403 })).toContain("nicht antworten");
    expect(
      termin.speicherFehler({
        status: 409,
        daten: { code: "PROGRAMM_GESCHLOSSEN", message: "Geschlossen." },
      }),
    ).toBe("Geschlossen.");
    expect(termin.speicherFehler({ status: 429 })).toContain("Zu viele");
    expect(termin.speicherFehler({ status: 500 })).toContain("nicht geklappt");
  });

  test("Zustände: nicht angemeldet führt zur Anmeldung mit Rückweg, unbekannt, Fehler", () => {
    expect(html(termin.zustandAnsicht("abgemeldet", ID))).toContain(
      `href="/anmelden?weiter=${encodeURIComponent(`/termin?id=${ID}`)}"`,
    );
    expect(text(termin.zustandAnsicht("nichtGefunden"))).toContain(
      "Diesen Termin gibt es nicht.",
    );
    expect(html(termin.zustandAnsicht("fehler"))).toContain(
      'data-aktion="nochmal"',
    );
    expect(html(termin.ladeView())).toContain('aria-busy="true"');
  });
});

const profil = (extra: Record<string, unknown> = {}) => ({
  id: "u1",
  name: "Lua Demo",
  ceviName: "Lua",
  benutzername: "demo.lua",
  mussPasswortAendern: false,
  datenschutzGelesenAm: "2026-11-01T10:00:00.000Z",
  telefon: null,
  pushChat: true,
  pushProgramme: false,
  admin: false,
  rollen: [],
  stufen: [{ id: "s1", name: "Artemis", kuerzel: "A" }],
  kinder: [],
  ...extra,
});
const stand = (p: unknown, extra: Record<string, unknown> = {}) => ({
  profil: p,
  pflicht: (p as { mussPasswortAendern: boolean }).mussPasswortAendern,
  pw: {
    aktuell: "",
    neu: "",
    zeigen: false,
    senden: false,
    fehler: {},
    meldung: null,
  },
  tel: { wert: "", fehler: null, senden: false, meldung: null },
  push: { senden: false, meldung: null },
  ds: { senden: false, meldung: null },
  abmelden: { bestaetigen: false, senden: false, meldung: null },
  ...extra,
});

describe("Mein Konto (#671)", () => {
  test("Passwort: Prüfung vor dem Senden", () => {
    expect(konto.pruefePasswort({ aktuell: "", neu: "x" })).toEqual([
      "aktuell",
      "Gib dein aktuelles Passwort ein.",
    ]);
    expect(
      konto.pruefePasswort({ aktuell: "", neu: "x", pflicht: true })[1],
    ).toBe("Gib dein Startpasswort ein.");
    expect(konto.pruefePasswort({ aktuell: "a", neu: "kurz" })[0]).toBe("neu");
    expect(
      konto.pruefePasswort({ aktuell: "a", neu: "x".repeat(129) })[1],
    ).toContain("höchstens 128");
    expect(
      konto.pruefePasswort({
        aktuell: "gleich-gleich-12",
        neu: "gleich-gleich-12",
      })[1],
    ).toContain("unterscheiden");
    expect(
      konto.pruefePasswort({ aktuell: "a", neu: "x".repeat(12) }),
    ).toBeNull();
  });

  test("Passwort: Antworten des Servers", () => {
    expect(konto.passwortAntwort({ status: 200 })).toBeNull();
    expect(konto.passwortAntwort({ status: 0, offline: true })?.band).toContain(
      "offline",
    );
    expect(konto.passwortAntwort({ status: 401 })?.band).toContain(
      "abgemeldet",
    );
    expect(
      konto.passwortAntwort({
        status: 400,
        daten: { code: "INVALID_PASSWORD" },
      }),
    ).toEqual({ feld: "aktuell", text: "Das aktuelle Passwort stimmt nicht." });
    expect(
      konto.passwortAntwort(
        { status: 400, daten: { code: "INVALID_PASSWORD" } },
        true,
      )?.text,
    ).toBe("Das Startpasswort stimmt nicht.");
    expect(
      konto.passwortAntwort({
        status: 400,
        daten: { code: "PASSWORD_COMPROMISED" },
      })?.feld,
    ).toBe("neu");
    expect(konto.passwortAntwort({ status: 429 })?.band).toContain("Zu viele");
    expect(konto.passwortAntwort({ status: 500 })?.band).toContain(
      "nicht geklappt",
    );
  });

  test("Telefon: nur Stufenleitungen speichern, alle dürfen entfernen", () => {
    const sl = { istStufenleitung: true, original: null };
    expect(konto.pruefeTelefon({ ...sl, eingabe: "079 123 45 67" })).toEqual({
      wert: "079 123 45 67",
      fehler: null,
    });
    expect(konto.pruefeTelefon({ ...sl, eingabe: "abc" }).fehler).toContain(
      "passt nicht",
    );
    expect(konto.pruefeTelefon({ ...sl, eingabe: "" })).toEqual({
      wert: "",
      fehler: null,
    });
    const eltern = { istStufenleitung: false, original: "079 123 45 67" };
    expect(konto.pruefeTelefon({ ...eltern, eingabe: "" }).fehler).toBeNull();
    expect(
      konto.pruefeTelefon({ ...eltern, eingabe: "079 123 45 67" }).fehler,
    ).toBeNull();
    expect(
      konto.pruefeTelefon({ ...eltern, eingabe: "079 999 99 99" }).fehler,
    ).toContain("nur Stufenleitungen");
  });

  test("Rollen im Klartext", () => {
    expect(konto.rollenText(profil())).toEqual([]);
    expect(
      konto.rollenText(
        profil({
          admin: true,
          rollen: [{ stufeId: "s1", typ: "stufenleitung" }],
          kinder: [{ id: "k", vorname: "Nils", nachname: "M", stufeId: "s1" }],
        }),
      ),
    ).toEqual(["Abteilungsleitung", "Stufenleitung Artemis", "Elternteil"]);
    expect(
      konto.rollenText(profil({ rollen: [{ stufeId: "s1", typ: "leitung" }] })),
    ).toEqual(["Leitung Artemis"]);
  });

  test("Pflichtwechsel: nur die Karte des Passworts, mit Startpasswort", () => {
    const p = profil({ mussPasswortAendern: true, datenschutzGelesenAm: null });
    const h = html(konto.kontoView(stand(p)));
    expect(h).toContain("Du hast ein Startpasswort.");
    expect(h).toContain("Startpasswort");
    expect(h).toContain('autocomplete="current-password"');
    expect(h).toContain('autocomplete="new-password"');
    expect(h).not.toContain("Dein Profil");
    expect(h).not.toContain("Datenschutz");
    expect(h).not.toContain("Abmelden");
  });

  test("Passwortfelder: verborgen, mit Wert aus dem Stand, anzeigbar", () => {
    const p = profil();
    const zu = html(konto.passwortKarte(stand(p)));
    expect(zu).toContain('type="password"');
    const auf = html(
      konto.passwortKarte(
        stand(p, {
          pw: {
            aktuell: "a",
            neu: "b",
            zeigen: true,
            senden: false,
            fehler: {},
            meldung: null,
          },
        }),
      ),
    );
    expect(auf).toContain('type="text"');
    expect(auf).toContain('aria-pressed="true"');
    const fehler = html(
      konto.passwortKarte(
        stand(p, {
          pw: {
            aktuell: "",
            neu: "",
            zeigen: false,
            senden: false,
            fehler: { neu: "Zu kurz." },
            meldung: null,
          },
        }),
      ),
    );
    expect(fehler).toContain('aria-invalid="true"');
    expect(fehler).toContain('id="kt-pw-neu-f"');
    expect(fehler).toContain("Zu kurz.");
  });

  test("Normale Ansicht: Datenschutz nur, solange nicht gelesen", () => {
    const gelesen = html(konto.kontoView(stand(profil())));
    expect(gelesen).toContain("Dein Profil");
    expect(gelesen).not.toContain("Zur Kenntnis genommen");
    const offen = html(
      konto.kontoView(stand(profil({ datenschutzGelesenAm: null }))),
    );
    expect(offen).toContain("Zur Kenntnis genommen");
    expect(offen).toContain('href="/datenschutz"');
  });

  test("Telefon: ohne Nummer und ohne Stufenleitung kein Abschnitt", () => {
    expect(konto.telefonKarte(stand(profil()))).toBeNull();
    expect(
      html(konto.telefonKarte(stand(profil({ telefon: "079 123 45 67" })))),
    ).toContain("nur entfernen");
    const sl = profil({ rollen: [{ stufeId: "s1", typ: "stufenleitung" }] });
    expect(html(konto.telefonKarte(stand(sl)))).toContain("Nummer speichern");
  });

  test("Mitteilungen: Schalter mit Zustand; «An- und Abmeldungen» nur, wenn die API ihn mitgibt", () => {
    const h = html(konto.mitteilungenKarte(stand(profil())));
    expect(h).toMatch(
      /aria-pressed="true"[^>]*data-schluessel="pushChat" data-wert="1"/,
    );
    expect(h).toMatch(
      /aria-pressed="true"[^>]*data-schluessel="pushProgramme" data-wert="0"/,
    );
    expect(h).not.toContain("An- und Abmeldungen");
    expect(h).toContain("Im Browser gibt es keine Mitteilungen");
    expect(
      html(konto.mitteilungenKarte(stand(profil({ pushAnmeldungen: true })))),
    ).toContain("An- und Abmeldungen");
  });

  test("Abmelden: «Überall abmelden» fragt erst nach", () => {
    const vorher = html(konto.weitereKarte(stand(profil())));
    expect(vorher).toContain('data-aktion="alle"');
    expect(vorher).not.toContain("alle-ja");
    const frage = html(
      konto.weitereKarte(
        stand(profil(), {
          abmelden: { bestaetigen: true, senden: false, meldung: null },
        }),
      ),
    );
    expect(frage).toContain("Alle anderen Geräte abmelden?");
    expect(frage).toContain('data-aktion="alle-ja"');
    expect(frage).toContain('data-aktion="alle-nein"');
    for (const ziel of [
      "/datenschutz",
      "/support",
      "/konto-loeschen",
      "/termine/",
    ]) {
      expect(vorher).toContain(`href="${ziel}"`);
    }
  });

  test("Zustände: nicht angemeldet mit Rückweg, Fehler, Laden", () => {
    expect(html(konto.zustandAnsicht("abgemeldet"))).toContain(
      `href="/anmelden?weiter=${encodeURIComponent("/konto")}"`,
    );
    expect(html(konto.zustandAnsicht("fehler"))).toContain(
      'data-aktion="nochmal"',
    );
    expect(html(konto.ladeView())).toContain('aria-busy="true"');
  });

  test("Das Profil zeigt keinen Zugang, kein Passwort und kein Telefon eines anderen", () => {
    const h = html(konto.profilKarte(profil()));
    expect(h).toContain("demo.lua");
    expect(h).not.toMatch(/passwort|token|email/i);
  });
});

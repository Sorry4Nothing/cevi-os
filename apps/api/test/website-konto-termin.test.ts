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
    zeigen_aktuell: false,
    zeigen_neu: false,
    senden: false,
    fehler: {},
    meldung: null,
  },
  markiert: null,
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
    expect(h).toContain("kto--pflicht");
    expect(h).toContain("Du hast ein Startpasswort.");
    expect(h).toContain("Startpasswort");
    expect(h).toContain('autocomplete="current-password"');
    expect(h).toContain('autocomplete="new-password"');
    expect(h).not.toContain("kto-profil");
    expect(h).not.toContain("Datenschutz");
    expect(h).not.toContain("Abmelden");
  });

  test("Passwortfelder: verborgen, Auge im Feld je Feld, Fehler beim Feld", () => {
    const p = profil();
    const zu = html(konto.passwortKarte(stand(p)));
    expect(zu).toContain('type="password"');
    expect(zu).toContain('aria-label="Passwort anzeigen"');
    expect(zu.match(/data-aktion="pw-zeigen"/g)).toHaveLength(2);
    const auf = html(
      konto.passwortKarte(
        stand(p, {
          pw: {
            aktuell: "a",
            neu: "b",
            zeigen_aktuell: false,
            zeigen_neu: true,
            senden: false,
            fehler: {},
            meldung: null,
          },
        }),
      ),
    );
    // Nur das neue Passwort ist sichtbar; sein Auge trägt den Zustand
    expect(auf.match(/type="text"/g)).toHaveLength(1);
    expect(auf).toMatch(
      /aria-label="Passwort verbergen" aria-pressed="true" data-aktion="pw-zeigen" data-feld="neu"/,
    );
    const fehler = html(
      konto.passwortKarte(
        stand(p, {
          pw: {
            aktuell: "",
            neu: "",
            zeigen_aktuell: false,
            zeigen_neu: false,
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
    // Ein Hauptknopf, kein eigener Knopf «Passwörter anzeigen»
    expect(zu).toContain("Passwort speichern");
    expect(zu).not.toContain("Passwörter anzeigen");
  });

  test("Länge des neuen Passworts: Satz mit Symbol und Balken, keine Stärke", () => {
    expect(text(konto.laengeHinweis(0))).toContain("Mindestens 12 Zeichen.");
    expect(text(konto.laengeHinweis(5))).toContain("Noch 7 Zeichen");
    expect(html(konto.laengeHinweis(5))).toContain("kto-balken l5");
    expect(html(konto.laengeHinweis(5))).not.toContain("kto-laenge ok");
    const ok = html(konto.laengeHinweis(14));
    expect(ok).toContain("kto-laenge ok");
    expect(ok).toContain("kto-balken l12");
    expect(text(konto.laengeHinweis(14))).toContain("Lang genug: 14 Zeichen.");
    expect(text(konto.laengeHinweis(129))).toContain("Zu lang");
    expect(html(konto.laengeHinweis(129))).not.toContain("kto-laenge ok");
    // Der Hinweis hängt am Feld
    expect(html(konto.laengeHinweis(3))).toContain('id="kt-pw-neu-h"');
  });

  test("Profilkarte: Initialen, Bild nur mit Adresse, Rollen als Liste, Hinweis zum Namen", () => {
    expect(konto.initialen("Lua Demo")).toBe("LD");
    expect(konto.initialen("  anna   maria  beispiel")).toBe("AM");
    expect(konto.initialen("")).toBe("");
    const ohne = html(konto.profilKarte(profil()));
    expect(ohne).toContain("kto-initialen");
    expect(ohne).not.toContain("<img");
    expect(ohne).toContain(
      "Name und Benutzername ändert die Abteilungsleitung.",
    );
    const mit = html(
      konto.profilKarte(
        profil({
          bildUrl: "/api/v1/personen/u1/bild",
          rollen: [{ stufeId: "s1", typ: "stufenleitung" }],
          kinder: [{ id: "k", vorname: "Nils", nachname: "M", stufeId: "s1" }],
        }),
      ),
    );
    expect(mit).toContain('src="/api/v1/personen/u1/bild"');
    expect(mit).toContain('alt=""');
    expect(mit).toContain("Stufenleitung Artemis");
    expect(mit).toContain("Elternteil");
    expect(mit).toContain("Nils");
    // Keine Symbole vor den Angaben
    expect(mit).not.toContain("<svg");
  });

  test("Normale Ansicht: zwei Spalten; Datenschutz nur, solange nicht gelesen", () => {
    const gelesen = html(konto.kontoView(stand(profil())));
    expect(gelesen).toContain("kto-links");
    expect(gelesen).toContain("kto-rechts");
    expect(gelesen).toContain("kto-ende");
    expect(gelesen).toContain("kto-profil");
    expect(gelesen).not.toContain("Zur Kenntnis genommen");
    // Der Tag der Kenntnisnahme steht in «Datenschutz und Hilfe»
    expect(gelesen).toContain("1. November 2026");
    const offen = html(
      konto.kontoView(stand(profil({ datenschutzGelesenAm: null }))),
    );
    expect(offen).toContain("Zur Kenntnis genommen");
    expect(offen).toContain('href="/datenschutz-website"');
  });

  test("Karte nach dem Speichern: die geänderte Karte ist hervorgehoben", () => {
    const sl = profil({
      rollen: [{ stufeId: "s1", typ: "stufenleitung" }],
      telefon: "079 123 45 67",
    });
    const h = html(konto.kontoView(stand(sl, { markiert: "tel" })));
    expect(h.match(/kto-hervor/g)).toHaveLength(1);
    expect(html(konto.telefonKarte(stand(sl, { markiert: "tel" })))).toContain(
      "kto-hervor",
    );
    expect(html(konto.kontoView(stand(sl)))).not.toContain("kto-hervor");
  });

  test("Telefon: ohne Nummer und ohne Stufenleitung kein Abschnitt; andere dürfen nur entfernen", () => {
    expect(konto.telefonKarte(stand(profil()))).toBeNull();
    const eltern = html(
      konto.telefonKarte(stand(profil({ telefon: "079 123 45 67" }))),
    );
    expect(eltern).toContain("nur entfernen");
    expect(eltern).toContain("079 123 45 67");
    expect(eltern).toContain('data-aktion="tel-weg"');
    expect(eltern).not.toContain("<input");
    // Direkt nach dem Entfernen bleibt die Karte mit der Rückmeldung, ohne Formular
    const weg = html(
      konto.telefonKarte(
        stand(profil(), {
          tel: {
            wert: "",
            fehler: null,
            senden: false,
            meldung: { art: "ok", text: "Die Nummer ist entfernt." },
          },
        }),
      ),
    );
    expect(weg).toContain("Die Nummer ist entfernt.");
    expect(weg).not.toContain("<form");
    const sl = profil({ rollen: [{ stufeId: "s1", typ: "stufenleitung" }] });
    const h = html(konto.telefonKarte(stand(sl)));
    expect(h).toContain("Nummer speichern");
    expect(h).toContain('inputmode="tel"');
  });

  test("Schalter: Rolle «switch», Text und Zustand, der nächste Wert steht am Knopf", () => {
    const h = html(konto.mitteilungenKarte(stand(profil())));
    expect(h).toMatch(
      /role="switch" class="schalter" aria-checked="true"[^>]*data-aktion="push" data-schluessel="pushChat" data-wert="0"/,
    );
    expect(h).toMatch(
      /role="switch" class="schalter" aria-checked="false"[^>]*data-schluessel="pushProgramme" data-wert="1"/,
    );
    expect(h).toContain('aria-labelledby="kt-pushChat"');
    expect(h).toContain('aria-describedby="kt-pushChat-h"');
    // Der Zustand steht auch als Wort
    expect(h).toContain(">Ein<");
    expect(h).toContain(">Aus<");
    expect(h).not.toContain("An- und Abmeldungen");
    expect(h).toContain("Im Browser gibt es keine Mitteilungen");
    expect(
      html(konto.mitteilungenKarte(stand(profil({ pushAnmeldungen: true })))),
    ).toContain("An- und Abmeldungen");
    const busy = html(
      konto.mitteilungenKarte(
        stand(profil(), { push: { senden: true, meldung: null } }),
      ),
    );
    expect(busy).toContain('aria-disabled="true"');
  });

  test("Abmelden: «Überall abmelden» fragt erst nach; Verweise der Hilfekarte", () => {
    const vorher = html(konto.abmeldenKarte(stand(profil())));
    expect(vorher).toContain('data-aktion="abmelden"');
    expect(vorher).toContain('data-aktion="alle"');
    expect(vorher).not.toContain("alle-ja");
    const frage = html(
      konto.abmeldenKarte(
        stand(profil(), {
          abmelden: { bestaetigen: true, senden: false, meldung: null },
        }),
      ),
    );
    expect(frage).toContain("Alle anderen Geräte abmelden?");
    expect(frage).toContain('data-aktion="alle-ja"');
    expect(frage).toContain('data-aktion="alle-nein"');
    const hilfe = html(konto.hilfeKarte(stand(profil())));
    for (const ziel of [
      "/datenschutz-website",
      "/support",
      "/konto-loeschen",
      "/termine/",
    ]) {
      expect(hilfe).toContain(`href="${ziel}"`);
    }
  });

  test("Zustände: nicht angemeldet mit Rückweg, Fehler, Skelett in der Form der Seite", () => {
    expect(html(konto.zustandAnsicht("abgemeldet"))).toContain(
      `href="/anmelden?weiter=${encodeURIComponent("/konto")}"`,
    );
    expect(html(konto.zustandAnsicht("fehler"))).toContain(
      'data-aktion="nochmal"',
    );
    const lade = html(konto.ladeView());
    expect(lade).toContain('aria-busy="true"');
    expect(lade).toContain("kto-links");
    expect(lade).toContain("kto-rechts");
    expect(lade).toContain("kto-ende");
    // Ein Skelett ist für Hilfstechnik verborgen
    expect(lade).toContain('aria-hidden="true"');
  });

  test("Das Profil zeigt keinen Zugang, kein Passwort und kein Telefon eines anderen", () => {
    const h = html(konto.profilKarte(profil()));
    expect(h).toContain("demo.lua");
    expect(h).not.toMatch(/passwort|token|email/i);
  });
});

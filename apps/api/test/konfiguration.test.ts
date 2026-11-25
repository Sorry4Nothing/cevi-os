import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { ladeKonfiguration } from "../src/konfiguration.js";

// Erfundene Werte; was eine Variable enthält, darf nie in der Meldung stehen
const GUELTIG = {
  DATABASE_URL: "postgres://cevi:geheim-1@db.example.org:5432/cevi_os",
  APP_MIN_VERSION: "0.1.0",
  PORT: "3000",
  BETTER_AUTH_SECRET: "geheim-6-0123456789abcdef0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3000",
};
const UNGUELTIG = {
  DATABASE_URL: ["mysql://cevi:geheim-2@db.example.org/cevi_os", "geheim-3"],
  APP_MIN_VERSION: ["1.2", "1.2.0-beta", "geheim-4"],
  PORT: ["0", "65536", "30.5", "-1.5", "geheim-5"],
  // Unter 32 Zeichen
  BETTER_AUTH_SECRET: ["geheim-7"],
  BETTER_AUTH_URL: ["ftp://api.example.org", "geheim-8"],
};

function meldung(env: Record<string, string | undefined>) {
  try {
    ladeKonfiguration(env);
  } catch (fehler) {
    return (fehler as Error).message;
  }
  throw new Error("ladeKonfiguration hat nicht geworfen");
}

test("liest die Werte samt festen Vorgaben und übergeht andere Variablen", () => {
  expect(
    ladeKonfiguration({
      ...GUELTIG,
      HOME: "/home/cevi",
      // Eine übrig gebliebene Variable des entfernten Auslesens (#361) stört den Start nicht
      ECKDATEN_BASIS_URL: "https://alt.example.org",
    }),
  ).toEqual({
    DATABASE_URL: GUELTIG.DATABASE_URL,
    APP_MIN_VERSION: "0.1.0",
    PORT: 3000,
    BETTER_AUTH_SECRET: GUELTIG.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: "http://localhost:3000",
    VERANTWORTLICHE_STELLE: "Abteilungsleitung Cevi Stäfa-Hombi",
    VERANTWORTLICHE_ADRESSE: "Oetwilerstrasse 35, 8634 Hombrechtikon",
    KONTAKT_EMAIL: "cevi-al@cevi-staefa-hombi.ch",
    APP_NACHWEIS: "aus",
    OUTLOOK_GRAPH: "false",
  });
});

describe.each(Object.keys(UNGUELTIG) as (keyof typeof UNGUELTIG)[])(
  "%s",
  (name) => {
    test.each<[string, string | undefined]>([
      ["fehlt", undefined],
      ["ist leer", ""],
      ...UNGUELTIG[name].map((wert): [string, string] => [
        `ist «${wert}»`,
        wert,
      ]),
    ])("%s: Die Meldung nennt nur den Namen", (_, wert) => {
      expect(meldung({ ...GUELTIG, [name]: wert })).toBe(
        `Fehlende oder ungültige Umgebungsvariablen: ${name}`,
      );
    });
  },
);

test("BETTER_AUTH_URL mit http: in Produktion ein Fehler, sonst erlaubt (#222)", () => {
  expect(meldung({ ...GUELTIG, NODE_ENV: "production" })).toBe(
    "Fehlende oder ungültige Umgebungsvariablen: BETTER_AUTH_URL",
  );
  expect(
    ladeKonfiguration({
      ...GUELTIG,
      NODE_ENV: "production",
      BETTER_AUTH_URL: "https://api.example.org",
    }).BETTER_AUTH_URL,
  ).toBe("https://api.example.org");
  expect(
    ladeKonfiguration({ ...GUELTIG, NODE_ENV: "development" }).BETTER_AUTH_URL,
  ).toBe("http://localhost:3000");
});

test("ohne Konfiguration nennt die Meldung alle fünf Namen", () => {
  expect(meldung({})).toBe(
    "Fehlende oder ungültige Umgebungsvariablen: DATABASE_URL, APP_MIN_VERSION, PORT, BETTER_AUTH_SECRET, BETTER_AUTH_URL",
  );
});

test("der Server startet ohne Konfiguration nicht", () => {
  const ergebnis = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/server.ts"],
    {
      cwd: new URL("..", import.meta.url),
      // Die Umgebung kann DATABASE_URL setzen; Schlüssel mit undefined lässt Node weg
      env: {
        ...process.env,
        DATABASE_URL: undefined,
        APP_MIN_VERSION: undefined,
        PORT: undefined,
        BETTER_AUTH_SECRET: undefined,
        BETTER_AUTH_URL: undefined,
      },
      encoding: "utf8",
      // Auf einem ausgelasteten Rechner dauert der Start mit tsx ein Vielfaches
      timeout: 60_000,
    },
  );
  expect(ergebnis.status).toBe(1);
  expect(ergebnis.stderr).toContain(
    "Fehlende oder ungültige Umgebungsvariablen: DATABASE_URL, APP_MIN_VERSION, PORT, BETTER_AUTH_SECRET, BETTER_AUTH_URL",
  );
}, 70_000);

test("FCM_SCHLUESSEL_DATEI ist freiwillig und wird durchgereicht", () => {
  expect(ladeKonfiguration(GUELTIG).FCM_SCHLUESSEL_DATEI).toBeUndefined();
  expect(
    ladeKonfiguration({ ...GUELTIG, FCM_SCHLUESSEL_DATEI: "/pfad/fcm.json" })
      .FCM_SCHLUESSEL_DATEI,
  ).toBe("/pfad/fcm.json");
  expect(meldung({ ...GUELTIG, FCM_SCHLUESSEL_DATEI: "" })).toBe(
    "Fehlende oder ungültige Umgebungsvariablen: FCM_SCHLUESSEL_DATEI",
  );
});

test("VERANTWORTLICHE_STELLE, VERANTWORTLICHE_ADRESSE und KONTAKT_EMAIL haben feste Vorgaben, die die Umgebung überschreibt und gültig sein muss", () => {
  const leer = ladeKonfiguration(GUELTIG);
  expect(leer.VERANTWORTLICHE_STELLE).toBe(
    "Abteilungsleitung Cevi Stäfa-Hombi",
  );
  expect(leer.VERANTWORTLICHE_ADRESSE).toBe(
    "Oetwilerstrasse 35, 8634 Hombrechtikon",
  );
  expect(leer.KONTAKT_EMAIL).toBe("cevi-al@cevi-staefa-hombi.ch");
  // Compose gibt eine leere Variable als leere Zeichenkette weiter: Sie gilt als nicht gesetzt
  expect(
    ladeKonfiguration({ ...GUELTIG, VERANTWORTLICHE_ADRESSE: "" })
      .VERANTWORTLICHE_ADRESSE,
  ).toBe("Oetwilerstrasse 35, 8634 Hombrechtikon");
  const mit = ladeKonfiguration({
    ...GUELTIG,
    VERANTWORTLICHE_STELLE: "Cevi Beispiel",
    VERANTWORTLICHE_ADRESSE: "Beispielweg 1, 8000 Beispielort",
    KONTAKT_EMAIL: "kontakt@example.org",
  });
  expect(mit.VERANTWORTLICHE_STELLE).toBe("Cevi Beispiel");
  expect(mit.VERANTWORTLICHE_ADRESSE).toBe("Beispielweg 1, 8000 Beispielort");
  expect(mit.KONTAKT_EMAIL).toBe("kontakt@example.org");
  expect(meldung({ ...GUELTIG, KONTAKT_EMAIL: "keine-adresse" })).toBe(
    "Fehlende oder ungültige Umgebungsvariablen: KONTAKT_EMAIL",
  );
  expect(meldung({ ...GUELTIG, VERANTWORTLICHE_STELLE: "  " })).toBe(
    "Fehlende oder ungültige Umgebungsvariablen: VERANTWORTLICHE_STELLE",
  );
  expect(meldung({ ...GUELTIG, VERANTWORTLICHE_ADRESSE: "  " })).toBe(
    "Fehlende oder ungültige Umgebungsvariablen: VERANTWORTLICHE_ADRESSE",
  );
});

test("KONTAKT_TELEFON (#549) ist freiwillig: ohne Wert und mit leerer Zeile nicht gesetzt, sonst eine Nummer", () => {
  expect(ladeKonfiguration(GUELTIG).KONTAKT_TELEFON).toBeUndefined();
  expect(
    ladeKonfiguration({ ...GUELTIG, KONTAKT_TELEFON: "" }).KONTAKT_TELEFON,
  ).toBeUndefined();
  expect(
    ladeKonfiguration({ ...GUELTIG, KONTAKT_TELEFON: "043 543 96 82" })
      .KONTAKT_TELEFON,
  ).toBe("043 543 96 82");
  expect(
    ladeKonfiguration({ ...GUELTIG, KONTAKT_TELEFON: "+41 00 000 00 00" })
      .KONTAKT_TELEFON,
  ).toBe("+41 00 000 00 00");
  for (const falsch of ["abc", "12", "<b>1</b>", "043-543-96-82"]) {
    expect(meldung({ ...GUELTIG, KONTAKT_TELEFON: falsch })).toBe(
      "Fehlende oder ungültige Umgebungsvariablen: KONTAKT_TELEFON",
    );
  }
});

describe("MEDIEN_S3_* (#335)", () => {
  // Erfundene Werte, nie ein echter Anbieter oder Schlüssel
  const MEDIEN = {
    MEDIEN_S3_ENDPOINT: "https://s3.example.org",
    MEDIEN_S3_REGION: "region-1",
    MEDIEN_S3_BUCKET: "bucket-beispiel",
    MEDIEN_S3_ZUGANGSSCHLUESSEL: "zugang-geheim-1",
    MEDIEN_S3_GEHEIMSCHLUESSEL: "geheim-geheim-2",
  };

  test("ohne alle fünf ist der Medienspeicher aus, auch mit leeren Zeilen aus deploy/.env", () => {
    expect(ladeKonfiguration(GUELTIG).MEDIEN_S3_BUCKET).toBeUndefined();
    const leer = Object.fromEntries(Object.keys(MEDIEN).map((n) => [n, ""]));
    expect(ladeKonfiguration({ ...GUELTIG, ...leer }).MEDIEN_S3_BUCKET).toBe(
      undefined,
    );
  });

  test("mit allen fünf werden sie durchgereicht", () => {
    expect(ladeKonfiguration({ ...GUELTIG, ...MEDIEN })).toMatchObject(MEDIEN);
  });

  test("mit einigen nennt die Meldung die fehlenden Namen und nie einen Wert", () => {
    const text = meldung({
      ...GUELTIG,
      MEDIEN_S3_ENDPOINT: MEDIEN.MEDIEN_S3_ENDPOINT,
      MEDIEN_S3_ZUGANGSSCHLUESSEL: MEDIEN.MEDIEN_S3_ZUGANGSSCHLUESSEL,
    });
    expect(text).toBe(
      "Fehlende oder ungültige Umgebungsvariablen: MEDIEN_S3_REGION, MEDIEN_S3_BUCKET, MEDIEN_S3_GEHEIMSCHLUESSEL",
    );
    expect(text).not.toContain("geheim");
  });

  test("der Endpunkt braucht https", () => {
    expect(
      meldung({
        ...GUELTIG,
        ...MEDIEN,
        MEDIEN_S3_ENDPOINT: "http://s3.example.org",
      }),
    ).toBe("Fehlende oder ungültige Umgebungsvariablen: MEDIEN_S3_ENDPOINT");
  });
});

describe("WEBSITE_* (#351)", () => {
  const WEBSITE = {
    WEBSITE_AUSGABE_PFAD: "/srv/website",
    WEBSITE_ABTEILUNG_ID: "0190a0b0-0000-7000-8000-000000000001",
    WEBSITE_BASIS_URL: "https://www.example.org/",
  };

  test("ohne alle drei ist die Erzeugung aus, auch mit leeren Zeilen aus deploy/.env", () => {
    expect(ladeKonfiguration(GUELTIG).WEBSITE_AUSGABE_PFAD).toBeUndefined();
    const leer = Object.fromEntries(Object.keys(WEBSITE).map((n) => [n, ""]));
    expect(ladeKonfiguration({ ...GUELTIG, ...leer }).WEBSITE_BASIS_URL).toBe(
      undefined,
    );
  });

  test("mit allen dreien gilt die Herkunft ohne Pfad und Schrägstrich am Ende", () => {
    expect(
      ladeKonfiguration({
        ...GUELTIG,
        ...WEBSITE,
        WEBSITE_BASIS_URL: "https://www.example.org/seite/",
      }),
    ).toMatchObject({
      ...WEBSITE,
      WEBSITE_BASIS_URL: "https://www.example.org",
    });
  });

  test("mit einigen nennt die Meldung die fehlenden Namen und nie einen Wert", () => {
    const text = meldung({ ...GUELTIG, WEBSITE_AUSGABE_PFAD: "/srv/website" });
    expect(text).toBe(
      "Fehlende oder ungültige Umgebungsvariablen: WEBSITE_ABTEILUNG_ID, WEBSITE_BASIS_URL",
    );
    expect(text).not.toContain("/srv");
  });

  test("die Abteilung ist eine UUID, die Adresse braucht in Produktion https", () => {
    expect(
      meldung({ ...GUELTIG, ...WEBSITE, WEBSITE_ABTEILUNG_ID: "keine-id" }),
    ).toBe("Fehlende oder ungültige Umgebungsvariablen: WEBSITE_ABTEILUNG_ID");
    const http = { ...WEBSITE, WEBSITE_BASIS_URL: "http://localhost:8080" };
    expect(ladeKonfiguration({ ...GUELTIG, ...http }).WEBSITE_BASIS_URL).toBe(
      "http://localhost:8080",
    );
    expect(
      meldung({
        ...GUELTIG,
        ...http,
        NODE_ENV: "production",
        BETTER_AUTH_URL: "https://api.example.org",
      }),
    ).toBe("Fehlende oder ungültige Umgebungsvariablen: WEBSITE_BASIS_URL");
  });
});

// Fotos aus Flickr (#690): Geheimnisse nur aus der Umgebung; Schlüssel und Secret, Token, Token-Secret und Konto des Tokens gehören zusammen
describe("Flickr", () => {
  const SCHLUESSEL = {
    FLICKR_API_KEY: "TestSchluesselNurFuerTests",
    FLICKR_API_SECRET: "ffeeddccbbaa9988",
  };
  const TOKEN = {
    FLICKR_OAUTH_TOKEN: "72157600000000000-0123456789abcdef",
    FLICKR_OAUTH_TOKEN_SECRET: "fedcba9876543210",
    FLICKR_KONTO: "12345678@N00",
  };

  test("ohne alle vier Werte gibt es keine Fotos, und das ist erlaubt", () => {
    const k = ladeKonfiguration(GUELTIG);
    expect(k.FLICKR_API_KEY).toBeUndefined();
    expect(k.FLICKR_OAUTH_TOKEN).toBeUndefined();
    // Eine leere Zeile in deploy/.env gilt als nicht gesetzt
    expect(
      ladeKonfiguration({
        ...GUELTIG,
        FLICKR_API_KEY: "",
        FLICKR_API_SECRET: "",
      }).FLICKR_API_KEY,
    ).toBeUndefined();
  });

  test("Schlüssel mit Secret genügt (nur öffentliche Fotos); mit Token auch die privaten", () => {
    expect(
      ladeKonfiguration({ ...GUELTIG, ...SCHLUESSEL }).FLICKR_API_KEY,
    ).toBe(SCHLUESSEL.FLICKR_API_KEY);
    expect(
      ladeKonfiguration({ ...GUELTIG, ...SCHLUESSEL, ...TOKEN })
        .FLICKR_OAUTH_TOKEN,
    ).toBe(TOKEN.FLICKR_OAUTH_TOKEN);
  });

  test("einzelne Werte eines Paares scheitern, und die Meldung nennt nur Namen, nie Werte", () => {
    expect(
      meldung({ ...GUELTIG, FLICKR_API_KEY: SCHLUESSEL.FLICKR_API_KEY }),
    ).toBe("Fehlende oder ungültige Umgebungsvariablen: FLICKR_API_SECRET");
    expect(
      meldung({
        ...GUELTIG,
        ...SCHLUESSEL,
        FLICKR_OAUTH_TOKEN: TOKEN.FLICKR_OAUTH_TOKEN,
      }),
    ).toBe(
      "Fehlende oder ungültige Umgebungsvariablen: FLICKR_OAUTH_TOKEN_SECRET, FLICKR_KONTO",
    );
    // Das Konto des Tokens gehört dazu (#777): Nur für dieses Konto signiert der Server
    expect(
      meldung({
        ...GUELTIG,
        ...SCHLUESSEL,
        FLICKR_OAUTH_TOKEN: TOKEN.FLICKR_OAUTH_TOKEN,
        FLICKR_OAUTH_TOKEN_SECRET: TOKEN.FLICKR_OAUTH_TOKEN_SECRET,
      }),
    ).toBe("Fehlende oder ungültige Umgebungsvariablen: FLICKR_KONTO");
    expect(
      meldung({ ...GUELTIG, ...SCHLUESSEL, ...TOKEN, FLICKR_KONTO: "abc" }),
    ).toBe("Fehlende oder ungültige Umgebungsvariablen: FLICKR_KONTO");
    // Ein Token ohne Schlüssel kann nichts signieren
    const ohneSchluessel = meldung({ ...GUELTIG, ...TOKEN });
    expect(ohneSchluessel).toContain("FLICKR_API_KEY");
    expect(ohneSchluessel).toContain("FLICKR_API_SECRET");
    expect(ohneSchluessel).not.toContain(TOKEN.FLICKR_OAUTH_TOKEN);
    // Ein ungültiger Wert: nur der Name
    const falsch = meldung({
      ...GUELTIG,
      ...SCHLUESSEL,
      FLICKR_API_KEY: "geheim-mit-Leerzeichen und /",
    });
    expect(falsch).toBe(
      "Fehlende oder ungültige Umgebungsvariablen: FLICKR_API_KEY",
    );
    expect(falsch).not.toContain("geheim");
  });

  test("eigene Adressen für Tests: lokal erlaubt, in Produktion verboten", () => {
    const basis = {
      ...GUELTIG,
      ...SCHLUESSEL,
      FLICKR_API_BASIS: "http://127.0.0.1:4999/rest/",
      FLICKR_BILD_BASIS: "http://127.0.0.1:4999",
    };
    expect(ladeKonfiguration(basis).FLICKR_API_BASIS).toBe(
      "http://127.0.0.1:4999/rest/",
    );
    const produktion = meldung({
      ...basis,
      NODE_ENV: "production",
      BETTER_AUTH_URL: "https://api.example.org",
    });
    expect(produktion).toContain("FLICKR_API_BASIS");
    expect(produktion).toContain("FLICKR_BILD_BASIS");
  });
});

describe("APP_NACHWEIS (#785)", () => {
  const ANDROID = {
    ANDROID_PAKETNAME: "ch.example.cevios",
    ANDROID_ZERTIFIKAT_SHA256: `${"AB:".repeat(31)}AB, ${"cd".repeat(32)}`,
    ANDROID_NACHWEIS_DIENSTKONTO_DATEI: "/run/secrets/play-integrity.json",
  };
  const IOS = {
    IOS_TEAM_ID: "ABCDE12345",
    IOS_BUNDLE_ID: "ch.example.cevios",
    IOS_NACHWEIS_UMGEBUNG: "production",
  };

  test("ohne Angabe ist der Nachweis aus und braucht nichts; leere Zeilen aus deploy/.env zählen als nicht gesetzt", () => {
    expect(ladeKonfiguration(GUELTIG).APP_NACHWEIS).toBe("aus");
    expect(
      ladeKonfiguration({
        ...GUELTIG,
        APP_NACHWEIS: "",
        ANDROID_PAKETNAME: "",
        IOS_TEAM_ID: "",
      }).APP_NACHWEIS,
    ).toBe("aus");
  });

  test("pruefen und pflicht verlangen beide Plattformen vollständig", () => {
    for (const modus of ["pruefen", "pflicht"]) {
      const k = ladeKonfiguration({
        ...GUELTIG,
        APP_NACHWEIS: modus,
        ...ANDROID,
        ...IOS,
      });
      expect(k.APP_NACHWEIS).toBe(modus);
      // Fingerabdrücke mit und ohne Doppelpunkte, klein, als Liste
      expect(k.ANDROID_ZERTIFIKAT_SHA256).toEqual([
        "ab".repeat(32),
        "cd".repeat(32),
      ]);
      expect(k.IOS_NACHWEIS_UMGEBUNG).toBe("production");
      const ohneIos = meldung({ ...GUELTIG, APP_NACHWEIS: modus, ...ANDROID });
      expect(ohneIos).toContain("IOS_TEAM_ID");
      expect(ohneIos).toContain("IOS_BUNDLE_ID");
      expect(ohneIos).toContain("IOS_NACHWEIS_UMGEBUNG");
      expect(ohneIos).not.toContain("ANDROID_");
      const ohneAndroid = meldung({ ...GUELTIG, APP_NACHWEIS: modus, ...IOS });
      expect(ohneAndroid).toContain("ANDROID_PAKETNAME");
      expect(ohneAndroid).toContain("ANDROID_NACHWEIS_DIENSTKONTO_DATEI");
    }
  });

  test("auch bei «aus» gehören die Angaben einer Plattform zusammen", () => {
    const m = meldung({
      ...GUELTIG,
      ANDROID_PAKETNAME: ANDROID.ANDROID_PAKETNAME,
    });
    expect(m).toContain("ANDROID_ZERTIFIKAT_SHA256");
    expect(m).toContain("ANDROID_NACHWEIS_DIENSTKONTO_DATEI");
    expect(
      ladeKonfiguration({ ...GUELTIG, ...ANDROID, ...IOS }).APP_NACHWEIS,
    ).toBe("aus");
  });

  test("ungültige Werte werden mit Namen genannt, nie mit Wert", () => {
    for (const [name, wert] of [
      ["APP_NACHWEIS", "geheim-ein"],
      ["ANDROID_PAKETNAME", "geheim paket"],
      ["ANDROID_ZERTIFIKAT_SHA256", "geheim-zu-kurz"],
      ["ANDROID_NACHWEIS_MIN_GERAETE", "geheim-siegel"],
      ["IOS_TEAM_ID", "geheim"],
      ["IOS_NACHWEIS_UMGEBUNG", "geheim-test"],
    ] as const) {
      const m = meldung({
        ...GUELTIG,
        APP_NACHWEIS: "pruefen",
        ...ANDROID,
        ...IOS,
        [name]: wert,
      });
      expect(m, name).toContain(name);
      expect(m, name).not.toContain("geheim");
    }
  });

  test("das geforderte Gerätesiegel ist wählbar", () => {
    expect(
      ladeKonfiguration({
        ...GUELTIG,
        APP_NACHWEIS: "pflicht",
        ...ANDROID,
        ...IOS,
        ANDROID_NACHWEIS_MIN_GERAETE: "MEETS_STRONG_INTEGRITY",
      }).ANDROID_NACHWEIS_MIN_GERAETE,
    ).toBe("MEETS_STRONG_INTEGRITY");
  });
});

describe("OUTLOOK_GRAPH (#835)", () => {
  const IDS = {
    OUTLOOK_TENANT_ID: "11111111-2222-3333-4444-555555555555",
    OUTLOOK_CLIENT_ID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  };

  test("Vorgabe aus: ohne Angaben startet die API wie bisher", () => {
    expect(ladeKonfiguration(GUELTIG).OUTLOOK_GRAPH).toBe("false");
    expect(
      ladeKonfiguration({ ...GUELTIG, OUTLOOK_GRAPH: "" }).OUTLOOK_GRAPH,
    ).toBe("false");
  });

  test("mit true sind Mandant und Client-ID Pflicht, und die Meldung nennt nur die Namen", () => {
    const m = meldung({ ...GUELTIG, OUTLOOK_GRAPH: "true" });
    expect(m).toBe(
      "Fehlende oder ungültige Umgebungsvariablen: OUTLOOK_TENANT_ID, OUTLOOK_CLIENT_ID",
    );
    expect(
      ladeKonfiguration({ ...GUELTIG, OUTLOOK_GRAPH: "true", ...IDS })
        .OUTLOOK_GRAPH,
    ).toBe("true");
  });

  test("beide IDs gehören zusammen; ein anderer Wert als true oder false und ein Sammelmandant sind ungültig", () => {
    expect(
      meldung({ ...GUELTIG, OUTLOOK_TENANT_ID: IDS.OUTLOOK_TENANT_ID }),
    ).toBe("Fehlende oder ungültige Umgebungsvariablen: OUTLOOK_CLIENT_ID");
    expect(meldung({ ...GUELTIG, OUTLOOK_GRAPH: "ja" })).toContain(
      "OUTLOOK_GRAPH",
    );
    for (const tenant of ["common", "organizations", "consumers", "x"]) {
      expect(
        meldung({ ...GUELTIG, ...IDS, OUTLOOK_TENANT_ID: tenant }),
      ).toContain("OUTLOOK_TENANT_ID");
    }
  });

  test("eigene Adressen für Tests: lokal erlaubt, in Produktion verboten", () => {
    const basis = {
      ...GUELTIG,
      ...IDS,
      OUTLOOK_GRAPH_BASIS: "http://127.0.0.1:4999",
      OUTLOOK_LOGIN_BASIS: "http://127.0.0.1:4999",
    };
    expect(ladeKonfiguration(basis).OUTLOOK_GRAPH_BASIS).toBe(
      "http://127.0.0.1:4999",
    );
    const produktion = meldung({
      ...basis,
      NODE_ENV: "production",
      BETTER_AUTH_URL: "https://api.example.org",
    });
    expect(produktion).toContain("OUTLOOK_GRAPH_BASIS");
    expect(produktion).toContain("OUTLOOK_LOGIN_BASIS");
  });
});

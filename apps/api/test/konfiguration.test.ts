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

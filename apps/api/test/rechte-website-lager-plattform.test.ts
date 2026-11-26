import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { setzeRechteModus } from "../src/rechtemodell/modus.js";
import { legeSystemrollenAn } from "../src/rechtemodell/gruppenrollen.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  legePersonaMitFaktorAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { legeProgrammAn } from "./hilfen/programme.js";
import { macheWebmaster } from "./hilfen/webmaster.js";

// Paket P3 der Rechte-Umstellung (#648): Website, Lager, Lädeli und Plattform prüfen ihre Rechte über das Rechtemodell. Je Route: Abteilungsleitung, Plattformrolle mit dem Recht, Gruppenrolle mit dem Recht, Rolle mit einem anderen Recht, ohne Recht, ohne zweiten Faktor. Antwortreihenfolge: 404, 403, zweiter Faktor, 409.
bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

let welt: Welt;
let admin: PersonaKonto;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  admin = await legePersonaAn(welt, "admin");
});

function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
) {
  return app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
}

// Eine Plattformrolle mit genau diesen Rechten und eine Person mit zweitem Faktor, die sie trägt
async function mitPlattformrolle(rechte: readonly string[], faktor = true) {
  const konto = faktor
    ? await legePersonaMitFaktorAn(welt, "elternA")
    : await legePersonaAn(welt, "elternA");
  const [rolle] = await db
    .insert(schema.plattformRolle)
    .values({
      abteilungId: welt.testabteilungId,
      name: `Rolle ${randomUUID().slice(0, 8)}`,
    })
    .returning({ id: schema.plattformRolle.id });
  if (rechte.length > 0) {
    await db
      .insert(schema.plattformRolleRecht)
      .values(rechte.map((recht) => ({ rolleId: rolle.id, recht })));
  }
  await db
    .insert(schema.personPlattformRolle)
    .values({ userId: konto.id!, rolleId: rolle.id });
  return konto;
}

async function legeTeamAn() {
  const [t] = await db
    .insert(schema.tag)
    .values({
      abteilungId: welt.testabteilungId,
      typ: "team",
      name: `Team ${randomUUID().slice(0, 8)}`,
      kuerzel: "",
    })
    .returning({ id: schema.tag.id });
  await legeSystemrollenAn(db, welt.testabteilungId, t.id, "team");
  return t.id;
}

// Eine Person in einer Gruppe mit einer Rolle, die diese Rechte trägt (Geltung «alle» oder «eigene»)
async function mitGruppenrolle(
  rechte: readonly { recht: string; geltung: "alle" | "eigene" }[],
  { faktor = true, tagId }: { faktor?: boolean; tagId?: string } = {},
) {
  const konto = faktor
    ? await legePersonaMitFaktorAn(welt, "elternA")
    : await legePersonaAn(welt, "elternA");
  const gruppe = tagId ?? (await legeTeamAn());
  const [rolle] = await db
    .insert(schema.gruppenRolle)
    .values({
      abteilungId: welt.testabteilungId,
      tagId: gruppe,
      name: `Rolle ${randomUUID().slice(0, 8)}`,
    })
    .returning({ id: schema.gruppenRolle.id });
  await db
    .insert(schema.gruppenRolleRecht)
    .values(rechte.map((r) => ({ rolleId: rolle.id, ...r })));
  await db
    .insert(schema.personTag)
    .values({ userId: konto.id!, tagId: gruppe, rolleId: rolle.id });
  return { konto, gruppe };
}
const alle = (...rechte: string[]) =>
  rechte.map((recht) => ({ recht, geltung: "alle" as const }));

async function code(res: Response) {
  return ((await res.json()) as { code?: string }).code;
}

// Die Routen, die sich über ein Recht öffnen. «recht»: das Recht, das die Route verlangt; «stattdessen»: ein Recht, das die Route nicht öffnet
interface Route {
  name: string;
  methode: string;
  pfad: () => string | Promise<string>;
  body?: Record<string, unknown>;
  recht: string;
  stattdessen: string;
  erfolg: number;
}

const ROUTEN: Route[] = [
  {
    name: "Lädeli: Einstellungen lesen",
    methode: "GET",
    pfad: () => "/api/v1/admin/laden/einstellungen",
    recht: "laden.einstellungen",
    stattdessen: "laden.artikel_pflegen",
    erfolg: 200,
  },
  {
    name: "Lädeli: Einstellungen ändern",
    methode: "PUT",
    pfad: () => "/api/v1/admin/laden/einstellungen",
    body: { uebergabearten: ["Abholung im Lädeli"] },
    recht: "laden.einstellungen",
    stattdessen: "laden.ansehen",
    erfolg: 204,
  },
  {
    name: "Lädeli: Artikel lesen (ansehen)",
    methode: "GET",
    pfad: () => "/api/v1/admin/laden/artikel",
    recht: "laden.ansehen",
    stattdessen: "laden.einstellungen",
    erfolg: 200,
  },
  {
    name: "Lädeli: Bestellungen lesen",
    methode: "GET",
    pfad: () => "/api/v1/admin/laden/bestellungen",
    recht: "laden.bestellungen_bearbeiten",
    stattdessen: "laden.einstellungen",
    erfolg: 200,
  },
  {
    name: "System: Betriebszahlen",
    methode: "GET",
    pfad: () => "/api/v1/admin/system/requests",
    recht: "system.lesen",
    stattdessen: "laden.ansehen",
    erfolg: 200,
  },
  {
    name: "Erinnerungen (Zeitregeln) lesen",
    methode: "GET",
    pfad: () => "/api/v1/admin/zeitregeln",
    recht: "zeitregeln.verwalten",
    stattdessen: "system.lesen",
    erfolg: 200,
  },
  {
    name: "Lager: Liste",
    methode: "GET",
    pfad: () => "/api/v1/admin/lager",
    recht: "lager.verwalten",
    stattdessen: "lager.vorlagen_pflegen",
    erfolg: 200,
  },
  {
    name: "Lager: Dateihosts lesen",
    methode: "GET",
    pfad: () => "/api/v1/admin/lager-dateien/hosts",
    recht: "lager.verwalten",
    stattdessen: "lager.vorlagen_pflegen",
    erfolg: 200,
  },
  {
    name: "Lager-Vorlagen: Liste",
    methode: "GET",
    pfad: () => "/api/v1/admin/vorlagen",
    recht: "lager.vorlagen_pflegen",
    stattdessen: "lager.verwalten",
    erfolg: 200,
  },
  {
    name: "Medien der Verwaltung: Liste",
    methode: "GET",
    pfad: () => "/api/v1/admin/medien",
    recht: "medien.verwalten",
    stattdessen: "laden.ansehen",
    erfolg: 200,
  },
  {
    name: "Weiterleitungen: Liste",
    methode: "GET",
    pfad: () => "/api/v1/redaktion/weiterleitungen",
    recht: "weiterleitungen.verwalten",
    stattdessen: "medien.verwalten",
    erfolg: 200,
  },
];

describe.each(ROUTEN)("$methode $name", (r) => {
  const sende = async (konto: PersonaKonto) =>
    anfrage(konto, r.methode, await r.pfad(), r.body);

  test("Abteilungsleitung darf", async () => {
    expect((await sende(admin)).status).toBe(r.erfolg);
  });

  test("Plattformrolle mit dem Recht darf", async () => {
    expect((await sende(await mitPlattformrolle([r.recht]))).status).toBe(
      r.erfolg,
    );
  });

  test("Gruppenrolle mit dem Recht für alle darf", async () => {
    const { konto } = await mitGruppenrolle(alle(r.recht));
    expect((await sende(konto)).status).toBe(r.erfolg);
  });

  test("ein anderes Recht und kein Recht geben 403", async () => {
    const anderes = await mitPlattformrolle([r.stattdessen]);
    expect((await sende(anderes)).status).toBe(403);
    const ohne = await legePersonaMitFaktorAn(welt, "elternA");
    expect((await sende(ohne)).status).toBe(403);
  });

  test("ohne zweiten Faktor: 403 ZWEITER_FAKTOR_FEHLT", async () => {
    const res = await sende(await mitPlattformrolle([r.recht], false));
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("ZWEITER_FAKTOR_FEHLT");
    const gruppe = await mitGruppenrolle(alle(r.recht), { faktor: false });
    const res2 = await sende(gruppe.konto);
    expect(res2.status).toBe(403);
    expect(await code(res2)).toBe("ZWEITER_FAKTOR_FEHLT");
  });

  test("ein Recht für die eigene Gruppe öffnet nie die Abteilung", async () => {
    // Die Geltung «eigene» gibt es für diese Rechte nicht (Katalog): Die Zeile gibt nichts
    const { konto } = await mitGruppenrolle([
      { recht: r.recht, geltung: "eigene" },
    ]);
    expect((await sende(konto)).status).toBe(403);
  });
});

describe("feste Punkte bleiben bei der Abteilungsleitung", () => {
  const fest: [string, string][] = [
    ["GET", "/api/v1/admin/bearbeiter"],
    ["GET", "/api/v1/admin/rechte/katalog"],
  ];

  test("eine Rolle mit allem Vergebbaren darf weder Rechte vergeben noch Sonderrechte setzen noch sperren", async () => {
    const rechte = [
      "laden.ansehen",
      "laden.artikel_pflegen",
      "lager.verwalten",
      "system.lesen",
      "zeitregeln.verwalten",
      "wartung.bereiche",
      "medien.verwalten",
      "seiten.anlegen_loeschen",
    ];
    const rolle = await mitPlattformrolle(rechte);
    for (const [methode, pfad] of fest) {
      expect((await anfrage(rolle, methode, pfad)).status, pfad).toBe(403);
    }
    // Sperre: nur Abteilungsleitung und Entwickler
    const sperre = await anfrage(rolle, "PUT", "/api/v1/plattform/schalter", {
      art: "sperre",
      bereich: "chat",
    });
    expect(sperre.status).toBe(403);
    // Wartung von «alles» ist ebenfalls fest
    const alles = await anfrage(rolle, "PUT", "/api/v1/plattform/schalter", {
      art: "wartung",
      bereich: "alles",
    });
    expect(alles.status).toBe(403);
  });

  test("Lager: Mitglieder und Rollen eines Lagers bleiben bei der Abteilungsleitung; ein fremdes oder unbekanntes Lager ist 404", async () => {
    const angelegt = await anfrage(admin, "POST", "/api/v1/admin/lager", {
      titel: "Sommerlager",
      von: "2027-07-10",
      bis: "2027-07-17",
    });
    expect(angelegt.status).toBe(201);
    const { id } = (await angelegt.json()) as { id: string };
    const verwalter = await mitPlattformrolle(["lager.verwalten"]);
    // Angaben des Lagers ja
    expect(
      (await anfrage(verwalter, "GET", `/api/v1/admin/lager/${id}`)).status,
    ).toBe(200);
    // Mitglieder und Rechte der Rollen nein
    for (const pfad of [`/${id}/mitglieder`, `/${id}/rechte`]) {
      expect(
        (await anfrage(verwalter, "GET", `/api/v1/admin/lager${pfad}`)).status,
        pfad,
      ).toBe(403);
      expect(
        (await anfrage(admin, "GET", `/api/v1/admin/lager${pfad}`)).status,
        pfad,
      ).toBe(200);
    }
    // Erst das Objekt (404), dann das Recht (403)
    const ohne = await legePersonaMitFaktorAn(welt, "elternA");
    expect(
      (await anfrage(ohne, "GET", `/api/v1/admin/lager/${randomUUID()}`))
        .status,
    ).toBe(404);
    expect(
      (await anfrage(ohne, "GET", `/api/v1/admin/lager/${id}`)).status,
    ).toBe(403);
    // Lager einer anderen Abteilung: auch mit dem Recht 404
    const fremd = await legePersonaAn(welt, "demoAdmin");
    expect(
      (await anfrage(fremd, "GET", `/api/v1/admin/lager/${id}`)).status,
    ).toBe(404);
  });
});

// Wartung: nur der Entwickler (#802). Zeilen der alten Rechte in Rollen bleiben in der Datenbank liegen (keine Migration) und geben nichts
async function pruefeWartungNurEntwickler() {
  const setze = (konto: PersonaKonto, bereich: string) =>
    anfrage(konto, "PUT", "/api/v1/plattform/schalter", {
      art: "wartung",
      bereich,
      hinweis: "Kurz weg",
    });
  const hebe = (konto: PersonaKonto, bereich: string) =>
    anfrage(
      konto,
      "DELETE",
      `/api/v1/plattform/schalter?art=wartung&bereich=${bereich}`,
    );
  const bereiche = [
    "alles",
    "website",
    "lager",
    "chat",
    "programme",
    "verwaltung",
  ];
  const plattform = await mitPlattformrolle([
    "wartung.bereiche",
    "wartungsmodus.website",
  ]);
  const gruppe = (
    await mitGruppenrolle([
      ...alle("wartung.bereiche"),
      ...alle("wartungsmodus.website"),
    ])
  ).konto;
  const entwickler = await legePersonaMitFaktorAn(welt, "elternA");
  await db
    .insert(schema.plattformEntwickler)
    .values({ userId: entwickler.id! });
  try {
    for (const bereich of bereiche) {
      for (const konto of [admin, plattform, gruppe]) {
        expect((await setze(konto, bereich)).status, bereich).toBe(403);
      }
      expect((await setze(entwickler, bereich)).status, bereich).toBe(200);
      for (const konto of [admin, plattform, gruppe]) {
        expect((await hebe(konto, bereich)).status, bereich).toBe(403);
      }
      expect((await hebe(entwickler, bereich)).status, bereich).toBe(204);
    }
    // Die Rolle mit dem alten Recht sieht nicht einmal den Stand; die Abteilungsleitung liest ihn
    expect(
      (await anfrage(plattform, "GET", "/api/v1/plattform/schalter")).status,
    ).toBe(403);
    expect(
      (await anfrage(admin, "GET", "/api/v1/plattform/schalter")).status,
    ).toBe(200);
    // Die Informationssperre bleibt bei der Abteilungsleitung
    const sperre = (konto: PersonaKonto) =>
      anfrage(konto, "PUT", "/api/v1/plattform/schalter", {
        art: "sperre",
        bereich: "chat",
      });
    expect((await sperre(plattform)).status).toBe(403);
    expect((await sperre(admin)).status).toBe(200);
    expect(
      (
        await anfrage(
          admin,
          "DELETE",
          "/api/v1/plattform/schalter?art=sperre&bereich=chat",
        )
      ).status,
    ).toBe(204);
  } finally {
    await db
      .delete(schema.plattformEntwickler)
      .where(eq(schema.plattformEntwickler.userId, entwickler.id!));
  }
}

describe("Wartung nur für den Entwickler (#802)", () => {
  test(
    "Abteilungsleitung, Plattformrolle und Gruppenrolle mit den alten Rechten: 403 in jedem Bereich, Entwickler darf",
    pruefeWartungNurEntwickler,
  );
});

describe("Website: Gruppenrollen und Plattformrollen", () => {
  const seite = async (zusatz: Partial<typeof schema.seite.$inferInsert>) => {
    const [z] = await db
      .insert(schema.seite)
      .values({
        abteilungId: welt.testabteilungId,
        adresse: `s-${randomUUID().slice(0, 8)}`,
        titel: "Seite",
        sichtbarkeit: "angemeldet",
        ...zusatz,
      })
      .returning({ id: schema.seite.id });
    return z.id;
  };

  test("Gruppenrolle mit «seiten.bearbeiten» für die eigene Gruppe: nur die Seiten der Gruppe", async () => {
    const { konto, gruppe } = await mitGruppenrolle([
      { recht: "seiten.bearbeiten", geltung: "eigene" },
    ]);
    const eigene = await seite({ tagId: gruppe });
    const fremde = await seite({});
    const ändern = (id: string) =>
      anfrage(konto, "PATCH", `/api/v1/redaktion/seiten/${id}`, {
        titel: "Neu",
      });
    expect((await ändern(eigene)).status).toBe(204);
    expect((await ändern(fremde)).status).toBe(403);
    expect((await ändern(randomUUID())).status).toBe(404);
    // Die Tür steht offen, die Liste zeigt nur die eigene Seite
    const liste = await anfrage(konto, "GET", "/api/v1/redaktion/seiten");
    expect(liste.status).toBe(200);
    const ids = ((await liste.json()) as { seiten: { id: string }[] }).seiten;
    expect(ids.map((s) => s.id)).toEqual([eigene]);
    // Anlegen verlangt das eigene Recht
    const neu = await anfrage(konto, "POST", "/api/v1/redaktion/seiten", {
      titel: "Neu",
      adresse: `n-${randomUUID().slice(0, 8)}`,
      sichtbarkeit: { art: "angemeldet" },
    });
    expect(neu.status).toBe(403);
  });

  test("Gruppenrolle mit «seiten.anlegen_loeschen» für alle darf anlegen; ohne zweiten Faktor 403 ZWEITER_FAKTOR_FEHLT", async () => {
    const { konto } = await mitGruppenrolle(alle("seiten.anlegen_loeschen"));
    const body = () => ({
      titel: "Neu",
      adresse: `n-${randomUUID().slice(0, 8)}`,
      sichtbarkeit: { art: "angemeldet" },
    });
    expect(
      (await anfrage(konto, "POST", "/api/v1/redaktion/seiten", body())).status,
    ).toBe(201);
    const ohneFaktor = await mitGruppenrolle(alle("seiten.anlegen_loeschen"), {
      faktor: false,
    });
    const res = await anfrage(
      ohneFaktor.konto,
      "POST",
      "/api/v1/redaktion/seiten",
      body(),
    );
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("ZWEITER_FAKTOR_FEHLT");
  });

  test("Einstellungen der Website: «seiten.veroeffentlichen» für alle, nie für die eigene Stufenseite", async () => {
    const rolle = await mitPlattformrolle(["seiten.veroeffentlichen"]);
    expect(
      (await anfrage(rolle, "GET", "/api/v1/redaktion/website")).status,
    ).toBe(200);
    const sl = await legePersonaAn(welt, "slA");
    expect((await anfrage(sl, "GET", "/api/v1/redaktion/website")).status).toBe(
      403,
    );
    const { konto } = await mitGruppenrolle([
      { recht: "seiten.veroeffentlichen", geltung: "eigene" },
    ]);
    expect(
      (await anfrage(konto, "GET", "/api/v1/redaktion/website")).status,
    ).toBe(403);
  });
});

describe("GET /api/v1/redaktion/ich: Katalogrechte der Person", () => {
  const ich = async (konto: PersonaKonto) =>
    (await (await anfrage(konto, "GET", "/api/v1/redaktion/ich")).json()) as {
      bereiche: string[];
      rechte: string[];
      katalogRechte: string[];
      katalogRechteEigene: string[];
    };

  test("Rolle mit Lädeli-Recht: Bereich «laedeli», kein Zugang zur Website", async () => {
    const konto = await mitPlattformrolle(["laden.ansehen", "system.lesen"]);
    const a = await ich(konto);
    expect(a.katalogRechte).toEqual(["laden.ansehen", "system.lesen"]);
    expect(a.bereiche).toEqual(["laedeli", "system"]);
    expect(a.rechte).toEqual([]);
  });

  test("Gruppenrolle für die eigene Gruppe steht unter «katalogRechteEigene», nie unter «katalogRechte»", async () => {
    const { konto } = await mitGruppenrolle([
      { recht: "seiten.bearbeiten", geltung: "eigene" },
    ]);
    const a = await ich(konto);
    expect(a.katalogRechte).not.toContain("seiten.bearbeiten");
    expect(a.katalogRechteEigene).toContain("seiten.bearbeiten");
  });

  test("Abteilungsleitung hat alle Rechte ausser dem, was nur der Entwickler darf; Eltern keine", async () => {
    const a = await ich(admin);
    expect(a.katalogRechte).toContain("laden.einstellungen");
    expect(a.katalogRechte).toContain("rechte.verwalten");
    expect(a.katalogRechte).not.toContain("protokoll.lesen");
    const eltern = await ich(await legePersonaAn(welt, "elternA"));
    expect(eltern.katalogRechte).toEqual([]);
    expect(eltern.bereiche).toEqual([]);
  });

  test("Webmaster (Vorgabe) wie bisher: Bereich «website», Plattformrechte, keine Lädeli-Rechte", async () => {
    const konto = await legePersonaMitFaktorAn(welt, "elternA");
    await macheWebmaster(db, welt.testabteilungId, konto.id!);
    const a = await ich(konto);
    // Die Vorgabe «Webmaster» hat auch «fotos.verwalten» (#690)
    expect(a.bereiche).toEqual(["website", "fotos"]);
    expect(a.rechte).toContain("medien.verwalten");
    expect(a.katalogRechte.filter((r) => r.startsWith("laden."))).toEqual([]);
  });
});

describe("Modus «neu»: dieselben Antworten", () => {
  beforeAll(() => setzeRechteModus("neu"));
  afterAll(() => setzeRechteModus("schatten"));

  test("Lädeli: Plattformrolle und Gruppenrolle öffnen, ohne Recht 403", async () => {
    const pfad = "/api/v1/admin/laden/artikel";
    expect(
      (await anfrage(await mitPlattformrolle(["laden.ansehen"]), "GET", pfad))
        .status,
    ).toBe(200);
    const { konto } = await mitGruppenrolle(alle("laden.ansehen"));
    expect((await anfrage(konto, "GET", pfad)).status).toBe(200);
    expect(
      (
        await anfrage(
          await legePersonaMitFaktorAn(welt, "elternA"),
          "GET",
          pfad,
        )
      ).status,
    ).toBe(403);
    expect((await anfrage(admin, "GET", pfad)).status).toBe(200);
  });

  test("Website: Webmaster und Stufenleitung wie bisher; die Stufenleitung sieht die Einstellungen nicht", async () => {
    const webmaster = await legePersonaMitFaktorAn(welt, "elternA");
    await macheWebmaster(db, welt.testabteilungId, webmaster.id!);
    expect(
      (await anfrage(webmaster, "GET", "/api/v1/redaktion/seiten")).status,
    ).toBe(200);
    const sl = await legePersonaAn(welt, "slA");
    expect((await anfrage(sl, "GET", "/api/v1/redaktion/seiten")).status).toBe(
      200,
    );
    expect((await anfrage(sl, "GET", "/api/v1/redaktion/website")).status).toBe(
      403,
    );
    expect((await anfrage(sl, "GET", "/api/v1/redaktion/medien")).status).toBe(
      200,
    );
  });

  test(
    "Wartung: nur der Entwickler, die Sperre bleibt bei der Abteilungsleitung",
    pruefeWartungNurEntwickler,
  );
});

// Seite eines Lagers (#838): «Seite anlegen» nur mit «lager.verwalten» und «seiten.anlegen_loeschen», idempotent, fremd 404; der Editor nennt Anlass und Lager nur, wer sie in der Verwaltung öffnen darf
describe("Seite eines Lagers und Bezug im Editor (#838)", () => {
  const legeLager = async (titel = "Sommerlager") =>
    (
      await db
        .insert(schema.lager)
        .values({
          abteilungId: welt.testabteilungId,
          titel,
          von: "2027-07-10",
          bis: "2027-07-24",
        })
        .returning({ id: schema.lager.id })
    )[0].id;
  const seiteVon = async (lagerId: string) =>
    (
      await db
        .select({ seiteId: schema.lager.seiteId })
        .from(schema.lager)
        .where(eq(schema.lager.id, lagerId))
    )[0].seiteId;
  const pfad = (lagerId: string) => `/api/v1/admin/lager/${lagerId}/seite`;
  const bezug = async (konto: PersonaKonto, seiteId: string) => {
    const antwort = await anfrage(
      konto,
      "GET",
      `/api/v1/redaktion/seiten/${seiteId}`,
    );
    expect(antwort.status).toBe(200);
    const { anlassId, lagerId } = (await antwort.json()) as {
      anlassId: string | null;
      lagerId: string | null;
    };
    return { anlassId, lagerId };
  };

  test("legt die Seite als Entwurf für Angemeldete an, verknüpft sie und legt beim zweiten Klick keine zweite an", async () => {
    const lagerId = await legeLager("Sommerlager 2027");
    const erst = await anfrage(admin, "POST", pfad(lagerId));
    expect(erst.status).toBe(201);
    const { seiteId } = (await erst.json()) as { seiteId: string };
    expect(await seiteVon(lagerId)).toBe(seiteId);
    const [seite] = await db
      .select()
      .from(schema.seite)
      .where(eq(schema.seite.id, seiteId));
    expect(seite).toMatchObject({
      titel: "Sommerlager 2027",
      sichtbarkeit: "angemeldet",
      veroeffentlichteVersionId: null,
      elternId: null,
    });
    const [eintrag] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, lagerId));
    expect(eintrag).toMatchObject({
      aktion: "lager_seite_angelegt",
      details: { seiteId },
    });

    const zweit = await anfrage(admin, "POST", pfad(lagerId));
    expect(zweit.status).toBe(200);
    expect(await zweit.json()).toEqual({ seiteId });
    const anzahl = await db
      .select({ id: schema.seite.id })
      .from(schema.seite)
      .where(eq(schema.seite.titel, "Sommerlager 2027"));
    expect(anzahl).toHaveLength(1);
    // Die Verwaltung des Lagers kennt die Seite
    const lager = await anfrage(admin, "GET", `/api/v1/admin/lager/${lagerId}`);
    expect(((await lager.json()) as { seiteId: string }).seiteId).toBe(seiteId);
  });

  test("Rechte: beide Rechte nötig, ohne zweiten Faktor 403; unbekannt und fremd 404", async () => {
    const lagerId = await legeLager();
    for (const rechte of [
      ["lager.verwalten"],
      ["seiten.anlegen_loeschen"],
      [],
    ]) {
      const konto = await mitPlattformrolle(rechte);
      expect(
        (await anfrage(konto, "POST", pfad(lagerId))).status,
        rechte.join(),
      ).toBe(403);
    }
    expect(await seiteVon(lagerId)).toBeNull();
    const ohneFaktor = await mitPlattformrolle(
      ["lager.verwalten", "seiten.anlegen_loeschen"],
      false,
    );
    const gesperrt = await anfrage(ohneFaktor, "POST", pfad(lagerId));
    expect(gesperrt.status).toBe(403);
    expect(await gesperrt.json()).toMatchObject({
      code: "ZWEITER_FAKTOR_FEHLT",
    });
    const beide = await mitPlattformrolle([
      "lager.verwalten",
      "seiten.anlegen_loeschen",
    ]);
    expect((await anfrage(beide, "POST", pfad(lagerId))).status).toBe(201);
    expect((await anfrage(admin, "POST", pfad(randomUUID()))).status).toBe(404);
    const fremd = await legePersonaAn(welt, "demoAdmin");
    expect((await anfrage(fremd, "POST", pfad(lagerId))).status).toBe(404);
  });

  test("wird die Seite gelöscht, ist die Verknüpfung leer und «Seite anlegen» legt eine neue an", async () => {
    const lagerId = await legeLager("Herbstlager");
    const { seiteId } = (await (
      await anfrage(admin, "POST", pfad(lagerId))
    ).json()) as { seiteId: string };
    expect(
      (await anfrage(admin, "DELETE", `/api/v1/redaktion/seiten/${seiteId}`))
        .status,
    ).toBe(204);
    expect(await seiteVon(lagerId)).toBeNull();
    const neu = await anfrage(admin, "POST", pfad(lagerId));
    expect(neu.status).toBe(201);
    const { seiteId: zweite } = (await neu.json()) as { seiteId: string };
    expect(zweite).not.toBe(seiteId);
    expect(await seiteVon(lagerId)).toBe(zweite);
  });

  test("der Editor nennt Lager und Anlass nur, wer sie öffnen darf; eine andere Seite hat keinen Bezug", async () => {
    const lagerId = await legeLager("Pfingstlager");
    const { seiteId: lagerSeite } = (await (
      await anfrage(admin, "POST", pfad(lagerId))
    ).json()) as { seiteId: string };
    const programm = await legeProgrammAn(db, {
      abteilungId: welt.testabteilungId,
      titel: "Waldweihnacht",
      beginn: new Date("2027-12-11T13:00:00Z"),
    });
    const angelegt = await anfrage(admin, "POST", "/api/v1/admin/anlaesse", {
      programmId: programm.id,
      anmeldungFuer: "person",
      anmeldungOffen: true,
      sichtbarkeit: { art: "angemeldet" },
      felder: [],
    });
    expect(angelegt.status).toBe(201);
    const anlass = (await angelegt.json()) as { id: string; seiteId: string };

    expect(await bezug(admin, lagerSeite)).toEqual({
      anlassId: null,
      lagerId,
    });
    expect(await bezug(admin, anlass.seiteId)).toEqual({
      anlassId: anlass.id,
      lagerId: null,
    });
    // Der Webmaster bearbeitet die Seiten, öffnet aber weder Lager noch Anlass
    const webmaster = await legePersonaMitFaktorAn(welt, "elternA");
    await macheWebmaster(db, welt.testabteilungId, webmaster.id!);
    expect(await bezug(webmaster, lagerSeite)).toEqual({
      anlassId: null,
      lagerId: null,
    });
    expect(await bezug(webmaster, anlass.seiteId)).toEqual({
      anlassId: null,
      lagerId: null,
    });
    // Mit «lager.verwalten» dazu nennt der Editor das Lager
    const beide = await mitPlattformrolle([
      "seiten.bearbeiten",
      "lager.verwalten",
    ]);
    expect((await bezug(beide, lagerSeite)).lagerId).toBe(lagerId);
    const andere = (await (
      await anfrage(admin, "POST", "/api/v1/redaktion/seiten", {
        titel: "Kontakt",
        adresse: `kontakt-${randomUUID().slice(0, 8)}`,
        sichtbarkeit: { art: "angemeldet" },
      })
    ).json()) as { id: string };
    expect(await bezug(admin, andere.id)).toEqual({
      anlassId: null,
      lagerId: null,
    });
  });
});

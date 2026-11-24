import { describe, expect, test } from "vitest";
import { erstelleBegrenzung } from "../src/fotos/begrenzung.js";
import {
  QuellFehler,
  type FotoQuelle,
  type QuellAlbum,
} from "../src/fotos/quelle.js";
import {
  erstelleZwischenspeicher,
  FEHLER_FRIST_MS,
  FRIST_MS,
} from "../src/fotos/zwischenspeicher.js";

// Zwischenspeicher und Begrenzung (#690) mit einer Uhr, die der Test stellt, und einer Quelle, die zählt.
const album = (id: string): QuellAlbum => ({
  id,
  titel: "Album",
  anzahl: 1,
  datum: null,
  titelbild: null,
});

function quelle(
  verhalten: () => Promise<QuellAlbum[]> = async () => [album("1")],
) {
  const n = { alben: 0, album: 0, datei: 0 };
  const q: FotoQuelle = {
    alben: () => {
      n.alben++;
      return verhalten();
    },
    album: async (_k, id) => {
      n.album++;
      return { album: album(id), bilder: [] };
    },
    datei: async () => {
      n.datei++;
      return {
        body: new ReadableStream<Uint8Array>(),
        typ: "image/jpeg",
        laenge: null,
      };
    },
  };
  return { q, n };
}

describe("Zwischenspeicher", () => {
  test("ein Treffer gilt bis zur Frist, danach holt er neu", async () => {
    let t = 1_000;
    const { q, n } = quelle();
    const s = erstelleZwischenspeicher(q, { jetzt: () => t });
    await s.alben("k");
    await s.alben("k");
    expect(n.alben).toBe(1);
    t += FRIST_MS - 1;
    await s.alben("k");
    expect(n.alben).toBe(1);
    t += 2;
    await s.alben("k");
    expect(n.alben).toBe(2);
  });

  test("Konto und Album sind getrennte Schlüssel", async () => {
    const { q, n } = quelle();
    const s = erstelleZwischenspeicher(q);
    await s.alben("a");
    await s.alben("b");
    await s.album("a", "1");
    await s.album("a", "2");
    await s.album("a", "1");
    expect(n).toMatchObject({ alben: 2, album: 2 });
  });

  test("gleichzeitige Anfragen teilen sich einen Abruf", async () => {
    let los!: () => void;
    const warte = new Promise<void>((r) => (los = r));
    const { q, n } = quelle(async () => {
      await warte;
      return [album("1")];
    });
    const s = erstelleZwischenspeicher(q);
    const alle = [s.alben("k"), s.alben("k"), s.alben("k")];
    los();
    await Promise.all(alle);
    expect(n.alben).toBe(1);
  });

  test("ein Fehler bleibt nur kurz stehen (kein Ansturm auf Flickr), danach versucht er es wieder", async () => {
    let t = 0;
    let fehlschlag = true;
    const { q, n } = quelle(async () => {
      if (fehlschlag) throw new QuellFehler("nicht_erreichbar");
      return [album("1")];
    });
    const s = erstelleZwischenspeicher(q, { jetzt: () => t });
    await expect(s.alben("k")).rejects.toBeInstanceOf(QuellFehler);
    await expect(s.alben("k")).rejects.toBeInstanceOf(QuellFehler);
    expect(n.alben).toBe(1);
    t += FEHLER_FRIST_MS + 1;
    fehlschlag = false;
    expect(await s.alben("k")).toHaveLength(1);
    expect(n.alben).toBe(2);
  });

  test("«nicht gefunden» gilt so lange wie ein Treffer", async () => {
    let t = 0;
    const { q, n } = quelle(async () => {
      throw new QuellFehler("nicht_gefunden");
    });
    const s = erstelleZwischenspeicher(q, { jetzt: () => t });
    await expect(s.alben("k")).rejects.toBeDefined();
    t += FEHLER_FRIST_MS + 1;
    await expect(s.alben("k")).rejects.toBeDefined();
    expect(n.alben).toBe(1);
  });

  test("leere() vergisst alles; die Datei geht nie durch den Speicher", async () => {
    const { q, n } = quelle();
    const s = erstelleZwischenspeicher(q);
    await s.alben("k");
    s.leere();
    await s.alben("k");
    expect(n.alben).toBe(2);
    const bild = {
      id: "1",
      server: "1",
      secret: "abcd",
      titel: "",
      breite: 4,
      hoehe: 3,
      groessen: [],
    };
    await s.datei(bild, "mittel");
    await s.datei(bild, "mittel");
    expect(n.datei).toBe(2);
  });
});

describe("Begrenzung je Konto", () => {
  test("lässt max Anfragen je Fenster zu, danach nicht, und im neuen Fenster wieder", () => {
    let t = 0;
    const grenze = erstelleBegrenzung({
      max: 3,
      fensterMs: 1000,
      jetzt: () => t,
    });
    expect([1, 2, 3, 4, 5].map(() => grenze("a"))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    // Ein anderes Konto zählt für sich
    expect(grenze("b")).toBe(true);
    t += 1000;
    expect(grenze("a")).toBe(true);
  });
});

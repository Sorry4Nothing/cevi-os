import { afterEach, expect, test, vi } from "vitest";
import { holeKalender, MAX_BYTES } from "../../src/kalender/abruf.js";
import { ANTWORT_UNGUELTIG } from "../../src/kalender/fehler.js";

afterEach(() => vi.unstubAllGlobals());

const ADRESSE = "https://kalender.example/test.ics";

function stubAntwort(antwort: Response) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(antwort));
}

test("liefert den Text einer kleinen Antwort", async () => {
  stubAntwort(new Response("BEGIN:VCALENDAR\nEND:VCALENDAR"));
  await expect(holeKalender(ADRESSE)).resolves.toBe(
    "BEGIN:VCALENDAR\nEND:VCALENDAR",
  );
});

test("bricht ab, sobald der Body MAX_BYTES überschreitet, und liest nicht weiter", async () => {
  let gelesen = 0;
  const stueck = new Uint8Array(1024 * 1024);
  const body = new ReadableStream<Uint8Array>({
    pull(steuerung) {
      gelesen += stueck.byteLength;
      steuerung.enqueue(stueck);
    },
  });
  stubAntwort(new Response(body));
  await expect(holeKalender(ADRESSE)).rejects.toThrow(ANTWORT_UNGUELTIG);
  // Endlos-Quelle: ohne Deckel käme der Test nie zurück
  expect(gelesen).toBeLessThanOrEqual(MAX_BYTES + 4 * stueck.byteLength);
});

test("weist eine zu grosse angekündigte Länge ohne Lesen ab", async () => {
  stubAntwort(
    new Response("x", { headers: { "content-length": String(MAX_BYTES + 1) } }),
  );
  await expect(holeKalender(ADRESSE)).rejects.toThrow(ANTWORT_UNGUELTIG);
});

test("folgt keiner Weiterleitung, und ein Fehler dabei nennt die Adresse nicht", async () => {
  const abruf = vi
    .fn()
    .mockRejectedValue(new TypeError(`unexpected redirect ${ADRESSE}`));
  vi.stubGlobal("fetch", abruf);
  const fehler = await holeKalender(ADRESSE).catch((e: Error) => e);
  expect(abruf.mock.calls[0]![1].redirect).toBe("error");
  expect(fehler).toBeInstanceOf(Error);
  expect((fehler as Error).message).not.toContain("kalender.example");
});

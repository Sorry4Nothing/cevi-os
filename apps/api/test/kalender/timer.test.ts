import {
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import { starteKalenderSync } from "../../src/kalender/sync.js";

const FUENF_MINUTEN = 5 * 60 * 1000;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  vi.useFakeTimers();
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  ausgabe.mockRestore();
  vi.useRealTimers();
});

test("läuft sofort und dann alle 5 Minuten; Erfolg bleibt still", async () => {
  const lauf = vi.fn().mockResolvedValue("fertig");
  const timer = starteKalenderSync(lauf);
  expect(lauf).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(FUENF_MINUTEN - 1);
  expect(lauf).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(lauf).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(FUENF_MINUTEN);
  expect(lauf).toHaveBeenCalledTimes(3);
  clearInterval(timer);
  expect(ausgabe).not.toHaveBeenCalled();
});

test("eine abgelehnte Runde schreibt eine Zeile ohne die Meldung, und der Timer läuft weiter", async () => {
  const lauf = vi.fn().mockRejectedValue(
    // Die Meldung sieht aus wie eine Verbindungs-URL mit Passwort: Sie darf nie im Log stehen
    Object.assign(new Error("postgres://cevi:geheim-6@example.org/cevi_os"), {
      code: "ECONNREFUSED",
    }),
  );
  const timer = starteKalenderSync(lauf);
  await vi.advanceTimersByTimeAsync(0);
  expect(ausgabe).toHaveBeenCalledTimes(1);
  const zeile = ausgabe.mock.calls[0][0] as string;
  expect(zeile).not.toContain("geheim-6");
  expect(JSON.parse(zeile)).toEqual({
    zeit: expect.any(String),
    ereignis: "kalender",
    fehler: "Unerwarteter Fehler",
    code: "ECONNREFUSED",
  });

  await vi.advanceTimersByTimeAsync(FUENF_MINUTEN);
  expect(lauf).toHaveBeenCalledTimes(2);
  expect(ausgabe).toHaveBeenCalledTimes(2);
  clearInterval(timer);
});

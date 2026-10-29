import * as SecureStore from "expo-secure-store";
import { Platform, Settings } from "react-native";

import { alteEintraegeLoeschen, SCHLUESSEL, speicher } from "../src/speicher";

const { __speicher, __aufrufe } = jest.requireMock("expo-secure-store") as {
  __speicher: Map<string, string>;
  __aufrufe: { methode: string; schluessel: string; optionen: object }[];
};
const marken = (Settings as unknown as { __werte: Map<string, unknown> })
  .__werte;

beforeEach(() => {
  __speicher.clear();
  __aufrufe.length = 0;
  marken.clear();
});
afterEach(() => jest.restoreAllMocks());

function alleBelegen() {
  for (const schluessel of SCHLUESSEL) __speicher.set(schluessel, "alt");
}

test("die Konstante ist die echte «WHEN_UNLOCKED_THIS_DEVICE_ONLY» (6)", () => {
  expect(SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY).toBe(6);
});

test("jeder Aufruf trägt «WHEN_UNLOCKED_THIS_DEVICE_ONLY» und nie requireAuthentication", async () => {
  await speicher.setItemAsync("a", "1");
  speicher.setItem("b", "2");
  await speicher.getItemAsync("a");
  speicher.getItem("b");
  await speicher.deleteItemAsync("a");

  expect(__aufrufe.map((aufruf) => aufruf.methode)).toEqual([
    "setItemAsync",
    "setItem",
    "getItemAsync",
    "getItem",
    "deleteItemAsync",
  ]);
  for (const { optionen } of __aufrufe) {
    expect(optionen).toEqual({ keychainAccessible: 6 });
    expect(optionen).not.toHaveProperty("requireAuthentication");
  }
});

test("iOS: ohne Marke löscht der erste Start alle alten Einträge und setzt die Marke", async () => {
  alleBelegen();
  __speicher.set("fremd", "bleibt");

  await alteEintraegeLoeschen();

  expect([...__speicher.keys()]).toEqual(["fremd"]);
  expect(marken.get("cevi-os_installiert")).toBe(true);
  const loeschen = __aufrufe.filter((a) => a.methode === "deleteItemAsync");
  expect(loeschen.map((a) => a.schluessel)).toEqual(SCHLUESSEL);
  for (const { optionen } of loeschen) {
    expect(optionen).toEqual({ keychainAccessible: 6 });
  }
});

test("iOS: mit Marke bleiben die Einträge, es wird nichts gelöscht", async () => {
  marken.set("cevi-os_installiert", true);
  alleBelegen();

  await alteEintraegeLoeschen();

  expect(__speicher.size).toBe(SCHLUESSEL.length);
  expect(__aufrufe).toEqual([]);
});

test("iOS: scheitert ein Löschen, fehlt die Marke, und der Fehler geht weiter", async () => {
  alleBelegen();
  jest
    .spyOn(SecureStore, "deleteItemAsync")
    .mockRejectedValueOnce(new Error("Keychain gesperrt"));

  await expect(alteEintraegeLoeschen()).rejects.toThrow("Keychain gesperrt");

  expect(marken.has("cevi-os_installiert")).toBe(false);
});

test("Android: nichts löschen und Settings nie anfassen", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  const lesen = jest.spyOn(Settings, "get");
  const schreiben = jest.spyOn(Settings, "set");
  alleBelegen();

  await alteEintraegeLoeschen();

  expect(__speicher.size).toBe(SCHLUESSEL.length);
  expect(lesen).not.toHaveBeenCalled();
  expect(schreiben).not.toHaveBeenCalled();
});

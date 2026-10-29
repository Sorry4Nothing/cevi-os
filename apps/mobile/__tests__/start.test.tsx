import {
  act,
  renderRouter,
  screen,
  waitFor,
} from "expo-router/testing-library";
import { enableAppSwitcherProtectionAsync } from "expo-screen-capture";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { queryClient } from "../src/api/client";

// Der echte Client: Hier zählt, ob vor dem Startschritt schon ein Netzzugriff läuft
jest.mock("expo-screen-capture", () => ({
  enableAppSwitcherProtectionAsync: jest.fn(async () => {}),
}));

const netz = global.fetch as jest.Mock;
const speicher = (
  jest.requireMock("expo-secure-store") as { __speicher: Map<string, string> }
).__speicher;
const marken = (
  jest.requireMock("react-native/Libraries/Settings/Settings") as {
    default: { __werte: Map<string, unknown> };
  }
).default.__werte;

beforeEach(() => {
  jest.clearAllMocks();
  speicher.clear();
  marken.clear();
});
afterEach(() => {
  jest.restoreAllMocks();
  queryClient.clear();
});

test("vor dem Startschritt geht keine Anfrage raus: Erst löscht die App alte Einträge, dann fragt sie nach der Sitzung", async () => {
  speicher.set("cevi-os_cookie", "{}");
  let beenden: () => void = () => {};
  jest
    .spyOn(SecureStore, "deleteItemAsync")
    .mockImplementationOnce(
      () => new Promise<void>((fertig) => (beenden = fertig)),
    );
  await renderRouter("./app", { initialUrl: "/" });

  expect(screen.getByText("Wird geladen …")).toBeOnTheScreen();
  // Die Sitzungsabfrage startet erst nach ein paar Takten: Warten, damit ein zu früh eingehängtes Tor auffällt
  await act(async () => jest.advanceTimersByTime(100));
  expect(netz).not.toHaveBeenCalled();

  await act(async () => beenden());
  await act(async () => {});

  await waitFor(() => expect(netz).toHaveBeenCalled());
});

test("iOS: der Startschritt verdeckt den App-Umschalter mit Blur 1", async () => {
  await renderRouter("./app", { initialUrl: "/" });
  await act(async () => {});

  expect(enableAppSwitcherProtectionAsync).toHaveBeenCalledWith(1);
});

test("Android: der Startschritt fasst den App-Umschalter nicht an", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  await renderRouter("./app", { initialUrl: "/" });
  await act(async () => {});

  expect(enableAppSwitcherProtectionAsync).not.toHaveBeenCalled();
});

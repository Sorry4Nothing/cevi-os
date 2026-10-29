import {
  act,
  fireEvent,
  renderRouter,
  screen,
  waitFor,
} from "expo-router/testing-library";
import * as SecureStore from "expo-secure-store";

import { queryClient } from "../src/api/client";

// Eigene Datei: Der Auth-Client lädt die Sitzung nur einmal je Modul, und hier zählt der erste Netzzugriff
const netz = global.fetch as jest.Mock;
const marken = (
  jest.requireMock("react-native/Libraries/Settings/Settings") as {
    default: { __werte: Map<string, unknown> };
  }
).default.__werte;

afterEach(() => {
  jest.restoreAllMocks();
  queryClient.clear();
});

test("scheitert der Startschritt, bleibt die App zu und bietet «Nochmals versuchen» (kein Netzzugriff)", async () => {
  jest
    .spyOn(SecureStore, "deleteItemAsync")
    .mockRejectedValueOnce(new Error("Keychain gesperrt"));
  await renderRouter("./app", { initialUrl: "/" });
  await act(async () => {});

  expect(screen.getByText("Das Laden hat nicht geklappt.")).toBeOnTheScreen();
  expect(screen.queryByRole("header", { name: "Anmelden" })).toBeNull();
  expect(netz).not.toHaveBeenCalled();

  // Der zweite Versuch gelingt: Die App läuft weiter und fragt nach der Sitzung
  await fireEvent.press(
    screen.getByRole("button", { name: "Nochmals versuchen" }),
  );
  await act(async () => {});
  await waitFor(() => expect(netz).toHaveBeenCalled());
  expect(marken.get("cevi-os_installiert")).toBe(true);
});

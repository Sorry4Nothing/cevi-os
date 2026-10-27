import { fireEvent, render, screen } from "@testing-library/react-native";

import Datenschutz from "../app/(auth)/datenschutz";
import { api, queryClient } from "../src/api/client";

jest.mock("../src/api/client", () => {
  const { QueryClient } = jest.requireActual("@tanstack/react-query");
  return {
    api: { api: { v1: { ich: { datenschutz: { $post: jest.fn() } } } } },
    ApiFehler: class ApiFehler extends Error {},
    queryClient: new QueryClient(),
  };
});

const melden = jest.mocked(api.api.v1.ich.datenschutz.$post);

beforeEach(() => {
  melden.mockReset();
  jest.restoreAllMocks();
});

test("zeigt den Hinweis als Kenntnisnahme mit dem Knopf «Gelesen»", async () => {
  await render(<Datenschutz />);

  expect(
    screen.getByRole("header", { name: "Datenschutz-Hinweis" }),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(
      "Die App speichert keine Serverdaten auf dem Gerät. Sie hält sie nur im Arbeitsspeicher, solange sie läuft.",
    ),
  ).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Gelesen" })).toBeOnTheScreen();
});

test("«Gelesen» meldet die Kenntnisnahme und lädt «ich» neu", async () => {
  melden.mockResolvedValue({} as never);
  const neuLaden = jest.spyOn(queryClient, "invalidateQueries");
  await render(<Datenschutz />);

  await fireEvent.press(screen.getByRole("button", { name: "Gelesen" }));

  expect(melden).toHaveBeenCalledTimes(1);
  expect(neuLaden).toHaveBeenCalledWith({ queryKey: ["ich"] });
});

test("ohne Netz bleibt der Bildschirm mit einer Meldung stehen", async () => {
  melden.mockRejectedValue(new TypeError("Network request failed"));
  await render(<Datenschutz />);

  await fireEvent.press(screen.getByRole("button", { name: "Gelesen" }));

  expect(
    await screen.findByText(
      "Keine Internetverbindung. Bitte später nochmals versuchen.",
    ),
  ).toBeOnTheScreen();
});

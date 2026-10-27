import { fireEvent, render, screen } from "@testing-library/react-native";

import Profil from "../app/(tabs)/profil";
import { abmelden, authClient } from "../src/api/client";
import { useIch } from "../src/api/ich";

jest.mock("../src/api/client", () => ({
  abmelden: jest.fn(),
  authClient: { changePassword: jest.fn(), revokeSessions: jest.fn() },
}));
jest.mock("../src/api/ich", () => ({ useIch: jest.fn() }));

const ich = jest.mocked(useIch);
const ueberall = jest.mocked(authClient.revokeSessions);

beforeEach(() => {
  jest.clearAllMocks();
  ich.mockReturnValue({
    data: {
      name: "Eltern A",
      benutzername: "eltern.a",
      mussPasswortAendern: false,
      datenschutzGelesenAm: "2026-10-01T00:00:00.000Z",
    },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  } as never);
});

test("zeigt Name und Benutzername aus GET /ich mit den Abschnitten und Knöpfen", async () => {
  await render(<Profil />);

  expect(screen.getByRole("header", { name: "Profil" })).toBeOnTheScreen();
  expect(screen.getByText("Eltern A")).toBeOnTheScreen();
  expect(screen.getByText("Benutzername: eltern.a")).toBeOnTheScreen();
  expect(
    screen.getByRole("header", { name: "Passwort ändern" }),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText("Bisheriges Passwort")).toBeOnTheScreen();
  expect(screen.getByLabelText("Neues Passwort")).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Passwort ändern" }),
  ).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Abmelden" })).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Überall abmelden" }),
  ).toBeOnTheScreen();
});

test("«Abmelden» ruft die eine Abmelde-Funktion", async () => {
  await render(<Profil />);

  await fireEvent.press(screen.getByRole("button", { name: "Abmelden" }));

  expect(abmelden).toHaveBeenCalledTimes(1);
});

test("«Überall abmelden» beendet alle Sitzungen und meldet dann ab", async () => {
  ueberall.mockResolvedValue({ error: null } as never);
  await render(<Profil />);

  await fireEvent.press(
    screen.getByRole("button", { name: "Überall abmelden" }),
  );

  expect(ueberall).toHaveBeenCalledTimes(1);
  expect(abmelden).toHaveBeenCalledTimes(1);
});

test("ohne Netz bleibt die Person angemeldet und sieht eine Meldung", async () => {
  ueberall.mockRejectedValue(new TypeError("Network request failed"));
  await render(<Profil />);

  await fireEvent.press(
    screen.getByRole("button", { name: "Überall abmelden" }),
  );

  expect(
    await screen.findByText(
      "Keine Internetverbindung. Bitte später nochmals versuchen.",
    ),
  ).toBeOnTheScreen();
  expect(abmelden).not.toHaveBeenCalled();
});

test("nach dem Passwortwechsel bleibt die Erfolgsmeldung stehen (Checkliste 8.2)", async () => {
  jest
    .mocked(authClient.changePassword)
    .mockResolvedValue({ error: null } as never);
  await render(<Profil />);

  await fireEvent.changeText(
    screen.getByLabelText("Bisheriges Passwort"),
    "mein-altes-passwort",
  );
  await fireEvent.changeText(
    screen.getByLabelText("Neues Passwort"),
    "mein-neues-passwort",
  );
  await fireEvent.press(
    screen.getByRole("button", { name: "Passwort ändern" }),
  );

  expect(
    await screen.findByText(
      "Das Passwort ist geändert. Alle anderen Geräte sind abgemeldet.",
    ),
  ).toBeOnTheScreen();
});

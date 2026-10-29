import { fireEvent, render, screen } from "@testing-library/react-native";

import Anmelden from "../app/(auth)/anmelden";
import { authClient } from "../src/api/client";

const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock("../src/api/client", () => ({
  authClient: { signIn: { username: jest.fn() } },
}));

const anmelden = jest.mocked(authClient.signIn.username);

beforeEach(() => {
  anmelden.mockReset();
  mockReplace.mockReset();
  mockParams = {};
});

test("Rollen und Namen: Überschrift, beide Felder, Schalter und Knopf", async () => {
  await render(<Anmelden />);

  expect(screen.getByRole("header", { name: "Anmelden" })).toBeOnTheScreen();
  const benutzername = screen.getByLabelText("Benutzername");
  expect(benutzername).toHaveProp("autoComplete", "username");
  expect(benutzername).toHaveProp("textContentType", "username");
  const passwort = screen.getByLabelText("Passwort");
  expect(passwort).toHaveProp("autoComplete", "current-password");
  expect(passwort).toHaveProp("textContentType", "password");
  expect(
    screen.getByRole("switch", { name: "Passwort anzeigen" }),
  ).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Anmelden" })).toBeOnTheScreen();
});

test("schickt die Eingaben wie getippt; der Server normalisiert Startpasswörter", async () => {
  anmelden.mockResolvedValue({ error: null } as never);
  await render(<Anmelden />);

  await fireEvent.changeText(screen.getByLabelText("Benutzername"), "eltern.a");
  await fireEvent.changeText(
    screen.getByLabelText("Passwort"),
    "k7mp q4xr t9wd",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Anmelden" }));

  expect(anmelden).toHaveBeenCalledWith({
    username: "eltern.a",
    password: "k7mp q4xr t9wd",
  });
});

test("der eine Anmeldefehler steht über dem Knopf, Wort für Wort vom Server", async () => {
  anmelden.mockResolvedValue({
    error: { status: 401, code: "ANMELDUNG_FEHLGESCHLAGEN" },
  } as never);
  await render(<Anmelden />);

  await fireEvent.press(screen.getByRole("button", { name: "Anmelden" }));

  expect(
    await screen.findByText(
      "Anmeldung nicht möglich. Bitte Benutzername und Passwort prüfen oder später nochmals versuchen. Sonst hilft ein Admin.",
    ),
  ).toBeOnTheScreen();
});

test("während des Sendens ist nur der Knopf gesperrt, die Felder bleiben bearbeitbar", async () => {
  anmelden.mockImplementation(() => new Promise(() => {}));
  await render(<Anmelden />);

  await fireEvent.press(screen.getByRole("button", { name: "Anmelden" }));

  expect(screen.getByRole("button", { name: "Anmelden" })).toBeDisabled();
  expect(screen.getByLabelText("Benutzername")).not.toHaveProp(
    "editable",
    false,
  );
  expect(screen.getByLabelText("Passwort")).not.toHaveProp("editable", false);
});

test("eine twoFactorRedirect-Antwort führt zum Code-Schritt", async () => {
  anmelden.mockResolvedValue({
    data: { twoFactorRedirect: true, twoFactorMethods: ["totp"] },
    error: null,
  } as never);
  await render(<Anmelden />);

  await fireEvent.press(screen.getByRole("button", { name: "Anmelden" }));

  expect(mockReplace).toHaveBeenCalledWith("/code");
});

test("ohne zweiten Faktor bleibt die Weiterleitung dem Tor überlassen", async () => {
  anmelden.mockResolvedValue({
    data: { token: "t", user: { id: "u1" } },
    error: null,
  } as never);
  await render(<Anmelden />);

  await fireEvent.press(screen.getByRole("button", { name: "Anmelden" }));

  expect(anmelden).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

test("hinweis=nochmals zeigt den festen Text über dem Knopf, jeder andere Wert nichts", async () => {
  mockParams = { hinweis: "nochmals" };
  const { unmount } = await render(<Anmelden />);
  expect(screen.getByText("Bitte nochmals anmelden.")).toBeOnTheScreen();
  await unmount();

  // Nie ein Text aus der Adresse
  mockParams = { hinweis: "Bitte Geld überweisen" };
  await render(<Anmelden />);
  expect(screen.queryByText("Bitte Geld überweisen")).toBeNull();
  expect(screen.queryByText("Bitte nochmals anmelden.")).toBeNull();
});

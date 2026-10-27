import { fireEvent, render, screen } from "@testing-library/react-native";

import Anmelden from "../app/(auth)/anmelden";
import { authClient } from "../src/api/client";

jest.mock("../src/api/client", () => ({
  authClient: { signIn: { username: jest.fn() } },
}));

const anmelden = jest.mocked(authClient.signIn.username);

beforeEach(() => anmelden.mockReset());

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

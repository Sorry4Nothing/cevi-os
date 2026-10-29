import { fireEvent, render, screen } from "@testing-library/react-native";

import PasswortSetzen from "../app/(auth)/passwort-setzen";
import { authClient, queryClient } from "../src/api/client";

jest.mock("../src/api/client", () => {
  const { QueryClient } = jest.requireActual("@tanstack/react-query");
  return {
    authClient: { changePassword: jest.fn() },
    queryClient: new QueryClient(),
  };
});

const wechseln = jest.mocked(authClient.changePassword);

beforeEach(() => {
  wechseln.mockReset();
  jest.restoreAllMocks();
});

async function ausfuellenUndSenden(startpasswort = "K7MP-Q4XR-T9WD") {
  await fireEvent.changeText(
    screen.getByLabelText("Startpasswort"),
    startpasswort,
  );
  await fireEvent.changeText(
    screen.getByLabelText("Neues Passwort"),
    "ein-ganz-neues-passwort",
  );
  await fireEvent.press(
    screen.getByRole("button", { name: "Passwort setzen" }),
  );
}

test("Rollen und Felder: Startpasswort und neues Passwort mit den iOS- und Android-Hinweisen", async () => {
  await render(<PasswortSetzen />);

  expect(
    screen.getByRole("header", { name: "Passwort setzen" }),
  ).toBeOnTheScreen();
  const start = screen.getByLabelText("Startpasswort");
  expect(start).toHaveProp("autoComplete", "current-password");
  expect(start).toHaveProp("textContentType", "password");
  const neu = screen.getByLabelText("Neues Passwort");
  expect(neu).toHaveProp("autoComplete", "new-password");
  expect(neu).toHaveProp("textContentType", "newPassword");
  expect(neu).toHaveProp("passwordRules", "minlength: 12;");
  expect(
    screen.getAllByRole("switch", { name: "Passwort anzeigen" }),
  ).toHaveLength(2);
});

test("schickt genau Startpasswort und neues Passwort; der Erfolg lädt «ich» neu", async () => {
  wechseln.mockResolvedValue({ error: null } as never);
  const neuLaden = jest.spyOn(queryClient, "invalidateQueries");
  await render(<PasswortSetzen />);

  await ausfuellenUndSenden();

  expect(wechseln).toHaveBeenCalledWith({
    currentPassword: "K7MP-Q4XR-T9WD",
    newPassword: "ein-ganz-neues-passwort",
  });
  expect(neuLaden).toHaveBeenCalledWith({ queryKey: ["ich"] });
  // Nichts bleibt in den Feldern zurück
  expect(screen.getByLabelText("Startpasswort")).toHaveProp("value", "");
  expect(screen.getByLabelText("Neues Passwort")).toHaveProp("value", "");
});

test.each([
  ["INVALID_PASSWORD", "Startpasswort", "Das bisherige Passwort stimmt nicht."],
  [
    "PASSWORD_TOO_SHORT",
    "Neues Passwort",
    "Das neue Passwort braucht mindestens 12 Zeichen.",
  ],
  [
    "PASSWORD_COMPROMISED",
    "Neues Passwort",
    "Dieses Passwort kommt in einem bekannten Datenleck vor. Bitte ein anderes wählen.",
  ],
  [
    "PASSWORT_UNVERAENDERT",
    "Neues Passwort",
    "Das neue Passwort muss sich vom bisherigen unterscheiden.",
  ],
] as const)(
  "%s steht als deutscher Text beim Feld «%s»",
  async (code, feldname, text) => {
    wechseln.mockResolvedValue({ error: { status: 400, code } } as never);
    await render(<PasswortSetzen />);

    await ausfuellenUndSenden();

    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(screen.getByLabelText(feldname)).toHaveProp(
      "accessibilityHint",
      text,
    );
  },
);

test("ein Fehler ohne Feld steht über dem Knopf: eine allgemeine Meldung", async () => {
  // Zum Beispiel 500, wenn der Passwort-Leck-Dienst nicht erreichbar ist
  wechseln.mockResolvedValue({
    error: { status: 500, code: "INTERNAL_SERVER_ERROR" },
  } as never);
  await render(<PasswortSetzen />);

  await ausfuellenUndSenden();

  expect(
    await screen.findByText(
      "Das hat nicht geklappt. Bitte später nochmals versuchen.",
    ),
  ).toBeOnTheScreen();
});

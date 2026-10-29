import { fireEvent, render, screen } from "@testing-library/react-native";

import Code from "../app/(auth)/code";
import { authClient } from "../src/api/client";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock("../src/api/client", () => ({
  authClient: {
    twoFactor: { verifyTotp: jest.fn(), verifyBackupCode: jest.fn() },
  },
}));

const totp = jest.mocked(authClient.twoFactor.verifyTotp);
const ersatz = jest.mocked(authClient.twoFactor.verifyBackupCode);

beforeEach(() => jest.resetAllMocks());

test("Rollen und Namen: Überschrift, Feld mit Eingabe-Hinweisen, Knöpfe", async () => {
  await render(<Code />);

  expect(
    screen.getByRole("header", { name: "Code eingeben" }),
  ).toBeOnTheScreen();
  const feld = screen.getByLabelText("Code aus der App");
  expect(feld).toHaveProp("textContentType", "oneTimeCode");
  expect(feld).toHaveProp("autoComplete", "2fa-app-otp");
  expect(feld).toHaveProp("keyboardType", "number-pad");
  expect(screen.getByRole("button", { name: "Anmelden" })).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Ersatzcode verwenden" }),
  ).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Zurück" })).toBeOnTheScreen();
});

test("der Code aus der App geht an verifyTotp, wie getippt", async () => {
  totp.mockResolvedValue({ data: {}, error: null } as never);
  await render(<Code />);

  await fireEvent.changeText(
    screen.getByLabelText("Code aus der App"),
    "123456",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Anmelden" }));

  expect(totp).toHaveBeenCalledWith({ code: "123456" });
  expect(ersatz).not.toHaveBeenCalled();
});

test("der Ersatzcode: eigenes Feld ohne Autokorrektur, Hinweis auf die Schreibung, verifyBackupCode", async () => {
  ersatz.mockResolvedValue({ data: {}, error: null } as never);
  await render(<Code />);

  await fireEvent.press(
    screen.getByRole("button", { name: "Ersatzcode verwenden" }),
  );
  const feld = screen.getByLabelText("Ersatzcode");
  expect(feld).toHaveProp("autoComplete", "off");
  expect(feld).toHaveProp("autoCapitalize", "none");
  expect(feld).toHaveProp("autoCorrect", false);
  expect(
    screen.getByText("Gross- und Kleinschreibung beachten."),
  ).toBeOnTheScreen();
  expect(screen.queryByLabelText("Code aus der App")).toBeNull();

  await fireEvent.changeText(feld, "aB3dE-fG7hJ");
  await fireEvent.press(screen.getByRole("button", { name: "Anmelden" }));
  expect(ersatz).toHaveBeenCalledWith({ code: "aB3dE-fG7hJ" });

  await fireEvent.press(
    screen.getByRole("button", { name: "Code aus der App verwenden" }),
  );
  expect(screen.getByLabelText("Code aus der App")).toBeOnTheScreen();
});

test.each([
  ["INVALID_CODE", false],
  ["INVALID_BACKUP_CODE", true],
])(
  "%s: «Der Code stimmt nicht.» steht am Feld, die Person bleibt hier",
  async (code, mitErsatz) => {
    (mitErsatz ? ersatz : totp).mockResolvedValue({
      data: null,
      error: { status: 401, code },
    } as never);
    await render(<Code />);
    if (mitErsatz) {
      await fireEvent.press(
        screen.getByRole("button", { name: "Ersatzcode verwenden" }),
      );
    }

    await fireEvent.press(screen.getByRole("button", { name: "Anmelden" }));

    expect(await screen.findByText("Der Code stimmt nicht.")).toBeOnTheScreen();
    expect(
      screen.getByLabelText(mitErsatz ? "Ersatzcode" : "Code aus der App"),
    ).toHaveProp("accessibilityHint", "Der Code stimmt nicht.");
    expect(mockReplace).not.toHaveBeenCalled();
  },
);

test.each(["INVALID_TWO_FACTOR_COOKIE", "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"])(
  "%s: zurück zu «Anmelden» mit dem Hinweis «nochmals»",
  async (code) => {
    totp.mockResolvedValue({
      data: null,
      error: { status: 400, code },
    } as never);
    await render(<Code />);

    await fireEvent.press(screen.getByRole("button", { name: "Anmelden" }));

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/anmelden",
      params: { hinweis: "nochmals" },
    });
  },
);

test.each([
  ["ZU_VIELE_ANFRAGEN", "Zu viele Anfragen. Bitte später nochmals versuchen."],
  [
    "STARTPASSWORT_ABGELAUFEN",
    "Das Startpasswort ist abgelaufen. Ein Admin kann ein neues setzen.",
  ],
])("%s steht mit dem Text des Codes über dem Knopf", async (code, text) => {
  totp.mockResolvedValue({
    data: null,
    error: { status: 429, code },
  } as never);
  await render(<Code />);

  await fireEvent.press(screen.getByRole("button", { name: "Anmelden" }));

  expect(await screen.findByText(text)).toBeOnTheScreen();
  expect(mockReplace).not.toHaveBeenCalled();
});

test("ohne Netz: Meldung über dem Knopf", async () => {
  totp.mockRejectedValue(new TypeError("Network request failed"));
  await render(<Code />);

  await fireEvent.press(screen.getByRole("button", { name: "Anmelden" }));

  expect(
    await screen.findByText(
      "Keine Internetverbindung. Bitte später nochmals versuchen.",
    ),
  ).toBeOnTheScreen();
});

test("«Zurück» führt zu «Anmelden»", async () => {
  await render(<Code />);

  await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));

  expect(mockReplace).toHaveBeenCalledWith("/anmelden");
});

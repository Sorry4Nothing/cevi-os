import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Linking, Share } from "react-native";

import ZweiterFaktor from "../app/(tabs)/profil/zweiter-faktor";
import { authClient, queryClient } from "../src/api/client";
import { useIch } from "../src/api/ich";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock("../src/api/client", () => ({
  authClient: { twoFactor: { enable: jest.fn(), verifyTotp: jest.fn() } },
  queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("../src/api/ich", () => ({ useIch: jest.fn() }));

const enable = jest.mocked(authClient.twoFactor.enable);
const verifyTotp = jest.mocked(authClient.twoFactor.verifyTotp);

const SCHLUESSEL = "JBSWY3DPEHPK3PXPJBSWY3DP";
const LINK = `otpauth://totp/Cevi%20OS:anna.muster?secret=${SCHLUESSEL}&issuer=Cevi%20OS&digits=6&period=30`;
const CODES = [
  "aB3dE-fG7hJ",
  "kL9mN-pQ2rS",
  "tU4vW-xY6zA",
  "bC8dF-gH1jK",
  "mN5pQ-rS3tU",
  "vW7xY-zA9bC",
  "dE2fG-hJ4kL",
  "mN6pQ-rS8tU",
  "vW1xY-zA3bC",
  "dE5fG-hJ7kL",
];

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useIch).mockReturnValue({
    data: { benutzername: "anna.muster" },
  } as never);
});

async function bisZumLink() {
  enable.mockResolvedValue({
    data: { method: "totp", totpURI: LINK, backupCodes: CODES },
    error: null,
  } as never);
  await render(<ZweiterFaktor />);
  await fireEvent.changeText(
    screen.getByLabelText("Passwort"),
    "mein-passwort",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
  await screen.findByRole("header", { name: "App für Codes verbinden" });
}

test("Schritt 1: Passwortfeld mit Eingabe-Hinweisen, enable mit dem Passwort, keine Codes", async () => {
  enable.mockResolvedValue({
    data: { method: "totp", totpURI: LINK, backupCodes: CODES },
    error: null,
  } as never);
  await render(<ZweiterFaktor />);

  expect(
    screen.getByRole("header", { name: "Zweiten Faktor einrichten" }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole("header", { name: "Passwort bestätigen" }),
  ).toBeOnTheScreen();
  const feld = screen.getByLabelText("Passwort");
  expect(feld).toHaveProp("autoComplete", "current-password");
  expect(feld).toHaveProp("textContentType", "password");

  await fireEvent.changeText(feld, "mein-passwort");
  await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));

  expect(enable).toHaveBeenCalledWith({ password: "mein-passwort" });
  expect(
    await screen.findByRole("header", { name: "App für Codes verbinden" }),
  ).toBeOnTheScreen();
  expect(screen.queryByText("aB3dE-fG7hJ")).toBeNull();
  expect(screen.queryByRole("header", { name: "Ersatzcodes" })).toBeNull();
});

test("ein falsches Passwort steht am Feld, es geht nicht weiter", async () => {
  enable.mockResolvedValue({
    data: null,
    error: { status: 400, code: "INVALID_PASSWORD" },
  } as never);
  await render(<ZweiterFaktor />);

  await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));

  expect(
    await screen.findByText("Das Passwort stimmt nicht."),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole("header", { name: "App für Codes verbinden" }),
  ).toBeNull();
});

test("Schritt 2: der Schlüssel steht immer da, in Vierergruppen und buchstabiert", async () => {
  await bisZumLink();

  expect(screen.getByText("Schlüssel")).toBeOnTheScreen();
  expect(screen.getByText("JBSW Y3DP EHPK 3PXP JBSW Y3DP")).toBeOnTheScreen();
  expect(
    screen.getByLabelText(
      "Schlüssel: J B S W, Y 3 D P, E H P K, 3 P X P, J B S W, Y 3 D P",
    ),
  ).toBeOnTheScreen();
});

test("«Link öffnen» öffnet den otpauth-Link; ohne passende App steht der Ausweg da", async () => {
  const oeffnen = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  await bisZumLink();

  await fireEvent.press(screen.getByRole("button", { name: "Link öffnen" }));
  expect(oeffnen).toHaveBeenCalledWith(LINK);
  expect(
    screen.queryByText(
      "Keine passende App gefunden. Trage den Schlüssel von Hand ein.",
    ),
  ).toBeNull();

  oeffnen.mockRejectedValue(new Error("Unable to open URL"));
  await fireEvent.press(screen.getByRole("button", { name: "Link öffnen" }));
  expect(
    await screen.findByText(
      "Keine passende App gefunden. Trage den Schlüssel von Hand ein.",
    ),
  ).toBeOnTheScreen();
  // Der Schlüssel bleibt zum Abtippen
  expect(screen.getByText("JBSW Y3DP EHPK 3PXP JBSW Y3DP")).toBeOnTheScreen();
});

test("ein falscher Code steht am Feld und zeigt keine Ersatzcodes", async () => {
  await bisZumLink();
  verifyTotp.mockResolvedValue({
    data: null,
    error: { status: 401, code: "INVALID_CODE" },
  } as never);

  const feld = screen.getByLabelText("Code aus der App");
  expect(feld).toHaveProp("autoComplete", "2fa-app-otp");
  expect(feld).toHaveProp("textContentType", "oneTimeCode");
  expect(feld).toHaveProp("keyboardType", "number-pad");
  await fireEvent.changeText(feld, "000000");
  await fireEvent.press(screen.getByRole("button", { name: "Bestätigen" }));

  expect(await screen.findByText("Der Code stimmt nicht.")).toBeOnTheScreen();
  expect(screen.queryByRole("header", { name: "Ersatzcodes" })).toBeNull();
  expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
});

test("Schritt 3 erst nach dem bestätigten Code: zehn Ersatzcodes, buchstabiert mit «gross», Teilen mit dem festen Text, «Fertig» räumt weg", async () => {
  const teilen = jest.spyOn(Share, "share").mockResolvedValue({
    action: "sharedAction",
    activityType: undefined,
  });
  await bisZumLink();
  verifyTotp.mockResolvedValue({ data: { token: "t" }, error: null } as never);

  await fireEvent.changeText(
    screen.getByLabelText("Code aus der App"),
    "123456",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Bestätigen" }));

  expect(verifyTotp).toHaveBeenCalledWith({ code: "123456" });
  expect(
    await screen.findByRole("header", { name: "Ersatzcodes" }),
  ).toBeOnTheScreen();
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
    queryKey: ["ich"],
  });
  for (const code of CODES) expect(screen.getByText(code)).toBeOnTheScreen();
  expect(
    screen.getByLabelText("a gross B 3 d gross E, f gross G 7 h gross J"),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(
      "Jeder Code gilt einmal. Bewahre sie sicher auf, zum Beispiel im Passwort-Manager. Du siehst sie nur jetzt.",
    ),
  ).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Teilen" }));
  expect(teilen).toHaveBeenCalledWith({
    message: `Ersatzcodes für Cevi OS (anna.muster):\n${CODES.join("\n")}\nJeder Code gilt einmal. Nicht weiterleiten.`,
  });

  await fireEvent.press(screen.getByRole("button", { name: "Fertig" }));
  expect(mockReplace).toHaveBeenCalledWith("/profil");
  // Die Codes sind aus dem Zustand
  for (const code of CODES) expect(screen.queryByText(code)).toBeNull();
});

test("jeder Schritt nimmt den Fokus auf seine Überschrift", async () => {
  // Die Ref zeigt im Test auf die Mock-Komponente von Text, deren Props sich ändern; der Titel wird darum beim Aufruf festgehalten
  const fokus: unknown[] = [];
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mockImplementation((element) =>
      fokus.push(
        (element as unknown as { props: { children: unknown } }).props.children,
      ),
    );
  await bisZumLink();
  expect(fokus).toContain("App für Codes verbinden");

  verifyTotp.mockResolvedValue({ data: { token: "t" }, error: null } as never);
  await fireEvent.changeText(
    screen.getByLabelText("Code aus der App"),
    "123456",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Bestätigen" }));
  await screen.findByRole("header", { name: "Ersatzcodes" });
  expect(fokus).toContain("Ersatzcodes");
});

test("«Zurück» führt zum Profil", async () => {
  await render(<ZweiterFaktor />);

  await act(async () => {
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
  });

  expect(mockReplace).toHaveBeenCalledWith("/profil");
});

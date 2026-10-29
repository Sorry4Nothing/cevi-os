import { fireEvent, render, screen } from "@testing-library/react-native";
import {
  getEnrolledLevelAsync,
  SecurityLevel,
} from "expo-local-authentication";

import Profil from "../app/(tabs)/profil";
import { abmelden, authClient } from "../src/api/client";
import { useIch } from "../src/api/ich";
import { SperreProvider } from "../src/sperre/SperreProvider";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("../src/api/client", () => ({
  abmelden: jest.fn(),
  authClient: { changePassword: jest.fn(), revokeSessions: jest.fn() },
}));
jest.mock("../src/api/ich", () => ({ useIch: jest.fn() }));

const ich = jest.mocked(useIch);
const ueberall = jest.mocked(authClient.revokeSessions);
const speicher = (
  jest.requireMock("expo-secure-store") as { __speicher: Map<string, string> }
).__speicher;

function zeige() {
  return render(
    <SperreProvider anfangsAus={false}>
      <Profil />
    </SperreProvider>,
  );
}

function mitRolle(admin: boolean, rollen: string[]) {
  ich.mockReturnValue({
    data: { ...ich().data, admin, rollen },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  speicher.clear();
  ich.mockReturnValue({
    data: {
      name: "Eltern A",
      benutzername: "eltern.a",
      mussPasswortAendern: false,
      datenschutzGelesenAm: "2026-10-01T00:00:00.000Z",
      admin: false,
      rollen: [],
    },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  } as never);
});

test("zeigt Name und Benutzername aus GET /ich mit den Abschnitten und Knöpfen", async () => {
  await zeige();

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
  await zeige();

  await fireEvent.press(screen.getByRole("button", { name: "Abmelden" }));

  expect(abmelden).toHaveBeenCalledTimes(1);
});

test("«Überall abmelden» beendet alle Sitzungen und meldet dann ab", async () => {
  ueberall.mockResolvedValue({ error: null } as never);
  await zeige();

  await fireEvent.press(
    screen.getByRole("button", { name: "Überall abmelden" }),
  );

  expect(ueberall).toHaveBeenCalledTimes(1);
  expect(abmelden).toHaveBeenCalledTimes(1);
});

test("ohne Netz bleibt die Person angemeldet und sieht eine Meldung", async () => {
  ueberall.mockRejectedValue(new TypeError("Network request failed"));
  await zeige();

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
  await zeige();

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

test("«App-Sperre»: für Eltern ein Schalter, standardmässig an; aus schreibt «aus», an löscht den Schlüssel", async () => {
  await zeige();
  expect(screen.getByRole("header", { name: "App-Sperre" })).toBeOnTheScreen();
  const schalter = screen.getByRole("switch", { name: "App-Sperre" });
  expect(schalter).toBeChecked();

  await fireEvent.press(schalter);
  expect(speicher.get("cevi-os_sperre")).toBe("aus");
  expect(screen.getByRole("switch", { name: "App-Sperre" })).not.toBeChecked();

  await fireEvent.press(screen.getByRole("switch", { name: "App-Sperre" }));
  expect(speicher.has("cevi-os_sperre")).toBe(false);
  expect(screen.getByRole("switch", { name: "App-Sperre" })).toBeChecked();
});

test.each([
  ["Leitende", false, ["leitung"]],
  ["Admins", true, []],
])(
  "«App-Sperre»: für %s kein Schalter, nur der Hinweis",
  async (_name, admin, rollen) => {
    mitRolle(admin, rollen);
    await zeige();

    expect(
      screen.getByText(
        "Für Leitende, SL und Admins ist die App-Sperre immer an.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("switch", { name: "App-Sperre" })).toBeNull();
  },
);

test("«App-Sperre»: ohne Geräte-Code steht die Zeile, dass die Sperre einen braucht", async () => {
  jest.mocked(getEnrolledLevelAsync).mockResolvedValueOnce(SecurityLevel.NONE);
  await zeige();

  expect(
    await screen.findByText(
      "Die App-Sperre wirkt erst, wenn das Gerät mit einem Geräte-Code gesichert ist.",
    ),
  ).toBeOnTheScreen();
});

test("«App-Sperre»: mit Geräte-Code steht die Zeile nicht", async () => {
  await zeige();

  expect(screen.queryByText(/mit einem Geräte-Code/)).toBeNull();
});

test("«Hilfe» öffnet die Hilfe-Seite unter /profil/hilfe", async () => {
  await zeige();

  await fireEvent.press(
    screen.getByRole("button", {
      name: "Hilfe, Vertrauenspersonen und Anlaufstellen",
    }),
  );

  expect(mockPush).toHaveBeenCalledWith("/profil/hilfe");
});

describe("zweiter Faktor", () => {
  const alsAdmin = (zweiterFaktor: boolean) =>
    ich.mockReturnValue({
      data: {
        name: "Anna Muster",
        benutzername: "anna.muster",
        admin: true,
        zweiterFaktor,
      },
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    } as never);

  test("Eltern und Leitende sehen den Abschnitt nicht", async () => {
    await zeige();

    expect(screen.queryByRole("header", { name: "Zweiter Faktor" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Zweiten Faktor einrichten" }),
    ).toBeNull();
  });

  test("Admin ohne Faktor sieht «Zweiten Faktor einrichten» und kommt damit zur Einrichtung", async () => {
    alsAdmin(false);
    await zeige();

    expect(
      screen.getByRole("header", { name: "Zweiter Faktor" }),
    ).toBeOnTheScreen();
    expect(screen.queryByText("Zweiter Faktor eingerichtet")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Zweiten Faktor einrichten" }),
    );
    expect(mockPush).toHaveBeenCalledWith("/profil/zweiter-faktor");
  });

  test("Admin mit Faktor sieht «Zweiter Faktor eingerichtet», aber keinen Knopf", async () => {
    alsAdmin(true);
    await zeige();

    expect(screen.getByText("Zweiter Faktor eingerichtet")).toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: "Zweiten Faktor einrichten" }),
    ).toBeNull();
  });
});

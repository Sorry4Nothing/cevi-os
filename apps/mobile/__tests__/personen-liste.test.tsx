import { fireEvent, render, screen } from "@testing-library/react-native";

import Personen from "../app/(tabs)/verwaltung/personen/index";
import { usePersonen } from "../src/api/personen";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));
jest.mock("../src/api/personen", () => ({ usePersonen: jest.fn() }));

const personen = jest.mocked(usePersonen);

const DATEN = {
  personen: [
    {
      id: "p1",
      name: "Anna Muster",
      benutzername: "anna.muster",
      admin: true,
      deaktiviert: false,
      mussPasswortAendern: false,
      startpasswortGueltigBis: null,
      rollen: [],
      elternteilVon: [],
    },
    {
      id: "p2",
      name: "Beat Beispiel",
      benutzername: "beat.beispiel",
      admin: false,
      deaktiviert: true,
      mussPasswortAendern: true,
      // Mittags UTC: derselbe Kalendertag in jeder Zeitzone
      startpasswortGueltigBis: "2026-11-03T12:00:00.000Z",
      rollen: [],
      elternteilVon: [],
    },
  ],
  stufen: [],
  kinder: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  personen.mockReturnValue({
    data: DATEN,
    isPending: false,
    refetch: jest.fn(),
  } as never);
});

test("zeigt pro Person den Status «angemeldet» oder «Startpasswort offen bis …»", async () => {
  await render(<Personen />);

  expect(screen.getByRole("header", { name: "Personen" })).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Anna Muster, angemeldet" }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole("button", {
      name: "Beat Beispiel, deaktiviert, Startpasswort offen bis 3.11.2026",
    }),
  ).toBeOnTheScreen();
});

test("eine Zeile öffnet das Detail, «Person anlegen» den neuen Bildschirm, «Zurück» geht zurück", async () => {
  await render(<Personen />);

  await fireEvent.press(
    screen.getByRole("button", { name: "Anna Muster, angemeldet" }),
  );
  expect(mockPush).toHaveBeenCalledWith("/verwaltung/personen/p1");

  await fireEvent.press(screen.getByRole("button", { name: "Person anlegen" }));
  expect(mockPush).toHaveBeenCalledWith("/verwaltung/personen/neu");

  await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

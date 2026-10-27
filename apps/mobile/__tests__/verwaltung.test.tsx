import { fireEvent, render, screen } from "@testing-library/react-native";

import Verwaltung from "../app/(tabs)/verwaltung/index";
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
      deaktiviert: false,
      mussPasswortAendern: false,
      startpasswortGueltigBis: null,
      rollen: [{ stufeId: "s1", typ: "stufenleitung" as const }],
      elternteilVon: [],
    },
  ],
  stufen: [{ id: "s1", name: "Stufe A", kuerzel: "A" }],
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

test("zeigt die Warnungen in einer Karte und die Zeile «Personen»", async () => {
  await render(<Verwaltung />);

  expect(screen.getByRole("header", { name: "Verwaltung" })).toBeOnTheScreen();
  expect(
    screen.getByText(
      "Weniger als zwei Admins: Bitte einen zweiten Admin bestimmen.",
    ),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(
      "Stufe A: weniger als zwei Personen in der Stufenleitung.",
    ),
  ).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Personen" }));
  expect(mockPush).toHaveBeenCalledWith("/verwaltung/personen");
});

test("ohne Warnungen gibt es keine Karte mit Meldungen", async () => {
  personen.mockReturnValue({
    data: {
      ...DATEN,
      personen: [
        ...DATEN.personen.map((person) => ({ ...person, admin: true })),
        {
          ...DATEN.personen[1],
          id: "p3",
          rollen: [{ stufeId: "s1", typ: "stufenleitung" as const }],
        },
      ],
    },
    isPending: false,
    refetch: jest.fn(),
  } as never);
  await render(<Verwaltung />);

  expect(screen.queryByText(/Weniger als zwei Admins/)).toBeNull();
  expect(screen.queryByText(/Stufenleitung\./)).toBeNull();
});

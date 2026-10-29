import { fireEvent, render, screen } from "@testing-library/react-native";

import Verwaltung from "../app/(tabs)/verwaltung/index";
import { useIch } from "../src/api/ich";
import { usePersonen } from "../src/api/personen";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));
jest.mock("../src/api/ich", () => ({ useIch: jest.fn() }));
jest.mock("../src/api/personen", () => ({ usePersonen: jest.fn() }));

const personen = jest.mocked(usePersonen);
const ich = jest.mocked(useIch);

const DATEN = {
  personen: [
    {
      id: "p1",
      name: "Anna Muster",
      benutzername: "anna.muster",
      admin: true,
      zweiterFaktor: true,
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
      zweiterFaktor: false,
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
  ich.mockReturnValue({
    data: { admin: true, zweiterFaktor: true },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  } as never);
  personen.mockReturnValue({
    data: DATEN,
    isPending: false,
    refetch: jest.fn(),
  } as never);
});

test("die Zeilen «Kinder» und «Stufen» folgen auf «Personen» und öffnen ihre Listen", async () => {
  await render(<Verwaltung />);

  expect(
    screen
      .getAllByRole("button")
      .map((knopf) => knopf.props.accessibilityLabel),
  ).toEqual([
    "Personen",
    "Kinder",
    "Stufen",
    "Vertrauenspersonen",
    "Meldungen",
  ]);
  await fireEvent.press(screen.getByRole("button", { name: "Kinder" }));
  expect(mockPush).toHaveBeenLastCalledWith("/verwaltung/kinder");
  await fireEvent.press(screen.getByRole("button", { name: "Stufen" }));
  expect(mockPush).toHaveBeenLastCalledWith("/verwaltung/stufen");
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

  await fireEvent.press(screen.getByRole("button", { name: "Meldungen" }));
  expect(mockPush).toHaveBeenCalledWith("/verwaltung/meldungen");
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

test("Admin ohne zweiten Faktor: nur die Sperr-Karte mit dem Weg zur Einrichtung, keine Anfrage der Personen", async () => {
  ich.mockReturnValue({
    data: { admin: true, zweiterFaktor: false },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  } as never);
  personen.mockReturnValue({
    data: undefined,
    isPending: true,
    refetch: jest.fn(),
  } as never);
  await render(<Verwaltung />);

  expect(screen.getByRole("header", { name: "Verwaltung" })).toBeOnTheScreen();
  expect(
    screen.getByText(
      "Für die Verwaltung braucht es zuerst einen zweiten Faktor.",
    ),
  ).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Personen" })).toBeNull();
  // Die Abfrage ruht, bis der Faktor da ist
  expect(personen).toHaveBeenLastCalledWith(false);
  await fireEvent.press(
    screen.getByRole("button", { name: "Zweiten Faktor einrichten" }),
  );
  expect(mockPush).toHaveBeenLastCalledWith("/profil/zweiter-faktor");
});

test("Admin mit zweitem Faktor: die Abfrage der Personen läuft, keine Sperr-Karte", async () => {
  await render(<Verwaltung />);

  expect(personen).toHaveBeenLastCalledWith(true);
  expect(
    screen.queryByRole("button", { name: "Zweiten Faktor einrichten" }),
  ).toBeNull();
});

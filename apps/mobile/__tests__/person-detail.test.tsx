import { fireEvent, render, screen } from "@testing-library/react-native";
import { Alert } from "react-native";

import PersonDetail from "../app/(tabs)/verwaltung/personen/[id]";
import { ApiFehler } from "../src/api/client";
import { useIch } from "../src/api/ich";
import {
  useNeuesStartpasswort,
  usePersonAendern,
  usePersonAktivieren,
  usePersonDeaktivieren,
  usePersonen,
  usePersonLoeschen,
} from "../src/api/personen";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockParams = { id: "p2" };
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({ id: mockParams.id }),
}));
jest.mock("../src/api/client", () => ({
  ApiFehler: class ApiFehler extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("../src/api/ich", () => ({ useIch: jest.fn() }));
jest.mock("../src/api/personen", () => ({
  usePersonen: jest.fn(),
  usePersonAendern: jest.fn(),
  useNeuesStartpasswort: jest.fn(),
  usePersonDeaktivieren: jest.fn(),
  usePersonAktivieren: jest.fn(),
  usePersonLoeschen: jest.fn(),
}));

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
      mussPasswortAendern: true,
      startpasswortGueltigBis: "2026-11-03T12:00:00.000Z",
      rollen: [{ stufeId: "s1", typ: "leitung" as const }],
      elternteilVon: [],
    },
  ],
  stufen: [{ id: "s1", name: "Stufe A", kuerzel: "A" }],
  kinder: [],
};

const mutation = () => ({
  mutate: jest.fn(),
  reset: jest.fn(),
  data: undefined,
  error: null,
  isPending: false,
});

type Attrappe = ReturnType<typeof mutation>;
let speichern: Attrappe;
let startpasswort: Attrappe;
let deaktivieren: Attrappe;
let aktivieren: Attrappe;
let loeschen: Attrappe;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.id = "p2";
  jest.mocked(useIch).mockReturnValue({ data: { id: "p1" } } as never);
  jest.mocked(usePersonen).mockReturnValue({
    data: DATEN,
    isPending: false,
    refetch: jest.fn(),
  } as never);
  speichern = mutation();
  startpasswort = mutation();
  deaktivieren = mutation();
  aktivieren = mutation();
  loeschen = mutation();
  jest.mocked(usePersonAendern).mockReturnValue(speichern as never);
  jest.mocked(useNeuesStartpasswort).mockReturnValue(startpasswort as never);
  jest.mocked(usePersonDeaktivieren).mockReturnValue(deaktivieren as never);
  jest.mocked(usePersonAktivieren).mockReturnValue(aktivieren as never);
  jest.mocked(usePersonLoeschen).mockReturnValue(loeschen as never);
});

test("zeigt Status, Namensfeld, Rollen und alle Knöpfe; «Speichern» schickt die Änderungen", async () => {
  await render(<PersonDetail />);

  expect(
    screen.getByRole("header", { name: "Beat Beispiel" }),
  ).toBeOnTheScreen();
  expect(
    screen.getByText("Startpasswort offen bis 3.11.2026"),
  ).toBeOnTheScreen();

  await fireEvent.changeText(screen.getByLabelText("Name"), "Beat Neu");
  await fireEvent.press(screen.getByRole("button", { name: "Ja, Admin" }));
  await fireEvent.press(screen.getByRole("button", { name: "Keine, Stufe A" }));
  await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));

  expect(speichern.mutate).toHaveBeenCalledWith(
    { id: "p2", name: "Beat Neu", admin: true, rollen: [], elternteilVon: [] },
    expect.anything(),
  );
});

test("auf dem eigenen Eintrag fehlen Startpasswort, Deaktivieren und Löschen", async () => {
  mockParams.id = "p1";
  await render(<PersonDetail />);

  expect(screen.getByRole("button", { name: "Speichern" })).toBeOnTheScreen();
  for (const name of ["Neues Startpasswort", "Deaktivieren", "Löschen"]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }
});

test("«Löschen» läuft nur über den Dialog mit «Abbrechen» und «Löschen»", async () => {
  const dialog = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await render(<PersonDetail />);

  await fireEvent.press(screen.getByRole("button", { name: "Löschen" }));
  expect(loeschen.mutate).not.toHaveBeenCalled();
  expect(dialog).toHaveBeenCalledTimes(1);

  const [, , knoepfe] = dialog.mock.calls[0];
  expect(knoepfe?.map((knopf) => knopf.text)).toEqual(["Abbrechen", "Löschen"]);
  knoepfe?.[1].onPress?.();
  expect(loeschen.mutate).toHaveBeenCalledWith("p2", expect.anything());
});

test("das neue Startpasswort erscheint aus der Mutation, «Fertig» räumt es weg", async () => {
  startpasswort.data = {
    startpasswort: "K7MP-Q4XR-T9WD",
  } as never;
  await render(<PersonDetail />);

  expect(
    screen.getByLabelText("Startpasswort: K 7 M P, Q 4 X R, T 9 W D"),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Fertig" }));
  expect(startpasswort.reset).toHaveBeenCalledTimes(1);
});

test("ein Fehler der Mutation steht über dem auslösenden Knopf", async () => {
  speichern.error = new ApiFehler(
    409,
    "LETZTER_ADMIN",
    "Der letzte Admin lässt sich nicht entfernen.",
  ) as never;
  await render(<PersonDetail />);

  expect(
    screen.getByText("Der letzte Admin lässt sich nicht entfernen."),
  ).toBeOnTheScreen();
});

test("eine deaktivierte Person zeigt «Aktivieren» statt «Deaktivieren»", async () => {
  jest.mocked(usePersonen).mockReturnValue({
    data: {
      ...DATEN,
      personen: DATEN.personen.map((person) =>
        person.id === "p2" ? { ...person, deaktiviert: true } : person,
      ),
    },
    isPending: false,
    refetch: jest.fn(),
  } as never);
  await render(<PersonDetail />);

  await fireEvent.press(screen.getByRole("button", { name: "Aktivieren" }));
  expect(aktivieren.mutate).toHaveBeenCalledWith("p2", expect.anything());
  expect(screen.queryByRole("button", { name: "Deaktivieren" })).toBeNull();
});

test("gibt es die Person nicht mehr, zeigt der Bildschirm den Leer-Zustand", async () => {
  mockParams.id = "p9";
  await render(<PersonDetail />);

  expect(
    screen.getByText("Diese Person gibt es nicht mehr."),
  ).toBeOnTheScreen();
});

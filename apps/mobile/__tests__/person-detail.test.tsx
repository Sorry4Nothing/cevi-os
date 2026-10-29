import { act, fireEvent, render, screen } from "@testing-library/react-native";
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
  usePersonZweitenFaktorZuruecksetzen,
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
  usePersonZweitenFaktorZuruecksetzen: jest.fn(),
}));

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
let zuruecksetzen: Attrappe;

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
  zuruecksetzen = mutation();
  jest.mocked(usePersonAendern).mockReturnValue(speichern as never);
  jest.mocked(useNeuesStartpasswort).mockReturnValue(startpasswort as never);
  jest.mocked(usePersonDeaktivieren).mockReturnValue(deaktivieren as never);
  jest.mocked(usePersonAktivieren).mockReturnValue(aktivieren as never);
  jest.mocked(usePersonLoeschen).mockReturnValue(loeschen as never);
  jest
    .mocked(usePersonZweitenFaktorZuruecksetzen)
    .mockReturnValue(zuruecksetzen as never);
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

describe("zweiter Faktor", () => {
  const mitFaktor = (ids: string[]) =>
    jest.mocked(usePersonen).mockReturnValue({
      data: {
        ...DATEN,
        personen: DATEN.personen.map((person) => ({
          ...person,
          zweiterFaktor: ids.includes(person.id),
        })),
      },
      isPending: false,
      refetch: jest.fn(),
    } as never);

  test("ohne Faktor fehlen Hinweis und Knopf", async () => {
    mitFaktor([]);
    await render(<PersonDetail />);

    expect(screen.queryByText("Zweiter Faktor eingerichtet")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Zweiten Faktor zurücksetzen" }),
    ).toBeNull();
  });

  test("auf dem eigenen Eintrag steht der Hinweis, aber kein Knopf", async () => {
    mitFaktor(["p1"]);
    mockParams.id = "p1";
    await render(<PersonDetail />);

    expect(screen.getByText("Zweiter Faktor eingerichtet")).toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: "Zweiten Faktor zurücksetzen" }),
    ).toBeNull();
  });

  test("bei einer anderen Person fragt der Dialog, erst «Zurücksetzen» sendet; der Erfolg bleibt stehen", async () => {
    mitFaktor(["p2"]);
    const dialog = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<PersonDetail />);

    expect(screen.getByText("Zweiter Faktor eingerichtet")).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole("button", { name: "Zweiten Faktor zurücksetzen" }),
    );
    expect(zuruecksetzen.mutate).not.toHaveBeenCalled();
    const [titel, nachricht, knoepfe] = dialog.mock.calls[0];
    expect(titel).toBe("Zweiten Faktor zurücksetzen?");
    expect(nachricht).toBe(
      "Die Person meldet sich danach ohne Code an und richtet den zweiten Faktor neu ein. Ist ihr Gerät verloren, zuerst ein neues Startpasswort setzen: Auf dem Gerät kann das Passwort gespeichert sein.",
    );
    expect(knoepfe?.map((knopf) => knopf.text)).toEqual([
      "Abbrechen",
      "Zurücksetzen",
    ]);

    await act(async () => knoepfe?.[1].onPress?.());
    expect(zuruecksetzen.mutate).toHaveBeenCalledWith("p2", expect.anything());
    const optionen = zuruecksetzen.mutate.mock.calls[0][1] as {
      onSuccess: () => void;
    };
    await act(async () => optionen.onSuccess());
    expect(
      screen.getByText("Der zweite Faktor ist zurückgesetzt."),
    ).toBeOnTheScreen();
  });

  test("ein Fehler steht über dem Knopf, Wort für Wort vom Server", async () => {
    mitFaktor(["p2"]);
    zuruecksetzen.error = new ApiFehler(
      409,
      "KEIN_ZWEITER_FAKTOR",
      "Diese Person hat keinen zweiten Faktor.",
    ) as never;
    await render(<PersonDetail />);

    expect(
      screen.getByText("Diese Person hat keinen zweiten Faktor."),
    ).toBeOnTheScreen();
  });
});

import { fireEvent, render, screen } from "@testing-library/react-native";
import { Share } from "react-native";

import PersonAnlegen from "../app/(tabs)/verwaltung/personen/neu";
import { ApiFehler } from "../src/api/client";
import { usePersonAnlegen, usePersonen } from "../src/api/personen";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
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
}));
jest.mock("../src/api/personen", () => ({
  usePersonen: jest.fn(),
  usePersonAnlegen: jest.fn(),
}));

const personen = jest.mocked(usePersonen);
const anlegen = jest.mocked(usePersonAnlegen);

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
  ],
  stufen: [{ id: "s1", name: "Stufe A", kuerzel: "A" }],
  kinder: [
    {
      id: "k1",
      vorname: "Kind",
      nachname: "A",
      stufeId: "s1",
      inaktivSeit: null,
    },
    {
      id: "k2",
      vorname: "Kind",
      nachname: "B",
      stufeId: "s1",
      inaktivSeit: "2026-01-01T12:00:00.000Z",
    },
  ],
};

const mutation = () => ({
  mutate: jest.fn(),
  reset: jest.fn(),
  data: undefined,
  error: null,
  isPending: false,
});

beforeEach(() => {
  jest.clearAllMocks();
  personen.mockReturnValue({
    data: DATEN,
    isPending: false,
    refetch: jest.fn(),
  } as never);
  anlegen.mockReturnValue(mutation() as never);
});

test("der Vorschlag folgt den Namen, bis jemand das Feld bearbeitet; Vergebenes bekommt eine Zahl", async () => {
  await render(<PersonAnlegen />);

  await fireEvent.changeText(screen.getByLabelText("Vorname"), "Rahel");
  await fireEvent.changeText(screen.getByLabelText("Nachname"), "Müller");
  expect(screen.getByLabelText("Benutzername")).toHaveDisplayValue(
    "rahel.mueller",
  );

  // «anna.muster» steht in der geladenen Liste
  await fireEvent.changeText(screen.getByLabelText("Vorname"), "Anna");
  await fireEvent.changeText(screen.getByLabelText("Nachname"), "Muster");
  expect(screen.getByLabelText("Benutzername")).toHaveDisplayValue(
    "anna.muster2",
  );

  await fireEvent.changeText(screen.getByLabelText("Benutzername"), "eigener");
  await fireEvent.changeText(screen.getByLabelText("Vorname"), "Beat");
  expect(screen.getByLabelText("Benutzername")).toHaveDisplayValue("eigener");
});

test("ein Benutzername gegen die Regel zeigt den Fehler am Feld und sendet nicht", async () => {
  const attrappe = mutation();
  anlegen.mockReturnValue(attrappe as never);
  await render(<PersonAnlegen />);

  await fireEvent.changeText(screen.getByLabelText("Benutzername"), "ab");
  await fireEvent.press(screen.getByRole("button", { name: "Person anlegen" }));

  expect(
    await screen.findByText(
      "Erlaubt sind 3 bis 64 Zeichen: Buchstaben ohne Umlaute, Ziffern, Punkt, Bindestrich und Unterstrich.",
    ),
  ).toBeOnTheScreen();
  expect(attrappe.mutate).not.toHaveBeenCalled();
});

test("sendet Namen, Benutzername und Rollen aus den Auswahlen", async () => {
  const attrappe = mutation();
  anlegen.mockReturnValue(attrappe as never);
  await render(<PersonAnlegen />);

  await fireEvent.changeText(screen.getByLabelText("Vorname"), "Rahel");
  await fireEvent.changeText(screen.getByLabelText("Nachname"), "Müller");
  await fireEvent.press(screen.getByRole("button", { name: "Ja, Admin" }));
  await fireEvent.press(
    screen.getByRole("button", { name: "Stufenleitung, Stufe A" }),
  );
  await fireEvent.press(
    screen.getByRole("button", { name: "Ja, Elternteil von Kind A" }),
  );
  // Inaktive Kinder stehen mit Zusatz zur Wahl
  expect(
    screen.getByRole("button", { name: "Ja, Elternteil von Kind B, inaktiv" }),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Person anlegen" }));

  expect(attrappe.mutate).toHaveBeenCalledWith(
    {
      vorname: "Rahel",
      nachname: "Müller",
      benutzername: "rahel.mueller",
      admin: true,
      rollen: [{ stufeId: "s1", typ: "stufenleitung" }],
      elternteilVon: ["k1"],
    },
    expect.anything(),
  );
});

test("BENUTZERNAME_VERGEBEN steht am Feld", async () => {
  const attrappe = mutation();
  attrappe.mutate = jest.fn(
    (_body, optionen?: { onError?: (f: unknown) => void }) =>
      optionen?.onError?.(
        new ApiFehler(
          409,
          "BENUTZERNAME_VERGEBEN",
          "Dieser Benutzername ist schon vergeben.",
        ),
      ),
  ) as never;
  anlegen.mockReturnValue(attrappe as never);
  await render(<PersonAnlegen />);

  await fireEvent.changeText(screen.getByLabelText("Vorname"), "Anna");
  await fireEvent.changeText(screen.getByLabelText("Nachname"), "Muster");
  await fireEvent.press(screen.getByRole("button", { name: "Person anlegen" }));

  expect(
    await screen.findByText("Dieser Benutzername ist schon vergeben."),
  ).toBeOnTheScreen();
});

test("nach dem Anlegen erscheint das Startpasswort genau einmal, «Teilen» schickt die drei Zeilen, «Fertig» geht zurück", async () => {
  const teilen = jest
    .spyOn(Share, "share")
    .mockResolvedValue({ action: "sharedAction" } as never);
  anlegen.mockReturnValue({
    ...mutation(),
    data: {
      id: "p9",
      benutzername: "vreni.muster",
      startpasswort: "K7MP-Q4XR-T9WD",
    },
  } as never);
  await render(<PersonAnlegen />);

  // Buchstabiert für Screenreader, kein Bedienelement
  expect(
    screen.getByLabelText("Startpasswort: K 7 M P, Q 4 X R, T 9 W D"),
  ).toBeOnTheScreen();
  expect(screen.queryByLabelText("Benutzername")).toBeNull();

  await fireEvent.press(screen.getByRole("button", { name: "Teilen" }));
  expect(teilen).toHaveBeenCalledWith({
    message:
      "Benutzername: vreni.muster\nStartpasswort: K7MP-Q4XR-T9WD\nNicht weiterleiten. Gilt 7 Tage und nur für die erste Anmeldung.",
  });

  await fireEvent.press(screen.getByRole("button", { name: "Fertig" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

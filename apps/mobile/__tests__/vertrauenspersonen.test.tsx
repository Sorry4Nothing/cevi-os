import { fireEvent, render, screen } from "@testing-library/react-native";

import Vertrauenspersonen from "../app/(tabs)/verwaltung/vertrauenspersonen";
import { ApiFehler } from "../src/api/client";
import { useHilfe, useVertrauenspersonenSpeichern } from "../src/api/hilfe";

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn() }),
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
jest.mock("../src/api/hilfe", () => ({
  useHilfe: jest.fn(),
  useVertrauenspersonenSpeichern: jest.fn(),
}));

const hilfe = jest.mocked(useHilfe);
const speichern = jest.mocked(useVertrauenspersonenSpeichern);

const mutation = (extra: object = {}) => ({
  mutate: jest.fn(),
  error: null,
  isPending: false,
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  hilfe.mockReturnValue({
    data: { vertrauenspersonen: "Platzhalter alt" },
    isPending: false,
    refetch: jest.fn(),
  } as never);
  speichern.mockReturnValue(mutation() as never);
});

test("das Feld zeigt den gespeicherten Text und ist beschriftet", async () => {
  await render(<Vertrauenspersonen />);

  expect(
    screen.getByRole("header", { name: "Vertrauenspersonen" }),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText("Text für die Hilfe-Seite")).toHaveDisplayValue(
    "Platzhalter alt",
  );
  expect(screen.getByRole("button", { name: "Speichern" })).toBeOnTheScreen();
});

test("«Speichern» sendet den geänderten Text und meldet «Gespeichert.»", async () => {
  const attrappe = mutation();
  attrappe.mutate.mockImplementation((_text, optionen) => optionen.onSuccess());
  speichern.mockReturnValue(attrappe as never);
  await render(<Vertrauenspersonen />);

  await fireEvent.changeText(
    screen.getByLabelText("Text für die Hilfe-Seite"),
    "Platzhalter neu",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));

  expect(attrappe.mutate).toHaveBeenCalledWith(
    "Platzhalter neu",
    expect.anything(),
  );
  expect(await screen.findByText("Gespeichert.")).toBeOnTheScreen();
});

test("ohne Netz steht die Netzmeldung über dem Knopf", async () => {
  speichern.mockReturnValue(mutation({ error: new TypeError("net") }) as never);
  await render(<Vertrauenspersonen />);

  expect(
    screen.getByText(
      "Keine Internetverbindung. Bitte später nochmals versuchen.",
    ),
  ).toBeOnTheScreen();
});

test("ein Serverfehler zeigt den deutschen Text", async () => {
  speichern.mockReturnValue(
    mutation({
      error: new ApiFehler(500, "INTERNER_FEHLER", "x"),
    }) as never,
  );
  await render(<Vertrauenspersonen />);

  expect(
    screen.getByText(
      "Das hat nicht geklappt. Bitte später nochmals versuchen.",
    ),
  ).toBeOnTheScreen();
});

test("beim Speichern ist der Knopf gesperrt", async () => {
  speichern.mockReturnValue(mutation({ isPending: true }) as never);
  await render(<Vertrauenspersonen />);

  expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
});

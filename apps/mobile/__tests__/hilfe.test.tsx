import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

import Hilfe from "../app/(tabs)/profil/hilfe";
import { useHilfe } from "../src/api/hilfe";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack }),
}));
jest.mock("../src/api/hilfe", () => ({ useHilfe: jest.fn() }));

const hilfe = jest.mocked(useHilfe);
const antwort = (zustand: object) =>
  hilfe.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
    refetch: jest.fn(),
    ...zustand,
  } as never);

beforeEach(() => jest.clearAllMocks());

test("zeigt den Text der Abteilung und die festen Anlaufstellen unter Überschriften", async () => {
  antwort({ data: { vertrauenspersonen: "Platzhalter: Funktion, Telefon" } });
  await render(<Hilfe />);

  expect(screen.getByRole("header", { name: "Hilfe" })).toBeOnTheScreen();
  expect(
    screen.getByRole("header", { name: "Vertrauenspersonen der Abteilung" }),
  ).toBeOnTheScreen();
  expect(screen.getByText("Platzhalter: Funktion, Telefon")).toBeOnTheScreen();
  expect(
    screen.getByRole("header", { name: "Weitere Anlaufstellen" }),
  ).toBeOnTheScreen();
  expect(
    screen.getByText("Elternberatung von Pro Juventute"),
  ).toBeOnTheScreen();
  expect(screen.getByText("Krisennummer von Cevi Schweiz")).toBeOnTheScreen();
  expect(screen.getByText("Swiss Sport Integrity")).toBeOnTheScreen();
});

test("«147 anrufen» öffnet die Telefon-App mit tel:147", async () => {
  antwort({ data: { vertrauenspersonen: null } });
  await render(<Hilfe />);

  await fireEvent.press(screen.getByRole("button", { name: "147 anrufen" }));

  expect(Linking.openURL).toHaveBeenCalledWith("tel:147");
});

test("Anlaufstellen ohne geprüfte Nummer haben keinen Anrufknopf und sagen es", async () => {
  antwort({ data: { vertrauenspersonen: null } });
  await render(<Hilfe />);

  expect(screen.getAllByRole("button", { name: /anrufen$/ })).toHaveLength(1);
  expect(
    screen.getAllByText("Die Nummer wird geprüft und hier ergänzt."),
  ).toHaveLength(2);
});

test("ohne Eintrag sagt die Seite es", async () => {
  antwort({ data: { vertrauenspersonen: null } });
  await render(<Hilfe />);

  expect(
    screen.getByText(
      "Die Abteilung hat noch keine Vertrauenspersonen eingetragen.",
    ),
  ).toBeOnTheScreen();
});

test("ohne Netz bleiben die Anlaufstellen stehen, der Text lässt sich neu laden", async () => {
  const neuLaden = jest.fn();
  antwort({ isError: true, refetch: neuLaden });
  await render(<Hilfe />);

  expect(
    screen.getByText("Der Text liess sich nicht laden."),
  ).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "147 anrufen" })).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", { name: "Nochmals versuchen" }),
  );
  expect(neuLaden).toHaveBeenCalledTimes(1);
});

test("beim Laden steht «Wird geladen …», «Zurück» geht zurück", async () => {
  antwort({ isPending: true });
  await render(<Hilfe />);

  expect(screen.getByText("Wird geladen …")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

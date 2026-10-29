import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import StufeDetail from "../app/(tabs)/verwaltung/stufen/[id]";
import Stufen from "../app/(tabs)/verwaltung/stufen/index";
import StufeAnlegen from "../app/(tabs)/verwaltung/stufen/neu";
import { ApiFehler, queryClient } from "../src/api/client";
import { useStufeAendern, useStufeAnlegen, useStufen } from "../src/api/stufen";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockParams = { id: "s1" };
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
jest.mock("../src/api/stufen", () => ({
  useStufen: jest.fn(),
  useStufeAnlegen: jest.fn(),
  useStufeAendern: jest.fn(),
}));

const DATEN = {
  stufen: [
    { id: "s1", name: "Biber", kuerzel: "Bi", reihenfolge: 1 },
    { id: "s2", name: "Wolf", kuerzel: "Wo", reihenfolge: 4 },
  ],
};

const mutation = () => ({
  mutate: jest.fn(),
  reset: jest.fn(),
  data: undefined,
  error: null,
  isPending: false,
});
type Attrappe = ReturnType<typeof mutation>;
let anlegen: Attrappe;
let aendern: Attrappe;

const stufenAntwort = (data: unknown, isPending = false) =>
  jest.mocked(useStufen).mockReturnValue({
    data,
    isPending,
    refetch: jest.fn(),
  } as never);

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.id = "s1";
  stufenAntwort(DATEN);
  anlegen = mutation();
  aendern = mutation();
  jest.mocked(useStufeAnlegen).mockReturnValue(anlegen as never);
  jest.mocked(useStufeAendern).mockReturnValue(aendern as never);
});

describe("Liste", () => {
  test("zeigt je Stufe Name und Kürzel; eine Zeile öffnet die Stufe, der Knopf die Neuanlage", async () => {
    await render(<Stufen />);

    expect(screen.getByRole("header", { name: "Stufen" })).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole("button", { name: "Wolf, Kürzel Wo" }),
    );
    expect(mockPush).toHaveBeenCalledWith("/verwaltung/stufen/s2");
    await fireEvent.press(
      screen.getByRole("button", { name: "Stufe anlegen" }),
    );
    expect(mockPush).toHaveBeenCalledWith("/verwaltung/stufen/neu");
  });

  test("ohne Stufen steht der Hinweis neben dem Knopf «Stufe anlegen»", async () => {
    stufenAntwort({ stufen: [] });
    await render(<Stufen />);

    expect(screen.getByText("Noch keine Stufen.")).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Stufe anlegen" }),
    ).toBeOnTheScreen();
  });

  test("«Zurück» geht eine Ebene zurück", async () => {
    await render(<Stufen />);
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe("Neu", () => {
  test("die Reihenfolge ist mit der höchsten plus 1 vorbelegt; «Stufe anlegen» schickt getrimmte Werte", async () => {
    await render(<StufeAnlegen />);

    expect(screen.getByLabelText("Reihenfolge")).toHaveProp("value", "5");
    expect(screen.getByLabelText("Reihenfolge")).toHaveProp(
      "keyboardType",
      "number-pad",
    );
    await fireEvent.changeText(screen.getByLabelText("Name"), " Pfadi ");
    await fireEvent.changeText(screen.getByLabelText("Kürzel"), " Pf ");
    await fireEvent.press(
      screen.getByRole("button", { name: "Stufe anlegen" }),
    );

    expect(anlegen.mutate).toHaveBeenCalledWith(
      { name: "Pfadi", kuerzel: "Pf", reihenfolge: 5 },
      expect.anything(),
    );
    anlegen.mutate.mock.calls[0][1].onSuccess();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  test("ohne Stufen beginnt die Reihenfolge bei 1", async () => {
    stufenAntwort({ stufen: [] });
    await render(<StufeAnlegen />);
    expect(screen.getByLabelText("Reihenfolge")).toHaveProp("value", "1");
  });

  test("leere Felder und eine Reihenfolge ausser 1 bis 999 stehen beim Feld und senden nichts", async () => {
    await render(<StufeAnlegen />);
    await fireEvent.changeText(screen.getByLabelText("Reihenfolge"), "1000");
    await fireEvent.press(
      screen.getByRole("button", { name: "Stufe anlegen" }),
    );

    expect(anlegen.mutate).not.toHaveBeenCalled();
    expect(
      screen.getByText("Bitte einen Namen mit höchstens 100 Zeichen eingeben."),
    ).toBeOnTheScreen();
    expect(
      screen.getByText("Bitte ein Kürzel mit höchstens 20 Zeichen eingeben."),
    ).toBeOnTheScreen();
    expect(
      screen.getByText("Bitte eine Zahl von 1 bis 999 eingeben."),
    ).toBeOnTheScreen();
    for (const wert of ["0", "", "12a", "1.5"]) {
      await fireEvent.changeText(screen.getByLabelText("Reihenfolge"), wert);
      await fireEvent.press(
        screen.getByRole("button", { name: "Stufe anlegen" }),
      );
    }
    expect(anlegen.mutate).not.toHaveBeenCalled();
  });

  test("ein Fehler der Mutation steht über dem Knopf und nimmt den Fokus", async () => {
    anlegen.error = new ApiFehler(500, "INTERNER_FEHLER", "x") as never;
    await render(<StufeAnlegen />);

    expect(
      screen.getByText(
        "Das hat nicht geklappt. Bitte später nochmals versuchen.",
      ),
    ).toBeOnTheScreen();
    const fokussiert = jest
      .mocked(AccessibilityInfo.sendAccessibilityEvent)
      .mock.calls.filter(([, art]) => art === "focus")
      .map(
        ([element]) =>
          (element as unknown as { props: { children?: unknown } }).props
            .children,
      );
    expect(fokussiert).toContain(
      "Das hat nicht geklappt. Bitte später nochmals versuchen.",
    );
  });
});

describe("Detail", () => {
  test("zeigt die Felder der Stufe, ohne Löschen; «Speichern» schickt alle drei", async () => {
    await render(<StufeDetail />);

    expect(screen.getByRole("header", { name: "Biber" })).toBeOnTheScreen();
    expect(screen.getByLabelText("Name")).toHaveProp("value", "Biber");
    expect(screen.getByLabelText("Kürzel")).toHaveProp("value", "Bi");
    expect(screen.getByLabelText("Reihenfolge")).toHaveProp("value", "1");
    expect(screen.queryByRole("button", { name: "Löschen" })).toBeNull();

    await fireEvent.changeText(screen.getByLabelText("Name"), "Biberli");
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    expect(aendern.mutate).toHaveBeenCalledWith(
      { id: "s1", name: "Biberli", kuerzel: "Bi", reihenfolge: 1 },
      expect.anything(),
    );
  });

  test("der Erfolg bleibt als Text stehen", async () => {
    await render(<StufeDetail />);
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await act(async () => aendern.mutate.mock.calls[0][1].onSuccess());
    await screen.findByText("Gespeichert.");
  });

  test("404 lädt neu und geht zurück; ein anderer Fehler nicht", async () => {
    await render(<StufeDetail />);
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    const { onError } = aendern.mutate.mock.calls[0][1];

    onError(new ApiFehler(400, "UNGUELTIGE_EINGABE", "x"));
    expect(mockBack).not.toHaveBeenCalled();
    onError(new ApiFehler(404, "NICHT_GEFUNDEN", "x"));
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  test("ungültige Werte stehen beim Feld und senden nichts", async () => {
    await render(<StufeDetail />);
    await fireEvent.changeText(screen.getByLabelText("Name"), "  ");
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));

    expect(aendern.mutate).not.toHaveBeenCalled();
    expect(
      screen.getByText("Bitte einen Namen mit höchstens 100 Zeichen eingeben."),
    ).toBeOnTheScreen();
  });

  test("gibt es die Stufe nicht mehr, zeigt der Bildschirm den Leer-Zustand mit «Zurück»", async () => {
    mockParams.id = "s9";
    await render(<StufeDetail />);

    expect(
      screen.getByText("Diese Stufe gibt es nicht mehr."),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Alert } from "react-native";

import KindDetail from "../app/(tabs)/verwaltung/kinder/[id]";
import Kinder from "../app/(tabs)/verwaltung/kinder/index";
import KindErfassen from "../app/(tabs)/verwaltung/kinder/neu";
import { ApiFehler, queryClient } from "../src/api/client";
import {
  useKindAendern,
  useKindAnlegen,
  useKinder,
  useKindLoeschen,
} from "../src/api/kinder";
import { usePersonen } from "../src/api/personen";
import { useStufen } from "../src/api/stufen";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockParams = { id: "k1" };
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
jest.mock("../src/api/kinder", () => ({
  useKinder: jest.fn(),
  useKindAnlegen: jest.fn(),
  useKindAendern: jest.fn(),
  useKindLoeschen: jest.fn(),
}));
jest.mock("../src/api/stufen", () => ({ useStufen: jest.fn() }));
jest.mock("../src/api/personen", () => ({ usePersonen: jest.fn() }));

const STUFEN = {
  stufen: [
    { id: "s1", name: "Biber", kuerzel: "Bi", reihenfolge: 1 },
    { id: "s2", name: "Wolf", kuerzel: "Wo", reihenfolge: 2 },
  ],
};
const KINDER = {
  kinder: [
    {
      id: "k1",
      vorname: "Lena",
      nachname: "Beispiel",
      stufeId: "s1",
      aktiv: true,
      eltern: ["p2"],
    },
    {
      id: "k2",
      vorname: "Noah",
      nachname: "Muster",
      stufeId: "s2",
      aktiv: false,
      eltern: [],
    },
  ],
};
const person = (id: string, name: string) => ({
  id,
  name,
  benutzername: name.toLowerCase().replace(" ", "."),
  admin: false,
  deaktiviert: false,
  mussPasswortAendern: false,
  startpasswortGueltigBis: null,
  rollen: [],
  elternteilVon: [],
});
// Absichtlich nicht nach Name sortiert: Die Reihenfolge im Bildschirm ergibt sich aus Verknüpfung und Name
const PERSONEN = {
  personen: [
    person("p1", "Zora Zürcher"),
    person("p2", "Beat Beispiel"),
    person("p3", "Anna Muster"),
  ],
  stufen: [],
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
let anlegen: Attrappe;
let aendern: Attrappe;
let loeschen: Attrappe;

const abfrage = (data: unknown) =>
  ({ data, isPending: false, refetch: jest.fn() }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.id = "k1";
  jest.mocked(useKinder).mockReturnValue(abfrage(KINDER));
  jest.mocked(useStufen).mockReturnValue(abfrage(STUFEN));
  jest.mocked(usePersonen).mockReturnValue(abfrage(PERSONEN));
  anlegen = mutation();
  aendern = mutation();
  loeschen = mutation();
  jest.mocked(useKindAnlegen).mockReturnValue(anlegen as never);
  jest.mocked(useKindAendern).mockReturnValue(aendern as never);
  jest.mocked(useKindLoeschen).mockReturnValue(loeschen as never);
});

describe("Liste", () => {
  test("zeigt Kind und Stufe, bei inaktiven «inaktiv, » davor; Zeilen und Knopf navigieren", async () => {
    await render(<Kinder />);

    expect(screen.getByRole("header", { name: "Kinder" })).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Lena Beispiel, Biber" }),
    ).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole("button", { name: "Noah Muster, inaktiv, Wolf" }),
    );
    expect(mockPush).toHaveBeenCalledWith("/verwaltung/kinder/k2");
    await fireEvent.press(
      screen.getByRole("button", { name: "Kind erfassen" }),
    );
    expect(mockPush).toHaveBeenCalledWith("/verwaltung/kinder/neu");
  });

  test("ohne Kinder steht der Hinweis neben dem Knopf «Kind erfassen»", async () => {
    jest.mocked(useKinder).mockReturnValue(abfrage({ kinder: [] }));
    await render(<Kinder />);

    expect(screen.getByText("Noch keine Kinder.")).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Kind erfassen" }),
    ).toBeOnTheScreen();
  });
});

describe("Neu", () => {
  test("ohne Stufe: Leer-Zustand «Zuerst eine Stufe anlegen.»", async () => {
    jest.mocked(useStufen).mockReturnValue(abfrage({ stufen: [] }));
    await render(<KindErfassen />);

    expect(screen.getByText("Zuerst eine Stufe anlegen.")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Vorname")).toBeNull();
  });

  test("die Stufe hat keine Vorauswahl und braucht eine Wahl, sonst steht der Fehler beim Feld", async () => {
    await render(<KindErfassen />);

    expect(screen.getByText("Stufe")).toBeOnTheScreen();
    for (const stufe of ["Biber", "Wolf"]) {
      expect(
        screen.getByRole("button", {
          name: `${stufe}, Stufe`,
          selected: false,
        }),
      ).toBeOnTheScreen();
    }
    await fireEvent.changeText(screen.getByLabelText("Vorname"), "Lena");
    await fireEvent.changeText(screen.getByLabelText("Nachname"), "Beispiel");
    await fireEvent.press(
      screen.getByRole("button", { name: "Kind erfassen" }),
    );

    expect(anlegen.mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Bitte eine Stufe wählen.")).toBeOnTheScreen();
  });

  test("leere Namen stehen beim Feld und senden nichts", async () => {
    await render(<KindErfassen />);
    await fireEvent.press(screen.getByRole("button", { name: "Wolf, Stufe" }));
    await fireEvent.changeText(screen.getByLabelText("Nachname"), "  ");
    await fireEvent.press(
      screen.getByRole("button", { name: "Kind erfassen" }),
    );

    expect(anlegen.mutate).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Bitte einen Vornamen mit höchstens 100 Zeichen eingeben.",
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Bitte einen Nachnamen mit höchstens 100 Zeichen eingeben.",
      ),
    ).toBeOnTheScreen();
  });

  test("nach dem Speichern bleibt der Bildschirm mit leeren Namen und derselben Stufe und sagt den Erfolg an", async () => {
    await render(<KindErfassen />);
    await fireEvent.changeText(screen.getByLabelText("Vorname"), " Lena ");
    await fireEvent.changeText(screen.getByLabelText("Nachname"), "Beispiel");
    await fireEvent.press(screen.getByRole("button", { name: "Wolf, Stufe" }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Kind erfassen" }),
    );

    expect(anlegen.mutate).toHaveBeenCalledWith(
      { vorname: "Lena", nachname: "Beispiel", stufeId: "s2" },
      expect.anything(),
    );
    await act(async () => anlegen.mutate.mock.calls[0][1].onSuccess());

    expect(screen.getByText("Lena Beispiel ist erfasst.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Vorname")).toHaveProp("value", "");
    expect(screen.getByLabelText("Nachname")).toHaveProp("value", "");
    expect(
      screen.getByRole("button", {
        name: "Wolf, Stufe",
        selected: true,
      }),
    ).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
  });

  test("ein Fehler der Mutation steht über dem Knopf und nimmt den Fokus", async () => {
    anlegen.error = new ApiFehler(400, "UNGUELTIGE_EINGABE", "x") as never;
    await render(<KindErfassen />);

    const text = "Das hat nicht geklappt. Bitte später nochmals versuchen.";
    expect(screen.getByText(text)).toBeOnTheScreen();
    const fokussiert = jest
      .mocked(AccessibilityInfo.sendAccessibilityEvent)
      .mock.calls.filter(([, art]) => art === "focus")
      .map(
        ([element]) =>
          (element as unknown as { props: { children?: unknown } }).props
            .children,
      );
    expect(fokussiert).toContain(text);
  });
});

describe("Detail", () => {
  const HINWEIS =
    "Eltern nur auf Angabe der Erziehungsberechtigten verknüpfen. Bei einem Obhuts- oder Kontaktverbot die Verknüpfung sofort lösen.";

  test("zeigt Namen, Stufe, Aktiv und die Eltern mit dem Hinweis darüber", async () => {
    await render(<KindDetail />);

    expect(
      screen.getByRole("header", { name: "Lena Beispiel" }),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText("Vorname")).toHaveProp("value", "Lena");
    expect(screen.getByLabelText("Nachname")).toHaveProp("value", "Beispiel");
    expect(
      screen.getByRole("button", { name: "Biber, Stufe", selected: true }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Ja, Aktiv", selected: true }),
    ).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Eltern" })).toBeOnTheScreen();
    expect(screen.getByText(HINWEIS)).toBeOnTheScreen();
  });

  test("Verknüpfte stehen zuerst, dann nach Name; die Reihenfolge bleibt beim Umschalten", async () => {
    await render(<KindDetail />);
    const namen = () =>
      screen
        .getAllByRole("button", { name: /^Ja, Elternteil / })
        .map((knopf) => knopf.props.accessibilityLabel);

    expect(namen()).toEqual([
      "Ja, Elternteil Beat Beispiel",
      "Ja, Elternteil Anna Muster",
      "Ja, Elternteil Zora Zürcher",
    ]);
    expect(
      screen.getByRole("button", {
        name: "Ja, Elternteil Beat Beispiel",
        selected: true,
      }),
    ).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole("button", { name: "Nein, Elternteil Beat Beispiel" }),
    );
    expect(namen()[0]).toBe("Ja, Elternteil Beat Beispiel");
  });

  test("«Speichern» schickt das ganze Formular; ein gelöster Elternteil fehlt in der Liste", async () => {
    await render(<KindDetail />);
    await fireEvent.press(
      screen.getByRole("button", { name: "Nein, Elternteil Beat Beispiel" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Ja, Elternteil Anna Muster" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Wolf, Stufe" }));
    await fireEvent.press(screen.getByRole("button", { name: "Nein, Aktiv" }));
    await fireEvent.changeText(screen.getByLabelText("Vorname"), "Lenja");
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));

    expect(aendern.mutate).toHaveBeenCalledWith(
      {
        id: "k1",
        vorname: "Lenja",
        nachname: "Beispiel",
        stufeId: "s2",
        aktiv: false,
        eltern: ["p3"],
      },
      expect.anything(),
    );
    await act(async () => aendern.mutate.mock.calls[0][1].onSuccess());
    expect(screen.getByText("Gespeichert.")).toBeOnTheScreen();
  });

  test("ein Fehler beim Speichern steht über dem Knopf; 404 lädt neu und geht zurück", async () => {
    aendern.error = new ApiFehler(400, "UNGUELTIGE_EINGABE", "x") as never;
    await render(<KindDetail />);
    expect(
      screen.getByText(
        "Das hat nicht geklappt. Bitte später nochmals versuchen.",
      ),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    const { onError } = aendern.mutate.mock.calls[0][1];
    onError(new ApiFehler(400, "UNGUELTIGE_EINGABE", "x"));
    expect(mockBack).not.toHaveBeenCalled();
    onError(new ApiFehler(404, "NICHT_GEFUNDEN", "x"));
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  test("«Löschen» läuft nur über den Dialog mit «Abbrechen» und «Löschen»", async () => {
    const dialog = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<KindDetail />);

    await fireEvent.press(screen.getByRole("button", { name: "Löschen" }));
    expect(loeschen.mutate).not.toHaveBeenCalled();
    expect(dialog).toHaveBeenCalledTimes(1);

    const [, , knoepfe] = dialog.mock.calls[0];
    expect(knoepfe?.map((knopf) => knopf.text)).toEqual([
      "Abbrechen",
      "Löschen",
    ]);
    knoepfe?.[1].onPress?.();
    expect(loeschen.mutate).toHaveBeenCalledWith("k1", expect.anything());
    loeschen.mutate.mock.calls[0][1].onSuccess();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  test("gibt es das Kind nicht mehr, zeigt der Bildschirm den Leer-Zustand", async () => {
    mockParams.id = "k9";
    await render(<KindDetail />);

    expect(
      screen.getByText("Dieses Kind gibt es nicht mehr."),
    ).toBeOnTheScreen();
  });
});

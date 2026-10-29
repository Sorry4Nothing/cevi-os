import { act, fireEvent, render, screen } from "@testing-library/react-native";
import {
  authenticateAsync,
  getEnrolledLevelAsync,
  SecurityLevel,
} from "expo-local-authentication";
import { useState, type ReactNode } from "react";
import {
  AppState,
  BackHandler,
  Keyboard,
  Pressable,
  TextInput,
  type AppStateStatus,
} from "react-native";

import { SperreProvider, useSperre } from "../src/sperre/SperreProvider";
import { Sperrschicht } from "../src/sperre/Sperrschicht";

jest.mock("../src/api/client", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  const horcher = new Set<() => void>();
  const zustand = {
    sitzung: { data: null, isPending: false, error: null },
    ich: { data: undefined },
  };
  const abonniere = (melden: () => void) => {
    horcher.add(melden);
    return () => horcher.delete(melden);
  };
  return {
    __setze(aenderung: Partial<typeof zustand>) {
      Object.assign(zustand, aenderung);
      horcher.forEach((melden) => melden());
    },
    useIchMock: () => useSyncExternalStore(abonniere, () => zustand.ich),
    authClient: {
      useSession: () => useSyncExternalStore(abonniere, () => zustand.sitzung),
    },
  };
});
jest.mock("../src/api/ich", () => ({
  useIch: () =>
    (
      jest.requireMock("../src/api/client") as { useIchMock: () => unknown }
    ).useIchMock(),
}));

const klient = jest.requireMock("../src/api/client") as {
  __setze: (aenderung: object) => void;
};
const speicher = (
  jest.requireMock("expo-secure-store") as { __speicher: Map<string, string> }
).__speicher;
const pruefen = jest.mocked(authenticateAsync);
const niveau = jest.mocked(getEnrolledLevelAsync);

const SITZUNG = { data: { user: { id: "u1" } }, isPending: false, error: null };
const OHNE_SITZUNG = { data: null, isPending: false, error: null };
const ELTERN = { data: { admin: false, rollen: [] } };
const LEITENDE = { data: { admin: false, rollen: ["leitung"] } };
// Das Overlay und der Inhalt darunter sind für die Suche versteckt, die Props prüfen wir trotzdem
const HIDDEN = { includeHiddenElements: true };
const FUENF_MINUTEN = 5 * 60 * 1000;
const ENTSPERREN_FEHLER =
  "Entsperren hat nicht geklappt. Bitte nochmals versuchen.";

// Der Entwurf lebt im Zustand des Inhalts: Hängt die Sperre ihn aus, ist er weg
function Entwurf() {
  const [text, setText] = useState("");
  return (
    <TextInput
      accessibilityLabel="Entwurf"
      accessibilityHint={undefined}
      value={text}
      onChangeText={setText}
    />
  );
}

function SperreAn() {
  const { setzeAus } = useSperre();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sperre einschalten"
      accessibilityHint={undefined}
      onPress={() => void setzeAus(false)}
    />
  );
}

function Wurzel({
  aus = false,
  children,
}: {
  aus?: boolean;
  children?: ReactNode;
}) {
  return (
    <SperreProvider anfangsAus={aus}>
      <Sperrschicht>
        <Entwurf />
        {children}
      </Sperrschicht>
    </SperreProvider>
  );
}

// Eine Abfrage, die erst auf Zuruf endet
function offeneAbfrage() {
  let beenden: (
    ergebnis: { success: true } | { success: false; error: never },
  ) => void = () => {};
  pruefen.mockReturnValueOnce(
    new Promise((fertig) => {
      beenden = fertig as typeof beenden;
    }) as never,
  );
  return {
    beenden: (ergebnis: Parameters<typeof beenden>[0]) =>
      act(async () => beenden(ergebnis)),
  };
}

async function warte() {
  await act(async () => {});
}

async function wechsle(neu: AppStateStatus) {
  const horcher = jest
    .mocked(AppState.addEventListener)
    .mock.calls.filter(([typ]) => typ === "change")
    .map(([, melden]) => melden);
  await act(async () => horcher.forEach((melden) => melden(neu)));
}

let jetzt = 1_000_000;
beforeEach(() => {
  jest.clearAllMocks();
  speicher.clear();
  jetzt = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => jetzt);
  niveau.mockResolvedValue(SecurityLevel.BIOMETRIC_STRONG);
  klient.__setze({ sitzung: SITZUNG, ich: ELTERN });
});
afterEach(() => jest.restoreAllMocks());

test("Kaltstart: Overlay statt Inhalt, die Abfrage läuft einmal von selbst", async () => {
  offeneAbfrage();
  await render(<Wurzel />);
  await warte();

  expect(
    screen.getByRole("header", { name: "Cevi OS ist gesperrt" }),
  ).toBeOnTheScreen();
  expect(pruefen).toHaveBeenCalledTimes(1);
  expect(pruefen).toHaveBeenCalledWith({
    promptMessage: "Cevi OS entsperren",
    cancelLabel: "Abbrechen",
  });
  // Solange eine Abfrage läuft, gibt es keine zweite (Android liefert dort app_cancel)
  expect(screen.getByRole("button", { name: "Entsperren" })).toBeDisabled();
});

test("gesperrt erreicht niemand den Inhalt, und beide Hinweise für die Screenreader stehen (Checkliste 7.1)", async () => {
  offeneAbfrage();
  await render(<Wurzel />);
  await warte();

  expect(screen.queryByLabelText("Entwurf")).toBeNull();
  // Beide Props, auf beiden Systemen: Android liest den einen, iOS den anderen
  expect(screen.getByTestId("sperre-inhalt", HIDDEN)).toHaveProp(
    "importantForAccessibility",
    "no-hide-descendants",
  );
  expect(screen.getByTestId("sperre-overlay", HIDDEN)).toHaveProp(
    "accessibilityViewIsModal",
    true,
  );
});

test("nach dem Entsperren steht der Inhalt wieder offen da", async () => {
  await render(<Wurzel />);
  await warte();

  expect(
    screen.queryByRole("header", { name: "Cevi OS ist gesperrt" }),
  ).toBeNull();
  expect(screen.getByLabelText("Entwurf")).toBeOnTheScreen();
  expect(screen.getByTestId("sperre-inhalt", HIDDEN)).toHaveProp(
    "importantForAccessibility",
    "auto",
  );
});

test("ein angefangener Entwurf überlebt die Sperre (Checkliste 7.2)", async () => {
  await render(<Wurzel />);
  await warte();
  await fireEvent.changeText(
    screen.getByLabelText("Entwurf"),
    "Hallo zusammen",
  );

  await wechsle("background");
  jetzt += FUENF_MINUTEN;
  const abfrage = offeneAbfrage();
  await wechsle("active");
  expect(screen.queryByLabelText("Entwurf")).toBeNull();
  expect(screen.getByDisplayValue("Hallo zusammen", HIDDEN)).toBeTruthy();

  await abfrage.beenden({ success: true });
  expect(screen.getByLabelText("Entwurf")).toHaveProp(
    "value",
    "Hallo zusammen",
  );
});

test("Abbrechen: kein Text, keine zweite Abfrage von selbst, nur der Knopf fragt wieder", async () => {
  pruefen.mockResolvedValueOnce({ success: false, error: "user_cancel" });
  await render(<Wurzel />);
  await warte();

  expect(pruefen).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(ENTSPERREN_FEHLER)).toBeNull();
  expect(screen.getByRole("button", { name: "Entsperren" })).toBeEnabled();

  await fireEvent.press(screen.getByRole("button", { name: "Entsperren" }));
  await warte();
  expect(pruefen).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("Entwurf")).toBeOnTheScreen();
});

test("ein Fehler steht als Text, bis es nochmals versucht wird (Checkliste 6.3, 8.2)", async () => {
  pruefen.mockResolvedValueOnce({
    success: false,
    error: "authentication_failed",
  });
  await render(<Wurzel />);
  await warte();
  expect(screen.getByText(ENTSPERREN_FEHLER)).toBeOnTheScreen();

  const abfrage = offeneAbfrage();
  await fireEvent.press(screen.getByRole("button", { name: "Entsperren" }));
  expect(screen.queryByText(ENTSPERREN_FEHLER)).toBeNull();
  await abfrage.beenden({ success: true });
});

test("fehlt dem System der Code («not_enrolled»), liest die App das Niveau nochmals", async () => {
  pruefen.mockResolvedValueOnce({ success: false, error: "not_enrolled" });
  await render(<Wurzel />);
  await warte();

  expect(screen.getByText(ENTSPERREN_FEHLER)).toBeOnTheScreen();
  // Einmal beim Start, einmal nach dem Fehler
  expect(niveau).toHaveBeenCalledTimes(2);
});

test("4:59 im Hintergrund sperrt nicht, 5:00 sperrt", async () => {
  await render(<Wurzel />);
  await warte();

  await wechsle("background");
  jetzt += FUENF_MINUTEN - 1;
  await wechsle("active");
  expect(screen.getByLabelText("Entwurf")).toBeOnTheScreen();

  await wechsle("background");
  jetzt += FUENF_MINUTEN;
  const abfrage = offeneAbfrage();
  await wechsle("active");
  expect(screen.queryByLabelText("Entwurf")).toBeNull();
  expect(
    screen.getByRole("header", { name: "Cevi OS ist gesperrt" }),
  ).toBeOnTheScreen();
  expect(pruefen).toHaveBeenCalledTimes(2);
  await abfrage.beenden({ success: true });
});

test("«inactive» allein sperrt nie (Face-ID-Abfrage, Kontrollzentrum)", async () => {
  await render(<Wurzel />);
  await warte();

  await wechsle("inactive");
  jetzt += 60 * FUENF_MINUTEN;
  await wechsle("active");

  expect(screen.getByLabelText("Entwurf")).toBeOnTheScreen();
  expect(pruefen).toHaveBeenCalledTimes(1);
});

test("die Anmeldung mit dem Passwort sperrt nicht gleich", async () => {
  klient.__setze({ sitzung: OHNE_SITZUNG, ich: { data: undefined } });
  await render(<Wurzel />);
  await warte();
  expect(pruefen).not.toHaveBeenCalled();

  await act(async () => klient.__setze({ sitzung: SITZUNG, ich: ELTERN }));
  await warte();

  expect(screen.getByLabelText("Entwurf")).toBeOnTheScreen();
  expect(
    screen.queryByRole("header", { name: "Cevi OS ist gesperrt" }),
  ).toBeNull();
  expect(pruefen).not.toHaveBeenCalled();
});

test("ohne Sitzung sperrt auch ein Hintergrund von 5 Minuten nicht", async () => {
  klient.__setze({ sitzung: OHNE_SITZUNG, ich: { data: undefined } });
  await render(<Wurzel />);
  await warte();

  await wechsle("background");
  jetzt += FUENF_MINUTEN;
  await wechsle("active");
  await act(async () => klient.__setze({ sitzung: SITZUNG, ich: ELTERN }));
  await warte();

  expect(pruefen).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Entwurf")).toBeOnTheScreen();
});

test("Leitende ohne Geräte-Code: «Geräte-Code fehlt», keine Daten, dann «Nochmals prüfen»", async () => {
  klient.__setze({ ich: LEITENDE });
  niveau.mockResolvedValueOnce(SecurityLevel.NONE);
  await render(<Wurzel />);
  await warte();

  expect(
    screen.getByRole("header", { name: "Geräte-Code fehlt" }),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(
      "Leitende, SL und Admins sehen die Daten erst, wenn das Gerät mit einem Geräte-Code gesichert ist.",
    ),
  ).toBeOnTheScreen();
  expect(screen.getByText(/^Einrichten/)).toBeOnTheScreen();
  expect(screen.queryByLabelText("Entwurf")).toBeNull();
  expect(pruefen).not.toHaveBeenCalled();

  // Der Code ist jetzt eingerichtet: Das System meldet es, die Sperre fragt von selbst
  await fireEvent.press(
    screen.getByRole("button", { name: "Nochmals prüfen" }),
  );
  await warte();
  expect(pruefen).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Entwurf")).toBeOnTheScreen();
});

test("Eltern ohne Geräte-Code haben keine Sperre und sehen den Inhalt", async () => {
  niveau.mockResolvedValue(SecurityLevel.NONE);
  await render(<Wurzel />);
  await warte();

  expect(screen.getByLabelText("Entwurf")).toBeOnTheScreen();
  expect(
    screen.queryByRole("header", { name: "Geräte-Code fehlt" }),
  ).toBeNull();
  expect(pruefen).not.toHaveBeenCalled();
});

test("abgeschaltet: Eltern haben keine Sperre", async () => {
  await render(<Wurzel aus />);
  await warte();
  expect(screen.getByLabelText("Entwurf")).toBeOnTheScreen();
  expect(pruefen).not.toHaveBeenCalled();
});

test("abgeschaltet gilt für Leitende nicht", async () => {
  klient.__setze({ ich: LEITENDE });
  offeneAbfrage();
  await render(<Wurzel aus />);
  await warte();

  expect(
    screen.getByRole("header", { name: "Cevi OS ist gesperrt" }),
  ).toBeOnTheScreen();
});

test("wer die Sperre wieder einschaltet, wird nicht sofort gesperrt", async () => {
  await render(
    <Wurzel aus>
      <SperreAn />
    </Wurzel>,
  );
  await warte();
  // Im Hintergrund lief die Zeit ab, die Sperre war aber aus
  await wechsle("background");
  jetzt += FUENF_MINUTEN;
  await wechsle("active");
  expect(screen.getByLabelText("Entwurf")).toBeOnTheScreen();

  await fireEvent.press(
    screen.getByRole("button", { name: "Sperre einschalten" }),
  );
  await warte();

  expect(screen.getByLabelText("Entwurf")).toBeOnTheScreen();
  expect(pruefen).not.toHaveBeenCalled();
});

test("ohne Sitzung fällt «aus» weg und der Schlüssel ist gelöscht", async () => {
  speicher.set("cevi-os_sperre", "aus");
  klient.__setze({ sitzung: OHNE_SITZUNG, ich: { data: undefined } });
  await render(<Wurzel aus />);
  await warte();

  expect(speicher.has("cevi-os_sperre")).toBe(false);
});

test("«Zurück» wird gesperrt verschluckt, offen nicht", async () => {
  const entfernen = jest.fn();
  const horcher = jest
    .spyOn(BackHandler, "addEventListener")
    .mockReturnValue({ remove: entfernen });
  const abfrage = offeneAbfrage();
  await render(<Wurzel />);
  await warte();

  expect(horcher).toHaveBeenCalledWith(
    "hardwareBackPress",
    expect.any(Function),
  );
  const [, beiZurueck] = horcher.mock.calls[0]!;
  expect((beiZurueck as () => boolean)()).toBe(true);

  await abfrage.beenden({ success: true });
  expect(entfernen).toHaveBeenCalled();
});

test("beim Sperren schliesst die Tastatur", async () => {
  const schliessen = jest.spyOn(Keyboard, "dismiss");
  offeneAbfrage();
  await render(<Wurzel />);
  await warte();

  expect(schliessen).toHaveBeenCalled();
});

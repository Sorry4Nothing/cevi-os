import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Alert } from "react-native";

import Profil from "../app/(tabs)/profil";
import { abmelden, ApiFehler, authClient } from "../src/api/client";
import { useIch } from "../src/api/ich";
import { useKontoLoeschen } from "../src/api/konto";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("../src/api/client", () => ({
  abmelden: jest.fn(),
  ApiFehler: class extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  authClient: { changePassword: jest.fn(), revokeSessions: jest.fn() },
}));
jest.mock("../src/api/ich", () => ({ useIch: jest.fn() }));
jest.mock("../src/api/konto", () => ({ useKontoLoeschen: jest.fn() }));

const ich = jest.mocked(useIch);
const ueberall = jest.mocked(authClient.revokeSessions);

const loeschen = {
  mutate: jest.fn(),
  reset: jest.fn(() => {
    loeschen.error = null;
  }),
  isPending: false,
  error: null as unknown,
};

beforeEach(() => {
  jest.clearAllMocks();
  loeschen.isPending = false;
  loeschen.error = null;
  jest.mocked(useKontoLoeschen).mockReturnValue(loeschen as never);
  ich.mockReturnValue({
    data: {
      name: "Eltern A",
      benutzername: "eltern.a",
      mussPasswortAendern: false,
      datenschutzGelesenAm: "2026-10-01T00:00:00.000Z",
    },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  } as never);
});

test("zeigt Name und Benutzername aus GET /ich mit den Abschnitten und Knöpfen", async () => {
  await render(<Profil />);

  expect(screen.getByRole("header", { name: "Profil" })).toBeOnTheScreen();
  expect(screen.getByText("Eltern A")).toBeOnTheScreen();
  expect(screen.getByText("Benutzername: eltern.a")).toBeOnTheScreen();
  expect(
    screen.getByRole("header", { name: "Passwort ändern" }),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText("Bisheriges Passwort")).toBeOnTheScreen();
  expect(screen.getByLabelText("Neues Passwort")).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Passwort ändern" }),
  ).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Abmelden" })).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Überall abmelden" }),
  ).toBeOnTheScreen();
});

test("«Abmelden» ruft die eine Abmelde-Funktion", async () => {
  await render(<Profil />);

  await fireEvent.press(screen.getByRole("button", { name: "Abmelden" }));

  expect(abmelden).toHaveBeenCalledTimes(1);
});

test("«Überall abmelden» beendet alle Sitzungen und meldet dann ab", async () => {
  ueberall.mockResolvedValue({ error: null } as never);
  await render(<Profil />);

  await fireEvent.press(
    screen.getByRole("button", { name: "Überall abmelden" }),
  );

  expect(ueberall).toHaveBeenCalledTimes(1);
  expect(abmelden).toHaveBeenCalledTimes(1);
});

test("ohne Netz bleibt die Person angemeldet und sieht eine Meldung", async () => {
  ueberall.mockRejectedValue(new TypeError("Network request failed"));
  await render(<Profil />);

  await fireEvent.press(
    screen.getByRole("button", { name: "Überall abmelden" }),
  );

  expect(
    await screen.findByText(
      "Keine Internetverbindung. Bitte später nochmals versuchen.",
    ),
  ).toBeOnTheScreen();
  expect(abmelden).not.toHaveBeenCalled();
});

test("nach dem Passwortwechsel bleibt die Erfolgsmeldung stehen (Checkliste 8.2)", async () => {
  jest
    .mocked(authClient.changePassword)
    .mockResolvedValue({ error: null } as never);
  await render(<Profil />);

  await fireEvent.changeText(
    screen.getByLabelText("Bisheriges Passwort"),
    "mein-altes-passwort",
  );
  await fireEvent.changeText(
    screen.getByLabelText("Neues Passwort"),
    "mein-neues-passwort",
  );
  await fireEvent.press(
    screen.getByRole("button", { name: "Passwort ändern" }),
  );

  expect(
    await screen.findByText(
      "Das Passwort ist geändert. Alle anderen Geräte sind abgemeldet.",
    ),
  ).toBeOnTheScreen();
});

test("«Hilfe» öffnet die Hilfe-Seite unter /profil/hilfe", async () => {
  await render(<Profil />);

  await fireEvent.press(
    screen.getByRole("button", {
      name: "Hilfe, Vertrauenspersonen und Anlaufstellen",
    }),
  );

  expect(mockPush).toHaveBeenCalledWith("/profil/hilfe");
});

describe("zweiter Faktor", () => {
  const alsAdmin = (zweiterFaktor: boolean) =>
    ich.mockReturnValue({
      data: {
        name: "Anna Muster",
        benutzername: "anna.muster",
        admin: true,
        zweiterFaktor,
      },
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    } as never);

  test("Eltern und Leitende sehen den Abschnitt nicht", async () => {
    await render(<Profil />);

    expect(screen.queryByRole("header", { name: "Zweiter Faktor" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Zweiten Faktor einrichten" }),
    ).toBeNull();
  });

  test("Admin ohne Faktor sieht «Zweiten Faktor einrichten» und kommt damit zur Einrichtung", async () => {
    alsAdmin(false);
    await render(<Profil />);

    expect(
      screen.getByRole("header", { name: "Zweiter Faktor" }),
    ).toBeOnTheScreen();
    expect(screen.queryByText("Zweiter Faktor eingerichtet")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Zweiten Faktor einrichten" }),
    );
    expect(mockPush).toHaveBeenCalledWith("/profil/zweiter-faktor");
  });

  test("Admin mit Faktor sieht «Zweiter Faktor eingerichtet», aber keinen Knopf", async () => {
    alsAdmin(true);
    await render(<Profil />);

    expect(screen.getByText("Zweiter Faktor eingerichtet")).toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: "Zweiten Faktor einrichten" }),
    ).toBeNull();
  });
});

describe("Konto löschen", () => {
  const dialog = () => jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const knopf = () => screen.getByRole("button", { name: "Konto löschen" });
  const fokus = () =>
    jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls.at(-1);
  // Nur die Props, nie das Element selbst: Ein Fehlschlag druckte den ganzen Fiber-Baum
  const fokusProps = () =>
    (fokus()![0] as unknown as { props: Record<string, unknown> }).props;

  afterEach(() => jest.restoreAllMocks());

  test("der Abschnitt steht nach «Überall abmelden» mit Überschrift, Passwortfeld und Knopf", async () => {
    await render(<Profil />);

    const rollen = screen
      .getAllByRole("header")
      .map((kopf) => kopf.props.children);
    expect(rollen.at(-1)).toBe("Konto löschen");
    expect(screen.getByLabelText("Passwort")).toBeOnTheScreen();
    expect(
      screen.getAllByRole("switch", { name: "Passwort anzeigen" }),
    ).toHaveLength(3);
    expect(knopf()).toBeOnTheScreen();
  });

  test("ohne Passwort kein Dialog, keine Anfrage, dafür der Hinweis am Feld mit Fokus", async () => {
    const alert = dialog();
    await render(<Profil />);

    await fireEvent.press(knopf());

    expect(alert).not.toHaveBeenCalled();
    expect(loeschen.mutate).not.toHaveBeenCalled();
    const text = screen.getByText("Bitte das Passwort eingeben.");
    expect(text).toBeOnTheScreen();
    expect(fokusProps().children).toBe(text.props.children);
  });

  test("alter Fehler und leeres Feld: genau eine Meldung, die am Feld", async () => {
    dialog();
    loeschen.error = new ApiFehler(429, "ZU_VIELE_ANFRAGEN", "x");
    await render(<Profil />);
    expect(
      screen.getByText("Zu viele Anfragen. Bitte später nochmals versuchen."),
    ).toBeOnTheScreen();

    await fireEvent.press(knopf());

    expect(loeschen.reset).toHaveBeenCalled();
    expect(screen.getByText("Bitte das Passwort eingeben.")).toBeOnTheScreen();
    expect(
      screen.queryByText("Zu viele Anfragen. Bitte später nochmals versuchen."),
    ).toBeNull();
  });

  test("die Meldung am leeren Feld geht beim Tippen weg", async () => {
    await render(<Profil />);
    await fireEvent.press(knopf());
    expect(screen.getByText("Bitte das Passwort eingeben.")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText("Passwort"), "g");

    expect(screen.queryByText("Bitte das Passwort eingeben.")).toBeNull();
  });

  test("zweiter Druck bei leerem Feld nimmt den Fokus erneut", async () => {
    await render(<Profil />);
    await fireEvent.press(knopf());
    jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();

    await fireEvent.press(knopf());

    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
    expect(fokusProps().children).toBe("Bitte das Passwort eingeben.");
  });

  test("mit Passwort fragt ein Dialog nach; «Abbrechen» schickt nichts und setzt den Fokus auf den Knopf", async () => {
    const alert = dialog();
    await render(<Profil />);
    await fireEvent.changeText(screen.getByLabelText("Passwort"), "geheim");

    await fireEvent.press(knopf());

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(
      "Konto löschen?",
      "Das Konto wird mit allen Rollen, Zuordnungen zu Kindern und eigenen Nachrichten gelöscht. Bei Eltern verschwinden auch die Einzelchats mit der Stufenleitung. Das lässt sich nicht rückgängig machen.",
      [
        { text: "Abbrechen", style: "cancel", onPress: expect.any(Function) },
        {
          text: "Löschen",
          style: "destructive",
          onPress: expect.any(Function),
        },
      ],
    );
    jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
    alert.mock.calls[0][2]![0].onPress!();
    expect(loeschen.mutate).not.toHaveBeenCalled();
    const art = fokus()![1];
    expect(art).toBe("focus");
    expect(fokusProps().accessibilityLabel).toBe("Konto löschen");
  });

  test("«Löschen» sendet das Passwort einmal", async () => {
    const alert = dialog();
    await render(<Profil />);
    await fireEvent.changeText(screen.getByLabelText("Passwort"), "geheim");
    await fireEvent.press(knopf());

    alert.mock.calls[0][2]![1].onPress!();

    expect(loeschen.mutate).toHaveBeenCalledTimes(1);
    expect(loeschen.mutate).toHaveBeenCalledWith("geheim");
  });

  test("während des Sendens ist der Knopf gesperrt", async () => {
    loeschen.isPending = true;
    await render(<Profil />);

    expect(
      screen.getByRole("button", { name: "Konto löschen", disabled: true }),
    ).toBeOnTheScreen();
  });

  test("ein falsches Passwort steht am Feld, mit Fokus; das Feld behält den Text", async () => {
    const { rerender } = await render(<Profil />);
    await fireEvent.changeText(screen.getByLabelText("Passwort"), "geheim");
    // Der Fehler kommt nach dem Absenden, nicht schon beim ersten Zeichnen
    loeschen.error = new ApiFehler(400, "PASSWORT_FALSCH", "x");
    await rerender(<Profil />);

    const text = screen.getByText("Das Passwort stimmt nicht.");
    expect(text).toBeOnTheScreen();
    expect(fokusProps().children).toBe(text.props.children);
    expect(screen.getByLabelText("Passwort").props.value).toBe("geheim");
  });

  test.each([
    [
      "letzter Admin",
      new ApiFehler(409, "LETZTER_ADMIN", "x"),
      "Der letzte Admin lässt sich nicht entfernen.",
    ],
    [
      "Wartezeit",
      new ApiFehler(429, "ZU_VIELE_ANFRAGEN", "x"),
      "Zu viele Anfragen. Bitte später nochmals versuchen.",
    ],
    [
      "kein Netz",
      new TypeError("Network request failed"),
      "Keine Internetverbindung. Bitte später nochmals versuchen.",
    ],
    [
      "unbekannter Code",
      new ApiFehler(500, "INTERNER_FEHLER", "x"),
      "Das hat nicht geklappt. Bitte später nochmals versuchen.",
    ],
  ])("%s: Text über dem Knopf, mit Fokus", async (_, fehler, erwartet) => {
    const { rerender } = await render(<Profil />);
    loeschen.error = fehler;
    await rerender(<Profil />);

    const text = screen.getByText(erwartet);
    expect(text).toBeOnTheScreen();
    expect(fokusProps().children).toBe(text.props.children);
    expect(screen.queryByText("Das Passwort stimmt nicht.")).toBeNull();
  });
});

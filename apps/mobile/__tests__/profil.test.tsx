import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Alert } from "react-native";
import {
  getEnrolledLevelAsync,
  SecurityLevel,
} from "expo-local-authentication";

import Profil from "../app/(tabs)/profil";
import { abmelden, ApiFehler, authClient, useOnline } from "../src/api/client";
import { useIch, usePushEinstellung } from "../src/api/ich";
import { useKontoLoeschen } from "../src/api/konto";
import { SperreProvider } from "../src/sperre/SperreProvider";

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
  useOnline: jest.fn(),
}));
jest.mock("../src/api/ich", () => ({
  useIch: jest.fn(),
  usePushEinstellung: jest.fn(),
}));
jest.mock("../src/api/konto", () => ({ useKontoLoeschen: jest.fn() }));

const ich = jest.mocked(useIch);
const ueberall = jest.mocked(authClient.revokeSessions);
const speicher = (
  jest.requireMock("expo-secure-store") as { __speicher: Map<string, string> }
).__speicher;

const baum = () => (
  <SperreProvider anfangsAus={false}>
    <Profil />
  </SperreProvider>
);
const zeige = () => render(baum());

function mitRolle(admin: boolean, rollen: string[]) {
  ich.mockReturnValue({
    data: { ...ich().data, admin, rollen },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  } as never);
}

const loeschen = {
  mutate: jest.fn(),
  reset: jest.fn(() => {
    loeschen.error = null;
  }),
  isPending: false,
  error: null as unknown,
};

// Ein Schalter-Zustand je Schlüssel, wie ihn useMutation liefert
const speichern = {
  pushChat: {
    mutate: jest.fn(),
    isPending: false,
    isError: false,
    variables: undefined as boolean | undefined,
  },
  pushProgramme: {
    mutate: jest.fn(),
    isPending: false,
    isError: false,
    variables: undefined as boolean | undefined,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useOnline).mockReturnValue(true);
  for (const zustand of Object.values(speichern)) {
    Object.assign(zustand, {
      isPending: false,
      isError: false,
      variables: undefined,
    });
  }
  jest
    .mocked(usePushEinstellung)
    .mockImplementation((schluessel) => speichern[schluessel] as never);
  loeschen.isPending = false;
  loeschen.error = null;
  jest.mocked(useKontoLoeschen).mockReturnValue(loeschen as never);
  speicher.clear();
  ich.mockReturnValue({
    data: {
      name: "Eltern A",
      benutzername: "eltern.a",
      mussPasswortAendern: false,
      datenschutzGelesenAm: "2026-10-01T00:00:00.000Z",
      pushChat: true,
      pushProgramme: false,
      admin: false,
      rollen: [],
    },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  } as never);
});

test("zeigt Name und Benutzername aus GET /ich mit den Abschnitten und Knöpfen", async () => {
  await zeige();

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
  await zeige();

  await fireEvent.press(screen.getByRole("button", { name: "Abmelden" }));

  expect(abmelden).toHaveBeenCalledTimes(1);
});

test("«Überall abmelden» beendet alle Sitzungen und meldet dann ab", async () => {
  ueberall.mockResolvedValue({ error: null } as never);
  await zeige();

  await fireEvent.press(
    screen.getByRole("button", { name: "Überall abmelden" }),
  );

  expect(ueberall).toHaveBeenCalledTimes(1);
  expect(abmelden).toHaveBeenCalledTimes(1);
});

test("ohne Netz bleibt die Person angemeldet und sieht eine Meldung", async () => {
  ueberall.mockRejectedValue(new TypeError("Network request failed"));
  await zeige();

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
  await zeige();

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

describe("Pushes", () => {
  const chat = () => screen.getByRole("switch", { name: /^Chat-Pushes/ });
  const programme = () =>
    screen.getByRole("switch", { name: /^Programm-Pushes/ });

  test("der Abschnitt steht vor «Abmelden»; die Schalter zeigen die Werte des Servers", async () => {
    await render(baum());

    const koepfe = screen
      .getAllByRole("header")
      .map((kopf) => kopf.props.children);
    // «App-Sperre» liegt dazwischen
    expect(koepfe.indexOf("Pushes")).toBe(koepfe.indexOf("Abmelden") - 2);
    expect(koepfe.indexOf("App-Sperre")).toBe(koepfe.indexOf("Abmelden") - 1);
    expect(chat()).toBeChecked();
    expect(programme()).not.toBeChecked();
  });

  test("ein Tipp sendet den umgekehrten Wert für genau diesen Schalter", async () => {
    await render(baum());

    await fireEvent.press(chat());
    await fireEvent.press(programme());

    expect(speichern.pushChat.mutate).toHaveBeenCalledWith(false);
    expect(speichern.pushProgramme.mutate).toHaveBeenCalledWith(true);
  });

  test("während des Speicherns zeigt der Schalter den neuen Wert, weitere Tipps zählen nicht", async () => {
    Object.assign(speichern.pushChat, { isPending: true, variables: false });
    await render(baum());

    expect(chat()).not.toBeChecked();
    await fireEvent.press(chat());
    expect(speichern.pushChat.mutate).not.toHaveBeenCalled();
  });

  test("ein Fehler lässt den Wert des Servers stehen; die Meldung nimmt den Fokus und bleibt", async () => {
    speichern.pushChat.isError = true;
    await render(baum());

    expect(chat()).toBeChecked();
    const text = screen.getByText(
      "Die Einstellung liess sich nicht speichern.",
    );
    expect(text).toBeOnTheScreen();
    // Beim ersten Zeichnen nimmt danach die Überschrift den Fokus; die Meldung war vorher dran
    const fokussiert = jest
      .mocked(AccessibilityInfo.sendAccessibilityEvent)
      .mock.calls.map(
        ([element]) =>
          (element as unknown as { props: { children: unknown } }).props
            .children,
      );
    expect(fokussiert).toContain(text.props.children);
  });

  test("ohne Netz sind beide Schalter gesperrt", async () => {
    jest.mocked(useOnline).mockReturnValue(false);
    await render(baum());

    expect(chat()).toBeDisabled();
    expect(programme()).toBeDisabled();
  });
});

test("«App-Sperre»: für Eltern ein Schalter, standardmässig an; aus schreibt «aus», an löscht den Schlüssel", async () => {
  await zeige();
  expect(screen.getByRole("header", { name: "App-Sperre" })).toBeOnTheScreen();
  const schalter = screen.getByRole("switch", { name: "App-Sperre" });
  expect(schalter).toBeChecked();

  await fireEvent.press(schalter);
  expect(speicher.get("cevi-os_sperre")).toBe("aus");
  expect(screen.getByRole("switch", { name: "App-Sperre" })).not.toBeChecked();

  await fireEvent.press(screen.getByRole("switch", { name: "App-Sperre" }));
  expect(speicher.has("cevi-os_sperre")).toBe(false);
  expect(screen.getByRole("switch", { name: "App-Sperre" })).toBeChecked();
});

test.each([
  ["Leitende", false, ["leitung"]],
  ["Admins", true, []],
])(
  "«App-Sperre»: für %s kein Schalter, nur der Hinweis",
  async (_name, admin, rollen) => {
    mitRolle(admin, rollen);
    await zeige();

    expect(
      screen.getByText(
        "Für Leitende, SL und Admins ist die App-Sperre immer an.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("switch", { name: "App-Sperre" })).toBeNull();
  },
);

test("«App-Sperre»: ohne Geräte-Code steht die Zeile, dass die Sperre einen braucht", async () => {
  jest.mocked(getEnrolledLevelAsync).mockResolvedValueOnce(SecurityLevel.NONE);
  await zeige();

  expect(
    await screen.findByText(
      "Die App-Sperre wirkt erst, wenn das Gerät mit einem Geräte-Code gesichert ist.",
    ),
  ).toBeOnTheScreen();
});

test("«App-Sperre»: mit Geräte-Code steht die Zeile nicht", async () => {
  await zeige();

  expect(screen.queryByText(/mit einem Geräte-Code/)).toBeNull();
});

test("«Hilfe» öffnet die Hilfe-Seite unter /profil/hilfe", async () => {
  await zeige();

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
    await zeige();

    expect(screen.queryByRole("header", { name: "Zweiter Faktor" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Zweiten Faktor einrichten" }),
    ).toBeNull();
  });

  test("Admin ohne Faktor sieht «Zweiten Faktor einrichten» und kommt damit zur Einrichtung", async () => {
    alsAdmin(false);
    await zeige();

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
    await zeige();

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
    await zeige();

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
    await zeige();

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
    await zeige();
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
    await zeige();
    await fireEvent.press(knopf());
    expect(screen.getByText("Bitte das Passwort eingeben.")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText("Passwort"), "g");

    expect(screen.queryByText("Bitte das Passwort eingeben.")).toBeNull();
  });

  test("zweiter Druck bei leerem Feld nimmt den Fokus erneut", async () => {
    await zeige();
    await fireEvent.press(knopf());
    jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();

    await fireEvent.press(knopf());

    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
    expect(fokusProps().children).toBe("Bitte das Passwort eingeben.");
  });

  test("mit Passwort fragt ein Dialog nach; «Abbrechen» schickt nichts und setzt den Fokus auf den Knopf", async () => {
    const alert = dialog();
    await zeige();
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
    await zeige();
    await fireEvent.changeText(screen.getByLabelText("Passwort"), "geheim");
    await fireEvent.press(knopf());

    alert.mock.calls[0][2]![1].onPress!();

    expect(loeschen.mutate).toHaveBeenCalledTimes(1);
    expect(loeschen.mutate).toHaveBeenCalledWith("geheim");
  });

  test("während des Sendens ist der Knopf gesperrt", async () => {
    loeschen.isPending = true;
    await zeige();

    expect(
      screen.getByRole("button", { name: "Konto löschen", disabled: true }),
    ).toBeOnTheScreen();
  });

  test("ein falsches Passwort steht am Feld, mit Fokus; das Feld behält den Text", async () => {
    const { rerender } = await zeige();
    await fireEvent.changeText(screen.getByLabelText("Passwort"), "geheim");
    // Der Fehler kommt nach dem Absenden, nicht schon beim ersten Zeichnen
    loeschen.error = new ApiFehler(400, "PASSWORT_FALSCH", "x");
    await rerender(baum());

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
    const { rerender } = await zeige();
    loeschen.error = fehler;
    await rerender(baum());

    const text = screen.getByText(erwartet);
    expect(text).toBeOnTheScreen();
    expect(fokusProps().children).toBe(text.props.children);
    expect(screen.queryByText("Das Passwort stimmt nicht.")).toBeNull();
  });
});

import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from "expo-router/testing-library";
import { Platform } from "react-native";

// Dieselbe Attrappe wie in tor.test.tsx; der Schritt «Pushes» erreicht daneben nur die expo-notifications-Attrappe
jest.mock("../src/api/client", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  const { QueryClient } = jest.requireActual("@tanstack/react-query");
  const horcher = new Set<() => void>();
  const zustand = {
    veraltet: false,
    sitzung: { data: null, isPending: false, error: null, refetch: jest.fn() },
    ich: {
      data: undefined,
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    },
  };
  const abonniere = (melden: () => void) => {
    horcher.add(melden);
    return () => horcher.delete(melden);
  };
  return {
    __zustand: zustand,
    __setze(aenderung: Partial<typeof zustand>) {
      Object.assign(zustand, aenderung);
      horcher.forEach((melden) => melden());
    },
    useIchMock: () => useSyncExternalStore(abonniere, () => zustand.ich),
    useAppVeraltet: () =>
      useSyncExternalStore(abonniere, () => zustand.veraltet),
    authClient: {
      useSession: () => useSyncExternalStore(abonniere, () => zustand.sitzung),
      signIn: { username: jest.fn() },
      changePassword: jest.fn(),
      revokeSessions: jest.fn(),
    },
    queryClient: new QueryClient(),
    abmelden: jest.fn(),
    useOnline: () => true,
    api: {
      api: {
        v1: {
          ich: { datenschutz: { $post: jest.fn() } },
          programme: {
            $get: jest.fn(async () => ({
              json: async () => ({ programme: [] }),
            })),
          },
          "push-token": { $put: jest.fn(async () => ({})) },
        },
      },
    },
    ApiFehler: class ApiFehler extends Error {},
  };
});
jest.mock("../src/api/ich", () => ({
  useIch: () =>
    (
      jest.requireMock("../src/api/client") as { useIchMock: () => unknown }
    ).useIchMock(),
}));

type Klient = {
  __setze: (aenderung: object) => void;
  queryClient: import("@tanstack/react-query").QueryClient;
  api: {
    api: { v1: { "push-token": { $put: jest.Mock } } };
  };
};
const klient = jest.requireMock("../src/api/client") as Klient;
const put = klient.api.api.v1["push-token"].$put;

const erlaubnis = jest.mocked(Notifications.getPermissionsAsync);
const frage = jest.mocked(Notifications.requestPermissionsAsync);
const kanal = jest.mocked(Notifications.setNotificationChannelAsync);
const holeToken = jest.mocked(Notifications.getExpoPushTokenAsync);

const SITZUNG = {
  data: { user: { id: "u1" }, session: { id: "s1" } },
  isPending: false,
  error: null,
  refetch: jest.fn(),
};
const ICH_BEREIT = {
  data: {
    name: "Eltern A",
    benutzername: "eltern.a",
    admin: false,
    mussPasswortAendern: false,
    datenschutzGelesenAm: "2026-10-01T00:00:00.000Z",
    rollen: [],
    stufen: [],
    kinder: [],
  },
  isPending: false,
  isError: false,
  refetch: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  erlaubnis.mockResolvedValue({ granted: true, canAskAgain: true } as never);
  frage.mockResolvedValue({ granted: true, canAskAgain: true } as never);
  put.mockImplementation(async () => ({}));
  klient.queryClient.clear();
  klient.__setze({
    veraltet: false,
    sitzung: SITZUNG,
    ich: ICH_BEREIT,
  });
});
afterEach(() => jest.restoreAllMocks());

test("solange die Frage offen ist, endet der Startablauf beim Schritt «Pushes», noch ohne Systemfrage", async () => {
  erlaubnis.mockResolvedValue({ granted: false, canAskAgain: true } as never);
  await renderRouter("./app", { initialUrl: "/" });

  expect(screen).toHavePathname("/pushes");
  expect(screen.getByRole("header", { name: "Pushes" })).toBeOnTheScreen();
  expect(
    screen.getByText(
      "Ein Push enthält nie den Text einer Nachricht und nie Namen von Kindern.",
    ),
  ).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Weiter" })).toBeOnTheScreen();
  expect(frage).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

test("mit erteilter Erlaubnis öffnen sich die Tabs ohne den Schritt", async () => {
  await renderRouter("./app", { initialUrl: "/" });

  expect(screen).toHavePathname("/programme");
});

test("lässt das System keine Frage mehr zu (canAskAgain false), fällt der Schritt weg", async () => {
  erlaubnis.mockResolvedValue({ granted: false, canAskAgain: false } as never);
  await renderRouter("./app", { initialUrl: "/" });

  expect(screen).toHavePathname("/programme");
});

test("eine scheiternde Abfrage überspringt den Schritt", async () => {
  erlaubnis.mockRejectedValue(new Error("kein Modul"));
  await renderRouter("./app", { initialUrl: "/" });

  expect(screen).toHavePathname("/programme");
});

test("«Weiter» legt erst die Kanäle an, fragt dann das System und führt zu den Tabs, auch wenn canAskAgain true bleibt", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  erlaubnis.mockResolvedValue({ granted: false, canAskAgain: true } as never);
  frage.mockResolvedValue({ granted: false, canAskAgain: true } as never);
  await renderRouter("./app", { initialUrl: "/" });
  expect(screen).toHavePathname("/pushes");

  await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
  await act(async () => {});

  // Nach dem Schritt registrieren die Tabs und legen die Kanäle nochmals an; hier zählen die beiden vor der Systemfrage
  expect(kanal.mock.calls.slice(0, 2).map(([id]) => id)).toEqual([
    "chat",
    "programme",
  ]);
  expect(kanal.mock.invocationCallOrder[1]).toBeLessThan(
    frage.mock.invocationCallOrder[0],
  );
  expect(screen).toHavePathname("/programme");
});

test("jede neue Sitzung meldet das Token erneut", async () => {
  (Constants.expoConfig as { extra?: unknown }).extra = {
    eas: { projectId: "projekt-1" },
  };
  holeToken.mockResolvedValue({
    type: "expo",
    data: "ExpoPushToken[geraet]",
  } as never);
  await renderRouter("./app", { initialUrl: "/" });
  expect(screen).toHavePathname("/programme");
  await act(async () => {});
  expect(put).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledWith({
    json: { token: "ExpoPushToken[geraet]", plattform: "ios" },
  });

  await act(async () =>
    klient.__setze({
      sitzung: { ...SITZUNG, data: { ...SITZUNG.data, session: { id: "s2" } } },
    }),
  );
  await act(async () => {});

  expect(put).toHaveBeenCalledTimes(2);
  (Constants.expoConfig as { extra?: unknown }).extra = undefined;
});
